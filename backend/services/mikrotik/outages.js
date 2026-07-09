const MikrotikOutage = require("../../models/mikrotikOutage");
const Comment = require("../../models/comment");
const TicketLog = require("../../models/ticketLog");
const { Ticket } = require("../../models/ticket");
const Preferences = require("../../models/preferences");
const { deviceLabel, fmtTime } = require("./tickets");
const logger = require("../../utils/logger");

// Outage-episode bookkeeping for monitored Mikrotik devices. Episodes power the
// availability report and the "connectivity restored" ticket comment. Every
// mutation here is best-effort and NEVER throws — report bookkeeping must not be
// able to break the health-check / alert crons or a parameter save.
//
// Concurrency: the "one open episode per device" invariant is enforced by a
// partial unique index on { mikrotik } where { open: true } (see the model), so
// concurrent upserts can only race into a duplicate-key error, which is swallowed.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// "1 д 4 ч 12 мин" / "35 мин" / "меньше минуты".
const formatDurationRu = (ms) => {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) return "меньше минуты";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (minutes) parts.push(`${minutes} мин`);
  return parts.join(" ");
};

// Open an episode for a device that is (still) offline. Called on every failed
// poll: cheap (one indexed upsert), keeps lastError fresh, and self-heals devices
// that were already offline before episode tracking existed — startedAt takes the
// historical offlineSince, not "now". `mikrotik` and `open` land on the inserted
// doc from the equality filter (adding them to $setOnInsert would conflict).
const ensureOpenOutage = async (record) => {
  try {
    await MikrotikOutage.findOneAndUpdate(
      { mikrotik: record._id, open: true },
      {
        $setOnInsert: { startedAt: record.offlineSince || new Date() },
        $set: { lastError: record.lastError || undefined },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) return; // lost a concurrent upsert race — fine
    logger.log("error", "Mikrotik outage open failed", {
      recordId: record._id,
      error: error.message,
    });
  }
};

// Stamp the offline-alert ticket onto the current episode (self-heals a missing
// episode the same way as ensureOpenOutage).
const attachTicket = async (record, ticketId) => {
  try {
    await MikrotikOutage.findOneAndUpdate(
      { mikrotik: record._id, open: true },
      {
        $set: { ticketId },
        $setOnInsert: { startedAt: record.offlineSince || new Date() },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) return;
    logger.log("error", "Mikrotik outage ticket stamp failed", {
      recordId: record._id,
      ticketId,
      error: error.message,
    });
  }
};

// Post the "connectivity restored" comment on the outage's alert ticket. Follows
// the system-comment pattern of the email pipeline: the author is
// Preferences.defaultApplicant, the comment id is pushed into ticket.comments
// (the UI only shows populated ticket.comments), notifications.pending lets the
// notifications cron deliver it, and ticket.version is NOT bumped (comments never
// trip the optimistic lock). The ticket itself stays open for a human.
const postRecoveryComment = async (record, { startedAt, endedAt }) => {
  const prefs = await Preferences.findOne({});
  const authorId = prefs?.defaultApplicant?._id;
  if (!authorId) {
    logger.warn(
      "Mikrotik recovery comment skipped: Preferences.defaultApplicant is not set",
    );
    return;
  }

  const ticket = await Ticket.findById(record.alertTicketId).select("num");
  if (!ticket) {
    logger.log("warn", "Mikrotik recovery comment skipped: ticket not found", {
      recordId: record._id,
      ticketId: record.alertTicketId,
    });
    return;
  }

  // Времена — в таймзоне приложения (как и в описании исходной заявки).
  const timeZone = prefs?.timezone;
  const downtime = startedAt
    ? `\nПродолжительность простоя: ${formatDurationRu(
        endedAt - new Date(startedAt),
      )} (с ${fmtTime(startedAt, timeZone)}).`
    : "";
  const comment = new Comment({
    content:
      `🟢 Связь с устройством «${deviceLabel(record)}» восстановлена ` +
      `${fmtTime(endedAt, timeZone)}.${downtime}`,
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
      firstName: prefs.defaultApplicant?.firstName,
      lastName: prefs.defaultApplicant?.lastName,
    },
    severity: "info",
    event: "добавлен комментарий",
  });
  await logEntry.save();

  logger.log("info", "Mikrotik recovery comment added", {
    recordId: record._id,
    ticketId: ticket._id,
  });
};

// Recovery: close the open episode (self-heal a missing one from offlineSince)
// and, if an alert ticket was raised for this outage, comment on it. Does NOT
// save the record — the caller owns clearing offlineSince/offlineAlertedAt/
// alertTicketId and persisting, so there is a single save per poll cycle.
const markRecovered = async (record) => {
  try {
    const endedAt = new Date();

    const close = { $set: { endedAt }, $unset: { open: 1 } };
    if (record.alertTicketId) close.$set.ticketId = record.alertTicketId;
    let outage = await MikrotikOutage.findOneAndUpdate(
      { mikrotik: record._id, open: true },
      close,
      { new: true },
    );
    if (!outage && record.offlineSince) {
      // The outage predates episode tracking — record it retroactively.
      outage = await MikrotikOutage.create({
        mikrotik: record._id,
        startedAt: record.offlineSince,
        endedAt,
        ticketId: record.alertTicketId || null,
      });
    }

    if (record.alertTicketId) {
      await postRecoveryComment(record, {
        startedAt: outage?.startedAt || record.offlineSince,
        endedAt,
      });
    }
  } catch (error) {
    logger.log("error", "Mikrotik outage recovery bookkeeping failed", {
      recordId: record._id,
      error: error.message,
    });
  }
};

// Silent close for "monitoring turned off" (disconnect): connectivity was not
// restored, so no recovery comment; the episode just ends here — otherwise it
// would stay open forever (no more polls) and poison the availability math.
const closeOpenOutage = async (record) => {
  try {
    await MikrotikOutage.updateOne(
      { mikrotik: record._id, open: true },
      { $set: { endedAt: new Date() }, $unset: { open: 1 } },
    );
  } catch (error) {
    logger.log("error", "Mikrotik outage close failed", {
      recordId: record._id,
      error: error.message,
    });
  }
};

// Detach/delete of a management record removes its episodes too (consistent with
// detach deleting credentials and polled data; the report is record-scoped, so
// orphans would be unreachable anyway).
const deleteOutages = async (recordId) => {
  try {
    await MikrotikOutage.deleteMany({ mikrotik: recordId });
  } catch (error) {
    logger.log("error", "Mikrotik outage cleanup failed", {
      recordId,
      error: error.message,
    });
  }
};

// Clamp outage docs to a [from, to] window (ms) and merge overlaps. Returns the
// merged [start, end] pairs — shared by the full report and the list-wide map.
const clampAndMergeIntervals = (docs, fromMs, toMs) => {
  const clamped = [];
  for (const doc of docs) {
    const start = Math.max(new Date(doc.startedAt).getTime(), fromMs);
    const end = Math.min(
      doc.endedAt ? new Date(doc.endedAt).getTime() : toMs,
      toMs,
    );
    if (end > start) clamped.push([start, end]);
  }
  clamped.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of clamped) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

// Availability over the trailing `days` window, clamped to when the device was
// enrolled (record.createdAt — there is no monitoring-toggle history). KPIs are
// computed on window-clamped, overlap-merged intervals so glitched data can never
// yield >100% downtime; the outages list keeps the real episode bounds for
// display. Downtime counts from the connectivity-loss edge (offlineSince), not
// from the alert threshold. May throw — the controller handles errors.
const computeAvailability = async (record, { days }) => {
  const to = new Date();
  const from = new Date(to.getTime() - days * MS_PER_DAY);
  const monitoredSince = record.createdAt || from;
  const effectiveFrom = monitoredSince > from ? monitoredSince : from;
  const windowMs = Math.max(0, to.getTime() - effectiveFrom.getTime());

  const docs = await MikrotikOutage.find({
    mikrotik: record._id,
    startedAt: { $lte: to },
    $or: [{ endedAt: null }, { endedAt: { $gte: effectiveFrom } }],
  })
    .sort({ startedAt: 1 })
    .populate("ticketId", "num")
    .lean();

  const merged = clampAndMergeIntervals(
    docs,
    effectiveFrom.getTime(),
    to.getTime(),
  );
  let downtimeMs = 0;
  let longestMs = 0;
  const outageCount = merged.length;
  for (const [start, end] of merged) {
    downtimeMs += end - start;
    longestMs = Math.max(longestMs, end - start);
  }

  const uptimePct =
    windowMs > 0
      ? Math.round((1 - downtimeMs / windowMs) * 10000) / 100
      : null;

  const outages = docs
    .map((doc) => ({
      id: doc._id,
      startedAt: doc.startedAt,
      endedAt: doc.endedAt || null,
      durationMs:
        (doc.endedAt ? new Date(doc.endedAt) : to).getTime() -
        new Date(doc.startedAt).getTime(),
      ongoing: !doc.endedAt,
      ticketId: doc.ticketId?._id || null,
      ticketNum: doc.ticketId?.num || null,
      lastError: doc.lastError || null,
    }))
    .reverse(); // newest first

  return {
    from,
    to,
    effectiveFrom,
    monitoredSince,
    windowMs,
    uptimePct,
    downtimeMs,
    outageCount,
    longestMs,
    current: {
      status: record.status,
      offlineSince: record.offlineSince || null,
      monitoringEnabled: record.monitoringEnabled,
    },
    outages,
  };
};

// 30-дневный рейтинг доступности для СПИСКА записей одним запросом (колонка
// таблицы управления). Возвращает Map(String(recordId) → pct | null), где null =
// «недостаточно данных» (запись только что создана). Математика та же, что в
// computeAvailability: окно клампится к monitoredSince, перекрытия сливаются.
const computeUptimeMap = async (records, { days = 30 } = {}) => {
  const map = new Map();
  if (!records.length) return map;

  const to = new Date();
  const from = new Date(to.getTime() - days * MS_PER_DAY);

  const docs = await MikrotikOutage.find({
    mikrotik: { $in: records.map((record) => record._id) },
    startedAt: { $lte: to },
    $or: [{ endedAt: null }, { endedAt: { $gte: from } }],
  })
    .select("mikrotik startedAt endedAt")
    .lean();

  const byRecord = new Map();
  for (const doc of docs) {
    const key = String(doc.mikrotik);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(doc);
  }

  for (const record of records) {
    const key = String(record._id);
    const monitoredSince = record.createdAt || from;
    const effectiveFrom = monitoredSince > from ? monitoredSince : from;
    const windowMs = to.getTime() - effectiveFrom.getTime();
    if (windowMs <= 0) {
      map.set(key, null);
      continue;
    }

    const merged = clampAndMergeIntervals(
      byRecord.get(key) || [],
      effectiveFrom.getTime(),
      to.getTime(),
    );
    let downtimeMs = 0;
    for (const [start, end] of merged) {
      downtimeMs += end - start;
    }
    map.set(key, Math.round((1 - downtimeMs / windowMs) * 10000) / 100);
  }

  return map;
};

module.exports = {
  ensureOpenOutage,
  attachTicket,
  markRecovered,
  closeOpenOutage,
  deleteOutages,
  computeAvailability,
  computeUptimeMap,
  formatDurationRu,
};
