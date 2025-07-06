FROM node:current-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Extract version from package.json and set as env variable
RUN export NPM_PACKAGE_VERSION=$(node -p "require('./package.json').version") && \
    echo "VITE_VERSION=$NPM_PACKAGE_VERSION" > .env

RUN pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]
