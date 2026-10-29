// Имена и снимки для текста операций и сверки дрейфа: describe(model, id) ->
// { name, updatedAt, hidden } | null. hidden — запись скрыта: isActive:false
// (только типы, атрибуты, вендоры, поставщики) или deletedAt (модели, конфигурации,
// сборки, устройства). Скрытое находится, но выбрать его нельзя — отказывает kit.
// Устройство называется типом и номером: «ПК PC-000123»; безымянная
// конфигурация — именем своей модели.
const mongoose = require("mongoose");
const ClientDevice = require("../../../models/inventory/clientDevice");
const DeviceModel = require("../../../models/inventory/deviceModel");
const DeviceType = require("../../../models/inventory/deviceType");
const DeviceConfiguration = require("../../../models/inventory/deviceConfiguration");
const DeviceBuild = require("../../../models/inventory/deviceBuild");
const DeviceAttribute = require("../../../models/inventory/deviceAttribute");
const Vendor = require("../../../models/inventory/vendor");
const Supplier = require("../../../models/inventory/supplier");
const AttributeGroup = require("../../../models/inventory/attributeGroup");
// Цель сверки у правки связи тип↔атрибут: changeExecutor берёт модель по имени
require("../../../models/inventory/deviceTypeAttribute");
const Location = require("../../../models/inventory/location");
const Company = require("../../../models/company");
const User = require("../../../models/user");

const modelTitle = async (model) => {
  const vendor = model.vendorId ? await Vendor.findById(model.vendorId).select("name").lean() : null;
  return [vendor?.name, model.name].filter(Boolean).join(" ");
};

const deviceName = async (device) => {
  const model = device.deviceModelId
    ? await DeviceModel.findById(device.deviceModelId).select("name vendorId deviceTypeId").lean()
    : null;
  const typeId = model?.deviceTypeId ?? device.deviceTypeId;
  const type = typeId ? await DeviceType.findById(typeId).select("name").lean() : null;
  const number = device.inventoryNumber || device.serialNumber;
  if (number) return [type?.name, number].filter(Boolean).join(" ");
  return (model ? await modelTitle(model) : type?.name) || "устройство без номера";
};

const configName = async (config) => {
  if (config.name || !config.deviceModelId) return config.name;
  const model = await DeviceModel.findById(config.deviceModelId).select("name vendorId").lean();
  return model ? modelTitle(model) : "";
};

// isActive:false — «скрыто из выбора» только у справочников; у компании,
// пользователя и помещения его правила прежние
const HIDES_INACTIVE = new Set(["Vendor", "Supplier", "DeviceType", "DeviceAttribute"]);

// Имя модели Mongoose -> { model, select, name? } (без name — поле name)
const LOADERS = {
  ClientDevice: { model: ClientDevice, select: "inventoryNumber serialNumber deviceModelId deviceTypeId", name: deviceName },
  DeviceModel: { model: DeviceModel, select: "name vendorId", name: modelTitle },
  DeviceType: { model: DeviceType, select: "name" },
  DeviceConfiguration: { model: DeviceConfiguration, select: "name deviceModelId", name: configName },
  DeviceBuild: { model: DeviceBuild, select: "name" },
  DeviceAttribute: { model: DeviceAttribute, select: "name" },
  Vendor: { model: Vendor, select: "name" },
  Supplier: { model: Supplier, select: "name" },
  AttributeGroup: { model: AttributeGroup, select: "name" },
  Location: { model: Location, select: "name" },
  Company: { model: Company, select: "alias fullTitle", name: (c) => c.alias || c.fullTitle },
  User: {
    model: User,
    // Почту в текст не берём: тексты уходят агенту и в Telegram
    select: "firstName lastName",
    name: (u) => [u.lastName, u.firstName].filter(Boolean).join(" ") || "пользователь без имени",
  },
};

const describe = async (modelName, id) => {
  const loader = LOADERS[modelName];
  if (!loader || !mongoose.isValidObjectId(id)) return null;
  const doc = await loader.model
    .findById(id)
    .select(`${loader.select} updatedAt deletedAt isActive`)
    .lean();
  if (!doc) return null;
  const name = loader.name ? await loader.name(doc) : doc.name;
  const hidden = Boolean(doc.deletedAt) || (doc.isActive === false && HIDES_INACTIVE.has(modelName));
  // deleted — причина «скрыто» именно удаление: kit называет её своим словом
  return {
    name: name || "без названия",
    updatedAt: doc.updatedAt,
    hidden,
    ...(doc.deletedAt ? { deleted: true } : {}),
  };
};

// Коды атрибутов -> { code: name } (для текста значений конфигурации)
const attributeNames = async (codes) => {
  const attrs = await DeviceAttribute.find({ code: { $in: codes } }).select("code name").lean();
  return Object.fromEntries(attrs.map((attr) => [attr.code, attr.name]));
};

// Живые детали хоста (как их видит каскад deviceOps.liveComponents) -> [id]
const liveParts = async (hostId) => {
  if (!mongoose.isValidObjectId(hostId)) return [];
  const parts = await ClientDevice.find({ parentDeviceId: hostId, deletedAt: null }).select("_id").lean();
  return parts.map((part) => String(part._id));
};

module.exports = { describe, attributeNames, liveParts };
