const mongoose = require("mongoose");
const Mikrotik = require("@/models/mikrotik");
const MikrotikArtifact = require("@/models/mikrotikArtifact");
require("@/models/company");
require("@/models/inventory/clientDevice");
require("@/models/subdivision");
const Location = require("@/models/inventory/location");
const storage = require("@/services/storage");
const { decryptArtifact } = require("@/services/crypto/artifactBox");
const { computeAvailability } = require("@/services/mikrotik/outages");
const { loadFirmwareContext, evaluateFirmware, parseFirmware } = require("@/services/mikrotik/firmware");
const { isUpgrading } = require("@/services/mikrotik/upgradeGuard");
const { resolveJumpContext, pollParams } = require("@/services/mikrotik/monitorState");
const { assertPublicHost, assertJumpTargetHost } = require("@/services/mikrotik/hostGuard");
const {
  buildSshParams,
  withSshSession,
  withApiSession,
  exportConfig,
  describeConnectionError,
} = require("@/services/mikrotik/connector");
const { createLiveConfig } = require("@/services/mikrotik/liveConfig");
const { liveLimiter, liveError } = require("@/services/mikrotik/liveLimiter");
const { redactConfig } = require("@/services/mikrotik/configRedact");
const { runCommands } = require("@/services/mikrotik/liveState");

/**
 * Чтение Mikrotik для MCP-инструментов (mikrotikTools.js). Наружу уходят
 * плоские строки из перечисленных полей: из `credentials` — только host и
 * port; логин, пароль, отпечатки TLS/SSH и последовательность стука не
 * читаются вовсе. Конфигурация покидает модуль только вычищенной
 * (services/mikrotik/configRedact.js) — сырой текст живёт внутри функций чтения.
 */

const ROW_FIELDS =
  "label name boardName serialNumber currentFirmware status monitoringEnabled credentials.host credentials.port companyId clientDevice jumpRecordId lastSuccessfulConnectionAt lastCheckedAt offlineSince createdAt";
const DETAIL_FIELDS = `${ROW_FIELDS} totalMemory license.level license.deadlineAt license.nextRenewalAt addresses lastError plannedOffline`;
const POPULATE = [
  { path: "companyId", select: "alias fullTitle" },
  {
    path: "clientDevice",
    select: "companyId serialNumber locationId",
    populate: [
      { path: "companyId", select: "alias fullTitle" },
      {
        path: "locationId",
        select: "name type address parent subdivisions",
        populate: { path: "subdivisions", select: "name" },
      },
    ],
  },
];
const MAX_LOCATION_DEPTH = 5;
const MAX_EXPORTS = 30;

const companyName = (company) => company?.alias || company?.fullTitle || null;

// Расположение устройства — из связанной карточки инвентаря: цепочка
// «здание › этаж › помещение», адрес и подразделения этого места. У записи без
// карточки (или карточки без расположения) его нет — это норма.
const loadParents = async (locations) => {
  const byId = new Map();
  let missing = [...new Set(locations.map((item) => item?.parent && String(item.parent)).filter(Boolean))];
  for (let depth = 0; depth < MAX_LOCATION_DEPTH && missing.length; depth += 1) {
    const found = await Location.find({ _id: { $in: missing } }).select("name address parent").lean();
    for (const item of found) byId.set(String(item._id), item);
    missing = [...new Set(found.map((item) => item.parent && String(item.parent)).filter((id) => id && !byId.has(id)))];
  }
  return byId;
};

const locationView = (location, parents) => {
  if (!location?.name) return null;
  const path = [location.name];
  let address = location.address || null;
  let cursor = location;
  for (let depth = 0; depth < MAX_LOCATION_DEPTH && cursor?.parent; depth += 1) {
    cursor = parents.get(String(cursor.parent));
    if (!cursor) break;
    path.unshift(cursor.name);
    address = address || cursor.address || null;
  }
  return {
    path,
    address,
    subdivisions: (location.subdivisions || []).map((item) => item?.name).filter(Boolean),
  };
};

