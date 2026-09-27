const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { MAX_ATTEMPTS, backoffMs, advanceStatus } = require("./rules");

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

/** Голова очереди каждого диалога + задания без диалога. Чисто. */
const pickHeads = (candidates, headIds, limit) => {
  const heads = new Set(headIds.map(String));
  return candidates.filter((job) => !job.conversationId || heads.has(String(job._id))).slice(0, limit);
};

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

const leaseJobs = async ({ networks, limit = 10, now = new Date() }) => {
  const mongoose = require("mongoose");
  const ChannelJob = require("@/models/channelJob");
  const free = { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] };
  const candidates = await ChannelJob.find({ state: "pending", network: { $in: networks }, notBefore: { $lte: now }, ...free })
    .sort({ createdAt: 1 })
    .limit(limit * 5)
    .lean();
  const conversationIds = [...new Set(candidates.map((job) => job.conversationId).filter(Boolean).map(String))];
  const heads = conversationIds.length
    ? await ChannelJob.aggregate([
        {
          $match: {
            state: "pending",
            conversationId: { $in: conversationIds.map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        { $sort: { createdAt: 1 } },
        { $group: { _id: "$conversationId", jobId: { $first: "$_id" } } },
      ])
    : [];

  const leaseId = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const jobs = [];
  for (const job of pickHeads(candidates, heads.map((row) => row.jobId), limit)) {
    const taken = await ChannelJob.findOneAndUpdate(
      { _id: job._id, state: "pending", ...free },
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

/** Итог отправки — в сообщение и в комментарий, если ответ ушёл из заявки. */
const applySendOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  const { bus } = require("@/services/pulse");
  const message = await Message.findById(job.messageId);
  if (!message) return;
  if (job.state === "done") {
    message.status = advanceStatus(message.status, "sent");
    message.error = "";
    if (result?.result?.externalId && !message.externalId) message.externalId = String(result.result.externalId);
    if (Array.isArray(result?.result?.externalIds)) message.externalIds = result.result.externalIds.map(String);
  } else if (job.state === "failed") {
    message.status = advanceStatus(message.status, "failed");
    message.error = job.lastError || "Не отправлено";
  } else {
    message.error = job.lastError || "";
  }
  try {
    await message.save();
  } catch (error) {
    // Эхо с тем же внешним id успело прийти раньше подтверждения без jobId —
    // статус сохраняем, id оставляем эху (шлюз обязан метить эхо jobId)
    if (error?.code !== 11000) throw error;
    message.externalId = undefined;
    await message.save();
  }
  if (message.commentId) {
    // Клиенту — только фиксированный текст на «failed»; сырой job.lastError
    // остаётся в Message.error/ChannelJob.lastError (виден только сотрудникам).
    // $set: undefined ничего не чистит (Mongoose его вырезает) — нужен $unset
    await Comment.updateOne(
      { _id: message.commentId },
      message.status === "failed"
        ? { $set: { "channel.status": message.status, "channel.statusAt": new Date(), "channel.error": "Не доставлено" } }
        : { $set: { "channel.status": message.status, "channel.statusAt": new Date() }, $unset: { "channel.error": 1 } },
    );
  }
  bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
};

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

const ackJobs = async (leaseId, results, { now = Date.now() } = {}) => {
  const ChannelJob = require("@/models/channelJob");
  let applied = 0;
  let ignored = 0;
  for (const result of results) {
    // Сбой одного подтверждения не уносит соседей; итог в сообщение пишется отдельно, задание уже закрыто
    try {
      let job = null;
      try {
        job = await ChannelJob.findOne({ _id: result?.id, leaseId });
      } catch {
        job = null;
      }
      if (!job) {
        ignored += 1;
        continue;
      }
      Object.assign(job, applyAck(job, result, now), { leaseId: null, leaseUntil: null, result: result.result ?? null });
      // Код и пароль входа не храним ни минуты дольше нужного
      if (job.type === "login") job.payload = { ...job.payload, value: null };
      await job.save();
      applied += 1;
      if (COMMAND_JOB_TYPES.has(job.type)) require("@/services/pulse").bus.bump({ topics: ["channels"] });

      // Итог в сообщение пишется отдельно, задание уже закрыто — ошибка здесь не отменяет подтверждение
      try {
        if (job.type === "send" && job.messageId) await applySendOutcome(job, result);
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

module.exports = { LEASE_MS, pickHeads, applyAck, enqueueJob, leaseJobs, ackJobs, waitForJob };
