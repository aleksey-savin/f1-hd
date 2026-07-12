const { Ticket } = require("../../models/ticket");
const Preferences = require("../../models/preferences");
const User = require("../../models/user");
const Company = require("../../models/company");
const ClientDevice = require("../../models/inventory/clientDevice");
const Comment = require("../../models/comment");
const TicketLog = require("../../models/ticketLog");
const { formatInAppTimezone } = require("../../utils/datetime");
const logger = require("../../utils/logger");

// Human-readable device name for ticket/comment text (RouterOS identity /
// standalone label / host — never an internal id).
const deviceLabel = (record) =>
  record.name ||
  record.label ||
  record.credentials?.host ||
  "устройство Mikrotik";

// Времена в текстах заявок/комментариев — в таймзоне приложения (общий утиль
// utils/datetime; сервер живёт в UTC, «сырое» toLocaleString расходится с
// временем создания заявки, которое фронт показывает в локальной зоне).
const fmtTime = (date, timeZone) =>
  date ? formatInAppTimezone(date, timeZone, "dd.MM.yyyy, HH:mm") : "неизвестно";

// Кликабельная ссылка на страницу устройства для описаний заявок: описание
// рендерится в вебе как sanitized-HTML и вставляется в HTML-письма, поэтому
// якорь работает в обоих местах (telegram-уведомления описание не включают).
// ADDRESS даёт абсолютный URL для писем; без него ссылка остаётся относительной
// и работает в вебе.
const deviceLinkHtml = (record) => {
  const base = process.env.ADDRESS || "";
  const path = record.clientDevice
    ? `/inventory/client-devices/${record.clientDevice}?tab=monitoring`
    : `/devices/mikrotik/records/${record._id}`;
  return `<a href="${base}${path}">Открыть страницу устройства</a>`;
};

// Resolve the embedded { _id, alias } company for a Mikrotik record. Standalone
// records carry companyId directly; inventory-backed records inherit it from the
// linked ClientDevice. Returns undefined when it can't be resolved — the caller
// then falls back to the author's company (see applicantCompany).
const resolveCompany = async (record) => {
  let companyId = record.companyId;
  if (!companyId && record.clientDevice) {
    const device = await ClientDevice.findById(record.clientDevice).select(
      "companyId",
    );
    companyId = device?.companyId;
  }
  if (!companyId) return undefined;

  const company = await Company.findById(companyId).select("alias");
  if (!company) return undefined;
  return { _id: company._id, alias: company.alias };
};

// Компания машинной заявки, когда «своей» у неё нет: компания сервисного
// аккаунта-автора (Preferences.mikrotik.applicant — в настройках выбираются
// только сервисные аккаунты). Схема «аккаунт → его компания» работает во всём
// приложении, а заявка без company ломает сквозной инвариант: уведомления,
// работы и проверки прав разыменовывают ticket.company без проверок (после
// toObject() mongoose вырезает пустой объект — 500 на карточке заявки).
const applicantCompany = (applicant) =>
  applicant?.company?._id
    ? { _id: applicant.company._id, alias: applicant.company.alias }
    : undefined;

// Load Preferences and validate the machine author. There is no system/bot user:
// ALL of the module's tickets and comments are authored by the service account
// chosen in Настройки → Mikrotik (`Preferences.mikrotik.applicant`). Not
// configured → machine tickets are skipped (logged), no fallback to
// defaultApplicant by design. Returns { prefs, applicant } or null.
const resolveTicketBasics = async (context) => {
  const prefs = await Preferences.findOne({});
  const applicantId = prefs?.mikrotik?.applicant?._id;
  if (!applicantId) {
    logger.warn(
      `Mikrotik ${context} skipped: Preferences.mikrotik.applicant is not set (Настройки → Mikrotik)`,
    );
    return null;
  }

  const applicant = await User.findById(applicantId).select("_id company");
  if (!applicant) {
    logger.warn(
      `Mikrotik ${context} skipped: mikrotik applicant user not found`,
    );
    return null;
  }

  return { prefs, applicant };
};

