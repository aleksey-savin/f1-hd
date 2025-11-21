const Vendor = require("../../models/inventory/vendor");
const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const vendors = await Vendor.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 });

    res.status(200).json(vendors);
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
    const { name, description } = req.body;

    const vendorExists = await Vendor.findOne({ name });
    if (vendorExists) {
      return next(
        new AppError(`Vendor with name "${name}" already exists`, 409),
      );
    }

    const vendor = new Vendor({
      name,
      description,
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
    const { name, description, isActive } = req.body;

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
    vendor.description = description;
    vendor.isActive = isActive;

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
