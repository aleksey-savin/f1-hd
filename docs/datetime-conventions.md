# Dates and timezones

_Reviewed against the source on 2026-11-22. This document describes date storage,
conversion, and calculation conventions. The main implementations are
`backend/utils/datetime.js` and `frontend/src/util/format-date.js`. See
[UX/UI guide](ux-ui-guide.md) for visible formats and shared fields,
[UX/UI changelog](ux-ui-changelog.md) for design history, and
[user presence and calendar](user-presence-and-calendar.md) for schedule behavior._

## Core rules

1. Use the shared formatters for human-readable dates. Choose the timezone by
   purpose: organization time for business calculations and server-generated
   documents; the viewer's display timezone for ordinary frontend timestamps.
2. Identify the data type before converting it. An instant, a calendar date
   stored at UTC midnight, and a day-key string have different meanings.
   UTC slicing is valid for a stored UTC-midnight calendar date. It is wrong
   for finding today's date in a non-UTC timezone.
3. Use the shared `DateField`, `DateRangeField`, and `DateTimeField` components.
   Datetime forms load with `utcToLocalForm`, save with `localToUtc`, and use
   `toDateTimeLocal` for "Сейчас" (Now). These helpers use the display timezone,
   including the personal override. Keep load and save conversions symmetric.
4. Use the server's period label and month key for business documents. Do not
   derive a report month from its UTC start instant in the viewer's timezone.

## Data model

| Type | Storage and transport | Meaning | Display |
| --- | --- | --- | --- |
| Instant | MongoDB `Date`, ISO timestamp over the API | A point in time | Explicit organization timezone on the backend; display timezone on the frontend, with report overrides |
| Calendar date | UTC-midnight `Date`; date fields exchange `YYYY-MM-DD` | A day without a time | `formatCalendarDate`, pinned to UTC |
| Day key | `String`, such as `2026-07-08` | A named calendar day | `formatDayKey`; convert to a UTC-midnight `Date` only where the receiving API requires it |

Instants include `createdAt`, `deadline`, `startedAt`, `finishedAt`,
`offlineSince`, and `lastSyncAt`. Converting their display timezone must not
change the stored instant.

UTC-midnight calendar fields include device purchase, warranty, and maintenance
dates in `backend/models/inventory/clientDevice.js`; service expiry dates in
`backend/models/knowledgeNote.js`; tariff binding `isActiveSince`; absence
`from`/`to`; and `workSchedules[].effectiveFrom` in `backend/models/user.js`.

Day-key strings include production calendar `date` and `transferredFrom`
(`backend/models/productionCalendar.js`, `backend/data/production-calendar/`)
and date answers in ticket template `customFields[].value`. See
[ticket templates](ticket-templates.md). These values should remain named days,
without timezone conversion.

## Timezone responsibilities

| Purpose | Timezone |
| --- | --- |
| Billing, employee overtime, schedule selection, report and ticket/work filter boundaries | `Preferences.timezone`, falling back to `Europe/Moscow` |
| Ordinary frontend timestamps and datetime forms | `personalTimezone`, then organization `timezone`, then `Europe/Moscow` |
| Service report timestamps and exports | The report's organization `zone` |
| Requester's local clock | User, subdivision ancestors, company, then organization timezone |
| Calendar field navigation and `toDateInputValue` | Browser-local calendar days |
| UTC-midnight calendar fields | UTC, to preserve the stored day |

### Organization and personal timezones

`Preferences.timezone` is the business timezone. Configure it in global System
settings. The frontend stores it as `localStorage.timezone` during login
(`frontend/src/pages/Auth/session.ts`) and refreshes it when the root loads
(`frontend/src/layout/Root.jsx`). The personal preference is stored alongside
it as `personalTimezone`.

`frontend/src/util/format-date.js` reads these values on every call. Its
`displayTimeZone()` returns the personal timezone when set, otherwise the
organization timezone or the default. Do not cache that result at module load.

`User.timezone` changes display and form interpretation; it does not change the
organization timezone used to calculate payroll or billing. Employee and service
schedules used by those calculations are expressed in organization wall time.
For example, a 09:30–17:00 shift in Vladivostok corresponds to 02:30–10:00 in
Moscow. Entering local employee hours as organization hours changes the schedule.

