const mongoose = require("mongoose");
const DeviceBuild = require("@/models/inventory/deviceBuild");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
// Регистрируют модели для populate (вендор, атрибуты значений).
require("@/models/inventory/vendor");
require("@/models/inventory/deviceAttribute");
const { AppError } = require("@/middleware/errorHandling");
const { ASSEMBLY_POPULATE } = require("./deviceType");

const PARTS_POPULATE = [
  {
    path: "parts.deviceModelId",
    select: "name vendorId deviceTypeId deletedAt",
    populate: { path: "vendorId", select: "name" },
  },
  {
    path: "parts.configurationId",
    select: "name values deletedAt",
    populate: {
      path: "values.attributeId",
      select: "code name unit valueType options",
    },
  },
  { path: "parts.typeId", select: "name" },
];

exports.PARTS_POPULATE = PARTS_POPULATE;

// Разбор деталей сборки. Чистая функция: slots — слоты типа
// ({typeId, required, multiple, typeName}). Порядок результата — порядок
// слотов, внутри слота — как прислано. Существование моделей/конфигураций
// проверяют обработчики.
function parseBuildParts(parts, slots) {
  if (!Array.isArray(parts)) {
    return { error: "parts должен быть массивом" };
  }

  const slotByType = new Map(slots.map((s) => [String(s.typeId), s]));
  const byType = new Map();

  for (const item of parts) {
    const typeId = String(item?.typeId ?? "");
    const slot = slotByType.get(typeId);
    if (!slot) {
      return { error: "Деталь не соответствует слотам типа" };
    }
    const deviceModelId = String(item?.deviceModelId ?? "");
    if (!mongoose.isValidObjectId(deviceModelId)) {
      return { error: `Не выбрана модель для слота «${slot.typeName}»` };
    }
    const rawQuantity = item?.quantity ?? 1;
    if (!Number.isInteger(rawQuantity) || rawQuantity < 1) {
      return {
        error: `Количество в слоте «${slot.typeName}» — целое число от 1`,
      };
    }
    if (!slot.multiple && rawQuantity !== 1) {
      return { error: `В слот «${slot.typeName}» — только одна деталь` };
    }
    const list = byType.get(typeId) || [];
    if (!slot.multiple && list.length > 0) {
      return { error: `В слот «${slot.typeName}» — только одна деталь` };
    }
    const configurationId = item?.configurationId
      ? String(item.configurationId)
      : null;
    if (configurationId && !mongoose.isValidObjectId(configurationId)) {
      return { error: `Неверная конфигурация в слоте «${slot.typeName}»` };
    }
    list.push({
      typeId,
      deviceModelId,
      configurationId,
      quantity: rawQuantity,
    });
    byType.set(typeId, list);
  }

  const missing = slots
    .filter((s) => s.required && !byType.has(String(s.typeId)))
    .map((s) => s.typeName);
  if (missing.length > 0) {
    return { error: `Не заполнено: ${missing.join(", ")}` };
  }

  const ordered = [];
  for (const slot of slots) {
    ordered.push(...(byType.get(String(slot.typeId)) || []));
  }
  return { parts: ordered };
}

exports.parseBuildParts = parseBuildParts;

// Конфигурация детали. Чистая функция: model — {name, vendorId?: {name}},
// modelConfigs — неудалённые конфигурации модели. Прислана — должна быть
// своей; не прислана — единственная подставляется сама, из нескольких
// выбирать обязательно (иначе у детали нет характеристик).
function resolvePartConfiguration(model, modelConfigs, configurationId) {
  const title = [model.vendorId?.name, model.name].filter(Boolean).join(" ");
  if (configurationId) {
    if (!modelConfigs.some((c) => String(c._id) === String(configurationId))) {
      return { error: `Конфигурация не принадлежит модели «${title}»` };
    }
    return { configurationId: String(configurationId) };
  }
  if (modelConfigs.length === 1) {
    return { configurationId: String(modelConfigs[0]._id) };
  }
  if (modelConfigs.length > 1) {
    return { error: `Выберите конфигурацию модели «${title}»` };
  }
  return { configurationId: null };
}

