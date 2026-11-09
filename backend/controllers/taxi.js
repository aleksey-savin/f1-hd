const { Types } = require("mongoose");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));
const { TaxiSettings, TaxiEmployee, TaxiTrip } = require("../models/taxi");
const User = require("../models/user");
const Company = require("../models/company");
const Work = require("../models/work");
const Preferences = require("../models/preferences");
const { Ticket } = require("../models/ticket");
const { AppError } = require("../middleware/errorHandling");
const { decryptSecret } = require("../services/crypto/secretBox");
const { loadAccessibleTicket, assertTicketsAccessible, isResponsible } = require("../services/ticketAccess");
const { normalizePurpose, companyPurpose, isWorkPurpose } = require("../services/taxi/policy");
const { ticketListFilter } = require("../services/ticketScope");
const { canViewTrip, requireStaff, has, canOpenReport } = require("../services/taxi/access");
const { loadConfiguration, prepareConfiguration, saveConfiguration } = require("../services/taxi/settings");
const provider = require("../services/taxi/provider");

const id = (value) => String(value?._id ?? value ?? "");
const objectId = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value)) throw new AppError("Некорректный идентификатор", 400);
  return new Types.ObjectId(value);
};
const ids = (values = []) => {
  if (!Array.isArray(values) || values.length > 100) throw new AppError("Некорректный список заявок", 400);
  return [...new Set(values.map((value) => String(objectId(value))))];
};
const endpoint = (permission, handler) => async (req, res, next) => {
  try {
    requireStaff(req.auth);
    if (["POST", "PUT", "PATCH"].includes(req.method) && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) throw new AppError("Некорректное тело запроса", 400);
    if (permission && !has(req.auth, permission)) throw new AppError("Недостаточно прав корпоративного такси", 403);
    return res.json(await handler(req));
  } catch (error) {
    return next(error instanceof AppError ? error : new AppError("Не удалось выполнить действие с такси", 500, true, error));
  }
};
const savedSettings = async () => {
  const settings = await TaxiSettings.findById("yandex-business").select("+token").lean();
  if (!settings?.token || !settings.clientId) throw new AppError("Сначала сохраните доступ к Яндекс Go", 400);
  try { return { ...settings, token: decryptSecret(settings.token) }; }
  catch { throw new AppError("Токен не читается. Введите его заново в настройках такси", 400); }
};
const findTrip = async (auth, tripId) => {
  const trip = await TaxiTrip.findById(objectId(tripId)).lean();
  if (!trip || trip.deletedAt) throw new AppError("Поездка не найдена", 404);
  if (!canViewTrip(auth, trip)) throw new AppError("Недостаточно прав для просмотра поездки", 403);
  return trip;
};
const companyOptions = async (internalCompanyId) => (await Company.find({ isActive: { $ne: false } }).select("alias").sort({ alias: 1 }).lean())
  .map((company) => ({ ...company, isInternal: Boolean(internalCompanyId && id(company) === id(internalCompanyId)) }));
const peopleOptions = (auth) => User.find({ isEndUser: false, isServiceAccount: { $ne: true }, isCloudTelephony: { $ne: true }, deletedAt: null, banned: { $ne: true },
  ...(!has(auth, "read") && !has(auth, "configure") ? { _id: auth.userId } : {}),
}).select("firstName lastName").sort({ lastName: 1 }).lean();

