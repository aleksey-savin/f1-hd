const Mikrotik = require("../../models/mikrotik");
const { Ticket } = require("../../models/ticket");
const Preferences = require("../../models/preferences");
const { MikrotikFirmwareState } = require("../../models/mikrotikFirmware");
const { evaluateFirmware } = require("./firmware");
const {
  createMikrotikSystemTicket,
  postSystemTicketComment,
  deviceLabel,
  deviceLinkHtml,
} = require("./tickets");
const logger = require("../../utils/logger");

// ОДНА авто-заявка на все устройства с опасной прошивкой (Preferences.mikrotik.
// securityUpdateTicket). Пункт чек-листа = устройство; по мере обновления пункты
// отмечаются автоматически. Жизненный цикл:
//  - заявка удалена (hard delete: findById → null) → создать новую сразу;
//  - закрыта, угроза осталась → создать новую в этот же суточный прогон
//    (альтернатива «новая только при появлении НОВЫХ угроз» сознательно не
//    выбрана: закрыть заявку «в никуда» не должно быть возможно, пока
//    устройства уязвимы);
//  - открыта → досыпать новые устройства, отмечать обновлённые, по полному
//    обнулению угрозы — один «✅»-комментарий (заявку закрывает человек).
// Синглтон-состояние — MikrotikFirmwareState("security-ticket"); создание идёт
// через CAS «claim first, create second» (паттерн offline-алертов).
// Корректность рассчитана на ОДИН процесс бэкенда, как и остальные крон-CAS.

const STATE_ID = "security-ticket";

// Устройства с прошивкой под опасной CVE. Берём все записи с известной версией:
// мониторинг может быть выключен, а устройство офлайн — устаревшие данные о
// версии всё равно полезнее молчания.
const collectEndangered = async (ctx) => {
  const records = await Mikrotik.find({
    currentFirmware: { $exists: true, $nin: [null, ""] },
  })
    .select("clientDevice companyId label name credentials.host currentFirmware")
    .lean();

  const endangered = [];
  for (const record of records) {
    const status = evaluateFirmware(record, ctx);
    if (status?.vulnerable) endangered.push({ record, status });
  }
  return endangered;
};

// Текст пункта чек-листа. Детерминирован — по нему же авто-отметка находит пункт
// (за _id держаться нельзя: эндпоинт полной замены чек-листа их пересоздаёт).
const itemDescription = ({ record, status }) =>
  `«${deviceLabel(record)}» (${record.credentials?.host || "—"}): ` +
  `RouterOS ${status.installedVersion} → ${status.latestVersion}`;

const SEVERITY_LABEL = {
  high: "высокие и критические (CVSS ≥ 7)",
  critical: "только критические (CVSS ≥ 9)",
};

// Описание заявки — HTML (веб-карточка рендерит через DOMPurify, письма
// встраивают как есть): порог, per-device блок с версиями, CVE и ссылкой.
const buildDescription = (endangered, ctx) => {
  const intro =
    "Найдены устройства Mikrotik с прошивкой, подверженной известным " +
    `уязвимостям (источник — NVD, порог: ${
      SEVERITY_LABEL[ctx.minSeverity] || ctx.minSeverity
    }).<br/>` +
    "Отмечайте пункты чек-листа по мере обновления устройств — система сама " +
    "отметит их при следующей ежедневной проверке.<br/><br/>";

  const blocks = endangered.map(({ record, status }) => {
    const cves = status.cves
      .map((cve) => `${cve.id} (${cve.severity || "?"} ${cve.score ?? "?"})`)
      .join(", ");
    return (
      `<b>«${deviceLabel(record)}»</b> (${record.credentials?.host || "—"})<br/>` +
      `RouterOS ${status.installedVersion} → ${status.latestVersion}<br/>` +
      `Уязвимости: ${cves}<br/>` +
      `${deviceLinkHtml(record)}<br/>`
    );
  });

  return intro + blocks.join("<br/>");
};

