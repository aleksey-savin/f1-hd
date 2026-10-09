# Mikrotik activity profile and planned offline windows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recommend a low-traffic window in the firmware upgrade dialog, and let a device carry planned offline windows so that scheduled power cuts raise no tickets and do not count as downtime.

**Architecture:** The 5-minute health-check gains one best-effort `/interface/print` read; the delta of Σ `rx-byte` over physical ports is accumulated into hourly buckets (`MikrotikTrafficHour`). Two pure modules do all the reasoning — `activityProfile.js` (168 hour-of-week slots → nearest quiet window) and `plannedOffline.js` (windows → concrete intervals, alert decision, downtime arithmetic, window suggestion). Alerts, availability, the row DTO and the upgrade plan call into them; the UI adds one section to the record page, one form sheet and a hint in the upgrade dialog.

**Tech Stack:** Node (CommonJS), Mongoose, dayjs + timezone plugin, `node:test`; React, React Router data routes, Tailwind + `components/app` primitives.

**Spec:** `docs/superpowers/specs/2026-10-09-mikrotik-activity-and-planned-offline-design.md`
**Mockup (approved):** https://claude.ai/artifact/4NqDsRoXwgzw8rKB8y1ALb — the UI tasks reproduce it exactly.

## Global Constraints

- **No git commits, no pushes.** The owner handles git. No task ends with a commit step.
- Package manager is **pnpm**; never npm/yarn. No new dependencies in this plan.
- Org timezone computes: every window and slot is in `Preferences.timezone` via `resolveTimezone(prefs)` from `backend/utils/datetime.js`. Instants from a schedule only through `instantOf` (`backend/services/workWindow.js`).
- Weekday numbering is JS: `0` = Sunday … `6` = Saturday (as in `schedules.weekday`). Slot index = `day * 24 + hour`, slot 0 = Sunday 00:00 org time.
- Window times are stored and sent as `"HH:mm"` strings; `end < start` means the next day; `end === start` is rejected.
- Tolerance around a planned window is 30 minutes on both sides. Traffic gap limit is 15 minutes. Buckets live 56 days. The hint needs 14 days of buckets.
- Sampling, bucket writes and profile reads are best-effort: they never fail a poll, an alert tick or a page.
- No message when there is not enough activity data — the hint is absent.
- Tests: `node:test`, run **only the files of the touched code** (`node --test <file>`). Never run the full backend `pnpm test`. Backend syntax check is `node --check <file>` (backend eslint is broken). Frontend check is `pnpm --dir frontend exec eslint <files>`; do not add `eslint-disable react-hooks/*` comments (the plugin is not installed and the comment itself fails lint).
- No browser/E2E run: static checks only, the owner verifies the UI.
- UI copy: gender-neutral, concise; action wording «Новое окно». Module doc `docs/mikrotik-management.md` is English and backend-only.
- Use `components/app` primitives before hand-rolling; no `text-[Npx]` classes.

## Review Focus

1. **A device that never returns after its window** — expected: exactly one ticket, raised 30 minutes after the window's end, saying the device did not come back. Pinned in Task 2 (`alertDecision`).
2. **A window crossing midnight evaluated after midnight** (Tuesday 03:00 inside Monday 22:00–07:00) — expected: still planned. Pinned in Task 2.
3. **Counter reset or a long gap between samples** — expected: no bucket written, so a reboot or an outage never shows up as a traffic spike or a negative number. Pinned in Task 1.
4. **A flat or empty activity profile** — expected: no hint at all, never «сейчас тихо» for every hour. Pinned in Task 3.
5. **Malformed windows in the database** (`start` = `"25:99"`, empty `days`, `start === end`) — expected: treated as no window; the alert path falls back to a normal ticket. Pinned in Task 2 (`normalizeWindows`).

## File Structure

Backend — create:
- `backend/models/mikrotikTrafficHour.js` — hourly bucket model.
- `backend/services/mikrotik/trafficSample.js` (+ `.test.js`) — pure: counter sum, sample → bucket rule.
- `backend/services/mikrotik/traffic.js` — impure: persist a sample, delete a record's buckets.
- `backend/services/mikrotik/plannedOffline.js` (+ `.test.js`) — pure: windows, intervals, alert decision, downtime arithmetic, suggestion.
- `backend/services/mikrotik/activityProfile.js` (+ `.test.js`) — pure: slots and quiet window.
- `backend/services/mikrotik/activity.js` — impure: load buckets/episodes and assemble payloads.

Backend — modify:
- `backend/models/mikrotik.js`, `backend/types/mikrotik.ts` — new fields.
- `backend/services/mikrotik/connector.js` — optional interface read.
- `backend/middleware/mikrotikHealthCheck.js`, `backend/services/mikrotik/monitorState.js` — sampling.
- `backend/services/mikrotik/alerts.js` — planned suppression and «did not return» text.
- `backend/services/mikrotik/outages.js` — availability without planned time.
- `backend/controllers/inventory/mikrotik.js`, `backend/controllers/inventory/mikrotikUpgrade.js`, `backend/routes/internal/inventory/mikrotik.js`, `backend/validations/inventory/mikrotik.js` (+ `.test.js`).

Frontend — create (all under `frontend/src/components/Mikrotik/`):
- `activity-format.js` (+ `.test.js`) — pure labels and grid helpers.
- `WeekGrid.jsx` — the 7×24 grid.
- `ActivitySection.jsx` — record page section.
- `PlannedOfflineForm.jsx` — form sheet + route action.

Frontend — modify: `store/lists/mikrotik-devices.js`, `components/Mikrotik/meta.jsx`, `components/Mikrotik/DeviceRow.jsx`, `pages/Mikrotik/Record.jsx`, `components/Mikrotik/AvailabilitySection.jsx`, `components/Mikrotik/UpgradeDialog.jsx`, `App.jsx`.

Docs — modify: `docs/mikrotik-management.md`, `docs/ux-ui-changelog.md`.

Phase A = Tasks 1, 2, 4, 5, 6, 8, 9. Phase B = Tasks 3, 7, 10. They can ship together; nothing in Phase B shows until a device has 14 days of buckets.

---

### Task 1: Traffic sampling

**Files:**
- Create: `backend/models/mikrotikTrafficHour.js`, `backend/services/mikrotik/trafficSample.js`, `backend/services/mikrotik/trafficSample.test.js`, `backend/services/mikrotik/traffic.js`
- Modify: `backend/models/mikrotik.js`, `backend/types/mikrotik.ts`, `backend/services/mikrotik/connector.js` (`pollDevice`, ~line 385), `backend/middleware/mikrotikHealthCheck.js` (`checkDevice`), `backend/services/mikrotik/monitorState.js` (`recoverToOnline`), `backend/controllers/inventory/mikrotik.js` (`deleteRecord`)

**Interfaces:**
- Produces: `sumRxBytes(rows) → number | null`; `nextSample(prev, counter, now) → { traffic: { counter, at }, bucket: { hour: Date, bytes, seconds } | null }`; `recordTraffic(record, interfaces, now) → Promise<void>`; `deleteTraffic(recordId) → Promise<void>`; model `MikrotikTrafficHour { mikrotik, hour, bytes, seconds }`; poll result field `interfaces`.

- [ ] **Step 1: Write the failing test** — `backend/services/mikrotik/trafficSample.test.js`

```js
// node --test services/mikrotik/trafficSample.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { sumRxBytes, nextSample } = require("./trafficSample");

const AT = new Date("2026-10-09T03:20:00Z");
const minutesBefore = (m) => new Date(AT.getTime() - m * 60 * 1000);

test("sums rx-byte over physical interfaces only", () => {
  const rows = [
    { name: "ether1", type: "ether", "rx-byte": "1000" },
    { name: "wlan1", type: "wlan", "rx-byte": "200" },
    { name: "bridge1", type: "bridge", "rx-byte": "999999" },
    { name: "gre1", type: "gre-tunnel", "rx-byte": "999999" },
    { name: "vlan10", type: "vlan", "rx-byte": "999999" },
  ];
  assert.equal(sumRxBytes(rows), 1200);
});

test("no rows, no physical rows or a failed read give null", () => {
  assert.equal(sumRxBytes(undefined), null);
  assert.equal(sumRxBytes({ error: "read timeout" }), null);
  assert.equal(sumRxBytes([{ type: "bridge", "rx-byte": "5" }]), null);
  assert.equal(sumRxBytes([{ type: "ether", "rx-byte": "abc" }]), null);
});

test("first sample is stored and writes no bucket", () => {
  const out = nextSample(undefined, 5000, AT);
  assert.deepEqual(out.traffic, { counter: 5000, at: AT });
  assert.equal(out.bucket, null);
});

test("normal delta lands in the hour of the new sample", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(5) }, 8000, AT);
  assert.deepEqual(out.bucket, {
    hour: new Date("2026-10-09T03:00:00Z"),
    bytes: 3000,
    seconds: 300,
  });
  assert.deepEqual(out.traffic, { counter: 8000, at: AT });
});

test("counter reset writes no bucket but stores the new sample", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(5) }, 120, AT);
  assert.equal(out.bucket, null);
  assert.equal(out.traffic.counter, 120);
});

test("a gap longer than 15 minutes writes no bucket", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(16) }, 9000, AT);
  assert.equal(out.bucket, null);
  assert.equal(out.traffic.counter, 9000);
});

test("a clock that went backwards writes no bucket", () => {
  const out = nextSample({ counter: 5000, at: new Date(AT.getTime() + 1000) }, 9000, AT);
  assert.equal(out.bucket, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mikrotik/trafficSample.test.js`
