import { config } from "../config.ts";
import { logger } from "../logger.ts";

/**
 * Единственная дверь в бэкенд.
 *
 * Раньше её не было: адрес `http://backend:8080` стоял вписанным в четырёх
 * местах, параметры уезжали строкой запроса, ответы не проверялись, а ошибки
 * молча превращались в `undefined`, который вызывающий принимал за пустой
 * список. Отсюда же следовала невозможность переезда — имя `backend` есть
 * только внутри compose.
 *
 * Здесь же живёт ЕДИНСТВЕННОЕ приведение типа во всём сервисе: `response.json()`
 * приходит как `unknown`, и мы говорим, чем он должен быть, ровно на границе.
 */

export class BackendError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.payload = payload;
  }
}

type RequestOptions = {
  method?: string;
  /** Тело: объект уедет JSON-ом, FormData — как есть (вложения). */
  body?: unknown;
  /**
   * Telegram-идентификатор человека, от чьего имени идёт действие.
   *
   * Мы НЕ утверждаем, кто это в приложении, — только пересказываем, кто пишет
   * боту. Учётку по нему находит бэкенд (`attachTelegramActor`), он же решает,
   * разрешено ли ей действие. Поэтому у сервиса нет и не должно быть ни одного
   * пользовательского удостоверения: украденный вместе с машиной файл базы не
   * даёт входа в портал.
   */
  actor?: string | number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, actor, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const isForm = body instanceof FormData;

  const headers: Record<string, string> = {
    "X-TG-Token": config.serviceToken,
  };
  if (actor !== undefined) {
    headers["X-TG-Actor"] = String(actor);
  }
  if (body !== undefined && !isForm) {
    headers["Content-Type"] = "application/json";
  }

  // Без таймаута зависший бэкенд останавливает и очередь, и табло: у fetch
  // своего предела нет.
  const abort = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.backendUrl}${path}`, {
      method,
      headers,
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: abort,
    });
  } catch (error) {
    // Сеть и таймаут — это «повторим», а не «ответ такой».
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackendError(0, null, `Backend unreachable: ${reason}`);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      (payload as { message?: string } | null)?.message ||
      `Request failed (${response.status})`;
    throw new BackendError(response.status, payload, message);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

/** Сетевой сбой и 5xx повторимы; 4xx — нет, второй такой же запрос не поможет. */
export const isRetryable = (error: unknown): boolean =>
  error instanceof BackendError && (error.status === 0 || error.status >= 500);

/**
 * Обёртка для фоновых работников: ошибка бэкенда не должна ронять цикл, но
 * обязана быть видна. Возвращает `null` — вызывающий сам решает, что это значит.
 */
export async function tryApi<T>(
  what: string,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    logger.warn(`Failed to ${what}`, error);
    return null;
  }
}
