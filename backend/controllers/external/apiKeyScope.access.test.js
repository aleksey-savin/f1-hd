// node --test controllers/external/apiKeyScope.access.test.js
require("module-alias/register");
const { test, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
const sift = require("sift").default;

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Внешний API по ключу компании: заявка (`createTicket`) и журнал входов AD
 * (`addUserActivity`). Правила отбора людей проверяет services/externalApi.test.js;
 * здесь — что КАЖДАЯ ручка ими пользуется: тест чистых функций не заметит
 * обработчик, который снова спросил `User.findById(req.body.userId)` мимо них.
 * А ключ лежит на рабочих станциях клиента, и тело запроса — чужой ввод.
 *
 * Исполняются настоящие обработчики. «База» — массивы людей, компаний и
 * категорий в памяти: статические методы моделей подменены, а фильтр приводится
 * к схеме настоящим Mongoose (`Query#cast`: id становятся ObjectId, почта —
 * нижним регистром, оператор вроде `{ $regex }` остаётся оператором, как и на
 * проде) и сопоставляется по правилам Mongo (sift). Поэтому запрос, в который
 * попал оператор или чужой id, находит чужого человека — как нашёл бы настоящий.
 *
 * Модель заявок и хранилище файлов подменены в require.cache до загрузки
 * контроллеров: models/ticket.js на верхнем уровне зовёт initCounter(), а
 * services/storage создаёт каталог и клиента S3. Заявка здесь — запись того, что
 * передано конструктору; у журналов настоящие модели, save проверяет схему и
 * запоминает документ. Появится у обработчика новый запрос — подменить его тут
 * же. `Company.findOne` подменён хотя обработчик компании не спрашивает: прежняя
 * реализация брала компанию заявителя из базы, и вернись она — тест увидит
 * чужую компанию в заявке, а не «запрос не подменён».
 */

const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};

// Что «записано в базу» за тест
const written = { tickets: [], ticketLogs: [], companyLogs: [] };
// Если задана — сохранение заявки падает с ней
let saveFailure = null;

class FakeTicket {
  constructor(doc) {
    Object.assign(this, doc);
    this._id = new mongoose.Types.ObjectId();
  }

  async save() {
    if (saveFailure) throw saveFailure;
    this.num = 51713;
    this.createdAt = new Date();
    written.tickets.push(this);
    return this;
  }
}
stubModule("@/models/ticket", {
  Ticket: FakeTicket,
  ticketDefaultFieldsSchema: {},
  initializeCounter: async () => {},
});

// Ключи файлов, которые обработчик убрал после сбоя
const deletedFiles = [];
stubModule("@/services/storage", {
  deleteObject: async (key) => {
    deletedFiles.push(key);
  },
});

const Company = require("@/models/company");
const CompanyLog = require("@/models/companyLog");
const Preferences = require("@/models/preferences");
const TicketCategory = require("@/models/ticketCategory");
const TicketLog = require("@/models/ticketLog");
const User = require("@/models/user");
const logger = require("@/utils/logger");

const { createTicket } = require("./ticket");
const { addUserActivity } = require("@/controllers/log/companyLog");

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const KEY_COMPANY = oid("66aa000000000000000000c1"); // компания ключа
const OTHER_COMPANY = oid("66aa000000000000000000c2"); // чужой клиент
const OUR_COMPANY = oid("66aa000000000000000000f0"); // сам сервис: сотрудники и пользователь по умолчанию

const COMPANIES = [
  { _id: KEY_COMPANY, alias: "Ромашка", isActive: true },
  { _id: OTHER_COMPANY, alias: "Чужая", isActive: true },
  { _id: OUR_COMPANY, alias: "F1", isActive: true },
];

const snapshot = ({ _id, alias }) => ({ _id, alias, isActive: true });

