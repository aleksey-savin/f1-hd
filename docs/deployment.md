# Deployment

How one installation of HD is run on a Linux host with Docker Compose. Quick
start is in the README; this page is the reference: configuration, migrations,
backups, moving an installation, rollback.

## Layout

| File | Purpose |
|---|---|
| `compose.yml` | production stack (default file): `mongodb`, `backend`, `frontend`, optional `tg-service` |
| `compose.dev.yml` | development stack with bind-mounted sources; selected by `COMPOSE_FILE=compose.dev.yml` in the dev machine's `.env` |
| `.env` / `.env.example` | the only configuration file; `deploy.sh` creates and fills it |
| `deploy.sh` | install/update, backup, restore, migrations, seeds, status, logs |
| `check.sh` | every quality gate in a container: `./check.sh` (sources), `./check.sh images` (production images) |
| `VERSION` | the version of the tree; goes into the images as their build identity |
| `backend/scripts/migrate.js` | ordered list of one-off data migrations plus the `migrations` ledger collection |
| `backend/scripts/seed.js` | ordered list of catalogue seeds (`backend/scripts/seeds/`) plus the `seeds` ledger collection |
| `*/Dockerfile` | one multi-stage file per service, targets `dev` and `prod` |
| `frontend/nginx.conf` | nginx inside the frontend image: serves the SPA, proxies `/api` and `/uploads` to the backend |

Network shape: frontend nginx publishes `HTTP_PORT` (default 8080); MongoDB
publishes `MONGO_PORT` on loopback by default (`127.0.0.1:27017`). The backend
has no published port. TLS and the public domain belong to an external reverse
proxy. `deploy.sh` explicitly uses `compose.yml`, regardless of `COMPOSE_FILE`;
that variable selects the development stack only for plain Compose commands.

## `deploy.sh`

```
./deploy.sh                 install or update (default)
./deploy.sh env             create/repair .env only
./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
./deploy.sh restore DIR     load a backup into this installation
./deploy.sh migrate ARGS    status | up | baseline <id> | mark <id>
./deploy.sh seed ARGS       status | up | mark <id>
./deploy.sh status          running build + docker compose ps
./deploy.sh logs [service]  follow logs
```

`deploy` does, in order: install Docker if missing (Docker's own `get.docker.com`
script: apt on Debian/Ubuntu, dnf on Fedora/RHEL/Alma) → create or repair `.env`
→ tag the running images `hd-<service>:prev` → build the images, or pull them
(see "Images") → start MongoDB → back up
(unless the database is empty) → run pending migrations with the application stopped → apply pending
catalogue seeds → start everything
and wait for health checks → smoke-test `GET /api/preferences-auth` through nginx
→ print the URL and, on a fresh database, the generated administrator password.

Requirements on the host:

- bash 4.4 or newer, curl, openssl;
- Docker with BuildKit (the default builder since Docker 23) and the Compose
  plugin 2.17 or newer: `compose.yml` gives the image builds a named build
  context. `deploy.sh` installs a current Docker when none is there; with an
  older Compose it stops before anything is changed and names the version it
  found — update the `docker-compose-plugin` package and run it again;
- root for the first run (Docker install). Later runs work as any user in the
  `docker` group.

## Images

The application images (`backend`, `frontend`, `tg-service`) are either built
on the host or pulled from a registry. `IMAGE_REGISTRY` in `.env` decides.

| | Build mode (`IMAGE_REGISTRY` empty) | Pull mode (`IMAGE_REGISTRY` and `IMAGE_TAG` set) |
|---|---|---|
| The host needs | the repository | `compose.yml`, `deploy.sh`, `.env` — no git, no sources; `docker login` once if the registry is private |
| Images | `docker compose build --pull`, named `hd-<service>:latest` | `docker compose pull` of `<IMAGE_REGISTRY>/<service>:<IMAGE_TAG>` |
| Start | `docker compose up` | `docker compose up --no-build` |
| An update is | `git pull && ./deploy.sh` | change `IMAGE_TAG` in `.env`, run `./deploy.sh` |

Everything else is the same in both modes: the `.env` checks, the `:prev`
tags, the backup, migrations with the application stopped, the smoke test, the
Telegram profile.

`IMAGE_TAG` names a release; `latest` is refused, so that an update is a
decision and a rollback is possible. `IMAGE_TAG` without `IMAGE_REGISTRY` stops
the script as well. `deploy.sh` derives `IMAGE_PREFIX` from the two keys and
keeps it in `.env` (`hd-` in build mode, `<IMAGE_REGISTRY>/` in pull mode), so
that a plain `docker compose ps|up|logs` sees the same image names as the
script; do not edit it by hand. After changing `IMAGE_REGISTRY` or
`IMAGE_TAG`, run `./deploy.sh` before any other command (`migrate`, `status`,
`logs`): the derived `IMAGE_PREFIX` is written by the deploy. `deploy.sh` does
not touch registry credentials.

