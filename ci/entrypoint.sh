#!/usr/bin/env bash
# Copies the working tree (tracked files and new, not ignored ones) out of the
# read-only mount, so that installs and builds never write to the host.
set -euo pipefail
mkdir -p /work
cd /repo
git ls-files -z --cached --others --exclude-standard \
  | tar --null --ignore-failed-read -T - -cf - 2>/dev/null \
  | tar -C /work -xf -
cp -a /repo/.git /work/.git
cd /work
exec bash ci/run.sh "$@"
