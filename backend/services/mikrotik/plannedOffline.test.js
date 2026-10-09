// node --test services/mikrotik/plannedOffline.test.js
// workWindow resolves `@/services/dateKeys` through module-alias.
require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TOLERANCE_MS,
  normalizeWindows,
  plannedIntervals,
  plannedAt,
  plannedSlots,
  alertDecision,
  plannedUntil,
  summarizeDowntime,
  isPlannedEpisode,
  suggestWindow,
} = require("./plannedOffline");

// Asia/Vladivostok is UTC+10, no DST: 22:00 local = 12:00Z, 07:00 local = 21:00Z
// of the previous UTC day. 2026-10-05 is a Monday.
const ZONE = "Asia/Vladivostok";
const at = (iso) => new Date(iso).getTime();
const MIN = 60 * 1000;
const NIGHTLY = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "07:00" }];
const MONDAY = [{ days: [1], start: "22:00", end: "07:00" }];

test("normalizeWindows drops malformed windows", () => {
  assert.deepEqual(normalizeWindows(undefined), []);
  assert.deepEqual(
    normalizeWindows([
      { days: [], start: "22:00", end: "07:00" },
      { days: [1], start: "22:00", end: "22:00" },
      { days: [1], start: "25:99", end: "07:00" },
      { days: [9], start: "22:00", end: "07:00" },
      { days: [1], start: "x", end: "07:00" },
    ]),
    [],
  );
  assert.deepEqual(normalizeWindows(MONDAY), [{ days: [1], start: 1320, end: 1860 }]);
});

test("a window crossing midnight becomes one interval on its start day", () => {
  const got = plannedIntervals(MONDAY, at("2026-10-04T00:00:00Z"), at("2026-10-08T00:00:00Z"), ZONE);
  assert.deepEqual(got, [{ from: at("2026-10-05T12:00:00Z"), to: at("2026-10-05T21:00:00Z") }]);
});

test("Tuesday 03:00 is inside Monday's window; Wednesday 03:00 is not", () => {
  assert.ok(plannedAt(MONDAY, at("2026-10-05T17:00:00Z"), ZONE));
  assert.equal(plannedAt(MONDAY, at("2026-10-06T17:00:00Z"), ZONE), null);
});

test("tolerance widens the window on both sides", () => {
  const before = at("2026-10-05T11:40:00Z"); // 21:40 local
  const after = at("2026-10-05T21:25:00Z"); // 07:25 local
  assert.equal(plannedAt(MONDAY, before, ZONE), null);
  assert.ok(plannedAt(MONDAY, before, ZONE, TOLERANCE_MS));
  assert.ok(plannedAt(MONDAY, after, ZONE, TOLERANCE_MS));
  assert.equal(plannedAt(MONDAY, at("2026-10-05T21:31:00Z"), ZONE, TOLERANCE_MS), null);
});

test("adjacent windows merge", () => {
  const windows = [
    { days: [1], start: "20:00", end: "23:00" },
    { days: [1], start: "23:00", end: "02:00" },
  ];
  const got = plannedIntervals(windows, at("2026-10-05T00:00:00Z"), at("2026-10-06T00:00:00Z"), ZONE);
  assert.equal(got.length, 1);
  assert.equal(got[0].to - got[0].from, 6 * 60 * MIN);
});

test("plannedSlots covers the hours of the window, including after midnight", () => {
  const slots = plannedSlots(MONDAY);
  assert.ok(slots.has(1 * 24 + 22));
  assert.ok(slots.has(1 * 24 + 23));
  assert.ok(slots.has(2 * 24 + 0));
  assert.ok(slots.has(2 * 24 + 6));
  assert.equal(slots.has(2 * 24 + 7), false);
  assert.equal(slots.has(1 * 24 + 21), false);
  assert.equal(slots.size, 9);
});

