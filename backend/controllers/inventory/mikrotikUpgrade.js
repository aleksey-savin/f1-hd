const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const MikrotikUpgradeJob = require("../../models/mikrotikUpgradeJob");
const User = require("../../models/user");
const { loadFirmwareContext } = require("../../services/mikrotik/firmware");
const { planUpgrade } = require("../../services/mikrotik/upgradePlan");
const { CHANNEL_MODES } = require("../../services/mikrotik/upgradeConstants");
const {
  publicPlan,
  publicJob,
  isDuplicateRunning,
} = require("../../services/mikrotik/upgradeView");
const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");

// Firmware upgrade batches (docs/mikrotik-management.md, «Firmware upgrades»).
// The worker (services/mikrotik/upgradeWorker.js) does the device work; these
// endpoints plan, start, show and cancel.

const MAX_BATCH = 100;
const BUSY_MESSAGE = "Уже идёт обновление прошивки — дождитесь его окончания";

const parseBody = (body) => {
  const channel = body?.channel ?? "current";
  if (!CHANNEL_MODES.includes(channel)) {
    throw new AppError("Неизвестная ветка RouterOS", 422);
  }
  const ids = Array.isArray(body?.recordIds)
    ? [...new Set(body.recordIds.map(String))]
    : [];
  if (ids.length === 0) throw new AppError("Выберите устройства", 422);
  if (ids.length > MAX_BATCH) {
    throw new AppError(`Не больше ${MAX_BATCH} устройств за раз`, 422);
  }
  if (!ids.every((id) => mongoose.isValidObjectId(id))) {
    throw new AppError("Некорректный идентификатор устройства", 422);
  }
  return { ids, channel };
};

const buildPlan = async ({ ids, channel }) => {
  const [records, firmware, running] = await Promise.all([
    Mikrotik.find({ _id: { $in: ids } })
      .select(
        "name label credentials.host firmwareUpgradeEnabled monitoringEnabled status currentFirmware jumpRecordId",
      )
      .lean(),
    loadFirmwareContext(),
    MikrotikUpgradeJob.findOne({ status: "running" })
      .select("items.mikrotik items.state")
      .lean(),
  ]);
  const busyIds = new Set(
    (running?.items || [])
      .filter((item) => item.state === "queued" || item.state === "running")
      .map((item) => String(item.mikrotik)),
  );
  return {
    plan: planUpgrade({
      records,
      channelMode: channel,
      releases: firmware.releases,
      busyIds,
    }),
    running,
  };
};

const loadCreator = (job) =>
  User.findById(job.createdBy).select("firstName lastName").lean();

const passAppError = (next, error, message) =>
  next(error instanceof AppError ? error : new AppError(message, 500, true, error));

exports.planUpgrades = async (req, res, next) => {
  try {
    const { plan } = await buildPlan(parseBody(req.body));
    res.status(200).json(publicPlan(plan));
  } catch (error) {
    passAppError(next, error, "Не удалось составить план обновления");
  }
};

exports.createUpgrades = async (req, res, next) => {
  try {
    const input = parseBody(req.body);
    const { plan, running } = await buildPlan(input);
    if (running) return next(new AppError(BUSY_MESSAGE, 409));
    if (plan.items.length === 0) {
      return res.status(422).json({ message: "Нечего обновлять", ...publicPlan(plan) });
    }

    let job;
    try {
      job = await MikrotikUpgradeJob.create({
        channelMode: input.channel,
        createdBy: req.userId,
        items: plan.items.map((item) => ({
          mikrotik: item.mikrotik,
          name: item.name,
          channel: item.channel,
          from: { os: item.fromVersion },
          to: { os: item.toVersion },
        })),
      });
    } catch (error) {
      if (isDuplicateRunning(error)) return next(new AppError(BUSY_MESSAGE, 409));
      throw error;
    }

    logger.log("info", "Mikrotik upgrade batch created", {
      actor: req.userId,
      jobId: job._id,
      channel: input.channel,
      items: plan.items.length,
      skipped: plan.skipped.length,
      ip: req.ip,
    });
    res.status(201).json({
      job: publicJob(job.toObject(), await loadCreator(job)),
      skipped: publicPlan(plan).skipped,
    });
  } catch (error) {
    passAppError(next, error, "Не удалось запустить обновление прошивки");
  }
};

exports.getCurrentUpgrade = async (req, res, next) => {
  try {
    const job = await MikrotikUpgradeJob.findOne({ status: "running" }).lean();
    if (!job) return res.status(200).json(null);
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось получить ход обновления", 500, true, error));
  }
};

exports.getUpgrade = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.jobId)) {
      return next(new AppError("Пакет обновления не найден", 404));
    }
    const job = await MikrotikUpgradeJob.findById(req.params.jobId).lean();
    if (!job) return next(new AppError("Пакет обновления не найден", 404));
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось получить пакет обновления", 500, true, error));
  }
};

exports.cancelUpgrade = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.jobId)) {
      return next(new AppError("Пакет обновления не найден", 404));
    }
    const job = await MikrotikUpgradeJob.findOneAndUpdate(
      { _id: req.params.jobId, status: "running", cancelRequestedAt: null },
      { $set: { cancelRequestedAt: new Date() } },
      { new: true },
    ).lean();
    if (!job) return next(new AppError("Пакет уже завершён или остановка уже запрошена", 409));
    logger.log("info", "Mikrotik upgrade batch cancel requested", {
      actor: req.userId,
      jobId: job._id,
    });
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось остановить пакет обновления", 500, true, error));
  }
};
