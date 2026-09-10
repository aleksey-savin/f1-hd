// node --test services/clientAddress.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  listCompanyAddresses,
  resolveClientAddress,
  subdivisionIndex,
} = require("./clientAddress");

const company = {
  _id: "c1",
  alias: "F1",
  address: "Москва, ул. Тверская, 12, стр. 2",
  linkToMap: "https://yandex.ru/maps/?pt=37.6,55.7",
};

// Дерево: Филиал Химки (адрес) → Бухгалтерия (без адреса);
// Склад Подольск (адрес, без ссылки); ИТ-отдел — тот же адрес, что у компании.
const khimki = {
  _id: "s1",
  name: "Филиал Химки",
  parent: null,
  address: "Химки, ул. Ленинградская, 5",
  linkToMap: "https://yandex.ru/maps/?pt=37.4,55.9",
};
const accounting = { _id: "s2", name: "Бухгалтерия", parent: "s1", address: "" };
const warehouse = {
  _id: "s3",
  name: "Склад Подольск",
  parent: null,
  address: "Подольск, ул. Заводская, 1",
};
const it = {
  _id: "s4",
  name: "ИТ-отдел",
  parent: null,
  address: "москва,  ул. тверская, 12, стр. 2",
};
const subdivisions = [warehouse, accounting, it, khimki];

test("list: company address first, subdivisions in tree order by name", () => {
  const list = listCompanyAddresses({ company, subdivisions });
  assert.deepEqual(
    list.map((entry) => [entry.source, entry.name, entry.address]),
    [
      ["company", null, "Москва, ул. Тверская, 12, стр. 2"],
      ["subdivision", "Склад Подольск", "Подольск, ул. Заводская, 1"],
      ["subdivision", "Филиал Химки", "Химки, ул. Ленинградская, 5"],
    ],
  );
});

test("list: entries carry key, linkToMap and subdivisionId", () => {
  const [main, , branch] = listCompanyAddresses({ company, subdivisions });
  assert.equal(main.key, "москва ул тверская 12 стр 2");
  assert.equal(main.linkToMap, company.linkToMap);
  assert.equal(main.subdivisionId, null);
  assert.equal(branch.subdivisionId, "s1");
  assert.equal(branch.linkToMap, khimki.linkToMap);
});

test("list: subdivision repeating the company address is collapsed", () => {
  const list = listCompanyAddresses({ company, subdivisions });
  assert.ok(!list.some((entry) => entry.name === "ИТ-отдел"));
});

test("list: nested subdivision with its own address follows its parent", () => {
  const nested = {
    _id: "s5",
    name: "Архив",
    parent: "s1",
    address: "Химки, ул. Мира, 3",
  };
  const list = listCompanyAddresses({
    company,
    subdivisions: [...subdivisions, nested],
  });
  assert.deepEqual(
    list.map((entry) => entry.name),
    [null, "Склад Подольск", "Филиал Химки", "Архив"],
  );
});

test("list: company without address lists only subdivisions", () => {
  const list = listCompanyAddresses({
    company: { ...company, address: "  " },
    subdivisions,
  });
  assert.deepEqual(
    list.map((entry) => entry.name),
    ["ИТ-отдел", "Склад Подольск", "Филиал Химки"],
  );
});

test("list: zero-width characters do not split duplicates", () => {
  const list = listCompanyAddresses({
    company: { ...company, address: "\u200bМосква, ул. Тверская, 12, стр. 2" },
    subdivisions: [it],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].address, "Москва, ул. Тверская, 12, стр. 2");
  assert.equal(list[0].key, "москва ул тверская 12 стр 2");
});

test("list: entries carry the stored point when there is one", () => {
  const list = listCompanyAddresses({
    company: { ...company, location: { lat: 55.7601, lon: 37.6083 } },
    subdivisions: [{ ...khimki, location: { lat: 55.8949, lon: 37.4297 } }],
  });
  assert.deepEqual(list[0].location, { lat: 55.7601, lon: 37.6083 });
  assert.deepEqual(list[1].location, { lat: 55.8949, lon: 37.4297 });
  const bare = listCompanyAddresses({ company, subdivisions: [warehouse] });
  assert.equal(bare[0].location, null);
  assert.equal(bare[1].location, null);
});

test("list: no data → empty list", () => {
  assert.deepEqual(listCompanyAddresses({ company: null, subdivisions: [] }), []);
});

test("resolve: subdivision with its own address wins", () => {
  const result = resolveClientAddress({
    subdivision: khimki,
    company,
    subdivisionById: subdivisionIndex(subdivisions),
  });
  assert.deepEqual(result, {
    address: "Химки, ул. Ленинградская, 5",
    linkToMap: khimki.linkToMap,
    source: "subdivision",
    sourceName: "Филиал Химки",
    subdivisionId: "s1",
    key: "химки ул ленинградская 5",
  });
});

test("resolve: subdivision without address inherits the nearest ancestor", () => {
  const result = resolveClientAddress({
    subdivision: accounting,
    company,
    subdivisionById: subdivisionIndex(subdivisions),
  });
  assert.equal(result.source, "subdivision");
  assert.equal(result.sourceName, "Филиал Химки");
  assert.equal(result.subdivisionId, "s1");
});

test("resolve: no address up the chain → company address", () => {
  const orphan = { _id: "s9", name: "Отдел", parent: null, address: "" };
  const result = resolveClientAddress({
    subdivision: orphan,
    company,
    subdivisionById: subdivisionIndex([orphan]),
  });
  assert.equal(result.source, "company");
  assert.equal(result.sourceName, "F1");
  assert.equal(result.address, company.address);
  assert.equal(result.key, "москва ул тверская 12 стр 2");
});

test("resolve: applicant without subdivision → company address", () => {
  const result = resolveClientAddress({ subdivision: null, company });
  assert.equal(result.source, "company");
});

test("resolve: nothing anywhere → nulls", () => {
  const result = resolveClientAddress({
    subdivision: null,
    company: { alias: "Пустая" },
  });
  assert.deepEqual(result, {
    address: null,
    linkToMap: null,
    source: null,
    sourceName: null,
    subdivisionId: null,
    key: null,
  });
});

test("resolve: parent cycle does not hang", () => {
  const a = { _id: "x1", name: "A", parent: "x2", address: "" };
  const b = { _id: "x2", name: "B", parent: "x1", address: "" };
  const result = resolveClientAddress({
    subdivision: a,
    company,
    subdivisionById: subdivisionIndex([a, b]),
  });
  assert.equal(result.source, "company");
});
