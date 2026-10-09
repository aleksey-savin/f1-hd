// node --test services/mikrotik/backupState.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { backupView } = require("./backupState");

const LAST = new Date("2026-10-09T00:00:00Z");
const NEXT = new Date("2026-10-10T00:00:00Z");

test("schedule off: none without copies, noSchedule with manual ones", () => {
  assert.deepEqual(backupView({ frequency: "off" }, null), {
    state: "none",
    lastAt: null,
    nextAt: null,
  });
  assert.deepEqual(backupView(undefined, null).state, "none");
  assert.deepEqual(backupView({ frequency: "off", nextRunAt: NEXT }, LAST), {
    state: "noSchedule",
    lastAt: LAST,
    nextAt: null,
  });
});

test("schedule on: pending until the first copy, then ok", () => {
  const schedule = { frequency: "daily", nextRunAt: NEXT };
  assert.deepEqual(backupView(schedule, null), {
    state: "pending",
    lastAt: null,
    nextAt: NEXT,
  });
  assert.deepEqual(backupView(schedule, LAST), {
    state: "ok",
    lastAt: LAST,
    nextAt: NEXT,
  });
});

test("schedule on with a failed last run: failed, even with older copies", () => {
  const schedule = { frequency: "weekly", lastError: "ssh timeout", nextRunAt: NEXT };
  assert.equal(backupView(schedule, LAST).state, "failed");
  assert.equal(backupView(schedule, null).state, "failed");
});

// Prod, 09.10: SSH was fixed on the device, a manual export succeeded, and the
// record still showed the error of the last scheduled run.
test("a copy taken after the failed run supersedes the error", () => {
  const failedRun = new Date("2026-10-08T17:02:00Z");
  const schedule = {
    frequency: "daily",
    lastError: "Timed out while waiting for handshake",
    lastRunAt: failedRun,
    nextRunAt: NEXT,
  };
  assert.equal(backupView(schedule, new Date("2026-10-09T03:00:00Z")).state, "ok");
  // A copy older than the failed run does not.
  assert.equal(backupView(schedule, new Date("2026-10-07T17:02:00Z")).state, "failed");
});