The server's process timezone is not the business timezone. Do not depend on
its current UTC deployment setting or on the browser timezone when calculating
business periods.

### Service reports

Service reports display timestamps in the organization timezone used for the
calculation. `frontend/src/components/Report/report-zone` provides
`ReportZoneProvider` and `useReportDates`. The API supplies `zone`; the report
conditions show "Часовой пояс отчёта" (Report timezone). Excel and PDF exports
use the same zone. This keeps an overtime entry visibly outside working hours
even when the viewer has a different personal timezone.

Use the server-provided `row.period` for the period label and `row.month` for
month filtering. `periodFrom.slice(0, 7)` can select the previous month because
local midnight east of UTC falls on the preceding UTC date.

## Backend

### Shared datetime helpers

`backend/utils/datetime.js` owns the backend defaults and formatting helpers.

| Export | Behavior |
| --- | --- |
| `DEFAULT_TIMEZONE` | `Europe/Moscow`, matching the Preferences schema and frontend fallback |
| `resolveTimezone(prefs)` | `prefs?.timezone || DEFAULT_TIMEZONE` |
| `formatInAppTimezone(date, tz, pattern)` | Formats with `date-fns-tz`; on failure falls back to server-local `toLocaleString("ru-RU")` |
| `fmtDateTime(date, tz)` | Numeric date and time; `—` for an empty value |
| `fmtDayMonth(date, tz)` | Day and Russian month name, such as `2 августа` |
| `fmtMonthYear(date, tz)` | Russian month and year, such as `июль 2026` |
| `dayKey(date, tz)` | Calendar day of an instant in the supplied zone, as `YYYY-MM-DD` |
| `dayKeyToUtcMidnight(key)` | Converts a day key to a UTC-midnight `Date` |
| `calendarDateRange(from, to, zone)` | Inclusive calendar keys to MongoDB `$gte` / exclusive `$lt` instant bounds; either bound may be omitted |
| `graceDeadline(value, zone)` | Date-only security deadline to the end of the organization day; preserves explicitly zoned API timestamps |

Use `resolveTimezone` when adding code that reads the organization timezone.
Do not introduce another hardcoded fallback. Existing defaults, including the
bot configuration response, must remain consistent.

`fmtDayMonth` and `fmtMonthYear` use `Intl` for Russian month names. A date-fns
pattern alone does not establish a Russian locale. The fallback in
`formatInAppTimezone` prevents a formatting failure from aborting text creation;
it does not guarantee business-timezone output for an invalid zone.

Consumers include Mikrotik ticket text and export filenames, notifications,
client timezone labels, the work calendar, and `backend/services/reportCard.js`.

### Period boundaries and day comparisons

Build day, month, quarter, and year boundaries in the organization timezone.
For a calendar month, a typical conversion is:

```js
const zone = resolveTimezone(await Preferences.findOne({}));
const from = dayjs.tz("2026-07-01", zone).startOf("month").toDate();
const to = dayjs.tz("2026-07-01", zone).endOf("month").toDate();
```

This requires the dayjs UTC and timezone plugins. Supply `timezone: zone` to
MongoDB date aggregations too. Relevant implementations include dashboard and
company statistics, employee and personal reports, team schedules, and
`backend/services/reportApproval.js` (`monthBoundsOf`).

For "today", absence checks, and schedule version selection on the backend,
use `dayKey(instant, zone)`. Convert the key back with `dayKeyToUtcMidnight`
when querying UTC-midnight calendar fields. East of UTC, the local calendar day
starts earlier than the UTC day: at UTC+10, UTC slicing still returns yesterday
until 10:00 local time.

### List filters and date-only deadlines

Open-ticket creation filters and closed-ticket/work archive filters use
organization calendar days. The frontend compares `organizationDayKey` values;
archive APIs accept `from` and `to` as `YYYY-MM-DD` and resolve each midnight
with `calendarDateRange`. The upper bound is exclusive midnight after `to`.
Do not add 24 elapsed hours: a daylight-saving transition can make the day
23 or 25 hours long. Invalid, timestamp-shaped, or reversed archive date
parameters return HTTP 400.

