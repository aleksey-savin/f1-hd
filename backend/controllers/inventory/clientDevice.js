const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceType = require("../../models/inventory/deviceType");
const Counter = require("../../models/inventory/counter");

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
  // Прямой тип — для самосборных устройств без модели.
  { path: "deviceTypeId", select: "name" },
  // Конфигурация (пресет характеристик модели) с расшифровкой значений.
  {
    path: "configurationId",
    select: "name values",
    populate: { path: "values.attributeId", select: "code name unit" },
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
const clean = (value) =>
  value === "" || value === undefined ? undefined : value;

// Maps the (schema-aligned) request body onto ClientDevice fields.
const buildDevicePayload = (body) => ({
  companyId: clean(body.companyId),
  userId: clean(body.userId),
  locationId: clean(body.locationId),
  deviceModelId: clean(body.deviceModelId),
  configurationId: clean(body.configurationId),
  deviceTypeId: clean(body.deviceTypeId),
  parentDeviceId: clean(body.parentDeviceId),
  quantity: clean(body.quantity),
  // clean(): пустой серийник сохраняем как unset (не ""), иначе пустые строки
  // конфликтуют по партиал-уникальному индексу.
  serialNumber: clean(body.serialNumber),
  inventoryNumber: clean(body.inventoryNumber),
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
  // Сетевое имя ПК. machineId здесь НЕ маппим намеренно: его проставляет агент
  // отдельным путём, а update делает Object.assign(payload) — иначе правка из
  // мастера (без machineId в теле) затёрла бы значение агента.
  hostname: clean(body.hostname),
  notes: clean(body.notes),
});

// Префикс инвентарного номера берём из типа устройства
// (DeviceType.inventoryPrefix), иначе — дефолтный "INV". Формат: PREFIX-000001,
// счётчик ведётся отдельно на каждый префикс.
const generateInventoryNumber = async (deviceTypeId) => {
  let prefix = "INV";
  if (deviceTypeId) {
    const type =
      await DeviceType.findById(deviceTypeId).select("inventoryPrefix");
    if (type?.inventoryPrefix) prefix = type.inventoryPrefix;
  }
  const seq = await Counter.getNextSequence(`clientDevice:${prefix}`);
  return `${prefix}-${String(seq).padStart(6, "0")}`;
};

exports.getAll = async (req, res, next) => {
  try {
    // Только самостоятельные устройства — комплектующие сборок (parentDeviceId)
    // в общий список не попадают.
    const devices = await ClientDevice.find({
      deletedAt: null,
      parentDeviceId: null,
    })
      .populate(DEVICE_POPULATE)
      .sort({ _id: -1 });

    // Кол-во комплектующих на каждую сборку — одним агрегатом.
    const counts = await ClientDevice.aggregate([
      { $match: { deletedAt: null, parentDeviceId: { $ne: null } } },
      { $group: { _id: "$parentDeviceId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const result = devices.map((d) => ({
      ...d.toObject(),
      componentCount: countMap.get(String(d._id)) || 0,
    }));

    res.status(200).json(result);
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

    // Комплектующие сборки (если есть) — для отображения/редактирования состава.
    const components = await ClientDevice.find({
      parentDeviceId: req.params.id,
      deletedAt: null,
    }).populate(DEVICE_POPULATE);

    res.status(200).json({ ...device.toObject(), components });
  } catch (error) {
    next(
      new AppError(`Failed to fetch device ${req.params.id}`, 500, true, error),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const payload = buildDevicePayload(req.body);

    // Серийник опционален — проверяем дубль только если он задан.
    if (payload.serialNumber) {
      const serialExists = await ClientDevice.findOne({
        serialNumber: payload.serialNumber,
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

    if (payload.inventoryNumber) {
      const invExists = await ClientDevice.findOne({
        inventoryNumber: payload.inventoryNumber,
      });
      if (invExists) {
        return next(
          new AppError(
            `Устройство с инвентарным номером ${payload.inventoryNumber} уже существует`,
            409,
          ),
        );
      }
    }

    // Компонент наследует компанию/расположение/пользователя от родителя.
    if (payload.parentDeviceId) {
      const parent = await ClientDevice.findById(payload.parentDeviceId);
      if (!parent) {
        return next(new AppError("Invalid parent device ID", 400));
      }
      payload.companyId = payload.companyId || parent.companyId;
      payload.locationId = payload.locationId || parent.locationId;
      payload.userId = payload.userId || parent.userId;
    }

    const company = await Company.findById(payload.companyId);
    if (!company) {
      return next(new AppError("Invalid company ID", 400));
    }

    // Hostname опционален и уникален в пределах компании — проверяем дубль,
    // только если задан (companyId здесь уже разрешён, в т.ч. от родителя).
    if (payload.hostname) {
      const hostExists = await ClientDevice.findOne({
        companyId: payload.companyId,
        hostname: payload.hostname,
      });
      if (hostExists) {
        return next(
          new AppError(
            `Устройство с именем "${payload.hostname}" уже есть в этой компании`,
            409,
          ),
        );
      }
    }

    // Назначенный пользователь должен быть из компании устройства (company у
    // User — вложенный объект { _id, alias }; сравниваем по _id).
    if (payload.userId) {
      const user = await User.findById(payload.userId);
      const userCompanyId = user?.company?._id || user?.company;
      if (!user || userCompanyId?.toString() !== payload.companyId?.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
    }

    // Устройство задаётся либо моделью (заводская сборка), либо напрямую типом
    // (самосборное). Тип нужен и для префикса инвентарного номера.
    let deviceTypeId;
    if (payload.deviceModelId) {
      const deviceModel = await DeviceModel.findById(payload.deviceModelId);
      if (!deviceModel) {
        return next(new AppError("Invalid device model ID", 400));
      }
      deviceTypeId = deviceModel.deviceTypeId;
    } else if (payload.deviceTypeId) {
      const deviceType = await DeviceType.findById(payload.deviceTypeId);
      if (!deviceType) {
        return next(new AppError("Invalid device type ID", 400));
      }
      deviceTypeId = payload.deviceTypeId;
    } else {
      return next(new AppError("Укажите модель или тип устройства", 400));
    }

    // Инвентарный номер — первичный идентификатор актива: если не задан вручную,
    // генерируем автоматически по префиксу типа.
    if (!payload.inventoryNumber) {
      payload.inventoryNumber = await generateInventoryNumber(deviceTypeId);
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

    if (
      payload.inventoryNumber &&
      payload.inventoryNumber !== device.inventoryNumber
    ) {
      const invExists = await ClientDevice.findOne({
        inventoryNumber: payload.inventoryNumber,
        _id: { $ne: req.params.id },
      });
      if (invExists) {
        return next(
          new AppError(
            `Устройство с инвентарным номером ${payload.inventoryNumber} уже существует`,
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

    // Hostname уникален в пределах компании. Проверяем, только если изменился;
    // компанию берём новую (если меняется) или текущую.
    if (payload.hostname && payload.hostname !== device.hostname) {
      const companyId = payload.companyId || device.companyId;
      const hostExists = await ClientDevice.findOne({
        companyId,
        hostname: payload.hostname,
        _id: { $ne: req.params.id },
      });
      if (hostExists) {
        return next(
          new AppError(
            `Устройство с именем "${payload.hostname}" уже есть в этой компании`,
            409,
          ),
        );
      }
    }

    // Назначенный пользователь — из компании устройства (новой или текущей).
    if (payload.userId) {
      const user = await User.findById(payload.userId);
      const userCompanyId = user?.company?._id || user?.company;
      const deviceCompanyId = payload.companyId || device.companyId;
      if (!user || userCompanyId?.toString() !== deviceCompanyId?.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
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

// Привязка/снятие пользователя — отдельный лёгкий экшен (со страницы устройства).
// Не используем общий update: тот через buildDevicePayload затирает незаданные
// поля. Назначение пользователя переводит статус в "deployed" (Выдано); снятие
// (пустой userId) возвращает "readyForDeployment", если было "deployed".
exports.assignUser = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    if (!device) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    const userId = clean(req.body.userId);

    if (userId) {
      const user = await User.findById(userId);
      const userCompanyId = user?.company?._id || user?.company;
      if (
        !user ||
        userCompanyId?.toString() !== device.companyId?.toString()
      ) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
      device.userId = userId;
      device.status = "deployed";
    } else {
      device.userId = undefined;
      if (device.status === "deployed") device.status = "readyForDeployment";
    }

    device.updatedBy = req.userId;
    await device.save();

    const populated = await ClientDevice.findById(device._id).populate(
      DEVICE_POPULATE,
    );

    res.status(200).json({
      message: userId ? "Пользователь назначен" : "Пользователь снят",
      device: populated,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to assign user to device ${req.params.id}`,
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
