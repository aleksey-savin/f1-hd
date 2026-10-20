// node --test controllers/inventory/inventoryChangeBot.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createBotHandlers, mountRoutes, gate } = require("./inventoryChangeBot");
const { createDecisions } = require("@/services/inventory/changeDecisions");
const { BIG_NOTE } = require("@/services/inventory/changeRender");

const ID = "64f100000000000000000001";
const NOW = new Date("2026-10-20T09:00:00Z");
const clone = (v) => structuredClone(v);
const op = (n) => ({ kind: "createVendor", text: `Новый производитель «V${n}»`, params: { name: `V${n}` } });
const baseDoc = (extra = {}) => ({
  _id: ID,
  title: "Новые производители",
  status: "awaiting_requester",
  expiresAt: new Date("2026-10-23T09:00:00Z"),
  requestedBy: "req",
  decision: { decision: null },
  operations: [op(1), op(2)],
  timeline: [],
  ...extra,
});

function harness(doc = baseDoc(), { canRight = true, applyError = false } = {}) {
  const state = { doc: clone(doc), calls: [], notified: [] };
  const store = {
    async load(id) { return id === state.doc._id ? clone(state.doc) : null; },
    async loadUser() { return { _id: "req", isEndUser: false }; },
    async applyPatch(id, status, patch) {
      const d = state.doc;
      if (applyError) throw new Error("db down");
      if (d.status !== status || d.decision?.decision) return null;
      Object.assign(d, { status: patch.status, decision: patch.decision });
      return clone(d);
    },
    async finish(id, status, { status: next, results }) {
      const d = state.doc;
      if (d.status !== status) return null;
      d.status = next;
      d.operations.forEach((o, i) => { o.result = results[i]; });
      return clone(d);
    },
  };
  const real = createDecisions({
    store,
    executor: { run: async (c) => ({ status: "done", results: c.operations.map(() => ({ state: "done" })) }) },
    ops: { requiredRights: () => [{ device: ["manage"] }] },
    notifier: { decided: async () => state.notified.push("decided"), result: async () => state.notified.push("result") },
    canFor: async () => () => canRight,
    now: () => NOW,
  });
  const decisions = { decide: async (args) => { state.calls.push(args); return real.decide(args); } };
  const handlers = createBotHandlers({
    load: async (id) => (id === state.doc._id ? clone(state.doc) : null),
    decisions,
    baseUrl: "https://hd.example.com",
    now: () => NOW,
  });
  return { state, handlers };
}

async function call(fn, { userId, params = { id: ID }, body = {} } = {}) {
  const req = { userId, params, body };
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await fn(req, res, (e) => { out.error = e; });
  return out;
}

test("message: заявитель получает текст, кнопки, подтверждение", async () => {
  const { handlers } = harness();
  const out = await call(handlers.message, { userId: "req" });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.match(out.body.text, /V1/);
  assert.equal(out.body.keyboard.inline_keyboard[0][0].callback_data, `ic:a:${ID}`);
  assert.match(out.body.confirmText, /Применить операции \(2\)/);
  assert.equal(out.body.confirmKeyboard.inline_keyboard[0][0].callback_data, `ic:y:${ID}`);
  assert.equal(out.body.shows, undefined);
});

test("message: не заявитель — not_yours; нет документа — not_found; закрыт — closed; истёк (по сроку и по статусу) — expired", async () => {
  const mk = (extra, userId = "req", params) => {
    const { handlers } = harness(baseDoc(extra));
    return call(handlers.message, { userId, params });
  };
  assert.equal((await mk({}, "other")).body.code, "not_yours");
  assert.equal((await mk({}, "req", { id: "nope" })).body.code, "not_found");
  assert.equal((await mk({ status: "done" })).body.code, "closed");
  assert.equal((await mk({ expiresAt: new Date("2026-10-20T08:00:00Z") })).body.code, "expired");
  // sweep уже поставил expired: не «Решение уже принято» — решения не было
  assert.equal((await mk({ status: "expired" })).body.code, "expired");
  const out = await mk({}, "other");
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, false);
  assert.ok(out.body.message);
});

test("gate: чужому состояние не сообщается даже у закрытого", () => {
  assert.equal(gate(baseDoc({ status: "done" }), "other", NOW), "not_yours");
});

test("decision approve: ok с текстом итога", async () => {
  const { handlers, state } = harness();
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.match(out.body.text, /Предложение применено/);
  assert.match(out.body.text, /✓ Новый производитель «V1»/);
  assert.equal(state.calls[0].channel, "telegram");
  assert.equal(state.calls[0].userId, "req");
});

