// node --test controllers/inventory/mikrotikChangeBot.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createBotHandlers, mountRoutes } = require("./mikrotikChangeBot");
const { createDecisions } = require("@/services/mikrotik/changeDecisions");

const ID = "64f100000000000000000001";
const NOW = new Date("2026-10-10T09:00:00Z");
const clone = (v) => structuredClone(v);
const NAMES = { req: { firstName: "Иван", lastName: "Петров" }, resp: { firstName: "Анна", lastName: "Смирнова" } };
const cmd = (text) => ({ path: "/ip firewall address-list", action: "add", text, risk: "normal" });
const baseDoc = (extra = {}) => ({
  _id: ID,
  number: 7,
  title: "WireGuard",
  status: "awaiting_requester",
  risk: "normal",
  expiresAt: new Date("2026-10-11T09:00:00Z"),
  mikrotik: "m1",
  requestedBy: "req",
  steps: [
    { role: "requester", user: "req", decision: null },
    { role: "responsible", user: "resp", decision: null },
  ],
  commands: [cmd("/ip firewall address-list add list=x address=10.0.0.1"), cmd("/ip firewall address-list add list=x address=10.0.0.2")],
  timeline: [],
  ...extra,
});

function harness(doc = baseDoc()) {
  const state = { doc: clone(doc), decideCalls: [], notified: [] };
  const store = {
    async load(id) { return id === state.doc._id ? clone(state.doc) : null; },
    async userName(id) { const u = NAMES[id]; return u ? `${u.firstName} ${u.lastName}` : ""; },
    async applyPatch(id, status, index, patch) {
      const d = state.doc;
      if (d.status !== status || d.steps[index].decision) return null;
      d.status = patch.status;
      d.steps[index].decision = patch.step.decision;
      return clone(d);
    },
  };
  const real = createDecisions({ store, notifier: { step: async (c) => state.notified.push(["step", c.status]), decided: async () => state.notified.push(["decided"]) }, now: () => NOW });
  const decisions = { decide: async (args) => { state.decideCalls.push(args); return real.decide(args); } };
  const handlers = createBotHandlers({
    load: async (id) => (id === state.doc._id ? clone(state.doc) : null),
    loadContext: async () => ({ deviceName: "GW01", companyName: "F1Lab", requesterName: "Иван Петров", timezone: "Europe/Moscow", now: NOW, users: new Map(Object.entries(NAMES)) }),
    decisions,
    baseUrl: "https://hd.example.com",
    now: () => NOW,
  });
  return { state, handlers };
}

// Заглушки req/res
async function call(fn, { userId, can = [], params = { id: ID }, body = {} } = {}) {
  const req = { userId, params, body, auth: { can: (q) => (q.mikrotik || []).every((a) => can.includes(`mikrotik.${a}`)) } };
  const out = {};
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await fn(req, res, (e) => { out.error = e; });
  return out;
}

test("message: актор — пользователь текущего шага: текст, кнопки, подтверждение со всеми командами", async () => {
  const { handlers } = harness();
  const out = await call(handlers.message, { userId: "req" });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.match(out.body.text, /Запрос на изменение конфигурации/);
  assert.equal(out.body.keyboard.inline_keyboard[0][0].callback_data, `mc:a:${ID}`);
  assert.match(out.body.confirmText, /Применить 2 команды/);
  assert.ok(out.body.confirmFull.startsWith(out.body.confirmText));
  assert.match(out.body.confirmFull, /1\. .*10\.0\.0\.1/);
  assert.match(out.body.confirmFull, /2\. .*10\.0\.0\.2/);
  assert.equal(out.body.confirmKeyboard.inline_keyboard[0][0].callback_data, `mc:y:${ID}`);
});