A failed pull (wrong tag, no access, no network) stops the run before anything
is stopped, backed up or migrated: the running containers stay as they are.
After the pull the script also checks that every image it needs is on the host.
Only the application images are pulled. MongoDB is pinned in `compose.yml`
(`mongo:8.0`) and is never pulled by an update; Docker fetches it once, when the
host does not have it yet.

Build identity. Every image carries the version (the `VERSION` file) and the
commit it was built from. In build mode `deploy.sh` takes them from the tree —
the commit is 12 hex digits, with `.dirty` appended when the tree has
uncommitted changes — and passes them to the build; pulled images already have
them. Where it shows:

- `GET /health` of the backend — `version` and `commit`. The built-in nginx
  proxies only `/api` and `/uploads`, so this address answers on the compose
  network (the container health check uses it), not on `HTTP_PORT`;
- `./deploy.sh status` — the first line, `build: 2.1.0+3f2a9c1d07be`
  (`unknown (image predates build identities)` when a backend runs but its
  image has no build identity, `nothing` when no backend runs); `./deploy.sh`
  prints the build after the smoke test, and the build that was running before
  it, in the same words, in the "Building images" / "Pulling images" line;
- open browser tabs — after an update they offer to reload.

In pull mode a version that differs from `IMAGE_TAG` (a pre-release tag, for
example) is reported as a warning, not an error.

In build mode a checkout whose commit cannot be read — no git on the host, or
git refuses the repository ("dubious ownership" when the tree belongs to
another user) — is built as `<version>+dev` with a warning: open browser tabs
compare build ids and are not told about such an update.

## Configuration (`.env`)

`deploy.sh env` writes everything that can be generated and asks for the rest.
Reference with comments: `.env.example`.

| Group | Keys | Notes |
|---|---|---|
| asked once | `APP_PUBLIC_URL`, `BOOTSTRAP_ADMIN_EMAIL` | URL scheme decides whether the session cookie is `Secure`; the admin e-mail is used only on an empty database |
| generated | `MONGODB_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_ENC_KEY`, `TG_API_TOKEN` | keep a copy with the backups — see rotation costs below |
| mail mode | `MAIL_MODE`, `MAIL_SANDBOX_RECIPIENT` | where outgoing e-mail really goes — see below |
| ticket tag | `TICKET_SUBJECT_PREFIX`, `TICKET_SUBJECT_PREFIXES_ACCEPTED` | prefix of the `[HD-51713]` tag in e-mail subjects, by which replies are matched to tickets; empty = `HD`. The key itself must be present (`deploy.sh` writes it into a new `.env` and stops on an older one without it); earlier prefixes still recognised in replies go into the second key, comma-separated |
| error tracking | `SENTRY_DSN` | DSN of a Sentry-compatible service for browser errors; empty = off, no third party is contacted. `deploy.sh` derives `SENTRY_CSP_ORIGIN` from it |
| images | `IMAGE_REGISTRY`, `IMAGE_TAG`, `IMAGE_PREFIX` | both empty = build on this host; both set = pull `<IMAGE_REGISTRY>/<service>:<IMAGE_TAG>` (`latest` is refused). `IMAGE_PREFIX` is written by `deploy.sh` — see "Images" |
| optional | `HTTP_PORT`, `TRUST_PROXY_HOPS`, `TG_TOKEN`, `S3_*`, `TICKET_COUNTER_STARTING_NUMBER`, `ADD_TICKET_LOG`, `CORS_ORIGINS`, `BOOTSTRAP_*`, `GETSCREEN_ROOT_API`, `NVD_API_KEY` | defaults in `.env.example` |

Rotation costs: `BETTER_AUTH_SECRET` — everybody is logged out and existing
TOTP secrets become unreadable. `APP_ENC_KEY` — every secret stored in the
database (mail passwords, AI and RouterOS credentials, Mikrotik backups) becomes
unreadable. Its previous name, `MIKROTIK_ENC_KEY`, remains a runtime fallback.
When `APP_ENC_KEY` is absent or empty, deployment copies a nonempty legacy key
into it; only an installation with neither key gets a generated key. An existing
`APP_ENC_KEY` always takes precedence and is never replaced automatically.
If an earlier deployment already generated the wrong key, recover the original
key from a trusted copy and establish which key encrypted the stored values
before changing anything; these fixes do not repair mixed-key data.
`MONGODB_PASSWORD` — change it in MongoDB too.

Mail mode. `MAIL_MODE` decides where outgoing e-mail goes, whatever the mail
settings in the database say; `NODE_ENV` plays no part.

