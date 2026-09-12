# In-app notifications (bell, unread markers, seen tickets)

Implementation notes for the in-app channel. UI conventions live in
`docs/ux-ui-guide.md` («Уведомления в приложении»); this file covers the data,
the producers and the endpoints.

## Two tiers

| | Bell (inbox) | Unread markers |
|---|---|---|
| Answers | "What happened that concerns me?" | "Did anything happen on this ticket since I last looked?" |
| Storage | `InAppNotification` — one document per recipient per event | `TicketRead {userId, ticketId, seenAt}` + `Ticket.activity {at, by}` |
| Produced by | The notification cron, table-driven (`services/inAppNotifications.js`) | Mongoose save hooks on `Ticket` and `Comment` |
| Consumed by | `GET /api/notifications`, `/summary`, `POST /read` | `unread` on list items (`getAllOpened`), `seenAt` on the ticket card (`getOne`) |
| Read | Click, opening the ticket, «Прочитать все» | Opening the ticket (`POST /tickets/:num/seen`), bulk `POST /tickets/seen` |

The outbox collection `notifications` (`models/notification.js`) is unrelated:
it queues outbound e-mail and Telegram messages and has no recipient user id
and no read state.

## Data

- `models/inAppNotification.js` — `userId`, `category` (one of the ten notify
  keys shared with `prefs.notify.personal` and `user.notify.*`), `kind` (a
  `KINDS` name from `services/ticketEvents.js` or one of
  `absenceRequest|absenceDecision|reportApproval|reportDecision`), `ticketId`,
  `ticketNum`, `ticketTitle`, `commentId`, `actor {_id, firstName, lastName} |
  null`, `title`, `text` (≤ 200 chars), `link` (route path), `readAt`.
  Indexes: `{userId, readAt, createdAt}`, `{userId, ticketId}`, TTL 90 days on
  `createdAt`. Types: `types/inAppNotification.ts`.
- `models/ticketRead.js` — unique `{userId, ticketId}`, `seenAt`.
- `Ticket.activity {at, by}` — last movement of the ticket. Set by the
  `pre("save")` hook when `shouldBumpActivity(doc)` holds: the document is new,
  `notifications.lastAction` changed, or `notifications.pending` flipped to
  `true`. Every lifecycle handler assigns `ticket.notifications = {lastAction,
  pending: true}`; the cron's `pending = false` saves do not match. `by` is
  `updatedBy`, which every lifecycle handler now sets (seven handlers used to
  leave it stale — `requestHelp`, `joinResponsibles`, `updateDeadline`, `reject`,
  `close`, `backToWork`, `closeMultiple`).
- `Comment` post-save (new documents only) does
  `Ticket.updateOne({_id}, {$set: {activity: {at: createdAt, by: createdBy}}})`.
  Mongoose awaits async post hooks, so a `markSeen` placed after
  `comment.save()` is guaranteed to land after the bump.
- `User.notify.inApp.<category>` — the personal switch of the channel, default
  `true`; a missing field means enabled (existing users have no field).
- `responsibles[].isNotified.inApp` — the once-only latch for «Вы назначены
  ответственным», like `telegram` / `email`. Self-assignment presets it to
  `true`; the cron sets it for every responsible an event *considered*,
  whether or not the personal gate let the item through.

No backfill: a ticket without `activity` has had no movement since the feature
shipped, so nothing is unread on day one.

## Unread semantics (`services/ticketUnread.js`, pure, tested)

```
isUnseen    = activity.at && activity.by !== me && (!seenAt || activity.at > seenAt)
newComments = seenAt ? count(comments with createdAt > seenAt and createdBy !== me) : 0
```

A never-opened ticket shows the dot only — "new since when?" has no answer.
The actor never sees their own action as unread: the predicate excludes
`activity.by === me`, and the server upserts the actor's watermark after the
actions that do not open the ticket page — `ticket.add`, bulk take/close,
`comment.add`/`addMultiple`, staff replies arriving by e-mail. Order matters:
bump first, then `markSeen`, so `seenAt ≥ activity.at`.

`unreadIndex(tickets, {userId})` loads the watermarks in one query; `getAllOpened`
attaches `unread: {isUnseen, newComments}` to every item (staff list, staff
dashboard block, client «Активные» tab all read this endpoint). `getOne` returns
`seenAt` — the watermark *before* this visit — so the chronicle can draw the
«Новые» divider on first paint; the page then calls `POST /tickets/:num/seen`.

