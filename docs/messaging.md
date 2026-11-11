# Messaging («Диалоги») — Implementation Notes

_Last updated: 2026-11-11. Current backend contracts include direct gateway
channels and Wazzup v3. The original design and mockup are in
`docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md`; verify these
implementation notes against the code._

_P1b (2026-09-27): staff UI additions — queue counts, identity candidates,
`ticket.boundAt`, the `channels` pulse topic, the channel failure alert; the
frontend map closes §7._

## 1. Overview

«Диалоги» ("Dialogues") is HD's messaging inbox: every client conversation from
a corporate Telegram, WhatsApp or MAX account lands here, and staff reply
from HD into the same channel. **The backend owns all state** — channels,
conversations, messages and the outbound queue. Both transports normalize their
events into `services/messaging/events.js`, use the same ingest entry point
(`services/messaging/ingest.js`) and share the job contract
(`services/messaging/jobs.js`).

There are two independent transports:

- **Wazzup v3**, implemented in `services/wazzup/`, connects WhatsApp
  (`whatsapp`, `wapi`), Telegram (`tgapi`, `telegram`) and MAX (`max`, `maxbot`).
  HD discovers accounts through the provider API, receives authenticated events
  through a durable webhook inbox and sends replies from its own worker (§9).
- **msg-gateway**, an external service holding direct Telegram
  (MTProto/GramJS) and WhatsApp (Baileys) sessions, talks to the backend over
  `/api/gateway/*` (§6). Existing direct Telegram login, proxy and account
  settings remain in HD.

The schema also supports website-form channels; a public form adapter is not
part of this implementation. A Wazzup account is configured in global
**Настройки системы → Диалоги** (`/preferences#messaging`), separately from
direct connections. One messenger account must use one connection method.

## 2. Collections

- **`channels`** (`models/channel.js`) — one document per connected corporate
  account. `provider` is `gateway` or `wazzup`; old documents without it remain
  gateway channels. Wazzup adds `providerChannelId` and `providerTransport`,
  with a unique partial `{provider, providerChannelId}` index for Wazzup.
  Direct messenger sessions are held by the gateway; MAX and site remain
  network values.
  Secrets (`secrets.*`) are `secretBox` ciphertext; only the gateway ever
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
  or phone ↔ **exactly one** user found by `findUsersByPhone`
  (`services/callerIdentityService.js`, shared with telephony: equality on the
  canonical number, no service or telephony accounts, no banned users, no users
  of a deactivated company — users without a company still match); a phone shared
  by two or more people is not evidence — nobody gets linked. Never by name or
  username. `phone` holds canonical digits with the country code whatever format
  the gateway sends (`docs/phone-numbers.md`). Unique
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
- **`channeljobs`** (`models/channelJob.js`) — the outbound/command queue,
  isolated by `provider: gateway|wazzup` (missing means gateway). Direct
  gateway jobs support send, markRead, fetchMedia, login, logout, loadHistory
  and testProxy; Wazzup jobs support send only. No natural unique key (a job
  has no external id before it is sent). `{state, network, notBefore, createdAt}` and `{conversationId, state,
  createdAt}` back the leasing query and per-conversation head ordering (§5); a
  partial TTL index on `finishedAt` (30 days, only documents that have one)
  prunes finished jobs — long enough to debug a failure, short enough not to
  grow forever.
- **`wazzupsettings`** (`models/wazzupSettings.js`) — one `WazzupSettings`
  document (`_id: "wazzup"`): `isActive`, encrypted `apiKey` and `webhookToken`
  (both `select:false`), selected `channelIds`, discovered `accounts`,
  `webhookConnected` and persistent `health` (§9). Account rows contain
  `{id, type, transport, name, account, state, reason}`; `reason` is the
  backend's user-facing explanation of Wazzup's state.
