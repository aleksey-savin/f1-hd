const { Ticket } = require("@/models/ticket");
const Comment = require("@/models/comment");
const Work = require("@/models/work");
const User = require("@/models/user");
const Company = require("@/models/company");
const TicketCategory = require("@/models/ticketCategory");
const ClientDevice = require("@/models/inventory/clientDevice");
require("@/models/inventory/deviceModel");
require("@/models/inventory/vendor");
require("@/models/inventory/deviceType");
require("@/models/routineTask");
const { workDurationMs } = require("@/services/workSummary");

/**
 * Чтение заявок для MCP-инструментов (ticketTools.js). Поля — только
 * разрешённые спекой; htmlDescription (≈51 КБ сырого письма) не читается никогда.
 */

const SEARCH_FIELDS = "num title description source state isClosed categoryId company applicantId createdAt finishedAt closingComment";
const DETAIL_FIELDS = `${SEARCH_FIELDS} processedAt startedAt deadline routineTask relatedClientDeviceId comments responsibles._id responsibles.firstName responsibles.lastName customFields.name customFields.type customFields.value checklist.description checklist.checked`;
const STATS_FIELDS = "categoryId company._id applicantId source createdAt finishedAt isClosed";
const WORK_FIELDS = "description visitRequired startedAt finishedAt finishedBy._id finishedBy.firstName finishedBy.lastName executor._id executor.firstName executor.lastName";
const DEVICE_FIELDS = "deviceModelId deviceTypeId serialNumber inventoryNumber status operatingSystem";
const DEVICE_POPULATE = [
  { path: "deviceModelId", select: "name vendorId deviceTypeId", populate: [{ path: "vendorId", select: "name" }, { path: "deviceTypeId", select: "name" }] },
  { path: "deviceTypeId", select: "name" },
];

// Часть комментариев старше рефакторинга модели (schema/comment.js) хранит
// createdBy денормализованным снимком {_id, firstName, lastName} вместо
// ObjectId-ссылки (~половина документов на деве/проде, task-11) — сама
// схема данные задним числом не переписывает. String(объект) даёт
// "[object Object]", справочник пользователей его не находит, и автора
// подписывает как "unknown person" (ticketFormat.js#personLabel). Достаём id
// из обеих форм.
const authorId = (value) => {
  if (!value) return null;
  const id = typeof value === "object" && value._id ? value._id : value;
  return String(id);
};
exports.authorId = authorId;

exports.loadDirectory = async () => {
  const [companies, users, categories] = await Promise.all([
    Company.find({}).select("alias fullTitle").lean(),
    User.find({}).select("firstName lastName position isEndUser isServiceAccount isCloudTelephony company._id").lean(),
    TicketCategory.find({}).select("title").lean(),
  ]);
  return { companies, users, categories };
};

exports.findTickets = (filter, { sort = { createdAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Ticket.find(filter).select(SEARCH_FIELDS).sort(sort).skip(skip).limit(limit).lean();

exports.countTickets = (filter) => Ticket.countDocuments(filter);

exports.loadTicketDetail = async (num, { works, devices, applicantIsSystem }) => {
  const ticket = await Ticket.findOne({ num }).select(DETAIL_FIELDS).populate({ path: "routineTask", select: "title" }).lean();
  if (!ticket) return null;

  // Комментарии — и по ticketId, и по массиву заявки: письма до 2026-07-08 в
  // массив не попадали, но ticketId у них есть.
  const commentsQuery = Comment.find({ $or: [{ ticketId: ticket._id }, { _id: { $in: ticket.comments || [] } }] })
    .select("content createdBy createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const worksQuery = works
    ? Work.find({ tickets: ticket._id }).select(WORK_FIELDS).sort({ startedAt: 1 }).lean()
    : null;

  const deviceOr = [];
  if (devices && ticket.relatedClientDeviceId) deviceOr.push({ _id: ticket.relatedClientDeviceId });
  if (devices && ticket.applicantId && !applicantIsSystem(ticket.applicantId)) {
    deviceOr.push({ userId: ticket.applicantId, parentDeviceId: null });
  }
  const devicesQuery = devices
    ? deviceOr.length
      ? ClientDevice.find({ deletedAt: null, $or: deviceOr }).select(DEVICE_FIELDS).populate(DEVICE_POPULATE).lean()
      : Promise.resolve([])
    : null;

  const [comments, workDocs, deviceDocs] = await Promise.all([commentsQuery, worksQuery, devicesQuery]);
  return {
    ticket,
    routineTaskTitle: ticket.routineTask?.title || null,
    comments: comments.map((comment) => ({ ...comment, createdBy: authorId(comment.createdBy) })),
    works: workDocs ? workDocs.map((work) => ({ ...work, durationMs: workDurationMs(work) })) : null,
    devices: deviceDocs,
  };
};

exports.loadWorkDescriptions = async (ticketIds) => {
  const works = await Work.find({ tickets: { $in: ticketIds } }).select("description tickets").lean();
  const byTicket = new Map();
  for (const work of works) {
    for (const id of work.tickets || []) {
      const key = String(id);
      if (!byTicket.has(key)) byTicket.set(key, []);
      if (work.description) byTicket.get(key).push(work.description);
    }
  }
  return byTicket;
};

exports.loadStatsRows = (filter) => Ticket.find(filter).select(STATS_FIELDS).lean();