// Открытая заявка: отметить обновлённые устройства, дописать новые, при полном
// обнулении угрозы — один итоговый комментарий.
const syncOpenTicket = async (ticket, state, endangered, prefs) => {
  const endangeredIds = new Set(
    endangered.map((e) => String(e.record._id)),
  );
  const checker = {
    _id: prefs?.mikrotik?.applicant?._id,
    firstName: prefs?.mikrotik?.applicant?.firstName,
    lastName: prefs?.mikrotik?.applicant?.lastName,
  };

  // Устройство исчезло из опасного множества (обновили или отвязали) → пункт
  // отмечен. Точечный updateOne по описанию: version не бампается, гонок с
  // ручными отметками нет. Человек переписал текст пункта → no-op, терпимо.
  const nowSafe = state.items.filter(
    (item) => !item.safe && !endangeredIds.has(String(item.recordId)),
  );
  for (const item of nowSafe) {
    await Ticket.updateOne(
      { _id: ticket._id },
      {
        $set: {
          "checklist.$[el].checked": true,
          "checklist.$[el].checkedBy": checker,
        },
      },
      {
        arrayFilters: [
          { "el.description": item.description, "el.checked": false },
        ],
      },
    ).catch((error) =>
      logger.log("warn", "Mikrotik security checklist auto-check failed", {
        ticketId: ticket._id,
        description: item.description,
        error: error.message,
      }),
    );
  }
  if (nowSafe.length) {
    await MikrotikFirmwareState.updateOne(
      { _id: STATE_ID },
      { $set: { "items.$[el].safe": true } },
      {
        arrayFilters: [
          { "el.recordId": { $in: nowSafe.map((item) => item.recordId) } },
        ],
      },
    );
  }

  // Новые устройства в опасности → пункты в чек-лист + комментарий.
  const known = new Set(state.items.map((item) => String(item.recordId)));
  const fresh = endangered.filter((e) => !known.has(String(e.record._id)));
  if (fresh.length) {
    const items = fresh.map((e) => ({
      recordId: e.record._id,
      description: itemDescription(e),
      safe: false,
    }));
    await Ticket.updateOne(
      { _id: ticket._id },
      {
        $push: {
          checklist: {
            $each: items.map((item) => ({
              description: item.description,
              mandatory: false,
              checked: false,
            })),
          },
        },
      },
    );
    await MikrotikFirmwareState.updateOne(
      { _id: STATE_ID },
      { $push: { items: { $each: items } }, $unset: { allSafeCommentedAt: "" } },
    );
    await postSystemTicketComment(
      ticket._id,
      "⚠️ Обнаружены новые устройства с уязвимой прошивкой:<br/>" +
        items.map((item) => item.description).join("<br/>"),
    );
    logger.log("info", "Mikrotik security ticket extended", {
      ticketId: ticket._id,
      added: fresh.length,
    });
    return;
  }

  if (!endangered.length && !state.allSafeCommentedAt) {
    const posted = await postSystemTicketComment(
      ticket._id,
      "✅ Все устройства из заявки обновлены или больше не подвержены " +
        "известным уязвимостям.",
    );
    if (posted) {
      await MikrotikFirmwareState.updateOne(
        { _id: STATE_ID },
        { $set: { allSafeCommentedAt: new Date() } },
      );
    }
  }
};

// Клейм → создание → штамп. Провал создания откатывает клейм (guarded), повтор —
// на следующем прогоне. Фильтры на null матчат и отсутствующее поле — состояние
// чистится только через $unset, так что это ожидаемо.
const claimAndCreate = async (endangered, cfg, ctx) => {
  const claimed = await MikrotikFirmwareState.findOneAndUpdate(
    { _id: STATE_ID, ticketId: null, claimedAt: null },
    { $set: { claimedAt: new Date() } },
    { new: false },
  );
  if (!claimed) return; // заявка уже есть или параллельный прогон опередил

  const items = endangered.map((e) => ({
    recordId: e.record._id,
    description: itemDescription(e),
    safe: false,
  }));

  const ticket = await createMikrotikSystemTicket({
    title: `Уязвимая прошивка RouterOS: устройств под угрозой — ${endangered.length}`,
    description: buildDescription(endangered, ctx),
    categoryId: cfg.categoryId || null,
    checklist: items,
  });

  if (!ticket) {
    await MikrotikFirmwareState.updateOne(
      { _id: STATE_ID, ticketId: null },
      { $unset: { claimedAt: "" } },
    );
    return;
  }

  await MikrotikFirmwareState.updateOne(
    { _id: STATE_ID, claimedAt: { $ne: null }, ticketId: null },
    {
      $set: { ticketId: ticket._id, items },
      $unset: { claimedAt: "", allSafeCommentedAt: "" },
    },
  );
  logger.log("info", "Mikrotik security ticket created", {
    ticketId: ticket._id,
    devices: endangered.length,
  });
};

// Точка входа (вызывается суточным прогоном после обновления кэшей). Never
// throws — сбой синхронизации не должен ломать рефреш релизов/CVE.
const syncSecurityTicket = async (ctx) => {
  try {
    const prefs = await Preferences.findOne({}).select("mikrotik").lean();
    const cfg = prefs?.mikrotik?.securityUpdateTicket;
    if (!cfg?.isActive) return;

    const endangered = await collectEndangered(ctx);

    let state = await MikrotikFirmwareState.findOneAndUpdate(
      { _id: STATE_ID },
      { $setOnInsert: { items: [] } },
      { upsert: true, new: true },
    );

    if (state.ticketId) {
      const ticket = await Ticket.findById(state.ticketId).select(
        "num isClosed",
      );
      if (ticket && !ticket.isClosed) {
        await syncOpenTicket(ticket, state, endangered, prefs);
        return;
      }
      // Удалена (hard delete) или закрыта — забываем её; если угроза осталась,
      // ниже будет создана новая (в этот же суточный прогон).
      logger.log("warn", "Mikrotik security ticket gone or closed — resetting", {
        ticketId: state.ticketId,
        closed: Boolean(ticket),
      });
      await MikrotikFirmwareState.updateOne(
        { _id: STATE_ID },
        {
          $set: { items: [] },
          $unset: { ticketId: "", claimedAt: "", allSafeCommentedAt: "" },
        },
      );
    }

    if (!endangered.length) return;
    await claimAndCreate(endangered, cfg, ctx);
  } catch (error) {
    logger.log("error", "Mikrotik security ticket sync failed", {
      error: error.message,
    });
  }
};

module.exports = { syncSecurityTicket };
