// node --test services/mikrotik/upgradeWorker.test.js
// The worker's requires reach modules that import through the `@/` alias.
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { nextAction } = require("./upgradeWorker");

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
