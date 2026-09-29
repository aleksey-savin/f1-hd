// node --test src/util/timezone-catalog.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import timezones, { TIMEZONE_REGIONS } from "../store/timezones.js";
import {
  catalogCity,
  shiftClock,
  shiftPhrase,
  timezoneOptions,
  utcOffsetLabel,
  zoneOffsetMinutes,
} from "./timezone-catalog.js";

const JANUARY = new Date("2026-01-15T12:00:00Z");
const JULY = new Date("2026-07-15T12:00:00Z");

// Зоны прежнего каталога: они уже сохранены в базе, выпасть из списка не могут
const LEGACY_ZONES = [
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Rome",
  "Europe/Kaliningrad", "Europe/Athens", "Africa/Cairo", "Africa/Nairobi",
  "Europe/Moscow", "Europe/Volgograd", "Asia/Dubai", "Europe/Samara",
  "Europe/Saratov", "Europe/Astrakhan", "Europe/Ulyanovsk", "Asia/Kolkata",
  "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk", "Asia/Krasnoyarsk",
  "Asia/Barnaul", "Asia/Tomsk", "Asia/Novokuznetsk", "Asia/Shanghai",
  "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Chita", "Asia/Seoul", "Asia/Tokyo",
  "Asia/Vladivostok", "Australia/Sydney", "Australia/Melbourne", "Asia/Magadan",
  "Asia/Sakhalin", "Asia/Kamchatka", "Asia/Anadyr", "America/New_York",
  "America/Toronto", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Vancouver",
];

test("каталог: зоны уникальны, известны Intl, у каждой есть город, страна и группа", () => {
  const values = timezones.map((entry) => entry.value);
  assert.equal(new Set(values).size, values.length);
  for (const entry of timezones) {
    assert.notEqual(zoneOffsetMinutes(entry.value, JULY), null, entry.value);
    assert.ok(entry.cities.length > 0 && entry.country, entry.value);
    assert.ok(TIMEZONE_REGIONS.includes(entry.region), entry.value);
  }
});

test("каталог: прежние зоны на месте", () => {
  const values = new Set(timezones.map((entry) => entry.value));
  for (const zone of LEGACY_ZONES) assert.ok(values.has(zone), zone);
});

test("копия на бэкенде совпадает с каталогом: зона → главный город", () => {
  const backend = JSON.parse(
    readFileSync(new URL("../../../backend/data/timezoneCities.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    backend,
    Object.fromEntries(timezones.map((entry) => [entry.value, entry.cities[0]])),
  );
});

test("смещение считается на момент показа, с летним временем", () => {
  assert.equal(zoneOffsetMinutes("Europe/London", JANUARY), 0);
  assert.equal(zoneOffsetMinutes("Europe/London", JULY), 60);
  assert.equal(zoneOffsetMinutes("America/New_York", JANUARY), -300);
  assert.equal(zoneOffsetMinutes("America/New_York", JULY), -240);
  assert.equal(zoneOffsetMinutes("Asia/Ho_Chi_Minh", JULY), 420);
  assert.equal(zoneOffsetMinutes("Asia/Kathmandu", JULY), 345);
  assert.equal(zoneOffsetMinutes("Not/AZone", JULY), null);
});

test("подпись смещения", () => {
  assert.equal(utcOffsetLabel(420), "UTC+7");
  assert.equal(utcOffsetLabel(330), "UTC+5:30");
  assert.equal(utcOffsetLabel(345), "UTC+5:45");
  assert.equal(utcOffsetLabel(-240), "UTC−4");
  assert.equal(utcOffsetLabel(-210), "UTC−3:30");
  assert.equal(utcOffsetLabel(0), "UTC+0");
});

test("опции: подпись, подсказка и группа Ханоя", () => {
  const hanoi = timezoneOptions({ at: JULY }).find(
    (option) => option.value === "Asia/Ho_Chi_Minh",
  );
  assert.deepEqual(hanoi, {
    value: "Asia/Ho_Chi_Minh",
    label: "Ханой, Хошимин (UTC+7)",
    hint: "Вьетнам · Asia/Ho_Chi_Minh",
    group: "Азия",
  });
});

test("опции: Россия первой, внутри группы — по смещению, затем по городу", () => {
  const options = timezoneOptions({ at: JULY });
  assert.equal(options[0].label, "Калининград (UTC+2)");
  const groups = [...new Set(options.map((option) => option.group))];
  assert.deepEqual(groups, TIMEZONE_REGIONS);

  const utc7 = options
    .filter((option) => option.group === "Россия" && option.label.endsWith("(UTC+7)"))
    .map((option) => option.label.split(" (")[0]);
  assert.deepEqual(utc7, ["Барнаул", "Красноярск", "Новокузнецк, Кемерово", "Новосибирск", "Томск"]);
});

test("опции: поиск по «UTC+7» находит и Новосибирск, и Ханой", () => {
  const found = timezoneOptions({ at: JULY })
    .filter((option) => `${option.label} ${option.hint}`.includes("UTC+7"))
    .map((option) => option.value);
  assert.ok(found.includes("Asia/Novosibirsk"));
  assert.ok(found.includes("Asia/Ho_Chi_Minh"));
});

test("опции: сохранённая зона вне каталога — первой строкой, как есть", () => {
  const options = timezoneOptions({ at: JULY, extra: ["Asia/Saigon", "Asia/Tokyo", null] });
  assert.deepEqual(options[0], { value: "Asia/Saigon", label: "Asia/Saigon (UTC+7)" });
  assert.equal(options.filter((option) => option.value === "Asia/Tokyo").length, 1);
  assert.equal(options.length, timezoneOptions({ at: JULY }).length + 1);
});

test("главный город зоны", () => {
  assert.equal(catalogCity("Asia/Ho_Chi_Minh"), "Ханой");
  assert.equal(catalogCity("Europe/Moscow"), "Москва");
  assert.equal(catalogCity("Asia/Saigon"), null);
});

test("сдвиг словами и пример времени", () => {
  assert.equal(shiftPhrase(-180), "на 3 ч раньше");
  assert.equal(shiftPhrase(150), "на 2 ч 30 мин позже");
  assert.equal(shiftPhrase(-45), "на 45 мин раньше");
  assert.equal(shiftPhrase(0), null);
  assert.equal(shiftClock("09:00", -180), "06:00");
  assert.equal(shiftClock("09:00", -600), "23:00");
  assert.equal(shiftClock("22:00", 180), "01:00");
  assert.equal(shiftClock("09:00", 330), "14:30");
});
