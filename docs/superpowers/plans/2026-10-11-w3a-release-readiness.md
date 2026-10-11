# W3a Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every build an identity, one green quality-gate command, clean images, a licence, and a `deploy.sh` that can run an installation from pulled images — all without depending on where CI and the registry will live.

**Architecture:** A root `VERSION` file plus the commit are passed as build arguments and baked into each image (`build-info.json` for the Node services, a Vite define for the frontend). `ci/run.sh` holds the checks and runs anywhere with Node 24; `check.sh` wraps it in a container locally. `compose.yml` names images through `IMAGE_PREFIX`/`IMAGE_TAG`, which `deploy.sh` derives from two `.env` keys to choose between building and pulling.

**Tech Stack:** bash, Docker + compose (BuildKit named contexts), Node 24 (`node:test`), pnpm 10 via corepack, ESLint 9 flat config, Vite, Mongoose.

**Spec:** `docs/superpowers/specs/2026-10-11-w3a-release-readiness-design.md` — read it first; this plan argues from it.

## Global Constraints

- **Never `git commit`, `git push`, `git add`, `git stash`.** The owner commits. Where a task says "checkpoint", it means: run the listed checks and report; nothing else.
- Work in a git worktree (`superpowers:using-git-worktrees`); symlink `node_modules` from the main checkout for `backend/` and `frontend/` if a host-side run is needed, and remove the symlinks afterwards.
- pnpm only. `pnpm install` and anything that talks to the Docker socket needs the sandbox disabled.
- **Never run the full backend suite on the host.** On the host run only the test files of the code you touched, under `ulimit -c 0`. The full suite runs only through `./check.sh` (in a container).
- Production is read-only; nothing in this plan touches it.
- Do not print or copy host names, users, IP addresses or e-mail addresses from `sync-dev-db.sh` into reports, docs or tracked files.
- Product text, UI copy and code comments in Russian; `docs/*.md` module notes and this plan's shell comments in English. `CHANGELOG.md` is Russian.
- No UI changes. If a step seems to need one, stop and report.
- Nothing may assume GitHub or GitLab.
- Version set by this work: `2.1.0`. Rights holder: Общество с ограниченной ответственностью «Ф1», year 2026.
- The main checkout may hold other people's uncommitted edits; revert your own changes surgically, never whole files.
- Deviations from the spec that this plan makes on purpose (the reason is in the task): the running build is read from `build-info.json` inside the container instead of `/health` (Task 6); `IMAGE_PREFIX` is written to `.env` by `deploy.sh` so that a plain `docker compose` sees it (Task 6); `check.sh images` uses `docker build` per service instead of `docker compose build`, because compose refuses to load without `.env` (Task 5).

## Review Focus

1. **`.env` in pull mode on a host with no git and no `VERSION` file** — `deploy.sh` must not call git or read `VERSION`; it must start the stack. Pinned in Task 6, test `pull mode needs no source tree`.
2. **`IMAGE_REGISTRY` written with a trailing slash or `IMAGE_TAG` with a space/quote** — the prefix must not become `host//`, and a malformed tag must stop with a message, not reach `docker`. Pinned in Task 6.
3. **`build-info.json` missing, empty or not JSON** (dev container, half-built image) — the backend must start and report `dev`, not crash at `require` time. Pinned in Task 1.
4. **A new `*.test.js` in a directory the backend `test` script does not list** — it must fail the `repo` part instead of being skipped silently, which is the bug this plan fixes. Pinned in Task 4.
5. **`maskData.js` pointed at a database that is not the local dev one, or run twice** — it must refuse the first and be idempotent on the second (same output for the same `_id`). Pinned in Task 8.

---

## File map

| Path | Responsibility |
|---|---|
| `VERSION` | the release version, one line |
| `LICENSE` | proprietary notice |
| `CHANGELOG.md` | operator/customer-facing changes per version |
| `backend/utils/buildInfo.js` (+ test) | read `build-info.json`, expose `{version, commit, id}` |
| `tg-service/src/buildInfo.ts` (+ test) | same for the Telegram service |
| `ci/run.sh` | the checks, by part |
| `ci/Dockerfile`, `ci/entrypoint.sh` | local container that runs `ci/run.sh` on a copy of the tree |
| `ci/images.sh`, `ci/image-denylist.txt` | build production images, assert their contents |
| `ci/tests/deploy_image_source.sh` | tests of `deploy.sh` mode selection |
| `check.sh` | local wrapper |
| `ops/sync-dev-db.sh`, `ops/sync.env.example`, `ops/README.md` | internal: copy production into dev |
| `backend/scripts/dev/maskData.js` (+ test) | pseudonymise a restored copy |

---

### Task 1: Build identity and licence

**Files:**
- Create: `VERSION`, `LICENSE`, `backend/utils/buildInfo.js`, `backend/utils/buildInfo.test.js`, `tg-service/src/buildInfo.ts`, `tg-service/src/buildInfo.test.ts`
- Modify: `backend/routes/public/health.js:29`, `backend/controllers/appVersion.js`, `backend/controllers/pulse.js:62` (and its `packageJson` require), `tg-service/src/health.ts:47-51`, `frontend/vite.config.js:7-21`, the three `Dockerfile`s, `compose.yml`, the three `package.json`, `.gitignore`, `README.md`

**Interfaces:**
- Produces: `require("@/utils/buildInfo")` → `{ buildInfo: { version, commit, id }, readBuildInfo(file?) }`; `import { buildInfo } from "./buildInfo.ts"` in tg-service with the same three string fields; build args `APP_VERSION`, `APP_COMMIT` (default `dev`); named build context `root`; compose variables `IMAGE_PREFIX` (default `hd-`) and `IMAGE_TAG` (default `latest`); image file `/app/build-info.json` in backend and tg-service images, `/LICENSE` in all three.

- [ ] **Step 1: Write the failing backend test** — `backend/utils/buildInfo.test.js`

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readBuildInfo } = require("./buildInfo");

const tmp = (content) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bi-")), "build-info.json");
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
};

test("no file means a dev build", () => {
  assert.deepEqual(readBuildInfo(tmp()), { version: "dev", commit: "dev", id: "dev" });
});

test("a baked file gives version+commit", () => {
  const file = tmp('{"version":"2.1.0","commit":"3f2a9c1d07be"}\n');
  assert.deepEqual(readBuildInfo(file), {
    version: "2.1.0",
    commit: "3f2a9c1d07be",
    id: "2.1.0+3f2a9c1d07be",
  });
});

test("empty, broken or foreign content never throws", () => {
  for (const content of ["", "{", "null", "[]", '{"version":7}', '{"version":"  "}']) {
    assert.equal(readBuildInfo(tmp(content)).id, "dev", JSON.stringify(content));
  }
});

