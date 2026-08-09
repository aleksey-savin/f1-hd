import { getDatabase } from "./db.ts";

/**
 * Что уже доставлено.
 *
 * Это ЕДИНСТВЕННАЯ защита от повторной отправки, и вот почему она обязана быть
 * локальной. Порядок такой: взять аренду → отправить в Telegram → подтвердить
 * бэкенду. Между вторым и третьим шагом сервис может умереть; аренда протухнет,
 * и очередь честно предложит уведомление снова. Без этой таблицы человек получил
 * бы его дважды — у Telegram своей идемпотентности нет, повтор ничем не отличим
 * от новой отправки.
 *
 * С таблицей повтор дешёвый: видим запись — не отправляем, а сразу подтверждаем
 * тем же `tg_message_id`.
 */

export type Delivery = { notificationId: string; tgMessageId: number | null };

export const wasDelivered = (notificationId: string): Delivery | null => {
  const row = getDatabase()
    .prepare("SELECT notification_id, tg_message_id FROM sent_outbox WHERE notification_id = ?")
    .get(notificationId) as
    | { notification_id: string; tg_message_id: number | null }
    | undefined;

  return row
    ? { notificationId: row.notification_id, tgMessageId: row.tg_message_id }
    : null;
};

export const recordDelivery = (notificationId: string, tgMessageId: number): void => {
  getDatabase()
    .prepare(
      `INSERT INTO sent_outbox (notification_id, tg_message_id, sent_at)
       VALUES (?, ?, ?)
       ON CONFLICT(notification_id) DO NOTHING`,
    )
    .run(notificationId, tgMessageId, new Date().toISOString());
};

/**
 * Уборка. Запись нужна ровно до тех пор, пока очередь может предложить это
 * уведомление снова, то есть считанные минуты; неделя — с многократным запасом,
 * зато файл не растёт вечно.
 */
export const pruneDeliveries = (olderThanDays = 7): number => {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const result = getDatabase()
    .prepare("DELETE FROM sent_outbox WHERE sent_at < ?")
    .run(cutoff);
  return Number(result.changes);
};
