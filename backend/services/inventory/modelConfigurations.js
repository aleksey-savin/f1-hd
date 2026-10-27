const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceConfiguration = require("../../models/inventory/deviceConfiguration");

// Конфигурации модели: правила режима «Несколько конфигураций».
//
// У живой модели всегда есть хотя бы одна живая конфигурация — значения
// характеристик хранятся только в ней. Режим выключен (по умолчанию) — она
// одна, правится как свойства модели, и устройство привязывается к ней само.
// Включён — нынешние варианты исполнения с выбором у устройства.
// «Первая» — самая ранняя по createdAt.
//
// Чистые функции решают; async-обёртки только читают базу. Ими пользуются
// контроллеры модели, конфигурации и устройства, операции агента и миграция.

const MULTI_OFF_REFUSED =
  "Чтобы выключить «Несколько конфигураций», оставьте одну конфигурацию";
const ADD_REFUSED =
  "Включите «Несколько конфигураций» в модели, чтобы добавить вторую";
const DELETE_REFUSED = "Последнюю конфигурацию модели удалить нельзя";

/** Единственная конфигурация модели вне режима нескольких; иначе null. */
const soleConfiguration = (model, configs) =>
  !model?.multiConfig && configs.length === 1 ? configs[0] : null;

/** Выключить режим можно, только когда живая конфигурация одна. */
const multiConfigOffError = (liveCount) =>
  liveCount > 1 ? MULTI_OFF_REFUSED : null;

/** Вторую конфигурацию с портала — только в режиме нескольких. */
const configAddError = (model) => (model?.multiConfig ? null : ADD_REFUSED);

/** Последнюю живую конфигурацию не удаляют ни в каком режиме. */
const configDeleteError = (liveCount) =>
  liveCount <= 1 ? DELETE_REFUSED : null;

/**
 * Что делает конфигурация от агента: «fill» — заполнить единственную пустую
 * (модель не в режиме нескольких), «create» — у модели конфигураций нет
 * (модель старше миграции), «add» — добавить ещё одну.
 */
const agentConfigurationMode = (model, configs) => {
  if (configs.length === 0) return "create";
  const sole = soleConfiguration(model, configs);
  if (sole && !(sole.values?.length > 0)) return "fill";
  return "add";
};

/**
 * Значения для первой конфигурации из тела формы модели. Создание пишет их
 * всегда: включили режим, уже заполнив поля, — введённое станет первой
 * конфигурацией. Правка — если поля были видны: модель вне режима нескольких
 * до сохранения (wasMulti) или после него; undefined — не трогать.
 */
const modelWriteFromBody = (body, { creating, multiConfig, wasMulti = false }) => {
  if (creating) return { values: body?.values ?? [] };
  return { values: !wasMulti || !multiConfig ? body?.values : undefined };
};

/**
 * Отказ сохранить модель вне режима нескольких, пока живых конфигураций
 * больше одной — при любом сохранении, не только при выключении (модель
 * старше миграции или конфигурацию перенесли с другой модели).
 */
const modeChangeError = (multiConfig, liveCount) =>
  multiConfig ? null : multiConfigOffError(liveCount);

/**
 * Конфигурация, к которой после сохранения модели привязываются все её
 * устройства: модель вне режима нескольких с единственной конфигурацией.
 */
const relinkDevicesTo = (multiConfig, configs) =>
  soleConfiguration({ multiConfig }, configs);

/** Конфигурация устройства: присланная, иначе единственная модели. */
const configurationForDevice = (given, soleId) => given || soleId || undefined;

/**
 * План миграции (scripts/singleModelConfigurations.js). Вход — живые модели,
 * их живые конфигурации и живые устройства с моделью, но без конфигурации.
 * createFor — моделям без конфигураций создать пустую; multiOn — у моделей с
 * двумя и больше включить режим нескольких; link — устройствам моделей с
 * единственной конфигурацией записать её. Устройства моделей из createFor
 * ждут второго прохода: id новой конфигурации до вставки неизвестен.
 */
const planModelConfigMigration = ({ models, configs, devices }) => {
  const byModel = new Map(models.map((m) => [String(m._id), { model: m, configs: [] }]));
  for (const c of [...configs].sort((a, b) => a.createdAt - b.createdAt)) {
    byModel.get(String(c.deviceModelId))?.configs.push(c);
  }
  const createFor = [];
  const multiOn = [];
  for (const { model, configs: own } of byModel.values()) {
    if (own.length === 0) createFor.push(model._id);
    else if (own.length > 1 && !model.multiConfig) multiOn.push(model._id);
  }
  const link = [];
  for (const device of devices) {
    const entry = byModel.get(String(device.deviceModelId));
    if (!entry || entry.configs.length > 1) continue;
    const sole = soleConfiguration(entry.model, entry.configs);
    if (sole) link.push({ deviceId: device._id, configurationId: sole._id });
  }
  return { createFor, multiOn, link };
};

/** Живые конфигурации модели, первая — самая ранняя (документы). */
const liveConfigurations = (modelId) =>
  DeviceConfiguration.find({ deviceModelId: modelId, deletedAt: null }).sort({
    createdAt: 1,
  });

/** id единственной конфигурации живой модели или null. */
const soleConfigurationId = async (modelId) => {
  const model = await DeviceModel.findOne({ _id: modelId, deletedAt: null })
    .select("multiConfig")
    .lean();
  if (!model) return null;
  const sole = soleConfiguration(model, await liveConfigurations(modelId));
  return sole ? String(sole._id) : null;
};

module.exports = {
  soleConfiguration,
  multiConfigOffError,
  configAddError,
  configDeleteError,
  agentConfigurationMode,
  modelWriteFromBody,
  modeChangeError,
  relinkDevicesTo,
  configurationForDevice,
  planModelConfigMigration,
  liveConfigurations,
  soleConfigurationId,
};
