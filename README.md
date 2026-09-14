# HD

Helpdesk and IT-management portal: tickets, inventory, knowledge base,
Mikrotik monitoring, work reports. One repository, three services.

```
hd/
├── backend/          # Node.js/Express API (Mongoose, better-auth)
├── frontend/         # React/Vite SPA, served by nginx in production
├── tg-service/       # Telegram bot service (talks to the backend API only)
├── compose.yml       # production stack (default compose file)
├── compose.dev.yml   # development stack (bind-mounted sources)
├── deploy.sh         # install / update / backup / restore / migrations
├── .env.example      # the only configuration template
├── scripts/          # host-side helpers (in-place MongoDB upgrade)
├── sync-dev-db.sh    # copy the production database into the dev one
└── docs/             # implementation notes; docs/deployment.md for operations
```

## Production

Any Linux host with bash, curl and openssl. Docker is installed by the script
if missing (Debian/Ubuntu via apt, Fedora/RHEL/Alma via dnf).

```bash
git clone <repo> hd && cd hd
sudo ./deploy.sh
```

The first run asks for the public URL and the administrator's e-mail, generates
every secret into `.env`, builds the images, starts the stack and prints the
generated administrator password once. The app listens on port 8080 (plain
HTTP); put your reverse proxy with TLS in front of it and set
`HTTP_PORT=127.0.0.1:8080`, `TRUST_PROXY_HOPS=2`, `APP_PUBLIC_URL=https://…`.

Updating: `git pull && ./deploy.sh`. A backup is taken and pending data
migrations run before the new version starts.

| Command | What it does |
|---|---|
| `./deploy.sh` | install or update |
| `./deploy.sh backup` | database + uploads → `backups/<timestamp>/` |
| `./deploy.sh restore DIR` | load a backup (then `migrate` and `deploy`) |
| `./deploy.sh migrate status` | which data migrations ran, which are pending |
| `./deploy.sh status` / `logs [service]` | containers, logs |

Configuration reference, Telegram, S3, moving to another host, rollback:
[docs/deployment.md](docs/deployment.md).

## Development

Prerequisites: Docker with the compose plugin, pnpm, Node 24.

```bash
cp .env.example .env         # fill in, then add:
echo COMPOSE_FILE=compose.dev.yml >> .env
docker compose up -d         # mongodb + backend (nodemon) + frontend (vite)
docker compose --profile telegram up -d   # plus the bot, when TG_TOKEN is set
```

Frontend: http://localhost:3000 (Vite proxies `/api` and `/uploads` to the
backend, so cookies work same-origin like in production). Changing `.env`
needs `docker compose up -d --force-recreate`. Backend logs are in
`backend/logs/`.

Per-service scripts (`cd backend|frontend|tg-service`):

```bash
pnpm dev          # backend: nodemon; frontend: vite; tg-service: node --watch
pnpm typecheck    # all three
pnpm test         # backend, tg-service (node --test)
pnpm lint         # frontend
pnpm build        # frontend
```

### Copy the production database

```bash
./sync-dev-db.sh
```

Runs from the host shell. The dump is read from production over SSH (through
the jump host when production is not reachable directly) and restored into the
local database on `localhost:27017`; it needs `mongodb-database-tools`
(`sudo dnf install mongodb-database-tools`). Production is never written to and
the `preferences` collection is left untouched; `./sync-dev-db.sh --help` lists
the options. After a sync re-run the better-auth scripts, otherwise nobody can
sign in (see `docs/deployment.md`, Migrations).

## Conventions

- pnpm only (`packageManager` is pinned in each service).
- Backend is CommonJS with `.ts` files executed natively by Node 24; see
  `docs/typescript-guide.md`.
- UI rules: `docs/ux-ui-guide.md`. Dates and timezones:
  `docs/datetime-conventions.md`.
- Data migrations are scripts in `backend/scripts/` registered in
  `backend/scripts/migrate.js`; never run one on production outside the runner
  without `migrate mark` afterwards.
