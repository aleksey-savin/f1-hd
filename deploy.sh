#!/usr/bin/env bash
#
# HD — deployment on one Linux host (Debian/Ubuntu or Fedora/RHEL family).
#
#   ./deploy.sh                 install or update: Docker if missing, .env with
#                               generated secrets, build or pull images,
#                               backup, migrate, start
#   ./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
#   ./deploy.sh restore DIR     load a backup into this installation
#   ./deploy.sh migrate ARGS    status | up | baseline <id> | mark <id>
#   ./deploy.sh status          build, containers and health
#   ./deploy.sh logs [service]  follow logs
#   ./deploy.sh env             only create/repair .env
#
# Needs bash, curl, openssl and root (or a user in the docker group once Docker
# is installed). Everything else runs in containers. See docs/deployment.md.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

log() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
dc()  { docker compose -f compose.yml "$@"; }

usage() { sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'; }

# --- prerequisites ----------------------------------------------------------

need_tools() {
  local tool
  for tool in curl openssl; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
  done
}

# compose.yml gives every image build a named context (`additional_contexts`),
# which Docker Compose reads since 2.17. Takes `docker compose version --short`
# ("2.20.2", "v2.20.2", "2.39.1-desktop.1"); fails only for a version that
# parses and is lower. A string that does not parse is not judged.
compose_version_ok() {
  local version=${1#v}
  [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]] || return 0
  local major=$((10#${BASH_REMATCH[1]})) minor=$((10#${BASH_REMATCH[2]}))
  [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 17 ]; }
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    [ "$(id -u)" = 0 ] || die "Docker (with the compose plugin) is missing; run this script as root once to install it"
    log "Installing Docker Engine from docker.com (apt or dnf, depending on the distro)"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon: run as root or add yourself to the docker group"
  local compose_version
  compose_version=$(docker compose version --short 2>/dev/null || true)
  compose_version_ok "$compose_version" \
    || die "Docker Compose 2.17 or newer is required (found $compose_version): compose.yml uses named build contexts. Update the docker-compose-plugin package and run ./deploy.sh again."
}

# --- .env -------------------------------------------------------------------

# Always the literal .env: Docker Compose reads that file and nothing else, so
# the script must not be pointed elsewhere from the operator's environment.
# Only a test that loads the functions (DEPLOY_SH_SOURCED=1) may redirect it.
ENV_FILE=.env
if [ "${DEPLOY_SH_SOURCED:-}" = 1 ]; then ENV_FILE=${DEPLOY_TEST_ENV_FILE:-.env}; fi

# Value of a key in $ENV_FILE, surrounding quotes stripped. Empty when absent.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"
}

# Every append to .env goes through this first: a file whose last line has no
# newline would otherwise get the new key glued onto that line.
env_eol() {
  if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then
    echo >> "$ENV_FILE"
  fi
}

# Replace or append KEY=VALUE in .env.
env_set() {
  local value
  value=$(printf '%s' "$2" | sed 's/[&#\\]/\\&/g')
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^$1=.*#$1=$value#" "$ENV_FILE"
  else
    env_eol
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

env_has() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null; }

# Ask for a value unless it is already set. Non-interactive runs take the default.
ask() {
  local key=$1 prompt=$2 default=$3 value=""
  [ -n "$(env_get "$key")" ] && return 0
  if [ -t 0 ]; then
    read -r -p "$prompt [$default]: " value
  fi
  value=${value:-$default}
  [ -n "$value" ] || die "$key is not set in .env"
  env_set "$key" "$value"
}

# Ask once for a value that may stay empty; the key is written either way so
# the question is not repeated on the next run.
ask_optional() {
  local key=$1 prompt=$2 value=""
  env_has "$key" && return 0
  if [ -t 0 ]; then
    read -r -p "$prompt [empty = skip]: " value
  fi
  env_set "$key" "$value"
}

host_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' | grep . \
    || ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1); exit}' | grep . \
    || echo 127.0.0.1
}

port_of()  { printf '%s' "${1##*:}"; }
bind_host() { case "$1" in *:*) printf '%s' "${1%:*}" ;; *) printf '127.0.0.1' ;; esac; }

