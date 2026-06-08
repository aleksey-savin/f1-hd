const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const DeviceModel = require("../../models/inventory/deviceModel");

const { AppError } = require("../../middleware/errorHandling");

// Shared populate graph: model (+ its vendor & type), company, location, user.
const DEVICE_POPULATE = [
  {
    path: "deviceModelId",
    select: "name vendorId deviceTypeId",
    populate: [
      { path: "vendorId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
  { path: "companyId", select: "alias fullTitle" },
  { path: "locationId", select: "name fullPath" },
  { path: "supplierId", select: "name" },
  { path: "userId", select: "firstName lastName email" },
  { path: "createdBy", select: "firstName lastName" },
  { path: "updatedBy", select: "firstName lastName" },
];

// Mongoose can't cast "" to ObjectId / Number / Date — turn blanks into
// undefined so empty optional fields are stored as unset rather than throwing.
const clean = (value) => (value === "" || value === undefined ? undefined : value);

// Maps the (schema-aligned) request body onto ClientDevice fields.
const buildDevicePayload = (body) => ({
  companyId: clean(body.companyId),
  userId: clean(body.userId),
  locationId: clean(body.locationId),
  deviceModelId: clean(body.deviceModelId),
  serialNumber: body.serialNumber,
  status: clean(body.status),
  purchasedAt: clean(body.purchasedAt),
  price: clean(body.price),
  purchaseDocument: clean(body.purchaseDocument),
  supplierId: clean(body.supplierId),
  warrantyExpirationDate: clean(body.warrantyExpirationDate),
  lastMaintenanceDate: clean(body.lastMaintenanceDate),
  ipAddress: clean(body.ipAddress),
  macAddress: clean(body.macAddress),
  operatingSystem: clean(body.operatingSystem),
  notes: clean(body.notes),
});

exports.getAll = async (req, res, next) => {
  try {
    const devices = await ClientDevice.find({ deletedAt: null })
      .populate(DEVICE_POPULATE)
      .sort({ _id: -1 });

    res.status(200).json(devices);
  } catch (error) {
    next(new AppError("Failed to fetch devices", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id).populate(
      DEVICE_POPULATE,
    );

    if (!device) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(device);
  } catch (error) {
    next(
      new AppError(`Failed to fetch device ${req.params.id}`, 500, true, error),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const payload = buildDevicePayload(req.body);

    const deviceExists = await ClientDevice.findOne({
      serialNumber: payload.serialNumber,
    });
    if (deviceExists) {
      return next(
        new AppError(
          `Device with serial number ${payload.serialNumber} already exists`,
          409,
        ),
      );
    }

    const company = await Company.findById(payload.companyId);
    if (!company) {
      return next(new AppError("Invalid company ID", 400));
    }

    const deviceModel = await DeviceModel.findById(payload.deviceModelId);
    if (!deviceModel) {
      return next(new AppError("Invalid device model ID", 400));
    }

    const clientDevice = new ClientDevice({
      ...payload,
      createdBy: req.userId,
    });

    await clientDevice.save();

    res.status(201).json({
      message: "Новое устройство успешно добавлено",
      clientDevice,
    });
  } catch (error) {
    next(new AppError("Failed to add device", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    if (!device) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    const payload = buildDevicePayload(req.body);

    if (payload.serialNumber && payload.serialNumber !== device.serialNumber) {
      const serialExists = await ClientDevice.findOne({
        serialNumber: payload.serialNumber,
        _id: { $ne: req.params.id },
      });
      if (serialExists) {
        return next(
          new AppError(
            `Device with serial number ${payload.serialNumber} already exists`,
            409,
          ),
        );
      }
    }

    if (payload.companyId) {
      const company = await Company.findById(payload.companyId);
      if (!company) {
        return next(new AppError("Invalid company ID", 400));
      }
    }

    if (payload.deviceModelId) {
      const deviceModel = await DeviceModel.findById(payload.deviceModelId);
      if (!deviceModel) {
        return next(new AppError("Invalid device model ID", 400));
      }
    }

    Object.assign(device, payload, { updatedBy: req.userId });
    await device.save();

    res.status(200).json({
      message: "Устройство успешно изменено.",
      device,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    if (device) {
      await ClientDevice.deleteOne({ _id: req.params.id });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
