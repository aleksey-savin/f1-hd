// node --test services/inventory/changeDecisions.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createDecisions, MESSAGES } = require("./changeDecisions");
const { createExecutor } = require("./changeExecutor");
const { createChangeSweep } = require("./changeSweep");
const { toView } = require("./changeView");

const NOW = new Date("2026-10-19T09:00:00Z");
const T1 = new Date("2026-10-18T10:00:00Z");
const clone = (v) => structuredClone(v);

const DEVICE = { device: ["manage"] };
const CATALOG = { inventoryCatalog: ["manage"] };

const op = (kind, text, targets = []) => ({ kind, params: {}, text, targets, result: { state: "pending" } });

const baseChange = (extra = {}) => ({
  _id: "c1",
  number: 3,
  title: "Перенос техники",
  requestedBy: "req",
  status: "awaiting_requester",
  expiresAt: new Date("2026-10-20T09:00:00Z"),
  operations: [
    op("createVendor", "Новый вендор «Lenovo»"),
    op("moveDevice", "Перенести ПК PC-000123 в «Кабинет 214»", [{ model: "ClientDevice", id: "d1", updatedAt: T1 }]),
    op("setDeviceStatus", "Сменить статус ПК PC-000124 на «В ремонте»", [{ model: "ClientDevice", id: "d2", updatedAt: T1 }]),
  ],
  timeline: [{ at: T1, kind: "proposed", user: "req", text: "Предложено ИИ-агентом" }],
  ...extra,
});

const staff = (extra = {}) => ({ _id: "req", firstName: "Иван", lastName: "Петров", isEndUser: false, ...extra });

// Хранилище в памяти: applyPatch, progress и finish условны и атомарны (как findOneAndUpdate/updateOne), load отдаёт копию.
// writes — порядок записей хода и итога
function fakeStore(initial, { users = { req: staff() }, current = { "ClientDevice:d1": T1, "ClientDevice:d2": T1 }, progressFails = false } = {}) {
  const state = { doc: clone(initial), patches: [], progress: [], finishes: [], writes: [] };
  return {
    state,
    async load(id) {
      await Promise.resolve();
      return id === state.doc._id ? clone(state.doc) : null;
    },
    async loadUser(id) {
      await Promise.resolve();
      return users[id] ? clone(users[id]) : null;
    },
    async applyPatch(id, expectedStatus, patch) {
      state.patches.push({ id, expectedStatus, patch: clone(patch) });
      const d = state.doc;
      if (d._id !== id || d.status !== expectedStatus || d.decision?.decision) return null;
      d.status = patch.status;
      d.decision = patch.decision;
      if (patch.applyingSince) d.applyingSince = patch.applyingSince;
      d.timeline.push(patch.timeline);
      return clone(d);
    },
    async progress(id, index, result) {
      await Promise.resolve();
      if (progressFails) throw new Error("mongo blip");
      state.writes.push(`progress:${index}`);
      const d = state.doc;
      // Как mongoStore.progress: только пока applying
      const saved = d._id === id && d.status === "applying";
      state.progress.push({ id, index, result: clone(result), saved });
      if (saved) d.operations[index].result = clone(result);
    },
    async finish(id, expectedStatus, { status, results, timeline }) {
      state.writes.push("finish");
      state.finishes.push({ id, expectedStatus, status, results: clone(results) });
      const d = state.doc;
      // Как mongoStore.finish: из applying, а также из failed+stuck (догадка sweep)
      const match = d.status === expectedStatus || (expectedStatus === "applying" && d.status === "failed" && d.stuck === true);
      if (d._id !== id || !match) return null;
      d.status = status;
      results.forEach((r, i) => { d.operations[i].result = r; });
      delete d.applyingSince;
      delete d.stuck;
      d.timeline.push(timeline);
      return clone(d);
    },
    async currentUpdatedAt(model, id) {
      return current[`${model}:${id}`] ?? null;
    },
  };
}

