import { test } from "node:test";
import assert from "node:assert/strict";
import {
  absenceDurationMinutes,
  absencePeriodError,
  formatAbsencePeriod,
  formatAbsenceDuration,
  formatAbsenceScheduleWindow,
} from "./absence-period.ts";

const date = (key) =>
  ({ "2026-11-09": "09.11.2026", "2026-11-10": "10.11.2026" })[key];
const period = (timeRange) => ({
  from: "2026-11-09",
  to: "2026-11-09",
  timeRange,
});

test("partial absence labels retain date, clocks and the next-day marker", () => {
  assert.equal(
    formatAbsencePeriod(period({ start: "14:00", end: "17:30" }), date),
    "09.11.2026 · 14:00–17:30",
  );
  assert.equal(
    formatAbsencePeriod(period({ start: "22:00", end: "02:30" }), date),
    "09.11.2026 · 22:00–02:30 +1",
  );
  assert.equal(formatAbsencePeriod(period(null), date), "09.11.2026");
  assert.equal(
    formatAbsencePeriod({ from: "2026-11-09", to: "2026-11-10" }, date),
    "09.11.2026 — 10.11.2026",
  );
});

test("duration counts overnight hours and rejects zero or invalid clocks", () => {
  assert.equal(absenceDurationMinutes({ start: "22:00", end: "02:30" }), 270);
  assert.equal(absenceDurationMinutes({ start: "14:00", end: "17:30" }), 210);
  for (const range of [
    null,
    { start: "10:00", end: "10:00" },
    { start: "24:00", end: "01:00" },
    { start: "9:00", end: "10:00" },
    { start: "", end: "10:00" },
  ]) {
    assert.equal(absenceDurationMinutes(range), null);
  }
  assert.equal(formatAbsenceDuration(270), "4 ч 30 мин");
  assert.equal(formatAbsenceDuration(60), "1 ч");
  assert.equal(formatAbsenceDuration(15), "15 мин");
});

test("partial requests require one date and a valid nonzero range; whole-day ranges remain valid", () => {
  assert.equal(
    absencePeriodError(period({ start: "22:00", end: "02:30" })),
    null,
  );
  assert.equal(
    absencePeriodError({ from: "2026-11-09", to: "2026-11-10" }),
    null,
  );
  for (const value of [
    period({ start: "10:00", end: "10:00" }),
    { ...period({ start: "10:00", end: "11:00" }), to: "2026-11-10" },
    { from: "", to: "" },
    { from: "2026-11-10", to: "2026-11-09" },
  ]) {
    assert.equal(typeof absencePeriodError(value), "string");
  }
});

test("schedule hints convert planner minutes to clocks, retaining midnight rollover", () => {
  assert.equal(
    formatAbsenceScheduleWindow({
      start: 540,
      end: 1140,
      crossesMidnight: false,
    }),
    "09:00–19:00",
  );
  assert.equal(
    formatAbsenceScheduleWindow({
      start: 1320,
      end: 1800,
      crossesMidnight: true,
    }),
    "22:00–06:00 +1",
  );
});
