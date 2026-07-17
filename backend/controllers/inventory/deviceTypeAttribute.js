const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const { AppError } = require("@/middleware/errorHandling");

// Поля каталожного атрибута, нужные карточке и форме конфигурации.
const ATTRIBUTE_FIELDS = "code name valueType unit options isActive";

// GET /device-type-attributes/type/:id — связки атрибутов типа (для ревалидации
// карточки). Тот же populate+sort, что и в deviceType.getOne.
exports.getByDeviceTypeId = async (req, res, next) => {
  try {
    const attributes = await DeviceTypeAttribute.find({
      deviceTypeId: req.params.id,
    })
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .sort({ order: 1, createdAt: 1 });

    res.status(200).json(attributes);
  } catch (error) {
    next(
      new AppError("Failed to fetch device type attributes", 500, true, error),
    );
  }
};

// GET /device-type-attributes/:id — одна связка (для формы правки).
exports.getOne = async (req, res, next) => {
  try {
    const attribute = await DeviceTypeAttribute.findById(req.params.id)
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("deviceTypeId", "name");

    if (!attribute) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }
    res.status(200).json(attribute);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// POST /device-type-attributes/add — привязать атрибут к типу (в конец списка).
exports.add = async (req, res, next) => {
  try {
    const { deviceTypeId, attributeId, required, extendable } = req.body;

    if (!deviceTypeId || !attributeId) {
      return next(new AppError("deviceTypeId и attributeId обязательны", 400));
    }

    const deviceType = await DeviceType.findById(deviceTypeId);
    if (!deviceType) {
      return next(
        new AppError(`Device type with id ${deviceTypeId} not found`, 404),
      );
    }

    const attribute = await DeviceAttribute.findById(attributeId);
    if (!attribute) {
      return next(
        new AppError(`Device attribute with id ${attributeId} not found`, 404),
      );
    }

    // Один атрибут — одна связка с типом
    const exists = await DeviceTypeAttribute.findOne({
      deviceTypeId,
      attributeId,
    });
    if (exists) {
      return next(
        new AppError(`Атрибут «${attribute.name}» уже добавлен к типу`, 409),
      );
    }

    // Порядок — следом за последним
    const last = await DeviceTypeAttribute.findOne({ deviceTypeId }).sort({
      order: -1,
    });
    const order = last ? (last.order || 0) + 1 : 0;

    const created = new DeviceTypeAttribute({
      deviceTypeId,
      attributeId,
      required: !!required,
      extendable: !!extendable,
      order,
      createdBy: req.userId,
    });
    await created.save();

    const populated = await DeviceTypeAttribute.findById(created._id).populate(
      "attributeId",
      ATTRIBUTE_FIELDS,
    );

    res.status(201).json({
      message: "Атрибут добавлен к типу",
      deviceTypeAttribute: populated,
    });
  } catch (error) {
    next(new AppError("Failed to add device type attribute", 500, true, error));
  }
};

// PUT /device-type-attributes/update/:id — сменить атрибут/флаги связки.
exports.update = async (req, res, next) => {
  try {
    const { attributeId, required, extendable } = req.body;

    const link = await DeviceTypeAttribute.findById(req.params.id);
    if (!link) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    if (attributeId && String(attributeId) !== String(link.attributeId)) {
      const attribute = await DeviceAttribute.findById(attributeId);
      if (!attribute) {
        return next(
          new AppError(
            `Device attribute with id ${attributeId} not found`,
            404,
          ),
        );
      }
      const duplicate = await DeviceTypeAttribute.findOne({
        deviceTypeId: link.deviceTypeId,
        attributeId,
        _id: { $ne: link._id },
      });
      if (duplicate) {
        return next(
          new AppError(`Атрибут «${attribute.name}» уже добавлен к типу`, 409),
        );
      }
      link.attributeId = attributeId;
    }

    if (required !== undefined) link.required = !!required;
    if (extendable !== undefined) link.extendable = !!extendable;
    link.updatedBy = req.userId;

    await link.save();

    const populated = await DeviceTypeAttribute.findById(link._id).populate(
      "attributeId",
      ATTRIBUTE_FIELDS,
    );

    res.status(200).json({
      message: "Атрибут типа обновлён",
      deviceTypeAttribute: populated,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// POST /device-type-attributes/delete/:id — жёсткое удаление (модель без
// soft-delete; так же, как bulk-удаление связок в deviceType-контроллере).
exports.delete = async (req, res, next) => {
  try {
    const link = await DeviceTypeAttribute.findById(req.params.id);
    if (!link) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    await DeviceTypeAttribute.deleteOne({ _id: req.params.id });
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// PUT /device-type-attributes/reorder — body: { deviceTypeId, orderedIds }.
// order = позиция в массиве; апдейтим только связки этого типа.
exports.reorder = async (req, res, next) => {
  try {
    const { deviceTypeId, orderedIds } = req.body;

    if (!deviceTypeId || !Array.isArray(orderedIds)) {
      return next(new AppError("deviceTypeId и orderedIds обязательны", 400));
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        DeviceTypeAttribute.updateOne(
          { _id: id, deviceTypeId },
          { $set: { order: index, updatedBy: req.userId } },
        ),
      ),
    );

    const attributes = await DeviceTypeAttribute.find({ deviceTypeId })
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .sort({ order: 1, createdAt: 1 });

    res.status(200).json({ message: "Порядок обновлён", attributes });
  } catch (error) {
    next(
      new AppError(
        "Failed to reorder device type attributes",
        500,
        true,
        error,
      ),
    );
  }
};
