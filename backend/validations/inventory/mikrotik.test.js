// node --test validations/inventory/mikrotik.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePlannedOffline } = require("./mikrotik");

test("accepts and normalises a list of windows", () => {
  const got = parsePlannedOffline({
    windows: [{ days: [5, 1, 1, "3"], start: "22:00", end: "07:00", extra: "x" }],
  });
  assert.deepEqual(got, { windows: [{ days: [1, 3, 5], start: "22:00", end: "07:00" }] });
});

test("an empty list clears the windows", () => {
  assert.deepEqual(parsePlannedOffline({ windows: [] }), { windows: [] });
});

test("rejects a missing list, bad days, bad clock, zero length and too many", () => {
  const window = { days: [1], start: "22:00", end: "07:00" };
  assert.ok(parsePlannedOffline({}).error);
  assert.ok(parsePlannedOffline({ windows: "no" }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, days: [] }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, days: [7] }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, start: "25:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, end: "7:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, end: "22:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: Array(8).fill(window) }).error);
});
