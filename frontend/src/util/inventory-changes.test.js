// node --test src/util/inventory-changes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  confirmSummary,
  createdTo,
  isOpenChange,
  linkFor,
  opsCount,
  partialNote,
  resultLabel,
  segments,
  statusTone,
} from "./inventory-changes.ts";

// Предложение ИИ-агента по инвентарю: тон статуса, ссылки в тексте операции,
// сводка диалога «Применить?» и подпись результата.

const allow = (...pairs) => (req) =>
  Object.entries(req).every(([res, actions]) =>
    actions.every((a) => pairs.includes(`${res}.${a}`)),
  );
const none = () => false;

test("isOpenChange: ждёт автора и срок не вышел; после срока до sweep — закрыто", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const at = (expiresAt, status = "awaiting_requester") => isOpenChange({ status, expiresAt }, now);
  assert.equal(at("2026-10-20T10:00:01Z"), true);
  // Срок вышел, статус ещё прежний (обход sweep раз в 5 минут)
  assert.equal(at("2026-10-20T10:00:00Z"), false);
  assert.equal(at("2026-10-20T09:58:00Z"), false);
  // Без срока или с битой датой — как на сервере, истёкшее
  assert.equal(at(undefined), false);
  assert.equal(at(null), false);
  assert.equal(at("не дата"), false);
  for (const status of ["applying", "done", "partial", "failed", "rejected", "expired"]) {
    assert.equal(at("2026-10-23T10:00:00Z", status), false, status);
  }
});

test("opsCount: 1, 3, 9, 21", () => {
  assert.equal(opsCount(1), "1 операция");
  assert.equal(opsCount(3), "3 операции");
  assert.equal(opsCount(9), "9 операций");
  assert.equal(opsCount(21), "21 операция");
});

test("statusTone: все статусы и прерванное применение", () => {
  assert.equal(statusTone("awaiting_requester", false), "wait");
  assert.equal(statusTone("partial", false), "wait");
  assert.equal(statusTone("applying", false), "info");
  assert.equal(statusTone("done", false), "ok");
  assert.equal(statusTone("failed", false), "bad");
  assert.equal(statusTone("rejected", false), "idle");
  assert.equal(statusTone("expired", false), "idle");
  assert.equal(statusTone("failed", true), "bad");
});

test("linkFor: путь по модели и право", () => {
  const can = allow("device.read", "inventoryCatalog.read", "supplier.read");
  assert.equal(linkFor({ model: "ClientDevice", id: "a" }, can), "/inventory/client-devices/a");
  assert.equal(linkFor({ model: "Location", id: "a" }, can), "/inventory/locations/a");
  assert.equal(linkFor({ model: "DeviceModel", id: "a" }, can), "/inventory/device-models/a");
  assert.equal(linkFor({ model: "DeviceType", id: "a" }, can), "/inventory/device-types/a");
  assert.equal(linkFor({ model: "Vendor", id: "a" }, can), "/inventory/vendors/a");
  assert.equal(linkFor({ model: "DeviceBuild", id: "a" }, can), "/inventory/device-builds/a");
  assert.equal(linkFor({ model: "Supplier", id: "a" }, can), "/inventory/suppliers/a");
});

test("linkFor: без права, без страницы, без id -> null", () => {
  assert.equal(linkFor({ model: "DeviceModel", id: "a" }, allow("device.read")), null);
  assert.equal(linkFor({ model: "ClientDevice", id: "a" }, none), null);
  for (const model of ["DeviceAttribute", "AttributeGroup", "Company", "User", "DeviceConfiguration", "Nope"]) {
    assert.equal(linkFor({ model, id: "a" }, allow("device.read", "inventoryCatalog.read")), null);
  }
  assert.equal(linkFor({ model: "ClientDevice", id: "" }, allow("device.read")), null);
});

test("segments: две ссылки в одной строке", () => {
  const can = allow("device.read", "inventoryCatalog.read");
  const links = [
    { model: "ClientDevice", id: "d1", label: "ПК PC-1" },
    { model: "DeviceModel", id: "m1", label: "Dell 7090" },
  ];
  assert.deepEqual(segments("Заменить Dell 7090 в ПК PC-1 сегодня", links, can), [
    { text: "Заменить " },
    { text: "Dell 7090", to: "/inventory/device-models/m1" },
    { text: " в " },
    { text: "ПК PC-1", to: "/inventory/client-devices/d1" },
    { text: " сегодня" },
  ]);
});

test("segments: подпись дважды — ссылкой только первая", () => {
  const out = segments("PC-1 и снова PC-1", [{ model: "ClientDevice", id: "d", label: "PC-1" }], allow("device.read"));
  assert.deepEqual(out, [
    { text: "PC-1", to: "/inventory/client-devices/d" },
    { text: " и снова PC-1" },
  ]);
});

test("segments: без права — текст без to", () => {
  const out = segments("в PC-1 ok", [{ model: "ClientDevice", id: "d", label: "PC-1" }], none);
  assert.deepEqual(out, [{ text: "в " }, { text: "PC-1" }, { text: " ok" }]);
  assert.ok(!("to" in out[1]));
});

test("segments: нет подписи в тексте - пропуск; без ссылок - один кусок; пустой текст", () => {
  assert.deepEqual(segments("просто текст", [{ model: "Vendor", id: "v", label: "Dell" }], allow("inventoryCatalog.read")), [
    { text: "просто текст" },
  ]);
  assert.deepEqual(segments("abc", [], none), [{ text: "abc" }]);
  assert.deepEqual(segments("", [], none), []);
});

