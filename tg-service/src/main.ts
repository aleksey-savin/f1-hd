import { GrammyError } from "grammy";
import type { Bot } from "grammy";

import { fetchConfig, reportIdentity } from "./api/backend.ts";
import { tryApi } from "./api/client.ts";
import type { BotConfig } from "./api/types.ts";
import { createBot } from "./bot/index.ts";
import { config } from "./config.ts";
import { markBackendOk, markTelegramOk, startHealthServer } from "./health.ts";
import { logger, setLogLevel } from "./logger.ts";
import { closeDatabase, openDatabase } from "./store/db.ts";
import { pruneDeliveries } from "./store/deliveries.ts";
import { pruneDialogs } from "./store/dialog.ts";
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

/**
 * Имя бота из getMe. Сервер хранит его для ссылки привязки во фронте; сверяем
 * при каждом обновлении настроек и досылаем при расхождении — так значение
 * переживает и смену токена, и перезапись настроек из формы.
 */
let botUsername: string | null = null;

const refreshConfig = async (): Promise<void> => {
  const fresh = await tryApi("fetch configuration", () => fetchConfig());
  if (fresh) {
    botConfig = fresh;
    markBackendOk();
    if (botUsername && fresh.telegram.botUsername !== botUsername) {
      const username = botUsername;
      await tryApi("report bot identity", () => reportIdentity(username));
    }
  }
};

/**
 * Цикл, который не наслаивается сам на себя и не умирает от одной ошибки.
 *
 * `setInterval` для этого не годится: он запускает следующий проход независимо
 * от того, закончился ли предыдущий, и при медленном ответе бэкенда обходы
 * начинают идти внахлёст.
 *
 * ПАУЗА ПРЕРЫВАЕМАЯ, и это не мелочь. Пока она была обычным `setTimeout`,
 * выключение ждало, пока цикл досыпит текущий интервал: у настроек это минута, у
 * уборки — ЧАС. На SIGTERM сервис послушно писал «Loop stopped» через сорок
 * секунд и добирал остальное уже после SIGKILL, то есть «мягкая остановка»
 * мягкой не была. Теперь сон гонится с общим сигналом остановки и рвётся сразу.
 */
const loop = (
  name: string,
  intervalMs: number,
  tick: () => Promise<void>,
  stopped: () => boolean,
  interrupted: Promise<void>,
): Promise<void> => {
  const run = async (): Promise<void> => {
    while (!stopped()) {
      try {
        await tick();
      } catch (error) {
        logger.error(`Loop "${name}" threw, continuing`, error);
      }
      if (stopped()) break;
      await Promise.race([sleep(intervalMs), interrupted]);
    }
    logger.info(`Loop "${name}" stopped`);
  };

  return run();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Сколько максимум длится остановка. Дальше выходим в любом случае. */
const SHUTDOWN_DEADLINE_MS = 3000;

/**
 * Знакомство с Telegram на старте — с повторами, и НЕ фатальное.
 *
 * Раньше здесь стоял голый `getMe()`, и первый же неответ сети валил сервис
 * целиком: контейнер поднимается раньше, чем у него появляется DNS и маршрут,
 * поэтому «не поднялся» означало не поломку, а слишком раннюю попытку.
 *
 * Отличаем два разных случая. Отказ Telegram (`GrammyError` — например,
 * неверный токен) это ошибка настройки: повторять её бессмысленно, падаем сразу
 * и с внятной причиной. Сетевой сбой — временный: пробуем несколько раз, а если
 * так и не достучались, всё равно продолжаем. Опрос переподключается сам, и
 * молчащий сервис виден в `/health` — это честнее, чем перезапускаться по кругу.
 */
const identifyBot = async (bot: Bot): Promise<void> => {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const me = await bot.api.getMe();
      botUsername = me.username ?? null;
      markTelegramOk();
      logger.info("Bot identified", { username: me.username });
      return;
    } catch (error) {
      if (error instanceof GrammyError) {
        throw error;
      }
      if (attempt >= MAX_ATTEMPTS) {
        logger.warn(
          "Telegram unreachable at startup, polling will keep retrying",
          error,
        );
        return;
      }
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 15_000);
      logger.warn("Telegram unreachable, retrying", { attempt, waitMs });
      await sleep(waitMs);
    }
  }
};