| Value | Behaviour |
|---|---|
| `live` | letters go to their real recipients |
| `sandbox` | every letter goes to `MAIL_SANDBOX_RECIPIENT`; the subject starts with `[SANDBOX → intended address]` and the intended address is kept on the queued letter. For hosts running on a copy of production data |
| `off` | nothing is sent: a letter is marked as not sent after one attempt and is not retried; Settings and the test button say that sending is switched off on the server |

Unset means `off`. An unknown value, or `sandbox` without
`MAIL_SANDBOX_RECIPIENT`, stops the backend at start with a message naming the
variable. `deploy.sh` writes `MAIL_MODE=off` into a new `.env`, and — once,
with a line in its output — `MAIL_MODE=live` into the `.env` of an installation
that was configured before this setting existed, so an update does not silence
its mail. Letters refused while the mode was `off` are not sent later: switch
the mode first, then let the application queue new ones. Changing `.env` takes
effect after the backend container is recreated.

Everything else the application needs lives in Settings inside the app (mail,
AI, modules, Telegram group, timezone). Only what must exist before the
database can be read (credentials, keys) or describes the host (URL, port,
proxy hops) stays in `.env`.

### Reverse proxy

Set `HTTP_PORT=127.0.0.1:8080` so only the proxy can reach the app, and
`TRUST_PROXY_HOPS=2` (the built-in nginx plus yours). nginx example:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100M;
}
```

`TRUST_PROXY_HOPS` is validated as a nonnegative integer at auth config load;
invalid, fractional, negative and empty values stop startup. An unset value
remains `0` (direct backend); `.env.example` supplies `1` for built-in nginx
only. Preserve the operator's configured value: use `2` for the chain above.
The backend must only be reachable through that exact-length trusted chain.
A shorter bypass path with too many trusted hops lets callers select an IP;
additional hops with too few trusted hops collapse clients onto a proxy IP.

Express `req.ip` is the canonical auth identity. The Node auth adapter and
application login/code wrappers replace `x-hd-auth-client-ip` with that value;
better-auth 1.6.26 reads only this internal header. Canonical identity and new
session audit records retain the exact trusted address. Abuse counters group
native IPv6 addresses by **/64** (`ipv6Subnet: 64` in the library); the session
create hook restores the exact internal-header address for audit data.
IPv4-mapped IPv6 shares the corresponding IPv4 abuse key. Caller-supplied
internal headers, `X-Real-IP` and extra leftmost forwarding entries do not
override it. nginx needs no
change. Do not expose the better-auth handler through another HTTP adapter
without the same overwrite.

Login/code pair budgets allow 10 failed checks per 15 minutes, normalized by
trimmed lower-case account and abuse IP (native IPv6 /64); code verification
and password reset by code share their pair counter. `/api/login-code` issues at most 3
codes per normalized account per hour, across IPs, retaining its generic reply.
The existing broad budget of 50 requests/hour/abuse IP covers login and
mail-code routes and also protects raw reset/magic verification from token rotation.
Password failures add an account cooldown (1s doubling to at most 30s); retries
inside that interval return the existing generic credential error with 429 and
`Retry-After` without moving its deadline. Password verification still runs:
a correct password clears cooldown and proceeds through existing ban/TOTP
checks, subject to independent pair/IP budgets. No active sessions are revoked.

Second-factor attempts share 30 requests/10 minutes using authenticated
identity. A live configured signed session takes precedence, keyed by user ID
and session ID, including setup/enable/disable. Only challenge-capable
verification paths may fall back to the configured signed two-factor cookie,
with a live persisted verification and an existing user. Invalid, expired,
orphaned or unrelated cookies fall back to abuse IP (native IPv6 /64), rather
than creating arbitrary buckets. Changing IP does not reset an authenticated
factor budget; independent NAT sessions/challenges have separate budgets. The
plugin's own 5-attempt challenge protection remains.

Raw reset allows 10 failures/15 minutes per abuse IP + reset token. Raw magic
verification counts **all** requests, up to 5/minute per abuse IP + token,
including success and error redirects (302). Redirects do not release these
reservations; the fixed window expires after 60 seconds. The shared broad
50/hour/abuse-IP budget also prevents bypass by rotating tokens. Original
responses, Location, cookies and callback/token-expiry behaviour are retained;
reset-password reservation-release rules remain separate.
These raw paths use application counters instead of better-auth's shared
per-IP plugin buckets. The public auth allow-list is unchanged. Auth policy
state is process-local, expires in fixed windows (idle cooldown after 15
minutes), and is capped at 10,000 entries with oldest-entry eviction; restarts
or eviction clear those counters. Multiple backend processes need a shared
bounded store before treating these as installation-wide limits.

After TLS is on, set `APP_PUBLIC_URL=https://…` and run `./deploy.sh` again.

