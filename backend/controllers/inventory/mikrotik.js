const crypto = require("crypto");
const mongoose = require("mongoose");

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
  RouterOsRelease,
  MikrotikFirmwareState,
} = require("../../models/mikrotikFirmware");

const {
  encryptSecret,
  decryptSecret,
  decodeKnockSequence,
  buildSshParams,
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
  assertJumpTargetHost,
  createArtifact,
} = require("../../services/mikrotik/artifacts");
const { resolveJumpContext } = require("../../services/mikrotik/monitorState");
const {
  markRecovered,
  closeOpenOutage,
  deleteOutages,
  computeAvailability,
  computeUptimeStats,
} = require("../../services/mikrotik/outages");
const {
  computeReconciliation,
  deriveSyncValues,
} = require("../../services/mikrotik/reconciliation");
const {
  loadFirmwareContext,
  evaluateFirmware,
} = require("../../services/mikrotik/firmware");

const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");
const { canFor } = require("@/services/permissions");

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
// `protection` carries the latest backup/export artifact dates for the badges;
// `jump` — {recordId, name} транзитного роутера («подключение через устройство»).
const buildRow = (device, record, protection, jump) => {
  const model = device.deviceModelId;

  return {
    source: "inventory",
    clientDeviceId: device._id,
    recordId: record?._id || null,
    jump: jump || null,
    displayName: buildDisplayName(record, device),
    serialNumber: device.serialNumber,
    // id нужен фронту: селект «Мост» фильтрует кандидатов по компании строки.
    company: device.companyId
      ? {
          id: device.companyId._id,
          name: device.companyId.alias || device.companyId.fullTitle,
        }
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
    port: record?.credentials?.port || null,
    boardName: record?.boardName || null,
    currentFirmware: record?.currentFirmware || null,
    addresses: record?.addresses || [],
    lastSuccessfulConnectionAt: record?.lastSuccessfulConnectionAt || null,
    lastCheckedAt: record?.lastCheckedAt || null,
    lastError: record?.lastError || null,
    // Край текущего эпизода офлайна (для «Не в сети · 3 ч 12 мин») и авто-заявка
    // эпизода (alertTicketId приходит populated полем num).
    offlineSince: record?.offlineSince || null,
    offlineAlertedAt: record?.offlineAlertedAt || null,
    alertTicket: record?.alertTicketId?.num
      ? { id: record.alertTicketId._id, num: record.alertTicketId.num }
      : null,
    monitoredSince: record?.createdAt || null,
    schedules: scheduleSummary(record),
    lastBackupAt: protection?.lastBackupAt || null,
    lastExportAt: protection?.lastExportAt || null,
  };
};

// Shapes a standalone row (no inventory ClientDevice, e.g. Cloud Hosted Router).
const buildStandaloneRow = (record, protection, jump) => ({
  source: "standalone",
  clientDeviceId: null,
  recordId: record._id,
  jump: jump || null,
  displayName:
    record.label || record.name || record.credentials?.host || "Cloud Hosted Router",
  serialNumber: record.serialNumber || null,
  // id нужен фронту: селект «Мост» фильтрует кандидатов по компании строки.
  company: record.companyId
    ? {
        id: record.companyId._id,
        name: record.companyId.alias || record.companyId.fullTitle,
      }
    : null,
  // У standalone нет карточки инвентаря — класс определяем по самому устройству.
  type: deriveDeviceKind(record),
  model: null,
  location: null,
  status: record.status || "offline",
  monitoringEnabled: record.monitoringEnabled || false,
  host: record.credentials?.host || null,
  port: record.credentials?.port || null,
  boardName: record.boardName || null,
  currentFirmware: record.currentFirmware || null,
  addresses: record.addresses || [],
  lastSuccessfulConnectionAt: record.lastSuccessfulConnectionAt || null,
  lastCheckedAt: record.lastCheckedAt || null,
  lastError: record.lastError || null,
  offlineSince: record.offlineSince || null,
  offlineAlertedAt: record.offlineAlertedAt || null,
  alertTicket: record.alertTicketId?.num
    ? { id: record.alertTicketId._id, num: record.alertTicketId.num }
    : null,
  monitoredSince: record.createdAt || null,
  schedules: scheduleSummary(record),
  lastBackupAt: protection?.lastBackupAt || null,
  lastExportAt: protection?.lastExportAt || null,
});