const toRow = (record, names, parents) => ({
  _id: String(record._id),
  name: record.name || record.label || record.credentials?.host || "Mikrotik",
  label: record.label || null,
  company: companyName(record.companyId) || companyName(record.clientDevice?.companyId),
  boardName: record.boardName || null,
  serialNumber: record.serialNumber || record.clientDevice?.serialNumber || null,
  currentFirmware: record.currentFirmware || null,
  status: record.status || "offline",
  monitoringEnabled: Boolean(record.monitoringEnabled),
  host: record.credentials?.host || null,
  port: record.credentials?.port || null,
  via: record.jumpRecordId ? names.get(String(record.jumpRecordId)) || "another device" : null,
  lastSuccessfulConnectionAt: record.lastSuccessfulConnectionAt || null,
  lastCheckedAt: record.lastCheckedAt || null,
  offlineSince: record.offlineSince || null,
  location: parents ? locationView(record.clientDevice?.locationId, parents) : null,
});

const nameMap = (records) =>
  new Map(records.map((r) => [String(r._id), r.name || r.label || r.credentials?.host || "Mikrotik"]));

// `locations` — модуль «Учёт техники» включён: расположение берётся из его
// карточек, с выключенным модулем агент их не видит.
const listDevices = async ({ locations = false } = {}) => {
  const records = await Mikrotik.find({}).select(ROW_FIELDS).populate(POPULATE).lean();
  const names = nameMap(records);
  const parents = locations ? await loadParents(records.map((r) => r.clientDevice?.locationId)) : null;
  return records.map((record) => toRow(record, names, parents));
};

// Адрес → имя управляемого устройства: подписывает пиров туннелей и соседей.
const loadAddressBook = async () => {
  const records = await Mikrotik.find({}).select("name label credentials.host addresses.address").lean();
  const book = new Map();
  for (const record of records) {
    const name = record.name || record.label || record.credentials?.host;
    if (!name) continue;
    for (const value of [record.credentials?.host, ...(record.addresses || []).map((item) => item?.address)]) {
      const address = String(value || "").split("/")[0];
      if (address && !book.has(address)) book.set(address, name);
    }
  }
  return book;
};

const exportRow = (artifact) => ({
  _id: String(artifact._id),
  createdAt: artifact.createdAt,
  trigger: artifact.trigger || null,
  routerOsVersion: artifact.routerOsVersion || null,
});

const listExports = async (id) =>
  (
    await MikrotikArtifact.find({ mikrotik: id, type: "export" })
      .sort({ createdAt: -1 })
      .limit(MAX_EXPORTS)
      .select("createdAt trigger routerOsVersion")
      .lean()
  ).map(exportRow);

const loadDevice = async (id, { days, locations = false }) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const record = await Mikrotik.findById(id).select(DETAIL_FIELDS).populate(POPULATE).lean();
  if (!record) return null;
  const jump = record.jumpRecordId
    ? await Mikrotik.findById(record.jumpRecordId).select("name label credentials.host").lean()
    : null;
  const [availability, firmwareContext, exports] = await Promise.all([
    computeAvailability(record, { days }),
    loadFirmwareContext(),
    listExports(record._id),
  ]);
  const parents = locations ? await loadParents([record.clientDevice?.locationId]) : null;
  return {
    device: {
      ...toRow(record, nameMap(jump ? [jump] : []), parents),
      totalMemory: record.totalMemory || null,
      license: record.license || null,
      addresses: record.addresses || [],
      lastError: record.lastError || null,
      plannedOffline: record.plannedOffline || [],
      monitoredSince: record.createdAt || null,
    },
    availability,
    firmware: evaluateFirmware(record, firmwareContext),
    exports,
  };
};

