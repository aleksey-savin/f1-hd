#!/usr/bin/env bash
# Tests of deploy.sh: choosing between building and pulling images.
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."

failures=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# Runs a snippet in a fresh shell that has loaded deploy.sh against a scratch
# .env; prints its stdout+stderr, returns its exit code.
run() {
  local env_content=$1 snippet=$2 dir
  dir=$(mktemp -d)
  printf '%s' "$env_content" > "$dir/.env"
  DEPLOY_TEST_ENV_FILE="$dir/.env" DEPLOY_SH_SOURCED=1 bash -c "source ./deploy.sh; $snippet" 2>&1
  local code=$?
  LAST_ENV=$(cat "$dir/.env")
  rm -rf "$dir"
  return $code
}

expect_ok()   { if out=$(run "$2" "$3"); then ok "$1"; else bad "$1 — $out"; fi; }
expect_die()  { if out=$(run "$2" "$3"); then bad "$1 — expected a stop, got: $out"; else
                  case "$out" in *"$4"*) ok "$1" ;; *) bad "$1 — wrong message: $out" ;; esac; fi; }
expect_out()  { out=$(run "$2" "$3"); [ "$out" = "$4" ] && ok "$1" || bad "$1 — got '$out', want '$4'"; }
# The resulting .env has a line that is exactly $4.
expect_env()  { run "$2" "$3" >/dev/null
                if printf '%s\n' "$LAST_ENV" | grep -Fxq -- "$4"; then ok "$1"; else bad "$1 — .env is: $LAST_ENV"; fi; }
# The resulting .env is exactly $4 (the final newline aside).
expect_file() { run "$2" "$3" >/dev/null
                [ "$LAST_ENV" = "$4" ] && ok "$1" || bad "$1 — .env is: $LAST_ENV"; }
# The resulting .env has exactly $5 lines that start with $4.
expect_count() { run "$2" "$3" >/dev/null; local n
                n=$(printf '%s\n' "$LAST_ENV" | grep -c -- "^$4" || true)
                [ "$n" = "$5" ] && ok "$1" || bad "$1 — $n lines start with $4: $LAST_ENV"; }

echo "deploy.sh: image source"

expect_out "no keys means build mode"            ""                                  'image_mode' build
expect_out "empty keys mean build mode"          $'IMAGE_REGISTRY=\nIMAGE_TAG=\n'    'image_mode' build
expect_out "registry and tag mean pull mode"     $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' 'image_mode' pull
expect_out "a registry of slashes only is build mode" $'IMAGE_REGISTRY=/\n'          'image_mode' build
expect_env "a registry of slashes only writes the local prefix" $'IMAGE_REGISTRY=//\n' 'ensure_image_source' 'IMAGE_PREFIX=hd-'

expect_env "build mode writes the local prefix"  $'MONGODB_PASSWORD=x\n'             'ensure_image_source' 'IMAGE_PREFIX=hd-'
expect_env "pull mode writes the registry prefix" $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_env "a trailing slash is not doubled"     $'IMAGE_REGISTRY=r.example/hd/\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_env "a quoted registry is unquoted"       $'IMAGE_REGISTRY="r.example/hd"\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_file "no newline at the end of .env"      'MONGODB_PASSWORD=x'                'ensure_image_source' $'MONGODB_PASSWORD=x\nIMAGE_PREFIX=hd-'
expect_env "switching back to build mode"        $'IMAGE_PREFIX=r.example/hd/\n'     'ensure_image_source' 'IMAGE_PREFIX=hd-'
expect_count "switching to build mode keeps one IMAGE_PREFIX" $'IMAGE_PREFIX=r.example/hd/\n' 'ensure_image_source' 'IMAGE_PREFIX=' 1
expect_count "switching to pull mode keeps one IMAGE_PREFIX" $'IMAGE_PREFIX=hd-\nIMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' \
  'ensure_image_source; ensure_image_source' 'IMAGE_PREFIX=' 1

expect_die "pull mode without a tag"             $'IMAGE_REGISTRY=r.example/hd\n'    'ensure_image_source' 'IMAGE_TAG must name the release'
expect_die "latest is refused"                   $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=latest\n' 'ensure_image_source' 'IMAGE_TAG=latest is not accepted'
expect_die "a tag with a space is refused"       $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1 0\n'  'ensure_image_source' 'characters an image tag cannot have'
expect_die "a registry with a space is refused"  $'IMAGE_REGISTRY=r example\nIMAGE_TAG=2.1.0\n'     'ensure_image_source' 'characters a registry path cannot have'
expect_die "a tag without a registry"            $'IMAGE_TAG=2.1.0\n'                'ensure_image_source' 'IMAGE_REGISTRY is empty'

