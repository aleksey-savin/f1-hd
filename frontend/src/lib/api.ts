import { clearSession } from "@/pages/Auth/session";

/**
 * Единственная точка выхода в API.
 *
 * До неё запросы писались руками в 309 местах, заголовок `Authorization` — в
 * 299, и на 401 приложение реагировало ТРЕМЯ несогласованными способами:
 *   • загрузчики бросали ответ, `pages/Error.jsx` редиректил на вход — но НЕ
 *     чистил localStorage, и следующий заход утыкался в тот же мёртвый токен;
 *   • три страницы раздела «Пользователи» проверяли `401 || 402` вручную,
 *     причём 402 не возвращает ни одна ручка бэкенда;
 *   • все zustand-сторы глотали 401 в `console.warn` — экран оставался пустым
 *     без единого следа.
 *
 * Базовый адрес пуст: и в деве (vite-прокси), и в проде (nginx) фронт и API
 * живут на одном origin, поэтому URL относительные, а cookie сеанса браузер
 * подставляет сам — `fetch` по умолчанию шлёт `credentials: "same-origin"`.
 */
const BASE = import.meta.env.VITE_API_ADDRESS ?? "";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    // Имя поля не случайно: `pages/Error.jsx` разбирает ошибку по `status`, и
    // ApiError должен быть для него неотличим от брошенного Response.
    this.status = status;
    this.payload = payload;
  }
}

let onUnauthorized: () => void = () => {};

/** Регистрируется один раз при старте приложения (App.jsx). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * Переходный транспорт. Пока часть экранов не переехала на этот клиент, вход
 * кладёт токен сеанса в localStorage, и его же шлём заголовком: плагин
 * `bearer` на бэкенде принимает и его, и cookie — обе дороги ведут в один
 * серверный сеанс. Снимается вместе с плагином, когда мигрирует последний
 * экран.
 */
function bearerHeader(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token && token !== "EXPIRED" ? { Authorization: `Bearer ${token}` } : {};
}

type Options = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Вернуть сырой Response — для скачивания файлов и прочего не-JSON. */
  raw?: boolean;
};

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, headers, signal, raw = false } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await fetch(`${BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    signal,
    headers: {
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...bearerHeader(),
      ...headers,
    },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    clearSession();
    onUnauthorized();
    throw new ApiError(401, null, "Требуется вход");
  }

  if (raw) {
    return response as T;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload,
      (payload as { message?: string } | null)?.message ||
        `Запрос не удался (${response.status})`,
    );
  }

  return response.status === 204 ? (null as T) : ((await response.json()) as T);
}