function fakeNotifier() {
  const sent = [];
  const rec = (name) => async (change) => void sent.push({ name, status: change.status });
  return { sent, decided: rec("decided"), result: rec("result") };
}

// Права: множество разрешённых операторов «ресурс»
const fakeCanFor = (allowed = ["device", "inventoryCatalog", "supplier"]) => async (user) => {
  assert.equal(typeof user.isEndUser, "boolean", "canFor получает полный документ");
  return (statement) => Object.keys(statement).every((k) => allowed.includes(k));
};

const fakeOps = (outcome) => {
  const calls = [];
  return {
    calls,
    requiredRights: (operations) => {
      const out = [];
      for (const o of operations) {
        const right = o.kind === "createVendor" ? CATALOG : DEVICE;
        if (!out.some((r) => JSON.stringify(r) === JSON.stringify(right))) out.push(clone(right));
      }
      return out;
    },
    async applyPackage(items, ctx) {
      calls.push({ items: clone(items), ctx });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = outcome || { status: "done", results: items.map(() => ({ state: "done" })) };
      // Как changeOps.applyPackage: ход — после каждой выполненной операции
      for (const [i, r] of result.results.entries()) if (r.state !== "skipped") await ctx.onResult?.(i, r);
      return result;
    },
  };
};

const make = (change, { users, current, outcome, canFor, notifier = fakeNotifier(), executor, progressFails } = {}) => {
  const store = fakeStore(change, { users, current, progressFails });
  const ops = fakeOps(outcome);
  const logged = [];
  const decisions = createDecisions({
    store,
    ops,
    executor: executor || createExecutor({ ops, store, now: () => NOW }),
    notifier,
    canFor: canFor || fakeCanFor(),
    now: () => NOW,
    log: { log: (level, message, meta) => logged.push({ level, message, meta }) },
  });
  return { store, ops, notifier, decisions, logged };
};

const approve = { changeId: "c1", userId: "req", decision: "approve", channel: "portal" };

test("утверждение: применено, результаты по операциям, хроника, уведомление result", async () => {
  const { decisions, store, ops, notifier } = make(baseChange());
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "done");
  assert.equal(ops.calls.length, 1);
  const { onResult, ...ctx } = ops.calls[0].ctx;
  assert.deepEqual(ctx, { userId: "req", now: NOW });
  assert.equal(typeof onResult, "function");
  // запись решения условна по прежнему статусу; применение — из applying
  assert.equal(store.state.patches[0].expectedStatus, "awaiting_requester");
  assert.equal(store.state.patches[0].patch.status, "applying");
  assert.equal(store.state.patches[0].patch.applyingSince.getTime(), NOW.getTime());
  assert.equal(store.state.finishes[0].expectedStatus, "applying");
  const doc = store.state.doc;
  assert.equal(doc.decision.decision, "approve");
  assert.equal(doc.decision.channel, "portal");
  assert.equal(doc.applyingSince, undefined);
  assert.deepEqual(doc.operations.map((o) => o.result.state), ["done", "done", "done"]);
  assert.equal(doc.operations[0].result.at.getTime(), NOW.getTime());
  assert.equal(doc.timeline[1].text, "Утверждено: Иван Петров, портал");
  assert.equal(doc.timeline[1].kind, "decision");
  assert.equal(doc.timeline[2].kind, "result");
  assert.match(doc.timeline[2].text, /^Применено/);
  assert.deepEqual(notifier.sent, [{ name: "result", status: "done" }]);
});

