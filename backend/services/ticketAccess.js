const { Ticket } = require("@/models/ticket");

const { AppError } = require("@/middleware/errorHandling");

/**
 * Доступ к КОНКРЕТНОЙ заявке.
 *
 * Право отвечает на вопрос «можно ли ему такое вообще», а эта функция — «можно
 * ли ему вот эту запись». Раздельно, потому что глобальное `ticket.perform` не
 * означает, что человек имеет отношение к каждой из тринадцати тысяч заявок.
 *
 * Список допусков совпадает со скоупом списка заявок (`controllers/ticket.js`,
 * ветка «остальные пользователи»): ответственный ИЛИ автор ИЛИ заявитель. Без
 * `isCreator` сотрудник, заведший заявку за клиента, видел бы её в списке и
 * получал 403 по клику.
 *
 * Правило жило внутри мидлвари `allowedToViewTicket`, где им могли
 * воспользоваться только маршруты с номером заявки в пути. Всё, что ходит к
 * заявке иначе — комментарии по `_id`, работы по списку заявок, — проверки не
 * делало вовсе.
 *
 * @param {object} ticket — документ заявки (или lean-объект)
 * @param {object} auth — `req.auth`
 */
const canAccessTicket = (ticket, auth) => {
  if (!ticket || !auth?.user) return false;

  const { user, can, isAdmin } = auth;
  const userId = user._id.toString();

  const isResp = (ticket.responsibles || [])
    .map((resp) => resp._id.toString())
    .includes(userId);
  const isApplicant =
    ticket.applicantId?.toString() === userId ||
    ticket.applicant?._id?.toString() === userId;
  const isCreator = ticket.createdBy?.toString() === userId;
  const sameCompany =
    can({ ticket: ["readCompany"] }) &&
    Boolean(user.company?._id) &&
    user.company._id.toString() === ticket.company?._id?.toString();

  return (
    isAdmin ||
    // connector: "OR" — внутри ресурса, а не рядом с ним: список действий
    // по умолчанию складывается по И (`access.mjs#normalizeActionRequest`).
    can({ ticket: { actions: ["administrate", "readAll"], connector: "OR" } }) ||
    isResp ||
    isApplicant ||
    isCreator ||
    sameCompany
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

module.exports = { canAccessTicket, loadAccessibleTicket, assertTicketsAccessible };
