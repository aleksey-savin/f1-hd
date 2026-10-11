#!/bin/bash

# Internal tooling of the operator — not part of the product, never in an image.

# HD System — Sync a dev/test MongoDB with production
#
# Runs from the shell of the machine whose database is the TARGET: the
# workstation (`ops/sync-dev-db.sh` fills the local dev DB) or a test host set up
# with deploy.sh (fills its DB before a migration rehearsal). The target is
# written over its published port with the host's own mongorestore, or — when
# the MongoDB tools are not installed — with the mongorestore inside the local
# mongodb container. Production is reached over SSH, routed through the jump
# host automatically when it is not directly reachable.
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
# Every collection except the KEEP_LOCAL ones is replaced in the local dev database;
# the NEVER_COPIED ones (credentials) are dropped there. Two modes: masked
# (default; after the restore backend/scripts/dev/maskData.js pseudonymises
# people and companies and replaces every credential) and --raw.
#
# A masked run never ends in success with real data in place: that the masking
# can run here is proven before anything is dumped or dropped
# (require_masking), its failure is a hard error (mask_dev_copy), and the final
# message is not reached unless it succeeded.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

# Operator configuration (host names, jump host, dev password) lives outside git.
SYNC_ENV="${SYNC_ENV:-ops/sync.env}"
if [ -f "$SYNC_ENV" ]; then
  set -a; . "$SYNC_ENV"; set +a
fi

# --- Configuration (override via environment) --------------------------------

PROD_SSH="${PROD_SSH:-}"
PROD_SSH_JUMP="${PROD_SSH_JUMP:-}"   # used only when prod's SSH port is unreachable directly
PROD_MONGO_PORT="${PROD_MONGO_PORT:-27017}"          # port MongoDB publishes on the prod host
PROD_MONGO_CONTAINER="${PROD_MONGO_CONTAINER:-}"     # resolved on the prod host if empty:
PROD_BACKEND_CONTAINER="${PROD_BACKEND_CONTAINER:-}" # (the default compose project names)
PROD_DB="${PROD_DB:-}"                # resolved from the prod backend container if empty
PROD_MONGO_USER="${PROD_MONGO_USER:-}"  # resolved from the prod mongo container if empty
PROD_MONGO_PASS="${PROD_MONGO_PASS:-}"

DEV_MONGO_HOST="${DEV_MONGO_HOST:-127.0.0.1}"
DEV_MONGO_PORT="${DEV_MONGO_PORT:-27017}"
DEV_MONGO_USER="${DEV_MONGO_USER:-}"  # resolved from .env if empty
DEV_MONGO_PASS="${DEV_MONGO_PASS:-}"
DEV_DB="${DEV_DB:-}"                  # resolved from .env if empty
ENV_FILE="${ENV_FILE:-.env}"

DUMP_MODE="${DUMP_MODE:-auto}"        # auto | remote (mongodump on prod) | tunnel (mongodump here)

# Never synced, part one (KEEP_LOCAL): dev settings stay as they are; prod
# channels and the prod outbox would make the dev backend act as production.
# Part two (NEVER_COPIED): live credentials — sessions, one-time tokens (magic
# links, password resets), MCP keys, firmware download codes, impersonation and
# pairing codes. A copy must not be able to act as a signed-in person or an
# agent of the source installation. KEEP_LOCAL ones are preserved on the dev
# side; NEVER_COPIED ones are dropped there.
KEEP_LOCAL=(preferences channels channeljobs)
NEVER_COPIED=(authSessions authVerifications mcpkeys mikrotikdownloadcodes impersonationCodes telegramPairingCodes)
EXCLUDE_COLLECTIONS=("${KEEP_LOCAL[@]}" "${NEVER_COPIED[@]}")
EXCLUDE_FLAGS=()
for collection in "${EXCLUDE_COLLECTIONS[@]}"; do EXCLUDE_FLAGS+=("--excludeCollection=$collection"); done
# Only the dev's own collections as a mongosh/JS array literal: counted
# before/after, preserved by the drop step
KEEP_JS_LIST=$(printf "'%s'," "${KEEP_LOCAL[@]}")
KEEP_JS_LIST="[${KEEP_JS_LIST%,}]"
WIRE_COMPRESSORS="${WIRE_COMPRESSORS:-zstd,snappy,zlib}"  # tunnel mode: compress on the wire

SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)

# --- Logging helpers (same style as deploy.sh) --------------------------

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
    echo "Modes: masked (default) copies the data and masks identity fields; --raw"
    echo "copies everything as it is (only for an installation whose data is your own)."
    echo ""
    echo "Runs on the machine whose database is the target (workstation or test host)."
    echo "The dump is read from production over SSH (through the jump host when needed)"
    echo "and restored into the local database over ${DEV_MONGO_HOST}:${DEV_MONGO_PORT}."
    echo ""
    echo "Options:"
    echo "  -y, --yes             Skip the confirmation prompt"
    echo "  --raw                 Copy identity fields as they are (default: masked copy)"
    echo "  --keep-dump           Keep the downloaded dump archive after a successful sync"
    echo "  --from-archive FILE   Restore from an existing dump archive instead of"
    echo "                        downloading a fresh one (never touches production)"
    echo "  --no-restart          Do not restart backend/tg-service containers afterwards"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Requirements:"
    echo "  Masked mode: the development stack of this checkout, running (the masking"
    echo "  script runs in its backend container against its mongodb service)"
    echo "  SSH access to production (directly or through the jump host)"
    echo "  mongorestore: installed locally (mongodb-database-tools) or, failing that,"
    echo "  the local mongodb container is used for it (docker compose up -d mongodb)"
    echo "  mongosh is optional in the same way; tunnel mode needs a local mongodump"
    echo ""
    echo "Environment overrides:"
    echo "  PROD_SSH              SSH destination, user@host (required; set in ops/sync.env)"
    echo "  PROD_SSH_JUMP         Jump host, used only when prod:22 is unreachable"
    echo "                        (default: none)"
    echo "  PROD_MONGO_PORT       MongoDB port published on the prod host (default: 27017)"
    echo "  PROD_MONGO_CONTAINER  Prod containers (default: found over SSH —"
    echo "  PROD_BACKEND_CONTAINER  hd-mongodb-1, hd-backend-1)"
    echo "  PROD_DB               Prod database name (default: resolved over SSH)"
    echo "  PROD_MONGO_USER/PASS  Prod credentials (default: resolved over SSH)"
    echo "  DUMP_MODE             auto (default): mongodump inside the prod container,"
    echo "                        falling back to 'tunnel'; remote: force the container;"
    echo "                        tunnel: pull with the local mongodump through a"
    echo "                        forwarded port — only sane on a low-latency link"
    echo "  DEV_MONGO_HOST/PORT   Local MongoDB endpoint (default: 127.0.0.1:27017)"
    echo "  DEV_MONGO_USER/PASS   Target credentials (default: from .env)"
    echo "  DEV_DB                Target database name (default: from .env)"
    echo "  DEV_PASSWORD          Masked copies: every account signs in with it (required)"
    echo "  MASK_REPORT           Masked copies: 1 (and only 1) also lists the fields where"
    echo "                        replaced addresses, phones and names are still found"
    echo "  SYNC_ENV              Configuration file (default: ops/sync.env)"
    echo ""
    echo "Never synced: '${KEEP_LOCAL[*]}' (local copies are left untouched)"
    echo "and '${NEVER_COPIED[*]}'"
    echo "(live credentials; dropped on the target)."
}

# --- Arguments ---------------------------------------------------------------

