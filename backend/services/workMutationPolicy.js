const { AppError } = require("../middleware/errorHandling");
const { Ticket } = require("../models/ticket");
const { validateWorkTaxiLinks } = require("./taxi/integration");
const TicketCategory = require("../models/ticketCategory");

const taxiDecision = (ids, requested, previous = "pending") => {
  if (requested !== undefined && !["pending", "none", "linked"].includes(requested)) {
    throw new AppError("Некорректное решение о поездке", 400);
  }
  return ids.length ? "linked" : (requested ?? previous) === "none" ? "none" : "pending";
};

/**
 * Можно ли править эту работу. Своими считаем троих, а не одного автора:
 * запланированную работу заводит один человек, а подтверждает фактом другой —
 * исполнитель, — и правило «только автор» разорвало бы этот обычный ход.
 *
 * Чужую работу правит тот, у кого есть на это право. Ограничение по заявкам
 * отдельное и стоит раньше: без него номер чужой работы открывал бы её вовсе.
 */
const canEditWork = (work, { userId, can }) =>
  can({ work: ["manage"] }) ||
  [work.createdBy?._id, work.executor?._id, work.finishedBy?._id]
    .filter(Boolean)
    .some((id) => id.toString() === userId);

/**
 * Работа не тарифицируется, если ХОТЬ ОДНА её заявка льготной категории.
 * По всем заявкам, а не по первой: одна работа вешается сразу на несколько
 * заявок (массовое добавление, «Связанные заявки»), и категории у них разные.
 * То же правило — в `workOvertime.isExcludedFromOvertime`.
 */
const isAlwaysWithinPlan = async (ticketIds) => {
  const tickets = await Ticket.find({ _id: { $in: ticketIds.filter(Boolean) } })
    .select("categoryId")
    .lean();

  const categoryIds = tickets
    .map((ticket) => ticket.categoryId)
    .filter(Boolean);

  if (categoryIds.length === 0) {
    return false;
  }

  const exempt = await TicketCategory.countDocuments({
    _id: { $in: categoryIds },
    alwaysWithinPlan: true,
  });

  return exempt > 0;
};

const canDeleteWork = (work, auth) => auth.can({ work: ["manage"] }) ||
  work.createdBy?._id?.toString() === auth.userId;

async function applyWorkTaxiDecision(auth, work, ids, requested, previous) {
  work.taxiTripIds = await validateWorkTaxiLinks({ auth, work, taxiTripIds: ids }) ?? [];
  work.taxiDecision = work.visitRequired && work.startedAt && work.finishedAt
    ? taxiDecision(work.taxiTripIds, requested, previous) : "pending";
}

module.exports = { canEditWork, canDeleteWork, isAlwaysWithinPlan, applyWorkTaxiDecision };
