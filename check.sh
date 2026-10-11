#!/usr/bin/env bash
#
# HD — every quality gate with one command, in a container.
#
#   ./check.sh                   repo, backend, frontend, tg-service
#   ./check.sh backend           one part (several may be listed)
#   ./check.sh images            build the production images and inspect them
#
# Nothing is written to the working tree. The first run downloads the
# dependencies into the hd_ci_pnpm_store volume; later runs reuse it.
#
# CHECK_DOCKER_NETWORK   optional Docker network for the build and the run,
#                        e.g. CHECK_DOCKER_NETWORK=host ./check.sh on a machine
#                        where containers on the default bridge cannot resolve
#                        names. Unset: Docker's default.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

usage() { sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'; }

source_parts=()
want_images=no
[ $# -gt 0 ] || set -- repo backend frontend tg-service
for part in "$@"; do
  case "$part" in
    images) want_images=yes ;;
    repo|backend|frontend|tg-service) source_parts+=("$part") ;;
    help|-h|--help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if [ ${#source_parts[@]} -gt 0 ]; then
  network=()
  [ -z "${CHECK_DOCKER_NETWORK:-}" ] || network=(--network "$CHECK_DOCKER_NETWORK")

  # In a linked git worktree .git is a file that points into the main
  # checkout; that directory is mounted at the same path so that git works
  # inside the container too.
  git_mount=()
  if [ -f .git ]; then
    git_common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
    git_mount=(-v "$git_common:$git_common:ro")
  fi

  docker build -q "${network[@]}" -t hd-ci:local ci >/dev/null
  docker run --rm --init --ulimit core=0 "${network[@]}" \
    -v "$PWD:/repo:ro" "${git_mount[@]}" \
    -v hd_ci_pnpm_store:/pnpm-store \
    -e npm_config_store_dir=/pnpm-store \
    -e CI=true \
    hd-ci:local "${source_parts[@]}"
fi

if [ "$want_images" = yes ]; then
  bash ci/images.sh
fi
