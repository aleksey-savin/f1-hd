#!/bin/bash

# HD System — Sync local dev MongoDB with production
#
# Meant to be run straight from the workstation shell: `./sync-dev-db.sh`.
# No docker is needed locally — the dev database is written over its published
# port with the host's own mongorestore. Production is reached over SSH, routed
# through the jump host automatically when it is not directly reachable.
#
# The dump itself is produced on the production side and streamed over SSH:
# the link to prod has ~200 ms RTT, and pulling the data with a local mongodump
# through a forwarded port is roughly two orders of magnitude slower (every
# cursor batch costs a round trip). DUMP_MODE=tunnel does exactly that for the
# cases where prod is close by or its container has no mongodump.
#
# PRODUCTION IS TREATED AS STRICTLY READ-ONLY. The only things this script does
# on the production host are `docker inspect` (to resolve the database name and
# credentials — skipped entirely if they are supplied via the environment) and
# a `mongodump` read. Nothing is ever written to production.
#
# Every collection except `preferences` is replaced in the local dev database.

set -euo pipefail
cd "$(dirname "$0")"

# --- Configuration (override via environment) --------------------------------

PROD_SSH="${PROD_SSH:-f1lab@10.0.50.70}"
PROD_SSH_JUMP="${PROD_SSH_JUMP:-f1lab@10.0.50.10}"   # used only when prod's SSH port is unreachable directly
PROD_MONGO_PORT="${PROD_MONGO_PORT:-27017}"          # port MongoDB publishes on the prod host
PROD_MONGO_CONTAINER="${PROD_MONGO_CONTAINER:-hd-mongodb-prod}"
PROD_BACKEND_CONTAINER="${PROD_BACKEND_CONTAINER:-hd-backend-prod}"
PROD_DB="${PROD_DB:-}"                # resolved from the prod backend container if empty
PROD_MONGO_USER="${PROD_MONGO_USER:-}"  # resolved from the prod mongo container if empty
PROD_MONGO_PASS="${PROD_MONGO_PASS:-}"

DEV_MONGO_HOST="${DEV_MONGO_HOST:-127.0.0.1}"
DEV_MONGO_PORT="${DEV_MONGO_PORT:-27017}"
DEV_DB="${DEV_DB:-}"                  # resolved from .env.dev if empty
ENV_FILE="${ENV_FILE:-.env.dev}"

DUMP_MODE="${DUMP_MODE:-auto}"        # auto | remote (mongodump on prod) | tunnel (mongodump here)

EXCLUDE_COLLECTION="preferences"      # never synced, dev copy is left untouched
WIRE_COMPRESSORS="${WIRE_COMPRESSORS:-zstd,snappy,zlib}"  # tunnel mode: compress on the wire

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
    echo "Runs from the host shell — no local docker needed. The dump is read from"
    echo "production over SSH (through the jump host when needed) and restored into the"
    echo "dev database over ${DEV_MONGO_HOST}:${DEV_MONGO_PORT}."
    echo ""
    echo "Options:"
    echo "  -y, --yes             Skip the confirmation prompt"
    echo "  --keep-dump           Keep the downloaded dump archive after a successful sync"
    echo "  --from-archive FILE   Restore from an existing dump archive instead of"
    echo "                        downloading a fresh one (never touches production)"
    echo "  --no-restart          Do not restart backend/telegram-bot containers afterwards"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Requirements:"
    echo "  mongodump/mongorestore locally (Fedora: sudo dnf install mongodb-database-tools)"
    echo "  SSH access to production (directly or through the jump host)"
    echo "  mongosh is optional: without it the stale-collection cleanup and the summary"
    echo "  fall back to the local mongodb container, or are skipped"
    echo ""
    echo "Environment overrides:"
    echo "  PROD_SSH              SSH destination (default: f1lab@10.0.50.70)"
    echo "  PROD_SSH_JUMP         Jump host, used only when prod:22 is unreachable"
    echo "                        (default: f1lab@10.0.50.10, set empty to never jump)"
    echo "  PROD_MONGO_PORT       MongoDB port published on the prod host (default: 27017)"
    echo "  PROD_DB               Prod database name (default: resolved over SSH)"
    echo "  PROD_MONGO_USER/PASS  Prod credentials (default: resolved over SSH)"
    echo "  DUMP_MODE             auto (default): mongodump inside the prod container,"
    echo "                        falling back to 'tunnel'; remote: force the container;"
    echo "                        tunnel: pull with the local mongodump through a"
    echo "                        forwarded port — only sane on a low-latency link"
    echo "  DEV_MONGO_HOST/PORT   Local MongoDB endpoint (default: 127.0.0.1:27017)"
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

