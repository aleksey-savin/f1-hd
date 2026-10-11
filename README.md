# HD

Proprietary software — see [LICENSE](LICENSE).

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
├── check.sh          # every quality gate in a container (ci/ holds its parts)
├── VERSION           # version of the tree; CHANGELOG.md lists the releases
├── ops/              # internal tooling (copy production into dev) — see ops/README.md
└── docs/             # implementation notes; docs/deployment.md for operations
```

## Production

Any Linux host with bash 4.4 or newer, curl and openssl. Docker is installed by
the script if missing (Debian/Ubuntu via apt, Fedora/RHEL/Alma via dnf); a
Docker that is already there needs BuildKit (the default since Docker 23) and
the Compose plugin 2.17 or newer.

```bash
git clone <repo> hd && cd hd
sudo ./deploy.sh
```

The first run asks for the public URL, the administrator's e-mail and an
optional Telegram bot token, generates every secret into `.env`, builds the
images, starts the stack and prints the generated administrator password once
(later: `docker compose logs backend | grep Пароль`). The app listens on port 8080 (plain
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

`./check.sh` runs every gate (lint, typecheck, tests, build, dependency audit) in a
container and is what a release must pass; `./check.sh backend` runs one part,
`./check.sh images` builds the production images and inspects their contents.
Where containers on Docker's default network cannot resolve names, name a network
that can: `CHECK_DOCKER_NETWORK=host ./check.sh`.

Per-service scripts (`cd backend|frontend|tg-service`):

```bash
pnpm dev          # backend: nodemon; frontend: vite
pnpm start        # tg-service: node --watch
pnpm lint         # backend, frontend
pnpm typecheck    # all three
pnpm test         # all three (node --test)
pnpm build        # frontend
```

### Copy the production database

Internal tooling, described in `ops/README.md`: `ops/sync-dev-db.sh` fills the
local database from another installation (masked by default).

## Conventions

- pnpm only (`packageManager` is pinned in each service).
- Backend is CommonJS with `.ts` files executed natively by Node 24; see
  `docs/typescript-guide.md`.
- UI rules: `docs/ux-ui-guide.md`. Dates and timezones:
  `docs/datetime-conventions.md`.
- Phone numbers are stored as canonical digits and formatted only for display:
  `docs/phone-numbers.md`.
- Data migrations are scripts in `backend/scripts/` registered in
  `backend/scripts/migrate.js`; never run one on production outside the runner
  without `migrate mark` afterwards.
