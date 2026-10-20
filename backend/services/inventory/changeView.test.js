// node --test services/inventory/changeView.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { toView, canView, createdRefs } = require("./changeView");

const NOW = new Date("2026-10-20T10:00:00Z");
const ME = "64f1000000000000000000a1";
const OTHER = "64f1000000000000000000a2";
const author = { _id: ME, firstName: "Алексей", lastName: "Савин", email: "a@x.ru", phone: "79990000000" };

const DEVICE = "64f1000000000000000000d1";
const MODEL = "64f1000000000000000000c1";
const CONFIG = "64f1000000000000000000c2";
const TYPE = "64f1000000000000000000e1";
const ATTR = "64f1000000000000000000e2";
const PC = "64f100000000000000000123";
const SSD12 = "64f100000000000000000012";
const SSD31 = "64f100000000000000000031";

const change = (extra = {}) => ({
  _id: "64f100000000000000000001",
  number: 7,
  title: "Ноутбук и док-станция новому сотруднику",
  reason: "Запрос в Telegram",
  status: "awaiting_requester",
  createdAt: new Date("2026-10-20T09:38:00Z"),
  expiresAt: new Date("2026-10-23T09:38:00Z"),
  requestedBy: author,
  requestedVia: { keyId: "64f1000000000000000000f1", keyName: "OpenClaw" },
  operations: [
    {
      kind: "moveDevice",
      params: { device: PC },
      text: "Перенести ПК PC-000123 в «Склад»",
      page: { head: "Перенести ПК PC-000123 в «Склад»", subs: [], fields: [], links: [{ model: "ClientDevice", id: PC, label: "ПК PC-000123" }], deferred: false },
      targets: [{ model: "ClientDevice", id: PC, updatedAt: new Date("2026-10-01T00:00:00Z") }],
      result: { state: "pending" },
    },
  ],
  timeline: [{ at: new Date("2026-10-20T09:38:00Z"), kind: "proposed", user: author, text: "Предложено агентом OpenClaw" }],
  ...extra,
});

const viewer = (extra = {}) => ({ userId: ME, canManageDevices: false, canManageCatalog: false, ...extra });

test("toView: автор видит кнопки, пока открыто и не истекло", () => {
  const view = toView(change(), viewer(), NOW);
  assert.equal(view.my.canDecide, true);
  assert.equal(view.statusLabel, "Ждёт утверждения");
  assert.equal(view.closedAt, null);
  assert.equal(view.decision, null);
  assert.equal(view.agentName, "OpenClaw");
  // Человек — только имя: ни почты, ни телефона
  assert.deepEqual(view.requestedBy, { _id: ME, name: "Алексей Савин" });
  assert.equal(view.number, undefined);

  const late = toView(change(), viewer(), new Date("2026-10-23T09:38:00Z"));
  assert.equal(late.my.canDecide, false);

  const colleague = toView(change(), viewer({ userId: OTHER, canManageDevices: true }), NOW);
  assert.equal(colleague.my.canDecide, false);
});

test("canView: автор, право на устройства, право на справочники — да; без прав — нет", () => {
  assert.equal(canView(change(), viewer()), true);
  assert.equal(canView(change(), viewer({ userId: OTHER, canManageDevices: true })), true);
  assert.equal(canView(change(), viewer({ userId: OTHER, canManageCatalog: true })), true);
  assert.equal(canView(change(), viewer({ userId: OTHER })), false);
  // Заявитель не раскрыт (id строкой) — тоже сравнивается
  assert.equal(canView(change({ requestedBy: ME }), viewer()), true);
});

test("toView: операция без page — заголовок и подстроки из text", () => {
  const legacy = change({
    operations: [
      { kind: "catalog", text: "Справочники техники:\nНовый тип «Док-станция» (комплектующая: нет)" },
      { kind: "setDeviceStatus", text: "Сменить статус SSD SSD-000012 на «В ремонте» — полная проверка при утверждении" },
    ],
  });
  const [catalog, status] = toView(legacy, viewer(), NOW).operations;
  assert.deepEqual(catalog, {
    index: 0,
    // Двоеточие перед списком снято, как в page (список и так ниже)
    head: "Справочники техники",
    subs: ["Новый тип «Док-станция» (комплектующая: нет)"],
    fields: [],
    links: [],
    deferred: false,
    result: { state: "pending", error: undefined, created: [] },
  });
  assert.equal(status.head, "Сменить статус SSD SSD-000012 на «В ремонте»");
  assert.deepEqual(status.subs, []);
  assert.equal(status.deferred, true);
  assert.deepEqual(status.links, []);
});

