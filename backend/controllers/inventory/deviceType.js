const DeviceType = require("@/models/inventory/deviceType");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceBuild = require("@/models/inventory/deviceBuild");
// Регистрирует модель для populate keySpecs.attributeId.
require("@/models/inventory/deviceAttribute");
const mongoose = require("mongoose");
const { AppError } = require("@/middleware/errorHandling");
const {
  SEVERAL_KINDS_MESSAGE,
  hasSeveralKinds,
} = require("@/services/inventory/typeKind");

const AGGREGATES = ["first", "sum", "list"];

// «N сборка/сборки/сборок» с правильным склонением.
function buildsWord(n) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  let word = "сборок";
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = "сборка";
    else if (mod10 >= 2 && mod10 <= 4) word = "сборки";
  }
  return `${n} ${word}`;
}

// Разбор слотов и ключевых характеристик «Своей сборки». Чистая функция:
// всё, что нужно из БД, приходит в ctx (множества/карты строковых id).
//  - componentTypeIds: id типов-комплектующих;
//  - attributeIdsByType: тип → id атрибутов, связанных с ним;
//  - valueTypeById: id атрибута → valueType;
//  - deviceAttributeIds: id атрибутов уровня устройства (их значение у
//    экземпляра, не у модели — ключевой характеристикой сборки быть не могут).
function parseAssembly(body, ctx) {
  const {
    componentTypeIds,
    attributeIdsByType,
    valueTypeById,
    deviceAttributeIds = new Set(),
  } = ctx;
  const rawSlots = body?.slots;
  const rawKeySpecs = body?.keySpecs;
  if (!Array.isArray(rawSlots) || !Array.isArray(rawKeySpecs)) {
    return { error: "slots и keySpecs должны быть массивами" };
  }

  const slots = [];
  const slotTypes = new Set();
  for (const item of rawSlots) {
    const typeId = String(item?.typeId ?? "");
    if (!componentTypeIds.has(typeId)) {
      return { error: "В слот можно поставить только тип-комплектующую" };
    }
    if (slotTypes.has(typeId)) {
      return { error: "Один слот на тип: тип повторяется" };
    }
    slotTypes.add(typeId);
    slots.push({
      typeId,
      required: item.required === true,
      multiple: item.multiple === true,
    });
  }

  const keySpecs = [];
  for (const item of rawKeySpecs) {
    const typeId = String(item?.typeId ?? "");
    if (!slotTypes.has(typeId)) {
      return { error: "Ключевая характеристика: тип должен быть среди слотов" };
    }
    if (!AGGREGATES.includes(item.aggregate)) {
      return { error: "Ключевая характеристика: неверный способ сведения" };
    }
    if (item.source === "model") {
      keySpecs.push({
        typeId,
        source: "model",
        attributeId: null,
        aggregate: item.aggregate,
      });
    } else if (item.source === "attribute") {
      const attributeId = String(item.attributeId ?? "");
      if (deviceAttributeIds.has(attributeId)) {
        return {
          error: "Ключевая характеристика не может быть атрибутом устройства",
        };
      }
      if (!attributeIdsByType.get(typeId)?.has(attributeId)) {
        return {
          error: "Ключевая характеристика: атрибут не привязан к типу слота",
        };
      }
      if (item.aggregate === "sum" && valueTypeById.get(attributeId) !== "number") {
        return { error: "Сумма возможна только по числовому атрибуту" };
      }
      keySpecs.push({
        typeId,
        source: "attribute",
        attributeId,
        aggregate: item.aggregate,
      });
    } else {
      return { error: "Ключевая характеристика: неверный источник" };
    }
  }

  return { slots, keySpecs };
}

// Populate состава «Своей сборки» — общий для карточки типа и сборок.
const ASSEMBLY_POPULATE = [
  { path: "assembly.slots.typeId", select: "name" },
  { path: "assembly.keySpecs.typeId", select: "name" },
  { path: "assembly.keySpecs.attributeId", select: "name unit valueType" },
];

exports.parseAssembly = parseAssembly;
exports.ASSEMBLY_POPULATE = ASSEMBLY_POPULATE;
exports.buildsWord = buildsWord;