test("a version without a commit keeps the version", () => {
  assert.equal(readBuildInfo(tmp('{"version":"2.1.0"}')).id, "2.1.0+dev");
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd backend && ulimit -c 0 && node --test utils/buildInfo.test.js`
Expected: FAIL, `Cannot find module './buildInfo'`.

- [ ] **Step 3: Implement** — `backend/utils/buildInfo.js`

```js
/**
 * Версия и коммит сборки. Образ пишет их в build-info.json последним слоем
 * (backend/Dockerfile); в dev файла нет, и сборка называется "dev".
 *
 * Это файл, а не переменная окружения, намеренно: backend получает весь .env
 * через env_file, и случайный ключ оттуда перекрыл бы ENV образа.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "build-info.json");

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : "dev");

const readBuildInfo = (file = FILE) => {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const version = clean(source.version);
  const commit = clean(source.commit);
  return { version, commit, id: version === "dev" ? "dev" : `${version}+${commit}` };
};

module.exports = { readBuildInfo, buildInfo: readBuildInfo() };
```

- [ ] **Step 4: Run it, expect 4 passing.**

- [ ] **Step 5: Use it in the backend.**
  - `routes/public/health.js`: `const { buildInfo } = require("../../utils/buildInfo");`; replace the `version:` line with `version: buildInfo.version,` and add `commit: buildInfo.commit,` below it.
  - `controllers/appVersion.js`: drop the `packageJson` require; respond `res.status(200).json(buildInfo.id)`.
  - `controllers/pulse.js`: `appVersion: buildInfo.id`; remove the now unused `packageJson` require.
  - Check nothing else reads the package version: `grep -rnE "package\.json\"?\)?\.version|packageJson\.version|npm_package_version" backend --include=*.js --include=*.mjs --include=*.ts --exclude-dir=node_modules --exclude-dir=.pnpm-store` must print nothing.
  - Run the test files next to what you touched: `ls backend/controllers/pulse*.test.js backend/controllers/appVersion*.test.js backend/routes/public/*.test.js 2>/dev/null` and run those that exist; adjust any that asserted a `package.json` version to expect `"dev"`.

- [ ] **Step 6: tg-service, test first** — `tg-service/src/buildInfo.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBuildInfo } from "./buildInfo.ts";

const tmp = (content?: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "bi-")), "build-info.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
};

test("no file means a dev build", () => {
  assert.deepEqual(readBuildInfo(tmp()), { version: "dev", commit: "dev", id: "dev" });
});

test("a baked file gives version+commit", () => {
  assert.equal(readBuildInfo(tmp('{"version":"2.1.0","commit":"abc"}')).id, "2.1.0+abc");
});

test("broken content never throws", () => {
  for (const content of ["", "{", "null", "[]", '{"version":7}']) {
    assert.equal(readBuildInfo(tmp(content)).id, "dev");
  }
});
```

`tg-service/src/buildInfo.ts`:

```ts
// Версия и коммит сборки: образ пишет build-info.json рядом с package.json
// (tg-service/Dockerfile); в dev файла нет, и сборка называется "dev".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  version: string;
  commit: string;
  id: string;
}

const FILE = fileURLToPath(new URL("../build-info.json", import.meta.url));

const clean = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "dev";

export const readBuildInfo = (file: string = FILE): BuildInfo => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  const source = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const version = clean(source.version);
  const commit = clean(source.commit);
  return { version, commit, id: version === "dev" ? "dev" : `${version}+${commit}` };
};

export const buildInfo = readBuildInfo();
```

In `src/health.ts` import `buildInfo` and add `version: buildInfo.version, commit: buildInfo.commit,` to the JSON object after `status`.
Run: `cd tg-service && pnpm typecheck && node --test src/buildInfo.test.ts` → green.

- [ ] **Step 7: Frontend.** In `frontend/vite.config.js` replace the `appVersion` block (the comment and the `JSON.parse(readFileSync(...))`) with:

```js
// Идентификатор сборки. В образе его задают аргументы сборки APP_VERSION и
// APP_COMMIT (frontend/Dockerfile), в dev их нет — и сервер, и клиент называют
// себя "dev", поэтому баннер «Доступна новая версия» в dev не появляется.
// define перекрывает и .env-файлы, и process.env.
const version = process.env.APP_VERSION || "dev";
const commit = process.env.APP_COMMIT || "dev";
const appVersion = version === "dev" ? "dev" : `${version}+${commit}`;
```

Remove the `readFileSync` import if nothing else uses it. `layout/Root.jsx` is not touched.

- [ ] **Step 8: Dockerfiles.**

`backend/Dockerfile`, `prod` stage — insert before `USER node`:

```dockerfile
COPY --from=root LICENSE /LICENSE
# Last layer on purpose: the identity changes with every commit, the layers
# above it do not.
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_COMMIT
RUN printf '{"version":"%s","commit":"%s"}\n' "$APP_VERSION" "$APP_COMMIT" > build-info.json
```

Replace the header comment's last paragraph about `--ignore-scripts`/husky only in Task 2 (husky goes there).

`tg-service/Dockerfile`, `prod` stage — the same block, placed before the `RUN mkdir -p data && chown -R node:node /app` line.

`frontend/Dockerfile` — in the `build` stage, between `COPY . .` and `RUN pnpm build`:

```dockerfile
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
ENV APP_VERSION=$APP_VERSION APP_COMMIT=$APP_COMMIT
```

and in the `prod` stage after `COPY --from=build …`:

```dockerfile
COPY --from=root LICENSE /LICENSE
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_COMMIT
```

Update the frontend header comment: "No build arguments" becomes "Two build arguments, the build identity; the bundle is otherwise the same for every installation."

- [ ] **Step 9: `compose.yml`.** For `backend`, `frontend`, `tg-service` add an `image:` line and extend `build:` (shown for backend; use `frontend` / `tg-service` in the image name and context of the other two):

```yaml
    # deploy.sh derives IMAGE_PREFIX: "hd-" when images are built here (the
    # name is then hd-backend:latest, as before), "<IMAGE_REGISTRY>/" when they
    # are pulled. See docs/deployment.md, "Images".
    image: ${IMAGE_PREFIX:-hd-}backend:${IMAGE_TAG:-latest}
    build:
      context: ./backend
      target: prod
      additional_contexts:
        root: .
      args:
        APP_VERSION: ${APP_VERSION:-dev}
        APP_COMMIT: ${APP_COMMIT:-dev}
```

Run: `docker compose -f compose.yml config -q` → exit 0 (needs `.env`; in the worktree copy the main checkout's `.env` locally and delete it at the end of the task — it is gitignored).

- [ ] **Step 10: Metadata.**
  - `VERSION`: the single line `2.1.0`.
  - `LICENSE`:

```text
© 2026 Общество с ограниченной ответственностью «Ф1». Все права защищены.

Настоящее программное обеспечение и сопутствующая документация являются
собственностью правообладателя. Использование, копирование, изменение,
распространение, декомпиляция и передача третьим лицам полностью или частично
допускаются только на основании письменного договора с правообладателем и в
пределах, прямо указанных в таком договоре. Программное обеспечение
предоставляется «как есть»; иные условия определяются договором.

© 2026 Obshchestvo s ogranichennoy otvetstvennostyu "F1" (F1 LLC). All rights reserved.

This software and its documentation are proprietary. No part of them may be
used, copied, modified, distributed, decompiled or disclosed to third parties
except under a written agreement with the rights holder and within the limits
that agreement states. The software is provided "as is"; all other terms are
set by that agreement.
```

  The English transliteration of the holder contains the old-brand token only as `"F1"`, which the guard's pattern does not match; confirm with `node --test backend/scripts/repoBrand.test.js`.
  - All three `package.json`: `"version": "0.0.0"`, `"license": "UNLICENSED"`, `"private": true` (add `license` to the frontend, which has none).
  - `.gitignore`: add `build-info.json`.
  - `README.md`: under the title add `Proprietary software — see [LICENSE](LICENSE).`

- [ ] **Step 11: Checkpoint.** Run `node --test backend/utils/buildInfo.test.js backend/scripts/repoBrand.test.js`, `cd tg-service && pnpm typecheck && pnpm test`, `cd frontend && pnpm build`. Then (sandbox off) build one image under a throw-away name to prove the wiring — never as `hd-backend:latest`, which a running stack on this machine may be using:

```bash
APP_VERSION=9.9.9 APP_COMMIT=abc IMAGE_PREFIX=hd-w3a- IMAGE_TAG=t1 docker compose -f compose.yml build backend
docker run --rm --entrypoint cat hd-w3a-backend:t1 /app/build-info.json   # {"version":"9.9.9","commit":"abc"}
docker run --rm --entrypoint head hd-w3a-backend:t1 -1 /LICENSE            # the © line
docker image rm hd-w3a-backend:t1
```

---

### Task 2: Backend gates — lint, the test script, stale tests, husky

**Files:**
- Modify: `backend/eslint.config.mjs` (rewrite), `backend/package.json` (scripts, devDependencies), `backend/pnpm-lock.yaml` (via pnpm), `backend/auth/access.test.js:19-21,52`, `backend/routes/mcp.test.js:304-312`, `backend/Dockerfile` (comment + `--ignore-scripts`), `.gitignore`, and the ~70 lint sites
- Delete: `backend/package-lock.json`

**Interfaces:**
- Produces: `pnpm lint` (exit 0, zero errors) and `pnpm test` (covers every tracked `*.test.js`) in `backend/`.

- [ ] **Step 1: Replace the lint config** — `backend/eslint.config.mjs`

```js
import js from "@eslint/js";
import globals from "globals";

// Плоский конфиг ESLint 9. Набор правил намеренно узкий — js/recommended:
// он ловит настоящие ошибки (необъявленные имена, недостижимый код, дубли
// ключей) и проходит на всей кодовой базе. *.ts не линтуются: их проверяет tsc.
const rules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
};

export default [
  { ignores: ["node_modules/**", ".pnpm-store/**", "uploads/**", "storage/**", "logs/**", "**/*.ts"] },
  {
    files: ["**/*.{js,cjs}"],
    languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: globals.node },
    rules,
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules,
  },
];
```

- [ ] **Step 2: Scripts and dependencies** in `backend/package.json`.
  - Add `"lint": "eslint ."`.
  - Replace `test` with all eleven directories that hold tests:
    `"test": "node --test \"auth/**/*.test.js\" \"controllers/**/*.test.js\" \"helpers/**/*.test.js\" \"middleware/**/*.test.js\" \"models/**/*.test.js\" \"prompts/**/*.test.js\" \"routes/**/*.test.js\" \"scripts/**/*.test.js\" \"services/**/*.test.js\" \"utils/**/*.test.js\" \"validations/**/*.test.js\""`
  - Remove scripts `prepare`, `precommit`, `security`, `test:workplace`.
  - Remove devDependencies: `pnpm remove eslint-plugin-import eslint-plugin-node eslint-plugin-promise eslint-plugin-security husky` (sandbox off).
  - Delete `backend/package-lock.json`. In `.gitignore` remove the `# Husky` / `.husky/` block and add `package-lock.json`, `yarn.lock`, `*.err`.
  - `backend/Dockerfile`: drop `--ignore-scripts` from both `pnpm install` lines **only if** `pnpm install --frozen-lockfile` in a clean container prints no "Ignored build scripts" warning for a package the app needs; otherwise keep the flag and rewrite the header comment to give the real reason (no dependency needs a build script) without mentioning husky.

