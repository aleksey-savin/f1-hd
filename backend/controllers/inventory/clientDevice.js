const mongoose = require("mongoose");

const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceType = require("../../models/inventory/deviceType");
const Vendor = require("../../models/inventory/vendor");
const Location = require("../../models/inventory/location");
const Counter = require("../../models/inventory/counter");
const Mikrotik = require("../../models/mikrotik");
const { Ticket } = require("../../models/ticket");

const { createPhotoHandlers, deleteAllPhotos } = require("./photoHandlers");
const { AppError } = require("../../middleware/errorHandling");
const {
  buildMikrotikStatusMap,
  mikrotikOverlay,
} = require("../../helpers/mikrotikOverlay");

// Каталог статусов — из схемы, чтобы второй копии списка не заводить.
const DEVICE_STATUSES = ClientDevice.schema.path("status").enumValues;

// Shared populate graph: model (+ its vendor & type), company, location, user.
// Снимки модели тянем только там, где они действительно нужны (карточка
// устройства): в списке это лишний вес на каждой строке.
const devicePopulate = ({ withModelPhotos = false } = {}) => [
  {
    path: "deviceModelId",
    select: `name vendorId deviceTypeId${withModelPhotos ? " photos" : ""}`,
    populate: [
      // Флаг вендора нужен странице устройства: показывать ли вкладку
      // «Мониторинг» (устройство управляемо, даже если ещё не подключено).
      { path: "vendorId", select: "name isMikrotikManagementEnabled" },
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

const DEVICE_POPULATE = devicePopulate();

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

// Эффективный тип устройства: у заводской сборки берём из модели, у самосборной —
// напрямую. Принимает «сырой» документ (deviceModelId/deviceTypeId — ObjectId).
const getEffectiveTypeId = async (device) => {
  if (device.deviceModelId) {
    const model =
      await DeviceModel.findById(device.deviceModelId).select("deviceTypeId");
    return model?.deviceTypeId || null;
  }
  return device.deviceTypeId || null;
};

// Тот же расчёт для populated-документа (deviceModelId.deviceTypeId раскрыт).
const populatedTypeId = (d) =>
  d.deviceModelId?.deviceTypeId?._id ||
  d.deviceModelId?.deviceTypeId ||
  d.deviceTypeId?._id ||
  d.deviceTypeId ||
  null;

// ─── Список устройств: серверная выборка ──────────────────────────────────
//
// Поиск, фасеты, сортировка и постраничность считает БД (клиентский поиск
// несовместим с пагинацией, а реестр активов растёт вместе с парком клиентов).
// Порядок разделов ниже повторяет controllers/user.js getAll — это тот же
// канон списка на серверной выборке.

const LIST_PAGE_LIMIT_DEFAULT = 50;
const LIST_PAGE_LIMIT_MAX = 100;

// Синтетический «производитель» — бакет самосборной техники без модели.
// Значение синхронно с фронтом (components/ClientDevice/device-status.js).
const CUSTOM_VENDOR_BUCKET = "__custom__";

// Populate строки списка: только то, что рисует строка. Конфигурация,
// поставщик, заметки и фото на карточке — в списке это лишний вес.
const LIST_POPULATE = [
  {
    path: "deviceModelId",
    select: "name vendorId deviceTypeId",
    populate: [
      { path: "vendorId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
  { path: "deviceTypeId", select: "name" },
  { path: "companyId", select: "alias fullTitle" },
  { path: "locationId", select: "name" },
  { path: "userId", select: "firstName lastName" },
  // Хозяин сборки — только у комплектующих: строка помечает, внутри чего деталь.
  {
    path: "parentDeviceId",
    select: "inventoryNumber deviceModelId deviceTypeId",
    populate: [
      { path: "deviceModelId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Собственные текстовые поля устройства (по связям ищем предзапросами ниже).
const DEVICE_SEARCH_FIELDS = [
  "inventoryNumber",
  "serialNumber",
  "hostname",
  "ipAddress",
  "macAddress",
  "operatingSystem",
];

const toIdList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => mongoose.isValidObjectId(entry))
    .map((entry) => new mongoose.Types.ObjectId(entry));

const toValueList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

// Строка списка — тот же принцип, что у toEnvDevice окружения: DTO собирает
// сервер, строка на клиенте ничего не вычисляет. Имя — из модели или прямого
// типа (самосборные), тип — эффективный (модельный приоритетнее).
const toListDevice = (device, { componentCount = 0, mikro = null } = {}) => {
  const model = device.deviceModelId;
  const type = model?.deviceTypeId || device.deviceTypeId;
  const user = device.userId;
  return {
    _id: device._id,
    name: model?.name || type?.name || "Устройство",
    typeId: type?._id || null,
    typeName: type?.name || null,
    vendorName: model?.vendorId?.name || null,
    inventoryNumber: device.inventoryNumber || null,
    serialNumber: device.serialNumber || null,
    hostname: device.hostname || null,
    ipAddress: device.ipAddress || null,
    status: device.status || null,
    company: device.companyId
      ? {
          _id: device.companyId._id,
          name: device.companyId.alias || device.companyId.fullTitle || "—",
        }
      : null,
    location: device.locationId
      ? { _id: device.locationId._id, name: device.locationId.name }
      : null,
    user: user
      ? {
          _id: user._id,
          name:
            [user.lastName, user.firstName].filter(Boolean).join(" ").trim() ||
            "—",
        }
      : null,
    componentCount,
    // Комплектующее: своей строкой в списке оно бывает только по запросу
    // (поиск или свитч фильтра), и тогда обязано назвать хозяина.
    parent: device.parentDeviceId
      ? {
          _id: device.parentDeviceId._id,
          name:
            device.parentDeviceId.deviceModelId?.name ||
            device.parentDeviceId.deviceTypeId?.name ||
            "Сборка",
          inventoryNumber: device.parentDeviceId.inventoryNumber || null,
        }
      : null,
    ...mikrotikOverlay(mikro),
    // ListRow подсвечивает свежесозданные и только что изменённые строки —
    // без отметок времени подсветка тихо гаснет.
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
};

// Совпадений нет вовсе (клиент без компании, фасет вне скоупа). Пустой $in —
// а не null: companyId у устройства необязателен, и null отдал бы всю технику
// без компании.
const MATCHES_NOTHING = { $in: [] };

/**
 * Условие видимости — в самом запросе, а не фильтрацией в памяти.
 * Конечный пользователь заперт в своей компании поверх любых фасетов: доступ к
 * модулю («Учёт техники») открывает раздел, а объём данных определяет роль —
 * как в архиве работ (controllers/work.js getFinished).
 */
const scopeMatch = ({ isEndUser, company }) =>
  isEndUser ? { companyId: company?._id || MATCHES_NOTHING } : {};

/**
 * Условия выборки без статуса: статус нужен отдельно, потому что счётчики
 * ленты парка считаются по набору БЕЗ него — фасет, обнуляющий сам себя,
 * показывал бы «В ремонте · 0» сразу после выбора «В ремонте».
 */
/**
 * Комплектующие показываются, КОГДА ИХ СПРОСИЛИ: поиском (прицельный вопрос
 * «где эта железка» — ищем по всему учёту, иначе реестр отвечает «ничего не
 * нашлось» про то, что в нём есть) или свитчем фильтра (просмотр «покажи все
 * модули памяти»). Без запроса список — реестр самостоятельных единиц.
 */
const wantsComponents = (query) =>
  query.withComponents === "true" || Boolean(String(query.search || "").trim());

const buildListMatch = async (query, authedUser) => {
  const searchTerm = String(query.search || "").trim();
  const withComponents = wantsComponents(query);

  const match = {
    deletedAt: null,
    ...(withComponents ? {} : { parentDeviceId: null }),
  };
  const and = [];

  const companies = toIdList(query.companies);
  const scopedCompanyId = authedUser.isEndUser
    ? authedUser.company?._id || null
    : null;
  if (authedUser.isEndUser) {
    // Скоуп сильнее фасета: клиент, подставивший в запрос чужую компанию,
    // не увидит ничего.
    const withinScope =
      scopedCompanyId &&
      (!companies.length ||
        companies.some((id) => id.equals(scopedCompanyId)));
    match.companyId = withinScope ? scopedCompanyId : MATCHES_NOTHING;
  } else if (companies.length) {
    match.companyId = { $in: companies };
  }

  const locations = toIdList(query.locations);
  if (locations.length) match.locationId = { $in: locations };

  // Пробел учёта: единица без инвентарного номера. Счётчик такой техники
  // показывает лента парка, и он же её отбирает — число, по которому нельзя
  // кликнуть, только раздражает.
  if (query.noInventory === "true") {
    and.push({ $or: [{ inventoryNumber: null }, { inventoryNumber: "" }] });
  }

  const users = toIdList(query.users);
  if (users.length) match.userId = { $in: users };

  // Тип эффективный: у заводской сборки берётся из модели, у самосборной —
  // прямой. Модели нужного типа резолвим предзапросом — так основной запрос
  // остаётся индексируемым, без $lookup по всей коллекции.
  const types = toIdList(query.types);
  if (types.length) {
    const models = await DeviceModel.find({
      deviceTypeId: { $in: types },
      deletedAt: null,
    }).select("_id");
    and.push({
      $or: [
        { deviceTypeId: { $in: types } },
        { deviceModelId: { $in: models.map((model) => model._id) } },
      ],
    });
  }

  // Производитель: живёт на модели; «Кастомная сборка» — устройства без модели.
  const vendorValues = toValueList(query.vendors);
  if (vendorValues.length) {
    const vendorIds = vendorValues
      .filter((value) => mongoose.isValidObjectId(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const or = [];
    if (vendorIds.length) {
      const models = await DeviceModel.find({
        vendorId: { $in: vendorIds },
        deletedAt: null,
      }).select("_id");
      or.push({ deviceModelId: { $in: models.map((model) => model._id) } });
    }
    if (vendorValues.includes(CUSTOM_VENDOR_BUCKET)) {
      or.push({ deviceModelId: null });
    }
    and.push(or.length ? { $or: or } : { _id: null });
  }

  // Поиск: каждый терм должен встретиться хотя бы в одном поле — своём или
  // связанном (модель, вендор, тип, компания, расположение, сотрудник). Связи
  // резолвим предзапросами по маленьким каталогам: regex по $lookup-полю
  // означал бы скан всей коллекции устройств.
  const terms = searchTerm
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  for (const term of terms) {
    const rx = new RegExp(escapeRegex(term.slice(0, 64)), "i");
    const [models, typeDocs, companies_, locationDocs, userDocs, vendors] =
      await Promise.all([
        DeviceModel.find({ name: rx, deletedAt: null }).select("_id"),
        DeviceType.find({ name: rx }).select("_id"),
        Company.find({ $or: [{ alias: rx }, { fullTitle: rx }] }).select("_id"),
        Location.find({ name: rx }).select("_id"),
        User.find({ $or: [{ firstName: rx }, { lastName: rx }] }).select("_id"),
        Vendor.find({ name: rx }).select("_id"),
      ]);
    const byVendor = vendors.length
      ? await DeviceModel.find({
          vendorId: { $in: vendors.map((vendor) => vendor._id) },
          deletedAt: null,
        }).select("_id")
      : [];
    const typeIds = typeDocs.map((type) => type._id);
    const modelIds = [...models, ...byVendor].map((model) => model._id);
    const modelsOfType = typeIds.length
      ? await DeviceModel.find({
          deviceTypeId: { $in: typeIds },
          deletedAt: null,
        }).select("_id")
      : [];

    and.push({
      $or: [
        ...DEVICE_SEARCH_FIELDS.map((field) => ({ [field]: rx })),
        { deviceModelId: { $in: [...modelIds, ...modelsOfType.map((m) => m._id)] } },
        { deviceTypeId: { $in: typeIds } },
        { companyId: { $in: companies_.map((company) => company._id) } },
        { locationId: { $in: locationDocs.map((location) => location._id) } },
        { userId: { $in: userDocs.map((user) => user._id) } },
      ],
    });
  }

  if (and.length) match.$and = and;
  return match;
};

/**
 * E11000 → человеческая 409 вместо «Failed to add device» с 500.
 *
 * Уникальны инвентарный номер, имя в сети (в пределах компании) и machineId —
 * конфликт по ним означает ровно одно: значение уже занято. Серийника здесь нет
 * намеренно: он не уникален (см. модель). Отдельная подстраховка на базе, где не
 * прогнан `scripts/migrateClientDeviceIndexes.js`: старый уникальный
 * `serialNumber_1` там ещё жив, и из ответа должно быть понятно, что чинить
 * (см. docs/inventory.md §7).
 */
const DUPLICATE_FIELDS = {
  inventoryNumber: "инвентарным номером",
  hostname: "именем в сети",
  machineId: "идентификатором машины",
};

const duplicateError = (error) => {
  if (error?.code !== 11000) return null;
  const field = Object.keys(error.keyPattern || {}).find(
    (key) => DUPLICATE_FIELDS[key],
  );
  if (!field) {
    // Чаще всего это устаревший уникальный serialNumber_1 на непромигрированной
    // базе — называем скрипт, а не отдаём «Такая запись уже существует».
    const stale = Object.keys(error.keyPattern || {}).join(", ");
    return new AppError(
      `Конфликт уникальности по полю «${stale}». Если это серийный номер — на базе не прогнан scripts/migrateClientDeviceIndexes.js.`,
      409,
    );
  }
  const value = error.keyValue?.[field];
  if (value == null) {
    return new AppError(
      `В базе устаревший уникальный индекс по полю «${field}»: второе устройство без значения он не пропускает. Прогоните scripts/migrateClientDeviceIndexes.js.`,
      409,
    );
  }
  return new AppError(
    `Устройство с таким ${DUPLICATE_FIELDS[field]} (${value}) уже есть`,
    409,
  );
};

exports.getAll = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const q = req.query;

    const baseMatch = await buildListMatch(q, authedUser);
    const statuses = toValueList(q.statuses).filter((status) =>
      DEVICE_STATUSES.includes(status),
    );
    const match = statuses.length
      ? { ...baseMatch, status: { $in: statuses } }
      : baseMatch;

    const limit = Math.min(
      Number(q.limit) || LIST_PAGE_LIMIT_DEFAULT,
      LIST_PAGE_LIMIT_MAX,
    );
    const page = Math.max(Number(q.page) || 1, 1);

    // Сортировки — только по собственным полям устройства: порядок по
    // связанному имени потребовал бы $lookup всей выборки на каждый запрос.
    const sortKey = q.sort === "inventory" ? "inventory" : "created";
    const pipeline = [{ $match: match }];
    if (sortKey === "inventory") {
      // Техника без номера — в конце: пустая метка это пробел учёта, но не
      // повод открывать им список.
      pipeline.push({
        $addFields: {
          _noInventory: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ["$inventoryNumber", ""] } }, 0] },
              0,
              1,
            ],
          },
        },
      });
      pipeline.push({ $sort: { _noInventory: 1, inventoryNumber: 1, _id: -1 } });
    } else {
      pipeline.push({ $sort: { _id: -1 } });
    }
    pipeline.push(
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          companyId: 1,
          userId: 1,
          locationId: 1,
          deviceModelId: 1,
          deviceTypeId: 1,
          parentDeviceId: 1,
          status: 1,
          inventoryNumber: 1,
          serialNumber: 1,
          hostname: 1,
          ipAddress: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );

    const [rows, total, componentsCount, [facetCounts]] = await Promise.all([
      ClientDevice.aggregate(pipeline),
      ClientDevice.countDocuments(match),
      // Сколько из найденного — детали внутри сборок: строка над списком
      // объясняет, почему сумма ленты парка меньше счётчика. Когда деталей в
      // выборке нет по условию, считать нечего (иначе ключ parentDeviceId в
      // литерале перетёр бы ограничение match и посчитал бы все детали учёта).
      wantsComponents(q)
        ? ClientDevice.countDocuments({
            ...match,
            parentDeviceId: { $ne: null },
          })
        : 0,
      // Лента парка: счётчики стадий и пробелов учёта — по всей выборке без
      // фасета статуса, поэтому агрегат идёт по baseMatch. Комплектующие в них
      // не входят НИКОГДА: они наследуют статус хозяина, и сложить их со
      // сборками значило бы удвоить парк (расхождение подписано над списком).
      ClientDevice.aggregate([
        { $match: { ...baseMatch, parentDeviceId: null } },
        {
          $facet: {
            byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
            noInventoryNumber: [
              {
                $match: {
                  $or: [{ inventoryNumber: null }, { inventoryNumber: "" }],
                },
              },
              { $count: "n" },
            ],
          },
        },
      ]),
    ]);

    await ClientDevice.populate(rows, LIST_POPULATE);

    const ids = rows.map((row) => row._id);
    const [componentCounts, mikroMap] = await Promise.all([
      ClientDevice.aggregate([
        { $match: { deletedAt: null, parentDeviceId: { $in: ids } } },
        { $group: { _id: "$parentDeviceId", n: { $sum: 1 } } },
      ]),
      buildMikrotikStatusMap(ids),
    ]);
    const componentMap = new Map(
      componentCounts.map((entry) => [String(entry._id), entry.n]),
    );

    const statusCounts = Object.fromEntries(
      (facetCounts?.byStatus || [])
        .filter((entry) => entry._id)
        .map((entry) => [entry._id, entry.n]),
    );

    res.status(200).json({
      devices: rows.map((row) =>
        toListDevice(row, {
          componentCount: componentMap.get(String(row._id)) || 0,
          mikro: mikroMap.get(String(row._id)) || null,
        }),
      ),
      total,
      componentsCount,
      page,
      pageSize: limit,
      statusCounts,
      noInventoryNumber: facetCounts?.noInventoryNumber?.[0]?.n || 0,
    });
  } catch (error) {
    next(new AppError("Failed to fetch devices", 500, true, error));
  }
};

/**
 * Опции фасетов фильтра — только то, что реально есть в видимом парке
 * (фильтр сужает существующее, а не предлагает пустые значения). Один проход
 * по выборке + короткие запросы за названиями.
 */
exports.getFacets = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    // Комплектующие входят в опции: без них в фасете типов не было бы
    // «Оперативной памяти», и свитч «показывать комплектующие» не с чем было бы
    // складывать.
    const match = {
      deletedAt: null,
      ...scopeMatch(authedUser),
    };

    const [groups] = await ClientDevice.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "devicemodels",
          localField: "deviceModelId",
          foreignField: "_id",
          as: "_model",
          pipeline: [{ $project: { deviceTypeId: 1, vendorId: 1 } }],
        },
      },
      {
        $addFields: {
          _typeId: {
            $ifNull: [
              { $arrayElemAt: ["$_model.deviceTypeId", 0] },
              "$deviceTypeId",
            ],
          },
          _vendorId: { $arrayElemAt: ["$_model.vendorId", 0] },
        },
      },
      {
        $facet: {
          companies: [{ $group: { _id: "$companyId" } }],
          users: [{ $group: { _id: "$userId" } }],
          // Расположение несёт компанию: фильтр показывает расположения
          // выбранных компаний, каскад считается на клиенте без дозапроса.
          locations: [
            { $group: { _id: "$locationId", company: { $first: "$companyId" } } },
          ],
          types: [{ $group: { _id: "$_typeId" } }],
          vendors: [{ $group: { _id: "$_vendorId" } }],
          custom: [{ $match: { deviceModelId: null } }, { $count: "n" }],
        },
      },
    ]);

    const idsOf = (rows) => (rows || []).map((row) => row._id).filter(Boolean);
    const [companies, users, locations, types, vendors] = await Promise.all([
      Company.find({ _id: { $in: idsOf(groups?.companies) } }).select(
        "alias fullTitle",
      ),
      User.find({ _id: { $in: idsOf(groups?.users) } }).select(
        "firstName lastName",
      ),
      Location.find({ _id: { $in: idsOf(groups?.locations) } }).select("name"),
      DeviceType.find({ _id: { $in: idsOf(groups?.types) } }).select("name"),
      Vendor.find({ _id: { $in: idsOf(groups?.vendors) } }).select("name"),
    ]);

    const locationCompany = new Map(
      (groups?.locations || [])
        .filter((row) => row._id)
        .map((row) => [String(row._id), row.company ? String(row.company) : null]),
    );
    const sortByLabel = (options) =>
      options.sort((a, b) => a.label.localeCompare(b.label, "ru"));
    const toOptions = (docs, label) =>
      sortByLabel(
        docs.map((doc) => ({ value: String(doc._id), label: label(doc) })),
      );

    const vendorOptions = toOptions(vendors, (vendor) => vendor.name);
    if (groups?.custom?.[0]?.n) {
      vendorOptions.push({
        value: CUSTOM_VENDOR_BUCKET,
        label: "Кастомная сборка",
      });
    }

    res.status(200).json({
      companies: toOptions(
        companies,
        (company) => company.alias || company.fullTitle || "—",
      ),
      users: toOptions(
        users,
        (user) => [user.lastName, user.firstName].filter(Boolean).join(" ") || "—",
      ),
      locations: sortByLabel(
        locations.map((location) => ({
          value: String(location._id),
          label: location.name,
          company: locationCompany.get(String(location._id)) || null,
        })),
      ),
      types: toOptions(types, (type) => type.name),
      vendors: vendorOptions,
    });
  } catch (error) {
    next(new AppError("Failed to fetch device facets", 500, true, error));
  }
};

