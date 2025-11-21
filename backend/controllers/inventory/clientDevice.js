const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceType = require("../../models/inventory/deviceType");
const Vendor = require("../../models/inventory/vendor");
const Location = require("../../models/inventory/location");

const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const devices = await ClientDevice.find()
      .populate("company", "alias fullTitle")
      .populate("user", "firstName lastName email")
      .populate("deviceType", "name")
      .populate("vendor", "name")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ _id: -1 });

    res.status(200).json(devices);
  } catch (error) {
    next(new AppError("Failed to fetch devices", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id)
      .populate("company", "alias fullTitle")
      .populate("user", "firstName lastName email")
      .populate("deviceType", "name")
      .populate("vendor", "name")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

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
    const {
      company,
      user,
      location,
      assignmentOption, // Новое поле для комбинированного выбора
      deviceType,
      vendor,
      model,
      serialNumber,
      purchaseDate,
      price,
      purchaseDocument,
      warrantyExpirationDate,
      status,
      lastMaintenanceDate,
      notes,
      assignedTo,
      ipAddress,
      macAddress,
      operatingSystem,
    } = req.body;

    const deviceExists = await ClientDevice.findOne({ serialNumber });
    if (deviceExists) {
      return next(
        new AppError(
          `Device with serial number ${serialNumber} already exists`,
          409,
        ),
      );
    }

    // Validate references
    const companyExists = await Company.findById(company);
    if (!companyExists) {
      return next(new AppError("Invalid company ID", 400));
    }

    if (user) {
      const userExists = await User.findById(user);
      if (!userExists) {
        return next(new AppError("Invalid user ID", 400));
      }
    }

    const deviceTypeExists = await DeviceType.findById(deviceType);
    if (!deviceTypeExists) {
      return next(new AppError("Invalid device type ID", 400));
    }

    const vendorExists = await Vendor.findById(vendor);
    if (!vendorExists) {
      return next(new AppError("Invalid vendor ID", 400));
    }

    // Обработка assignmentOption
    let finalLocation = location;
    let finalUser = user;

    if (assignmentOption) {
      if (assignmentOption.startsWith("user_")) {
        // Если выбран пользователь, находим его рабочее место
        const userId = assignmentOption.replace("user_", "");
        const selectedUser = await User.findById(userId);

        if (!selectedUser) {
          return next(new AppError("Selected user not found", 400));
        }

        // Ищем рабочее место пользователя
        const workplace = await Location.findOne({
          type: "workplace",
          assignedUser: userId,
          isActive: true,
        });

        if (workplace) {
          finalLocation = workplace._id;
          finalUser = userId;
        } else {
          return next(new AppError("User workplace not found", 400));
        }
      } else {
        // Если выбрано расположение
        const locationExists = await Location.findById(assignmentOption);
        if (!locationExists) {
          return next(new AppError("Selected location not found", 400));
        }
        finalLocation = assignmentOption;
        // finalUser остается тем, что было передано в user
      }
    }

    const clientDevice = new ClientDevice({
      company,
      user: finalUser,
      location: finalLocation,
      deviceType,
      vendor,
      model,
      serialNumber,
      purchaseDate,
      price,
      purchaseDocument,
      warrantyExpirationDate,
      status,
      lastMaintenanceDate,
      notes,
      assignedTo,
      ipAddress,
      macAddress,
      operatingSystem,
      createdBy: req.userId,
    });

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
    if (!device) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    const {
      company,
      user,
      location,
      deviceType,
      vendor,
      model,
      serialNumber,
      purchaseDate,
      purchaseDocument,
      price,
      warrantyExpirationDate,
      status,
      lastMaintenanceDate,
      notes,
      assignedTo,
      ipAddress,
      macAddress,
      operatingSystem,
    } = req.body;

    // Check if serial number is being changed and if new serial number already exists
    if (serialNumber !== device.serialNumber) {
      const serialExists = await ClientDevice.findOne({
        serialNumber,
        _id: { $ne: req.params.id },
      });
      if (serialExists) {
        return next(
          new AppError(
            `Device with serial number ${serialNumber} already exists`,
            409,
          ),
        );
      }
    }

    // Validate references
    if (company) {
      const companyExists = await Company.findById(company);
      if (!companyExists) {
        return next(new AppError("Invalid company ID", 400));
      }
    }

    if (user) {
      const userExists = await User.findById(user);
      if (!userExists) {
        return next(new AppError("Invalid user ID", 400));
      }
    }

    if (deviceType) {
      const deviceTypeExists = await DeviceType.findById(deviceType);
      if (!deviceTypeExists) {
        return next(new AppError("Invalid device type ID", 400));
      }
    }

    if (vendor) {
      const vendorExists = await Vendor.findById(vendor);
      if (!vendorExists) {
        return next(new AppError("Invalid vendor ID", 400));
      }
    }

    device.company = company;
    device.user = user;
    device.location = location;
    device.deviceType = deviceType;
    device.vendor = vendor;
    device.model = model;
    device.serialNumber = serialNumber;
    device.purchaseDate = purchaseDate;
    device.purchaseDocument = purchaseDocument;
    device.price = price;
    device.warrantyExpirationDate = warrantyExpirationDate;
    device.status = status;
    device.lastMaintenanceDate = lastMaintenanceDate;
    device.notes = notes;
    device.assignedTo = assignedTo;
    device.ipAddress = ipAddress;
    device.macAddress = macAddress;
    device.operatingSystem = operatingSystem;
    device.updatedBy = req.userId;

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