// Своя компания: клиент ключа
const ANNA = {
  _id: oid("66aa000000000000000000a1"),
  email: "anna@romashka.ru",
  firstName: "Анна",
  lastName: "Петрова",
  activeDirectoryObjectGUID: "guid-anna",
  company: snapshot(COMPANIES[0]),
};
// Свой же, но отключённый
const GONE = {
  _id: oid("66aa000000000000000000a2"),
  email: "gone@romashka.ru",
  firstName: "Олег",
  lastName: "Уволен",
  banned: true,
  company: snapshot(COMPANIES[0]),
};
// Чужая компания
const BORIS = {
  _id: oid("66aa000000000000000000b1"),
  email: "boss@other.ru",
  firstName: "Борис",
  lastName: "Чужой",
  activeDirectoryObjectGUID: "guid-boss",
  company: snapshot(COMPANIES[1]),
};
// Сотрудник сервиса
const DISPATCHER = {
  _id: oid("66aa000000000000000000f2"),
  email: "dispatcher@f1lab.ru",
  firstName: "Пётр",
  lastName: "Диспетчеров",
  activeDirectoryObjectGUID: "guid-dispatcher",
  isEndUser: false,
  company: snapshot(COMPANIES[2]),
};
// Пользователь по умолчанию из настроек: служебная учётка сервиса
const ADMIN = {
  _id: oid("66aa000000000000000000f1"),
  email: "admin@f1lab.ru",
  firstName: "Админ",
  lastName: "Наш",
  isEndUser: false,
  company: snapshot(COMPANIES[2]),
};
// Чужой — первым: запрос с оператором берёт первого подходящего, и это должен
// быть человек, которого ключу видеть нельзя
const USERS = [BORIS, DISPATCHER, ANNA, GONE, ADMIN];

const KNOWN_CATEGORY = "66aa000000000000000000e1";
const CATEGORIES = [{ _id: oid(KNOWN_CATEGORY), title: "Принтеры" }];

const DEFAULT_PREFERENCES = () => ({
  defaultApplicant: { _id: ADMIN._id },
  deadline: 24,
});
let preferences = DEFAULT_PREFERENCES();

// Запросы к людям и категориям — как они пришли в модель, до приведения к схеме
const queries = [];

// Одна запись по фильтру, приведённому к схеме Mongoose; битый id — CastError
const findOne = (Model, docs, filter) =>
  docs.find(sift(Model.find({ ...filter }).cast(Model))) ?? null;

const project = (doc, fields) => {
  if (!doc || !fields) return doc;
  const picked = { _id: doc._id };
  for (const name of fields.split(/\s+/).filter(Boolean)) picked[name] = doc[name];
  return picked;
};

/**
 * Запрос Mongoose в виде заглушки: `select` оставляет перечисленные поля (и
 * `_id`), `await` отдаёт результат. Считается лениво, внутри `then`: битый id
 * падает при `await`, как у настоящего запроса.
 */
const query = (compute) => {
  let fields = null;
  const chain = {
    select(spec) {
      fields = spec;
      return chain;
    },
    lean: () => chain,
    then: (onFulfilled, onRejected) =>
      new Promise((resolve) => resolve(project(compute(), fields))).then(
        onFulfilled,
        onRejected,
      ),
  };
  return chain;
};

const originals = {
  userFindOne: User.findOne,
  userFindById: User.findById,
  companyFindOne: Company.findOne,
  categoryExists: TicketCategory.exists,
  prefsFindOne: Preferences.findOne,
  loggerLog: logger.log,
};

User.findOne = (filter) => {
  queries.push({ method: "User.findOne", filter });
  return query(() => findOne(User, USERS, filter));
};
// Как у Mongoose: findById(id) — это findOne({ _id: id }), и оператор вместо
// id проходит в запрос так же
User.findById = (id) => {
  queries.push({ method: "User.findById", filter: { _id: id } });
  return query(() => findOne(User, USERS, { _id: id }));
};
Company.findOne = (filter) => query(() => findOne(Company, COMPANIES, filter));
TicketCategory.exists = (filter) => {
  queries.push({ method: "TicketCategory.exists", filter });
  return query(() => {
    const found = findOne(TicketCategory, CATEGORIES, filter);
    return found ? { _id: found._id } : null;
  });
};
Preferences.findOne = () => query(() => preferences);

