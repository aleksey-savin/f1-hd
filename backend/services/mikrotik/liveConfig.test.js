// node --test services/mikrotik/liveConfig.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createLiveConfig } = require("./liveConfig");
const { createLiveLimiter } = require("./liveLimiter");

const EXPORT = "# by RouterOS 7.15\n/interface wireguard\nadd name=wg0 private-key=\"RawPrivateKey=\"\n";
const record = (id, jumpRecordId) => ({ _id: id, jumpRecordId });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the result is redacted and cached; the raw export is not kept", async () => {
  let calls = 0;
  let clock = 1000;
  const live = createLiveConfig({ readExport: async () => ((calls += 1), Buffer.from(EXPORT)), now: () => clock, ttlMs: 100 });

  const first = await live.get(record("a"));
  assert.equal(first.cached, false);
  assert.ok(!JSON.stringify(first).includes("RawPrivateKey"));
  assert.equal(first.config.sections[0].path, "/interface wireguard");

  clock += 50;
  const second = await live.get(record("a"));
  assert.equal(second.cached, true);
  assert.equal(second.fetchedAt, 1000);
  assert.equal(calls, 1);

  clock += 100;
  assert.equal((await live.get(record("a"))).cached, false);
  assert.equal(calls, 2);
});

test("concurrent calls for one device share one read", async () => {
  let calls = 0;
  const gate = deferred();
  const live = createLiveConfig({
    readExport: async () => {
      calls += 1;
      await gate.promise;
      return EXPORT;
    },
  });
  const both = Promise.all([live.get(record("a")), live.get(record("a"))]);
  await tick();
  gate.resolve();
  await both;
  assert.equal(calls, 1);
});

test("a command error instead of an export is refused and not cached", async () => {
  let calls = 0;
  const live = createLiveConfig({ readExport: async () => ((calls += 1), "expected end of command (line 1 column 9)") });
  await assert.rejects(live.get(record("a")), { code: "MIKROTIK_LIVE_BAD_EXPORT" });
  await assert.rejects(live.get(record("a")), { code: "MIKROTIK_LIVE_BAD_EXPORT" });
  assert.equal(calls, 2);
});

test("a failed read is not cached and the next call reads again", async () => {
  let fail = true;
  const live = createLiveConfig({
    limiter: createLiveLimiter({ maxSessions: 1 }),
    readExport: async () => {
      if (fail) throw new Error("unreachable");
      return EXPORT;
    },
  });
  await assert.rejects(live.get(record("a")), /unreachable/);
  fail = false;
  assert.equal((await live.get(record("a"))).cached, false);
});
