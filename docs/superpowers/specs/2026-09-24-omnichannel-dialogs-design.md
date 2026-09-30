# Omnichannel «Диалоги» — design

Status: design and mockup approved 2026-09-24; P0 backend implemented 2026-09-25
(not committed).
Implementation notes (event and job contract) live in `docs/messaging.md`.

## Problem

Client communication is split. HD holds ticket comments (and e-mail, which the
mail collector turns into tickets and comments). Next to it, managers chat with
clients by hand from **corporate accounts** in Telegram, WhatsApp Business and
MAX; website feedback forms also post into a messenger. The messenger side is not
visible to the team, not tied to tickets and not measurable. Goal: **one window** —
every client message lands in HD, replies go out from HD into the same messenger,
the ticket timeline shows the whole conversation whatever the channel, and "who is
still waiting for us" is visible to everyone.

## Decisions (owner, 2026-09-24)

1. **Group chats and 1:1 chats are both in v1** (roughly equal share today).
2. **Hybrid model.** New section «Диалоги». A 1:1 chat bound to an open ticket feeds
   it; unbound messages wait with «Создать заявку» / «Привязать к заявке». No
   per-channel automatic ticket creation in v1 (every «Добрый день» would become a
   ticket).
3. **Channels are the existing corporate accounts**, not staff personal accounts.
4. **Own gateway, no aggregators.** Telegram corporate account = MTProto user session
   (GramJS). WhatsApp Business = WhatsApp Web linked device (Baileys, QR). **MAX =
   official company bot** — MAX has no API for user accounts, so clients move from the
   corporate MAX account to the bot.
5. **Telegram first** (most traffic). The accounts are used for clients only.
6. **Website forms land in «Диалоги»** through a new HD endpoint (today they post
   into a messenger).
7. Mockup review: **messenger order** in «Диалоги» (oldest → newest, composer at the
   bottom; variant A, not the chronicle canon of variant F); **brand colours** for
   channel glyphs; phone tab bar «Главная · Заявки · Диалоги · Пользователи ·
   Компании» («База» moves to the burger menu) with a count badge on «Диалоги»; new
   «Диалог» row in the ticket's «Детали».

## Context: 2026 constraints

- Telegram and WhatsApp are heavily restricted in Russia; a server in Russia often
  cannot reach them. The gateway therefore supports a **per-channel proxy** (SOCKS5,
  MTProxy for Telegram) or runs on a host abroad. MAX works domestically.
- MAX bot API: webhook needs HTTPS:443 with a trusted CA, secret header
  `X-Max-Bot-Api-Secret`, answer within 30 s, subscription removed after 8 h of
  failures; long polling is for development only and is disabled while a webhook
  exists; dialogs are addressed by `user_id`; no delivery/read events; text ≤ 4000;
  uploads via `POST /uploads`; a bot cannot write first.
- MTProto (user session) delivers history, groups, messages sent from other devices
  ("from the phone"), edits, deletions and read receipts; FLOOD_WAIT must be honoured.
- Baileys is unofficial (ban risk); the phone must come online at least every 14 days;
  it delivers `fromMe` echoes, delivery/read receipts, groups and a history sync on
  pairing.
- 152-FZ: Telegram/WhatsApp servers are abroad — the tenant's cross-border notice must
  cover these channels; site-form consent is stored.
- SaaS: HD is deployed per tenant; nothing may require us to register callback URLs at
  a provider per tenant. Tenant-provided tokens and QR pairing are fine.

## Concept

**Three objects**

- **Заявка** stays the unit of work (works, time, reports). Its «Хроника» shows
  messages from every channel with a channel marker; a reply from the ticket goes out
  through a chosen route.
- **Диалог** (`Conversation`) = one chat in one channel: `direct`, `group` or `form`.
- **Контакт** = an HD user plus channel identities (`ChannelIdentity`). No messenger
  fields are added to `User`.

**Chat ↔ ticket**

- Direct chat: sticky binding. While bound to an open ticket, messages both ways are
  mirrored into it as Comments (messenger time, channel marker, delivery status).
  Replying from a ticket through a direct chat binds that chat; if the chat is bound to
  another open ticket the route is blocked (shown disabled in the menu, 409 on the
  server). Ticket closed or deleted → the binding ends; the next inbound message asks
  staff «По заявке №X (закрыта)? Вернуть в работу · Новая заявка · Без заявки».
