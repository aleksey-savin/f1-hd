// node --test services/mikrotik/activityProfile.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { slotOf, buildSlots, findQuietWindow } = require("./activityProfile");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (iso) => new Date(iso).getTime();
// 2026-10-09 is a Friday.
const NOW = at("2026-10-09T12:00:00Z");

// One bucket per hour for `days` days back from `now`; the rate comes from the
// UTC hour of the bucket.
const history = (days, rateOf, now = NOW) => {
  const buckets = [];
  for (let hour = now - days * DAY; hour < now; hour += HOUR) {
    const rate = rateOf(new Date(hour).getUTCHours(), new Date(hour).getUTCDay());
    buckets.push({ hour: new Date(hour), bytes: rate * 3600, seconds: 3600 });
  }
  return buckets;
};
const nightDip = (hour) => (hour === 3 || hour === 4 ? 10 : 1000);

test("slotOf is day * 24 + hour in the given zone", () => {
  assert.equal(slotOf(at("2026-10-09T03:30:00Z"), "UTC"), 5 * 24 + 3);
  // 20:00Z Friday is 06:00 Saturday in Vladivostok (UTC+10)
  assert.equal(slotOf(at("2026-10-09T20:00:00Z"), "Asia/Vladivostok"), 6 * 24 + 6);
});

test("not enough history gives no profile", () => {
  assert.equal(buildSlots([], "UTC", NOW), null);
  assert.equal(buildSlots(history(10, nightDip), "UTC", NOW), null);
});

test("slot value is the median rate of its weeks", () => {
  const slots = buildSlots(history(21, nightDip), "UTC", NOW);
  assert.equal(slots.length, 168);
  assert.equal(slots[5 * 24 + 3], 10);
  assert.equal(slots[5 * 24 + 14], 1000);
});

test("a slot seen in too few weeks, or barely covered, is invalid", () => {
  const buckets = history(21, nightDip).filter((bucket) => {
    const date = new Date(bucket.hour);
    // Mondays 10:00 UTC present in only one of the three weeks
    return !(date.getUTCDay() === 1 && date.getUTCHours() === 10) || bucket.hour >= NOW - 7 * DAY;
  });
  const thin = history(21, nightDip).map((bucket) =>
    new Date(bucket.hour).getUTCHours() === 15 ? { ...bucket, seconds: 600, bytes: 600000 } : bucket,
  );
  assert.equal(buildSlots(buckets, "UTC", NOW)[1 * 24 + 10], null);
  assert.equal(buildSlots(thin, "UTC", NOW)[5 * 24 + 15], null);
});

test("blocked slots are invalid", () => {
  const slots = buildSlots(history(21, nightDip), "UTC", NOW, new Set([5 * 24 + 3]));
  assert.equal(slots[5 * 24 + 3], null);
});

test("nearest quiet window is the next night dip", () => {
  const slots = buildSlots(history(21, nightDip), "UTC", NOW);
  assert.deepEqual(findQuietWindow(slots, "UTC", NOW), {
    from: at("2026-10-10T03:00:00Z"),
    to: at("2026-10-10T05:00:00Z"),
    current: false,
  });
});

test("inside a quiet window with time left the window is current", () => {
  const now = at("2026-10-10T03:20:00Z");
  const slots = buildSlots(history(21, nightDip, now), "UTC", now);
  assert.deepEqual(findQuietWindow(slots, "UTC", now), {
    from: at("2026-10-10T03:00:00Z"),
    to: at("2026-10-10T05:00:00Z"),
    current: true,
  });
});

test("less than 30 minutes left moves on to the next window", () => {
  const now = at("2026-10-10T04:45:00Z");
  const slots = buildSlots(history(21, nightDip, now), "UTC", now);
  assert.deepEqual(findQuietWindow(slots, "UTC", now), {
    from: at("2026-10-11T03:00:00Z"),
    to: at("2026-10-11T05:00:00Z"),
    current: false,
  });
});

test("a current window stretches through the following quiet hours", () => {
  const wide = (hour) => (hour >= 1 && hour <= 5 ? 10 : 1000);
  const now = at("2026-10-10T01:10:00Z");
  const slots = buildSlots(history(21, wide, now), "UTC", now);
  assert.deepEqual(findQuietWindow(slots, "UTC", now), {
    from: at("2026-10-10T01:00:00Z"),
    to: at("2026-10-10T06:00:00Z"),
    current: true,
  });
});

test("a flat profile recommends nothing", () => {
  const slots = buildSlots(history(21, () => 500), "UTC", NOW);
  assert.equal(findQuietWindow(slots, "UTC", NOW), null);
  const almostFlat = buildSlots(history(21, (hour) => (hour === 3 ? 400 : 500)), "UTC", NOW);
  assert.equal(findQuietWindow(almostFlat, "UTC", NOW), null);
});

test("no profile or no valid pair recommends nothing", () => {
  assert.equal(findQuietWindow(null, "UTC", NOW), null);
  assert.equal(findQuietWindow(new Array(168).fill(null), "UTC", NOW), null);
});

test("blocking the dip leaves a flat rest and no recommendation", () => {
  const blocked = new Set();
  for (let day = 0; day < 7; day += 1) for (const hour of [2, 3, 4, 5]) blocked.add(day * 24 + hour);
  const slots = buildSlots(history(21, nightDip), "UTC", NOW, blocked);
  assert.equal(findQuietWindow(slots, "UTC", NOW), null);
});

test("a silent device (all zero) recommends nothing", () => {
  const slots = buildSlots(history(21, () => 0), "UTC", NOW);
  assert.equal(findQuietWindow(slots, "UTC", NOW), null);
});
