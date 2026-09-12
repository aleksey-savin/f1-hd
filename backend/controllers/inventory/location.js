const Location = require("../../models/inventory/location");
const Subdivision = require("../../models/subdivision");
const User = require("../../models/user");
const Company = require("../../models/company");
const ClientDevice = require("../../models/inventory/clientDevice");
const { AppError } = require("../../middleware/errorHandling");
const {
  buildMikrotikStatusMap,
  mikrotikOverlay,
} = require("../../helpers/mikrotikOverlay");

// Идентификатор из populate'нутого документа, вложенного объекта (`user.company`
// это `{_id, alias}`) или сырого ObjectId — сравниваем строками.
const idOf = (value) => String(value?._id || value || "");

/**
 * Компании, данные которых вправе видеть автор запроса.
 *
 * Клиент заперт в своей компании: модуль «Учёт техники» открывает раздел, а
 * объём данных определяет роль — тот же приём, что в реестре техники
 * (`controllers/inventory/clientDevice.js`, `scopeMatch`). Запрошенные компании
 * ПЕРЕСЕКАЮТСЯ со своей, поэтому подставленный в query чужой id не отдаёт чужую
 * технику, а не отдаёт ничего. Клиент без компании не видит ничего — это лучше,
 * чем «без компании» как пропуск ко всему.
 *
 * До этого расположения не смотрели на учётную запись вовсе: клиентов держал
 * только случайный слой «не клиент», протёкший с соседнего монтирования
 * `/inventory` (см. `routes/inventoryMount.js`).
 *
 * @param {object} req
 * @param {string[]|null} [requested] компании из query/params, если есть
 * @returns {string[]|null} `null` — сотрудник, ограничений нет; иначе список
 *   разрешённых id (пустой = не видно ничего)
 */
const companyScope = (req, requested = null) => {
  if (!req.auth?.isEndUser) return null;
  const own = idOf(req.auth.legacy?.company?._id);
  const ownIds = own ? [own] : [];
  if (!requested?.length) return ownIds;
  return ownIds.filter((id) => requested.some((value) => idOf(value) === id));
};

/**
 * Скоуп в терминах ТЕХНИКИ: у устройства компания лежит в `companyId`.
 *
 * Нужен отдельно от расположения, потому что «расположение своей компании» ещё
 * не значит «вся техника в нём своя»: публичное расположение (`isPublic`) может
 * держать устройства чужой компании, и клиенту в списке видны были бы их модель
 * и инвентарный номер.
 */
const deviceScopeMatch = (scope) =>
  scope ? { companyId: { $in: scope } } : {};

