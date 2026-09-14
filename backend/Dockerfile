# Backend image. Two targets:
#   dev  — nodemon, bind-mounted sources (compose.dev.yml)
#   prod — production deps only, runs as `node`, healthcheck built in
#
# Node 24 executes the .ts files by stripping types, so there is no build step.
# `corepack install` reads the pnpm version pinned in package.json
# (`packageManager`), so the image and the developers use the same pnpm.
# `--ignore-scripts` skips the repo's own `prepare` (husky) — no dependency
# here needs a build script (bcryptjs is pure JS; ssh2's native helper is optional).
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

FROM base AS dev
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
EXPOSE 8080
CMD ["pnpm", "dev"]

FROM base AS deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
# uploads/ and storage/ are volumes in compose; the mount point must belong to
# the user that writes there, or the first upload fails with EACCES.
RUN mkdir -p uploads storage && chown node:node uploads storage
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "app.js"]
