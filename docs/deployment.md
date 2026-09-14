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
| `scripts/mongo-upgrade.sh` | in-place MongoDB 5→6→7→8 for a host that still runs an old server; used automatically when needed |
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
→ upgrade an old MongoDB in place if one is found on this host → remove
containers of the previous layout → tag the running images `hd-<service>:prev`
→ build → start MongoDB → fix volume ownership → back up (unless the database is
empty) → run pending migrations with the application stopped → start everything
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
./deploy.sh migrate up            run pending entries in order (deploy does this)
./deploy.sh migrate baseline ID   mark everything up to and including ID as applied
./deploy.sh migrate mark ID       mark one entry (you ran it by hand)
```

Rules the runner enforces:

- empty database → `up` records the whole list as baseline and runs nothing;
- data without a ledger → `up` refuses with exit code 2 until you `baseline`;
- the first failure stops the run; applied entries stay recorded, a rerun
  resumes;
- entries with a `preflight` (e.g. `checkEmailCollisions`, the `assignRoles` dry
  run) run those first and stop if they fail;
- the list is append-only; never reorder it.

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
application: run `migrate status`, `baseline` if the ledger is empty, then
`./deploy.sh`.

## Moving an installation to a new host

The old host keeps running until DNS is switched; nothing below touches it
beyond a read-only dump.

1. Old host: `git pull`, `./deploy.sh backup` (works with the previous layout
   too: it reads `.env.prod` and the `hd-mongodb-prod` container).
2. Copy `backups/<timestamp>` to the new host.
3. New host: clone the repository, `./deploy.sh env` (installs Docker, writes
   `.env`, asks for the URL). Then edit `.env`:
   - `APP_ENC_KEY` = the old `MIKROTIK_ENC_KEY` — mandatory, or every stored
     password, API key and Mikrotik backup is unreadable;
   - `S3_*` as before if attachments live in S3;
   - `TICKET_COUNTER_STARTING_NUMBER`, `TG_TOKEN`, `TRUST_PROXY_HOPS=2`,
     `HTTP_PORT=127.0.0.1:8080` as needed;
   - `BETTER_AUTH_SECRET` and the MongoDB credentials are new: the dump has no
     users of its own and the previous installation had no better-auth.
4. `./deploy.sh restore backups/<timestamp>`.
5. `./deploy.sh migrate baseline 2026-07-24-backfillUserLastActivity` for data
   from the pre-better-auth installation (the three entries dated 07-27/07-31
   are idempotent and simply re-run).
6. `./deploy.sh` — backup, migrations (the better-auth chain runs here, gated by
   `checkEmailCollisions` and the `assignRoles` dry run), start, smoke test.
7. Point the reverse proxy at `127.0.0.1:8080`, sign in with a real account.

Rehearse steps 4–6 on the new host before the real switch: it is empty, and
`restore` can be repeated.

## Upgrading MongoDB in place

`deploy.sh` checks which server last wrote `hd_data` on this host. Below 8 it
runs `scripts/mongo-upgrade.sh`: a full dump to `backups/pre-upgrade-*`, then
one major at a time (`mongo:6.0`, `mongo:7.0`, `mongo:8.0`) on the same volume,
raising `featureCompatibilityVersion` after each. This is one-way; going back
means restoring the pre-upgrade dump into a container of the previous version
(the old image is kept as `hd-mongo:pre-upgrade`). Rehearse on a copy first:

```
docker run --rm -v hd_data:/from -v hd_data_test:/to alpine cp -a /from/. /to/
VOL=hd_data_test CFG=hd_mongodb_config_test scripts/mongo-upgrade.sh
```

## Rollback

- Code: the images that ran before the last deploy are tagged
  `hd-backend:prev`, `hd-frontend:prev`, `hd-tg-service:prev`. Retag them as
  `hd-<service>:latest` and `docker compose up -d --no-build`, or check out the
  previous commit and run `./deploy.sh`.
- Data: `./deploy.sh restore backups/<timestamp>` with the backup taken right
  before the migrations. A data rollback always goes together with a code
  rollback: the better-auth schema (`isActive` → `banned`) is incompatible in
  both directions.

## Logs

Containers log to stdout; Docker keeps five rotated 10 MB files per container
(`x-logging` in `compose.yml`). `./deploy.sh logs backend` follows them. In
production the backend writes no log files of its own; in development the
rotating files under `backend/logs/` are kept.
