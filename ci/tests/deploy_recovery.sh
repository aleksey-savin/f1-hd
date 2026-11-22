#!/usr/bin/env bash
# Exercise setup and restore with isolated files and stand-ins for Docker.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
failures=0

check_key() {
  local name=$1 extra=$2 expected=$3
  cat > "$scratch/.env" <<ENV
MONGODB_USERNAME=hd
MONGODB_PASSWORD=test
MONGODB_DATABASE=hd
BETTER_AUTH_SECRET=test
TG_API_TOKEN=test
HTTP_PORT=8080
APP_PUBLIC_URL=http://example.test
TG_TOKEN=
$extra
ENV
  DEPLOY_TEST_ENV_FILE="$scratch/.env" DEPLOY_SH_SOURCED=1 bash -c '
    source ./deploy.sh
    ensure_mail_mode() { :; }; ensure_subject_prefix() { :; }
    ensure_sentry_origin() { :; }; ensure_image_source() { :; }
    docker() { return 0; }
    ensure_env
    first_key=$(env_get APP_ENC_KEY)
    ensure_env
    [ "$(env_get APP_ENC_KEY)" = "$first_key" ]
  ' > "$scratch/setup.log" 2>&1
  if [ "$expected" = generated ]; then
    expected=$(sed -n 's/^APP_ENC_KEY=//p' "$scratch/.env")
    if [ "$(printf %s "$expected" | base64 -d | wc -c)" != 32 ]; then
      echo 'FAIL fresh installation did not generate a 32-byte key' >&2
      failures=$((failures + 1))
      return
    fi
  fi
  if grep -Fxq "APP_ENC_KEY=$expected" "$scratch/.env" &&
     [ "$(grep -c '^APP_ENC_KEY=' "$scratch/.env")" = 1 ]; then
    echo "ok $name"
  else
    echo "FAIL $name: setup replaced or duplicated the encryption key" >&2
    failures=$((failures + 1))
  fi
}
# Fixed synthetic keys, never installation secrets.
legacy=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
current=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
check_key fresh_install "" generated
check_key legacy_only "MIKROTIK_ENC_KEY='$legacy'" "$legacy"
check_key empty_current "$(printf 'APP_ENC_KEY=\nMIKROTIK_ENC_KEY=%s' "$legacy")" "$legacy"
check_key explicit_current "$(printf 'APP_ENC_KEY=%s\nMIKROTIK_ENC_KEY=%s' "$current" "$legacy")" "$current"

mkdir "$scratch/backup"
: > "$scratch/backup/mongo.archive.gz"
printf 'DB=hd\n' > "$scratch/backup/manifest"
for stop_code in 1 0; do
  : > "$scratch/trace"
  code=0
  CASE_TRACE="$scratch/trace" BACKUP_DIR="$scratch/backup" STOP_CODE="$stop_code" \
    DEPLOY_SH_SOURCED=1 bash -c '
      source ./deploy.sh
      need_tools() { :; }; ensure_docker() { :; }; ensure_env() { :; }
      load_env() { DB_NAME=hd; DB_USER=hd; DB_PASS=test; }; ensure_volumes() { :; }
      dc() {
        echo "$*" >> "$CASE_TRACE"
        case "$1" in stop) return "$STOP_CODE" ;; esac
      }
      docker() { echo "unexpected docker call" >> "$CASE_TRACE"; return 1; }
      restore "$BACKUP_DIR"
    ' > "$scratch/restore.log" 2>&1 || code=$?
  if [ "$stop_code" = 1 ]; then
    if [ "$code" != 0 ] && [ "$(cat "$scratch/trace")" = 'stop backend frontend tg-service' ]; then
      echo 'ok failed stop prevents all restore operations'
    else
      echo 'FAIL restore continued after application stop failed' >&2
      failures=$((failures + 1))
    fi
  elif [ "$code" = 0 ] && grep -q 'mongorestore' "$scratch/trace"; then
    echo 'ok successful stop allows restore'
  else
    echo 'FAIL restore did not proceed after successful stop' >&2
    failures=$((failures + 1))
  fi
done
[ "$failures" = 0 ]