- **`wazzupevents`** (`models/wazzupEvent.js`) — durable `WazzupEvent` inbox:
  `_id` is SHA-256 of the event kind and canonicalized payload; `kind` is
  `messages`, `statuses` or `channelsUpdates`. Carries `payload`, `attempts`,
  `notBefore`, `leaseUntil`, `processedAt` and `lastError`. The pending-work
  index covers `{processedAt, notBefore, leaseUntil, createdAt}`. Processed
  rows expire after seven days; pending rows do not expire.
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
called by the gateway (`POST /gateway/events`) and the Wazzup inbox worker
(`services/wazzup/processor.js`).

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
to the other `jobs.register` registrations; 50 s watchdog) →
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
- **start** = `conversation.read` + `conversation.reply` + module switch.
- **ticket messaging** = `ticket.sendMessage` + module switch + access to the ticket;
  this does not grant the inbox or conversation reads.
- **manage** = `conversation.manage` + module switch.
- **settings** = `settings.manage` **only** — channels can be connected and
  test-driven before the module is switched on for everyone.

| Method & path | Gate | What |
|---|---|---|
| `GET /conversations` | read | Paged list (`queue`: awaiting\|mine\|unbound\|all\|hidden; filters `network`, `company`, `q` — a substring of the title, last-message preview or author; a whole-number `q` also matches its digits across separators in titles and author names; per-queue counts) |
| `GET /conversations/counts` | read | `{counts: {awaiting, mine, unbound, all}}` only — the navigation badge; declared before `/conversations/:id` |
| `GET /conversations/recipients?q=` | start | Scoped HD recipient search by name, phone or email |
| `GET /conversations/start-routes?userId=…` or `?phone=…` | start | Existing direct chats and first-contact options for one recipient |
| `POST /conversations/start` | start | Multipart first message: `userId` or `phone`, `routeId`, UUID `clientRequestId`, `text`, `attachments`; returns an asynchronous receipt |
| `GET /conversations/outgoing/:id` | start | Author-scoped first-send receipt and resolved conversation ID |
| `GET /conversations/outgoing/request/:requestId` | start | Recover the same receipt after a lost HTTP response |
| `GET /conversations/:id` | read | Full card: conversation, channel, counterpart, participants, linked HD contact, that contact's other channels, bound/open tickets (`ticket.boundAt` — when the binding started) |
| `GET /conversations/:id/messages` | read | A page of messages (`before`+`beforeSeq` chronological, or `changedSince`(+`afterId`) for polling — see below) |
| `GET /conversations/:id/ticket-draft` | read | Draft **HTML** description + guessed applicant/company/source from selected messages |
| `POST /conversations/:id/seen` | read | Read watermark; enqueues `markRead` when applicable |
| `POST /conversations/:id/messages` | reply | Send a reply (multipart `attachments`) |
| `POST /conversations/:id/handled` | reply | Clear "awaiting" without a reply |
| `POST /messages/:id/retry` | start or ticket messaging | Retry a failed message through accessible conversation or ticket; service rechecks the matching permission and scope |
| `POST /conversations/:id/assign` | manage | Set/clear the assignee |
| `POST /conversations/:id/bind` | manage | Bind a **direct** chat to an open ticket |
| `POST /conversations/:id/unbind` | manage | End a live binding |
| `POST /conversations/:id/attach` | manage | Attach selected messages to an open ticket |
| `POST /conversations/:id/decision` | manage | Answer "about ticket #X?" (`{action: "none"}`) |
| `POST /conversations/:id/hide` | manage | Hide/unhide from the default queues |
| `PATCH /conversations/:id` | manage | Change `companyId` |
| `POST /identities/:id/link` | manage | Link a counterpart to an HD user |
| `POST /identities/:id/unlink` | manage | Remove that link |
| `GET /identities/:id/candidates?q=` | manage | Users to link a counterpart to: a `q` that looks like a whole number is one phone term (`services/personSearch.js`); otherwise every word must match one of name/email/phone/position/company; returns `{items: [{id, name, position, company}]}` (≤8, clients first, banned and service accounts excluded) — names only, never the contacts it matched on |
| `GET /tickets/:num/delivery-routes` | read or ticket.sendMessage + module + ticket access | Reply routes for one accessible ticket |
| `GET /preferences/wazzup` | settings | Public Wazzup metadata for a silent `channels` pulse refresh; preserves the UI draft |
| `POST /preferences/wazzup/check` | settings | Discover Wazzup accounts with a draft API key; no save (§9) |
| `GET /preferences` | settings | Includes public `wazzup` configuration (§9) |
| `POST /preferences` | settings | Partial save accepts `{wazzup:{isActive,apiKey,channelIds}}`; shared settings draft (§9) |
| `GET /channels` | settings | List channels (secret *presence* flags only, never values) |
| `POST /channels` | settings | Create a direct channel; Wazzup channels are synchronized from its configuration |
| `PATCH /channels/:id` | settings | Update name/isActive/settings/secrets/`serviceUserId` |
| `DELETE /channels/:id` | settings | Delete (refuses if it still has conversations) |
| `POST /channels/:id/login` | settings | Direct gateway login step; Wazzup rejects gateway commands |
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
already applies it. `retryMessage` (same file) permits either inbox read/reply
with conversation visibility or `ticket.sendMessage` with ticket access
(`canAccessTicket`, `services/ticketAccess.js`). A pending inbox first message
without a conversation remains author-scoped. The ticket's own tier is enough
to retry a ticket reply even where inbox visibility would deny the conversation.
`validateDeliverRoute` (`services/messaging/outbound.js`)
and `prepareOrigin` (inherited by `ticketDraft`, `services/messaging/origin.js`)
re-check **both** their own permission (`ticket.sendMessage` for
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

**Reply defaults.** Creating a ticket from a conversation stores its immutable
`Ticket.originConversationId` alongside the source. The field is `select:false`
and is read explicitly only for route selection. That original conversation is
the default if it is still an available route; an unavailable original falls back
to `notify`, not a different recipient. Historical messenger tickets recover the
origin from the earliest `Message.attachMode:"origin"`, then the earliest inbound
comment, then a live binding. Ordinary tickets default to `notify` even after a
messenger reply binds a chat. Both current `applicantId` and legacy
`applicant._id` identify the applicant's available routes. The comment composer
shows the selector after routes load, including when only `notify` exists.
The comment composer uses the always-visible shared Segmented control above
the text field. `notify` comes first; narrow columns use two columns, wide
columns up to four. Each route retains its ID (a group and direct chat are
distinct recipients); disabled-route reasons remain visible below the control.
Labels contain only the network name; disabled routes retain their failure reason.
Unavailable phone-initiation routes are omitted when the same network already
has an available direct-conversation or phone route. A group route does not
replace direct contact; unavailable existing conversations retain their reasons.
Outgoing signatures use plain text `- First name, Organisation`.
Provider text for a live ticket-bound inbox reply or a ticket comment also
includes the ticket number on a separate digits-only line before the optional
signature. This applies with signatures disabled and to attachment-only sends.
Message.text and Comment.content stay original; the final provider payload is
persisted in the durable job intent and reused unchanged during recovery/retry.

**New dialogue from the inbox.** The route-owned `/conversations/new` form
supports scoped HD user search and an arbitrary valid phone without creating a
User or Ticket. The server resolves a selected user's current phone; the raw
phone path accepts a validated canonical number. Existing visible direct chats
open instead of creating duplicates. Only supported personal-account transports
offer first contact; disabled options retain their reason. The selector prefers
an existing available chat and shows one option per network.

A new first message uses the same durable queue, attachment delivery and
accepted-part checkpoints as ticket replies. `Message.clientRequestId` has a
unique partial author/request index; a repeated request returns the same receipt.
The sheet stores only account-scoped recovery identifiers and recipient metadata
in sessionStorage, never message text or attachment bytes. After closing/reload
or a lost HTTP response, it recovers the receipt before offering another send.
The worker rechecks author permissions and recipient eligibility before HTTP.
Canonical linking for an inbox first message never creates a ticket or binding.
Initial dispatch and explicit retries persist `Message.retryIntent` with a
reserved job ID and the exact signed payload before inserting the job. Retrying
claims `failed → queued` atomically; concurrent callers reuse the winner. The
repair worker inserts only the reserved ID, so crashes before/after insertion
cannot create another send or discard accepted multipart progress. The intent
and client request IDs are removed from development database copies.

**Independent ticket permission.** `ticket.sendMessage` is a staff-only action
in the «Заявки» group. It enables messenger delivery and retry in accessible
tickets without `conversation.read` or `conversation.reply`. The inbox menu,
page, API and deep links remain behind `conversation.read`; new inbox messages
also require `conversation.reply`. The one-time
`2026-11-11-grantTicketMessaging` migration preserves existing senders' capability
and administrative roles without granting any inbox read permission. Fresh
role templates include the corresponding action.

**First outbound contact from an existing ticket.** Reply routes include active
messenger accounts even when the applicant has never written to HD and has no
`ChannelIdentity` or conversation. Routes are discriminated by `target`:
`conversation` carries an existing `conversationId`; `phone` carries a `channelId`
and `conversationId:null`. Each has a unique `id`; `deliverVia` submits that id.
The server reads the applicant's canonical phone from `User` (legacy tickets use
`applicant._id`), rechecks route membership, module and reply permission, and never
accepts a recipient number from the comment request.