- Group chat: never bound as a whole. Staff select messages → «Создать заявку» /
  «Добавить в заявку». A client's quote-reply to a message that belongs to an open
  ticket X attaches to X (closed X → only a suggestion). Messages in a ticket carry a
  «№X» tag.
- «Создать заявку» opens the **existing** ticket form (FormSheet, nested route)
  prefilled from the chat: company, applicant, description = selected messages, media
  copied; AI title/category as today. An unidentified contact → the server sets
  `defaultApplicant` and `realSender` «Имя · Telegram», exactly like e-mail.

**Queues.** «Ждёт ответа» = the last message is inbound and unhandled. It is cleared
by any newer outbound message (from HD, from the phone, from a staff account in a
group) or by «Ответ не нужен» (logged as a system line). Imported history never sets
it. Queues: «Ждут ответа · Мои · Без заявки · Все», filter «Скрытые» («Скрыть диалог»
for spam). «Мои» = assigned to me, or unassigned and belonging to one of my companies
(`responsibleForCompanies`).

**Reply routing («Ответить через»)** in the ticket chronicle: the applicant's chats
plus «Почта и бот HD — как сейчас». Default = the bound chat, else the channel of the
client's last inbound message in this ticket, else «как сейчас». A messenger reply
sets `skipApplicant` on the comment → no duplicate e-mail / bot / in-app notice to the
applicant; staff notifications are unchanged.

**Identity** is linked only by hard evidence: Telegram id = `User.telegramBot.chatId`,
phone via `findApplicantByPhone`, a MAX pairing code or `request_contact`, or manual
«Это он» — never by name or username. Unknown → the «Кто это?» panel (search a user,
«Это он», «Новый пользователь» = the existing UserForm, «Скрыть диалог»). A group is
linked to a company once.

**Staff contacts rule.** Clients write to corporate accounts or the bot only; replies
may be signed «— Игорь, F1Lab» (first name + organisation); the comment `channel`
block and `realSender` carry names only (tested); conversation APIs are staff-only.

## UI (mockup rev. 2)

Boards: A — «Диалоги» desktop (light/dark): page header with queue chips, one panel
with three panes (list 352 · thread · context 320). B — phone: list, thread (tab bar
hidden, composer docked), context sheet, dark variants. C — group chat with message
selection, unknown WhatsApp number («Кто это?»), website form card. D — ticket page:
chronicle with channel markers and «Ответить через ▾», new «Диалог» row in «Детали»,
phone sheet. E — Settings → «Каналы связи» (SettingRow + HealthRow per channel,
«Диалоги» module switch, QR connect dialog, phone). F — comparison only (rejected).

Channel brand colours (text on tint):

| Channel | Light fg / tint | Dark fg / tint |
|---|---|---|
| Telegram | `#1b86ba` / `rgba(34,158,217,.14)` | `#56b8ee` / `rgba(42,171,238,.18)` |
| WhatsApp | `#128c46` / `rgba(37,211,102,.16)` | `#3fd07f` / `rgba(37,211,102,.16)` |
| MAX | `#5a43d4` / `rgba(112,86,240,.14)` | `#a594ff` / `rgba(130,110,255,.20)` |
| Site, e-mail | neutral (`accent` tile, `muted-foreground` glyph) | neutral |

## Architecture

- **backend** owns all state and logic. The MAX adapter and the site form live in the
  backend (public HTTPS webhook under `/api/`, no proxy, no session). Every adapter
  emits the same normalized event → one ingest path.
- **msg-gateway** — a new TypeScript service cloned from the `tg-service` skeleton
  (compose profile `messengers`, node:24-alpine): GramJS for Telegram (QR / code / 2FA
  login, SOCKS5 / MTProxy, gap check) and Baileys v7 for WhatsApp (QR or pairing code,
  phone/LID aliases). Sessions stay in the gateway's volume (node:sqlite, encrypted with
  `MSG_GATEWAY_ENC_KEY`, bound to `APP_PUBLIC_URL`, `VACUUM INTO` snapshot in
  `deploy.sh backup`) — never in Mongo, so `sync-dev-db.sh` cannot clone a live
  session (Telegram answers `AUTH_KEY_DUPLICATED`). It talks to the backend only over
  HTTP (`X-Gateway-Token`, own limiter) and can run on a host abroad.