ASSUME_YES=false
MODE=masked
KEEP_DUMP=false
RESTART_SERVICES=true
FROM_ARCHIVE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes)       ASSUME_YES=true ;;
        --raw)          MODE=raw ;;
        --keep-dump)    KEEP_DUMP=true ;;
        --no-restart)   RESTART_SERVICES=false ;;
        --from-archive) FROM_ARCHIVE="${2:-}"; shift
                        [ -n "$FROM_ARCHIVE" ] || { log_error "--from-archive requires a file path"; exit 1; } ;;
        -h|--help)      show_help; exit 0 ;;
        *)              log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
    shift
done

[ -n "$PROD_SSH" ] || [ -n "$FROM_ARCHIVE" ] || { log_error "PROD_SSH is not set. Copy ops/sync.env.example to ops/sync.env and fill it in."; exit 1; }

if [ "$MODE" = masked ] && [ -z "${DEV_PASSWORD:-}" ]; then
    log_error "DEV_PASSWORD is not set in ops/sync.env: a masked copy signs everyone in with it."
    exit 1
fi
# Handed to the masking container by name, so the value stays off command lines.
export DEV_PASSWORD="${DEV_PASSWORD:-}"
if [ "$MODE" = raw ] && [ "$ASSUME_YES" != true ]; then
    log_warning "Raw copy: names, e-mail addresses, phones and password hashes are copied as they are."
    log_warning "Use it only for an installation whose data is your own."
    read -r -p "Type RAW to continue: " answer
    [ "$answer" = RAW ] || { log_error "Cancelled."; exit 1; }
fi

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

# The production stack runs under the `hd` compose project (hd-*-1).
resolve_prod_containers() {
    [ -n "$PROD_MONGO_CONTAINER" ] && [ -n "$PROD_BACKEND_CONTAINER" ] && return 0
    local names
    names=$(prod_ssh "docker ps --format '{{.Names}}'" | tr -d '\r')
    [ -n "$PROD_MONGO_CONTAINER" ]   || PROD_MONGO_CONTAINER=$(printf '%s\n' "$names" | grep -E -m1 '^hd-mongodb-1$' || true)
    [ -n "$PROD_BACKEND_CONTAINER" ] || PROD_BACKEND_CONTAINER=$(printf '%s\n' "$names" | grep -E -m1 '^hd-backend-1$' || true)
    if [ -z "$PROD_MONGO_CONTAINER" ] || [ -z "$PROD_BACKEND_CONTAINER" ]; then
        log_error "Could not find the hd mongodb/backend containers on $PROD_SSH (running: $(printf '%s' "$names" | tr '\n' ' '))"
        exit 1
    fi
    log_info "Production containers: $PROD_MONGO_CONTAINER, $PROD_BACKEND_CONTAINER"
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

# Find the local mongodb container first (mongorestore may need it even when
# mongosh is installed natively), then pick where mongosh runs.
detect_dev_shell() {
    if command -v docker >/dev/null 2>&1; then
        local id name
        id=$(docker compose ps -q mongodb 2>/dev/null | head -1 || true)
        [ -n "$id" ] || id=$(docker ps -q --filter "publish=$DEV_MONGO_PORT" 2>/dev/null | head -1 || true)
        if [ -n "$id" ]; then
            name=$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's|^/||' || true)
            case "$name" in
                *prod*) ;;            # never run anything against a prod-looking container
                *)      DEV_MONGO_CONTAINER="$id" ;;
            esac
        fi
    fi

    if command -v mongosh >/dev/null 2>&1; then
        DEV_SHELL_MODE=native
    elif [ -n "$DEV_MONGO_CONTAINER" ]; then
        DEV_SHELL_MODE=docker
    fi
}

# mongorestore: the host's own binary, or the one inside the mongodb container.
DEV_TOOLS_MODE=none                   # native | docker | none

detect_dev_tools() {
    if command -v mongorestore >/dev/null 2>&1; then
        DEV_TOOLS_MODE=native
    elif [ -n "$DEV_MONGO_CONTAINER" ]; then
        DEV_TOOLS_MODE=docker
    fi
}

