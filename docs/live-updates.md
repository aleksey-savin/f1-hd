# Live updates (pulse) — Implementation Notes

_Last updated: 2026-09-13. How open pages learn that their data changed on the
server. Interface rules (what pauses, what never toasts) live in
`docs/ux-ui-guide.md`; this file covers the mechanism. A snapshot, not a spec —
verify against the code._

## Why

Until 2026-09-13 every widget polled its own heavy endpoint on its own timer
(`hooks/use-polling.js`, removed): `/tickets/all-opened` (~14 DB round trips)
and `/tickets/:num` (~17) every 15 s per open tab, the approval pipeline
repricing every unbilled work every 20 s — whether or not anything had changed.
The ticket card's change check (`ticketSignature`) missed comment edits, work
deletions and responsible swaps, and fired on the notification cron's
`pending=false` saves. Updates that arrived while a poll was paused were lost.

Now: **one light request per tab** returns change revisions; a page refetches
only when its topic moved. Server push (SSE) was rejected for now — the outer
production proxy is not in the repo and, without HTTP/2 there, several tabs
would exhaust the browser's 6 connections per origin. The client transport is an
interface, so SSE can replace polling without touching pages.

## Backend

### Bus — `services/pulse.js`

In-memory, no I/O. `createBus()` / singleton `bus`:

- `epoch` — random per process start. Counters mean nothing across processes;
  a cursor with another epoch is ignored and the client refetches everything.
- One global monotonic `rev`; each topic stores the `rev` of its last bump, so
  one cursor number compares against any topic.
- Topics: `tickets`, `presence`, `team`, `mikrotik`, `approval`, `knowledge`.
- Per ticket: an LRU `Map<ticketId, rev>` (5000 entries). An evicted ticket
  reports the newest evicted revision (`ticketFloor`) — conservative, never
  "unchanged" by mistake. A write whose ticket is unknown bumps `anyTicketRev`,
  which counts for every ticket.
- Per user: inbox revision (in-app notifications), plus `anyUserRev`.
- `bump()` never throws.

### Which writes move which topic — `services/pulseTopics.js`

One reviewable spec per model: `topics` or `byPath` (User), where the ticket id
lives (`ticket: "self" | field`), the inbox owner (`user`), and `noise` —
`(path, value, op) => boolean`. A write touching only noise paths is not a
change. Current noise:

- `updatedAt`, `__v` everywhere.
- Ticket/Comment/Work: `notifications.pending` set to anything but `true`, and
  any `isNotified` latch — the notification cron's bookkeeping saves.
- User: anything outside the presence paths (`workStatus`, `nextShiftAt`,
  names, avatar, `banned`, `hideWorkStatus`, …) and team paths (`workSchedules`,
  `timezone`, `workTimeMode`, `remoteOnly`, …) — `lastLogin`, `lastActivityAt`
  move nothing.
- Mikrotik: the per-poll `$set`/`$unset`/`$inc`/`$min` shapes of
  `services/mikrotik/monitorState.js`. Real transitions are bumped explicitly
  there (`recoverToOnline` when the device was not online or its identity
  changed, `recordFailure` on confirmation); `runMikrotikFirmwareRefresh`
  bumps once at the end. Alert stamps and operator edits are not noise.

### Plugin — `services/pulsePlugin.js`

`schema.plugin(require("../services/pulsePlugin"), { model: "Ticket" })` sits in
each model file right before `mongoose.model()` — Mongoose copies hooks at model
compile time, so a global plugin would silently miss models required first. In
`models/ticket.js` it is registered after `touchActivity`.

Models: Ticket, Comment, TicketLog, Work, User, Absence, ProductionCalendar,
Mikrotik, MikrotikArtifact, KnowledgeNote, ServicePlanReport, ServicePlan,
InAppNotification.

- `save`: `pre` classifies `directModifiedPaths()` with their new values into
  `$locals.pulse`; `post` bumps (post hooks run only after a successful write).