**Models** (`backend/models/`, types in `backend/types/`)

- `Channel` — type `telegram | whatsapp | max | site`; state (`connecting`,
  `awaitingQr`, `awaitingCode`, `awaitingPassword`, `connected`, `loggedOut`, `banned`,
  `error`); account; `login {qr, expiresAt}`; health; settings (`proxyUrl`,
  `historyDays` 14, `importGroups`, `markReadOnOpen`, `signReplies`, `maxMediaMb` 50,
  `ignoredChatIds`, `site {formKey, allowedOrigins, consentText}`); secretBox secrets;
  `serviceUserId` (author of mirrors of messages sent from the phone).
- `ChannelIdentity` — network, externalId, aliases, names, username, phone
  (canonical digits — E.164 without «+», `docs/phone-numbers.md`),
  isBot, userId, linkMethod (`tgBot | phone | pairing | manual`), companyId, isStaff.
  Unique `{network, externalId}`.
- `Conversation` — channelId, kind, externalChatId, participants, companyId,
  `binding {ticketId, ticketNum, boundAt, boundBy, endedAt, endReason}`,
  `decision {afterClose}`, assigneeId, awaitingSince, handled, lastMessage, hidden.
  Unique `{channelId, externalChatId}`.
- `Message` — direction, origin (`client | staff | hd | device | form`), identityId,
  authorUserId, kind, text, attachments (status `ready | pending | skipped | failed`),
  replyTo, externalId(s), sentAt, status (`received | queued | sent | delivered | read |
  failed`), revisions, editedAt, deletedAt, ticketId, attachMode, commentId, imported,
  `effects {}` (replay-safe steps instead of transactions). Unique
  `{channelId, externalChatId, externalId}`.
- `ChannelJob` — outbox + commands (lease/ack like `controllers/bot.js`,
  per-conversation ordering, backoff 30 s → 30 min × 5, FLOOD_WAIT = delay, not an
  attempt). `ConversationRead` — like `TicketRead`.
- Changes: `Comment` + `channel {network, conversationId, messageId, direction,
  authorName, status, editedAt, deletedAt}` + `notifications.skipApplicant`;
  forward-only `bumpTicketActivity`; `Ticket.source` + `WhatsApp`, `MAX`, `Сайт`;
  close hook ends bindings; `Preferences.modules.messaging`,
  `notify.personal.conversationMessage`; `User.notify.*.conversationMessage`;
  `services/storage.js` `putObject` / `copyObject`.

**Flows**

- Ingest (`services/messaging/ingest.js`): upsert conversation + identity → insert
  message (duplicate key = replay, resume `effects`) → summary with only-if-newer
  writes → awaiting → pure `decideAttach` → mirror Comment (idempotent by
  `channel.messageId`, `$push` into `ticket.comments`, media placeholders «Фото» /
  «Голосовое 0:12», only the newest of a batch notifies) → in-app notice only when an
  unbound chat starts waiting (assignee → company responsibles → `conversation.manage`).
- Outbound: Comment (`preparing`) → Message (unique `commentId`) → Job; a guarded cron
  repairs stuck ones. No duplicates: gateway `sent_jobs` (check → send → record → ack),
  Telegram `random_id` derived from the job id, WhatsApp deterministic ids, MAX
  at-least-once. Echoes from the phone not in `sent_jobs` → `origin: device`. Statuses
  only move forward; comment status updates are pulse noise plus a targeted
  `bus.bump({ticketIds})`.
- Media: the gateway downloads through the proxy and uploads to
  `POST /api/gateway/media` → storage; files over `maxMediaMb` and history media are
  `skipped` and fetched on click (`fetchMedia` job).
- Rate limits: Telegram 1/s per chat, 20/min; WhatsApp ≥ 3 s per chat + typing, 30 per
  10 min, 10 first contacts per day, `markOnlineOnConnect: false`; MAX 2/s per chat,
  4000-character chunks.
