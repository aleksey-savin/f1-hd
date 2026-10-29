// node --test services/inventory/changeProposals.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createProposals } = require("./changeProposals");
const { TTL_MS } = require("./changeSteps");

const NOW = new Date("2026-10-20T10:00:00Z");
const REQ = { _id: "u-req", name: "Иван" };
const CALLER = { keyId: "k1", keyName: "agent" };
const KINDS = {
  moveDevice: { right: { device: ["manage"] } },
  createVendor: { right: { inventoryCatalog: ["manage"] } },
};
const goodOps = [{ kind: "createVendor", params: { name: "Acme" } }];

function setup(over = {}) {
  const created = [];
  const store = {
    findUserByTelegram: async () => REQ,
    canFor: async () => true,
    countOpen: async () => 0,
    countByKeySince: async () => 0,
    nextNumber: async () => 7,
    create: async (doc) => (created.push(doc), { ...doc, _id: "c1" }),
    ...over.store,
  };
  const ops = {
    KINDS,
    checkPackage: async (operations) => ({
      ok: true,
      reasons: [],
      items: operations.map((o) => ({ kind: o.kind, ref: o.ref || null, params: o.params, text: `T ${o.kind}`, targets: [{ model: "Device", id: "d", updatedAt: NOW }] })),
    }),
    ...over.ops,
  };
  return { proposals: createProposals({ store, ops, now: () => NOW }), created };
}
const base = (extra = {}) => ({ requester: "123", title: "Заголовок", reason: "Причина", operations: goodOps, ...extra });

test("unknown requester", async () => {
  const { proposals } = setup({ store: { findUserByTelegram: async () => null } });
  const r = await proposals.propose(base(), CALLER);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0].text, /no employee/);
});

test("missing right names the operation and kind", async () => {
  const { proposals } = setup({ store: { canFor: async (u, s) => !s.device } });
  const r = await proposals.propose(base({ operations: [goodOps[0], { kind: "moveDevice", params: {} }, { kind: "moveDevice", params: {} }] }), CALLER);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons.map((x) => x.text), [
    "Операция 2 (перенос устройства): нет права «Изменять технику и расположения»",
    "Операция 3 (перенос устройства): нет права «Изменять технику и расположения»",
  ]);
});

test("array right: one reason per missing statement", async () => {
  const asked = [];
  const { proposals } = setup({
    store: { canFor: async (u, s) => (asked.push(s), !s.device) },
    ops: { KINDS: { ...KINDS, mergeX: { right: [{ inventoryCatalog: ["manage"] }, { device: ["manage"] }] } } },
  });
  const r = await proposals.propose(base({ operations: [{ kind: "mergeX", params: {} }] }), CALLER);
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons.map((x) => x.text), ["Операция 1 (mergeX): нет права «Изменять технику и расположения»"]);
  assert.equal(asked.length, 2);
});

test("rights and package reasons come together", async () => {
  const { proposals } = setup({
    store: { canFor: async () => false },
    ops: { checkPackage: async () => ({ ok: false, reasons: ["Операция 1: плохо"], items: [] }) },
  });
  const r = await proposals.propose(base(), CALLER);
  assert.equal(r.reasons.length, 2);
  assert.equal(r.reasons[1].text, "Операция 1: плохо");
});

test("6th open proposal is refused", async () => {
  const { proposals, created } = setup({ store: { countOpen: async () => 5 } });
  const r = await proposals.propose(base(), CALLER);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0].text, /open proposals/);
  assert.equal(created.length, 0);
});

test("per-key daily limit", async () => {
  const { proposals } = setup({ store: { countByKeySince: async () => 40 } });
  const r = await proposals.propose(base(), CALLER);
  assert.match(r.reasons[0].text, /24 hours/);
});

test("41 operations are refused", async () => {
  const { proposals } = setup();
  const r = await proposals.propose(base({ operations: Array.from({ length: 41 }, () => goodOps[0]) }), CALLER);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0].text, /too many operations/);
});

test("title and reason are checked", async () => {
  const { proposals } = setup();
  const r = await proposals.propose(base({ title: "x".repeat(201), reason: "" }), CALLER);
  assert.equal(r.reasons.length, 2);
});

test("concurrent proposals from one key are serialized", async () => {
  let stored = 0;
  const { proposals } = setup({
    store: {
      countOpen: async () => stored,
      create: async (doc) => {
        await new Promise((res) => setTimeout(res, 10));
        stored += 1;
        return { ...doc, _id: `c${stored}` };
      },
    },
  });
  const rs = await Promise.all(Array.from({ length: 7 }, () => proposals.propose(base(), CALLER)));
  assert.equal(rs.filter((r) => r.ok).length, 5);
  assert.equal(rs.filter((r) => !r.ok).length, 2);
});

test("happy path stores texts, targets and lifecycle", async () => {
  const { proposals, created } = setup();
  const r = await proposals.propose(base({ operations: [{ kind: "createVendor", ref: "v1", params: { name: "Acme" } }] }), CALLER);
  assert.equal(r.ok, true);
  const doc = created[0];
  assert.equal(doc.number, 7);
  assert.equal(doc.status, "awaiting_requester");
  assert.equal(doc.expiresAt.getTime(), NOW.getTime() + TTL_MS);
  assert.deepEqual(doc.requestedVia, { keyId: "k1", keyName: "agent" });
  assert.equal(doc.operations[0].text, "T createVendor");
  assert.equal(doc.operations[0].ref, "v1");
  assert.equal(doc.operations[0].targets.length, 1);
  assert.equal(doc.timeline[0].kind, "proposed");
  assert.equal(doc.timeline[0].text, "Предложено ИИ-агентом");
});

