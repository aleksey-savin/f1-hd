const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const { AppError } = require("@/middleware/errorHandling");

exports.getByDeviceModelId = async (req, res, next) => {
  try {
    const deviceConfigurations = await DeviceConfiguration.find({
      deviceModelId: req.params.id,
      deletedAt: null,
    })
      .populate("deviceModelId", "name")
      .populate("values.attributeId", "code name valueType")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ createdAt: -1 });

    res.status(200).json(deviceConfigurations);
  } catch (error) {
    next(
      new AppError("Failed to fetch device configurations", 500, true, error),
    );
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceConfiguration = await DeviceConfiguration.findOne({
      _id: req.params.id,
      deletedAt: null,
    })
      .populate("deviceModelId", "name")
      .populate("values.attributeId", "code name valueType unit options")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!deviceConfiguration) {
      return next(
        new AppError(
          `Device configuration with id ${req.params.id} not found`,
          404,
        ),
      );
    }
    res.status(200).json(deviceConfiguration);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device configuration ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { deviceModelId, values } = req.body;

    // Validate that device model exists
    const DeviceModel = require("@/models/inventory/deviceModel");
    const deviceModel = await DeviceModel.findById(deviceModelId);
    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${deviceModelId} not found`, 404),
      );
    }

    // Check for duplicate configuration with same values
    const existingConfig = await DeviceConfiguration.findOne({
      deviceModelId,
      deletedAt: null,
    });

    // Create new configuration
    const deviceConfiguration = new DeviceConfiguration({
      deviceModelId,
      values: values || [],
      createdBy: req.userId,
    });

    await deviceConfiguration.save();

    const populatedConfiguration = await DeviceConfiguration.findById(
      deviceConfiguration._id,
    )
      .populate("deviceModelId", "name")
      .populate("values.attributeId", "code name valueType")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    res.status(201).json({
      message: "Device configuration added successfully",
      deviceConfiguration: populatedConfiguration,
    });
  } catch (error) {
    next(new AppError("Failed to add device configuration", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { deviceModelId, values } = req.body;

    const deviceConfiguration = await DeviceConfiguration.findOne({
      _id: req.params.id,
      deletedAt: null,
    });

    if (!deviceConfiguration) {
      return next(
        new AppError(
          `Device configuration with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    // Update fields
    if (deviceModelId) {
      // Validate that device model exists
      const DeviceModel = require("@/models/inventory/deviceModel");
      const deviceModel = await DeviceModel.findById(deviceModelId);
      if (!deviceModel) {
        return next(
          new AppError(`Device model with id ${deviceModelId} not found`, 404),
        );
      }
      deviceConfiguration.deviceModelId = deviceModelId;
    }

    if (values) {
      deviceConfiguration.values = values;
    }

    deviceConfiguration.updatedBy = req.userId;

    await deviceConfiguration.save();

    const populatedConfiguration = await DeviceConfiguration.findById(
      deviceConfiguration._id,
    )
      .populate("deviceModelId", "name")
      .populate("values.attributeId", "code name valueType")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    res.status(200).json({
      message: "Device configuration updated successfully",
      deviceConfiguration: populatedConfiguration,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device configuration ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const deviceConfiguration = await DeviceConfiguration.findOne({
      _id: req.params.id,
      deletedAt: null,
    });

    if (!deviceConfiguration) {
      return next(
        new AppError(
          `Device configuration with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    // Soft delete
    deviceConfiguration.deletedAt = new Date();
    deviceConfiguration.deletedBy = req.userId;

    await deviceConfiguration.save();

    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device configuration ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
