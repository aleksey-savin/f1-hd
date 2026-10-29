// node --test services/inventory/deviceAttributes.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDeviceAttributes,
  mergeDeviceAttributes,
  missingRequired,
} = require("./deviceAttributes");

const OS = "aaaaaaaaaaaaaaaaaaaaaa01";
const IP = "aaaaaaaaaaaaaaaaaaaaaa02";
const MADE = "aaaaaaaaaaaaaaaaaaaaaa03";
const PORTS = "aaaaaaaaaaaaaaaaaaaaaa04";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaa09";

const link = (_id, name, valueType, required = false) => ({
  attributeId: { _id, name, valueType, scope: "device", options: [] },
  required,
});
const links = [
  link(OS, "Операционная система", "string", true),
  link(IP, "IP-адрес", "string"),
  link(MADE, "Дата производства", "date"),
  link(PORTS, "Портов", "number"),
];
const pairs = (values) => values.map((v) => [String(v.attributeId), v.value]);

test("normalizeDeviceAttributes: годные проходят, пустые выпадают", () => {
  const out = normalizeDeviceAttributes(
    [
      { attributeId: OS, value: " Windows 11 Pro " },
      { attributeId: MADE, value: "2026-06-18" },
      { attributeId: IP, value: "" },
    ],
    links,
  );
  assert.deepEqual(pairs(out.values), [
    [OS, "Windows 11 Pro"],
    [MADE, "2026-06-18"],
  ]);
});

test("normalizeDeviceAttributes: негодное значение и чужой атрибут — ошибка с именем", () => {
  assert.deepEqual(normalizeDeviceAttributes([{ attributeId: PORTS, value: "abc" }], links), {
    error: "Неверное значение атрибута «Портов»",
  });
  assert.deepEqual(normalizeDeviceAttributes([{ attributeId: OTHER, value: "x" }], links), {
    error: "Атрибут не относится к устройствам этого типа",
  });
  assert.deepEqual(normalizeDeviceAttributes({ attributeId: OS }, links), {
    error: "attributes должен быть массивом",
  });
  assert.deepEqual(normalizeDeviceAttributes(undefined, links), { values: [] });
});

test("mergeDeviceAttributes: патч только IP не трогает ОС", () => {
  const current = [
    { attributeId: OS, value: "Windows 11 Pro" },
    { attributeId: IP, value: "10.0.0.1" },
  ];
  const merged = mergeDeviceAttributes(current, [{ attributeId: IP, value: "10.0.0.2" }], links);
  assert.deepEqual(pairs(merged), [
    [OS, "Windows 11 Pro"],
    [IP, "10.0.0.2"],
  ]);
});

test("mergeDeviceAttributes: пустое значение удаляет, атрибут вне связок выпадает", () => {
  const current = [
    { attributeId: OS, value: "Windows 11 Pro" },
    { attributeId: IP, value: "10.0.0.1" },
    { attributeId: OTHER, value: "осталось от прежнего типа" },
  ];
  const merged = mergeDeviceAttributes(current, [{ attributeId: IP, value: "" }], links);
  assert.deepEqual(pairs(merged), [[OS, "Windows 11 Pro"]]);
});

test("missingRequired: имена обязательных без значения", () => {
  assert.deepEqual(missingRequired(links, [{ attributeId: IP, value: "1.1.1.1" }]), ["Операционная система"]);
  assert.deepEqual(missingRequired(links, [{ attributeId: OS, value: "Linux" }]), []);
});

test("normalizeDeviceAttributes: системные IP и MAC проверяются по формату", () => {
  const sys = [
    { attributeId: { _id: IP, code: "ip_address", name: "IP-адрес", valueType: "string", scope: "device" } },
    { attributeId: { _id: MADE, code: "mac_address", name: "MAC-адрес", valueType: "string", scope: "device" } },
  ];
  assert.deepEqual(normalizeDeviceAttributes([{ attributeId: IP, value: "10.0.0.300" }], sys), {
    error: "Некорректный IP-адрес",
  });
  assert.deepEqual(normalizeDeviceAttributes([{ attributeId: MADE, value: "AA:BB" }], sys), {
    error: "Некорректный MAC-адрес",
  });
  const ok = normalizeDeviceAttributes(
    [
      { attributeId: IP, value: "192.168.10.42" },
      { attributeId: MADE, value: "AA:BB:CC:DD:EE:FF" },
    ],
    sys,
  );
  assert.equal(ok.values.length, 2);
});

test("normalizeDeviceAttributes keepEmpty: пустые остаются как «снять» для слияния", () => {
  const out = normalizeDeviceAttributes(
    [
      { attributeId: IP, value: "" },
      { attributeId: OS, value: "Linux" },
    ],
    links,
    { keepEmpty: true },
  );
  assert.deepEqual(pairs(out.values), [
    [IP, ""],
    [OS, "Linux"],
  ]);
});
