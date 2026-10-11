#!/usr/bin/env bash
#
# Builds the three production images under throw-away names and checks what is
# inside: the build identity, the licence, and nothing that is not product.
# Needs Docker; called by ./check.sh images.
#
# CHECK_DOCKER_NETWORK   optional Docker network for every `docker build`, as in
#                        check.sh (e.g. host, where the default bridge cannot
#                        resolve names). Unset: Docker's default.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

VERSION_UNDER_TEST=0.0.0-check
COMMIT_UNDER_TEST=checkcommit
ID_UNDER_TEST="$VERSION_UNDER_TEST+$COMMIT_UNDER_TEST"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; docker image rm -f hd-check-backend:check hd-check-frontend:check hd-check-tg-service:check >/dev/null 2>&1 || true' EXIT

network=()
[ -z "${CHECK_DOCKER_NETWORK:-}" ] || network=(--network "$CHECK_DOCKER_NETWORK")

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

# Assembled from parts so that this file passes the brand guard itself.
OLD_BRAND="F1""Lab|F1""-HD|f1""lab\.ru"

build() {
  step "build $1"
  docker build -q --target prod "${network[@]}" --build-context root=. \
    --build-arg APP_VERSION="$VERSION_UNDER_TEST" --build-arg APP_COMMIT="$COMMIT_UNDER_TEST" \
    -t "hd-check-$1:check" "$1" >/dev/null
}

# Unpacks the product directories of an image into $WORK/<service>.
unpack() {
  local service=$1; shift
  local container
  container=$(docker create "hd-check-$service:check")
  mkdir -p "$WORK/$service"
  docker export "$container" | tar -C "$WORK/$service" -xf - "$@" 2>/dev/null || true
  docker rm "$container" >/dev/null
}

inspect() {
  local service=$1 root=$2
  step "$service: contents"
  local listing="$WORK/$service.list"
  (cd "$WORK/$service" && find "$root" -type f -not -path '*/node_modules/*') > "$listing"
  [ -s "$listing" ] || fail "$service: nothing found under /$root"

  local denied
  denied=$(grep -E -f ci/image-denylist.txt "$listing" || true)
  [ -z "$denied" ] || fail "$service image contains: $denied"

  local markdown
  markdown=$(grep -E '\.md$' "$listing" | grep -v '^app/help/' || true)
  [ -z "$markdown" ] || fail "$service image contains notes: $markdown"

  local branded
  branded=$(cd "$WORK/$service" && grep -rIlE -i "$OLD_BRAND" "$root" --exclude-dir=node_modules || true)
  [ -z "$branded" ] || fail "$service image mentions the previous owner: $branded"

  [ -f "$WORK/$service/LICENSE" ] || fail "$service image has no /LICENSE"
}

for service in backend frontend tg-service; do build "$service"; done

unpack backend app LICENSE
inspect backend app
grep -Fq "\"version\":\"$VERSION_UNDER_TEST\",\"commit\":\"$COMMIT_UNDER_TEST\"" "$WORK/backend/app/build-info.json" \
  || fail "backend image does not carry the build identity"
# The Help articles are the one Markdown the product ships: backend/.dockerignore
# drops **/*.md and then lets help/** back in, and the order of those two lines
# decides whether Help is there at all.
grep -Eq '^app/help/.*\.md$' "$WORK/backend.list" \
  || fail "backend image has no Help articles under /app/help"

unpack tg-service app LICENSE
inspect tg-service app
grep -Fq "\"version\":\"$VERSION_UNDER_TEST\"" "$WORK/tg-service/app/build-info.json" \
  || fail "tg-service image does not carry the build identity"

unpack frontend usr/share/nginx/html etc/nginx/templates LICENSE
inspect frontend usr/share/nginx/html
grep -rFq "$ID_UNDER_TEST" "$WORK/frontend/usr/share/nginx/html" \
  || fail "frontend bundle does not carry the build identity"
[ -n "$(find "$WORK/frontend/etc/nginx/templates" -type f -name '*.template' 2>/dev/null)" ] \
  || fail "frontend image has no nginx template under /etc/nginx/templates"

for service in backend frontend tg-service; do
  step "$service: labels"
  label=$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "hd-check-$service:check")
  [ "$label" = "$VERSION_UNDER_TEST" ] || fail "$service: version label is '$label'"
done

printf '\nImages are clean and carry %s\n' "$ID_UNDER_TEST"
