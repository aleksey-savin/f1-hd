const crypto = require("crypto");

const Mikrotik = require("../../models/mikrotik");
const MikrotikArtifact = require("../../models/mikrotikArtifact");
const MikrotikDownloadCode = require("../../models/mikrotikDownloadCode");
const ClientDevice = require("../../models/inventory/clientDevice");
const DeviceModel = require("../../models/inventory/deviceModel");
const Vendor = require("../../models/inventory/vendor");
const Preferences = require("../../models/preferences");
const User = require("../../models/user");
const Notification = require("../../models/notification");

const {
  encryptSecret,
  decryptSecret,
  assertUserNotFullGroup,
  pollDevice,
  mapPollToFields,
  describeConnectionError,
} = require("../../services/mikrotik/connector");
const storage = require("../../services/storage");
const { decryptArtifact } = require("../../services/crypto/artifactBox");
const { computeNextRun } = require("../../services/mikrotik/schedule");
const {
  assertPublicHost,
  decodeKnockSequence,
  createArtifact,
} = require("../../services/mikrotik/artifacts");
const {
  markRecovered,
  closeOpenOutage,
  deleteOutages,
  computeAvailability,
  computeUptimeMap,
} = require("../../services/mikrotik/outages");
const {
  computeReconciliation,
  deriveSyncValues,
} = require("../../services/mikrotik/reconciliation");

const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");

// Config exports contain device secrets, so downloading one requires a step-up
// email OTP: a 6-digit code, valid 10 minutes, single-use, max 5 tries.
const DOWNLOAD_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_CODE_ATTEMPTS = 5;