# Validation of the image source must work on a host without git.
expect_ok  "validation needs no git"             $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' \
  'git() { echo "git was called" >&2; exit 9; }; ensure_image_source; [ "$(image_mode)" = pull ]'

expect_out "build identity comes from VERSION"   ""  'build_identity; printf %s "$APP_VERSION"' "$(tr -d '[:space:]' < VERSION)"
expect_ok  "the commit is 12 hex digits, with .dirty when the tree has changes" "" \
  'build_identity; printf %s "$APP_COMMIT" | grep -Eq "^([0-9a-f]{12}(\.dirty)?|dev)$"'

# A checkout whose commit cannot be read is built as +dev, and says so. The
# snippet works in a scratch tree: a .git entry, a VERSION, a git that fails.
SCRATCH_TREE='tree=$(mktemp -d); cd "$tree"; echo 9.9.9 > VERSION'
GIT_REFUSES='git() { echo "fatal: detected dubious ownership in repository" >&2; return 128; }'
expect_out "git that refuses the repository: a warning and +dev" "" \
  "$SCRATCH_TREE; : > .git; $GIT_REFUSES"'; build_identity 2>&1; echo "$APP_VERSION+$APP_COMMIT"; cd /; rm -rf "$tree"' \
  'warning: cannot read the commit from git (fatal: detected dubious ownership in repository): the build is labelled 9.9.9+dev, and open tabs will not be told about this update
9.9.9+dev'
expect_out "the warning goes to stderr" "" \
  "$SCRATCH_TREE; : > .git; $GIT_REFUSES"'; build_identity 2>/dev/null; echo "$APP_VERSION+$APP_COMMIT"; cd /; rm -rf "$tree"' \
  '9.9.9+dev'
expect_out "a tree that is not a checkout: +dev without a warning" "" \
  "$SCRATCH_TREE; $GIT_REFUSES"'; build_identity 2>&1; echo "$APP_VERSION+$APP_COMMIT"; cd /; rm -rf "$tree"' \
  '9.9.9+dev'

echo "deploy.sh: Docker Compose version"

for version in 2.17.0 2.17.3 v2.20.2 2.39.1-desktop.1 5.0.0 10.2.0 2.100.0; do
  expect_ok "compose $version is accepted" "" "compose_version_ok '$version'"
done
for version in 2.16.0 v2.16.2 2.3.3 1.29.2; do
  expect_die "compose $version is refused" "" "compose_version_ok '$version' || { echo refused; exit 1; }" refused
done
for version in "" dev garbage "2" "v" "x.y.z"; do
  expect_ok "compose version '$version' is not judged" "" "compose_version_ok '$version'"
done
# ensure_docker with stand-ins for docker: the version decides, and the
# message names what was found.
DOCKER_STUB='docker() { case "$*" in "compose version --short") echo "$COMPOSE_V" ;; esac; return 0; }'
expect_die "ensure_docker stops on an old compose" "" "COMPOSE_V=2.16.0; $DOCKER_STUB; ensure_docker; echo went on" \
  'Docker Compose 2.17 or newer is required (found 2.16.0): compose.yml uses named build contexts. Update the docker-compose-plugin package and run ./deploy.sh again.'
expect_out "ensure_docker goes on with a current compose" "" "COMPOSE_V=v2.20.2; $DOCKER_STUB; ensure_docker; echo went on" 'went on'
expect_out "ensure_docker goes on when the version does not parse" "" "COMPOSE_V=; $DOCKER_STUB; ensure_docker; echo went on" 'went on'

echo "deploy.sh: the running build"

expect_out "a build id is shown as it is" "" \
  'dc() { echo "dc was called"; }; running_build_label 2.1.0+3f2a9c1d07be' '2.1.0+3f2a9c1d07be'
expect_out "a backend without build-info.json is unknown" "" \
  'dc() { case "$1" in ps) echo 0123abcd ;; esac; }; running_build_label ""' 'unknown (image predates build identities)'
expect_out "no backend is nothing" "" \
  'dc() { return 0; }; running_build_label ""' 'nothing'