test("два одновременных утверждения: применяется один раз, второе — «Решение уже принято»", async () => {
  const { decisions, store, ops, notifier } = make(baseChange());
  const [a, b] = await Promise.all([decisions.decide(approve), decisions.decide({ ...approve, channel: "telegram" })]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const loser = a.ok ? b : a;
  assert.deepEqual([loser.code, loser.message], ["closed", "Решение уже принято"]);
  assert.equal(store.state.patches.length, 2);
  assert.equal(ops.calls.length, 1);
  assert.equal(store.state.finishes.length, 1);
  assert.deepEqual(notifier.sent, [{ name: "result", status: "done" }]);
  assert.equal(store.state.doc.timeline.filter((t) => t.kind === "decision").length, 1);
});

test("повторное нажатие после применения — closed, ничего не применяется", async () => {
  const { decisions, ops } = make(baseChange());
  await decisions.decide(approve);
  const again = await decisions.decide(approve);
  assert.deepEqual([again.ok, again.code], [false, "closed"]);
  assert.equal(ops.calls.length, 1);
});

test("утверждение и отказ одновременно: побеждает один", async () => {
  const { decisions, notifier } = make(baseChange());
  const [a, b] = await Promise.all([decisions.decide(approve), decisions.decide({ ...approve, decision: "reject" })]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  assert.equal(notifier.sent.length, 1);
});

test("дрейф: failed, ничего не применено, причина называет операцию", async () => {
  const { decisions, store, ops, notifier } = make(baseChange(), {
    current: { "ClientDevice:d1": new Date("2026-10-19T08:00:00Z"), "ClientDevice:d2": T1 },
  });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "failed");
  assert.equal(ops.calls.length, 0);
  const doc = store.state.doc;
  assert.deepEqual(doc.operations.map((o) => o.result.state), ["skipped", "skipped", "skipped"]);
  // В итоге операции — только причина; текст операции — в хронике
  assert.equal(doc.operations[1].result.error, "изменилось после предложения");
  assert.equal(doc.operations[0].result.error, "другая операция пакета изменилась после предложения");
  assert.match(doc.timeline.at(-1).text, /^Не применено: изменилось после предложения: Перенести ПК PC-000123/);
  assert.deepEqual(notifier.sent, [{ name: "result", status: "failed" }]);
});

test("сбой второй из трёх операций: partial, каждая операция со своим итогом", async () => {
  const outcome = {
    status: "partial",
    results: [
      { state: "done", created: { vendor: "v9" } },
      { state: "failed", error: "Деталь «RAM-1» уже не в составе устройства" },
      { state: "skipped" },
    ],
  };
  const { decisions, store, notifier } = make(baseChange(), { outcome });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "partial");
  const results = store.state.doc.operations.map((o) => o.result);
  assert.deepEqual(results.map((x) => x.state), ["done", "failed", "skipped"]);
  assert.deepEqual(results[0].created, { vendor: "v9" });
  assert.equal(results[1].error, "Деталь «RAM-1» уже не в составе устройства");
  assert.match(store.state.doc.timeline.at(-1).text, /^Применено частично \(1 из 3\): Деталь «RAM-1» уже не в составе устройства/);
  assert.deepEqual(notifier.sent, [{ name: "result", status: "partial" }]);
});

test("заявитель потерял право: no_right, статус не меняется, ничего не применено", async () => {
  const { decisions, store, ops, notifier } = make(baseChange(), { canFor: fakeCanFor(["inventoryCatalog"]) });
  const r = await decisions.decide(approve);
  assert.deepEqual([r.ok, r.code], [false, "no_right"]);
  assert.equal(r.message, "Нет права на одну из операций: Изменять технику и расположения");
  assert.equal(store.state.doc.status, "awaiting_requester");
  assert.equal(store.state.patches.length, 0);
  assert.equal(ops.calls.length, 0);
  assert.deepEqual(notifier.sent, []);
});

test("заявитель отключён, стал служебной учёткой, клиентом или удалён: no_right", async () => {
  const future = new Date(Date.now() + 24 * 3600 * 1000);
  const variants = [
    { req: staff({ banned: true }) },
    { req: staff({ banned: true, banExpires: future }) },
    { req: staff({ isServiceAccount: true }) },
    { req: staff({ isEndUser: true }) },
    {},
  ];
  for (const users of variants) {
    const { decisions, store, ops } = make(baseChange(), { users });
    const r = await decisions.decide(approve);
    assert.deepEqual([r.ok, r.code], [false, "no_right"], JSON.stringify(users));
    assert.match(r.message, /^Нет права на одну из операций: /);
    assert.equal(store.state.patches.length, 0);
    assert.equal(ops.calls.length, 0);
  }
});

