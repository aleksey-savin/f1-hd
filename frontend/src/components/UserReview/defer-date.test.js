import { test } from "node:test";
import assert from "node:assert/strict";
import { deferredDateAfter } from "./defer-date.ts";

test("defer presets count calendar days across month, leap-year and year boundaries", () => {
  assert.equal(deferredDateAfter("2026-01-31", 30), "2026-03-02");
  assert.equal(deferredDateAfter("2028-01-31", 30), "2028-03-01");
  assert.equal(deferredDateAfter("2026-12-15", 60), "2027-02-13");
  assert.equal(deferredDateAfter("2026-11-09", 90), "2027-02-07");
});

test("defer presets preserve the selected business day across browser DST changes", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(deferredDateAfter("2026-10-15", 30), "2026-11-14");
    assert.equal(deferredDateAfter("2026-03-01", 30), "2026-03-31");
    process.env.TZ = "Pacific/Honolulu";
    assert.equal(deferredDateAfter("2026-11-09", 30), "2026-12-09");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
