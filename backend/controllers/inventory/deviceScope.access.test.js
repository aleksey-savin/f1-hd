// node --test controllers/inventory/deviceScope.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
const sift = require("sift").default;

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки контроллера:
 * models/ticket.js на верхнем уровне зовёт initCounter(), и без базы в выводе
 * остаётся «Failed to initialize counter» (тот же приём, что в
 * controllers/company.access.test.js).
 */
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
const Ticket = {};
stubModule("@/models/ticket", { Ticket });

// Рубильник модуля Mikrotik читает Preferences, то есть базу. Контроллеры и
// оверлей забирают его деструктуризацией при загрузке, поэтому подмена стоит
// до `require`.
require("@/services/mikrotik/enabled").mikrotikEnabled = async () => false;
// errorResponse пишет ошибку в журнал; здесь она ожидаема, шум не нужен
require("@/utils/logger").addNoAuthContext = () => ({ log() {} });

const ClientDevice = require("@/models/inventory/clientDevice");
const DeviceType = require("@/models/inventory/deviceType");
const Location = require("@/models/inventory/location");
const User = require("@/models/user");
const { errorResponse } = require("@/middleware/errorHandling");

const clientDeviceController = require("./clientDevice");
const locationController = require("./location");

/**
 * Видимость техники в контроллерах (спека W1, §3). Тест помощников
 * (services/deviceScope.test.js) не заметит, что из обработчика пропал ЕГО
 * ВЫЗОВ — например, откат куска файла при слиянии, — поэтому здесь исполняются
 * настоящие `getOne`, `getTickets`, `getAttachable` и `getUserTech`.
 *
 * Подменены только статические методы моделей. Фильтры, которые обработчики
 * собирают для Mongo, исполняются в памяти через sift — тем же сопоставлением
 * условий, что у базы, — так что проверяется то, что человек получил бы в
 * ответе, а не текст запроса.
 */

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const OWN = "66aa00000000000000000001"; // компания клиента
const FOREIGN = "66aa00000000000000000002"; // чужая компания
const CLIENT_ID = "66bb00000000000000000001";
const STAFF_ID = "66bb00000000000000000002";
const COLLEAGUE_ID = "66bb00000000000000000003";

/**
 * `req.auth` в форме buildAuthContext (services/authContext), но без базы.
 * `tier` — ярус заявок человека (services/ticketScope): права заявок читаются
 * только через `can()`.
 */
const GRANTS = {
  own: [],
  companies: ["readCompanies"],
  all: ["readCompanies", "readAll"],
};
const authFor = ({ userId, isEndUser, companyId = null, tier = "own" }) => {
  const company = companyId ? { _id: oid(companyId) } : null;
  return {
    userId,
    isAdmin: false,
    isEndUser,
    user: { company },
    // legacy — плоская копия пользователя: список читает из неё isEndUser
    legacy: {
      _id: oid(userId),
      userId,
      company,
      isEndUser,
      responsibleForCompanies: [],
    },
    can: ({ ticket = [] } = {}) =>
      ticket.every((action) => GRANTS[tier].includes(action)),
  };
};

const client = authFor({
  userId: CLIENT_ID,
  isEndUser: true,
  companyId: OWN,
  tier: "companies",
});
const homeless = authFor({ userId: CLIENT_ID, isEndUser: true });
const staff = authFor({ userId: STAFF_ID, isEndUser: false });
const staffSeesAll = authFor({
  userId: STAFF_ID,
  isEndUser: false,
  tier: "all",
});

// Запросы, которые дошли до «базы»: по ним видно, что отказанный не выполнялся
const queries = [];
const ran = (name) => queries.filter(([called]) => called === name).length;

/**
 * Запрос Mongoose в виде заглушки: select/lean/sort/limit ничего не меняют, а
 * `await` отдаёт заранее заданный результат. Заказанные populate запоминаются и
 * передаются в `hydrate` — так подстановка связей видит, какие поля запросил
 * обработчик.
 */
const query = (result, hydrate = (doc) => doc) => {
  const populates = [];
  const chain = {
    populate: (options) => {
      populates.push(options);
      return chain;
    },
    select: () => chain,
    lean: () => chain,
    sort: () => chain,
    limit: () => chain,
    then: (resolve, reject) =>
      Promise.resolve(hydrate(result, populates)).then(resolve, reject),
  };
  return chain;
};

