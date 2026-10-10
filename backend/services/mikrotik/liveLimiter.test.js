// node --test services/mikrotik/liveLimiter.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createLiveLimiter } = require("./liveLimiter");

const record = (id, jumpRecordId) => ({ _id: id, jumpRecordId });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("devices behind one transit router run one at a time, the router itself included", async () => {
  let active = 0;
  let peak = 0;
  const limiter = createLiveLimiter({ maxSessions: 5 });
  const work = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return "done";
  };
  const results = await Promise.all([
    limiter.run(record("a", "jump"), work),
    limiter.run(record("b", "jump"), work),
    limiter.run(record("jump"), work),
  ]);
  assert.deepEqual(results, ["done", "done", "done"]);
  assert.equal(peak, 1);
});

test("no more than maxSessions at once; an overlong queue is refused", async () => {
  let active = 0;
  let peak = 0;
  const gate = deferred();
  const limiter = createLiveLimiter({ maxSessions: 2, maxQueue: 1 });
  const work = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
  };
  const results = ["a", "b", "c", "d"].map((id) => limiter.run(record(id), work).then(() => "ok", (error) => error.code));
  await tick();
  gate.resolve();
  assert.deepEqual(await Promise.all(results), ["ok", "ok", "ok", "MIKROTIK_LIVE_BUSY"]);
  assert.equal(peak, 2);
});

test("a failed run frees the slot and the lane", async () => {
  const limiter = createLiveLimiter({ maxSessions: 1 });
  await assert.rejects(limiter.run(record("a", "jump"), async () => {
    throw new Error("unreachable");
  }), /unreachable/);
  assert.equal(await limiter.run(record("b", "jump"), async () => 1), 1);
});

test("calls for one device count against the queue too", async () => {
  const gate = deferred();
  const limiter = createLiveLimiter({ maxSessions: 2, maxQueue: 1 });
  const results = Array.from({ length: 10 }, () => limiter.run(record("a"), () => gate.promise).then(() => "ok", (error) => error.code));
  await tick();
  gate.resolve();
  const settled = await Promise.all(results);
  assert.equal(settled.filter((value) => value === "ok").length, 3);
  assert.equal(settled.filter((value) => value === "MIKROTIK_LIVE_BUSY").length, 7);
  // После разгрузки очередь снова принимает
  assert.equal(await limiter.run(record("a"), async () => 1), 1);
});