Expected: FAIL — `Cannot find module './trafficSample'`.

- [ ] **Step 3: Implement `backend/services/mikrotik/trafficSample.js`**

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test services/mikrotik/trafficSample.test.js`
Expected: 7 passing.

- [ ] **Step 5: Add the model `backend/models/mikrotikTrafficHour.js`**

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Network activity of a monitored Mikrotik device, one document per UTC hour.
// Filled by the health-check (services/mikrotik/traffic.js): `bytes` is the sum
// of accepted counter deltas that landed in the hour, `seconds` the time those
// deltas cover — a partly covered hour is told apart from a quiet one.
const mikrotikTrafficHourSchema = new Schema({
  mikrotik: { type: Schema.Types.ObjectId, ref: "Mikrotik", required: true },
  hour: { type: Date, required: true },
  bytes: { type: Number, default: 0 },
  seconds: { type: Number, default: 0 },
});

mikrotikTrafficHourSchema.index({ mikrotik: 1, hour: 1 }, { unique: true });
// Eight weeks of history is all the weekly profile reads.
mikrotikTrafficHourSchema.index({ hour: 1 }, { expireAfterSeconds: 56 * 24 * 60 * 60 });

module.exports = mongoose.model("MikrotikTrafficHour", mikrotikTrafficHourSchema);
```

- [ ] **Step 6: Add the fields to `backend/models/mikrotik.js`** — right after the `addresses` array (before the `status` field):

```js
    // Last traffic sample (Σ rx-byte over physical interfaces) — the base the
    // next poll's delta is taken from. See services/mikrotik/trafficSample.js.
    traffic: {
      counter: Number,
      at: Date,
    },
    // Planned offline windows (org timezone): the device is switched off on
    // purpose — no offline ticket, no downtime. `days` — 0 = Sunday … 6, the
    // day the window STARTS; end < start ⇒ ends the next day.
    plannedOffline: [
      {
        _id: false,
        days: [Number],
        start: String,
        end: String,
      },
    ],
    // «Скрыть» on the suggested window — not offered again for 30 days.
    plannedOfflineSuggestionHiddenAt: Date,
```

Mirror them in the `IMikrotik` interface in `backend/types/mikrotik.ts`:

```ts
  traffic?: { counter?: number; at?: Date };
  plannedOffline?: { days: number[]; start: string; end: string }[];
  plannedOfflineSuggestionHiddenAt?: Date;
```

- [ ] **Step 7: Read interfaces in `pollDevice`** (`backend/services/mikrotik/connector.js`)

Next to the other read-timeout constants at the top of the file add:

```js
// /interface/print feeds the traffic sample; a reply of ~30 rows, bounded so a
// silent device cannot stall the poll.
const INTERFACE_READ_TIMEOUT_MS = 8000;
```

Change the signature and add the read as the LAST command of the session (an unanswered command must not sit in front of other reads):

```js
const pollDevice = (
  params,
  { verifyFullGroup = true, readRouterboard = true, readInterfaces = false } = {},
) =>
```

Immediately before the `return {` of the session callback:

```js
    // Traffic counters — health-check only, best-effort. No `.proplist`: with
    // one the reader returned no rows on live devices (probe 09.10.2026).
    let interfaces = null;
    if (readInterfaces) {
      try {
        interfaces = await withReadTimeout(
          conn.write(["/interface/print"]),
          INTERFACE_READ_TIMEOUT_MS,
        );
      } catch (error) {
        logger.log("debug", "Mikrotik /interface/print unavailable — no traffic sample", {
          host: params.host,
          error: error.message,
        });
      }
    }
```

and add `interfaces,` to the returned object after `license,`.

- [ ] **Step 8: Create `backend/services/mikrotik/traffic.js`**

```js
const Mikrotik = require("../../models/mikrotik");
const MikrotikTrafficHour = require("../../models/mikrotikTrafficHour");
const { sumRxBytes, nextSample } = require("./trafficSample");
const logger = require("../../utils/logger");

// Persist one traffic sample. `record` is the PRE-update document (its
// `traffic` is the previous sample). Best-effort and never throws: activity
// bookkeeping must not be able to break the health-check.
const recordTraffic = async (record, interfaces, now = new Date()) => {
  try {
    const counter = sumRxBytes(interfaces);
    if (counter === null || !record?._id) return;

    const { traffic, bucket } = nextSample(record.traffic, counter, now);
    await Mikrotik.updateOne({ _id: record._id }, { $set: { traffic } });
    if (bucket) {
      await MikrotikTrafficHour.updateOne(
        { mikrotik: record._id, hour: bucket.hour },
        { $inc: { bytes: bucket.bytes, seconds: bucket.seconds } },
        { upsert: true },
      );
    }
  } catch (error) {
    logger.log("debug", "Mikrotik traffic sample not saved", {
      recordId: record?._id,
      error: error.message,
    });
  }
};

// Deleting a monitoring record removes its activity history too.
const deleteTraffic = async (recordId) => {
  try {
    await MikrotikTrafficHour.deleteMany({ mikrotik: recordId });
  } catch (error) {
    logger.log("warn", "Mikrotik traffic history not deleted", {
      recordId,
      error: error.message,
    });
  }
};

module.exports = { recordTraffic, deleteTraffic };
```

- [ ] **Step 9: Wire it in**

`backend/middleware/mikrotikHealthCheck.js`, in `checkDevice`, add `readInterfaces: true,` to the options object passed to `pollWithRetry` (next to `readRouterboard`).

`backend/services/mikrotik/monitorState.js`: add `const { recordTraffic } = require("./traffic");` with the other requires, and in `recoverToOnline`, right after the `if (shownChanged(prev, set)) bus.bump(...)` line:

```js
  // Traffic sample — only polls that read interfaces carry one (health-check);
  // `prev.traffic` is the previous sample.
  if (prev && poll.interfaces) await recordTraffic(prev, poll.interfaces, now);
```

`backend/controllers/inventory/mikrotik.js`: add `const { deleteTraffic } = require("../../services/mikrotik/traffic");` and in `deleteRecord`, after `await deleteOutages(record._id);`:

```js
    await deleteTraffic(record._id);
```

- [ ] **Step 10: Verify**

Run: `cd backend && node --test services/mikrotik/trafficSample.test.js services/mikrotik/connector.test.js && for f in models/mikrotikTrafficHour.js models/mikrotik.js services/mikrotik/traffic.js services/mikrotik/connector.js services/mikrotik/monitorState.js middleware/mikrotikHealthCheck.js controllers/inventory/mikrotik.js; do node --check $f || break; done`
Expected: tests pass, no syntax errors.

---

### Task 2: Planned offline — pure module

**Files:**
- Create: `backend/services/mikrotik/plannedOffline.js`, `backend/services/mikrotik/plannedOffline.test.js`

**Interfaces:**
- Consumes: `instantOf`, `shiftDayKey`, `windowMinutes`, `subtractWindows`, `intersectWindows` from `backend/services/workWindow.js`; `keyToUtc` from `backend/services/dateKeys.js`.
- Produces:
  - `TOLERANCE_MS` (1 800 000)
  - `normalizeWindows(raw) → [{ days: number[], start: number, end: number }]` (minutes; `end` monotonic, may exceed 1440)
  - `plannedIntervals(windows, fromMs, toMs, zone) → [{ from, to }]` (ms, merged, sorted, real bounds)
  - `plannedAt(windows, ms, zone, toleranceMs = 0) → { from, to } | null`
  - `plannedSlots(windows) → Set<number>` (hour-of-week slots touched by a window)
  - `alertDecision(record, nowMs, zone) → { suppress: boolean, missed: { from, to } | null }`
  - `plannedUntil(record, nowMs, zone) → Date | null`
  - `summarizeDowntime(pairs, planned, fromMs, toMs) → { chunks, windowMs, downtimeMs, longestMs, outageCount }` (`pairs` and `chunks` are `[start, end]` arrays)
  - `isPlannedEpisode(startMs, endMs, planned) → boolean`
  - `suggestWindow(episodes, windows, zone, nowMs) → { days, start, end, matched, total } | null`

- [ ] **Step 1: Write the failing test** — `backend/services/mikrotik/plannedOffline.test.js`

```js
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
  const base = { plannedOffline: MONDAY, monitoringEnabled: true, status: "offline" };
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mikrotik/plannedOffline.test.js`
Expected: FAIL — `Cannot find module './plannedOffline'`.

- [ ] **Step 3: Implement `backend/services/mikrotik/plannedOffline.js`**

