const mongoose = require("mongoose");

const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceType = require("../../models/inventory/deviceType");
const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
require("../../models/inventory/attributeGroup");
const Vendor = require("../../models/inventory/vendor");
const Location = require("../../models/inventory/location");
const DeviceBuild = require("../../models/inventory/deviceBuild");
const Mikrotik = require("../../models/mikrotik");
const { Ticket } = require("../../models/ticket");

const { createPhotoHandlers, deleteAllPhotos } = require("./photoHandlers");
const { ASSEMBLY_POPULATE } = require("./deviceType");
const {
  PARTS_POPULATE,
  loadPartLinks,
} = require("./deviceBuild");
const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");
const {
  buildMikrotikStatusMap,
  mikrotikOverlay,
} = require("../../helpers/mikrotikOverlay");
const { mikrotikEnabled } = require("../../services/mikrotik/enabled");
const { loadKeySpecs } = require("../../services/inventory/assemblyKeySpecs");
const {
  configurationForDevice,
  soleConfigurationId,
} = require("../../services/inventory/modelConfigurations");
const {
  assignUser,
  attachComponent,
  buildDevicePayload,
  clean,
  createDevice,
  detachComponent,
  duplicateError,
  findTakenIdentity,
  planDeviceParts,
  validateAssembly,
} = require("../../services/inventory/deviceOps");
const { filterAttachable } = require("../../services/inventory/attachRules");
const { ticketListFilter } = require("../../services/ticketScope");
const {
  attachableCompanyId,
  deviceComponentsFilter,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
  visibleHost,
} = require("../../services/deviceScope");

// Каталог статусов — из схемы, чтобы второй копии списка не заводить.
const DEVICE_STATUSES = ClientDevice.schema.path("status").enumValues;

// Shared populate graph: model (+ its vendor & type), company, location, user.
// Снимки модели тянем только там, где они действительно нужны (карточка
// устройства): в списке это лишний вес на каждой строке.
// Флаги типа решают секции карточки: «Сеть и система» не у комплектующих,
// расходников и периферии, «Состав сборки» — у собираемых типов.
const DEVICE_TYPE_SELECT =
  "name isComponent isConsumable isPeripheral assembly.enabled";

const devicePopulate = ({ withModelPhotos = false } = {}) => [
  {
    path: "deviceModelId",
    select: `name vendorId deviceTypeId${withModelPhotos ? " photos" : ""}`,
    populate: [
      // Флаг вендора нужен странице устройства: показывать ли вкладку
      // «Мониторинг» (устройство управляемо, даже если ещё не подключено).
      { path: "vendorId", select: "name isMikrotikManagementEnabled" },
      { path: "deviceTypeId", select: DEVICE_TYPE_SELECT },
    ],
  },
  // Прямой тип — для самосборных устройств без модели.
  { path: "deviceTypeId", select: DEVICE_TYPE_SELECT },
  // Конфигурация (пресет характеристик модели) с расшифровкой значений.
  {
    path: "configurationId",
    select: "name values",
    populate: {
      path: "values.attributeId",
      select: "code name unit valueType options",
    },
  },
  { path: "companyId", select: "alias fullTitle" },
  { path: "locationId", select: "name fullPath" },
  { path: "supplierId", select: "name" },
  { path: "userId", select: "firstName lastName email" },
  { path: "createdBy", select: "firstName lastName" },
  { path: "updatedBy", select: "firstName lastName" },
];

const DEVICE_POPULATE = devicePopulate();

// Детали ПК своей сборки на карточке: только то, что нужно «Конфигурации» и
// характеристикам (модель, конфигурация со значениями, серийник, гарантия,
// закупка) — карточку открывают и клиенты.
const ASSEMBLY_COMPONENT_SELECT =
  "deviceModelId configurationId deviceTypeId serialNumber warrantyExpirationDate purchasedAt inventoryNumber quantity";
const ASSEMBLY_COMPONENT_POPULATE = [
  {
    path: "deviceModelId",
    select: "name vendorId deviceTypeId deletedAt",
    populate: [
      { path: "vendorId", select: "name" },
      { path: "deviceTypeId", select: "name" },
    ],
  },
  {
    path: "configurationId",
    select: "name values deletedAt",
    populate: {
      path: "values.attributeId",
      select: "code name unit valueType options",
    },
  },
  { path: "deviceTypeId", select: "name" },
];

