# Mikrotik: network activity profile and planned offline windows — design

Status: design and UI mockup approved 2026-10-09 (owner). Mockup:
https://claude.ai/artifact/4NqDsRoXwgzw8rKB8y1ALb (both themes, desktop and
phone). Not implemented yet. Plan:
`docs/superpowers/plans/2026-10-10-mikrotik-activity-and-planned-offline.md`.

## Problem

Two gaps in Mikrotik monitoring, both about a device's weekly rhythm.

1. **When to upgrade.** Firmware upgrades are started by hand and reboot the
   device. Nothing tells the owner when a device carries the least traffic.
2. **Devices that are switched off on purpose.** Several switches sit in a room
   whose power is cut every night. Each night is a confirmed outage, so turning
   on `Preferences.mikrotik.offlineTicket` would file a ticket per switch per
   night. The owner keeps offline tickets off for the whole module because of
   them.

## Intended outcome

- The upgrade dialog shows, per device, a recommended window: the nearest period
  in which the device usually has the least network activity. It is advice
  only — nothing is scheduled or started automatically.
- A device can carry planned offline windows. Inside a window an outage raises
  no ticket; a device that does not come back after the window does. With that,
  offline tickets can be enabled module-wide.

## Probe result (2026-10-09, production, read-only)

Run against `f1-msk-gw03` (CHR, RouterOS 7.23.8) and `GBG-VLD-SW02` (CRS326-24G-2S+,
RouterOS 6.49.22, every port hardware-offloaded, reached through a transit
router).

- `/interface/print` returns cumulative `rx-byte` / `tx-byte` on both.
- On the CRS the values are the **switch-chip** counters, not the CPU's:
  `ether1` `rx-byte` equalled `/interface/ethernet/print stats` `rx-bytes` to the
  byte (5 880 759 393), while `driver-rx-byte` (CPU) was 1.4 MB. Hardware-switched
  traffic is therefore visible through the plain interface read.
- An API session left idle for 30 s stops answering («read timeout»). Sampling
  must be one read per poll, never two reads in one session.

## Decisions

1. **Activity = Σ `rx-byte` over physical interfaces.** Physical means
   `type` ∈ `ether`, `wlan`, `wifi`, `lte`. Bridges, VLANs, tunnels and loopbacks
   are excluded, so nothing is counted twice and no «main» interface has to be
   chosen. One rule serves routers and switches.
2. **Sampled by the existing health-check**, one extra read per 5-minute poll.
   The read is best-effort and bounded: a failure or timeout never fails the
   poll and never touches connectivity state.
3. **Hourly buckets, 8 weeks.** Deltas are accumulated per device per UTC hour
   and expire on their own.
4. **The hint shows the nearest quiet window**, not the quietest of the week.
5. **No message when there is not enough data.** The hint is simply absent.
6. **Planned offline is explicit.** Windows are set on the device record by a
   person. The system only *suggests* a window from outage history; it never
   suppresses tickets on its own.
7. **A device that does not return after its window gets a ticket.**
8. **Planned offline does not count against availability** and is not shown as
   an outage on the board, the list or the dashboard.
9. **Org timezone computes** (`Preferences.timezone`), as everywhere else; the
   viewer's timezone only affects how instants are displayed.

Out of scope: telling power loss from link loss by uptime; scheduling or
auto-starting upgrades; one shared window for a batch of devices; per-interface
charts.

## Data model

### `Mikrotik` (additions)

```
traffic: { counter: Number, at: Date }      // last Σ rx-byte sample
plannedOffline: [
  { days: [Number],   // 0 = Sunday … 6 = Saturday (as in `schedules.weekday`),
                      // the day the window STARTS, org timezone
    start: String,    // "HH:mm"
    end: String }     // "HH:mm"; end < start ⇒ ends the next day
]
plannedOfflineSuggestionHiddenAt: Date   // «Скрыть» on the suggestion
```