# mongorestore against the target with the given extra arguments. In docker
# mode the archive is streamed into the container on stdin.
dev_restore() {
    case "$DEV_TOOLS_MODE" in
        native) mongorestore "${DEV_CONN[@]}" "$@" --archive="$DUMP_FILE" --gzip ;;
        docker) docker exec -i "$DEV_MONGO_CONTAINER" mongorestore \
                    --username "$DEV_MONGO_USER" --password "$DEV_MONGO_PASS" --authenticationDatabase admin \
                    "$@" --archive --gzip < "$DUMP_FILE" ;;
        *)      return 1 ;;
    esac
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
if [ -z "$DEV_MONGO_USER" ] || [ -z "$DEV_MONGO_PASS" ] || [ -z "$DEV_DB" ]; then
    [ -f "$ENV_FILE" ] || { log_error "Environment file $ENV_FILE not found (run from the repo root)"; exit 1; }
fi

[ -n "$DEV_MONGO_USER" ] || DEV_MONGO_USER=$(env_val MONGODB_USERNAME)
[ -n "$DEV_MONGO_PASS" ] || DEV_MONGO_PASS=$(env_val MONGODB_PASSWORD)
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
           || { log_error "Refusing to write to a non-local MongoDB ($DEV_MONGO_HOST); set ALLOW_REMOTE_TARGET=1 to override"; exit 1; }
       # The containers to restart live on the target machine, not here.
       RESTART_SERVICES=false ;;
esac

if [ -n "$FROM_ARCHIVE" ] && [ ! -f "$FROM_ARCHIVE" ]; then
    log_error "Archive not found: $FROM_ARCHIVE"
    exit 1
fi

detect_dev_shell
detect_dev_tools
case "$DEV_TOOLS_MODE" in
    docker) log_info "mongorestore not installed locally, using the $(docker inspect --format '{{.Name}}' "$DEV_MONGO_CONTAINER" | sed 's|^/||') container for it" ;;
    none)   log_error "mongorestore is required: install mongodb-database-tools (Fedora: dnf, Ubuntu: MongoDB's apt repo) or start the local mongodb container (docker compose up -d mongodb)"
            exit 1 ;;
esac
case "$DEV_SHELL_MODE" in
    docker) [ "$DEV_TOOLS_MODE" = docker ] || log_info "mongosh not installed locally, using the mongodb container for it" ;;
    none)   log_warning "No mongosh and no local mongodb container: stale collections will not be dropped and the summary will be skipped" ;;
esac

if [ "$DEV_TOOLS_MODE" = native ]; then
    tcp_open "$DEV_MONGO_HOST" "$DEV_MONGO_PORT" 5 \
        || { log_error "Target MongoDB is not listening on $DEV_MONGO_HOST:$DEV_MONGO_PORT (docker compose up -d mongodb)"; exit 1; }
fi

# --- Masking preflight ---------------------------------------------------------

MASKED_OK=false
RESTORE_STARTED=false

# The masking script, in a one-off dev backend container, where the sources are
# bind-mounted and the database is reachable by its service name. The database
# is pinned to the one this run restores into: with a DEV_DB override the
# container's own MONGODB_DATABASE would point the masking at another database.
# stdin is closed: the container must not swallow the answers typed at the prompts.
mask_run() {
    docker compose run --rm -T "${MASK_RUN_FLAGS[@]}" -e DEV_PASSWORD -e MONGODB_DATABASE="$DEV_DB" backend \
        node scripts/dev/maskData.js "$@" </dev/null
}
MASK_RUN_FLAGS=()

# The masking container talks to the `mongodb` service of this compose project,
# so the restore target has to be that very server.
target_is_compose_mongodb() {
    local published
    case "$DEV_MONGO_HOST" in
        127.0.0.1|localhost|::1) ;;
        *) return 1 ;;
    esac
    published=$(docker compose port mongodb 27017 2>/dev/null | head -1 || true)
    [ -n "$published" ] && [ "${published##*:}" = "$DEV_MONGO_PORT" ]
}