expect_out "a compose that cannot answer is nothing" "" \
  'dc() { return 1; }; running_build_label ""' 'nothing'

echo "deploy.sh: pulling"

# dc and docker are replaced by stand-ins: no Docker is touched.
PULL_ENV=$'IMAGE_PREFIX=r.example/hd/\nIMAGE_TAG=2.1.0\nCOMPOSE_PROFILES=\n'
PULL_ENV_TG=$'IMAGE_PREFIX=r.example/hd/\nIMAGE_TAG=2.1.0\nCOMPOSE_PROFILES=telegram\n'
expect_out "without the telegram profile two services" "$PULL_ENV"    'image_services | tr "\n" " "' 'backend frontend '
expect_out "with the telegram profile three services"  "$PULL_ENV_TG" 'image_services | tr "\n" " "' 'backend frontend tg-service '
expect_out "the pull asks for exactly those services"  "$PULL_ENV_TG" \
  'dc() { echo "dc $*"; }; docker() { return 0; }; pull_images' 'dc pull backend frontend tg-service'
expect_out "every pulled image is then looked up by its full name" "$PULL_ENV_TG" \
  'seen=$ENV_FILE.seen; dc() { :; }; docker() { echo "$3" >> "$seen"; }; pull_images; tr "\n" " " < "$seen"' \
  'r.example/hd/backend:2.1.0 r.example/hd/frontend:2.1.0 r.example/hd/tg-service:2.1.0 '
expect_die "a failed pull stops with the script's message" "$PULL_ENV" \
  'dc() { return 1; }; docker() { return 0; }; pull_images; echo "went on"' 'cannot pull r.example/hd/*:2.1.0'
expect_die "a pull that only warned stops when an image is missing" "$PULL_ENV" \
  'dc() { return 0; }; docker() { case "$3" in *frontend*) return 1 ;; esac; return 0; }; pull_images; echo "went on"' \
  'image r.example/hd/frontend:2.1.0 is not on this host'
expect_out "all images present: the run goes on" "$PULL_ENV" \
  'dc() { return 0; }; docker() { return 0; }; pull_images; echo "went on"' 'went on'

echo "deploy.sh: the .env file"

# ENV_FILE from the environment is never read: compose uses the literal .env.
out=$(ENV_FILE=/nonexistent/other.env DEPLOY_SH_SOURCED=1 bash -c 'source ./deploy.sh; printf %s "$ENV_FILE"' 2>&1)
[ "$out" = .env ] && ok "an exported ENV_FILE is ignored" || bad "an exported ENV_FILE is ignored — got '$out'"
# Outside a test run nothing but the literal can be assigned: the only other
# assignment in the script sits behind DEPLOY_SH_SOURCED.
assignments=$(grep -nE '(^|[^_A-Z"$])ENV_FILE=' deploy.sh | sed 's/^[0-9]*://')
want='ENV_FILE=.env
if [ "${DEPLOY_SH_SOURCED:-}" = 1 ]; then ENV_FILE=${DEPLOY_TEST_ENV_FILE:-.env}; fi'
[ "$assignments" = "$want" ] && ok "ENV_FILE is assigned only as the literal and behind the test guard" \
  || bad "ENV_FILE is assigned only as the literal and behind the test guard — found: $assignments"
literal=$(sed -n '/^ensure_env() {/,/^}/p' deploy.sh | grep -nE '(^|[ >])\.env( |$)' || true)
[ -z "$literal" ] && ok "ensure_env has no literal .env" || bad "ensure_env has no literal .env — $literal"
# ensure_env itself, with docker and openssl replaced by stand-ins: it creates
# the file it was pointed at, private, and no .env appears beside deploy.sh.
had_env=no; [ -e .env ] && had_env=yes
expect_ok "ensure_env creates its file at ENV_FILE with mode 600" "" \
  'rm -f "$ENV_FILE"; docker() { return 1; }; openssl() { echo generated; }
   ensure_env </dev/null >/dev/null; [ "$(stat -c %a "$ENV_FILE")" = 600 ] && grep -q "^MONGODB_PASSWORD=generated$" "$ENV_FILE"'
now_env=no; [ -e .env ] && now_env=yes
[ "$had_env" = "$now_env" ] && ok "ensure_env leaves the directory of deploy.sh alone" \
  || bad "ensure_env leaves the directory of deploy.sh alone — .env appeared"

[ "$failures" = 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