/** Work is the source of its ride links. Money is never joined onto work rows. */
const decorateTrips = async (trips, auth) => {
  if (!trips.length) return [];
  const [works, companies, people, employees] = await Promise.all([
    Work.find({ taxiTripIds: { $in: trips.map((trip) => trip._id) } }).select("tickets taxiTripIds").lean(),
    Company.find({ _id: { $in: trips.map((trip) => trip.companyId).filter(Boolean) } }).select("alias").lean(),
    User.find({ _id: { $in: trips.map((trip) => trip.userId).filter(Boolean) } }).select("firstName lastName").lean(),
    TaxiEmployee.find({ externalId: { $in: trips.map((trip) => trip.externalUserId).filter(Boolean) } }).select("externalId firstName lastName").lean(),
  ]);
  const linked = new Map(trips.map((trip) => [id(trip), { workIds: [], ticketIds: new Set((trip.ticketIds || []).map(id)) }]));
  for (const work of works) for (const rideId of work.taxiTripIds || []) {
    const entry = linked.get(id(rideId));
    if (entry) { entry.workIds.push(id(work)); for (const ticketId of work.tickets || []) entry.ticketIds.add(id(ticketId)); }
  }
  const tickets = await Ticket.find({ _id: { $in: [...new Set([...linked.values()].flatMap((entry) => [...entry.ticketIds]))] }, ...ticketListFilter(auth) }).select("num title isClosed").lean();
  const ticketById = new Map(tickets.map((ticket) => [id(ticket), ticket]));
  const companyById = new Map(companies.map((company) => [id(company), company.alias]));
  const names = new Map(people.map((person) => [id(person), [person.firstName, person.lastName].filter(Boolean).join(" ")]));
  const externalNames = new Map(employees.map((person) => [person.externalId, [person.firstName, person.lastName].filter(Boolean).join(" ")]));
  return trips.map((trip) => {
    const relation = linked.get(id(trip));
    const visibleTickets = [...relation.ticketIds].map((ticketId) => ticketById.get(ticketId)).filter(Boolean);
    return { _id: id(trip), externalId: trip.externalId, source: trip.source, userId: trip.userId ? id(trip.userId) : null,
      personName: names.get(id(trip.userId)) || externalNames.get(trip.externalUserId) || "Сотрудник не сопоставлен",
      companyId: trip.companyId ? id(trip.companyId) : null, companyName: companyById.get(id(trip.companyId)) || "",
      purpose: normalizePurpose(trip.purpose), status: trip.status, origin: trip.origin, destination: trip.destination,
      startedAt: trip.startedAt, requestedAt: trip.requestedAt, finishedAt: trip.finishedAt, estimateMinor: trip.estimateMinor ?? null, totalMinor: trip.totalMinor ?? null,
      currency: trip.currency || "RUB", driver: trip.driver, workIds: relation.workIds,
      directTicketIds: (trip.ticketIds || []).map(id).filter((ticketId) => ticketById.has(ticketId)),
      workTicketIds: [...new Set(works.filter((work) => (work.taxiTripIds || []).some((tripId) => id(tripId) === id(trip))).flatMap((work) => (work.tickets || []).map(id)))].filter((ticketId) => ticketById.has(ticketId)),
      ticketIds: visibleTickets.map(id), tickets: visibleTickets.map((ticket) => ({ _id: id(ticket), num: ticket.num, title: ticket.title, isClosed: Boolean(ticket.isClosed) })),
      canAllocate: id(trip.userId) === id(auth.userId) || has(auth, "allocate"), canDelete: has(auth, "allocate"),
    };
  });
};

exports.settings = endpoint("configure", loadConfiguration);
exports.saveSettings = endpoint("configure", async (req) => ({ settings: await saveConfiguration(await prepareConfiguration(req.body)) }));
exports.check = endpoint("configure", async () => {
  const settings = await savedSettings();
  await provider.request(settings, "/users", { query: { limit: 1 } });
  await TaxiSettings.updateOne({ _id: settings._id }, { $set: { "health.lastOkAt": new Date(), "health.lastError": "", "health.consecutiveFailures": 0 } });
  return { message: "Доступ к Яндекс Go проверен" };
});
exports.sync = endpoint("configure", async () => require("../services/taxi/integration").runTaxiSync({ force: true }));
exports.mapEmployee = endpoint("configure", async (req) => {
  if (typeof req.params.externalId !== "string" || req.params.externalId.length > 200) throw new AppError("Некорректный сотрудник", 400);
  const userId = req.body.userId === null ? null : objectId(req.body.userId);
  if (userId) {
    const user = await User.findById(userId).lean();
    if (!user || user.deletedAt || user.isEndUser || user.isServiceAccount || user.isCloudTelephony || user.banned) throw new AppError("Выберите действующего сотрудника HD", 400);
    if (await TaxiEmployee.exists({ userId, externalId: { $ne: req.params.externalId } })) throw new AppError("Этот сотрудник уже связан с другим аккаунтом Яндекса", 409);
  }
  let employee;
  try { employee = await TaxiEmployee.findOneAndUpdate({ externalId: req.params.externalId }, { $set: { userId } }, { new: true }).lean(); }
  catch (error) { if (error.code === 11000) throw new AppError("Этот сотрудник уже связан с другим аккаунтом Яндекса", 409); throw error; }
  if (!employee) throw new AppError("Сотрудник Яндекса не найден", 404);
  await TaxiTrip.updateMany({ externalUserId: employee.externalId }, { $set: { userId } });
  return employee;
});