// Валидирует «подключение через устройство» из тела запроса; null — прямое
// подключение. Один уровень транзита: у транзита не может быть своего
// транзита, а записи с зависимыми нельзя задать транзит (иначе резолв стал бы
// рекурсивным). Все отказы — операторские 422.
const resolveJumpForSave = async (body, existing) => {
  const raw = body.jumpRecordId;
  if (raw === undefined || raw === null || raw === "") return null;

  if (!mongoose.isValidObjectId(raw)) {
    throw new AppError(
      "Некорректный идентификатор транзитного устройства",
      422,
    );
  }
  if (existing && String(existing._id) === String(raw)) {
    throw new AppError("Устройство не может подключаться через само себя", 422);
  }
  const jumpDoc = await Mikrotik.findById(raw);
  if (!jumpDoc || !jumpDoc.credentials?.host) {
    throw new AppError("Транзитное устройство не найдено", 422);
  }
  if (jumpDoc.jumpRecordId) {
    throw new AppError(
      "Нельзя подключаться через устройство, которое само подключено через " +
        "другое устройство",
      422,
    );
  }
  if (existing) {
    const hasDependents = await Mikrotik.exists({ jumpRecordId: existing._id });
    if (hasDependents) {
      throw new AppError(
        "Через это устройство уже подключены другие — ему нельзя задать транзит",
        422,
      );
    }
  }
  return jumpDoc;
};

// Блокирует удаление записи, через которую подключены другие устройства: их
// мониторинг молча осиротел бы (висячая ссылка). Возвращает AppError 409 с
// именами зависимых или null.
const dependentsConflict = async (record) => {
  const dependents = await Mikrotik.find({ jumpRecordId: record._id })
    .select("name label credentials.host")
    .lean();
  if (!dependents.length) return null;
  const names = dependents
    .slice(0, 5)
    .map(
      (dep) => `«${dep.name || dep.label || dep.credentials?.host || dep._id}»`,
    )
    .join(", ");
  const tail = dependents.length > 5 ? ` и ещё ${dependents.length - 5}` : "";
  return new AppError(
    `Через это устройство подключены: ${names}${tail}. Сначала переключите ` +
      "их на прямое подключение или отвяжите",
    409,
  );
};

