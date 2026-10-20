// node --test controllers/inventory/inventoryChange.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createController } = require("./inventoryChange");
const { MESSAGES } = require("@/services/inventory/changeDecisions");

const NOW = new Date("2026-10-20T10:00:00Z");
const ID = "64f100000000000000000001";
const REQ = "64f1000000000000000000a1";
const OTHER = "64f1000000000000000000a2";
const DEVICE = "64f1000000000000000000d1";
const clone = (v) => structuredClone(v);

const baseDoc = (extra = {}) => ({
  _id: ID,
  number: 7,
  title: "Ноутбук новому сотруднику",
  reason: "Запрос в Telegram",
  status: "awaiting_requester",
  createdAt: new Date("2026-10-20T09:00:00Z"),
  expiresAt: new Date("2026-10-23T09:00:00Z"),
  requestedBy: { _id: REQ, firstName: "Иван", lastName: "Петров" },
  requestedVia: { keyName: "OpenClaw" },
  operations: [{ kind: "createDevice", text: "Новое устройство ThinkPad", result: { state: "pending" } }],
  timeline: [],
  ...extra,
});

// Документ один на всё: решения пишут в него, репозиторий читает из него
function harness({ doc = baseDoc(), decide, awaiting } = {}) {
  const state = { doc: clone(doc), calls: [], resolved: [] };
  const decisions = {
    async decide(args) {
      state.calls.push(args);
      if (decide) return decide(args, state);
      state.doc.status = args.decision === "approve" ? "done" : "rejected";
      state.doc.decision = { user: args.userId, decision: args.decision, channel: args.channel, comment: args.comment, at: NOW };
      if (args.decision === "approve") state.doc.operations[0].result = { state: "done", created: { device: DEVICE } };
      return { ok: true, change: clone(state.doc) };
    },
  };
  const repo = {
    async findById(id) { return id === state.doc._id ? clone(state.doc) : null; },
    async listAwaiting() { return (awaiting || [state.doc]).map(clone); },
    async resolveCreated(refs) {
      state.resolved.push(refs);
      return new Map(refs.map((r) => [`${r.model}:${r.id}`, { label: "NB-000214", to: `/inventory/client-devices/${r.id}` }]));
    },
  };
  const controller = createController({ decisions, repo, now: () => NOW, log: { log() {} } });
  return { controller, state };
}

function call(handler, { userId, can = [], params = {}, body = {} } = {}) {
  const req = {
    userId, params, body,
    auth: { can: (q) => Object.entries(q).every(([r, acts]) => acts.every((a) => can.includes(`${r}.${a}`))) },
  };
  const out = { headers: {} };
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; return this; },
  };
  return Promise.resolve(handler(req, res, (e) => { out.error = e; })).then(() => out);
}

// ---------------------------------------------------------------- просмотр

test("getOne: автору — вид с кнопками; сотруднику с правом — без кнопок", async () => {
  const { controller } = harness();
  const mine = await call(controller.getOne, { userId: REQ, params: { id: ID } });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.title, "Ноутбук новому сотруднику");
  assert.equal(mine.body.my.canDecide, true);

  const staff = await call(controller.getOne, { userId: OTHER, can: ["device.manage"], params: { id: ID } });
  assert.equal(staff.status, 200);
  assert.equal(staff.body.my.canDecide, false);

  const catalog = await call(controller.getOne, { userId: OTHER, can: ["inventoryCatalog.manage"], params: { id: ID } });
  assert.equal(catalog.status, 200);
});

test("getOne: чужому без прав, пропавшему и битому id — одинаковый 404", async () => {
  const { controller } = harness();
  for (const [userId, can, id] of [
    [OTHER, ["device.read", "inventoryCatalog.read"], ID],
    [REQ, [], "64f1000000000000000000ff"],
    [REQ, [], "not-an-id"],
  ]) {
    const out = await call(controller.getOne, { userId, can, params: { id } });
    assert.equal(out.error?.statusCode, 404, id);
    assert.equal(out.error.message, "Предложение не найдено");
    assert.equal(out.body, undefined);
  }
});

// ---------------------------------------------------------------- решение

