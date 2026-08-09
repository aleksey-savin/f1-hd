import { fetchConfig } from "./api/backend.ts";
import { tryApi } from "./api/client.ts";
import type { BotConfig } from "./api/types.ts";
import { createBot } from "./bot/index.ts";
import { config } from "./config.ts";
import { markBackendOk, markTelegramOk, startHealthServer } from "./health.ts";
import { logger, setLogLevel } from "./logger.ts";
import { closeDatabase, openDatabase } from "./store/db.ts";
import { pruneDeliveries } from "./store/deliveries.ts";
import { pruneDialogs } from "./store/dialog.ts";
import { announceGuard } from "./util/chatGuard.ts";
import { runBoardCycle } from "./workers/board.ts";
import { runOutboxCycle } from "./workers/outbox.ts";

/**
 * Сборка сервиса.
 *
 * Порядок важен и он последовательный: настройки → база → бот → работники.
 * Прежний бот подключался к Mongo без `await` и тут же запускал опрос Telegram,
 * так что первые обращения к базе спасала только её буферизация, а об ошибке
 * подключения он узнавал из журнала где-то потом.
 */

/**
 * Настройки живут в памяти и обновляются по кругу.
 *
 * Прежний бот читал их ОДИН раз при запуске и жил с этой копией до
 * перезапуска: смена группы уведомлений, часового пояса или срока по умолчанию
 * до него не доезжала.
 */
let botConfig: BotConfig | null = null;

const refreshConfig = async (): Promise<void> => {
  const fresh = await tryApi("получить настройки", () => fetchConfig());
  if (fresh) {
    botConfig = fresh;
    markBackendOk();
  }
};

/**
 * Цикл, который не наслаивается сам на себя и не умирает от одной ошибки.
 *
 * `setInterval` для этого не годится: он запускает следующий проход независимо
 * от того, закончился ли предыдущий, и при медленном ответе бэкенда обходы
 * начинают идти внахлёст.
 */
const loop = (
  name: string,
  intervalMs: number,
  tick: () => Promise<void>,
  stopped: () => boolean,
): Promise<void> => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const run = async (): Promise<void> => {
    while (!stopped()) {
      try {
        await tick();
      } catch (error) {
        logger.error(`Цикл «${name}» упал, продолжаем`, error);
      }
      await sleep(intervalMs);
    }
    logger.info(`Цикл «${name}» остановлен`);
  };

  return run();
};

const main = async (): Promise<void> => {
  setLogLevel(config.logLevel);
  logger.info("Запуск tg-service", {
    backend: config.backendUrl,
    production: config.isProduction,
  });

  announceGuard();
  openDatabase();

  // Настройки нужны до первого обхода табло; без них работать можно, но
  // рисовать нечего.
  await refreshConfig();
  if (!botConfig) {
    logger.warn("Настройки не получены — продолжаем, следующая попытка по кругу");
  }

  const bot = createBot(() => botConfig);

  // Проверяем токен ДО запуска опроса: неверный токен должен быть виден сразу,
  // а не превращаться в бесконечный поток ошибок опроса.
  const me = await bot.api.getMe();
  markTelegramOk();
  logger.info("Бот опознан", { username: me.username });

  const health = startHealthServer();

  let stopping = false;
  const stopped = () => stopping;

  const loops = [
    loop("очередь", config.outboxIntervalMs, async () => {
      await runOutboxCycle(bot);
      markTelegramOk();
      markBackendOk();
    }, stopped),

    loop("табло", config.boardIntervalMs, async () => {
      if (botConfig) await runBoardCycle(bot, botConfig);
    }, stopped),

    loop("настройки", config.configRefreshMs, refreshConfig, stopped),

    // Уборка локальной базы. Раз в час достаточно: записи живут неделю.
    loop("уборка", 60 * 60 * 1000, async () => {
      const deliveries = pruneDeliveries();
      const dialogs = pruneDialogs();
      if (deliveries || dialogs) {
        logger.debug("Убрано из локальной базы", { deliveries, dialogs });
      }
    }, stopped),
  ];

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`Получен ${signal}, останавливаемся`);

    // Порядок обратный запуску: сначала перестаём принимать новое, потом
    // доводим начатое, потом закрываем базу.
    await bot.stop().catch((error: unknown) => logger.warn("Опрос не остановился", error));
    await Promise.allSettled(loops);
    health.close();
    closeDatabase();

    logger.info("Остановлено");
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  // `bot.start()` не возвращается, пока опрос не остановлен.
  await bot.start({
    onStart: () => logger.info("Опрос Telegram запущен"),
  });
};

main().catch((error) => {
  logger.error("Сервис не поднялся", error);
  process.exit(1);
});