// Документ устройства «как из базы»; toObject нужен карточке и не перечисляется
const device = (fields) => {
  const doc = { deletedAt: null, parentDeviceId: null, ...fields };
  return Object.defineProperty(doc, "toObject", {
    value: () => ({ ...doc }),
  });
};

const originals = {
  deviceFindById: ClientDevice.findById,
  deviceFind: ClientDevice.find,
  deviceDistinct: ClientDevice.distinct,
  deviceAggregate: ClientDevice.aggregate,
  deviceCount: ClientDevice.countDocuments,
  devicePopulate: ClientDevice.populate,
  typeFind: DeviceType.find,
  workplaces: Location.getUserWorkplaces,
  locationFind: Location.find,
  locationFindById: Location.findById,
  userFindById: User.findById,
};

afterEach(() => {
  ClientDevice.findById = originals.deviceFindById;
  ClientDevice.find = originals.deviceFind;
  ClientDevice.distinct = originals.deviceDistinct;
  ClientDevice.aggregate = originals.deviceAggregate;
  ClientDevice.countDocuments = originals.deviceCount;
  ClientDevice.populate = originals.devicePopulate;
  DeviceType.find = originals.typeFind;
  Location.getUserWorkplaces = originals.workplaces;
  Location.find = originals.locationFind;
  Location.findById = originals.locationFindById;
  User.findById = originals.userFindById;
  delete Ticket.find;
  delete Ticket.countDocuments;
  queries.length = 0;
});

/**
 * aggregate() не приводит типы: строка-идентификатор в $match не совпадёт с
 * ObjectId в базе (Mongoose: «does not cast pipeline stages»), тогда как find
 * их приводит. sift же сравнивает по значению, поэтому для агрегата ObjectId
 * перед сопоставлением заменяется меткой с типом: строка и ObjectId перестают
 * быть равными, как в настоящей агрегации.
 */
const typed = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return { __objectId: value.toHexString() };
  }
  if (Array.isArray(value)) return value.map(typed);
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, typed(inner)]),
    );
  }
  return value;
};

const strictMatch = (docs, filter) => {
  const matches = sift(typed(filter));
  return docs.filter((doc) => matches(typed(doc)));
};

// $group по полю со счётчиком `{ $sum: 1 }` под любым именем (count, n)
const groupCount = (rows, { _id: key, ...accumulators }) => {
  const [[name, accumulator]] = Object.entries(accumulators);
  assert.deepEqual(accumulator, { $sum: 1 });
  const counts = new Map();
  for (const row of rows) {
    const id = String(row[key.slice(1)]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ _id: oid(id), [name]: count }));
};

/**
 * Конвейер aggregate над «базой»: только стадии, которые строят обработчики
 * ($match, $sort по _id, $skip, $limit, $project, $group со счётчиком, $facet
 * лентой статусов). Незнакомая стадия роняет тест, а не отдаёт неверные числа.
 */
const runPipeline = (devices, pipeline) => {
  let rows = devices;
  for (const stage of pipeline) {
    const [name] = Object.keys(stage);
    if (name === "$match") {
      rows = strictMatch(rows, stage.$match);
    } else if (name === "$sort") {
      assert.deepEqual(stage.$sort, { _id: -1 });
      rows = [...rows].sort((a, b) =>
        String(b._id).localeCompare(String(a._id)),
      );
    } else if (name === "$skip") {
      rows = rows.slice(stage.$skip);
    } else if (name === "$limit") {
      rows = rows.slice(0, stage.$limit);
    } else if (name === "$group") {
      rows = groupCount(rows, stage.$group);
    } else if (name === "$facet") {
      return [{ byStatus: [], noInventoryNumber: [] }];
    } else if (name !== "$project") {
      throw new Error(`стадия ${name} не поддержана заглушкой aggregate`);
    }
  }
  // Агрегат отдаёт новые объекты, а не документы «базы»
  return rows.map((row) => ({ ...row }));
};