# A masked copy is refused here, before anything is dumped or dropped, unless
# every piece the masking step needs is in place: the script in the checkout,
# the dev stack with its database as the target, a shell to check the result
# with, a backend container that can actually start the script (a product
# image has no scripts/dev and runs with NODE_ENV=production — both fail the
# script's own --preflight), and a connection from that container that lands in
# the database this run restores into (--target: wrong credentials, an
# unreachable server or another database name are caught here, not after the
# drop).
require_masking() {
    local why="" probe="" reached=""
    if [ ! -f backend/scripts/dev/maskData.js ]; then
        why="backend/scripts/dev/maskData.js is not in this checkout"
    elif ! command -v docker >/dev/null 2>&1; then
        why="docker is not available"
    elif ! docker compose config --services 2>/dev/null | grep -qx backend; then
        why="the active compose file has no 'backend' service"
    elif ! target_is_compose_mongodb; then
        why="the target $DEV_MONGO_HOST:$DEV_MONGO_PORT is not the running mongodb service of this compose project"
    elif [ "$DEV_SHELL_MODE" = none ]; then
        why="no mongosh to check the result with"
    else
        MASK_RUN_FLAGS=(--no-deps)
        probe=$(mask_run --preflight 2>&1) \
            || why="the backend container cannot run the masking script ($(printf '%s\n' "$probe" | grep -E -m1 'Error|Отказ|не задан' || printf '%s\n' "$probe" | tail -1))"
        if [ -z "$why" ]; then
            probe=$(mask_run --target 2>&1) || true
            reached=$(printf '%s\n' "$probe" | sed -n 's/^База: //p' | tail -1)
            if [ -z "$reached" ]; then
                why="the backend container cannot connect to the database ($(printf '%s\n' "$probe" | grep -E -m1 'Error|Отказ|не задан|failed' || printf '%s\n' "$probe" | tail -1))"
            elif [ "$reached" != "$DEV_DB" ]; then
                why="the backend container connects to '$reached', not to '$DEV_DB'"
            fi
        fi
        MASK_RUN_FLAGS=()
    fi
    [ -n "$why" ] || return 0
    log_error "A masked copy needs the development stack. On a host installed with deploy.sh use --raw, and only for your own data."
    log_error "Reason: $why."
    exit 1
}

if [ "$MODE" = masked ]; then
    require_masking
fi

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
        if [ "$MODE" = masked ] && $RESTORE_STARTED && ! $MASKED_OK; then
            log_error "The copy in '$DEV_DB' is NOT masked and may hold real data. Re-run the sync from the archive (not maskData.js by hand), or drop the database."
        fi
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

# Pseudonymise the restored copy inside the dev backend container, then check
# from this side that it reached the database that was restored: no account may
# be left with an address outside example.com.
mask_dev_copy() {
    local left
    log_info "Masking identities and credentials in '$DEV_DB'..."
    local report=()
    [ "${MASK_REPORT:-}" = 1 ] && report=(--report)
    mask_run "${report[@]}" \
        || { log_error "Masking failed: the copy in '$DEV_DB' still holds real data. Re-run the sync from the kept archive (not maskData.js by hand), or drop the database."; exit 1; }
    left=$(dev_eval "print(db.getSiblingDB('$DEV_DB').users.countDocuments({ email: { \$not: /@example\\.com\$/ } }))" 2>/dev/null | tr -d '[:space:]' || true)
    if [ "$left" != 0 ]; then
        log_error "Masking did not take effect (accounts left unmasked: ${left:-unknown}): the copy in '$DEV_DB' still holds real data. Re-run the sync from the kept archive, or drop the database."
        exit 1
    fi
    MASKED_OK=true
    log_success "Copy masked: accounts sign in with their masked address and DEV_PASSWORD"
}

# --- Resolve the production side ---------------------------------------------

if [ -n "$FROM_ARCHIVE" ]; then
    # Restoring from a local archive never contacts production.
    [ -n "$PROD_DB" ] || PROD_DB=$(archive_db_name "$FROM_ARCHIVE")
    [ -n "$PROD_DB" ] || { log_error "Could not read the source database name from $FROM_ARCHIVE (pass PROD_DB=...)"; exit 1; }
