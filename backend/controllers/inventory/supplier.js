const Supplier = require("../../models/inventory/supplier");
const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const suppliers = await Supplier.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 });

    res.status(200).json(suppliers);
  } catch (error) {
    next(new AppError("Failed to fetch suppliers", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!supplier) {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(supplier);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch supplier ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { name } = req.body;

    const supplierExists = await Supplier.findOne({ name });
    if (supplierExists) {
      return next(
        new AppError(`Supplier with name "${name}" already exists`, 409),
      );
    }

    const supplier = new Supplier({
      name,
      createdBy: req.userId,
    });

    await supplier.save();

    res.status(201).json({
      message: "Поставщик успешно добавлен",
      supplier: supplier,
    });
  } catch (error) {
    next(new AppError("Failed to add supplier", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { name, isActive } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }

    // Check if name is being changed and if new name already exists
    if (name !== supplier.name) {
      const nameExists = await Supplier.findOne({
        name,
        _id: { $ne: req.params.id },
      });
      if (nameExists) {
        return next(
          new AppError(`Supplier with name "${name}" already exists`, 409),
        );
      }
    }

    supplier.name = name;
    if (isActive !== undefined) supplier.isActive = isActive;
    supplier.updatedBy = req.userId;

    await supplier.save();

    res.status(200).json({
      message: "Поставщик успешно обновлен",
      supplier: supplier,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update supplier ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (supplier) {
      await Supplier.deleteOne({ _id: req.params.id });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete supplier ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