TicketLog.prototype.save = async function save() {
  await this.validate();
  written.ticketLogs.push(this.toObject());
  return this;
};
CompanyLog.prototype.save = async function save() {
  await this.validate();
  written.companyLogs.push(this.toObject());
  return this;
};

// Журнал приложения: что обработчик в него написал
const logs = [];
logger.log = (level, message, meta) => {
  logs.push({ level, message, meta });
};

afterEach(() => {
  queries.length = 0;
  logs.length = 0;
  deletedFiles.length = 0;
  written.tickets.length = 0;
  written.ticketLogs.length = 0;
  written.companyLogs.length = 0;
  saveFailure = null;
  preferences = DEFAULT_PREFERENCES();
});

after(() => {
  User.findOne = originals.userFindOne;
  User.findById = originals.userFindById;
  Company.findOne = originals.companyFindOne;
  TicketCategory.exists = originals.categoryExists;
  Preferences.findOne = originals.prefsFindOne;
  logger.log = originals.loggerLog;
  // Своё свойство прототипа убирается, чтобы снова виден был метод Model
  delete TicketLog.prototype.save;
  delete CompanyLog.prototype.save;
});

/**
 * В запросы к людям и категориям попадают только строки (id из тела) и ObjectId
 * (компания ключа, id пользователя по умолчанию), плюс `banned: { $ne: true }`,
 * которое строит сам код. Любой другой объект — оператор из тела, дошедший до
 * базы. Зовётся только в тестах с операторами в теле: остальные проверяют
 * другое, и посторонний оператор в запросе (у прежней реализации это
 * `company.isActive: { $ne: false }`) заслонил бы им причину отказа.
 */
const assertOnlyPlainValues = () => {
  for (const { method, filter } of queries) {
    for (const [path, value] of Object.entries(filter)) {
      if (path === "banned") {
        assert.deepEqual(value, { $ne: true }, `${method}: banned`);
        continue;
      }
      assert.ok(
        typeof value === "string" || value instanceof mongoose.Types.ObjectId,
        `${method}: ${path} = ${JSON.stringify(value)} is not a plain value`,
      );
    }
  }
};

const keyCompany = {
  _id: KEY_COMPANY,
  alias: "Ромашка",
  fullTitle: "ООО «Ромашка»",
  apiKey: { _id: oid("66aa000000000000000000d1"), name: "AD" },
};

const call = async (handler, req) => {
  let failure = null;
  let sent = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent = {
        status: this.statusCode,
        payload,
        wire: JSON.stringify(payload),
      };
      return this;
    },
  };
  await handler({ company: keyCompany, ...req }, res, (error) => {
    failure = error;
  });
  return { failure, sent };
};

const create = (body, extra = {}) => call(createTicket, { body, ...extra });
const logLogin = (body) => call(addUserActivity, { body });

// Упавший обработчик отдаёт 500 через next — настоящую причину показываем
const assertSucceeded = ({ failure, sent }, status) => {
  assert.equal(failure, null, failure?.originalError?.stack ?? String(failure));
  assert.equal(sent.status, status);
};

const onlyTicket = () => {
  assert.equal(written.tickets.length, 1, "exactly one ticket is written");
  return written.tickets[0];
};

const BODY = {
  title: "Не печатает принтер",
  description: "Кабинет 12, HP LaserJet",
};

test("premise: the stub database finds people of any company by id, e-mail or an operator", async () => {
  // Без этого остальные тесты прошли бы и на «базе», что ничего не находит, —
  // молча ничего не доказав
  assert.equal((await User.findById(BORIS._id)).firstName, "Борис");
  assert.equal((await User.findOne({ email: "boss@other.ru" })).firstName, "Борис");
  assert.equal(
    (await User.findOne({ activeDirectoryObjectGUID: "guid-boss" })).firstName,
    "Борис",
  );
  // Оператор находит первого попавшегося — как на проде
  assert.equal((await User.findOne({ email: { $regex: "." } })).firstName, "Борис");
  assert.equal((await User.findById({ $ne: null })).firstName, "Борис");
  // Запрос в пределах компании чужого не находит
  assert.equal(
    await User.findOne({ _id: BORIS._id, "company._id": KEY_COMPANY }),
    null,
  );
  // select оставляет только перечисленное
  assert.deepEqual(
    Object.keys(await User.findOne({ email: "anna@romashka.ru" }).select("firstName lastName")),
    ["_id", "firstName", "lastName"],
  );
});

