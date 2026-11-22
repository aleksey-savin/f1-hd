const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calendarDateRange, graceDeadline } = require("./datetime");

test("calendar ranges support open bounds and reject invalid or reversed days", () => {
  assert.deepEqual(calendarDateRange(), {});
  assert.equal(calendarDateRange("2026-01-01", null, "UTC").$gte.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(calendarDateRange(null, "2026-12-31", "UTC").$lt.toISOString(), "2027-01-01T00:00:00.000Z");
  for (const day of ["2026-02-30", "not-a-date", "2026-01-01T00:00:00Z", ["2026-01-01"]]) {
    assert.throws(() => calendarDateRange(day, null, "UTC"), RangeError);
  }
  assert.throws(() => calendarDateRange("2026-11-23", "2026-11-22", "UTC"), RangeError);
});

test("grace deadlines preserve explicit instants and interpret legacy unzoned values in organization time", () => {
  for (const host of ["UTC", "America/New_York", "Asia/Vladivostok"]) {
    const previous = process.env.TZ;
    try {
      process.env.TZ = host;
      assert.equal(graceDeadline("2026-11-22", "Asia/Vladivostok").toISOString(), "2026-11-22T13:59:59.999Z");
      assert.equal(graceDeadline("2026-11-22T23:59:59", "Asia/Vladivostok").toISOString(), "2026-11-22T13:59:59.000Z");
      assert.equal(graceDeadline("2026-11-22T23:59:59Z", "Asia/Vladivostok").toISOString(), "2026-11-22T23:59:59.000Z");
      assert.equal(graceDeadline("2026-11-22T23:59:59+03:00", "Asia/Vladivostok").toISOString(), "2026-11-22T20:59:59.000Z");
      assert.equal(graceDeadline("2026-03-08", "America/New_York").toISOString(), "2026-03-09T03:59:59.999Z");
      assert.equal(graceDeadline("2026-11-01", "America/New_York").toISOString(), "2026-11-02T04:59:59.999Z");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }
  assert.equal(graceDeadline(null, "UTC"), null);
  for (const value of ["2026-02-30", "tomorrow", "2026-11-22T99:99:99"]) {
    assert.throws(() => graceDeadline(value, "UTC"), RangeError);
  }
});
