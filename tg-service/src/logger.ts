/**
 * Журнал — JSON в stdout, и всё.
 *
 * Прежний бот писал winston с ротацией в собственный каталог `logs/`, который
 * рос внутри контейнера и читался только через `docker exec`. Для сервиса,
 * который должен разворачиваться где угодно, правильный сток — stdout: его
 * забирает `docker logs`, journald или что там стоит на той машине. Заодно
 * уходят две зависимости, а вместе с ними — падение процесса, когда файл
 * журнала оказывается чужим (ровно это ловится на этой машине).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;

export type LogLevel = keyof typeof LEVELS;

const isLevel = (value: string): value is LogLevel => value in LEVELS;

let threshold: number = LEVELS.info;

export const setLogLevel = (level: string): void => {
  threshold = isLevel(level) ? LEVELS[level] : LEVELS.info;
};

const write = (level: LogLevel, message: string, meta?: unknown): void => {
  if (LEVELS[level] > threshold) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
  };

  if (meta !== undefined) {
    // Ошибку разворачиваем руками: JSON.stringify отдаёт от Error пустой
    // объект, и в журнале оставалось бы `{}` вместо причины.
    line.meta =
      meta instanceof Error
        ? { error: meta.message, stack: meta.stack }
        : meta;
  }

  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
};

export const logger = {
  error: (message: string, meta?: unknown) => write("error", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  info: (message: string, meta?: unknown) => write("info", message, meta),
  debug: (message: string, meta?: unknown) => write("debug", message, meta),
};
