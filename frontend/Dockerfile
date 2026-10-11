# Frontend image. Two targets:
#   dev  — Vite dev server with the proxy to the backend (compose.dev.yml)
#   prod — static build served by nginx (unprivileged image, listens on 8080)
#
# Two build arguments, the build identity; the bundle is otherwise the same for
# every installation. API calls are relative (frontend/.env.production sets
# VITE_API_ADDRESS to empty) because the same nginx serves the app and proxies
# /api and /uploads to the backend.
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
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
ENV APP_VERSION=$APP_VERSION APP_COMMIT=$APP_COMMIT
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS prod
# nginx.conf is a template: the image's entrypoint (20-envsubst-on-templates.sh)
# renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at start and
# replaces only variables that are defined in the environment. The empty default
# keeps SENTRY_CSP_ORIGIN defined when compose passes nothing, and the filter
# limits the substitution to that single name.
ENV SENTRY_CSP_ORIGIN="" \
    NGINX_ENVSUBST_FILTER="^SENTRY_CSP_ORIGIN\$"
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=root LICENSE /LICENSE
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_COMMIT
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
