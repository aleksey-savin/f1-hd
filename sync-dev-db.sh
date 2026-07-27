#!/bin/bash

# HD System — Sync local dev MongoDB with production
#
# Pulls a full dump of the production database over SSH and restores it into
# the local dev MongoDB container, replacing every collection except
# `preferences`.
#
# PRODUCTION IS TREATED AS STRICTLY READ-ONLY. The only commands this script
# runs on the production host are `docker inspect` (to resolve the database
# name and credentials) and `docker exec ... mongodump` (to stream the dump).
# Nothing is ever written to the production database or filesystem.

set -euo pipefail
cd "$(dirname "$0")"

# --- Configuration (override via environment) --------------------------------

PROD_SSH="${PROD_SSH:-f1lab@10.0.50.70}"
PROD_MONGO_CONTAINER="${PROD_MONGO_CONTAINER:-hd-mongodb-prod}"
PROD_BACKEND_CONTAINER="${PROD_BACKEND_CONTAINER:-hd-backend-prod}"
PROD_DB="${PROD_DB:-}"                # resolved from the prod backend container if empty
DEV_DB="${DEV_DB:-}"                  # resolved from .env.dev if empty
ENV_FILE="${ENV_FILE:-.env.dev}"
EXCLUDE_COLLECTION="preferences"      # never synced, dev copy is left untouched

SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)

# --- Logging helpers (same style as deploy-prod.sh) --------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    echo "Sync local dev MongoDB with production (production is read-only)."
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -y, --yes             Skip the confirmation prompt"
    echo "  --keep-dump           Keep the downloaded dump archive after a successful sync"
    echo "  --from-archive FILE   Restore from an existing dump archive instead of"
    echo "                        downloading a fresh one (useful to retry a failed restore)"
    echo "  --no-restart          Do not restart backend/telegram-bot containers afterwards"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Environment overrides:"
    echo "  PROD_SSH              SSH destination (default: f1lab@10.0.50.70)"
    echo "  PROD_MONGO_CONTAINER  Prod mongo container (default: hd-mongodb-prod)"
    echo "  PROD_DB               Prod database name (default: resolved over SSH)"
    echo "  DEV_DB                Target dev database name (default: from .env.dev)"
    echo ""
    echo "The '${EXCLUDE_COLLECTION}' collection is never synced: it is excluded from the"
    echo "dump and the local copy is left untouched."
}

# --- Arguments ---------------------------------------------------------------

ASSUME_YES=false
KEEP_DUMP=false
RESTART_SERVICES=true
FROM_ARCHIVE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes)       ASSUME_YES=true ;;
        --keep-dump)    KEEP_DUMP=true ;;
        --no-restart)   RESTART_SERVICES=false ;;
        --from-archive) FROM_ARCHIVE="${2:-}"; shift
                        [ -n "$FROM_ARCHIVE" ] || { log_error "--from-archive requires a file path"; exit 1; } ;;
        -h|--help)      show_help; exit 0 ;;
        *)              log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
    shift
done

# --- Helpers -----------------------------------------------------------------

# Single-quote a value for safe use inside the remote shell command line.
shq() {
    printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")"
}

# Read a value from the env file (last occurrence wins, quotes stripped).
env_val() {
    local v
    v=$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-) || true
    v="${v%\'}"; v="${v#\'}"
    v="${v%\"}"; v="${v#\"}"
    printf '%s' "$v"
}

prod_ssh() { # read-only helper: every remote command goes through here
    ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$@"
}

# --- Preflight ---------------------------------------------------------------

command -v docker >/dev/null || { log_error "docker is not installed"; exit 1; }
command -v ssh    >/dev/null || { log_error "ssh is not installed"; exit 1; }
[ -f "$ENV_FILE" ] || { log_error "Environment file $ENV_FILE not found (run from the repo root)"; exit 1; }

DEV_MONGO_USER=$(env_val MONGODB_USERNAME)
DEV_MONGO_PASS=$(env_val MONGODB_PASSWORD)
[ -n "$DEV_DB" ] || DEV_DB=$(env_val MONGODB_DATABASE)

if [ -z "$DEV_MONGO_USER" ] || [ -z "$DEV_MONGO_PASS" ] || [ -z "$DEV_DB" ]; then
    log_error "MONGODB_USERNAME/MONGODB_PASSWORD/MONGODB_DATABASE not found in $ENV_FILE"
    exit 1
fi

