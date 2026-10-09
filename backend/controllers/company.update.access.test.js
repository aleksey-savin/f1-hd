// node --test controllers/company.update.access.test.js
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
stubModule("@/models/ticket", { Ticket: {} });

const Company = require("@/models/company");
const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const Subdivision = require("@/models/subdivision");

const controller = require("./company");

/**
 * Что уходит в ответ на сохранение компании. Компания хранит API-ключи
 * интеграций: значение (у старых ключей) и отпечаток. `getOne` их из ответа
 * убирает; `update` отдавал сохранённый документ как есть — любой, кто правит
 * компании, читал чужие ключи. Здесь проверяется, что КАЖДАЯ ручка, возвращающая
 * компанию, берёт её из одного места и что `getOne` после этого не изменился.
 *
 * Исполняются настоящие `update`, `add` и `getOne`. Подменены только статические
 * методы моделей и запись в базу; сама компания — настоящий документ Mongoose,
 * так что `toJSON()` в ответе тот же, что и на проде. Появится у обработчика
 * новый запрос — подменить его здесь же.
 */

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const COMPANY_ID = "66aa00000000000000000001";
const RESPONSIBLE_ID = "66aa00000000000000000002";
const CLIENT_SIDE_ID = "66aa00000000000000000003";
const AUTHOR_ID = "66bb00000000000000000001";

// Ключ старого образца хранит и значение, и отпечаток; выпущенный после
// перехода на отпечаток — только отпечаток и хвост
const LEGACY_KEY = "hd_plaintext_legacy_key";
const LEGACY_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15";
const NEW_HASH = "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752";
const SECRETS = [LEGACY_KEY, LEGACY_HASH, NEW_HASH];

const SCHEDULE = { Monday: { isWorking: true, start: "09:00", end: "18:00" } };
const MAP_LINK = "https://yandex.ru/maps/?pt=37.6,55.7";

const calls = [];

const companyDoc = () => {
  const doc = new Company({
    _id: oid(COMPANY_ID),
    alias: "Ромашка",
    fullTitle: "ООО «Ромашка»",
    emailDomains: ["romashka.ru"],
    phones: ["74950000000"],
    address: "Москва, Тверская, 1",
    linkToMap: MAP_LINK,
    location: { lat: 55.7, lon: 37.6 },
    timezone: "Asia/Yekaterinburg",
    workSchedule: SCHEDULE,
    apiKeys: [
      { key: LEGACY_KEY, keyHash: LEGACY_HASH, keyTail: "c15", name: "AD" },
      { keyHash: NEW_HASH, keyTail: "752", name: "Мониторинг" },
    ],
  });
  doc.isNew = false;
  // В базу документ не пишется
  doc.save = async () => {
    calls.push("save");
    return doc;
  };
  return doc;
};

/** Человек, которого форма выбрала ответственным: документ «как из базы». */
const person = (id, fields) => ({
  _id: oid(id),
  responsibleForCompanies: [],
  async save() {
    calls.push(`save ${fields.lastName}`);
    return this;
  },
  ...fields,
});

/**
 * Запрос Mongoose в виде заглушки: populate/select/lean ничего не меняют, а
 * `await` отдаёт заранее заданный результат.
 */