test("message: чужой шаг, закрытый, истёкший, чужой id — отказ с русским текстом", async () => {
  const { handlers } = harness();
  const other = await call(handlers.message, { userId: "resp" }); // шаг ответственного ещё не наступил
  assert.deepEqual([other.body.ok, other.body.code, other.body.message], [false, "not_yours", "Это решение не за вами"]);
  const bad = await call(handlers.message, { userId: "req", params: { id: "zzz" } });
  assert.equal(bad.body.ok, false);
  const rejected = harness(baseDoc({ status: "rejected" }));
  const closed = await call(rejected.handlers.message, { userId: "req" });
  assert.equal(closed.body.message, "Запрос уже решён");
  const expired = await call(harness(baseDoc({ expiresAt: new Date("2026-10-10T08:00:00Z") })).handlers.message, { userId: "req" });
  assert.deepEqual([expired.body.code, expired.body.message], ["expired", "Запрос истёк"]);
});

test("message: команды не помещаются — нет кнопок решения и шага подтверждения", async () => {
  const long = Array.from({ length: 30 }, (_, i) => cmd(`/ip firewall address-list add list=x address=10.0.0.${i} comment=${"я".repeat(150)}`));
  const { handlers } = harness(baseDoc({ commands: long }));
  const out = await call(handlers.message, { userId: "req" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.confirmText, null);
  assert.equal(out.body.confirmFull, null);
  assert.equal(out.body.confirmKeyboard, null);
  const buttons = (out.body.keyboard?.inline_keyboard || []).flat().map((b) => b.callback_data).filter(Boolean);
  assert.deepEqual(buttons, []);
});

test("decision: подтверждение на первом шаге — следующий решает ответственный", async () => {
  const { handlers, state } = harness();
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.deepEqual(out.body, { ok: true, text: "Вы подтвердили запрос. Дальше решает Анна Смирнова." });
  assert.equal(state.decideCalls.length, 1);
  assert.equal(state.decideCalls[0].channel, "telegram");
  assert.equal(state.doc.status, "awaiting_responsible");
});

test("decision: утверждение на последнем шаге и отклонение", async () => {
  const doc = baseDoc({ status: "awaiting_responsible", steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: null }] });
  const last = await call(harness(doc).handlers.decision, { userId: "resp", can: ["mikrotik.approveChanges"], body: { decision: "approve" } });
  assert.equal(last.body.text, "Вы утвердили запрос. HD снимет резервную копию и применит команды. Итог придёт отдельным сообщением.");
  const rej = await call(harness().handlers.decision, { userId: "req", body: { decision: "reject" } });
  assert.deepEqual(rej.body, { ok: true, text: "Вы отклонили запрос." });
});

test("decision: чужой актор — отказ, сервис решений не вызван", async () => {
  const { handlers, state } = harness();
  const out = await call(handlers.decision, { userId: "resp", can: ["mikrotik.approveChanges"], body: { decision: "approve" } });
  assert.deepEqual([out.body.ok, out.body.code, out.body.message], [false, "not_yours", "Это решение не за вами"]);
  assert.equal(state.decideCalls.length, 0);
  assert.equal(state.doc.status, "awaiting_requester");
});

test("decision: второе нажатие — «Запрос уже решён»", async () => {
  const { handlers, state } = harness();
  await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  const again = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.deepEqual([again.body.ok, again.body.code], [false, "already_yours"]);
  assert.equal(again.body.message, "Вы уже подтвердили запрос. Дальше решает Анна Смирнова.");
  const one = harness(baseDoc({ steps: [{ role: "requester", user: "req", decision: null }] }));
  await call(one.handlers.decision, { userId: "req", can: ["mikrotik.approveChanges"], body: { decision: "approve" } });
  const second = await call(one.handlers.decision, { userId: "req", can: ["mikrotik.approveChanges"], body: { decision: "approve" } });
  assert.deepEqual([second.body.code, second.body.message], ["already_yours", "Вы уже утвердили запрос. Запрос применяется."]);
  assert.equal(state.decideCalls.length, 1);
});

