// Системные атрибуты устройства — бывшие поля карточки ipAddress, macAddress,
// operatingSystem. Теперь это обычные атрибуты уровня «device» (значения в
// ClientDevice.attributes), но код их знает: Mikrotik пишет в них снятое с
// устройства, MCP и списки показывают их как прежние ключи.
//
// Атрибут находится по коду ИЛИ имени (у старых баз мог остаться только один из
// них — см. устаревший unique-индекс по name). Создаёт их сид
// 2026-10-29-deviceSystemAttributes и миграция moveDeviceTechToAttributes.

const SYSTEM_CODES = { os: "operatingsystem", ip: "ip_address", mac: "mac_address" };
const SYSTEM_NAMES = { os: "Операционная система", ip: "IP-адрес", mac: "MAC-адрес" };
// Ключ в прежних полях устройства, DTO и патчах Mikrotik
const FIELD_BY_KEY = { os: "operatingSystem", ip: "ipAddress", mac: "macAddress" };
const KEYS = Object.keys(SYSTEM_CODES);

const idOf = (ref) => String(ref?._id ?? ref ?? "");

const mongoStore = () => {
  const DeviceAttribute = require("../../models/inventory/deviceAttribute");
  const DeviceConfiguration = require("../../models/inventory/deviceConfiguration");
  return {
    findAttributes: ({ codes, names }) =>
      DeviceAttribute.find({ $or: [{ code: { $in: codes } }, { name: { $in: names } }] })
        .select("code name valueType scope")
        .lean(),
    createAttribute: async (doc) => (await DeviceAttribute.create(doc)).toObject(),
    updateAttribute: (id, set) => DeviceAttribute.updateOne({ _id: id }, { $set: set }),
    countConfigValues: (id) => DeviceConfiguration.countDocuments({ "values.attributeId": id }),
  };
};

// Найденные атрибуты по ключам: сперва по коду, потом по имени
const matchSystem = (list) => {
  const found = {};
  for (const key of KEYS) {
    found[key] =
      list.find((attr) => attr.code === SYSTEM_CODES[key]) ||
      list.find((attr) => attr.name === SYSTEM_NAMES[key]) ||
      null;
  }
  return found;
};

const lookup = (store) =>
  store.findAttributes({ codes: Object.values(SYSTEM_CODES), names: Object.values(SYSTEM_NAMES) });

// Вид значений, который приводится к тексту без потерь (вариант списка — тот же текст)
const TO_STRING = new Set(["string", "select", "text"]);

/**
 * Найти или создать три системных атрибута и привести найденные к канону: код
 * (найденный по имени — получает системный код; на него завязаны интерфейс и
 * проверка формата), вид «string», уровень «device». Уровень модели при значениях
 * в конфигурациях и вид, не сводимый к тексту, — ошибка (значения молча
 * потерялись бы). Повторный вызов ничего не меняет.
 */
const ensureSystemAttributes = async ({ log = console.log, store = mongoStore() } = {}) => {
  const found = matchSystem(await lookup(store));
  // Сначала все проверки, потом записи: остановка не оставляет полработы
  for (const key of KEYS) {
    const attr = found[key];
    if (attr && !TO_STRING.has(attr.valueType ?? "string")) {
      throw new Error(`У атрибута «${attr.name}» вид значений «${attr.valueType}», нужен текст — перенос остановлен`);
    }
    if (attr && attr.scope !== "device" && (await store.countConfigValues(attr._id)) > 0) {
      throw new Error(`Атрибут «${attr.name}» заполнен в конфигурациях — перенос остановлен`);
    }
  }
  const ids = {};
  for (const key of KEYS) {
    let attr = found[key];
    if (!attr) {
      attr = await store.createAttribute({
        code: SYSTEM_CODES[key],
        name: SYSTEM_NAMES[key],
        valueType: "string",
        scope: "device",
      });
      log(`создан атрибут «${attr.name}»`);
    } else {
      const set = {};
      if (attr.code !== SYSTEM_CODES[key]) set.code = SYSTEM_CODES[key];
      if ((attr.valueType ?? "string") !== "string") set.valueType = "string";
      if (attr.scope !== "device") set.scope = "device";
      if (Object.keys(set).length) {
        await store.updateAttribute(attr._id, set);
        if (set.code) log(`атрибут «${attr.name}» получил код ${set.code}`);
        if (set.valueType) log(`атрибут «${attr.name}» стал текстом`);
        if (set.scope) log(`атрибут «${attr.name}» переведён на уровень устройства`);
      }
    }
    ids[key] = attr._id;
  }
  return ids;
};

// Кэш на минуту: пересозданный атрибут подхватывается без перезапуска
const CACHE_MS = 60_000;
let cached = null;

/** id системных атрибутов без записи; кэшируется, когда найдены все три. fresh — мимо кэша. */
const systemIds = async ({ store, fresh = false } = {}) => {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.ids;
  const found = matchSystem(await lookup(store ?? mongoStore()));
  const ids = Object.fromEntries(KEYS.map((key) => [key, found[key]?._id ?? null]));
  cached = KEYS.every((key) => ids[key]) ? { ids, at: Date.now() } : null;
  return ids;
};

const SYSTEM_CODE_SET = new Set(Object.values(SYSTEM_CODES));

/**
 * Отказ правке системного атрибута (по коду): уровень — только «device», код и
 * вид значений не меняются; next === null — удаление. null — можно.
 */
