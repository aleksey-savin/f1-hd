// Planned offline windows of a monitored Mikrotik device — pure (no I/O).
//
// A window says «the device is switched off on purpose»: no offline ticket, no
// downtime. Windows are stored on the record as { days, start, end } in the org
// timezone; `days` is 0 = Sunday … 6 and names the day the window STARTS, an
// `end` earlier than `start` ends the next day. Anything malformed is dropped
// by normalizeWindows, so broken data always falls back to «no window» — for
// alerts that means a ticket, which is the safe side.
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const {
  instantOf,
  shiftDayKey,
  windowMinutes,
  subtractWindows,
  intersectWindows,
} = require("../workWindow");
const { keyToUtc, pad } = require("../dateKeys");

// Power is not cut to the minute: an outage that starts a little early or a
// device that boots a little late is still the planned one.
const TOLERANCE_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 1440;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const normalizeWindows = (raw) => {
  if (!Array.isArray(raw)) return [];
  const list = [];
  for (const item of raw) {
    if (!CLOCK.test(item?.start) || !CLOCK.test(item?.end)) continue;
    const days = Array.isArray(item.days)
      ? [...new Set(item.days.map(Number))].filter(
          (day) => Number.isInteger(day) && day >= 0 && day <= 6,
        )
      : [];
    const minutes = windowMinutes(item.start, item.end);
    if (days.length === 0 || !minutes) continue;
    list.push({ days, start: minutes.start, end: minutes.end });
  }
  return list;
};

const dateKeyAt = (ms, zone) => dayjs(ms).tz(zone).format("YYYY-MM-DD");