Wazzup personal Telegram (`tgapi`) and MAX (`max`) initiate through `phone`;
WhatsApp (`whatsapp`) uses the phone as `chatId`. Telegram/MAX bots cannot initiate
a conversation, and WABA requires an approved template. The external direct
gateway has no recipient-by-phone resolution contract; its new-contact options
remain unavailable, while existing direct chats keep working.

The comment and an outbound HD `Message` are saved before dispatch. Only this
pending first-contact message may have `conversationId:null`; `recipientPhone`
holds its address, and the comment has a real message id for status and retry.
`ChannelJob.orderingKey` serializes the channel/phone queue before a conversation
exists. Immediately before sending, the worker rechecks any newly created/hidden
or busy canonical conversation. A first response checkpoints both accepted
message ids and the resolved `chatId`, then links the existing message/comment/job
to the canonical conversation through the common ingest/identity helpers. A
conditional bind cannot replace a concurrent foreign binding. Incoming replies
then mirror into the existing ticket.

Multipart sends continue through the resolved chat id. A crash resumes accepted
parts; uncertain acceptance never automatically resends. An explicit manual retry
keeps proven accepted parts and clears only the uncertain in-flight latch. The
`sendComplete` receipt distinguishes a completed attempt from a partially sent
or partially linked first contact. Old ticket defaults remain `notify`.

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
| `/conversations` (list, queues, filters) | `pages/Conversation/Inbox.tsx`, `components/Conversation/{QueueSelector,ConversationList,ConversationRow,ListFilter}.tsx` | `store/conversations.ts` |
| `/conversations/:id` (thread + contact pane; phone full screen) | `pages/Conversation/Thread.tsx`, `components/Conversation/ConversationThread.tsx` (+ `ThreadHeader`, `MessagesPane`, `MessageBubble`, `MessageMedia`, `SystemLine`, `Composer`, `DecisionPrompt`, `ContextPane`, `ContactBlock`, `TicketBlock`, `OpenTickets`, `AssigneePicker`, `WhoIsThis`, `ThreadMenu`, `ContextSheet`) | route loader + `components/Conversation/use-thread.ts` |
| `/conversations/:id/tickets/add` («Создать заявку») | `routes/ticket-forms.jsx` → `pages/Ticket/Add.jsx` (`?conversation=&messages=`), `components/Ticket/ticket-origin.js` | ticket form state (`use-ticket-form.js`) |
| `/conversations/:id/users/add` («Новый пользователь») | `pages/Conversation/NewUser.tsx` → `components/User/UserForm.jsx` | — |
| Navigation badge | `components/Conversation/{CountsSync,NavBadges}.tsx`, `layout/Navigation/menu.js`, `layout/MobileBottomNavbar.jsx` | `store/conversations.ts` (`counts`) |
| Ticket card: the «Хроника» as a dialog (staff and end users), channel markers, delivery status, «Ответить через», «Диалог» row | `components/Ticket/{Chronicle.jsx,ChannelMarker.tsx,ReplyRoute.tsx,use-delivery-routes.ts}`, `components/Ticket/View/Sections.jsx`, `util/chronicle-dialog.js` (sides, names, markers, «Новые») | `store/view-ticket.js` |
| Settings → «Диалоги» (`/preferences#messaging`), «Модули» | `components/Preferences/{Channels,Wazzup,TelegramChannelDialog}.tsx`, `components/Preferences/Modules.jsx` | Wazzup: shared settings draft + explicit account check; direct channels: component state, pulse topic `channels`; old `#channels` aliases `#messaging` |
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
- **`ops/sync-dev-db.sh`** excludes messaging configuration and queues
  (`preferences`, `channels`, `channeljobs`, `wazzupsettings`, `wazzupevents`) from
  every sync — the dump, the restore's namespace filter, and the pre-restore
  local cleanup all agree on the same list — so a dev copy never receives
  production's bot tokens, Wazzup API/webhook credentials, the MAX webhook
  secret, queued outbound messages or pending Wazzup events.
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
  `/preferences#messaging`, text = channel name + the transport's reason. The
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