const systemAttributeChangeError = (attr, next) => {
  if (!SYSTEM_CODE_SET.has(attr?.code)) return null;
  const head = `«${attr.name}» — системный атрибут`;
  if (next === null) return `${head}: удалить нельзя`;
  if (next.scope && next.scope !== "device") return `${head}: значение всегда задаётся у каждого устройства`;
  if (next.code && next.code !== attr.code) return `${head}: код не меняется`;
  if (next.valueType && next.valueType !== attr.valueType) return `${head}: вид значений не меняется`;
  return null;
};

// Связка тип↔атрибут — upsert по паре: параллельные записи (синхронизация Mikrotik)
// не плодят дублей; уже существующую не трогает
const createLinkOnce = (link) => {
  const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
  const { deviceTypeId, attributeId, ...rest } = link;
  return DeviceTypeAttribute.updateOne({ deviceTypeId, attributeId }, { $setOnInsert: rest }, { upsert: true });
};

/** Значения системных атрибутов устройства под прежними ключами; пустое — null. */
const systemValues = (device, ids) => {
  const byId = new Map((device?.attributes ?? []).map((entry) => [idOf(entry?.attributeId), entry?.value]));
  const out = {};
  for (const key of KEYS) {
    const value = ids?.[key] ? byId.get(idOf(ids[key])) : null;
    out[FIELD_BY_KEY[key]] = value ? String(value) : null;
  }
  return out;
};

/**
 * Новый массив attributes: системные значения из patch ({ ipAddress, macAddress,
 * operatingSystem }) поверх текущих. Не упомянутое (undefined) не трогается,
 * пустое или null снимает значение; прочие атрибуты устройства остаются.
 */
const withSystemValues = (device, patch = {}, ids) => {
  const next = (device?.attributes ?? []).map((entry) => ({
    attributeId: entry.attributeId?._id ?? entry.attributeId,
    value: entry.value,
  }));
  for (const key of KEYS) {
    const raw = patch[FIELD_BY_KEY[key]];
    if (raw === undefined || !ids?.[key]) continue;
    const value = String(raw ?? "").trim();
    const at = next.findIndex((entry) => idOf(entry.attributeId) === idOf(ids[key]));
    if (!value) {
      if (at >= 0) next.splice(at, 1);
    } else if (at >= 0) {
      next[at] = { attributeId: next[at].attributeId, value };
    } else {
      next.push({ attributeId: ids[key], value });
    }
  }
  return next;
};

/**
 * Недостающие связки типа с атрибутами — поля новых DeviceTypeAttribute: без
 * группы, не обязательные, в конец. Ничего не пишет.
 */
const missingTypeLinks = async (typeId, attributeIds = []) => {
  if (!typeId || !attributeIds.length) return [];
  const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
  const links = await DeviceTypeAttribute.find({ deviceTypeId: typeId }).select("attributeId order").lean();
  const linked = new Set(links.map((link) => idOf(link.attributeId)));
  let order = links.reduce((max, link) => Math.max(max, link.order ?? 0), -1);
  const missing = [];
  for (const attributeId of attributeIds) {
    if (!attributeId || linked.has(idOf(attributeId))) continue;
    order += 1;
    missing.push({ deviceTypeId: typeId, attributeId, groupId: null, required: false, order });
    linked.add(idOf(attributeId));
  }
  return missing;
};

/** Связать атрибуты с типом, если связок ещё нет. */
const ensureTypeLinks = async (typeId, attributeIds = []) => {
  for (const link of await missingTypeLinks(typeId, attributeIds)) await createLinkOnce(link);
};

/** Системные поля тела (агент, Mikrotik): только переданные ключи. */
const systemPatchOf = (body = {}) =>
  Object.fromEntries(
    Object.values(FIELD_BY_KEY)
      .filter((field) => body[field] !== undefined)
      .map((field) => [field, body[field]]),
  );

/**
 * План записи системных значений без записи: новый attributes и недостающие
 * связки с типом для атрибутов с непустым значением (иначе значение было бы
 * невидимо в карточке и форме). typeId — эффективный тип (тип модели, иначе
 * прямой); без типа значения всё равно пишутся. null — патч пуст.
 */
const planSystemValues = async (device, patch = {}, { typeId, ids } = {}) => {
  const keys = KEYS.filter((key) => patch[FIELD_BY_KEY[key]] !== undefined);
  if (!keys.length) return null;
  const resolved = ids ?? (await systemIds());
  const filledKeys = keys.filter((key) => String(patch[FIELD_BY_KEY[key]] ?? "").trim());
  return {
    attributes: withSystemValues(device, patch, resolved),
    links: await missingTypeLinks(
      typeId,
      filledKeys.map((key) => resolved[key]),
    ),
  };
};

/** То же с записью связок; attributes — в документ, сохраняет вызывающий (Mikrotik). */
const applySystemValues = async (device, patch = {}, options = {}) => {
  const planned = await planSystemValues(device, patch, options);
  if (!planned) return;
  for (const link of planned.links) await createLinkOnce(link);
  device.attributes = planned.attributes;
};

module.exports = {
  SYSTEM_CODES,
  SYSTEM_NAMES,
  FIELD_BY_KEY,
  ensureSystemAttributes,
  systemAttributeChangeError,
  systemIds,
  systemValues,
  withSystemValues,
  ensureTypeLinks,
  systemPatchOf,
  planSystemValues,
  applySystemValues,
};
