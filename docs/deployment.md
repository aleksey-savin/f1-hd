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
| `deploy.sh` | install/update, backup, restore, migrations, status, logs |
| `backend/scripts/migrate.js` | ordered list of one-off data migrations plus the `migrations` ledger collection |
| `*/Dockerfile` | one multi-stage file per service, targets `dev` and `prod` |
| `frontend/nginx.conf` | nginx inside the frontend image: serves the SPA, proxies `/api` and `/uploads` to the backend |

Network shape: exactly one port is published (`HTTP_PORT`, default 8080) by the
frontend nginx. MongoDB and the backend are reachable only on the compose
network. TLS and the public domain belong to an external reverse proxy.

## `deploy.sh`

```
./deploy.sh                 install or update (default)
./deploy.sh env             create/repair .env only
./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
./deploy.sh restore DIR     load a backup into this installation
./deploy.sh migrate ARGS    status | up | baseline <id> | mark <id>
./deploy.sh status          docker compose ps
./deploy.sh logs [service]  follow logs
```

`deploy` does, in order: install Docker if missing (Docker's own `get.docker.com`
script: apt on Debian/Ubuntu, dnf on Fedora/RHEL/Alma) → create or repair `.env`
→ tag the running images `hd-<service>:prev` → build → start MongoDB → back up
(unless the database is empty) → run pending migrations with the application stopped → start everything
and wait for health checks → smoke-test `GET /api/preferences-auth` through nginx
→ print the URL and, on a fresh database, the generated administrator password.

Requirements on the host: bash, curl, openssl, root for the first run (Docker
install). Later runs work as any user in the `docker` group.

## Configuration (`.env`)

`deploy.sh env` writes everything that can be generated and asks for the rest.
Reference with comments: `.env.example`.

| Group | Keys | Notes |
|---|---|---|
| asked once | `APP_PUBLIC_URL`, `BOOTSTRAP_ADMIN_EMAIL` | URL scheme decides whether the session cookie is `Secure`; the admin e-mail is used only on an empty database |
| generated | `MONGODB_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_ENC_KEY`, `TG_API_TOKEN` | keep a copy with the backups — see rotation costs below |
| optional | `HTTP_PORT`, `TRUST_PROXY_HOPS`, `TG_TOKEN`, `S3_*`, `TICKET_COUNTER_STARTING_NUMBER`, `ADD_TICKET_LOG`, `CORS_ORIGINS`, `BOOTSTRAP_*`, `GETSCREEN_ROOT_API`, `NVD_API_KEY` | defaults in `.env.example` |

Rotation costs: `BETTER_AUTH_SECRET` — everybody is logged out and existing
TOTP secrets become unreadable. `APP_ENC_KEY` — every secret stored in the
database (mail passwords, AI and RouterOS credentials, Mikrotik backups) becomes
unreadable; it replaced `MIKROTIK_ENC_KEY`, which is still accepted under the
old name. `MONGODB_PASSWORD` — change it in MongoDB too.

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
MONGO_PORT=10.0.50.231:27017
```

Connection string: `mongodb://<MONGODB_USERNAME>:<MONGODB_PASSWORD>@10.0.50.231:27017/?authSource=admin`
(the credentials are in `.env`; the password is plain hex, nothing to escape).
Bind to the LAN address, never `0.0.0.0` on a host with a public interface:
Docker publishes ports past ufw, so the firewall would not protect it.

### Filling a test host with production data

Run the sync script on the test host itself; it needs SSH access to the
production host (your key, or `ssh -A` when you log in) and nothing else — when
`mongorestore` is not installed it uses the one inside the `mongodb` container:

```bash
./sync-dev-db.sh          # replaces every collection except `preferences`
./deploy.sh migrate up    # whatever this code has that production has not
```

The script finds the production containers by itself. The copy brings the
production `migrations` ledger along, so `migrate up` runs only the entries
production has not applied yet.

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
resumes at that entry), or skip the entry with `migrate mark`.

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
once the hashes are proven), `renameRoleKeys.js` (dev tool), the catalogue
seeds (`initializeInventoryData.js`, `seedMikrotikModels.js`), diagnostics.

Any script can still be run by hand inside the container:
`docker compose run --rm backend node scripts/<name>.js [--apply]`, then
`./deploy.sh migrate mark <id>`.

## Backup and restore

`./deploy.sh backup` writes `backups/<timestamp>/` with `mongo.archive.gz`
(`mongodump --archive --gzip` of the application database), `hd_uploads.tar.gz`,
`hd_storage.tar.gz` and a `manifest`. The last five are kept. `deploy` takes one
automatically before running migrations on a non-empty database. Copy the
directory elsewhere; it is the whole installation apart from `.env`.

`./deploy.sh restore backups/<timestamp>` stops the application, restores the
database with `--drop` (renaming it if the dump came from a database with
another name), unpacks the volumes and fixes ownership. It does not start the
application: run `migrate status` (the ledger comes with the dump), then
`./deploy.sh`.

## Moving an installation to a new host

The old host keeps running until DNS is switched; nothing below touches it
beyond a read-only dump.

1. Old host: `./deploy.sh backup`.
2. Copy `backups/<timestamp>` to the new host, together with the old `.env`.
3. New host: clone the repository, `./deploy.sh env` (installs Docker, writes
   `.env`, asks for the URL). Then edit `.env`:
   - `APP_ENC_KEY` and `BETTER_AUTH_SECRET` = the old values — mandatory, or
     every stored secret is unreadable and every session and TOTP secret is
     lost;
   - `S3_*` as before if attachments live in S3;
   - `TICKET_COUNTER_STARTING_NUMBER`, `TG_TOKEN`, `TRUST_PROXY_HOPS=2`,
     `HTTP_PORT=127.0.0.1:8080` as needed.
4. `./deploy.sh restore backups/<timestamp>`.
5. `./deploy.sh` — backup, pending migrations, start, smoke test.
6. Point the reverse proxy at `127.0.0.1:8080`, sign in with a real account.

Rehearse steps 4–5 on the new host before the real switch: it is empty, and
`restore` can be repeated.

## Rollback

- Code: the images that ran before the last deploy are tagged
  `hd-backend:prev`, `hd-frontend:prev`, `hd-tg-service:prev`. Retag them as
  `hd-<service>:latest` and `docker compose up -d --no-build`, or check out the
  previous commit and run `./deploy.sh`.
- Data: `./deploy.sh restore backups/<timestamp>` with the backup taken right
  before the migrations. A data rollback always goes together with a code
  rollback.

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
