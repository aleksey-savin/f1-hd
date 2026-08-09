# Дев-образ. Сборки нет: Node исполняет .ts, стирая типы, поэтому и билдера нет.
FROM node:24-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

COPY . .

# Файл SQLite лежит в томе; каталог создаём заранее, чтобы владельцем был node.
RUN mkdir -p data

CMD ["pnpm", "start"]