else
    open_prod_ssh
    resolve_prod_containers

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
        tunnel) ;;
        auto)   if prod_ssh "docker exec $PROD_MONGO_CONTAINER mongodump --version" >/dev/null 2>&1; then
                    DUMP_MODE=remote
                else
                    log_warning "No mongodump in $PROD_MONGO_CONTAINER, pulling through a forwarded port instead — expect it to be slow"
                    DUMP_MODE=tunnel
                fi ;;
        *)      log_error "Unknown DUMP_MODE: $DUMP_MODE (auto|remote|tunnel)"; exit 1 ;;
    esac
    if [ "$DUMP_MODE" = tunnel ]; then
        command -v mongodump >/dev/null 2>&1 || { log_error "Tunnel mode needs a local mongodump (mongodb-database-tools)"; exit 1; }
        open_prod_tunnel
    fi
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
log_info "Not synced:  ${KEEP_LOCAL[*]} (local copies kept as is); ${NEVER_COPIED[*]} (dropped)"
log_info "Mode:        $MODE"
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

    log_info "Dumping '$PROD_DB' (without '${EXCLUDE_COLLECTIONS[*]}') from production — this only reads data..."
    if [ "$DUMP_MODE" = tunnel ]; then
        # One cursor at a time and no read deadline: on a slow link a single
        # batch takes minutes, which the driver defaults treat as a dead socket.
        mongodump --uri "mongodb://127.0.0.1:$TUNNEL_PORT/?authSource=admin&compressors=$WIRE_COMPRESSORS&socketTimeoutMS=0&connectTimeoutMS=120000&serverSelectionTimeoutMS=120000" \
            --username "$PROD_MONGO_USER" --password "$PROD_MONGO_PASS" \
            --db "$PROD_DB" \
            "${EXCLUDE_FLAGS[@]}" \
            --numParallelCollections=1 \
            --archive="$DUMP_FILE" --gzip
    else
        prod_ssh "docker exec $PROD_MONGO_CONTAINER mongodump \
            --username $(shq "$PROD_MONGO_USER") --password $(shq "$PROD_MONGO_PASS") \
            --authenticationDatabase admin \
            --db $(shq "$PROD_DB") \
            $(printf -- '--excludeCollection=%s ' "${EXCLUDE_COLLECTIONS[@]}") \
            --archive --gzip" > "$DUMP_FILE"
    fi

    log_info "Verifying archive integrity..."
    gzip -t "$DUMP_FILE" || { log_error "Downloaded archive is corrupted"; exit 1; }
    DUMP_OK=true
    log_success "Dump downloaded: $(du -h "$DUMP_FILE" | cut -f1) ($DUMP_FILE)"
fi

close_prod_ssh                        # production is done with, everything below is local

# --- Restore (local dev side) ------------------------------------------------

# --nsExclude is repeatable: one per never-synced collection, so a restore from
# an old archive (--from-archive, possibly dumped before this exclusion list grew)
# can't reintroduce prod channels/channeljobs either.
RESTORE_NS=(--nsInclude "$PROD_DB.*")
for collection in "${EXCLUDE_COLLECTIONS[@]}"; do RESTORE_NS+=(--nsExclude "$PROD_DB.$collection"); done
if [ "$PROD_DB" != "$DEV_DB" ]; then
    RESTORE_NS+=(--nsFrom "$PROD_DB.*" --nsTo "$DEV_DB.*")
fi

log_info "Validating archive against mongorestore (dry run, nothing is written)..."
# Not --quiet: it swallows the failure reason too, leaving a bare exit code 1.
if ! DRY_RUN_OUT=$(dev_restore "${RESTORE_NS[@]}" --dryRun 2>&1); then
    printf '%s\n' "$DRY_RUN_OUT" | tail -20 >&2
    log_error "mongorestore dry run failed (output above)"
    exit 1