const dateBoundary = (value, zone, end) => {
  if (typeof value !== "string") throw new AppError("Некорректная дата периода", 400);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = dayjs.tz(value, zone);
    if (!parsed.isValid() || parsed.format("YYYY-MM-DD") !== value) throw new AppError("Некорректная дата периода", 400);
    return (end ? parsed.endOf("day") : parsed.startOf("day")).toDate();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new AppError("Некорректная дата периода", 400);
  return parsed;
};
exports.list = endpoint(null, async (req) => {
  if (!canOpenReport(req.auth)) throw new AppError("Нет доступа к отчёту по такси", 403);
  if ((req.query.scope === "all" || req.query.userId && id(req.query.userId) !== id(req.auth.userId)) && !has(req.auth, "read")) throw new AppError("Нет права видеть поездки других сотрудников", 403);
  const filter = { deletedAt: null };
  if (req.query.scope !== "all" || !has(req.auth, "read")) filter.userId = objectId(req.auth.userId);
  if (req.query.userId) filter.userId = objectId(req.query.userId);
  if (req.query.companyId) filter.companyId = objectId(req.query.companyId);
  if (req.query.unassigned === "1") filter.companyId = null;
  const preferences = await Preferences.findOne({}).select("timezone defaultCompany").lean();
  const zone = preferences?.timezone || "Europe/Moscow";
  const now = dayjs().tz(zone);
  const from = req.query.from ? dateBoundary(req.query.from, zone, false) : now.startOf("month").toDate();
  const to = req.query.to ? dateBoundary(req.query.to, zone, true) : now.endOf("month").toDate();
  if (from > to) throw new AppError("Начало периода позже окончания", 400);
  filter.$and = [{ $or: [ { startedAt: { $gte: from, $lte: to } }, { startedAt: null, requestedAt: { $gte: from, $lte: to } } ] }];
  if (req.query.withoutTicket === "1") {
    const linked = await Work.distinct("taxiTripIds", { taxiTripIds: { $exists: true, $ne: [] } });
    filter.ticketIds = { $size: 0 }; filter._id = { $nin: linked };
  }
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AppError("Некорректная страница", 400);
  const [trips, sums, companies, users, settings] = await Promise.all([
    TaxiTrip.aggregate([{ $match: filter }, { $addFields: { dateForSort: { $ifNull: ["$startedAt", "$requestedAt"] } } }, { $sort: { dateForSort: -1, _id: -1 } }, { $skip: (page - 1) * 100 }, { $limit: 100 }]),
    TaxiTrip.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: 1 }, totalMinor: { $sum: { $ifNull: ["$totalMinor", 0] } },
      estimatedMinor: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$totalMinor", null] }, null] }, { $ifNull: ["$estimateMinor", 0] }, 0] } } } }]),
    companyOptions(preferences?.defaultCompany?._id), peopleOptions(req.auth), TaxiSettings.findById("yandex-business").lean(),
  ]);
  return { trips: await decorateTrips(trips, req.auth), total: sums[0]?.total || 0, totalMinor: sums[0]?.totalMinor || 0,
    estimatedMinor: sums[0]?.estimatedMinor || 0, companies, users, isActive: Boolean(settings?.isActive),
    period: { from: dayjs(from).tz(zone).format("YYYY-MM-DD"), to: dayjs(to).tz(zone).format("YYYY-MM-DD") } };
});

