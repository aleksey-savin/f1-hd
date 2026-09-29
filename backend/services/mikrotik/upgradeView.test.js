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
