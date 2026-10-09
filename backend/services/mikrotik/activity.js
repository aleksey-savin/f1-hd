const MikrotikTrafficHour = require("../../models/mikrotikTrafficHour");
const MikrotikOutage = require("../../models/mikrotikOutage");
const Preferences = require("../../models/preferences");
const { buildSlots, findQuietWindow, slotOf } = require("./activityProfile");
const { plannedSlots, suggestWindow } = require("./plannedOffline");
const { resolveTimezone } = require("../../utils/datetime");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SUGGESTION_LOOKBACK_MS = 21 * DAY_MS;
const SUGGESTION_HIDDEN_MS = 30 * DAY_MS;

const loadZone = async () =>
  resolveTimezone(await Preferences.findOne({}).select("timezone").lean());

const profileOf = (buckets, record, zone, nowMs) => {
  const slots = buildSlots(buckets, zone, nowMs, plannedSlots(record.plannedOffline));
  return { slots, quiet: findQuietWindow(slots, zone, nowMs) };
};

const publicWindow = (quiet) => ({
  from: new Date(quiet.from),
  to: new Date(quiet.to),
  current: quiet.current,
});

// Activity section of the record page: the weekly profile, the nearest quiet
// window and — when no window covers it yet — a planned-offline suggestion.
// `slots` is null until the device has two weeks of history.
const loadActivity = async (record, now = new Date()) => {
  const zone = await loadZone();
  const nowMs = now.getTime();

  const [buckets, episodes] = await Promise.all([
    MikrotikTrafficHour.find({ mikrotik: record._id })
      .select("hour bytes seconds")
      .lean(),
    MikrotikOutage.find({
      mikrotik: record._id,
      startedAt: { $gte: new Date(nowMs - SUGGESTION_LOOKBACK_MS) },
      endedAt: { $ne: null },
    })
      .select("startedAt endedAt")
      .lean(),
  ]);

  const { slots, quiet } = profileOf(buckets, record, zone, nowMs);
  const hiddenAt = record.plannedOfflineSuggestionHiddenAt;
  const hidden = hiddenAt && nowMs - new Date(hiddenAt).getTime() < SUGGESTION_HIDDEN_MS;

  return {
    timezone: zone,
    slots,
    quiet: quiet
      ? {
          ...publicWindow(quiet),
          slots: [slotOf(quiet.from, zone), slotOf(quiet.from + HOUR_MS, zone)],
        }
      : null,
    suggestion: hidden
      ? null
      : suggestWindow(episodes, record.plannedOffline, zone, nowMs),
  };
};

// Quiet windows for the devices of an upgrade plan — one bucket query for all.
// Devices without enough history are simply absent from the map.
const loadQuietWindows = async (records, now = new Date()) => {
  const map = new Map();
  if (!records.length) return map;

  const zone = await loadZone();
  const nowMs = now.getTime();
  const buckets = await MikrotikTrafficHour.find({
    mikrotik: { $in: records.map((record) => record._id) },
  })
    .select("mikrotik hour bytes seconds")
    .lean();

  const byRecord = new Map();
  for (const bucket of buckets) {
    const key = String(bucket.mikrotik);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(bucket);
  }
  for (const record of records) {
    const key = String(record._id);
    const { quiet } = profileOf(byRecord.get(key) || [], record, zone, nowMs);
    if (quiet) map.set(key, publicWindow(quiet));
  }
  return map;
};

module.exports = { loadActivity, loadQuietWindows };
