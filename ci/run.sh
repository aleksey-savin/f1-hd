#!/usr/bin/env bash
#
# Quality gates. Runs in any environment with Node 24, corepack and git:
# locally through ./check.sh (in a container), later from a pipeline job.
#
#   ci/run.sh                    repo, backend, frontend, tg-service
#   ci/run.sh backend frontend   only these parts
#
# The first failing step stops the run with a non-zero exit code.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
ulimit -c 0 2>/dev/null || true

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

# Directories of backend/package.json's "test" script, read from the script
# itself so that the list has one home.
backend_test_dirs() {
  node -e '
    const script = require("./backend/package.json").scripts.test;
    for (const match of script.matchAll(/"([a-z]+)\/\*\*\/\*\.test\.js"/g)) console.log(match[1]);
  '
}

# Backend test files of the working tree: tracked ones and new, not ignored
# ones (a test is in the tree before it is committed); deleted files are skipped.
backend_test_files() {
  git ls-files --cached --others --exclude-standard 'backend/*.test.js' \
    | while IFS= read -r file; do
        [ -f "$file" ] && printf '%s\n' "$file"
      done
  return 0
}

# Versions of a package in a pnpm lockfile, one per line. Lock keys look like
# "  name@1.2.3:" under packages: and "  name@1.2.3(peer@x):" under snapshots:
# (quoted when the name is scoped).
lock_versions() {
  local lock=$1 package=$2
  sed -n "s/^  '\{0,1\}$package@\([0-9][^:('\"]*\).*/\1/p" "$lock" | sort -u
}

# Packages that break at run time when the bundle holds two copies of them. An
# override in package.json can split such a package between its dependents
# without any test or build noticing, so the lockfile itself is checked.
SINGLE_VERSION_PACKAGES="prosemirror-model prosemirror-state prosemirror-view prosemirror-transform react react-dom"

single_versions() {
  local lock=$1 package versions
  for package in $SINGLE_VERSION_PACKAGES; do
    versions=$(lock_versions "$lock" "$package" | tr '\n' ' ')
    [ "$(printf '%s' "$versions" | wc -w)" -le 1 ] \
      || fail "$lock holds several versions of $package: ${versions% } (add a pnpm override in ${lock%/*}/package.json so that every dependent resolves one)"
  done
}

part_repo() {
  step "repo: VERSION"
  [ -f VERSION ] || fail "VERSION is missing"
  [ "$(grep -c '' VERSION)" = 1 ] || fail "VERSION must be exactly one line"
  version=$(tr -d '[:space:]' < VERSION)
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
    || fail "VERSION is not a semantic version: '$version'"

  step "repo: CHANGELOG has a section for $version"
  grep -Fxq "## $version" CHANGELOG.md || fail "CHANGELOG.md has no '## $version' heading"

  step "repo: one lockfile format"
  # A file deleted from the working tree but not yet committed is on its way
  # out and does not count.
  stray=$(git ls-files | grep -E '(^|/)(package-lock\.json|yarn\.lock)$' \
    | while IFS= read -r file; do [ -f "$file" ] && printf '%s\n' "$file"; done || true)
  [ -z "$stray" ] || fail "foreign lockfiles are tracked: $stray"

  step "repo: one version of the packages that must not be duplicated"
  single_versions frontend/pnpm-lock.yaml

  step "repo: nothing reads the version from package.json"
  hits=$(git ls-files 'backend/*' 'frontend/src/*' 'frontend/vite.config.js' 'tg-service/src/*' \
    | grep -E '\.(js|mjs|cjs|jsx|ts|tsx)$' \
    | xargs grep -nE 'npm_package_version|packageJson\.version|package\.json"\)\.version' || true)
  [ -z "$hits" ] || fail "version read from package.json: $hits"

  step "repo: every backend test directory is in the test script"
  listed=$(backend_test_dirs | sort -u)
  actual=$(backend_test_files | cut -d/ -f2 | sort -u)
  missing=$(comm -13 <(printf '%s\n' "$listed") <(printf '%s\n' "$actual"))
  [ -z "$missing" ] || fail "backend tests outside the test script: $missing"

  step "repo: shell syntax"
  git ls-files '*.sh' | while IFS= read -r script; do
    [ -f "$script" ] || continue
    bash -n "$script" || fail "syntax error in $script"
  done

  for script in ci/tests/*.sh; do
    [ -f "$script" ] || continue
    step "repo: $script"
    bash "$script" || fail "$script"
  done
}

node_part() {
  local dir=$1; shift
  step "$dir: install"
  (cd "$dir" && corepack install >/dev/null && pnpm install --frozen-lockfile)
  local script
  for script in "$@"; do
    step "$dir: $script"
    (cd "$dir" && pnpm run "$script")
  done
  step "$dir: audit (production dependencies, high and critical)"
  (cd "$dir" && pnpm audit --prod --audit-level high)
}

part_backend()    { node_part backend lint typecheck test; }
part_frontend()   { node_part frontend lint typecheck test build; }
part_tg_service() { node_part tg-service typecheck test; }

[ $# -gt 0 ] || set -- repo backend frontend tg-service
for part in "$@"; do
  case "$part" in
    repo)       part_repo ;;
    backend)    part_backend ;;
    frontend)   part_frontend ;;
    tg-service) part_tg_service ;;
    *) fail "unknown part '$part' (repo | backend | frontend | tg-service)" ;;
  esac
done
printf '\nAll checks passed: %s\n' "$*"
