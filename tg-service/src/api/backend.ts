import { api } from "./client.ts";
import type {
  BoardData,
  BotConfig,
  CreatedTicket,
  DeliveryOutcome,
  OutboxBatch,
  PairingResult,
  TicketList,
  WorkStatusResult,
} from "./types.ts";

/**
 * Именованные вызовы вместо строк с путями по всему коду.
 *
 * Так видно всю поверхность, которой пользуется сервис, — она должна совпадать
 * с закрытым списком в `backend/routes/bot.js`, — и видно, у каких вызовов есть
 * действующее лицо, а у каких нет. Второе важнее первого: `actor` — это разница
 * между «сервис спрашивает» и «человек делает».
 */

export const fetchConfig = () => api<BotConfig>("/api/bot/config");

export const pullOutbox = (limit = 25) =>
  api<OutboxBatch>(`/api/bot/outbox?limit=${limit}`);

export const ackOutbox = (leaseId: string, results: DeliveryOutcome[]) =>
  api<{ applied: number; ignored: number }>("/api/bot/outbox/ack", {
    method: "POST",
    body: { leaseId, results },
  });

export const fetchBoard = () => api<BoardData>("/api/bot/status-board");

export const reportBoardMessage = (
  payload: { messageId: number | null } | { migratedToChatId: string },
) => api<{ message: string }>("/api/bot/status-board/message", {
  method: "POST",
  body: payload,
});

export const claimPairing = (code: string, chatId: number | string) =>
  api<PairingResult>(
    `/api/bot/pairing/claim?chatId=${encodeURIComponent(String(chatId))}&code=${encodeURIComponent(code)}`,
    { method: "POST" },
  );

// --- от имени человека ------------------------------------------------------

export const fetchOpenTickets = (actor: number | string) =>
  api<TicketList>("/api/bot/tickets/open", { actor });

export const setWorkStatus = (actor: number | string, code: string) =>
  api<WorkStatusResult>("/api/bot/work-status", {
    method: "POST",
    body: { code },
    actor,
  });

export const setupStatusBoard = (
  actor: number | string,
  chatId: number | string,
  messageThreadId?: number,
) =>
  api<{ message: string }>("/api/bot/status-board/setup", {
    method: "POST",
    body: { chatId: String(chatId), messageThreadId: messageThreadId ?? "" },
    actor,
  });

export const createTicket = (actor: number | string, form: FormData) =>
  api<CreatedTicket>("/api/bot/tickets", {
    method: "POST",
    body: form,
    actor,
    // Вложение может быть крупным, а идёт оно через нас в бэкенд и дальше в S3.
    timeoutMs: 60_000,
  });
