require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const period = require("./absencePeriod");
const on = (from, start, end) => ({ from, to: from, timeRange: start ? { start, end } : null });

test("absence overlaps use half-open wall-clock windows, including adjacent dates", () => {
  const cases = [
    [on("2026-11-09", "09:00", "10:00"), on("2026-11-09", "10:00", "11:00"), false],
    [on("2026-11-09", "09:00", "10:00"), on("2026-11-09", "09:59", "11:00"), true],
    [on("2026-11-09", "23:00", "02:00"), on("2026-11-10", "01:00", "03:00"), true],
    [on("2026-11-09", "23:00", "02:00"), on("2026-11-10", "02:00", "03:00"), false],
    [on("2026-11-09", "23:00", "02:00"), on("2026-11-10"), true],
    [on("2026-11-09"), on("2026-11-10"), false],
    [{ from: new Date("2026-11-08T00:00:00Z"), to: new Date("2026-11-10T00:00:00Z") }, on("2026-11-09", "12:00", "13:00"), true],
  ];
  for (const [left, right, expected] of cases) {
    assert.equal(period.absencePeriodsOverlap(left, right), expected);
    assert.equal(period.absencePeriodsOverlap(right, left), expected);
  }
});

test("human absence period includes date, clocks and overnight marker", () => {
  assert.equal(period.formatAbsencePeriod(on("2026-11-09", "23:00", "02:00")), "09.11.2026, 23:00–02:00 +1");
  assert.equal(period.formatAbsencePeriod(on("2026-11-09", "09:00", "10:00")), "09.11.2026, 09:00–10:00");
  assert.equal(period.formatAbsencePeriod({ from: "2026-11-09", to: "2026-11-10" }), "09.11.2026 — 10.11.2026");
  assert.equal(period.absenceDurationMinutes({ start: "23:00", end: "02:00" }), 180);
});

test("overlap search includes both neighboring calendar dates across month boundary", () => {
  assert.deepEqual(period.absenceSearchBounds({ from: "2026-11-01", to: "2026-11-01" }), {
    from: new Date("2026-10-31T00:00:00Z"), to: new Date("2026-11-02T00:00:00Z"),
  });
});