// Поля, которые запросил populate (select); `_id` приходит всегда
const selected = (doc, select = "") =>
  Object.fromEntries(
    ["_id", ...select.split(/\s+/).filter(Boolean)]
      .filter((key) => key in doc)
      .map((key) => [key, doc[key]]),
  );

// Хозяин сборки по пути parentDeviceId — теми полями, что запросил обработчик
const hostLabel = (devices, hostId, option) => {
  const host = devices.find((doc) => String(doc._id) === String(hostId));
  return host ? selected(host, option.select) : null;
};

/**
 * Устройства «базы»: `find` и `countDocuments` исполняют фильтр над ними (они
 * приводят типы, как Mongoose), `aggregate` — строго по типам (runPipeline),
 * `findById` ищет по id, а populate подставляет хозяина сборки.
 */
const seedDevices = (devices) => {
  ClientDevice.findById = (id) => {
    queries.push(["ClientDevice.findById", id]);
    const found = devices.find((doc) => String(doc._id) === String(id)) ?? null;
    return query(found, (doc, populates) => {
      const option = populates.find(
        (entry) => entry?.path === "parentDeviceId",
      );
      if (!doc || !option || !doc.parentDeviceId) return doc;
      return device({
        ...doc,
        parentDeviceId: hostLabel(devices, doc.parentDeviceId, option),
      });
    });
  };
  ClientDevice.find = (filter) => {
    queries.push(["ClientDevice.find", filter]);
    return query(devices.filter(sift(filter)));
  };
  ClientDevice.countDocuments = async (filter) => {
    queries.push(["ClientDevice.countDocuments", filter]);
    return devices.filter(sift(filter)).length;
  };
  ClientDevice.distinct = async () => [];
  ClientDevice.aggregate = async (pipeline) => {
    queries.push(["ClientDevice.aggregate", pipeline]);
    return runPipeline(devices, pipeline);
  };
  // Model.populate строк списка: правит строки на месте, как Mongoose
  ClientDevice.populate = async (rows, options) => {
    queries.push(["ClientDevice.populate", options]);
    const option = [options]
      .flat()
      .find((entry) => entry?.path === "parentDeviceId");
    for (const row of rows) {
      if (option && row.parentDeviceId) {
        row.parentDeviceId = hostLabel(devices, row.parentDeviceId, option);
      }
    }
    return rows;
  };
};

const seedTickets = (tickets) => {
  Ticket.find = (filter) => {
    queries.push(["Ticket.find", filter]);
    return query(tickets.filter(sift(filter)));
  };
  Ticket.countDocuments = async (filter) => {
    queries.push(["Ticket.countDocuments", filter]);
    return tickets.filter(sift(filter)).length;
  };
};

