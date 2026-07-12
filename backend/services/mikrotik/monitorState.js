const Mikrotik = require("../../models/mikrotik");
const {
  decodeKnockSequence,
  decryptSecret,
  buildSshParams,
  mapPollToFields,
} = require("./connector");
const { ensureOpenOutage, markRecovered } = require("./outages");
const logger = require("../../utils/logger");

// The online↔offline state machine for a monitored Mikrotik record, shared by the
// health-check cron and the offline-alert cron (which re-polls before ticketing).
//
// Every transition is a SINGLE atomic findOneAndUpdate. The old code loaded a
// document at the top of a tick and save()d it at the bottom, so two crons holding
// two copies overwrote each other's fields: a recovery could erase the alertTicketId
// the alert cron had just written (losing the "connectivity restored" comment), and
// an alert could re-stamp offlineAlertedAt onto an already-online device (silently
// blocking every future alert for it).
//
// Anti-flap: one failed poll is not an outage. failedPolls counts consecutive failed
// cycles and only CONFIRM_POLLS of them flip the status. firstFailureAt records the
// candidate loss edge and becomes offlineSince on confirmation, so the downtime clock
// (and the alert threshold) still runs from the moment connectivity actually died —
// hysteresis costs no alerting latency, it only filters out blips.

// How many consecutive failed poll cycles confirm an outage. Note each cycle already
// contains one immediate retry, so the default means ~4 failed attempts over ~5 min.
// Raising this raises the floor on time-to-ticket: alerts can never fire sooner than
// CONFIRM_POLLS × the health-check interval, regardless of `thresholdMinutes`.
const CONFIRM_POLLS = Number(process.env.MIKROTIK_OFFLINE_CONFIRM_POLLS) || 2;

// A poll result maps onto sparse fields (identity may be missing, a CHR has no
// serial); undefined values must not reach $set.
const definedOnly = (fields) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

// Build the poll parameters for a stored record (secrets decrypted here, once).
// Транзит (jump) сюда не входит: его контекст резолвится отдельно (см. ниже) и
// передаётся вызывателем — один роутер обслуживает многих зависимых за тик.
const pollParams = (record) => ({
  host: record.credentials.host,
  port: record.credentials.port,
  user: record.credentials.user,
  password: decryptSecret(record.credentials.password),
  tlsCert: record.credentials.tlsCert,
  knockSequence: decodeKnockSequence(record.credentials.knockSequence),
});

// Висячая ссылка на транзит (роутер удалён мимо guard'а или гонка с detach).
// Код маппится describeConnectionError → 422; сообщение попадает в lastError.
const jumpRecordMissingError = () => {
  const error = new Error(
    "Транзитное устройство не найдено — ссылка на удалённую запись. " +
      "Пересохраните параметры подключения",
  );
  error.code = "MIKROTIK_JUMP_RECORD_MISSING";
  return error;
};

// «Подключение через устройство»: разрешает транзит одной записи. null —
// прямое подключение; бросает MIKROTIK_JUMP_RECORD_MISSING для висячей ссылки.
const resolveJumpContext = async (record) => {
  if (!record.jumpRecordId) return null;
  const doc = await Mikrotik.findById(record.jumpRecordId);
  if (!doc?.credentials?.host) throw jumpRecordMissingError();
  return { doc, params: buildSshParams(doc) };
};

// Один запрос на тик: контексты уникальных транзитов списка устройств (секреты
// каждого роутера расшифровываются один раз). Непригодный транзит (нет записи,
// битые креды) в Map не попадает — вызыватель отличает «нет jumpRecordId» от
// «висячей ссылки» сам.
const loadJumpContexts = async (devices) => {
  const contexts = new Map();
  const ids = [
    ...new Set(
      devices
        .filter((device) => device.jumpRecordId)
        .map((device) => String(device.jumpRecordId)),
    ),
  ];
  if (ids.length === 0) return contexts;

  const docs = await Mikrotik.find({ _id: { $in: ids } });
  for (const doc of docs) {
    if (!doc.credentials?.host) continue;
    try {
      contexts.set(String(doc._id), { doc, params: buildSshParams(doc) });
    } catch (error) {
      // Секреты роутера не расшифровались — как транзит он непригоден;
      // зависимые в этот тик получат «транзит не найден», а причина — в логе.
      logger.log("error", "Mikrotik jump context unavailable", {
        jumpRecordId: String(doc._id),
        error: error.message,
      });
    }
  }
  return contexts;
};