The security form submits `twoFactorPolicy.graceUntil` as a day key. The backend
stores the instant one millisecond before the next organization-local midnight.
If timezone and policy change in one request, the submitted organization zone
applies. Explicitly zoned timestamps remain accepted for API compatibility;
legacy unzoned datetime strings are interpreted in organization time. Existing
stored deadlines are not migrated. Review an existing grace deadline before
resaving it if it was originally entered with different timezone assumptions.

### Schedulers

Daily maintenance jobs in `backend/app.js` (`registerMaintenanceCrons`) and
routine tasks in `backend/middleware/taskManager.js` pass an explicit timezone
to `cron.schedule`. Maintenance jobs read the setting when registered at startup;
a timezone change requires restarting them. `middleware/routineTasks.js`
validates expressions and delegates scheduling to the manager.

A cadence such as `*/5 * * * *` does not select a particular local hour. Once a
schedule restricts hours or days, its timezone matters. Keep scheduler and
frontend preview timezone selection consistent.

Mikrotik exports use `backend/services/mikrotik/schedule.js` (`computeNextRun`),
which handles calendar dates across daylight-saving transitions.

### Telegram service

The current bot is `tg-service`. Its `src/bot/render.ts` formatter accepts an
explicit timezone and uses `Intl` through `toLocaleDateString`. Ticket deadlines
and update timestamps use `botConfig.timezone`, supplied by
`backend/controllers/bot.js` with the organization timezone and a
`Europe/Moscow` fallback. Overdue status compares instants.

Requester-local clock labels are prepared by the backend's
`formatClientTimeLabel` in `backend/services/clientTimezone.js`. The bot does not
need a second implementation of the timezone inheritance rules.

## Frontend

### Display helpers

These exports come from `frontend/src/util/format-date.js`. Ordinary instant
formatters use the display timezone, not necessarily the organization timezone.

| Helper | Output or purpose |
| --- | --- |
| `displayTimeZone()` | Current personal/organization/default display zone |
| `formatDate` | Date and time with weekday |
| `formatShortDate` | Numeric date of an instant |
| `formatShortDateTime` | Numeric date and time without weekday |
| `formatDateTime` | Day, month name, and time without year |
| `formatWeekdayDateTime` | The same with weekday |
| `formatDayMonthTime` | Numeric day/month and time |
| `formatTime` | Time only |
| `formatDayMonthLong` | Day and month name |
| `formatDayMonth` | Numeric day and month |
| `formatAgo` | Relative past time; older values use `formatShortDateTime` |
| `formatIn` | Relative future time; distant values use `formatDate` |
| `formatCalendarDate` | Stored calendar date, formatted in UTC |
| `formatDayKey` | `YYYY-MM-DD` to `DD.MM.YYYY`, without timezone conversion |
| `formatMonthLabel` | `YYYY-MM` to a month label, preserving the named month |

The date display helpers generally return `null` for empty input; callers can
use `formatShortDate(value) || "—"`. `formatMonthLabel` instead returns an empty
string when it cannot extract a year and month. These are formatting helpers,
not comprehensive input validators.

`formatShortDate`, `formatDateTime`, and `formatWeekdayDateTime` accept an optional
second argument `{ timeZone }`. Service reports use that override through
`useReportDates`. It is an options object so an array callback's numeric index
is not mistaken for a timezone string.

Russian UI output may contain the locale's `в` before the time and `г.` after
the year. Preserve established formats from the UX/UI guide. There are no
`formatMonthYear` or `formatMonth` exports in this frontend module; backend
`fmtMonthYear` is a separate helper.

### Day comparisons and form values

Despite their names, `businessDayKey` and `businessDaysAgo` use the display
timezone, including `personalTimezone`. They serve viewer-relative "today" and
"yesterday" comparisons. Do not use them as proof of the organization's current
day when a personal override is set. The employee form now uses
`organizationDayKey` for active schedule selection and the default effective
date. Backend business rules use `dayKey` with an explicit organization zone.