test("отключение с вышедшим сроком — не отключение", async () => {
  const { decisions } = make(baseChange(), { users: { req: staff({ banned: true, banExpires: new Date("2020-01-01") }) } });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
});

test("отказ: rejected, notifier.decided, хроника «Отклонено», комментарий в решении", async () => {
  const { decisions, store, ops, notifier } = make(baseChange());
  const r = await decisions.decide({ ...approve, decision: "reject", channel: "telegram", comment: "Не сейчас" });
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "rejected");
  assert.equal(ops.calls.length, 0);
  assert.deepEqual(notifier.sent, [{ name: "decided", status: "rejected" }]);
  const doc = store.state.doc;
  assert.equal(doc.decision.comment, "Не сейчас");
  assert.equal(doc.timeline.at(-1).text, "Отклонено: Иван Петров, Telegram");
  assert.equal(store.state.patches[0].patch.applyingSince, undefined);
});

test("отказ не проверяет права: отклонить можно и без них", async () => {
  const { decisions } = make(baseChange(), { canFor: fakeCanFor([]) });
  const r = await decisions.decide({ ...approve, decision: "reject" });
  assert.equal(r.ok, true);
});

test("коды отказа и русские тексты; записи и уведомлений нет", async () => {
  const cases = [
    [baseChange(), { userId: "other" }, "not_yours", "Это решение не за вами"],
    [baseChange({ status: "done" }), {}, "closed", "Решение уже принято"],
    [baseChange({ status: "applying" }), {}, "closed", "Решение уже принято"],
    [baseChange({ expiresAt: new Date("2026-10-19T08:00:00Z") }), {}, "expired", "Предложение истекло"],
    // sweep уже поставил expired: «истекло», а не «Решение уже принято»
    [baseChange({ status: "expired" }), {}, "expired", "Предложение истекло"],
    [baseChange(), { changeId: "nope" }, "not_found", "Предложение не найдено"],
  ];
  for (const [change, args, code, text] of cases) {
    const { decisions, store, notifier } = make(change);
    const r = await decisions.decide({ ...approve, ...args });
    assert.deepEqual([r.ok, r.code, r.message], [false, code, text]);
    assert.equal(MESSAGES[code], text);
    assert.equal(store.state.patches.length, 0);
    assert.deepEqual(notifier.sent, []);
  }
});

test("исполнитель бросил: failed с общей пометкой, ошибка в журнале", async () => {
  const executor = { run: async () => { throw new Error("db down"); } };
  const { decisions, store, notifier, logged } = make(baseChange(), { executor });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "failed");
  const results = store.state.doc.operations.map((o) => o.result);
  assert.ok(results.every((x) => x.state === "skipped" && x.error === "Не удалось применить: внутренняя ошибка"));
  assert.equal(store.state.doc.applyingSince, undefined);
  assert.ok(logged.some((l) => l.level === "error" && l.meta?.error === "db down"));
  assert.deepEqual(notifier.sent, [{ name: "result", status: "failed" }]);
});

test("сбой уведомления не ломает решение и итог", async () => {
  const boom = async () => { throw new Error("tg down"); };
  const { decisions, logged } = make(baseChange(), { notifier: { result: boom, decided: boom } });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "done");
  assert.ok(logged.some((l) => l.meta?.error === "tg down"));
  const { decisions: d2 } = make(baseChange(), { notifier: { result: boom, decided: boom } });
  assert.equal((await d2.decide({ ...approve, decision: "reject" })).ok, true);
});

