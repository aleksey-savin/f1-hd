const mongoose = require("mongoose");
const mime = require("mime-types");

const Channel = require("@/models/channel");
const { AppError } = require("@/middleware/errorHandling");
const { decryptSecret } = require("@/services/crypto/secretBox");
const storage = require("@/services/storage");
const logger = require("@/utils/logger");
const { validateEvent } = require("@/services/messaging/events");
const { ingestEvent } = require("@/services/messaging/ingest");
const { leaseJobs, ackJobs, waitForJob } = require("@/services/messaging/jobs");
const { GATEWAY_NETWORKS } = require("@/services/messaging/rules");

/** Ручки шлюза мессенджеров; список — routes/gateway.js, контракт — docs/messaging.md. */

const MAX_EVENTS = 50;
const MAX_WAIT_S = 25;

const open = (value) => {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
};

const networksOf = (raw) => {
  const asked = String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
  return (asked.length ? asked : GATEWAY_NETWORKS).filter((network) => GATEWAY_NETWORKS.includes(network));
};

exports.channels = async (req, res, next) => {
  try {
    const channels = await Channel.find({ type: { $in: networksOf(req.query.types) }, isActive: true }).lean();
    res.status(200).json({
      channels: channels.map((channel) => ({
        id: String(channel._id),
        type: channel.type,
        name: channel.name,
        state: channel.state,
        account: channel.account || {},
        settings: {
          proxyUrl: channel.settings?.proxyUrl || "",
          historyDays: channel.settings?.historyDays ?? 14,
          importGroups: channel.settings?.importGroups !== false,
          markReadOnOpen: channel.settings?.markReadOnOpen !== false,
          maxMediaMb: channel.settings?.maxMediaMb ?? 50,
          ignoredChatIds: channel.settings?.ignoredChatIds || [],
        },
        secrets: {
          tgApiId: open(channel.secrets?.tgApiId),
          tgApiHash: open(channel.secrets?.tgApiHash),
          proxyPassword: open(channel.secrets?.proxyPassword),
        },
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось отдать каналы", 500, true, error));
  }
};

exports.events = async (req, res, next) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) {
      return next(new AppError(`Ожидается events: от 1 до ${MAX_EVENTS}`, 400));
    }
    const results = [];
    for (const raw of events) {
      const checked = validateEvent(raw);
      if (!checked.ok) {
        results.push({ ok: false, retryable: false, error: checked.error });
        continue;
      }
      try {
        results.push(await ingestEvent(checked.event));
      } catch (error) {
        logger.log("error", "Событие канала не принято", {
          module: "messaging",
          type: raw?.type,
          channelId: String(raw?.channelId || ""),
          error: error.message,
        });
        results.push({ ok: false, retryable: true, error: "сбой приёма, повторите" });
      }
    }
    res.status(200).json({ results });
  } catch (error) {
    next(new AppError("Не удалось принять события", 500, true, error));
  }
};

exports.mediaUploaded = (req, res, next) => {
  if (!req.file) return next(new AppError("Ожидается файл в поле file", 400));
  // multer отдаёт имя файла в latin1 — кириллица без перекодировки ломается
  const originalName = String(
    req.body?.originalName || Buffer.from(req.file.originalname || "", "latin1").toString("utf8"),
  ).slice(0, 300);
  res.status(201).json({ name: req.file.key, originalName, mimetype: req.file.mimetype, size: req.file.size });
};

exports.media = async (req, res, next) => {
  try {
    const buffer = await storage.getObjectBuffer(req.params.name);
    res.type(mime.lookup(req.params.name) || "application/octet-stream").send(buffer);
  } catch (error) {
    next(new AppError("Файл не найден", 404, true, error));
  }
};

const openPayload = (job) =>
  job.type === "login" && job.payload?.value ? { ...job.payload, value: open(job.payload.value) } : job.payload || {};

exports.jobs = async (req, res, next) => {
  try {
    const networks = networksOf(req.query.types);
    const waitMs = Math.min(Math.max(Number(req.query.wait) || 0, 0), MAX_WAIT_S) * 1000;
    let batch = await leaseJobs({ networks });
    if (!batch.jobs.length && waitMs) {
      await waitForJob(networks, waitMs);
      batch = await leaseJobs({ networks });
    }
    res.status(200).json({
      leaseId: batch.leaseId,
      leaseExpiresAt: batch.leaseUntil,
      jobs: batch.jobs.map((job) => ({
        id: String(job._id),
        type: job.type,
        channelId: String(job.channelId),
        conversationId: job.conversationId ? String(job.conversationId) : null,
        messageId: job.messageId ? String(job.messageId) : null,
        attempt: job.attempts,
        payload: openPayload(job),
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось выдать задания", 500, true, error));
  }
};

exports.ack = async (req, res, next) => {
  try {
    const { leaseId, results } = req.body || {};
    if (!leaseId || !Array.isArray(results) || results.length > 50) {
      return next(new AppError("Ожидаются leaseId и results", 400));
    }
    res.status(200).json(await ackJobs(String(leaseId), results));
  } catch (error) {
    next(new AppError("Не удалось принять подтверждение", 500, true, error));
  }
};

exports.heartbeat = async (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.channels) ? req.body.channels.slice(0, 50) : [])
      .map((item) => item?.id)
      .filter((id) => mongoose.isValidObjectId(id));
    if (ids.length) await Channel.updateMany({ _id: { $in: ids } }, { $set: { gatewaySeenAt: new Date() } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(new AppError("Не удалось принять heartbeat", 500, true, error));
  }
};
