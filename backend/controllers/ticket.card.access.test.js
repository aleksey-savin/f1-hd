// node --test controllers/ticket.card.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки контроллера:
 * models/ticket.js на верхнем уровне зовёт initCounter(), и без базы в выводе
 * остаётся «Failed to initialize counter» (тот же приём, что в
 * controllers/company.access.test.js). `ticketDefaultFieldsSchema` нужен
 * models/ticketTemplate.js — контроллер подтягивает его при загрузке.
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
stubModule("@/models/ticket", {
  Ticket,
  ticketDefaultFieldsSchema: {},
  initializeCounter: async () => {},
});

const Company = require("@/models/company");
const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const Subdivision = require("@/models/subdivision");
const TicketLog = require("@/models/ticketLog");
const TicketRead = require("@/models/ticketRead");

const controller = require("./ticket");

/**
 * Что в карточке заявки (`GET /tickets/:num`) уходит под ключом `company`.
 * Отбор полей проверяет services/ticketCardCompany.test.js; здесь — что
 * `getOne` им ПОЛЬЗУЕТСЯ: тест чистой функции не заметит обработчик, который
 * вернул `company.toJSON()` мимо неё — а в нём API-ключи и контакты людей.
 *
 * Исполняется настоящий `getOne`. Подменены только статические методы моделей,
 * сама компания — настоящий документ Mongoose, так что `toJSON()` в ответе тот
 * же, что и на проде. Появится у `getOne` новый запрос на пути без прав
 * (работы, журнал AD — они за правами) — подменить его здесь же.
 */

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const COMPANY_ID = "66aa00000000000000000001";
const EMPLOYEE_ID = "66aa00000000000000000002";
const TICKET_ID = "66cc00000000000000000001";

// Всё, что компания хранит и что карточке не принадлежит: ключ (значение — у
// старых ключей), его отпечаток, снимки контактов людей, услуги, домены
const LEGACY_KEY = "hd_plaintext_legacy_key";
const KEY_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15";
const SECRETS = [
  LEGACY_KEY,
  KEY_HASH,
  "apiKeys",
  "keyHash",
  "ivanov@romashka.ru", // снимок клиента в company.users
  "staff@f1lab.ru", // ответственный компании
  "buhgalter@romashka.ru", // человек компании (employees)
  "79000000000", // его телефон
  "servicePlans",
  "emailDomains",
  "ООО «Ромашка»", // fullTitle
];

// Поля, которые getOne выбирает у людей компании (`select` его populate)
const EMPLOYEE_FIELDS = {
  firstName: 1,
  lastName: 1,
  email: 1,
  phone: 1,
  position: 1,
  banned: 1,
};

const companyDoc = () =>
  new Company({
    _id: oid(COMPANY_ID),
    alias: "Ромашка",
    fullTitle: "ООО «Ромашка»",
    emailDomains: ["romashka.ru"],
    phones: ["74950000000"],
    address: "Москва, Тверская, 1",
    linkToMap: "https://yandex.ru/maps/?pt=37.6,55.7",
    location: { lat: 55.7, lon: 37.6 },
    locationSettings: {
      allowTracking: true,
      latitude: 55.7,
      longitude: 37.6,
      title: "Офис",
      radius: 100,
    },
    timezone: "Asia/Yekaterinburg",
    workSchedule: { Monday: { isWorking: true, start: "09:00", end: "18:00" } },
    users: [
      {
        id: oid("66aa00000000000000000003"),
        fullName: "Иванов Иван",
        email: "ivanov@romashka.ru",
        phone: "79001112233",
      },
    ],
    responsibles: [
      {
        id: oid("66aa00000000000000000004"),
        firstName: "Пётр",
        lastName: "Сидоров",
        email: "staff@f1lab.ru",
        phone: "79114445566",
      },
    ],
    servicePlans: [{ _id: oid("66aa00000000000000000005"), customerApprovalRequired: true }],
    apiKeys: [{ key: LEGACY_KEY, keyHash: KEY_HASH, keyTail: "c15", name: "AD" }],
    // Как после `.populate("employees")` в getOne: документы пользователей с
    // теми же полями, что выбирает populate (без проекции в документ попали бы
    // значения по умолчанию всей схемы — на проде их там нет)
    employees: [
      new User(
        {
          _id: oid(EMPLOYEE_ID),
          firstName: "Иван",
          lastName: "Иванов",
          email: "buhgalter@romashka.ru",
          phone: "79000000000",
          position: "Бухгалтер",
        },
        EMPLOYEE_FIELDS,
      ),
    ],
  });

/**
 * Запрос Mongoose в виде заглушки: populate/select/sort/lean ничего не меняют,
 * `transform` применяется к результату, а `await` отдаёт заранее заданное.
 */
const query = (result) => {
  let transform = (doc) => doc;
  const chain = {
    populate: () => chain,
    select: () => chain,
    sort: () => chain,
    lean: () => chain,
    transform: (fn) => {
      transform = fn;
      return chain;
    },
    then: (resolve, reject) =>
      Promise.resolve(result).then(transform).then(resolve, reject),
  };
  return chain;
};

// Заявка «как из базы»: toObject() отдаёт простой объект, как в getOne
const ticketDoc = () => ({
  toObject: () => ({
    _id: TICKET_ID,
    num: 51713,
    title: "Не печатает принтер",
    company: { _id: COMPANY_ID, alias: "Ромашка" },
    comments: [],
    applicantId: null,
    categoryId: null,
  }),
});