# Mail mode (MAIL_MODE). An installation configured before this setting existed
# was sending mail, so it keeps doing so: "live" is written once and announced.
# A new .env starts with "off" — the operator switches mail on deliberately.
# The dev stack (COMPOSE_FILE=compose.dev.yml) runs on a copy of production
# data and must never be switched to live by a script.
ensure_mail_mode() {
  local existing=$1
  env_has MAIL_MODE && return 0
  if [ "$existing" = yes ]; then
    case "$(env_get COMPOSE_FILE)" in
      *dev*)
        env_set MAIL_MODE off
        echo "MAIL_MODE was not set: wrote MAIL_MODE=off (dev stack). Use MAIL_MODE=sandbox with MAIL_SANDBOX_RECIPIENT to receive mail."
        ;;
      *)
        env_set MAIL_MODE live
        echo "MAIL_MODE was not set: wrote MAIL_MODE=live to .env so this installation keeps sending e-mail."
        warn_legacy_brand
        ;;
    esac
  else
    env_eol
    printf '%s\n' \
      '# Outgoing e-mail: live = real recipients, sandbox = everything to' \
      '# MAIL_SANDBOX_RECIPIENT, off = nothing is sent. See .env.example.' \
      'MAIL_MODE=off' >> "$ENV_FILE"
    echo "Outgoing e-mail is switched off (MAIL_MODE=off in .env). Set MAIL_MODE=live once mail is configured in Settings."
  fi
}

# The portal name and the e-mail signature became settings in the same release
# as MAIL_MODE, and the seedBrand migration carries the earlier wording over
# only from LEGACY_BRAND_NAME / LEGACY_BRAND_SIGNATURE. Asking the database
# whether that migration has run is not cheap from here, so the warning is tied
# to the run that writes MAIL_MODE=live — the first run of that release on an
# installation that was already in use. A warning, not a stop.
warn_legacy_brand() {
  env_has LEGACY_BRAND_NAME && return 0
  printf '%s\n' \
    "WARNING: LEGACY_BRAND_NAME is not set in $ENV_FILE." \
    "  This update turns the portal name and the e-mail signature into settings." \
    "  Unless LEGACY_BRAND_NAME / LEGACY_BRAND_SIGNATURE are in $ENV_FILE before this" \
    "  deploy migrates the database (see .env.example), both switch to the product" \
    "  defaults; the values can then be entered in Settings" \
    "  (Настройки → Основные → Бренд). This warning is not repeated." >&2
}

