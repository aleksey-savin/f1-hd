// node --test services/mikrotik/changeDecisions.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createDecisions, MESSAGES } = require("./changeDecisions");

const NOW = new Date("2026-10-10T09:00:00Z");
const clone = (v) => structuredClone(v);

const baseChange = (extra = {}) => ({
  _id: "c1",
  number: 7,
  requestedBy: "req",
  status: "awaiting_requester",
  expiresAt: new Date("2026-10-11T09:00:00Z"),
  steps: [
    { role: "requester", user: "req", decision: null },
    { role: "responsible", user: "resp", decision: null },
  ],
  timeline: [],
  ...extra,
});

// Хранилище в памяти: applyPatch условна и атомарна (как findOneAndUpdate), load отдаёт копию
function fakeStore(initial, { names = { req: "Иван Петров", resp: "Анна Смирнова" } } = {}) {
  const state = { doc: clone(initial), calls: [] };
  return {
    state,
    async load(id) {
      await Promise.resolve();
      return id === state.doc._id ? clone(state.doc) : null;
    },
    async userName(id) { return names[id] || ""; },
    async applyPatch(id, expectedStatus, expectedIndex, patch) {
      state.calls.push({ id, expectedStatus, expectedIndex, patch: clone(patch) });
      const d = state.doc;
      if (d._id !== id || d.status !== expectedStatus || d.steps[expectedIndex]?.decision) return null;
      d.status = patch.status;
      Object.assign(d.steps[expectedIndex], {
        decision: patch.step.decision,
        channel: patch.step.channel,
        comment: patch.step.comment,
        decidedAt: patch.step.decidedAt,
      });
      d.timeline.push(patch.timeline);
      return clone(d);
    },
    async applyCancel(id, expectedStatus, patch) {
      state.calls.push({ id, expectedStatus, cancel: true, patch: clone(patch) });
      const d = state.doc;
      if (d._id !== id || d.status !== expectedStatus) return null;
      d.status = "cancelled";
      d.timeline.push(patch.timeline);
      return clone(d);
    },
  };
}

function fakeNotifier() {
  const sent = [];
  const rec = (name) => async (change) => void sent.push({ name, status: change.status });
  return { sent, step: rec("step"), decided: rec("decided"), result: rec("result"), cancelled: rec("cancelled") };
}

const make = (change, opts) => {
  const store = fakeStore(change, opts);
  const notifier = fakeNotifier();
  const decisions = createDecisions({ store, notifier, now: () => NOW, log: { log() {} } });
  return { store, notifier, decisions };
};

test("заявитель подтверждает: статус «ждёт ответственного», уведомление следующему, хроника «Подтверждено»", async () => {
  const { decisions, notifier, store } = make(baseChange());
  const r = await decisions.decide({ changeId: "c1", userId: "req", decision: "approve", channel: "portal", canApprove: false });
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "awaiting_responsible");
  assert.deepEqual(notifier.sent, [{ name: "step", status: "awaiting_responsible" }]);
  assert.equal(store.state.doc.timeline[0].text, "Подтверждено: Иван Петров, портал");
  assert.equal(store.state.doc.timeline[0].user, "req");
  assert.equal(store.state.doc.timeline[0].at.getTime(), NOW.getTime());
});

test("последний шаг: в очередь, никого не уведомляем; хроника «Утверждено» с Telegram", async () => {
  const c = baseChange({
    status: "awaiting_responsible",
    steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: null },
    ],
  });
  const { decisions, notifier, store } = make(c);
  const r = await decisions.decide({ changeId: "c1", userId: "resp", decision: "approve", channel: "telegram", canApprove: true });
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "queued");
  assert.deepEqual(notifier.sent, []);
  assert.equal(store.state.doc.timeline[0].text, "Утверждено: Анна Смирнова, Telegram");
});

test("отказ: decided, комментарий в шаге, хроника «Отклонено»", async () => {
  const { decisions, notifier, store } = make(baseChange());
  const r = await decisions.decide({ changeId: "c1", userId: "req", decision: "reject", comment: "Не я", channel: "portal", canApprove: false });
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "rejected");
  assert.deepEqual(notifier.sent, [{ name: "decided", status: "rejected" }]);
  assert.equal(store.state.doc.steps[0].comment, "Не я");
  assert.equal(store.state.doc.timeline[0].text, "Отклонено: Иван Петров, портал");
});

test("коды отказа и русские тексты; уведомлений и записи нет", async () => {
  const cases = [
    [baseChange(), { userId: "resp", canApprove: true }, "not_yours"],
    [baseChange({ status: "applied" }), { userId: "req" }, "closed"],
    [baseChange({ expiresAt: new Date("2026-10-10T08:00:00Z") }), { userId: "req" }, "expired"],
    [baseChange({ status: "awaiting_responsible", steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: null },
    ] }), { userId: "resp", canApprove: false }, "no_right"],
  ];
  const texts = {
    not_yours: "Это решение не за вами",
    closed: "Запрос уже решён",
    expired: "Запрос истёк",
    no_right: "Нет права утверждать запросы ИИ-агентов по устройствам Mikrotik",
  };
  for (const [change, args, code] of cases) {
    const { decisions, notifier, store } = make(change);
    const r = await decisions.decide({ changeId: "c1", decision: "approve", channel: "portal", canApprove: false, ...args });
    assert.deepEqual([r.ok, r.code, r.message], [false, code, texts[code]]);
    assert.equal(MESSAGES[code], texts[code]);
    assert.deepEqual(notifier.sent, []);
    assert.equal(store.state.calls.length, 0);
  }
});

