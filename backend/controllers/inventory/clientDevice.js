const ClientDevice = require("../../models/inventory/clientDevice");

const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const devices = await ClientDevice.find().sort({ _id: -1 });

    res.status(200).json(devices);
  } catch (error) {
    next(new AppError("Failed to fetch devices", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
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
    const deviceExists = await ClientDevice.findOne({
      serialNumber: req.body.serialNumber,
    });

    if (deviceExists) {
      return next(
        new AppError(
          `Device with serial number ${req.body.serialNumber} already exists`,
          409,
        ),
      );
    }

    const clientDevice = new ClientDevice(req.body);

    await clientDevice.save();

    res.status(201).json({
      message: "Новое устройство успешно добавлено",
      clientDevice: clientDevice,
    });
  } catch (error) {
    next(new AppError("Failed to add device", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    const {
      company,
      user,
      location,
      deviceType,
      manufacturer,
      model,
      serialNumber,
      purchaseDate,
      purchaseDocument,
      price,
      warrantyExpirationDate,
      status,
      lastMaintanceDate,
      notes,
      assignedTo,
      ipAddress,
      macAddress,
      operatingSystem,
    } = req.body;

    device.company = company;
    device.user = user;
    device.location = location;
    device.deviceType = deviceType;
    device.manufacturer = manufacturer;
    device.model = model;
    device.serialNumber = serialNumber;
    device.purchaseDate = purchaseDate;
    device.purchaseDocument = purchaseDocument;
    device.price = price;
    device.warrantyExpirationDate = warrantyExpirationDate;
    device.status = status;
    device.lastMaintenanceDate = lastMaintanceDate;
    device.notes = notes;
    device.assignedTo = assignedTo;
    device.ipAddress = ipAddress;
    device.macAddress = macAddress;
    device.operatingSystem = operatingSystem;

    await device.save();

    res.status(200).json({
      message: "Устройство успешно изменено.",
      device: device,
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