```js
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
  const missed = since ? plannedAt(windows, since, zone, TOLERANCE_MS) : null;
  return { suppress: false, missed: missed && missed.to < nowMs ? missed : null };
};

// End of the window an offline device is currently in (row DTO: «Отключено по
// расписанию · до 07:00»), or null.
const plannedUntil = (record, nowMs, zone) => {
  if (!record?.monitoringEnabled || record.status !== "offline") return null;
  const hit = plannedAt(record.plannedOffline, nowMs, zone, TOLERANCE_MS);
  return hit ? new Date(hit.to) : null;
};

// Availability arithmetic with planned time taken out of BOTH sides: it is
// neither downtime nor time the device was expected to be up. `pairs` are
// merged [start, end] outage intervals already clamped to [fromMs, toMs].
const summarizeDowntime = (pairs, planned, fromMs, toMs) => {
  const chunks = pairs.flatMap((pair) => subtractWindows(pair, planned));
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

const byNumber = (a, b) => a - b;
const percentile = (sorted, share) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
const toClock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// A window proposed from recent outage history, or null. Never applied by the
// system itself — a person confirms it.
const suggestWindow = (episodes, windows, zone, nowMs) => {
  const sinceMs = nowMs - LOOKBACK_DAYS * DAY_MS;
  const items = [];
  for (const episode of episodes || []) {
    if (!episode?.endedAt) continue;
    const start = new Date(episode.startedAt).getTime();
    const end = new Date(episode.endedAt).getTime();
    const lengthMs = end - start;
    if (start < sinceMs || lengthMs < MIN_EPISODE_MS || lengthMs >= DAY_MS) continue;
    const local = dayjs(start).tz(zone);
    items.push({
      start,
      end,
      dow: local.day(),
      minute: local.hour() * 60 + local.minute(),
      length: Math.round(lengthMs / 60000),
    });
  }
  if (items.length < MIN_MATCHED) return null;

  // Starts scattered around midnight (23:50 / 00:10) are the same pattern:
  // re-express each start relative to the median one.
  const anchor = percentile(items.map((item) => item.minute).sort(byNumber), 0.5);
  for (const item of items) {
    if (item.minute - anchor > 720) {
      item.minute -= MINUTES_PER_DAY;
      item.dow = (item.dow + 1) % 7;
    } else if (anchor - item.minute > 720) {
      item.minute += MINUTES_PER_DAY;
      item.dow = (item.dow + 6) % 7;
    }
  }

  const perDay = new Map();
  for (const item of items) perDay.set(item.dow, (perDay.get(item.dow) || 0) + 1);
  const days = [...perDay].filter(([, count]) => count >= 2).map(([day]) => day);
  const matched = items.filter((item) => days.includes(item.dow));
  if (matched.length < MIN_MATCHED) return null;

  let start =
    Math.floor(percentile(matched.map((item) => item.minute).sort(byNumber), 0.2) / 15) * 15;
  const endAbs =
    Math.ceil(
      percentile(matched.map((item) => item.minute + item.length).sort(byNumber), 0.8) / 15,
    ) * 15;
  const length = endAbs - start;
  if (length <= 0 || length >= MINUTES_PER_DAY) return null;

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test services/mikrotik/plannedOffline.test.js`
Expected: 19 passing. (The module and its tests were run once while writing this plan — the code above is known to pass as written.)

---

### Task 3: Activity profile — pure module

**Files:**
- Create: `backend/services/mikrotik/activityProfile.js`, `backend/services/mikrotik/activityProfile.test.js`

**Interfaces:**
- Produces: `slotOf(ms, zone) → number` (0–167); `buildSlots(buckets, zone, nowMs, blocked = new Set()) → (number | null)[168] | null`; `findQuietWindow(slots, zone, nowMs) → { from, to, current } | null` (ms).
- `buckets` items: `{ hour: Date, bytes: number, seconds: number }`. `blocked` is the `Set` from `plannedSlots` (Task 2).

- [ ] **Step 1: Write the failing test** — `backend/services/mikrotik/activityProfile.test.js`

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mikrotik/activityProfile.test.js`
Expected: FAIL — `Cannot find module './activityProfile'`.

- [ ] **Step 3: Implement `backend/services/mikrotik/activityProfile.js`**

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test services/mikrotik/activityProfile.test.js`
Expected: 13 passing.

---

### Task 4: Alerts honour planned windows

**Files:**
- Modify: `backend/services/mikrotik/alerts.js`

**Interfaces:**
- Consumes: `alertDecision(record, nowMs, zone)` (Task 2); `resolveTimezone(prefs)` from `backend/utils/datetime.js`.

The decision logic is pinned by Task 2's tests; this task is the wiring.

- [ ] **Step 1: Add the requires** at the top of `backend/services/mikrotik/alerts.js`:

```js
const { alertDecision } = require("./plannedOffline");
const { resolveTimezone } = require("../../utils/datetime");
```

- [ ] **Step 2: Suppress inside a window.** In `runMikrotikOfflineAlerts`, replace the `candidates` line

```js
  const candidates = devices.filter((device) => !quietUnderUpgrade(device, byId, now));
```

with

```js
  // Плановое отключение: в окне (и 30 минут вокруг него) заявка не создаётся.
  // offlineAlertedAt остаётся null, поэтому каждый тик переоценивает — не
  // вернулось после окна → заявка с пометкой об этом (missed).
  const zone = resolveTimezone(prefs);
  const decisions = new Map();
  const candidates = devices.filter((device) => {
    if (quietUnderUpgrade(device, byId, now)) return false;
    const decision = alertDecision(device, now.getTime(), zone);
    if (decision.suppress) {
      logger.log("debug", "Mikrotik offline alert suppressed: planned offline window", {
        recordId: device._id,
      });
      return false;
    }
    decisions.set(String(device._id), decision);
    return true;
  });
```

and in `alertIfDown` change the last line to pass the missed window:

```js
    await raiseTicket(record, cfg, prefs, decisions.get(String(record._id))?.missed || null);
```

- [ ] **Step 3: Say so in the ticket.** Change `raiseTicket`'s signature to `async (record, cfg, prefs, missed = null)` and replace the `description` and the `title` passed to `createMikrotikTicket`:

```js
  const description =
    `Устройство «${name}» (${host}) недоступно с ` +
    `${fmtTime(record.offlineSince, prefs?.timezone)} (более ${minutes} мин).<br/>` +
    (missed
      ? `Плановое отключение закончилось в ${fmtTime(new Date(missed.to), prefs?.timezone)}, устройство в сеть не вернулось.<br/>`
      : "") +
    (record.lastError ? `Последняя ошибка: ${record.lastError}<br/>` : "") +
    deviceLinkHtml(record);

  const ticket = await createMikrotikTicket(record, {
    title: missed
      ? `Mikrotik не вернулся после планового отключения: ${name}`
      : `Mikrotik недоступен: ${name}`,
    description,
    categoryId: cfg.categoryId || null,
  });
```

- [ ] **Step 4: Verify**

Run: `cd backend && node --check services/mikrotik/alerts.js && node --test services/mikrotik/plannedOffline.test.js`
Expected: no syntax errors; tests still pass.

---

### Task 5: Availability without planned time

**Files:**
- Modify: `backend/services/mikrotik/outages.js` (`computeAvailability`, `computeUptimeStats`)

**Interfaces:**
- Consumes: `plannedIntervals`, `summarizeDowntime`, `isPlannedEpisode` (Task 2); `resolveTimezone`.
- Produces: report gains `plannedMs` and `downIntervals: [[startMs, endMs]]`; each `outages[]` item gains `planned: boolean`. `windowMs`, `uptimePct`, `downtimeMs`, `outageCount`, `longestMs` now exclude planned time. `computeUptimeStats` results likewise.

The arithmetic is pinned by Task 2's `summarizeDowntime` tests.

- [ ] **Step 1: Add the requires** to `backend/services/mikrotik/outages.js`:

```js
const { plannedIntervals, summarizeDowntime, isPlannedEpisode } = require("./plannedOffline");
const { resolveTimezone } = require("../../utils/datetime");
```

and a small loader above `computeAvailability`:

```js
// Org timezone — planned offline windows are defined in it.
const loadZone = async () =>
  resolveTimezone(await Preferences.findOne({}).select("timezone").lean());
```

- [ ] **Step 2: `computeAvailability`.** Replace the block from `const merged = clampAndMergeIntervals(` through the `uptimePct` computation with:

```js
  const merged = clampAndMergeIntervals(
    docs,
    effectiveFrom.getTime(),
    to.getTime(),
  );
  // Плановые отключения не простой и не время, когда устройство должно было
  // работать: вычитаются и из простоя, и из окна наблюдения. Эпизод, переживший
  // своё окно, считается только с конца окна.
  const planned = plannedIntervals(
    record.plannedOffline,
    effectiveFrom.getTime(),
    to.getTime(),
    await loadZone(),
  );
  const summary = summarizeDowntime(
    merged,
    planned,
    effectiveFrom.getTime(),
    to.getTime(),
  );
  const { downtimeMs, longestMs, outageCount } = summary;
  const observedMs = summary.windowMs;

  const uptimePct =
    observedMs > 0
      ? Math.round((1 - downtimeMs / observedMs) * 10000) / 100
      : null;
```

Delete the now-unused `let downtimeMs`, `let longestMs`, `const outageCount` and the `for (const [start, end] of merged)` loop that this block replaces. Keep `const windowMs = …` above it as is.

In the `outages` mapping add the flag (after `ongoing`):

```js
      planned: isPlannedEpisode(
        new Date(doc.startedAt).getTime(),
        (doc.endedAt ? new Date(doc.endedAt) : to).getTime(),
        planned,
      ),
```

In the returned object add, after `windowMs,`:

```js
    plannedMs: windowMs - observedMs,
    // Простои без плановых кусков — лента доступности красит по ним.
    downIntervals: summary.chunks,
```

- [ ] **Step 3: `computeUptimeStats`.** Before `const byRecord = new Map();` add `const zone = await loadZone();`. In the per-record loop replace

```js
    let downtimeMs = 0;
    for (const [start, end] of merged) {
      downtimeMs += end - start;
    }
```

with

