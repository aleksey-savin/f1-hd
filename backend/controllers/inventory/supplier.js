const Supplier = require("../../models/inventory/supplier");
const ClientDevice = require("../../models/inventory/clientDevice");
const { AppError } = require("../../middleware/errorHandling");

// Поля формы поставщика. Название обязательно, остальное дописывается позже:
// заводят его на бегу, из мастера устройства.
const SUPPLIER_FIELDS = [
  "name",
  "phone",
  "email",
  "website",
  "address",
  "inn",
  "kpp",
  "notes",
];

const applyFields = (supplier, body) => {
  for (const field of SUPPLIER_FIELDS) {
    if (body[field] !== undefined) supplier[field] = body[field] || undefined;
  }
  if (body.isActive !== undefined) supplier.isActive = body.isActive;
};

/**
 * Закупки поставщика: сколько единиц, на какую сумму и когда последняя.
 *
 * Комплектующие считаются обычными позициями: сборку целиком с перечнем
 * деталей не покупают — деталь берут отдельно, и в поставке она такая же
 * позиция, как системный блок. Поэтому `parentDeviceId` здесь не фильтруется.
 */
const purchaseTotals = async (supplierIds) => {
  if (!supplierIds.length) return new Map();
  const rows = await ClientDevice.aggregate([
    { $match: { deletedAt: null, supplierId: { $in: supplierIds } } },
    {
      $group: {
        _id: "$supplierId",
        deviceCount: { $sum: 1 },
        totalSpent: { $sum: { $ifNull: ["$price", 0] } },
        lastPurchaseAt: { $max: "$purchasedAt" },
        documents: { $addToSet: "$purchaseDocument" },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        deviceCount: row.deviceCount,
        totalSpent: row.totalSpent,
        lastPurchaseAt: row.lastPurchaseAt || null,
        // Позиции без документа в поставки не группируются — считаем их одной
        // безымянной «россыпью», поэтому null из набора выкидываем.
        deliveryCount: row.documents.filter(Boolean).length,
      },
    ]),
  );
};

exports.getAll = async (req, res, next) => {
  try {
    const suppliers = await Supplier.find({})
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .sort({ name: 1 })
      .lean();

    const totals = await purchaseTotals(suppliers.map((s) => s._id));

    res.status(200).json(
      suppliers.map((supplier) => ({
        ...supplier,
        ...(totals.get(String(supplier._id)) || {
          deviceCount: 0,
          totalSpent: 0,
          lastPurchaseAt: null,
          deliveryCount: 0,
        }),
      })),
    );
  } catch (error) {
    next(new AppError("Failed to fetch suppliers", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName")
      .lean();

    if (!supplier) {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }

    // Поставки: одна накладная — одна группа. Документ в устройствах хранится
    // строкой как есть («№ 32 от 17 июня 2026 г.»), поэтому он же и ключ.
    const devices = await ClientDevice.find({
      deletedAt: null,
      supplierId: supplier._id,
    })
      .select(
        "inventoryNumber serialNumber price purchasedAt purchaseDocument warrantyExpirationDate deviceModelId deviceTypeId companyId parentDeviceId",
      )
      .populate([
        { path: "deviceModelId", select: "name vendorId", populate: { path: "vendorId", select: "name" } },
        { path: "deviceTypeId", select: "name" },
        { path: "companyId", select: "alias fullTitle" },
      ])
      .sort({ purchasedAt: -1, _id: -1 })
      .lean();

    const byDocument = new Map();
    for (const device of devices) {
      const key = device.purchaseDocument || "__none";
      if (!byDocument.has(key)) {
        byDocument.set(key, {
          document: device.purchaseDocument || null,
          purchasedAt: device.purchasedAt || null,
          company:
            device.companyId?.alias || device.companyId?.fullTitle || null,
          total: 0,
          positions: [],
        });
      }
      const delivery = byDocument.get(key);
      delivery.total += device.price || 0;
      // Дата поставки — самая ранняя из позиций документа (их вводят по одной).
      if (
        device.purchasedAt &&
        (!delivery.purchasedAt || device.purchasedAt < delivery.purchasedAt)
      ) {
        delivery.purchasedAt = device.purchasedAt;
      }
      delivery.positions.push({
        _id: device._id,
        name:
          device.deviceModelId?.name || device.deviceTypeId?.name || "Устройство",
        vendorName: device.deviceModelId?.vendorId?.name || null,
        inventoryNumber: device.inventoryNumber || null,
        serialNumber: device.serialNumber || null,
        price: device.price ?? null,
        warrantyExpirationDate: device.warrantyExpirationDate || null,
        // Комплектующее — такая же позиция поставки; пометка нужна лишь строке.
        isComponent: Boolean(device.parentDeviceId),
      });
    }

    const deliveries = [...byDocument.values()].sort((a, b) => {
      if (!a.purchasedAt) return 1;
      if (!b.purchasedAt) return -1;
      return new Date(b.purchasedAt) - new Date(a.purchasedAt);
    });

    res.status(200).json({
      ...supplier,
      deliveries,
      deviceCount: devices.length,
      totalSpent: devices.reduce((sum, device) => sum + (device.price || 0), 0),
      lastPurchaseAt: deliveries[0]?.purchasedAt || null,
    });
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
        new AppError(`Поставщик «${name}» уже есть в справочнике`, 409),
      );
    }

    const supplier = new Supplier({ createdBy: req.userId });
    applyFields(supplier, req.body);
    await supplier.save();

    res.status(201).json({
      message: "Поставщик успешно добавлен",
      supplier,
    });
  } catch (error) {
    next(new AppError("Failed to add supplier", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { name } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }

    if (name !== supplier.name) {
      const nameExists = await Supplier.findOne({
        name,
        _id: { $ne: req.params.id },
      });
      if (nameExists) {
        return next(
          new AppError(`Поставщик «${name}» уже есть в справочнике`, 409),
        );
      }
    }

    applyFields(supplier, req.body);
    supplier.updatedBy = req.userId;
    await supplier.save();

    res.status(200).json({
      message: "Поставщик успешно обновлён",
      supplier,
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
    if (!supplier) {
      return next(
        new AppError(`Supplier with id ${req.params.id} not found`, 404),
      );
    }

    // Есть закупки — удалять нельзя: история потеряет источник (та же логика,
    // что у расположения с устройствами). Отключение оставляет его в истории и
    // убирает из формы устройства.
    const purchases = await ClientDevice.countDocuments({
      deletedAt: null,
      supplierId: supplier._id,
    });
    if (purchases > 0) {
      const tail = purchases % 10;
      const teen = purchases % 100 >= 11 && purchases % 100 <= 14;
      const word =
        !teen && tail === 1
          ? "устройство"
          : !teen && tail >= 2 && tail <= 4
            ? "устройства"
            : "устройств";
      return next(
        new AppError(
          `За поставщиком числится ${purchases} ${word} — удаление оставит их без источника закупки. Отключите поставщика вместо удаления.`,
          409,
        ),
      );
    }

    await Supplier.deleteOne({ _id: supplier._id });
    res.status(204).end();
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
