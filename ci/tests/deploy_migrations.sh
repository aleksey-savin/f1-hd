#!/usr/bin/env bash
# Exercise the real deploy flow; Docker and other host operations are stand-ins.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
: > "$scratch/.env"

run_deploy() {
  local name=$1 pending_code=$2 stop_code=$3 up_code=$4 empty=$5
  CASE_TRACE="$scratch/$name.trace" PENDING_CODE="$pending_code" STOP_CODE="$stop_code" \
    UP_CODE="$up_code" EMPTY_DATABASE="$empty" DEPLOY_TEST_ENV_FILE="$scratch/.env" \
    DEPLOY_SH_SOURCED=1 bash -c '
      source ./deploy.sh
      need_tools() { :; }; ensure_docker() { :; }; ensure_env() { :; }
      require_subject_prefix() { :; }; load_env() { :; }; tag_previous() { :; }
      ensure_volumes() { :; }; pull_images() { :; }; smoke_test() { :; }
      docker() { :; }
      running_build() { :; }; running_build_label() { echo previous; }
      image_mode() { echo pull; }; db_is_empty() { [ "$EMPTY_DATABASE" = yes ]; }
      backup() { echo backup >> "$CASE_TRACE"; }
      dc() {
        echo "$*" >> "$CASE_TRACE"
        case "$*" in
          "run --rm backend node scripts/migrate.js pending") return "$PENDING_CODE" ;;
          "stop backend tg-service") return "$STOP_CODE" ;;
          "run --rm backend node scripts/migrate.js up") return "$UP_CODE" ;;
        esac
      }
      deploy
    ' > "$scratch/$name.output" 2>&1
}

expect_trace() {
  local name=$1 expected=$2
  local actual; actual=$(cat "$scratch/$name.trace")
  [ "$actual" = "$expected" ] || {
    printf 'FAIL %s: unexpected deploy operations\n%s\n' "$name" "$actual" >&2
    exit 1
  }
  printf 'ok %s\n' "$name"
}

normal_tail=$'run --rm backend node scripts/seed.js up\nup -d --wait --remove-orphans --no-build mongodb backend frontend\nlogs --no-log-prefix backend'
existing_head=$'up -d --wait --no-build mongodb\nbackup\nrun --rm backend node scripts/migrate.js pending'

run_deploy pending 3 0 0 no
expect_trace pending "$existing_head"$'\nstop backend tg-service\nrun --rm backend node scripts/migrate.js up\n'"$normal_tail"

run_deploy current 0 0 0 no
expect_trace current "$existing_head"$'\n'"$normal_tail"

run_deploy fresh 0 0 0 yes
expect_trace fresh $'up -d --wait --no-build mongodb\nrun --rm backend node scripts/migrate.js pending\n'"$normal_tail"

if run_deploy stop_failed 3 1 0 no; then
  echo 'FAIL failed writer stop must prevent migrations and service startup' >&2
  exit 1
fi
expect_trace stop_failed "$existing_head"$'\nstop backend tg-service'

if run_deploy migration_failed 3 0 1 no; then
  echo 'FAIL failed migration must prevent seeds and service startup' >&2
  exit 1
fi
expect_trace migration_failed "$existing_head"$'\nstop backend tg-service\nrun --rm backend node scripts/migrate.js up'

if run_deploy ledger_missing 2 0 0 no; then
  echo 'FAIL missing ledger must prevent migration and startup' >&2
  exit 1
fi
expect_trace ledger_missing "$existing_head"
