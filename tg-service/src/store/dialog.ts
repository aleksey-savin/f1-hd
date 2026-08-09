import { getDatabase } from "./db.ts";

/**
 * На каком шаге человек.
 *
 * Сейчас шаг ровно один — «предложили завести заявку, ждём да/нет», — и раньше
 * он жил в замыкании модуля: перезапуск сервиса терял его молча, а в группе два
 * человека делили одно значение на всех. Ключ здесь — telegram-идентификатор
 * ЧЕЛОВЕКА, а не чата, и это тот же принцип, что во всём сервисе: чат — это
 * комната, действует в ней кто-то конкретный.
 */

export type DialogStep = "confirm-ticket";

export type Dialog = {
  step: DialogStep;
  payload: { description: string; photoFileId?: string };
};

const TTL_MS = 30 * 60 * 1000;

export const setDialog = (tgUserId: string | number, dialog: Dialog): void => {
  getDatabase()
    .prepare(
      `INSERT INTO dialog (tg_user_id, step, payload, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tg_user_id) DO UPDATE SET step       = excluded.step,
                                             payload    = excluded.payload,
                                             expires_at = excluded.expires_at`,
    )
    .run(
      String(tgUserId),
      dialog.step,
      JSON.stringify(dialog.payload),
      new Date(Date.now() + TTL_MS).toISOString(),
    );
};

export const getDialog = (tgUserId: string | number): Dialog | null => {
  const row = getDatabase()
    .prepare("SELECT step, payload, expires_at FROM dialog WHERE tg_user_id = ?")
    .get(String(tgUserId)) as
    | { step: string; payload: string | null; expires_at: string }
    | undefined;

  if (!row) return null;

  // Срок проверяем сами: своей уборки у SQLite нет, а забытый вчера черновик
  // не должен всплыть ответом «да» на сегодняшний вопрос.
  if (new Date(row.expires_at) < new Date()) {
    clearDialog(tgUserId);
    return null;
  }

  if (row.step !== "confirm-ticket") return null;

  try {
    const payload: unknown = JSON.parse(row.payload || "{}");
    const description = (payload as { description?: unknown }).description;
    if (typeof description !== "string") return null;

    const photoFileId = (payload as { photoFileId?: unknown }).photoFileId;
    return {
      step: "confirm-ticket",
      payload: {
        description,
        ...(typeof photoFileId === "string" ? { photoFileId } : {}),
      },
    };
  } catch {
    return null;
  }
};

export const clearDialog = (tgUserId: string | number): void => {
  getDatabase().prepare("DELETE FROM dialog WHERE tg_user_id = ?").run(String(tgUserId));
};

export const pruneDialogs = (): number => {
  const result = getDatabase()
    .prepare("DELETE FROM dialog WHERE expires_at < ?")
    .run(new Date().toISOString());
  return Number(result.changes);
};