exports.planDeviceParts = planDeviceParts;
exports.ASSEMBLY_COMPONENT_SELECT = ASSEMBLY_COMPONENT_SELECT;
exports.ASSEMBLY_COMPONENT_POPULATE = ASSEMBLY_COMPONENT_POPULATE;

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
  // Компания хозяина выбрана ради клиента (`visibleHost`): чужого хозяина его
  // строка не называет.
  {
    path: "parentDeviceId",
    select: "inventoryNumber deviceModelId deviceTypeId companyId",
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
const toListDevice = (
  device,
  { componentCount = 0, mikro = null, keySpecs = "" } = {},
) => {
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
    // Ключевые характеристики ПК своей сборки (процессор · память · диск):
    // только у сборки собираемого типа и только когда есть что показать.
    ...(keySpecs ? { keySpecs } : {}),
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
 * Что считается строкой реестра — три состояния фасета `components`:
 * `hide` (умолчание) — только самостоятельные единицы, `any` — вместе с
 * деталями сборок, `only` — одни детали (просмотр «покажи все модули памяти»).
 *
 * Поиск — прицельный вопрос «где эта железка»: он ищет по всему учёту, иначе
 * реестр отвечал бы «ничего не нашлось» про то, что в нём есть. Явный выбор
 * человека поиск при этом не отменяет: «только детали» остаётся «только
 * деталями».
 */
const componentsMode = (query) => {
  if (query.components === "only" || query.components === "any") {
    return query.components;
  }
  return String(query.search || "").trim() ? "any" : "hide";
};

const buildListMatch = async (query, authedUser) => {
  const searchTerm = String(query.search || "").trim();
  const mode = componentsMode(query);

  const match = {
    deletedAt: null,
    ...(mode === "hide" ? { parentDeviceId: null } : {}),
    ...(mode === "only" ? { parentDeviceId: { $ne: null } } : {}),
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

  // Модель — фасет секции «Устройства» на карточке модели
  const models = toIdList(query.models);
  if (models.length) match.deviceModelId = { $in: models };

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
      componentsMode(q) === "any"
        ? ClientDevice.countDocuments({
            ...match,
            parentDeviceId: { $ne: null },
          })
        : 0,
      // Лента парка: счётчики стадий и пробелов учёта — по всей выборке без
      // фасета статуса, поэтому агрегат идёт по baseMatch. Комплектующие в них
      // не входят: они наследуют статус хозяина, и сложить их со сборками
      // значило бы удвоить парк (расхождение подписано над списком).
      // Исключение — режим «только детали»: сборок в выдаче нет вовсе, удваивать
      // нечего, и лента обязана описывать ровно показанное, а не пустоту.
      // Так же у выборки одной модели: модель — либо сборка, либо деталь,
      // удвоения нет, а модель памяти иначе показала бы пустую ленту.
      ClientDevice.aggregate([
        {
          $match:
            componentsMode(q) === "only" || toIdList(q.models).length
              ? baseMatch
              : { ...baseMatch, parentDeviceId: null },
        },
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

    // Связь «сборка — деталь» не обходит скоуп: состав бывает смешанным (хозяина
    // переводят в другую компанию, а детали остаются), и клиенту строка не
    // называет чужого хозяина и не считает чужие детали (services/deviceScope).
    // Условие счётчика идёт в aggregate, поэтому скоуп в нём — ObjectId.
    const viewer = deviceViewer(req.auth);
    const ids = rows.map((row) => row._id);
    const [componentCounts, mikroMap, keySpecsMap] = await Promise.all([
      ClientDevice.aggregate([
        { $match: deviceComponentsFilter(viewer, { $in: ids }) },
        { $group: { _id: "$parentDeviceId", n: { $sum: 1 } } },
      ]),
      buildMikrotikStatusMap(ids),
      // Пачкой на страницу; видимость деталей та же, что у счётчика.
      loadKeySpecs(rows, {
        ClientDevice,
        DeviceType,
        assemblyPopulate: ASSEMBLY_POPULATE,
        componentPopulate: ASSEMBLY_COMPONENT_POPULATE,
        componentSelect: `${ASSEMBLY_COMPONENT_SELECT} parentDeviceId`,
        componentsFilter: (hostIds) => deviceComponentsFilter(viewer, hostIds),
      }).catch((error) => {
        // Сводка — украшение строки: её сбой не роняет список.
        logger.log("warn", "Не удалось собрать ключевые характеристики сборок", {
          error: error.message,
        });
        return new Map();
      }),
    ]);
    const componentMap = new Map(
      componentCounts.map((entry) => [String(entry._id), entry.n]),
    );

    const statusCounts = Object.fromEntries(
      (facetCounts?.byStatus || [])
        .filter((entry) => entry._id)
        .map((entry) => [entry._id, entry.n]),
    );

    // Чип компаний секции на карточке модели: компании выборки со счётчиками.
    // Считаются без фасета компаний (выбор одной не обнуляет соседние), но с
    // остальными условиями. По запросу: реестру хватает своих фасетов.
    let companyCounts;
    if (q.companyCounts === "true") {
      const withoutCompanies = await buildListMatch(
        { ...q, companies: undefined },
        authedUser,
      );
      const groups = await ClientDevice.aggregate([
        {
          $match: statuses.length
            ? { ...withoutCompanies, status: { $in: statuses } }
            : withoutCompanies,
        },
        { $group: { _id: "$companyId", n: { $sum: 1 } } },
      ]);
      const companies = await Company.find({
        _id: { $in: groups.map((group) => group._id).filter(Boolean) },
      }).select("alias fullTitle");
      const countOf = new Map(groups.map((group) => [String(group._id), group.n]));
      companyCounts = companies
        .map((company) => ({
          value: String(company._id),
          label: company.alias || company.fullTitle || "—",
          count: countOf.get(String(company._id)) || 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    }

    res.status(200).json({
      devices: rows.map((row) =>
        toListDevice(
          { ...row, parentDeviceId: visibleHost(viewer, row.parentDeviceId) },
          {
            componentCount: componentMap.get(String(row._id)) || 0,
            mikro: mikroMap.get(String(row._id)) || null,
            keySpecs: keySpecsMap.get(String(row._id)) || "",
          },
        ),
      ),
      total,
      componentsCount,
      page,
      pageSize: limit,
      statusCounts,
      noInventoryNumber: facetCounts?.noInventoryNumber?.[0]?.n || 0,
      ...(companyCounts ? { companyCounts } : {}),
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
      // в общем списке устройств его нет по определению. Компания хозяина
      // выбрана ради клиента: чужого хозяина ответ не называет (`visibleHost`).
      .populate({
        path: "parentDeviceId",
        select: "inventoryNumber deviceModelId deviceTypeId companyId",
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
    // открывалось прямой ссылкой. Правило общее с заявками устройства
    // (`getTickets`) — services/deviceScope.
    const viewer = deviceViewer(req.auth);
    if (!deviceVisibleTo(viewer, device)) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    // ПК своей сборки собираемого типа: карточка строит «Конфигурацию» и
    // характеристики из фактических деталей и сравнивает их со сборкой.
    const assemblyType =
      !device.deviceModelId && device.deviceTypeId
        ? await DeviceType.findById(device.deviceTypeId._id)
            .select("assembly")
            .populate(ASSEMBLY_POPULATE)
            .lean()
        : null;
    const assembly = assemblyType?.assembly?.enabled
      ? assemblyType.assembly
      : null;

    // Комплектующие сборки (если есть) — для отображения/редактирования состава.
    // Состав бывает смешанным (хозяина перевели в другую компанию, а детали
    // остались), и клиенту детали чужой компании не отдаются — как и сама карточка.
    const componentsQuery = ClientDevice.find(
      deviceComponentsFilter(viewer, device._id),
    );
    const components = assembly
      ? await componentsQuery
          .select(ASSEMBLY_COMPONENT_SELECT)
          .populate(ASSEMBLY_COMPONENT_POPULATE)
          .lean()
      : await componentsQuery.populate(DEVICE_POPULATE);

    // Сборка-шаблон (удалённая — уже не с чем сравнивать) и связки типов
    // деталей с группами — для характеристик из конфигураций деталей.
    const assemblyData = assembly
      ? {
          assembly,
          build: device.buildId
            ? await DeviceBuild.findOne({
                _id: device.buildId,
                deletedAt: null,
              })
                .select("name parts")
                .populate(PARTS_POPULATE)
                .lean()
            : null,
          partLinks: await loadPartLinks(components.map(populatedTypeId)),
        }
      : {};

    const locationPath = await buildLocationPath(device.locationId?._id);

    // Связки эффективного типа (тип модели, иначе прямой) с группами — по ним
    // карточка раскладывает значения конфигурации; без конфигурации не нужны.
    const typeId = populatedTypeId(device);
    const specLinks =
      device.configurationId && typeId
        ? await DeviceTypeAttribute.find({ deviceTypeId: typeId })
            .populate(
              "attributeId",
              "code name valueType unit options isActive",
            )
            .populate("groupId", "name order")
            .select("attributeId groupId order createdAt")
            .sort({ order: 1, createdAt: 1 })
            .lean()
        : [];

    // Mikrotik management overlay: connectivity + a link target for the panel,
    // present only when the device has a management record and the Mikrotik
    // module is on.
    const mikrotikRecord = (await mikrotikEnabled())
      ? await Mikrotik.findOne({
          clientDevice: device._id,
        }).select("status monitoringEnabled lastSuccessfulConnectionAt")
      : null;
    const mikrotik = mikrotikRecord
      ? {
          recordId: mikrotikRecord._id,
          status: mikrotikRecord.status || "offline",
          monitoringEnabled: mikrotikRecord.monitoringEnabled,
          lastSuccessfulConnectionAt:
            mikrotikRecord.lastSuccessfulConnectionAt,
        }
      : null;

    // Хозяин детали — только виденный клиенту: у детали своей компании он мог
    // остаться чужим, и тогда ответ его не называет
    const body = device.toObject();
    if (body.parentDeviceId) {
      body.parentDeviceId = visibleHost(viewer, body.parentDeviceId);
    }

    res.status(200).json({
      ...body,
      components,
      ...assemblyData,
      mikrotik,
      locationPath,
      specLinks,
    });
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
    // Сначала само устройство — тем же скоупом, что карточка (getOne): по
    // чужому id клиент получает 404, а не историю простоев чужой компании
    const device = await ClientDevice.findById(req.params.id)
      .select("companyId")
      .lean();
    if (!device || !deviceVisibleTo(deviceViewer(req.auth), device)) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    // Заявки — в пределах видимости заявок автора запроса: ярус «свои» у
    // сотрудника через устройство тоже не видит чужих заявок
    const query = deviceTicketsFilter(device._id, ticketListFilter(req.auth));
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
  const result = await createDevice(req.body, { userId: req.userId });
  if (!result.ok) {
    return next(
      new AppError(result.message, result.status, true, result.error),
    );
  }
  res.status(201).json({
    message: "Новое устройство успешно добавлено",
    clientDevice: result.device,
    components: result.parts,
  });
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

    const takenInventory = await findTakenIdentity({
      inventoryNumber:
        payload.inventoryNumber !== device.inventoryNumber
          ? payload.inventoryNumber
          : undefined,
      excludeId: req.params.id,
    });
    if (takenInventory) {
      return next(new AppError(takenInventory.message, takenInventory.status));
    }

    if (payload.companyId) {
      const company = await Company.findById(payload.companyId);
      if (!company) {
        return next(new AppError("Invalid company ID", 400));
      }
    }

    // Hostname уникален в пределах компании. Проверяем, только если изменился;
    // компанию берём новую (если меняется) или текущую.
    const takenHostname = await findTakenIdentity({
      hostname:
        payload.hostname !== device.hostname ? payload.hostname : undefined,
      companyId: payload.companyId || device.companyId,
      excludeId: req.params.id,
    });
    if (takenHostname) {
      return next(new AppError(takenHostname.message, takenHostname.status));
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
      // Не прислана (форма сбрасывает её при смене модели) — единственная
      // конфигурация модели
      payload.configurationId = configurationForDevice(
        payload.configurationId,
        payload.configurationId
          ? null
          : await soleConfigurationId(deviceModel._id),
      );
    }

    // Сборка-шаблон: присланная — проверяется как при создании; не присланная
    // остаётся прежней (форма правки её может не знать). Заводское устройство
    // или смена типа сборку снимают: она бывает только у своей сборки типа.
    if (!("buildId" in req.body)) {
      payload.buildId =
        payload.deviceModelId ||
        String(payload.deviceTypeId ?? "") !== String(device.deviceTypeId ?? "")
          ? null
          : device.buildId;
    } else if (payload.buildId) {
      // Прежняя сборка не перепроверяется: её могли удалить после создания ПК.
      if (String(payload.buildId) !== String(device.buildId ?? "")) {
        const assembly = await validateAssembly(payload);
        if (assembly.error) return next(assembly.error);
      }
    } else {
      payload.buildId = null;
    }

    // Связь с хозяином сборки: форма правки её не присылает — тогда остаётся
    // прежней (иначе правка детали открепила бы её). Снимает связь
    // detachComponent; явный ключ в теле применяется как есть.
    if (!("parentDeviceId" in req.body)) {
      payload.parentDeviceId = device.parentDeviceId;
    }

    Object.assign(device, payload, { updatedBy: req.userId });
    await device.save();

    res.status(200).json({
      message: "Устройство успешно изменено.",
      device,
    });
  } catch (error) {
    const duplicate = duplicateError(error);
    next(
      (duplicate && new AppError(duplicate.message, duplicate.status)) ||
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
  const result = await assignUser(req.params.id, req.body.userId, {
    actorId: req.userId,
    withComponents: false,
  });
  if (!result.ok) {
    return next(
      new AppError(result.message, result.status, true, result.error),
    );
  }
  const populated = await ClientDevice.findById(result.device._id).populate(
    DEVICE_POPULATE,
  );
  res.status(200).json({
    message: clean(req.body.userId)
      ? "Пользователь назначен"
      : "Пользователь снят",
    device: populated,
  });
};

// Свободные устройства, которые можно прикрепить к сборке как комплектующие:
// самостоятельные (без parentDeviceId), не являющиеся сами сборкой, той же
// компании, с «прикрепляемым» типом (комплектующие/расходники/периферия) и —
// если задан hostTypeId — совместимые с типом хоста (attachableToTypeIds).
exports.getAttachable = async (req, res, next) => {
  try {
    // Клиенту — только своя компания: чужая в query, кривой или повторённый
    // параметр отвечают пустым списком (services/deviceScope)
    const companyId = attachableCompanyId(
      deviceViewer(req.auth),
      req.query.companyId,
    );
    const excludeId = clean(req.query.excludeId);
    const hostTypeId = clean(req.query.hostTypeId);

    if (!companyId) return res.status(200).json([]);

    const attachableTypes = await DeviceType.find({
      $or: [
        { isComponent: true },
        { isConsumable: true },
        { isPeripheral: true },
      ],
    }).select(
      "_id isComponent isConsumable isPeripheral attachableToTypeIds",
    );
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

    const result = filterAttachable({
      candidates,
      typeOf: populatedTypeId,
      typeById: typeMap,
      assemblyIds: assemblySet,
      hostTypeId,
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
  const result = await attachComponent(req.params.id, req.body.componentId, {
    actorId: req.userId,
  });
  if (!result.ok) {
    return next(
      new AppError(result.message, result.status, true, result.error),
    );
  }
  res
    .status(200)
    .json({ message: "Комплектующее прикреплено", component: result.device });
};

// Открепить комплектующее: разрывает связь с хостом и возвращает устройство в
// общий список как «Готово к выдаче» (без пользователя). Расположение сохраняем.
exports.detachComponent = async (req, res, next) => {
  const result = await detachComponent(req.params.id, req.params.componentId, {
    actorId: req.userId,
  });
  if (!result.ok) {
    return next(
      new AppError(result.message, result.status, true, result.error),
    );
  }
  res
    .status(200)
    .json({ message: "Комплектующее откреплено", component: result.device });
};

// Фотографии конкретного экземпляра. Та же логика, что у модели устройства.
const devicePhotos = createPhotoHandlers({
  Model: ClientDevice,
  notFoundMessage: (id) => `Device with id ${id} not found`,
});
exports.addPhotos = devicePhotos.addPhotos;
exports.deletePhoto = devicePhotos.deletePhoto;

// «1 деталь», «3 детали», «5 деталей».
const partsWord = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} деталь`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} детали`;
  return `${n} деталей`;
};

exports.delete = async (req, res, next) => {
  try {
    const device = await ClientDevice.findById(req.params.id);
    if (device) {
      // ПК с деталями не удаляем: каскада нет, детали сперва открепляют.
      const parts = await ClientDevice.countDocuments({
        parentDeviceId: device._id,
        deletedAt: null,
      });
      if (parts > 0) {
        return next(
          new AppError(`Сначала открепите детали: ${partsWord(parts)}`, 409),
        );
      }
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
