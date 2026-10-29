// node --test src/components/app/spec-sheet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSpecGroups,
  formatSpecValue,
  groupLinks,
  parseMultiValue,
  serializeMultiValue,
  specSummary,
  splitColumns,
} from "./spec-sheet.ts";

test("formatSpecValue: boolean", () => {
  assert.equal(formatSpecValue({ valueType: "boolean" }, true), "да");
  assert.equal(formatSpecValue({ valueType: "boolean" }, "false"), "нет");
  assert.equal(formatSpecValue({ valueType: "boolean" }, "true"), "да");
});

test("formatSpecValue: select shows label, falls back to raw", () => {
  const attr = { valueType: "select", options: [{ value: "ddr5", label: "DDR5" }] };
  assert.equal(formatSpecValue(attr, "ddr5"), "DDR5");
  assert.equal(formatSpecValue(attr, "x"), "x");
});

test("formatSpecValue: multiselect", () => {
  const attr = {
    valueType: "multiselect",
    options: [
      { value: "a", label: "HDMI" },
      { value: "b", label: "DP" },
    ],
  };
  assert.equal(formatSpecValue(attr, '["a","b"]'), "HDMI, DP");
  assert.equal(formatSpecValue(attr, "HDMI 2.0"), "HDMI 2.0");
});

test("formatSpecValue: unit and empty", () => {
  assert.equal(formatSpecValue({ valueType: "number", unit: "ГБ" }, "16"), "16 ГБ");
  assert.equal(formatSpecValue({ valueType: "number", unit: '"' }, "14"), '14"');
  assert.equal(formatSpecValue({ valueType: "string" }, ""), "");
  assert.equal(formatSpecValue({ valueType: "string" }, undefined), "");
});

const attr = (id, name, extra = {}) => ({ _id: id, name, valueType: "string", ...extra });
const link = (id, order, a, groupId, createdAt = "2026-01-01") => ({
  _id: "l" + id,
  order,
  createdAt,
  attributeId: a,
  groupId,
});
const gA = { _id: "gA", name: "Б-группа", order: 5 };
const gB = { _id: "gB", name: "А-группа", order: 2 };

test("buildSpecGroups: group order, row order, empties dropped, Прочее last", () => {
  const links = [
    link(1, 2, attr("a1", "CPU"), gA),
    link(2, 1, attr("a2", "RAM"), gA),
    link(3, 1, attr("a3", "Экран"), gB),
    link(4, 1, attr("a4", "Пустое"), gB),
    link(5, 1, attr("a5", "Пустая группа"), { _id: "gC", name: "Пустая", order: 1 }),
    link(6, 1, attr("a6", "Без группы"), null),
    link(7, 2, attr("a7", "Битая"), "6a1234"),
  ];
  const values = [
    { attributeId: attr("a1", "CPU"), value: "i5" },
    { attributeId: "a2", value: "16" },
    { attributeId: "a3", value: "14" },
    { attributeId: "a4", value: "" },
    { attributeId: "a5", value: "" },
    { attributeId: "a6", value: "x" },
    { attributeId: "a7", value: "y" },
    { attributeId: attr("z1", "Ярлык"), value: "orphan" },
    { attributeId: attr("z0", "Антенна"), value: "orphan2" },
  ];
  const groups = buildSpecGroups(links, values);
  assert.deepEqual(groups.map((g) => g.name), ["А-группа", "Б-группа", "Прочее"]);
  assert.deepEqual(groups[1].rows.map((r) => r.label), ["RAM", "CPU"]);
  assert.deepEqual(groups[0].rows.map((r) => r.value), ["14"]);
  assert.deepEqual(groups[2].rows.map((r) => r.label), [
    "Без группы",
    "Битая",
    "Антенна",
    "Ярлык",
  ]);
});