### Telegram

`deploy.sh` asks for the @BotFather token once (`TG_TOKEN`; empty = no
Telegram) and switches the `telegram` compose profile on when it is set. The
service discovers the bot's username itself and reports it to the backend,
which the account page uses for the "connect" link. No token: the profile stays
off and the page says the bot is not configured.

A bot token can poll Telegram from **one** place only. While the old
installation still runs its bot, leave `TG_TOKEN` empty on the new host (or use
a second bot); otherwise both copies get `409 Conflict` and the service keeps
restarting. An unhealthy `tg-service` never blocks the deployment — the app is
up without it; `./deploy.sh logs tg-service` shows why.

### AI agents (MCP)

AI agents (OpenClaw and other MCP clients) read the knowledge base, tickets and Mikrotik devices
through `${APP_PUBLIC_URL}/api/mcp`. Nothing goes into `.env`: an administrator
creates a key in Settings, it is shown once, and deleting it revokes access
immediately. A key carries permissions — «База знаний», «Заявки», «Mikrotik» and/or «Изменения Mikrotik»; a key
stored before permissions existed reads as «База знаний» only. The
knowledge-base half answers only while that module is on, and only with
approved notes that have no leak flag; ticket tools have no module gate of
their own and mask phone numbers, e-mail addresses and detected credentials in
every free-text field they return. Full implementation notes: `docs/mcp.md`.

The reverse proxy needs no extra settings: every call is a POST whose short
`text/event-stream` answer closes with the result. OpenClaw configuration:

```json5
mcp: { servers: { helpdesk: {
  url: "https://hd.example.ru/api/mcp",
  transport: "streamable-http",   // required: without it OpenClaw uses "sse"
  headers: { Authorization: "Bearer hd_mcp_…" },
} } }
```

To rotate a key, create a new one, switch the agent to it, then delete the old
one. Calls are logged as `MCP tool call` with the key name
(`./deploy.sh logs backend`).

### MongoDB from the LAN

MongoDB is published on loopback only by default. To reach it from another
machine (Compass, the sync script run from a workstation), set the host's LAN
address in `.env` and re-run `./deploy.sh`:

```
MONGO_PORT=<lan-ip>:27017
```

Connection string: `mongodb://<MONGODB_USERNAME>:<MONGODB_PASSWORD>@<lan-ip>:27017/?authSource=admin`
(the credentials are in `.env`; the password is plain hex, nothing to escape).
Bind to the LAN address, never `0.0.0.0` on a host with a public interface:
Docker publishes ports past ufw, so the firewall would not protect it.

### Attachments

With `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` and
`S3_ENDPOINT` set, new uploads go to S3; otherwise they are written to the
`hd_uploads` volume. `/uploads/<name>` serves local files first and redirects
to a presigned URL for the rest, so both can coexist.

## Migrations

One-off data migrations are the scripts in `backend/scripts/`, listed in order
in `backend/scripts/migrate.js`. The `migrations` collection records what was
applied (`{_id, appliedAt, mode: run | baseline | mark}`).

```
./deploy.sh migrate status        applied / pending
./deploy.sh migrate pending       exit 0 = nothing pending, 3 = pending, 2 = no ledger
./deploy.sh migrate up            run pending entries in order (deploy does this)
./deploy.sh migrate baseline ID   mark everything up to and including ID as applied
./deploy.sh migrate mark ID       mark one entry (you ran it by hand)
```

`deploy` asks `pending` first and stops `backend` and `tg-service` only when
something has to run, so a routine update has no extra downtime, while a data
migration never races the previous version of the code. If an entry fails the
application stays stopped: fix the cause and run `./deploy.sh` again (it
resumes at that entry), or mark it only after verifying that its required changes have already been
applied. `mark` records completion without executing or validating the migration.

The migration step also stops the deployment if application writers cannot be
stopped. Taxi defaults are ledger-backed migrations, including
`2026-11-09-repairTaxiAdminPermissions`: administrative staff roles receive
`taxi.*` even when unrelated module rights are missing. The repair has its own
entry so an already recorded initial grant cannot skip it. Fresh installations
use the admin role catalogue. Grants are not rerun on every deployment, so later
intentional role edits remain in effect.

`2026-11-11-grantProxmoxPermissions` adds `proxmox.read`, `manage`, `power`,
`backup` and `discover` to existing administrative staff roles (those with
`role.manage`, `user.manageAccess` and `settings.manage`). It preserves other
permission restrictions and skips client roles. Roles that become full-access
also have their holders' `isAdmin` / plugin role mirrors recomputed; a retry
after interruption completes that step without duplicating grants. Fresh
installations already have these actions in the admin role catalogue. This is
a one-off migration, so subsequent intentional permission edits stay in effect.