# Can we open a TCP connection to host/port within N seconds?
tcp_open() {
    timeout "${3:-3}" bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null
}

# First free local port in a range well above the mongo defaults.
free_local_port() {
    local p
    for p in $(seq 27100 27199); do
        tcp_open 127.0.0.1 "$p" 1 || { printf '%s' "$p"; return 0; }
    done
    return 1
}

# Best-effort source database name: the archive header is BSON, so the value
# simply follows the `db` field name in the first collection block.
archive_db_name() {
    local name
    name=$( { gzip -dc "$1" 2>/dev/null || true; } | head -c 65536 | tr -c '[:print:]' '\n' \
            | awk '$0 == "db" { while ((getline line) > 0) if (line != "") { print line; exit } }' || true)
    [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || name=""
    printf '%s' "$name"
}

# --- SSH connection to production (read-only side) ---------------------------

SSH_CTL_DIR=""
SSH_CTL=""
TUNNEL_PORT=""

prod_ssh() { ssh -S "$SSH_CTL" "${SSH_OPTS[@]}" "$PROD_SSH" "$@"; }

close_prod_ssh() {
    [ -n "$SSH_CTL" ] || return 0
    ssh -S "$SSH_CTL" -O exit "$PROD_SSH" >/dev/null 2>&1 || true
    rm -rf "$SSH_CTL_DIR"
    SSH_CTL=""; SSH_CTL_DIR=""
}

# One multiplexed connection for everything the prod side needs.
open_prod_ssh() {
    local prod_host="${PROD_SSH##*@}"
    local jump=()

    if tcp_open "$prod_host" 22 5; then
        log_info "Production SSH reachable directly ($prod_host:22)"
    elif [ -n "$PROD_SSH_JUMP" ]; then
        log_info "Production SSH not reachable directly, jumping through $PROD_SSH_JUMP"
        jump=(-J "$PROD_SSH_JUMP")
    else
        log_error "Cannot reach $prod_host:22 and no PROD_SSH_JUMP is configured"
        exit 1
    fi

    # Unix sockets cap out around 100 characters, so keep the control path short.
    SSH_CTL_DIR=$(mktemp -d /tmp/hd-sync-ssh.XXXXXX)
    SSH_CTL="$SSH_CTL_DIR/c"

    ssh -f -N -M -S "$SSH_CTL" "${SSH_OPTS[@]}" "${jump[@]}" "$PROD_SSH" \
        || { log_error "Could not connect to $PROD_SSH"; exit 1; }
    ssh -S "$SSH_CTL" -O check "$PROD_SSH" >/dev/null 2>&1 \
        || { log_error "SSH connection to $PROD_SSH did not come up"; exit 1; }
}

# Forward a local port to the production MongoDB port (tunnel dump mode only).
open_prod_tunnel() {
    TUNNEL_PORT=$(free_local_port) || { log_error "No free local port for the tunnel"; exit 1; }
    ssh -S "$SSH_CTL" -O forward -L "127.0.0.1:$TUNNEL_PORT:127.0.0.1:$PROD_MONGO_PORT" "$PROD_SSH" \
        || { log_error "Could not forward a port to ${PROD_SSH##*@}:$PROD_MONGO_PORT"; exit 1; }
    log_success "Tunnel up: 127.0.0.1:$TUNNEL_PORT -> ${PROD_SSH##*@}:${PROD_MONGO_PORT} (read-only)"
}

# --- Dev-side shell (mongosh natively, or via the local container) -----------

DEV_SHELL_MODE=none                   # native | docker | none
DEV_MONGO_CONTAINER=""

detect_dev_shell() {
    if command -v mongosh >/dev/null 2>&1; then
        DEV_SHELL_MODE=native
        return
    fi
    command -v docker >/dev/null 2>&1 || return

    local id name
    id=$(docker compose ps -q mongodb 2>/dev/null | head -1 || true)
    [ -n "$id" ] || id=$(docker ps -q --filter "publish=$DEV_MONGO_PORT" 2>/dev/null | head -1 || true)
    [ -n "$id" ] || return

    name=$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's|^/||' || true)
    case "$name" in
        *prod*) return ;;             # never run anything against a prod-looking container
    esac
    DEV_MONGO_CONTAINER="$id"
    DEV_SHELL_MODE=docker
}

