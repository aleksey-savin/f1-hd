// node --test services/inventory/changeExecutor.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createExecutor, UNDATED } = require("./changeExecutor");

const NOW = new Date("2026-10-19T09:00:00Z");
const T1 = new Date("2026-10-18T10:00:00Z");
const T2 = new Date("2026-10-18T11:00:00Z");

const change = () => ({
  _id: "c1",
  requestedBy: "req",
  operations: [
    {
      kind: "moveDevice",
      params: { device: "d1", location: "l1" },
      text: "Перенести ПК PC-000123 в «Кабинет 214» вместе с деталями: ОЗУ RAM-000045",
      targets: [
        { model: "ClientDevice", id: "d1", updatedAt: T1 },
        { model: "Location", id: "l1", updatedAt: T1 },
        { model: "ClientDevice", id: "p1", updatedAt: T1 },
      ],
      componentIds: ["p1"],
      componentRefs: ["ram"],
      result: { state: "pending" },
    },
    {
      kind: "createVendor",
      ref: "v1",
      params: { name: "Lenovo" },
      text: "Новый вендор «Lenovo»",
      targets: [],
      result: { state: "pending" },
    },
  ],
});

// Хранилище: текущие updatedAt по «модель:id»; отсутствующий ключ — документа нет
const fakeStore = (current) => ({
  asked: [],
  async currentUpdatedAt(model, id) {
    this.asked.push(`${model}:${id}`);
    await Promise.resolve();
    return Object.hasOwn(current, `${model}:${id}`) ? current[`${model}:${id}`] : null;
  },
});

const fakeOps = (outcome = { status: "done", results: [{ state: "done" }, { state: "done", created: { vendor: "v9" } }] }) => {
  const calls = [];
  return {
    calls,
    async applyPackage(items, ctx) {
      calls.push({ items: structuredClone(items), ctx });
      return outcome;
    },
  };
};

const allCurrent = () => ({ "ClientDevice:d1": T1, "Location:l1": new Date(T1.getTime()), "ClientDevice:p1": T1.toISOString() });

test("без дрейфа: пакет уходит в applyPackage от имени заявителя, итог как есть", async () => {
  const store = fakeStore(allCurrent());
  const ops = fakeOps();
  const executor = createExecutor({ ops, store, now: () => NOW });
  const r = await executor.run(change(), { actorId: "req" });
  assert.equal(r.status, "done");
  assert.deepEqual(r.results, [{ state: "done" }, { state: "done", created: { vendor: "v9" } }]);
  assert.equal(ops.calls.length, 1);
  assert.deepEqual(ops.calls[0].ctx, { userId: "req", now: NOW });
  const [first, second] = ops.calls[0].items;
  assert.equal(first.kind, "moveDevice");
  assert.deepEqual(first.params, { device: "d1", location: "l1" });
  assert.deepEqual(first.componentIds, ["p1"]);
  // новые детали каскада — ссылками, id подставит applyPackage
  assert.deepEqual(first.componentRefs, ["ram"]);
  assert.equal(second.ref, "v1");
  assert.equal(second.componentIds, undefined);
  assert.equal(second.componentRefs, undefined);
  // каждая цель каждой операции, детали каскада тоже
  assert.deepEqual(store.asked, ["ClientDevice:d1", "Location:l1", "ClientDevice:p1"]);
});

test("onResult уходит в applyPackage как есть; без него ctx прежний", async () => {
  const store = fakeStore(allCurrent());
  const ops = fakeOps();
  const onResult = async () => {};
  await createExecutor({ ops, store, now: () => NOW }).run(change(), { actorId: "req", onResult });
  assert.deepEqual(ops.calls[0].ctx, { userId: "req", now: NOW, onResult });
});

test("дрейф детали каскада: failed, все операции пропущены с пометкой, ничего не применено", async () => {
  const store = fakeStore({ ...allCurrent(), "ClientDevice:p1": T2 });
  const ops = fakeOps();
  const executor = createExecutor({ ops, store, now: () => NOW });
  const r = await executor.run(change(), { actorId: "req" });
  assert.equal(r.status, "failed");
  assert.equal(ops.calls.length, 0);
  // drift — для хроники, с текстом операции; в итоге операции — только причина, без повтора текста
  assert.deepEqual(r.drift, ["изменилось после предложения: Перенести ПК PC-000123 в «Кабинет 214» вместе с деталями: ОЗУ RAM-000045"]);
  assert.deepEqual(r.results, [
    { state: "skipped", error: "изменилось после предложения" },
    { state: "skipped", error: "другая операция пакета изменилась после предложения" },
  ]);
});

test("документ цели пропал — тоже дрейф", async () => {
  const current = allCurrent();
  delete current["Location:l1"];
  const ops = fakeOps();
  const r = await createExecutor({ ops, store: fakeStore(current), now: () => NOW }).run(change(), { actorId: "req" });
  assert.equal(r.status, "failed");
  assert.equal(ops.calls.length, 0);
  assert.equal(r.drift.length, 1);
});

test("дата только с одной стороны — дрейф; без даты с обеих сторон — сходится", async () => {
  const c = change();
  c.operations[0].targets[0].updatedAt = undefined;
  const ops = fakeOps();
  const r = await createExecutor({ ops, store: fakeStore(allCurrent()), now: () => NOW }).run(c, { actorId: "req" });
  assert.equal(r.status, "failed");
  assert.equal(ops.calls.length, 0);

  // в снимке дата есть, у документа нет
  const undatedNow = { ...allCurrent(), "ClientDevice:d1": UNDATED };
  const r2 = await createExecutor({ ops, store: fakeStore(undatedNow), now: () => NOW }).run(change(), { actorId: "req" });
  assert.equal(r2.status, "failed");
  assert.equal(ops.calls.length, 0);

  // ни в снимке, ни у документа — не дрейф
  const r3 = await createExecutor({ ops, store: fakeStore(undatedNow), now: () => NOW }).run(c, { actorId: "req" });
  assert.equal(r3.status, "done");
  assert.equal(ops.calls.length, 1);
});

test("многострочный текст операции: в drift — только первая строка", async () => {
  const c = change();
  c.operations[0].text = "Новое устройство «ПК»\nдеталь «ОЗУ»";
  const store = fakeStore({ ...allCurrent(), "ClientDevice:d1": T2 });
  const r = await createExecutor({ ops: fakeOps(), store, now: () => NOW }).run(c, { actorId: "req" });
  assert.deepEqual(r.drift, ["изменилось после предложения: Новое устройство «ПК»"]);
});

test("частичный итог applyPackage проходит без изменений", async () => {
  const outcome = { status: "partial", results: [{ state: "done" }, { state: "failed", error: "Вендор «Lenovo» уже есть" }] };
  const ops = fakeOps(outcome);
  const r = await createExecutor({ ops, store: fakeStore(allCurrent()), now: () => NOW }).run(change(), { actorId: "req" });
  assert.deepEqual(r, outcome);
});

test("снимок refs операции уходит в элемент пакета; без него — нет поля", async () => {
  const refs = [{ model: "DeviceConfiguration", path: "values.value", ids: ["c1"], live: 1, deleted: 0, deletedIds: [] }];
  const withRefs = change();
  withRefs.operations[1].refs = refs;
  const ops = fakeOps();
  await createExecutor({ ops, store: fakeStore(allCurrent()), now: () => NOW }).run(withRefs, { actorId: "req" });
  const [first, second] = ops.calls[0].items;
  assert.equal(Object.hasOwn(first, "refs"), false);
  assert.deepEqual(second.refs, refs);
});