test("toView: итог операции и созданное", () => {
  const applied = change({
    status: "done",
    decision: { user: ME, decision: "approve", channel: "portal", at: new Date("2026-10-20T09:51:00Z") },
    operations: [
      {
        kind: "catalog",
        params: { types: [{ key: "dock", name: "Док-станция" }, { key: "nb", name: "Ноутбук" }], attributes: [{ key: "usbc", name: "Порты USB-C" }] },
        text: "Справочники техники:\nТип «Ноутбук» уже есть — используется\nНовый тип «Док-станция» (комплектующая: нет)\nНовый атрибут «Порты USB-C» (число)",
        page: {
          head: "Справочники техники",
          subs: ["Тип «Ноутбук» уже есть — используется", "Новый тип «Док-станция» (комплектующая: нет)", "Новый атрибут «Порты USB-C» (число)"],
          fields: [],
          links: [],
          deferred: false,
        },
        // ids каталога несут и подхваченное: «Ноутбук» уже был, созданным он не показывается
        result: { state: "done", created: { type: { dock: TYPE, nb: "64f1000000000000000000e9" }, attribute: { usbc: ATTR } } },
      },
      { kind: "createModel", text: "Новая модель «Dock»", result: { state: "done", created: { model: MODEL } } },
      { kind: "createConfiguration", text: "Новая конфигурация «16/512»", result: { state: "done", created: { configuration: CONFIG } } },
      { kind: "createDevice", text: "Новое устройство ThinkPad", result: { state: "done", created: { device: DEVICE } } },
      // Созданное потом удалили: ссылки нет, итог прежний
      { kind: "createVendor", text: "Новый вендор «Acme»", result: { state: "done", created: { vendor: "64f1000000000000000000b1" } } },
      { kind: "moveDevice", text: "Перенести ПК PC-000123", result: { state: "failed", error: "помещение не найдено" } },
    ],
    timeline: [
      { at: new Date("2026-10-20T09:38:00Z"), kind: "proposed", text: "Предложено" },
      { at: new Date("2026-10-20T09:51:00Z"), kind: "decision", user: author, text: "Утверждено: Алексей Савин, на портале" },
      { at: new Date("2026-10-20T09:52:00Z"), kind: "result", user: author, text: "Применено" },
    ],
  });

  assert.deepEqual(createdRefs(applied), [
    { model: "DeviceType", id: TYPE },
    { model: "DeviceAttribute", id: ATTR },
    { model: "DeviceModel", id: MODEL },
    { model: "DeviceConfiguration", id: CONFIG },
    { model: "ClientDevice", id: DEVICE },
    { model: "Vendor", id: "64f1000000000000000000b1" },
  ]);

  const created = new Map([
    [`DeviceType:${TYPE}`, { label: "Док-станция", to: `/inventory/device-types/${TYPE}` }],
    [`DeviceAttribute:${ATTR}`, { label: "Порты USB-C" }],
    [`DeviceModel:${MODEL}`, { label: "ThinkPad USB-C Dock Gen 2", to: `/inventory/device-models/${MODEL}` }],
    [`DeviceConfiguration:${CONFIG}`, { label: "ThinkPad T14 Gen 5 «16/512»", to: `/inventory/device-models/${MODEL}` }],
    [`ClientDevice:${DEVICE}`, { label: "NB-000214", to: `/inventory/client-devices/${DEVICE}` }],
  ]);
  const view = toView(applied, viewer(), NOW, { created });

  assert.equal(view.closedAt.toISOString(), "2026-10-20T09:52:00.000Z");
  assert.deepEqual(view.decision, { decision: "approve", channel: "portal", comment: undefined, at: new Date("2026-10-20T09:51:00Z") });
  assert.equal(view.my.canDecide, false);

  const [catalog, , , device, vendor, move] = view.operations;
  assert.deepEqual(catalog.result.created, [
    { model: "DeviceType", id: TYPE, label: "Док-станция", to: `/inventory/device-types/${TYPE}` },
    { model: "DeviceAttribute", id: ATTR, label: "Порты USB-C" },
  ]);
  assert.deepEqual(device.result, {
    state: "done",
    error: undefined,
    created: [{ model: "ClientDevice", id: DEVICE, label: "NB-000214", to: `/inventory/client-devices/${DEVICE}` }],
  });
  assert.deepEqual(vendor.result, { state: "done", error: undefined, created: [] });
  assert.deepEqual(move.result, { state: "failed", error: "помещение не найдено", created: [] });

  assert.deepEqual(view.created, [
    { model: "DeviceType", id: TYPE, label: "Док-станция", kindLabel: "тип", to: `/inventory/device-types/${TYPE}` },
    { model: "DeviceAttribute", id: ATTR, label: "Порты USB-C", kindLabel: "атрибут" },
    { model: "DeviceModel", id: MODEL, label: "ThinkPad USB-C Dock Gen 2", kindLabel: "модель", to: `/inventory/device-models/${MODEL}` },
    { model: "DeviceConfiguration", id: CONFIG, label: "ThinkPad T14 Gen 5 «16/512»", kindLabel: "конфигурация", to: `/inventory/device-models/${MODEL}` },
    { model: "ClientDevice", id: DEVICE, label: "NB-000214", kindLabel: "устройство", to: `/inventory/client-devices/${DEVICE}` },
  ]);
  assert.deepEqual(view.timeline.map((t) => t.text), ["Предложено", "Утверждено: Алексей Савин, на портале", "Применено"]);
  assert.deepEqual(Object.keys(view.timeline[0]), ["at", "text"]);
});