- History import: `historyDays`, text only, `imported`; never 777000, Saved Messages,
  bots, broadcast channels, `ignoredChatIds`. Gap check on reconnect and every 5 min.
- Live: pulse topics `conversations` and `conversationThreads` (staff only); an open
  thread fetches `changedSince` with `requestCadence(3000)`.

**Endpoints**

- Gateway (mounted before `attachSession`, like `/bot`): `GET channels`, `POST events`
  (batch, per-event ok / retryable), `POST|GET media`, `GET jobs?wait=25`,
  `POST jobs/ack`, `POST heartbeat`.
- Public: `POST /api/hooks/max/:channelId` (secret header),
  `POST /api/public/forms/:formKey` (form-encoded, allow-origin only for
  `allowedOrigins`, honeypot, minimum fill time, consent, rate limits).
- Staff (module switch + `conversation.*`): list / get / messages / ticket-draft;
  send / seen / handled / retry; assign / bind / unbind / attach / decision / hide;
  identity link / unlink; `GET /tickets/:num/delivery-routes`. Channels CRUD +
  connect / login / logout / test / history under `settings.manage`.
- Extended: `POST /api/tickets/add` + `originConversationId`, `originMessageIds`,
  `source`; `POST /api/comments/add` + `deliverVia`.
- Permissions: `conversation.read | reply | manage` (staff; visibility follows the
  ticket tiers; every reader also sees unidentified chats) in `auth/access.js` + grant
  migration `scripts/grantConversations.js` in `scripts/migrate.js` +
  `roles.catalogue.json` (otherwise administrators lose full access).

## Phases

| Phase | Scope |
|---|---|
| P0 | Backend foundations: models, ingest/mirroring/outbound queue, conversation + gateway APIs, module switch, permissions + grant migration, pulse topics, notification category, storage helpers, dev smoke script, `docs/messaging.md` |
| P1 | UI per the mockup (inbox desktop/phone, chronicle «Ответить через», ContactCard rows, settings «Каналы связи», nav/tab bar, brand tokens, guide) + `msg-gateway` with Telegram MTProto (direct chats) |
| P2 | Telegram groups: participants, supergroup migration, company per group, selection → ticket, quote auto-attach, staff accounts clear awaiting |
| P3 | MAX bot: webhook auto-subscribe + 30-min check, polling fallback, uploads, chunking, pairing, `request_contact` |
| P4 | WhatsApp (Baileys v7): encrypted auth state, SOCKS agent, QR / pairing code, phone/LID aliases, logout/ban → channel state |
| P5 | Website form: snippet, form conversations, one-off e-mail reply, prefilled «Новый пользователь», reply by phone within the first-contact cap |
| P6 | Voice transcription, «Шаблоны ответов», waiting times by work calendar, staff bot alerts, retention, private media route, e-mail threading for form replies |

MAX (P3) precedes WhatsApp (P4): official API, domestic, and Baileys — the riskiest
part — lands on a proven pipeline. Swap if WhatsApp volume matters more.

## Risks

- Bans: rate limits, no bulk sends, first-contact cap, WhatsApp warm-up; a ban or
  logout moves the channel state and alerts admins.
- Blocking: per-channel proxy with «Проверить», or the gateway abroad; MAX is domestic.
- Session loss (WhatsApp 14-day rule, Telegram «terminate other sessions»):
  `loggedOut` + in-app alert; gateway snapshots.
- Duplicates: inbound dedup key + `effects`; outbound `random_id` / deterministic ids.
- Volume: history cap, on-demand media, `maxMediaMb`, S3; retention in P6.
- Secrets: sessions never in Mongo; channel data excluded from the dev copy; secretBox;
  logs carry ids, not message text.
- Staff contacts: staff-only APIs (+ `isNotClient`), names-only client payloads (test),
  reply signature = first name + organisation.
- Public `/uploads` by URL (existing behaviour) now carries chat media → private route
  in P6.

## Out of scope (v1)

Automatic ticket creation per channel, internal notes, SLA timers, reply templates
(P6), replies inside the HD notification bot, capturing managers' personal accounts,
the e-mail attachments S3 bypass (`emailHandling.js:536`, separate fix).
