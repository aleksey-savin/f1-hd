const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const { AppError } = require("@/middleware/errorHandling");
const { uniqueAttributeCode } = require("@/services/attributeCode");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const ClientDevice = require("@/models/inventory/clientDevice");
const { scopeChangeError } = require("@/services/inventory/attributeScope");
const { systemAttributeChangeError } = require("@/services/inventory/systemDeviceAttributes");

// Сколько значений держит атрибут на каждом уровне: форма атрибута по нему
// запирает выбор уровня, update — отказывает в смене.
const valuesInUse = async (attributeId) => {
  const [configValues, deviceValues] = await Promise.all([
    DeviceConfiguration.countDocuments({ "values.attributeId": attributeId }),
    ClientDevice.countDocuments({ "attributes.attributeId": attributeId }),
  ]);
  return { configValues, deviceValues };
};

exports.getAll = async (req, res, next) => {
  try {
    const deviceAttributes = await DeviceAttribute.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ label: 1 });

    res.status(200).json(deviceAttributes);
  } catch (error) {
    next(new AppError("Failed to fetch device attributes", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceAttribute = await DeviceAttribute.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!deviceAttribute) {
      return next(
        new AppError(
          `Device attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }
    res.status(200).json({
      ...deviceAttribute.toObject(),
      inUse: await valuesInUse(deviceAttribute._id),
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { name, valueType, unit, options, isActive, scope } = req.body;

    // Наименование уникально и по смыслу, и по устаревшему индексу name_1 на
    // старых базах; код занятым быть не может — подбирается свободный.
    if (await DeviceAttribute.exists({ name })) {
      return next(
        new AppError(`Атрибут «${name}» уже есть`, 409),
      );
    }
    const code =
      req.body.code && !(await DeviceAttribute.exists({ code: req.body.code }))
        ? req.body.code
        : await uniqueAttributeCode(DeviceAttribute, name);

    const deviceAttribute = new DeviceAttribute({
      code,
      name,
      valueType,
      scope,
      unit,
      options,
      isActive,
      createdBy: req.userId,
    });

    await deviceAttribute.save();

    const populatedDeviceAttribute = await DeviceAttribute.findById(
      deviceAttribute._id,
    )
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    res.status(201).json({
      message: "Device attribute added successfully",
      deviceAttribute: populatedDeviceAttribute,
    });
  } catch (error) {
    next(new AppError("Failed to add device attribute", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { name, valueType, unit, options, isActive, scope } = req.body;

    const deviceAttribute = await DeviceAttribute.findById(req.params.id);
    if (!deviceAttribute) {
      return next(
        new AppError(
          `Device attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    // IP, MAC, ОС: на них завязаны Mikrotik, агент и проверка формата
    const system = systemAttributeChangeError(deviceAttribute, { scope, code: req.body.code, valueType });
    if (system) return next(new AppError(system, 409));

    // Уровень не шлют — прежний; смена при значениях на прежнем уровне — 409
    if (scope && scope !== deviceAttribute.scope) {
      const blocked = scopeChangeError(
        deviceAttribute,
        scope,
        await valuesInUse(deviceAttribute._id),
      );
      if (blocked) return next(new AppError(blocked, 409));
      deviceAttribute.scope = scope;
    }

    // Форма кода не шлёт — тогда он прежний; явный код (API) меняет его
    const code = req.body.code || deviceAttribute.code;

    // Check if name or code is being changed and if new name/code already exists
    if (name !== deviceAttribute.name || code !== deviceAttribute.code) {
      const duplicateExists = await DeviceAttribute.findOne({
        $or: [{ name }, { code }],
        _id: { $ne: req.params.id },
      });
      if (duplicateExists) {
        return next(
          new AppError(
            `Device attribute with name "${name}" or code "${code}" already exists`,
            409,
          ),
        );
      }
    }

    deviceAttribute.code = code;
    deviceAttribute.name = name;
    deviceAttribute.valueType = valueType;
    deviceAttribute.unit = unit;
    deviceAttribute.options = options;
    deviceAttribute.isActive = isActive;
    deviceAttribute.updatedBy = req.userId;

    await deviceAttribute.save();

    const populatedDeviceAttribute = await DeviceAttribute.findById(
      deviceAttribute._id,
    )
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    res.status(200).json({
      message: "Device attribute updated successfully",
      deviceAttribute: populatedDeviceAttribute,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// PUT /device-attributes/:id/device-types — body: { deviceTypeIds }.
// Обратная сторона привязки: с карточки типа связки правятся по одной, а из
// списка атрибутов — набором сразу. Синхронизируем: недостающие связки
// создаются в конец списка атрибутов своего типа, лишние удаляются. Порядок и
// флаги (required/extendable) уцелевших связок не трогаем — они живут на
// карточке типа, и переприсвоение затёрло бы их набором из этого диалога.
exports.setDeviceTypes = async (req, res, next) => {
  try {
    const attribute = await DeviceAttribute.findById(req.params.id);
    if (!attribute) {
      return next(
        new AppError(
          `Device attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    const wanted = [
      ...new Set((req.body.deviceTypeIds || []).map((id) => String(id))),
    ];

    // Несуществующий тип в наборе — это рассинхрон каталога у клиента, а не
    // «просто пропустим»: молча привязать к остальным значит соврать о том,
    // что сохранилось.
    const found = await DeviceType.find({ _id: { $in: wanted } }).select("_id");
    if (found.length !== wanted.length) {
      return next(
        new AppError("Среди выбранных типов есть несуществующий", 404),
      );
    }

    const links = await DeviceTypeAttribute.find({
      attributeId: attribute._id,
    }).select("deviceTypeId");
    const current = new Set(links.map((link) => String(link.deviceTypeId)));
    const wantedSet = new Set(wanted);

    const toAdd = wanted.filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !wantedSet.has(id));

    if (toRemove.length > 0) {
      await DeviceTypeAttribute.deleteMany({
        attributeId: attribute._id,
        deviceTypeId: { $in: toRemove },
      });
    }

    // Порядок — следом за последним атрибутом СВОЕГО типа (как в add связки),
    // поэтому позиция считается по каждому типу отдельно.
    for (const deviceTypeId of toAdd) {
      const last = await DeviceTypeAttribute.findOne({ deviceTypeId }).sort({
        order: -1,
      });
      await DeviceTypeAttribute.create({
        deviceTypeId,
        attributeId: attribute._id,
        order: last ? (last.order || 0) + 1 : 0,
        createdBy: req.userId,
      });
    }

    res.status(200).json({
      message: "Привязка к типам обновлена",
      deviceTypeIds: wanted,
      added: toAdd.length,
      removed: toRemove.length,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to set device types for attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const deviceAttribute = await DeviceAttribute.findById(req.params.id);

    if (!deviceAttribute) {
      return next(
        new AppError(
          `Device attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    const system = systemAttributeChangeError(deviceAttribute, null);
    if (system) return next(new AppError(system, 409));

    // TODO: Check if attribute is used in any device types or device models
    // For now, allow deletion

    await DeviceAttribute.deleteOne({ _id: req.params.id });
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