test("buildSpecGroups: custom otherLabel, no Прочее when nothing left", () => {
  const links = [link(1, 1, attr("a1", "CPU"), gA)];
  const values = [{ attributeId: "a1", value: "i5" }];
  const groups = buildSpecGroups(links, values, { otherLabel: "Ещё" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "gA");
});

test("buildSpecGroups: custom otherLabel names the leftover group", () => {
  const links = [
    link(1, 1, attr("a1", "CPU"), gA),
    link(2, 2, attr("a2", "Без группы"), null),
  ];
  const values = [
    { attributeId: "a1", value: "i5" },
    { attributeId: "a2", value: "x" },
  ];
  const groups = buildSpecGroups(links, values, { otherLabel: "Ещё" });
  assert.equal(groups.at(-1).name, "Ещё");
});

test("buildSpecGroups: only orphan values create the leftover group from scratch", () => {
  const values = [{ attributeId: attr("z1", "Снят"), value: "old" }];
  const groups = buildSpecGroups([], values, { otherLabel: "Ещё" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "other");
  assert.equal(groups[0].name, "Ещё");
  assert.deepEqual(groups[0].rows.map((r) => r.label), ["Снят"]);
});

test("buildSpecGroups: незаполненный Да/Нет — «нет», если характеристики заполнены", () => {
  const links = [
    link(1, 1, attr("a1", "Диагональ"), gA),
    link(2, 2, attr("a2", "Регулировка по высоте", { valueType: "boolean" }), gA),
    link(3, 3, attr("a3", "Поворот", { valueType: "boolean" }), gA),
    link(4, 4, attr("a4", "Динамики", { valueType: "boolean" }), gA),
  ];
  const values = [
    { attributeId: "a1", value: "27" },
    { attributeId: "a3", value: "" },
    { attributeId: "a4", value: true },
  ];
  const groups = buildSpecGroups(links, values);
  assert.deepEqual(
    groups[0].rows.map((r) => [r.label, r.value]),
    [
      ["Диагональ", "27"],
      ["Регулировка по высоте", "нет"],
      ["Поворот", "нет"],
      ["Динамики", "да"],
    ],
  );
  // Пустая конфигурация — пустой лист, а не столбик «нет»
  assert.deepEqual(buildSpecGroups(links, []), []);
  assert.deepEqual(buildSpecGroups(links, [{ attributeId: "a1", value: "" }]), []);
});

test("groupLinks: group order, ungrouped last", () => {
  const links = [
    link(1, 1, attr("a1", "CPU"), null),
    link(2, 2, attr("a2", "RAM"), gA),
    link(3, 1, attr("a3", "Экран"), gB),
    link(4, 1, attr("a4", "SSD"), gA),
  ];
  const groups = groupLinks(links, "Без группы");
  assert.deepEqual(groups.map((g) => g.name), ["А-группа", "Б-группа", "Без группы"]);
  assert.deepEqual(groups[1].links.map((l) => l._id), ["l4", "l2"]);
  assert.deepEqual(groupLinks([], "Без группы"), []);
});

test("specSummary: link order across groups, empties skipped, orphans after, limit", () => {
  const links = [
    link(1, 3, attr("a1", "SSD", { unit: "ГБ" }), gA),
    link(2, 1, attr("a2", "CPU"), gB),
    link(3, 2, attr("a3", "Пусто"), null),
    link(4, 4, attr("a4", "RAM", { unit: "ГБ" }), gA),
  ];
  const values = [
    { attributeId: "a1", value: "512" },
    { attributeId: "a2", value: "i5" },
    { attributeId: "a3", value: "" },
    { attributeId: attr("z1", "Снят"), value: "old" },
  ];
  assert.equal(specSummary(links, values), "i5 / 512 ГБ / old");
  assert.equal(specSummary(links, values, 1), "i5");
  assert.equal(specSummary(links, []), "");
  // Сводка модели в форме устройства — через « · »
  assert.equal(specSummary(links, values, 4, " · "), "i5 · 512 ГБ · old");
});

test("splitColumns", () => {
  assert.deepEqual(splitColumns([1, 2, 3, 4, 5]), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(splitColumns([]), [[], []]);
});

test("multi value helpers", () => {
  assert.deepEqual(parseMultiValue('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseMultiValue("HDMI"), ["HDMI"]);
  assert.deepEqual(parseMultiValue(""), []);
  assert.equal(serializeMultiValue(["a"]), '["a"]');
});
