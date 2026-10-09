// node --test controllers/inventory/location.update.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

const ClientDevice = require("@/models/inventory/clientDevice");
const Company = require("@/models/company");
const Location = require("@/models/inventory/location");

const controller = require("./location");

/**
 * Что уходит в ответ на правку и удаление расположения. Ручка правки зовёт
 * `populate("company")`, а расположение отдаёт компанию в ответе как есть, —
 * поэтому раскрытая целиком компания уносила с собой её API-ключи (значение у
 * старых ключей и отпечаток) и контакты людей. Достаточно ПОДПИСИ — алиаса и
 * названия, как в `add`.
 *
 * Исполняются настоящие `update` и `delete`. Подменены только статические
 * методы моделей и запись в базу (`save`, `deleteOne` на документе); сам
 * документ — настоящий документ Mongoose, так что `toJSON()` в ответе тот же,
 * что и на проде. `populate` обработчика заглушка исполняет так, как это делает
 * база: без `select` компания приходит целиком, с `select` — только выбранными
 * полями. Появится у обработчика новый запрос — подменить его здесь же.
 */

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const COMPANY_ID = "66aa00000000000000000001";
const OTHER_COMPANY_ID = "66aa00000000000000000002";
const LOCATION_ID = "66cc00000000000000000001";
const STAFF_ID = "66bb00000000000000000001";

// Всё, что компания хранит и что ответу о расположении не принадлежит: ключ
// (значение — у старых ключей), его отпечаток, снимок человека, домены
const LEGACY_KEY = "hd_plaintext_legacy_key";
const KEY_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15";
const SECRETS = [
  LEGACY_KEY,
  KEY_HASH,
  "apiKeys",
  "keyHash",
  "ivanov@romashka.ru", // снимок человека в company.users
  "emailDomains",
];

// Компания в базе: у неё есть и подпись, и то, чего в подписи быть не должно
const COMPANY_FIELDS = {
  _id: oid(COMPANY_ID),
  alias: "Ромашка",
  fullTitle: "ООО «Ромашка»",
  emailDomains: ["romashka.ru"],
  users: [
    {
      id: oid("66aa00000000000000000003"),
      fullName: "Иванов Иван",
      email: "ivanov@romashka.ru",
      phone: "79001112233",
    },
  ],
  apiKeys: [{ key: LEGACY_KEY, keyHash: KEY_HASH, keyTail: "c15", name: "AD" }],
};

const LOCATION_FIELDS = {
  _id: oid(LOCATION_ID),
  name: "Кабинет 12",
  type: "room",
  isPublic: false,
};

/**
 * Компания «как из базы» при populate: без `select` — документ целиком, с
 * `select` — выбранные поля и `_id` (проекция передана конструктору, иначе
 * в документ попали бы значения по умолчанию всей схемы — на проде их там нет).
 */
const storedCompany = (select) => {
  if (select === undefined) return new Company(COMPANY_FIELDS);
  assert.equal(typeof select, "string", "заглушка знает select только строкой");
  const names = select.split(/\s+/).filter(Boolean);
  return new Company(
    Object.fromEntries(
      ["_id", ...names].map((name) => [name, COMPANY_FIELDS[name]]),
    ),
    Object.fromEntries(names.map((name) => [name, 1])),
  );
};

// Запись в базу и документ, выданный обработчику: по ним видно, что он прочёл
const calls = [];
let served = null;

/**
 * `Location.findById(id)` запросом Mongoose: populate запоминается, а `await`
 * отдаёт документ расположения, у которого компания раскрыта ровно так, как её
 * запросил обработчик. Без populate компания остаётся ObjectId.
 */
const findLocation = () => {
  const populates = [];
  const chain = {
    populate: (path, select) => {
      populates.push(typeof path === "string" ? { path, select } : path);
      return chain;
    },
    then: (resolve, reject) => {
      try {
        resolve(hydrate(populates));
      } catch (error) {
        reject(error);
      }
    },
  };
  return chain;
};