```js
    const planned = plannedIntervals(record.plannedOffline, effectiveFromMs, toMs, zone);
    const summary = summarizeDowntime(merged, planned, effectiveFromMs, toMs);
    const downtimeMs = summary.downtimeMs;
```

In the day-bucket loop iterate `summary.chunks` instead of `merged`:

```js
      for (const [start, end] of summary.chunks) {
```

and compute `pct` from `summary.windowMs`:

```js
      pct:
        summary.windowMs > 0
          ? Math.round((1 - downtimeMs / summary.windowMs) * 10000) / 100
          : null,
```

`windowMs` in that loop becomes unused — delete its declaration.

Both callers of `computeUptimeStats` load full records (no `.select` that would drop `plannedOffline`), so nothing changes there.

- [ ] **Step 4: Verify**

Run: `cd backend && node --check services/mikrotik/outages.js && node --test services/mikrotik/plannedOffline.test.js`
Expected: no syntax errors; tests pass.

---

### Task 6: Planned offline API, validation and row DTO

**Files:**
- Modify: `backend/validations/inventory/mikrotik.js` (currently empty), `backend/controllers/inventory/mikrotik.js`, `backend/routes/internal/inventory/mikrotik.js`
- Create: `backend/validations/inventory/mikrotik.test.js`

**Interfaces:**
- Consumes: `plannedUntil`, `TOLERANCE_MS` (Task 2).
- Produces: `parsePlannedOffline(body) → { windows } | { error: string }`; routes `PUT /mikrotik-devices/records/:recordId/planned-offline` (body `{ windows: [{ days, start, end }] }`, reply `{ message, plannedOffline }`) and `POST /mikrotik-devices/records/:recordId/planned-offline/suggestion/hide` (reply `{ message }`); row DTO fields `plannedOffline: [{ days, start, end }]` and `plannedOfflineUntil: Date | null` on both `getManagedDevices` rows and `getRecordOne`; `getOfflineDevices` leaves planned devices out.

- [ ] **Step 1: Write the failing test** — `backend/validations/inventory/mikrotik.test.js`

```js
// node --test validations/inventory/mikrotik.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePlannedOffline } = require("./mikrotik");

test("accepts and normalises a list of windows", () => {
  const got = parsePlannedOffline({
    windows: [{ days: [5, 1, 1, "3"], start: "22:00", end: "07:00", extra: "x" }],
  });
  assert.deepEqual(got, { windows: [{ days: [1, 3, 5], start: "22:00", end: "07:00" }] });
});

test("an empty list clears the windows", () => {
  assert.deepEqual(parsePlannedOffline({ windows: [] }), { windows: [] });
});

test("rejects a missing list, bad days, bad clock, zero length and too many", () => {
  const window = { days: [1], start: "22:00", end: "07:00" };
  assert.ok(parsePlannedOffline({}).error);
  assert.ok(parsePlannedOffline({ windows: "no" }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, days: [] }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, days: [7] }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, start: "25:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, end: "7:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: [{ ...window, end: "22:00" }] }).error);
  assert.ok(parsePlannedOffline({ windows: Array(8).fill(window) }).error);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test validations/inventory/mikrotik.test.js`
Expected: FAIL — `parsePlannedOffline is not a function`.

- [ ] **Step 3: Implement `backend/validations/inventory/mikrotik.js`**

```js
// Validation of Mikrotik monitoring input that has no verify-on-save behind it.

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_WINDOWS = 7;

// Planned offline windows from a request body. Returns { windows } (cleaned —
// unknown keys dropped, days unique and sorted) or { error } with a message for
// the operator.
const parsePlannedOffline = (body) => {
  const raw = body?.windows;
  if (!Array.isArray(raw)) return { error: "Не переданы окна отключения" };
  if (raw.length > MAX_WINDOWS) {
    return { error: `Не больше ${MAX_WINDOWS} окон на устройство` };
  }

  const windows = [];
  for (const item of raw) {
    const days = Array.isArray(item?.days) ? [...new Set(item.days.map(Number))] : [];
    if (
      days.length === 0 ||
      !days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      return { error: "Выберите дни недели для каждого окна" };
    }
    if (!CLOCK.test(item.start) || !CLOCK.test(item.end)) {
      return { error: "Укажите начало и конец окна в формате ЧЧ:ММ" };
    }
    if (item.start === item.end) {
      return { error: "Начало и конец окна не должны совпадать" };
    }
    windows.push({
      days: days.sort((a, b) => a - b),
      start: item.start,
      end: item.end,
    });
  }
  return { windows };
};

module.exports = { parsePlannedOffline };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test validations/inventory/mikrotik.test.js`
Expected: 3 passing.

- [ ] **Step 5: Controller — requires and a zone helper.** In `backend/controllers/inventory/mikrotik.js` add with the other requires:

```js
const { plannedUntil } = require("../../services/mikrotik/plannedOffline");
const { parsePlannedOffline } = require("../../validations/inventory/mikrotik");
const { resolveTimezone } = require("../../utils/datetime");
```

and next to the other small helpers (above `getOfflineDevices`):

```js
// Пояс организации — в нём заданы окна планового отключения.
const loadOrgZone = async () =>
  resolveTimezone(await Preferences.findOne({}).select("timezone").lean());

// Поля планового отключения строки: окна и конец текущего (устройство не в
// сети и сейчас внутри окна) — «Отключено по расписанию · до 07:00».
const plannedView = (record, zone, nowMs) => ({
  plannedOffline: (record.plannedOffline || []).map(({ days, start, end }) => ({
    days,
    start,
    end,
  })),
  plannedOfflineUntil: plannedUntil(record, nowMs, zone),
});
```

- [ ] **Step 6: Row DTO.** In `getManagedDevices`, before `const rows = records.map(`, add:

```js
    const zone = await loadOrgZone();
    const nowMs = Date.now();
```

and add `...plannedView(record, zone, nowMs),` to the returned row object right after `...base,`. In `getRecordOne` add the same spread after `...base,`, computing the arguments inline:

```js
      ...plannedView(record, await loadOrgZone(), Date.now()),
```

- [ ] **Step 7: Dashboard block.** In `getOfflineDevices` add `plannedOffline monitoringEnabled status` to the `.select(...)` string of the first query, load the zone before `const items = records`:

```js
    const zone = await loadOrgZone();
    const nowMs = Date.now();
```

and filter planned devices out as the first step of the chain — change `const items = records\n      .map(` to:

```js
    const items = records
      // Отключённые по расписанию — не авария: в блок «не в сети» не попадают.
      .filter((record) => !plannedUntil(record, nowMs, zone))
      .map(
```

`monitored` (the `countDocuments`) stays as is — it is the size of the fleet, not of the list.

- [ ] **Step 8: The two handlers.** Add after `updateSchedules` in the same controller:

```js
// Окна планового отключения. Отдельно от параметров намеренно: их сохранение
// проверяет подключение (verify-on-save), а устройство, ради которого окно
// задают, в этот момент может быть как раз выключено.
exports.updatePlannedOffline = async (req, res, next) => {
  try {
    const parsed = parsePlannedOffline(req.body);
    if (parsed.error) return next(new AppError(parsed.error, 422));

    const record = await Mikrotik.findByIdAndUpdate(
      req.params.recordId,
      { $set: { plannedOffline: parsed.windows } },
      { new: true },
    ).select("plannedOffline");
    if (!record) return next(new AppError("Устройство не найдено", 404));

    logger.log("info", "Mikrotik planned offline windows updated", {
      actor: req.userId,
      recordId: record._id,
      windows: parsed.windows.length,
      ip: req.ip,
    });
    bus.bump({ topics: ["mikrotik"] });

    res.status(200).json({
      message: parsed.windows.length
        ? "Плановые отключения сохранены"
        : "Плановые отключения убраны",
      plannedOffline: parsed.windows,
    });
  } catch (error) {
    next(new AppError("Failed to update mikrotik planned offline", 500, true, error));
  }
};

// «Скрыть» на предложенном окне — 30 дней его не предлагаем снова.
exports.hidePlannedOfflineSuggestion = async (req, res, next) => {
  try {
    const result = await Mikrotik.updateOne(
      { _id: req.params.recordId },
      { $set: { plannedOfflineSuggestionHiddenAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      return next(new AppError("Устройство не найдено", 404));
    }
    res.status(200).json({ message: "Скрыто" });
  } catch (error) {
    next(new AppError("Failed to hide mikrotik planned offline suggestion", 500, true, error));
  }
};
```

The controller does not import the live-updates bus yet — add `const { bus } = require("../../services/pulse");` with the other requires (the same bus `monitorState.js` bumps).

- [ ] **Step 9: Routes.** In `backend/routes/internal/inventory/mikrotik.js`, right after the `…/records/:recordId/disconnect` route:

```js
// Плановые отключения — свой эндпоинт: параметры проверяют подключение при
// сохранении, а окно задают как раз для устройства, которое бывает выключено.
router.put(
  "/mikrotik-devices/records/:recordId/planned-offline",
  isAuth,
  canManageMikrotik,
  mikrotikController.updatePlannedOffline,
);
router.post(
  "/mikrotik-devices/records/:recordId/planned-offline/suggestion/hide",
  isAuth,
  canManageMikrotik,
  mikrotikController.hidePlannedOfflineSuggestion,
);
```

- [ ] **Step 10: Verify**