/**
 * Цепочка расположения от корня к самому расположению устройства.
 * `Location.fullPath` — асинхронный виртуал и по проводу приходит undefined
 * (см. docs/inventory.md §7), поэтому путь собираем обходом `parent` вверх.
 * Глубина ограничена: дерево здание → этаж → помещение → рабочее место.
 */
const buildLocationPath = async (locationId) => {
  if (!locationId) return [];
  const chain = [];
  let current = await Location.findById(locationId).select("name type parent");
  let guard = 0;
  while (current && guard < 8) {
    chain.unshift({ _id: current._id, name: current.name, type: current.type });
    if (!current.parent) break;
    current = await Location.findById(current.parent).select(
      "name type parent",
    );
    guard += 1;
  }
  return chain;
};

/**
 * Мягкая проверка серийного номера: есть ли уже устройства с таким же.
 *
 * Уникальности по серийнику нет — он повторяется в жизни (партия одинаковых
 * блоков питания, нечитаемая наклейка), и жёсткое ограничение люди обходили
 * суффиксом, портя данные. Совпадение — повод предупредить и показать, что
 * именно уже заведено, а решает человек.
 */
exports.checkSerial = async (req, res, next) => {
  try {
    const value = String(req.query.value || "").trim();
    if (!value) return res.status(200).json({ matches: [] });

    const authedUser = req.auth?.legacy ?? null;
    const match = {
      deletedAt: null,
      serialNumber: value,
      ...scopeMatch(authedUser),
    };
    if (mongoose.isValidObjectId(req.query.excludeId)) {
      match._id = { $ne: new mongoose.Types.ObjectId(req.query.excludeId) };
    }

    const devices = await ClientDevice.find(match)
      .select("inventoryNumber deviceModelId deviceTypeId companyId")
      .populate([
        { path: "deviceModelId", select: "name" },
        { path: "deviceTypeId", select: "name" },
        { path: "companyId", select: "alias fullTitle" },
      ])
      .limit(5)
      .lean();

    res.status(200).json({
      matches: devices.map((device) => ({
        _id: device._id,
        inventoryNumber: device.inventoryNumber || null,
        name:
          device.deviceModelId?.name ||
          device.deviceTypeId?.name ||
          "Устройство",
        company:
          device.companyId?.alias || device.companyId?.fullTitle || null,
      })),
    });
  } catch (error) {
    next(new AppError("Failed to check serial number", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id)
      .populate(devicePopulate({ withModelPhotos: true }))
      // Хозяин сборки: у комплектующего это единственный путь «наверх» —
      // в общем списке устройств его нет по определению.
      .populate({
        path: "parentDeviceId",
        select: "inventoryNumber deviceModelId deviceTypeId",
        populate: [
          { path: "deviceModelId", select: "name" },
          { path: "deviceTypeId", select: "name" },
        ],
      });

    if (!device) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    // Тот же скоуп, что у списка: клиент заперт в своей компании. В выборке
    // список это делал (`scopeMatch`), а карточка — нет, и чужое устройство
    // открывалось прямой ссылкой.
    const { isEndUser, user } = req.auth;
    if (
      isEndUser &&
      String(device.companyId?._id ?? device.companyId ?? "") !==
        String(user.company?._id ?? "")
    ) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    // Комплектующие сборки (если есть) — для отображения/редактирования состава.
    const components = await ClientDevice.find({
      parentDeviceId: req.params.id,
      deletedAt: null,
    }).populate(DEVICE_POPULATE);

    const locationPath = await buildLocationPath(device.locationId?._id);

    // Mikrotik management overlay: connectivity + a link target for the panel,
    // present only when the device has a management record.
    const mikrotikRecord = await Mikrotik.findOne({
      clientDevice: device._id,
    }).select("status monitoringEnabled lastSuccessfulConnectionAt");
    const mikrotik = mikrotikRecord
      ? {
          recordId: mikrotikRecord._id,
          status: mikrotikRecord.status || "offline",
          monitoringEnabled: mikrotikRecord.monitoringEnabled,
          lastSuccessfulConnectionAt:
            mikrotikRecord.lastSuccessfulConnectionAt,
        }
      : null;

    res
      .status(200)
      .json({ ...device.toObject(), components, mikrotik, locationPath });
  } catch (error) {
    next(
      new AppError(`Failed to fetch device ${req.params.id}`, 500, true, error),
    );
  }
};

/**
 * Заявки, ссылающиеся на устройство. Ссылку сейчас ставит только автоматика
 * мониторинга (`services/mikrotik/tickets.js`), поэтому список короткий и это
 * честно: ручное создание заявки устройство пока не выбирает.
 *
 * Секция карточки читает историю простоев, а не ведёт переписку, — отдаём
 * только то, что рисует строка, и без пагинации (последние N).
 */
exports.getTickets = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const query = { relatedClientDeviceId: req.params.id };
    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .select("num title state isClosed source createdAt finishedAt")
        .sort({ num: -1 })
        .limit(limit)
        .lean(),
      Ticket.countDocuments(query),
    ]);

    res.status(200).json({
      tickets: tickets.map((ticket) => ({
        _id: ticket._id,
        num: ticket.num,
        title: ticket.title,
        state: ticket.state,
        isClosed: ticket.isClosed,
        // Автозаявка мониторинга — по источнику: значок «авто» в строке.
        isAuto: ticket.source === "Мониторинг устройств",
        createdAt: ticket.createdAt,
        finishedAt: ticket.finishedAt || null,
      })),
      total,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch tickets of device ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const payload = buildDevicePayload(req.body);

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
    next(duplicateError(error) || new AppError("Failed to add device", 500, true, error));
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
      duplicateError(error) ||
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

// Свободные устройства, которые можно прикрепить к сборке как комплектующие:
// самостоятельные (без parentDeviceId), не являющиеся сами сборкой, той же
// компании, с «прикрепляемым» типом (комплектующие/расходники/периферия) и —
// если задан hostTypeId — совместимые с типом хоста (attachableToTypeIds).
exports.getAttachable = async (req, res, next) => {
  try {
    const companyId = clean(req.query.companyId);
    const excludeId = clean(req.query.excludeId);
    const hostTypeId = clean(req.query.hostTypeId);

    if (!companyId) return res.status(200).json([]);

    const attachableTypes = await DeviceType.find({
      $or: [
        { isComponent: true },
        { isConsumable: true },
        { isPeripheral: true },
      ],
    }).select("_id attachableToTypeIds");
    const typeMap = new Map(attachableTypes.map((t) => [String(t._id), t]));

    // Устройства, которые сами являются сборкой (имеют комплектующие), — не
    // предлагаем (избегаем вложенных сборок).
    const parentIds = await ClientDevice.distinct("parentDeviceId", {
      deletedAt: null,
      parentDeviceId: { $ne: null },
    });
    const assemblySet = new Set(parentIds.map(String));

    const query = { deletedAt: null, parentDeviceId: null, companyId };
    if (excludeId) query._id = { $ne: excludeId };

    const candidates = await ClientDevice.find(query)
      .populate(DEVICE_POPULATE)
      .sort({ _id: -1 });

    const result = candidates.filter((d) => {
      if (assemblySet.has(String(d._id))) return false;
      const typeId = populatedTypeId(d);
      if (!typeId) return false;
      const type = typeMap.get(String(typeId));
      if (!type) return false;
      const attachable = type.attachableToTypeIds || [];
      if (attachable.length && hostTypeId) {
        return attachable.some((a) => String(a) === String(hostTypeId));
      }
      return true;
    });

    res.status(200).json(result);
  } catch (error) {
    next(new AppError("Failed to fetch attachable devices", 500, true, error));
  }
};

// Прикрепить существующее устройство к сборке. Компонент «следует за хостом»:
// перенимает компанию/расположение/пользователя/статус. Тип должен быть
// прикрепляемым и совместимым с хостом; нельзя прикрепить сборку или само себя.
exports.attachComponent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const componentId = clean(req.body.componentId);

    if (!componentId) return next(new AppError("Не указан компонент", 400));
    if (String(componentId) === String(id)) {
      return next(
        new AppError("Нельзя прикрепить устройство к самому себе", 400),
      );
    }

    const host = await ClientDevice.findById(id);
    if (!host || host.deletedAt) {
      return next(new AppError(`Device with id ${id} not found`, 404));
    }

    const component = await ClientDevice.findById(componentId);
    if (!component || component.deletedAt) {
      return next(new AppError(`Component ${componentId} not found`, 404));
    }

    if (
      component.parentDeviceId &&
      String(component.parentDeviceId) !== String(host._id)
    ) {
      return next(new AppError("Устройство уже входит в другую сборку", 409));
    }

    const hasChildren = await ClientDevice.exists({
      parentDeviceId: component._id,
      deletedAt: null,
    });
    if (hasChildren) {
      return next(
        new AppError(
          "Нельзя прикрепить устройство, которое само является сборкой",
          409,
        ),
      );
    }

    const typeId = await getEffectiveTypeId(component);
    const type = typeId
      ? await DeviceType.findById(typeId).select(
          "isComponent isConsumable isPeripheral attachableToTypeIds",
        )
      : null;
    if (!type || !(type.isComponent || type.isConsumable || type.isPeripheral)) {
      return next(
        new AppError(
          "Этот тип устройства нельзя прикреплять как комплектующее",
          400,
        ),
      );
    }

    const attachable = type.attachableToTypeIds || [];
    if (attachable.length) {
      const hostTypeId = await getEffectiveTypeId(host);
      if (
        !hostTypeId ||
        !attachable.some((a) => String(a) === String(hostTypeId))
      ) {
        return next(
          new AppError("Этот компонент несовместим с типом хоста", 400),
        );
      }
    }

    // Следует за хостом.
    component.parentDeviceId = host._id;
    component.companyId = host.companyId;
    component.locationId = host.locationId;
    component.userId = host.userId;
    component.status = host.status;
    component.updatedBy = req.userId;
    await component.save();

    res.status(200).json({ message: "Комплектующее прикреплено", component });
  } catch (error) {
    next(new AppError("Failed to attach component", 500, true, error));
  }
};

