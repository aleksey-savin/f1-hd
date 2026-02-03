const DeviceModel = require("../../models/inventory/deviceModel");
const ClientDevice = require("../../models/inventory/clientDevice");
const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const deviceModels = await DeviceModel.find({})
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")
      .populate("attributes.attributeId", "name label dataType unit")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 });

    res.status(200).json(deviceModels);
  } catch (error) {
    next(new AppError("Failed to fetch device models", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceModel = await DeviceModel.findById(req.params.id)
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")
      .populate("attributes.attributeId", "name label dataType unit options")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(deviceModel);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device model ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { deviceTypeId, vendorId, name, attributes, notes } = req.body;

    const deviceModelExists = await DeviceModel.findOne({ name });
    if (deviceModelExists) {
      return next(
        new AppError(`Device model with name "${name}" already exists`, 409),
      );
    }

    const deviceModel = new DeviceModel({
      deviceTypeId,
      vendorId,
      name,
      attributes,
      notes,
      createdBy: req.userId,
    });

    await deviceModel.save();

    const populatedDeviceModel = await DeviceModel.findById(deviceModel._id)
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")
      .populate("attributes.attributeId", "name label dataType unit");

    res.status(201).json({
      message: "Device model added successfully",
      deviceModel: populatedDeviceModel,
    });
  } catch (error) {
    next(new AppError("Failed to add device model", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { deviceTypeId, vendorId, name, attributes, notes } = req.body;

    const deviceModel = await DeviceModel.findById(req.params.id);
    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${req.params.id} not found`, 404),
      );
    }

    // Check if name is being changed and if new name already exists
    if (name !== deviceModel.name) {
      const nameExists = await DeviceModel.findOne({
        name,
        _id: { $ne: req.params.id },
      });
      if (nameExists) {
        return next(
          new AppError(`Device model with name "${name}" already exists`, 409),
        );
      }
    }

    deviceModel.name = name;
    deviceModel.deviceTypeId = deviceTypeId;
    deviceModel.vendorId = vendorId;
    deviceModel.attributes = attributes;
    deviceModel.notes = notes;
    deviceModel.updatedBy = req.userId;

    await deviceModel.save();

    const populatedDeviceModel = await DeviceModel.findById(deviceModel._id)
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")
      .populate("attributes.attributeId", "name label dataType unit");

    res.status(200).json({
      message: "Device model updated successfully",
      deviceModel: populatedDeviceModel,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device model ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const deviceModel = await DeviceModel.findById(req.params.id);

    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${req.params.id} not found`, 404),
      );
    }

    const clientDevices = await ClientDevice.find({
      deviceModelId: req.params.id,
    });

    if (clientDevices.length > 0) {
      return next(new AppError(`Device model ${req.params.id} is in use`, 409));
    }

    await DeviceModel.deleteOne({ _id: req.params.id });
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device model ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
