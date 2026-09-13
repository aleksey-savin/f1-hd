// node --test src/components/Work/time-range.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatWorkRange } from "./time-range.js";

const options = {
  today: "2026-09-13",
  formatDay: (key) => key.split("-").reverse().join("."),
};

test("a work of today reads as a sentence", () => {
  assert.equal(
    formatWorkRange("2026-09-13T13:50", "2026-09-13T14:20", options),
    "Сегодня, 13:50 – 14:20",
  );
});

test("yesterday is named, older days get a date", () => {
  assert.equal(
    formatWorkRange("2026-09-12T10:00", "2026-09-12T11:30", options),
    "Вчера, 10:00 – 11:30",
  );
  assert.equal(
    formatWorkRange("2026-09-01T10:00", "2026-09-01T11:30", options),
    "01.09.2026, 10:00 – 11:30",
  );
});

test("a work across midnight names both days", () => {
  assert.equal(
    formatWorkRange("2026-09-12T23:30", "2026-09-13T00:30", options),
    "Вчера 23:30 – сегодня 00:30",
  );
});

test("the yesterday label survives a month boundary", () => {
  assert.equal(
    formatWorkRange("2026-08-31T09:00", "2026-08-31T09:15", {
      ...options,
      today: "2026-09-01",
    }),
    "Вчера, 09:00 – 09:15",
  );
});

test("nothing to say until both ends are set", () => {
  assert.equal(formatWorkRange("", "2026-09-13T14:20", options), "");
  assert.equal(formatWorkRange("2026-09-13T13:50", "", options), "");
});
