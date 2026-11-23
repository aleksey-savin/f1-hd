require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("mongoose")] = { loaded: true, exports: { connection: { readyState: 1 } } };
const Mikrotik = { find() {}, updateOne() {} };
const Preferences = { findOne() {} };
require.cache[require.resolve("../models/mikrotik")] = { loaded: true, exports: Mikrotik };
require.cache[require.resolve("../models/preferences")] = { loaded: true, exports: Preferences };
const due = new Date("2025-01-01T00:00:00Z");

const created = [];
let duringExport = () => {};
const artifacts = require.resolve("../services/mikrotik/artifacts");
require.cache[artifacts] = { loaded: true, exports: {
  createArtifact: async (record) => { created.push(record._id); duringExport(record); },
} };
const { runMikrotikScheduler } = require("./mikrotikScheduler");

test("only unchanged due schedules run, including checks of transit records without schedules", async (t) => {
  const record = (_id, jumpRecordId) => ({
    _id, jumpRecordId, schedules: { export: { frequency: "daily", nextRunAt: due } },
  });
  const records = [record("behind", "router"), record("edited"), record("due"), record("legacy")];
  delete records[3].schedules.export.nextRunAt;
  const persisted = new Map(records.map((r) => [r._id, { ...r.schedules.export }]));
  persisted.get("edited").frequency = "off";
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({ modules: { mikrotik: { isActive: true } } }),
  }));
  t.mock.method(Mikrotik, "find", (filter) => filter._id
    ? { select: () => [{ _id: "router", upgrade: { jobId: "job", since: new Date() } }] }
    : records);
  const field = (path) => {
    assert.ok(path.startsWith("schedules.export."));
    return path.slice("schedules.export.".length);
  };
  t.mock.method(Mikrotik, "updateOne", async (filter, update) => {
    const saved = persisted.get(filter._id);
    for (const [path, expected] of Object.entries(filter)) {
      if (path !== "_id" && (saved[field(path)] ?? null) !== expected) return { matchedCount: 0 };
    }
    for (const [path, value] of Object.entries(update.$set || {})) saved[field(path)] = value;
    for (const path of Object.keys(update.$unset || {})) delete saved[field(path)];
    return { matchedCount: 1 };
  });
  duringExport = () => {
    Object.assign(persisted.get("due"), { frequency: "off", nextRunAt: null, keepLast: 22 });
  };
  await runMikrotikScheduler();
  assert.deepEqual(created, ["due"]);
  const finished = persisted.get("due");
  assert.equal(finished.frequency, "off");
  assert.equal(finished.keepLast, 22);
  assert.equal(finished.nextRunAt, null);
  assert.ok(finished.lastSuccessAt instanceof Date);
  assert.ok(persisted.get("legacy").nextRunAt instanceof Date);
  assert.equal(persisted.get("legacy").lastRunAt, undefined);
  assert.equal(persisted.get("behind").nextRunAt, due);
});