Rules the runner enforces:

- empty database → `up` records the whole list as baseline and runs nothing;
- data without a ledger → `up` refuses with exit code 2: such data predates the
  list (see below) and has to go through the release that still carried it;
- the first failure stops the run; applied entries stay recorded, a rerun
  resumes;
- entries with a `preflight` run those checks first and stop if they fail;
- the list is append-only; never reorder it.

Entries applied on every installation are removed from the list together with
their scripts; extra records in the ledger do no harm. The list currently
starts after commit `61d49c6` (the last one before «Диалоги»): every
installation runs that code or newer. Data older than that — a backup without a
`migrations` collection — has to be restored and deployed with `61d49c6`
first, then updated to the current code.

Not in the list on purpose: `eraseApiKeyValues.js` (irreversible, run by hand
once the hashes are proven), `renameRoleKeys.js` (dev tool), the MikroTik model
catalogue (`seedMikrotikModels.js`, run by hand), diagnostics. The inventory
catalogue has its own runner — see «Seeds» below.

The standalone `./deploy.sh migrate up` command does not stop writers or take
a backup. For production upgrades use the full deployment flow; manual writes
require a separately arranged backup and maintenance window.

Any script can still be run by hand inside the container:
`docker compose run --rm backend node scripts/<name>.js [--apply]`, then
`./deploy.sh migrate mark <id>`.

### W5a browser-session cutover

This is an incremental update of an installation already using better-auth;
do not repeat the historical JWT/user/role migrations. Keep
`BETTER_AUTH_SECRET`, `APP_PUBLIC_URL`, cookie prefix/name/attributes, user IDs,
passwords, TOTP data and integration credentials unchanged. Changing the secret
would invalidate clients and make existing encrypted TOTP data unreadable.

The migration entry `2026-11-07-cutoverStaffSessions` runs
`scripts/cutoverStaffSessions.js --apply`. In the **candidate** backend image,
`node scripts/cutoverStaffSessions.js` without arguments is a read-only dry run:
it prints counts for staff sessions, staff impersonations, preserved client
sessions and impersonation codes, with no tokens or user details. An unrecognised
argument fails. Record these counts in the release record; counts read while
writers are active are estimates until the maintenance window.

Use the normal deployment backup and stopped-writer migration lifecycle. With
backend and tg-service stopped and MongoDB running, the apply step saves a
majority-acknowledged `authCutovers` snapshot before deleting its selected IDs.
Staff means **exactly** `isEndUser === false`; client-manager/client-admin roles
and missing/null `isEndUser` remain client-scoped. Staff-owned sessions,
staff-to-client impersonation sessions and affected unclaimed impersonation
codes are revoked. Independent client cookies and saved bot links survive.
Retries use the saved native Mongo IDs, so a staff login issued after the
cutover is not selected by a retry. Retain `authCutovers` and the migration
ledger. Staff sign in again after the update.

Before release, verify an already-open old client tab can read, create a ticket,
comment, upload and receive Pulse changes through the candidate backend. Open
the new frontend in a second tab and verify both tabs. Existing cookies carry
identity; compatibility `cookie.<session-id>` values are public cache markers,
never credentials. Keep shared legacy keys available for old tabs. Their
existing localStorage expiry timer still bounds an old loaded tab; do not
invent a later deadline, force an auth-migration reload, or bypass intentional
logout. Test the existing outage-recovery reload separately, and confirm renewed
Set-Cookie headers actually reach the browser. Bearer-only browser requests
must fail; dedicated MCP/company/bot credentials keep their own transports.

For Telegram, check an existing client binding without `linkedAt`: photo plus
caption creates a ticket and its notification goes to the same saved chat.
Browser revocation must not require re-pairing. A service token without a saved
actor must not create a ticket, and browser cookies must not supply that actor.
Never start a second polling process with a live bot token. A local fake
Telegram transport verifies application routing/outbox behaviour, **not real
Telegram API delivery**.

The historical synthetic rehearsal is
`backend/auth/w5aContinuity.integration.test.js`, with helpers under
Docker-excluded `backend/auth/__tests__/`. It is skipped by ordinary test runs.
It depends on a separately prepared `/tmp/hd-w5a-baseline` source snapshot,
existing dependencies, Playwright Chromium and the local `mongo:8` image. That
temporary snapshot is not distributed with this repository: the rehearsal is
not a self-contained installation check. Its original context is in the
[W5a implementation plan](superpowers/plans/2026-11-07-w5a-auth-session-compatibility.md).
Do not treat the plan's task-specific review barriers as current deployment
prerequisites.

When deliberately reproducing that historical fixture in an isolated test
environment, its opt-in command, from `backend`, is:

```sh
ulimit -c 0
W5A_REHEARSAL=1 W5A_BROWSER=1 node --test auth/w5aContinuity.integration.test.js
```

It creates disposable MongoDB, uploads, bot SQLite and browser fixtures; it does
not verify live Telegram delivery or the deployed nginx/proxy chain. Without
`W5A_BROWSER=1`, browser coverage is skipped and must not be reported as passed.

For a release, run `./check.sh` and `./check.sh images` from the source checkout,
record failures and skipped coverage, and perform the client-session and bot
checks above on an isolated staging installation of the actual candidate
images. Use the production Node version supplied by the container checks.
The deployment smoke test covers HTTP reachability only; it does not establish
session continuity, backup recoverability or compatibility of old browser tabs.

## Seeds

Catalogue seeds are the starting data of the inventory catalogue (attribute
groups, device types, attributes and their links, the slots of self-built
types). Each one is a module in
`backend/scripts/seeds/`, listed in order in `backend/scripts/seed.js`; the
`seeds` collection records what was applied (`{_id, appliedAt, mode: run | mark}`).

```
./deploy.sh seed status        applied / pending
./deploy.sh seed up            apply pending seeds in order (deploy does this)
./deploy.sh seed mark ID       record a seed as applied without running it (skip it)
```

On a dev machine: `docker compose run --rm backend node scripts/seed.js <command>`.

Unlike migrations, seeds run on every deploy, **a fresh install included**: a
new installation needs the catalogue too. With nothing pending the step does
nothing. A seed only adds: what already exists is picked up by name (attributes
also by code), case-insensitively, and is not overwritten — except that a
select attribute gets its missing options, a link without a group gets the
catalogue's group, a picked-up type the catalogue lists as a component
becomes one, and a type without slots gets the catalogue's assembly (slots and
key characteristics of its own build). A mismatching value type is printed as a
warning and the attribute is still picked up. Nothing is ever deleted. An applied seed never
runs again, so whatever the owner renamed or removed afterwards stays that way.

Seeds run after the migrations and before the services start; the application
is not stopped for them. A failed seed removes what it created in that run and
stops the deploy: fix the cause and run `./deploy.sh` again (it resumes at that
seed), or skip it with `./deploy.sh seed mark <id>`.

Seeds so far:

| id | what it adds |
| --- | --- |
| `2026-10-19-inventoryCatalog` | attribute groups, component types (Процессор, Материнская плата, …), factory types (Ноутбук, Моноблок, Маршрутизатор, Коммутатор, МФУ) and «Системный блок» for branded models, with their attributes; see `docs/inventory.md` |
| `2026-10-19-systemUnitAssembly` | the own build of «Системный блок»: nine component slots and six key characteristics. Pick-up only: it creates nothing (no groups, types, attributes or links) and adds nothing else (no options, link groups or component flags). Whatever it cannot find — a type or attribute the owner renamed or deleted, a missing link — is a warning, and the slots and key characteristics depending on it are dropped; if «Системный блок» itself is not found, nothing is written. On a fresh install the first seed runs just before it in the same `seed up`, so everything resolves. A type whose slots are already set is left alone; see `docs/inventory.md` §2.5 |

## Updating an installation that predates brand settings

Releases before brand settings carried the brand, the mail redirect and the
ticket subject prefix in code. An installation that ran such a release needs
four things in `.env` before its first `./deploy.sh` on the new one:

| Variable | What to set | If it is missing |
|---|---|---|
| `TICKET_SUBJECT_PREFIX` | the text inside the square brackets of a ticket notification subject, before the last hyphen and the number | `./deploy.sh` stops and says so: replies to letters already sent are matched by this prefix |
| `MAIL_MODE` | `live` | `deploy.sh` writes `live` itself, once, and prints a line about it |
| `LEGACY_BRAND_NAME`, `LEGACY_BRAND_SIGNATURE` | the portal name and the e-mail signature the installation used (`<br>` or `\n` separates signature lines) | `deploy.sh` prints a warning on that first run (once, together with the `MAIL_MODE` line) and goes on; the `seedBrand` migration writes nothing and is still recorded as applied: the portal shows the product defaults until the name and signature are entered in «Настройки → Основные → Бренд» |

Optional: `SENTRY_DSN` — the previous releases reported browser errors to a
built-in address; now nothing is reported unless this is set.

To change the prefix later without orphaning replies, put the new one in
`TICKET_SUBJECT_PREFIX` and the old one in `TICKET_SUBJECT_PREFIXES_ACCEPTED`.

The two `LEGACY_BRAND_*` lines can be removed from `.env` after the deploy.

A dev machine working on a copy of real data sets `MAIL_MODE=sandbox` and
`MAIL_SANDBOX_RECIPIENT=<your address>`, then recreates the containers
(`docker compose up -d --force-recreate`); until then its mail is off.