// Create a helpdesk ticket authored by the Mikrotik module (offline alert / config
// change). Deadline follows the global `Preferences.deadline` (hours). Setting
// `notifications.pending` lets the notifications cron deliver it.
//
// Never throws — a failed alert must not break the poll/cron loop; it logs and
// returns null so the caller can decide whether to retry later.
const createMikrotikTicket = async (
  record,
  { title, description, categoryId = null },
) => {
  try {
    const basics = await resolveTicketBasics("ticket");
    if (!basics) return null;
    const { prefs, applicant } = basics;

    const company =
      (await resolveCompany(record)) ?? applicantCompany(applicant);
    if (!company) {
      logger.warn(
        "Mikrotik ticket created without company: neither the device company nor the mikrotik applicant's company resolved",
      );
    }
    const deadlineHours = prefs?.deadline || 10;
    const now = new Date();

    const ticket = new Ticket({
      title,
      description: description || "",
      categoryId: categoryId || null,
      applicantId: applicant._id,
      // Инвентарное устройство, о котором заявка, — питает вкладку «Окружение».
      // У standalone-записей (CHR) карточки нет — поле остаётся пустым.
      relatedClientDeviceId: record.clientDevice || undefined,
      company,
      deadline: new Date(now.getTime() + deadlineHours * 60 * 60 * 1000),
      isClosed: false,
      state: "Новая",
      source: "Мониторинг устройств",
      createdBy: applicant._id,
      updatedBy: applicant._id,
      notifications: { lastAction: "new ticket", pending: true },
    });
    await ticket.save();
    return ticket;
  } catch (error) {
    logger.log("error", "Failed to create Mikrotik ticket", {
      error: error.message,
      recordId: record?._id,
    });
    return null;
  }
};

// Глобальная системная заявка (не по одному устройству) — например, сводная по
// уязвимостям прошивок. Company — компания сервисного аккаунта-автора
// (устройств много, «своей» компании у заявки нет, а без company падают
// карточка заявки, уведомления и работы). Без relatedClientDeviceId: ref
// одиночный, N устройств им не выразить — их список живёт в описании и
// чек-листе. Пункты чек-листа не mandatory, чтобы человек мог убрать
// неактуальный. Never throws.
const createMikrotikSystemTicket = async ({
  title,
  description,
  categoryId = null,
  checklist = [],
}) => {
  try {
    const basics = await resolveTicketBasics("system ticket");
    if (!basics) return null;
    const { prefs, applicant } = basics;

    const company = applicantCompany(applicant);
    if (!company) {
      logger.warn(
        "Mikrotik system ticket created without company: the mikrotik applicant account has no company",
      );
    }
    const deadlineHours = prefs?.deadline || 10;
    const now = new Date();

    const ticket = new Ticket({
      title,
      description: description || "",
      categoryId: categoryId || null,
      applicantId: applicant._id,
      company,
      deadline: new Date(now.getTime() + deadlineHours * 60 * 60 * 1000),
      isClosed: false,
      state: "Новая",
      source: "Мониторинг устройств",
      createdBy: applicant._id,
      updatedBy: applicant._id,
      notifications: { lastAction: "new ticket", pending: true },
      checklist: checklist.map((item) => ({
        description: item.description,
        mandatory: false,
        checked: false,
      })),
    });
    await ticket.save();
    return ticket;
  } catch (error) {
    logger.log("error", "Failed to create Mikrotik system ticket", {
      error: error.message,
    });
    return null;
  }
};

// Системный комментарий на заявку (паттерн postRecoveryComment из outages.js):
// Comment + пуш _id в ticket.comments (UI показывает только их) +
// notifications.pending для крона доставки + TicketLog. `ticket.version` НЕ
// бампается — комментарии не участвуют в optimistic lock. Never throws;
// возвращает true при успехе (по нему вызывающий штампует «уже сказано»).
const postSystemTicketComment = async (ticketId, content) => {
  try {
    const prefs = await Preferences.findOne({});
    const authorId = prefs?.mikrotik?.applicant?._id;
    if (!authorId) {
      logger.warn(
        "Mikrotik system comment skipped: Preferences.mikrotik.applicant is not set (Настройки → Mikrotik)",
      );
      return false;
    }

    const ticket = await Ticket.findById(ticketId).select("num");
    if (!ticket) {
      logger.log("warn", "Mikrotik system comment skipped: ticket not found", {
        ticketId,
      });
      return false;
    }

    const comment = new Comment({
      content,
      ticketId: ticket._id,
      notifications: { lastAction: "new comment", pending: true },
      createdBy: authorId,
      updatedBy: authorId,
    });
    await comment.save();

    await Ticket.updateOne(
      { _id: ticket._id },
      { $push: { comments: comment._id } },
    );

    const logEntry = new TicketLog({
      ticket: ticket.num,
      ticketId: ticket._id,
      user: {
        firstName: prefs.mikrotik?.applicant?.firstName,
        lastName: prefs.mikrotik?.applicant?.lastName,
      },
      severity: "info",
      event: "добавлен комментарий",
    });
    await logEntry.save();
    return true;
  } catch (error) {
    logger.log("error", "Mikrotik system comment failed", {
      ticketId,
      error: error.message,
    });
    return false;
  }
};

module.exports = {
  createMikrotikTicket,
  createMikrotikSystemTicket,
  postSystemTicketComment,
  deviceLabel,
  fmtTime,
  deviceLinkHtml,
};
