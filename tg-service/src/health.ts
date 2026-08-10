import { createServer, type Server } from "node:http";

import { config } from "./config.ts";
import { logger } from "./logger.ts";

/**
 * Проверка здоровья, которая может провалиться.
 *
 * У прежнего бота healthcheck был `node -e "process.exit(0)"` — то есть
 * контейнер считался живым всегда, в том числе когда бот молчал сутки.
 * Здоровым считаем только то состояние, в котором обе связи работали недавно:
 * ответ Telegram и ответ бэкенда.
 */

const STALE_MS = 5 * 60 * 1000;

const state = {
  telegramOkAt: 0,
  backendOkAt: 0,
  startedAt: Date.now(),
};

export const markTelegramOk = (): void => {
  state.telegramOkAt = Date.now();
};

export const markBackendOk = (): void => {
  state.backendOkAt = Date.now();
};

export const startHealthServer = (): Server => {
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }

    const now = Date.now();
    // Пока сервис только поднялся, отметок ещё нет — это не повод считать его
    // больным, иначе контейнер перезапускался бы по кругу.
    const warmingUp = now - state.startedAt < STALE_MS;
    const telegramFresh = now - state.telegramOkAt < STALE_MS;
    const backendFresh = now - state.backendOkAt < STALE_MS;
    const healthy = warmingUp || (telegramFresh && backendFresh);

    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "degraded",
        telegramOkAt: state.telegramOkAt || null,
        backendOkAt: state.backendOkAt || null,
      }),
    );
  });

  // Только петля: наружу сервису слушать нечего, входящих портов у него нет.
  server.listen(config.healthPort, "127.0.0.1", () => {
    logger.info("Health endpoint listening", { port: config.healthPort });
  });

  return server;
};