/* ------------------------------ createTicket ------------------------------ */

for (const [how, identity] of [
  ["id", { userId: String(ANNA._id) }],
  ["e-mail in any case and padding", { userEmail: " Anna@Romashka.RU " }],
  [
    "a stale id with the right e-mail",
    { userId: "66aa0000000000000000dead", userEmail: "anna@romashka.ru" },
  ],
]) {
  test(`createTicket, a person of the key's company by ${how}: the applicant, in the key's company`, async () => {
    const result = await create({ ...BODY, ...identity });

    assertSucceeded(result, 201);
    const ticket = onlyTicket();
    assert.equal(String(ticket.applicantId), String(ANNA._id));
    assert.equal(String(ticket.createdBy), String(ANNA._id));
    assert.equal(String(ticket.updatedBy), String(ANNA._id));
    assert.equal(String(ticket.company._id), String(KEY_COMPANY));
    assert.equal(ticket.company.alias, "Ромашка");
    // Имя в ответе — человека, а не пользователя по умолчанию (почта — в
    // отдельном тесте ниже)
    const { _id, firstName, lastName } = JSON.parse(result.sent.wire).ticket.applicant;
    assert.deepEqual(
      { _id, firstName, lastName },
      { _id: String(ANNA._id), firstName: "Анна", lastName: "Петрова" },
    );
  });
}

for (const [who, identity] of [
  ["nobody named", {}],
  ["a person of ANOTHER company by id", { userId: String(BORIS._id) }],
  ["a person of ANOTHER company by e-mail", { userEmail: "boss@other.ru" }],
  ["a staff member by id", { userId: String(DISPATCHER._id) }],
  ["a staff member by e-mail", { userEmail: "dispatcher@f1lab.ru" }],
  ["a disabled colleague by e-mail", { userEmail: "gone@romashka.ru" }],
]) {
  test(`createTicket, ${who}: the default applicant, in the KEY's company`, async () => {
    const result = await create({ ...BODY, ...identity });

    assertSucceeded(result, 201);
    const ticket = onlyTicket();
    // Заявка от пользователя по умолчанию, а не от названного
    assert.equal(String(ticket.applicantId), String(ADMIN._id));
    assert.equal(String(ticket.createdBy), String(ADMIN._id));
    // Компания — ключа: ни чужого клиента, ни самого сервиса (компания
    // пользователя по умолчанию заявке не навязывается)
    assert.equal(String(ticket.company._id), String(KEY_COMPANY));
    assert.equal(ticket.company.alias, "Ромашка");
    const wire = JSON.stringify(ticket) + result.sent.wire;
    assert.ok(!wire.includes(String(OTHER_COMPANY)), "another company leaked");
    assert.ok(!wire.includes(String(OUR_COMPANY)), "the default applicant's company leaked");
    const { _id, firstName, lastName } = JSON.parse(result.sent.wire).ticket.applicant;
    assert.deepEqual(
      { _id, firstName, lastName },
      { _id: String(ADMIN._id), firstName: "Админ", lastName: "Наш" },
    );
  });
}