test("decision: гонка — второй вызов, прошедший проверку, получает closed из атомарной записи", async () => {
  const one = harness(baseDoc({ steps: [{ role: "requester", user: "req", decision: null }] }));
  const args = { userId: "req", can: ["mikrotik.approveChanges"], body: { decision: "approve" } };
  const [a, b] = await Promise.all([call(one.handlers.decision, args), call(one.handlers.decision, args)]);
  assert.deepEqual([a.body.ok, b.body.ok].sort(), [false, true]);
  assert.equal([a, b].find((x) => !x.body.ok).body.code, "closed"); // обе проверки прошли до записи
});

test("decision: право берётся только из сессии, не из тела", async () => {
  const one = harness(baseDoc({ steps: [{ role: "requester", user: "req", decision: null }] }));
  const out = await call(one.handlers.decision, { userId: "req", can: [], body: { decision: "approve", canApprove: true } });
  assert.deepEqual([out.body.ok, out.body.code], [false, "no_right"]);
  assert.equal(one.state.decideCalls[0].canApprove, false);
});

test("decision: утверждение того, что не помещается в сообщение, отказано на бэкенде", async () => {
  const long = Array.from({ length: 30 }, (_, i) => cmd(`/ip firewall address-list add list=x address=10.0.0.${i} comment=${"я".repeat(150)}`));
  const { handlers, state } = harness(baseDoc({ commands: long }));
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.message, "Команды не помещаются в сообщение — утвердите запрос в HD");
  assert.equal(state.decideCalls.length, 0);
  // отклонить можно в любом случае
  const rej = await call(handlers.decision, { userId: "req", body: { decision: "reject" } });
  assert.equal(rej.body.ok, true);
});

test("decision: неизвестное решение — 400", async () => {
  const out = await call(harness().handlers.decision, { userId: "req", body: { decision: "maybe" } });
  assert.equal(out.error.statusCode ?? out.error.status, 400);
});

test("маршруты: актор, затем гейты (модуль, не клиент), затем ручка; выключенный модуль и клиент не доходят до ручки", async () => {
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
      const base = `http://127.0.0.1:${server.address().port}/api/bot/mikrotik-changes/${ID}`;
      const a = await fetch(`${base}/message`);
      const b = await fetch(`${base}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { hits, statuses: [a.status, b.status] };
    } finally { server.close(); }
  };
  assert.deepEqual(await run({ moduleOn: true, client: false }), { hits: ["actor", "message", "actor", "decision"], statuses: [200, 200] });
  assert.deepEqual((await run({ moduleOn: false, client: false })).hits.filter((h) => h !== "actor"), []);
  assert.deepEqual((await run({ moduleOn: true, client: true })).hits.filter((h) => h !== "actor"), []);
});

test("message и решение: тексты для бота без HTML-экранирования (бот правит без parse_mode)", async () => {
  const doc = baseDoc({ title: "A <b>x</b> & y", commands: [cmd("/ip firewall address-list add comment=<i>&</i>")] });
  const { handlers } = harness(doc);
  const out = await call(handlers.message, { userId: "req" });
  for (const t of [out.body.text, out.body.confirmFull]) {
    assert.match(t, /<i>&<\/i>/);
    assert.ok(!/&amp;|&lt;|&gt;/.test(t));
  }
  assert.match(out.body.confirmText, /A <b>x<\/b> & y/);
});

test("already_yours: свой исход и текущее состояние", async () => {
  const two = (extra) => baseDoc({ steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: null }], status: "awaiting_responsible", ...extra });
  const wait = await call(harness(two()).handlers.message, { userId: "req" });
  assert.deepEqual([wait.body.code, wait.body.message], ["already_yours", "Вы уже подтвердили запрос. Дальше решает Анна Смирнова."]);
  const done = (status) => harness(two({ status, steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: "approve" }] }));
  assert.equal((await call(done("applied").handlers.message, { userId: "resp" })).body.message, "Вы уже утвердили запрос. Запрос применён.");
  assert.equal((await call(done("applying").handlers.message, { userId: "req" })).body.message, "Вы уже подтвердили запрос. Запрос применяется.");
  assert.equal((await call(done("needs_attention").handlers.message, { userId: "req" })).body.message, "Вы уже подтвердили запрос. Требует проверки.");
  const rej = harness(two({ status: "rejected", steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: "reject" }] }));
  assert.equal((await call(rej.handlers.decision, { userId: "resp", body: { decision: "approve" } })).body.message, "Вы уже отклонили запрос. Запрос отклонён.");
});

test("already_yours: повтор после записи решения (ответ потерян) не вызывает decide", async () => {
  const { handlers, state } = harness();
  await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  const retry = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.equal(retry.body.code, "already_yours");
  assert.equal(state.decideCalls.length, 1);
});

test("лимитер по актору: ключ — Telegram-id из заголовка, 429 с русским message", async () => {
  const { actorKey, createActorLimiter } = require("./mikrotikChangeBot");
  assert.equal(actorKey({ get: (h) => (h === "x-tg-actor" ? "42" : undefined) }), "tg-actor:42");
  assert.notEqual(actorKey({ get: () => "1" }), actorKey({ get: () => "2" }));
  const limiter = createActorLimiter({ max: 1 });
  const app = express();
  app.use((req, res, next) => next());
  app.get("/x", limiter, (req, res) => res.json({}));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/x`;
    const h = { "x-tg-actor": "7" };
    assert.equal((await fetch(url, { headers: h })).status, 200);
    const limited = await fetch(url, { headers: h });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { message: "Слишком много нажатий. Подождите минуту." });
    assert.equal((await fetch(url, { headers: { "x-tg-actor": "8" } })).status, 200); // другой человек не задет
  } finally { server.close(); }
});

