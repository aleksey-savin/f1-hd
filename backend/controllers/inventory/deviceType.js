const DeviceType = require("../../models/inventory/deviceType");
const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const deviceTypes = await DeviceType.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 });

    res.status(200).json(deviceTypes);
  } catch (error) {
    next(new AppError("Failed to fetch device types", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceType = await DeviceType.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!deviceType) {
      return next(
        new AppError(`Device type with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(deviceType);
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
    const { name, description } = req.body;

    const deviceTypeExists = await DeviceType.findOne({ name });
    if (deviceTypeExists) {
      return next(
        new AppError(`Device type with name "${name}" already exists`, 409),
      );
    }

    const deviceType = new DeviceType({
      name,
      description,
      createdBy: req.userId,
    });

    await deviceType.save();

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
    const { name, description, isActive } = req.body;

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
    deviceType.description = description;
    deviceType.isActive = isActive;

    await deviceType.save();

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
