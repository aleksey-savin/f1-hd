const ClientDevice = require("@/models/inventory/clientDevice");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const AttributeGroup = require("@/models/inventory/attributeGroup");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const DeviceBuild = require("@/models/inventory/deviceBuild");
const Vendor = require("@/models/inventory/vendor");
const Supplier = require("@/models/inventory/supplier");
const Location = require("@/models/inventory/location");
const Company = require("@/models/company");
const User = require("@/models/user");
const mongoose = require("mongoose");
const { loadKeySpecs } = require("@/services/inventory/assemblyKeySpecs");

/**
 * Чтение инвентаря для MCP-инструментов. Единственное место с доступом к
 * Mongoose: всё отдаётся плоскими lean-объектами с id «как хранятся», без
 * populate — инструменты склеивают данные через Map, поэтому тесты обходятся
 * фейками. Секреты (licenseKey, macAddress, machineId) не выбираются никогда.
 */

const TYPE_FIELDS = "name isActive isComponent isConsumable isPeripheral attachableToTypeIds inventoryPrefix assembly updatedAt";
const ATTRIBUTE_FIELDS = "code name valueType unit options isActive";
const LINK_FIELDS = "deviceTypeId attributeId groupId required order";
const MODEL_FIELDS = "name deviceTypeId vendorId compatibleWithModelIds notes updatedAt";
const CONFIG_FIELDS = "name deviceModelId values";
const BUILD_FIELDS = "name deviceTypeId parts notes";

// Секреты намеренно отсутствуют: installedSoftware.licenseKey, macAddress, machineId.
const DEVICE_FIELDS = [
  "configurationId deviceModelId deviceTypeId parentDeviceId buildId quantity",
  "companyId userId locationId supplierId",
  "hostname inventoryNumber serialNumber status",
  "comment notes purchaseDocument",
  "purchasedAt price warrantyExpirationDate deploymentDate retirementDate expectedLifespan",
  "lastMaintenanceDate nextMaintenanceDate maintenanceInterval",
  "ipAddress operatingSystem",
  "installedSoftware.name installedSoftware.version",
  "createdAt updatedAt",
].join(" ");

const ROW_FIELDS =
  "companyId userId locationId deviceModelId deviceTypeId parentDeviceId buildId status serialNumber inventoryNumber purchasedAt deploymentDate warrantyExpirationDate expectedLifespan nextMaintenanceDate updatedAt createdAt";

const alive = (filter = {}) => ({ ...filter, deletedAt: null });

/** Тип устройства: из модели, если она есть, иначе собственный (getEffectiveTypeId). */
const deviceTypeId = (device, modelsById) => {
  const modelId = device.deviceModelId;
  if (modelId) {
    const model = modelsById.get(String(modelId._id ?? modelId));
    if (model?.deviceTypeId) return String(model.deviceTypeId._id ?? model.deviceTypeId);
  }
  return device.deviceTypeId ? String(device.deviceTypeId._id ?? device.deviceTypeId) : null;
};

const loadCatalog = async () => {
  const [types, attributes, links, groups, vendors, suppliers] = await Promise.all([
    DeviceType.find({}).select(TYPE_FIELDS).lean(),
    DeviceAttribute.find({}).select(ATTRIBUTE_FIELDS).lean(),
    DeviceTypeAttribute.find({}).select(LINK_FIELDS).lean(),
    AttributeGroup.find({}).select("name order").lean(),
    Vendor.find({}).select("name isActive").lean(),
    Supplier.find({}).select("name isActive").lean(),
  ]);
  return { types, attributes, links, groups, vendors, suppliers };
};

const loadModels = (filter = {}) => DeviceModel.find(alive(filter)).select(MODEL_FIELDS).lean();

const loadConfigurations = (modelIds) =>
  DeviceConfiguration.find(alive(modelIds ? { deviceModelId: { $in: modelIds } } : {}))
    .select(CONFIG_FIELDS)
    .lean();

const loadBuilds = (filter = {}) => DeviceBuild.find(alive(filter)).select(BUILD_FIELDS).lean();

