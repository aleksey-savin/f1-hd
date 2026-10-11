# W3a — Release readiness (platform-independent half of W3)

Date: 2026-10-11 · Status: approved by the owner 2026-10-11
Source: `2026-09-30-productization-audit.md`, findings O1, O2, O12, H7, L3.

## Context

W3 "Release engineering" turns the product from "clone the repo and build on the host" into
"versioned images from a registry, with CI as the only path to a release". The owner is moving
from GitHub to a self-hosted GitLab that does not exist yet, so W3 is split:

- **W3a (this spec)** — everything that does not depend on where CI and the registry live.
- **W3b (later, after GitLab is up)** — `.gitlab-ci.yml`, publishing images, release notes from
  tags, moving the owner's production to pulled images, a migration dry-run on a prod-shaped
  dump, base-image pinning by digest.

W3a is done when W3b is reduced to "call `ci/run.sh` from a pipeline and push what
`docker compose build` produces".

## Owner's decisions (2026-10-11)

1. Self-hosted sales: **later**. Images and a LICENSE now; no licence enforcement, no EULA, no
   customer install kit.
2. CI and registry: self-hosted GitLab, later (W3b). Nothing in W3a may assume GitHub.
3. The owner's production stays on build-on-host until W3b.
4. Internal materials (`docs/superpowers`, host notes) stay in the repository and must not get
   into images.

## Goals

1. A build has an identity (version + commit) that the backend, the frontend and the Telegram
   service all report, and the "new version" banner works.
2. One command runs every quality gate, in a container, and is green.
3. Images contain the product and nothing else; the repository contains no infrastructure of
   the previous owner.
4. `deploy.sh` can run an installation from pulled images with no source tree on the host.
5. The product is no longer labelled open source.

## Non-goals

- Any pipeline file, registry, or GitHub/GitLab specific configuration (W3b).
- Switching the owner's production to pulled images (W3b).
- EULA, terms of service, privacy texts (W6), licence enforcement (L10).
- Pinning base images by digest. Once images are built once in CI and shipped by tag, hosts stop
  rebuilding and the drift O1 describes disappears; until then `--pull` keeps security patches
  flowing.