# Run a mongosh snippet against the dev database. Returns 1 when no shell exists.
dev_eval() {
    case "$DEV_SHELL_MODE" in
        native) mongosh --quiet --host "$DEV_MONGO_HOST" --port "$DEV_MONGO_PORT" \
                    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
                    --eval "$1" ;;
        docker) docker exec "$DEV_MONGO_CONTAINER" mongosh --quiet \
                    -u "$DEV_MONGO_USER" -p "$DEV_MONGO_PASS" --authenticationDatabase admin \
                    --eval "$1" ;;
        *)      return 1 ;;
    esac
}

# --- Preflight ---------------------------------------------------------------

command -v ssh >/dev/null 2>&1 || { log_error "ssh is not installed"; exit 1; }
if ! command -v mongodump >/dev/null 2>&1 || ! command -v mongorestore >/dev/null 2>&1; then
    log_error "mongodump/mongorestore are required (Fedora: sudo dnf install mongodb-database-tools)"
    exit 1
fi
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

case "$DEV_MONGO_HOST" in
    127.0.0.1|localhost|::1) ;;
    *) [ "${ALLOW_REMOTE_TARGET:-0}" = "1" ] \
           || { log_error "Refusing to write to a non-local MongoDB ($DEV_MONGO_HOST); set ALLOW_REMOTE_TARGET=1 to override"; exit 1; } ;;
esac

tcp_open "$DEV_MONGO_HOST" "$DEV_MONGO_PORT" 5 \
    || { log_error "Dev MongoDB is not listening on $DEV_MONGO_HOST:$DEV_MONGO_PORT (docker compose up -d mongodb)"; exit 1; }

if [ -n "$FROM_ARCHIVE" ] && [ ! -f "$FROM_ARCHIVE" ]; then
    log_error "Archive not found: $FROM_ARCHIVE"
    exit 1
fi

detect_dev_shell
case "$DEV_SHELL_MODE" in
    docker) log_info "mongosh not installed locally, using the $(docker inspect --format '{{.Name}}' "$DEV_MONGO_CONTAINER" | sed 's|^/||') container for it" ;;
    none)   log_warning "No mongosh and no local mongodb container: stale collections will not be dropped and the summary will be skipped" ;;
esac

DEV_CONN=(--host "$DEV_MONGO_HOST" --port "$DEV_MONGO_PORT"
          --username "$DEV_MONGO_USER" --password "$DEV_MONGO_PASS"
          --authenticationDatabase admin)

# --- Cleanup ------------------------------------------------------------------

SECONDS=0
DUMP_FILE="$FROM_ARCHIVE"
DUMP_IS_TEMP=false
DUMP_OK=false

