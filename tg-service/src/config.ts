/**
 * Окружение разбирается ОДИН раз и на старте.
 *
 * Падать надо здесь и с именем переменной, а не через полчаса работы на первом
 * запросе: прежний бот подключался к Mongo без `await`, запускал опрос Telegram
 * параллельно и о неверных настройках узнавал уже в бою.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return value;
};

const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} должно быть положительным числом, получено "${raw}"`);
  }
  return parsed;
};

export const config = {
  /** Токен бота у BotFather. */
  botToken: required("TG_TOKEN"),

  /**
   * Общий секрет с бэкендом. Имя оставлено прежним (`TG_API_TOKEN`), потому что
   * его же читает `backend/middleware/isTelegramBot`: переименование стоило бы
   * синхронной правки окружения на обеих сторонах и ничего бы не дало.
   */
  serviceToken: required("TG_API_TOKEN"),

  /** База API. Внутри compose — `http://backend:8080`, снаружи — `https://…`. */
  backendUrl: required("BACKEND_URL").replace(/\/+$/, ""),

  /** Единственное состояние сервиса. Каталог должен быть в томе. */
  dbPath: process.env.TG_DB_PATH || "./data/tg-service.db",

  /** Адрес портала для кнопки «Подробнее». Пусто — кнопки не будет. */
  appUrl: (process.env.ADDRESS || "").replace(/\/+$/, ""),

  isProduction: process.env.NODE_ENV === "production",

  /**
   * Куда уводить уведомления вне прода. Пусто — не отправлять вовсе: молчание
   * безопаснее сообщения чужому человеку (см. util/chatGuard).
   */
  devChatId: process.env.DEV_TELEGRAM_CHAT_ID || null,

  /** Как часто спрашивать очередь. Прежний бот ходил раз в 20 секунд. */
  outboxIntervalMs: number("OUTBOX_INTERVAL_MS", 5_000),

  /** Как часто перерисовывать табло статусов. */
  boardIntervalMs: number("BOARD_INTERVAL_MS", 20_000),

  /** Как часто перечитывать настройки с бэкенда. */
  configRefreshMs: number("CONFIG_REFRESH_MS", 60_000),

  /** Порт для `/health`. Слушается только для healthcheck контейнера. */
  healthPort: number("HEALTH_PORT", 8081),

  logLevel: process.env.LOG_LEVEL || "info",
} as const;

export type Config = typeof config;