| Helper | Contract |
| --- | --- |
| `businessDayKey(date?)` | Display-zone calendar day of an instant; defaults to now |
| `businessDaysAgo(date)` | Difference between display-zone calendar days |
| `organizationDayKey(date?, timeZone?)` | Organization calendar day, ignoring the personal override; optional explicit organization zone for settings forms |
| `toDateInputValue(date?)` | Browser-local `YYYY-MM-DD`; defaults to today |
| `toDateTimeLocal(date?)` | Display-zone wall time as `YYYY-MM-DDTHH:mm`; defaults to now |
| `utcToLocalForm(iso)` | Same conversion for an API timestamp |
| `localToUtc(value)` | Display-zone wall time to an ISO UTC timestamp |
| `shiftLocalForm(value, minutes)` | Converts to an instant, shifts by elapsed minutes, and converts back |

The shared date fields keep the same string value contracts as HTML date and
datetime-local inputs, but use the shared calendar UI. Do not replace them with
native date pickers. `components/app/date-value.ts` parses day keys with a local
constructor and returns `toIsoDay`. The internal `Date` is a calendar adapter;
it does not turn the selected day into a zoned instant. Calendar "today" uses
the browser's day.

Datetime form conversion must remain symmetric:

```jsx
// Load a timestamp into DateTimeField.
value={utcToLocalForm(ticket.deadline)}

// Set the current time or add elapsed minutes.
setValue(toDateTimeLocal());
setValue(shiftLocalForm(value, 30));

// Save the field's display-zone wall time as an instant.
formData.append("deadline", localToUtc(value));
```

Saving with `new Date(value).toISOString()` would interpret the string in the
browser timezone instead. With different browser and display zones, an unchanged
form submission could then move the timestamp. Load and save also need the same
display-zone setting during the edit. Do not assume a minute-precision field
preserves seconds from an arbitrary API timestamp.

The conversion helpers format wall-time parts with `Intl` and pass the raw
wall-time string to `fromZonedTime`. A browser-local `Date` must not be an
intermediate representation: its own DST gap can change hours even when the
display zone has no transition. Work-form duration and validation subtract the
same converted UTC instants used for saving.

Datetime fields do not carry an offset or a daylight-saving fold marker.
Ambiguous or nonexistent wall times in the selected display zone follow the
installed timezone library's resolution behavior; they cannot represent both
occurrences of a repeated minute independently.

Countdowns to instants use epoch differences, such as `deadline - Date.now()`.
Calendar-date expiry checks must retain their calendar semantics rather than
silently treating UTC midnight as a local deadline.

### Specialized formatters

The shared formatter is the default for ordinary UI timestamps. Existing pure
formatters may take an explicit timezone when they need a specialized output:

- `frontend/src/util/conversation-format.js`, `conversation-thread.js`, and
  `chronicle-dialog.js` group or label messages and activity in a supplied zone.
- `frontend/src/util/mikrotik-changes.ts` and
  `components/Mikrotik/activity-format.js` format monitoring-specific labels.
- `frontend/src/components/Report/export-format.js` formats report exports with
  an explicit report zone.
- `backend/services/mcp/text.js` deliberately emits ISO-like UTC timestamps with
  a `Z` marker. This is an explicit UTC representation, not server-local time.
- Telegram rendering and backend client-clock labels use the explicit zones
  described above.

Reuse these module-specific helpers within their domain. Do not replace an
explicit report, client, or UTC zone with the viewer's display zone merely to
route every date through one module.

### Related frontend modules

- `util/cron.js` owns routine schedule parsing, validation, descriptions, and
  previews (`nextCronRuns`, `formatCronRun`, `relativeToNow`). It uses the
  organization timezone, matching the server scheduler.
- `util/period.js` builds calendar filter keys in browser time.
- `util/relative-time.js` uses `businessDaysAgo` for address-book relative dates.
- `util/time-helpers.js` owns `msToHMS`; durations have no timezone.
- `util/get-working-status.js` and `useWorkingStatus` show a client's working
  hours using the supplied client zone, with organization time as fallback.

## Client timezone

The requester-local clock helps staff decide when to contact someone. The
backend resolver in `services/clientTimezone.js` uses the first nonempty value:

1. `User.timezone`.
2. `Subdivision.timezone`.
3. Ancestors through `Subdivision.parent`.
4. `Company.timezone`.
5. `Preferences.timezone`, with the shared default.

An empty value means inheritance. Do not copy inherited values into child
records; those copies would become stale when a parent changes timezone.