// Concrete intervals overlapping [fromMs, toMs] — merged, sorted, with their
// REAL bounds (not clamped to the range).
const plannedIntervals = (windows, fromMs, toMs, zone) => {
  const list = normalizeWindows(windows);
  if (list.length === 0 || !(toMs > fromMs)) return [];

  const found = [];
  try {
    const lastKey = dateKeyAt(toMs, zone);
    // One day back: yesterday's window may still be running at `fromMs`.
    for (
      let key = shiftDayKey(dateKeyAt(fromMs, zone), -1);
      key <= lastKey;
      key = shiftDayKey(key, 1)
    ) {
      const dow = keyToUtc(key).getUTCDay();
      for (const window of list) {
        if (!window.days.includes(dow)) continue;
        const from = instantOf(key, window.start, zone);
        const to = instantOf(key, window.end, zone);
        if (to > fromMs && from < toMs) found.push({ from, to });
      }
    }
  } catch {
    return []; // unknown timezone — behave as «no windows»
  }

  found.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const item of found) {
    const last = merged[merged.length - 1];
    if (last && item.from <= last.to) {
      last.to = Math.max(last.to, item.to);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
};

const plannedAt = (windows, ms, zone, toleranceMs = 0) =>
  plannedIntervals(windows, ms - toleranceMs - 1, ms + toleranceMs + 1, zone).find(
    (item) => ms >= item.from - toleranceMs && ms <= item.to + toleranceMs,
  ) || null;

// Hour-of-week slots (day * 24 + hour, 0 = Sunday 00:00) a window touches. The
// activity profile ignores them: a device that is off has no traffic to rank.
const plannedSlots = (windows) => {
  const slots = new Set();
  for (const window of normalizeWindows(windows)) {
    for (const day of window.days) {
      for (
        let minute = Math.floor(window.start / 60) * 60;
        minute < window.end;
        minute += 60
      ) {
        slots.add((day * 24 + minute / 60) % 168);
      }
    }
  }
  return slots;
};

// Should the offline-alert job stay silent for this device right now, and if
// not — is this the «did not come back after its window» case?
const alertDecision = (record, nowMs, zone) => {
  const windows = record?.plannedOffline;
  if (plannedAt(windows, nowMs, zone, TOLERANCE_MS)) {
    return { suppress: true, missed: null };
  }
  const since = record?.offlineSince
    ? new Date(record.offlineSince).getTime()
    : null;
  // «Не вернулось» — только если устройство пропало до конца окна: упавшее
  // через десять минут после него — обычный простой.
  const hit = since ? plannedAt(windows, since, zone, TOLERANCE_MS) : null;
  const missed = hit && since <= hit.to && hit.to < nowMs ? hit : null;
  return { suppress: false, missed };
};

// End of the window an offline device is currently in (row DTO: «Отключено по
// расписанию · до 07:00»), or null.
//
// The outage must have STARTED in that same window and carry no alert: a
// device that failed at noon, or one that never returned from last night's
// window, is an incident — it must not turn grey (and lose its error line and
// its place in the dashboard block) just because the clock entered a window.
const plannedUntil = (record, nowMs, zone) => {
  if (!record?.monitoringEnabled || record.status !== "offline") return null;
  if (!record.offlineSince || record.offlineAlertedAt || record.alertTicketId) {
    return null;
  }
  const hit = plannedAt(record.plannedOffline, nowMs, zone, TOLERANCE_MS);
  if (!hit) return null;
  const since = new Date(record.offlineSince).getTime();
  return since >= hit.from - TOLERANCE_MS && since <= hit.to
    ? new Date(hit.to)
    : null;
};

// Availability arithmetic with planned time taken out of BOTH sides: it is
// neither downtime nor time the device was expected to be up. `pairs` are
// merged [start, end] outage intervals already clamped to [fromMs, toMs].
//
// What is left of an outage right at a window's edge is still the planned one:
// power is cut a few minutes early, and the episode ends at the first
// successful poll after the device has booted. Such leftovers — entirely
// within the tolerance before a window's start or after its end — are dropped,
// otherwise every night would count as two small incidents. An overrun longer
// than the tolerance counts in full from the window's end.
const atWindowEdge = ([start, end], planned) =>
  planned.some(
    (item) =>
      (end <= item.from && start >= item.from - TOLERANCE_MS) ||
      (start >= item.to && end <= item.to + TOLERANCE_MS),
  );

const summarizeDowntime = (pairs, planned, fromMs, toMs) => {
  const chunks = pairs
    .flatMap((pair) => subtractWindows(pair, planned))
    .filter((chunk) => !atWindowEdge(chunk, planned));
  const plannedMs = intersectWindows([fromMs, toMs], planned).reduce(
    (sum, [start, end]) => sum + (end - start),
    0,
  );
  let downtimeMs = 0;
  let longestMs = 0;
  for (const [start, end] of chunks) {
    downtimeMs += end - start;
    longestMs = Math.max(longestMs, end - start);
  }
  return {
    chunks,
    windowMs: Math.max(0, toMs - fromMs - plannedMs),
    downtimeMs,
    longestMs,
    outageCount: chunks.length,
  };
};

const isPlannedEpisode = (startMs, endMs, planned) =>
  planned.some(
    (item) => startMs >= item.from - TOLERANCE_MS && endMs <= item.to + TOLERANCE_MS,
  );

const LOOKBACK_DAYS = 21;
const MIN_EPISODE_MS = 2 * 60 * 60 * 1000;
const MIN_MATCHED = 10;
// A schedule is regular and leaves the device most of the day: starts and ends
// must cluster, and the window stays well under a full day. Without these a
// device that is simply down most of the time «suggests» a 22-hour window.
const MAX_SPREAD_MIN = 60;
const MAX_WINDOW_MIN = 16 * 60;

const byNumber = (a, b) => a - b;
const percentile = (sorted, share) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
const toClock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// A window proposed from recent outage history, or null. Never applied by the
// system itself — a person confirms it.
const suggestWindow = (episodes, windows, zone, nowMs) => {
  const sinceMs = nowMs - LOOKBACK_DAYS * DAY_MS;
  const raw = [];
  for (const episode of episodes || []) {
    if (!episode?.endedAt) continue;
    const start = new Date(episode.startedAt).getTime();
    const end = new Date(episode.endedAt).getTime();
    const lengthMs = end - start;
    if (start < sinceMs || lengthMs < MIN_EPISODE_MS || lengthMs >= DAY_MS) continue;
    const local = dayjs(start).tz(zone);
    raw.push({
      start,
      end,
      key: local.format("YYYY-MM-DD"),
      dow: local.day(),
      minute: local.hour() * 60 + local.minute(),
      length: Math.round(lengthMs / 60000),
    });
  }
  if (raw.length < MIN_MATCHED) return null;

  // Starts scattered around midnight (23:50 / 00:10) are the same pattern:
  // re-express each start relative to the median one, moving it to the
  // neighbouring day.
  const anchor = percentile(raw.map((item) => item.minute).sort(byNumber), 0.5);
  for (const item of raw) {
    if (item.minute - anchor > 720) {
      item.minute -= MINUTES_PER_DAY;
      item.dow = (item.dow + 1) % 7;
      item.key = shiftDayKey(item.key, 1);
    } else if (anchor - item.minute > 720) {
      item.minute += MINUTES_PER_DAY;
      item.dow = (item.dow + 6) % 7;
      item.key = shiftDayKey(item.key, -1);
    }
  }

  // One episode per day — the longest: a second outage on the same day is
  // noise, and `matched` must stay a count of days.
  const byDay = new Map();
  for (const item of raw) {
    const known = byDay.get(item.key);
    if (!known || item.length > known.length) byDay.set(item.key, item);
  }
  const items = [...byDay.values()];
  if (items.length < MIN_MATCHED) return null;

  const perDay = new Map();
  for (const item of items) perDay.set(item.dow, (perDay.get(item.dow) || 0) + 1);
  const days = [...perDay].filter(([, count]) => count >= 2).map(([day]) => day);
  const matched = items.filter((item) => days.includes(item.dow));
  if (matched.length < MIN_MATCHED) return null;

  const starts = matched.map((item) => item.minute).sort(byNumber);
  const ends = matched.map((item) => item.minute + item.length).sort(byNumber);
  if (
    percentile(starts, 0.8) - percentile(starts, 0.2) > MAX_SPREAD_MIN ||
    percentile(ends, 0.8) - percentile(ends, 0.2) > MAX_SPREAD_MIN
  ) {
    return null;
  }

  let start = Math.floor(percentile(starts, 0.2) / 15) * 15;
  const endAbs = Math.ceil(percentile(ends, 0.8) / 15) * 15;
  const length = endAbs - start;
  if (length <= 0 || length > MAX_WINDOW_MIN) return null;

  let startDays = days;
  if (start < 0) {
    start += MINUTES_PER_DAY;
    startDays = days.map((day) => (day + 6) % 7);
  } else if (start >= MINUTES_PER_DAY) {
    start -= MINUTES_PER_DAY;
    startDays = days.map((day) => (day + 1) % 7);
  }

  const latest = matched.reduce((a, b) => (b.start > a.start ? b : a));
  if (plannedAt(windows, (latest.start + latest.end) / 2, zone)) return null;

  return {
    days: [...startDays].sort(byNumber),
    start: toClock(start),
    end: toClock((start + length) % MINUTES_PER_DAY),
    matched: matched.length,
    total: LOOKBACK_DAYS,
  };
};

module.exports = {
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
};
