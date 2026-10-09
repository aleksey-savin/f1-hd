// node --test src/components/Mikrotik/activity-format.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  clockIn,
  plannedSummary,
  plannedSlotSet,
  slotLevels,
  quietLabel,
} from "./activity-format.js";

const ZONE = "Asia/Vladivostok"; // UTC+10
const NOW = new Date("2026-10-09T02:00:00Z"); // Friday 12:00 local

test("clockIn formats an instant in the given zone", () => {
  assert.equal(clockIn("2026-10-08T21:00:00Z", ZONE), "07:00");
});

test("plannedSummary names days and time", () => {
  assert.equal(plannedSummary([]), null);
  assert.equal(
    plannedSummary([{ days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "07:00" }]),
    "Ежедневно, 22:00–07:00",
  );
  assert.equal(
    plannedSummary([{ days: [1, 2, 3, 4, 5], start: "22:00", end: "07:00" }]),
    "Пн–пт, 22:00–07:00",
  );
  assert.equal(
    plannedSummary([
      { days: [1, 3], start: "22:00", end: "07:00" },
      { days: [6, 0], start: "18:00", end: "09:00" },
    ]),
    "Пн, ср, 22:00–07:00; сб, вс, 18:00–09:00",
  );
});

test("plannedSlotSet mirrors the backend slots", () => {
  const slots = plannedSlotSet([{ days: [1], start: "22:00", end: "07:00" }]);
  assert.equal(slots.size, 9);
  assert.ok(slots.has(1 * 24 + 22) && slots.has(2 * 24 + 6));
  assert.equal(slots.has(2 * 24 + 7), false);
  assert.deepEqual(
    [...plannedSlotSet([{ days: [6], start: "23:00", end: "01:00" }])].sort((a, b) => a - b),
    [0, 6 * 24 + 23],
  );
  assert.equal(plannedSlotSet([{ days: [1], start: "x", end: "07:00" }]).size, 0);
});

test("slotLevels ranks against the busiest slot", () => {
  assert.deepEqual(slotLevels([null, 0, 10, 30, 50, 100]), [null, 1, 1, 2, 3, 4]);
  assert.deepEqual(slotLevels([null, null]), [null, null]);
  assert.deepEqual(slotLevels([0, 0]), [1, 1]);
});

test("quietLabel says today, tomorrow or the weekday", () => {
  const window = (from, to, current = false) => ({ from, to, current });
  assert.equal(quietLabel(null, ZONE, NOW), null);
  assert.equal(
    quietLabel(window("2026-10-09T10:00:00Z", "2026-10-09T12:00:00Z"), ZONE, NOW),
    "сегодня 20:00–22:00",
  );
  assert.equal(
    quietLabel(window("2026-10-09T17:00:00Z", "2026-10-09T19:00:00Z"), ZONE, NOW),
    "завтра 03:00–05:00",
  );
  assert.equal(
    quietLabel(window("2026-10-11T17:00:00Z", "2026-10-11T19:00:00Z"), ZONE, NOW),
    "пн 03:00–05:00",
  );
  assert.equal(
    quietLabel(window("2026-10-09T01:00:00Z", "2026-10-09T04:00:00Z", true), ZONE, NOW),
    "до 14:00",
  );
});
