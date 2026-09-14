# Frontend image. Two targets:
#   dev  — Vite dev server with the proxy to the backend (compose.dev.yml)
#   prod — static build served by nginx (unprivileged image, listens on 8080)
#
# No build arguments: the bundle is the same for every installation. API calls
# are relative (frontend/.env.production sets VITE_API_ADDRESS to empty) because
# the same nginx serves the app and proxies /api and /uploads to the backend.
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

FROM base AS dev
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