/** Зовёт настоящий обработчик; ошибки, отданные в `next`, собираются в `errors`. */
const call = async (handler, req) => {
  const res = {
    statusCode: 200,
    payload: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const errors = [];
  await handler({ params: {}, query: {}, ...req }, res, (error) =>
    errors.push(error),
  );
  return { res, errors };
};

// Отказ как «не найдено»: ни ответа, ни подсказки, что такое устройство есть
const assertNotFound = ({ res, errors }) => {
  assert.equal(
    errors.length,
    1,
    `ожидали отказ, получили ответ ${res.statusCode}: ${JSON.stringify(res.payload)}`,
  );
  assert.equal(errors[0].statusCode, 404);
  assert.equal(res.payload, null);
};

// Успех без ошибки; при падении показываем исходную ошибку, а не только 500
const assertOk = ({ res, errors }) => {
  assert.equal(
    errors.length,
    0,
    errors[0]?.originalError?.stack ?? errors[0]?.message,
  );
  assert.equal(res.statusCode, 200);
};

// ─── Карточка устройства (getOne) ─────────────────────────────────────────

const CARD_ID = "66cc00000000000000000001";

// Карточка приходит с раскрытой компанией: `companyId: { _id, alias }`
const cardOf = (company) =>
  device({
    _id: oid(CARD_ID),
    companyId: company ? { _id: oid(company), alias: "Компания" } : null,
  });

const stubCard = (doc) => {
  ClientDevice.findById = () => query(doc);
  ClientDevice.find = (filter) => {
    queries.push(["ClientDevice.find", filter]);
    return query([]);
  };
};

test("device card: a client gets 404 for another company's device", async () => {
  stubCard(cardOf(FOREIGN));
  const outcome = await call(clientDeviceController.getOne, {
    auth: client,
    params: { id: CARD_ID },
  });
  assertNotFound(outcome);
  assert.equal(ran("ClientDevice.find"), 0);
});

test("device card: a client without a company gets 404 even for a company-less device", async () => {
  stubCard(cardOf(null));
  const outcome = await call(clientDeviceController.getOne, {
    auth: homeless,
    params: { id: CARD_ID },
  });
  assertNotFound(outcome);
});

test("device card: a client opens an own-company device, staff open any", async () => {
  stubCard(cardOf(OWN));
  const own = await call(clientDeviceController.getOne, {
    auth: client,
    params: { id: CARD_ID },
  });
  assertOk(own);
  assert.equal(String(own.res.payload._id), CARD_ID);

  stubCard(cardOf(FOREIGN));
  const foreign = await call(clientDeviceController.getOne, {
    auth: staff,
    params: { id: CARD_ID },
  });
  assertOk(foreign);
  assert.equal(String(foreign.res.payload._id), CARD_ID);
});

// ─── Заявки устройства (getTickets) ───────────────────────────────────────

const DEVICE_ID = "66dd00000000000000000001";
const OTHER_DEVICE_ID = "66dd00000000000000000002";

const ticket = (num, fields) => ({
  _id: oid(`66ee0000000000000000000${num}`),
  num,
  title: `Заявка ${num}`,
  relatedClientDeviceId: oid(DEVICE_ID),
  ...fields,
});

const tickets = [
  // заявка своей компании, заведена коллегой: клиент видит по компании
  ticket(1, { company: { _id: oid(OWN) }, createdBy: oid(COLLEAGUE_ID) }),
  // заявка чужой компании по тому же устройству: клиенту она не видна
  ticket(2, { company: { _id: oid(FOREIGN) }, createdBy: oid(COLLEAGUE_ID) }),
  // заведена самим сотрудником: ему видна на любом ярусе
  ticket(3, { company: { _id: oid(FOREIGN) }, createdBy: oid(STAFF_ID) }),
  // другое устройство: в список этого не попадает
  ticket(4, {
    relatedClientDeviceId: oid(OTHER_DEVICE_ID),
    company: { _id: oid(OWN) },
    createdBy: oid(STAFF_ID),
  }),
];

const numsOf = ({ res }) => res.payload.tickets.map((row) => row.num).sort();

test("device tickets: a client gets 404 for another company's device and no ticket query runs", async () => {
  seedDevices([device({ _id: oid(DEVICE_ID), companyId: oid(FOREIGN) })]);
  seedTickets(tickets);

  const outcome = await call(clientDeviceController.getTickets, {
    auth: client,
    params: { id: DEVICE_ID },
  });

  assertNotFound(outcome);
  assert.equal(ran("Ticket.find"), 0);
  assert.equal(ran("Ticket.countDocuments"), 0);
});

test("device tickets: a client without a company gets 404 for a company-less device", async () => {
  seedDevices([device({ _id: oid(DEVICE_ID) })]);
  seedTickets(tickets);

  const outcome = await call(clientDeviceController.getTickets, {
    auth: homeless,
    params: { id: DEVICE_ID },
  });

  assertNotFound(outcome);
  assert.equal(ran("Ticket.find"), 0);
});

test("device tickets: a client sees only the tickets of own company on an own device", async () => {
  seedDevices([device({ _id: oid(DEVICE_ID), companyId: oid(OWN) })]);
  seedTickets(tickets);

  const outcome = await call(clientDeviceController.getTickets, {
    auth: client,
    params: { id: DEVICE_ID },
  });

  assertOk(outcome);
  assert.deepEqual(numsOf(outcome), [1]);
  assert.equal(outcome.res.payload.total, 1);
});

test("device tickets: staff see a device of any company, but tickets only within their tier", async () => {
  seedDevices([device({ _id: oid(DEVICE_ID), companyId: oid(FOREIGN) })]);
  seedTickets(tickets);

  // Ярус «свои»: через устройство чужих заявок не видно
  const own = await call(clientDeviceController.getTickets, {
    auth: staff,
    params: { id: DEVICE_ID },
  });
  assertOk(own);
  assert.deepEqual(numsOf(own), [3]);
  assert.equal(own.res.payload.total, 1);

  // Ярус «все»: все заявки этого устройства, и только его
  const all = await call(clientDeviceController.getTickets, {
    auth: staffSeesAll,
    params: { id: DEVICE_ID },
  });
  assertOk(all);
  assert.deepEqual(numsOf(all), [1, 2, 3]);
  assert.equal(all.res.payload.total, 3);
});

test("device tickets: an unknown device is 404 for staff as well", async () => {
  seedDevices([]);
  seedTickets(tickets);

  const outcome = await call(clientDeviceController.getTickets, {
    auth: staffSeesAll,
    params: { id: DEVICE_ID },
  });

  assertNotFound(outcome);
  assert.equal(ran("Ticket.find"), 0);
});

test("device tickets: a malformed id ends in 404 through errorResponse", async () => {
  // Модель не подменена: Mongoose бросает CastError на `_id` ещё до обращения к
  // базе, а errorResponse превращает такую ошибку в 404
  const { errors } = await call(clientDeviceController.getTickets, {
    auth: staff,
    params: { id: "not-an-id" },
  });
  assert.equal(errors.length, 1);

  const res = {
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  errorResponse(errors[0], { originalUrl: "/", method: "GET" }, res, () => {});
  assert.equal(res.statusCode, 404);
});

// ─── Подбор комплектующих (getAttachable) ─────────────────────────────────

const RAM_TYPE = oid("66ff00000000000000000001");

const part = (n, companyId) =>
  device({
    _id: oid(`66ff0000000000000000001${n}`),
    companyId: oid(companyId),
    deviceTypeId: { _id: RAM_TYPE, name: "Память" },
    serialNumber: companyId === OWN ? "own" : "foreign",
  });

const seedParts = () => {
  seedDevices([part(1, OWN), part(2, FOREIGN)]);
  DeviceType.find = () => query([{ _id: RAM_TYPE, attachableToTypeIds: [] }]);
};

const serialsOf = ({ res }) =>
  res.payload.map((doc) => doc.serialNumber).sort();

test("attachable: a client gets own-company parts for the own company only", async () => {
  seedParts();
  const outcome = await call(clientDeviceController.getAttachable, {
    auth: client,
    query: { companyId: OWN },
  });
  assertOk(outcome);
  assert.deepEqual(serialsOf(outcome), ["own"]);
});

test("attachable: a client asking for another company, or with a crafted parameter, gets an empty list and no query", async () => {
  seedParts();
  // Клиенту в query подставляют чужую компанию, повторённый параметр
  // (`?companyId=a&companyId=b` — массив) и объект с оператором. Объект express 5
  // с простым разбором query сегодня не отдаёт, но обработчик не должен зависеть
  // от настройки парсера: при `extended` такой `$ne` вернул бы чужую технику
  for (const companyId of [FOREIGN, [OWN, FOREIGN], { $ne: OWN }, undefined]) {
    const outcome = await call(clientDeviceController.getAttachable, {
      auth: client,
      query: { companyId },
    });
    assertOk(outcome);
    assert.deepEqual(outcome.res.payload, []);
  }
  assert.equal(ran("ClientDevice.find"), 0);
});

test("attachable: staff may ask for any company, but only a single real id", async () => {
  seedParts();
  const foreign = await call(clientDeviceController.getAttachable, {
    auth: staff,
    query: { companyId: FOREIGN },
  });
  assertOk(foreign);
  assert.deepEqual(serialsOf(foreign), ["foreign"]);

  const crafted = await call(clientDeviceController.getAttachable, {
    auth: staff,
    query: { companyId: [OWN, FOREIGN] },
  });
  assertOk(crafted);
  assert.deepEqual(crafted.res.payload, []);
});

// ─── Техника пользователя (getUserTech) ───────────────────────────────────

const WORKPLACE_ID = oid("66a100000000000000000001");
const ROOM_ID = oid("66a100000000000000000002");
const ELSEWHERE_ID = oid("66a100000000000000000003");

const unit = (n, name, fields) =>
  device({
    _id: oid(`66a2${String(n).padStart(20, "0")}`),
    deviceModelId: { name },
    ...fields,
  });

const techDevices = [
  unit(1, "Личный ноутбук", {
    userId: oid(CLIENT_ID),
    locationId: ELSEWHERE_ID,
    companyId: oid(OWN),
  }),
  unit(2, "Моноблок", { locationId: WORKPLACE_ID, companyId: oid(OWN) }),
  unit(3, "Чужой моноблок", {
    locationId: WORKPLACE_ID,
    companyId: oid(FOREIGN),
  }),
  unit(4, "МФУ", { locationId: ROOM_ID, companyId: oid(OWN) }),
  unit(5, "Чужой принтер", { locationId: ROOM_ID, companyId: oid(FOREIGN) }),
  unit(6, "Модуль памяти", {
    locationId: WORKPLACE_ID,
    companyId: oid(OWN),
    parentDeviceId: oid("66a20000000000000000000f"),
  }),
  unit(7, "Списанный", {
    locationId: WORKPLACE_ID,
    companyId: oid(OWN),
    deletedAt: new Date(),
  }),
  // Без компании: у устройства она необязательна
  unit(8, "Без компании", { locationId: ROOM_ID }),
  // Закреплено лично, но компании нет: клиенту больше не показывается
  unit(9, "Личный без компании", {
    userId: oid(CLIENT_ID),
    locationId: ELSEWHERE_ID,
  }),
  // Закреплено лично за человеком, но числится за другой компанией: у клиента
  // это были бы чужие модель и инвентарный номер
  unit(10, "Личный чужой", {
    userId: oid(CLIENT_ID),
    locationId: ELSEWHERE_ID,
    companyId: oid(FOREIGN),
  }),
];

const seedTech = () => {
  seedDevices(techDevices);
  User.findById = () =>
    query({
      _id: oid(CLIENT_ID),
      firstName: "Анна",
      lastName: "Клиентова",
      company: { _id: oid(OWN) },
    });
  Location.getUserWorkplaces = async () => [
    {
      _id: WORKPLACE_ID,
      name: "РМ 12",
      parent: { _id: ROOM_ID, name: "Кабинет 12", type: "room" },
    },
  ];
};

const groupsOf = ({ res }) =>
  Object.fromEntries(
    res.payload.groups.map((group) => [
      group.key,
      group.devices.map((unitDto) => unitDto.name),
    ]),
  );

test("user tech: a client sees only own-company devices at the desk and in the room", async () => {
  seedTech();
  const outcome = await call(locationController.getUserTech, {
    auth: client,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  assert.deepEqual(groupsOf(outcome), {
    own: ["Личный ноутбук", "Моноблок"],
    nearby: ["МФУ"],
  });
  assert.equal(outcome.res.payload.total, 3);
});

test("user tech: a client without a company sees no devices, not the company-less ones", async () => {
  seedTech();
  const outcome = await call(locationController.getUserTech, {
    auth: homeless,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  assert.deepEqual(outcome.res.payload.groups, []);
  assert.equal(outcome.res.payload.total, 0);
});

test("user tech: staff see every company's devices", async () => {
  seedTech();
  const outcome = await call(locationController.getUserTech, {
    auth: staff,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  assert.deepEqual(groupsOf(outcome), {
    own: [
      "Личный без компании",
      "Личный ноутбук",
      "Личный чужой",
      "Моноблок",
      "Чужой моноблок",
    ],
    nearby: ["Без компании", "МФУ", "Чужой принтер"],
  });
  assert.equal(outcome.res.payload.total, 8);
});

// ─── Окружение пользователя (getUserEnvironment) ──────────────────────────

// Расположения «базы»: у рабочего места родитель — сырой id (populate делает
// getUserWorkplaces), а помещение — корень цепочки
const locations = [
  {
    _id: ROOM_ID,
    name: "Кабинет 12",
    type: "room",
    parent: null,
    isActive: true,
  },
  {
    _id: WORKPLACE_ID,
    name: "РМ 12",
    type: "workplace",
    parent: ROOM_ID,
    isActive: true,
  },
];

// Те же устройства, что у «Техники пользователя», плюс дерево расположений:
// цепочку (buildLocationChain) и вложенные узлы (buildEnvNode) ведут find/findById
const seedEnvironment = () => {
  seedTech();
  Location.find = (filter) => query(locations.filter(sift(filter)));
  Location.findById = (id) =>
    query(locations.find((doc) => String(doc._id) === String(id)) ?? null);
};

// Состав без привязки к порядку: порядок отдаёт база
const namesOf = (devices) => devices.map((dto) => dto.name).sort();

test("user environment: a client sees only own-company devices, personal ones and the whole chain", async () => {
  seedEnvironment();
  const outcome = await call(locationController.getUserEnvironment, {
    auth: client,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  const { personalDevices, chain } = outcome.res.payload;

  // Личная техника: чужая и без компании закреплены за человеком, но не видны
  assert.deepEqual(namesOf(personalDevices), ["Личный ноутбук"]);
  // Цепочка корень → рабочее место, на каждом узле — только своя техника
  assert.deepEqual(
    chain.map((node) => node.name),
    ["Кабинет 12", "РМ 12"],
  );
  assert.deepEqual(namesOf(chain[0].devices), ["МФУ"]);
  assert.deepEqual(namesOf(chain[1].devices), ["Моноблок"]);
  // Счётчик вложенного узла считает только свою технику, и считает её верно:
  // это агрегат, а aggregate() не приводит типы, поэтому 1 (а не 0) получается
  // лишь когда скоуп в $match — ObjectId (deviceScopeMatch). Заглушка агрегата
  // сравнивает типы строго, как база: со строкой здесь было бы 0
  assert.deepEqual(
    chain[0].children.map((child) => [child.name, child.deviceCount]),
    [["РМ 12", 1]],
  );
});

test("user environment: without a workplace a client gets only own-company personal devices", async () => {
  seedEnvironment();
  Location.getUserWorkplaces = async () => [];
  const outcome = await call(locationController.getUserEnvironment, {
    auth: client,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  assert.equal(outcome.res.payload.workplace, null);
  assert.equal(outcome.res.payload.chain, null);
  assert.deepEqual(namesOf(outcome.res.payload.personalDevices), [
    "Личный ноутбук",
  ]);
});

test("user environment: staff see every company's devices", async () => {
  seedEnvironment();
  const outcome = await call(locationController.getUserEnvironment, {
    auth: staff,
    params: { userId: CLIENT_ID },
  });
  assertOk(outcome);
  const { personalDevices, chain } = outcome.res.payload;

  assert.deepEqual(
    namesOf(personalDevices),
    ["Личный без компании", "Личный ноутбук", "Личный чужой"].sort(),
  );
  assert.deepEqual(
    namesOf(chain[0].devices),
    ["Без компании", "МФУ", "Чужой принтер"].sort(),
  );
  assert.deepEqual(
    namesOf(chain[1].devices),
    ["Моноблок", "Чужой моноблок"].sort(),
  );
  assert.deepEqual(
    chain[0].children.map((child) => [child.name, child.deviceCount]),
    [["РМ 12", 2]],
  );
});

// ─── Сборки: комплектующие и хозяин (getOne, getAll) ──────────────────────

/**
 * Состав сборки бывает смешанным: хозяина переводят в другую компанию, а детали
 * остаются прежними (update меняет companyId хозяина и не трогает детали).
 * Клиент не должен видеть через связь «сборка — деталь» то, что ему не видно
 * напрямую: ни чужую деталь, ни чужого хозяина, ни их число.
 */
const HOST_OWN = oid("66b100000000000000000001");
const HOST_FOREIGN = oid("66b100000000000000000002");
const partId = (n) => oid(`66b2${String(n).padStart(20, "0")}`);
const OWN_PART = partId(1);
const FOREIGN_PART = partId(2);
const PART_IN_FOREIGN_HOST = partId(3);

const assembly = [
  device({
    _id: HOST_OWN,
    companyId: oid(OWN),
    inventoryNumber: "A-001",
    deviceModelId: { name: "Системный блок A" },
  }),
  device({
    _id: HOST_FOREIGN,
    companyId: oid(FOREIGN),
    inventoryNumber: "B-001",
    deviceModelId: { name: "Сервер B" },
  }),
  // В своей сборке: одна деталь своей компании, одна чужая
  device({
    _id: OWN_PART,
    companyId: oid(OWN),
    parentDeviceId: HOST_OWN,
    serialNumber: "own-part",
    deviceModelId: { name: "Память A" },
  }),
  device({
    _id: FOREIGN_PART,
    companyId: oid(FOREIGN),
    parentDeviceId: HOST_OWN,
    serialNumber: "foreign-part",
    deviceModelId: { name: "Диск B" },
  }),
  // Деталь своей компании внутри чужой сборки
  device({
    _id: PART_IN_FOREIGN_HOST,
    companyId: oid(OWN),
    parentDeviceId: HOST_FOREIGN,
    serialNumber: "own-part-in-foreign-host",
    deviceModelId: { name: "Блок питания A" },
  }),
];

const openCard = (auth, id) =>
  call(clientDeviceController.getOne, { auth, params: { id: String(id) } });

const serialsOfComponents = ({ res }) =>
  res.payload.components.map((doc) => doc.serialNumber).sort();

test("device card: a client does not get the parts of another company from a mixed assembly", async () => {
  seedDevices(assembly);

  const asClient = await openCard(client, HOST_OWN);
  assertOk(asClient);
  assert.deepEqual(serialsOfComponents(asClient), ["own-part"]);

  // Сотрудник видит весь состав, как раньше
  const asStaff = await openCard(staff, HOST_OWN);
  assertOk(asStaff);
  assert.deepEqual(serialsOfComponents(asStaff), ["foreign-part", "own-part"]);
});

test("device card: a client does not get the host of a component when the host is another company's", async () => {
  seedDevices(assembly);

  // Деталь своей компании в чужой сборке: хозяина клиент не видит
  const orphan = await openCard(client, PART_IN_FOREIGN_HOST);
  assertOk(orphan);
  assert.equal(orphan.res.payload.parentDeviceId, null);

  // Хозяин своей компании остаётся: по нему карточка ведёт «наверх»
  const mounted = await openCard(client, OWN_PART);
  assertOk(mounted);
  assert.equal(mounted.res.payload.parentDeviceId.inventoryNumber, "A-001");

  // Сотрудник видит хозяина любой компании, как раньше
  const asStaff = await openCard(staff, PART_IN_FOREIGN_HOST);
  assertOk(asStaff);
  assert.equal(asStaff.res.payload.parentDeviceId.inventoryNumber, "B-001");
});

const rowOf = ({ res }, id) =>
  res.payload.devices.find((row) => String(row._id) === String(id));

test("device list: a client's rows name only visible hosts and count only visible parts", async () => {
  seedDevices(assembly);
  const outcome = await call(clientDeviceController.getAll, {
    auth: client,
    query: { components: "any" },
  });
  assertOk(outcome);

  // Строки чужой компании в выдаче нет; своя сборка не считает чужую деталь
  assert.deepEqual(
    outcome.res.payload.devices.map((row) => String(row._id)).sort(),
    [HOST_OWN, OWN_PART, PART_IN_FOREIGN_HOST].map(String).sort(),
  );
  assert.equal(rowOf(outcome, HOST_OWN).componentCount, 1);

  // Деталь в своей сборке называет хозяина, деталь в чужой — нет
  assert.deepEqual(rowOf(outcome, OWN_PART).parent, {
    _id: HOST_OWN,
    name: "Системный блок A",
    inventoryNumber: "A-001",
  });
  assert.equal(rowOf(outcome, PART_IN_FOREIGN_HOST).parent, null);
});

test("device list: staff see every host and every part, as before", async () => {
  seedDevices(assembly);
  const outcome = await call(clientDeviceController.getAll, {
    auth: staff,
    query: { components: "any" },
  });
  assertOk(outcome);

  assert.equal(outcome.res.payload.devices.length, assembly.length);
  assert.equal(rowOf(outcome, HOST_OWN).componentCount, 2);
  assert.equal(rowOf(outcome, HOST_FOREIGN).componentCount, 1);
  assert.deepEqual(rowOf(outcome, PART_IN_FOREIGN_HOST).parent, {
    _id: HOST_FOREIGN,
    name: "Сервер B",
    inventoryNumber: "B-001",
  });
});