- [ ] **Step 3: Run lint and fix every error.**

Run: `cd backend && ulimit -c 0 && npx eslint . -f stylish | tail -80`
Expected first run: about 70 errors (53 `no-unused-vars`, 6 `no-control-regex`, 4 `no-undef`, 3 `no-empty`, 2 `no-regex-spaces`, 1 `no-useless-escape`, 1 `no-irregular-whitespace`). Rules for fixing:
  - `no-undef` — each is a real bug candidate. Read the code path; add the missing require/declaration, or delete dead code. Report each one with file:line and what it was.
  - `no-unused-vars` — delete the unused import/variable. If it is a function parameter that must stay for arity (Express error handlers, `(req, res, next)`), prefix it with `_`. Do not delete a `require` that is there for its side effect — turn it into a bare `require("…");`.
  - `no-control-regex` — these regexes strip control characters on purpose; keep them and put `// eslint-disable-next-line no-control-regex` with a Russian comment saying what is being stripped.
  - `no-empty` — add a one-line Russian comment inside the block stating why nothing is done.
  - `no-regex-spaces`, `no-useless-escape`, `no-irregular-whitespace` — fix the literal; where the irregular whitespace is the data being matched, write it as a `\u` escape.
  - No file-level or config-level disabling.

After each batch of files, run the tests that sit next to them (`node --test <dir>/<name>.test.js`), never the whole suite.

- [ ] **Step 4: Fix the three stale tests.**
  - `auth/access.test.js`: the dictionary now has 61 actions — change the title and the assertion to 61, and add `Утверждать` to the verb alternation in the label regex on line 52. Confirm against `auth/access.js:436` that `mikrotik.approveChanges` is the only addition (`ALL_ACTIONS.length`).
  - `routes/mcp.test.js`, test "tools follow the key's permissions and the modules": run it, read the diff between actual and expected. For every extra tool name in `actual`, confirm it is registered under the `mikrotik` scope in `services/mcp/` (for example `mikrotikEventTools.js`), then add it to `MIKROTIK_TOOLS` in sorted order. If an extra tool does **not** belong to the scope under test, that is a product bug: stop and report instead of editing the expectation.

Run: `node --test auth/access.test.js routes/mcp.test.js` → all pass.

- [ ] **Step 5: Run the eight previously skipped files** (they have never been part of `pnpm test`):
`node --test "models/**/*.test.js" "prompts/**/*.test.js" "scripts/**/*.test.js" "utils/**/*.test.js"` → fix what fails; a failure that reveals a product bug is reported, not silenced.

- [ ] **Step 6: Checkpoint.** `npx eslint .` exits 0 with no output; the files run in steps 4–5 pass; `pnpm typecheck` passes. List every `no-undef` finding in the report.

---

### Task 3: Frontend and Telegram-service gates

**Files:**
- Modify: `frontend/src/components/app/FormWrapper.tsx:100`, `frontend/package.json` (scripts)
- Delete: `frontend/build.err`

**Interfaces:**
- Produces: in `frontend/`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all exit 0; in `tg-service/`: `pnpm typecheck`, `pnpm test` exit 0.

- [ ] **Step 1: Typecheck.** In `FormWrapper.tsx` the JSON branch casts to `Record<string, unknown>`, which is not a `SubmitTarget`. Replace the cast with the parameter type of the function being called:

```tsx
fetcher.submit(json!() as Parameters<typeof fetcher.submit>[0], {
```

Run: `cd frontend && pnpm typecheck` → no output, exit 0.

- [ ] **Step 2: Test script.** Add to `frontend/package.json` scripts: `"test": "node --test \"src/**/*.test.js\""`.
Run: `ulimit -c 0 && pnpm test` → all 44+ files pass. A failing file is fixed at its cause.

- [ ] **Step 3: Lint.** `pnpm lint` → exit 0. Fix what it reports (the script already has `--max-warnings=0`). Remember: there is no `react-hooks` plugin here — an `eslint-disable react-hooks/*` comment itself fails the lint.

- [ ] **Step 4:** delete `frontend/build.err`. `pnpm build` → exit 0.

- [ ] **Step 5: tg-service.** `cd tg-service && pnpm typecheck && pnpm test` → green (includes the test from Task 1).

- [ ] **Step 6: Checkpoint.** Report the four frontend and two tg-service exit codes.

---

### Task 4: `ci/run.sh`, `check.sh`, changelog, first full run

**Files:**
- Create: `ci/run.sh`, `ci/Dockerfile`, `ci/entrypoint.sh`, `check.sh`, `CHANGELOG.md`
- Modify: `README.md` ("Per-service scripts" block), any file the first full run shows to be broken

**Interfaces:**
- Consumes: the scripts from Tasks 2–3.
- Produces: `ci/run.sh [repo|backend|frontend|tg-service]…` (no argument = all four, in that order; exit non-zero on the first failure); `./check.sh [part…|images]`; `ci/run.sh repo` runs every executable `ci/tests/*.sh` it finds (Task 6 adds one).

- [ ] **Step 1: `ci/run.sh`** (mode 755)

```bash
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
  stray=$(git ls-files | grep -E '(^|/)(package-lock\.json|yarn\.lock)$' || true)
  [ -z "$stray" ] || fail "foreign lockfiles are tracked: $stray"

  step "repo: nothing reads the version from package.json"
  hits=$(git ls-files 'backend/*' 'frontend/src/*' 'frontend/vite.config.js' 'tg-service/src/*' \
    | grep -E '\.(js|mjs|cjs|jsx|ts|tsx)$' \
    | xargs grep -nE 'npm_package_version|packageJson\.version|package\.json"\)\.version' || true)
  [ -z "$hits" ] || fail "version read from package.json: $hits"

  step "repo: every backend test directory is in the test script"
  listed=$(backend_test_dirs | sort -u)
  actual=$(git ls-files 'backend/*.test.js' | cut -d/ -f2 | sort -u)
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
```

A backend test that lives directly in `backend/` (no subdirectory) would give `cut -d/ -f2` a file name; that is reported as "outside the test script", which is the intended answer.

- [ ] **Step 2: The container** — `ci/Dockerfile`

```dockerfile
# Local runner for ci/run.sh: the same Node as the product images, plus git
# (the brand guard and the repo checks read `git ls-files`).
FROM node:24-alpine
RUN apk add --no-cache bash git tar && corepack enable \
 && git config --system --add safe.directory '*'
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["bash", "/entrypoint.sh"]
```

`ci/entrypoint.sh`:

```bash
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
```

- [ ] **Step 3: `check.sh`** (root, mode 755)

```bash
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

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

usage() { sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; }

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
  docker build -q -t hd-ci:local ci >/dev/null
  docker run --rm --init --ulimit core=0 \
    -v "$PWD:/repo:ro" \
    -v hd_ci_pnpm_store:/pnpm-store \
    -e npm_config_store_dir=/pnpm-store \
    -e CI=true \
    hd-ci:local "${source_parts[@]}"
fi

if [ "$want_images" = yes ]; then
  bash ci/images.sh
fi
```

(`ci/images.sh` arrives in Task 5; until then `./check.sh images` fails with "No such file", which is acceptable inside this task.)

- [ ] **Step 4: `CHANGELOG.md`**

```markdown
# История изменений

Здесь — то, что важно тому, кто обновляет и обслуживает установку. Новые версии сверху.

## 2.1.0

### Новое

- Название, цвет, значок и подпись писем задаются в «Настройки → Основные → Бренд».
- Режим почты `MAIL_MODE`: `live` — письма уходят адресатам, `sandbox` — одному адресу, `off` — не уходят.
- Версия и коммит сборки видны в `/health` и в `./deploy.sh status`; после обновления открытые вкладки предлагают перезагрузиться.
- Установка из готовых образов: ключи `IMAGE_REGISTRY` и `IMAGE_TAG`.
- `./check.sh` — все проверки одной командой.

### Исправлено

- Исправления безопасности: доступ к чужим устройствам и заявкам, подделка отправителя входящей почты, вход по ссылке в обход второго фактора.
- Отчёты об ошибках из браузера отправляются, только если задан `SENTRY_DSN`.

### Что сделать при обновлении

- Установка, работавшая до 2.1.0: перед `./deploy.sh` добавьте в `.env` `TICKET_SUBJECT_PREFIX` — метку, с которой письма о заявках уходят сейчас. Без неё обновление остановится, ничего не изменив.
- Чтобы сохранить прежние название и подпись писем, до первого обновления добавьте `LEGACY_BRAND_NAME` и `LEGACY_BRAND_SIGNATURE` (см. `docs/deployment.md`).
- Проверьте `MAIL_MODE`: на действующей установке скрипт записывает `live`, на новой — `off`.
```

Before finalising, check each "Исправлено" line against the W1 section of `docs/superpowers/specs/2026-09-30-productization-audit.md` and each "Новое" line against the code; delete a line that is not true of the tree. The file must pass the brand guard.

