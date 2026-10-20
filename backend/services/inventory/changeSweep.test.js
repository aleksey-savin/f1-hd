// node --test services/inventory/changeSweep.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChangeSweep, STUCK_TEXT, EXPIRED_TEXT } = require("./changeSweep");

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (ms) => new Date(NOW.getTime() - ms);
const MIN = 60 * 1000;

const doc = (id, over = {}) => ({ _id: id, number: 1, title: "t", status: "awaiting_requester", timeline: [], ...over });

// Хранилище в памяти: update условен по статусу, как findOneAndUpdate
function fakeStore(docs, { beforeUpdate } = {}) {
  const state = { docs: docs.map((d) => ({ ...d })), updates: [] };
  return {
    state,
    async findStale(before) {
      return state.docs.filter((d) => d.status === "applying" && d.applyingSince <= before).map((d) => ({ ...d }));
    },
    async findExpired(at) {
      return state.docs.filter((d) => d.status === "awaiting_requester" && d.expiresAt <= at).map((d) => ({ ...d }));
    },
    async update(id, { from, set = {}, unset = [], timeline = [] }) {
      if (beforeUpdate) beforeUpdate(state, id);
      state.updates.push({ id, from, set });
      const d = state.docs.find((x) => x._id === id);
      if (!d || d.status !== from) return null;
      Object.assign(d, set);
      unset.forEach((name) => delete d[name]);
      d.timeline = [...d.timeline, ...timeline];
      return { ...d };
    },
  };
}

const fakeNotifier = () => {
  const sent = [];
  return { sent, expired: async (c) => sent.push(["expired", c._id]), result: async (c) => sent.push(["result", c._id, c.status, c.stuck]) };
};

const make = (docs, opts) => {
  const store = fakeStore(docs, opts);
  const notifier = fakeNotifier();
  const sweep = createChangeSweep({ store, notifier, now: () => NOW, log: { log() {} } });
  return { store, notifier, sweep };
};

test("истёкшее открытое предложение → expired, запись в хронике, уведомление", async () => {
  const { store, notifier, sweep } = make([doc("a", { expiresAt: ago(1) })]);
  await sweep.sweep();
  const d = store.state.docs[0];
  assert.equal(d.status, "expired");
  assert.equal(d.timeline.at(-1).text, EXPIRED_TEXT);
  assert.equal(d.timeline.at(-1).kind, "expired");
  assert.deepEqual(notifier.sent, [["expired", "a"]]);
});

test("свежее предложение не трогается", async () => {
  const { store, notifier, sweep } = make([doc("a", { expiresAt: new Date(NOW.getTime() + MIN) })]);
  await sweep.sweep();
  assert.equal(store.state.docs[0].status, "awaiting_requester");
  assert.deepEqual(notifier.sent, []);
});

test("applying старше 10 минут → failed со stuck, хроника, уведомление о результате", async () => {
  const { store, notifier, sweep } = make([
    doc("old", { status: "applying", applyingSince: ago(11 * MIN) }),
    doc("fresh", { status: "applying", applyingSince: ago(5 * MIN) }),
  ]);
  await sweep.sweep();
  const [old, fresh] = store.state.docs;
  assert.equal(old.status, "failed");
  assert.equal(old.stuck, true);
  assert.equal(old.applyingSince, undefined);
  assert.equal(old.timeline.at(-1).text, STUCK_TEXT);
  assert.equal(STUCK_TEXT, "Применение прервано — результат неизвестен");
  assert.equal(fresh.status, "applying");
  assert.deepEqual(notifier.sent, [["result", "old", "failed", true]]);
});

test("застрявшее: итоги, записанные по ходу применения, остаются", async () => {
  const operations = [
    { kind: "createVendor", result: { state: "done", created: { vendor: "v9" } } },
    { kind: "createModel", result: { state: "done", created: { model: "m9" } } },
    { kind: "createDevice", result: { state: "pending" } },
  ];
  const { store, sweep } = make([doc("old", { status: "applying", applyingSince: ago(11 * MIN), operations })]);
  await sweep.sweep();
  const [old] = store.state.docs;
  assert.equal(old.status, "failed");
  assert.equal(old.stuck, true);
  // Sweep пишет только статус и stuck: операции не в его $set
  assert.deepEqual(Object.keys(store.state.updates[0].set), ["status", "stuck"]);
  assert.deepEqual(old.operations, operations);
});

test("параллельное решение побеждает: условное обновление ничего не находит, уведомления нет", async () => {
  const { store, notifier, sweep } = make([doc("a", { expiresAt: ago(1) })], {
    beforeUpdate: (state) => { state.docs[0].status = "applying"; },
  });
  await sweep.sweep();
  assert.equal(store.state.docs[0].status, "applying");
  assert.deepEqual(notifier.sent, []);
});

test("сбой одного шага не мешает другому", async () => {
  const { store, notifier, sweep } = make([doc("a", { expiresAt: ago(1) })]);
  store.findStale = async () => { throw new Error("db"); };
  await sweep.sweep();
  assert.equal(store.state.docs[0].status, "expired");
  assert.equal(notifier.sent.length, 1);
});

test("update одного документа бросил: следующий всё равно обработан", async () => {
  const { store, notifier, sweep } = make([doc("a", { expiresAt: ago(2) }), doc("b", { expiresAt: ago(1) })]);
  const real = store.update;
  store.update = async (id, args) => { if (id === "a") throw new Error("db"); return real(id, args); };
  await sweep.sweep();
  assert.equal(store.state.docs[1].status, "expired");
  assert.deepEqual(notifier.sent, [["expired", "b"]]);
});