Window semantics follow `services/workWindow.js`: a window crossing midnight
belongs to its start day; `end === start` is a zero-length window and is
rejected by validation. Instants are derived with `instantOf` only.

### `MikrotikTrafficHour` (new)

```
mikrotik: ObjectId   // ref Mikrotik
hour: Date           // start of the UTC hour
bytes: Number        // Σ accepted deltas that landed in this hour
seconds: Number      // Σ covered seconds (≤ 3600)
```

Indexes: unique `{ mikrotik, hour }`; TTL on `hour`, 56 days. Written with one
`$inc` upsert per poll. Deleted together with the record (same place that
deletes outage episodes).

No migration: every addition is optional and the collection starts empty.

## Sampling

`pollDevice` gains an opt-in read of `/interface/print` (no `.proplist` — the
reader returned no rows with one during the probe) and returns the summed
counter. The health-check turns it on; verify-on-save and the alert re-poll do
not.

On a successful poll, with the previous sample `traffic` and the new one:

- no previous sample → store the new one, write nothing;
- new counter < previous (reboot, counter reset) → store, write nothing;
- gap > 15 minutes (an outage or missed polls in between) → store, write
  nothing — the traffic cannot be attributed to an hour honestly;
- otherwise `$inc` `bytes` by the delta and `seconds` by the gap on the bucket of
  the hour the new sample falls in, then store the new sample.

A failed poll leaves `traffic` untouched. Devices under an upgrade are not
polled (existing `quietUnderUpgrade`), so the reboot shows up as a reset or a
gap and is discarded by the rules above.

## Activity profile — `services/mikrotik/activityProfile.js` (pure)

Input: the device's buckets, the org timezone, its planned windows, `now`.

- Each bucket with `seconds ≥ 1800` yields a rate (`bytes / seconds`) for its
  hour-of-week slot (168 slots, org timezone).
- A slot is **valid** when it has rates from at least 2 weeks and from at least
  75 % of the weeks observed. A slot in which the device is usually off has no
  buckets, so presence needs no separate join. Slots inside a planned window are
  invalid regardless.
- Slot value = median of its rates.
- **Enough data** = first bucket at least 14 days old.
- Candidate windows are every 2 consecutive valid slots; score = sum of the two
  values. A window is **quiet** when its score ≤ `min + 0.15 × (max − min)` over
  all candidate scores. (A percentile was rejected: on a flat profile ties make
  every window «quiet».) A profile without contrast (`max < 2 × min`) yields no
  window at all — there is nothing to recommend.
- Result: the first quiet window starting after `now` within the next 7 days —
  or the current one, if `now` is inside a quiet window with at least 30 minutes
  left; a current window is extended through the following quiet hours. `null` when there is not enough data or no candidate.

## Planned offline — `services/mikrotik/plannedOffline.js` (pure)

- `plannedAt(windows, instant, zone)` → the window covering the instant, with
  its concrete `from` / `to`.
- `plannedIntervals(windows, fromMs, toMs, zone)` → merged concrete intervals in
  a range.
- `suggestWindow(episodes, zone, now)` → a proposed window or `null`.

### Tickets — `services/mikrotik/alerts.js`

`TOLERANCE = 30 min` on both sides of a window.

A candidate is skipped (no re-poll, no claim) while `now` lies in
`[from − TOLERANCE, to + TOLERANCE]` of one of its windows. `offlineAlertedAt`
stays null, so every tick re-evaluates. Once `now` passes `to + TOLERANCE` and
the device is still offline, the normal path runs and the ticket text says the
device did not return after its planned window (window end included).

Outage episodes are recorded as before; nothing in `monitorState` changes.
Transit suppression is unchanged: dependents of a router that is off by plan are
already silent while the router is offline.

### Availability — `services/mikrotik/outages.js`