fi

# One combined snapshot for all never-synced collections, not just `preferences`:
# the pre-clean drop below (and a --from-archive restore) must leave every one
# of them untouched, not only the first.
EXCLUDED_BEFORE=$(dev_eval "print(${KEEP_JS_LIST}.map(c => c + '=' + db.getSiblingDB('$DEV_DB').getCollection(c).countDocuments()).join(','))" || true)

if [ "$DEV_SHELL_MODE" != none ]; then
    log_info "Dropping existing '$DEV_DB' collections (except ${KEEP_LOCAL[*]})..."
    dev_eval "
        const d = db.getSiblingDB('$DEV_DB');
        const kept = new Set(${KEEP_JS_LIST});
        const dropped = d.getCollectionNames()
            .filter(c => !kept.has(c) && !c.startsWith('system.'));
        dropped.forEach(c => d.getCollection(c).drop());
        print('Dropped ' + dropped.length + ' collections');
    "
else
    log_warning "Skipping the drop step: collections missing from the dump will stay in '$DEV_DB'"
fi

log_info "Restoring into '$DEV_DB'..."
RESTORE_STARTED=true
dev_restore "${RESTORE_NS[@]}" --drop --stopOnError

if [ "$MODE" = masked ]; then
    mask_dev_copy
fi

# --- Verify ------------------------------------------------------------------

if [ "$DEV_SHELL_MODE" != none ]; then
    log_info "Post-restore summary:"
    dev_eval "
        const d = db.getSiblingDB('$DEV_DB');
        const names = d.getCollectionNames().filter(c => !c.startsWith('system.'));
        print('  collections: ' + names.length);
        ['tickets', 'comments', 'users', 'companies'].forEach(c =>
            print('  ' + c + ': ' + d.getCollection(c).countDocuments()));
        ${KEEP_JS_LIST}.forEach(c =>
            print('  ' + c + ' (untouched): ' + d.getCollection(c).countDocuments()));
    "

    EXCLUDED_AFTER=$(dev_eval "print(${KEEP_JS_LIST}.map(c => c + '=' + db.getSiblingDB('$DEV_DB').getCollection(c).countDocuments()).join(','))" || true)
    if [ "$EXCLUDED_BEFORE" != "$EXCLUDED_AFTER" ]; then
        log_warning "Excluded collection counts changed ($EXCLUDED_BEFORE -> $EXCLUDED_AFTER) — this should not happen"
    fi
fi

if $RESTART_SERVICES; then
    if command -v docker >/dev/null 2>&1; then
        log_info "Restarting backend (and tg-service, if it runs) to drop cached state..."
        docker compose restart backend >/dev/null 2>&1 \
            || log_warning "Could not restart backend (is it running?)"
        docker compose restart tg-service >/dev/null 2>&1 || true
    else
        log_warning "docker is not available: restart backend/tg-service yourself to drop cached state"
    fi
fi

# Last line of defence: success is never reported for an unmasked masked run.
if [ "$MODE" = masked ] && ! $MASKED_OK; then
    log_error "The copy in '$DEV_DB' was not masked and still holds real data. Re-run the sync from the archive, or drop the database."
    exit 1
fi

log_success "Database '$DEV_DB' synced with production '$PROD_DB' in ${SECONDS}s ($MODE copy)"

# Production carries the migration ledger, and the copy brings it along. A copy
# without one comes from data older than the migration list (see
# docs/deployment.md, «Migrations»).
if [ "$DEV_SHELL_MODE" != none ]; then
    LEDGER=$(dev_eval "print(db.getSiblingDB('$DEV_DB').getCollection('migrations').countDocuments())" 2>/dev/null | tr -d '[:space:]' || true)
    if [ "${LEDGER:-0}" = 0 ]; then
        echo ""
        log_warning "The copy has no migration ledger: production data predates commit 61d49c6."
        echo "  Such data cannot be migrated by this code — see docs/deployment.md, «Migrations»."
    fi
fi
