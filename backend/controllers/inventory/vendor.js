const Vendor = require("../../models/inventory/vendor");
const ClientDevice = require("../../models/inventory/clientDevice");
const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const [vendors, deviceCounts] = await Promise.all([
      Vendor.find({})
        .populate("createdBy", "firstName lastName")
        .populate("updatedBy", "firstName lastName")
        .sort({ name: 1 })
        .lean(),
      // Число устройств вендора для списка. Прямой ссылки на вендора у
      // устройства нет — связь через модель: ClientDevice.deviceModelId →
      // DeviceModel.vendorId. Удалённые устройства не считаем.
      ClientDevice.aggregate([
        { $match: { deletedAt: null } },
        {
          $lookup: {
            from: "devicemodels",
            localField: "deviceModelId",
            foreignField: "_id",
            as: "model",
          },
        },
        { $unwind: "$model" },
        { $group: { _id: "$model.vendorId", count: { $sum: 1 } } },
      ]),
    ]);

    const countByVendor = new Map(
      deviceCounts.map(({ _id, count }) => [String(_id), count]),
    );

    res.status(200).json(
      vendors.map((vendor) => ({
        ...vendor,
        deviceCount: countByVendor.get(String(vendor._id)) ?? 0,
      })),
    );
  } catch (error) {
    next(new AppError("Failed to fetch vendors", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!vendor) {
      return next(
        new AppError(`Vendor with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(vendor);
  } catch (error) {
    next(
      new AppError(`Failed to fetch vendor ${req.params.id}`, 500, true, error),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { name, isMikrotikManagementEnabled } = req.body;

    const vendorExists = await Vendor.findOne({ name });
    if (vendorExists) {
      return next(
        new AppError(`Vendor with name "${name}" already exists`, 409),
      );
    }

    const vendor = new Vendor({
      name,
      isMikrotikManagementEnabled: isMikrotikManagementEnabled ?? false,
      createdBy: req.userId,
    });

    await vendor.save();

    res.status(201).json({
      message: "Вендор успешно добавлен",
      vendor: vendor,
    });
  } catch (error) {
    next(new AppError("Failed to add vendor", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { name, isActive, isMikrotikManagementEnabled } = req.body;

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return next(
        new AppError(`Vendor with id ${req.params.id} not found`, 404),
      );
    }

    // Check if name is being changed and if new name already exists
    if (name !== vendor.name) {
      const nameExists = await Vendor.findOne({
        name,
        _id: { $ne: req.params.id },
      });
      if (nameExists) {
        return next(
          new AppError(`Vendor with name "${name}" already exists`, 409),
        );
      }
    }

    vendor.name = name;
    vendor.isActive = isActive;
    vendor.isMikrotikManagementEnabled = isMikrotikManagementEnabled;

    await vendor.save();

    res.status(200).json({
      message: "Вендор успешно обновлен",
      vendor: vendor,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update vendor ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (vendor) {
      await Vendor.deleteOne({ _id: req.params.id });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Vendor with id ${req.params.id} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete vendor ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