Run: `cd backend && node --test validations/inventory/mikrotik.test.js && node --check controllers/inventory/mikrotik.js && node --check routes/internal/inventory/mikrotik.js`
Expected: tests pass, no syntax errors.

---

### Task 7: Activity API and the quiet window in the upgrade plan

**Files:**
- Create: `backend/services/mikrotik/activity.js`
- Modify: `backend/controllers/inventory/mikrotik.js`, `backend/controllers/inventory/mikrotikUpgrade.js`, `backend/routes/internal/inventory/mikrotik.js`

**Interfaces:**
- Consumes: `buildSlots`, `findQuietWindow`, `slotOf` (Task 3); `plannedSlots`, `suggestWindow` (Task 2); model `MikrotikTrafficHour` (Task 1).
- Produces:
  - `loadActivity(record, now = new Date()) → { timezone, slots, quiet, suggestion }` where `quiet` is `{ from: Date, to: Date, current: boolean, slots: [number, number] } | null`
  - `loadQuietWindows(records, now = new Date()) → Map<String(recordId), { from: Date, to: Date, current: boolean }>` (devices without a window are absent)
  - route `GET /mikrotik-devices/records/:recordId/activity`
  - upgrade plan items gain `quietWindow: { from, to, current } | null`

- [ ] **Step 1: Create `backend/services/mikrotik/activity.js`**

```js
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
```

- [ ] **Step 2: Activity handler.** In `backend/controllers/inventory/mikrotik.js` add `const { loadActivity } = require("../../services/mikrotik/activity");` and, after `getAvailability`:

```js
// Недельный профиль активности записи, ближайшее тихое окно и предложение
// планового отключения по истории простоев.
exports.getActivity = async (req, res, next) => {
  try {
    const record = await Mikrotik.findById(req.params.recordId)
      .select("plannedOffline plannedOfflineSuggestionHiddenAt")
      .lean();
    if (!record) {
      return next(new AppError("Устройство не найдено", 404));
    }
    res.status(200).json(await loadActivity(record));
  } catch (error) {
    next(new AppError("Failed to compute mikrotik activity", 500, true, error));
  }
};
```

Route — in `backend/routes/internal/inventory/mikrotik.js`, right after the `…/records/:recordId/availability` route (same middleware — `isAuth` only, it is a read):

```js
router.get(
  "/mikrotik-devices/records/:recordId/activity",
  isAuth,
  mikrotikController.getActivity,
);
```

- [ ] **Step 3: Upgrade plan.** In `backend/controllers/inventory/mikrotikUpgrade.js` add `const { loadQuietWindows } = require("../../services/mikrotik/activity");`, add `plannedOffline` to the `.select(...)` string in `buildPlan`, return the records from it (`return { plan: planUpgrade({...}), running, records };`), and replace `planUpgrades` with:

```js
exports.planUpgrades = async (req, res, next) => {
  try {
    const { plan, records } = await buildPlan(parseBody(req.body));
    const view = publicPlan(plan);

    // Тихое окно каждого устройства — подсказка, когда лучше запускать. Нет
    // данных — поля нет; сбой расчёта план не ломает.
    try {
      const ids = new Set(view.items.map((item) => String(item.recordId)));
      const quiet = await loadQuietWindows(
        records.filter((record) => ids.has(String(record._id))),
      );
      for (const item of view.items) {
        item.quietWindow = quiet.get(String(item.recordId)) || null;
      }
    } catch (error) {
      logger.log("debug", "Mikrotik quiet windows unavailable for the plan", {
        error: error.message,
      });
    }

    res.status(200).json(view);
  } catch (error) {
    passAppError(next, error, "Не удалось составить план обновления");
  }
};
```

- [ ] **Step 4: Verify**

Run: `cd backend && for f in services/mikrotik/activity.js controllers/inventory/mikrotik.js controllers/inventory/mikrotikUpgrade.js routes/internal/inventory/mikrotik.js; do node --check $f || break; done && node --test services/mikrotik/activityProfile.test.js services/mikrotik/plannedOffline.test.js services/mikrotik/upgradeView.test.js`
Expected: no syntax errors; all tests pass.

---

### Task 8: Frontend — status «Отключено по расписанию», helpers, store

**Files:**
- Create: `frontend/src/components/Mikrotik/activity-format.js`, `frontend/src/components/Mikrotik/activity-format.test.js`
- Modify: `frontend/src/store/lists/mikrotik-devices.js`, `frontend/src/components/Mikrotik/meta.jsx`, `frontend/src/components/Mikrotik/DeviceRow.jsx`, `frontend/src/pages/Mikrotik/Record.jsx` (hero status), `frontend/src/components/Mikrotik/AvailabilitySection.jsx`

**Interfaces:**
- Consumes: row fields `plannedOffline`, `plannedOfflineUntil` (Task 6); report fields `planned`, `downIntervals`, `plannedMs` (Task 5).
- Produces (all from `activity-format.js`): `clockIn(date, timeZone) → "07:00"`; `plannedSummary(windows) → string | null`; `plannedSlotSet(windows) → Set<number>`; `slotLevels(slots) → (0|1|2|3|4|null)[]`; `quietLabel(quiet, timeZone, now) → string | null`. Store: `rowStatus(row)` may return `"planned"`; `fetchActivity(recordId)`, `savePlannedOffline(recordId, windows)`, `hidePlannedSuggestion(recordId)`.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/Mikrotik/activity-format.test.js`

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/components/Mikrotik/activity-format.test.js`
Expected: FAIL — cannot find `./activity-format.js`.

- [ ] **Step 3: Implement `frontend/src/components/Mikrotik/activity-format.js`**

```js
// Подписи и геометрия секции «Активность» и плановых отключений — чистые
// функции. Всё здесь считается в поясе ОРГАНИЗАЦИИ (его присылает бэкенд):
// окна заданы в нём, сетка недели нарезана в нём, и подсказка «сегодня
// 20:00–22:00» обязана совпадать с тем, что видно в сетке.

const DAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
// Порядок показа недели — с понедельника.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// «07:00» — время инстанта в заданном поясе.
export const clockIn = (date, timeZone) =>
  new Date(date).toLocaleTimeString("ru", { timeZone, hour: "2-digit", minute: "2-digit" });

const dayKeyIn = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone });

const weekdayIn = (date, timeZone) =>
  DAY_SHORT[
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      new Date(date).toLocaleDateString("en-US", { timeZone, weekday: "short" }),
    )
  ];

// «пн–пт» для подряд идущих дней, иначе перечисление; «ежедневно» для семи.
const daysLabel = (days) => {
  const ordered = WEEK_ORDER.filter((day) => days.includes(day));
  if (ordered.length === 7) return "ежедневно";
  const positions = ordered.map((day) => WEEK_ORDER.indexOf(day));
  const consecutive = positions.every(
    (position, index) => index === 0 || position === positions[index - 1] + 1,
  );
  if (ordered.length >= 3 && consecutive) {
    return `${DAY_SHORT[ordered[0]]}–${DAY_SHORT[ordered[ordered.length - 1]]}`;
  }
  return ordered.map((day) => DAY_SHORT[day]).join(", ");
};

// «Ежедневно, 22:00–07:00» / «Пн–пт, 22:00–07:00; сб, вс, 18:00–09:00».
export const plannedSummary = (windows) => {
  if (!Array.isArray(windows) || windows.length === 0) return null;
  return capitalize(
    windows
      .map((window) => `${daysLabel(window.days)}, ${window.start}–${window.end}`)
      .join("; "),
  );
};

// Слоты недели (день * 24 + час, 0 — воскресенье 00:00), задетые окнами.
// Зеркало plannedSlots бэкенда (services/mikrotik/plannedOffline.js).
export const plannedSlotSet = (windows) => {
  const slots = new Set();
  for (const window of windows || []) {
    if (!CLOCK.test(window?.start) || !CLOCK.test(window?.end)) continue;
    const start = toMinutes(window.start);
    let end = toMinutes(window.end);
    if (end === start) continue;
    if (end < start) end += 1440;
    for (const day of window.days || []) {
      for (let minute = Math.floor(start / 60) * 60; minute < end; minute += 60) {
        slots.add((day * 24 + minute / 60) % 168);
      }
    }
  }
  return slots;
};

// Ступень заливки слота 1–4 относительно самого нагруженного; null — данных нет.
export const slotLevels = (slots) => {
  const max = Math.max(0, ...(slots || []).filter((value) => value !== null));
  return (slots || []).map((value) => {
    if (value === null) return null;
    if (max === 0) return 1;
    const share = value / max;
    return share > 0.75 ? 4 : share > 0.45 ? 3 : share > 0.2 ? 2 : 1;
  });
};

// «сегодня 20:00–22:00» / «завтра 03:00–05:00» / «пн 03:00–05:00»;
// для идущего окна — «до 14:00».
export const quietLabel = (quiet, timeZone, now = new Date()) => {
  if (!quiet) return null;
  if (quiet.current) return `до ${clockIn(quiet.to, timeZone)}`;

  const range = `${clockIn(quiet.from, timeZone)}–${clockIn(quiet.to, timeZone)}`;
  const fromKey = dayKeyIn(quiet.from, timeZone);
  if (fromKey === dayKeyIn(now, timeZone)) return `сегодня ${range}`;
  const tomorrow = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000);
  if (fromKey === dayKeyIn(tomorrow, timeZone)) return `завтра ${range}`;
  return `${weekdayIn(quiet.from, timeZone)} ${range}`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node --test src/components/Mikrotik/activity-format.test.js`
