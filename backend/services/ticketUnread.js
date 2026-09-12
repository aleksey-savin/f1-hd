/**
 * Непрочитанное по заявке для списков: точка у строки и «N новых».
 *
 * Считается сервером из `ticket.activity` (см. services/ticketSeen.js) и
 * личного водяного знака `TicketRead.seenAt`; фронт получает готовое
 * `unread: { isUnseen, newComments }` и ничего не вычисляет — иначе главная
 * клиента, список сотрудника и блоки главной считали бы по-разному.
 *
 * Правила:
 *   • своё движение не новое: `activity.by === я` → прочитано;
 *   • чужое движение по заявке, которую ни разу не открывал, — непрочитано,
 *     но без счётчика: «сколько новых» имеет смысл только от последнего
 *     визита, а не «с сотворения заявки»;
 *   • «N новых» — чужие комментарии новее визита.
 *
 * Чистая функция — тесты без базы; `unreadIndex` ходит за водяными знаками
 * одним запросом на весь список.
 */

const idOf = (value) =>
  value && typeof value === "object" && "_id" in value
    ? String(value._id)
    : value == null
      ? ""
      : String(value);

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

const computeUnread = ({ ticket, seenAt, userId }) => {
  const me = String(userId);
  const activityAt = time(ticket?.activity?.at);
  const seen = time(seenAt);
  const foreign = activityAt > 0 && idOf(ticket.activity.by) !== me;
  const isUnseen = foreign && (!seen || activityAt > seen);
  const newComments = seen
    ? (ticket?.comments || []).filter(
        (comment) =>
          comment &&
          typeof comment === "object" &&
          time(comment.createdAt) > seen &&
          idOf(comment.createdBy) !== me,
      ).length
    : 0;
  return { isUnseen, newComments };
};

/** Map(ticketId → unread) для набора заявок одного человека. */
const unreadIndex = async (tickets, { userId }) => {
  const TicketRead = require("@/models/ticketRead");
  const ids = tickets.map((ticket) => ticket._id).filter(Boolean);
  const reads = ids.length
    ? await TicketRead.find({ userId, ticketId: { $in: ids } })
        .select("ticketId seenAt")
        .lean()
    : [];
  const seenBy = new Map(reads.map((read) => [String(read.ticketId), read.seenAt]));
  return new Map(
    tickets.map((ticket) => [
      String(ticket._id),
      computeUnread({
        ticket,
        seenAt: seenBy.get(String(ticket._id)) ?? null,
        userId,
      }),
    ]),
  );
};

const attachUnread = async (tickets, { userId }) => {
  const index = await unreadIndex(tickets, { userId });
  return tickets.map((ticket) => ({
    ...ticket,
    unread: index.get(String(ticket._id)),
  }));
};

module.exports = { computeUnread, unreadIndex, attachUnread };
