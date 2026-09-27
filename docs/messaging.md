# Messaging («Диалоги») — Implementation Notes

_Last updated: 2026-09-25. P0 backend foundation: channels, ingest, mirroring
into tickets, the outbound queue, the gateway and staff HTTP contracts. Design
decisions and the mockup are in
`docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md`; this file is
a snapshot of the backend contract as implemented — verify against the code._

_P1b (2026-09-27): staff UI additions — queue counts, identity candidates,
`ticket.boundAt`, the `channels` pulse topic, the channel failure alert; the
frontend map closes §7._

## 1. Overview

«Диалоги» ("Dialogues") is HD's messaging inbox: every client conversation from
a corporate Telegram/WhatsApp account, the MAX bot, or a website form lands
here, and staff reply from HD into the same channel. **The backend owns all
state** — channels, conversations, messages, the outbound queue; adapters are
thin and stateless, and all of them emit the same normalized event shape
(`services/messaging/events.js`) into the same ingest entry point
(`services/messaging/ingest.js`), and drain the same outbound job queue
(`services/messaging/jobs.js`).

In P0 the only adapter wired up is **msg-gateway**, an external service that
holds the live Telegram (MTProto/GramJS) and WhatsApp (Baileys) sessions and
talks to the backend over `/api/gateway/*` (§6). A backend-side MAX webhook
adapter and the public site-form endpoint are out of scope for P0 (their
adapters land in later phases) but consume the identical event/job contract —
nothing here is Telegram/WhatsApp-specific except the gateway transport itself.

## 2. Collections

- **`channels`** (`models/channel.js`) — one document per connected corporate
  account: Telegram/WhatsApp (gateway-held session), the MAX bot, or a site
  form. Secrets (`secrets.*`) are `secretBox` ciphertext; only the gateway ever
  sees them decrypted (`controllers/gateway.js#channels`). Messenger sessions
  themselves are **not** stored here — they live in the gateway's own volume,
  so a dev database copy never carries a live prod session. Indexes:
  `{type, isActive}` (gateway's own channel listing); unique sparse
  `{"settings.site.formKey": 1}` (routes an untrusted site-form POST to exactly
  one channel; sparse because only `type: "site"` channels set it).
- **`channelidentities`** (`models/channelIdentity.js`) — one row per external
  party per network: a Telegram id, a WhatsApp phone, a MAX user id, or a site
  visitor. Linked to an HD `User` only on hard evidence
  (`services/messaging/identity.js`) — Telegram id ↔ `User.telegramBot.chatId`,
  or phone ↔ **exactly one** user found by `findUsersByPhone` (same matching as
  `findApplicantByPhone`/`services/callerIdentityService.js`, plus banned/service
  filtering); a phone shared by two or more people is not evidence — nobody
  gets linked. Never by name or username. Unique
  `{network: 1, externalId: 1}` is the dedup key `resolveIdentity` upserts
  through, so two concurrent events for the same sender never create two
  identities. Also `{network, aliases}` (WhatsApp phone↔LID rewrites),
  `{userId}` (reverse lookup once linked), sparse `{phone}`.
- **`conversations`** (`models/conversation.js`) — one row per chat per
  channel: a direct chat, a group, or a site-form "conversation". Carries the
  denormalized `lastMessage` summary, the `binding` to an open ticket (direct
  chats only), the post-close `decision` prompt, and `awaitingSince`/
  `waitNotifiedAt` for the "waiting for us" clock. Unique
  `{channelId: 1, externalChatId: 1}` is the dedup key `upsertConversation`
  relies on (`findOneAndUpdate` with `upsert: true`; a duplicate-key race from
  two concurrent first-messages is retried as a plain update). Also
  `{hidden, awaitingSince}`, `{hidden, "lastMessage.at"}`,
  `{companyId, "lastMessage.at"}`, `{assigneeId, "lastMessage.at"}` (the list
  queues, §7), `{"binding.ticketId"}`, `{counterpartIdentityId}`,
  `{"participants.identityId"}`.
- **`messages`** (`models/message.js`) — every inbound/outbound/system line.
  Carries `effects.{conversation,attach,notify}`, the per-step idempotency
  latch that makes replay safe (§4). Two **unique partial** indexes carry the
  whole ingest's correctness:
  - `{channelId: 1, externalChatId: 1, externalId: 1}`, partial on
    `externalId: {$type: "string"}` — a gateway retry of the same event can
    never create a second message; `insertMessage` catches the resulting
    `E11000` and returns the existing winner instead.
  - `{commentId: 1}`, partial on `commentId: {$type: "objectId"}` — one
    message maps to at most one mirrored comment.
  Plus `{conversationId, sentAt, seq}` (chronological read), `{conversationId,
  updatedAt}` (`changedSince` polling), `{ticketId}`, sparse `{jobId}`,
  `{channelId, externalId}`.
- **`channeljobs`** (`models/channelJob.js`) — the outbound/command queue for
  the gateway (send, markRead, fetchMedia, login, logout, loadHistory,
  testProxy). No natural unique key (a job has no external id before it is
  sent). `{state, network, notBefore, createdAt}` and `{conversationId, state,
  createdAt}` back the leasing query and per-conversation head ordering (§5); a
  partial TTL index on `finishedAt` (30 days, only documents that have one)
  prunes finished jobs — long enough to debug a failure, short enough not to
  grow forever.
- **`conversationreads`** (`models/conversationRead.js`) — one read watermark
  per `(user, conversation)`, the messaging equivalent of `TicketRead`. Unique
  `{userId: 1, conversationId: 1}` is exactly the upsert key
  `POST /conversations/:id/seen` writes through, and the same compound index
  backs the list's per-viewer unread counts (`{userId, conversationId: {$in:
  ids}}` — equality then `$in`, in that order). The separate `{conversationId}`
  index isn't used by any P0 query today.

## 3. Events

Every event (`services/messaging/events.js#validateEvent`) carries `type`,
`channelId` (24-hex ObjectId string) and `at` (defaults to receipt time).
Limits: text ≤ 20 000 chars, ≤ 20 attachments per message, ≤ 100 ids per
`message.deleted`, ≤ 50 events per `/gateway/events` batch.