exports.resolvePartConfiguration = resolvePartConfiguration;

// Тип должен существовать и собираться из комплектующих; слоты — с именами.
async function loadAssemblyType(deviceTypeId) {
  if (!mongoose.isValidObjectId(deviceTypeId)) {
    return { error: new AppError("Не указан тип устройства", 400) };
  }
  const deviceType = await DeviceType.findById(deviceTypeId)
    .populate("assembly.slots.typeId", "name")
    .lean();
  if (!deviceType) {
    return { error: new AppError("Тип устройства не найден", 404) };
  }
  if (!deviceType.assembly?.enabled) {
    return {
      error: new AppError(
        `Тип «${deviceType.name}» не собирается из комплектующих`,
        400,
      ),
    };
  }
  const slots = (deviceType.assembly.slots || []).map((s) => ({
    typeId: String(s.typeId?._id ?? s.typeId),
    typeName: s.typeId?.name ?? "—",
    required: !!s.required,
    multiple: !!s.multiple,
  }));
  return { deviceType, slots };
}

exports.loadAssemblyType = loadAssemblyType;

// Связки типов деталей с группами — по ним карточка раскладывает значения
// конфигураций (как specLinks устройства). Ключ — id типа детали; общая для
// карточки сборки и карточки ПК своей сборки.
async function loadPartLinks(rawTypeIds) {
  const typeIds = [...new Set(rawTypeIds.filter(Boolean).map(String))];
  const links = typeIds.length
    ? await DeviceTypeAttribute.find({ deviceTypeId: { $in: typeIds } })
        .populate("attributeId", "code name valueType unit options isActive")
        .populate("groupId", "name order")
        .select("deviceTypeId attributeId groupId order createdAt")
        .sort({ order: 1, createdAt: 1 })
        .lean()
    : [];
  const partLinks = Object.fromEntries(typeIds.map((id) => [id, []]));
  for (const link of links) {
    partLinks[String(link.deviceTypeId)]?.push(link);
  }
  return partLinks;
}

exports.loadPartLinks = loadPartLinks;

// Проверка ссылок деталей и конфигураций (resolvePartConfiguration).
// Возвращает { parts } | { error: AppError }; прочие поля детали сохраняются.
async function resolveParts(parsedParts) {
  const modelIds = [...new Set(parsedParts.map((p) => p.deviceModelId))];
  const models = await DeviceModel.find({
    _id: { $in: modelIds },
    deletedAt: null,
  })
    .select("name deviceTypeId vendorId")
    .populate("vendorId", "name")
    .lean();
  const modelById = new Map(models.map((m) => [String(m._id), m]));

  const configs = await DeviceConfiguration.find({
    deviceModelId: { $in: modelIds },
    deletedAt: null,
  })
    .select("name deviceModelId")
    .lean();
  const configsByModel = new Map();
  for (const c of configs) {
    const key = String(c.deviceModelId);
    configsByModel.set(key, [...(configsByModel.get(key) || []), c]);
  }

  const typeNames = new Map(
    (
      await DeviceType.find({
        _id: { $in: [...new Set(parsedParts.map((p) => p.typeId))] },
      })
        .select("name")
        .lean()
    ).map((t) => [String(t._id), t.name]),
  );

  const result = [];
  for (const part of parsedParts) {
    const model = modelById.get(part.deviceModelId);
    if (!model) {
      return {
        error: new AppError(
          `Модель в слоте «${typeNames.get(part.typeId) ?? "—"}» не найдена или удалена`,
          400,
        ),
      };
    }
    if (String(model.deviceTypeId) !== part.typeId) {
      return {
        error: new AppError(
          `Модель «${model.name}» не относится к типу «${typeNames.get(part.typeId) ?? "—"}»`,
          400,
        ),
      };
    }
    const config = resolvePartConfiguration(
      model,
      configsByModel.get(part.deviceModelId) || [],
      part.configurationId,
    );
    if (config.error) return { error: new AppError(config.error, 400) };
    result.push({ ...part, configurationId: config.configurationId });
  }
  return { parts: result };
}