test("decision: незнакомцу 404, решение не зовётся", async () => {
  const { controller, state } = harness();
  const out = await call(controller.decide, { userId: OTHER, can: ["device.read"], params: { id: ID }, body: { decision: "approve" } });
  assert.equal(out.error.statusCode, 404);
  assert.equal(out.error.message, MESSAGES.not_found);
  assert.equal(state.calls.length, 0);
});

test("decision: некорректное решение и комментарий длиннее 300 знаков — 400", async () => {
  const { controller, state } = harness();
  for (const body of [{}, { decision: "maybe" }, { decision: "approve", comment: 5 }, { decision: "reject", comment: "я".repeat(301) }]) {
    const out = await call(controller.decide, { userId: REQ, params: { id: ID }, body });
    assert.equal(out.error?.statusCode, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(out.error.message, "Некорректное решение");
  }
  assert.equal(state.calls.length, 0);
  // Ровно 300 после схлопывания пробелов — можно
  const ok = await call(controller.decide, { userId: REQ, params: { id: ID }, body: { decision: "reject", comment: `${"я".repeat(150)}  \n ${"я".repeat(149)}` } });
  assert.equal(ok.status, 200);
  assert.equal(state.calls[0].comment.length, 300);
});

test("decision: отказ сервиса — 409 / 410 / 403 / 404 с его текстом", async () => {
  for (const [code, status] of [["closed", 409], ["expired", 410], ["not_yours", 403], ["no_right", 403], ["not_found", 404]]) {
    const message = code === "no_right" ? `${MESSAGES.no_right}: учёт техники` : MESSAGES[code];
    const { controller } = harness({ decide: () => ({ ok: false, code, message }) });
    const out = await call(controller.decide, { userId: REQ, params: { id: ID }, body: { decision: "approve" } });
    assert.equal(out.error?.statusCode, status, code);
    assert.equal(out.error.message, message);
  }
});

test("decision: утверждение идёт с channel «portal»; ответ — вид, перечитанный после применения", async () => {
  const { controller, state } = harness();
  const out = await call(controller.decide, { userId: REQ, params: { id: ID }, body: { decision: "approve", comment: " ок\nспасибо " } });
  assert.equal(out.error, undefined);
  assert.equal(out.status, 200);
  assert.deepEqual(state.calls, [{ changeId: ID, userId: REQ, decision: "approve", channel: "portal", comment: "ок спасибо" }]);
  assert.equal(out.body.status, "done");
  assert.equal(out.body.my.canDecide, false);
  assert.deepEqual(out.body.operations[0].result.created, [
    { model: "ClientDevice", id: DEVICE, label: "NB-000214", to: `/inventory/client-devices/${DEVICE}` },
  ]);
  assert.deepEqual(state.resolved.at(-1), [{ model: "ClientDevice", id: DEVICE }]);
});

test("decision: право из тела запроса не читается — userId только из сессии", async () => {
  const { controller, state } = harness();
  await call(controller.decide, { userId: REQ, params: { id: ID }, body: { decision: "reject", userId: OTHER, channel: "telegram" } });
  assert.equal(state.calls[0].userId, REQ);
  assert.equal(state.calls[0].channel, "portal");
});

// ---------------------------------------------------------------- главная

test("awaitingMe: только свои, открытые и не истёкшие, полным видом", async () => {
  const own = baseDoc();
  const awaiting = [
    own,
    baseDoc({ _id: "64f100000000000000000002", requestedBy: { _id: OTHER, firstName: "О", lastName: "Ч" } }),
    baseDoc({ _id: "64f100000000000000000003", status: "done" }),
    baseDoc({ _id: "64f100000000000000000004", expiresAt: new Date("2026-10-20T09:59:59Z") }),
    baseDoc({ _id: "64f100000000000000000005", expiresAt: null }),
  ];
  const { controller } = harness({ awaiting });
  const out = await call(controller.awaitingMe, { userId: REQ });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.map((v) => v._id), [ID]);
  assert.equal(out.body[0].operations.length, 1);
  assert.equal(out.body[0].my.canDecide, true);
});