| `type` | Fields | Notes |
|---|---|---|
| `message` | `chat` (below); `message.id`, `.direction` (`in`\|`out`), `.origin`, `.jobId`, `.sender`, `.kind`, `.text`, `.attachments[]`, `.replyToId`, `.sentAt`, `.imported`, `.form.fields[]` (≤30, label ≤100, value ≤5000) | Inbound: `origin` is left to the server (only the literal `"form"` may be sent); `sender` is required. Outbound: `origin` defaults to `"device"`, must be `device`\|`hd`; `hd` requires `jobId` (see below). |
| `message.edited` | `chat` (kind optional), `message.id`, `message.text`, `message.editedAt` | No-op if the text is unchanged. |
| `message.deleted` | `chat` (optional), `messageIds[]` (1–100) | A mark (`deletedAt`), not an erase — the mirrored comment keeps its text. |
| `message.status` | `status` (`sent`\|`delivered`\|`read`\|`failed`), `error`, either `jobId` **or** `chat`+`messageIds` | Status only advances (`advanceStatus`, `rules.js`), never regresses. |
| `chat` | `chat` (kind optional; `participants[]` ≤500; `migratedToChatId`) | Metadata/participants sync; ignored if the conversation is not known yet. |
| `channel.state` | `state` (one of the 9 `Channel.state` values), `reason`, `account`, `login.qr`/`.expiresAt` | Gateway → channel connection status (QR, awaiting code, banned, …). |

`chat` shape: `{id, kind: "direct"|"group"|"form", title, peer, participants[],
migratedToChatId}`. `peer` is the **other** party of a direct chat — resolved
independently of `message.sender` so the counterpart can still be identified
on an outbound/device message (which has no `sender`) and so the corporate
account itself is never mistaken for its own counterpart.

`origin` meaning: `"device"` = sent from the corporate phone/app directly (not
through HD) — mirrored under `Channel.serviceUserId` (§4); `"hd"` + `jobId` =
the gateway's echo of a message HD itself queued — it confirms delivery of an
existing `Message`, it never creates a new one (`confirmOwn`, `ingest.js`).

`imported: true` marks history backfill: such messages are stored and shown in
the chat, but never start or clear the waiting clock (`nextAwaiting`) and are
never attached to a ticket (`decideAttach`) — they only fill in the timeline.

## 4. Ingest invariants

`services/messaging/ingest.js` is the single entry point for every event,
called by the gateway (`POST /gateway/events`) and, in later phases, the MAX
webhook and the site form.

- **Replay via `effects`.** Each `Message` carries
  `effects.{conversation,attach,notify}`; `ingestMessage` runs a step only
  while its flag is still false, then sets it. A retried event is found by the
  unique `{channelId, externalChatId, externalId}` index and simply resumes at
  the first unfinished step — once every step has run, a retry is a pure no-op.
