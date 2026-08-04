FROM node:lts-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# App version is injected by vite.config.js straight from package.json — no .env
# here: in dev the whole /app is shadowed by the bind mount anyway.

RUN pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]