- Query writes (`updateOne/Many`, `findOneAndUpdate/Replace/Delete` incl.
  `findById*`, `replaceOne`, `deleteOne/Many`; document `deleteOne()` /
  `updateOne()` run as these queries): update keys are classified once per
  query. Ticket ids come from `getFilter()._id` (scalar / `$in` / `$eq`);
  Comment/Work/inbox ids not pinned by the filter are pre-read with a lean
  `find(filter).select(field)` capped at 1000 (over the cap → "any ticket").
  Bumps only when `modifiedCount/upsertedCount/deletedCount > 0` or a document
  came back. Note: Mongoose timestamps make a same-value `updateOne` report
  `modifiedCount: 1` — such writes still bump (harmless, rare).
- `insertMany`, `bulkWrite` (bulkWrite bumps "any ticket"/"any user").
- Every hook swallows and logs (`warn`): a pulse failure never breaks a write.

Not covered (the client's max-staleness refresh backs these up): raw driver
writes (`mongoose.connection.db…`, better-auth adapter), TTL deletes, writes
from other processes (the legacy Mongo-writing telegram bot), manual mongosh.

### Endpoint — `GET /api/pulse?cursor=<epoch>:<rev>&ticket=<id>[,<id>…]`

`routes/internal/pulse.js` (`isAuth`), `controllers/pulse.js`.

```json
{ "epoch": "mtz1jckj-1de90e", "rev": 18423, "pollMs": 10000, "appVersion": "2.0.1",
  "topics": { "tickets": 18420, "presence": 18011, "team": 17002, "mikrotik": 18100, "approval": 18400, "knowledge": 16000 },
  "tickets": { "<id>": 18419 },
  "notifications": { "unreadCount": 3, "latestAt": "…" } }
```

- `rev` is captured first: whatever changes during the handler reaches the
  client with the next pulse.
- End users get only `tickets` and `approval` topics.
- Up to 3 watched tickets. A ticket's revision is access-checked
  (`canAccessTicket` on a lean scope projection) only when it reports a change
  past the cursor; inaccessible → `null`.
- `notifications` (the bell summary, `summaryFor` in `controllers/notification.js`)
  only when the inbox moved past the cursor or there is no cursor.
- `Cache-Control: no-store`. Cost: `attachSession` reads + O(1) memory.

### `X-Pulse-Cursor` on every internal API response

A middleware in `routes/index.js` (before `attachSession`) stamps the cursor at
request start — before the handler reads data. A route loader keeps it as its
baseline, so its own action's bump does not trigger a second heavy reload.
Exposed via `Access-Control-Expose-Headers` for a cross-origin dev setup.

## Frontend

- `lib/pulse/live-cursor.ts` — pure consumer logic (tests:
  `live-cursor.test.js`). A consumer keeps a **baseline** cursor and is dirty
  when a watched topic/ticket revision exceeds it, the epoch differs, or
  `maxStaleMs` (default 10 min) passed. The baseline advances only when the
  refetch actually runs (to the snapshot that triggered it; forward-only), so a
  change that arrives while paused (`enabled: false`, still running,
  `minIntervalMs`) is applied as soon as the pause ends. A failed run keeps the
  baseline and retries on the next pulse. No baseline yet → the first snapshot
  is adopted silently.
- `lib/pulse/transport.ts` — `PulseTransport {start, stop, poke}`; polling
  implementation: no requests while the tab is hidden, an immediate pulse on
  becoming visible, exponential backoff up to 60 s on errors.
- `store/pulse.ts` — last `snapshot`, `appVersion`, `pollMs`, ticket watch
  refcounts (`watchTicket`), requested faster cadences (`requestCadence`).
- `components/app/PulseLoop.tsx` — mounted once in `layout/Root.jsx` for a
  signed-in person. Delay = `min(pollMs, cadences)`, never below 3 s. Every
  5 min the request goes without a cursor to resync the bell summary. Hands
  `notifications` to `store/notifications.ts → applySummary`.
- `hooks/use-live-topic.ts` — `useLiveTopic(topics, onChange, { enabled,
  ticketId, baseline, maxStaleMs, minIntervalMs })`. Subscribes to the store
  outside React (a pulse re-renders nothing). Initial baseline: the loader
  cursor if given, else the last pulse (not newer than the page's own fetch).
- `hooks/use-live-route-revalidate.ts` — same, but the change re-runs the route
  loader through `useDeferredRevalidate` (`components/app/use-refresh-route.js`):
  only when the revalidator and every fetcher are idle (React Router crashes
  with "Did not find corresponding fetcher result" otherwise).
- `components/User/PresenceSync.tsx` — the only fetcher of
  `/api/users/work-statuses` (staff); the rail, «Команда сейчас», the users
  list (`mergePresence`), the user card and the navbar's own status read
  `store/work-statuses`. Own status and the user card take the newer of loader
  and live `workStatus` by `updatedAt` (`newerWorkStatus` in
  `components/User/presence.js`).

### Consumers

| Page / block | Topic | On change | Options |
|---|---|---|---|
| Bell | inbox (in the pulse) | `applySummary` | — |
| Presence rail, TeamNow, users list, user card presence, navbar status | presence | `PresenceSync` refetch | — |
| New-version banner | `appVersion` | re-render | — |
| Dashboard open tickets | tickets | `dashboard-tickets.refresh` | 15 s min |
| Ticket list | tickets | `silentRefresh` | paused during selection / open sheet; 15 s min |
| Ticket card | ticket `_id` | deferred loader revalidate | baseline = loader cursor; paused under a sheet or checklist edit |
| AI guide pending | (ticket watch) | — | `requestCadence(4000)` while pending |
| Mikrotik list / record | mikrotik | `silentRefresh` / deferred revalidate | 5 min max staleness |
| Dashboard monitoring offline | mikrotik | block `load` | — |
| Dashboard scheduled works, client closed tickets | tickets | block `load` | 30 s min |
| KB moderation counts (dashboard + KB) | knowledge | `knowledgeModeration.refresh` | moderators only |
| KB list | knowledge | `fetch({ silent: true })`; silent refetch on return | — |
| User card tickets | tickets | deferred revalidate | 30 s min, paused under a sheet |
| Team calendar | team + presence | `silentFetch` | 30 s min |
| Client device monitoring / tickets panels | mikrotik / tickets | panel refetch | 5 min max staleness / 30 s min |
| Approval pipeline / report / preview | approval | `silentRefresh` / `load` | 20 s min; report paused while busy |

Deliberately not live: archive, reports, catalogs, roles, templates, preferences.

## Adding live data to a page

1. Pick the topic. If the data lives in a model without the plugin, add the
   plugin line and a spec entry (with its noise) — or an explicit `bus.bump`
   where the write is not a Mongoose write.
2. `useLiveTopic(topic, silentRefetch, …)` for store/state pages,
   `useLiveRouteRevalidate(topic, { baseline: data.pulse })` for loader pages
   (return `response.headers.get("X-Pulse-Cursor")` from the loader).
3. The refetch must be silent: no spinner, no error banner over shown data.
4. Never add a `setInterval` for live data.

## Pitfalls

- **A GET must never write a topic model on every call** — pulse → refetch →
  write → bump is a loop. `expireStalePending*` in `getOne` fires once per stale
  ticket; `/seen` writes `TicketRead` and `InAppNotification` (inbox only).
- **Single process.** In-memory counters and a per-process epoch break with more
  than one backend replica (round-robin would flip the epoch on every pulse).
  Scale out only after moving the bus to shared storage behind the same
  interface.
- A new frequent machine write on a topic model (a cron touching every
  document) wakes every subscribed page — give it a noise rule or an explicit
  transition bump.
- Clients see only "something changed" timing for the global `tickets`
  topic; per-tenant topic keys are needed before multi-tenant SaaS.

## Tests

`backend/services/pulse.test.js`, `backend/services/pulsePlugin.test.js`
(hydrated real models — `directModifiedPaths` naming is Mongoose's; exact
`monitorState.js` update shapes), `frontend/src/lib/pulse/live-cursor.test.js`.
Run `cd backend && pnpm test`; `cd frontend && node --test src/lib/pulse/live-cursor.test.js`.
