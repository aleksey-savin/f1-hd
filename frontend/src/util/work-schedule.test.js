import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayIntervals,
  withIntervals,
  changeInterval,
  removeInterval,
  addPlaceChange,
  appendInterval,
  copyScheduleDays,
  dayIntervalsError,
  scheduleForSave,
} from "./work-schedule.ts";

const day = () => ({
  isWorking: true,
  is24hours: false,
  start: "09:00",
  end: "19:00",
  breakMinutes: 60,
});
const mixed = () =>
  withIntervals(day(), [
    { start: "09:00", end: "11:00", place: "remote" },
    { start: "11:00", end: "19:00", place: "office" },
  ]);

test("old schedules become a single interval with the employee's place", () => {
  assert.deepEqual(dayIntervals(day()), [
    { start: "09:00", end: "19:00", place: "office" },
  ]);
  assert.equal(dayIntervals(day(), true)[0].place, "remote");
});
test("editing a boundary keeps the next interval contiguous and the daily break intact", () => {
  const changed = changeInterval(mixed(), 0, { end: "12:00" });
  assert.equal(changed.intervals[1].start, "12:00");
  assert.equal(changed.end, "19:00");
  assert.equal(changed.breakMinutes, 60);
});
test("editing a later interval start moves the shared boundary in both rows", () => {
  const original = withIntervals(day(), [
    { start: "09:00", end: "11:00", place: "remote" },
    { start: "11:00", end: "18:00", place: "office" },
    { start: "18:00", end: "19:00", place: "remote" },
  ]);
  const changed = changeInterval(original, 1, { start: "12:00" });
  assert.deepEqual(changed.intervals, [
    { start: "09:00", end: "12:00", place: "remote" },
    { start: "12:00", end: "18:00", place: "office" },
    { start: "18:00", end: "19:00", place: "remote" },
  ]);
  assert.equal(dayIntervalsError(changed), null);
  assert.equal(original.intervals[0].end, "11:00");
});
test("sequential rows extend the shift from 09–11 remote to 11–18 office and 18–19 remote", () => {
  const first = withIntervals(day(), [
    { start: "09:00", end: "11:00", place: "remote" },
  ]);
  let current = appendInterval(first, "office");
  assert.deepEqual(current.intervals, [
    { start: "09:00", end: "11:00", place: "remote" },
    { start: "11:00", end: "12:00", place: "office" },
  ]);
  current = changeInterval(current, 1, { end: "18:00" });
  current = appendInterval(current, "remote");
  assert.deepEqual(current.intervals, [
    { start: "09:00", end: "11:00", place: "remote" },
    { start: "11:00", end: "18:00", place: "office" },
    { start: "18:00", end: "19:00", place: "remote" },
  ]);
  assert.equal(current.start, "09:00");
  assert.equal(current.end, "19:00");
  assert.equal(current.breakMinutes, 60);
  assert.equal(dayIntervalsError(current), null);
  assert.equal(first.end, "11:00");
});
test("appending across midnight extends the night shift without losing its places", () => {
  const first = withIntervals({ ...day(), start: "22:00", end: "23:30" }, [
    { start: "22:00", end: "23:30", place: "office" },
  ]);
  const changed = appendInterval(first, "remote");
  assert.deepEqual(changed.intervals, [
    { start: "22:00", end: "23:30", place: "office" },
    { start: "23:30", end: "00:30", place: "remote" },
  ]);
  assert.equal(changed.end, "00:30");
  assert.equal(dayIntervalsError(changed), null);
});
test("adding places in explicit 24 hour mode keeps the fixed midnight boundaries", () => {
  const full = { ...day(), is24hours: true, start: "00:00", end: "00:00" };
  const changed = appendInterval(full, "remote");
  assert.deepEqual(changed.intervals, [
    { start: "00:00", end: "23:00", place: "office" },
    { start: "23:00", end: "00:00", place: "remote" },
  ]);
  const moved = changeInterval(changed, 1, { start: "12:00" });
  assert.equal(moved.intervals[0].end, "12:00");
  assert.equal(moved.is24hours, true);
  assert.equal(dayIntervalsError(moved), null);
});
test("appending beyond 24 hours leaves an editable draft with a duration error", () => {
  const first = withIntervals({ ...day(), start: "09:00", end: "08:30" }, [
    { start: "09:00", end: "08:30", place: "office" },
  ]);
  const changed = appendInterval(first, "remote");
  assert.deepEqual(changed.intervals[1], {
    start: "08:30",
    end: "09:30",
    place: "remote",
  });
  assert.match(dayIntervalsError(changed), /24/);
  const corrected = changeInterval(changed, 1, { end: "08:45" });
  assert.equal(dayIntervalsError(corrected), null);
});
test("a place change splits the day at the chosen time without changing work hours", () => {
  const changed = addPlaceChange(day(), "15:00", "remote");
  assert.deepEqual(changed.intervals, [
    { start: "09:00", end: "15:00", place: "office" },
    { start: "15:00", end: "19:00", place: "remote" },
  ]);
  assert.equal(dayIntervalsError(changed), null);
});
test("deleting either interval preserves the full workday", () => {
  assert.deepEqual(removeInterval(mixed(), 0).intervals, [
    { start: "09:00", end: "19:00", place: "office" },
  ]);
  assert.deepEqual(removeInterval(mixed(), 1).intervals, [
    { start: "09:00", end: "19:00", place: "remote" },
  ]);
});
test("copying to Wednesday and Friday makes independent days", () => {
  const source = { Monday: mixed(), Wednesday: day(), Friday: day() };
  const copied = copyScheduleDays(source, "Monday", ["Wednesday", "Friday"]);
  assert.deepEqual(copied.Wednesday, mixed());
  copied.Wednesday.intervals[0].end = "12:00";
  assert.equal(copied.Monday.intervals[0].end, "11:00");
  assert.equal(copied.Friday.intervals[0].end, "11:00");
  assert.equal(source.Wednesday.intervals, undefined);
});
test("invalid intervals are explained before saving", () => {
  for (const intervals of [
    [],
    [{ start: "09:00", end: "19:00", place: "lunch" }],
    [
      { start: "09:00", end: "11:00", place: "office" },
      { start: "12:00", end: "19:00", place: "remote" },
    ],
  ]) {
    assert.equal(typeof dayIntervalsError({ ...day(), intervals }), "string");
  }
});
test("night shifts can change place after midnight", () => {
  const night = { ...day(), start: "22:00", end: "06:00" };
  const changed = addPlaceChange(night, "01:00", "remote");
  assert.deepEqual(changed.intervals, [
    { start: "22:00", end: "01:00", place: "office" },
    { start: "01:00", end: "06:00", place: "remote" },
  ]);
  assert.equal(dayIntervalsError(changed), null);
});
test("24 hour days keep their explicit flag when split at noon", () => {
  const full = { ...day(), is24hours: true, start: "00:00", end: "00:00" };
  const changed = addPlaceChange(full, "12:00", "remote");
  assert.equal(changed.is24hours, true);
  assert.equal(dayIntervalsError(changed), null);
});

test("disabled days do not submit hidden unfinished intervals, but keep valid saved places", () => {
  const incomplete = changeInterval(mixed(), 0, { end: "" });
  incomplete.isWorking = false;
  const validOff = { ...mixed(), isWorking: false };
  const serialized = scheduleForSave({ Monday: incomplete, Tuesday: validOff });
  assert.equal(serialized.Monday.intervals, undefined);
  assert.deepEqual(serialized.Tuesday.intervals, mixed().intervals);
  assert.equal(
    incomplete.intervals[0].end,
    "",
    "serialization must not change the editor draft",
  );
});