- [ ] **Step 5: README.** Replace the "Per-service scripts" code block's content with the current scripts (add `pnpm lint` and `pnpm test` for all that have them) and add above it:

```markdown
`./check.sh` runs every gate (lint, typecheck, tests, build, dependency audit) in a
container and is what a release must pass; `./check.sh backend` runs one part,
`./check.sh images` builds the production images and inspects their contents.
```

- [ ] **Step 6: First full run and triage** (sandbox off).

Run: `./check.sh repo`, then `./check.sh tg-service`, `./check.sh frontend`, `./check.sh backend` — separately, so that one failure does not hide the rest.
Rules:
  - A crash of the node process during `backend: test` is a failure. Find which file crashes (`node --test` prints the file), reproduce it alone in the container (`docker run --rm -it --entrypoint bash -v "$PWD:/repo:ro" hd-ci:local`, then the copy commands from `entrypoint.sh`), and fix the cause. Typical causes to check first: a test that leaves a timer, server or interval open; a test that calls `process.exit`; two tests sharing a port; a test reading `.env` or the network.
  - A test that needs MongoDB or the network does not belong in this suite: make it self-contained with stubs, as its neighbours are.
  - `pnpm audit` findings of level high or critical: upgrade the dependency (`pnpm update <name>`, or `pnpm.overrides` for a transitive one) and re-run that service's tests. Only when no fixed version exists, add the advisory id to `pnpm.auditConfig.ignoreGhsas` in that `package.json` and a line to `docs/deployment.md` under a new heading "Known advisories" with the id, the package and why it does not apply.
  - No `--test-skip-pattern`, no deleted tests, no `|| true`.

- [ ] **Step 7: Prove the gate bites.** One at a time, in the worktree, then revert each: add `const unused = 1;` to `backend/app.js` → `./check.sh backend` fails at lint; put `2.1` in `VERSION` → `./check.sh repo` fails; create `backend/newdir/x.test.js` with a passing test → `./check.sh repo` fails with "outside the test script"; break an assertion in one frontend test → `./check.sh frontend` fails.

- [ ] **Step 8: Checkpoint.** `./check.sh` (all four) exits 0. Report: duration, every crash cause found, every advisory ignored (ideally none).

---

### Task 5: Image contents

**Files:**
- Create: `ci/images.sh`, `ci/image-denylist.txt`
- Modify: `backend/.dockerignore`, `frontend/.dockerignore`, `tg-service/.dockerignore`

**Interfaces:**
- Consumes: build args and the `root` context from Task 1; `check.sh images` from Task 4.
- Produces: `bash ci/images.sh` exits 0 only when the three production images build, carry the identity and `/LICENSE`, and contain nothing from the deny-list.

- [ ] **Step 1: `.dockerignore` files.** `backend/.dockerignore` — add:

```
.claude
.pnpm-store
.husky
eslint.config.mjs
package-lock.json
build-info.json
# Help articles are product content; every other Markdown file is a note
*.md
!help/**
# Developer-only scripts: data masking for a production copy and the like
scripts/dev
```

`frontend/.dockerignore` — add `.claude`, `*.md`, `*.test.js`, `*.err`, `eslint.config.mjs`.
`tg-service/.dockerignore` — add `.claude`, `*.md`, `build-info.json`, `src/**/*.test.ts` (its
Dockerfile copies `src` whole, so tests ship today).

Check that the backend still finds what it needs at runtime: `grep -rn "\.md\b" backend --include=*.js --exclude-dir=node_modules --exclude-dir=.pnpm-store | grep -v test | grep -v "help/"` — any runtime read of a Markdown file outside `help/` gets its own `!path` line.

- [ ] **Step 2: `ci/image-denylist.txt`** — extended regular expressions, one per line, matched against paths inside the product directories (dependencies excluded):

```
(^|/)\.env
(^|/)\.git(/|$)
(^|/)\.claude(/|$)
(^|/)\.superpowers(/|$)
(^|/)\.husky(/|$)
(^|/)docs(/|$)
(^|/)ops(/|$)
(^|/)ci(/|$)
(^|/)scripts/dev(/|$)
\.test\.(js|ts|mjs|jsx|tsx)$
\.map$
\.err$
(^|/)(package-lock\.json|yarn\.lock)$
(^|/)eslint\.config\.
(^|/)Dockerfile
(^|/)sync-dev-db
```

Markdown is handled in the script (allowed only under `app/help/`).

- [ ] **Step 3: `ci/images.sh`** (mode 755)

```bash
#!/usr/bin/env bash
#
# Builds the three production images under throw-away names and checks what is
# inside: the build identity, the licence, and nothing that is not product.
# Needs Docker; called by ./check.sh images.

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

VERSION_UNDER_TEST=0.0.0-check
COMMIT_UNDER_TEST=checkcommit
ID_UNDER_TEST="$VERSION_UNDER_TEST+$COMMIT_UNDER_TEST"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; docker image rm -f hd-check-backend:check hd-check-frontend:check hd-check-tg-service:check >/dev/null 2>&1 || true' EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

# Assembled from parts so that this file passes the brand guard itself.
OLD_BRAND="F1""Lab|F1""-HD|f1""lab\.ru"

build() {
  step "build $1"
  docker build -q --target prod --build-context root=. \
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

unpack tg-service app LICENSE
inspect tg-service app
grep -Fq "\"version\":\"$VERSION_UNDER_TEST\"" "$WORK/tg-service/app/build-info.json" \
  || fail "tg-service image does not carry the build identity"

unpack frontend usr/share/nginx/html etc/nginx/templates LICENSE
inspect frontend usr/share/nginx/html
grep -rFq "$ID_UNDER_TEST" "$WORK/frontend/usr/share/nginx/html" \
  || fail "frontend bundle does not carry the build identity"

for service in backend frontend tg-service; do
  step "$service: labels"
  label=$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.version" }}' "hd-check-$service:check")
  [ "$label" = "$VERSION_UNDER_TEST" ] || fail "$service: version label is '$label'"
done

printf '\nImages are clean and carry %s\n' "$ID_UNDER_TEST"
```

- [ ] **Step 4: Run** `./check.sh images` (sandbox off) → exit 0. Fix the `.dockerignore`s for whatever the first run reports.

- [ ] **Step 5: Prove it bites**, reverting each: create `backend/services/zzz.test.js` and remove the `*.test.js` line from `backend/.dockerignore` → fails with "contains"; create `backend/NOTES.md` after removing `*.md` → fails with "notes".

- [ ] **Step 6: Runtime sanity.** The backend image must still boot without what was excluded: `docker run --rm --entrypoint node hd-check-backend:check -e "require('./utils/buildInfo'); require('./help/sections.js'); console.log('ok')"` (run it before the trap removes the images — add it temporarily or build once by hand under another tag). Expected: `ok`.

- [ ] **Step 7: Checkpoint.** Report the size of each image and anything the first run found.

---

### Task 6: `deploy.sh` — build identity and pull mode

**Files:**
- Create: `ci/tests/deploy_image_source.sh`
- Modify: `deploy.sh` (header, `ENV_FILE`, new functions, `ensure_env`, `deploy`, `status`, a source guard), `.env.example`, `docs/deployment.md`

