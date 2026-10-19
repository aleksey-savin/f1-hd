// node --test src/components/ClientDevice/device-parts.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeWarrantyMonths,
  addMonthsToDay,
  buildSummary,
  emptyUnit,
  insertUnit,
  manualUnits,
  partsBody,
  partsStepLead,
  unitPosition,
  unitWarranty,
  unitsFromBuild,
  warrantyBase,
} from "./device-parts.ts";
import { slotGaps } from "../DeviceBuild/part-models.ts";

const T = (id, name) => ({ _id: id, name });
const cpu = T("t-cpu", "Процессор");
const ram = T("t-ram", "Оперативная память");
const ssd = T("t-ssd", "Накопитель");
const wifi = T("t-wifi", "Wi-Fi адаптер");

const slots = [
  { typeId: wifi, required: false, multiple: false },
  { typeId: cpu, required: true, multiple: false },
  { typeId: ram, required: true, multiple: true },
  { typeId: ssd, required: false, multiple: true },
];

const model = (id, typeId, extra = {}) => ({
  _id: id,
  name: id,
  deviceTypeId: { _id: typeId },
  ...extra,
});

test("manualUnits: по строке на слот, в порядке слотов (как из сборки)", () => {
  const units = manualUnits(slots);
  assert.deepEqual(
    units.map((u) => u.typeId),
    ["t-wifi", "t-cpu", "t-ram", "t-ssd"],
  );
  assert.ok(units.every((u) => u.modelId === null && u.samePurchase));
});

test("unitsFromBuild: quantity разворачивается в строки, пустой слот — пустая строка", () => {
  const parts = [
    {
      typeId: ram,
      deviceModelId: model("m-ram", "t-ram"),
      configurationId: { _id: "c-8" },
      quantity: 2,
    },
    { typeId: cpu, deviceModelId: model("m-cpu", "t-cpu"), quantity: 1 },
  ];
  const units = unitsFromBuild(slots, parts);
  assert.deepEqual(
    units.map((u) => [u.typeId, u.modelId, u.configId]),
    [
      ["t-wifi", null, null],
      ["t-cpu", "m-cpu", null],
      ["t-ram", "m-ram", "c-8"],
      ["t-ram", "m-ram", "c-8"],
      ["t-ssd", null, null],
    ],
  );
  assert.equal(new Set(units.map((u) => u.key)).size, units.length);
  assert.equal(unitPosition(units, units[2]), "1 из 2");
  assert.equal(unitPosition(units, units[3]), "2 из 2");
  assert.equal(unitPosition(units, units[1]), null);
});

test("unitsFromBuild: удалённая и сменившая тип модель не подставляются", () => {
  const units = unitsFromBuild(slots, [
    {
      typeId: cpu,
      deviceModelId: model("m-cpu", "t-cpu", { deletedAt: "2026-01-01" }),
      quantity: 1,
    },
    {
      typeId: ram,
      deviceModelId: model("m-x", "t-ssd"),
      configurationId: { _id: "c" },
      quantity: 1,
    },
  ]);
  const cpuUnit = units.find((u) => u.typeId === "t-cpu");
  const ramUnit = units.find((u) => u.typeId === "t-ram");
  assert.equal(cpuUnit.modelId, null);
  assert.equal(cpuUnit.modelGone, "deleted");
  assert.equal(ramUnit.modelId, null);
  assert.equal(ramUnit.configId, null);
  assert.equal(ramUnit.modelGone, "retyped");
});

test("unitsFromBuild: удалённая конфигурация сборки не подставляется", () => {
  const units = unitsFromBuild(slots, [
    {
      typeId: ram,
      deviceModelId: model("m-ram", "t-ram"),
      configurationId: { _id: "c", deletedAt: "x" },
      quantity: 1,
    },
  ]);
  assert.equal(units.find((u) => u.typeId === "t-ram").configId, null);
});

test("insertUnit: новая строка — после последней строки слота", () => {
  const units = manualUnits(slots);
  const next = insertUnit(units, "t-ram");
  assert.deepEqual(
    next.map((u) => u.typeId),
    ["t-wifi", "t-cpu", "t-ram", "t-ram", "t-ssd"],
  );
});