test("segments: длинная подпись раньше короткой, без наложений", () => {
  const can = allow("inventoryCatalog.read");
  const links = [
    { model: "Vendor", id: "v", label: "Dell" },
    { model: "DeviceModel", id: "m", label: "Dell 7090" },
  ];
  assert.deepEqual(segments("Dell 7090", links, can), [
    { text: "Dell 7090", to: "/inventory/device-models/m" },
  ]);
});

test("confirmSummary: образец макета", () => {
  const out = confirmSummary(
    {
      create: { type: 1, attribute: 1, model: 1, configuration: 1, device: 2 },
      change: { count: 1, names: ["ПК PC-000123"] },
    },
    9,
  );
  assert.equal(out.title, "Применить 9 операций?");
  assert.deepEqual(out.items, [
    "создать: тип, атрибут, модель, конфигурацию и 2 устройства;",
    "изменить: ПК PC-000123.",
  ]);
});

test("confirmSummary: 40 устройств; формы 1 / 2-4 / 5+", () => {
  assert.deepEqual(confirmSummary({ create: { device: 40 }, change: { count: 0 } }, 40).items, [
    "создать: 40 устройств.",
  ]);
  assert.deepEqual(
    confirmSummary(
      { create: { type: 5, attribute: 2, group: 1, vendor: 3, supplier: 1, model: 7, configuration: 3, build: 1, device: 1 }, change: { count: 0 } },
      1,
    ).items,
    [
      "создать: 5 типов, 2 атрибута, группу, 3 вендора, поставщика, 7 моделей, 3 конфигурации, сборку и устройство.",
    ],
  );
  assert.deepEqual(
    confirmSummary({ create: { supplier: 5, build: 2, group: 5 }, change: { count: 0 } }, 1).items,
    ["создать: 5 групп, 5 поставщиков и 2 сборки."],
  );
});

test("confirmSummary: изменить — числом, если имён нет; пустая сторона опущена", () => {
  assert.deepEqual(confirmSummary({ create: {}, change: { count: 3 } }, 3).items, [
    "изменить: 3 устройства.",
  ]);
  assert.deepEqual(confirmSummary({ create: {}, change: { count: 1 } }, 1).items, [
    "изменить: 1 устройство.",
  ]);
  assert.deepEqual(confirmSummary({ create: {}, change: { count: 0 } }, 1).items, []);
  assert.equal(confirmSummary({ create: {}, change: { count: 0 } }, 21).title, "Применить 21 операцию?");
  assert.deepEqual(
    confirmSummary({ create: { type: 1 }, change: { count: 1, names: ["A", "B"] } }, 2).items,
    ["создать: тип;", "изменить: A, B."],
  );
});

test("resultLabel: все ветки", () => {
  assert.deepEqual(resultLabel({ state: "done" }, false), { tone: "ok", text: "✓ Выполнено" });
  assert.deepEqual(resultLabel({ state: "failed", error: "нет места" }, false), {
    tone: "bad",
    text: "✗ Не выполнено: нет места",
  });
  assert.deepEqual(resultLabel({ state: "pending" }, true), { tone: "wait", text: "Результат неизвестен" });
  assert.deepEqual(resultLabel({ state: "skipped" }, true), { tone: "wait", text: "Результат неизвестен" });
  assert.deepEqual(resultLabel({ state: "pending" }, false), { tone: "idle", text: "Не выполнялась" });
  assert.deepEqual(resultLabel({ state: "skipped", error: "устройство изменилось" }, false), {
    tone: "idle",
    text: "Не выполнялась: устройство изменилось",
  });
  assert.deepEqual(resultLabel({ state: "done" }, true), { tone: "ok", text: "✓ Выполнено" });
});

test("createdTo: to есть и право есть; конфигурация — по праву модели", () => {
  const catalog = allow("inventoryCatalog.read");
  const device = { model: "ClientDevice", id: "d1", to: "/inventory/client-devices/d1" };
  const config = { model: "DeviceConfiguration", id: "c1", to: "/inventory/device-models/m1" };
  assert.equal(createdTo(device, allow("device.read")), "/inventory/client-devices/d1");
  assert.equal(createdTo(config, catalog), "/inventory/device-models/m1");
  assert.equal(createdTo(config, allow("device.read")), null);
  assert.equal(createdTo(device, catalog), null);
  assert.equal(createdTo({ model: "DeviceAttribute", id: "a1" }, catalog), null);
  assert.equal(createdTo({ model: "ClientDevice", id: "d2" }, allow("device.read")), null);
});

const ops = (...states) => states.map((state) => ({ result: { state } }));

test("partialNote: образец макета — 7 из 9, восьмая не прошла", () => {
  const note = partialNote(ops("done", "done", "done", "done", "done", "done", "done", "failed", "skipped"));
  assert.equal(note.title, "Применено 7 из 9 операций");
  assert.equal(
    note.body,
    "Операция 8 не прошла, и HD остановил применение: операция 9 не выполнялась. Сделанное остаётся — остаток агент может предложить заново.",
  );
});

test("partialNote: несколько невыполненных; упала последняя; 21 операция", () => {
  assert.match(
    partialNote(ops("done", "failed", "skipped", "skipped", "skipped")).body,
    /^Операция 2 не прошла, и HD остановил применение: операции 3–5 не выполнялись\. /,
  );
  assert.match(partialNote(ops("done", "failed")).body, /^Операция 2 не прошла, и HD остановил применение\. Сделанное/);
  const many = ops(...Array(20).fill("done"), "failed");
  assert.equal(partialNote(many).title, "Применено 20 из 21 операции");
});