exports.resolveParts = resolveParts;

// Общая часть add/update: имя, заметки и детали → поля документа.
async function buildFields(body, slots) {
  const name = String(body?.name ?? "").trim();
  if (!name) return { error: new AppError("Укажите название сборки", 400) };
  const parsed = parseBuildParts(body?.parts, slots);
  if (parsed.error) return { error: new AppError(parsed.error, 400) };
  const resolved = await resolveParts(parsed.parts);
  if (resolved.error) return { error: resolved.error };
  const notes = body?.notes ? String(body.notes).trim() : undefined;
  return { name, notes, parts: resolved.parts };
}

exports.buildFields = buildFields;

exports.getAll = async (req, res, next) => {
  try {
    const { deviceTypeId } = req.query;
    const filter = { deletedAt: null };
    if (deviceTypeId) {
      if (!mongoose.isValidObjectId(deviceTypeId)) {
        return next(new AppError("Неверный тип устройства", 400));
      }
      filter.deviceTypeId = deviceTypeId;
    }
    const builds = await DeviceBuild.find(filter)
      .select("name notes parts updatedAt")
      .populate(PARTS_POPULATE)
      .sort({ name: 1 })
      .lean();
    res.status(200).json(builds);
  } catch (error) {
    next(new AppError("Failed to fetch device builds", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError("Сборка не найдена", 404));
    }
    const build = await DeviceBuild.findOne({
      _id: req.params.id,
      deletedAt: null,
    })
      .populate(PARTS_POPULATE)
      .lean();
    if (!build) {
      return next(new AppError("Сборка не найдена", 404));
    }

    const deviceType = await DeviceType.findById(build.deviceTypeId)
      .select("name assembly")
      .populate(ASSEMBLY_POPULATE)
      .lean();

    const partLinks = await loadPartLinks(
      build.parts.map((p) => p.typeId?._id ?? p.typeId),
    );

    res.status(200).json({ build, deviceType, partLinks });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device build ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const loaded = await loadAssemblyType(req.body?.deviceTypeId);
    if (loaded.error) return next(loaded.error);
    if (loaded.slots.length === 0) {
      return next(new AppError("У типа не заданы комплектующие", 400));
    }
    const fields = await buildFields(req.body, loaded.slots);
    if (fields.error) return next(fields.error);

    const build = await DeviceBuild.create({
      ...fields,
      deviceTypeId: loaded.deviceType._id,
      createdBy: req.userId,
      updatedBy: req.userId,
    });
    res.status(201).json(build);
  } catch (error) {
    next(new AppError("Failed to create device build", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError("Сборка не найдена", 404));
    }
    const build = await DeviceBuild.findOne({
      _id: req.params.id,
      deletedAt: null,
    });
    if (!build) {
      return next(new AppError("Сборка не найдена", 404));
    }
    // Тип сборки не меняется — слоты берём у её типа.
    const loaded = await loadAssemblyType(build.deviceTypeId);
    if (loaded.error) return next(loaded.error);
    const fields = await buildFields(req.body, loaded.slots);
    if (fields.error) return next(fields.error);

    build.name = fields.name;
    build.notes = fields.notes;
    build.parts = fields.parts;
    build.updatedBy = req.userId;
    await build.save();
    res.status(200).json(build);
  } catch (error) {
    next(
      new AppError(
        `Failed to update device build ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError("Сборка не найдена", 404));
    }
    const build = await DeviceBuild.findOne({
      _id: req.params.id,
      deletedAt: null,
    });
    if (!build) {
      return next(new AppError("Сборка не найдена", 404));
    }
    build.deletedAt = new Date();
    build.deletedBy = req.userId;
    await build.save();
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device build ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