const main = async (): Promise<void> => {
  setLogLevel(config.logLevel);
  logger.info("Starting tg-service", {
    backend: config.backendUrl,
    production: config.isProduction,
  });

  openDatabase();

  // Сначала знакомство с Telegram, потом настройки: первый же `refreshConfig`
  // сверит имя бота с тем, что знает сервер, и дошлёт его при расхождении.
  const bot = createBot(() => botConfig);
  await identifyBot(bot);

  // Настройки нужны до первого обхода табло; без них работать можно, но
  // рисовать нечего.
  await refreshConfig();
  if (!botConfig) {
    logger.warn("Configuration not fetched yet, will retry on the next cycle");
  }

  const health = startHealthServer();

  let stopping = false;
  const stopped = () => stopping;

  /**
   * Общий сигнал «пора заканчивать»: один промис на все циклы, который они
   * гонят со своим сном. Разбудить их иначе нечем — таймер уже поставлен.
   */
  let wakeAll: () => void = () => {};
  const interrupted = new Promise<void>((resolve) => {
    wakeAll = resolve;
  });

  const loops = [
    loop("outbox", config.outboxIntervalMs, async () => {
      await runOutboxCycle(bot);
      markTelegramOk();
      markBackendOk();
    }, stopped, interrupted),

    loop("status-board", config.boardIntervalMs, async () => {
      if (botConfig) await runBoardCycle(bot, botConfig);
    }, stopped, interrupted),

    loop("config", config.configRefreshMs, refreshConfig, stopped, interrupted),

    // Уборка локальной базы. Раз в час достаточно: записи живут неделю.
    loop("prune", 60 * 60 * 1000, async () => {
      const deliveries = pruneDeliveries();
      const dialogs = pruneDialogs();
      if (deliveries || dialogs) {
        logger.debug("Pruned local database", { deliveries, dialogs });
      }
    }, stopped, interrupted),
  ];

  /**
   * Остановка ОГРАНИЧЕНА ПО ВРЕМЕНИ, и это главное её свойство.
   *
   * Прежний бот обработчика сигналов не имел вовсе: его убивали, он тут же
   * поднимался. Я добавил мягкую остановку — и она превратилась в способ НЕ
   * завершиться: `allSettled` ждал все циклы, а цикл уборки спит час, поэтому
   * после SIGTERM процесс не выходил, а значит и не перезапускался.
   *
   * Аккуратно доводить дела приятно, но останавливаться обязательно. Поэтому
   * сначала ставится будильник на выход, и только потом делается всё остальное:
   * что не успело за отведённое время — не успело.
   */
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${signal}, shutting down`);

    const forceExit = setTimeout(() => {
      logger.warn("Shutdown took too long, exiting anyway");
      process.exit(0);
    }, SHUTDOWN_DEADLINE_MS);

    // Будим спящие циклы: без этого каждый досыпает свой интервал.
    wakeAll();

    // Порядок обратный запуску: сначала перестаём принимать новое, потом
    // доводим начатое, потом закрываем базу.
    //
    // Каждый шаг со своей обработкой: неудача опроса не должна отменять уборку.
    // В общем `try` падение `bot.stop()` уносило и закрытие базы — а её надо
    // закрыть в любом случае, иначе WAL остаётся неподведённым.
    await bot
      .stop()
      .catch((error: unknown) => logger.warn("Polling did not stop cleanly", error));

    await Promise.allSettled(loops);

    try {
      health.close();
      closeDatabase();
    } catch (error) {
      logger.warn("Cleanup was not clean", error);
    }

    clearTimeout(forceExit);
    logger.info("Stopped");
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  /**
   * `bot.start()` не возвращается, пока опрос не остановлен, — и при остановке
   * ОТКЛОНЯЕТСЯ, а не завершается.
   *
   * `bot.stop()` рвёт ожидание сигналом отмены, и `start()` падает с «Aborted
   * delay». Это штатный конец опроса, но необработанным он долетал до
   * `main().catch()`, тот писал «Service failed to start» и выходил с кодом 1 —
   * то есть моя же остановка убивала процесс как аварию, ещё и не дав
   * остановке доработать. `node --watch` на ненулевой выход перезапуск не
   * делает, поэтому сервис оставался лежать.
   */
  await bot
    .start({ onStart: () => logger.info("Telegram polling started") })
    .catch((error: unknown) => {
      if (stopping) return;
      throw error;
    });
};

main().catch((error) => {
  logger.error("Service failed to start", error);
  process.exit(1);
});
