const net = require("net");
const dns = require("dns").promises;

const Mikrotik = require("../../models/mikrotik");
const ClientDevice = require("../../models/inventory/clientDevice");
const DeviceModel = require("../../models/inventory/deviceModel");
const Vendor = require("../../models/inventory/vendor");

const {
  encryptSecret,
  decryptSecret,
  assertUserNotFullGroup,
  pollDevice,
  mapPollToFields,
} = require("../../services/mikrotik/connector");

const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");

// --- SSRF guard: the device host is operator-supplied, so refuse to open
// connections to loopback / private / link-local (incl. cloud-metadata) targets. ---
const isBlockedIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return (
      low === "::1" ||
      low.startsWith("fe80") ||
      low.startsWith("fc") ||
      low.startsWith("fd")
    );
  }
  return false;
};

const assertPublicHost = async (host) => {
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const resolved = await dns.lookup(host, { all: true });
    ips = resolved.map((entry) => entry.address);
  }
  if (ips.some(isBlockedIp)) {
    const error = new Error(
      `Хост ${host} указывает на внутренний адрес и запрещён`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

// Decrypts a stored knock sequence ("v1:…" of a JSON port array) to numbers.
const decodeKnockSequence = (blob) => {
  if (!blob) return undefined;
  try {
    const arr = JSON.parse(decryptSecret(blob));
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
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
const buildRow = (device, record) => {
  const model = device.deviceModelId;

  return {
    clientDeviceId: device._id,
    displayName: buildDisplayName(record, device),
    serialNumber: device.serialNumber,
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
  };
};

// Returns the ClientDevices whose model's vendor has Mikrotik management
// enabled, each left-joined with its (optional) Mikrotik management record.
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
        populate: { path: "vendorId", select: "name" },
      })
      .populate("locationId", "name address")
      .sort({ _id: -1 })
      .lean();

    const records = await Mikrotik.find({
      clientDevice: { $in: devices.map((device) => device._id) },
    })
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    const recordByDevice = new Map(
      records.map((record) => [String(record.clientDevice), record]),
    );

    const rows = devices.map((device) =>
      buildRow(device, recordByDevice.get(String(device._id))),
    );

    res.status(200).json(rows);
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

    res.status(200).json({ ...buildRow(device, record), record: record || null });
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
    const { host, user, password } = req.body;
    const port = Number(req.body.port);
    const useTls = req.body.useTls !== false; // default to API-SSL
    const knockPorts = Array.isArray(req.body.knockSequence)
      ? req.body.knockSequence
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
      : [];

    if (!host || !port || !user || !password) {
      return next(
        new AppError("host, port, user и password обязательны", 422),
      );
    }

    const device = await ClientDevice.findById(clientDeviceId);
    if (!device) {
      return next(
        new AppError(`Client device ${clientDeviceId} not found`, 404),
      );
    }

    try {
      await assertPublicHost(host);
    } catch (error) {
      return next(new AppError(error.message, 422, true, error));
    }

    // Pin to the device's already-trusted cert (if any) while verifying.
    const existing = await Mikrotik.findOne({ clientDevice: clientDeviceId });

    let poll;
    try {
      poll = await pollDevice({
        host,
        port,
        user,
        password,
        useTls,
        tlsCert: existing?.credentials?.tlsCert,
        knockSequence: knockPorts,
      });
      assertUserNotFullGroup(poll.users, user);
    } catch (error) {
      if (error.code === "MIKROTIK_FULL_GROUP_USER") {
        return next(new AppError(error.message, 409));
      }
      return next(
        new AppError(
          `Не удалось подключиться к устройству ${host}`,
          502,
          true,
          error,
        ),
      );
    }

    const now = new Date();
    const record = await Mikrotik.findOneAndUpdate(
      { clientDevice: clientDeviceId },
      {
        clientDevice: clientDeviceId,
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
        },
        ...mapPollToFields(poll),
        status: "online",
        lastSuccessfulConnectionAt: now,
        lastCheckedAt: now,
        lastError: null,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).select("-credentials.password -credentials.knockSequence");

    logger.log("info", "Mikrotik parameters saved", {
      actor: req.userId,
      clientDeviceId,
      host,
      useTls,
      ip: req.ip,
    });

    res.status(200).json({
      message: "Параметры сохранены и проверены",
      record,
    });
  } catch (error) {
    next(new AppError("Failed to save mikrotik parameters", 500, true, error));
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
        useTls: record.credentials.useTls !== false,
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
      { monitoringEnabled: false, status: "offline" },
      { new: true },
    ).select("-credentials.password -credentials.knockSequence");

    if (!record) {
      return next(new AppError("Устройство не настроено", 404));
    }

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