for (const [what, extra] of [
  ["responsibles and a past deadline", { responsibles: [String(ADMIN._id), String(DISPATCHER._id)], deadline: "2020-01-01" }],
  ["a single responsible and a junk deadline", { responsibles: String(DISPATCHER._id), deadline: "not a date" }],
  ["responsibles as documents", { responsibles: [{ _id: String(ADMIN._id), firstName: "Админ" }], deadline: 0 }],
]) {
  test(`createTicket, ${what} in the body are ignored: nobody assigned, deadline from the settings`, async () => {
    const before = Date.now();
    const result = await create({ ...BODY, userEmail: "anna@romashka.ru", ...extra });
    const after = Date.now();

    assertSucceeded(result, 201);
    const ticket = onlyTicket();
    assert.deepEqual(ticket.responsibles, []);
    // Срок — всегда «сейчас + настройки» (в часах)
    const day = 24 * 60 * 60 * 1000;
    assert.ok(ticket.deadline instanceof Date);
    assert.ok(
      ticket.deadline.getTime() >= before + day &&
        ticket.deadline.getTime() <= after + day,
      `deadline is ${ticket.deadline.toISOString()}`,
    );
    assert.equal(JSON.parse(result.sent.wire).ticket.deadline, ticket.deadline.toISOString());
  });
}

test("createTicket: the body cannot choose the company, the author or the state either", async () => {
  const result = await create({
    ...BODY,
    userEmail: "anna@romashka.ru",
    company: { _id: String(OTHER_COMPANY), alias: "Чужая" },
    companyId: String(OTHER_COMPANY),
    applicantId: String(BORIS._id),
    createdBy: String(BORIS._id),
    updatedBy: String(BORIS._id),
    state: "Закрыта",
    isClosed: true,
    notifications: { pending: false },
  });

  assertSucceeded(result, 201);
  const ticket = onlyTicket();
  assert.equal(String(ticket.company._id), String(KEY_COMPANY));
  assert.equal(String(ticket.applicantId), String(ANNA._id));
  assert.equal(String(ticket.createdBy), String(ANNA._id));
  assert.equal(String(ticket.updatedBy), String(ANNA._id));
  assert.equal(ticket.state, "Новая");
  assert.equal(ticket.isClosed, false);
  assert.deepEqual(ticket.notifications, { lastAction: "new ticket", pending: true });
});

// Тело multipart-запроса приходит мимо охраны JSON: `userEmail[$regex]=.` multer
// разбирает в объект, повторённое поле — в массив
for (const [what, extra] of [
  ["userEmail { $regex }", { userEmail: { $regex: "." } }],
  ["userId { $ne }", { userId: { $ne: null } }],
  ["userId { $gt } with userEmail { $ne }", { userId: { $gt: "" }, userEmail: { $ne: null } }],
  ["userEmail as an array", { userEmail: ["anna@romashka.ru"] }],
]) {
  test(`createTicket, ${what}: never reaches a query as an operator`, async () => {
    const result = await create({ ...BODY, ...extra });

    // Объект из тела в запрос не попал — а значит, и первый попавшийся человек
    // заявителем не стал (ниже)
    assertOnlyPlainValues();
    assert.ok(!JSON.stringify(queries).includes("$regex"));
    assert.ok(!JSON.stringify(queries).includes("$gt"));
    assertSucceeded(result, 201);
    const ticket = onlyTicket();
    const expectedApplicant = extra.userEmail === "anna@romashka.ru" ? ANNA : ADMIN;
    assert.equal(String(ticket.applicantId), String(expectedApplicant._id));
    assert.equal(String(ticket.company._id), String(KEY_COMPANY));
  });
}

for (const [who, identity] of [
  ["an applicant of the key's company", { userEmail: "anna@romashka.ru" }],
  ["the default applicant", { userEmail: "boss@other.ru" }],
]) {
  test(`createTicket, ${who}: the answer carries no e-mail`, async () => {
    const result = await create({ ...BODY, ...identity });

    assertSucceeded(result, 201);
    // Ни адреса того, кто назван, ни любого другого: по сети не уходит почта
    for (const user of USERS) {
      assert.ok(!result.sent.wire.includes(user.email), `${user.email} leaked`);
    }
    assert.doesNotMatch(result.sent.wire, /@/);
    // А то, что читает интеграция, на месте
    const { success, message, ticket } = JSON.parse(result.sent.wire);
    assert.equal(success, true);
    assert.equal(message, "Заявка успешно создана");
    assert.deepEqual(Object.keys(ticket).sort(), [
      "_id", "applicant", "company", "createdAt", "deadline", "description", "num", "state", "title",
    ]);
    assert.equal(ticket.num, 51713);
    assert.equal(ticket.title, BODY.title);
    assert.equal(ticket.state, "Новая");
    assert.deepEqual(ticket.company, { _id: String(KEY_COMPANY), alias: "Ромашка" });
  });
}