// Лёгкий populate-граф для виджета окружения заявки: только то, что нужно
// карточке устройства. userId НЕ populate — сравниваем сырой ObjectId для флага
// isPersonal, чтобы не тянуть лишнее.
const ENV_DEVICE_POPULATE = [
  {
    path: "deviceModelId",
    select: "name vendorId deviceTypeId",
    populate: [
      { path: "vendorId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
  { path: "deviceTypeId", select: "name" },
  { path: "locationId", select: "name type" },
];

// Тонкий DTO устройства для окружения. Имя — из модели или прямого типа
// (самосборные), вендор/тип человекочитаемые. isPersonal: устройство закреплено
// лично за заявителем (бейдж «★»). Только не удалённые самостоятельные единицы.
const toEnvDevice = (d, userId, mikroMap) => {
  const model = d.deviceModelId;
  const typeName = model?.deviceTypeId?.name || d.deviceTypeId?.name || null;
  const mikro = mikroMap?.get(String(d._id));
  return {
    _id: d._id,
    name: model?.name || typeName || "Устройство",
    typeName,
    vendorName: model?.vendorId?.name || null,
    serialNumber: d.serialNumber || null,
    inventoryNumber: d.inventoryNumber || null,
    status: d.status || null,
    ipAddress: d.ipAddress || null,
    operatingSystem: d.operatingSystem || null,
    locationId: d.locationId?._id || d.locationId || null,
    locationName: d.locationId?.name || null,
    isPersonal: String(d.userId?._id || d.userId || "") === String(userId),
    // Mikrotik management overlay — present only for devices with a record.
    ...mikrotikOverlay(mikro),
  };
};

// Узел окружения: устройства локации (со слоем isPersonal) + дочерние локации с
// числом устройств. Без isCurrent — «ветку заявителя» подсвечивает фронт по id
// цепочки, чтобы кликабельны были ВСЕ дочерние узлы. Общий код для
// getUserEnvironment и getLocationNode.
const buildEnvNode = async (location, userId, scope = null) => {
  const devicesRaw = await ClientDevice.find({
    deletedAt: null,
    parentDeviceId: null,
    locationId: location._id,
    ...deviceScopeMatch(scope),
  }).populate(ENV_DEVICE_POPULATE);
  const mikroMap = await buildMikrotikStatusMap(devicesRaw.map((d) => d._id));
  const devices = devicesRaw.map((d) => toEnvDevice(d, userId, mikroMap));

  const childrenDocs = await Location.find({
    parent: location._id,
    isActive: true,
  }).select("name type");

  const childIds = childrenDocs.map((c) => c._id);
  const countAgg = childIds.length
    ? await ClientDevice.aggregate([
        {
          $match: {
            locationId: { $in: childIds },
            deletedAt: null,
            parentDeviceId: null,
            ...deviceScopeMatch(scope),
          },
        },
        { $group: { _id: "$locationId", count: { $sum: 1 } } },
      ])
    : [];
  const countMap = new Map(countAgg.map((c) => [String(c._id), c.count]));

  const children = childrenDocs.map((child) => ({
    _id: child._id,
    name: child.name,
    type: child.type,
    deviceCount: countMap.get(String(child._id)) || 0,
  }));

  return {
    _id: location._id,
    name: location.name,
    type: location.type,
    subdivisionName:
      (location.subdivisions || [])
        .map((s) => s?.name)
        .filter(Boolean)
        .join(", ") || null,
    deviceCount: devices.length,
    devices,
    children,
  };
};

// Цепочка root→leaf: поднимаемся по parent от листа. Кап глубины — защита от
// циклов. Общий код для getUserEnvironment и getDeviceEnvironment.
const buildLocationChain = async (leaf) => {
  const chainDocs = [];
  let current = leaf;
  let guard = 0;
  while (current && guard < 8) {
    chainDocs.unshift(current);
    const parentId = current.parent?._id || current.parent;
    if (!parentId) break;
    current = await Location.findById(parentId)
      .select("name type parent subdivisions")
      .populate("subdivisions", "name");
    guard += 1;
  }
  return chainDocs;
};

exports.getAll = async (req, res, next) => {
  try {
    // Поле компании у расположения — `company` (не `companyId`, как у техники).
    const scope = companyScope(req);
    const locations = await Location.find(
      scope ? { company: { $in: scope } } : {},
    )
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivisions",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .sort({ type: 1, name: 1 });

    res.status(200).json(locations);
  } catch (error) {
    next(new AppError("Failed to fetch locations", 500, true, error));
  }
};

// Get locations for one or multiple companies
// Supports: ?companyId=123 (single) or ?companyIds=123,456,789 (multiple)
exports.getAllCompanies = async (req, res, next) => {
  try {
    const { companyIds } = req.query;

    const authedUser = req.auth?.legacy ?? null;

    const requested = companyIds ? companyIds.split(",").filter(Boolean) : null;
    // Скоуп сильнее запроса: клиент, подставивший чужую компанию, не увидит
    // ничего (пустой $in), а не её расположения.
    const scope = companyScope(req, requested);

    let companyFilter = {};

    if (scope) {
      companyFilter = { company: { $in: scope } };
    } else if (requested) {
      companyFilter = { company: { $in: requested } };
    } else {
      // Default to user's company
      companyFilter = { company: authedUser.company?._id };
    }

    const locations = await Location.find(companyFilter)
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivisions",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .sort({ type: 1, name: 1 })
      .lean();

    // Число устройств в каждом расположении — одним агрегатом (мета строк
    // дерева «Тип · N устройств»; считаем прямые, как на карточке).
    const ids = locations.map((l) => l._id);
    const counts = ids.length
      ? await ClientDevice.aggregate([
          {
            $match: {
              locationId: { $in: ids },
              deletedAt: null,
              parentDeviceId: null,
            },
          },
          { $group: { _id: "$locationId", count: { $sum: 1 } } },
        ])
      : [];
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    for (const location of locations) {
      location.deviceCount = countMap.get(String(location._id)) || 0;
    }

    res.status(200).json(locations);
  } catch (error) {
    next(new AppError("Failed to fetch locations", 500, true, error));
  }
};

// Get location hierarchy
// Get one location by ID — питает карточку расположения: сама локация,
// цепочка предков (крошки), вложенные с числом устройств и устройства «здесь».
exports.getOne = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id)
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivisions",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .populate("children", "name type")
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Чужая компания отвечает «не найдено», а не «нельзя»: существование
    // расположений клиенту знать незачем.
    const scope = companyScope(req);
    if (scope && !scope.includes(idOf(location.company))) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Устройства непосредственно в этом расположении. Живые поля —
    // locationId/deletedAt/parentDeviceId (ср. buildEnvNode): старый запрос по
    // location/isDeleted всегда возвращал пусто.
    const devicesRaw = await ClientDevice.find({
      locationId: req.params.id,
      deletedAt: null,
      parentDeviceId: null,
      ...deviceScopeMatch(scope),
    })
      .populate({
        path: "deviceModelId",
        select: "name vendorId deviceTypeId",
        populate: [
          { path: "vendorId", select: "name" },
          { path: "deviceTypeId", select: "name" },
        ],
      })
      .populate("deviceTypeId", "name")
      .populate("userId", "firstName lastName")
      .select(
        "deviceModelId deviceTypeId userId serialNumber inventoryNumber status",
      )
      .sort({ inventoryNumber: 1 });

    // Тонкий DTO для секции «Устройства здесь»: имя, тип (id — чип-фасет),
    // номера, статус, кому выдано. Тип — из модели или прямой (самосборные).
    const devices = devicesRaw.map((d) => {
      const model = d.deviceModelId;
      const type = model?.deviceTypeId || d.deviceTypeId || null;
      return {
        _id: d._id,
        name:
          [model?.vendorId?.name, model?.name].filter(Boolean).join(" ") ||
          type?.name ||
          "Устройство",
        typeId: type?._id || null,
        typeName: type?.name || null,
        serialNumber: d.serialNumber || null,
        inventoryNumber: d.inventoryNumber || null,
        status: d.status || null,
        userName: d.userId
          ? [d.userId.firstName, d.userId.lastName].filter(Boolean).join(" ")
          : null,
      };
    });

    // Вложенные расположения с числом устройств (ср. buildEnvNode).
    const childIds = (location.children || []).map((child) => child._id);
    const countAgg = childIds.length
      ? await ClientDevice.aggregate([
          {
            $match: {
              locationId: { $in: childIds },
              deletedAt: null,
              parentDeviceId: null,
              ...deviceScopeMatch(scope),
            },
          },
          { $group: { _id: "$locationId", count: { $sum: 1 } } },
        ])
      : [];
    const countMap = new Map(countAgg.map((c) => [String(c._id), c.count]));
    const TYPE_ORDER = {
      building: 0,
      floor: 1,
      room: 2,
      workplace: 3,
      storage: 4,
    };
    const children = (location.children || [])
      .map((child) => ({
        _id: child._id,
        name: child.name,
        type: child.type,
        deviceCount: countMap.get(String(child._id)) || 0,
      }))
      .sort(
        (a, b) =>
          (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
          (a.name || "").localeCompare(b.name || "", "ru"),
      );

    // Предки root→родитель для крошек (без самого расположения).
    const chainDocs = await buildLocationChain(location);
    const ancestors = chainDocs
      .slice(0, -1)
      .map((node) => ({ _id: node._id, name: node.name, type: node.type }));

    res.status(200).json({
      location,
      ancestors,
      children,
      devices,
      deviceCount: devices.length,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Create new location
exports.add = async (req, res, next) => {
  try {
    const {
      name,
      type,
      company,
      subdivisions,
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      responsibilityRules,
      description,
      isPublic,
      tags,
      notes,
    } = req.body;

    const authedUser = req.auth?.legacy ?? null;

    // Validation: assignedUser only for workplace type
    if (type !== "workplace" && assignedUser) {
      return next(
        new AppError(
          "assignedUser can only be set for workplace type locations",
          400,
        ),
      );
    }

    if (type === "workplace" && !assignedUser) {
      return next(
        new AppError(
          "assignedUser is required for workplace type locations",
          400,
        ),
      );
    }

    // Компания из тела, иначе — компания автора (req.user не существует,
    // авторизованный приходит из токена выше).
    const targetCompanyId = company || authedUser.company?._id;

    // Check if user belongs to the same company
    if (assignedUser) {
      const user = await User.findById(assignedUser);
      // company у User — вложенный объект { _id, alias }; сравниваем по _id
      // (с фолбэком на сырой ObjectId для непопулированных/legacy данных).
      const userCompanyId = user?.company?._id || user?.company;
      if (!user || userCompanyId?.toString() !== targetCompanyId.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
    }

    // Check that every subdivision belongs to the same company
    if (subdivisions && subdivisions.length) {
      const subs = await Subdivision.find({ _id: { $in: subdivisions } });
      const allValid =
        subs.length === subdivisions.length &&
        subs.every(
          (s) => s.company.toString() === targetCompanyId.toString(),
        );
      if (!allValid) {
        return next(
          new AppError("Subdivision must belong to the same company", 400),
        );
      }
    }

    // Check if parent exists and belongs to the same company.
    // Не populate'им company: нужен только ObjectId для сравнения (у populated
    // документа .toString() ≠ id, из-за чего проверка ложно срабатывала).
    if (parent) {
      const parentLocation = await Location.findById(parent);
      const parentCompanyId =
        parentLocation?.company?._id || parentLocation?.company;
      if (
        !parentLocation ||
        parentCompanyId?.toString() !== targetCompanyId.toString()
      ) {
        return next(
          new AppError("Parent location must belong to the same company", 400),
        );
      }
    }

    const location = new Location({
      name,
      type,
      company: targetCompanyId,
      subdivisions: subdivisions || [],
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      responsibilityRules: responsibilityRules || {
        inheritFromParent: true,
        deviceTypeOverrides: [],
      },
      description,
      isPublic: isPublic || false,
      tags: tags || [],
      notes,
      createdBy: req.userId,
    });

    await location.save();

    // Populate the response
    await location.populate([
      { path: "company", select: "alias fullTitle" },
      {
        path: "subdivisions",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      },
      { path: "assignedUser", select: "firstName lastName email" },
      { path: "defaultResponsible", select: "firstName lastName email" },
      { path: "parent", select: "name type" },
    ]);

    res.status(201).json({
      message: "Расположение успешно создано",
      location,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(
        new AppError(
          "Location with this name already exists in the company",
          409,
        ),
      );
    }
    next(new AppError("Failed to create location", 500, true, error));
  }
};

// Update location
exports.update = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id).populate("company");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    const authedUser = req.auth?.legacy ?? null;

    const {
      name,
      type,
      company,
      subdivisions,
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      capacity,
      responsibilityRules,
      description,
      securityLevel,
      isActive,
      isAccessible,
      isPublic,
      tags,
      notes,
    } = req.body;

    // Validation: assignedUser only for workplace type
    if (type !== "workplace" && assignedUser) {
      return next(
        new AppError(
          "assignedUser can only be set for workplace type locations",
          400,
        ),
      );
    }

    if (type === "workplace" && !assignedUser) {
      return next(
        new AppError(
          "assignedUser is required for workplace type locations",
          400,
        ),
      );
    }

    // Назначаемый пользователь должен быть из той же компании. company может
    // меняться в этом же запросе — берём новое значение, иначе текущую компанию
    // локации (она populated). Сравнение по user.company._id (см. add).
    if (assignedUser) {
      const user = await User.findById(assignedUser);
      const userCompanyId = user?.company?._id || user?.company;
      const targetCompanyId =
        company || location.company?._id || location.company;
      if (!user || userCompanyId?.toString() !== targetCompanyId?.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
    }

    // Prevent creating circular references in parent-child relationships
    if (parent && parent.toString() === req.params.id) {
      return next(new AppError("Location cannot be its own parent", 400));
    }

    // Update fields
    if (name !== undefined) location.name = name;
    if (type !== undefined) location.type = type;
    if (company !== undefined) location.company = company;
    if (subdivisions !== undefined) location.subdivisions = subdivisions;
    if (parent !== undefined) location.parent = parent;
    if (assignedUser !== undefined) location.assignedUser = assignedUser;
    if (defaultResponsible !== undefined)
      location.defaultResponsible = defaultResponsible;
    if (address !== undefined) location.address = address;
    if (coordinates !== undefined) location.coordinates = coordinates;
    if (capacity !== undefined) location.capacity = capacity;
    if (responsibilityRules !== undefined)
      location.responsibilityRules = responsibilityRules;
    if (description !== undefined) location.description = description;
    if (securityLevel !== undefined) location.securityLevel = securityLevel;
    if (isActive !== undefined) location.isActive = isActive;
    if (isAccessible !== undefined) location.isAccessible = isAccessible;
    if (isPublic !== undefined) location.isPublic = isPublic;
    if (tags !== undefined) location.tags = tags;
    if (notes !== undefined) location.notes = notes;

    location.updatedBy = authedUser._id;

    await location.save();

    // Populate the response
    await location.populate([
      { path: "subdivisions", select: "name manager" },
      { path: "assignedUser", select: "firstName lastName email" },
      { path: "defaultResponsible", select: "firstName lastName email" },
      { path: "parent", select: "name type" },
    ]);

    res.status(200).json({
      message: "Расположение успешно обновлено",
      location,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Кандидаты на привязку устройства к пользователю по правилам расположения:
//  • рабочее место с назначенным сотрудником → только он (и по умолчанию);
//  • есть подразделение → только его сотрудники, руководитель по умолчанию и с
//    пометкой isSubdivisionManager;
//  • иначе → все активные пользователи компании.
exports.getAssignableUsers = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id)
      .populate("assignedUser", "firstName lastName email")
      .populate({ path: "subdivisions", select: "name manager users" });

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Состав чужой компании клиенту не отдаём (см. getOne).
    const scope = companyScope(req);
    if (scope && !scope.includes(idOf(location.company))) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    const toDTO = (u, isManager = false) => ({
      _id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      isSubdivisionManager: isManager,
    });

    // 1) Рабочее место с назначенным сотрудником → только он.
    if (location.type === "workplace" && location.assignedUser) {
      const u = location.assignedUser;
      return res.status(200).json({
        users: [toDTO(u)],
        defaultUserId: u._id,
        single: true,
      });
    }

    // 2) Есть подразделения → их сотрудники, руководители по умолчанию/с пометкой.
    const subs = location.subdivisions || [];
    if (subs.length) {
      const managerIds = new Set(
        subs.filter((s) => s.manager).map((s) => s.manager.toString()),
      );

      // Состав: по полю user.subdivision (любое из подразделений локации) ИЛИ из
      // массива sub.users, плюс сами руководители. Только активные.
      const extraIds = new Set();
      subs.forEach((sub) =>
        (sub.users || []).forEach((id) => extraIds.add(id.toString())),
      );
      managerIds.forEach((id) => extraIds.add(id));

      const subIds = subs.map((s) => s._id);
      const employees = await User.find({
        banned: { $ne: true },
        "company.isActive": { $ne: false },
        $or: [
          { subdivision: { $in: subIds } },
          { _id: { $in: Array.from(extraIds) } },
        ],
      }).select("firstName lastName email");

      const seen = new Set();
      const users = [];
      for (const u of employees) {
        const id = u._id.toString();
        if (seen.has(id)) continue;
        seen.add(id);
        users.push(toDTO(u, managerIds.has(id)));
      }
      // руководителей — в начало списка
      users.sort(
        (a, b) =>
          (b.isSubdivisionManager ? 1 : 0) - (a.isSubdivisionManager ? 1 : 0),
      );

      // По умолчанию — руководитель первого подразделения с руководителем.
      const defaultUserId =
        subs.find((s) => s.manager)?.manager?.toString() || null;

      return res.status(200).json({
        users,
        defaultUserId,
        single: false,
      });
    }

    // 3) Без подразделения → все активные пользователи компании.
    const companyUsers = await User.find({
      banned: { $ne: true },
      "company.isActive": { $ne: false },
      "company._id": location.company,
    }).select("firstName lastName email");

    return res.status(200).json({
      users: companyUsers.map((u) => toDTO(u)),
      defaultUserId: null,
      single: false,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch assignable users for location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Soft delete location
exports.delete = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id).populate("company");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Расположение с устройствами не удаляем (живые поля locationId/deletedAt —
    // старая проверка по location/isDeleted всегда пропускала). Сообщение
    // уходит в тост как есть.
    const deviceCount = await ClientDevice.countDocuments({
      locationId: req.params.id,
      deletedAt: null,
    });

    if (deviceCount > 0) {
      return next(
        new AppError(
          `В расположении есть устройства (${deviceCount}) — сначала переместите их`,
          400,
        ),
      );
    }

    // Check if location has children
    if (location.children && location.children.length > 0) {
      return next(
        new AppError(
          "У расположения есть вложенные расположения — сначала удалите или перенесите их",
          400,
        ),
      );
    }

    await location.deleteOne();

    res.status(200).json({
      message: "Расположение успешно удалено",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to delete location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Get workplaces for a specific user
// Окружение заявителя: рабочее место + цепочка вверх (здание→этаж→помещение→
// рабочее место) с техникой и дочерними узлами на каждом уровне, плюс личная
// техника пользователя. Питает zoom-виджет «Окружение» в карточке заявки.
// Если рабочее место не сопоставлено — отдаём только личную технику (chain:null).
exports.getUserEnvironment = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      "firstName lastName company",
    );
    if (!user) {
      return next(new AppError(`User with id ${userId} not found`, 404));
    }

    // Окружение сотрудника чужой компании — не наше дело (см. getOne).
    const scope = companyScope(req);
    if (scope && !scope.includes(idOf(user.company))) {
      return next(new AppError(`User with id ${userId} not found`, 404));
    }

    // Только не удалённые самостоятельные единицы (без комплектующих сборок).
    const deviceFilter = { deletedAt: null, parentDeviceId: null };

    // Личная техника (по userId) — показывается всегда, даже без рабочего места.
    const personalDevicesRaw = await ClientDevice.find({
      ...deviceFilter,
      userId,
    }).populate(ENV_DEVICE_POPULATE);
    const personalMikroMap = await buildMikrotikStatusMap(
      personalDevicesRaw.map((d) => d._id),
    );
    const personalDevices = personalDevicesRaw.map((d) =>
      toEnvDevice(d, userId, personalMikroMap),
    );

    // Рабочее место (workplace с assignedUser=userId). populate parent/subdivision.
    const workplaces = await Location.getUserWorkplaces(userId);
    const workplace = workplaces[0] || null;

    if (!workplace) {
      return res.status(200).json({
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        workplace: null,
        workplaceCount: 0,
        chain: null,
        personalDevices,
      });
    }

    // Цепочка root→leaf (общий хелпер с окружением по устройству).
    const chainDocs = await buildLocationChain(workplace);

    // На каждом узле — устройства и дочерние локации (общий хелпер).
    const chain = [];
    for (const node of chainDocs) {
      chain.push(await buildEnvNode(node, userId, scope));
    }

    res.status(200).json({
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      workplace: { _id: workplace._id, name: workplace.name },
      workplaceCount: workplaces.length,
      chain,
      personalDevices,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch environment for user ${req.params.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Узел окружения по id локации — для свободной навигации в виджете «Окружение»
// (клик по любому дочернему расположению, не только по ветке заявителя). userId
// в query — чтобы проставить слой isPersonal на технике относительно заявителя.
exports.getLocationNode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    // `company` в выборке — для скоупа клиента (см. getOne).
    const location = await Location.findById(id)
      .select("name type subdivisions company")
      .populate("subdivisions", "name");
    if (!location) {
      return next(new AppError(`Location with id ${id} not found`, 404));
    }

    const scope = companyScope(req);
    if (scope && !scope.includes(idOf(location.company))) {
      return next(new AppError(`Location with id ${id} not found`, 404));
    }

    const node = await buildEnvNode(location, userId, scope);
    res.status(200).json(node);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch location node ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Окружение по УСТРОЙСТВУ — для заявок мониторинга (их автор — служебный
// applicant без рабочего места, поэтому окружение по заявителю пусто):
// устройство → его расположение → цепочка вверх. Слой isPersonal смысла не
// имеет — userId передаём null. Удалённое устройство по-прежнему резолвится
// (старые заявки должны открываться), но помечается флагом deleted.
exports.getDeviceEnvironment = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    const device =
      await ClientDevice.findById(deviceId).populate(ENV_DEVICE_POPULATE);
    if (!device) {
      return next(new AppError(`Device with id ${deviceId} not found`, 404));
    }

    // Устройство чужой компании (и устройство без компании — принадлежность
    // недоказуема) клиенту не показываем (см. getOne).
    const scope = companyScope(req);
    if (scope && !scope.includes(idOf(device.companyId))) {
      return next(new AppError(`Device with id ${deviceId} not found`, 404));
    }

    const mikroMap = await buildMikrotikStatusMap([device._id]);
    const deviceDto = {
      ...toEnvDevice(device, null, mikroMap),
      deleted: !!device.deletedAt,
    };

    const locationId = device.locationId?._id || device.locationId;
    if (!locationId) {
      return res.status(200).json({ device: deviceDto, chain: null });
    }

    const leaf = await Location.findById(locationId)
      .select("name type parent subdivisions")
      .populate("subdivisions", "name");
    if (!leaf) {
      return res.status(200).json({ device: deviceDto, chain: null });
    }

    const chainDocs = await buildLocationChain(leaf);
    const chain = [];
    for (const node of chainDocs) {
      chain.push(await buildEnvNode(node, null, scope));
    }

    res.status(200).json({ device: deviceDto, chain });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch environment for device ${req.params.deviceId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Окружение КОМПАНИИ — вход виджета на её карточке: корневые расположения
// (здания/склады) со счётчиками по всему поддереву. Дальше навигация идёт
// обычным getLocationNode. Счёт поддеревьев — в памяти по одному запросу
// локаций и одной агрегации устройств (без $graphLookup на каждый корень).
exports.getCompanyEnvironment = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    // Чужая компания — «не найдено» (см. getOne).
    const scope = companyScope(req, [companyId]);
    if (scope && !scope.length) {
      return next(new AppError(`Company with id ${companyId} not found`, 404));
    }

    const company = await Company.findById(companyId).select("alias");
    if (!company) {
      return next(new AppError(`Company with id ${companyId} not found`, 404));
    }

    const locations = await Location.find({
      company: companyId,
      isActive: true,
    }).select("name type parent");

    const countAgg = locations.length
      ? await ClientDevice.aggregate([
          {
            $match: {
              locationId: { $in: locations.map((l) => l._id) },
              deletedAt: null,
              parentDeviceId: null,
            },
          },
          { $group: { _id: "$locationId", count: { $sum: 1 } } },
        ])
      : [];
    const countMap = new Map(countAgg.map((c) => [String(c._id), c.count]));

    const childrenMap = new Map();
    locations.forEach((l) => {
      if (!l.parent) return;
      const key = String(l.parent);
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key).push(l);
    });

    // Корень = узел без родителя в наборе компании (повисшие ветки не теряем)
    const ids = new Set(locations.map((l) => String(l._id)));
    const roots = locations.filter(
      (l) => !l.parent || !ids.has(String(l.parent)),
    );

    const TYPE_ORDER = { building: 0, storage: 1, floor: 2, room: 3, workplace: 4 };
    const buildings = roots
      .map((root) => {
        let deviceTotal = 0;
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          deviceTotal += countMap.get(String(node._id)) || 0;
          (childrenMap.get(String(node._id)) || []).forEach((child) =>
            stack.push(child),
          );
        }
        return {
          _id: root._id,
          name: root.name,
          type: root.type,
          childCount: (childrenMap.get(String(root._id)) || []).length,
          deviceTotal,
        };
      })
      .sort(
        (a, b) =>
          (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
          (a.name || "").localeCompare(b.name || "", "ru"),
      );

    res.status(200).json({
      company: { _id: company._id, name: company.alias },
      buildings,
      deviceTotal: buildings.reduce((sum, b) => sum + b.deviceTotal, 0),
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch environment for company ${req.params.companyId}`,
        500,
        true,
        error,
      ),
    );
  }
};

const TECH_TYPE_ORDER = {
  building: 0,
  floor: 1,
  room: 2,
  workplace: 3,
  storage: 4,
};

// Плоский список техники КОМПАНИИ — вид «Список» секции «Техника» на её
// карточке: устройства всех расположений компании + закреплённые лично за её
// пользователями. Порядок — обходом иерархии расположений (здание → этаж →
// помещение → РМ), техника читается «сверху вниз»; личная без расположения — в
// конце. DTO строки = toEnvDevice, чтобы шторка устройства работала без
// дозапроса.
exports.getCompanyTech = async (req, res, next) => {
  try {
    const { companyId } = req.params;

    // Чужая компания — «не найдено» (см. getOne).
    const scope = companyScope(req, [companyId]);
    if (scope && !scope.length) {
      return next(new AppError(`Company with id ${companyId} not found`, 404));
    }

    const company = await Company.findById(companyId).select("alias");
    if (!company) {
      return next(new AppError(`Company with id ${companyId} not found`, 404));
    }

    const locations = await Location.find({
      company: companyId,
      isActive: true,
    }).select("name type parent");
    const companyUsers = await User.find({ company: companyId }).select("_id");

    const devicesRaw = await ClientDevice.find({
      deletedAt: null,
      parentDeviceId: null,
      // Расположение компании может быть публичным и держать чужую технику —
      // клиенту она не видна (см. deviceScopeMatch).
      ...deviceScopeMatch(scope),
      $or: [
        { locationId: { $in: locations.map((l) => l._id) } },
        { userId: { $in: companyUsers.map((u) => u._id) } },
      ],
    }).populate(ENV_DEVICE_POPULATE);

    const mikroMap = await buildMikrotikStatusMap(devicesRaw.map((d) => d._id));
    const devices = devicesRaw.map((d) => toEnvDevice(d, null, mikroMap));

    // Порядковый номер каждой локации при DFS-обходе леса компании
    const childrenMap = new Map();
    const ids = new Set(locations.map((l) => String(l._id)));
    const roots = [];
    locations.forEach((l) => {
      const pid = l.parent ? String(l.parent) : null;
      if (pid && ids.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(l);
      } else {
        roots.push(l);
      }
    });
    const byTypeName = (a, b) =>
      (TECH_TYPE_ORDER[a.type] ?? 9) - (TECH_TYPE_ORDER[b.type] ?? 9) ||
      (a.name || "").localeCompare(b.name || "", "ru");
    const locOrder = new Map();
    const walk = (nodes) => {
      [...nodes].sort(byTypeName).forEach((node) => {
        locOrder.set(String(node._id), locOrder.size);
        walk(childrenMap.get(String(node._id)) || []);
      });
    };
    walk(roots);

    devices.sort(
      (a, b) =>
        (locOrder.get(String(a.locationId)) ?? Infinity) -
          (locOrder.get(String(b.locationId)) ?? Infinity) ||
        (a.name || "").localeCompare(b.name || "", "ru"),
    );

    res.status(200).json({
      company: { _id: company._id, name: company.alias },
      devices,
      total: devices.length,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch tech for company ${req.params.companyId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Метка группы техники «уровнем выше» по типу родителя рабочего места.
const PARENT_GROUP_LABEL = {
  room: "В помещении",
  floor: "На этаже",
  building: "В здании",
  storage: "На складе",
};

// Техника ПОЛЬЗОВАТЕЛЯ для секции «Техника» его карточки, тремя источниками:
// закреплённая лично (★), техника его рабочего места и — уровнем выше — прямая
// техника родителя РМ (общие принтеры/МФУ помещения). Группы собирает бэкенд:
// «Личная и рабочее место» и «В помещении — X»; дубли (личное, стоящее на РМ)
// не повторяются.
/**
 * Своё рабочее место — блок «Моё рабочее место» на главной клиента.
 *
 * Отдельно от getUserTech, потому что весь /inventory смонтирован за
 * `canUseInventoryModule`, а этого права нет **ни у одного из 676 клиентов** и
 * быть не должно: оно открывает раздел «Устройства» целиком. Но собственный
 * стол — не модуль учёта техники, и спрашивать за него право, выданное
 * инженерам, неправильно.
 *
 * Скоуп жёсткий: id берётся из токена, параметра нет — подставить чужой
 * нечем.
 */
exports.getMyTech = async (req, res, next) => {
  const authedUser = req.auth?.legacy ?? null;
  req.params = { ...req.params, userId: authedUser._id.toString() };
  return exports.getUserTech(req, res, next);
};

exports.getUserTech = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      "firstName lastName company",
    );
    if (!user) {
      return next(new AppError(`User with id ${userId} not found`, 404));
    }

    // Техника сотрудника чужой компании клиенту не видна (см. getOne). Своё
    // рабочее место проходит всегда: в getMyTech id приходит из токена, и
    // отказывать человеку в его собственном столе из-за пустой компании в
    // учётке было бы регрессией «Моего рабочего места».
    const scope = companyScope(req);
    if (
      scope &&
      idOf(user._id) !== req.auth.userId &&
      !scope.includes(idOf(user.company))
    ) {
      return next(new AppError(`User with id ${userId} not found`, 404));
    }

    const deviceFilter = { deletedAt: null, parentDeviceId: null };
    const workplaces = await Location.getUserWorkplaces(userId);
    const workplace = workplaces[0] || null;
    const parent = workplace?.parent || null;

    const ownRaw = await ClientDevice.find({
      ...deviceFilter,
      $or: [
        { userId },
        ...(workplace ? [{ locationId: workplace._id }] : []),
      ],
    }).populate(ENV_DEVICE_POPULATE);

    const ownIds = new Set(ownRaw.map((d) => String(d._id)));
    const parentRaw = parent
      ? (
          await ClientDevice.find({
            ...deviceFilter,
            locationId: parent._id,
          }).populate(ENV_DEVICE_POPULATE)
        ).filter((d) => !ownIds.has(String(d._id)))
      : [];

    const mikroMap = await buildMikrotikStatusMap(
      [...ownRaw, ...parentRaw].map((d) => d._id),
    );
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "ru");
    const own = ownRaw.map((d) => toEnvDevice(d, userId, mikroMap)).sort(byName);
    const nearby = parentRaw
      .map((d) => toEnvDevice(d, userId, mikroMap))
      .sort(byName);

    const groups = [];
    if (own.length) {
      groups.push({
        key: "own",
        label: workplace ? "Личная и рабочее место" : "Закреплено лично",
        devices: own,
      });
    }
    if (nearby.length) {
      groups.push({
        key: "nearby",
        label: `${PARENT_GROUP_LABEL[parent.type] || "Рядом"} — ${parent.name}`,
        devices: nearby,
      });
    }

    res.status(200).json({
      user: { _id: user._id, firstName: user.firstName, lastName: user.lastName },
      workplace: workplace
        ? { _id: workplace._id, name: workplace.name }
        : null,
      groups,
      total: own.length + nearby.length,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch tech for user ${req.params.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

