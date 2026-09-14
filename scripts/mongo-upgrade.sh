#!/usr/bin/env bash
#
# In-place MongoDB major upgrade of the data in a Docker volume: 5 → 6 → 7 → 8.
#
# deploy.sh calls this when the host already runs a MongoDB older than 8 on
# hd_data. It can also be run by hand, e.g. on a copy of the volume first:
#   docker run --rm -v hd_data:/from -v hd_data_test:/to alpine cp -a /from/. /to/
#   VOL=hd_data_test CFG=hd_mongodb_config_test scripts/mongo-upgrade.sh
#
# Each step runs the next major's mongod on the same files and raises the
# featureCompatibilityVersion; MongoDB allows exactly one major per step. A full
# dump is taken first (backups/pre-upgrade-*.archive.gz) — the only way back is
# to restore it into a mongo:5.0 container.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

VOL=${VOL:-hd_data}
CFG=${CFG:-hd_mongodb_config}
NAME=hd-mongo-upgrade
TARGET=8

log() { printf '== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

docker volume inspect "$VOL" >/dev/null 2>&1 || die "volume $VOL does not exist"
docker volume create "$CFG" >/dev/null

current=$(docker ps -aq --filter "volume=$VOL" | head -n 1)
[ -n "$current" ] || die "no container has used $VOL yet; cannot tell which MongoDB wrote it"
current_image=$(docker inspect -f '{{.Image}}' "$current")
# Keep the old server binary under a name of ours: `mongo:latest` gets
# overwritten by the next pull and EOL tags can vanish from Docker Hub.
docker tag "$current_image" hd-mongo:pre-upgrade

for id in $(docker ps -q --filter "volume=$VOL"); do
  log "stopping $(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')"
  docker stop -t 120 "$id" >/dev/null
done
docker rm -f "$NAME" >/dev/null 2>&1 || true

# The temporary mongod runs without MONGO_INITDB_* so the image does not add
# --auth: admin commands work locally, and --network none keeps it private.
run_tmp() {
  docker run -d --rm --name "$NAME" --network none \
    -v "$VOL:/data/db" -v "$CFG:/data/configdb" "$1" >/dev/null
  wait_ready
}
stop_tmp() { docker stop -t 120 "$NAME" >/dev/null; }

# mongosh where available (5.0+ images ship it), the legacy shell otherwise.
sh_eval() {
  docker exec "$NAME" sh -c \
    "if command -v mongosh >/dev/null 2>&1; then mongosh --quiet --eval '$1'; else mongo --quiet --eval '$1'; fi"
}

wait_ready() {
  local attempt
  for attempt in $(seq 1 60); do
    sh_eval 'db.adminCommand("ping").ok' >/dev/null 2>&1 && return 0
    sleep 2
  done
  docker logs "$NAME" 2>&1 | tail -n 30
  die "mongod did not become ready"
}

fcv() {
  sh_eval 'db.adminCommand({getParameter: 1, featureCompatibilityVersion: 1}).featureCompatibilityVersion.version' | tr -d '[:space:]'
}

set_fcv() {
  case "$1" in
    5.0|6.0) sh_eval "db.adminCommand({setFeatureCompatibilityVersion: \"$1\"}).ok" >/dev/null ;;
    *)       sh_eval "db.adminCommand({setFeatureCompatibilityVersion: \"$1\", confirm: true}).ok" >/dev/null ;;
  esac
  [ "$(fcv)" = "$1" ] || die "featureCompatibilityVersion $1 was not set"
}

log "starting the current mongod for a full backup"
run_tmp "$current_image"
major=$(sh_eval 'db.version()' | tr -d '[:space:]' | cut -d. -f1)
mkdir -p backups
archive="backups/pre-upgrade-$(date +%Y%m%d-%H%M%S).archive.gz"
docker exec "$NAME" mongodump --quiet --archive --gzip > "$archive"
log "full dump saved: $archive (MongoDB $major, FCV $(fcv))"
[ "$(fcv)" = "$major.0" ] || set_fcv "$major.0"
stop_tmp

for next in 6 7 8; do
  [ "$next" -gt "$major" ] || continue
  [ "$next" -le "$TARGET" ] || break
  log "upgrading to MongoDB $next.0"
  run_tmp "mongo:$next.0"
  set_fcv "$next.0"
  stop_tmp
done

log "done: the data is at featureCompatibilityVersion $TARGET.0 and ready for mongo:8"