test("plannedSlots wraps Saturday night into Sunday", () => {
  const slots = plannedSlots([{ days: [6], start: "23:00", end: "01:00" }]);
  assert.deepEqual([...slots].sort((a, b) => a - b), [0, 6 * 24 + 23]);
});

test("alert is suppressed inside the window and its tolerance", () => {
  const record = { plannedOffline: NIGHTLY, offlineSince: new Date("2026-10-05T12:05:00Z") };
  assert.deepEqual(alertDecision(record, at("2026-10-05T12:20:00Z"), ZONE), {
    suppress: true,
    missed: null,
  });
  assert.equal(alertDecision(record, at("2026-10-05T21:29:00Z"), ZONE).suppress, true);
});

test("a device that did not return gets a ticket naming the missed window", () => {
  const record = { plannedOffline: MONDAY, offlineSince: new Date("2026-10-05T12:05:00Z") };
  const got = alertDecision(record, at("2026-10-05T21:31:00Z"), ZONE);
  assert.equal(got.suppress, false);
  assert.deepEqual(got.missed, { from: at("2026-10-05T12:00:00Z"), to: at("2026-10-05T21:00:00Z") });
});

test("an outage outside any window is an ordinary alert", () => {
  const record = { plannedOffline: MONDAY, offlineSince: new Date("2026-10-07T03:00:00Z") };
  assert.deepEqual(alertDecision(record, at("2026-10-07T03:20:00Z"), ZONE), {
    suppress: false,
    missed: null,
  });
  assert.deepEqual(alertDecision({ offlineSince: new Date() }, Date.now(), ZONE), {
    suppress: false,
    missed: null,
  });
});

test("malformed stored windows never suppress an alert", () => {
  const record = {
    plannedOffline: [{ days: [1], start: "25:99", end: "07:00" }],
    offlineSince: new Date("2026-10-05T12:05:00Z"),
  };
  assert.equal(alertDecision(record, at("2026-10-05T12:20:00Z"), ZONE).suppress, false);
});

test("plannedUntil is set only for an offline monitored device inside a window", () => {
  const now = at("2026-10-05T15:00:00Z");
  const base = {
    plannedOffline: MONDAY,
    monitoringEnabled: true,
    status: "offline",
    offlineSince: new Date("2026-10-05T12:05:00Z"),
  };
  assert.deepEqual(plannedUntil(base, now, ZONE), new Date("2026-10-05T21:00:00Z"));
  assert.equal(plannedUntil({ ...base, status: "online" }, now, ZONE), null);
  assert.equal(plannedUntil({ ...base, monitoringEnabled: false }, now, ZONE), null);
  assert.equal(plannedUntil(base, at("2026-10-07T15:00:00Z"), ZONE), null);
});

test("planned time is removed from both the window and the downtime", () => {
  const from = at("2026-10-05T00:00:00Z");
  const to = at("2026-10-06T00:00:00Z");
  const planned = plannedIntervals(MONDAY, from, to, ZONE); // 12:00Z–21:00Z, 9 h
  // one episode fully inside the window, one that outlasts it by 2 h 05 min
  const inside = summarizeDowntime([[at("2026-10-05T12:04:00Z"), at("2026-10-05T20:52:00Z")]], planned, from, to);
  assert.equal(inside.downtimeMs, 0);
  assert.equal(inside.outageCount, 0);
  assert.equal(inside.windowMs, 15 * 60 * MIN);

  const late = summarizeDowntime([[at("2026-10-05T12:01:00Z"), at("2026-10-05T23:05:00Z")]], planned, from, to);
  assert.equal(late.downtimeMs, 125 * MIN);
  assert.equal(late.longestMs, 125 * MIN);
  assert.equal(late.outageCount, 1);
});

test("without windows the summary equals the plain sum", () => {
  const from = at("2026-10-05T00:00:00Z");
  const to = at("2026-10-06T00:00:00Z");
  const got = summarizeDowntime([[from + 10 * MIN, from + 55 * MIN]], [], from, to);
  assert.equal(got.downtimeMs, 45 * MIN);
  assert.equal(got.windowMs, 24 * 60 * MIN);
  assert.equal(got.outageCount, 1);
});