// --- финальная волна: A1

const { displayCommand } = require("@/services/mikrotik/changeRender");

test("A1: команда с важным за 600-м знаком — из Telegram ни кнопок, ни утверждения", async () => {
  const command = {
    path: "/interface wireguard peers",
    action: "add",
    params: { comment: "к".repeat(490), interface: "wireguard1", "public-key": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg=", "allowed-address": "0.0.0.0/0" },
  };
  const doc = baseDoc({ commands: [{ ...command, text: displayCommand(command), risk: "normal" }] });
  const { handlers, state } = harness(doc);
  const shown = await call(handlers.message, { userId: "req" });
  assert.equal(shown.body.ok, true);
  assert.equal(shown.body.confirmFull, null);
  assert.equal(shown.body.confirmKeyboard, null);
  assert.deepEqual((shown.body.keyboard?.inline_keyboard || []).flat().map((b) => b.callback_data).filter(Boolean), []);
  const out = await call(handlers.decision, { userId: "req", body: { decision: "approve" } });
  assert.deepEqual([out.body.ok, out.body.code], [false, "too_long"]);
  assert.equal(state.decideCalls.length, 0);
});

test("посторонний сотрудник (не участник запроса) всегда получает «не за вами» — закрыт запрос или истёк, бот не выдаёт", async () => {
  for (const doc of [baseDoc({ status: "rejected" }), baseDoc({ status: "applied" }), baseDoc({ expiresAt: new Date("2026-10-10T08:00:00Z") }), baseDoc()]) {
    const h = harness(doc);
    const seen = await call(h.handlers.message, { userId: "other" });
    assert.equal(seen.body.code, "not_yours");
    const tapped = await call(h.handlers.decision, { userId: "other", body: { decision: "approve" } });
    assert.equal(tapped.body.code, "not_yours");
  }
  // запрос без срока считается истёкшим — как в сервисе решений
  const noExpiry = await call(harness(baseDoc({ expiresAt: undefined })).handlers.message, { userId: "req" });
  assert.equal(noExpiry.body.code, "expired");
});