// Транзит одной записи для getOne/getStandaloneOne: имя роутера для строки
// «через <имя>» и префилла селекта в форме параметров.
const jumpInfoFor = async (record) => {
  if (!record?.jumpRecordId) return null;
  const jumpDoc = await Mikrotik.findById(record.jumpRecordId)
    .select("name label credentials.host")
    .lean();
  return {
    recordId: record.jumpRecordId,
    name: jumpDoc
      ? jumpDoc.name || jumpDoc.label || jumpDoc.credentials?.host || null
      : null,
  };
};

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

  const jumpDoc = await resolveJumpForSave(body, existing);

  // Через транзит цель недостижима с бэкенда — knock туда физически не дойдёт
  // (а с роутера он бессмыслен: источником был бы LAN-адрес самого роутера).
  // Вместо него доступ ограничивается файрволом на устройстве.
  if (jumpDoc && knockPorts.length) {
    throw new AppError(
      "Port knocking недоступен при подключении через устройство — " +
        "ограничьте доступ к API/SSH файрволом на самом устройстве",
      422,
    );
  }

  try {
    // Транзитная цель — LAN-адрес за роутером: мягкий guard (RFC1918 разрешён);
    // прямая — как раньше (публичный адрес обязателен).
    if (jumpDoc) assertJumpTargetHost(host);
    else await assertPublicHost(host);
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
    jump: jumpDoc ? buildSshParams(jumpDoc) : undefined,
  });
  assertUserNotFullGroup(poll.users, user);

  // Опортунистический TOFU-пиннинг SSH-ключа роутера: транзитный полл мог
  // увидеть ключ раньше первой SSH-операции самого роутера. Guarded — уже
  // закреплённый отпечаток никогда не перезаписывается.
  if (jumpDoc && poll.jumpHostKey && !jumpDoc.credentials?.sshHostKey) {
    await Mikrotik.updateOne(
      {
        _id: jumpDoc._id,
        $or: [
          { "credentials.sshHostKey": { $exists: false } },
          { "credentials.sshHostKey": null },
        ],
      },
      { $set: { "credentials.sshHostKey": poll.jumpHostKey } },
    );
  }

  const now = new Date();
  return {
    // Present only when set; the save paths $unset it otherwise, so clearing
    // the select in the form really detaches the record from its transit.
    ...(jumpDoc ? { jumpRecordId: jumpDoc._id } : {}),
    credentials: {
      host,
      port,
      user,
      password: encryptSecret(password),
      useTls,
      // Pin the observed cert (TOFU) or keep the previously pinned one.
      tlsCert: poll.tlsCert || existing?.credentials?.tlsCert,
      // Смена режима на транзит явно сбрасывает сохранённый knock (пустой ввод
      // обычно СОХРАНЯЕТ старый шифрблоб — для транзита он стал бы «протухшим»
      // секретом, который никогда не используется).
      knockSequence: jumpDoc
        ? undefined
        : knockPorts.length
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
    // A live poll just succeeded — reset the anti-flap counter. (firstFailureAt is
    // cleared with $unset by the callers: a stored null would freeze its $min.)
    failedPolls: 0,
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

// Populate-опции карточки инвентаря для строки списка/страницы записи.
const DEVICE_ROW_POPULATE = [
  {
    path: "deviceModelId",
    select: "name vendorId deviceTypeId",
    populate: [
      { path: "vendorId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
  { path: "deviceTypeId", select: "name" },
  { path: "locationId", select: "name address" },
  { path: "companyId", select: "alias fullTitle" },
];

// Окно, внутри которого отметки offlineSince считаются ОДНИМ проходом опроса.
const ONE_POLL_WINDOW_MS = 5 * 60 * 1000;
// Сколько строк максимум уносит главная; остальное — по ссылке в раздел.
const OFFLINE_ROWS_LIMIT = 10;

/**
 * GET /inventory/mikrotik-devices/offline — блок «Мониторинг» на главной.
 *
 * Отдельно от getManagedDevices намеренно: тот тянет все записи, все карточки
 * инвентаря, сводку артефактов, 30-дневную доступность и кэш прошивок с CVE —
 * это эндпоинт страницы раздела, на лендинге ему делать нечего.
 *
 * От заявок блок не зависит. `Preferences.mikrotik.offlineTicket.isActive`
 * выключен по умолчанию, и тогда недоступность не порождает ни заявки, ни
 * уведомления; читаем состояние записи напрямую.
 *
 * `pollLooksBroken` — главное здесь. Когда опрос падает целиком (протухли
 * креды, лёг воркер, нет маршрута), офлайн уходят ВСЕ устройства разом и с
 * одной ошибкой. Список из N строк в этом случае врёт: это одна авария, а не N.
 * Фронт в таком режиме показывает строку состояния вместо списка.
 */
exports.getOfflineDevices = async (req, res, next) => {
  try {
    const [records, monitored] = await Promise.all([
      Mikrotik.find({ monitoringEnabled: true, status: "offline" })
        .select(
          "name label boardName clientDevice companyId offlineSince lastError alertTicketId",
        )
        .populate("companyId", "alias")
        .populate("alertTicketId", "num")
        .lean(),
      Mikrotik.countDocuments({ monitoringEnabled: true }),
    ]);

    // Компанию берём через карточку инвентаря: Mikrotik.companyId в базе не
    // заполнен ни у одной записи, а clientDevice — у всех.
    const deviceIds = records.map((record) => record.clientDevice).filter(Boolean);
    const devices = deviceIds.length
      ? await ClientDevice.find({ _id: { $in: deviceIds } })
          .select("companyId serialNumber deviceModelId")
          .populate("companyId", "alias")
          .populate("deviceModelId", "name")
          .lean()
      : [];
    const deviceById = new Map(
      devices.map((device) => [String(device._id), device]),
    );

    const items = records
      .map((record) => {
        const device = record.clientDevice
          ? deviceById.get(String(record.clientDevice))
          : null;
        return {
          _id: record._id,
          name:
            record.name ||
            record.label ||
            device?.deviceModelId?.name ||
            "Устройство",
          company:
            record.companyId?.alias || device?.companyId?.alias || null,
          offlineSince: record.offlineSince || null,
          lastError: record.lastError || "",
          alertTicketNum: record.alertTicketId?.num || null,
        };
      })
      // Дольше всех молчит — выше: это и есть порядок разбора.
      .sort((a, b) => {
        if (!a.offlineSince) return 1;
        if (!b.offlineSince) return -1;
        return new Date(a.offlineSince) - new Date(b.offlineSince);
      });

    // Ищем не «весь список ушёл разом», а САМУЮ БОЛЬШУЮ ОДНОВРЕМЕННУЮ ГРУППУ.
    // Разброс по всему списку тут не годится: достаточно одного роутера,
    // упавшего накануне по своей причине, и признак пропадает — ровно это и
    // происходит на живых данных (17 записей в одну секунду + один за 11 часов
    // до них).
    const withStamp = items.filter((item) => item.offlineSince);
    let cluster = [];
    for (const anchor of withStamp) {
      const start = new Date(anchor.offlineSince).getTime();
      const group = withStamp.filter((item) => {
        const delta = new Date(item.offlineSince).getTime() - start;
        return delta >= 0 && delta <= ONE_POLL_WINDOW_MS;
      });
      if (group.length > cluster.length) {
        cluster = group;
      }
    }

    const errorCounts = new Map();
    for (const item of cluster) {
      if (!item.lastError) continue;
      errorCounts.set(item.lastError, (errorCounts.get(item.lastError) || 0) + 1);
    }
    const [dominantError, dominantErrorCount] = [...errorCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0] || [null, 0];

    // Три признака сразу: группа накрывает почти весь парк, ушла одним проходом
    // и с одной ошибкой. Порознь каждый бывает и при настоящей аварии —
    // вместе почти нет.
    const pollLooksBroken =
      cluster.length >= 3 &&
      monitored > 0 &&
      cluster.length / monitored >= 0.8 &&
      dominantErrorCount / cluster.length >= 0.5;

    res.status(200).json({
      items: items.slice(0, OFFLINE_ROWS_LIMIT),
      total: items.length,
      monitored,
      pollLooksBroken,
      // При сломанном опросе интересен момент, когда он сломался (начало
      // группы), а не когда упал самый первый роутер: он-то упал сам по себе.
      since:
        (pollLooksBroken ? cluster[0]?.offlineSince : items[0]?.offlineSince) ||
        null,
      dominantError: pollLooksBroken ? dominantError : null,
    });
  } catch (error) {
    next(
      new AppError(`Failed to fetch offline Mikrotik devices`, 500, true, error),
    );
  }
};

// Все записи мониторинга одним списком — строка идёт от ЗАПИСИ. Инвентарные
// устройства «без записи» на странице больше не показываются: добавление всегда
// создаёт новую запись, а связь с карточкой инвентаря — отдельный шаг после
// проверки (см. linkInventory / createInventoryCard).
exports.getManagedDevices = async (req, res, next) => {
  try {
    const records = await Mikrotik.find({})
      .populate("companyId", "alias fullTitle")
      .populate("alertTicketId", "num")
      .select("-credentials.password -credentials.knockSequence")
      .lean();

    const deviceIds = records
      .map((record) => record.clientDevice)
      .filter(Boolean);
    const devices = await ClientDevice.find({ _id: { $in: deviceIds } })
      .populate(DEVICE_ROW_POPULATE)
      .lean();
    const deviceById = new Map(
      devices.map((device) => [String(device._id), device]),
    );
    const deviceFor = (record) =>
      record.clientDevice
        ? deviceById.get(String(record.clientDevice)) || null
        : null;

    // Latest backup/export dates per record, for the table protection badges.
    const artifactSummary = await summarizeArtifacts(
      records.map((record) => record._id),
    );

    // Доступность за 30 дней (суммарный % + лента по дням) — один запрос на всех.
    const uptimeStats = await computeUptimeStats(records);

    // Кэш релизов/CVE читается один раз на запрос (как uptimeStats); оценка
    // каждой строки — чистое вычисление. Питает индикаторы «доступно обновление»
    // / «опасная уязвимость» у прошивки.
    const firmware = await loadFirmwareContext();

    // Имена транзитов для «через <имя>» — по уже загруженным записям, без
    // дополнительных запросов. Карточка, выпавшая из выборки (устройство
    // удалено), даёт фолбэк на identity/host.
    const jumpNames = new Map();
    for (const record of records) {
      const device = deviceFor(record);
      jumpNames.set(
        String(record._id),
        device
          ? buildDisplayName(record, device)
          : record.label || record.name || record.credentials?.host || null,
      );
    }
    const jumpFor = (record) =>
      record?.jumpRecordId
        ? {
            recordId: record.jumpRecordId,
            name: jumpNames.get(String(record.jumpRecordId)) || null,
          }
        : null;

    const rows = records.map((record) => {
      const device = deviceFor(record);
      const protection = protectionFor(artifactSummary, record._id);
      const stats = uptimeStats.get(String(record._id));
      const base = device
        ? buildRow(device, record, protection, jumpFor(record))
        : buildStandaloneRow(record, protection, jumpFor(record));
      return {
        ...base,
        uptime30d: stats?.pct ?? null,
        uptimeDays: stats?.days ?? null,
        firmwareStatus: evaluateFirmware(record, firmware),
      };
    });

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

// Одна запись мониторинга (инвентарная или standalone) — страница записи и
// префилл формы «Изменить»: строка списка + запись без секретов + сверка с
// карточкой инвентаря (для связанных).
exports.getRecordOne = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId)
      .populate("companyId", "alias fullTitle")
      .populate("alertTicketId", "num")
      .select("-credentials.password -credentials.knockSequence")
      .lean();
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    const device = record.clientDevice
      ? await ClientDevice.findById(record.clientDevice)
          .populate(DEVICE_ROW_POPULATE)
          .lean()
      : null;

    const artifactSummary = await summarizeArtifacts([record._id]);
    const uptimeStats = await computeUptimeStats([record]);
    const firmware = await loadFirmwareContext();
    const jump = await jumpInfoFor(record);

    const protection = protectionFor(artifactSummary, record._id);
    const stats = uptimeStats.get(String(record._id));
    const base = device
      ? buildRow(device, record, protection, jump)
      : buildStandaloneRow(record, protection, jump);

    res.status(200).json({
      ...base,
      uptime30d: stats?.pct ?? null,
      uptimeDays: stats?.days ?? null,
      firmwareStatus: evaluateFirmware(record, firmware),
      record,
      // Стоячее предупреждение о расхождениях карточки с устройством.
      reconciliation: device ? computeReconciliation(device, record) : null,
      inventory: device
        ? {
            clientDeviceId: device._id,
            modelName: device.deviceModelId?.name || null,
            inventoryNumber: device.inventoryNumber || null,
          }
        : null,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch mikrotik record ${req.params.recordId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Плашка версий над таблицей: последние релизы RouterOS по веткам (+чейнджлоги)
// и свежесть CVE-синхронизации. Кэш ведёт суточный крон; пустой кэш (первый
// деплой до boot-рефреша) — фронт просто не рендерит плашку.
exports.getFirmwareReleases = async (req, res, next) => {
  try {
    const [releases, cveSync] = await Promise.all([
      RouterOsRelease.find().lean(),
      MikrotikFirmwareState.findById("cve-sync").lean(),
    ]);

    res.status(200).json({
      channels: releases.map((release) => ({
        key: release._id,
        version: release.version || null,
        releasedAt: release.releasedAt || null,
        changelog: release.changelog || "",
        fetchedAt: release.fetchedAt || null,
        lastError: release.lastError || null,
      })),
      cveSync: cveSync
        ? {
            lastSuccessAt: cveSync.lastSuccessAt || null,
            lastError: cveSync.lastError || null,
            cveCount: cveSync.cveCount ?? null,
          }
        : null,
    });
  } catch (error) {
    next(new AppError("Failed to fetch RouterOS releases", 500, true, error));
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
/**
 * Применить считанные с устройства значения к карточке инвентаря (расхождения
 * показывает секция «Мониторинг» карточки). Вход record-центричный, как у всех
 * живых операций: запись знает свою карточку, а обратный путь (:clientDeviceId)
 * остался от вкладки мониторинга и удалён вместе с ней.
 *
 * Клиент присылает только ИМЕНА полей — значения выводит сервер из сохранённой
 * записи, чтобы браузер не мог записать в карточку произвольное.
 */
exports.syncInventory = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }
    if (!record.clientDevice) {
      return next(new AppError("Запись не связана с карточкой инвентаря", 409));
    }

    const device = await ClientDevice.findById(record.clientDevice).populate(
      "deviceModelId",
      "name",
    );
    if (!device) {
      return next(new AppError("Карточка устройства не найдена", 404));
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

    // Дубль-проверка hostname — в пределах компании (серийник не уникален,
    // см. models/inventory/clientDevice.js).
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
const connectByFilter = async (filter, req, res, next) => {
  try {
    const record = await Mikrotik.findOne(filter);

    if (!record || !record.credentials?.host) {
      return next(
        new AppError("Сначала задайте параметры подключения", 409),
      );
    }

    record.monitoringEnabled = true;

    const now = new Date();
    try {
      // Висячая ссылка на транзит бросит здесь и попадёт в общий catch —
      // статус offline с понятным (русским) lastError.
      const jumpCtx = await resolveJumpContext(record);
      const poll = await pollDevice({
        host: record.credentials.host,
        port: record.credentials.port,
        user: record.credentials.user,
        password: decryptSecret(record.credentials.password),
        tlsCert: record.credentials.tlsCert,
        knockSequence: decodeKnockSequence(record.credentials.knockSequence),
        jump: jumpCtx?.params,
      });
      Object.assign(record, mapPollToFields(poll));
      if (poll.tlsCert && !record.credentials.tlsCert) {
        record.credentials.tlsCert = poll.tlsCert; // pin trust-on-first-use cert
      }
      record.status = "online";
      record.lastSuccessfulConnectionAt = now;
      record.lastCheckedAt = now;
      record.lastError = null;
      record.failedPolls = 0;
      record.firstFailureAt = undefined;
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
      recordId: record._id,
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

exports.connectRecord = (req, res, next) =>
  connectByFilter({ _id: req.params.recordId }, req, res, next);

// Выключить фоновый мониторинг и пометить устройство офлайн.
const disconnectByFilter = async (filter, req, res, next) => {
  try {
    const record = await Mikrotik.findOneAndUpdate(
      filter,
      {
        $set: { monitoringEnabled: false, status: "offline", failedPolls: 0 },
        // Monitoring off means no poll will ever end the outage — drop the alert
        // state and close the episode silently (connectivity was not restored).
        $unset: {
          offlineSince: "",
          offlineAlertedAt: "",
          alertTicketId: "",
          firstFailureAt: "",
        },
      },
      { new: true },
    ).select("-credentials.password -credentials.knockSequence");

    if (!record) {
      return next(new AppError("Устройство не настроено", 404));
    }

    await closeOpenOutage(record);

    logger.log("info", "Mikrotik monitoring disabled", {
      actor: req.userId,
      recordId: record._id,
      ip: req.ip,
    });

    res.status(200).json({ message: "Мониторинг отключён", record });
  } catch (error) {
    next(new AppError("Failed to disconnect mikrotik device", 500, true, error));
  }
};

exports.disconnectRecord = (req, res, next) =>
  disconnectByFilter({ _id: req.params.recordId }, req, res, next);



// --- Связь записи мониторинга с инвентарём -------------------------------------

// Кандидат на авто-связь: карточка инвентаря с тем же серийным номером, ещё не
// связанная с другой записью. null — предлагать нечего.
const findInventoryCandidate = async (record) => {
  const serial = String(record?.serialNumber || "").trim();
  if (!serial) return null;

  const device = await ClientDevice.findOne({ serialNumber: serial })
    .populate({
      path: "deviceModelId",
      select: "name vendorId",
      populate: { path: "vendorId", select: "name" },
    })
    .populate("companyId", "alias fullTitle")
    .lean();
  if (!device) return null;

  const alreadyManaged = await Mikrotik.exists({ clientDevice: device._id });
  if (alreadyManaged) return null;

  return {
    clientDeviceId: device._id,
    hostname: device.hostname || null,
    modelName: device.deviceModelId?.name || null,
    vendorName: device.deviceModelId?.vendorId?.name || null,
    inventoryNumber: device.inventoryNumber || null,
    serialNumber: device.serialNumber,
    company: device.companyId
      ? {
          id: device.companyId._id,
          name: device.companyId.alias || device.companyId.fullTitle,
        }
      : null,
  };
};

// Блок «Инвентарь» шага после проверки: кандидат на связь по серийнику и может
// ли пользователь создать карточку. null — модуль «Учёт техники» выключен,
// блок не показывается вовсе.
const inventoryLinkContext = async (record, userId) => {
  const [prefs, user] = await Promise.all([
    Preferences.findOne({}).select("modules.inventory").lean(),
    User.findById(userId).select("permissions isAdmin").lean(),
  ]);
  if (prefs?.modules?.inventory?.isActive === false) return null;

  const candidate = await findInventoryCandidate(record);
  const canCreateCard = user
    ? (await canFor(user))({ clientDevice: ["manage"] })
    : false;
  return { candidate, canCreateCard };
};

// Записать связь запись → карточка: связь есть только у «живой» пары, поэтому
// standalone-идентичность (companyId/label) очищается — её место занимает карта.
const attachRecordToDevice = async (record, deviceId) => {
  record.clientDevice = deviceId;
  record.companyId = undefined;
  record.label = undefined;
  await record.save();
};

// Связать запись мониторинга с существующей карточкой инвентаря (шаг после
// проверки: «Найдена карточка с этим серийным номером — Связать»).
exports.linkInventory = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }
    if (record.clientDevice) {
      return next(
        new AppError("Запись уже связана с карточкой инвентаря", 409),
      );
    }

    const { clientDeviceId } = req.body || {};
    if (!mongoose.isValidObjectId(clientDeviceId)) {
      return next(new AppError("Некорректный идентификатор карточки", 422));
    }
    const device = await ClientDevice.findById(clientDeviceId).populate(
      "deviceModelId",
      "name",
    );
    if (!device) {
      return next(new AppError("Карточка инвентаря не найдена", 404));
    }
    const taken = await Mikrotik.exists({ clientDevice: device._id });
    if (taken) {
      return next(
        new AppError("Карточка уже связана с другой записью мониторинга", 409),
      );
    }
    // Связь предлагается по серийнику — расхождение означает не ту карточку.
    const cardSerial = String(device.serialNumber || "").trim();
    const recordSerial = String(record.serialNumber || "").trim();
    if (cardSerial && recordSerial && cardSerial !== recordSerial) {
      return next(
        new AppError("Серийные номера записи и карточки не совпадают", 409),
      );
    }

    try {
      await attachRecordToDevice(record, device._id);
    } catch (error) {
      if (error?.code === 11000) {
        return next(
          new AppError(
            "Карточка уже связана с другой записью мониторинга",
            409,
          ),
        );
      }
      throw error;
    }

    logger.log("info", "Mikrotik record linked to inventory", {
      actor: req.userId,
      recordId: record._id,
      clientDeviceId: device._id,
      ip: req.ip,
    });

    res.status(200).json({
      message: "Карточка связана",
      clientDeviceId: device._id,
      reconciliation: computeReconciliation(device, record),
    });
  } catch (error) {
    next(
      new AppError("Failed to link mikrotik record to inventory", 500, true, error),
    );
  }
};

// Создать карточку инвентаря из данных записи и связать (шаг после проверки:
// карточки с таким серийником нет). Модель подбирается по плате среди вендоров
// с включённым управлением Mikrotik; не нашлась — карточка без модели.
exports.createInventoryCard = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }
    if (record.clientDevice) {
      return next(
        new AppError("Запись уже связана с карточкой инвентаря", 409),
      );
    }

    const prefs = await Preferences.findOne({})
      .select("modules.inventory")
      .lean();
    if (prefs?.modules?.inventory?.isActive === false) {
      return next(new AppError("Модуль «Учёт техники» отключён", 409));
    }

    const serial = String(record.serialNumber || "").trim();
    if (serial) {
      const exists = await ClientDevice.findOne({ serialNumber: serial })
        .select("_id")
        .lean();
      if (exists) {
        return next(
          new AppError(
            "Карточка с таким серийным номером уже есть — свяжите запись с ней",
            409,
          ),
        );
      }
    }

    // Модель по плате: точное совпадение имени, иначе вхождение (анти-шум как
    // в сверке: "RB4011iGS+" ⊂ "RouterBOARD RB4011iGS+5HacQ2HnD").
    let model = null;
    const board = String(record.boardName || "").trim();
    if (board) {
      const vendorIds = await Vendor.find({
        isMikrotikManagementEnabled: true,
      }).distinct("_id");
      const models = await DeviceModel.find({ vendorId: { $in: vendorIds } })
        .select("name")
        .lean();
      const boardNorm = board.toLowerCase();
      model =
        models.find((m) => m.name.trim().toLowerCase() === boardNorm) ||
        models.find((m) => {
          const name = m.name.trim().toLowerCase();
          return name.includes(boardNorm) || boardNorm.includes(name);
        }) ||
        null;
    }

    const values = deriveSyncValues(record);
    const device = new ClientDevice({
      ...(model ? { deviceModelId: model._id } : {}),
      companyId: record.companyId || undefined,
      ...(values.hostname ? { hostname: values.hostname } : {}),
      ...(serial ? { serialNumber: serial } : {}),
      ...(values.operatingSystem
        ? { operatingSystem: values.operatingSystem }
        : {}),
      ...(values.ipAddress ? { ipAddress: values.ipAddress } : {}),
      status: "deployed",
      createdBy: req.userId,
      updatedBy: req.userId,
    });
    try {
      await device.save();
    } catch (error) {
      if (error?.code === 11000) {
        return next(
          new AppError(
            "Значение уже используется другой карточкой (серийный номер или имя)",
            409,
          ),
        );
      }
      throw error;
    }

    await attachRecordToDevice(record, device._id);

    logger.log("info", "Mikrotik inventory card created and linked", {
      actor: req.userId,
      recordId: record._id,
      clientDeviceId: device._id,
      modelMatched: Boolean(model),
      ip: req.ip,
    });

    res.status(201).json({
      message: "Карточка создана и связана",
      clientDeviceId: device._id,
    });
  } catch (error) {
    next(
      new AppError("Failed to create inventory card from mikrotik", 500, true, error),
    );
  }
};

// --- Standalone devices (no inventory ClientDevice, e.g. Cloud Hosted Router) ---

// Create a standalone managed device: verify-on-save, then persist a record with
// no clientDevice (identified by companyId + optional label). Ответ несёт блок
// «Инвентарь» (кандидат на связь по серийнику) для шага после проверки.
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

    res.status(201).json({
      message: "Устройство добавлено и проверено",
      record: safe,
      inventory: await inventoryLinkContext(record, req.userId),
    });
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

// Пересохранить параметры ЛЮБОЙ записи (verify-on-save) по её id. Для
// несвязанной записи принимает также companyId/label; у связанной идентичность
// даёт карточка инвентаря, поэтому эти поля игнорируются.
exports.updateRecordParameters = async (req, res, next) => {
  try {
    const existing = await Mikrotik.findById(req.params.recordId);
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
    const unset = { firstFailureAt: "" };
    // Очищенный селект транзита должен реально отвязать запись от роутера.
    if (!update.jumpRecordId) unset.jumpRecordId = "";
    if (existing.offlineSince) {
      await markRecovered(existing);
      unset.offlineSince = "";
      unset.offlineAlertedAt = "";
      unset.alertTicketId = "";
    }

    if (!existing.clientDevice) {
      if (req.body.companyId !== undefined) {
        update.companyId = req.body.companyId || null;
      }
      if (req.body.label !== undefined) {
        update.label = req.body.label || null;
      }
    }

    const record = await Mikrotik.findByIdAndUpdate(
      req.params.recordId,
      { $set: update, $unset: unset },
      { new: true },
    ).select("-credentials.password -credentials.knockSequence");

    logger.log("info", "Mikrotik record parameters saved", {
      actor: req.userId,
      recordId: req.params.recordId,
      host: update.credentials.host,
      ip: req.ip,
    });

    res.status(200).json({
      message: "Параметры сохранены и проверены",
      record,
      // Несвязанной записи после проверки снова предлагается связь (серийник
      // мог появиться только сейчас); у связанной блока нет.
      inventory: record.clientDevice
        ? null
        : await inventoryLinkContext(record, req.userId),
    });
  } catch (error) {
    next(
      new AppError("Failed to save mikrotik record parameters", 500, true, error),
    );
  }
};

// Удалить запись мониторинга по её id (креды, закреплённый серт, снятые данные,
// эпизоды). Связанная карточка инвентаря остаётся нетронутой.
exports.deleteRecord = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId);
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }

    // Запись может быть транзитом для других — удалять её нельзя, пока они
    // подключены через неё (иначе их мониторинг молча осиротеет).
    const conflict = await dependentsConflict(record);
    if (conflict) return next(conflict);

    await Mikrotik.deleteOne({ _id: record._id });
    await deleteOutages(record._id);

    logger.log("info", "Mikrotik record deleted", {
      actor: req.userId,
      recordId: req.params.recordId,
      hadClientDevice: Boolean(record.clientDevice),
      ip: req.ip,
    });

    res.status(200).json({ message: "Устройство удалено из мониторинга" });
  } catch (error) {
    next(new AppError("Failed to delete mikrotik record", 500, true, error));
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

// Sorting IP strings lexically puts "46.x" after "192.x" and "10.0.0.1" before
// "1.0.0.10" — compare by octets instead. The mask is the low-order part of the
// key so /30 and /24 on the same address keep a stable order.
const addressSortKey = (value) => {
  const [ip = "", mask = ""] = String(value || "").split("/");
  const octets = ip.split(".").map((part) => Number(part) || 0);
  while (octets.length < 4) octets.push(0);
  return (
    octets.slice(0, 4).reduce((acc, part) => acc * 256 + part, 0) * 64 +
    (Number(mask) || 0)
  );
};

const byAddress = (a, b) => addressSortKey(a) - addressSortKey(b);

// Overlapping networks are ranked by how much they demand attention, so the
// page reads top-down and stops being interesting at a predictable point.
const OVERLAP_RANK = { addressClash: 0, maskOverlap: 1, sharedNetwork: 2 };

// The fleet-wide IP plan: every address of every managed record, plus a
// breakdown of which networks overlap and why.
//
// Disabled addresses are returned too (the previous `disabled === "false"`
// filter hid them everywhere): a disabled address is an ordinary spare, and it
// matters when working out why a tunnel refuses to come up. They take no part
// in overlap detection — a disabled address collides with nothing.
//
// Empty sub-documents (an `_id` and nothing else — the poller creates them;
// there are 36 in the live data) are skipped: that is not an address.
//
// Overlaps carry a REASON, because one repeated `network` string covers three
// unrelated facts:
//   addressClash  — two devices hold the same address. Broken.
//   maskOverlap   — one network, several masks (/24 swallowing a /30). Broken.
//   sharedNetwork — different addresses, shared network: the two ends of a GRE
//                   tunnel, a management VLAN across a stack of switches, one
//                   upstream ISP subnet. Normally fine.
// On live data 14 networks repeat and 3 of them are faults, while the previous
// report highlighted all 34 rows identically — that is, told them apart not at
// all.
exports.networksReport = async (req, res, next) => {
  try {
    const records = await Mikrotik.find({})
      .select("_id name addresses")
      .sort({ name: 1 })
      .lean();

    const entries = [];
    for (const record of records) {
      for (const address of record.addresses || []) {
        if (!address.address) continue;
        entries.push({
          id: String(address._id),
          recordId: String(record._id),
          deviceName: record.name || "",
          address: address.address,
          network: address.network || "",
          interface: address.interface || "",
          comment: address.comment || "",
          disabled: address.disabled === "true",
        });
      }
    }

    const byNetwork = new Map();
    for (const entry of entries) {
      if (entry.disabled || !entry.network) continue;
      const group = byNetwork.get(entry.network);
      if (group) group.push(entry);
      else byNetwork.set(entry.network, [entry]);
    }

    const overlaps = [];
    for (const [network, group] of byNetwork) {
      if (group.length < 2) continue;

      const timesSeen = new Map();
      for (const entry of group) {
        timesSeen.set(entry.address, (timesSeen.get(entry.address) || 0) + 1);
      }
      const clashing = [...timesSeen.entries()]
        .filter(([, count]) => count > 1)
        .map(([address]) => address)
        .sort(byAddress);

      const masks = [
        ...new Set(
          group.map((entry) => entry.address.split("/")[1]).filter(Boolean),
        ),
      ].sort((a, b) => Number(a) - Number(b));

      const kind = clashing.length
        ? "addressClash"
        : masks.length > 1
          ? "maskOverlap"
          : "sharedNetwork";

      // The flat list carries the same reason, so a row in the registry can
      // show its dot without the client rebuilding the grouping.
      for (const entry of group) entry.overlap = kind;

      overlaps.push({
        network,
        kind,
        clashing,
        masks,
        deviceCount: new Set(group.map((entry) => entry.deviceName)).size,
        addresses: [...group].sort((a, b) => byAddress(a.address, b.address)),
      });
    }

    overlaps.sort(
      (a, b) =>
        OVERLAP_RANK[a.kind] - OVERLAP_RANK[b.kind] ||
        byAddress(a.network, b.network),
    );

    entries.sort(
      (a, b) =>
        byAddress(a.address, b.address) ||
        a.deviceName.localeCompare(b.deviceName, "ru"),
    );

    res.status(200).json({
      entries,
      overlaps,
      totals: {
        devices: new Set(entries.map((entry) => entry.deviceName)).size,
        addresses: entries.length,
        disabled: entries.filter((entry) => entry.disabled).length,
        networks: byNetwork.size,
      },
    });
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
