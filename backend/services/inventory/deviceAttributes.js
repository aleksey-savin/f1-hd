// Значения атрибутов уровня устройства — ClientDevice.attributes, та же форма
// { attributeId, value }, что у DeviceConfiguration.values, и та же проверка
// значения (attributeValue.js). Допустимы только атрибуты из связок уровня
// «device» эффективного типа устройства (тип модели, иначе прямой).

const net = require("net");
const { isValidValue, storedValue } = require("./attributeValue");
const { splitLinks } = require("./attributeScope");

const idOf = (ref) => String(ref?._id ?? ref ?? "");
const attrOf = (link) => (link?.attributeId && typeof link.attributeId === "object" ? link.attributeId : null);
const byAttrId = (links) => new Map(links.filter(attrOf).map((link) => [idOf(link.attributeId), link]));

// Системные атрибуты (бывшие поля карточки) сохраняют прежнюю проверку формата.
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const FORMAT_BY_CODE = {
  ip_address: [(value) => net.isIP(value) !== 0, "Некорректный IP-адрес"],
  mac_address: [(value) => MAC.test(value), "Некорректный MAC-адрес"],
};

/**
 * Тело формы/агента → значения для записи. Пустые выпадают («не задано»);
 * с keepEmpty остаются как { value: "" } — «снять» для mergeDeviceAttributes.
 * { values } либо { error } с текстом для 400.
 */
const normalizeDeviceAttributes = (raw, deviceLinks = [], { keepEmpty = false } = {}) => {
  if (raw == null) return { values: [] };
  if (!Array.isArray(raw)) return { error: "attributes должен быть массивом" };
  const links = byAttrId(deviceLinks);
  const values = [];
  const seen = new Set();
  for (const entry of raw) {
    const id = idOf(entry?.attributeId);
    const attr = attrOf(links.get(id));
    if (!attr) return { error: "Атрибут не относится к устройствам этого типа" };
    const value = storedValue(attr, entry?.value);
    if (value === null || !isValidValue(attr, value)) {
      return { error: `Неверное значение атрибута «${attr.name}»` };
    }
    const format = FORMAT_BY_CODE[attr.code];
    if (value && format && !format[0](value)) return { error: format[1] };
    if ((!value && !keepEmpty) || seen.has(id)) continue;
    seen.add(id);
    values.push({ attributeId: attr._id, value });
  }
  return { values };
};

/**
 * Частичная правка: патч поверх текущего по attributeId, пустое значение
 * снимает. Значения атрибутов, которых нет в связках (тип сменился), выпадают.
 * patch — уже нормализованный, но пустые в нём оставлены как «снять»:
 * [{ attributeId, value: "" }].
 */
const mergeDeviceAttributes = (current = [], patch = [], deviceLinks = []) => {
  const allowed = byAttrId(deviceLinks);
  const next = new Map();
  for (const entry of current) {
    const id = idOf(entry?.attributeId);
    if (allowed.has(id) && entry.value) next.set(id, { attributeId: entry.attributeId, value: entry.value });
  }
  for (const entry of patch) {
    const id = idOf(entry?.attributeId);
    if (!allowed.has(id)) continue;
    if (entry.value) next.set(id, { attributeId: entry.attributeId, value: entry.value });
    else next.delete(id);
  }
  return [...next.values()];
};

/** Имена обязательных атрибутов устройства без значения. */
const missingRequired = (deviceLinks = [], values = []) => {
  const filled = new Set(values.filter((v) => v?.value).map((v) => idOf(v.attributeId)));
  return deviceLinks
    .filter((link) => link.required && attrOf(link) && !filled.has(idOf(link.attributeId)))
    .map((link) => link.attributeId.name);
};

/** Связки уровня устройства типа, атрибут populated. */
const loadDeviceLinks = async (typeId) => {
  if (!typeId) return [];
  const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
  const links = await DeviceTypeAttribute.find({ deviceTypeId: typeId })
    .populate("attributeId", "code name valueType unit options isActive scope")
    .select("attributeId required groupId order")
    .lean();
  return splitLinks(links).device;
};

module.exports = {
  FORMAT_BY_CODE,
  normalizeDeviceAttributes,
  mergeDeviceAttributes,
  missingRequired,
  loadDeviceLinks,
};