// Контроллер подгружаем лениво: тяжёлый граф зависимостей не нужен чистым хелперам.
const loadKeySpecsFor = (rows) => {
  const { ASSEMBLY_POPULATE } = require("@/controllers/inventory/deviceType");
  const { ASSEMBLY_COMPONENT_SELECT, ASSEMBLY_COMPONENT_POPULATE } = require("@/controllers/inventory/clientDevice");
  return loadKeySpecs(rows, {
    ClientDevice,
    DeviceType,
    assemblyPopulate: ASSEMBLY_POPULATE,
    componentPopulate: ASSEMBLY_COMPONENT_POPULATE,
    componentSelect: `${ASSEMBLY_COMPONENT_SELECT} parentDeviceId`,
    // Агент видит всё (как сотрудник); удалённые детали не считаются.
    componentsFilter: (hostIds) => alive({ parentDeviceId: hostIds }),
  });
};

const countBy = async (field) => {
  const grouped = await ClientDevice.aggregate([
    { $match: { deletedAt: null, [field]: { $ne: null } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]);
  return new Map(grouped.map((g) => [String(g._id), g.n]));
};
const countDevicesByModel = () => countBy("deviceModelId");
const countDevicesByConfiguration = () => countBy("configurationId");

const findDevices = (filter, { sort = { updatedAt: -1 }, skip = 0, limit = 50 } = {}) =>
  ClientDevice.find(alive(filter)).select(DEVICE_FIELDS).sort(sort).skip(skip).limit(limit).lean();

const countDevices = (filter) => ClientDevice.countDocuments(alive(filter));

// Битый id — это «не найдено», а не CastError.
const loadDevice = (id) => !mongoose.Types.ObjectId.isValid(id) ? Promise.resolve(null) : ClientDevice.findOne(alive({ _id: id })).select(DEVICE_FIELDS).lean();

const loadComponents = (hostIds) =>
  ClientDevice.find(alive({ parentDeviceId: { $in: hostIds } })).select(DEVICE_FIELDS).lean();

const loadAssemblyIds = async () => {
  const ids = await ClientDevice.distinct("parentDeviceId", alive({ parentDeviceId: { $ne: null } }));
  return new Set(ids.map(String));
};

const loadDirectory = async () => {
  const [companies, users, locations] = await Promise.all([
    Company.find({}).select("alias fullTitle").lean(),
    User.find({}).select("firstName lastName position company._id").lean(),
    Location.find({}).select("name type parent company").lean(),
  ]);
  return { companies, users, locations };
};

// Связь приблизительная: заявки по relatedClientDeviceId + заявки человека,
// за которым числится устройство (только корневые), как в ticketSource.loadTicketDetail.
const ticketLinkFilter = (devices, { from, systemUserIds = [] } = {}) => {
  const or = [];
  const deviceIds = devices.map((d) => d._id);
  if (deviceIds.length) or.push({ relatedClientDeviceId: { $in: deviceIds } });
  // Служебные учётки (анонимный заявитель, роботы) — не владелец устройства.
  const system = new Set(systemUserIds.map(String));
  const userIds = [
    ...new Set(devices.filter((d) => d.userId && !d.parentDeviceId && !system.has(String(d.userId))).map((d) => String(d.userId))),
  ];
  if (userIds.length) or.push({ applicantId: { $in: userIds } });
  if (!or.length) return null;
  const filter = { $or: or };
  if (from) filter.createdAt = { $gte: from };
  return filter;
};

const loadTicketsForDevices = async (devices, options = {}) => {
  const filter = ticketLinkFilter(devices, options);
  if (!filter) return [];
  // Ленивый require: модель заявок на импорте запускает initCounter (ждёт БД).
  const { Ticket } = require("@/models/ticket");
  const query = Ticket.find(filter)
    .select("num title isClosed createdAt applicantId relatedClientDeviceId")
    .sort({ createdAt: -1 });
  return (options.limit ? query.limit(options.limit) : query).lean();
};

const countTicketsForDevices = async (devices, options = {}) => {
  const filter = ticketLinkFilter(devices, options);
  if (!filter) return 0;
  const { Ticket } = require("@/models/ticket");
  return Ticket.countDocuments(filter);
};

const deviceRows = (filter = {}) => ClientDevice.find(alive(filter)).select(ROW_FIELDS).lean();

module.exports = {
  DEVICE_FIELDS,
  deviceTypeId,
  loadCatalog,
  loadModels,
  loadConfigurations,
  loadBuilds,
  loadKeySpecsFor,
  countDevicesByModel,
  countDevicesByConfiguration,
  findDevices,
  countDevices,
  loadDevice,
  loadComponents,
  loadAssemblyIds,
  loadDirectory,
  ticketLinkFilter,
  loadTicketsForDevices,
  countTicketsForDevices,
  deviceRows,
};