`computeAvailability` subtracts planned intervals from both the observed window
and the downtime; an episode that outlasts its window therefore counts only
from the window's end; leftovers within the tolerance at a window's edge are
dropped (amended after the final review — otherwise every night counted as two
small incidents). Episodes in the report carry a computed `planned` flag (fully
inside a window, tolerance applied). The flag is derived at read time, so
editing windows re-classifies history; that is accepted.

### Row DTO

`getManagedDevices` / `getRecordOne` add `plannedOffline` (the windows) and
`plannedOfflineUntil` (set when the device is offline, `now` is inside a
window with tolerance applied, the outage started in that same window and no
alert has been raised for it — amended after the final review: a real outage
must not turn «off by schedule» when the clock enters a window). Consumers treat such a device as «off by schedule»,
not as down; the dashboard offline block leaves it out.

### Suggestion

From the last 21 days of episodes lasting 2 hours or more, per weekday: the
pattern holds on a weekday when it occurred in at least 2 of its 3 occurrences.
Proposed `start` = 20th percentile of episode starts rounded down to 15 min,
`end` = 80th percentile of ends rounded up to 15 min, `days` = the weekdays on
which it holds. Requires at least 10 matching days, counting one (the longest)
episode per day; starts and ends must cluster within an hour (20th–80th
percentile) and the window may not exceed 16 hours — added during
implementation after a device that is down most of the time «suggested» a
22-hour window on real data. Not offered when an existing
window already covers it, nor for 30 days after the owner hid it
(`plannedOfflineSuggestionHiddenAt`). Computed only for the record page request.

## API

| Route | Change |
| --- | --- |
| `PUT /records/:recordId/planned-offline` (new) | `{ windows }`; days 0–6 non-empty, `HH:mm` times, `start ≠ end`, at most 7 windows. `canManageMikrotik`. A separate endpoint (and its own form sheet), like `schedules`: the parameters save re-verifies the connection, so windows of a device that is currently off could not be saved through it. |
| `POST /records/:recordId/planned-offline/suggestion/hide` (new) | stamps `plannedOfflineSuggestionHiddenAt`. `canManageMikrotik`. |
| `GET /records/:recordId/activity` (new) | `{ timezone, slots: [168 × (rate \| null)] \| null, quiet: { from, to, current, slots } \| null, suggestion }`; slot 0 = Sunday 00:00 org time. `isAuth`, same read gate as availability. |
| upgrade preview (the DTO behind the upgrade dialog) | each device gains `quietWindow: { from, to } \| null`. |

## Error handling

- Interface read fails or times out → logged at debug, poll succeeds, no sample.
- Bucket write fails → logged, swallowed; sampling must never break the
  health-check (same rule as outage bookkeeping).
- Malformed windows already in the database → treated as no windows by the pure
  functions; alerts fall back to normal behaviour (a ticket is the safe side).
- Org timezone missing → the app default, as elsewhere.

## Testing

`node:test`, files of the touched code only:

- `activityProfile.test.js` — slot validity, median, not-enough-data, nearest vs
  current window, planned slots excluded, timezone and week wrap.
- `plannedOffline.test.js` — midnight-crossing windows, tolerance edges,
  interval merge, suggestion thresholds.
- sampling rules (first sample, reset, gap, normal delta) as a pure function
  extracted from the health-check.
- `alerts` — suppressed inside a window, raised after `to + TOLERANCE`.
- availability with planned intervals subtracted.

## Rollout

1. **Phase A** — sampling + planned offline windows (backend and UI). Buckets
   start filling; offline tickets can be switched on.
2. **Phase B** — activity profile, the upgrade-dialog hint and the weekly view.
   Ships whenever; shows nothing until a device has 14 days of buckets.

Deploy is the usual `git pull` + `./deploy.sh`; no migration step.

## Docs

`docs/mikrotik-management.md` (English, backend only): data model, sampling,
planned offline in the alert path, availability change, new endpoint.
`docs/ux-ui-changelog.md`: the UI decisions once the mockup is approved.