test("toView: созданная группа — в «Создано» с подписью «группа» и без ссылки; подхваченная — нет", () => {
  const NEW_GROUP = "64f1000000000000000000e3";
  const OLD_GROUP = "64f1000000000000000000e4";
  const applied = change({
    status: "done",
    operations: [
      {
        kind: "catalog",
        params: { groups: [{ key: "net", name: "Сеть" }, { key: "pwr", name: "Питание" }] },
        text: "Справочники техники:\nГруппа «Сеть» уже есть — используется\nНовая группа «Питание»",
        page: { head: "Справочники техники", subs: ["Группа «Сеть» уже есть — используется", "Новая группа «Питание»"], fields: [], links: [], deferred: false },
        result: { state: "done", created: { type: {}, attribute: {}, group: { net: OLD_GROUP, pwr: NEW_GROUP } } },
      },
    ],
  });
  assert.deepEqual(createdRefs(applied), [{ model: "AttributeGroup", id: NEW_GROUP }]);
  const created = new Map([[`AttributeGroup:${NEW_GROUP}`, { label: "Питание" }]]);
  const view = toView(applied, viewer(), NOW, { created });
  assert.deepEqual(view.created, [{ model: "AttributeGroup", id: NEW_GROUP, label: "Питание", kindLabel: "группа" }]);
});

test("toView: прерванное с записанным ходом — выполненные done, остальные pending, созданное в «Создано»", () => {
  const stuck = change({
    status: "failed",
    stuck: true,
    operations: [
      { kind: "createModel", text: "Новая модель «Dock»", result: { state: "done", created: { model: MODEL } } },
      { kind: "createDevice", text: "Новое устройство ThinkPad", result: { state: "pending" } },
    ],
  });
  const created = new Map([[`DeviceModel:${MODEL}`, { label: "Dock", to: `/inventory/device-models/${MODEL}` }]]);
  const view = toView(stuck, viewer(), NOW, { created });
  assert.deepEqual(view.operations.map((o) => o.result.state), ["done", "pending"]);
  assert.deepEqual(view.created, [{ model: "DeviceModel", id: MODEL, label: "Dock", kindLabel: "модель", to: `/inventory/device-models/${MODEL}` }]);
});

test("toView: прерванное — stuck true, statusLabel «Не применено»", () => {
  const stuck = change({
    status: "failed",
    stuck: true,
    decision: { user: ME, decision: "approve", channel: "telegram", at: new Date("2026-10-20T09:51:00Z") },
    timeline: [{ at: new Date("2026-10-20T10:05:00Z"), kind: "result", text: "Применение прервано — результат неизвестен" }],
  });
  const view = toView(stuck, viewer(), NOW);
  assert.equal(view.stuck, true);
  assert.equal(view.statusLabel, "Не применено");
  assert.equal(view.closedAt.toISOString(), "2026-10-20T10:05:00.000Z");

  // Флаг без failed — не прерванное
  assert.equal(toView(change({ stuck: true }), viewer(), NOW).stuck, false);
  assert.equal(toView(change({ status: "failed" }), viewer(), NOW).stuck, false);
});