test("право берётся из аргумента вызывающего, а не из документа", async () => {
  const c = baseChange({
    status: "awaiting_responsible",
    steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: null },
    ],
  });
  c.canApprove = true; // подсунутое поле значения не имеет
  const { decisions } = make(c);
  const r = await decisions.decide({ changeId: "c1", userId: "resp", decision: "approve", channel: "portal", canApprove: false });
  assert.equal(r.code, "no_right");
});

test("неизвестный запрос — not_found", async () => {
  const { decisions } = make(baseChange());
  const r = await decisions.decide({ changeId: "nope", userId: "req", decision: "approve", channel: "portal", canApprove: true });
  assert.deepEqual([r.ok, r.code], [false, "not_found"]);
});

test("два одновременных утверждения одного шага: одно проходит, второе closed, уведомление одно", async () => {
  const { decisions, notifier, store } = make(baseChange());
  const args = { changeId: "c1", userId: "req", decision: "approve", channel: "portal", canApprove: true };
  const [a, b] = await Promise.all([decisions.decide(args), decisions.decide({ ...args, channel: "telegram" })]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const loser = a.ok ? b : a;
  assert.equal(loser.code, "closed");
  assert.equal(notifier.sent.length, 1);
  assert.equal(store.state.calls.length, 2);
  // условие записи — и прежний статус, и «этот шаг ещё без решения»
  assert.equal(store.state.calls[0].expectedStatus, "awaiting_requester");
  assert.equal(store.state.calls[0].expectedIndex, 0);
  assert.equal(store.state.doc.timeline.length, 1);
});

test("утверждение и отказ одновременно: побеждает один", async () => {
  const { decisions, notifier } = make(baseChange());
  const base = { changeId: "c1", userId: "req", channel: "portal", canApprove: true };
  const [a, b] = await Promise.all([
    decisions.decide({ ...base, decision: "approve" }),
    decisions.decide({ ...base, decision: "reject" }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(notifier.sent.length, 1);
});

test("сбой уведомления не ломает принятое решение", async () => {
  const store = fakeStore(baseChange());
  const notifier = { step: async () => { throw new Error("boom"); }, decided: async () => {}, cancelled: async () => {} };
  const decisions = createDecisions({ store, notifier, now: () => NOW, log: { log() {} } });
  const r = await decisions.decide({ changeId: "c1", userId: "req", decision: "approve", channel: "portal", canApprove: false });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- отзыв

test("отзыв: только заявитель, пока запрос открыт; хроника и уведомление", async () => {
  const { decisions, notifier, store } = make(baseChange());
  const r = await decisions.cancel({ changeId: "c1", userId: "req" });
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "cancelled");
  assert.equal(store.state.doc.timeline[0].text, "Отозвано заявителем");
  assert.deepEqual(notifier.sent, [{ name: "cancelled", status: "cancelled" }]);
});

test("отзыв: чужой — not_yours, закрытый и в очереди — closed, истёкший — expired", async () => {
  const check = async (change, userId) => {
    const { decisions, notifier } = make(change);
    const r = await decisions.cancel({ changeId: "c1", userId });
    assert.deepEqual(notifier.sent, []);
    return r.code;
  };
  assert.equal(await check(baseChange(), "resp"), "not_yours");
  assert.equal(await check(baseChange({ status: "queued" }), "req"), "closed");
  assert.equal(await check(baseChange({ status: "applied" }), "req"), "closed");
  assert.equal(await check(baseChange({ expiresAt: new Date("2026-10-10T08:00:00Z") }), "req"), "expired");
});

test("отзыв и решение одновременно: проходит один", async () => {
  const { decisions, notifier } = make(baseChange({
    steps: [{ role: "requester", user: "req", decision: null }],
  }));
  const [a, b] = await Promise.all([
    decisions.cancel({ changeId: "c1", userId: "req" }),
    decisions.decide({ changeId: "c1", userId: "req", decision: "approve", channel: "portal", canApprove: true }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(notifier.sent.length <= 1, true);
});

test("decisions and a cancel leave a trace in the device journal", async () => {
  const written = [];
  const events = { record: async (recordId, kind, fields) => written.push({ recordId, kind, actor: fields.actor, channel: fields.data.channel }) };
  const store = fakeStore(baseChange({ mikrotik: "r1", title: "WireGuard" }));
  const decisions = createDecisions({ store, events, now: () => NOW });
  await decisions.decide({ changeId: "c1", userId: "req", decision: "approve", channel: "telegram" });
  await decisions.decide({ changeId: "c1", userId: "resp", decision: "approve", channel: "portal", canApprove: true });
  assert.deepEqual(written, [
    { recordId: "r1", kind: "changeConfirmed", actor: { type: "user", userId: "req" }, channel: "telegram" },
    { recordId: "r1", kind: "changeApproved", actor: { type: "user", userId: "resp" }, channel: "portal" },
  ]);

  const other = fakeStore(baseChange({ mikrotik: "r1" }));
  const cancelled = [];
  await createDecisions({ store: other, events: { record: async (recordId, kind) => cancelled.push(kind) }, now: () => NOW }).cancel({ changeId: "c1", userId: "req" });
  assert.deepEqual(cancelled, ["changeCancelled"]);
});
