const { Ticket } = require("@/models/ticket");

const { AppError } = require("@/middleware/errorHandling");
const { ticketInScope } = require("@/services/ticketScope");

/**
 * Доступ к КОНКРЕТНОЙ заявке.
 *
 * Право отвечает на вопрос «можно ли ему такое вообще», а эта функция — «можно
 * ли ему вот эту запись». Раздельно, потому что глобальное `ticket.perform` не
 * означает, что человек имеет отношение к каждой из тринадцати тысяч заявок.
 *
 * Список допусков теперь считает `services/ticketScope` — тот же модуль, что
 * фильтрует список заявок: ответственный ИЛИ автор ИЛИ заявитель ИЛИ компания
 * из скоупа (`ticketScope`). Без `isCreator` сотрудник, заведший заявку за
 * клиента, видел бы её в списке и получал 403 по клику.
 *
 * Правило жило внутри мидлвари `allowedToViewTicket`, где им могли
 * воспользоваться только маршруты с номером заявки в пути. Всё, что ходит к
 * заявке иначе — комментарии по `_id`, работы по списку заявок, — проверки не
 * делало вовсе.
 *
 * @param {object} ticket — документ заявки (или lean-объект)
 * @param {object} auth — `req.auth`
 */

const isResponsible = (ticket, userId) =>
  (ticket?.responsibles || []).some((resp) => String(resp?._id ?? resp) === String(userId));

/** Правило одно на список и карточку — `services/ticketScope`. */
const canAccessTicket = (ticket, auth) => {
  if (!ticket || !auth?.userId) return false;
  return Boolean(auth.isAdmin) || ticketInScope(ticket, auth);
};

/**
 * Действие над СВОЕЙ заявкой: закрыть, отказаться, изменить срок, запросить
 * помощь, отметить пункт чек-листа.
 *
 * «Своя» — это та, где он в ответственных (решение владельца 2026-09-12), и
 * никакое право этого не заменяет, кроме «Вести заявки»: ведущий распоряжается
 * любой заявкой по должности. Раньше хватало одного `ticket.perform` на любую
 * доступную заявку — исполнитель мог закрыть заявку коллеги, а интерфейс такой
 * кнопки не показывал: запрет обещал только фронт.
 *
 * @param {object} ticket — документ заявки
 * @param {object} auth — `req.auth`
 */
const canActOnOwnTicket = (ticket, auth) => {
  if (!ticket || !auth?.userId) return false;
  if (auth.can({ ticket: ["manage"] })) return true;
  return isResponsible(ticket, auth.userId);
};

/**
 * Присоединиться к заявке (принять в работу, встать в ответственные, забрать
 * себе): ответственный — к своей, остальные — только с правом «Присоединяться
 * к чужим заявкам»; ведущий заявки — всегда.
 *
 * Отдельно от `canActOnOwnTicket`, потому что это единственное действие, где
 * заявка становится своей ПОСЛЕ него: требовать «быть ответственным» было бы
 * замкнутым кругом.
 */
const canJoinTicket = (ticket, auth) => {
  if (!ticket || !auth?.userId) return false;
  if (auth.can({ ticket: ["join"] }) || auth.can({ ticket: ["manage"] })) {
    return true;
  }
  return isResponsible(ticket, auth.userId);
};

/**
 * То же по СПИСКУ заявок — массовое действие из выделения.
 *
 * Подходить должна КАЖДАЯ заявка, а не первая: иначе массовое действие
 * проезжало бы по чужим заодно со своими. Пустой список — отказ: правило
 * обязано отказывать, а не пропускать по недосмотру.
 */
const canActOnOwnTickets = (tickets, auth) =>
  Boolean(tickets?.length) &&
  tickets.every((ticket) => canActOnOwnTicket(ticket, auth));

/** То же для присоединения: каждая заявка выделения, пустой список — отказ. */
const canJoinTickets = (tickets, auth) =>
  Boolean(tickets?.length) &&
  tickets.every((ticket) => canJoinTicket(ticket, auth));

/**
 * Состав чек-листа (не отметки): «Вести заявки» — на любой заявке, исполнитель
 * с «Брать в работу» — на своей, если заявка не из регламента: регламентный
 * чек-лист принадлежит регламенту, а не заявке.
 */
const canEditChecklist = (ticket, auth) => {
  if (!ticket || !auth) return false;
  if (auth.isAdmin || auth.can({ ticket: ["manage"] })) return true;
  return (
    auth.can({ ticket: ["perform"] }) &&
    isResponsible(ticket, auth.userId) &&
    !ticket.routineTask
  );
};

const NOT_FOUND = "Заявка не найдена";
const FORBIDDEN = "Недостаточно прав для просмотра страницы";

/**
 * Заявка по номеру ИЛИ по `_id` с проверкой доступа. Бросает 404, если заявки
 * нет, и 403, если она чужая.
 *
 * Два ключа поиска — не небрежность: маршруты заявок адресуют её человеческим
 * номером (`/tickets/:ticketNum`), а комментарии и работы — `_id`. Одна функция
 * на оба случая, чтобы правило доступа не разошлось между ними.
 */
const loadAccessibleTicket = async (auth, { num, id }) => {
  let ticket = null;

  if (num !== undefined && num !== null) {
    if (isNaN(+num)) throw new AppError(NOT_FOUND, 404);
    ticket = await Ticket.findOne({ num: +num });
  } else {
    if (!id) throw new AppError(NOT_FOUND, 404);
    ticket = await Ticket.findById(id).catch(() => null);
  }

  if (!ticket) throw new AppError(NOT_FOUND, 404);
  if (!canAccessTicket(ticket, auth)) throw new AppError(FORBIDDEN, 403);

  return ticket;
};

/**
 * Каждая из перечисленных заявок должна быть доступна.
 *
 * Проверяем ВСЕ, а не первую: одна работа вешается сразу на несколько заявок
 * («Связанные заявки», массовое добавление), и проверка только `tickets[0]`
 * открывала бы остальные — а именно из них контроллер берёт компанию и пишет
 * записи в журнал.
 */
const assertTicketsAccessible = async (auth, ids = []) => {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!unique.length) throw new AppError("Не указана заявка", 400);

  const tickets = await Ticket.find({ _id: { $in: unique } });
  if (tickets.length !== unique.length) throw new AppError(NOT_FOUND, 404);

  if (!tickets.every((ticket) => canAccessTicket(ticket, auth))) {
    throw new AppError(FORBIDDEN, 403);
  }

  return tickets;
};

module.exports = {
  canAccessTicket,
  canActOnOwnTicket,
  canActOnOwnTickets,
  canEditChecklist,
  canJoinTicket,
  canJoinTickets,
  isResponsible,
  loadAccessibleTicket,
  assertTicketsAccessible,
};