const query = (result) => {
  const chain = {
    populate: () => chain,
    select: () => chain,
    lean: () => chain,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

const originals = {
  companyFindById: Company.findById,
  userFindById: User.findById,
  prefsFindOne: Preferences.findOne,
  subdivisionFind: Subdivision.find,
};

afterEach(() => {
  Company.findById = originals.companyFindById;
  User.findById = originals.userFindById;
  Preferences.findOne = originals.prefsFindOne;
  Subdivision.find = originals.subdivisionFind;
  // Своё свойство прототипа убирается, чтобы снова виден был метод Model
  delete Company.prototype.save;
  calls.length = 0;
});

/** Что показывает запрос карточки: компания, её подразделений нет. */
const serve = (company) => {
  Company.findById = () => query(company);
  Subdivision.find = () => query([]);
  Preferences.findOne = async () => null;
  User.findById = async (id) =>
    [
      person(RESPONSIBLE_ID, {
        firstName: "Пётр",
        lastName: "Сидоров",
        email: "staff@f1lab.ru",
        role: "staff",
        isActive: true,
      }),
      person(CLIENT_SIDE_ID, {
        firstName: "Анна",
        lastName: "Иванова",
        email: "anna@romashka.ru",
        role: "client",
        isActive: true,
      }),
    ].find((human) => String(human._id) === String(id)) ?? null;
};

/** Зовёт настоящий обработчик; отдаёт ответ после сериализации в JSON. */
const call = async (handler, { params = {}, body = {} } = {}) => {
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
  await handler(
    {
      params,
      body,
      auth: {
        userId: AUTHOR_ID,
        legacy: { _id: oid(AUTHOR_ID), isEndUser: false },
        can: () => false,
      },
    },
    res,
    (error) => {
      failure = error;
    },
  );

  // Упавший обработчик отдаёт 500 через next — настоящую причину показываем
  assert.equal(failure, null, failure?.originalError?.stack ?? String(failure));
  return { status: sent.status, wire: sent.wire, ...JSON.parse(sent.wire) };
};

// Все объекты ответа, как бы глубоко ни лежали
function* everyObject(value) {
  if (value && typeof value === "object") {
    yield value;
    for (const inner of Object.values(value)) yield* everyObject(inner);
  }
}

/**
 * Весь ответ, а не только `company`: ни значения ключа, ни отпечатка, ни поля
 * отпечатка — в любом месте. Поле `key` ищется в списках ключей: у адресов
 * компании есть свой безобидный `key` (ключ сравнения адресов).
 */
const assertNoKeyValues = (wire) => {
  for (const secret of SECRETS) {
    assert.ok(!wire.includes(secret), `${secret} leaked`);
  }
  assert.ok(!wire.includes("keyHash"), "a `keyHash` field leaked");
  for (const object of everyObject(JSON.parse(wire))) {
    for (const apiKey of object.apiKeys ?? []) {
      assert.ok(!("key" in apiKey), "a `key` field leaked");
    }
  }
};

// Что шлёт форма компании (Company/Form.jsx) при сохранении
const UPDATE_BODY = {
  alias: "Ромашка",
  fullTitle: "ООО «Ромашка-2»",
  emailDomains: "romashka.ru, romashka.com",
  phones: ["74950000000"],
  address: "Москва, Тверская, 1",
  linkToMap: MAP_LINK,
  workSchedule: SCHEDULE,
  timezone: "Asia/Yekaterinburg",
  responsibles: [RESPONSIBLE_ID],
  clientsSideResponsibles: [CLIENT_SIDE_ID],
};

test("premise: the company document serialises with key values and hashes, and the scan sees them", () => {
  // Без этого остальные тесты прошли бы и на документе, чьи ключи не
  // сериализуются, или на проверке, которая ничего не находит, — молча ничего
  // не доказав
  const wire = JSON.stringify(companyDoc());

  for (const secret of SECRETS) {
    assert.ok(wire.includes(secret), `${secret} is missing from the document`);
  }
  assert.throws(() => assertNoKeyValues(wire), /leaked/);
});

test("update: the answer carries no API key values or hashes, anywhere", async () => {
  serve(companyDoc());

  const answer = await call(controller.update, {
    params: { id: COMPANY_ID },
    body: UPDATE_BODY,
  });

  assert.equal(answer.status, 200);
  assertNoKeyValues(answer.wire);
});

test("update: still answers what the form reads, and saves what it was sent", async () => {
  const stored = companyDoc();
  serve(stored);

  const answer = await call(controller.update, {
    params: { id: COMPANY_ID },
    body: UPDATE_BODY,
  });

  // Форма читает error и message; компания — сохранённая, а не прежняя
  assert.equal(answer.error, undefined);
  assert.equal(answer.message, "Данные компании успешно обновлены.");
  assert.equal(answer.company._id, COMPANY_ID);
  assert.equal(answer.company.alias, "Ромашка");
  assert.equal(answer.company.fullTitle, "ООО «Ромашка-2»");
  assert.deepEqual(answer.company.emailDomains, ["romashka.ru", "romashka.com"]);
  assert.deepEqual(
    answer.company.responsibles.map(({ lastName }) => lastName),
    ["Сидоров"],
  );
  assert.deepEqual(
    answer.company.clientsSideResponsibles.map(({ lastName }) => lastName),
    ["Иванова"],
  );
  assert.ok(calls.includes("save"), "the company was not saved");
  // Ключи убираются из ответа, а не из документа: сохранённая компания их держит
  assert.deepEqual(
    stored.apiKeys.map(({ key, keyHash }) => ({ key, keyHash })),
    [
      { key: LEGACY_KEY, keyHash: LEGACY_HASH },
      { key: undefined, keyHash: NEW_HASH },
    ],
  );
  // Список ключей остаётся: имя, хвост и состояние опознают ключ без значения
  assert.deepEqual(
    answer.company.apiKeys.map(({ name, keyTail, isActive }) => ({
      name,
      keyTail,
      isActive,
    })),
    [
      { name: "AD", keyTail: "c15", isActive: true },
      { name: "Мониторинг", keyTail: "752", isActive: true },
    ],
  );
});

test("getOne: the card still has no key values, and keeps its key list", async () => {
  serve(companyDoc());

  const answer = await call(controller.getOne, { params: { id: COMPANY_ID } });

  assert.equal(answer.status, 200);
  assertNoKeyValues(answer.wire);
  assert.equal(answer.company._id, COMPANY_ID);
  assert.deepEqual(
    answer.company.apiKeys.map(({ name, keyTail }) => ({ name, keyTail })),
    [
      { name: "AD", keyTail: "c15" },
      { name: "Мониторинг", keyTail: "752" },
    ],
  );
  // Поля, которые карточка собирает после отбора ключей
  assert.deepEqual(answer.company.subdivisions, []);
  assert.equal(answer.company.addresses.length, 1);
  assert.deepEqual(answer.servicePlans, []);
});

test("add: still answers the created company's id (the form opens its card by it)", async () => {
  // Новая компания создаётся самим обработчиком, поэтому запись «в базу»
  // подменена у прототипа
  Company.prototype.save = async function () {
    calls.push("save");
    return this;
  };

  const answer = await call(controller.add, {
    body: { ...UPDATE_BODY, users: [], responsibles: [] },
  });

  assert.equal(answer.status, 201);
  assertNoKeyValues(answer.wire);
  assert.match(answer.company._id, /^[0-9a-f]{24}$/);
  assert.equal(answer.company.alias, "Ромашка");
  assert.equal(answer.message, "Company added successfully!");
  assert.deepEqual(calls, ["save"]);
});
