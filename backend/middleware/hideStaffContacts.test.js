// node --test middleware/hideStaffContacts.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

// Список сотрудников подменяем ДО загрузки стража: базу в тесте не поднимаем
const staffContacts = require("@/services/staffContacts");
let staffLoader = async () => ({ ids: new Set(["s1"]), emails: new Set() });
staffContacts.loadStaff = () => staffLoader();
const guard = require("./hideStaffContacts");

const respond = (auth, body) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload });
        return this;
      },
    };
    guard({ auth }, res, () => res.json(body));
  });

const BODY = {
  responsibles: [{ _id: "s1", firstName: "Иван", email: "i@f1lab.ru", phone: "1" }],
};

test("клиенту ответ уходит без личных контактов сотрудника", async () => {
  const { status, payload } = await respond({ isEndUser: true }, BODY);
  assert.equal(status, 200);
  assert.deepEqual(payload, { responsibles: [{ _id: "s1", firstName: "Иван" }] });
});

test("сотруднику и запросу без сеанса ответ уходит как есть", async () => {
  assert.deepEqual((await respond({ isEndUser: false }, BODY)).payload, BODY);
  assert.deepEqual((await respond(undefined, BODY)).payload, BODY);
});

test("не смогли проверить — не отдаём вовсе", async () => {
  staffLoader = async () => {
    throw new Error("база недоступна");
  };
  const { status, payload } = await respond({ isEndUser: true }, BODY);
  assert.equal(status, 500);
  assert.ok(!JSON.stringify(payload).includes("f1lab.ru"));
});
