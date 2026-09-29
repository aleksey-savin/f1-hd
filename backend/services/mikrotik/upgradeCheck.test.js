// node --test services/mikrotik/upgradeCheck.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { isFinalUpdateStatus, awaitUpdateCheck } = require("./upgradeCheck");

test("only the three end states of check-for-updates are final", () => {
  assert.equal(isFinalUpdateStatus("New version is available"), true);
  assert.equal(isFinalUpdateStatus("System is already up to date"), true);
  assert.equal(isFinalUpdateStatus("ERROR: could not resolve dns name"), true);
  assert.equal(isFinalUpdateStatus("finding out latest version..."), false);
  assert.equal(isFinalUpdateStatus("checking..."), false);
  assert.equal(isFinalUpdateStatus("Downloaded, please reboot router to upgrade it"), false);
  assert.equal(isFinalUpdateStatus(""), false);
  assert.equal(isFinalUpdateStatus(undefined), false);
});

// A fake API session: each print pops the next row; sleep advances the clock.
const session = (rows) => {
  const state = { clock: 0, sleeps: [], prints: 0 };
  const run = async (words) => {
    assert.deepEqual(words, ["/system/package/update/print"]);
    state.prints += 1;
    return [rows[Math.min(state.prints - 1, rows.length - 1)]];
  };
  const sleep = async (ms) => {
    state.sleeps.push(ms);
    state.clock += ms;
  };
  const now = () => state.clock;
  return { state, run, sleep, now };
};

const ROW_PENDING = { channel: "long-term", "installed-version": "7.23.5", "latest-version": "7.23.7", status: "finding out latest version..." };
const ROW_FINAL = { channel: "long-term", "installed-version": "7.23.5", "latest-version": "7.23.8", status: "New version is available" };

test("a final status on the first print returns at once", async () => {
  const s = session([ROW_FINAL]);
  const update = await awaitUpdateCheck(s.run, { sleep: s.sleep, now: s.now });
  assert.deepEqual(update, { channel: "long-term", installed: "7.23.5", latest: "7.23.8", status: "New version is available" });
  assert.equal(s.state.prints, 1);
  assert.deepEqual(s.state.sleeps, []);
});

test("a pending status is re-printed every interval until it is final", async () => {
  const s = session([ROW_PENDING, ROW_PENDING, ROW_FINAL]);
  const update = await awaitUpdateCheck(s.run, { sleep: s.sleep, now: s.now, intervalMs: 3000, limitMs: 45000 });
  assert.equal(update.latest, "7.23.8");
  assert.equal(update.status, "New version is available");
  assert.equal(s.state.prints, 3);
  assert.deepEqual(s.state.sleeps, [3000, 3000]);
});

test("past the limit the last row is returned as is, never past the bound", async () => {
  const s = session([ROW_PENDING]);
  const update = await awaitUpdateCheck(s.run, { sleep: s.sleep, now: s.now, intervalMs: 3000, limitMs: 45000 });
  assert.equal(update.status, "finding out latest version...");
  assert.equal(update.latest, "7.23.7");
  assert.ok(s.state.clock <= 45000, `polled for ${s.state.clock} ms`);
  assert.equal(s.state.prints, 16); // 0, 3, …, 45 s
});

test("an empty print row yields an empty status and no latest", async () => {
  const run = async () => [];
  const update = await awaitUpdateCheck(run, { sleep: async () => {}, now: () => 0, limitMs: 0 });
  assert.deepEqual(update, { channel: undefined, installed: undefined, latest: undefined, status: "" });
});