- Widening backend `tsc` beyond `models/` and `types/` (that is the TS migration's pace).
- Lint for `tg-service` (28 files under strict `tsc`; no config exists today).
- Splitting the six 1,500+ line files, raising test coverage (O12 lists them; separate work).
- Showing the version anywhere in the UI. No UI changes at all, hence no mockup.

---

## D1. Licence

- `LICENSE` at the repository root: a short proprietary "all rights reserved" notice, Russian
  text first, English below. It names the rights holder and the year and forbids copying,
  modification and redistribution without a written agreement.
- All three `package.json`: `"license": "UNLICENSED"`, `"private": true`.
- `LICENSE` is copied into each production image at `/LICENSE`. The build contexts are the
  service directories and the file lives at the root, so `compose.yml` gives each build a
  second, named context (`additional_contexts: { root: . }`) and the Dockerfiles use
  `COPY --from=root LICENSE /LICENSE`. In pull mode (D6) nothing is built, so the root is not
  needed on the host.
- README gets one line: proprietary software, see `LICENSE`.

Rights holder: Общество с ограниченной ответственностью «Ф1», year 2026.

## D2. Version and build identity

**Source of truth:** a root file `VERSION` holding one semver line. W3a sets it to `2.1.0`.
`package.json` `version` fields become `0.0.0` in all three services so that nothing can read a
stale number from them; no code may read `package.json` for the version (checked by D3 `repo`).

**Build identity** = `version` + `commit`:

| | version | commit |
|---|---|---|
| `deploy.sh` build | contents of `VERSION` | `git rev-parse --short=12 HEAD`, plus `.dirty` when the tree has changes |
| dev stack (`compose.dev.yml`) | `dev` | `dev` |
| W3b pipeline | the tag, must equal `VERSION` | pipeline commit |

`id` is `version+commit` (for example `2.1.0+3f2a9c1d07be`); in dev it is `dev`.

**How it gets into the images.** Build arguments `APP_VERSION` and `APP_COMMIT` (defaults
`dev`), declared in `compose.yml` under each service's `build.args` from the environment of the
calling process. They are deliberately **not** runtime environment variables: the backend gets
the whole `.env` through `env_file`, and a stray key there would override an image `ENV`.

- backend, tg-service: the `prod` stage writes `/app/build-info.json`
  (`{"version": "...", "commit": "..."}`) as its last layer, so the dependency layers stay
  cached. A module `utils/buildInfo.js` (backend) / `src/buildInfo.ts` (tg-service) reads the
  file once and returns `{ version, commit, id }`; a missing file means `dev`.
- frontend: the `build` stage exposes the two arguments to `vite build`;
  `vite.config.js` defines `import.meta.env.VITE_VERSION` as the `id` (the existing name is
  kept, the `package.json` read is removed).
- All three images get OCI labels `org.opencontainers.image.version` and `.revision`.

**Consumers.**

- `GET /health` (backend): `version`, `commit` from `buildInfo` — replaces
  `npm_package_version || '1.0.0'`. Nothing else in the payload changes.
- `GET /api/app-version` and the pulse's `appVersion`: return `id`.
- tg-service `/health`: adds `version`, `commit`.
- The banner in `layout/Root.jsx` already compares `appVersion` with `VITE_VERSION` for
  inequality; with `id` on both sides it fires after every deploy of a different build and
  never in dev. No change to the component.
- `./deploy.sh status` prints the running build id before `docker compose ps`.

## D3. Quality gates: one command

Two files:

- `ci/run.sh <part>…` — the checks themselves. Runs in any environment that has Node 24, pnpm
  (via corepack) and git. This is what a W3b pipeline job calls.
- `check.sh [part…]` — the local wrapper. Builds a small image from `ci/Dockerfile`
  (`node:24-alpine` + git + bash + corepack), mounts the repository **read-only**, copies the
  tracked and untracked-not-ignored files into the container's own filesystem, and runs
  `ci/run.sh` there. Nothing is written back to the host. The pnpm store is a named volume
  (`hd_ci_pnpm_store`) so repeated runs do not re-download. Core dumps are disabled
  (`ulimit -c 0`).

Parts (no argument = all four source parts, in this order; the first failure stops the run and
the exit code is non-zero):

| Part | Steps |
|---|---|
| `repo` | `VERSION` is one valid semver line · `CHANGELOG.md` has a heading for it · no `package-lock.json` / `yarn.lock` tracked · no source file reads `package.json` version · `bash -n` on every tracked `*.sh` |
| `backend` | `pnpm install --frozen-lockfile` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm audit --prod --audit-level high` |
| `frontend` | install · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · audit |
| `tg-service` | install · `pnpm typecheck` · `pnpm test` · audit |
| `images` (wrapper only, needs Docker) | `docker compose build` of the three production images with a test identity · image content assertions (D4) · each image reports that identity |

What has to change so that the command is green:

- **Backend lint.** `eslint.config.mjs` uses legacy `extends` strings under the flat config and
  fails before linting a single file. It is replaced by a flat config with
  `@eslint/js` recommended rules, CommonJS for `*.js`/`*.cjs`, ESM for `*.mjs`, Node globals;
  `*.ts` files are not linted (they are type-checked). A probe with exactly this rule set gives
  70 errors in 669 files (53 unused variables, 4 undefined names, 13 others) — all are fixed,
  none disabled wholesale. The four dead plugins (`node`, `import`, `security`, `promise`)
  leave `devDependencies`. New script `"lint": "eslint ."`.
- **Backend tests.** The `test` script lists seven directories and silently skips `models/`,
  `prompts/`, `scripts/` and `utils/` (8 files, including the brand guard). It becomes one glob
  over every `*.test.js` outside `node_modules`. The three known failures are stale
  expectations after `mikrotik.approveChanges` was added (`auth/access.test.js` ×2,
  `routes/mcp.test.js` ×1); the expectations are corrected.
- **The full backend suite has never passed in one run.** On the desktop it crashes node six
  times. The first containerised run is a triage step: a crash is a gate failure and gets a
  root cause, not a retry or a skip.
- **Frontend typecheck.** The one error in `components/app/FormWrapper.tsx:100` is fixed.
- **Frontend tests.** 44 `node:test` files exist and no script runs them. New script
  `"test": "node --test \"src/**/*.test.js\""`.
- **Audit.** Findings of level high or critical in production dependencies are fixed by
  upgrading. An advisory that cannot be fixed is listed in that package's
  `pnpm.auditConfig.ignoreGhsas` with a one-line reason in `docs/deployment.md`.
- **Husky is removed** (`devDependency`, the `prepare` script, `.gitignore` entry, the
  Dockerfile comment about `--ignore-scripts`). Its hook ran the whole backend suite with `npm`
  on every commit and was gitignored, so nobody else ever had it. The gate is `check.sh`.
- Dead backend scripts go: `precommit`, `security` (both call `npm`), `test:workplace` (its
  file does not exist).

README's "Per-service scripts" block is updated and gains `./check.sh`.

## D4. Repository and image hygiene

**Repository.**

- Delete `backend/package-lock.json` and `frontend/build.err`; add `package-lock.json`,
  `yarn.lock` and `*.err` to `.gitignore`.
- Fixtures and comments that name real clients, people or phone lines are replaced with
  neutral ones (`ООО «Ромашка»`, `user@example.com`, `+7 900 000-00-0N`). Known sites from the
  audit: `components/Report/SignatureRoute.tsx`, `validations/company.test.js`,
  `docs/ux-ui-guide.md`, `services/staffContacts.test.js`, `services/mapLink.test.js`, and the
  fixture phone that appears about 70 times.
- To find the rest, a one-off scan compares the tracked tree with the names actually present
  in the local database copy (company titles, people's surnames, phones, e-mail domains). The
  scan script is throwaway and is not committed; its hit list is. A permanent guard for client
  names is not possible without putting the names in the repository.
- `backend/scripts/repoBrand.test.js`: the `ALLOWED` list becomes empty (see D5).

**Images.**

- `backend/.dockerignore` adds `.claude`, `.pnpm-store`, `.husky`, `eslint.config.mjs`,
  `package-lock.json`, `*.md`, `scripts/dev/` (D5). The same review for `frontend` and
  `tg-service`.
- The `images` part of `check.sh` lists every file in each production image and fails on a
  match with `ci/image-denylist.txt`: test files, `.env*`, `.git`, `.claude`, `.superpowers`,
  `docs/`, `ops/`, `*.md`, lockfiles other than `pnpm-lock.yaml`, `*.map`, `node_modules/.cache`,
  and in the frontend image anything outside the built `dist` and the nginx template.
- The same part fails when any file in an image matches the old-brand pattern of the guard.

## D5. The production-copy script (H7, L3)

`sync-dev-db.sh` is the last file with the previous owner's hosts in it and it copies
everything, including live sessions and reset tokens.

- It moves to `ops/sync-dev-db.sh`. `ops/` is internal tooling: never in an image, documented
  in `ops/README.md`, not mentioned in the customer-facing part of `docs/deployment.md`.
- No host, user or address stays in the file. They come from `ops/sync.env` (gitignored);
  `ops/sync.env.example` lists the keys with empty values. Without `PROD_SSH` the script stops
  with a message that names the file. The owner's current values are written to a local,
  untracked `ops/sync.env` during implementation so the workflow keeps working.
- **Never copied, in any mode:** sessions, verification tokens (magic links, password resets),
  MCP keys, Mikrotik download codes — added to the existing exclusion list
  (`preferences`, `channels`, `channeljobs`).
- **Default mode is masked.** After the restore the script runs
  `backend/scripts/dev/maskData.js` in the dev backend container. It rewrites, deterministically
  by `_id`:
  - people: names, e-mail, phones, messenger ids, avatars;
  - companies: titles, legal names, tax ids, addresses, contact fields;
  - credentials: password hashes are replaced with the hash of `DEV_PASSWORD` from
    `ops/sync.env`, two-factor secrets are removed.
  It refuses to run when `NODE_ENV=production` or when the database name is not the one in the
  local `.env`. It is excluded from the production image.
- **`--raw`** copies identities and password hashes as they are, after a typed confirmation.
  It exists for the owner's own instance, where the data is the owner's own.
- Stated limit, written into `ops/README.md`: masking covers identity fields. Free text
  (tickets, comments, messages, work descriptions) and device records are copied as they are,
  so a masked copy is pseudonymised, not anonymous. A stricter policy belongs to W6.
- References are updated: README, `docs/deployment.md` ("Filling a test host…" moves to
  `ops/README.md`), `docs/messaging.md`, `tg-service/README.md`, comments in `compose.yml`,
  `compose.dev.yml`, `.env.example`, `backend/models/channel.js`.

## D6. `deploy.sh`: installations from pulled images

`compose.yml` names the images explicitly and keeps `build:` beside them:

```yaml
backend:
  image: ${IMAGE_PREFIX:-hd-}backend:${IMAGE_TAG:-latest}
  build:
    context: ./backend
    target: prod
    additional_contexts: { root: . }
    args: { APP_VERSION: "${APP_VERSION:-dev}", APP_COMMIT: "${APP_COMMIT:-dev}" }
```

`IMAGE_PREFIX` is derived and exported by `deploy.sh`, never written by hand: `hd-` when no
registry is set — the image is then `hd-backend:latest`, exactly today's implicit name, so
`:prev` tagging and the rollback text keep working — and `<IMAGE_REGISTRY>/` otherwise.

Two keys in `.env`, both empty by default and documented in `.env.example`:

| Key | Meaning |
|---|---|
| `IMAGE_REGISTRY` | e.g. `registry.example.com/hd`. Empty = build on this host. |
| `IMAGE_TAG` | the release to run, e.g. `2.1.0`. Required when `IMAGE_REGISTRY` is set; `latest` is refused. |

Behaviour of `./deploy.sh`:

| | Build mode (`IMAGE_REGISTRY` empty) | Pull mode |
|---|---|---|
| Needs on the host | the repository | `compose.yml`, `deploy.sh`, `.env` — no git, no source |
| Images | `docker compose build --pull` with `APP_VERSION`/`APP_COMMIT` | `docker compose pull` |
| Start | as today | `up --no-build` |
| Everything else | unchanged: `.env` checks, `:prev` tags, backup, migrations with the app stopped, smoke test, Telegram profile | same |

- The log states the build being deployed and the build currently running.
- After the smoke test `deploy.sh` reads `/health` and prints the running version; in pull mode
  a version that differs from `IMAGE_TAG` is a warning, not an error (pre-release tags).
- Registry authentication is `docker login`, done once by the operator; `deploy.sh` does not
  touch credentials. A failed pull stops before anything is stopped or migrated.
- Rollback in pull mode: set `IMAGE_TAG` back and run `./deploy.sh`; data rollback is the
  existing `./deploy.sh restore`. `docs/deployment.md` "Rollback" gets the second variant.
- The owner's production has no `IMAGE_REGISTRY` and behaves exactly as before.

## D7. Changelog

`CHANGELOG.md` at the root, in Russian (it is read by operators and customers), newest first,
one section per version with three fixed subsections: «Новое», «Исправлено»,
«Что сделать при обновлении». The `2.1.0` entry is written in W3a and covers what changed for
an operator since `2.0.1`: the new `.env` keys of W1 and W2 and this spec's `IMAGE_*` keys.
`check.sh repo` fails when the current `VERSION` has no section.

---

## Verification

1. `./check.sh` exits 0 on the finished tree; breaking one thing in each part (an unused
   variable, a type error, a failing test, a wrong `VERSION`) makes it exit non-zero.
2. `./check.sh images` passes; adding a test file or a doc to an image context trips the
   deny-list.
3. Build mode: `./deploy.sh` on a scratch installation; `/health` shows `2.1.0` and the commit;
   a browser tab opened before a second deploy from another commit shows the banner.
4. Pull mode end to end without GitLab: a local `registry:2` on loopback, images pushed under a
   test tag, then an empty directory holding only `compose.yml`, `deploy.sh` and `.env` with
   `IMAGE_REGISTRY`/`IMAGE_TAG` — `./deploy.sh` brings the stack up and migrations run.
5. `deploy.sh` unit-style scratch checks (the style used in W2) for: mode selection, refusal of
   `latest`, missing `IMAGE_TAG`, failed pull leaves the running stack untouched.
6. Sync: `ops/sync-dev-db.sh` without `ops/sync.env` stops with the message; a masked run
   leaves no original e-mail or phone in `users`, signs in with `DEV_PASSWORD`, and the session
   and verification collections are empty; `maskData.js` refuses under `NODE_ENV=production`.
7. `repoBrand.test.js` passes with an empty allow-list.

The pull-mode and image checks need Docker; the frontend banner check is the owner's (browser).

## What changes for an operator

- Nothing has to be added to `.env` on an existing installation.
- `./sync-dev-db.sh` becomes `ops/sync-dev-db.sh --raw` (for the owner's own data) and needs
  `ops/sync.env`.
- After each deploy, open tabs show «Доступна новая версия».
- Git hooks are gone; run `./check.sh` before a release.

## Owner's answers (2026-10-11)

1. Rights holder for `LICENSE`: Общество с ограниченной ответственностью «Ф1».
2. Version `2.1.0` confirmed.
3. Sync script: masked by default, `--raw` for the owner's instance — confirmed, masking stays
   in W3a.