## 9. Wazzup operations

**Configuration and access.** `settings.manage` is required independently by
the preferences write path, `GET /api/preferences/wazzup` and
`POST /api/preferences/wazzup/check`.
`GET /api/preferences` exposes `wazzup` only to settings administrators:

```text
{
  isActive, apiKeyIsSet, channelIds,
  accounts: [{id, type, transport, name, account, state, reason}],
  health: {lastCheckedAt, lastOkAt, lastMessageAt,
           lastError, lastErrorHint, lastErrorAt},
  webhookConnected
}
```

`type` is `telegram|whatsapp|max`. Secret values are never returned.
`POST /api/preferences/wazzup/check {apiKey}` uses the draft key; an empty
string uses the stored key. It returns `{accounts, message}` without writing
configuration, health, channels or a webhook. A successful check proves API
access only. The UI does not fetch this catalog automatically on mount, ties
its result to the key draft and keeps saved accounts selectable after a
failed discovery. On a `channels` pulse, `GET /api/preferences/wazzup` returns
`{wazzup}` and refreshes saved account/health metadata without changing the
draft switch, key or selection. A check with a new draft key retains its
own result instead of inheriting the saved connection's status.

The main `POST /api/preferences` accepts the partial draft
`{wazzup:{isActive,apiKey,channelIds}}`; an empty `apiKey` preserves the saved
secret. Wazzup uses the page's `SectionForm`/`DraftBar`, with no section save
button. Enabling requires at least one selected account; the server fetches
accounts again and rejects unknown selections. It also rejects an account
already active directly when its canonical phone or username matches a
direct channel of the same network. Disabling or deselecting deactivates the
Wazzup channels while retaining their IDs and conversation history; direct
channels are untouched. The worker reconciles interrupted synchronization
after restart.

