// node --test validations/company.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const companyValidation = require("./company");

// Полезная нагрузка формы компании (Company/Form.jsx): телефоны — массивом,
// домены — строкой через запятую, пояс — null, когда «как в организации».
const formPayload = () => ({
  alias: "Ромашка",
  fullTitle: 'ООО "Василёк"',
  emailDomains: "example.com, example.org",
  phones: ["+7 (900) 000-00-01", "+7 (900) 000-00-02"],
  address: "Тверская улица, 1",
  linkToMap: "https://yandex.ru/maps/-/AbCd1234",
  responsibles: ["62d0bdbf5a3314d41cc43eb1"],
  workSchedule: { monday: { isWorking: true } },
  timezone: null,
  clientsSideResponsibles: ["62e7641133a5b1c2cdec4165"],
});

const runChains = async (chains, body, params = {}) => {
  const req = { body, params, query: {}, headers: {}, cookies: {} };
  for (const chain of chains) await chain.run(req);
  return validationResult(req)
    .array()
    .map((error) => `${error.path}: ${error.msg}`);
};

test("update: the payload the company form sends passes validation", async () => {
  const errors = await runChains(companyValidation.update, formPayload(), {
    id: "62d0c0ed5a3314d41cc43ef3",
  });
  assert.deepEqual(errors, []);
});

test("add: the same payload without clientsSideResponsibles passes", async () => {
  const { clientsSideResponsibles: _clientsSideResponsibles, ...body } = formPayload();
  const errors = await runChains(companyValidation.add, body);
  assert.deepEqual(errors, []);
});

test("phones: a single string (legacy form) still passes", async () => {
  const errors = await runChains(
    companyValidation.update,
    { ...formPayload(), phones: "+7 (900) 000-00-01" },
    { id: "62d0c0ed5a3314d41cc43ef3" },
  );
  assert.deepEqual(errors, []);
});

test("phones: non-string items are rejected", async () => {
  const errors = await runChains(
    companyValidation.update,
    { ...formPayload(), phones: ["+7 (900) 000-00-01", 42] },
    { id: "62d0c0ed5a3314d41cc43ef3" },
  );
  assert.ok(errors.some((error) => error.startsWith("phones")), errors.join(" | "));
});