test("toView: отклонённое — closedAt по решению, комментарий", () => {
  const rejected = change({
    status: "rejected",
    decision: { user: ME, decision: "reject", channel: "portal", comment: "Купим в ноябре", at: new Date("2026-10-20T09:44:00Z") },
    timeline: [{ at: new Date("2026-10-20T09:44:30Z"), kind: "decision", text: "Отклонено: Алексей Савин, на портале" }],
  });
  const view = toView(rejected, viewer(), NOW);
  assert.equal(view.closedAt.toISOString(), "2026-10-20T09:44:00.000Z");
  assert.equal(view.decision.comment, "Купим в ноябре");
  assert.equal(view.statusLabel, "Отклонено");
});

// Пакет макета: каталог (тип и атрибут), модель, конфигурация, два устройства, выдача нового, снятие, установка, статус
const devLink = (id, label) => ({ model: "ClientDevice", id, label });
const target = (id) => ({ model: "ClientDevice", id, updatedAt: new Date("2026-10-01T00:00:00Z") });
const op = (kind, page, targets = [], params = {}) => ({ kind, params, text: page.head, page: { subs: [], fields: [], links: [], deferred: false, ...page }, targets });
const samplePackage = () => [
  op("catalog", { head: "Справочники техники", subs: ["Новый тип «Док-станция» (комплектующая: нет)", "Новый атрибут «Порты USB-C» (число) у типа «Док-станция»"] }),
  op("createModel", { head: "Новая модель «ThinkPad USB-C Dock Gen 2»" }),
  op("createConfiguration", { head: "Новая конфигурация «16/512» для ThinkPad T14 Gen 5" }),
  op("createDevice", { head: "Новое устройство ThinkPad T14 Gen 5" }),
  op("createDevice", { head: "Новое устройство ThinkPad USB-C Dock Gen 2" }),
  op("assignDevice", { head: "Выдать устройство PF4XK2L9 (будет создано выше): Иван Петров" }),
  op("detachComponent", { head: "Снять SSD SSD-000012 с ПК PC-000123", links: [devLink(SSD12, "SSD SSD-000012"), devLink(PC, "ПК PC-000123")] }, [target(SSD12), target(PC)]),
  op("attachComponent", { head: "Установить SSD SSD-000031 в ПК PC-000123", deferred: true, links: [devLink(SSD31, "SSD SSD-000031"), devLink(PC, "ПК PC-000123")] }, [target(SSD31), target(PC)]),
  op("setDeviceStatus", { head: "Сменить статус SSD SSD-000012 на «В ремонте»", deferred: true, links: [devLink(SSD12, "SSD SSD-000012")] }, [target(SSD12)]),
];

test("summary: создать и изменить", () => {
  const view = toView(change({ operations: samplePackage() }), viewer(), NOW);
  assert.deepEqual(view.summary, {
    create: { type: 1, attribute: 1, group: 0, vendor: 0, supplier: 0, model: 1, configuration: 1, build: 0, device: 2 },
    // Три разных существующих устройства — без имён
    change: { count: 3 },
  });

  // Изменяется одно устройство — с именем; деталь своей сборки — тоже новое устройство
  const small = change({
    operations: [
      op("createDevice", { head: "Новое устройство ПК своей сборки", subs: ["деталь «SSD»", "деталь «ОЗУ»"] }, [], { parts: [{}, {}] }),
      op("catalog", { head: "Справочники техники", subs: ["Новая группа «Порты»", "Тип «Ноутбук» уже есть — используется"] }),
      op("moveDevice", { head: "Перенести ПК PC-000123 в «Склад»", links: [devLink(PC, "ПК PC-000123")] }, [target(PC)]),
      op("assignDevice", { head: "Выдать ПК PC-000123: Иван Петров", links: [devLink(PC, "ПК PC-000123")] }, [target(PC)]),
    ],
  });
  assert.deepEqual(toView(small, viewer(), NOW).summary, {
    create: { type: 0, attribute: 0, group: 1, vendor: 0, supplier: 0, model: 0, configuration: 0, build: 0, device: 3 },
    change: { count: 1, names: ["ПК PC-000123"] },
  });

  // Старое предложение без page: подписи взять неоткуда — только число
  const legacy = change({ operations: [{ kind: "moveDevice", text: "Перенести ПК PC-000123", targets: [target(PC)] }] });
  assert.deepEqual(toView(legacy, viewer(), NOW).summary.change, { count: 1 });
});