**Webhook registration.** Secrets use `secretBox` and require `APP_ENC_KEY`.
Set a public HTTPS base in `APP_PUBLIC_URL` or `ADDRESS`; credentials, query,
fragment, literal IPs and local hostnames are rejected. During an active save,
HD generates a random callback token, encrypts it and registers
`/api/wazzup/webhook?token=<generated-token>` through Wazzup's v3 `webhooks`
API. Registration subscribes to `messagesAndStatuses` and `channelsUpdates`,
with `contactsAndDealsCreation:false`. The callback handles Wazzup's
authenticated `test:true` probe before activation. An existing callback for
another integration causes a 409 instead of being overwritten. Failed
registration leaves working credentials unchanged; `webhookConnected` records
successful registration separately from an API check. Disabling does not
unregister the remote callback: authenticated events are acknowledged and
ignored while Wazzup is inactive.

**Durable incoming delivery.** The dedicated callback uses its token, not a
browser session, compares it in constant time and accepts at most 500 events
per request. Its route limit is 600 requests per minute per IP. A normal 200
means all accepted events were persisted with deduplicating upserts into
`WazzupEvent`; a database failure returns 503 so Wazzup can redeliver. Each
queue key covers the kind plus canonicalized payload, while common ingest
also deduplicates messages by channel/chat/provider message ID. The worker
runs every three seconds, drains at most 50 events with two-minute leases,
and retries processing failures with backoff up to one hour. Statuses and
own-message echoes that arrive before the send response wait for correlation
(up to one day). Invalid events or events for unselected channels are ignored.
Incoming messages, device echoes, edits, deletions and delivery statuses all
pass through common ingest and ticket mirroring; no separate conversation
store is created.

