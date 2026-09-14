#!/usr/bin/env bash
#
# HD — deployment on one Linux host (Debian/Ubuntu or Fedora/RHEL family).
#
#   ./deploy.sh                 install or update: Docker if missing, .env with
#                               generated secrets, build, backup, migrate, start
#   ./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
#   ./deploy.sh restore DIR     load a backup into this installation
#   ./deploy.sh migrate ARGS    status | up | baseline <id> | mark <id>
#   ./deploy.sh status          containers and health
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

usage() { sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'; }

# --- prerequisites ----------------------------------------------------------

need_tools() {
  local tool
  for tool in curl openssl; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
  done
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    [ "$(id -u)" = 0 ] || die "Docker (with the compose plugin) is missing; run this script as root once to install it"
    log "Installing Docker Engine from docker.com (apt or dnf, depending on the distro)"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon: run as root or add yourself to the docker group"
}

# --- .env -------------------------------------------------------------------

ENV_FILE=.env

# Value of a key in $ENV_FILE, surrounding quotes stripped. Empty when absent.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"
}

# Replace or append KEY=VALUE in .env.
env_set() {
  local value
  value=$(printf '%s' "$2" | sed 's/[&#\\]/\\&/g')
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^$1=.*#$1=$value#" "$ENV_FILE"
  else
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

# The previous layout kept production settings in .env.prod. Convert it once:
# known keys are carried over, renamed where the name changed, dead keys are
# dropped. The old file stays next to it as .env.prod.migrated.
migrate_legacy_env() {
  [ -f .env ] && return 0
  [ -f .env.prod ] || return 0
  log "Converting .env.prod to .env"
  local legacy_get key value
  legacy_get() { sed -n "s/^$1=//p" .env.prod | tail -n 1 | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/"; }
  : > .env
  chmod 600 .env
  for key in MONGODB_USERNAME MONGODB_PASSWORD MONGODB_DATABASE BETTER_AUTH_SECRET TG_API_TOKEN TG_TOKEN \
             TICKET_COUNTER_STARTING_NUMBER ADD_TICKET_LOG CORS_ORIGINS TRUST_PROXY_HOPS \
             S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET_NAME S3_REGION S3_ENDPOINT S3_FORCE_PATH_STYLE S3_KMS_KEY_ID \
             BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_FIRST_NAME BOOTSTRAP_ADMIN_LAST_NAME \
             BOOTSTRAP_COMPANY_TITLE BOOTSTRAP_ORG_NAME; do
    value=$(legacy_get "$key")
    [ -n "$value" ] && env_set "$key" "$value"
  done
  value=$(legacy_get APP_PUBLIC_URL); [ -n "$value" ] || value=$(legacy_get API_URL)
  [ -n "$value" ] && env_set APP_PUBLIC_URL "$value"
  value=$(legacy_get APP_ENC_KEY); [ -n "$value" ] || value=$(legacy_get MIKROTIK_ENC_KEY)
  [ -n "$value" ] && env_set APP_ENC_KEY "$value"
  mv .env.prod .env.prod.migrated
  echo "   done; the old file is kept as .env.prod.migrated (dead keys were not carried over)"
  return 0
}

ensure_env() {
  migrate_legacy_env
  [ -f .env ] || : > .env
  chmod 600 .env
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

# Database credentials for backup/restore. Falls back to .env.prod so `backup`
# works on a host that still runs the previous layout.
load_env() {
  if [ -f .env ]; then ENV_FILE=.env
  elif [ -f .env.prod ]; then ENV_FILE=.env.prod
  else die "no .env here — run ./deploy.sh env first"
  fi
  DB_USER=$(env_get MONGODB_USERNAME)
  DB_PASS=$(env_get MONGODB_PASSWORD)
  DB_NAME=$(env_get MONGODB_DATABASE)
  [ -n "$DB_USER" ] && [ -n "$DB_PASS" ] && [ -n "$DB_NAME" ] \
    || die "MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE missing in $ENV_FILE"
}

# --- docker helpers ---------------------------------------------------------

mongo_container() {
  local id
  id=$(dc ps -q mongodb 2>/dev/null | head -n 1)
  [ -n "$id" ] || id=$(docker ps -q --filter 'name=^hd-mongodb-prod$' | head -n 1)
  printf '%s' "$id"
}

ensure_volumes() {
  local volume
  for volume in hd_data hd_mongodb_config hd_uploads; do
    docker volume create "$volume" >/dev/null
  done
}

# Containers from the previous layout (fixed container_name) would hold the
# volumes and ports; the new stack replaces them.
stop_legacy() {
  docker rm -f hd-mongodb-prod hd-backend-prod hd-frontend-prod hd-tg-service-prod hd-tg-service hd-telegram-bot-prod \
    >/dev/null 2>&1 || true
}

# Keep the images that run now as hd-<service>:prev for a quick rollback.
tag_previous() {
  local service id
  for service in backend frontend tg-service; do
    id=$(dc images -q "$service" 2>/dev/null | head -n 1)
    [ -n "$id" ] && docker tag "$id" "hd-$service:prev" >/dev/null 2>&1 || true
  done
}

# The previous backend image ran as uid 1001; the current one runs as `node`
# (1000). Files written by the old one must be writable by the new one.
fix_volume_owner() {
  local volume
  for volume in hd_uploads hd_storage; do
    docker volume inspect "$volume" >/dev/null 2>&1 || continue
    docker run --rm -v "$volume:/v" alpine sh -c \
      '[ -z "$(find /v ! -user 1000 | head -n 1)" ] || chown -R 1000:1000 /v'
  done
}

# Major version of the MongoDB that last used hd_data on this host (empty when
# none did). Uses the image ID, not its tag: an untagged `mongo` may already
# point at a newer pull than the one the data was written with.
mongo_major_on_volume() {
  docker volume inspect hd_data >/dev/null 2>&1 || return 0
  local container image
  container=$(docker ps -aq --filter volume=hd_data | head -n 1)
  [ -n "$container" ] || return 0
  image=$(docker inspect -f '{{.Image}}' "$container")
  docker run --rm --entrypoint mongod "$image" --version 2>/dev/null \
    | sed -n 's/^db version v\([0-9]*\)\..*/\1/p'
}

upgrade_mongo_if_needed() {
  local major
  major=$(mongo_major_on_volume)
  if [ -n "$major" ] && [ "$major" -lt 8 ]; then
    log "MongoDB $major.x data found on this host — upgrading it in place to 8"
    scripts/mongo-upgrade.sh
  fi
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
  ./deploy.sh migrate status
  ./deploy.sh migrate baseline <id>    # data from the pre-better-auth prod: 2026-07-24-backfillUserLastActivity
  ./deploy.sh                          # migrate the rest and start
MSG
}

migrate() {
  ensure_docker
  # `run` starts mongodb (depends_on) and waits until it is healthy.
  dc run --rm backend node scripts/migrate.js "$@"
}

deploy() {
  need_tools; ensure_docker; ensure_env; load_env
  upgrade_mongo_if_needed
  stop_legacy
  tag_previous
  ensure_volumes
  log "Building images"
  dc build --pull
  log "Starting MongoDB"
  dc up -d --wait mongodb
  fix_volume_owner
  if db_is_empty; then
    log "Empty database: the first start creates the administrator"
  else
    backup
  fi
  log "Applying data migrations"
  dc run --rm backend node scripts/migrate.js up
  log "Starting services"
  dc up -d --wait --remove-orphans mongodb backend frontend
  smoke_test
  echo
  echo "Application is up: $(env_get APP_PUBLIC_URL)"
  dc logs --no-log-prefix backend 2>/dev/null \
    | grep -o 'Пароль администратора сгенерирован: [^ ]*' | tail -n 1 | sed 's/^/   /' || true
  # Telegram is optional and its health depends on the outside world (token,
  # reachability of api.telegram.org, no second copy of the bot polling with
  # the same token), so it must not take the deployment down with it.
  if [ "$(env_get COMPOSE_PROFILES)" = telegram ]; then
    log "Starting the Telegram service"
    if ! dc up -d --wait tg-service; then
      echo "WARNING: tg-service is not healthy. The app works without it; see: ./deploy.sh logs tg-service"
      echo "         (a bot token can poll Telegram from ONE place only — stop the old bot first)"
    fi
  fi
  # Dangling images and old build cache — the previous script let the cache
  # grow to tens of gigabytes; recent layers are kept for fast rebuilds.
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage 4GB >/dev/null 2>&1 || true
}

case "${1:-deploy}" in
  deploy)   deploy ;;
  env)      need_tools; ensure_docker; ensure_env; echo ".env is ready" ;;
  backup)   ensure_docker; backup ;;
  restore)  shift; restore "$@" ;;
  migrate)  shift; migrate "$@" ;;
  status)   dc ps ;;
  logs)     shift; dc logs -f --tail=100 "$@" ;;
  help|-h|--help) usage ;;
  *)        usage; exit 1 ;;
esac
