// node --test services/phoneMigration.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { PHONE_PATHS, migratePhoneValue, planDocument, projectionFor } = require("./phoneMigration");

const specOf = (collection) => PHONE_PATHS.find((item) => item.collection === collection);

test("each stored shape gets its status", () => {
  const cases = [
    ["+7 (914) 555-01-42", "79145550142", "normalized"],
    ["+79145550142", "79145550142", "normalized"],
    ["89999999999", "79999999999", "normalized"],
    // след старой маски ввода: набранная 8 осталась после плюса
    ["+8 (914) 555-01-42", "79145550142", "normalized"],
    // десять цифр без кода страны — российский номер
    ["9145550142", "79145550142", "normalized"],
    ["+7 (4232) 22‒22‒22", "74232222222", "normalized"],
    ["79145550142", "79145550142", "unchanged"],
    ["", "", "unchanged"],
    ["+7", "", "emptied"],
    ["телефон", "", "emptied"],
    // фигурные тире, без кода города — как в двух подразделениях копии прода
    ["222‒29‒99", "2222999", "invalid"],
    ["+7 (914) 555-01-4", "7914555014", "invalid"],
    // те же цифры после первого прогона: 7 повторно не дописывается
    ["7914555014", "7914555014", "invalid"],
    ["+79991234567, +79991234568", "79991234567", "split"],
  ];
  for (const [raw, value, status] of cases) {
    assert.deepEqual(migratePhoneValue(raw), { value, status }, raw);
  }
  assert.deepEqual(migratePhoneValue(undefined), { value: undefined, status: "unchanged" });
});

test("a company: phones de-duplicated, snapshots written by position", () => {
  const plan = planDocument(specOf("companies"), {
    _id: "c1",
    phones: ["+7 (423) 222-29-99", "+7", "8 423 222 29 99", "74232222998"],
    users: [],
    responsibles: [{ phone: "+7 (914) 555-01-42" }, { phone: "" }, {}],
    clientsSideResponsibles: [{ phone: "79140000000" }],
  });
  assert.deepEqual(plan.set, {
    "responsibles.0.phone": "79145550142",
    phones: ["74232222999", "74232222998"],
  });
  assert.deepEqual(
    plan.findings.map((item) => `${item.path} ${item.status}`),
    ["responsibles.0.phone normalized", "phones.0 normalized", "phones.1 emptied", "phones.2 normalized"],
  );
  // В находках нет номеров — только форма значения
  assert.equal(plan.findings[0].shape, "+9 (999) 999-99-99");
});

test("a number of another country is listed for review", () => {
  const plan = planDocument(specOf("users"), { _id: "u1", phone: "+375 29 123-45-67" });
  assert.deepEqual(plan.set, { phone: "375291234567" });
  assert.deepEqual(plan.findings.map((item) => item.status), ["normalized", "foreign"]);
});

test("a second run changes nothing", () => {
  const spec = specOf("tickets");
  const first = planDocument(spec, {
    applicant: { phone: "8 (914) 555-01-42" },
    responsibles: [{ phone: "+7 (423) 222-29-99" }],
  });
  const migrated = {
    applicant: { phone: first.set["applicant.phone"] },
    responsibles: [{ phone: first.set["responsibles.0.phone"] }],
  };
  assert.deepEqual(planDocument(spec, migrated).set, {});
});

test("a second run invents nothing", () => {
  // неполный «+7 …» — десять цифр: первый прогон оставляет их цифрами,
  // второй не дописывает ещё одну 7
  const users = specOf("users");
  assert.deepEqual(planDocument(users, { phone: "+7 (914) 555-01-4" }).set, { phone: "7914555014" });
  assert.deepEqual(planDocument(users, { phone: "7914555014" }).set, {});
});

test("an invalid local number is not listed as foreign", () => {
  // семь цифр без кода города: негодный номер, а не номер другой страны
  const plan = planDocument(specOf("subdivisions"), { phone: "222‒29‒99" });
  assert.deepEqual(plan.findings.map((item) => item.status), ["invalid"]);
});

test("a snapshot is written by its position and guarded by the value that was read", () => {
  const plan = planDocument(specOf("tickets"), {
    responsibles: [{ phone: "79145550142" }, {}, { phone: "+7 (423) 222-29-99" }],
  });
  assert.deepEqual(plan.set, { "responsibles.2.phone": "74232222999" });
  // запись пройдёт, только если по этой позиции всё ещё лежит прочитанное
  assert.deepEqual(plan.expect, { "responsibles.2.phone": "+7 (423) 222-29-99" });
});

test("a position survives a non-document element", () => {
  const plan = planDocument(specOf("tickets"), {
    responsibles: [null, { phone: "+7 (914) 555-01-42" }],
  });
  assert.deepEqual(plan.set, { "responsibles.1.phone": "79145550142" });
  assert.deepEqual(plan.expect, { "responsibles.1.phone": "+7 (914) 555-01-42" });
});

test("a changed phone list is guarded by the original array", () => {
  const plan = planDocument(specOf("companies"), { phones: ["+7 (423) 222-29-99", "+7"] });
  assert.deepEqual(plan.set, { phones: ["74232222999"] });
  assert.deepEqual(plan.expect, { phones: ["+7 (423) 222-29-99", "+7"] });
});

test("a plus-8 conversion is listed", () => {
  const plan = planDocument(specOf("users"), { phone: "+8 (914) 555-01-42" });
  assert.deepEqual(plan.set, { phone: "79145550142" });
  assert.ok(plan.findings.some((item) => item.status === "plus8"));
  // обычный «+7 …» в этот список не попадает
  const usual = planDocument(specOf("users"), { phone: "+7 (914) 555-01-42" });
  assert.ok(!usual.findings.some((item) => item.status === "plus8"));
});

test("a shape hides letters as well as digits", () => {
  // имя из свободного текста не должно попасть в лог развёртывания
  const plan = planDocument(specOf("users"), { phone: "звонить Ивану 222-29-99" });
  const invalid = plan.findings.find((item) => item.status === "invalid");
  assert.equal(invalid.shape, "aaaaaaa aaaaa 999-99-99");
  assert.doesNotMatch(invalid.shape, /\p{Script=Cyrillic}/u);
});

test("a snapshot path that is not an array is skipped", () => {
  const plan = planDocument(specOf("tickets"), { responsibles: {} });
  assert.deepEqual(plan, { set: {}, expect: {}, findings: [] });
});

test("only phone paths are read", () => {
  // Снимки людей читаются массивами целиком: точечная проекция «responsibles.phone»
  // выбрасывает элементы-не-документы, и позиции для записи съезжают
  assert.deepEqual(projectionFor(specOf("companies")), {
    users: 1,
    responsibles: 1,
    clientsSideResponsibles: 1,
    phones: 1,
  });
  assert.deepEqual(projectionFor(specOf("tickets")), { "applicant.phone": 1, responsibles: 1 });
  assert.deepEqual(projectionFor(specOf("preferences")), { "contacts.tel": 1 });
});
