// Уровень атрибута каталога: «model» — одно значение на конфигурацию модели
// (DeviceConfiguration.values), «device» — своё у каждого экземпляра
// (ClientDevice.attributes). Уровень — свойство самого атрибута, связка с типом
// его не задаёт: IP-адрес не бывает характеристикой модели ни у одного типа.

const SCOPES = ["model", "device"];
const DEFAULT_SCOPE = "model";

const isDeviceScoped = (attr) => attr?.scope === "device";

// Связки типа (attributeId populated) по уровню; непопулированная — модель:
// без атрибута уровень неизвестен, а модель — прежнее поведение.
const splitLinks = (links = []) => {
  const model = [];
  const device = [];
  for (const link of links) {
    const attr = link?.attributeId;
    (attr && typeof attr === "object" && isDeviceScoped(attr) ? device : model).push(link);
  }
  return { model, device };
};

const idOf = (ref) => String(ref?._id ?? ref ?? "");

// Значения конфигурации не должны ссылаться на атрибут уровня устройства.
// attrsById — Map(id → атрибут) с полем scope.
const deviceScopedValueError = (values = [], attrsById) => {
  for (const entry of values) {
    const attr = attrsById.get(idOf(entry?.attributeId));
    if (isDeviceScoped(attr)) {
      return `Атрибут «${attr.name}» задаётся у каждого устройства, а не у модели`;
    }
  }
  return null;
};

// То же по базе: значения формы конфигурации/модели ({ attributeId, value }).
// Модель — ленивым require, чтобы чистые функции выше тестировались без БД.
const configValuesScopeError = async (values) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const DeviceAttribute = require("../../models/inventory/deviceAttribute");
  const attrs = await DeviceAttribute.find({
    _id: { $in: values.map((entry) => idOf(entry?.attributeId)).filter((id) => /^[a-f0-9]{24}$/i.test(id)) },
    scope: "device",
  })
    .select("name scope")
    .lean();
  return deviceScopedValueError(values, new Map(attrs.map((attr) => [String(attr._id), attr])));
};

// Смена уровня, пока у атрибута есть значения на прежнем уровне, оставила бы
// их невидимыми между моделью и устройством.
const scopeChangeError = (attr, nextScope, { configValues = 0, deviceValues = 0 } = {}) => {
  const current = attr?.scope || DEFAULT_SCOPE;
  if (!nextScope || nextScope === current) return null;
  const held = current === "device" ? deviceValues : configValues;
  return held > 0 ? `У атрибута «${attr.name}» уже есть значения — уровень не меняется` : null;
};

module.exports = {
  SCOPES,
  DEFAULT_SCOPE,
  isDeviceScoped,
  splitLinks,
  deviceScopedValueError,
  configValuesScopeError,
  scopeChangeError,
};