test("addMonthsToDay: месяцы и конец месяца", () => {
  assert.equal(addMonthsToDay("2026-10-19", 36), "2029-10-19");
  assert.equal(addMonthsToDay("2026-10-19", 12), "2027-10-19");
  assert.equal(addMonthsToDay("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonthsToDay("2028-02-29", 12), "2029-02-28");
  assert.equal(addMonthsToDay("", 12), "");
});

test("warrantyBase: своя дата / дата ПК / сегодня", () => {
  const unit = emptyUnit("t-cpu");
  assert.equal(warrantyBase(unit, "2026-05-01", "2026-10-19"), "2026-05-01");
  assert.equal(warrantyBase(unit, "", "2026-10-19"), "2026-10-19");
  const own = { ...unit, samePurchase: false, purchasedAt: "2025-03-03" };
  assert.equal(warrantyBase(own, "2026-05-01", "2026-10-19"), "2025-03-03");
  assert.equal(
    warrantyBase({ ...own, purchasedAt: "" }, "2026-05-01", "2026-10-19"),
    "2026-10-19",
  );
});

test("activeWarrantyMonths: чип активен, только если дата совпала", () => {
  const unit = { ...emptyUnit("t-cpu"), warrantyExpirationDate: "2028-10-19" };
  assert.equal(activeWarrantyMonths(unit, "2026-10-19"), 24);
  assert.equal(activeWarrantyMonths(unit, "2026-10-18"), null);
  assert.equal(activeWarrantyMonths(emptyUnit("t-cpu"), "2026-10-19"), null);
});

test("гарантия чипом: месяцы в строке, дата — от итоговой даты покупки", () => {
  // Чип выбран, когда даты покупки ПК ещё не было — от сегодня
  const chip = {
    ...emptyUnit("t-cpu"),
    modelId: "m-cpu",
    warrantyExpirationDate: "2028-10-19",
    warrantyMonths: 24,
  };
  // Чип активен и после смены базы
  assert.equal(activeWarrantyMonths(chip, "2026-05-01"), 24);
  assert.equal(unitWarranty(chip, "2026-05-01"), "2028-05-01");
  // Руками выбранная дата не пересчитывается
  const manual = {
    ...emptyUnit("t-ram"),
    modelId: "m-ram",
    warrantyExpirationDate: "2027-01-15",
  };
  // Своя закупка — от своей даты
  const own = {
    ...chip,
    typeId: "t-ssd",
    modelId: "m-ssd",
    warrantyMonths: 12,
    samePurchase: false,
    purchasedAt: "2025-03-03",
  };
  const opts = { pcPurchasedAt: "2026-05-01", today: "2026-10-19" };
  assert.deepEqual(
    partsBody([chip, manual, own], opts).map((b) => b.warrantyExpirationDate),
    ["2028-05-01", "2027-01-15", "2026-03-03"],
  );
  // Даты ПК нет — от сегодня
  assert.equal(
    partsBody([chip], { today: "2026-10-19" })[0].warrantyExpirationDate,
    "2028-10-19",
  );
});

test("partsBody: пустые строки не уходят, закупка — всё или ничего", () => {
  const units = [
    {
      ...emptyUnit("t-cpu"),
      modelId: "m-cpu",
      serialNumber: "  SN1 ",
      warrantyExpirationDate: "2029-10-19",
    },
    emptyUnit("t-wifi"),
    {
      ...emptyUnit("t-ram"),
      modelId: "m-ram",
      configId: "c-8",
      samePurchase: false,
      purchasedAt: "2026-10-15",
      supplierId: "",
    },
  ];
  assert.deepEqual(partsBody(units), [
    {
      typeId: "t-cpu",
      deviceModelId: "m-cpu",
      serialNumber: "SN1",
      warrantyExpirationDate: "2029-10-19",
    },
    {
      typeId: "t-ram",
      deviceModelId: "m-ram",
      configurationId: "c-8",
      purchasedAt: "2026-10-15",
      supplierId: "",
    },
  ]);
});

test("slotGaps: пустой обязательный слот и конфигурация", () => {
  const live = slots;
  const models = new Map([
    ["m-ram", model("m-ram", "t-ram", { configurationsCount: 2 })],
    ["m-cpu", model("m-cpu", "t-cpu", { configurationsCount: 1 })],
  ]);
  const units = [
    { ...emptyUnit("t-cpu"), modelId: "m-cpu" },
    { ...emptyUnit("t-ram"), modelId: "m-ram" },
  ];
  assert.deepEqual(slotGaps(live, units, models), [
    "конфигурация: Оперативная память",
  ]);
  assert.deepEqual(slotGaps(live, [emptyUnit("t-cpu")], models), [
    "Процессор",
    "Оперативная память",
  ]);
});

test("buildSummary: состав по слотам и число единиц", () => {
  const parts = [
    {
      typeId: cpu,
      deviceModelId: {
        _id: "m-cpu",
        name: "Ryzen 5 8600G",
        vendorId: { name: "AMD" },
      },
      quantity: 1,
    },
    {
      typeId: ram,
      deviceModelId: { _id: "m-ram", name: "FURY 8 ГБ" },
      quantity: 2,
    },
    {
      typeId: wifi,
      deviceModelId: { _id: "m-w", name: "TP-Link" },
      quantity: 1,
    },
  ];
  const summary = buildSummary(
    { slots, keySpecs: [{ typeId: cpu, source: "model", aggregate: "first" }] },
    parts,
  );
  assert.equal(summary.keySpecs, "AMD Ryzen 5 8600G");
  assert.equal(
    summary.composition,
    "4 детали: Wi-Fi адаптер, процессор, 2 × оперативная память",
  );
});

test("partsStepLead: число и согласование", () => {
  assert.equal(
    partsStepLead(8),
    "8 деталей станут отдельными устройствами в составе этого ПК.",
  );
  assert.equal(
    partsStepLead(1),
    "1 деталь станет отдельным устройством в составе этого ПК.",
  );
  assert.equal(
    partsStepLead(3),
    "3 детали станут отдельными устройствами в составе этого ПК.",
  );
});