test("предложение снято из applying (sweep) до записи итога: итог в журнале, без второго уведомления", async () => {
  const store = fakeStore(baseChange());
  const notifier = fakeNotifier();
  const logged = [];
  const ops = fakeOps();
  const executor = {
    run: async (change, ctx) => {
      store.state.doc.status = "failed"; // sweep успел раньше
      return createExecutor({ ops, store, now: () => NOW }).run(change, ctx);
    },
  };
  const decisions = createDecisions({
    store, ops, executor, notifier, canFor: fakeCanFor(), now: () => NOW,
    log: { log: (level, message, meta) => logged.push({ level, message, meta }) },
  });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "failed");
  assert.deepEqual(notifier.sent, []);
  assert.ok(logged.some((l) => l.level === "error"));
});

test("sweep счёл применение застрявшим (failed+stuck): живой итог всё равно пишется и снимает stuck", async () => {
  const store = fakeStore(baseChange());
  const notifier = fakeNotifier();
  const ops = fakeOps();
  const executor = {
    run: async (change, ctx) => {
      Object.assign(store.state.doc, { status: "failed", stuck: true }); // sweep успел раньше
      return createExecutor({ ops, store, now: () => NOW }).run(change, ctx);
    },
  };
  const decisions = createDecisions({
    store, ops, executor, notifier, canFor: fakeCanFor(), now: () => NOW, log: { log() {} },
  });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(store.state.doc.status, "done");
  assert.equal(store.state.doc.stuck, undefined);
  assert.deepEqual(store.state.doc.operations.map((o) => o.result.state), ["done", "done", "done"]);
  assert.deepEqual(notifier.sent, [{ name: "result", status: "done" }]);
});

test("ход применения: итог каждой операции пишется сразу, до общего итога, условно от applying", async () => {
  const outcome = {
    status: "partial",
    results: [{ state: "done", created: { vendor: "v9" } }, { state: "failed", error: "нет места" }, { state: "skipped" }],
  };
  const { decisions, store } = make(baseChange(), { outcome });
  const r = await decisions.decide(approve);
  assert.equal(r.change.status, "partial");
  // Выполненные (done и failed) — по записи на операцию; пропущенная — только в finish
  assert.deepEqual(store.state.writes, ["progress:0", "progress:1", "finish"]);
  assert.deepEqual(store.state.progress.map((p) => [p.index, p.result.state, p.saved]), [[0, "done", true], [1, "failed", true]]);
  assert.deepEqual(store.state.progress[0].result.created, { vendor: "v9" });
  assert.equal(store.state.progress[0].result.at.getTime(), NOW.getTime());
  // finish по-прежнему пишет весь набор
  assert.deepEqual(store.state.finishes[0].results.map((x) => x.state), ["done", "failed", "skipped"]);
});