- **Only-if-newer summary.** `Conversation.lastMessage`/`Channel.lastMessageAt`
  update behind a `$lte` guard on the incoming `sentAt`, so a delayed or
  out-of-order event never overwrites a newer summary.
- **Awaiting rules** (`nextAwaiting`, `rules.js`). A client message starts
  `awaitingSince` only if it isn't already waiting; any of our own replies (HD,
  device, or — in a **group** only — a staff-linked identity) at or after that
  timestamp clears it. An inbound message from a staff-linked
  `ChannelIdentity` counts as `origin: "staff"` **only in group chats**; in a
  **direct** chat the same identity is still `origin: "client"` and starts the
  wait — a direct chat is the corporate account talking to one external party,
  regardless of which HD user that party's identity happens to be linked to.
  `imported` and `system` messages never touch the clock.
- **Attach rules** (`decideAttach`, `rules.js`). A **direct** chat with a live,
  open binding attaches as `"bound"`. A **group** reply-quote to a message
  already in an *open* ticket attaches as `"reply"`; quoting one from a
  *closed* ticket only sets `suggestTicketId` (a hint, not an attach). A
  binding whose ticket was closed or deleted out of band ends itself right
  here; a client message arriving within 30 days (`DECISION_WINDOW_MS`) of a
  **closed**-reason ending opens the "about ticket #X?" prompt
  (`conversation.decision`) exactly once. Answering **«Без заявки»**
  (`POST /conversations/:id/decision {action:"none"}`) also sets
  `binding.endReason: "manual"` on that ended binding, so the same closure
  never asks again. History (`imported`) and our own `origin:"hd"` outbound are
  never attached here — an HD reply is attached by `queueOutbound` itself, at
  send time.
- **Mirrored comments** (`mirrorToTicket`, `services/messaging/mirror.js`).
  Idempotent on `Comment.channel.messageId`: a duplicate insert from concurrent
  replay collides on the unique partial index `channel_messageId_unique`
  (`{"channel.messageId": 1}`, `partialFilterExpression:
  {"channel.messageId": {$exists: true}}`) — the losing writer deletes its own
  attachment copies and reuses the winner's comment id, so there is exactly one
  mirror per message even under a concurrent retry. `Comment.createdAt` is set
  to the **messenger** time (`message.sentAt`), not insert time, so the
  timeline sorts correctly for delayed delivery. The comment id is
  `$addToSet`-ed into `ticket.comments` (the UI reads only that array).
  `notifications.skipApplicant` is set when the applicant themselves is a
  participant of the conversation (`userTalksHere`) — they already saw the
  message in the chat. The `channel` block is names-only
  (`mirrorAuthorName`/`commentChannel`) — no phone, username or external id,
  since the client sees this block in their own ticket. Ready attachments are
  copied (`storage.copyObject`), never referenced directly. **Author**, in
  order: `message.authorUserId` if the message already has one (a staff
  reply); else, for an **outbound** message, `Channel.serviceUserId` (the
  "from the corporate phone" author); else the linked identity's user; else
  `Preferences.defaultApplicant` (an unlinked client). When several messages of the same
  conversation/ticket/direction mirror in a burst, only the **newest** comment
  keeps `notifications.pending: true` (`mirrorToTicket`'s own `updateMany`
  clears it on the older, not-yet-notified ones) — the notification cron fires
  exactly once, with the latest text.
- **The "waiting" bell** (`notifyWaiting`, `services/messaging/notify.js`):
  category `conversationMessage`, kind `conversationWaiting`
  (`EXTRA_KINDS`, `models/inAppNotification.js`), link
  `/conversations/<id>`. Recipients: the conversation's `assigneeId` if set,
  else the responsibles of `companyId` if known, else everyone holding
  `conversation.manage`. **Skipped entirely while
  `Preferences.modules.messaging.isActive` is false** (`applyNotify`,
  `ingest.js`) — the module being off must not ring a bell that leads to a page
  nobody can open. **One bell per wait**: `applyNotify` claims the send
  atomically (`Conversation.updateOne` on `{_id, awaitingSince,
  waitNotifiedAt: {$ne: awaitingSince}}` → `$set waitNotifiedAt`), so a racing
  duplicate delivery of the same event never fires twice for the same waiting
  period. `inAppNotifications`' `insert`/`pushInApp` return the number of
  documents **actually inserted** (`InAppNotification.insertMany(...).length`),
  not the recipient count — a muted or already-covered recipient doesn't count.

## 5. Jobs

Types and payloads (`models/channelJob.js`, `services/messaging/jobs.js`):

