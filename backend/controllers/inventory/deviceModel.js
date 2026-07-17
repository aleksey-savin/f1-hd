const DeviceModel = require("@/models/inventory/deviceModel");
const ClientDevice = require("@/models/inventory/clientDevice");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const { createPhotoHandlers } = require("./photoHandlers");
const { AppError } = require("@/middleware/errorHandling");

// Каталожные снимки модели. Удаление модели мягкое, поэтому объекты в S3 при
// нём остаются: восстановленная модель должна вернуться со своими фото.
const modelPhotos = createPhotoHandlers({
  Model: DeviceModel,
  notFoundMessage: (id) => `Device model with id ${id} not found`,
});
exports.addPhotos = modelPhotos.addPhotos;
exports.deletePhoto = modelPhotos.deletePhoto;

exports.getAll = async (req, res, next) => {
  try {
    const deviceModels = await DeviceModel.find({ deletedAt: null })
      .populate("deviceTypeId", "name isConsumable")
      .populate("vendorId", "name")
      .populate("compatibleWithModelIds", "name")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 })
      .lean();

    // Счётчик конфигураций по каждой модели — одним запросом (мета списка:
    // «Тип · N конфигураций»). Считаем только неудалённые.
    const configCounts = await DeviceConfiguration.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: "$deviceModelId", count: { $sum: 1 } } },
    ]);
    const countByModel = new Map(
      configCounts.map((row) => [String(row._id), row.count]),
    );
    for (const deviceModel of deviceModels) {
      deviceModel.configurationsCount =
        countByModel.get(String(deviceModel._id)) || 0;
    }

    res.status(200).json(deviceModels);
  } catch (error) {
    next(new AppError("Failed to fetch device models", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const deviceModel = await DeviceModel.findOne({
      _id: req.params.id,
      deletedAt: null,
    })
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")      .populate("compatibleWithModelIds", "name")
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
    const {
      deviceTypeId,
      vendorId,
      name,      compatibleWithModelIds,
      notes,
    } = req.body;

    // Check if name already exists (if name is provided)
    if (name) {
      const deviceModelExists = await DeviceModel.findOne({
        name,
        deletedAt: null,
      });
      if (deviceModelExists) {
        return next(
          new AppError(`Device model with name "${name}" already exists`, 409),
        );
      }
    }

    const deviceModel = new DeviceModel({
      deviceTypeId,
      vendorId,
      name,      compatibleWithModelIds: compatibleWithModelIds || [],
      notes,
      createdBy: req.userId,
    });

    await deviceModel.save();

    const populatedDeviceModel = await DeviceModel.findById(deviceModel._id)
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")      .populate("compatibleWithModelIds", "name");

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
    const {
      deviceTypeId,
      vendorId,
      name,      compatibleWithModelIds,
      notes,
    } = req.body;

    const deviceModel = await DeviceModel.findOne({
      _id: req.params.id,
      deletedAt: null,
    });
    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${req.params.id} not found`, 404),
      );
    }

    // Check if name is being changed and if new name already exists
    if (name && name !== deviceModel.name) {
      const nameExists = await DeviceModel.findOne({
        name,
        _id: { $ne: req.params.id },
        deletedAt: null,
      });
      if (nameExists) {
        return next(
          new AppError(`Device model with name "${name}" already exists`, 409),
        );
      }
    }

    // Update fields
    if (name !== undefined) deviceModel.name = name;
    if (deviceTypeId) deviceModel.deviceTypeId = deviceTypeId;
    if (vendorId) deviceModel.vendorId = vendorId;    if (compatibleWithModelIds !== undefined)
      deviceModel.compatibleWithModelIds = compatibleWithModelIds;
    if (notes !== undefined) deviceModel.notes = notes;
    deviceModel.updatedBy = req.userId;

    await deviceModel.save();

    const populatedDeviceModel = await DeviceModel.findById(deviceModel._id)
      .populate("deviceTypeId", "name")
      .populate("vendorId", "name")      .populate("compatibleWithModelIds", "name");

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
    const deviceModel = await DeviceModel.findOne({
      _id: req.params.id,
      deletedAt: null,
    });

    if (!deviceModel) {
      return next(
        new AppError(`Device model with id ${req.params.id} not found`, 404),
      );
    }

    // Check if device model is being used
    const clientDevices = await ClientDevice.find({
      deviceModelId: req.params.id,
      deletedAt: null,
    });

    if (clientDevices.length > 0) {
      return next(
        new AppError(
          `Device model is in use by ${clientDevices.length} device(s)`,
          409,
        ),
      );
    }

    // Soft delete
    deviceModel.deletedAt = new Date();
    deviceModel.deletedBy = req.userId;

    await deviceModel.save();

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