Expected: 5 passing.

- [ ] **Step 5: Status.** In `frontend/src/store/lists/mikrotik-devices.js` replace `rowStatus`:

```js
// «planned» — устройство не в сети, но сейчас внутри окна планового отключения
// (plannedOfflineUntil считает бэкенд): это не авария.
export const rowStatus = (row) => {
  if (!row?.monitoringEnabled) return "disabled";
  const status = row.status || "offline";
  return status === "offline" && row.plannedOfflineUntil ? "planned" : status;
};
```

In the same store, next to `fetchAvailability`, add:

```js
  // Недельный профиль активности записи: слоты, тихое окно, предложение окна.
  fetchActivity: async (recordId) => {
    const response = await fetch(`${API}/records/${recordId}/activity`, {
      headers: authHeaders(),
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  },
  savePlannedOffline: (recordId, windows) =>
    fetch(`${API}/records/${recordId}/planned-offline`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ windows }),
    }),
  hidePlannedSuggestion: (recordId) =>
    fetch(`${API}/records/${recordId}/planned-offline/suggestion/hide`, {
      method: "POST",
      headers: authHeaders(),
    }),
```

In `frontend/src/components/Mikrotik/meta.jsx` add to `STATUS_META` after `offline`:

```js
  // Не в сети по расписанию (окно планового отключения) — не авария: серым.
  planned: {
    label: "Отключено по расписанию",
    tone: "off",
    text: "text-muted-foreground",
    dot: "bg-faint",
  },
```

and in `DeviceTile` replace the local status line so the dot follows the same rule:

```js
  const offlineByPlan =
    row?.monitoringEnabled && (row.status || "offline") === "offline" && row.plannedOfflineUntil;
  const status = offlineByPlan
    ? "planned"
    : row?.monitoringEnabled
      ? row?.status || "offline"
      : "disabled";
```

- [ ] **Step 6: Show «· до 07:00».** In `frontend/src/components/Mikrotik/DeviceRow.jsx` (`formatTime` is already imported there) in the status cell (the `<DeviceStatusText tone={statusMeta.tone}>` around line 297) render the label with the suffix:

```jsx
              <DeviceStatusText tone={statusMeta.tone}>
                {statusMeta.label}
                {status === "planned" && ` · до ${formatTime(row.plannedOfflineUntil)}`}
              </DeviceStatusText>
```

In `frontend/src/pages/Mikrotik/Record.jsx`, in the hero status span, add after the existing `status === "offline" && row.offlineSince` block:

```jsx
              {status === "planned" && <> · до {formatTime(row.plannedOfflineUntil)}</>}
```

and add `formatTime` to the page's existing `../../util/format-date` import. `status` there is already `rowStatus(row)`, so `EpisodeLine` (it returns null unless `status === "offline"`) stays hidden for a planned outage with no change.

- [ ] **Step 7: Availability section.** In `frontend/src/components/Mikrotik/meta.jsx`, in `reportSegments`, build `intervals` from the planned-free chunks when the report has them:

```js
  const intervals = Array.isArray(report.downIntervals)
    ? report.downIntervals
    : (report.outages || []).map((outage) => [
        new Date(outage.startedAt).getTime(),
        outage.endedAt ? new Date(outage.endedAt).getTime() : to,
      ]);
```

and guard the pulsing last segment so a planned outage does not pulse red — change `if (report.current?.status === "offline") {` to:

```js
  const ongoingPlanned = (report.outages || []).some(
    (outage) => outage.ongoing && outage.planned,
  );
  if (report.current?.status === "offline" && !ongoingPlanned) {
```

In `frontend/src/components/Mikrotik/AvailabilitySection.jsx`:

Phone row — add `outage.planned && "text-muted-foreground"` to the row `className` via `cn(...)`, and replace the right-hand lower line (ticket link or dash) with:

```jsx
                  <div className="text-xs">
                    {outage.planned ? (
                      <span className="text-faint">по расписанию</span>
                    ) : outage.ticketNum ? (
                      <Link
                        to={`/tickets/${outage.ticketNum}`}
                        className="font-semibold text-accent-text no-underline hover:underline"
                      >
                        {outage.ticketNum}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </div>
```

Desktop row — add `outage.planned && "text-muted-foreground"` to the row `className` via `cn(...)` and change the duration cell to:

```jsx
                  <span className="flex-1">
                    {formatDurationShort(outage.durationMs)}
                    {outage.planned && " · по расписанию"}
                  </span>
```

Under the journal (inside the `<div className="mt-4">`, after the desktop table block) add the footnote:

```jsx
          {report?.plannedMs > 0 && (
            <div className="mt-2.5 text-xs text-faint">
              Простои по расписанию не входят в доступность и счётчик инцидентов.
            </div>
          )}
```

- [ ] **Step 8: Verify**

Run: `cd frontend && node --test src/components/Mikrotik/activity-format.test.js && pnpm exec eslint src/components/Mikrotik/activity-format.js src/components/Mikrotik/meta.jsx src/components/Mikrotik/DeviceRow.jsx src/components/Mikrotik/AvailabilitySection.jsx src/pages/Mikrotik/Record.jsx src/store/lists/mikrotik-devices.js`
Expected: tests pass; eslint reports nothing new in these files.

---

### Task 9: Frontend — «Плановые отключения» form sheet and the section (Phase A part)

**Files:**
- Create: `frontend/src/components/Mikrotik/PlannedOfflineForm.jsx`, `frontend/src/components/Mikrotik/ActivitySection.jsx`
- Modify: `frontend/src/App.jsx` (route), `frontend/src/pages/Mikrotik/Record.jsx` (rail + section)

**Interfaces:**
- Consumes: `fetchActivity`, `savePlannedOffline`, `hidePlannedSuggestion` (Task 8); `plannedSummary`, `quietLabel`, `WEEK_ORDER` (Task 8); route loader data `mikrotik-record` with `plannedOffline`.
- Produces: default export `PlannedOfflineForm` and named `action` from `PlannedOfflineForm.jsx`; default export `ActivitySection({ row, canManage })`. `ActivitySection` renders `<WeekGrid>` only in Task 10 — in this task it renders the suggestion and the property rows.

Mockup screens 2 and 3. The form is its own sheet (route `planned-offline`), like `ScheduleForm`: the parameters form verifies the connection on save and could not be saved while the device is off.

- [ ] **Step 1: Create `frontend/src/components/Mikrotik/PlannedOfflineForm.jsx`**

```jsx
import { useState } from "react";
import { useLocation, useRouteLoaderData } from "react-router";
import { RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import FormWrapper from "@/components/app/FormWrapper";
import TimeInput from "@/components/app/TimeInput";
import { cn } from "@/lib/utils";

import { WEEK_ORDER } from "./activity-format";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const DAY_LABEL = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_NAME = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];
const MAX_WINDOWS = 7;

const emptyWindow = () => ({ days: [1, 2, 3, 4, 5], start: "22:00", end: "07:00" });

/**
 * Плановые отключения устройства — шторка над страницей записи (вложенный
 * маршрут `planned-offline`, право `manage`). Секция «Активность» только
 * показывает окна, сюда ведёт карандаш в её метке и кнопка «Задать окно» у
 * предложенного окна (оно приходит в `location.state.suggestion`).
 *
 * Форма отдельная от формы параметров намеренно: та проверяет подключение при
 * каждом сохранении, а окно задают как раз для устройства, которое бывает
 * выключено. Время — в поясе организации; конец раньше начала значит
 * следующий день.
 */
const PlannedOfflineForm = () => {
  const row = useRouteLoaderData("mikrotik-record");
  const suggestion = useLocation().state?.suggestion;

  const [windows, setWindows] = useState(() => {
    const current = (row?.plannedOffline || []).map((window) => ({ ...window }));
    return suggestion
      ? [...current, { days: suggestion.days, start: suggestion.start, end: suggestion.end }]
      : current;
  });

  const patch = (index, next) =>
    setWindows((prev) =>
      prev.map((window, position) => (position === index ? { ...window, ...next } : window)),
    );
  const toggleDay = (index, day) => {
    const days = windows[index].days;
    patch(index, {
      days: days.includes(day) ? days.filter((value) => value !== day) : [...days, day],
    });
  };

  return (
    <FormWrapper title="Плановые отключения" json={() => ({ windows })}>
      <p className="mb-3 text-sm text-muted-foreground">
        В эти часы устройство выключено намеренно. Заявка о недоступности не
        создаётся, простой не снижает доступность. Если через 30 минут после
        конца окна устройство не вернулось, заявка создаётся.
      </p>

      <div className="divide-y divide-border-soft border-y border-border-soft">
        {windows.length === 0 && (
          <div className="py-3 text-sm text-faint">Окон нет.</div>
        )}
        {windows.map((window, index) => (
          <div key={index} className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 py-3">
            <div
              role="group"
              aria-label="Дни недели"
              className="flex gap-1 max-md:basis-full"
            >
              {WEEK_ORDER.map((day) => {
                const on = window.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAME[day]}
                    onClick={() => toggleDay(index, day)}
                    className={cn(
                      "grid h-8 w-9 cursor-pointer appearance-none place-items-center rounded-lg border text-sm font-medium transition-colors max-md:w-auto max-md:flex-1",
                      on
                        ? "border-primary/55 bg-primary/15 text-accent-text"
                        : "border-border bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {DAY_LABEL[day]}
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-0 items-center gap-2 max-md:flex-1">
              <TimeInput
                value={window.start}
                aria-label="Начало"
                onChange={(event) => patch(index, { start: event.target.value })}
                className="h-9 w-24 min-w-0 max-md:w-full"
              />
              <span className="text-faint">–</span>
              <TimeInput
                value={window.end}
                aria-label="Конец"
                onChange={(event) => patch(index, { end: event.target.value })}
                className="h-9 w-24 min-w-0 max-md:w-full"
              />
            </div>
            {window.end && window.start && window.end < window.start && (
              <span className="text-xs text-faint max-md:order-last max-md:basis-full">
                до {window.end} следующего дня
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ms-auto text-faint"
              aria-label="Удалить окно"
              onClick={() =>
                setWindows((prev) => prev.filter((_, position) => position !== index))
              }
            >
              <RiCloseLine />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={windows.length >= MAX_WINDOWS}
          onClick={() => setWindows((prev) => [...prev, emptyWindow()])}
        >
          Новое окно
        </Button>
        <span className="text-xs text-faint">Время по поясу организации</span>
      </div>
    </FormWrapper>
  );
};

export default PlannedOfflineForm;

// Router-action шторки: тело — JSON формы, ответ — в формате FormWrapper
// (`error` + `message`); по успеху шторка закрывается сама, loader страницы
// записи перечитывается.
export async function action({ request, params }) {
  const body = await request.json();
  const response = await useMikrotikDeviceFilterStore
    .getState()
    .savePlannedOffline(params.recordId, body.windows);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      error: true,
      message: data.message || "Не удалось сохранить плановые отключения",
    };
  }
  return { message: data.message || "Плановые отключения сохранены" };
}
```