// A successful poll. One atomic update flips the record to online, clears the whole
// offline/alert state and returns the PRE-update document, which is what makes the
// recovery correct:
//   - the DB says "online" before the slow markRecovered bookkeeping runs, closing
//     the window in which a concurrent alert cron saw a stale "offline";
//   - `prev.alertTicketId` is the value that existed at update time — including one
//     written a moment ago by the alert cron — so the recovery comment lands on the
//     right ticket instead of being lost;
//   - `prev.offlineSince` is truthy for exactly ONE of two concurrent recoveries, so
//     the comment is posted exactly once.
// Gating on offlineSince (not on status) also means an unconfirmed blip never fabricates
// a retroactive outage episode, and `disconnect` (status offline, no offlineSince) is
// correctly not treated as a recovery.
const recoverToOnline = async (record, poll, now = new Date()) => {
  const set = definedOnly({
    ...mapPollToFields(poll),
    status: "online",
    lastSuccessfulConnectionAt: now,
    lastCheckedAt: now,
    failedPolls: 0,
  });
  // Trust-on-first-use: pin the observed cert, never overwrite an existing pin.
  if (poll.tlsCert && !record.credentials?.tlsCert) {
    set["credentials.tlsCert"] = poll.tlsCert;
  }

  const prev = await Mikrotik.findOneAndUpdate(
    { _id: record._id },
    {
      $set: set,
      $unset: {
        lastError: "",
        offlineSince: "",
        offlineAlertedAt: "",
        alertTicketId: "",
        firstFailureAt: "",
      },
    },
    { new: false },
  );

  if (prev?.offlineSince) {
    await markRecovered(prev);
    logger.log("info", "Mikrotik device recovered", {
      recordId: record._id,
      host: record.credentials?.host,
      offlineSince: prev.offlineSince,
      hadTicket: Boolean(prev.alertTicketId),
    });
  }
  return prev;
};

// A failed poll cycle (the poll and its retry both failed). Counts the failure and
// confirms the outage once the counter reaches the threshold.
//
// $min stamps firstFailureAt on the first failure (it creates the field when absent)
// and keeps the earliest value afterwards — no read-modify-write, no lost edge. It is
// why firstFailureAt must only ever be $unset, never set to null: a stored null sorts
// before every date and would freeze $min forever.
const recordFailure = async (record, error, now = new Date()) => {
  const host = record.credentials?.host;
  const after = await Mikrotik.findOneAndUpdate(
    { _id: record._id },
    {
      $inc: { failedPolls: 1 },
      $min: { firstFailureAt: now },
      $set: { lastCheckedAt: now, lastError: error.message },
    },
    { new: true },
  );
  if (!after) return null;

  if (after.status === "offline") {
    // Already in a confirmed outage — keep the episode's lastError fresh.
    await ensureOpenOutage(after);
    return after;
  }

  if (after.failedPolls < CONFIRM_POLLS) {
    logger.log("info", "Mikrotik poll failed (outage not confirmed yet)", {
      recordId: record._id,
      host,
      failedPolls: after.failedPolls,
      error: error.message,
    });
    return after;
  }

  // Compare-and-set so exactly one caller performs the online→offline transition
  // and opens exactly one episode.
  const confirmed = await Mikrotik.findOneAndUpdate(
    { _id: record._id, status: { $ne: "offline" } },
    { $set: { status: "offline", offlineSince: after.firstFailureAt } },
    { new: true },
  );
  if (!confirmed) return after;

  await ensureOpenOutage(confirmed);
  logger.log("warn", "Mikrotik device confirmed offline", {
    recordId: record._id,
    host,
    offlineSince: confirmed.offlineSince,
    failedPolls: after.failedPolls,
    error: error.message,
  });
  return confirmed;
};

module.exports = {
  CONFIRM_POLLS,
  pollParams,
  jumpRecordMissingError,
  resolveJumpContext,
  loadJumpContexts,
  recoverToOnline,
  recordFailure,
};