**Interfaces:**
- Consumes: compose variables `IMAGE_PREFIX`, `IMAGE_TAG`, build args `APP_VERSION`, `APP_COMMIT` (Task 1); `/app/build-info.json` in the backend container.
- Produces: `.env` keys `IMAGE_REGISTRY`, `IMAGE_TAG` (operator's), `IMAGE_PREFIX` (written by the script); functions `image_mode` (prints `build` or `pull`), `ensure_image_source`, `build_identity`, `running_build`.

- [ ] **Step 1: Make `deploy.sh` loadable by a test.** Change `ENV_FILE=.env` to `ENV_FILE=${ENV_FILE:-.env}`, and put this line immediately before the final `case "${1:-deploy}" in`:

```bash
# Tests load the functions above without running a command.
[ "${DEPLOY_SH_SOURCED:-}" = 1 ] && return 0
```

- [ ] **Step 2: Write the failing test** — `ci/tests/deploy_image_source.sh`

```bash
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
  ENV_FILE="$dir/.env" DEPLOY_SH_SOURCED=1 bash -c "source ./deploy.sh; $snippet" 2>&1
  local code=$?
  LAST_ENV=$(cat "$dir/.env")
  rm -rf "$dir"
  return $code
}

expect_ok()   { if out=$(run "$2" "$3"); then ok "$1"; else bad "$1 — $out"; fi; }
expect_die()  { if out=$(run "$2" "$3"); then bad "$1 — expected a stop, got: $out"; else
                  case "$out" in *"$4"*) ok "$1" ;; *) bad "$1 — wrong message: $out" ;; esac; fi; }
expect_out()  { out=$(run "$2" "$3"); [ "$out" = "$4" ] && ok "$1" || bad "$1 — got '$out', want '$4'"; }
expect_env()  { run "$2" "$3" >/dev/null; case "$LAST_ENV" in *"$4"*) ok "$1" ;; *) bad "$1 — .env is: $LAST_ENV" ;; esac; }

echo "deploy.sh: image source"

expect_out "no keys means build mode"            ""                                  'image_mode' build
expect_out "empty keys mean build mode"          $'IMAGE_REGISTRY=\nIMAGE_TAG=\n'    'image_mode' build
expect_out "registry and tag mean pull mode"     $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' 'image_mode' pull

expect_env "build mode writes the local prefix"  $'MONGODB_PASSWORD=x\n'             'ensure_image_source' 'IMAGE_PREFIX=hd-'
expect_env "pull mode writes the registry prefix" $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_env "a trailing slash is not doubled"     $'IMAGE_REGISTRY=r.example/hd/\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_env "a quoted registry is unquoted"       $'IMAGE_REGISTRY="r.example/hd"\nIMAGE_TAG=2.1.0\n' 'ensure_image_source' 'IMAGE_PREFIX=r.example/hd/'
expect_env "no newline at the end of .env"       'MONGODB_PASSWORD=x'                'ensure_image_source' $'MONGODB_PASSWORD=x\nIMAGE_PREFIX=hd-'
expect_env "switching back to build mode"        $'IMAGE_PREFIX=r.example/hd/\n'     'ensure_image_source' 'IMAGE_PREFIX=hd-'

expect_die "pull mode without a tag"             $'IMAGE_REGISTRY=r.example/hd\n'    'ensure_image_source' 'IMAGE_TAG'
expect_die "latest is refused"                   $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=latest\n' 'ensure_image_source' 'latest'
expect_die "a tag with a space is refused"       $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1 0\n'  'ensure_image_source' 'IMAGE_TAG'
expect_die "a registry with a space is refused"  $'IMAGE_REGISTRY=r example\nIMAGE_TAG=2.1.0\n'     'ensure_image_source' 'IMAGE_REGISTRY'
expect_die "a tag without a registry"            $'IMAGE_TAG=2.1.0\n'                'ensure_image_source' 'IMAGE_REGISTRY'

# Pull mode needs no source tree: build_identity must not be reached, and
# nothing may call git or read VERSION.
expect_ok  "pull mode needs no source tree"      $'IMAGE_REGISTRY=r.example/hd\nIMAGE_TAG=2.1.0\n' \
  'git() { echo "git was called" >&2; exit 9; }; ensure_image_source; [ "$(image_mode)" = pull ]'

expect_out "build identity comes from VERSION"   ""  'build_identity; printf %s "$APP_VERSION"' "$(tr -d '[:space:]' < VERSION)"
expect_ok  "the commit is 12 hex digits, with .dirty when the tree has changes" "" \
  'build_identity; printf %s "$APP_COMMIT" | grep -Eq "^([0-9a-f]{12}(\.dirty)?|dev)$"'

[ "$failures" = 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
```

Run: `bash ci/tests/deploy_image_source.sh` → fails (`image_mode: command not found`).

- [ ] **Step 3: Implement in `deploy.sh`.** Add a section after `require_subject_prefix`:

```bash
# --- images: built here or pulled -------------------------------------------

# "pull" when IMAGE_REGISTRY is set in .env, "build" otherwise.
image_mode() {
  if [ -n "$(env_get IMAGE_REGISTRY)" ]; then echo pull; else echo build; fi
}

# compose.yml names the images ${IMAGE_PREFIX}backend:${IMAGE_TAG}. The prefix
# is derived here and kept in .env, so that a plain `docker compose ps|up|logs`
# sees the same names as this script (the way SENTRY_CSP_ORIGIN is kept).
#   build mode: hd-backend:latest — the name compose gave these images before
#   pull mode:  <IMAGE_REGISTRY>/backend:<IMAGE_TAG>
ensure_image_source() {
  local registry tag
  registry=$(env_get IMAGE_REGISTRY); registry=${registry%/}
  tag=$(env_get IMAGE_TAG)
  if [ -z "$registry" ]; then
    [ -z "$tag" ] || die "IMAGE_TAG=$tag is set but IMAGE_REGISTRY is empty: set both to run pulled images, or clear IMAGE_TAG to build here"
    env_set IMAGE_PREFIX hd-
    return 0
  fi
  case "$registry" in
    *[!A-Za-z0-9._:/-]*) die "IMAGE_REGISTRY has characters a registry path cannot have: '$registry'" ;;
  esac
  [ -n "$tag" ] || die "IMAGE_REGISTRY is set, so IMAGE_TAG must name the release to run (for example IMAGE_TAG=2.1.0)"
  [ "$tag" != latest ] || die "IMAGE_TAG=latest is not accepted: name a release, so that an update is a decision and a rollback is possible"
  case "$tag" in
    *[!A-Za-z0-9._-]*) die "IMAGE_TAG has characters an image tag cannot have: '$tag'" ;;
  esac
  env_set IMAGE_PREFIX "$registry/"
}

# Version and commit of the tree being built; passed to the image builds.
build_identity() {
  APP_VERSION=dev; APP_COMMIT=dev
  [ -f VERSION ] && APP_VERSION=$(tr -d '[:space:]' < VERSION)
  if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
    APP_COMMIT=$(git rev-parse --short=12 HEAD)
    [ -z "$(git status --porcelain 2>/dev/null)" ] || APP_COMMIT="$APP_COMMIT.dirty"
  fi
  export APP_VERSION APP_COMMIT
}

# "2.1.0+3f2a9c1d07be" of the backend that runs now; empty when none runs or
# the image predates build identities.
running_build() {
  dc exec -T backend cat /app/build-info.json 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)","commit":"\([^"]*\)".*/\1+\2/p' || true
}
```

`env_set` escapes `&`, `#` and `\` for sed but the replacement delimiter is `#`, and a registry path contains `/` only — safe; the test "pull mode writes the registry prefix" pins it.

Wire it in:
  - `ensure_env`: call `ensure_image_source` right after `ensure_sentry_origin`.
  - `deploy()`: replace the two lines `log "Building images"` / `dc build --pull` with

```bash
  local before; before=$(running_build)
  if [ "$(image_mode)" = pull ]; then
    log "Pulling images: $(env_get IMAGE_PREFIX)*:$(env_get IMAGE_TAG) (running now: ${before:-nothing})"
    # Only the application images: MongoDB is pinned in compose.yml and is not
    # re-pulled by an update. A failed pull stops here, before anything else.
    if [ "$(env_get COMPOSE_PROFILES)" = telegram ]; then
      dc pull backend frontend tg-service
    else
      dc pull backend frontend
    fi
  else
    [ -f backend/Dockerfile ] || die "no source tree here: set IMAGE_REGISTRY and IMAGE_TAG in .env to run pulled images"
    build_identity
    log "Building images: $APP_VERSION+$APP_COMMIT (running now: ${before:-nothing})"
    dc build --pull
  fi
```

  `tag_previous` stays where it is, before this block.
  - In pull mode `up` must never fall back to building. At the top of `deploy()` add
    `local up_flags=(); [ "$(image_mode)" = pull ] && up_flags=(--no-build)` and pass
    `"${up_flags[@]}"` to each of the three `dc up -d --wait …` calls. (`docker compose run`
    has no such flag and does not need one: the image is already pulled. Bash 4.4+ expands an
    empty array safely under `set -u`; Debian and Fedora ship 5.x.)
  - After `smoke_test`, replace the `echo "Application is up: …"` line with:

```bash
  local now; now=$(running_build)
  echo "Application is up: $(env_get APP_PUBLIC_URL)${now:+ — build $now}"
  if [ "$(image_mode)" = pull ] && [ -n "$now" ] && [ "${now%%+*}" != "$(env_get IMAGE_TAG)" ]; then
    echo "note: the image tagged $(env_get IMAGE_TAG) reports version ${now%%+*}"
  fi
```

  - `status)` in the dispatcher becomes `status)   b=$(running_build); echo "build: ${b:-unknown}"; dc ps ;;`
  - Header comment: change the first usage line's description to "…generated secrets, build or pull images, backup, migrate, start" and the `status` line to "build, containers and health".

The spec says to read `/health`; reading `build-info.json` inside the container gives the same two values without depending on the published port or nginx routing.

- [ ] **Step 4: Run the test** → `all passed`. Then `bash -n deploy.sh` and `./check.sh repo` (which now runs the test file as well).

- [ ] **Step 5: `.env.example`.** After the `HTTP_PORT` block add:

```bash
# Where the application images come from. Both empty = they are built on this
# host from the source tree next to deploy.sh. To run released images instead,
# set the registry path and the release; the host then needs only compose.yml,
# deploy.sh and this file (and `docker login` once, if the registry is private).
# "latest" is not accepted as a tag. IMAGE_PREFIX is written by deploy.sh.
IMAGE_REGISTRY=
IMAGE_TAG=
```

- [ ] **Step 6: `docs/deployment.md`.** Add a section "Images" after "`deploy.sh`": the two modes as a table (what the host needs, what an update is: `git pull && ./deploy.sh` versus "change `IMAGE_TAG`, run `./deploy.sh`"), the build identity and where it shows (`/health`, `./deploy.sh status`, the banner in open tabs), and the note that MongoDB is never pulled by an update. Add the three keys to the configuration table. In "Rollback" add: "Pulled images: set `IMAGE_TAG` back to the previous release and run `./deploy.sh`." Add `./check.sh` to "Layout".

- [ ] **Step 7: End-to-end in pull mode, without any registry service of ours** (sandbox off; everything under throw-away names, and nothing may touch the volumes or containers of the `hd` project on this machine).

```bash
docker run -d --name w3a-registry -p 127.0.0.1:5055:5000 registry:2
for s in backend frontend tg-service; do
  docker build -q --target prod --build-context root=. --build-arg APP_VERSION=2.1.0 --build-arg APP_COMMIT=e2etest \
    -t 127.0.0.1:5055/hd/$s:2.1.0 $s && docker push -q 127.0.0.1:5055/hd/$s:2.1.0
  docker image rm 127.0.0.1:5055/hd/$s:2.1.0
done
```

Then in an empty scratch directory outside the repository copy only `compose.yml`, `deploy.sh`, `.env.example`. `deploy.sh` uses the fixed project name `hd` and fixed volume names, so on the owner's workstation this would collide with the dev stack: for the test only, run it with a scratch copy in which `name: hd` and the four volume names are replaced by `hdw3a…` (`sed` on the copy, never on the repository files), `HTTP_PORT=127.0.0.1:18080`, `MONGO_PORT=127.0.0.1:27018`, and answers supplied through the environment the script reads (`APP_PUBLIC_URL`, `BOOTSTRAP_ADMIN_EMAIL=admin@example.com` pre-written into `.env`, `IMAGE_REGISTRY=127.0.0.1:5055/hd`, `IMAGE_TAG=2.1.0`).
Expected: images are pulled, MongoDB starts, the smoke test passes, the last lines contain `build 2.1.0+e2etest`; `./deploy.sh status` prints `build: 2.1.0+e2etest`. Then set `IMAGE_TAG=9.9.9` and run again → stops at the pull with the stack still answering on 18080.
Clean up: `docker compose -p hdw3a… down -v`, remove the scratch volumes, images and the `w3a-registry` container; confirm with `docker ps -a` and `docker volume ls` that the `hd_*` volumes of the real stack are untouched (list them before and after).

If this machine cannot run the scenario (ports, disk), report exactly which commands were not run instead of marking the step done.

- [ ] **Step 8: Checkpoint.** Test file output, `./check.sh repo`, and the transcript summary of Step 7.

---

### Task 7: The production-copy script moves to `ops/`

**Files:**
- Create: `ops/README.md`, `ops/sync.env.example`, untracked `ops/sync.env` (owner's values, never reported)
- Move: `sync-dev-db.sh` → `ops/sync-dev-db.sh`
- Modify: `.gitignore`, `README.md`, `docs/deployment.md`, `docs/messaging.md:477`, `tg-service/README.md:27`, `compose.yml:38`, `compose.dev.yml:2,13`, `.env.example:45`, `backend/models/channel.js:13`, `backend/scripts/repoBrand.test.js`

**Interfaces:**
- Produces: `ops/sync-dev-db.sh [--raw] [existing options]`; configuration keys in `ops/sync.env`: `PROD_SSH`, `PROD_SSH_JUMP`, `DEV_MONGO_HOST`, `DEV_PASSWORD`; an exclusion list that also holds the credential collections. The masking call itself is wired in Task 8.

- [ ] **Step 1: Save the owner's values first.** Before editing, read the defaults of `PROD_SSH`, `PROD_SSH_JUMP` and `DEV_MONGO_HOST` from the current script and write them, with `DEV_PASSWORD=` left empty, into `ops/sync.env` **in the main checkout** (`/home/aleksey/projects/hd/ops/sync.env`, mode 600) — it is untracked, so a worktree would lose it. Do not echo the values anywhere.

- [ ] **Step 2: Move and reconfigure.** `git mv` is not allowed (it stages); move with `mv sync-dev-db.sh ops/sync-dev-db.sh` and let the owner's `git add -A` record the rename. In the script:
  - `cd "$(dirname "$0")"` becomes `cd "$(dirname "$(readlink -f "$0")")/.."` (it works from the repository root, where `.env` and `compose*.yml` are).
  - Replace the header's first lines with: `# Internal tooling of the operator — not part of the product, never in an image.`
  - After `set -euo pipefail` and the `cd`, load the configuration:

```bash
SYNC_ENV="${SYNC_ENV:-ops/sync.env}"
if [ -f "$SYNC_ENV" ]; then
  set -a; . "$SYNC_ENV"; set +a
fi
```

  - The three defaults lose their values: `PROD_SSH="${PROD_SSH:-}"`, `PROD_SSH_JUMP="${PROD_SSH_JUMP:-}"`, `DEV_MONGO_HOST="${DEV_MONGO_HOST:-127.0.0.1}"`.
  - After option parsing: `[ -n "$PROD_SSH" ] || { log_error "PROD_SSH is not set. Copy ops/sync.env.example to ops/sync.env and fill it in."; exit 1; }`. Where the jump host is used, skip it when `PROD_SSH_JUMP` is empty.
  - Go through the rest of the file and remove every remaining literal host name, user name, IP address, container name that carries the old brand, and every example in `show_help` that shows one. `node --test backend/scripts/repoBrand.test.js` is the check.

- [ ] **Step 3: Never copy credentials.** Find the real collection names — do not guess the pluralisation:
`grep -n "modelName" backend/auth/instance.mjs` (sessions, verifications) and, in the dev database, `docker compose exec -T mongodb mongosh --quiet -u … --eval 'db.getCollectionNames().filter(n => /mcp|download|verif|session/i.test(n))'` for the MCP keys and Mikrotik download codes.
Extend the list with them:

```bash
# Never synced, part one: dev settings stay as they are; prod channels and the
# prod outbox would make the dev backend act as production.
# Part two: live credentials — sessions, one-time tokens (magic links, password
# resets), MCP keys, firmware download codes. A copy must not be able to act as
# a signed-in person or an agent of the source installation.
EXCLUDE_COLLECTIONS=(preferences channels channeljobs authSessions authVerifications <mcp keys> <download codes>)
```

with the two bracketed names replaced by what the lookup printed. The drop step on the dev side keeps only `preferences channels channeljobs` (the dev's own): the credential collections of the **dev** database must be emptied, not preserved. Split the array into `KEEP_LOCAL=(preferences channels channeljobs)` and `NEVER_COPIED=(…)`; `--excludeCollection`/`--nsExclude` use both, the "kept" set in the drop snippet and the before/after count check use only `KEEP_LOCAL`.

- [ ] **Step 4: `--raw` and the mode banner.** Add the option (default `MODE=masked`). In `--raw` mode ask for a typed confirmation unless `--yes` is given:

```bash
if [ "$MODE" = raw ] && [ "$ASSUME_YES" != true ]; then
  log_warning "Raw copy: names, e-mail addresses, phones and password hashes are copied as they are."
  log_warning "Use it only for an installation whose data is your own."
  read -r -p "Type RAW to continue: " answer
  [ "$answer" = RAW ] || { log_error "Cancelled."; exit 1; }
fi
```

(use the script's existing name for its `--yes` variable). Print the mode in the summary block next to "Not synced". In masked mode require `DEV_PASSWORD` to be non-empty before anything is dumped: `log_error "DEV_PASSWORD is not set in ops/sync.env: a masked copy signs everyone in with it."`. The call to the masking script is added in Task 8; leave a clearly named function `mask_dev_copy() { :; }` invoked after the restore in masked mode, so Task 8 only fills it.

- [ ] **Step 5: `ops/sync.env.example`**

```bash
# Configuration of ops/sync-dev-db.sh. Copy to ops/sync.env (ignored by git).

# SSH target of the source installation: user@host
PROD_SSH=
# Optional jump host (user@host), used when the source is not reachable directly
PROD_SSH_JUMP=
# Where the target MongoDB is published
DEV_MONGO_HOST=127.0.0.1
# Masked copies: every account signs in with this password
DEV_PASSWORD=
```

`.gitignore`: add `ops/sync.env`.

- [ ] **Step 6: `ops/README.md`** (English): what `ops/` is (internal tooling, excluded from images, not for customers); how to run the copy on a workstation and on a test host (move the "Filling a test host with production data" text here from `docs/deployment.md`, without any address); the two modes; the list of what is never copied; and the stated limit, verbatim from the spec: masking covers identity fields; free text (tickets, comments, messages, work descriptions) and device records are copied as they are, so a masked copy is pseudonymised, not anonymous.

- [ ] **Step 7: Update references.** README: the layout line becomes `├── ops/              # internal tooling (copy production into dev) — see ops/README.md`; "Copy the production database" shrinks to two lines pointing to `ops/README.md`. `docs/deployment.md`: remove the "Filling a test host…" section (moved). In the other listed files replace `sync-dev-db.sh` with `ops/sync-dev-db.sh` in comments. `backend/scripts/repoBrand.test.js`: `ALLOWED` becomes `[]` — keep the constant and its doc comment.

- [ ] **Step 8: Verify.**
  - `bash -n ops/sync-dev-db.sh`; `node --test backend/scripts/repoBrand.test.js` → pass with the empty allow-list.
  - `SYNC_ENV=/nonexistent PROD_SSH= ops/sync-dev-db.sh --yes` → stops with the `PROD_SSH is not set` message, exit 1, before any network call.
  - `ops/sync-dev-db.sh --help` → shows `--raw`, no host names.
  - `grep -rn "sync-dev-db" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=superpowers --exclude-dir=.superpowers --exclude-dir=.pnpm-store | grep -v "ops/sync-dev-db"` → nothing.
  - Do **not** run a real sync in this task: it rewrites the owner's dev database. That run is the owner's, after Task 8.

- [ ] **Step 9: Checkpoint.** Report the collection names found in Step 3 and the four verification results.

---

### Task 8: Masking a restored copy

**Files:**
- Create: `backend/scripts/dev/maskData.js`, `backend/scripts/dev/maskData.test.js`
- Modify: `ops/sync-dev-db.sh` (`mask_dev_copy`), `ops/README.md`

**Interfaces:**
- Consumes: `mask_dev_copy` hook and `DEV_PASSWORD` from Task 7; `scripts/dev` is excluded from the image (Task 5).
- Produces: `node scripts/dev/maskData.js [--report]` run inside the dev backend container; pure exports `maskedUser(doc)`, `maskedCompany(doc)`, `maskedPerson(id, isEndUser)`, `assertSafeTarget(env, dbName)`.

- [ ] **Step 1: Map the fields.** Before writing code, list every place a person's or a company's identity is stored:

```bash
cd backend && grep -rnE "(firstName|lastName|email|phone|chatId|fullTitle|alias|address|inn|kpp|ogrn)\b *:" models --include=*.js --include=*.ts | grep -v test
```

Classify each hit as (a) a field of `users`, (b) a field of `companies`, (c) an embedded snapshot of a person or company inside another document (the audit notes denormalised snapshots in tickets and works; `models/company.js` embeds people in `users`, `employees`, `responsibles`, `clientsSideResponsibles`), or (d) free text / not identity. Write the (a)–(c) list as the `SNAPSHOTS` table in the script (Step 3). Collections that hold only messenger identities (`models/channelIdentity.js`) are emptied in masked mode.

- [ ] **Step 2: Write the failing test** — `backend/scripts/dev/maskData.test.js`

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { maskedPerson, maskedUser, maskedCompany, assertSafeTarget } = require("./maskData");

const ID = "64f1a2b3c4d5e6f708192a3b";

test("a person is derived from the id alone and is stable", () => {
  const first = maskedPerson(ID, false);
  assert.deepEqual(maskedPerson(ID, false), first);
  assert.equal(first.email, `u${ID}@example.com`);
  assert.match(first.phone, /^7900\d{7}$/);
  assert.equal(first.firstName, "Сотрудник");
  assert.match(first.lastName, /^[0-9A-F]{6}$/);
  assert.equal(maskedPerson(ID, true).firstName, "Клиент");
});

test("different ids give different e-mails and phones", () => {
  const other = maskedPerson("64f1a2b3c4d5e6f708192a3c", false);
  assert.notEqual(other.email, maskedPerson(ID, false).email);
  assert.notEqual(other.phone, maskedPerson(ID, false).phone);
});

test("a user update rewrites identity and removes secrets", () => {
  const update = maskedUser({ _id: ID, isEndUser: true, email: "real@corp.test", phone: "74951234567" });
  assert.equal(update.$set.email, `u${ID}@example.com`);
  assert.equal(update.$set.firstName, "Клиент");
  assert.equal(update.$set["telegramBot.isActive"], false);
  assert.equal(update.$set["telegramBot.chatId"], "");
  for (const field of ["password", "verifyToken", "resetToken", "profileImagePath", "backgroundImagePath", "activeDirectoryObjectGUID"]) {
    assert.ok(field in update.$unset, field);
  }
  assert.ok(!JSON.stringify(update).includes("real@corp.test"));
});

test("masking twice gives the same result", () => {
  const once = maskedUser({ _id: ID, isEndUser: false });
  const twice = maskedUser({ _id: ID, isEndUser: false, ...once.$set });
  assert.deepEqual(twice, once);
});

test("a company keeps its shape and loses its identity and keys", () => {
  const update = maskedCompany({ _id: ID, alias: "Настоящая", fullTitle: "ООО Настоящая", phones: ["74951234567", "74957654321"], emailDomains: ["corp.test"] });
  assert.match(update.$set.alias, /^Компания [0-9A-F]{6}$/);
  assert.equal(update.$set.fullTitle, `ООО «${update.$set.alias}»`);
  assert.equal(update.$set.phones.length, 2);
  assert.ok(update.$set.phones.every((phone) => /^7900\d{7}$/.test(phone)));
  assert.deepEqual(update.$set.emailDomains, []);
  assert.deepEqual(update.$set.apiKeys, []);
  assert.ok(!JSON.stringify(update).includes("Настоящая"));
});

test("it refuses anything that is not the local dev database", () => {
  const env = { NODE_ENV: "development", MONGODB_DATABASE: "hd-dev" };
  assert.doesNotThrow(() => assertSafeTarget(env, "hd-dev"));
  assert.throws(() => assertSafeTarget({ ...env, NODE_ENV: "production" }, "hd-dev"), /production/);
  assert.throws(() => assertSafeTarget(env, "hd-prod"), /hd-prod/);
  assert.throws(() => assertSafeTarget({ NODE_ENV: "development" }, "hd-dev"), /MONGODB_DATABASE/);
  assert.throws(() => assertSafeTarget({ ...env, NODE_ENV: undefined }, "hd-dev"), /NODE_ENV/);
});
```

Run: `ulimit -c 0 && node --test scripts/dev/maskData.test.js` → FAIL, module not found.

- [ ] **Step 3: Implement** — `backend/scripts/dev/maskData.js`. The pure part:

```js
/**
 * Обезличивание копии базы после ops/sync-dev-db.sh. Только для разработки:
 * в образ продукта не входит (backend/.dockerignore), на рабочей базе
 * запускаться отказывается.
 *
 * Меняются поля, по которым человека или компанию можно узнать, и всё, чем
 * можно войти. Свободный текст (заявки, комментарии, сообщения) не трогается —
 * копия псевдонимизирована, а не анонимна; см. ops/README.md.
 *
 * Запуск (в dev-контейнере backend):  node scripts/dev/maskData.js [--report]
 */
const hex6 = (id) => String(id).slice(-6).toUpperCase();

// Телефон из идентификатора: 7 900 + семь цифр. Счётчик ObjectId — последние
// три байта, поэтому у соседних документов номера разные.
const phoneOf = (id, salt = 0) =>
  `7900${String((parseInt(String(id).slice(-6), 16) + salt * 7919) % 10_000_000).padStart(7, "0")}`;

const maskedPerson = (id, isEndUser) => ({
  email: `u${String(id)}@example.com`,
  phone: phoneOf(id),
  firstName: isEndUser ? "Клиент" : "Сотрудник",
  lastName: hex6(id),
});

const maskedUser = (doc) => ({
  $set: {
    ...maskedPerson(doc._id, doc.isEndUser === true),
    "telegramBot.isActive": false,
    "telegramBot.chatId": "",
    "telegramBot.linkedAt": null,
    twoFactorEnabled: false,
  },
  $unset: {
    password: "",
    verifyToken: "",
    verifyTokenExpiration: "",
    resetToken: "",
    resetTokenExpiration: "",
    profileImagePath: "",
    backgroundImagePath: "",
    activeDirectoryObjectGUID: "",
  },
});

const maskedCompany = (doc) => {
  const alias = `Компания ${hex6(doc._id)}`;
  return {
    $set: {
      alias,
      fullTitle: `ООО «${alias}»`,
      phones: (doc.phones || []).map((_, index) => phoneOf(doc._id, index + 1)),
      emailDomains: [],
      apiKeys: [],
      address: "",
      linkToMap: "",
    },
    $unset: { profileImagePath: "", location: "" },
  };
};

const assertSafeTarget = (env, dbName) => {
  if (!env.NODE_ENV) throw new Error("NODE_ENV не задан: скрипт работает только в dev-контейнере");
  if (env.NODE_ENV === "production") throw new Error("Отказ: NODE_ENV=production");
  if (!env.MONGODB_DATABASE) throw new Error("MONGODB_DATABASE не задан");
  if (dbName !== env.MONGODB_DATABASE) {
    throw new Error(`Отказ: подключение к базе ${dbName}, а локальная — ${env.MONGODB_DATABASE}`);
  }
};

module.exports = { maskedPerson, maskedUser, maskedCompany, assertSafeTarget, phoneOf, hex6 };
```

Emptying `emailDomains` is deliberate: a real domain identifies the client, and a fake one would start routing inbound mail by domain in dev. If Step 1 found further identity fields on `users` or `companies` (tax ids, legal address, contact names), add them to the matching function and extend the test's "shape" assertions in the same step.

The runner, in the same file under `if (require.main === module)`:
  1. Connect the way the other scripts in `backend/scripts/` do (read two of them and reuse their connection helper; do not invent a second one). Call `assertSafeTarget(process.env, mongoose.connection.db.databaseName)` before the first write.
  2. Require `process.env.DEV_PASSWORD`; exit 1 with a message when empty.
  3. `users`: stream `{}` with `_id` and `isEndUser`, `bulkWrite` in batches of 500 with `maskedUser` — through the native driver (`mongoose.connection.db.collection("users")`), because the Mongoose schema would re-apply setters and validators.
  4. `companies`: the same with `maskedCompany`.
  5. Snapshots: for each entry of the `SNAPSHOTS` table from Step 1 — `{ collection, path, idField, kind: "person" | "company" }` — rewrite the embedded name/e-mail/phone/title fields from the referenced id with the same `maskedPerson` / alias functions, so a ticket's applicant shows the same masked name as the user record. A snapshot without a usable id gets the constant `Клиент` / `000000`.
  6. Credentials: delete every document of the two-factor collection (`authTwoFactors`) and of the messenger-identity collection; set the `password` of every `authAccounts` document whose `providerId` is `"credential"` to `bcrypt.hashSync(DEV_PASSWORD, 10)` using the `bcryptjs` dependency the backend already has. Confirm in `backend/auth/instance.mjs` (`verifyWithLegacyBcrypt`) that a bcrypt hash is accepted at sign-in; if it is not, hash with the helper that module uses for new passwords instead.
  7. `--report`: before step 3, collect the original e-mails and phones of `users` into memory; after step 6, scan every collection and print `collection.fieldPath: count` for each field path whose string value still contains one of them. This is how a missed snapshot shows up. Free-text paths are expected in the report; structured ones are bugs to fix in `SNAPSHOTS`.
  8. Print a summary: counts per collection, and the reminder that free text is not masked.

- [ ] **Step 4: Run the unit test** → 6 passing. Also `npx eslint scripts/dev`.

- [ ] **Step 5: Wire into the sync script.** Fill `mask_dev_copy` in `ops/sync-dev-db.sh`:

```bash
# Pseudonymise the restored copy inside the dev backend container, where the
# sources are bind-mounted and the database is reachable by its service name.
mask_dev_copy() {
  log_info "Masking identities and credentials in '$DEV_DB'..."
  docker compose run --rm -T -e DEV_PASSWORD="$DEV_PASSWORD" backend \
    node scripts/dev/maskData.js \
    || { log_error "Masking failed: the copy in '$DEV_DB' still holds real data. Re-run, or drop the database."; exit 1; }
}
```

It runs after the restore and before the script's final success message, in masked mode only. On a test host installed with `deploy.sh` there is no dev container and no `scripts/dev` in the image: detect it (`[ -f backend/scripts/dev/maskData.js ] && docker compose config --services 2>/dev/null | grep -qx backend` with the dev compose file active) and, when masking is not possible, refuse a masked run **before** dumping with: "A masked copy needs the development stack. On a host installed with deploy.sh use --raw, and only for your own data."

- [ ] **Step 6: Dry run on a scratch database, not the dev one.** In the dev stack: copy 50 users and 10 companies into a database named `hd-mask-test` (`mongosh`: `db.getSiblingDB("<dev>").users.find().limit(50).forEach(d => db.getSiblingDB("hd-mask-test").users.insertOne(d))`, same for companies and for a few tickets that reference those users), then run the script with `MONGODB_DATABASE=hd-mask-test` set for that one `docker compose run` and `--report`.
Expected: the summary counts match; `db.users.countDocuments({ email: { $not: /@example\.com$/ } })` is 0; the report lists no structured field path; a second run changes nothing (`db.users.find().sort({_id:1}).limit(5)` identical before and after). Then drop `hd-mask-test` — by name, after checking the name (`db.getSiblingDB("hd-mask-test").dropDatabase()`), and nothing else.
Also: `docker compose run --rm -e NODE_ENV=production backend node scripts/dev/maskData.js` → refuses, writes nothing.

- [ ] **Step 7: `ops/README.md`.** Add the field classes that are masked, the sign-in rule (any account, `DEV_PASSWORD`), what `--report` is for, and the test-host limitation from Step 5.

- [ ] **Step 8: Checkpoint.** Unit test output, the Step 6 numbers, the final `SNAPSHOTS` table. The first real masked sync is the owner's to run.

---

### Task 9: Neutral fixtures (H7)

**Files:**
- Modify: `frontend/src/components/Report/SignatureRoute.tsx`, `backend/validations/company.test.js`, `docs/ux-ui-guide.md`, `backend/services/staffContacts.test.js`, `backend/services/mapLink.test.js`, the files that carry the repeated fixture phone, `backend/routes/mcp.test.js` and others the scan finds
- Create: nothing tracked

**Interfaces:**
- Produces: a tree in which no tracked file names a real client, person, phone line or address of the source installation.

- [ ] **Step 1: Known sites.** Read each of the files the audit names (H7 in `docs/superpowers/specs/2026-09-30-productization-audit.md`) and replace real names with neutral ones: companies `ООО «Ромашка»`, `ООО «Василёк»`, `ИП Иванов`; people `Иванова Анна`, `Петров Пётр`; e-mail `name@example.com`; phones `+7 900 000-00-01`, `-02`, … in whatever format the fixture uses (canonical digits: `79000000001`); map links — a syntactically valid link of the same provider to a neutral point (keep the shape the parser is being tested on: same host, same parameter names, coordinates changed to round values such as `55.75,37.61`). Where an expected value is derived from the fixture (a parsed coordinate, a formatted phone), change the expectation with it.

- [ ] **Step 2: The repeated phone.** Find it: `git ls-files | xargs grep -ohE "\+?[78][ (-]*[0-9]{3}[ )-]*[0-9]{3}[ -]*[0-9]{2}[ -]*[0-9]{2}" 2>/dev/null | tr -d ' ()-' | sort | uniq -c | sort -rn | head -20`. A number that is not in the `7900000…` range and repeats is a candidate; replace it everywhere with one neutral number in a single pass, keeping each site's formatting.

- [ ] **Step 3: Scan against the real names.** Write a throw-away script **in the scratchpad directory, not in the repository**: it reads from the local dev database (through `docker compose exec mongodb mongosh --quiet --eval …`) the company aliases and full titles, the surnames of users, all phones and all e-mail domains; then for each value of at least 5 characters greps the tracked files (`git ls-files`, minus `docs/superpowers/`, `.superpowers/`, lockfiles) case-insensitively and prints `file:line` — **never the matched value itself in a report**. Skip the scan and say so if the local database is already a masked copy. Review each hit: a real name is replaced as in Step 1; a coincidence with a common word («Альфа», «Сервис») is left.
Delete the script and its output when done.

- [ ] **Step 4: Run the tests of every file you changed** (per file, `ulimit -c 0`), then `./check.sh backend frontend`.

- [ ] **Step 5: Checkpoint.** Report counts only: files changed, sites replaced, hits judged coincidental. No names, numbers or addresses in the report.

---

### Task 10: Wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-productization-audit.md` (status notes), `docs/deployment.md` (final read-through), `README.md`

- [ ] **Step 1: Full gate.** `./check.sh` and `./check.sh images` on the finished tree → both exit 0. Paste the last line of each into the report.

- [ ] **Step 2: Audit status.** Under §3.1 add a note in the style of the one under §2.1: O2 closed; O1 partly (build identity, `/health`, image-or-build in `deploy.sh`, changelog — registry and pipeline remain for W3b); O12 partly (one gate command, lint/typecheck/tests green, husky removed — the pipeline itself, coverage and the large files remain); H7 closed; L3 closed for the product repository with the stated masking limit. In the roadmap table mark W3 as "W3a done, W3b after GitLab".

- [ ] **Step 3: Docs read-through.** Read `README.md` and `docs/deployment.md` top to bottom once: every command shown must exist (`./check.sh`, `ops/sync-dev-db.sh`), no section may still describe `sync-dev-db.sh` at the root, husky, or `package.json` as the version.

- [ ] **Step 4: Leftovers.** Remove scratch images (`hd-ci:local` may stay; `hd-check-*`, `hd-w3a-*`, the test registry and its volumes must be gone), the worktree's copied `.env`, and any `node_modules` symlinks. `git status --short` in the worktree shows only intended changes.

- [ ] **Step 5: Hand-over notes for the owner** (in the final report, not a file): what to do on the workstation after applying (`ops/sync.env` exists with their values and an empty `DEV_PASSWORD`; the old `./sync-dev-db.sh` is now `ops/sync-dev-db.sh --raw`); that production needs nothing new in `.env`; that the first deploy from this tree makes open tabs show «Доступна новая версия»; and the list of things not verified here (browser check of the banner; a real sync run; anything from Task 6 Step 7 that could not run).