test("каскад со ссылками на новые детали: componentIds и componentRefs сохраняются", async () => {
  const { proposals, created } = setup({
    ops: {
      checkPackage: async () => ({
        ok: true,
        reasons: [],
        items: [
          { kind: "moveDevice", ref: null, params: {}, text: "T", targets: [], componentIds: ["p1"], componentRefs: ["ram"] },
          { kind: "moveDevice", ref: null, params: {}, text: "T", targets: [] },
        ],
      }),
    },
  });
  const r = await proposals.propose(base({ operations: [{ kind: "moveDevice", params: {} }, { kind: "moveDevice", params: {} }] }), CALLER);
  assert.equal(r.ok, true);
  const [first, second] = created[0].operations;
  assert.deepEqual(first.componentIds, ["p1"]);
  assert.deepEqual(first.componentRefs, ["ram"]);
  assert.equal(second.componentRefs, undefined);
});

test("предложение сохраняет page каждой операции", async () => {
  const page = {
    head: "Перенести ПК PC-000123 в «Кабинет 214»",
    subs: [],
    fields: [],
    links: [{ model: "ClientDevice", id: "d1", label: "ПК PC-000123" }],
    deferred: false,
  };
  const { proposals, created } = setup({
    ops: {
      checkPackage: async () => ({
        ok: true,
        reasons: [],
        items: [
          { kind: "moveDevice", ref: null, params: {}, text: "Перенести ПК PC-000123 в «Кабинет 214»", targets: [], page },
          { kind: "moveDevice", ref: null, params: {}, text: "T", targets: [] },
        ],
      }),
    },
  });
  const r = await proposals.propose(base({ operations: [{ kind: "moveDevice", params: {} }, { kind: "moveDevice", params: {} }] }), CALLER);
  assert.equal(r.ok, true);
  const [first, second] = created[0].operations;
  assert.deepEqual(first.page, page);
  assert.equal(first.text, "Перенести ПК PC-000123 в «Кабинет 214»");
  // Операция без page (вид её не построил) — без ключа: страница возьмёт text
  assert.equal(Object.hasOwn(second, "page"), false);
});

test("снимок refs операции сохраняется как есть; без него — нет поля", async () => {
  const refs = [{ model: "DeviceConfiguration", path: "values.value", ids: ["c1"], live: 1, deleted: 0, deletedIds: [] }];
  const { proposals, created } = setup({
    ops: {
      checkPackage: async () => ({
        ok: true,
        reasons: [],
        items: [
          { kind: "createVendor", ref: null, params: {}, text: "T", targets: [], refs },
          { kind: "createVendor", ref: null, params: {}, text: "T", targets: [] },
        ],
      }),
    },
  });
  const r = await proposals.propose(base({ operations: [goodOps[0], goodOps[0]] }), CALLER);
  assert.equal(r.ok, true);
  const [first, second] = created[0].operations;
  assert.deepEqual(first.refs, refs);
  assert.equal(Object.hasOwn(second, "refs"), false);
});

test("правки каталога: в отказе по праву — русское название вида", async () => {
  const kinds = [
    "updateVendor",
    "updateSupplier",
    "updateModel",
    "updateDeviceType",
    "updateGroup",
    "updateAttribute",
    "updateTypeAttribute",
    "unlinkAttribute",
    "updateConfiguration",
    "updateBuild",
  ];
  const { proposals } = setup({
    ops: { KINDS: Object.fromEntries(kinds.map((kind) => [kind, { right: { inventoryCatalog: ["manage"] } }])) },
    store: { canFor: async () => false },
  });
  const r = await proposals.propose(base({ operations: kinds.map((kind) => ({ kind, params: {} })) }), CALLER);
  assert.deepEqual(
    r.reasons.map((x) => x.text.match(/\((.*)\)/)[1]),
    [
      "изменение вендора",
      "изменение поставщика",
      "изменение модели",
      "изменение типа",
      "изменение группы",
      "изменение атрибута",
      "изменение атрибута у типа",
      "снятие атрибута с типа",
      "изменение конфигурации",
      "изменение шаблона сборки",
    ],
  );
});

test("слияния: в отказе по праву — русское название вида", async () => {
  const kinds = ["mergeVendors", "mergeSuppliers", "mergeGroups", "mergeModels", "mergeAttributes", "mergeConfigurations", "mergeDeviceTypes", "retireVendor", "retireSupplier", "retireModel", "retireAttribute", "retireDeviceType", "deleteGroup"];
  const { proposals } = setup({
    ops: { KINDS: Object.fromEntries(kinds.map((kind) => [kind, { right: { inventoryCatalog: ["manage"] } }])) },
    store: { canFor: async () => false },
  });
  const r = await proposals.propose(base({ operations: kinds.map((kind) => ({ kind, params: {} })) }), CALLER);
  assert.deepEqual(
    r.reasons.map((x) => x.text.match(/\((.*)\)/)[1]),
    [
      "слияние вендоров",
      "слияние поставщиков",
      "слияние групп",
      "слияние моделей",
      "слияние атрибутов",
      "слияние конфигураций",
      "слияние типов",
      "скрытие вендора",
      "скрытие поставщика",
      "скрытие модели",
      "скрытие атрибута",
      "скрытие типа",
      "удаление группы",
    ],
  );
});
