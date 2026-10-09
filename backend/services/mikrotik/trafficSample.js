// Pure rules of traffic sampling (no I/O). Activity of a device is the sum of
// rx-byte over its PHYSICAL interfaces: every frame enters through exactly one
// of them, so bridges, VLANs and tunnels would only count the same bytes again.
// On hardware-offloaded switches these counters come from the switch chip
// (verified on a CRS326, see the design spec), so switched traffic is included.

const PHYSICAL_TYPES = new Set(["ether", "wlan", "wifi", "lte"]);

// Longer gaps mean an outage or missed polls: the bytes cannot be attributed to
// an hour honestly, so they are dropped.
const MAX_GAP_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Σ rx-byte, or null when the read failed or the device reported nothing usable.
const sumRxBytes = (rows) => {
  if (!Array.isArray(rows)) return null;
  let total = 0;
  let seen = false;
  for (const row of rows) {
    if (!PHYSICAL_TYPES.has(row?.type)) continue;
    const value = Number(row["rx-byte"]);
    if (!Number.isFinite(value) || value < 0) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
};

// The new stored sample and the bucket increment it produces (null = none).
const nextSample = (prev, counter, now) => {
  const traffic = { counter, at: now };
  if (!prev || !Number.isFinite(prev.counter) || !prev.at) {
    return { traffic, bucket: null };
  }
  const gapMs = now.getTime() - new Date(prev.at).getTime();
  const delta = counter - prev.counter;
  if (delta < 0 || gapMs <= 0 || gapMs > MAX_GAP_MS) {
    return { traffic, bucket: null };
  }
  return {
    traffic,
    bucket: {
      hour: new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS),
      bytes: delta,
      seconds: Math.round(gapMs / 1000),
    },
  };
};

module.exports = { PHYSICAL_TYPES, MAX_GAP_MS, sumRxBytes, nextSample };