on_exit() {
    local code=$?
    close_prod_ssh
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

# --- Resolve the production side ---------------------------------------------

if [ -n "$FROM_ARCHIVE" ]; then
    # Restoring from a local archive never contacts production.
    [ -n "$PROD_DB" ] || PROD_DB=$(archive_db_name "$FROM_ARCHIVE")
    [ -n "$PROD_DB" ] || { log_error "Could not read the source database name from $FROM_ARCHIVE (pass PROD_DB=...)"; exit 1; }
else
    open_prod_ssh

    if [ -z "$PROD_MONGO_USER" ] || [ -z "$PROD_MONGO_PASS" ]; then
        log_info "Resolving production MongoDB credentials (docker inspect, read-only)..."
        PROD_ENV=$(prod_ssh "docker inspect $PROD_MONGO_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}'" | tr -d '\r')
        [ -n "$PROD_MONGO_USER" ] || PROD_MONGO_USER=$(printf '%s\n' "$PROD_ENV" | grep '^MONGO_INITDB_ROOT_USERNAME=' | cut -d= -f2- || true)
        [ -n "$PROD_MONGO_PASS" ] || PROD_MONGO_PASS=$(printf '%s\n' "$PROD_ENV" | grep '^MONGO_INITDB_ROOT_PASSWORD=' | cut -d= -f2- || true)
        if [ -z "$PROD_MONGO_USER" ] || [ -z "$PROD_MONGO_PASS" ]; then
            log_error "Could not resolve MongoDB credentials from $PROD_MONGO_CONTAINER"
            exit 1
        fi
    fi

    if [ -z "$PROD_DB" ]; then
        log_info "Resolving production database name (docker inspect, read-only)..."
        PROD_DB=$(prod_ssh "docker inspect $PROD_BACKEND_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}'" \
            | grep '^MONGODB_DATABASE=' | cut -d= -f2- | tr -d '\r' || true)
        [ -n "$PROD_DB" ] || { log_error "Could not resolve MONGODB_DATABASE from $PROD_BACKEND_CONTAINER"; exit 1; }
    fi

    case "$DUMP_MODE" in
        remote) ;;
        tunnel) open_prod_tunnel ;;
        auto)   if prod_ssh "docker exec $PROD_MONGO_CONTAINER mongodump --version" >/dev/null 2>&1; then
                    DUMP_MODE=remote
                else
                    log_warning "No mongodump in $PROD_MONGO_CONTAINER, pulling through a forwarded port instead — expect it to be slow"
                    DUMP_MODE=tunnel
                    open_prod_tunnel
                fi ;;
        *)      log_error "Unknown DUMP_MODE: $DUMP_MODE (auto|remote|tunnel)"; exit 1 ;;
    esac
fi

[[ "$PROD_DB" =~ ^[A-Za-z0-9_-]+$ ]] || { log_error "Suspicious prod database name: $PROD_DB"; exit 1; }

# --- Confirmation ------------------------------------------------------------

echo ""
if [ -n "$FROM_ARCHIVE" ]; then
    log_info "Source:      $PROD_DB from archive $FROM_ARCHIVE (production not contacted)"
elif [ "$DUMP_MODE" = tunnel ]; then
    log_info "Source:      $PROD_DB @ $PROD_SSH via 127.0.0.1:$TUNNEL_PORT (READ-ONLY)"
else
    log_info "Source:      $PROD_DB @ $PROD_SSH (container $PROD_MONGO_CONTAINER, READ-ONLY)"
fi
log_info "Target:      $DEV_DB @ $DEV_MONGO_HOST:$DEV_MONGO_PORT"
log_info "Not synced:  $EXCLUDE_COLLECTION (local copy kept as is)"
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

if [ -z "$DUMP_FILE" ]; then
    DUMP_FILE=$(mktemp "${TMPDIR:-/tmp}/hd-db-sync-$(date +%Y%m%d-%H%M%S)-XXXX.archive.gz")
    DUMP_IS_TEMP=true

    log_info "Dumping '$PROD_DB' (without '$EXCLUDE_COLLECTION') from production — this only reads data..."
    if [ "$DUMP_MODE" = tunnel ]; then
        # One cursor at a time and no read deadline: on a slow link a single
        # batch takes minutes, which the driver defaults treat as a dead socket.
        mongodump --uri "mongodb://127.0.0.1:$TUNNEL_PORT/?authSource=admin&compressors=$WIRE_COMPRESSORS&socketTimeoutMS=0&connectTimeoutMS=120000&serverSelectionTimeoutMS=120000" \
            --username "$PROD_MONGO_USER" --password "$PROD_MONGO_PASS" \
            --db "$PROD_DB" \
            --excludeCollection="$EXCLUDE_COLLECTION" \
            --numParallelCollections=1 \
            --archive="$DUMP_FILE" --gzip
    else
        prod_ssh "docker exec $PROD_MONGO_CONTAINER mongodump \
            --username $(shq "$PROD_MONGO_USER") --password $(shq "$PROD_MONGO_PASS") \
            --authenticationDatabase admin \
            --db $(shq "$PROD_DB") \
            --excludeCollection=$EXCLUDE_COLLECTION \
            --archive --gzip" > "$DUMP_FILE"
    fi

    log_info "Verifying archive integrity..."
    gzip -t "$DUMP_FILE" || { log_error "Downloaded archive is corrupted"; exit 1; }
    DUMP_OK=true
    log_success "Dump downloaded: $(du -h "$DUMP_FILE" | cut -f1) ($DUMP_FILE)"