// Открепить комплектующее: разрывает связь с хостом и возвращает устройство в
// общий список как «Готово к выдаче» (без пользователя). Расположение сохраняем.
exports.detachComponent = async (req, res, next) => {
  try {
    const { id, componentId } = req.params;

    const component = await ClientDevice.findById(componentId);
    if (!component || component.deletedAt) {
      return next(new AppError(`Component ${componentId} not found`, 404));
    }
    if (String(component.parentDeviceId || "") !== String(id)) {
      return next(new AppError("Устройство не входит в эту сборку", 400));
    }

    component.parentDeviceId = undefined;
    component.userId = undefined;
    component.status = "readyForDeployment";
    component.updatedBy = req.userId;
    await component.save();

    res.status(200).json({ message: "Комплектующее откреплено", component });
  } catch (error) {
    next(new AppError("Failed to detach component", 500, true, error));
  }
};

// Фотографии конкретного экземпляра. Та же логика, что у модели устройства.
const devicePhotos = createPhotoHandlers({
  Model: ClientDevice,
  notFoundMessage: (id) => `Device with id ${id} not found`,
});
exports.addPhotos = devicePhotos.addPhotos;
exports.deletePhoto = devicePhotos.deletePhoto;

exports.delete = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    if (device) {
      await ClientDevice.deleteOne({ _id: req.params.id });
      // Снимки живут только вместе с устройством — чистим бакет.
      await deleteAllPhotos(device);
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