[[ "$DEV_DB" =~ ^[A-Za-z0-9_-]+$ ]] || { log_error "Suspicious dev database name: $DEV_DB"; exit 1; }
case "$DEV_DB" in
    admin|local|config) log_error "Refusing to restore into system database '$DEV_DB'"; exit 1 ;;
esac

LOCAL_CONTAINER=$(docker compose ps -q mongodb || true)
if [ -z "$LOCAL_CONTAINER" ]; then
    log_error "Local mongodb container is not running (docker compose up -d mongodb)"
    exit 1
fi
LOCAL_CONTAINER_NAME=$(docker inspect --format '{{.Name}}' "$LOCAL_CONTAINER" | sed 's|^/||')
case "$LOCAL_CONTAINER_NAME" in
    *prod*) log_error "Local compose resolved to a prod-looking container ($LOCAL_CONTAINER_NAME), aborting"; exit 1 ;;
esac

if [ -n "$FROM_ARCHIVE" ] && [ ! -f "$FROM_ARCHIVE" ]; then
    log_error "Archive not found: $FROM_ARCHIVE"
    exit 1
fi

# Resolve the prod database name (read-only `docker inspect` on the prod host).
if [ -z "$PROD_DB" ]; then
    log_info "Resolving production database name via SSH ($PROD_SSH)..."
    PROD_DB=$(prod_ssh "docker inspect $PROD_BACKEND_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}'" \
        | grep '^MONGODB_DATABASE=' | cut -d= -f2- | tr -d '\r' || true)
    [ -n "$PROD_DB" ] || { log_error "Could not resolve MONGODB_DATABASE from $PROD_BACKEND_CONTAINER"; exit 1; }
fi
[[ "$PROD_DB" =~ ^[A-Za-z0-9_-]+$ ]] || { log_error "Suspicious prod database name: $PROD_DB"; exit 1; }

# --- Confirmation ------------------------------------------------------------

echo ""
log_info "Source:      $PROD_DB @ $PROD_SSH (container $PROD_MONGO_CONTAINER, READ-ONLY)"
log_info "Target:      $DEV_DB @ local container $LOCAL_CONTAINER_NAME"
log_info "Not synced:  $EXCLUDE_COLLECTION (local copy kept as is)"
[ -n "$FROM_ARCHIVE" ] && log_info "Archive:     $FROM_ARCHIVE (skipping download)"
echo ""
log_warning "All other collections in '$DEV_DB' will be REPLACED with production data."

if ! $ASSUME_YES; then
    read -r -p "Continue? [y/N] " reply
    case "$reply" in
        [yY]|[yY][eE][sS]) ;;
        *) log_info "Aborted"; exit 0 ;;
    esac
fi

# --- Dump (production side, read-only) ---------------------------------------

SECONDS=0
DUMP_FILE="$FROM_ARCHIVE"
DUMP_IS_TEMP=false
DUMP_OK=false

on_exit() {
    local code=$?
    if [ $code -ne 0 ]; then
        log_error "Sync failed (exit code $code)"
        if $DUMP_IS_TEMP && $DUMP_OK; then
            log_warning "Dump kept at: $DUMP_FILE"
            log_warning "Retry the restore without re-downloading: $0 --from-archive $DUMP_FILE"
        fi
    elif $DUMP_IS_TEMP && ! $KEEP_DUMP; then
        rm -f "$DUMP_FILE"
    elif $DUMP_IS_TEMP; then
        log_info "Dump kept at: $DUMP_FILE"
    fi
}
trap on_exit EXIT

