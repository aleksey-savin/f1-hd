const DeviceType = require("@/models/inventory/deviceType");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const { AppError } = require("@/middleware/errorHandling");

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
      .populate("attachableToTypeIds", "name");

    if (!deviceType) {
      return next(
        new AppError(`Device type with id ${req.params.id} not found`, 404),
      );
    }

    // Fetch device type attributes
    const deviceTypeAttributes = await DeviceTypeAttribute.find({
      deviceTypeId: req.params.id,
    })
      .populate("attributeId", "code name valueType unit options isActive")
      .sort({ order: 1, createdAt: 1 });

    const deviceTypeWithAttributes = {
      ...deviceType.toObject(),
      attributes: deviceTypeAttributes,
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
      attributes,
    } = req.body;

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

    // Save device type attributes if provided
    if (attributes && attributes.length > 0) {
      const attributeDocs = attributes.map((attr, index) => ({
        deviceTypeId: deviceType._id,
        attributeId: attr.attributeId,
        required: attr.required || false,
        extendable: attr.extendable || false,
        order: index,
        createdBy: req.userId,
      }));

      await DeviceTypeAttribute.insertMany(attributeDocs);
    }

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
      attributes,
    } = req.body;

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
    deviceType.updatedBy = req.userId;

    await deviceType.save();

    // Update device type attributes
    if (attributes) {
      // Delete existing attributes
      await DeviceTypeAttribute.deleteMany({ deviceTypeId: req.params.id });

      // Add new attributes
      if (attributes.length > 0) {
        const attributeDocs = attributes.map((attr, index) => ({
          deviceTypeId: req.params.id,
          attributeId: attr.attributeId,
          required: attr.required || false,
          extendable: attr.extendable || false,
          order: index,
          createdBy: req.userId,
        }));

        await DeviceTypeAttribute.insertMany(attributeDocs);
      }
    }

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

exports.delete = async (req, res, next) => {
  try {
    const deviceType = await DeviceType.findById(req.params.id);
    if (deviceType) {
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