`services/workCalendar.resolvePersonalTimezone` has a different purpose: it
provides employee-local display time and falls directly back to the organization
zone. It does not traverse client subdivisions. Neither resolver chooses the
zone for payroll or billing calculations.

The API returns `clientTimezone: { timezone, source, sourceName }` in ticket,
user, and subdivision data. `createClientTimezoneResolver` batches resolution
for lists, and `annotateSubdivisionTree` annotates the hierarchy.
`normalizeTimezone`, `isValidTimezone`, `timezoneCity`, `offsetMinutesFrom`, and
`offsetDiffLabel` support validation and labels.

The frontend's `util/timezone-display.js` displays these results. Its
`inheritedTimezone` traversal is only a form hint, not an alternative authority
for the API. Compare actual offsets at the relevant instant when deciding
whether to show a difference; different zone identifiers can share an offset.

Keep `backend/data/timezoneCities.json` synchronized with the primary cities in
`frontend/src/store/timezones.js`. `frontend/src/util/timezone-catalog.test.js`
checks their agreement. The catalog contains city and country labels; offsets
are computed at display time by `util/timezone-catalog`, including daylight
saving. Unknown catalog entries supplied through the API retain their zone ID.

The client working-hours indicator interprets `Company.workSchedule` in the
client timezone supplied to `getWorkingStatus`. This display behavior is separate
from service billing, which uses organization time for the service schedule.
Do not transfer the indicator's zone selection into billing calculations.

## Work schedules and overtime

Employee overtime and customer billing use shared window arithmetic in
`backend/services/workWindow.js`, but choose different schedules:

- `workOvertime.js`, through `workCalendar.js`, uses the employee's schedule
  version for the date, falling back to the default employee schedule.
- `servicePlanBilling.js` uses the service schedule: tariff, then company,
  then default. `workPreview.js` calls billing functions to preview the
  customer's eventual charge.

Both use organization time. Keep personal and employee-summary reports aligned;
do not introduce a separate overtime formula. Tests include
`workWindow.test.js`, `workOvertime.test.js`, `servicePlanBilling.test.js`, the
billing baseline fixture, and `backend/scripts/checkWorkCalendar.js`.
The invariant is **scheduled time + overtime = work duration**.

### Overnight shifts and daylight saving

Parse weekly `{start, end}` windows through `workWindow.windowMinutes`:

| Relationship | Meaning |
| --- | --- |
| `end > start` | Same-day window `[D start, D end)` |
| `end < start` | Overnight window `[D start, (D+1) end)` |
| `end === start` | Zero-length window; use `is24hours` for a full day |

A shift belongs to its start day. Holidays, shortened days, and full-day absence
rules apply to that start day. Overtime categories (`weekday`, `weekend`,
`holiday`) depend on the calendar day when the overtime minute actually occurs.
An overnight scheduled minute is still within the schedule even after midnight.

Overtime is the day segment minus the union of applicable work windows. Include
the previous day's window so an overnight tail covers the next morning.
`backend/validations/workSchedule.js` rejects overlapping adjacent schedules;
calculation merges windows in legacy data to avoid counting minutes twice.

Use `workWindow.instantOf(dateKey, minutes, zone)` to turn schedule wall time
into an instant. Do not calculate it as midnight plus elapsed minutes or mutate
a reused dayjs cursor's hour: fixed offsets can produce incorrect local hours
across daylight-saving transitions.

### Location intervals and partial absences

Personal schedules may contain continuous `intervals` with `office` or `remote`
locations covering the `start`–`end` window, including overnight shifts.
`backend/utils/workScheduleIntervals.js` expresses them as minutes relative to
the shift's start day. Location does not change the overall work window used
for normal hours and overtime. A shortened day trims the final interval with
the shift end. Presence scheduling checks intervals every minute; a manual
choice (`auto: false`) remains protected until the nightly reset.

A partial absence has one start date (`from === to`) and
`timeRange: {start, end}` in organization wall time. An earlier end means the
next day; equal times are invalid. `backend/utils/absencePeriod.js` checks
half-open intervals on a shared calendar-minute axis, including adjacent days.
Convert to actual instants with `instantOf`. Partial absences affect availability
and presence, but do not change the financial `dayPlan`, normal hours, or
overtime boundaries. See [user presence and calendar](user-presence-and-calendar.md).

## Intentional exceptions and mistakes to avoid