const hydrate = (populates) => {
  for (const { path } of populates) {
    assert.equal(path, "company", "заглушка раскрывает только company");
  }
  const option = populates.find(({ path }) => path === "company");

  const doc = new Location({
    ...LOCATION_FIELDS,
    company: option ? storedCompany(option.select) : oid(COMPANY_ID),
  });
  doc.isNew = false;
  // В базу документ не пишется; побочные запросы хуков не нужны
  doc.save = async () => {
    calls.push("save");
    return doc;
  };
  doc.deleteOne = async () => {
    calls.push("deleteOne");
    return doc;
  };
  served = doc;
  return doc;
};

const originals = {
  findById: Location.findById,
  countDocuments: ClientDevice.countDocuments,
};

afterEach(() => {
  Location.findById = originals.findById;
  ClientDevice.countDocuments = originals.countDocuments;
  calls.length = 0;
  served = null;
});

/** «База» с одним расположением; устройств в нём нет. */
const serve = () => {
  Location.findById = findLocation;
  ClientDevice.countDocuments = async () => 0;
};

/** Зовёт настоящий обработчик; отдаёт ответ после сериализации в JSON. */
const call = async (handler, { body = {} } = {}) => {
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
      params: { id: LOCATION_ID },
      body,
      auth: { legacy: { _id: oid(STAFF_ID) } },
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

const assertNoSecrets = (wire) => {
  // Главное: по сети не уходит ни ключ, ни контакт, ни поле, где он лежит
  // (проверяется весь ответ, а не только `location.company`)
  for (const secret of SECRETS) {
    assert.ok(!wire.includes(secret), `${secret} leaked`);
  }
};

test("premise: a location with its company opened in full serialises with keys and contacts", () => {
  // Без этого остальные тесты прошли бы и на компании, чьи секреты не
  // сериализуются, — молча ничего не доказав
  const wire = JSON.stringify(
    new Location({ ...LOCATION_FIELDS, company: storedCompany() }),
  );

  for (const secret of SECRETS) {
    assert.ok(wire.includes(secret), `${secret} is missing from the document`);
  }
});

test("premise: the stubbed select opens the company by its label only", () => {
  // И обратная сторона: заглушка действительно режет по select, а не отдаёт
  // документ целиком при любом аргументе
  assert.deepEqual(JSON.parse(JSON.stringify(storedCompany("alias fullTitle"))), {
    _id: COMPANY_ID,
    alias: "Ромашка",
    fullTitle: "ООО «Ромашка»",
  });
});

// Валидатор правки не требует company: тело без неё проходит. Интерфейс шлёт
// company всегда — свою же (форма) или другую (перенос).
const BODIES = [
  ["a body without company", {}],
  ["the same company", { company: COMPANY_ID }],
  ["another company", { company: OTHER_COMPANY_ID }],
];

for (const [what, extra] of BODIES) {
  test(`update, ${what}: the answer carries no API keys, hashes or contacts`, async () => {
    serve();

    const answer = await call(controller.update, {
      body: { name: "Кабинет 12А", type: "room", ...extra },
    });

    assert.equal(answer.status, 200);
    assertNoSecrets(answer.wire);
    // Правка выполнена и записана, ответ — про то же расположение
    assert.deepEqual(calls, ["save"]);
    assert.equal(answer.location.name, "Кабинет 12А");
    assert.equal(answer.location._id, LOCATION_ID);
    // Компания в ответе — та, к которой расположение теперь относится
    const { company } = answer.location;
    assert.equal(company?._id ?? company, extra.company ?? COMPANY_ID);
  });
}

test("update, a body without company: the company in the answer is its label, as in add", async () => {
  serve();

  const answer = await call(controller.update, {
    body: { name: "Кабинет 12А", type: "room" },
  });

  // Подпись, которую читают списки и форма: алиас и название
  assert.deepEqual(answer.location.company, {
    _id: COMPANY_ID,
    alias: "Ромашка",
    fullTitle: "ООО «Ромашка»",
  });
  assert.equal(answer.message, "Расположение успешно обновлено");
});

test("delete: answers only the message and never reads the company's keys", async () => {
  serve();

  const answer = await call(controller.delete);

  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.wire), {
    message: "Расположение успешно удалено",
  });
  assert.deepEqual(calls, ["deleteOne"]);
  // Компания, подгруженная обработчиком, — одна подпись. Ответ завтра могут
  // дополнить расположением, как у правки, и целая компания принесла бы ключи
  assertNoSecrets(JSON.stringify(served));
});
