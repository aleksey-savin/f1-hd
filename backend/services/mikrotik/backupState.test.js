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