UTC slicing is correct when reading a calendar field stored at UTC midnight.
Examples include device date prefills, tariff `isActiveSince`, and schedule
`effectiveFrom`. It is not a general solution for converting an instant to a
date-field value.

`util/period.js`, `WorkCalendar`, and the financial `TimeByDayChart` work with
calendar day keys using browser-local date operations. Change that contract
only together with its consumers; do not reinterpret their keys as timestamps.

Avoid these patterns:

- Formatting instants with an unzoned `toLocaleString` or a component-local
  formatter instead of the shared helpers.
- Using UTC slicing for display-zone or organization-zone "today", or browser
  `getDate`/`toDateString` for comparisons in another zone.
- Assuming `businessDayKey` ignores the personal override, or that
  `toDateInputValue` uses organization time.
- Reading preferences without a fallback, or adding scattered hardcoded zones.
- Building business period boundaries with server-local constructors or
  `setHours`. `new Date(y, m + 1, 0)` is the start of the last day, not the end
  of the month.
- Mixing browser and display zones when loading and saving datetime forms.
- Deriving a business document's period label from a UTC instant on the frontend.
- Duplicating work-window parsing, treating an overnight window as invalid,
  or treating equal start/end times as a full day.

## Remaining cleanup

Some month labels still use local implementations: arrays in
`Company/View/ActivityTiles.jsx` and `Team/calendar.ts`, and `Intl.DateTimeFormat`
in `app/MonthStepper.tsx`, `Report/TrendsChart.tsx`, and
`pages/Finances/PersonalReportPage.tsx`. They use calendar-derived dates rather
than business instants. Consolidation should preserve each label's format and
calendar semantics. The previously listed duplicate `msToHMS` implementations
are gone; the shared implementation is `util/time-helpers.js`.

Regression coverage for timezone conversions, schedule selection, filter bounds,
and security deadlines is in `frontend/src/util/datetime-regression.test.js`,
`backend/controllers/archive-dates.test.js`, `backend/utils/datetime.test.js`,
and `backend/controllers/preferences.test.js`.

## Manual verification

Use test data and independently vary the organization, personal, and browser
zones. These checks describe expected behavior; this documentation review did
not execute them against a running application.

1. Set the organization to `Asia/Vladivostok`, clear the personal override, and
   use a browser in `Europe/Moscow`. Ordinary timestamps and datetime forms
   should show organization time. Save an unchanged minute-aligned deadline;
   its stored instant must not shift.
2. Set the personal zone to `Europe/Moscow` and the browser to a third zone.
   Ordinary timestamps and datetime forms should now use personal time.
   Repeat the unchanged-save check. Creating and reopening a work entry should
   preserve the entered wall time and saved instant. Repeat with a New York
   browser on March 8, 2026, using Moscow display time `02:30`: the browser's
   DST gap must not change the displayed or saved hour.
3. Use an instant close to midnight that falls on different calendar days in
   these zones. `businessDayKey` should follow the display zone,
   `toDateInputValue` the browser, and backend `dayKey` the supplied zone.
4. Change only the personal zone. Service report periods, report timestamps,
   exports, overtime totals, and billing totals must remain in organization
   time and retain their values.
5. Enter device purchase/warranty dates, a tariff effective date, an absence,
   and a schedule effective date. Reopen them with different timezone settings;
   each stored calendar day must remain unchanged. Check default "today" values
   against the field's intended browser or organization calendar explicitly.
6. Select a single day and a month in archive filters. Verify that the returned
   period matches those organization calendar keys and includes the whole final
   day, including the last millisecond. Check both 23-hour and 25-hour DST days.
7. Compare server-generated notification timestamps and Telegram deadlines with
   the organization timezone. Check requester-local clock labels separately
   against the inheritance chain.
8. Compare routine-task previews with actual scheduled executions in organization
   time. Re-register/restart maintenance scheduling after changing its zone.
9. Check overnight and daylight-saving schedules, zero-length and full-day
   windows, and partial absences crossing midnight. Preserve the overtime
   invariant and the existing financial treatment of partial absences.
10. Save a two-factor grace date with organization, personal, and browser zones
    all different. Reopen it and verify the same organization date. The stored
    instant must be the end of that day in organization time.