- [ ] **Step 2: Route.** In `frontend/src/App.jsx` import next to the `MikrotikScheduleForm` import:

```js
import MikrotikPlannedOfflineForm, {
  action as mikrotikPlannedOfflineAction,
} from "./components/Mikrotik/PlannedOfflineForm.jsx";
```

and add a sibling of the `schedule` child route of `devices/mikrotik/records/:recordId`:

```jsx
                // Плановые отключения — своя шторка: параметры проверяют
                // подключение при сохранении, а устройство бывает выключено
                {
                  path: "planned-offline",
                  element: <MikrotikPlannedOfflineForm />,
                  action: mikrotikPlannedOfflineAction,
                  handle: { can: { mikrotik: ["manage"] }, ...SHEET_MD },
                },
```

- [ ] **Step 3: Create `frontend/src/components/Mikrotik/ActivitySection.jsx`**

```jsx
import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";

import { Button } from "@/components/ui/button";
import { Panel, Eyebrow, Section, SectionEditLink } from "@/components/app/Panel";

import { plannedSummary, quietLabel } from "./activity-format";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Строка «подпись — значение» секции (в две колонки, на телефоне — друг под
// другом). Свой вид, а не app/PropRow: у того обязательная плитка-иконка.
const Row = ({ label, children }) => (
  <div className="grid gap-x-3 gap-y-0.5 border-t border-border-soft py-2 text-sm first:border-t-0 first:pt-0 md:grid-cols-[12rem_minmax(0,1fr)]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="m-0 tabular-nums">{children}</dd>
  </div>
);

/**
 * Секция «Активность» страницы записи: плановые отключения устройства,
 * ближайшие тихие часы и неделя по часам (сетка появляется, когда накоплено
 * две недели данных). Окна правятся в своей шторке — карандаш в метке.
 *
 * Над строками — предложение окна: система видит повторяющиеся ночные простои
 * и предлагает оформить их как плановые; сама она ничего не подавляет.
 */
const ActivitySection = ({ row, canManage }) => {
  const fetchActivity = useMikrotikDeviceFilterStore((state) => state.fetchActivity);
  const hidePlannedSuggestion = useMikrotikDeviceFilterStore(
    (state) => state.hidePlannedSuggestion,
  );
  const revalidator = useRevalidator();

  const [activity, setActivity] = useState(null);
  const [hidden, setHidden] = useState(false);

  // Окна приходят из loader'а страницы; после сохранения в шторке он
  // перечитывается, и профиль запрашивается заново вместе с ним.
  const windowsKey = JSON.stringify(row.plannedOffline || []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchActivity(row.recordId);
      if (!cancelled) setActivity(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.recordId, windowsKey]);

  const summary = plannedSummary(row.plannedOffline);
  const quiet = activity?.quiet
    ? quietLabel(activity.quiet, activity.timezone)
    : null;
  const suggestion = !hidden && canManage ? activity?.suggestion : null;

  const hide = async () => {
    setHidden(true);
    await hidePlannedSuggestion(row.recordId);
    revalidator.revalidate();
  };

  return (
    <Section>
      <Eyebrow
        id="activity"
        action={
          canManage && (
            <SectionEditLink to="planned-offline" label="Плановые отключения" />
          )
        }
      >
        Активность
      </Eyebrow>
      <Panel>
        {suggestion && (
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5 rounded-lg border border-primary/35 bg-primary/5 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-72">
              <div className="text-sm font-semibold">
                Похоже на отключение по расписанию
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {suggestion.matched} ночей из {suggestion.total} устройство было
                не в сети примерно с {suggestion.start} до {suggestion.end}.
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button asChild size="xs">
                <Link to="planned-offline" state={{ suggestion }}>
                  Задать окно
                </Link>
              </Button>
              <Button variant="ghost" size="xs" onClick={hide}>
                Скрыть
              </Button>
            </div>
          </div>
        )}

        <dl className="m-0">
          <Row label="Плановое отключение">
            {summary || <span className="text-faint">Не задано</span>}
          </Row>
          {quiet && (
            <Row label="Тихие часы">
              {activity.quiet.current ? `Сейчас, ${quiet}` : capitalize(quiet)}
              <div className="text-xs text-faint">
                ближайшее время с наименьшей сетевой активностью
              </div>
            </Row>
          )}
        </dl>
      </Panel>
    </Section>
  );
};

export default ActivitySection;
```

Check `Panel.tsx` exports `Section`, `SectionEditLink`, `Eyebrow`, `Panel` under exactly these names (they do as of 09.10) and that `Button` supports `size="xs"` and `size="icon-xs"` (both are used in `Panel.tsx`).

- [ ] **Step 4: Put it on the record page.** In `frontend/src/pages/Mikrotik/Record.jsx`:

Import: `import ActivitySection from "../../components/Mikrotik/ActivitySection";`

Rail — add after the availability entry:

```js
    { id: "activity", label: "Активность" },
```

Body — right after `<AvailabilitySection recordId={row.recordId} />`:

```jsx
          <ActivitySection row={row} canManage={canManage} />
```

- [ ] **Step 5: Verify**

Run: `cd frontend && pnpm exec eslint src/components/Mikrotik/PlannedOfflineForm.jsx src/components/Mikrotik/ActivitySection.jsx src/pages/Mikrotik/Record.jsx src/App.jsx`
Expected: nothing new reported. If eslint flags the effect dependency list, do NOT add a `react-hooks` disable comment — the plugin is not installed; leave the list as written.

---

### Task 10: Frontend — week grid and the upgrade dialog hint (Phase B)

**Files:**
- Create: `frontend/src/components/Mikrotik/WeekGrid.jsx`
- Modify: `frontend/src/components/Mikrotik/ActivitySection.jsx`, `frontend/src/components/Mikrotik/UpgradeDialog.jsx`

**Interfaces:**
- Consumes: `slotLevels`, `plannedSlotSet`, `WEEK_ORDER`, `quietLabel` (Task 8); `activity.slots`, `activity.quiet.slots`, `activity.timezone` (Task 7); plan items' `quietWindow` (Task 7).
- Produces: default export `WeekGrid({ slots, planned, quietSlots, today })`.

Pixel check (dense-grid rule): desktop panel ≈ 760 px inner → 24 columns of ≈ 28 px, rows 20 px; phone 375 − 32 − 28 − 26 ≈ 290 px → ≈ 10 px per hour, rows 16 px. One cell = one hour; nothing smaller is drawn.

- [ ] **Step 1: Create `frontend/src/components/Mikrotik/WeekGrid.jsx`**

