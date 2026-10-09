// node --test services/ticketCardCompany.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ticketCardCompany } = require("./ticketCardCompany");

/**
 * Компания в карточке заявки: только поля, которые читает интерфейс. Ключи,
 * контакты, услуги и домены не уходят никому; люди компании — только с правом
 * видеть журнал входов AD, и только имя.
 */

// Как после `company.toJSON()` + `addresses` в controllers/ticket.js getOne
const fullCompany = () => ({
  _id: "66aa00000000000000000001",
  alias: "Ромашка",
  fullTitle: "ООО «Ромашка»",
  isActive: true,
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
  workSchedule: { mode: "weekly", days: [] },
  timezone: "Europe/Moscow",
  users: [{ id: "u1", fullName: "Иванов", email: "i@romashka.ru", phone: "7900" }],
  responsibles: [{ id: "s1", email: "staff@f1lab.ru", phone: "7911" }],
  clientsSideResponsibles: [{ id: "u1", email: "i@romashka.ru" }],
  servicePlans: [{ _id: "p1", approver: { _id: "u1" } }],
  apiKeys: [{ key: "hd_plaintext_legacy", keyHash: "abc", name: "AD" }],
  employees: [
    {
      _id: "u1",
      firstName: "Иван",
      lastName: "Иванов",
      email: "i@romashka.ru",
      phone: "79000000000",
      position: "Бухгалтер",
      banned: false,
    },
  ],
  addresses: [
    { key: "москва тверская 1", name: null, address: "Москва, Тверская, 1", source: "company" },
  ],
  createdBy: "s1",
  updatedBy: "s1",
});

test("without company.readLogs: exactly the card fields", () => {
  const dto = ticketCardCompany(fullCompany(), { canReadLogs: false });

  assert.deepEqual(Object.keys(dto).sort(), [
    "_id",
    "address",
    "addresses",
    "alias",
    "linkToMap",
    "location",
    "locationSettings",
    "workSchedule",
  ]);
  assert.deepEqual(dto.locationSettings, { latitude: 55.7, longitude: 37.6 });
  assert.equal(dto.addresses.length, 1);
});

test("with company.readLogs: employees carry only id and name", () => {
  const dto = ticketCardCompany(fullCompany(), { canReadLogs: true });

  assert.deepEqual(dto.employees, [
    { _id: "u1", firstName: "Иван", lastName: "Иванов" },
  ]);
});

test("keys, contacts and plans never leave, whatever the right", () => {
  for (const canReadLogs of [false, true]) {
    const wire = JSON.stringify(ticketCardCompany(fullCompany(), { canReadLogs }));
    for (const secret of [
      "hd_plaintext_legacy",
      "apiKeys",
      "i@romashka.ru",
      "staff@f1lab.ru",
      "servicePlans",
      "emailDomains",
      "79000000000",
      "fullTitle",
    ]) {
      assert.ok(!wire.includes(secret), `${secret} leaked (canReadLogs=${canReadLogs})`);
    }
  }
});

test("missing fields stay missing, no company gives an empty object", () => {
  assert.deepEqual(ticketCardCompany({ _id: "c1", alias: "Без адреса" }), {
    _id: "c1",
    alias: "Без адреса",
  });
  assert.deepEqual(ticketCardCompany(null), {});
  assert.deepEqual(ticketCardCompany(undefined, { canReadLogs: true }), {});
});

test("unpopulated or empty employee lists do not break the card", () => {
  assert.deepEqual(
    ticketCardCompany({ _id: "c1", employees: [null] }, { canReadLogs: true }).employees,
    [],
  );
  assert.deepEqual(
    ticketCardCompany({ _id: "c1" }, { canReadLogs: true }).employees,
    [],
  );
});