fi

close_prod_ssh                        # production is done with, everything below is local

# --- Restore (local dev side) ------------------------------------------------

RESTORE_NS=(--nsInclude "$PROD_DB.*" --nsExclude "$PROD_DB.$EXCLUDE_COLLECTION")
if [ "$PROD_DB" != "$DEV_DB" ]; then
    RESTORE_NS+=(--nsFrom "$PROD_DB.*" --nsTo "$DEV_DB.*")
fi

log_info "Validating archive against mongorestore (dry run, nothing is written)..."
mongorestore "${DEV_CONN[@]}" "${RESTORE_NS[@]}" \
    --archive="$DUMP_FILE" --gzip --dryRun --quiet

PREFS_BEFORE=$(dev_eval "print(db.getSiblingDB('$DEV_DB').getCollection('$EXCLUDE_COLLECTION').countDocuments())" || true)

if [ "$DEV_SHELL_MODE" != none ]; then
    log_info "Dropping existing '$DEV_DB' collections (except '$EXCLUDE_COLLECTION')..."
    dev_eval "
        const d = db.getSiblingDB('$DEV_DB');
        const dropped = d.getCollectionNames()
            .filter(c => c !== '$EXCLUDE_COLLECTION' && !c.startsWith('system.'));
        dropped.forEach(c => d.getCollection(c).drop());
        print('Dropped ' + dropped.length + ' collections');
    "
else
    log_warning "Skipping the drop step: collections missing from the dump will stay in '$DEV_DB'"
fi

log_info "Restoring into '$DEV_DB'..."
mongorestore "${DEV_CONN[@]}" "${RESTORE_NS[@]}" \
    --archive="$DUMP_FILE" --gzip --drop --stopOnError

# --- Verify ------------------------------------------------------------------

if [ "$DEV_SHELL_MODE" != none ]; then
    log_info "Post-restore summary:"
    dev_eval "
        const d = db.getSiblingDB('$DEV_DB');
        const names = d.getCollectionNames().filter(c => !c.startsWith('system.'));
        print('  collections: ' + names.length);
        ['tickets', 'comments', 'users', 'companies'].forEach(c =>
            print('  ' + c + ': ' + d.getCollection(c).countDocuments()));
        print('  $EXCLUDE_COLLECTION (untouched): ' + d.getCollection('$EXCLUDE_COLLECTION').countDocuments());
    "

    PREFS_AFTER=$(dev_eval "print(db.getSiblingDB('$DEV_DB').getCollection('$EXCLUDE_COLLECTION').countDocuments())" || true)
    if [ "$PREFS_BEFORE" != "$PREFS_AFTER" ]; then
        log_warning "'$EXCLUDE_COLLECTION' document count changed ($PREFS_BEFORE -> $PREFS_AFTER) — this should not happen"
    fi
fi

if $RESTART_SERVICES; then
    if command -v docker >/dev/null 2>&1; then
        log_info "Restarting backend and telegram-bot to drop cached state..."
        docker compose restart backend telegram-bot >/dev/null 2>&1 \
            || log_warning "Could not restart backend/telegram-bot (are they running?)"
    else
        log_warning "docker is not available: restart backend/telegram-bot yourself to drop cached state"
    fi
fi

log_success "Dev database '$DEV_DB' synced with production '$PROD_DB' in ${SECONDS}s"
