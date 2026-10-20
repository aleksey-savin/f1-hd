import { api } from "@/lib/api";
import type { InventoryChangeView } from "@/types/inventoryChange";

// Предложения ИИ-агентов по инвентарю: вызовы API страницы предложения и блока
// «Главной». Состояния здесь нет — страницу читает загрузчик маршрута. Ошибки
// приходят ApiError с текстом сервера в `message` (403/409/410).

const BASE = "/api/inventory/changes";

/** Сырой ответ — загрузчику маршрута нужны заголовок пульса и статус для 404. */
export const fetchChangeResponse = (id: string): Promise<Response> =>
  api<Response>(`${BASE}/${id}`, { raw: true });

export const decideChange = (
  id: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<InventoryChangeView> =>
  api<InventoryChangeView>(`${BASE}/${id}/decision`, {
    method: "POST",
    body: comment ? { decision, comment } : { decision },
  });

/** Предложения, где решение сейчас за вошедшим (блок «Главной»). */
export const fetchAwaitingMe = (): Promise<InventoryChangeView[]> =>
  api<InventoryChangeView[]>(`${BASE}/awaiting-me`);