# Error tracking (SENTRY_DSN, optional). The browser may only talk to origins
# the CSP allows, and the CSP is written by nginx in the frontend container,
# which gets nothing but SENTRY_CSP_ORIGIN (compose.yml). Keep that key in .env
# equal to the DSN's scheme://host[:port] — no key, no path — on every run, so
# plain `docker compose up` sees the same value as this script.
ensure_sentry_origin() {
  local dsn origin="" rest
  dsn=$(env_get SENTRY_DSN)
  if [ -n "$dsn" ]; then
    rest=${dsn#*://}      # key@host[:port]/project
    rest=${rest%%/*}      # key@host[:port]
    origin="${dsn%%://*}://${rest##*@}"
    # The value lands inside a quoted nginx string: accept a plain origin only.
    if ! printf '%s' "$origin" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
      echo "WARNING: SENTRY_DSN does not look like https://<key>@<host>/<project>; error tracking stays blocked by the CSP."
      origin=""
    fi
  fi
  [ "$(env_get SENTRY_CSP_ORIGIN)" = "$origin" ] && return 0
  # Nothing to clear and nothing to set: do not add an empty key.
  [ -z "$origin" ] && ! env_has SENTRY_CSP_ORIGIN && return 0
  env_set SENTRY_CSP_ORIGIN "$origin"
}

# Prefix of the ticket tag in e-mail subjects (TICKET_SUBJECT_PREFIX). A new
# .env gets the key with an empty value: the product default applies, and the
# key itself records that this installation was set up with the setting in
# place. An installation configured earlier has no such key — see
# require_subject_prefix.
ensure_subject_prefix() {
  local existing=$1
  env_has TICKET_SUBJECT_PREFIX && return 0
  [ "$existing" = yes ] && return 0
  env_eol
  printf '%s\n' \
    '# Prefix of the ticket tag in e-mail subjects; empty = the product default.' \
    '# Set it before the first e-mail goes out, not after. See .env.example.' \
    'TICKET_SUBJECT_PREFIX=' >> "$ENV_FILE"
}

# Replies are matched to tickets by the tag in the subject. An installation
# that was sending mail before the prefix became a setting must name the prefix
# its letters already carry; guessing it here would orphan every reply to
# earlier mail. Called by the install/update path only, after ensure_env, so
# `./deploy.sh env` can still create and repair .env.
require_subject_prefix() {
  env_has TICKET_SUBJECT_PREFIX && return 0
  die "TICKET_SUBJECT_PREFIX is not set in $ENV_FILE.
This installation was configured before the prefix became a setting, and replies
to its earlier e-mails are matched to tickets by that prefix. Look at the subject
of any ticket notification it has sent: the tag in square brackets is
<prefix>-<ticket number>. Add the line
    TICKET_SUBJECT_PREFIX=<prefix>
to $ENV_FILE (the text inside the brackets before the last hyphen and the number)
and run ./deploy.sh again. Nothing has been built or restarted."
}

# --- images: built here or pulled -------------------------------------------

# IMAGE_REGISTRY of .env without trailing slashes; a value of slashes only is
# no registry. The one reading of the key: mode and prefix cannot disagree.
image_registry() {
  local registry
  registry=$(env_get IMAGE_REGISTRY)
  while [ "${registry%/}" != "$registry" ]; do registry=${registry%/}; done
  printf '%s' "$registry"
}

# "pull" when IMAGE_REGISTRY is set in .env, "build" otherwise.
image_mode() {
  if [ -n "$(image_registry)" ]; then echo pull; else echo build; fi
}

# compose.yml names the images ${IMAGE_PREFIX}backend:${IMAGE_TAG}. The prefix
# is derived here and kept in .env, so that a plain `docker compose ps|up|logs`
# sees the same names as this script (the way SENTRY_CSP_ORIGIN is kept).
#   build mode: hd-backend:latest — the name compose gave these images before
#   pull mode:  <IMAGE_REGISTRY>/backend:<IMAGE_TAG>
ensure_image_source() {
  local registry tag
  registry=$(image_registry)
  tag=$(env_get IMAGE_TAG)
  if [ -z "$registry" ]; then
    [ -z "$tag" ] || die "IMAGE_TAG=$tag is set but IMAGE_REGISTRY is empty: set both to run pulled images, or clear IMAGE_TAG to build here"
    env_set IMAGE_PREFIX hd-
    return 0
  fi
  case "$registry" in
    *[!A-Za-z0-9._:/-]*) die "IMAGE_REGISTRY has characters a registry path cannot have: '$registry'" ;;
  esac
  [ -n "$tag" ] || die "IMAGE_REGISTRY is set, so IMAGE_TAG must name the release to run (for example IMAGE_TAG=2.1.0)"
  [ "$tag" != latest ] || die "IMAGE_TAG=latest is not accepted: name a release, so that an update is a decision and a rollback is possible"
  case "$tag" in
    *[!A-Za-z0-9._-]*) die "IMAGE_TAG has characters an image tag cannot have: '$tag'" ;;
  esac
  env_set IMAGE_PREFIX "$registry/"
}

# Version and commit of the tree being built; passed to the image builds.
# A tree that is a git checkout but whose commit cannot be read (no git on the
# host, or git refuses the repository — "dubious ownership" under another
# user) is built as <version>+dev, and that is said aloud: browsers compare
# build ids, and a build that is +dev again does not look new to them.
build_identity() {
  local git_error=""
  APP_VERSION=dev; APP_COMMIT=dev
  [ -f VERSION ] && APP_VERSION=$(tr -d '[:space:]' < VERSION)
  if ! command -v git >/dev/null 2>&1; then
    git_error="git is not installed"
  elif ! git_error=$(git rev-parse --git-dir 2>&1 >/dev/null); then
    git_error=$(printf '%s\n' "$git_error" | head -n 1)
    git_error=${git_error:-git rev-parse failed}
  else
    git_error=""
    APP_COMMIT=$(git rev-parse --short=12 HEAD)
    [ -z "$(git status --porcelain 2>/dev/null)" ] || APP_COMMIT="$APP_COMMIT.dirty"
  fi
  if [ -n "$git_error" ] && [ -e .git ]; then
    echo "warning: cannot read the commit from git ($git_error): the build is labelled $APP_VERSION+dev, and open tabs will not be told about this update" >&2
  fi
  export APP_VERSION APP_COMMIT
}

# Application services of this installation, one per line: the images that are
# pulled and then checked. tg-service only with the telegram profile.
image_services() {
  echo backend
  echo frontend
  if [ "$(env_get COMPOSE_PROFILES)" = telegram ]; then echo tg-service; fi
}

# Pull the application images and make sure each one is on this host. Compose's
# exit code is not enough: for a service that also has `build:` some versions
# only warn that the image "must be built from source" and exit 0.
pull_images() {
  local prefix tag service services=()
  prefix=$(env_get IMAGE_PREFIX); tag=$(env_get IMAGE_TAG)
  mapfile -t services < <(image_services)
  dc pull "${services[@]}" \
    || die "cannot pull $prefix*:$tag: check IMAGE_TAG, the registry login (docker login) and the network; nothing was stopped"
  for service in "${services[@]}"; do
    docker image inspect "$prefix$service:$tag" >/dev/null 2>&1 \
      || die "image $prefix$service:$tag is not on this host after the pull: check IMAGE_TAG, the registry login (docker login) and the network; nothing was stopped"
  done
}

# "2.1.0+3f2a9c1d07be" of the backend that runs now; empty when none runs or
# the image predates build identities.
running_build() {
  dc exec -T backend cat /app/build-info.json 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)","commit":"\([^"]*\)".*/\1+\2/p' || true
}

# The running build for the log and for `status`, given running_build's output:
# the build id; "unknown (…)" when a backend runs but its image has no
# build-info.json; "nothing" when no backend runs.
running_build_label() {
  if [ -n "$1" ]; then
    printf '%s' "$1"
  elif [ -n "$(dc ps -q backend 2>/dev/null | head -n 1)" ]; then
    printf 'unknown (image predates build identities)'
  else
    printf 'nothing'
  fi
}

ensure_env() {
  # "Existing" = configured by an earlier run: the database password is there.
  local existing=no
  [ -n "$(env_get MONGODB_PASSWORD)" ] && existing=yes
  [ -f "$ENV_FILE" ] || : > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ensure_mail_mode "$existing"
  ensure_subject_prefix "$existing"
  ensure_sentry_origin
  ensure_image_source
  [ -n "$(env_get MONGODB_USERNAME)" ]   || env_set MONGODB_USERNAME hd
  [ -n "$(env_get MONGODB_DATABASE)" ]   || env_set MONGODB_DATABASE hd
  [ -n "$(env_get MONGODB_PASSWORD)" ]   || env_set MONGODB_PASSWORD "$(openssl rand -hex 24)"
  [ -n "$(env_get BETTER_AUTH_SECRET)" ] || env_set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  [ -n "$(env_get APP_ENC_KEY)" ]        || env_set APP_ENC_KEY "$(openssl rand -base64 32)"
  [ -n "$(env_get TG_API_TOKEN)" ]       || env_set TG_API_TOKEN "$(openssl rand -hex 32)"
  [ -n "$(env_get HTTP_PORT)" ]          || env_set HTTP_PORT 8080
  ask APP_PUBLIC_URL "Public URL of the app (what browsers will open)" \
      "http://$(host_ip):$(port_of "$(env_get HTTP_PORT)")"
  if ! docker volume inspect hd_data >/dev/null 2>&1; then
    ask BOOTSTRAP_ADMIN_EMAIL "E-mail of the first administrator" "admin@example.com"
  fi
  ask_optional TG_TOKEN "Telegram bot token from @BotFather"
  if [ -n "$(env_get TG_TOKEN)" ]; then
    env_set COMPOSE_PROFILES telegram
  else
    env_set COMPOSE_PROFILES ""
  fi
}

# Database credentials for backup/restore.
load_env() {
  [ -f "$ENV_FILE" ] || die "no .env here — run ./deploy.sh env first"
  DB_USER=$(env_get MONGODB_USERNAME)
  DB_PASS=$(env_get MONGODB_PASSWORD)
  DB_NAME=$(env_get MONGODB_DATABASE)
  [ -n "$DB_USER" ] && [ -n "$DB_PASS" ] && [ -n "$DB_NAME" ] \
    || die "MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE missing in $ENV_FILE"
}

# --- docker helpers ---------------------------------------------------------

mongo_container() {
  dc ps -q mongodb 2>/dev/null | head -n 1
}

ensure_volumes() {
  local volume
  for volume in hd_data hd_mongodb_config hd_uploads; do
    docker volume create "$volume" >/dev/null
  done
}

# Keep the images that run now as hd-<service>:prev for a quick rollback.
tag_previous() {
  local service id
  for service in backend frontend tg-service; do
    id=$(dc images -q "$service" 2>/dev/null | head -n 1)
    [ -n "$id" ] && docker tag "$id" "hd-$service:prev" >/dev/null 2>&1 || true
  done
}

db_is_empty() {
  local count
  count=$(dc exec -T -e MONGO_PASS="$DB_PASS" mongodb sh -c \
    "mongosh --quiet -u '$DB_USER' -p \"\$MONGO_PASS\" --authenticationDatabase admin '$DB_NAME' --eval 'db.users.countDocuments()'" \
    2>/dev/null | tr -d '[:space:]')
  [ "$count" = 0 ]
}

smoke_test() {
  local http_port host port attempt
  http_port=$(env_get HTTP_PORT)
  host=$(bind_host "$http_port"); port=$(port_of "$http_port")
  [ "$host" = 0.0.0.0 ] && host=127.0.0.1
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS -o /dev/null "http://$host:$port/api/preferences-auth"; then
      echo "   smoke test passed: nginx → backend → MongoDB answer on port $port"
      return 0
    fi
    sleep 5
  done
  die "smoke test failed: GET http://$host:$port/api/preferences-auth (see ./deploy.sh logs)"
}

# --- commands ---------------------------------------------------------------

backup() {
  load_env
  local container dir volume
  container=$(mongo_container)
  [ -n "$container" ] || die "MongoDB container is not running"
  dir="backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dir"
  log "Backing up database $DB_NAME to $dir"
  docker exec -e MONGO_PASS="$DB_PASS" "$container" sh -c \
    "mongodump --quiet --archive --gzip --db '$DB_NAME' -u '$DB_USER' -p \"\$MONGO_PASS\" --authenticationDatabase admin" \
    > "$dir/mongo.archive.gz"
  printf 'DB=%s\nDATE=%s\n' "$DB_NAME" "$(date -Is)" > "$dir/manifest"
  for volume in hd_uploads hd_storage; do
    docker volume inspect "$volume" >/dev/null 2>&1 || continue
    docker run --rm -v "$volume:/src:ro" -v "$PWD/$dir:/out" alpine tar czf "/out/$volume.tar.gz" -C /src .
  done
  # Keep the five most recent backups.
  ls -dt backups/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
  echo "   done: $dir ($(du -sh "$dir" | cut -f1))"
}

restore() {
  local dir=${1:-} source volume ns=""
  [ -n "$dir" ] && [ -f "$dir/mongo.archive.gz" ] || die "usage: ./deploy.sh restore backups/<timestamp>"
  need_tools; ensure_docker; ensure_env; load_env; ensure_volumes
  source=$(sed -n 's/^DB=//p' "$dir/manifest" 2>/dev/null); source=${source:-$DB_NAME}
  log "Restoring $dir into database $DB_NAME"
  dc stop backend frontend tg-service >/dev/null 2>&1 || true
  dc up -d --wait mongodb
  [ "$source" = "$DB_NAME" ] || ns="--nsFrom '$source.*' --nsTo '$DB_NAME.*'"
  dc exec -T -e MONGO_PASS="$DB_PASS" mongodb sh -c \
    "mongorestore --quiet --archive --gzip --drop $ns -u '$DB_USER' -p \"\$MONGO_PASS\" --authenticationDatabase admin" \
    < "$dir/mongo.archive.gz"
  for volume in hd_uploads hd_storage; do
    [ -f "$dir/$volume.tar.gz" ] || continue
    docker volume create "$volume" >/dev/null
    docker run --rm -v "$volume:/dst" -v "$PWD/$dir:/in:ro" alpine sh -c \
      "tar xzf /in/$volume.tar.gz -C /dst && chown -R 1000:1000 /dst"
  done
  cat <<MSG

Restored. Next:
  ./deploy.sh migrate status           # the ledger comes with the dump
  ./deploy.sh                          # migrate what is pending and start
MSG
}

migrate() {
  ensure_docker
  # `run` starts mongodb (depends_on) and waits until it is healthy.
  dc run --rm backend node scripts/migrate.js "$@"
}

deploy() {
  need_tools; ensure_docker; ensure_env; require_subject_prefix; load_env
  # Pulled images are never rebuilt by `up`, even if a source tree is here.
  local up_flags=(); [ "$(image_mode)" = pull ] && up_flags=(--no-build)
  tag_previous
  ensure_volumes
  local before; before=$(running_build_label "$(running_build)")
  if [ "$(image_mode)" = pull ]; then
    log "Pulling images: $(env_get IMAGE_PREFIX)*:$(env_get IMAGE_TAG) (running now: $before)"
    # Only the application images: MongoDB is pinned in compose.yml and is not
    # re-pulled by an update. A failed pull stops here, before anything else.
    pull_images
  else
    [ -f backend/Dockerfile ] || die "no source tree here: set IMAGE_REGISTRY and IMAGE_TAG in .env to run pulled images"
    build_identity
    log "Building images: $APP_VERSION+$APP_COMMIT (running now: $before)"
    dc build --pull
  fi
  log "Starting MongoDB"
  dc up -d --wait "${up_flags[@]}" mongodb
  if db_is_empty; then
    log "Empty database: the first start creates the administrator"
  else
    backup
  fi
  # Data migrations run with the application STOPPED: the previous version
  # must not serve requests while the data changes shape under it. The stop
  # happens only when something is actually pending, so a routine update has
  # no extra downtime.
  set +e
  dc run --rm backend node scripts/migrate.js pending
  pending=$?
  set -e
  case $pending in
    0) ;;
    3) log "Applying data migrations (the application is stopped meanwhile)"
       dc stop backend tg-service >/dev/null 2>&1 || true
       dc run --rm backend node scripts/migrate.js up \
         || die "a migration failed — fix the cause and run ./deploy.sh again (it resumes there), or skip it with ./deploy.sh migrate mark <id>" ;;
    *) die "migrations cannot run (see above): ./deploy.sh migrate status" ;;
  esac
  log "Starting services"
  dc up -d --wait --remove-orphans "${up_flags[@]}" mongodb backend frontend
  smoke_test
  echo
  local now; now=$(running_build)
  echo "Application is up: $(env_get APP_PUBLIC_URL)${now:+ — build $now}"
  if [ "$(image_mode)" = pull ] && [ -n "$now" ] && [ "${now%%+*}" != "$(env_get IMAGE_TAG)" ]; then
    echo "warning: the image tagged $(env_get IMAGE_TAG) reports version ${now%%+*}"
  fi
  dc logs --no-log-prefix backend 2>/dev/null \
    | grep -o 'Пароль администратора сгенерирован: [^ ]*' | tail -n 1 | sed 's/^/   /' || true
  # Telegram is optional and its health depends on the outside world (token,
  # reachability of api.telegram.org, no second copy of the bot polling with
  # the same token), so it must not take the deployment down with it.
  if [ "$(env_get COMPOSE_PROFILES)" = telegram ]; then
    log "Starting the Telegram service"
    if ! dc up -d --wait "${up_flags[@]}" tg-service; then
      echo "WARNING: tg-service is not healthy. The app works without it; see: ./deploy.sh logs tg-service"
      echo "         (a bot token can poll Telegram from ONE place only — stop the old bot first)"
    fi
  fi
  # Dangling images and old build cache — the previous script let the cache
  # grow to tens of gigabytes; recent layers are kept for fast rebuilds.
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage 4GB >/dev/null 2>&1 || true
}

# Tests load the functions above without running a command.
[ "${DEPLOY_SH_SOURCED:-}" = 1 ] && return 0

case "${1:-deploy}" in
  deploy)   deploy ;;
  env)      need_tools; ensure_docker; ensure_env; echo ".env is ready" ;;
  backup)   ensure_docker; backup ;;
  restore)  shift; restore "$@" ;;
  migrate)  shift; migrate "$@" ;;
  status)   echo "build: $(running_build_label "$(running_build)")"; dc ps ;;
  logs)     shift; dc logs -f --tail=100 "$@" ;;
  help|-h|--help) usage ;;
  *)        usage; exit 1 ;;
esac