test("createTicket, a failure: the error log carries no request body, the uploaded files are removed", async () => {
  saveFailure = new Error("boom");
  const secret = "Пароль от роутера: hunter2";
  const files = [
    { key: "uploads/a1.png", mimetype: "image/png" },
    { key: "uploads/a2.pdf", mimetype: "application/pdf" },
  ];

  const { failure, sent } = await create(
    { ...BODY, description: secret, userEmail: "anna@romashka.ru", userId: String(ANNA._id) },
    { files },
  );

  assert.equal(sent, null);
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.message, "Ошибка при создании заявки");

  const errors = logs.filter(({ level }) => level === "error");
  assert.ok(errors.length >= 1, "the failure is logged");
  for (const { meta } of errors) {
    const wire = JSON.stringify(meta);
    assert.ok(!("body" in meta), "req.body is logged");
    // Ни текст обращения, ни заголовок, ни адрес человека
    for (const fragment of ["hunter2", BODY.title, "anna@romashka.ru", String(ANNA._id)]) {
      assert.ok(!wire.includes(fragment), `${fragment} is in the error log`);
    }
  }
  // Запись при этом осталась полезной: причина, стек, чей ключ
  const entry = errors.find(({ message }) => message.includes("внешний API"));
  assert.equal(entry.meta.error, "boom");
  assert.ok(entry.meta.stack.includes("boom"));
  assert.equal(String(entry.meta.companyId), String(KEY_COMPANY));
  // Загруженные файлы убраны
  assert.deepEqual(deletedFiles, ["uploads/a1.png", "uploads/a2.pdf"]);
  assert.equal(written.tickets.length, 0);
});

test("createTicket: a category is kept only as the id of an existing one", async () => {
  const known = await create({ ...BODY, categoryId: KNOWN_CATEGORY });
  assertSucceeded(known, 201);
  assert.equal(String(onlyTicket().categoryId), KNOWN_CATEGORY);

  // Неизвестная, битая, пустая и объектная (multipart: `categoryId[$ne]=`) —
  // заявка без категории, а в запрос к категориям объект не попадает
  for (const categoryId of [
    "66aa000000000000000000e2",
    "not-an-id",
    "",
    undefined,
    { $ne: null },
    [KNOWN_CATEGORY],
  ]) {
    written.tickets.length = 0;
    queries.length = 0;
    const result = await create({ ...BODY, categoryId });
    assertOnlyPlainValues();
    assertSucceeded(result, 201);
    assert.equal(onlyTicket().categoryId, null, JSON.stringify(categoryId));
  }
});

test("createTicket: files, custom fields and source are taken as before", async () => {
  const result = await create(
    {
      ...BODY,
      userEmail: "anna@romashka.ru",
      customFields: [{ name: "Кабинет", value: "12" }, { value: "без имени" }],
      source: "Сайт",
    },
    { files: [{ key: "uploads/a1.png", mimetype: "image/png" }] },
  );

  assertSucceeded(result, 201);
  const ticket = onlyTicket();
  assert.deepEqual(ticket.attachments, [{ mimetype: "image/png", name: "uploads/a1.png" }]);
  assert.deepEqual(ticket.customFields, [{ name: "Кабинет", value: "12" }]);
  assert.equal(ticket.source, "Сайт");
  assert.equal(ticket.title, BODY.title);
  assert.equal(ticket.description, BODY.description);
  assert.equal(ticket.state, "Новая");
  assert.equal(ticket.isClosed, false);

  // Без файлов, полей и источника — как прежде: пусто и «Другое»
  written.tickets.length = 0;
  assertSucceeded(await create({ title: "Заголовок" }), 201);
  assert.deepEqual(onlyTicket().attachments, []);
  assert.deepEqual(onlyTicket().customFields, []);
  assert.equal(onlyTicket().source, "Другое");
  assert.equal(onlyTicket().description, "");
});