## User review and retained user identities

The user-review feature is opt-in under Settings → «Проверка пользователей».
Text analysis uses the configured AI connection; inactivity and known disabled-age
rules work independently of the AI provider. History analysis is started manually.
No account is disabled or deleted without a person's decision.

The deployment migration `2026-11-09-upgradeUserReviewRoles` preserves full access
for roles that held the entire previous staff dictionary. Restricted roles do not
receive the new review rights automatically. `2026-11-09-backfillUserActivity`
advances cached activity from the latest applicant ticket, including legacy
applicant references. Existing newer activity is retained, even when the linked
ticket is absent from the current database copy.
The corresponding scripts default to dry-run when launched manually; the migration
runner applies them once through its ledger.

User deletion retains the document, membership, credentials and historical
references while denying access. Restoring a user keeps the account disabled.
Existing disabled users without `disabledAt` remain undated and are excluded from
age-based deletion proposals. Do not infer this date from a profile update.

## Backup and restore

`./deploy.sh backup` writes `backups/<timestamp>/` with an application-database
`mongo.archive.gz` (`mongodump --archive --gzip`) and a `manifest`. It also
archives `hd_uploads` and `hd_storage` when those volumes exist. The last five
backup directories are kept locally. Copy completed backups off the host and
keep a protected copy of `.env`, including the original encryption keys.

This is **not a complete installation backup**:

- S3 objects are not downloaded or archived. Maintain a separate bucket backup
  and retention policy covering both attachments and private artifacts.
- `hd_tg_service_data` is not included. It holds Telegram's SQLite delivery
  deduplication, board and in-progress dialog state. Back up and restore that
  volume separately with `tg-service` stopped; preserve the whole volume,
  including SQLite WAL files. Account bindings in MongoDB are separate.
- Images, reverse-proxy configuration and external integration state are not
  included. Retain the release identity and the configuration needed to recover.

Backup does not stop writers. `deploy` also takes its automatic backup **before**
stopping writers for pending migrations. Database and volume archives are read
sequentially, so live writes can leave them inconsistent. For a recoverable
maintenance snapshot, prevent new traffic and stop all application writers
(including external importers), while keeping MongoDB running:

```sh
docker compose -f compose.yml stop backend frontend tg-service && ./deploy.sh backup
```

Verify that the stop succeeded before proceeding. Keep writers stopped while
copying Telegram state and taking any matching external-storage snapshot.
Do not use `docker compose down -v`: `hd_storage` and `hd_tg_service_data` are
not external volumes and can be deleted by that command.

`./deploy.sh restore backups/<timestamp>` stops the application and refuses to
continue if that stop fails. MongoDB remains available. Restore uses `--drop`
for collections in the dump, maps the source database name to the configured
name when needed, extracts available volume archives and fixes ownership.
It leaves the application stopped. Inspect `./deploy.sh migrate status` using
the intended release, then run `./deploy.sh` when ready to start it.

Restore is **not an exact reset** of an existing installation: collections absent
from the dump are not removed, volume files are overlaid rather than cleared,
and missing volume archives leave existing files untouched. A failure can leave
a partial restore. Prefer an empty, isolated recovery target; preserve any
existing target data before deliberately cleaning it. Retrying alone does not
remove residual data. Verify attachment access and the intended database state
before admitting users. No restore command can undo writes to external systems.

## Moving an installation to a new host

Separate rehearsal from the final cutover. A rehearsal can use a live backup,
but it must not send real mail, poll the production Telegram bot, process live
inbound integrations or run jobs against production devices. `MAIL_MODE=off`
only disables outgoing email; it does not isolate other integrations. Use an
isolated network and test credentials, and verify the restrictions before
starting the copied application.

1. Prepare the target release and Docker environment. Copy the old `.env`
   securely and preserve `APP_ENC_KEY` (or its legacy value),
   `BETTER_AUTH_SECRET` and the existing public URL/cookie identity. Run
   `./deploy.sh env`; it retains configured values rather than asking for a new
   URL. Adjust port bindings and proxy hops for the new host. Leave the live bot
   disabled during rehearsal.
2. Rehearse recovery on an empty isolated target, including S3 availability,
   local artifacts and Telegram state. Restore does not clean a used target;
   prepare a fresh target for the final recovery.
3. Begin the final maintenance window. Block traffic to the old application and
   stop its backend, frontend, Telegram service and external writers. Verify
   they stopped; leave MongoDB running. Take a **new final backup**, preserve
   Telegram state, and copy the backup plus any separately managed storage.
   Writes accepted after this snapshot will not appear on the new host.
4. On the new host, run `./deploy.sh restore backups/<timestamp>`. Restore the
   separately saved Telegram volume while its service is stopped. Confirm the
   original secrets and external-storage configuration are present. Keep the
   old application stopped throughout cutover.