test("isPlannedEpisode allows the tolerance but not an overrun", () => {
  const planned = [{ from: at("2026-10-05T12:00:00Z"), to: at("2026-10-05T21:00:00Z") }];
  assert.equal(isPlannedEpisode(at("2026-10-05T11:45:00Z"), at("2026-10-05T21:10:00Z"), planned), true);
  assert.equal(isPlannedEpisode(at("2026-10-05T12:01:00Z"), at("2026-10-05T23:05:00Z"), planned), false);
});

// 14 nights in a row, off about 22:05–06:50 local, jittered by a few minutes.
const nightlyEpisodes = (nights, endDay) =>
  Array.from({ length: nights }, (_, index) => {
    const day = at(`2026-10-${String(endDay).padStart(2, "0")}T00:00:00Z`) - index * 24 * 60 * MIN;
    const jitter = (index % 3) * 4 * MIN;
    return {
      startedAt: new Date(day + 12 * 60 * MIN + 5 * MIN + jitter), // ~22:05 local
      endedAt: new Date(day + 20 * 60 * MIN + 50 * MIN - jitter), // ~06:50 local
    };
  });

test("suggests a nightly window from a steady pattern", () => {
  const now = at("2026-10-09T02:00:00Z");
  const got = suggestWindow(nightlyEpisodes(14, 8), [], ZONE, now);
  assert.deepEqual(got.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(got.start, "22:00");
  assert.equal(got.end, "07:00");
  assert.equal(got.matched, 14);
  assert.equal(got.total, 21);
});

test("no suggestion from too few nights, short blips or open episodes", () => {
  const now = at("2026-10-09T02:00:00Z");
  assert.equal(suggestWindow(nightlyEpisodes(9, 8), [], ZONE, now), null);
  const blips = Array.from({ length: 14 }, (_, index) => ({
    startedAt: new Date(now - (index + 1) * 24 * 60 * MIN),
    endedAt: new Date(now - (index + 1) * 24 * 60 * MIN + 45 * MIN),
  }));
  assert.equal(suggestWindow(blips, [], ZONE, now), null);
  assert.equal(suggestWindow([{ startedAt: new Date(now - 60 * MIN), endedAt: null }], [], ZONE, now), null);
});

test("no suggestion when a window already covers the pattern", () => {
  const now = at("2026-10-09T02:00:00Z");
  assert.equal(suggestWindow(nightlyEpisodes(14, 8), NIGHTLY, ZONE, now), null);
});

test("starts scattered around midnight still give one window", () => {
  const now = at("2026-10-09T02:00:00Z");
  // off 23:50 or 00:10 local (13:50Z / 14:10Z), back at 06:00 local (20:00Z)
  const episodes = Array.from({ length: 14 }, (_, index) => {
    const day = at("2026-10-08T00:00:00Z") - index * 24 * 60 * MIN;
    const start = index % 2 ? 13 * 60 * MIN + 50 * MIN : 14 * 60 * MIN + 10 * MIN;
    return { startedAt: new Date(day + start), endedAt: new Date(day + 20 * 60 * MIN) };
  });
  const got = suggestWindow(episodes, [], ZONE, now);
  assert.equal(got.start, "23:45");
  assert.equal(got.end, "06:00");
  assert.equal(got.days.length, 7);
});

test("a device that is down most of the day gets no suggestion", () => {
  const now = at("2026-10-09T02:00:00Z");
  // up for two hours a day — that is an outage, not a schedule
  const longDaily = Array.from({ length: 14 }, (_, index) => {
    const start = at("2026-10-08T03:45:00Z") - index * 24 * 60 * MIN;
    return { startedAt: new Date(start), endedAt: new Date(start + 22 * 60 * MIN) };
  });
  assert.equal(suggestWindow(longDaily, [], ZONE, now), null);
});

test("long outages at scattered times are not a schedule", () => {
  const now = at("2026-10-09T02:00:00Z");
  const scattered = Array.from({ length: 16 }, (_, index) => {
    const start = at("2026-10-08T00:00:00Z") - index * 24 * 60 * MIN + ((index * 5) % 8) * 60 * MIN;
    return { startedAt: new Date(start), endedAt: new Date(start + 5 * 60 * MIN) };
  });
  assert.equal(suggestWindow(scattered, [], ZONE, now), null);
});

test("one episode per day is counted, so matched never exceeds the lookback", () => {
  const now = at("2026-10-09T02:00:00Z");
  const nightly = nightlyEpisodes(14, 8);
  // a second, shorter outage on each of those days
  const extra = nightly.map((episode) => ({
    startedAt: new Date(new Date(episode.startedAt).getTime() - 6 * 60 * MIN),
    endedAt: new Date(new Date(episode.startedAt).getTime() - 3 * 60 * MIN),
  }));
  const got = suggestWindow([...nightly, ...extra], [], ZONE, now);
  assert.equal(got.matched, 14);
  assert.equal(got.start, "22:00");
  assert.equal(got.end, "07:00");
});

// --- Final review fixes -------------------------------------------------------

test("a nightly cut that starts early and ends late is no downtime at all", () => {
  const from = at("2026-10-05T00:00:00Z");
  const to = at("2026-10-06T00:00:00Z");
  const planned = plannedIntervals(MONDAY, from, to, ZONE); // 12:00Z–21:00Z
  // off 21:55 local, back 07:05 local — five minutes over on both sides
  const got = summarizeDowntime(
    [[at("2026-10-05T11:55:00Z"), at("2026-10-05T21:05:00Z")]],
    planned,
    from,
    to,
  );
  assert.equal(got.downtimeMs, 0);
  assert.equal(got.outageCount, 0);
  assert.deepEqual(got.chunks, []);
});

test("an overrun beyond the tolerance still counts from the window's end", () => {
  const from = at("2026-10-05T00:00:00Z");
  const to = at("2026-10-06T00:00:00Z");
  const planned = plannedIntervals(MONDAY, from, to, ZONE);
  const got = summarizeDowntime(
    [[at("2026-10-05T11:55:00Z"), at("2026-10-05T23:05:00Z")]],
    planned,
    from,
    to,
  );
  assert.equal(got.downtimeMs, 125 * MIN);
  assert.equal(got.outageCount, 1);
});

test("a real outage does not turn «planned» when the clock enters a window", () => {
  const now = at("2026-10-05T15:00:00Z"); // inside Monday's window
  const base = { plannedOffline: MONDAY, monitoringEnabled: true, status: "offline" };
  // went down at noon local, long before the window
  assert.equal(plannedUntil({ ...base, offlineSince: new Date("2026-10-05T02:00:00Z") }, now, ZONE), null);
  // went down in LAST week's window and never came back
  assert.equal(plannedUntil({ ...base, offlineSince: new Date("2026-09-28T12:05:00Z") }, now, ZONE), null);
  // already alerted — a ticket exists, it is an incident
  const inWindow = { ...base, offlineSince: new Date("2026-10-05T12:05:00Z") };
  assert.equal(plannedUntil({ ...inWindow, offlineAlertedAt: new Date() }, now, ZONE), null);
  assert.equal(plannedUntil({ ...inWindow, alertTicketId: "t" }, now, ZONE), null);
  assert.deepEqual(plannedUntil(inWindow, now, ZONE), new Date("2026-10-05T21:00:00Z"));
});

test("a drop AFTER the window is not «did not return»", () => {
  const record = { plannedOffline: MONDAY, offlineSince: new Date("2026-10-05T21:10:00Z") };
  // 07:10 local, window ended 07:00; alert tick at 07:40
  assert.deepEqual(alertDecision(record, at("2026-10-05T21:40:00Z"), ZONE), {
    suppress: false,
    missed: null,
  });
});