## Producers (`services/inAppNotifications.js`)

`TICKET_EVENTS` maps `ticket.notifications.lastAction` to rules
`{category, kind, title, audience, skipIfClosed?, text}`; audiences are
`applicant`, `responsibles`, `newResponsibles` (latch), `managers`
(`permissionFilter("ticket.manage")`). One item per person per event, the
first matching rule wins (a newly assigned manager gets «Вы назначены», not
«Новая заявка»). The actor is excluded, service accounts and banned users are
never recipients (they cannot sign in), and the gate is
`prefs.notify.personal[category] && user.notify.inApp?.[category] !== false`.
Tickets created by machines (Mikrotik monitoring, e-mail ingestion, routine
tasks) are ordinary tickets: same rules, same recipients, and the monitoring
account appears as the author like anyone else.

| lastAction | category / kind | audience |
|---|---|---|
| new ticket | respStateUpdate / processed | newResponsibles |
| new ticket | newTicket / created | managers + applicant |
| process ticket | respStateUpdate / processed | newResponsibles; skip when closed |
| take ticket to work | ticketStateUpdate / taken | applicant |
| request help | respStateUpdate / helpRequested | newResponsibles |
| join responsibles | respStateUpdate / joined | other responsibles |
| update deadline | ticketDeadlineUpdate / deadline | applicant + responsibles; skip when closed |
| reject ticket | respStateUpdate / rejected | managers + remaining responsibles |
| close ticket | ticketStateUpdate / closed | applicant + responsibles |
| back to work | ticketStateUpdate / reopened | applicant + responsibles |
| new comment | ticketNewComment / comment | applicant + responsibles, minus author |
| scheduled works | scheduledWorks / workAdded, workUpdated | applicants + responsibles of the works' tickets |

Three calls in `middleware/notifications.js`, one per cron job, placed *before*
the `switch`: `notifyTicketEvent` (also covers `join responsibles`, which has
no branch of its own), `notifyCommentEvent`, `notifyWorksEvent`.
`services/absenceNotifications.js` and `services/reportApprovalNotifications.js`
call `pushInApp` with their explicit recipient lists (`linkFor` gives the
approver a personal `/approval/<token>` path).

The two channel gates that skipped the cron entirely when neither e-mail nor
Telegram was configured are gone (`app.js` and the three early returns in the
jobs): the in-app channel always exists, and `notifyTg` / `notifyEmail` check
their own `isActive`. Comment `pending` is therefore unconditional in
`controllers/comment.js`; the closing/returning comments created with
`pending: false` stay that way (the ticket event carries them).

## Endpoints (all behind `isAuth`, all scoped to `req.auth.userId`)

- `GET /api/notifications?before=<ISO>&limit=30` → `{items, unreadCount, nextBefore}`
- `GET /api/notifications/summary` → `{unreadCount, latestAt}` (polled every 15 s)
- `POST /api/notifications/read` `{ids? | all? | ticketId?}` → `{updated, unreadCount}`
- `POST /api/tickets/:ticketNum/seen` (ticket access asserted) → `{seenAt, previousSeenAt, unreadCount}`; retries once on E11000 (mount and poll can race)
- `POST /api/tickets/seen` `{ids}` (access asserted for every id) → `{seenAt, count, unreadCount}`

Files: `controllers/notification.js`, `validations/notification.js`,
`routes/internal/notification.js`, two routes in `routes/internal/ticket.js`.

## Tests

`services/inAppNotifications.test.js`, `services/ticketUnread.test.js`,
`services/ticketSeen.test.js` — `node --test`, pure fixtures, no database.
Run with `cd backend && pnpm test`.

## Pitfalls

- A lifecycle handler that forgets `ticket.updatedBy` attributes the movement
  to the previous editor: the actor then sees their own action as unread and
  the item's author is wrong.
- `shouldBumpActivity` relies on `isModified("notifications.lastAction")`
  after a wholesale reassignment of `notifications`; setting child paths works
  too (`updateDeadline` does). A `pending = false` save is never a movement.
- The `isNotified.inApp` latch must be set for every considered responsible,
  gate or not; otherwise re-enabling the category replays a stale «Вы
  назначены» on the next unrelated edit.
- Deleting a ticket leaves its inbox items and watermarks behind (they expire
  by TTL / are harmless); clean them up in `delete` if it ever matters.