// "petr@example.com" -> "p***@example.com" (don't echo the full address back).
const maskEmail = (email) => {
  const [name, domain] = String(email).split("@");
  if (!domain) return "почту";
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(1, name.length - 1))}@${domain}`;
};

// Full backup/export schedule per artifact type, embedded in each row so the
// device panel can render the schedule editor and the badges without an extra
// request. Schedules aren't secret. Defaults describe an unconfigured device.
const scheduleSummary = (record) => {
  const pick = (schedule) => ({
    frequency: schedule?.frequency || "off",
    time: schedule?.time || "03:00",
    weekday: schedule?.weekday ?? 1,
    dayOfMonth: schedule?.dayOfMonth ?? 1,
    keepLast: schedule?.keepLast ?? 10,
    lastRunAt: schedule?.lastRunAt || null,
    lastSuccessAt: schedule?.lastSuccessAt || null,
    lastError: schedule?.lastError || null,
    nextRunAt: schedule?.nextRunAt || null,
  });
  return {
    backup: pick(record?.schedules?.backup),
    export: pick(record?.schedules?.export),
  };
};

// Класс устройства по данным С САМОГО устройства (board-name из /system/resource,
// который мы уже опрашиваем): RouterOS не отдаёт «тип» отдельным полем, но
// MikroTik кодирует класс в номенклатуре серий. Используется как фолбэк, когда
// у устройства нет типа в инвентаре (standalone / карточка без типа); для
// неизвестной серии честно возвращаем null («—»), а не гадаем.
const DEVICE_KIND_PATTERNS = [
  [/^(crs|css|netpower)/, "Коммутатор"],
  [/^chr/, "Cloud Hosted Router"],
  [/^ccr/, "Маршрутизатор"],
  [
    /^(cap|wap|mantbox|basebox|netmetal|omnitik|groove|sxt|lhg|ldf|disc|wire|cube)/,
    "Точка доступа",
  ],
  [/^(hap|hex|rb|l0\d|e\d{2}|powerbox|map|audience|chateau)/, "Маршрутизатор"],
];

const deriveDeviceKind = (record) => {
  const board = String(record?.boardName || "")
    .trim()
    .toLowerCase();
  if (!board) return null;
  const match = DEVICE_KIND_PATTERNS.find(([pattern]) => pattern.test(board));
  return match ? match[1] : null;
};

// Builds the display name: RouterOS identity when configured, otherwise the
// device model name + inventory serial number.
const buildDisplayName = (record, device) => {
  if (record?.name) {
    return record.name;
  }
  const modelName = device.deviceModelId?.name || "Устройство";
  return device.serialNumber
    ? `${modelName} · SN ${device.serialNumber}`
    : modelName;
};

// Shapes one merged row for the management table. Never exposes the password.
// `protection` carries the latest backup/export artifact dates for the badges.
const buildRow = (device, record, protection) => {
  const model = device.deviceModelId;

  return {
    source: "inventory",
    clientDeviceId: device._id,
    recordId: record?._id || null,
    displayName: buildDisplayName(record, device),
    serialNumber: device.serialNumber,
    company: device.companyId
      ? { name: device.companyId.alias || device.companyId.fullTitle }
      : null,
    // Тип устройства: приоритет — тип из карточки инвентаря (таксономия
    // пользователя: маршрутизатор/коммутатор/…), фолбэк — класс по данным с
    // самого устройства (board-name).
    type:
      model?.deviceTypeId?.name ||
      device.deviceTypeId?.name ||
      deriveDeviceKind(record),
    model: model ? { name: model.name, vendor: model.vendorId?.name } : null,
    location: device.locationId
      ? { name: device.locationId.name, address: device.locationId.address }
      : null,
    status: record ? record.status || "offline" : "notConfigured",
    monitoringEnabled: record?.monitoringEnabled || false,
    host: record?.credentials?.host || null,
    boardName: record?.boardName || null,
    currentFirmware: record?.currentFirmware || null,
    addresses: record?.addresses || [],
    lastSuccessfulConnectionAt: record?.lastSuccessfulConnectionAt || null,
    lastCheckedAt: record?.lastCheckedAt || null,
    lastError: record?.lastError || null,
    schedules: scheduleSummary(record),
    lastBackupAt: protection?.lastBackupAt || null,
    lastExportAt: protection?.lastExportAt || null,
  };
};

// Shapes a standalone row (no inventory ClientDevice, e.g. Cloud Hosted Router).
const buildStandaloneRow = (record, protection) => ({
  source: "standalone",
  clientDeviceId: null,
  recordId: record._id,
  displayName:
    record.label || record.name || record.credentials?.host || "Cloud Hosted Router",
  serialNumber: record.serialNumber || null,
  company: record.companyId
    ? { name: record.companyId.alias || record.companyId.fullTitle }
    : null,
  // У standalone нет карточки инвентаря — класс определяем по самому устройству.
  type: deriveDeviceKind(record),
  model: null,
  location: null,
  status: record.status || "offline",
  monitoringEnabled: record.monitoringEnabled || false,
  host: record.credentials?.host || null,
  boardName: record.boardName || null,
  currentFirmware: record.currentFirmware || null,
  addresses: record.addresses || [],
  lastSuccessfulConnectionAt: record.lastSuccessfulConnectionAt || null,
  lastCheckedAt: record.lastCheckedAt || null,
  lastError: record.lastError || null,
  schedules: scheduleSummary(record),
  lastBackupAt: protection?.lastBackupAt || null,
  lastExportAt: protection?.lastExportAt || null,
});

// Validates connection params, opens a verified live session (SSRF-guarded,
// port-knock + TLS poll + Full-group guard) and returns the record fields to
// persist. Throws an AppError for validation/host problems and re-throws poll
// errors unchanged so the caller can classify them. Shared by the inventory and
// standalone save paths.
const verifyAndBuild = async (body, existing) => {
  const { host, user, password } = body;
  const port = Number(body.port);
  // API-SSL (TLS) is mandatory — plaintext API is never allowed, so credentials
  // and polled data can't travel in the clear. Any `useTls` from the client is
  // ignored; the device must have api-ssl configured or verification fails.
  const useTls = true;
  const knockPorts = Array.isArray(body.knockSequence)
    ? body.knockSequence
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
    : [];
  // Optional SSH port (used for backups / exports); default 22 via schema.
  const sshPortInput = Number(body.sshPort);
  const sshPort =
    Number.isInteger(sshPortInput) && sshPortInput > 0 && sshPortInput < 65536
      ? sshPortInput
      : existing?.credentials?.sshPort;
  // A changed host invalidates the previously pinned SSH host key (re-pin TOFU).
  const hostChanged = existing?.credentials?.host
    ? existing.credentials.host !== host
    : false;

  if (!host || !port || !user || !password) {
    throw new AppError("host, port, user и password обязательны", 422);
  }

  try {
    await assertPublicHost(host);
  } catch (error) {
    throw new AppError(error.message, 422, true, error);
  }

  const poll = await pollDevice({
    host,
    port,
    user,
    password,
    // Pin to the device's already-trusted cert (if any) while verifying.
    tlsCert: existing?.credentials?.tlsCert,
    knockSequence: knockPorts,
  });
  assertUserNotFullGroup(poll.users, user);

  const now = new Date();
  return {
    credentials: {
      host,
      port,
      user,
      password: encryptSecret(password),
      useTls,
      // Pin the observed cert (TOFU) or keep the previously pinned one.
      tlsCert: poll.tlsCert || existing?.credentials?.tlsCert,
      knockSequence: knockPorts.length
        ? encryptSecret(JSON.stringify(knockPorts))
        : existing?.credentials?.knockSequence,
      // Preserve SSH settings across param re-saves (this object replaces the
      // whole credentials sub-doc). Drop the pinned host key if the host changed.
      sshPort,
      sshHostKey: hostChanged ? undefined : existing?.credentials?.sshHostKey,
    },
    ...mapPollToFields(poll),
    status: "online",
    // Saving verified parameters enrols the device in the health-check cron.
    monitoringEnabled: true,
    lastSuccessfulConnectionAt: now,
    lastCheckedAt: now,
    lastError: null,
  };
};

// Maps an error thrown by verifyAndBuild() onto a clear operator-facing AppError:
// validation/host → the AppError it already is; Full-group → 409; a connection
// failure → classified via describeConnectionError (TLS/cert/timeout/login).
const mapVerifyError = (error, host) => {
  if (error instanceof AppError) return error;
  if (error.code === "MIKROTIK_FULL_GROUP_USER") {
    return new AppError(error.message, 409);
  }
  const described = describeConnectionError(error);
  return new AppError(
    described
      ? described.message
      : `Не удалось подключиться к устройству ${host}`,
    described ? described.status : 502,
    true,
    error,
  );
};

// --- Backups & config exports -------------------------------------------------

// Client-facing artifact shape (no internal storage key).
const publicArtifact = (doc) => ({
  id: doc._id,
  type: doc.type,
  trigger: doc.trigger,
  fileName: doc.fileName,
  size: doc.size,
  storage: doc.storage,
  routerOsVersion: doc.routerOsVersion,
  createdAt: doc.createdAt,
});

// Aggregates the latest artifact date per (record, type) for the table badges.
const summarizeArtifacts = async (recordIds) => {
  const map = new Map();
  if (!recordIds.length) return map;
  const rows = await MikrotikArtifact.aggregate([
    { $match: { mikrotik: { $in: recordIds } } },
    {
      $group: {
        _id: { mikrotik: "$mikrotik", type: "$type" },
        last: { $max: "$createdAt" },
      },
    },
  ]);
  for (const row of rows) {
    map.set(`${row._id.mikrotik}:${row._id.type}`, row.last);
  }
  return map;
};

const protectionFor = (map, recordId) => ({
  lastBackupAt: recordId ? map.get(`${recordId}:backup`) || null : null,
  lastExportAt: recordId ? map.get(`${recordId}:export`) || null : null,
});

// Maps a createArtifact() failure onto a clear operator-facing AppError.
const mapArtifactError = (error, host) => {
  if (error instanceof AppError) return error;
  if (error.code === "MIKROTIK_BLOCKED_HOST") {
    return new AppError(error.message, 422);
  }
  if (error.code === "MIKROTIK_SSH_HOSTKEY_MISMATCH") {
    return new AppError(error.message, 409);
  }
  const described = describeConnectionError(error);
  return new AppError(
    described ? described.message : `Не удалось подключиться к устройству ${host}`,
    described ? described.status : 502,
    true,
    error,
  );
};

// --- Schedules ----------------------------------------------------------------

const normalizeFrequency = (value) =>
  ["off", "daily", "weekly", "monthly"].includes(value) ? value : "off";

const normalizeTime = (value, fallback = "03:00") =>
  /^\d{2}:\d{2}$/.test(value) ? value : fallback;

const clampInt = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const publicSchedule = (schedule) => ({
  frequency: schedule?.frequency || "off",
  time: schedule?.time || "03:00",
  weekday: schedule?.weekday ?? 1,
  dayOfMonth: schedule?.dayOfMonth ?? 1,
  keepLast: schedule?.keepLast ?? 10,
  lastRunAt: schedule?.lastRunAt || null,
  lastSuccessAt: schedule?.lastSuccessAt || null,
  lastError: schedule?.lastError || null,
  nextRunAt: schedule?.nextRunAt || null,
});

const publicSchedules = (record) => ({
  backup: publicSchedule(record.schedules?.backup),
  export: publicSchedule(record.schedules?.export),
});

// Returns the ClientDevices whose model's vendor has Mikrotik management enabled
// (each left-joined with its optional record) plus all standalone records.
exports.getManagedDevices = async (req, res, next) => {
  try {
    const vendorIds = await Vendor.find({
      isMikrotikManagementEnabled: true,
    }).distinct("_id");

    const modelIds = await DeviceModel.find({
      vendorId: { $in: vendorIds },
    }).distinct("_id");

    const devices = await ClientDevice.find({
      deviceModelId: { $in: modelIds },
    })
      .populate({
        path: "deviceModelId",
        select: "name vendorId deviceTypeId",
        populate: [
          { path: "vendorId", select: "name" },
          { path: "deviceTypeId", select: "name" },
        ],
      })
      .populate("locationId", "name address")
      .populate("companyId", "alias fullTitle")
      .sort({ _id: -1 })
      .lean();

    const records = await Mikrotik.find({
      clientDevice: { $in: devices.map((device) => device._id) },
    })
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    // Standalone devices (no ClientDevice, e.g. Cloud Hosted Router).
    const standaloneRecords = await Mikrotik.find({
      clientDevice: { $exists: false },
    })
      .populate("companyId", "alias fullTitle")
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    // Latest backup/export dates per record, for the table protection badges.
    const artifactSummary = await summarizeArtifacts([
      ...records.map((record) => record._id),
      ...standaloneRecords.map((record) => record._id),
    ]);

    // 30-дневный рейтинг доступности — колонка таблицы (один запрос на всех).
    const uptimeMap = await computeUptimeMap([
      ...records,
      ...standaloneRecords,
    ]);

    const recordByDevice = new Map(
      records.map((record) => [String(record.clientDevice), record]),
    );

    const inventoryRows = devices.map((device) => {
      const record = recordByDevice.get(String(device._id));
      return {
        ...buildRow(device, record, protectionFor(artifactSummary, record?._id)),
        uptime30d: record ? (uptimeMap.get(String(record._id)) ?? null) : null,
      };
    });

    const standaloneRows = standaloneRecords.map((record) => ({
      ...buildStandaloneRow(record, protectionFor(artifactSummary, record._id)),
      uptime30d: uptimeMap.get(String(record._id)) ?? null,
    }));

    res.status(200).json([...standaloneRows, ...inventoryRows]);
  } catch (error) {
    next(
      new AppError(
        "Failed to fetch managed mikrotik devices",
        500,
        true,
        error,
      ),
    );
  }
};

// Single managed device + its record (credentials without password), used to
// prefill the parameters modal.
exports.getOne = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.clientDeviceId)
      .populate({
        path: "deviceModelId",
        select: "name vendorId",
        populate: { path: "vendorId", select: "name" },
      })
      .populate("locationId", "name address")
      .populate("companyId", "alias fullTitle")
      .lean();

    if (!device) {
      return next(
        new AppError(
          `Client device ${req.params.clientDeviceId} not found`,
          404,
        ),
      );
    }

    const record = await Mikrotik.findOne({ clientDevice: device._id })
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    res.status(200).json({
      ...buildRow(device, record),
      record: record || null,
      // Стоячее предупреждение о расхождениях карточки с устройством.
      reconciliation: computeReconciliation(device, record),
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch mikrotik device ${req.params.clientDeviceId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Verify-on-save: open a live session, validate the account, poll metadata, and
// upsert the management record. Invalid params / unreachable devices are rejected.
exports.updateParameters = async (req, res, next) => {
  try {
    const { clientDeviceId } = req.params;

    // Модель нужна для сверки полей карточки с данными устройства.
    const device = await ClientDevice.findById(clientDeviceId).populate(
      "deviceModelId",
      "name",
    );
    if (!device) {
      return next(
        new AppError(`Client device ${clientDeviceId} not found`, 404),
      );
    }

    const existing = await Mikrotik.findOne({ clientDevice: clientDeviceId });

    let update;
    try {
      update = await verifyAndBuild(req.body, existing);
    } catch (error) {
      return next(mapVerifyError(error, req.body.host));
    }

    // The verified save proves the device is reachable again — close the outage
    // episode (+ recovery comment) and clear the stale offline-alert state, which
    // a bare upsert would otherwise leave behind until the next cron tick.
    if (existing?.offlineSince) {
      await markRecovered(existing);
      update.offlineSince = null;
      update.offlineAlertedAt = null;
      update.alertTicketId = null;
    }

    const record = await Mikrotik.findOneAndUpdate(
      { clientDevice: clientDeviceId },
      { clientDevice: clientDeviceId, ...update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).select("-credentials.password -credentials.knockSequence");

    logger.log("info", "Mikrotik parameters saved", {
      actor: req.userId,
      clientDeviceId,
      host: update.credentials.host,
      useTls: update.credentials.useTls,
      ip: req.ip,
    });

    res.status(200).json({
      message: "Параметры сохранены и проверены",
      record,
      // Расхождения карточки с только что снятыми данными — модалка предлагает
      // обновить карточку сразу после подключения.
      reconciliation: computeReconciliation(device, record),
    });
  } catch (error) {
    next(new AppError("Failed to save mikrotik parameters", 500, true, error));
  }
};

// Fields the sync-inventory endpoint may write to the ClientDevice card. Values
// are always derived server-side from the stored record (deriveSyncValues) — the
// client only chooses WHICH fields to apply, never their values.
const SYNCABLE_FIELDS = [
  "hostname",
  "serialNumber",
  "operatingSystem",
  "ipAddress",
];

// Apply device-derived values to the inventory card (reconciliation step of the
// parameters modal / the standing warning on the device page).
exports.syncInventory = async (req, res, next) => {
  try {
    const { clientDeviceId } = req.params;

    const device = await ClientDevice.findById(clientDeviceId).populate(
      "deviceModelId",
      "name",
    );
    if (!device) {
      return next(
        new AppError(`Client device ${clientDeviceId} not found`, 404),
      );
    }

    const record = await Mikrotik.findOne({ clientDevice: clientDeviceId });
    if (!record) {
      return next(new AppError("Устройство не настроено", 404));
    }

    const requested = Array.isArray(req.body.fields) ? req.body.fields : [];
    const values = deriveSyncValues(record);
    const updates = {};
    for (const field of requested) {
      if (SYNCABLE_FIELDS.includes(field) && values[field] != null) {
        updates[field] = values[field];
      }
    }
    if (Object.keys(updates).length === 0) {
      return next(new AppError("Нет данных для синхронизации", 422));
    }

    // Дубль-проверки как в update-контроллере устройств: серийник глобально,
    // hostname — в пределах компании (+ страховка от гонки через E11000 ниже).
    if (updates.serialNumber && updates.serialNumber !== device.serialNumber) {
      const serialExists = await ClientDevice.findOne({
        _id: { $ne: device._id },
        serialNumber: updates.serialNumber,
      });
      if (serialExists) {
        return next(
          new AppError(
            `Device with serial number ${updates.serialNumber} already exists`,
            409,
          ),
        );
      }
    }
    if (updates.hostname && updates.hostname !== device.hostname) {
      const hostExists = await ClientDevice.findOne({
        _id: { $ne: device._id },
        companyId: device.companyId,
        hostname: updates.hostname,
      });
      if (hostExists) {
        return next(
          new AppError(
            `Устройство с именем "${updates.hostname}" уже есть в этой компании`,
            409,
          ),
        );
      }
    }

    Object.assign(device, updates);
    device.updatedBy = req.userId;
    try {
      await device.save();
    } catch (error) {
      if (error?.code === 11000) {
        return next(
          new AppError("Значение уже используется другим устройством", 409),
        );
      }
      throw error;
    }

    logger.log("info", "Mikrotik inventory sync applied", {
      actor: req.userId,
      clientDeviceId,
      fields: Object.keys(updates),
      ip: req.ip,
    });

    res.status(200).json({
      message: "Карточка устройства обновлена",
      updated: Object.keys(updates),
      reconciliation: computeReconciliation(device, record),
    });
  } catch (error) {
    next(
      new AppError("Failed to sync inventory from mikrotik", 500, true, error),
    );
  }
};

// Enable background monitoring and do an immediate poll. Monitoring stays on
// even if this first poll fails (the cron will retry).
exports.connect = async (req, res, next) => {
  try {
    const record = await Mikrotik.findOne({
      clientDevice: req.params.clientDeviceId,
    });

    if (!record || !record.credentials?.host) {
      return next(
        new AppError("Сначала задайте параметры подключения", 409),
      );
    }

    record.monitoringEnabled = true;

    const now = new Date();
    try {
      const poll = await pollDevice({
        host: record.credentials.host,
        port: record.credentials.port,
        user: record.credentials.user,
        password: decryptSecret(record.credentials.password),
        tlsCert: record.credentials.tlsCert,
        knockSequence: decodeKnockSequence(record.credentials.knockSequence),
      });
      Object.assign(record, mapPollToFields(poll));
      if (poll.tlsCert && !record.credentials.tlsCert) {
        record.credentials.tlsCert = poll.tlsCert; // pin trust-on-first-use cert
      }
      record.status = "online";
      record.lastSuccessfulConnectionAt = now;
      record.lastCheckedAt = now;
      record.lastError = null;
      // A successful poll is a recovery: close the outage episode (+ ticket
      // comment) and clear the offline-alert state.
      if (record.offlineSince) {
        await markRecovered(record);
        record.offlineSince = undefined;
        record.offlineAlertedAt = undefined;
        record.alertTicketId = undefined;
      }
    } catch (error) {
      record.status = "offline";
      record.lastCheckedAt = now;
      record.lastError = error.message;
    }

    await record.save();

    logger.log("info", "Mikrotik monitoring enabled", {
      actor: req.userId,
      clientDeviceId: req.params.clientDeviceId,
      status: record.status,
      ip: req.ip,
    });

    const result = record.toObject();
    if (result.credentials) {
      delete result.credentials.password;
      delete result.credentials.knockSequence;
    }

    res.status(200).json({ message: "Мониторинг включён", record: result });
  } catch (error) {
    next(new AppError("Failed to connect mikrotik device", 500, true, error));
  }
};

// Disable background monitoring and mark the device offline.
exports.disconnect = async (req, res, next) => {
  try {
    const record = await Mikrotik.findOneAndUpdate(
      { clientDevice: req.params.clientDeviceId },
      {
        monitoringEnabled: false,
        status: "offline",
        // Monitoring off means no poll will ever end the outage — drop the alert
        // state and close the episode silently (connectivity was not restored).
        offlineSince: null,
        offlineAlertedAt: null,
        alertTicketId: null,
      },
      { new: true },
    ).select("-credentials.password -credentials.knockSequence");

    if (!record) {
      return next(new AppError("Устройство не настроено", 404));
    }

    await closeOpenOutage(record);

    logger.log("info", "Mikrotik monitoring disabled", {
      actor: req.userId,
      clientDeviceId: req.params.clientDeviceId,
      ip: req.ip,
    });

    res.status(200).json({ message: "Мониторинг отключён", record });
  } catch (error) {
    next(
      new AppError("Failed to disconnect mikrotik device", 500, true, error),
    );
  }
};

// Detach a device from Mikrotik management: delete its record (encrypted
// credentials, pinned TLS cert, polled metadata). The ClientDevice itself is
// untouched and returns to the "not configured" pool, so it can be re-added.
exports.detach = async (req, res, next) => {
  try {
    const record = await Mikrotik.findOneAndDelete({
      clientDevice: req.params.clientDeviceId,
    });

    if (!record) {
      return next(new AppError("Устройство не настроено", 404));
    }

    await deleteOutages(record._id);

    logger.log("info", "Mikrotik device detached", {
      actor: req.userId,
      clientDeviceId: req.params.clientDeviceId,
      ip: req.ip,
    });

    res.status(200).json({ message: "Устройство отвязано от управления" });
  } catch (error) {
    next(new AppError("Failed to detach mikrotik device", 500, true, error));
  }
};

// --- Standalone devices (no inventory ClientDevice, e.g. Cloud Hosted Router) ---

// Create a standalone managed device: verify-on-save, then persist a record with
// no clientDevice (identified by companyId + optional label).
exports.createStandalone = async (req, res, next) => {
  try {
    let update;
    try {
      update = await verifyAndBuild(req.body, null);
    } catch (error) {
      return next(mapVerifyError(error, req.body.host));
    }

    const record = await Mikrotik.create({
      companyId: req.body.companyId || undefined,
      label: req.body.label || undefined,
      ...update,
    });

    const safe = record.toObject();
    if (safe.credentials) {
      delete safe.credentials.password;
      delete safe.credentials.knockSequence;
    }

    logger.log("info", "Standalone mikrotik device created", {
      actor: req.userId,
      recordId: record._id,
      host: update.credentials.host,
      ip: req.ip,
    });

    res
      .status(201)
      .json({ message: "Устройство добавлено и проверено", record: safe });
  } catch (error) {
    next(
      new AppError(
        "Failed to create standalone mikrotik device",
        500,
        true,
        error,
      ),
    );
  }
};

// One standalone record (credentials without password) for the edit-modal prefill.
exports.getStandaloneOne = async (req, res, next) => {
  try {
    const record = await Mikrotik.findOne({
      _id: req.params.recordId,
      clientDevice: { $exists: false },
    })
      .populate("companyId", "alias fullTitle")
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    res.status(200).json({ ...buildStandaloneRow(record), record });
  } catch (error) {
    next(
      new AppError(
        "Failed to fetch standalone mikrotik device",
        500,
        true,
        error,
      ),
    );
  }
};

// Re-verify and update a standalone record's parameters (and company/label).
exports.updateStandaloneParameters = async (req, res, next) => {
  try {
    const existing = await Mikrotik.findOne({
      _id: req.params.recordId,
      clientDevice: { $exists: false },
    });
    if (!existing) {
      return next(new AppError("Устройство не найдено", 404));
    }

    let update;
    try {
      update = await verifyAndBuild(req.body, existing);
    } catch (error) {
      return next(mapVerifyError(error, req.body.host));
    }

    // Verified save = recovery (see updateParameters).
    if (existing.offlineSince) {
      await markRecovered(existing);
      update.offlineSince = null;
      update.offlineAlertedAt = null;
      update.alertTicketId = null;
    }

    if (req.body.companyId !== undefined) {
      update.companyId = req.body.companyId || null;
    }
    if (req.body.label !== undefined) {
      update.label = req.body.label || null;
    }

    const record = await Mikrotik.findByIdAndUpdate(req.params.recordId, update, {
      new: true,
    }).select("-credentials.password -credentials.knockSequence");

    logger.log("info", "Standalone mikrotik parameters saved", {
      actor: req.userId,
      recordId: req.params.recordId,
      host: update.credentials.host,
      ip: req.ip,
    });

    res.status(200).json({ message: "Параметры сохранены и проверены", record });
  } catch (error) {
    next(
      new AppError(
        "Failed to save standalone mikrotik parameters",
        500,
        true,
        error,
      ),
    );
  }
};

// Delete a standalone record entirely (no inventory device to fall back to).
exports.detachStandalone = async (req, res, next) => {
  try {
    const record = await Mikrotik.findOneAndDelete({
      _id: req.params.recordId,
      clientDevice: { $exists: false },
    });
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    await deleteOutages(record._id);

    logger.log("info", "Standalone mikrotik device deleted", {
      actor: req.userId,
      recordId: req.params.recordId,
      ip: req.ip,
    });

    res.status(200).json({ message: "Устройство удалено" });
  } catch (error) {
    next(
      new AppError(
        "Failed to delete standalone mikrotik device",
        500,
        true,
        error,
      ),
    );
  }
};

// Availability report for one managed device (inventory-backed or standalone):
// uptime % / downtime / outage episodes over a trailing window. Episode bounds
// follow the connectivity-loss edge (offlineSince), not the alert threshold.
exports.getAvailability = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    const requested = Number(req.query.days);
    const days = [1, 7, 30, 90].includes(requested) ? requested : 30;

    const report = await computeAvailability(record, { days });
    res.status(200).json(report);
  } catch (error) {
    next(
      new AppError(
        "Failed to compute mikrotik availability",
        500,
        true,
        error,
      ),
    );
  }
};

// Aggregates IP addresses across all managed devices and flags duplicate
// networks (unchanged logic, now sourced from the per-device records).
exports.networksReport = async (req, res, next) => {
  try {
    const records = await Mikrotik.find({}).sort({ name: 1 });

    let entries = [];

    for (const record of records) {
      for (const address of record.addresses) {
        if (address.disabled === "false") {
          entries.push({
            id: address._id,
            address: address.address,
            network: address.network,
            interface: address.interface,
            deviceName: record.name,
            comment: address.comment,
            duplicated: false,
          });
        }
      }
    }

    entries.forEach((entry) => {
      const isDuplicated =
        entries.filter(({ network }) => network === entry.network).length > 1;
      if (isDuplicated) {
        entry.duplicated = true;
      }
    });

    res.status(200).json({ entries });
  } catch (error) {
    next(new AppError("Failed to generate networks report", 500, true, error));
  }
};

// --- Backups & config exports (keyed by the Mikrotik record id) ---------------

// List a device's stored backups/exports (metadata only). Optional ?type filter.
exports.listArtifacts = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId).select("_id");
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }
    const query = { mikrotik: record._id };
    if (req.query.type === "backup" || req.query.type === "export") {
      query.type = req.query.type;
    }
    const artifacts = await MikrotikArtifact.find(query)
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ artifacts: artifacts.map(publicArtifact) });
  } catch (error) {
    next(new AppError("Failed to list mikrotik artifacts", 500, true, error));
  }
};

// Export the running config now (manual). Captures /export over SSH into a .rsc.
exports.createExportNow = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record || !record.credentials?.host) {
      return next(new AppError("Устройство не настроено", 404));
    }

    let artifact;
    try {
      artifact = await createArtifact(record, {
        trigger: "manual",
        userId: req.userId,
      });
    } catch (error) {
      return next(mapArtifactError(error, record.credentials.host));
    }

    logger.log("info", "Mikrotik config export created", {
      actor: req.userId,
      recordId: record._id,
      ip: req.ip,
    });

    res
      .status(201)
      .json({ message: "Конфигурация экспортирована", artifact: publicArtifact(artifact) });
  } catch (error) {
    next(new AppError("Failed to export mikrotik config", 500, true, error));
  }
};

// Step 1 of the 2FA download: email the requesting user a fresh 6-digit code and
// store its hash. Replaces any previous code for this (user, artifact). Never
// returns the code; in non-prod it's logged (dev email is off) so it's testable.
exports.requestDownloadCode = async (req, res, next) => {
  try {
    const artifact = await MikrotikArtifact.findOne({
      _id: req.params.artifactId,
      mikrotik: req.params.recordId,
    });
    if (!artifact) {
      return next(new AppError("Файл не найден", 404));
    }

    const user = await User.findById(req.userId).select("email");
    if (!user?.email) {
      return next(
        new AppError("У вашего профиля нет email для отправки кода", 422),
      );
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    await MikrotikDownloadCode.deleteMany({
      user: user._id,
      artifact: artifact._id,
    });
    await MikrotikDownloadCode.create({
      user: user._id,
      artifact: artifact._id,
      codeHash,
      expiresAt: new Date(Date.now() + DOWNLOAD_CODE_TTL_MS),
    });

    // Queue the email (delivered by the telegram-bot mailer worker).
    await new Notification({
      instrument: "email",
      to: { email: user.email },
      title: "Код для скачивания конфигурации Mikrotik",
      text:
        `<div>Код для скачивания файла <b>${artifact.fileName}</b>: ` +
        `<b style="font-size:20px;letter-spacing:2px">${code}</b><br/><br/>` +
        `Код действует 10 минут и работает один раз. ` +
        `Если вы не запрашивали скачивание — просто проигнорируйте это письмо.</div>`,
    }).save();

    if (process.env.NODE_ENV !== "production") {
      logger.log("info", "Mikrotik download code (non-prod)", {
        code,
        artifactId: artifact._id,
        userId: user._id,
      });
    }

    logger.log("info", "Mikrotik download code requested", {
      actor: req.userId,
      recordId: req.params.recordId,
      artifactId: artifact._id,
      ip: req.ip,
    });

    res.json({ message: `Код отправлен на ${maskEmail(user.email)}` });
  } catch (error) {
    next(new AppError("Failed to send download code", 500, true, error));
  }
};

// Step 2: verify the emailed code, then stream the bytes through the backend
// (local-first, else fetched from S3 server-side) so it works for token-auth
// fetches without depending on bucket CORS. The code is single-use.
exports.downloadArtifact = async (req, res, next) => {
  try {
    const artifact = await MikrotikArtifact.findOne({
      _id: req.params.artifactId,
      mikrotik: req.params.recordId,
    });
    if (!artifact) {
      return next(new AppError("Файл не найден", 404));
    }

    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return next(new AppError("Введите 6-значный код из письма", 400));
    }

    const record = await MikrotikDownloadCode.findOne({
      user: req.userId,
      artifact: artifact._id,
    });
    if (!record || record.expiresAt <= new Date()) {
      return next(new AppError("Код не найден или истёк — запросите новый", 401));
    }
    if (record.attempts >= MAX_DOWNLOAD_CODE_ATTEMPTS) {
      await MikrotikDownloadCode.deleteOne({ _id: record._id });
      return next(
        new AppError("Слишком много попыток — запросите новый код", 429),
      );
    }

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    if (codeHash !== record.codeHash) {
      record.attempts += 1;
      await record.save();
      return next(new AppError("Неверный код", 401));
    }

    // Valid — single use.
    await MikrotikDownloadCode.deleteOne({ _id: record._id });

    // Stored bytes are envelope-encrypted (see artifactBox); decrypt to plaintext
    // before streaming. Legacy pre-encryption artifacts pass through unchanged.
    const buffer = decryptArtifact(
      await storage.getArtifactBuffer(artifact.storageKey),
    );
    const contentType =
      artifact.type === "export"
        ? "text/plain; charset=utf-8"
        : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
    );

    logger.log("info", "Mikrotik artifact downloaded", {
      actor: req.userId,
      recordId: req.params.recordId,
      artifactId: artifact._id,
      ip: req.ip,
    });

    res.status(200).send(buffer);
  } catch (error) {
    next(new AppError("Failed to download mikrotik artifact", 500, true, error));
  }
};

// Delete a stored artifact (DB doc + underlying file).
exports.deleteArtifact = async (req, res, next) => {
  try {
    const artifact = await MikrotikArtifact.findOne({
      _id: req.params.artifactId,
      mikrotik: req.params.recordId,
    });
    if (!artifact) {
      return next(new AppError("Файл не найден", 404));
    }

    await storage.deleteArtifact(artifact.storageKey);
    await MikrotikArtifact.deleteOne({ _id: artifact._id });

    logger.log("info", "Mikrotik artifact deleted", {
      actor: req.userId,
      recordId: req.params.recordId,
      artifactId: artifact._id,
      ip: req.ip,
    });

    res.status(200).json({ message: "Копия удалена" });
  } catch (error) {
    next(new AppError("Failed to delete mikrotik artifact", 500, true, error));
  }
};

// Save the backup/export schedules + retention, recomputing each nextRunAt.
exports.updateSchedules = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    const prefs = await Preferences.findOne({}).lean();
    const timezone = prefs?.timezone;

    record.schedules = record.schedules || {};
    for (const type of ["backup", "export"]) {
      const input = req.body?.[type];
      if (!input) continue;
      const current = record.schedules[type] || {};
      const nextSchedule = {
        frequency: normalizeFrequency(input.frequency),
        time: normalizeTime(input.time, current.time || "03:00"),
        weekday: clampInt(input.weekday, 0, 6, current.weekday ?? 1),
        dayOfMonth: clampInt(input.dayOfMonth, 1, 28, current.dayOfMonth ?? 1),
        keepLast: clampInt(input.keepLast, 1, 365, current.keepLast ?? 10),
        lastRunAt: current.lastRunAt,
        lastSuccessAt: current.lastSuccessAt,
        lastError: current.lastError,
      };
      nextSchedule.nextRunAt = computeNextRun(nextSchedule, new Date(), timezone);
      record.schedules[type] = nextSchedule;
    }
    record.markModified("schedules");
    await record.save();

    logger.log("info", "Mikrotik schedules updated", {
      actor: req.userId,
      recordId: record._id,
      ip: req.ip,
    });

    res
      .status(200)
      .json({ message: "Расписание сохранено", schedules: publicSchedules(record) });
  } catch (error) {
    next(new AppError("Failed to update mikrotik schedules", 500, true, error));
  }
};