if [ -z "$DUMP_FILE" ]; then
    DUMP_FILE=$(mktemp "${TMPDIR:-/tmp}/hd-db-sync-$(date +%Y%m%d-%H%M%S)-XXXX.archive.gz")
    DUMP_IS_TEMP=true

    log_info "Resolving production MongoDB credentials (docker inspect, read-only)..."
    PROD_ENV=$(prod_ssh "docker inspect $PROD_MONGO_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}'" | tr -d '\r')
    PROD_MONGO_USER=$(printf '%s\n' "$PROD_ENV" | grep '^MONGO_INITDB_ROOT_USERNAME=' | cut -d= -f2- || true)
    PROD_MONGO_PASS=$(printf '%s\n' "$PROD_ENV" | grep '^MONGO_INITDB_ROOT_PASSWORD=' | cut -d= -f2- || true)
    if [ -z "$PROD_MONGO_USER" ] || [ -z "$PROD_MONGO_PASS" ]; then
        log_error "Could not resolve MongoDB credentials from $PROD_MONGO_CONTAINER"
        exit 1
    fi

    log_info "Dumping '$PROD_DB' (without '$EXCLUDE_COLLECTION') from production — this only reads data..."
    prod_ssh "docker exec $PROD_MONGO_CONTAINER mongodump \
        --username $(shq "$PROD_MONGO_USER") --password $(shq "$PROD_MONGO_PASS") \
        --authenticationDatabase admin \
        --db $(shq "$PROD_DB") \
        --excludeCollection=$EXCLUDE_COLLECTION \
        --archive --gzip" > "$DUMP_FILE"

    log_info "Verifying archive integrity..."
    gzip -t "$DUMP_FILE" || { log_error "Downloaded archive is corrupted"; exit 1; }
    DUMP_OK=true
    log_success "Dump downloaded: $(du -h "$DUMP_FILE" | cut -f1) ($DUMP_FILE)"
fi

# --- Restore (local dev side) ------------------------------------------------

RESTORE_AUTH=(--username "$DEV_MONGO_USER" --password "$DEV_MONGO_PASS" --authenticationDatabase admin)
RESTORE_NS=(--nsInclude "$PROD_DB.*" --nsExclude "$PROD_DB.$EXCLUDE_COLLECTION")
if [ "$PROD_DB" != "$DEV_DB" ]; then
    RESTORE_NS+=(--nsFrom "$PROD_DB.*" --nsTo "$DEV_DB.*")
fi

log_info "Validating archive against mongorestore (dry run, nothing is written)..."
docker exec -i "$LOCAL_CONTAINER" mongorestore "${RESTORE_AUTH[@]}" "${RESTORE_NS[@]}" \
    --archive --gzip --dryRun --quiet < "$DUMP_FILE"

PREFS_BEFORE=$(docker exec "$LOCAL_CONTAINER" mongosh --quiet \
    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
    --eval "print(db.getSiblingDB('$DEV_DB').getCollection('$EXCLUDE_COLLECTION').countDocuments())")

log_info "Dropping existing '$DEV_DB' collections (except '$EXCLUDE_COLLECTION')..."
docker exec "$LOCAL_CONTAINER" mongosh --quiet \
    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
    --eval "
        const d = db.getSiblingDB('$DEV_DB');
        const dropped = d.getCollectionNames()
            .filter(c => c !== '$EXCLUDE_COLLECTION' && !c.startsWith('system.'));
        dropped.forEach(c => d.getCollection(c).drop());
        print('Dropped ' + dropped.length + ' collections');
    "

log_info "Restoring into '$DEV_DB'..."
docker exec -i "$LOCAL_CONTAINER" mongorestore "${RESTORE_AUTH[@]}" "${RESTORE_NS[@]}" \
    --archive --gzip --drop --stopOnError < "$DUMP_FILE"

# --- Verify ------------------------------------------------------------------

log_info "Post-restore summary:"
docker exec "$LOCAL_CONTAINER" mongosh --quiet \
    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
    --eval "
        const d = db.getSiblingDB('$DEV_DB');
        const names = d.getCollectionNames().filter(c => !c.startsWith('system.'));
        print('  collections: ' + names.length);
        ['tickets', 'comments', 'users', 'companies'].forEach(c =>
            print('  ' + c + ': ' + d.getCollection(c).countDocuments()));
        print('  $EXCLUDE_COLLECTION (untouched): ' + d.getCollection('$EXCLUDE_COLLECTION').countDocuments());
    "

PREFS_AFTER=$(docker exec "$LOCAL_CONTAINER" mongosh --quiet \
    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
    --eval "print(db.getSiblingDB('$DEV_DB').getCollection('$EXCLUDE_COLLECTION').countDocuments())")
if [ "$PREFS_BEFORE" != "$PREFS_AFTER" ]; then
    log_warning "'$EXCLUDE_COLLECTION' document count changed ($PREFS_BEFORE -> $PREFS_AFTER) — this should not happen"
fi

if $RESTART_SERVICES; then
    log_info "Restarting backend and telegram-bot to drop cached state..."
    docker compose restart backend telegram-bot >/dev/null 2>&1 \
        || log_warning "Could not restart backend/telegram-bot (are they running?)"
fi

log_success "Dev database '$DEV_DB' synced with production '$PROD_DB' in ${SECONDS}s"