const originals = {
  findById: Company.findById,
  prefsFindOne: Preferences.findOne,
  subdivisionFind: Subdivision.find,
  logFind: TicketLog.find,
  readFindOne: TicketRead.findOne,
};

afterEach(() => {
  Company.findById = originals.findById;
  Preferences.findOne = originals.prefsFindOne;
  Subdivision.find = originals.subdivisionFind;
  TicketLog.find = originals.logFind;
  TicketRead.findOne = originals.readFindOne;
  delete Ticket.findOne;
});

/** «База» с одной заявкой и её компанией (`null` — компании не нашлось). */
const serve = (company) => {
  Ticket.findOne = () => query(ticketDoc());
  Company.findById = () => query(company);
  Preferences.findOne = async () => null;
  Subdivision.find = () => query([]);
  TicketLog.find = () => query([]);
  TicketRead.findOne = () => query(null);
};

/**
 * `req.auth` в форме buildAuthContext (services/authContext), но без базы:
 * `can` отвечает по списку выданных прав «ресурс.действие».
 */
const authFor = ({ isEndUser = false, grants = [] } = {}) => ({
  userId: "66bb00000000000000000001",
  isAdmin: false,
  isEndUser,
  can: (need) =>
    Object.entries(need).every(([resource, actions]) =>
      actions.every((action) => grants.includes(`${resource}.${action}`)),
    ),
});

const client = authFor({ isEndUser: true });
const staff = authFor();
const staffWithLogs = authFor({ grants: ["company.readLogs"] });

/** Карточка глазами клиента сети: ответ после сериализации в JSON. */
const openCard = async (auth) => {
  let failure = null;
  let sent = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent = { status: this.statusCode, wire: JSON.stringify(payload) };
      return this;
    },
  };
  await controller.getOne(
    { params: { ticketNum: "51713" }, query: {}, auth },
    res,
    (error) => {
      failure = error;
    },
  );

  // Упавший обработчик отдаёт 500 через next — настоящую причину показываем
  assert.equal(failure, null, failure?.originalError?.stack ?? String(failure));
  assert.equal(sent.status, 200);
  return { ...JSON.parse(sent.wire), wire: sent.wire };
};

test("premise: the company document serialises with keys, contacts and plans", () => {
  // Без этого остальные тесты прошли бы и на документе, чьи секреты не
  // сериализуются, — молча ничего не доказав
  const wire = JSON.stringify(companyDoc().toJSON());

  for (const secret of SECRETS) {
    assert.ok(wire.includes(secret), `${secret} is missing from the document`);
  }
});

for (const [who, auth] of [
  ["a client", client],
  ["staff without company.readLogs", staff],
]) {
  test(`${who}: the card's company carries no keys, contacts or people`, async () => {
    serve(companyDoc());

    const { company, wire } = await openCard(auth);

    // Главное: по сети не уходит ни ключ, ни контакт, ни поле, где он лежит
    // (проверяется весь ответ, а не только `company`)
    for (const secret of SECRETS) {
      assert.ok(!wire.includes(secret), `${secret} leaked`);
    }
    // Люди компании нужны только журналу входов AD — он за правом
    assert.equal(company.employees, undefined);
  });
}

test("staff with company.readLogs: employees by name only, still no keys or contacts", async () => {
  serve(companyDoc());

  const { company, wire } = await openCard(staffWithLogs);

  assert.deepEqual(company.employees, [
    { _id: EMPLOYEE_ID, firstName: "Иван", lastName: "Иванов" },
  ]);
  for (const secret of SECRETS) {
    assert.ok(!wire.includes(secret), `${secret} leaked`);
  }
});

test("the card still gets what it reads: schedule, addresses, map point", async () => {
  serve(companyDoc());

  const { company } = await openCard(staff);

  assert.equal(company._id, COMPANY_ID);
  assert.equal(company.alias, "Ромашка");
  assert.equal(company.workSchedule.Monday.isWorking, true);
  assert.equal(company.address, "Москва, Тверская, 1");
  assert.equal(company.linkToMap, "https://yandex.ru/maps/?pt=37.6,55.7");
  assert.deepEqual(company.location, { lat: 55.7, lon: 37.6 });
  // Старые координаты: такси берёт их, когда у компании нет точки location
  assert.deepEqual(company.locationSettings, { latitude: 55.7, longitude: 37.6 });
  // Список адресов считается ДО отбора полей и в ответ входит
  assert.equal(company.addresses.length, 1);
  assert.equal(company.addresses[0].source, "company");
});

test("the cascades behind the card still read the full company", async () => {
  serve(companyDoc());

  const { ticket } = await openCard(client);

  // Пояса и адреса нет в ответе компании, а в ответе заявки они есть: каскады
  // считались по полному документу, отбор полей идёт только на выходе
  assert.deepEqual(ticket.clientTimezone, {
    timezone: "Asia/Yekaterinburg",
    source: "company",
    sourceName: "Ромашка",
  });
  assert.equal(ticket.clientAddress.address, "Москва, Тверская, 1");
  assert.equal(ticket.clientAddress.source, "company");
});

test("a ticket whose company is gone still opens, with an empty company", async () => {
  serve(null);

  const { company } = await openCard(staffWithLogs);

  assert.deepEqual(company, {});
});
