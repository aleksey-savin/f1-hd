# Telegram service image. Two targets:
#   dev  — `node --watch`, bind-mounted sources (compose.dev.yml)
#   prod — production deps only, runs as `node`, healthcheck built in
#
# No build step: Node executes the .ts files by stripping types. No compiler in
# the image either — state lives in the built-in `node:sqlite`, not in a native
# module that would need python3/make/g++ on musl.
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

FROM base AS dev
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p data
CMD ["pnpm", "start"]

FROM base AS deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# The SQLite file lives in a volume; its mount point must belong to the user
# that runs the process, or the first write fails with EACCES.
RUN mkdir -p data && chown -R node:node /app
COPY --from=root LICENSE /LICENSE
# Last layer on purpose: the identity changes with every commit, the layers
# above it do not. The file is written by root after the chown and is
# world-readable, which is all the process needs.
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_COMMIT
RUN printf '{"version":"%s","commit":"%s"}\n' "$APP_VERSION" "$APP_COMMIT" > build-info.json
USER node
# A real check: the old bot's healthcheck was `process.exit(0)`, i.e. always green.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HEALTH_PORT||8081)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/main.ts"]
