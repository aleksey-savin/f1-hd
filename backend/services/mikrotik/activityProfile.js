// Weekly activity profile of a Mikrotik device — pure (no I/O).
//
// Hourly traffic buckets fold into 168 hour-of-week slots in the org timezone
// (slot = day * 24 + hour, 0 = Sunday 00:00). The profile answers one question:
// when is the nearest two-hour stretch in which this device is usually quiet —
// the hint of the firmware upgrade dialog. It is advice; nothing is scheduled.
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const SLOT_COUNT = 168;

// A bucket must cover at least half of its hour to speak for it.
const MIN_SECONDS = 1800;
// Two weeks before any advice: one week is an anecdote.
const MIN_DAYS = 14;
// Share of the min..max range that still counts as quiet.
const QUIET_SHARE = 0.15;
// A window that ends in less than this is not worth starting an upgrade in.
const MIN_LEFT_MS = 30 * 60 * 1000;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const slotOf = (ms, zone) => {
  const local = dayjs(ms).tz(zone);
  return local.day() * 24 + local.hour();
};

// 168 median rates (bytes/second); null — the slot cannot be judged: seen in
// too few weeks (a device that is usually off then has no buckets at all) or
// blocked by a planned offline window. null for the whole profile — not enough
// history yet.
const buildSlots = (buckets, zone, nowMs, blocked = new Set()) => {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  let firstMs = Infinity;
  const rates = Array.from({ length: SLOT_COUNT }, () => []);
  for (const bucket of buckets) {
    const hour = new Date(bucket.hour).getTime();
    firstMs = Math.min(firstMs, hour);
    if (!(bucket.seconds >= MIN_SECONDS)) continue;
    rates[slotOf(hour, zone)].push(bucket.bytes / bucket.seconds);
  }
  if (nowMs - firstMs < MIN_DAYS * DAY_MS) return null;

  const weeks = Math.floor((nowMs - firstMs) / WEEK_MS);
  const needed = Math.max(2, Math.ceil(weeks * 0.75));
  return rates.map((list, index) =>
    blocked.has(index) || list.length < needed ? null : median(list),
  );
};

// The nearest quiet two-hour window: { from, to, current } in ms, or null.
// Quiet = score within the lowest QUIET_SHARE of the min..max range of all
// two-slot scores. A percentile would not do: on a flat profile ties make every
// window «quiet». A profile without contrast recommends nothing at all.
const findQuietWindow = (slots, zone, nowMs) => {
  if (!Array.isArray(slots)) return null;

  const scoreOf = (index) => {
    const first = slots[index];
    const second = slots[(index + 1) % SLOT_COUNT];
    return first === null || second === null ? null : first + second;
  };
  const scores = slots.map((_, index) => scoreOf(index)).filter((value) => value !== null);
  if (scores.length === 0) return null;

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === 0 || max < min * 2) return null;
  const limit = min + (max - min) * QUIET_SHARE;

  const quietAt = (startMs) => {
    const score = scoreOf(slotOf(startMs, zone));
    return score !== null && score <= limit;
  };

  const thisHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  for (const start of [thisHour - HOUR_MS, thisHour]) {
    if (!quietAt(start)) continue;
    let to = start + 2 * HOUR_MS;
    while (to - start < DAY_MS && quietAt(to - HOUR_MS)) to += HOUR_MS;
    if (to - nowMs < MIN_LEFT_MS) continue;
    return { from: start, to, current: true };
  }

  for (let step = 1; step <= SLOT_COUNT; step += 1) {
    const start = thisHour + step * HOUR_MS;
    if (quietAt(start)) return { from: start, to: start + 2 * HOUR_MS, current: false };
  }
  return null;
};

module.exports = { slotOf, buildSlots, findQuietWindow };