test("createTicket: the ticket log and the application log get their entries", async () => {
  const result = await create({ ...BODY, userEmail: "anna@romashka.ru" });

  assertSucceeded(result, 201);
  const ticket = onlyTicket();
  assert.equal(written.ticketLogs.length, 1);
  const [entry] = written.ticketLogs;
  assert.equal(String(entry.ticketId), String(ticket._id));
  assert.deepEqual(entry.user, { firstName: "Анна", lastName: "Петрова" });
  assert.equal(entry.severity, "info");
  assert.equal(entry.event, "создана новая заявка через внешний API");
  assert.deepEqual(
    logs.map(({ level }) => level),
    ["info"],
  );
  assert.equal(String(logs[0].meta.companyId), String(KEY_COMPANY));
});

test("createTicket: a title is required; the settings and the default applicant are checked", async () => {
  const noTitle = await create({ userEmail: "anna@romashka.ru" });
  assert.equal(noTitle.failure?.statusCode, 400);
  assert.equal(noTitle.failure?.message, "Заголовок заявки обязателен");

  preferences = null;
  const noSettings = await create({ ...BODY });
  assert.equal(noSettings.failure?.statusCode, 500);

  // Настроек пользователя по умолчанию нет, а названный не нашёлся
  preferences = { deadline: 24 };
  const noDefault = await create({ ...BODY, userEmail: "boss@other.ru" });
  assert.equal(noDefault.failure?.statusCode, 400);

  // Он есть в настройках, но пропал из базы
  preferences = { defaultApplicant: { _id: oid("66aa000000000000000000ff") }, deadline: 24 };
  const gone = await create({ ...BODY });
  assert.equal(gone.failure?.statusCode, 500);

  // Названного нашли — пользователь по умолчанию не нужен
  preferences = { deadline: 24 };
  assertSucceeded(await create({ ...BODY, userEmail: "anna@romashka.ru" }), 201);

  assert.equal(written.tickets.length, 1, "only the last request wrote a ticket");
});

/* ----------------------------- addUserActivity ---------------------------- */

const LOGIN = { activeDirectoryLogin: "ROMASHKA\\anna" };

test("addUserActivity: the GUID and the login are required, as strings", async () => {
  for (const body of [
    {},
    { activeDirectoryObjectGUID: "guid-anna" },
    { activeDirectoryLogin: "ROMASHKA\\anna" },
    { ...LOGIN, activeDirectoryObjectGUID: { $ne: null } },
    { ...LOGIN, activeDirectoryObjectGUID: ["guid-anna"] },
    { activeDirectoryObjectGUID: "guid-anna", activeDirectoryLogin: { $ne: null } },
  ]) {
    const { failure } = await logLogin(body);
    assert.equal(failure?.statusCode, 400, JSON.stringify(body));
  }

  assert.equal(written.companyLogs.length, 0);
  assert.equal(queries.length, 0, "a bad request asks the database nothing");
});

test("addUserActivity: a person of the key's company by GUID is linked and named without an e-mail", async () => {
  const result = await logLogin({
    activeDirectoryObjectGUID: "  guid-anna  ",
    activeDirectoryLogin: "  ROMASHKA\\anna ",
    firstName: " Анна ",
    lastName: "Петрова",
    computerName: " PC-12 ",
    // Своя почта агента ни на что не влияет: GUID уже нашёл человека
    email: "someone@else.ru",
    // Компанию записи тело не выбирает
    companyId: String(OTHER_COMPANY),
  });

  assertSucceeded(result, 201);
  const { success, data } = JSON.parse(result.sent.wire);
  assert.equal(success, true);
  assert.equal(data.action, "userLogin");
  assert.deepEqual(data.user, { activeDirectoryLogin: "ROMASHKA\\anna" });
  assert.deepEqual(data.linkedUser, {
    id: String(ANNA._id),
    firstName: "Анна",
    lastName: "Петрова",
  });
  assert.ok(!result.sent.wire.includes("anna@romashka.ru"), "the e-mail leaked");

  assert.equal(written.companyLogs.length, 1);
  const [entry] = written.companyLogs;
  assert.equal(String(entry.companyId), String(KEY_COMPANY));
  assert.equal(String(entry.userId), String(ANNA._id));
  assert.equal(entry.activeDirectoryObjectGUID, "guid-anna");
  assert.equal(entry.activeDirectoryLogin, "ROMASHKA\\anna");
  assert.equal(entry.firstName, "Анна");
  assert.equal(entry.lastName, "Петрова");
  assert.equal(entry.computerName, "PC-12");
});