5. Run `./deploy.sh` for the intended release, inspect migration results and
   verify the proxy and application with controlled access. Check sign-in,
   attachments and the required integrations. Only one host may poll the live
   Telegram token or run production background jobs.
6. Switch the reverse proxy/DNS, then admit users. Keep old endpoints blocked
   while DNS caches expire. Retain the old data and final backup for recovery;
   after the new host accepts writes, switching back requires reconciling those
   writes rather than simply restarting the old copy.

## Rollback

- Built images: the images that ran before the last deploy are tagged
  `hd-backend:prev`, `hd-frontend:prev`, `hd-tg-service:prev`. Retag them as
  `hd-<service>:latest` and `docker compose up -d --no-build`, or check out the
  previous commit and run `./deploy.sh`.
- Pulled images: set `IMAGE_TAG` back to the previous release and run
  `./deploy.sh`.
- Data: `./deploy.sh restore backups/<timestamp>` with the backup taken right
  before the migrations. A data rollback always goes together with a code
  rollback.

For W5a, roll application images back with the same secret and cookie identity.
Do **not** restore the database just to undo the staff-session cutover: deleted
staff/impersonation sessions remain revoked, while client activity and saved
Telegram bindings must remain intact. Do not remove the cutover snapshot or
migration ledger to reselect sessions. A full disaster restore is a separate,
deliberate data rollback; it is not the W5a runtime rollback procedure.

### Mikrotik changes proposed by AI agents

A key with the «Изменения Mikrotik» access can propose configuration changes
that people approve in HD before anything reaches a router. Implementation
notes: `docs/mikrotik-changes.md`.

- **Migration `2026-10-10-grantApproveChanges`**
  (`backend/scripts/grantApproveChanges.js`, after `2026-10-01-grantUpgradeFirmware`
  in `migrate.js`). The new right `mikrotik.approveChanges` would otherwise
  break «full access» for existing administrator roles. The migration adds that
  one action to staff roles that lack only that action, then recomputes the
  mirrored `isAdmin` / plugin role for holders of full-access staff roles. It
  runs with the application stopped, like the other data migrations: `deploy.sh`
  stops `backend` and `tg-service` when something is pending. It is idempotent
  and can be previewed by hand: `docker compose run --rm backend node
  scripts/grantApproveChanges.js` (add `--apply` to write, then `./deploy.sh
  migrate mark 2026-10-10-grantApproveChanges`).
- **Environment** (optional, read from `.env` by the backend; a container picks
  up changes only when recreated):
  - `MIKROTIK_CHANGE_EXECUTOR` — `safe-mode` (default) or `api`. Leave the
    default until the live probe `scripts/spikeSafeMode.js` has been run on a
    real router; `api` applies without any rollback. Case and surrounding
    spaces are ignored; an unknown value is logged once as an error and
    treated as `safe-mode`.
  - `MIKROTIK_CHANGE_KEEPALIVE` — `1` enables SSH keepalive on the connection
    that holds safe mode. Off by default (not verified against RouterOS).
- **Scheduled jobs** (registered in `backend/app.js`, single backend process
  assumed): `Mikrotik change worker`, every 15 seconds, applies one approved
  request per run; `Mikrotik change sweep`, every 5 minutes (minutes 1, 6, 11…),
  expires and reminds open requests, erases WireGuard keys after 24 hours and
  settles requests stuck in `applying`.
- **Device accounts** need the RouterOS policies `api`, `read`, `write`, `ssh`
  (checked before each apply; see `docs/mikrotik-management.md`).

## Logs

Containers log to stdout; Docker keeps five rotated 10 MB files per container
(`x-logging` in `compose.yml`). `./deploy.sh logs backend` follows them. In
production the backend writes no log files of its own; in development the
rotating files under `backend/logs/` are kept.

## Known advisories

`./check.sh` fails on a dependency advisory of level high or critical. The ones
below are the repository's explicit exceptions in
`pnpm.auditConfig.ignoreGhsas` of the service. This table is not a current audit
result or a claim that every other dependency is clear. Run the gate for the
release being deployed, review its full output, and reassess exceptions when
updating dependencies.

| Advisory | Package | Service | Why it does not apply |
|---|---|---|---|
| `GHSA-4r6h-8v6p-xvw6` (prototype pollution) | `xlsx` 0.18.5 | frontend | triggered by reading a crafted spreadsheet; the browser code only builds workbooks from its own data and writes them (`components/Report/export.ts`, `components/Mikrotik/networks-export.js`), it never parses a file |
| `GHSA-5pgg-2g8v-p4x9` (ReDoS) | `xlsx` 0.18.5 | frontend | same: the vulnerable code is the parser, which is not called |
