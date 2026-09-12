/**
 * «Видел ли человек заявку»: движение заявки и личный водяной знак.
 *
 * Непрочитанное считается из двух вещей, и обе живут здесь:
 *   • `ticket.activity {at, by}` — когда и кто последний раз ДВИГАЛ заявку
 *     (событие жизненного цикла или комментарий). Ставит хук `pre("save")`
 *     заявки по предикату `shouldBumpActivity` и хук комментария; ни один из
 *     двух десятков контроллеров об этом не знает.
 *   • `TicketRead {userId, ticketId, seenAt}` — когда человек последний раз
 *     открывал заявку. Ставит страница заявки (`POST /tickets/:num/seen`) и
 *     сервер после действий, при которых человек заявку не открывает
 *     (массовые действия из списка, свой комментарий).
 *
 * Почему не `updatedAt`: его бумкает любое машинное касание — ИИ, крон
 * уведомлений, мониторинг (см. services/ticketActivity.js). Почему не хроника
 * (`TicketLog`): у её записей нет идентификатора автора, а «своё движение —
 * не новое» без автора не выразить.
 *
 * Модели подключаются внутри функций: предикат чистый и тестируется без базы.
 */

/**
 * Считать ли сохранение заявки движением.
 *
 * Каждое событие жизненного цикла переприсваивает `ticket.notifications =
 * { lastAction, pending: true }` целиком — это и есть признак. Крон
 * уведомлений сохраняет ту же заявку, снимая `pending` (и ставя защёлки
 * `isNotified`), и движением это быть не должно. Повтор того же действия
 * (обработана дважды подряд) меняет только `pending` с false на true — тоже
 * движение.
 */
const shouldBumpActivity = (doc) => {
  if (doc.isNew) return true;
  if (doc.isModified("notifications.lastAction")) return true;
  return (
    doc.isModified("notifications.pending") &&
    doc.notifications?.pending === true
  );
};

const TicketRead = () => require("@/models/ticketRead");
const InAppNotification = () => require("@/models/inAppNotification");

/** Отметить несколько заявок просмотренными (массовые действия, «Отметить прочитанными»). */
const markSeen = async (userId, ticketIds, at = new Date()) => {
  const ids = [...new Set((ticketIds || []).map((id) => String(id)))];
  if (!ids.length) return 0;
  await TicketRead().bulkWrite(
    ids.map((ticketId) => ({
      updateOne: {
        filter: { userId, ticketId },
        update: { $set: { seenAt: at } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return ids.length;
};

/**
 * Отметить одну заявку просмотренной; возвращает прежний водяной знак — по
 * нему хроника проводит черту «Новые». Первое открытие могут сделать два
 * запроса одновременно (монтирование страницы и опрос) — второй упрётся в
 * уникальный индекс, поэтому одна повторная попытка.
 */
const markTicketSeen = async (userId, ticketId, at = new Date()) => {
  const attempt = () =>
    TicketRead()
      .findOneAndUpdate(
        { userId, ticketId },
        { $set: { seenAt: at } },
        { upsert: true, new: false },
      )
      .lean();
  let previous;
  try {
    previous = await attempt();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    previous = await attempt();
  }
  return { seenAt: at, previousSeenAt: previous?.seenAt ?? null };
};

/**
 * Прочитать уведомления колокольчика: по заявке, по списку или все. Без
 * условия ничего не трогаем — «прочитать всё» должно быть сказано явно.
 */
const markInboxRead = async (
  userId,
  { ticketId, ticketIds, ids, all } = {},
) => {
  const filter = { userId, readAt: null };
  if (ticketId) filter.ticketId = ticketId;
  else if (Array.isArray(ticketIds)) {
    if (!ticketIds.length) return 0;
    filter.ticketId = { $in: ticketIds };
  } else if (Array.isArray(ids)) {
    if (!ids.length) return 0;
    filter._id = { $in: ids };
  } else if (!all) return 0;
  const result = await InAppNotification().updateMany(filter, {
    $set: { readAt: new Date() },
  });
  return result.modifiedCount ?? 0;
};

const unreadCount = (userId) =>
  InAppNotification().countDocuments({ userId, readAt: null });

module.exports = {
  shouldBumpActivity,
  markSeen,
  markTicketSeen,
  markInboxRead,
  unreadCount,
};
