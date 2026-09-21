// node --test services/staffContacts.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { hideStaffContacts } = require("./staffContacts");

const STAFF = {
  ids: new Set(["s1", "s2"]),
  emails: new Set(["engineer@f1lab.ru"]),
};

test("у нашего сотрудника клиенту остаются имя и должность — без личных каналов", () => {
  const payload = {
    responsibles: [
      {
        _id: "s1",
        firstName: "Иван",
        lastName: "Петров",
        position: "Инженер",
        email: "engineer@f1lab.ru",
        phone: "+7 900 000-00-00",
        telegramBot: { chatId: 42 },
      },
    ],
  };
  assert.deepEqual(hideStaffContacts(payload, STAFF), {
    responsibles: [
      { _id: "s1", firstName: "Иван", lastName: "Петров", position: "Инженер" },
    ],
  });
});

test("коллеги клиента и общая линия поддержки остаются с контактами", () => {
  const payload = {
    ticket: {
      applicant: { _id: "c1", firstName: "Анна", email: "anna@client.ru", phone: "123" },
      responsibles: [{ _id: "s2", firstName: "Пётр", phone: "555" }],
    },
    company: {
      phones: ["+7 423 202-52-96"],
      employees: [{ _id: "c2", email: "boss@client.ru", phone: "777" }],
    },
    contacts: { tel: "+7 423 202-52-96", email: "helpdesk@f1lab.ru" },
  };
  const result = hideStaffContacts(payload, STAFF);
  assert.deepEqual(result.ticket.applicant, payload.ticket.applicant);
  assert.deepEqual(result.company, payload.company);
  assert.deepEqual(result.contacts, payload.contacts);
  assert.deepEqual(result.ticket.responsibles, [{ _id: "s2", firstName: "Пётр" }]);
});

test("сотрудника узнаём и по id-ссылке, и по почте, на любой глубине", () => {
  const payload = {
    a: [{ b: { person: { id: "s1", phone: "1" } } }],
    // Встроенная копия без идентификатора — только почта
    c: { firstName: "Иван", email: "Engineer@F1lab.ru ", phone: "2" },
    // ObjectId после сериализации — строка; сравнение по строке
    d: { _id: "s2", email: "x@y.z" },
  };
  assert.deepEqual(hideStaffContacts(payload, STAFF), {
    a: [{ b: { person: { id: "s1" } } }],
    c: { firstName: "Иван" },
    d: { _id: "s2" },
  });
});

test("не-объекты и пустое проходят как есть, вход не мутируется", () => {
  assert.equal(hideStaffContacts(null, STAFF), null);
  assert.equal(hideStaffContacts("text", STAFF), "text");
  assert.deepEqual(hideStaffContacts([1, "a", null], STAFF), [1, "a", null]);
  const source = { _id: "s1", phone: "1" };
  hideStaffContacts(source, STAFF);
  assert.equal(source.phone, "1");
});
