// node --test services/mikrotik/upgradeView.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { publicJob, upgradeFor, userName, isDuplicateRunning } = require("./upgradeView");

test("job counts and the log tail", () => {
  const log = Array.from({ length: 30 }, (_, i) => ({ at: new Date(), text: `l${i}` }));
  const job = {
    _id: "j", status: "running", channelMode: "current", createdAt: new Date(),
    items: [
      { _id: "a", mikrotik: "m1", name: "A", state: "done", log },
      { _id: "b", mikrotik: "m2", name: "B", state: "failed", log: [] },
      { _id: "c", mikrotik: "m3", name: "C", state: "running", log: [] },
      { _id: "d", mikrotik: "m4", name: "D", state: "queued", log: [] },
    ],
  };
  const out = publicJob(job, { _id: "u", firstName: "Алексей", lastName: "Савин" });
  assert.deepEqual(out.counts, { total: 4, done: 1, failed: 1, skipped: 0, processed: 2 });
  assert.equal(out.items[0].log.length, 20);
  assert.equal(out.createdBy.name, "Алексей Савин");
});

test("row state comes from the running batch only", () => {
  const record = { _id: "m2", firmwareUpgradeEnabled: true };
  const job = { _id: "j", items: [{ mikrotik: "m2", state: "running", step: "wait" }] };
  assert.equal(upgradeFor(record, job).state, "running");
  assert.equal(upgradeFor(record, null).state, null);
  assert.equal(upgradeFor({ _id: "x" }, job).enabled, false);
});

test("user name falls back to a dash", () => {
  assert.equal(userName(null), "—");
});

test("only a duplicate-key error means another batch won the race", () => {
  assert.equal(isDuplicateRunning({ code: 11000 }), true);
  assert.equal(isDuplicateRunning(new Error("x")), false);
});

const { publicPlan } = require("./upgradeView");

test("plan passes legs, via, majorUpgrade and hasV6", () => {
  const out = publicPlan({
    items: [{ mikrotik: "m1", name: "A", channel: "long-term", fromVersion: "6.45.9", toVersion: "7.23.7", legs: ["long-term", "upgrade", "long-term"], via: ["6.49.22", "7.x"], majorUpgrade: true }],
    skipped: [],
    hasV6: true,
  });
  assert.equal(out.hasV6, true);
  assert.deepEqual(out.items[0].legs, ["long-term", "upgrade", "long-term"]);
  assert.deepEqual(out.items[0].via, ["6.49.22", "7.x"]);
  assert.equal(out.items[0].majorUpgrade, true);
});

test("job items carry the legs; old items fall back to a single leg", () => {
  const job = {
    _id: "j", status: "running", channelMode: "current", toV7: true, createdAt: new Date(),
    items: [
      { _id: "a", mikrotik: "m1", name: "A", channel: "long-term", state: "running", legs: ["upgrade", "long-term"], leg: 1, hopTo: "7.23.7", path: ["6.49.22", "7.x", "7.23.7"], from: { os: "6.49.22" }, to: { os: "7.23.7" }, log: [] },
      { _id: "b", mikrotik: "m2", name: "B", channel: "stable", state: "done", from: { os: "7.23.5" }, to: { os: "7.24.4" }, log: [] },
      { _id: "c", mikrotik: "m3", name: "C", channel: "stable", state: "queued", legs: [], from: { os: "7.23.5" }, to: { os: "7.24.4" }, log: [] },
    ],
  };
  const out = publicJob(job, null);
  assert.equal(out.toV7, true);
  assert.deepEqual(out.items[0].legs, ["upgrade", "long-term"]);
  assert.equal(out.items[0].leg, 1);
  assert.equal(out.items[0].hopTo, "7.23.7");
  assert.deepEqual(out.items[0].path, ["6.49.22", "7.x", "7.23.7"]);
  assert.deepEqual(out.items[1].legs, ["stable"]);
  assert.equal(out.items[1].leg, 0);
  assert.equal(out.items[1].hopTo, null);
  assert.deepEqual(out.items[1].path, ["7.23.5", "7.24.4"]);
  // Mongoose gives an empty array, not undefined, to items written before legs existed.
  assert.deepEqual(out.items[2].legs, ["stable"]);
  assert.deepEqual(out.items[2].path, ["7.23.5", "7.24.4"]);
  assert.equal(publicJob({ ...job, toV7: undefined }, null).toV7, false);
});