test("addUserActivity: an unknown GUID falls back to the e-mail inside the key's company", async () => {
  const result = await logLogin({
    ...LOGIN,
    activeDirectoryObjectGUID: "unknown-guid",
    email: " Anna@Romashka.RU ",
  });

  assertSucceeded(result, 201);
  assert.equal(JSON.parse(result.sent.wire).data.linkedUser.id, String(ANNA._id));
  assert.equal(String(written.companyLogs[0].userId), String(ANNA._id));
});

for (const [who, body] of [
  ["a person of ANOTHER company by GUID", { activeDirectoryObjectGUID: "guid-boss" }],
  ["a person of ANOTHER company by e-mail", { activeDirectoryObjectGUID: "unknown-guid", email: "boss@other.ru" }],
  ["a staff member by GUID", { activeDirectoryObjectGUID: "guid-dispatcher" }],
  ["a staff member by e-mail", { activeDirectoryObjectGUID: "unknown-guid", email: "dispatcher@f1lab.ru" }],
]) {
  test(`addUserActivity, ${who}: not linked, not named, the entry stays in the key's company`, async () => {
    const result = await logLogin({ ...LOGIN, ...body });

    assertSucceeded(result, 201);
    const answer = JSON.parse(result.sent.wire);
    assert.equal(answer.data.linkedUser, null);
    // Ни имени, ни почты, ни id чужого человека — ни в каком виде
    for (const user of [BORIS, DISPATCHER]) {
      for (const fragment of [user.firstName, user.lastName, user.email, String(user._id)]) {
        assert.ok(!result.sent.wire.includes(fragment), `${fragment} leaked`);
      }
    }
    assert.equal(written.companyLogs.length, 1);
    assert.equal(written.companyLogs[0].userId, null);
    assert.equal(String(written.companyLogs[0].companyId), String(KEY_COMPANY));
  });
}

test("addUserActivity: a GUID of another company does not stop the e-mail of an own person", async () => {
  const result = await logLogin({
    ...LOGIN,
    activeDirectoryObjectGUID: "guid-boss",
    email: "anna@romashka.ru",
  });

  assertSucceeded(result, 201);
  assert.equal(JSON.parse(result.sent.wire).data.linkedUser.id, String(ANNA._id));
  assert.ok(!result.sent.wire.includes("Борис"));
});

for (const [what, extra] of [
  ["email { $regex }", { email: { $regex: "." } }],
  ["email { $ne }", { email: { $ne: null } }],
  ["email as an array", { email: ["anna@romashka.ru"] }],
]) {
  test(`addUserActivity, ${what}: never reaches a query as an operator`, async () => {
    const result = await logLogin({
      ...LOGIN,
      activeDirectoryObjectGUID: "unknown-guid",
      computerName: { $ne: null },
      ...extra,
    });

    // Объект из тела в запрос не попал — а значит, первый попавшийся человек не
    // связан (ниже)
    assertOnlyPlainValues();
    assert.ok(!JSON.stringify(queries).includes("$regex"));
    assertSucceeded(result, 201);
    assert.equal(JSON.parse(result.sent.wire).data.linkedUser, null);
    assert.equal(written.companyLogs[0].userId, null);
    assert.equal(written.companyLogs[0].computerName, undefined);
  });
}