| Type | Payload | Enqueued by |
|---|---|---|
| `send` | `{chatId, kind, text, attachments: [{name, originalName, mimetype, size}]}` | `queueOutbound` (a reply); `repairOutbound` (recovery) |
| `markRead` | `{chatId, upToExternalId}` | `POST /conversations/:id/seen`, when the channel is a gateway network and `markReadOnOpen` is on |
| `fetchMedia` | — | Not yet enqueued by any P0 endpoint (contract for a later re-fetch of skipped/deferred media); the ack consumer already exists — a `done` result's `result.attachments[]` (≤20) replaces the message's attachment list |
| `login` | `{step: "start"\|"phone"\|"code"\|"password", value}` | `POST /channels/:id/login`; `value` is `secretBox`-ciphertext at rest, decrypted only in the `GET /gateway/jobs` response, and nulled out on ack |
| `logout` | `{}` | `POST /channels/:id/logout` |
| `testProxy` | `{}` | `POST /channels/:id/test` |
| `loadHistory` | `{days}` (1–90) | `POST /channels/:id/history` |

**Leasing** (`leaseJobs`): a 2-minute lease (`LEASE_MS`) per batch (`leaseId`),
one `findOneAndUpdate` per job so two pollers never take the same one.
**Head-of-conversation ordering**: among pending jobs that belong to a
conversation, only the single oldest per `conversationId` is eligible in a
batch (`pickHeads`) — a later reply can never race ahead of one still waiting
on a retry; jobs without a `conversationId` (login/logout/test/history) are
always eligible.

**Ack** (`ackJobs`): `POST /gateway/jobs/ack {leaseId, results: [{id, ok,
error?, retryAfterMs?, retryable?, result?}]}`. Outcomes (`applyAck`,
`services/messaging/jobs.js`):
- `ok: true` → `done`.
- `retryAfterMs > 0` (flood wait) → stays `pending`, `notBefore = now +
  min(retryAfterMs, 6h)`; does **not** count as an attempt.
- otherwise → attempt count +1; `retryable === false` or 5 attempts reached
  (`MAX_ATTEMPTS`) → `failed`; else `pending`, `notBefore = now +
  backoff(attempts)`, backoff = 30s → 2min → 8min → 30min → 30min
  (`BACKOFF_MS`).

`ackJobs` isolates every result: one entry that fails to look up (unknown id,
lease already expired) or to save is counted in `ignored` and never stops the
rest of the batch; a failure while writing the outcome into the linked
`Message`/`Comment` is caught and logged separately — the job's own ack still
stands either way.

**The repair cron** — `messagingRepair`, every minute (`backend/app.js`, next
to the other `guardedCron` registrations; 50 s watchdog) →
`services/messaging/outbound.js#repairOutbound`. It returns immediately when
`Channel.exists({isActive: true})` is false, so an idle deployment doesn't scan
anything every minute. Otherwise it finds outbound messages stuck
`status:"queued", jobId:null` for over 60 s (≤50 at a time): fails them if
their channel is inactive; otherwise **links** an already-existing job for
that message when the earlier crash happened after `enqueueJob` but before the
message was updated with its id (it never enqueues a second job for the same
message); otherwise enqueues a fresh one. It also finds comments stuck at
`channel.status:"preparing"` for over 60 s (≤50) and either copies in the
linked message's id/status or marks them `failed`. Three partial indexes back
these two queries and the job-lookup inside them without scanning a whole
collection — see §8.

