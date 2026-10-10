import { api, ApiError } from "@/lib/api";
import type { ChangeView } from "@/types/mikrotikChange";

// Запросы ИИ-агентов на изменение Mikrotik: вызовы API страницы запроса и
// раздела «Изменения». Состояния здесь нет — страница читает запрос загрузчиком
// маршрута, раздел держит список у себя. Ошибки приходят ApiError с текстом
// сервера в `message` (403/409/410 — «не ваш шаг», «уже решён», «срок вышел»).

const BASE = "/api/inventory";

/** Сырой ответ — загрузчику маршрута нужны заголовок пульса и статус для 404. */
export const fetchChangeResponse = (id: string): Promise<Response> =>
  api<Response>(`${BASE}/mikrotik-changes/${id}`, { raw: true });

export const fetchRecordChanges = (recordId: string): Promise<ChangeView[]> =>
  api<ChangeView[]>(`${BASE}/mikrotik-devices/records/${recordId}/changes`);

export const decideChange = (
  id: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<ChangeView> =>
  api<ChangeView>(`${BASE}/mikrotik-changes/${id}/decision`, {
    method: "POST",
    body: comment ? { decision, comment } : { decision },
  });

export const cancelChange = (id: string): Promise<ChangeView> =>
  api<ChangeView>(`${BASE}/mikrotik-changes/${id}/cancel`, { method: "POST" });

/**
 * Текст конфигурации WireGuard для сотрудника. Приватный ключ внутри:
 * вызывающий держит результат только в состоянии компонента — не в сторе, не в
 * localStorage. Каждое чтение сервер записывает в хронику запроса; `via: "qr"` помечает показ QR (отдельная запись, не «Скачана»).
 */
export const fetchWireguardConfig = async (
  id: string,
  via?: "qr",
): Promise<string> => {
  const response = await api<Response>(
    `${BASE}/mikrotik-changes/${id}/wireguard.conf${via ? `?via=${via}` : ""}`,
    { raw: true },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(
      response.status,
      payload,
      payload?.message || "Не удалось получить конфигурацию",
    );
  }
  return response.text();
};

/** Отдать браузеру текст как файл. */
export const saveTextFile = (fileName: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Адрес отзываем не сразу: часть браузеров начинает скачивание после возврата из click()
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Запросы, где решение сейчас за вошедшим (блок «Главной»). */
export const fetchAwaitingMe = (): Promise<ChangeView[]> =>
  api<ChangeView[]>(`${BASE}/mikrotik-changes/awaiting-me`);
