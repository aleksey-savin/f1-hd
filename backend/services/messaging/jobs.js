const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { MAX_ATTEMPTS, backoffMs } = require("./rules");

/**
 * Очередь шлюза: отправка сообщений и команды. Выдача — арендой (как очередь
 * telegram-уведомлений, controllers/bot.js): findOneAndUpdate атомарен, одно
 * задание дважды не уходит, транзакций не нужно. Порядок в диалоге: выдаётся
 * только голова очереди диалога — более новое сообщение не обгонит старое,
 * которое ждёт повтора.
 */

const LEASE_MS = 2 * 60 * 1000;
// Команды шлюзу, итог которых ждут настройки каналов: вход, выход, проверка
// прокси, история. Их подтверждение двигает тему пульса «channels»
const COMMAND_JOB_TYPES = new Set(["login", "logout", "testProxy", "loadHistory"]);
const MAX_PAUSE_MS = 6 * 3600 * 1000;

// Долгий опрос шлюза просыпается, как только появилось задание
const signal = new EventEmitter();
signal.setMaxListeners(100);

/** Поля задания после ответа шлюза. Чисто. */
const applyAck = (job, result, now = Date.now()) => {
  const lastError = String(result?.error || "").slice(0, 500);
  if (result?.ok) return { state: "done", attempts: job.attempts + 1, lastError: "", finishedAt: new Date(now) };
  // FLOOD_WAIT и прочие «подождите»: пауза, а не попытка
  if (Number.isFinite(result?.retryAfterMs) && result.retryAfterMs > 0) {
    return {
      state: "pending",
      attempts: job.attempts,
      lastError,
      notBefore: new Date(now + Math.min(result.retryAfterMs, MAX_PAUSE_MS)),
    };
  }
  const attempts = job.attempts + 1;
  if (result?.retryable === false || attempts >= MAX_ATTEMPTS) {
    return { state: "failed", attempts, lastError, finishedAt: new Date(now) };
  }
  return { state: "pending", attempts, lastError, notBefore: new Date(now + backoffMs(attempts)) };
};

const enqueueJob = async (fields) => {
  const ChannelJob = require("@/models/channelJob");
  const job = await ChannelJob.create(fields);
  signal.emit("job", job.network);
  return job;
};

const leaseJobs = async ({ networks, provider = 'gateway', limit = 10, now = new Date() }) => {
  const ChannelJob = require("@/models/channelJob");
  const free = { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] };
  const transport = provider === 'wazzup' ? { provider: 'wazzup' } : require('./transport').gatewayFilter();
  // Reduce each queue to its actual head before filtering by lease or backoff.
  // Commands without a queue key each form their own group.
  const heads = await ChannelJob.aggregate([
    { $match: { ...transport, state: "pending", network: { $in: networks } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: {
      _id: { $ifNull: ["$orderingKey", "$conversationId", "$_id"] },
      jobId: { $first: "$_id" }, createdAt: { $first: "$createdAt" },
      notBefore: { $first: "$notBefore" }, leaseUntil: { $first: "$leaseUntil" },
    } },
    { $match: { notBefore: { $lte: now }, ...free } },
    { $sort: { createdAt: 1, jobId: 1 } },
    { $limit: limit },
  ]);
  const leaseId = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const jobs = [];
  for (const job of heads) {
    const taken = await ChannelJob.findOneAndUpdate(
      { _id: job.jobId, state: "pending", notBefore: { $lte: now }, ...free },
      { $set: { leaseId, leaseUntil } },
      { returnDocument: "after" },
    ).lean();
    if (taken) jobs.push(taken);
  }
  return { leaseId, leaseUntil, jobs };
};

/** Долгий опрос: ждать задание для своих сетей не дольше ms. */
const waitForJob = (networks, ms) =>
  new Promise((resolve) => {
    const onJob = (network) => {
      if (!networks.includes(network)) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal.off("job", onJob);
    };
    signal.on("job", onJob);
  });

const applyMediaOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const list = result?.result?.attachments;
  if (job.state !== "done" || !Array.isArray(list)) return;
  await Message.updateOne(
    { _id: job.messageId },
    {
      $set: {
        attachments: list.slice(0, 20).map((a) => ({
          name: String(a.name || ""),
          originalName: String(a.originalName || ""),
          mimetype: String(a.mimetype || ""),
          size: Number(a.size) || 0,
          durationSec: Number.isFinite(a.durationSec) ? a.durationSec : null,
          status: ["ready", "skipped", "failed"].includes(a.status) ? a.status : "ready",
          externalRef: String(a.externalRef || ""),
        })),
      },
    },
  );
};

const ackJobs = async (leaseId, results, { now, provider = 'gateway' } = {}) => {
  const ChannelJob = require("@/models/channelJob");
  let applied = 0;
  let ignored = 0;
  for (const result of results) {
    // Сбой одного подтверждения не уносит соседей; итог в сообщение пишется отдельно, задание уже закрыто
    try {
      const activeLease = () => ({
        _id: result?.id, state: "pending", leaseId, leaseUntil: { $gt: new Date(now ?? Date.now()) },
        ...(provider === 'wazzup' ? { provider: 'wazzup' } : require('./transport').gatewayFilter()),
      });
      const snapshot = await ChannelJob.findOne(activeLease());
      if (!snapshot) {
        ignored += 1;
        continue;
      }
      const patch = { ...applyAck(snapshot, result, now ?? Date.now()), leaseId: null, leaseUntil: null };
      if (snapshot.type === "login") patch.payload = { ...snapshot.payload, value: null };
      if (snapshot.type === "send" && snapshot.messageId && patch.state !== "pending") {
        patch.outcomeApplied = false;
      }
      // A status webhook may have appended delivery evidence since our read.
      // Merge only fields returned by the sender into the current checkpoint.
      const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { $literal: value }]));
      if (provider === "wazzup") {
        const { delivery: _delivery, ...progress } = result.result || {};
        fields.result = { $mergeObjects: ["$result", { $literal: progress }] };
      } else {
        fields.result = { $literal: result.result ?? null };
      }
      const commitFilter = activeLease();
      if (now === undefined) commitFilter.$expr = { $gt: ["$leaseUntil", "$$NOW"] };
      const job = await ChannelJob.findOneAndUpdate(commitFilter, [{ $set: fields }], {
        updatePipeline: true, returnDocument: "after",
      }).lean();
      if (!job) {
        ignored += 1;
        continue;
      }
      applied += 1;
      if (COMMAND_JOB_TYPES.has(job.type)) require("@/services/pulse").bus.bump({ topics: ["channels"] });

      // Итог в сообщение пишется отдельно, задание уже закрыто — ошибка здесь не отменяет подтверждение
      try {
        if (job.type === "send" && job.messageId) {
          if (job.state === "pending") {
            await require("@/models/message").updateOne({ _id: job.messageId, jobId: job._id, status: "queued" }, { $set: { error: job.lastError } });
          } else {
            await require("./send-outcome").projectSendOutcome(job);
          }
        }
        if (job.type === "fetchMedia" && job.messageId) await applyMediaOutcome(job, result);
      } catch (error) {
        require("@/utils/logger").log("warn", "Итог задания шлюза не записан в сообщение", { module: "messaging", jobId: String(job._id), error: error?.message });
      }
    } catch (error) {
      require("@/utils/logger").log("warn", "Подтверждение задания шлюза не применено", { module: "messaging", jobId: String(result?.id), error: error?.message });
      ignored += 1;
    }
  }
  return { applied, ignored };
};

module.exports = { LEASE_MS, applyAck, enqueueJob, leaseJobs, ackJobs, waitForJob };