**Client-visible delivery errors** (`Comment.channel.error`, written by
`applySendOutcome` above, `ingestStatus` (§4's ingest, `message.status`
events) and `retryMessage`/`markQueued` (`services/messaging/outbound.js`)):
the client only ever sees the fixed string **«Не доставлено»**, and only once
the linked message's status becomes `failed`. A comment whose delivery never
even got enqueued gets a different fixed string, **«Не отправлено: сбой при
постановке в очередь»** (`controllers/comment.js`'s fallback, also written
verbatim — never a raw error — by `repairOutbound`'s stuck-comment branch).
Raw gateway/job errors (`Message.error`, `ChannelJob.lastError`) are
staff-only and are never copied into `channel.error`. Every write of
`channel.status` other than into `failed` — `queued`, `sent`, `delivered`,
`read`, and every retry — clears the field with `$unset`, since `$set:
{"channel.error": undefined}` is silently stripped by Mongoose and clears
nothing.

## 6. Gateway API

`routes/gateway.js` + `controllers/gateway.js`, all under `/api/gateway/*`,
guarded by `isGateway` (`middleware/isGateway.js`: header `X-Gateway-Token`,
constant-time compare against env `MSG_GATEWAY_TOKEN`; an empty/unset token
refuses **every** request with 401 — there is no "open" mode) and a combined
rate limit (600 req/min across the whole gateway, one shared bucket).

1. `GET /channels?types=telegram,whatsapp` — active channels for the given
   networks (default: both gateway networks). Returns `{channels: [{id, type,
   name, state, account, settings: {proxyUrl, historyDays, importGroups,
   markReadOnOpen, maxMediaMb, ignoredChatIds}, secrets: {tgApiId, tgApiHash,
   proxyPassword}}]}` — secrets are **decrypted** here, and only here.
2. `POST /events {events: [...]}` (1–50) — each item is validated then
   ingested independently; returns `{results: [{ok, retryable?, error?}, ...]}`
   in input order. A malformed individual event is reported per item, not a
   400 for the whole batch — only a malformed `events` array itself is a 400.
3. `POST /media` (multipart, field `file`, ≤200 MB) — stores a gateway-fetched
   attachment; returns `{name, originalName, mimetype, size}` (`name` is the
   storage key to reuse in a later event/attachment).
4. `GET /media/:name` — reads the stored object fully into memory and sends
   it (`storage.getObjectBuffer` + `res.send`, not a stream; content-type
   guessed from the extension).
5. `GET /jobs?types=&wait=0..25` — leases ≤10 pending jobs for the given
   networks; long-polls up to `wait` seconds (capped at 25) if none are ready
   yet. Returns `{leaseId, leaseExpiresAt, jobs: [{id, type, channelId,
   conversationId, messageId, attempt, payload}]}` (a `login` job's `payload`
   arrives with `value` already decrypted).
6. `POST /jobs/ack {leaseId, results: [...]}` (≤50) → `{applied, ignored}`.
7. `POST /heartbeat {channels: [{id}, ...]}` (≤50) — stamps
   `Channel.gatewaySeenAt` for each; returns `{ok: true}`.

**Contract requirements on the gateway itself** (not enforced by event
validation — a gateway bug here silently breaks a client-visible feature, it
doesn't get rejected):
- Every echo of an HD-sent message — including **every chunk**, when a long
  text is split into several external messages (`externalIds`) — **must**
  carry the original `jobId`; an echo without it can't be matched to the
  `Message` it confirms (`confirmOwn`, `ingest.js`) and would be mistaken for a
  new inbound message instead.
- An edit event (`message.edited`) for an HD-sent message must carry the text
  **as HD stored it** — without the outgoing signature `signReply` appends —
  or the gateway must suppress the edit entirely; otherwise the signature
  becomes part of the mirrored comment's text on every edit.
- `sender.name`/`peer.name` must never be a raw phone number, an `@handle`, or
  a WhatsApp JID: this string becomes the client-visible author name
  (`identityName`/`publicName`) whenever no better name is known.
- Oversized media gets an error answer from the backend today (`POST
  /gateway/media` currently answers 500, via multer's own size limit) — the
  gateway must treat that as a **terminal** failure for the attachment and not
  retry it.

## 7. Staff API

`routes/internal/conversation.js` + `controllers/conversation.js` /
`controllers/channel.js`, all under `/api`. Each route is composed from its
own gate list rather than one shared prefix middleware, so the gates can't leak
into a neighboring router:

- **read** = `conversation.read` + `Preferences.modules.messaging.isActive`.
- **reply** = `conversation.reply` + module switch.
- **manage** = `conversation.manage` + module switch.
- **settings** = `settings.manage` **only** — channels can be connected and
  test-driven before the module is switched on for everyone.

| Method & path | Gate | What |
|---|---|---|
| `GET /conversations` | read | Paged list (`queue`: awaiting\|mine\|unbound\|all\|hidden; filters `network`, `company`, `q`; per-queue counts) |
| `GET /conversations/counts` | read | `{counts: {awaiting, mine, unbound, all}}` only — the navigation badge; declared before `/conversations/:id` |
| `GET /conversations/:id` | read | Full card: conversation, channel, counterpart, participants, linked HD contact, that contact's other channels, bound/open tickets (`ticket.boundAt` — when the binding started) |
| `GET /conversations/:id/messages` | read | A page of messages (`before`+`beforeSeq` chronological, or `changedSince`(+`afterId`) for polling — see below) |
| `GET /conversations/:id/ticket-draft` | read | Draft **HTML** description + guessed applicant/company/source from selected messages |
| `POST /conversations/:id/seen` | read | Read watermark; enqueues `markRead` when applicable |
| `POST /conversations/:id/messages` | reply | Send a reply (multipart `attachments`) |
| `POST /conversations/:id/handled` | reply | Clear "awaiting" without a reply |
| `POST /messages/:id/retry` | reply | Re-enqueue a `failed` outbound message |
| `POST /conversations/:id/assign` | manage | Set/clear the assignee |
| `POST /conversations/:id/bind` | manage | Bind a **direct** chat to an open ticket |
| `POST /conversations/:id/unbind` | manage | End a live binding |
| `POST /conversations/:id/attach` | manage | Attach selected messages to an open ticket |
| `POST /conversations/:id/decision` | manage | Answer "about ticket #X?" (`{action: "none"}`) |
| `POST /conversations/:id/hide` | manage | Hide/unhide from the default queues |
| `PATCH /conversations/:id` | manage | Change `companyId` |
| `POST /identities/:id/link` | manage | Link a counterpart to an HD user |
| `POST /identities/:id/unlink` | manage | Remove that link |
| `GET /identities/:id/candidates?q=` | manage | Users to link a counterpart to: every word of `q` must match one of name/email/phone/position/company; returns `{items: [{id, name, position, company}]}` (≤8, clients first, banned and service accounts excluded) — names only, never the contacts it matched on |
| `GET /tickets/:num/delivery-routes` | read + ticket access | Reply routes for a ticket ("reply via …") |
| `GET /channels` | settings | List channels (secret *presence* flags only, never values) |
| `POST /channels` | settings | Create a channel |
| `PATCH /channels/:id` | settings | Update name/isActive/settings/secrets/`serviceUserId` |
| `DELETE /channels/:id` | settings | Delete (refuses if it still has conversations) |
| `POST /channels/:id/login` | settings | Gateway login step |
| `POST /channels/:id/logout` | settings | Gateway logout |
| `POST /channels/:id/test` | settings | Proxy test |
| `POST /channels/:id/history` | settings | Request history import (`days`) |
| `GET /channels/:id/jobs/:jobId` | settings | Poll a command job's outcome |

**The `changedSince` polling contract**
(`GET /conversations/:id/messages?changedSince=<ISO>&afterId=<id>`, both query
params, `afterId` optional): rows are sorted by `{updatedAt, _id}` — an edit or
a status change bumps `updatedAt`, not `sentAt` — so this is **change order**,
not display order; the client sorts by `seq` itself before rendering. Without
`afterId` the filter is `updatedAt >= since` (at-least-once; the client
de-dupes by message id). With `afterId` it narrows to `updatedAt > since OR
(updatedAt == since AND _id > afterId)`, so rows sharing the exact same
`updatedAt` are neither skipped nor repeated. A **full** page
(`items.length === limit`) returns `{items, hasMore:true, serverTime: <last
row's updatedAt>, afterId: <last row's _id>}` — feed both straight back to
keep draining the same page. A **partial/empty** page returns `{items,
hasMore:false, serverTime: <time captured before the query ran>}` — use that
as the next poll's `since`, with no `afterId`, so anything that lands in the
gap between the query and the response isn't missed.

Defense in depth is uneven by design, not accidental. `sendFromInbox`
(`services/messaging/outbound.js`) re-checks `conversation.reply` and
conversation visibility (`canSeeConversation`) **itself** — but not the module
switch, since it's reachable only through this router, whose `reply` gate
already applies it. `retryMessage` (same file) re-checks `conversation.reply`
and allows **either** conversation visibility **or** ticket access
(`canAccessTicket`, `services/ticketAccess.js`) when the message carries a
`ticketId` — the ticket's own tier must be enough to retry a reply its own
responsible sent, even where the conversation's general (company) visibility
tier would say no. `validateDeliverRoute` (`services/messaging/outbound.js`)
and `prepareOrigin` (inherited by `ticketDraft`, `services/messaging/origin.js`)
re-check **both** their own permission (`conversation.reply` for
`validateDeliverRoute`, `conversation.read` for `prepareOrigin`/`ticketDraft`)
**and** the module switch themselves — because these two are also reachable
from ticket-side code that never goes through this router at all (a ticket
comment delivered "via" a messenger, `deliverComment`; "Create ticket" from
selected messages). `validateDeliverRoute` does **not** re-check general
conversation visibility: it requires the conversation to be a member of
`deliveryRoutes(ticket)` instead — 404 ("Диалог не найден") if it isn't a
route of this ticket at all, 409 with that route's own `reason` if it is but
is busy — because the caller (`controllers/comment.js`) has already asserted
ticket access, and route membership is the correct, narrower gate: an
own-tier engineer responsible for a ticket with a company can reply through
any route that ticket's own `deliveryRoutes` offers, even to a conversation
the general inbox visibility tiers would otherwise hide from them. Those
general tiers are deliberately **not** widened by this — ledgered for P1.
`prepareOrigin` additionally refuses (409) a **direct** chat still bound to a
different **open** ticket. Replying **via** a route from the ticket's comment
box (`deliverComment`) auto-binds the target **direct** chat exactly like
`POST /conversations/:id/bind` would, but only while the ticket is still
**open** — sending itself is never blocked by this, only the auto-bind side
effect is skipped for a closed ticket.

**Company identification stays conservative.** `applyOrigin`
(`services/messaging/origin.js`, run right after "Создать заявку" saves the
new ticket) never writes `ChannelIdentity.companyId` — only a **manual** link
is hard evidence for a person's company. It sets `Conversation.companyId` from
the new ticket's company only when the conversation had none yet **and** that
company isn't a placeholder — not `Preferences.defaultCompany` and not the
default applicant's own company — so an anonymous walk-in ticket never stamps
a real-looking company onto an unidentified chat. `POST /identities/:id/link`
(`controllers/conversation.js#linkIdentity`), by contrast, **is** hard
evidence: it overrides the identity's `companyId` unconditionally to the
linked user's company and, for **direct** conversations whose counterpart is
that identity, overrides `Conversation.companyId` the same way; group
conversations are untouched.

**The draft's applicant is authoritative.** `POST /tickets` with
`originConversationId` (`controllers/ticket.js#add`) trusts the conversation's
own resolved applicant — the linked user if the counterpart identity is
linked, else `Preferences.defaultApplicant` with the counterpart's name copied
into `realSender` — whenever the request's `applicantId` is absent or equal to
that value, **regardless of** whether the caller holds `ticket.createForOthers`.
Only a genuinely **different** `applicantId` (staff deliberately picking
someone else as the applicant) goes through the ordinary `createForOthers`
rules.

**Frontend map (P1b).** UI rules live in `docs/ux-ui-guide.md` («Диалоги:
переписка с клиентом»); this is only where things are.

| Route / surface | Files | State |
|---|---|---|
| `/conversations` (list, queues, filters) | `pages/Conversation/Inbox.tsx`, `components/Conversation/{QueueChips,ConversationList,ConversationRow,ListFilter}.tsx` | `store/conversations.ts` |
| `/conversations/:id` (thread + contact pane; phone full screen) | `pages/Conversation/Thread.tsx`, `components/Conversation/ConversationThread.tsx` (+ `ThreadHeader`, `MessagesPane`, `MessageBubble`, `MessageMedia`, `SystemLine`, `Composer`, `DecisionPrompt`, `ContextPane`, `ContactBlock`, `TicketBlock`, `OpenTickets`, `AssigneePicker`, `WhoIsThis`, `ThreadMenu`, `ContextSheet`) | route loader + `components/Conversation/use-thread.ts` |
| `/conversations/:id/tickets/add` («Создать заявку») | `routes/ticket-forms.jsx` → `pages/Ticket/Add.jsx` (`?conversation=&messages=`), `components/Ticket/ticket-origin.js` | ticket form state (`use-ticket-form.js`) |
| `/conversations/:id/users/add` («Новый пользователь») | `pages/Conversation/NewUser.tsx` → `components/User/UserForm.jsx` | — |
| Navigation badge | `components/Conversation/{CountsSync,NavBadges}.tsx`, `layout/Navigation/menu.js`, `layout/MobileBottomNavbar.jsx` | `store/conversations.ts` (`counts`) |
| Ticket card: the «Хроника» as a dialog (staff and end users), channel markers, delivery status, «Ответить через», «Диалог» row | `components/Ticket/{Chronicle.jsx,ChannelMarker.tsx,ReplyRoute.tsx,use-delivery-routes.ts}`, `components/Ticket/View/Sections.jsx`, `util/chronicle-dialog.js` (sides, names, markers, «Новые») | `store/view-ticket.js` |
| Settings → «Каналы связи», «Модули» | `components/Preferences/{Channels,TelegramChannelDialog}.tsx`, `components/Preferences/Modules.jsx` | component state, pulse topic `channels` |
| Pure helpers (node --test) | `util/{conversation-format,conversation-thread,delivery-routes,chronicle-dialog,channel-state}.js` | — |

## 8. Operations

- **`MSG_GATEWAY_TOKEN`** (env) — the shared secret with msg-gateway, sent as
  `X-Gateway-Token`. Unset/empty ⇒ every `/api/gateway/*` request is refused
  (401); there is no "open" fallback mode.
- **Migrations** (`backend/scripts/migrate.js`):
  - `2026-09-25-grantConversations` — idempotent, dictionary-only: grants
    `conversation.read`/`reply`/`manage` to existing roles
    (`conversationGrants`, `services/actionMigration.js`) — any staff role
    (not `audience: "client"`, not an outside-performer role) already holding
    `ticket.perform` or `ticket.manage` gets `read`+`reply`; one already
    holding `ticket.manage` also gets `manage`. Only *adds*; a role's set as
    hand-edited from the UI is never touched.
  - `2026-09-25-initMessaging` — idempotent: turns the `conversationMessage`
    in-app notification category on for existing `Preferences` documents (a
    Mongoose schema default only applies when a document loads through the
    model, and the bell reads settings with `.lean()`). The **module switch**
    itself, `Preferences.modules.messaging.isActive`, is untouched — always a
    manual opt-in.
- **`sync-dev-db.sh`** excludes `preferences`, `channels`, `channeljobs` from
  every sync — the dump, the restore's namespace filter, and the pre-restore
  local cleanup all agree on the same list — so a dev copy never receives
  production's bot tokens, the MAX webhook secret, or production's queued
  outbound messages.
- **`backend/scripts/smokeMessaging.js`** — a dev-only end-to-end check
  (ingest → mirror → reply → echo → close), **not** part of `migrate.js`. Run
  inside the backend container: `node scripts/smokeMessaging.js`. Everything it
  creates is deleted at the end by an explicit `_id` list, counted first.
- **Pulse topic `conversations`** (`services/pulseTopics.js`) is staff-only —
  it is not in `controllers/pulse.js`'s `CLIENT_TOPICS`, so an end-user session
  never receives it. The spec's second staff topic, `conversationThreads`
  (per-conversation live updates), is **not** implemented: an open thread
  requests a 3-second pulse cadence and, when `conversations` moves, polls
  `GET /conversations/:id/messages?changedSince=...` (§7). Decided in P1b.
- **Pulse topic `channels`** (staff-only, same reason) moves on meaningful
  `Channel` writes — login state, QR, account, settings; `gatewaySeenAt`
  (heartbeat) and `lastMessageAt` (every message) are noise — and on the
  acknowledgement of a command job (`login`, `logout`, `testProxy`,
  `loadHistory`; explicit `bus.bump` in `ackJobs`). Only the channel settings
  read it.
- **`backend/scripts/seedDemoConversations.js`** — dev-only demo data for the
  UI (a `[DEMO] Telegram` channel, a `[DEMO] Форма с сайта` channel, a demo
  company, two clients at `@demo-p1.invalid`, a demo ticket and six
  conversations) created through the real ingest/outbound/jobs paths; **not**
  part of `migrate.js`. `--remove` finds everything from the demo channels and
  addresses, counts it, and deletes by explicit `_id` lists.
- **Channel failure alert** (`services/messaging/channelAlert.js`, called from
  `ingestChannelState`): a `channel.state` event that moves an active channel
  **into** `loggedOut`, `banned` or `error` from a different state rings the
  bell of everyone holding `settings.manage` (service accounts and banned
  users excluded) — kind `channelState`, category `conversationMessage` (no
  system category exists; same module, in-app only), link
  `/preferences#channels`, text = channel name + the gateway's reason. The
  state write is a compare-and-set on the previous state, so a replay or a
  second delivery never rings twice; `error` rings at most once per 6 hours
  per channel (`Channel.errorAlertedAt`, claimed in the same write), because
  the gateway reports it after 60 s without a connection. The module switch
  is not checked — channels are set up before the module is on.
- **Partial indexes for the repair cron** (this wave, §5): `comments` gets
  `{createdAt: 1}` partial on `channel.status:"preparing"`
  (`channel_preparing_createdAt`) — built **once** on deploy (one pass over the
  whole `comments` collection, same as any new index); `messages` gets
  `{createdAt: 1}` partial on the orphan query's own equality fields
  (`direction:"out", origin:"hd", status:"queued", jobId:null`,
  `hd_queued_no_job_createdAt`); `channeljobs` gets a plain `{messageId: 1}`
  for the repair's per-message job lookup. `repairOutbound` itself also returns
  immediately when `Channel.exists({isActive:true})` is false.