const candidateRows = async (auth, draft) => {
  const performerId = draft.performerId ? objectId(draft.performerId) : objectId(auth.userId);
  if (id(performerId) !== id(auth.userId) && !has(auth, "read") && !has(auth, "allocate")) throw new AppError("Недостаточно прав для чужих поездок", 403);
  let companyId = draft.companyId ? id(objectId(draft.companyId)) : null;
  if (draft.tickets?.length) {
    const tickets = await assertTicketsAccessible(auth, ids(draft.tickets));
    companyId ||= id(tickets[0].company);
    if (tickets.some((ticket) => id(ticket.company) !== companyId)) throw new AppError("Заявки должны относиться к одной компании", 400);
  }
  if (!companyId) return [];
  const startedAt = draft.startedAt ? new Date(draft.startedAt) : new Date();
  const finishedAt = draft.finishedAt ? new Date(draft.finishedAt) : startedAt;
  if (!Number.isFinite(startedAt.valueOf()) || !Number.isFinite(finishedAt.valueOf()) || startedAt > finishedAt) throw new AppError("Некорректное время работ", 400);
  return TaxiTrip.find({ deletedAt: null, userId: performerId, companyId, purpose: { $in: ["business", "service"] }, status: { $in: ["transporting", "finished", "complete"] },
    $or: [
      { startedAt: { $gte: new Date(startedAt.valueOf() - 24 * 3600000), $lte: new Date(finishedAt.valueOf() + 4 * 3600000) } },
      { startedAt: null, requestedAt: { $gte: new Date(startedAt.valueOf() - 24 * 3600000), $lte: new Date(finishedAt.valueOf() + 4 * 3600000) } },
    ],
  }).sort({ startedAt: -1 }).limit(100).lean();
};
exports.candidates = endpoint(null, async (req) => ({ trips: await decorateTrips(await candidateRows(req.auth, req.body), req.auth), isActive: true }));
exports.ticketTrips = endpoint(null, async (req) => {
  const ticket = await loadAccessibleTicket(req.auth, { id: id(objectId(req.params.id)) });
  if (!ticket.isClosed) return { trips: [], totalMinor: 0 };
  const linked = await Work.distinct("taxiTripIds", { tickets: ticket._id });
  const trips = await TaxiTrip.find({ deletedAt: null, $or: [{ ticketIds: ticket._id }, { _id: { $in: linked } }], ...(!has(req.auth, "read") ? { userId: req.auth.userId } : {}) }).sort({ startedAt: 1 }).lean();
  return { trips: await decorateTrips(trips, req.auth), totalMinor: trips.reduce((sum, trip) => sum + (trip.totalMinor || 0), 0) };
});
exports.ticketCandidates = endpoint(null, async (req) => {
  const ticket = await loadAccessibleTicket(req.auth, { id: id(objectId(req.params.id)) });
  const works = await Work.find({ tickets: ticket._id }).lean();
  const pending = works.filter((work) => work.visitRequired && work.startedAt && work.finishedAt && work.taxiDecision !== "none" && !work.taxiTripIds?.length
    && (id(work.finishedBy) === id(req.auth.userId) || has(req.auth, "read") || has(req.auth, "allocate")));
  const trips = new Map();
  for (const work of pending) for (const trip of await candidateRows(req.auth, { companyId: id(ticket.company), performerId: id(work.finishedBy), startedAt: work.startedAt, finishedAt: work.finishedAt })) {
    if (!(trip.ticketIds || []).some((ticketId) => id(ticketId) === id(ticket))) trips.set(id(trip), trip);
  }
  return { trips: await decorateTrips([...trips.values()], req.auth), isActive: true };
});
exports.allocationOptions = endpoint(null, async (req) => {
  const trip = await findTrip(req.auth, req.params.id);
  if (id(trip.userId) !== id(req.auth.userId) && !has(req.auth, "allocate")) throw new AppError("Нет права распределять чужие расходы", 403);
  const companyId = objectId(req.query.companyId);
  const tickets = trip.userId ? await Ticket.find({ $and: [
    { "company._id": companyId }, { "responsibles._id": trip.userId }, ticketListFilter(req.auth),
  ] }).select("num title isClosed").sort({ _id: -1 }).lean() : [];
  return { tripId: id(trip), companyId: id(companyId), tickets };
});
exports.remove = endpoint("allocate", async (req) => {
  const trip = await TaxiTrip.findById(objectId(req.params.id)).lean();
  if (!trip) throw new AppError("Поездка не найдена", 404);
  // The tombstone is the import deduplication key. Repeated deletion also
  // finishes link cleanup after interruption; it never calls the provider.
  await TaxiTrip.updateOne({ _id: trip._id, deletedAt: null }, { $set: { deletedAt: new Date(), deletedBy: req.auth.userId } });
  await Work.updateMany({ taxiTripIds: trip._id }, { $pull: { taxiTripIds: trip._id } });
  return { ok: true };
});
exports.allocate = endpoint(null, async (req) => {
  const trip = await findTrip(req.auth, req.params.id);
  if (id(trip.userId) !== id(req.auth.userId) && !has(req.auth, "allocate")) throw new AppError("Нет права распределять чужие расходы", 403);
  const companyId = objectId(req.body.companyId), ticketIds = ids(req.body.ticketIds);
  if (!await Company.exists({ _id: companyId })) throw new AppError("Компания не найдена", 404);
  const tickets = ticketIds.length ? await assertTicketsAccessible(req.auth, ticketIds) : [];
  if (tickets.some((ticket) => id(ticket.company) !== id(companyId))) throw new AppError("Заявки относятся к другой компании", 400);
  const visibleExisting = await Ticket.find({ _id: { $in: trip.ticketIds || [] }, ...ticketListFilter(req.auth) }).select("_id").lean();
  const visibleIds = new Set(visibleExisting.map(id));
  const hiddenIds = (trip.ticketIds || []).map(id).filter((ticketId) => !visibleIds.has(ticketId));
  if (hiddenIds.length && id(companyId) !== id(trip.companyId)) throw new AppError("Для смены компании требуется доступ ко всем связанным заявкам", 409);
  const linkedWorks = await Work.find({ taxiTripIds: trip._id }).select("company tickets").lean();
  const derived = new Set(linkedWorks.flatMap((work) => (work.tickets || []).map(id)));
  const existingDirect = new Set((trip.ticketIds || []).map(id));
  const mergedTicketIds = [...new Set([...ticketIds.filter((ticketId) => !derived.has(ticketId) || existingDirect.has(ticketId)), ...hiddenIds])];
  if (tickets.some((ticket) => !existingDirect.has(id(ticket)) && !derived.has(id(ticket)) && (!trip.userId || !isResponsible(ticket, trip.userId)))) throw new AppError("Выберите заявки, где сотрудник поездки — ответственный", 400);
  const preferences = req.body.purpose === undefined ? await Preferences.findOne({}).select("defaultCompany").lean() : null;
  const purpose = req.body.purpose === undefined ? companyPurpose(companyId, preferences?.defaultCompany?._id) : normalizePurpose(req.body.purpose);
  if (!["business", "service", "personal", "unknown"].includes(purpose)) throw new AppError("Некорректное назначение поездки", 400);
  const works = linkedWorks;
  if (works.some((work) => id(work.company) !== id(companyId)) || works.length && !isWorkPurpose(purpose)) throw new AppError("Сначала измените связь поездки с выполненными работами", 409);
  if (purpose === "personal" && mergedTicketIds.length) throw new AppError("Личная поездка не связывается с заявками", 400);
  const updated = await TaxiTrip.findOneAndUpdate({ _id: trip._id }, { $set: { companyId, ticketIds: mergedTicketIds, purpose, manuallyAssigned: true } }, { new: true }).lean();
  await require("../services/taxi/sync").refreshTaxiPresenceNote(updated);
  return (await decorateTrips([updated], req.auth))[0];
});

exports.detail = endpoint(null, async (req) => ({
  trip: (await decorateTrips([await findTrip(req.auth, req.params.id)], req.auth))[0],
}));