test("обрыв после двух операций: их итоги уже в документе, sweep их сохраняет, страница показывает ✓ и «Создано»", async () => {
  const store = fakeStore(baseChange());
  const crashed = {
    requiredRights: () => [],
    // Две операции прошли, третья так и не вернулась (процесс перезапущен)
    async applyPackage(items, ctx) {
      await ctx.onResult(0, { state: "done", created: { vendor: "64f1000000000000000000b1" } });
      await ctx.onResult(1, { state: "done" });
      return new Promise(() => {});
    },
  };
  const decisions = createDecisions({
    store, ops: crashed, executor: createExecutor({ ops: crashed, store, now: () => NOW }),
    notifier: fakeNotifier(), canFor: fakeCanFor(), now: () => NOW, log: { log() {} },
  });
  void decisions.decide(approve);
  for (let i = 0; i < 50 && store.state.progress.length < 2; i++) await new Promise((resolve) => setImmediate(resolve));

  const doc = store.state.doc;
  assert.equal(doc.status, "applying");
  assert.deepEqual(doc.operations.map((o) => o.result.state), ["done", "done", "pending"]);
  assert.equal(store.state.finishes.length, 0);

  // Sweep: застрявшее — failed+stuck, записанное не трогается
  doc.applyingSince = new Date(NOW.getTime() - 11 * 60 * 1000);
  const sweepStore = {
    async findStale(before) { return doc.status === "applying" && doc.applyingSince <= before ? [clone(doc)] : []; },
    async findExpired() { return []; },
    async update(id, { from, set = {}, unset = [], timeline = [] }) {
      if (doc._id !== id || doc.status !== from) return null;
      Object.assign(doc, set);
      unset.forEach((name) => delete doc[name]);
      doc.timeline.push(...timeline);
      return clone(doc);
    },
  };
  await createChangeSweep({ store: sweepStore, notifier: {}, now: () => NOW, log: { log() {} } }).sweep();
  assert.equal(doc.status, "failed");
  assert.equal(doc.stuck, true);
  assert.deepEqual(doc.operations.map((o) => o.result.state), ["done", "done", "pending"]);
  assert.deepEqual(doc.operations[0].result.created, { vendor: "64f1000000000000000000b1" });

  // Страница: две ✓ (done), третья — pending («Результат неизвестен» при stuck), созданное — в «Создано»
  const created = new Map([["Vendor:64f1000000000000000000b1", { label: "Lenovo", to: "/inventory/vendors/64f1000000000000000000b1" }]]);
  const view = toView(doc, { userId: "req" }, NOW, { created });
  assert.equal(view.stuck, true);
  assert.deepEqual(view.operations.map((o) => o.result.state), ["done", "done", "pending"]);
  assert.deepEqual(view.created, [
    { model: "Vendor", id: "64f1000000000000000000b1", label: "Lenovo", kindLabel: "вендор", to: "/inventory/vendors/64f1000000000000000000b1" },
  ]);
});

test("ход после догадки sweep не пишется: условие applying", async () => {
  const store = fakeStore(baseChange());
  const ops = fakeOps();
  const executor = {
    run: async (change, ctx) => {
      Object.assign(store.state.doc, { status: "failed", stuck: true }); // sweep успел раньше
      return createExecutor({ ops, store, now: () => NOW }).run(change, ctx);
    },
  };
  const decisions = createDecisions({ store, ops, executor, notifier: fakeNotifier(), canFor: fakeCanFor(), now: () => NOW, log: { log() {} } });
  await decisions.decide(approve);
  assert.deepEqual(store.state.progress.map((p) => p.saved), [false, false, false]);
  // Итог всё равно дописал finish
  assert.equal(store.state.doc.status, "done");
  assert.deepEqual(store.state.doc.operations.map((o) => o.result.state), ["done", "done", "done"]);
});

test("сбой записи хода — в журнал, применение идёт дальше, finish пишет весь набор", async () => {
  const { decisions, store, logged } = make(baseChange(), { progressFails: true });
  const r = await decisions.decide(approve);
  assert.equal(r.ok, true);
  assert.equal(r.change.status, "done");
  assert.deepEqual(store.state.doc.operations.map((o) => o.result.state), ["done", "done", "done"]);
  const warns = logged.filter((l) => l.level === "warn" && l.meta?.error === "mongo blip");
  assert.equal(warns.length, 3);
  assert.match(warns[0].message, /progress #3 op 1 not saved/);
});

test("исполнитель бросил после выполненной операции: её итог не затирается общей пометкой", async () => {
  const store = fakeStore(baseChange());
  const ops = {
    requiredRights: () => [],
    async applyPackage(items, ctx) {
      await ctx.onResult(0, { state: "done", created: { vendor: "v9" } });
      throw new Error("db down");
    },
  };
  const decisions = createDecisions({
    store, ops, executor: createExecutor({ ops, store, now: () => NOW }),
    notifier: fakeNotifier(), canFor: fakeCanFor(), now: () => NOW, log: { log() {} },
  });
  const r = await decisions.decide(approve);
  assert.equal(r.change.status, "failed");
  const results = store.state.doc.operations.map((o) => o.result);
  assert.deepEqual(results.map((x) => x.state), ["done", "skipped", "skipped"]);
  assert.deepEqual(results[0].created, { vendor: "v9" });
  assert.equal(results[1].error, "Не удалось применить: внутренняя ошибка");
});
