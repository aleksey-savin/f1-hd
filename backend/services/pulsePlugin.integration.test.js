const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const plugin = require("./pulsePlugin");
const { createBus } = require("./pulse");

let serial = 0;
const oid = () => new mongoose.Types.ObjectId();
function fixture(spec = "Work") {
  const bus = createBus();
  const schema = new mongoose.Schema({ tickets: [mongoose.Schema.Types.ObjectId], userId: mongoose.Schema.Types.ObjectId, kind: String, dedupeKey: String, notifications: { pending: Boolean } });
  schema.plugin(plugin, { model: spec, bus });
  const Model = mongoose.model(`PulseIntegration${++serial}`, schema);
  return { bus, Model };
}

for (const field of ["tickets", "userId"]) {
  test(`save notifies both previous and current ${field}`, async () => {
    const { bus, Model } = fixture(field === "tickets" ? "Work" : "InAppNotification");
    const oldId = oid(), newId = oid(), unrelated = oid();
    const before = { _id: oid(), [field]: field === "tickets" ? [oldId] : oldId };
    Model.collection.findOne = async () => before;
    Model.collection.updateOne = async () => ({ modifiedCount: 1 });
    const doc = Model.hydrate(before);
    doc[field] = field === "tickets" ? [newId] : newId;
    await doc.save();
    const revision = field === "tickets" ? bus.ticketRev : bus.userRev;
    assert.ok(revision(oldId) > 0);
    assert.ok(revision(newId) > 0);
    assert.equal(revision(unrelated), 0);
  });
}

for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"]) {
  test(`${operation} reparent notifies both tickets even when filter changes`, async () => {
    const { bus, Model } = fixture();
    const oldId = oid(), newId = oid(), unrelated = oid();
    let row = { _id: oid(), tickets: [oldId] };
    Model.collection.find = () => ({ toArray: async () => [row] });
    Model.collection[operation] = async () => {
      const previous = row;
      row = { ...row, tickets: [newId] };
      return operation.startsWith("find") ? previous : { modifiedCount: 1 };
    };
    const update = operation.includes("Replace") || operation === "replaceOne" ? { tickets: [newId] } : { $set: { tickets: [newId] } };
    await Model[operation]({ tickets: oldId }, update);
    assert.ok(bus.ticketRev(oldId) > 0);
    assert.ok(bus.ticketRev(newId) > 0);
    assert.equal(bus.ticketRev(unrelated), 0);
  });
}

for (const metadata of [false, true]) {
  for (const after of [false, true]) {
    test(`insert-only upsert bumps once, preserves result (metadata=${metadata}, after=${after})`, async () => {
      const { bus, Model } = fixture("MikrotikEvent");
      const row = { _id: oid(), kind: "reboot", dedupeKey: "one" };
      let inserted = false;
      Model.collection.findOneAndUpdate = async (_filter, _update, options) => {
        const wasInserted = !inserted;
        inserted = true;
        const value = wasInserted && !after ? null : row;
        return options.includeResultMetadata
          ? { ok: 1, value, lastErrorObject: { updatedExisting: !wasInserted, ...(wasInserted ? { upserted: row._id } : {}) } }
          : value;
      };
      const run = () => Model.findOneAndUpdate({ dedupeKey: "one" }, { $setOnInsert: { kind: "reboot" } }, { upsert: true, returnDocument: after ? "after" : "before", includeResultMetadata: metadata });
      const result = await run();
      assert.equal(bus.topics().mikrotik, 1);
      assert.equal(metadata ? result.value?.kind ?? null : result?.kind ?? null, after ? "reboot" : null);
      if (metadata) assert.equal(result.lastErrorObject.updatedExisting, false);
      await run();
      assert.equal(bus.topics().mikrotik, 1, "duplicate insert-only upsert stays silent");
    });
  }
}

test("updateOne insert-only upsert bumps, duplicate does not", async () => {
  const { bus, Model } = fixture("MikrotikEvent");
  let inserted = false;
  Model.collection.updateOne = async () => {
    const result = { modifiedCount: 0, upsertedCount: inserted ? 0 : 1, upsertedId: inserted ? null : oid() };
    inserted = true;
    return result;
  };
  const run = () => Model.updateOne({ dedupeKey: "one" }, { $setOnInsert: { kind: "reboot" } }, { upsert: true });
  await run();
  assert.equal(bus.topics().mikrotik, 1);
  await run();
  assert.equal(bus.topics().mikrotik, 1);
});

test("failed reparent and notification bookkeeping do not bump", async () => {
  const { bus, Model } = fixture();
  Model.collection.find = () => ({ toArray: async () => [] });
  Model.collection.updateOne = async () => { throw new Error("write failed"); };
  await assert.rejects(Model.updateOne({ _id: oid() }, { $set: { tickets: [oid()] } }), /write failed/);
  Model.collection.updateOne = async () => ({ modifiedCount: 1 });
  await Model.updateOne({ _id: oid() }, { $set: { "notifications.pending": false } });
  assert.equal(bus.rev(), 0);
});

for (const after of [false, true]) {
  test(`query inbox reassignment notifies both owners (after=${after})`, async () => {
    const { bus, Model } = fixture("InAppNotification");
    const oldId = oid(), newId = oid();
    let row = { _id: oid(), userId: oldId };
    Model.collection.find = () => ({ toArray: async () => [row] });
    Model.collection.findOneAndUpdate = async () => {
      const previous = row;
      row = { ...row, userId: newId };
      return after ? row : previous;
    };
    await Model.findOneAndUpdate({ userId: oldId }, { userId: newId }, { returnDocument: after ? "after" : "before" });
    assert.ok(bus.userRev(oldId) > 0);
    assert.ok(bus.userRev(newId) > 0);
    assert.equal(bus.userRev(oid()), 0);
  });
}

test("array removal notifies removed and retained tickets", async () => {
  const { bus, Model } = fixture();
  const removed = oid(), retained = oid();
  let row = { _id: oid(), tickets: [removed, retained] };
  Model.collection.find = () => ({ toArray: async () => [row] });
  Model.collection.updateOne = async () => {
    row = { ...row, tickets: [retained] };
    return { modifiedCount: 1 };
  };
  await Model.updateOne({ tickets: removed }, { $pull: { tickets: removed } });
  assert.ok(bus.ticketRev(removed) > 0);
  assert.ok(bus.ticketRev(retained) > 0);
  assert.equal(bus.ticketRev(oid()), 0);
});

test("reference read cap falls back to every ticket", async () => {
  const { bus, Model } = fixture();
  Model.collection.find = () => ({ toArray: async () => Array.from({ length: 1001 }, () => ({ _id: oid(), tickets: [oid()] })) });
  Model.collection.updateMany = async () => ({ modifiedCount: 1001 });
  await Model.updateMany({}, { $set: { tickets: [oid()] } });
  assert.ok(bus.ticketRev(oid()) > 0);
});

test("insert-only upsert with a reference notifies the inserted ticket", async () => {
  const { bus, Model } = fixture();
  const ticket = oid();
  const row = { _id: oid(), tickets: [ticket] };
  let inserted = false;
  Model.collection.find = () => ({ toArray: async () => inserted ? [row] : [] });
  Model.collection.updateOne = async () => {
    inserted = true;
    return { modifiedCount: 0, upsertedCount: 1, upsertedId: row._id };
  };
  await Model.updateOne({ dedupeKey: "one" }, { $setOnInsert: { tickets: [ticket] } }, { upsert: true });
  assert.ok(bus.ticketRev(ticket) > 0);
  assert.equal(bus.ticketRev(oid()), 0);
});