**Provider-isolated outgoing delivery.** `ChannelJob.provider` follows the
channel. `/api/gateway/*` cannot list or lease Wazzup channels/jobs, ingest
events or heartbeat for those channels, or acknowledge their jobs. Old jobs
without `provider` remain gateway jobs. The Wazzup worker leases only `provider:wazzup`, checks the active configuration,
selected account, active channel and the «Диалоги» module, then calls
`POST https://api.wazzup24.com/v3/message`. Login, logout, proxy tests,
history import and mark-read commands remain direct-gateway operations.
Wazzup channels set `historyDays:0` and `markReadOnOpen:false`: opening a
conversation marks it seen in HD without calling Wazzup, and there is no
historical import through this adapter.

A logical reply is split into text parts (1024 characters for `wapi`, 10,000
for other WhatsApp transports, 4096 for Telegram/MAX), followed by one part
per attachment. Each part has a stable `crmMessageId` derived from the job ID
and part number. Before every external send, the worker persists its
`inFlightPart`; after a confirmed response it persists `nextPart` and
`externalIds`, then continues. Delivery statuses aggregate over all provider
IDs belonging to the logical reply. A 429 can retry automatically using
`Retry-After` (bounded to six hours). A timeout, missing response ID or crash
with an in-flight part leaves acceptance unknown and fails the job without
an automatic resend. Staff must inspect the conversation in Wazzup before
using the existing manual retry action, which creates a new delivery attempt;
late receipts for the previous attempt cannot mark the new attempt delivered.

**Media.** Incoming downloads accept only HTTPS URLs on exactly
`store.wazzup24.com` or `store.wazzup24.ru`, without credentials or an explicit
port; redirects are refused. The timeout is 30 seconds. The limit is the
lower of `Channel.settings.maxMediaMb` and 50 MiB, checked both from
`Content-Length` and while streaming. Oversized attachments are marked
`skipped`; an expired 404/410 URL is marked `failed`; other download failures
retry through the durable event queue. Accepted bytes go into HD storage.
Outgoing attachments use the public HD
`/uploads/direct/:name/:filename` endpoint for both local and S3-backed uploads.
It streams the bytes in a single response, supports GET/HEAD, preserves the
original filename through Content-Disposition and applies the upload sandbox
headers. It exposes the same public upload keys as `/uploads/:name`, never the
private-artifact namespace. Wazzup's content store rejected our otherwise valid
presigned S3 URLs with `BAD_RESPONSE`; direct HD responses were accepted in a
targeted live check with PNG and a synthetic `.conf` file on 2026-11-11.

Persistent health is written by real incoming processing and outgoing sends:
`lastOkAt`, `lastMessageAt`, `lastError`, `lastErrorHint`, `lastErrorAt`.
Provider errors are reduced to safe user-facing explanations; raw transport
errors, API keys and token-bearing callback URLs are not returned to staff.