exports.getAll = async (req, res, next) => {
  try {
    const deviceTypes = await DeviceType.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 });

    // Актуальные связи тип↔атрибут живут в коллекции DeviceTypeAttribute
    // (как в getOne) — прикладываем их к каждому типу одним запросом.
    // Иначе в ответ утекает легаси-поле attributes из старых документов
    // (формат isRequired/displayOrder), и счётчик в списке врёт.
    const links = await DeviceTypeAttribute.find({}).select(
      "deviceTypeId attributeId required extendable order",
    );
    const linksByType = new Map();
    for (const link of links) {
      const key = String(link.deviceTypeId);
      if (!linksByType.has(key)) {
        linksByType.set(key, []);
      }
      linksByType.get(key).push({
        attributeId: link.attributeId,
        required: link.required,
        extendable: link.extendable,
        order: link.order,
      });
    }

    res.status(200).json(
      deviceTypes.map((deviceType) => ({
        ...deviceType.toObject(),
        attributes: linksByType.get(String(deviceType._id)) ?? [],
      })),
    );
  } catch (error) {
    next(new AppError("Failed to fetch device types", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceType = await DeviceType.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .populate("attachableToTypeIds", "name")
      .populate(ASSEMBLY_POPULATE);

    if (!deviceType) {
      return next(
        new AppError(`Device type with id ${req.params.id} not found`, 404),
      );
    }

    // Fetch device type attributes
    const deviceTypeAttributes = await DeviceTypeAttribute.find({
      deviceTypeId: req.params.id,
    })
      .populate("attributeId", "code name valueType unit options isActive scope")
      .populate("groupId", "name order")
      .sort({ order: 1, createdAt: 1 });

    const buildsCount = await DeviceBuild.countDocuments({
      deviceTypeId: req.params.id,
      deletedAt: null,
    });

    const deviceTypeWithAttributes = {
      ...deviceType.toObject(),
      attributes: deviceTypeAttributes,
      buildsCount,
    };

    res.status(200).json(deviceTypeWithAttributes);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device type ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const {
      name,
      isActive,
      isComponent,
      isConsumable,
      isPeripheral,
      inventoryPrefix,
      attachableToTypeIds,
    } = req.body;

    if (hasSeveralKinds({ isComponent, isConsumable, isPeripheral })) {
      return next(new AppError(SEVERAL_KINDS_MESSAGE, 400));
    }

    const deviceTypeExists = await DeviceType.findOne({ name });
    if (deviceTypeExists) {
      return next(
        new AppError(`Device type with name "${name}" already exists`, 409),
      );
    }

    const deviceType = new DeviceType({
      name,
      isActive,
      isComponent,
      isConsumable,
      isPeripheral,
      inventoryPrefix,
      attachableToTypeIds,
      createdBy: req.userId,
    });

    await deviceType.save();

    // Атрибуты типа добавляются отдельно, с карточки типа (см.
    // controllers/inventory/deviceTypeAttribute.js) — здесь их не трогаем.

    res.status(201).json({
      message: "Тип устройства успешно добавлен",
      deviceType: deviceType,
    });
  } catch (error) {
    next(new AppError("Failed to add device type", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const {
      name,
      isActive,
      isComponent,
      isConsumable,
      isPeripheral,
      inventoryPrefix,
      attachableToTypeIds,
      assemblyEnabled,
    } = req.body;

    if (hasSeveralKinds({ isComponent, isConsumable, isPeripheral })) {
      return next(new AppError(SEVERAL_KINDS_MESSAGE, 400));
    }

    const deviceType = await DeviceType.findById(req.params.id);
    if (!deviceType) {
      return next(
        new AppError(`Device type with id ${req.params.id} not found`, 404),
      );
    }

    // Check if name is being changed and if new name already exists
    if (name !== deviceType.name) {
      const nameExists = await DeviceType.findOne({
        name,
        _id: { $ne: req.params.id },
      });
      if (nameExists) {
        return next(
          new AppError(`Device type with name "${name}" already exists`, 409),
        );
      }
    }

    deviceType.name = name;
    deviceType.isActive = isActive;
    deviceType.isComponent = isComponent;
    deviceType.isConsumable = isConsumable;
    deviceType.isPeripheral = isPeripheral;
    deviceType.inventoryPrefix = inventoryPrefix;
    deviceType.attachableToTypeIds = attachableToTypeIds;
    // undefined — не трогать (старые клиенты формы флага не шлют).
    if (typeof assemblyEnabled === "boolean") {
      if (!assemblyEnabled && deviceType.assembly?.enabled) {
        const buildsCount = await DeviceBuild.countDocuments({
          deviceTypeId: deviceType._id,
          deletedAt: null,
        });
        if (buildsCount > 0) {
          return next(
            new AppError(
              `Нельзя выключить: у типа ${buildsWord(buildsCount)}`,
              409,
            ),
          );
        }
      }
      deviceType.set("assembly.enabled", assemblyEnabled);
    }
    deviceType.updatedBy = req.userId;

    await deviceType.save();

    // Атрибуты типа правятся отдельными формами с карточки (см.
    // controllers/inventory/deviceTypeAttribute.js) — основной update их не
    // трогает, иначе форма без атрибутов затирала бы их.

    res.status(200).json({
      message: "Тип устройства успешно обновлен",
      deviceType: deviceType,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device type ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Слоты и ключевые характеристики «Своей сборки» целиком.
exports.updateAssembly = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return next(new AppError("Некорректный id типа", 400));
    }
    const deviceType = await DeviceType.findById(id);
    if (!deviceType) {
      return next(new AppError(`Device type with id ${id} not found`, 404));
    }

    const slotIds = (Array.isArray(req.body?.slots) ? req.body.slots : [])
      .map((s) => s?.typeId)
      .filter((v) => mongoose.isValidObjectId(v));
    const components = await DeviceType.find({
      _id: { $in: slotIds },
      isComponent: true,
    }).select("_id");
    const componentTypeIds = new Set(components.map((t) => String(t._id)));

    const links = await DeviceTypeAttribute.find({
      deviceTypeId: { $in: [...componentTypeIds] },
    })
      .populate("attributeId", "valueType scope")
      .select("deviceTypeId attributeId");
    const attributeIdsByType = new Map();
    const valueTypeById = new Map();
    const deviceAttributeIds = new Set();
    for (const link of links) {
      if (!link.attributeId) continue;
      const typeKey = String(link.deviceTypeId);
      const attrKey = String(link.attributeId._id);
      if (!attributeIdsByType.has(typeKey)) {
        attributeIdsByType.set(typeKey, new Set());
      }
      attributeIdsByType.get(typeKey).add(attrKey);
      valueTypeById.set(attrKey, link.attributeId.valueType);
      if (link.attributeId.scope === "device") deviceAttributeIds.add(attrKey);
    }

    const parsed = parseAssembly(req.body, {
      componentTypeIds,
      attributeIdsByType,
      valueTypeById,
      deviceAttributeIds,
    });
    if (parsed.error) {
      return next(new AppError(parsed.error, 400));
    }

    deviceType.set("assembly.slots", parsed.slots);
    deviceType.set("assembly.keySpecs", parsed.keySpecs);
    deviceType.updatedBy = req.userId;
    await deviceType.save();

    await deviceType.populate(ASSEMBLY_POPULATE);
    res.status(200).json(deviceType);
  } catch (error) {
    next(
      new AppError(
        `Failed to update assembly of device type ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const deviceType = await DeviceType.findById(req.params.id);
    if (deviceType) {
      // Не осиротить модели: тип нельзя удалить, пока на него ссылаются модели
      const models = await DeviceModel.find({
        deviceTypeId: req.params.id,
        deletedAt: null,
      });
      if (models.length > 0) {
        return next(
          new AppError(
            `Тип используется ${models.length} модел${models.length === 1 ? "ью" : "ями"} — сначала удалите или перенесите их`,
            409,
          ),
        );
      }

      // Не осиротить «Свою сборку»: слот/ключевая характеристика другого
      // типа без своего типа роняет карточку сборки.
      const host = await DeviceType.findOne({
        _id: { $ne: deviceType._id },
        $or: [
          { "assembly.slots.typeId": deviceType._id },
          { "assembly.keySpecs.typeId": deviceType._id },
        ],
      })
        .select("name")
        .lean();
      if (host) {
        return next(
          new AppError(`Тип используется в своей сборке «${host.name}»`, 409),
        );
      }
      const buildsCount = await DeviceBuild.countDocuments({
        deviceTypeId: deviceType._id,
        deletedAt: null,
      });
      if (buildsCount > 0) {
        return next(new AppError("У типа есть сборки", 409));
      }

      // Delete associated device type attributes
      await DeviceTypeAttribute.deleteMany({ deviceTypeId: req.params.id });

      await DeviceType.deleteOne({ _id: req.params.id });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Device type with id ${req.params.id} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device type ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
