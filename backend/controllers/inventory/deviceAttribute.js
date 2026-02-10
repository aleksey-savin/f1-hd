const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const { AppError } = require("@/middleware/errorHandling");

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
    res.status(200).json(deviceAttribute);
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
    const { code, name, valueType, unit, options, isActive } = req.body;

    const deviceAttributeExists = await DeviceAttribute.findOne({
      $or: [{ name }, { code }],
    });
    if (deviceAttributeExists) {
      return next(
        new AppError(
          `Device attribute with name "${name}" or code "${code}" already exists`,
          409,
        ),
      );
    }

    const deviceAttribute = new DeviceAttribute({
      code,
      name,
      valueType,
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
    const { code, name, valueType, unit, options, isActive } = req.body;

    const deviceAttribute = await DeviceAttribute.findById(req.params.id);
    if (!deviceAttribute) {
      return next(
        new AppError(
          `Device attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    // Check if name is being changed and if new name already exists
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