```jsx
import { cn } from "@/lib/utils";

import { WEEK_ORDER } from "./activity-format";

const DAY_LABEL = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const LEVEL_BG = {
  1: "bg-primary/15",
  2: "bg-primary/35",
  3: "bg-primary/60",
  4: "bg-primary/90",
};

// Штриховка планового отключения — цветом границы, читается в обеих темах.
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 5px)",
};

/**
 * Неделя устройства по часам: 7 строк × 24 колонки, клетка = час. Заливка —
 * активность относительно самого нагруженного часа (ступени 1–4), штриховка —
 * плановое отключение, рамка — ближайшие тихие часы, пустая клетка — данных
 * нет. Числа сетка не показывает: она отвечает на «когда», а не «сколько».
 *
 * `levels` и `planned` индексируются слотом недели (день * 24 + час,
 * 0 — воскресенье 00:00, пояс организации); показ — с понедельника.
 */
const WeekGrid = ({ levels, planned, quietSlots = [], today }) => (
  <div
    role="img"
    aria-label="Активность по часам недели"
    className="mt-3.5 grid grid-cols-[1.625rem_repeat(24,minmax(0,1fr))] gap-0.5"
  >
    <span />
    {["00", "06", "12", "18"].map((label) => (
      <span key={label} className="col-span-6 h-4 text-xs text-faint tabular-nums">
        {label}
      </span>
    ))}
    {WEEK_ORDER.map((day) => (
      <div key={day} className="contents">
        <span
          className={cn(
            "flex items-center text-xs",
            day === today ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {DAY_LABEL[day]}
        </span>
        {HOURS.map((hour) => {
          const slot = day * 24 + hour;
          const off = planned.has(slot);
          return (
            <span
              key={hour}
              style={off ? HATCH : undefined}
              className={cn(
                "h-5 rounded-xs max-md:h-4",
                !off && (LEVEL_BG[levels[slot]] || "bg-muted"),
                quietSlots.includes(slot) && "relative z-10 ring-2 ring-foreground",
              )}
            />
          );
        })}
      </div>
    ))}
  </div>
);

export const WeekLegend = ({ withPlanned }) => (
  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1">
      меньше
      {[1, 2, 3, 4].map((level) => (
        <i key={level} className={cn("inline-block h-3 w-3.5 rounded-xs", LEVEL_BG[level])} />
      ))}
      больше
    </span>
    {withPlanned && (
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-3 w-3.5 rounded-xs" style={HATCH} />
        плановое отключение
      </span>
    )}
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block h-3 w-3.5 rounded-xs ring-2 ring-foreground ring-inset" />
      ближайшие тихие часы
    </span>
  </div>
);

export default WeekGrid;
```

Sizes stay on the spacing scale (`h-5`, `h-4`); never `h-[22px]`.

- [ ] **Step 2: Use it in `ActivitySection.jsx`.** Add imports:

```js
import { catalogCity } from "../../util/timezone-catalog";
import { plannedSlotSet, slotLevels } from "./activity-format";
import WeekGrid, { WeekLegend } from "./WeekGrid";
```

(merge the `activity-format` import with the existing one), and inside the component, before `return`:

```js
  const planned = plannedSlotSet(row.plannedOffline);
  // День недели «сегодня» в поясе организации — в нём нарезана сетка.
  const today = activity?.timezone
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        new Date().toLocaleDateString("en-US", {
          timeZone: activity.timezone,
          weekday: "short",
        }),
      )
    : null;
```

and after the closing `</dl>` inside the `Panel`:

```jsx
        {activity?.slots && (
          <>
            <WeekGrid
              levels={slotLevels(activity.slots)}
              planned={planned}
              quietSlots={activity.quiet?.slots}
              today={today}
            />
            <WeekLegend withPlanned={planned.size > 0} />
            <div className="mt-2.5 text-xs text-faint">
              Медиана по неделям наблюдения. Время по поясу организации
              {catalogCity(activity.timezone) ? `: ${catalogCity(activity.timezone)}` : ""}.
            </div>
          </>
        )}
```

- [ ] **Step 3: Upgrade dialog hint.** In `frontend/src/components/Mikrotik/UpgradeDialog.jsx`:

Imports — add `RiTimeLine` to the `react-icons/ri` import and:

```js
import { quietLabel } from "./activity-format";
import { displayTimeZone } from "../../util/format-date";
```

The plan endpoint does not return the org timezone; the hint is formatted in the zone the app displays dates in (`displayTimeZone()`), which is the zone every other time in this dialog's surroundings uses.

Inside the component, after `const majorCount = …`:

```js
  // Тихое окно — подсказка, когда запускать: одно устройство получает плашку,
  // в пакете — строка под названием. Нет данных — нет и подсказки.
  const zone = displayTimeZone();
  const singleQuiet = single ? items[0]?.quietWindow : null;
  const hasQuiet = !single && items.some((item) => item.quietWindow);
```

In the plan row, inside the first `<span className="min-w-0 flex-1">`, after the `item.majorUpgrade` block:

```jsx
                {!single && item.quietWindow && (
                  <span
                    className={cn(
                      "block text-xs tabular-nums",
                      item.quietWindow.current
                        ? "font-medium text-accent-text"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.quietWindow.current ? "тихо сейчас, " : "тихо "}
                    {quietLabel(item.quietWindow, zone)}
                  </span>
                )}
```

(import `cn` from `@/lib/utils` if the file does not have it).

Right after the plan list block (`{count > 0 && (…)}`):

```jsx
      {hasQuiet && (
        <p className="-mt-2 text-xs text-faint">
          Тихие часы — время наименьшей сетевой активности устройства.
        </p>
      )}

      {singleQuiet && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
            singleQuiet.current
              ? "border-primary/35 bg-primary/5"
              : "border-border bg-muted",
          )}
        >
          <RiTimeLine
            size={16}
            aria-hidden
            className={cn(
              "mt-0.5 flex-none",
              singleQuiet.current ? "text-accent-text" : "text-muted-foreground",
            )}
          />
          <div>
            {singleQuiet.current ? (
              <>
                Сейчас подходящее время:{" "}
                <b className="font-semibold tabular-nums">
                  {quietLabel(singleQuiet, zone)}
                </b>{" "}
                на устройстве наименьшая сетевая активность.
              </>
            ) : (
              <>
                Рекомендуем обновить{" "}
                <b className="font-semibold tabular-nums">
                  {quietLabel(singleQuiet, zone).replace(/ (\d\d:\d\d)–/, " с $1 до ")}
                </b>
                : в это время на устройстве наименьшая сетевая активность.
              </>
            )}
          </div>
        </div>
      )}
```

The `.replace` turns «сегодня 20:00–22:00» into «сегодня с 20:00 до 22:00» for the sentence form of the mockup.

- [ ] **Step 4: Verify**

Run: `cd frontend && node --test src/components/Mikrotik/activity-format.test.js && pnpm exec eslint src/components/Mikrotik/WeekGrid.jsx src/components/Mikrotik/ActivitySection.jsx src/components/Mikrotik/UpgradeDialog.jsx`
Expected: tests pass; nothing new reported.

---

### Task 11: Documentation

**Files:**
- Modify: `docs/mikrotik-management.md`, `docs/ux-ui-changelog.md`

- [ ] **Step 1: `docs/mikrotik-management.md`** (English, backend only — no columns, sheets or badges). Before editing, verify every file name and route you mention exists (`ls` the paths, compare the route table with `backend/routes/internal/inventory/mikrotik.js`).

  - **Data model & relationships** — add `MikrotikTrafficHour` (fields, unique index, 56-day TTL) next to `MikrotikOutage`.
  - **`Mikrotik` model** field list — add `traffic`, `plannedOffline`, `plannedOfflineSuggestionHiddenAt`.
  - New subsection **«Network activity sampling»** after «Health-check cron»: the extra `/interface/print` read (health-check only, best-effort, last command of the session, no `.proplist`), the Σ `rx-byte` over `ether`/`wlan`/`wifi`/`lte` rule and why (hardware-offloaded switches report switch-chip counters there — probe of 09.10.2026), the sample rules (first sample, reset, 15-minute gap), where it is persisted (`services/mikrotik/traffic.js`).
  - New subsection **«Planned offline windows»** after «Outage episodes & availability»: window semantics and timezone, the 30-minute tolerance, `alertDecision` in the alert cron (suppressed in the window; «did not return» ticket after it), availability with planned time removed from both sides, `plannedOfflineUntil` in the row DTO and its effect on the dashboard offline block, the suggestion rule and its 30-day hide.
  - New subsection **«Activity profile»**: 168 slots, validity rule, quiet = lowest 15 % of the range, no advice on a flat profile, nearest/current window; consumers (`GET …/activity`, `quietWindow` in the upgrade plan).
  - **Endpoints** table — add `PUT /records/:recordId/planned-offline`, `POST /records/:recordId/planned-offline/suggestion/hide`, `GET /records/:recordId/activity`; note `quietWindow` on the upgrade plan route.
  - **Frontend map** — one line each for `ActivitySection.jsx`, `WeekGrid.jsx`, `PlannedOfflineForm.jsx` (route `planned-offline`), `activity-format.js`.
  - **How to test end-to-end** — add: set a window covering «now» on an offline test record → the list shows it as off by schedule and the alert job logs «suppressed: planned offline window».

- [ ] **Step 2: `docs/ux-ui-changelog.md`** (Russian) — one entry dated 10.10.2026 with the decisions and their reasons: статус «Отключено по расписанию» серым вместо красного и почему (это не авария); секция «Активность» и одна сетка на оба вопроса (когда тихо / когда выключено); окна правятся в своей шторке, а не в параметрах (verify-on-save); подсказка в диалоге обновления без сообщения при нехватке данных; плановые простои в журнале приглушены и не входят в доступность. Ссылка на макет.

- [ ] **Step 3: Final check of the whole change**

Run:
```
cd backend && node --test services/mikrotik/trafficSample.test.js services/mikrotik/plannedOffline.test.js services/mikrotik/activityProfile.test.js validations/inventory/mikrotik.test.js services/mikrotik/connector.test.js services/mikrotik/upgradeView.test.js
cd ../frontend && node --test src/components/Mikrotik/activity-format.test.js
```
Expected: everything passes. Report to the owner what was NOT verified: nothing was run in a browser, and the sampling path was not exercised against a live device.

---

## Rollout notes (for the owner)

- No migration. Deploy = `git pull` + `./deploy.sh`. The dev container picks up backend changes on restart.
- After deploy: buckets start filling on the next health-check tick. The hint and the grid appear per device after 14 days.
- Offline tickets can be switched on once the night-time switches have their windows — either from the suggestion on the record page or by hand.
