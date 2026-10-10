// node --test services/mikrotik/upgradeWorker.test.js
// The worker's requires reach modules that import through the `@/` alias.
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { RIGHTS_FIX } = require("./upgradeErrors");
const { nextAction, startsNewLeg, rightsVerdict, itemEvent } = require("./upgradeWorker");

const job = (states, over = {}) => ({
  items: states.map((state, i) => ({ _id: `i${i}`, state })),
  ...over,
});

test("a running item is advanced first", () => {
  const action = nextAction(job(["done", "running", "queued"]));
  assert.equal(action.kind, "advance");
  assert.equal(action.item._id, "i1");
});

test("the next queued item is started when nothing runs", () => {
  const action = nextAction(job(["done", "failed", "queued", "queued"]));
  assert.equal(action.kind, "start");
  assert.equal(action.item._id, "i2");
});

test("a cancel request finishes instead of starting the next device", () => {
  const action = nextAction(job(["done", "queued"], { cancelRequestedAt: new Date() }));
  assert.deepEqual(action, { kind: "finish", status: "cancelled" });
});

test("a cancel request lets the running device finish", () => {
  const action = nextAction(job(["running", "queued"], { cancelRequestedAt: new Date() }));
  assert.equal(action.kind, "advance");
});

test("nothing left finishes the batch as done", () => {
  assert.deepEqual(nextAction(job(["done", "failed", "skipped"])), { kind: "finish", status: "done" });
});

test("a patch that moves the leg cursor starts a new hop (the device flag is refreshed)", () => {
  // A slow three-leg item must not outlive the 90-minute stale cutoff of the
  // monitoring guard: every new leg re-stamps `upgrade.since`.
  assert.equal(startsNewLeg({ step: "channel", stepStartedAt: new Date(), leg: 2, hopTo: null }), true);
  assert.equal(startsNewLeg({ step: "download", hopTo: "7.12.1" }), false);
  assert.equal(startsNewLeg({ state: "failed", error: "x" }), false);
  assert.equal(startsNewLeg(undefined), false);
});

// --- upgradeRights stamped on the record by a finished item ------------------

const NOW = new Date("2026-09-29T06:00:00Z");

test("an item failed on rights stamps the record: write refused by the device", () => {
  assert.deepEqual(
    rightsVerdict({ state: "failed", finishedAt: NOW, error: "…", fix: RIGHTS_FIX }, NOW),
    { ok: false, missing: [], checkedAt: NOW, source: "upgrade" },
  );
});

test("a finished upgrade stamps the record: write confirmed", () => {
  assert.deepEqual(rightsVerdict({ state: "done", finishedAt: NOW }, NOW), {
    ok: true,
    missing: [],
    checkedAt: NOW,
    source: "upgrade",
  });
});

test("any other outcome says nothing about rights", () => {
  // A device that never came back, a mid-step patch, no patch at all.
  assert.equal(rightsVerdict({ state: "failed", finishedAt: NOW, error: "не ответило" }, NOW), null);
  assert.equal(rightsVerdict({ step: "download", hopTo: "7.12.1" }, NOW), null);
  assert.equal(rightsVerdict(undefined, NOW), null);
});

test("itemEvent: start, success and failure of a device become journal events", () => {
  const job = { _id: "j1", createdBy: "u1" };
  const item = { mikrotik: "r1", channel: "stable", from: { os: "7.20.1" }, to: { os: "7.23.7" } };
  assert.deepEqual(itemEvent(job, item, { state: "running", startedAt: new Date() }), {
    kind: "upgradeStarted",
    fields: {
      actor: { type: "user", userId: "u1" },
      data: { from: "7.20.1", to: "7.23.7", channel: "stable" },
      refs: { upgradeJobId: "j1" },
    },
  });
  assert.equal(itemEvent(job, item, { state: "done" }).kind, "upgradeFinished");
  const failed = itemEvent(job, item, { state: "failed", error: "нет места" });
  assert.equal(failed.kind, "upgradeFailed");
  assert.equal(failed.fields.data.error, "нет места");
});

test("itemEvent: a step inside a running item is not an event", () => {
  assert.equal(itemEvent({ _id: "j1" }, {}, { step: "reboot" }), null);
  assert.equal(itemEvent({ _id: "j1" }, {}, { state: "running", step: "download" }), null);
});