// Заход на роутер — тем же путём и с теми же стражами, что экспорт для
// бэкапа (services/mikrotik/artifacts.js#createArtifact), но без записи.
const readExport = async (record) => {
  const jumpCtx = await resolveJumpContext(record);
  if (isUpgrading(record) || isUpgrading(jumpCtx?.doc)) {
    throw liveError("MIKROTIK_LIVE_UPGRADING", "The device is being upgraded");
  }
  if (record.jumpRecordId) assertJumpTargetHost(record.credentials.host);
  else await assertPublicHost(record.credentials.host);
  const { result } = await withSshSession(
    { ...buildSshParams(record), jump: jumpCtx?.params },
    (conn) => exportConfig(conn, { hideSensitive: parseFirmware(record.currentFirmware)?.major === 6 }),
  );
  return result;
};

const liveConfig = createLiveConfig({ readExport });

/** Вычищенная живая конфигурация; null — устройства нет. Сбой связи бросается. */
const readLiveConfig = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const record = await Mikrotik.findById(id);
  if (!record?.credentials?.host) return null;
  return liveConfig.get(record);
};

const SESSION_DEADLINE_MS = 60 * 1000;

/**
 * Диагностика: команды из закрытого списка (services/mikrotik/liveState.js)
 * одной API-сессией, по очереди. Команда, которую роутер не знает или на
 * которую не ответил, даёт `{ title, error }` — остальные выполняются. Бросает,
 * только если не открылась сама сессия. null — устройства нет.
 */
const runOnDevice = async (id, commands) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const record = await Mikrotik.findById(id);
  if (!record?.credentials?.host) return null;
  return liveLimiter.run(record, async () => {
    const jumpCtx = await resolveJumpContext(record);
    if (isUpgrading(record) || isUpgrading(jumpCtx?.doc)) {
      throw liveError("MIKROTIK_LIVE_UPGRADING", "The device is being upgraded");
    }
    // Те же стражи адреса, что у чтения конфигурации (readExport)
    if (record.jumpRecordId) assertJumpTargetHost(record.credentials.host);
    else await assertPublicHost(record.credentials.host);
    return withApiSession(
      { ...pollParams(record), jump: jumpCtx?.params },
      (run) => runCommands(run, commands),
      { deadlineMs: SESSION_DEADLINE_MS },
    );
  });
};

const LIVE_MESSAGES = {
  MIKROTIK_LIVE_UPGRADING: "the device is being upgraded right now — try again in a few minutes",
  MIKROTIK_LIVE_BUSY: "too many device sessions are in progress — try again in a minute",
  MIKROTIK_LIVE_BAD_EXPORT: "the device did not return a configuration export",
  MIKROTIK_BLOCKED_HOST: "the device address is not allowed for connections from HD",
};

// Понятная агенту причина сбоя живого чтения; null — причина неизвестна.
const describeLiveError = (error) =>
  LIVE_MESSAGES[String(error?.code || "")] || describeConnectionError(error)?.message || null;

const MISSING_FILE = new Set(["NoSuchKey", "NotFound", "ENOENT"]);

/** Сохранённый экспорт устройства, вычищенный; null — такого экспорта нет. */
const loadExportConfig = async (deviceId, artifactId) => {
  if (!mongoose.isValidObjectId(deviceId) || !mongoose.isValidObjectId(artifactId)) return null;
  const artifact = await MikrotikArtifact.findOne({ _id: artifactId, mikrotik: deviceId, type: "export" })
    .select("storageKey createdAt trigger routerOsVersion")
    .lean();
  if (!artifact) return null;
  let stored;
  try {
    stored = await storage.getArtifactBuffer(artifact.storageKey);
  } catch (error) {
    // Запись есть, файла в хранилище нет — для агента экспорта нет
    if (MISSING_FILE.has(String(error?.Code || error?.code || error?.name)) || /not found$/.test(String(error?.message))) return null;
    throw error;
  }
  return { ...exportRow(artifact), config: redactConfig(decryptArtifact(stored)) };
};

module.exports = {
  listDevices,
  loadDevice,
  listExports,
  readLiveConfig,
  runOnDevice,
  loadAddressBook,
  describeLiveError,
  loadExportConfig,
};
