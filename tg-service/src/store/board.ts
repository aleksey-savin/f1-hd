import { getDatabase } from "./db.ts";

/**
 * Что уже нарисовано на табло.
 *
 * Хранится ХЕШ отрисованного текста, а не сам текст: сравнение нужно только
 * чтобы не звать `editMessageText` впустую — Telegram на неизменённый текст
 * отвечает ошибкой «message is not modified», и прежний бот держал ради этого
 * полную копию сообщения в общей базе (`preferences.statusBoard.lastText`).
 *
 * `messageId` тут НЕ хранится намеренно: он про общий чат, а не про этот
 * процесс, и живёт на бэкенде — иначе администратор не смог бы пересоздать
 * табло из веб-настроек, а второй экземпляр сервиса нарисовал бы второе.
 */

export const getRenderedHash = (chatId: string): string | null => {
  const row = getDatabase()
    .prepare("SELECT rendered_hash FROM board_state WHERE chat_id = ?")
    .get(chatId) as { rendered_hash: string } | undefined;

  return row?.rendered_hash ?? null;
};

export const setRenderedHash = (chatId: string, hash: string): void => {
  getDatabase()
    .prepare(
      `INSERT INTO board_state (chat_id, rendered_hash, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET rendered_hash = excluded.rendered_hash,
                                          updated_at    = excluded.updated_at`,
    )
    .run(chatId, hash, new Date().toISOString());
};

export const forgetBoard = (chatId: string): void => {
  getDatabase().prepare("DELETE FROM board_state WHERE chat_id = ?").run(chatId);
};