test("decision reject: ok, текст «отклонено», допускается даже без показа", async () => {
  const many = Array.from({ length: 40 }, (_, i) => op(i));
  const { handlers } = harness(baseDoc({ operations: many }));
  const out = await call(handlers.decision, { userId: "req", body: { decision: "reject" } });
  assert.equal(out.body.ok, true);
  assert.match(out.body.text, /Предложение отклонено/);
});

test("decision approve, когда не помещается: too_long, решение не записано", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...op(i), text: `Новый производитель «${"Я".repeat(100)}${i}»` }));
  const { handlers, state } = harness(baseDoc({ operations: many }));
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(out.status, 200);
  assert.equal(out.body.code, "too_long");
  assert.match(out.body.message, /в портале/);
  assert.equal(state.calls.length, 0);
});

test("сообщение влезло, подтверждение нет: без кнопок решения и без подтверждения, approve — too_long (общий present)", async () => {
  // сообщение без причины и срока влезает, подтверждение (плюс две строки предупреждения) — нет
  const wide = Array.from({ length: 7 }, (_, i) => ({ ...op(i), text: `${i} ${"ж".repeat(470)}` }));
  const { handlers, state } = harness(baseDoc({ title: "t", operations: wide }));
  const shown = await call(handlers.message, { userId: "req" });
  assert.equal(shown.body.ok, true);
  assert.equal(shown.body.confirmText, null);
  assert.equal(shown.body.confirmKeyboard, null);
  assert.ok(!JSON.stringify(shown.body.keyboard).includes("ic:a:"));
  assert.ok(shown.body.text.endsWith(BIG_NOTE));
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(out.body.code, "too_long");
  assert.equal(out.body.message, BIG_NOTE);
  assert.equal(state.calls.length, 0);
});

test("decision: не заявитель — not_yours, сервис не вызван", async () => {
  const { handlers, state } = harness();
  const out = await call(handlers.decision, { userId: "other", body: { decision: "approve" } });
  assert.equal(out.body.code, "not_yours");
  assert.equal(state.calls.length, 0);
});

test("decision approve: потерял право — no_right из сервиса, HTTP 200", async () => {
  const { handlers, state } = harness(baseDoc(), { canRight: false });
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(out.status, 200);
  assert.equal(out.body.code, "no_right");
  assert.match(out.body.message, /^Нет права/);
  assert.equal(state.doc.status, "awaiting_requester");
});

test("decision: плохое тело — 400 через next; сбой хранилища — HTTP 500 {ok:false, code:failed}", async () => {
  const bad = await call(harness().handlers.decision, { userId: "req", body: { decision: "maybe" } });
  assert.equal(bad.error.statusCode ?? bad.error.status, 400);
  const { handlers } = harness(baseDoc(), { applyError: true });
  const out = await call(handlers.decision, { userId: "req", body: { decision: "reject" } });
  assert.equal(out.status, 500);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.code, "failed");
  assert.match(out.body.message, /попробуйте ещё раз/);
});

test("маршруты: актор, затем гейты (модуль, не клиент), затем ручка", async () => {
  const run = async ({ moduleOn, client }) => {
    const hits = [];
    const router = express.Router();
    const gates = [
      (req, res, next) => (moduleOn ? next() : res.status(403).json({ blocked: "module" })),
      (req, res, next) => (client ? res.status(403).json({ blocked: "client" }) : next()),
    ];
    mountRoutes(router, {
      limiter: (req, res, next) => next(),
      attachActor: (req, res, next) => { hits.push("actor"); req.userId = "req"; next(); },
      gates,
      handlers: { message: (req, res) => { hits.push("message"); res.json({}); }, decision: (req, res) => { hits.push("decision"); res.json({}); } },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/bot", router);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/bot/inventory-changes/${ID}`;
      const a = await fetch(`${base}/message`);
      const b = await fetch(`${base}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { hits, statuses: [a.status, b.status] };
    } finally { server.close(); }
  };
  assert.deepEqual(await run({ moduleOn: true, client: false }), { hits: ["actor", "message", "actor", "decision"], statuses: [200, 200] });
  assert.deepEqual((await run({ moduleOn: false, client: false })).hits.filter((h) => h !== "actor"), []);
  assert.deepEqual((await run({ moduleOn: true, client: true })).hits.filter((h) => h !== "actor"), []);
});
