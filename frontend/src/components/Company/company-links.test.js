// node --test src/components/Company/company-links.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { getCompanyAddresses, getTaxiChoices } from "./company-links.js";

const main = {
  key: "москва ул тверская 12 стр 2",
  name: null,
  address: "Москва, ул. Тверская, 12, стр. 2",
  linkToMap: "https://yandex.ru/maps/?pt=37.6,55.7",
  source: "company",
  subdivisionId: null,
};
const khimki = {
  key: "химки ул ленинградская 5",
  name: "Филиал Химки",
  address: "Химки, ул. Ленинградская, 5",
  linkToMap: "https://yandex.ru/maps/?pt=37.4,55.9",
  source: "subdivision",
  subdivisionId: "s1",
};
const warehouse = {
  key: "подольск ул заводская 1",
  name: "Склад Подольск",
  address: "Подольск, ул. Заводская, 1",
  linkToMap: null,
  source: "subdivision",
  subdivisionId: "s3",
};

const company = {
  alias: "Ромашка",
  address: main.address,
  linkToMap: main.linkToMap,
  addresses: [main, khimki, warehouse],
};

test("addresses: backend list is used as is", () => {
  assert.equal(getCompanyAddresses(company), company.addresses);
});

test("addresses: payload without the list falls back to the company address", () => {
  const list = getCompanyAddresses({
    address: " Москва, Ленинский пр-т, 45 ",
    linkToMap: "https://yandex.ru/maps/?ll=37.5,55.7",
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].source, "company");
  assert.equal(list[0].address, "Москва, Ленинский пр-т, 45");
  assert.equal(list[0].linkToMap, "https://yandex.ru/maps/?ll=37.5,55.7");
  assert.deepEqual(getCompanyAddresses({ address: "" }), []);
  assert.deepEqual(getCompanyAddresses(null), []);
});

test("choices: no operator → nothing", () => {
  assert.equal(getTaxiChoices(company, ""), null);
});

test("choices: several addresses with Yandex Go → menu, company address first", () => {
  const choices = getTaxiChoices(company, "yandexgo");
  assert.equal(choices.count, 3);
  assert.equal(choices.menu.label, "Такси · Яндекс Go");
  assert.equal(choices.menu.first.title, "Основной адрес");
  assert.equal(choices.menu.first.reason, null);
  assert.equal(choices.menu.restLabel, "Подразделения");
  assert.deepEqual(
    choices.menu.rest.map((entry) => entry.title),
    ["Филиал Химки", "Склад Подольск"],
  );
  assert.equal(choices.title, "Такси · выбрать адрес (3)");
});

test("choices: default key puts the applicant's address first with its reason", () => {
  const choices = getTaxiChoices(company, "yandexgo", {
    defaultKey: khimki.key,
    defaultReason: "подразделение инициатора",
  });
  assert.equal(choices.menu.first.title, "Филиал Химки");
  assert.equal(choices.menu.first.reason, "подразделение инициатора");
  assert.equal(choices.menu.restLabel, "Другие адреса");
  assert.deepEqual(
    choices.menu.rest.map((entry) => entry.title),
    ["Основной адрес", "Склад Подольск"],
  );
  // прямой вызов (Enter по кнопке без меню) — тоже адрес по умолчанию
  assert.match(choices.action.href, /end-lat=55\.9&end-lon=37\.4/);
});

test("choices: unknown default key falls back to the first address", () => {
  const choices = getTaxiChoices(company, "yandexgo", { defaultKey: "nope" });
  assert.equal(choices.menu.first.title, "Основной адрес");
});

test("choices: each item carries its own taxi action and route flag", () => {
  const choices = getTaxiChoices(company, "yandexgo");
  // плоский список всех адресов с действиями — для строк мобильной шторки
  assert.deepEqual(
    choices.entries.map((entry) => entry.title),
    ["Основной адрес", "Филиал Химки", "Склад Подольск"],
  );
  const [branch, depot] = choices.menu.rest;
  assert.equal(branch.action.supportsRoute, true);
  assert.match(branch.action.href, /end-lat=55\.9&end-lon=37\.4/);
  assert.equal(depot.action.supportsRoute, false);
});

test("choices: one address → direct action, no menu", () => {
  const choices = getTaxiChoices(
    {
      address: "Москва, Ленинский пр-т, 45",
      linkToMap: "https://yandex.ru/maps/?pt=37.5,55.7",
    },
    "yandexgo",
  );
  assert.equal(choices.menu, null);
  assert.equal(choices.count, 1);
  assert.equal(choices.entries.length, 1);
  assert.equal(choices.action.supportsRoute, true);
  assert.equal(choices.title, choices.action.title);
});

test("choices: operator without routes → no menu even with several addresses", () => {
  const choices = getTaxiChoices(company, "maxim");
  assert.equal(choices.menu, null);
  assert.equal(choices.action.href, "https://taximaxim.ru/");
});

test("choices: no address at all → order without a destination", () => {
  const choices = getTaxiChoices({ alias: "Гамма" }, "yandexgo");
  assert.equal(choices.menu, null);
  assert.equal(choices.count, 0);
  assert.equal(choices.action.supportsRoute, false);
});

test("choices: a stored point wins over the map link", () => {
  const stored = {
    ...company,
    addresses: [
      { ...main, location: { lat: 55.7602, lon: 37.6084 } },
      khimki,
      warehouse,
    ],
  };
  const choices = getTaxiChoices(stored, "yandexgo");
  assert.match(
    choices.menu.first.action.href,
    /end-lat=55\.7602&end-lon=37\.6084/,
  );
});

test("choices: a subdivision point from a short link gives a route", () => {
  const withPoint = {
    ...company,
    addresses: [
      main,
      { ...warehouse, location: { lat: 55.4312, lon: 37.5447 } },
    ],
  };
  const choices = getTaxiChoices(withPoint, "yandexgo");
  const depot = choices.menu.rest[0];
  assert.equal(depot.action.supportsRoute, true);
  assert.match(depot.action.href, /end-lat=55\.4312&end-lon=37\.5447/);
});

test("choices: company coordinates from locationSettings reach the main address", () => {
  const choices = getTaxiChoices(
    { ...company, locationSettings: { latitude: 55.75, longitude: 37.62 } },
    "yandexgo",
  );
  assert.match(choices.menu.first.action.href, /end-lat=55\.75&end-lon=37\.62/);
});
