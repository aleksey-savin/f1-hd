# Omnichannel «Диалоги» — P1b: Dialogs UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The staff-facing «Диалоги» UI on top of the committed P0 backend (2e1e693) — inbox (queues · list · thread · contact pane), «Кто это?», the ticket side (the «Хроника» rebuilt as a dialog for staff and end users — boards D4–D8 — with channel markers, delivery status/retry and «Ответить через»; «Создать заявку» from a chat; the «Диалог» row), channel settings (Telegram connect with QR / code / 2FA, proxy «Проверить», history, read receipts, signature), the «Диалоги» module switch, the notification category, an in-app alert to administrators when a channel is logged out, banned or broken, navigation with a count pill and the new phone tab bar — pixel-faithful to the approved canvas, for Telegram direct chats.

**Architecture:** One data-router section `/conversations` (list store + nested `:id` thread route whose loader returns the conversation card and the first message page); live data only through the existing pulse (`useLiveTopic`, `requestCadence`) — the list refreshes on topic `conversations`, an open thread polls `changedSince` when that topic moves. Every decision that can be pure (texts, time labels, queue meta, thread grouping, poll cursor, delivery routes, who sits on which side of the ticket chronicle, channel state, draft → form mapping, the modules payload) lives in `node --test`-covered helpers; components are thin TSX over them and the `components/app` catalog. Forms over a conversation («Создать заявку», «Новый пользователь») are the EXISTING ticket and user forms mounted as nested FormSheet routes. Seven small backward-compatible backend additions (counts, identity candidates, `boundAt`, the `channels` pulse topic, the channel failure alert, comment author flag + e-mail tag for the chronicle, a dev seed).

**Tech Stack:** React 19, react-router 7 (data router), Vite 6, Tailwind v4 + shadcn/radix, zustand 5, TypeScript 6 (new frontend code in `.ts/.tsx`), `node:test` for pure helpers; backend Node 24 CommonJS, Express 5, Mongoose 9, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` (Concept, UI, brand colour table, Endpoints, Queues, Reply routing, Identity, Staff contacts rule); backend contract `docs/messaging.md` (§7 Staff API, the `changedSince` contract); approved canvas https://claude.ai/artifact/FN258HRxCzAUV7JV36HEem — boards A1/A2, B1–B5, C2, D1–D3, E1–E4 (C1, C3, F are out of scope). Everything the implementer needs from the canvas is copied into «Canvas reference» below.

## Global Constraints

- No commits and no staging in any step — each task ends with a checkpoint; the owner commits by hand.
- pnpm only; no new dependencies unless the plan justifies one. (This plan adds none: `qr-code-styling`, `react-icons`, radix and zustand are already installed.)
- Frontend typecheck baseline is red with 3 known errors (see memory) — "no new errors" is the gate; never add `eslint-disable react-hooks/*`. (The three: `src/components/app/FormWrapper.tsx(100,32)` TS2345, `src/pages/Finances/ApprovalReport.tsx(146,28)` and `(166,26)` TS2554. The react-hooks ESLint plugin is not installed, so such a comment itself fails lint.)
- Frontend lint baseline: 3 warnings (`components/Error/500.jsx`, `components/Preferences/Tickets.jsx` ×2) make `pnpm lint` exit non-zero on a clean tree — lint the files a task touches: `pnpm exec eslint <files> --max-warnings=0` must print nothing.
- Code comments in Russian; UI texts Russian; docs English (module notes `docs/messaging.md`, `docs/live-updates.md`). The UX guide and its changelog are Russian-language documents and stay Russian.
- Clients never see staff personal contacts; «Диалоги» and channel settings are staff-only UI.
- Nothing touches production; `sync-dev-db.sh` is never run; `node scripts/migrate.js up` is never run by the plan.
- Typography only from the Dense scale — no `text-[Npx]` (arbitrary box sizes, radii and offsets such as `h-[calc(100svh-8.5rem)]` or `rounded-[14px]` are fine); both themes; desktop and phone; wording canon («Новый X» for creation, «Отмена» for forms that change data, «Закрыть» for read-only).
- Live data only through the pulse (`useLiveTopic`, `useDeferredRevalidate`, `requestCadence`) — no data-polling timers. The QR countdown is a display clock, not a data poll.
- Pure helpers are unit-tested with `cd frontend && node --test <file>`: they import nothing browser-only (`util/format-date`, `lib/api`, stores), their relative imports carry the `.js` extension, and JS helpers carry JSDoc types (TS infers JS option objects from their defaults and drops un-defaulted keys otherwise).
- New components, hooks, stores and types are TypeScript (`.ts/.tsx`, `type` props, arrow component + default export). Pure helpers that import each other under `node --test` are `.js` with JSDoc types — Node needs real extensions in relative imports and the TS config does not allow `.ts` import extensions. A JS component or store used from TSX is cast once at the boundary (`X as unknown as ComponentType<{…}>`, `selector(...) as T[]`).
- Backend tests: `cd backend && NODE_ENV=production pnpm test`; untested backend files get `node --check`.
- Scripts delete only by explicit `_id` lists after counting; never a blind `deleteMany`.
- Out of scope: group-chat selection (canvas C1, P2), the website form card (C3, P5), the gateway service (P1a), WhatsApp / MAX / site rows in «Каналы связи» (P3–P5). The UI must still render `kind: "group"` and `kind: "form"` rows and threads without breaking.

## Review Focus

1. **Saving «Модули» must never switch «Диалоги» off.** The backend replaces the whole `modules` object (`controllers/preferences.js`, `has("modules")` branch) and today's `Modules.jsx` does not send `messaging` — one save of any module would silently disable the inbox for everyone. Pinned by `modules-payload.test.js` (Task 12).
2. **A burst of changes while a thread is open** (the gateway replays a backlog, statuses flip on 200 messages) — the `changedSince` page comes back full; the client must drain it with `afterId` without skipping or duplicating, and render by `seq`. Pinned by `nextCursor` / `changesQuery` / `mergeMessages` tests (Task 6).
3. **«Создать заявку» for an unidentified sender** — the form must accept an empty «Инициатор» (the server sets the service account and puts «Андрей · Telegram» into `realSender`), and must not save or restore the generic local ticket draft (the chat text would reappear in the next ordinary «Новая заявка»). Pinned by `originFormValues` and `formDraftEnabled` tests (Task 9).
4. **«Ответить через» must never preselect a busy or vanished route** — a chat bound to another open ticket answers 409; the default falls back to «Почта и бот HD». Pinned by `initialRoute` tests (Task 10).
5. **Which side of the ticket chronicle a message is on, and whose name it carries.** Staff must see every colleague on the right and the applicant, other client users and unknown messenger senders on the left; an end user sees only their own messages on the right — a reply sent through Telegram is the team's, a message the client wrote in Telegram is the client's. Old comments whose author has no `isEndUser` (embedded snapshot, deleted account) must not jump sides at random, and an unknown sender reads «Андрей», not the service account's name or «Андрей · Telegram» next to a «Telegram» marker. Pinned by `commentSide`, `chronicleRows` and `chronicleAuthorName` tests (Task 10).

(Also pinned, lower risk: group and form rows render meta without crashing — `rowMeta` tests, Task 5; «Диалоги» facet only for people who can open the section — `visibleFacets` test, Task 11; a replayed or repeated `channel.state` event and a flapping connection must not flood the administrators' bells — `shouldAlertChannelState` tests, Task 13.)

## Backend changes (for reconciliation with the P1a plan)

1. `GET /api/conversations/counts` (gate: `conversation.read` + module) → `{ counts: { awaiting, mine, unbound, all } }` — navigation badge; declared before `/conversations/:id`.
2. `GET /api/identities/:id/candidates?q=` (gate: `conversation.manage` + module) → `{ items: [{ id, name, position, company }] }` — «Кто это?» search; names/position/company only, same visibility rule as `/identities/:id/link`.
3. `GET /api/conversations/:id` — the card's `ticket` gains `boundAt` (additive).
4. Pulse topic `channels` (staff-only): the `Channel` model gets the pulse plugin (noise: `updatedAt`, `__v`, `gatewaySeenAt`, `lastMessageAt`); `ackJobs` bumps `channels` when a `login` / `logout` / `testProxy` / `loadHistory` job is acknowledged.
5. `backend/scripts/seedDemoConversations.js` — dev-only demo data (`--remove` to clean), not in `migrate.js`.
6. Channel failure alert (spec «Risks»): `ingestChannelState` (`services/messaging/ingest.js`) now writes the state as a compare-and-set on the previous one; a move of an active channel **into** `loggedOut` / `banned` / `error` from a different state pushes one in-app notification to every non-banned, non-service holder of `settings.manage` — new kind `channelState` (`EXTRA_KINDS`), category `conversationMessage` (no admin/system category exists; the nearest one — same module, in-app only), link `/preferences#channels`, text = channel name + reason. `error` rings at most once per 6 h per channel (new field `Channel.errorAlertedAt`). New `services/messaging/channelAlert.js` (+ test).
7. Chronicle dialog (Task 10): `GET /api/tickets/:num` — comment authors carry `isEndUser` (`controllers/ticket.js#getOne` populate; it decides the side of the dialog); new optional `Comment.source` (`"email"`), set by `middleware/emailHandling.js` on e-mail comments for the «письмо» marker (older e-mails are recognised by `quotedText`). P1a touches none of these three files.

**Overlap with P1a** (which adds `POST /api/messages/:id/media` in `controllers/conversation.js`, `routes/internal/conversation.js` and `services/messaging/media.js`, plus a gateway §9 in `docs/messaging.md`): compatible in either order. The P1b hunks in the controller (the `present` import line, `exports.counts` after `queueCounts`, `boundAt` in `get`, `exports.candidates` before `exports.deliveryRoutes`) and in the routes file (`/conversations/counts` after the list route, `/identities/:id/candidates` after `/identities/:id/unlink`) touch other lines than P1a's `requestMedia` import, `exports.fetchMedia` and the `/messages/:id/media` route — checked with `git apply --check` on top of the P1a draft. `docs/messaging.md` is edited by anchored insertions and replacements (Task 14) that leave every line the P1a plan matches untouched (its `_Last updated` header lines, the `fetchMedia` job row, the `POST /messages/:id/retry` row); the P1b frontend map closes §7 instead of becoming a new top-level section, so P1a's §9 appended after §8 stays in order whichever plan lands first. P1b does not touch `services/messaging/media.js`; `jobs.js` gets only the `channels` bump inside `ackJobs` (P1a's Task 18 replaces only `applyMediaOutcome`), and `fetchMedia` is deliberately not a «command» job for it. `services/messaging/ingest.js` (Task 13) and `models/inAppNotification.js` are not edited by P1a.

## Contract assumptions shared with P1a (msg-gateway)

The settings UI reads only what P0 defines; these are the expectations the P1a plan must meet:

- Login progress arrives as `channel.state` events: `connecting` → `awaitingQr` with `login.qr` (the string is encoded into the QR as-is, e.g. `tg://login?token=…`) and `login.expiresAt`; `awaitingCode`; `awaitingPassword` (2FA); `connected` with `account { displayName, phone, username }`; `error` / `loggedOut` / `banned` with `reason`.
- `POST /api/channels/:id/login { step: "phone", value }` may be sent without a preceding `start` (the «Войти по коду из SMS» path); `code` and `password` steps follow the state the gateway reports.
- A `testProxy` job is acknowledged `ok: true` with `result: { latencyMs: number }`, or `ok: false` with a human-readable `error` (shown after «Прокси не отвечает · »).
- The gateway reads `secrets.tgApiId`, `secrets.tgApiHash`, `secrets.proxyPassword` and `settings.proxyUrl`, `historyDays`, `markReadOnOpen`, `signReplies` from `GET /api/gateway/channels`.
- Heartbeats (`POST /api/gateway/heartbeat`) arrive at least every 5 minutes — the settings row says «Шлюз не отвечает» after 5 minutes of silence.

## Canvas reference

Everything below was measured from the canvas generator (`build.py`, rev. 2); the scratchpad copy may not survive.

**Tokens** (added to `styles/tailwind.css`, light / dark):

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--channel-telegram` / `-tint` | `#1b86ba` / `rgba(34,158,217,.14)` | `#56b8ee` / `rgba(42,171,238,.18)` | Telegram glyph / its tile |
| `--channel-whatsapp` / `-tint` | `#128c46` / `rgba(37,211,102,.16)` | `#3fd07f` / `rgba(37,211,102,.16)` | WhatsApp |
| `--channel-max` / `-tint` | `#5a43d4` / `rgba(112,86,240,.14)` | `#a594ff` / `rgba(130,110,255,.20)` | MAX |
| `--bubble-in` | `#f2f4f5` | `#272b31` | inbound bubble |
| `--bubble-out` | `rgba(0,188,140,.13)` | `rgba(0,188,140,.17)` | our bubble |
| `--media-placeholder` / `-fg` | `#dfe3e6` / `#7f8a93` | `#2c3137` / `#838c95` | photo not downloaded yet |
| `--voice-wave` | `#c3c9ce` | `#4a5057` | voice bars |

Site, e-mail and phone are neutral: list tile `bg-accent text-muted-foreground`, contact-row tile `bg-primary/15 text-accent-text`.

**A1/A2 — desktop inbox (1440×900).** Sheet 48 px from the left, 92 px from the right (status rail), 80 px from the top, 24 px from the bottom, padding 16. Header row h 40: h1 «Диалоги» 30/30 600 tracking −0.025em + count «37» (= «Все») 20/28 500 faint tabular; queue chips 16 px after the title, gap 8 (`FilterChip md`, 40 px, count after the label; only «Ждут ответа» has a dot — amber `warning`); right: search 320 «Поиск по диалогам», filter icon button 40 outline «Фильтры». Panel 16 below: border, radius 12, three columns — list 352 (border-right soft), thread flex-1, contact 320 (padding 16/20, border-left soft).
List row: padding 12/16, gap 12; tile 40 radius 12 (phone 44), glyph 20; title 16/24 (unread 600, else 500) with a group glyph 15 before group titles, time 12 faint tabular on the right; line 2 (mt 2) 14/20 muted «Вы: …» / «с телефона: …» / «Смирнов Олег: …» (prefix in foreground); line 3 (mt 6) 12/16 «ТД Восток · №56812» or «… · без заявки» (faint) or «неизвестный номер», right side «ждёт 12 мин» 600 `warning-text` and the unread pill (min-w 20, h 20, radius 6, `bg-primary/15`, 12/16 600 `accent-text`). Selected row `bg-primary/10`; dividers from left 16.
Thread header min-h 64, padding 0 16 0 20, border-bottom soft: name 16/24 600; meta 14/20 muted: glyph 14 (brand) «Telegram» · «@m_sokolova» · «ждёт ответа 12 мин» (600 `warning-text`); right: ticket chip (h 36, border, radius 8, 14 600: state glyph 16 muted + «№56812» + state 400 muted) + «⋯» outline 36 «Действия с диалогом»; for an unbound chat «Создать заявку» (primary sm + plus) instead of the chip.
Messages: padding 12 20 16, justify-end. Day label 12/16 700 uppercase faint + hairline. Bubble max-w 420: inbound radius 14 14 14 4 on `--bubble-in`, ours 14 14 4 14 on `--bubble-out`, padding 8 12 6 (photo 4 4 6); time 12 faint tabular at the right bottom, ours with ✓✓ 16 `accent-text` («Прочитано») or ✓ 14 faint («Отправлено»); author above our bubble 12 muted right-aligned. Gaps: 6 after a day/system line, 4 same side, 12 side switch. System line: hairlines both sides, link icon 14 `accent-text`, 12/16 muted, ticket number a 600 `accent-text` link, max-w 460. Quote: 2 px `primary/35` left border, author 600 `accent-text`, text muted one line (max 300). Photo 220×124 radius 10; voice: play 36 round primary, 29 bars 3 px wide gap 2, height 28, duration 12 muted.
Composer: border-top soft, padding 12 16; textarea h 64 radius 8 placeholder «Сообщение в Telegram — попадёт в заявку №56812»; row mt 8: «Файл» (outline xs + clip), hint «Enter — отправить, Shift+Enter — новая строка» 12 faint, spacer, «Ответ не нужен» (ghost xs), «Отправить» (primary xs + send).
Contact pane: tile 44 + name 16/24 600 + «Бухгалтер · ТД Восток» 14 muted; channel rows (mt 14, gap 8): border radius 12 padding 6, tile 36 radius 8 (brand or `primary/15`), label 12 faint, value 14 500 tabular, action on the right — «Telegram · этот диалог / @m_sokolova» (border `primary/35`), «WhatsApp / +7 914 555-01-42 / Написать» (ghost xs), «Почта / m.sokolova@tdvostok.ru / copy» (icon-xs faint). Eyebrows 12/16 700 uppercase faint, margin 20 0 10: «Заявка» → block (border radius 12, padding 12 14): «56812» 14 600 muted + «привязана с 10:03» 12 faint right; title 14 500; «▶ в работе · срок сегодня в 18:00» 14 muted; «Лебедев Игорь»; «Открыть заявку →» 14 600 `accent-text` + «Отвязать» (ghost xs + unlink). «Открытые заявки ТД Восток · 2» rows (padding 8 0, border-top soft): number 14 500 muted, title 14 truncate, state 12 with glyph 13 (`warning-text` for waiting states), «Привязать» (outline xs + link). «Ответственный за диалог» — field h 40 with a 24 px presence avatar, name 14 500, chevron.

**B1/B4 — phone list (390×844).** Padding 12: title row (h1 30/36 + count 20/28 faint, filter icon 40 at the right), search full width, chips `sm` (28 px, 12 px, gap 6). List card below (mt 12, border radius 12), rows with 44 tiles. Tab bar island: «Главная · Заявки · Диалоги · Пользователи · Компании», badge on «Диалоги» (h 16, min-w 16, `bg-primary`, 12 700 white, ring 2 card, top −4 right −10).
**B2/B5 — phone thread.** No tab bar. Top block on card: «‹ Диалоги» (14 500 muted, padding 10 12 0), header (padding 4 12 10, min-h 52): name 16/24 600, meta 12 («Telegram · ждёт ответа 12 мин»), small ticket chip (h 32, 12 px, no state) + «⋯» outline 32 «Контакт и действия». Messages padding 12, bubbles max-w 290. Composer on card: hint 12 faint «Ответ уйдёт в Telegram и попадёт в заявку №56812», row: attach 44 ghost, textarea h 44 16 px «Сообщение», send 44 primary icon. System line short form «Создана заявка №56812 — переписка идёт в неё».
**B3 — contact sheet.** Bottom sheet radius 16 top, padding 20 20 28, close 36: tile 60 + name 18/24, channel values 16; «Заявка», «Ответственный за диалог».
**C2 — «Кто это?»** eyebrow «Кто это?» (mt 0); tile 44 with a user glyph + «+7 914 207-33-18 / WhatsApp · подписан «Андрей»»; paragraph «Свяжите номер с пользователем — дальше его сообщения будут узнаваться сами, а заявка получит компанию и инициатора.»; «Найти пользователя» (14 600 muted) + search «Имя, телефон или почта»; results: tile 28 + name 14 500 + «Примавто · завхоз» 12 muted + «Это он» (outline xs); divider; «Новый пользователь» (outline sm + plus, full width), «Скрыть диалог» (ghost sm + eye-off, full width). Thread starts with the info line «Новый собеседник — этого номера нет ни у пользователей, ни у компаний».
**D1/D2 — ticket.** Chronicle composer row: route trigger (h 32, border — primary while open, 12 600, brand glyph 14, «Telegram · Соколова М.», chevron) + «Файл» + «Отправить»; menu 304 wide, padding 4, radius 6, shadow md: header «Ответить через» 12 600 faint; items (padding 8, radius 6): brand glyph 16 · title 14/20 «Telegram · Соколова Марина» · sub 12 muted «личный чат · привязан к этой заявке» · check 16 `accent-text` when selected, selected row `bg-accent`; busy item at 45 % opacity with «занят заявкой №56790»; separator; «Почта и бот HD / как сейчас — уведомление о комментарии». (Chronicle entries: superseded by D4–D8 below.) «Детали»: row «Диалог» — «Telegram · личный чат» + «Открыть диалог →» (600 `accent-text`).
**D3 — phone ticket.** Route picker as a bottom sheet «Ответить через» (h2 18/28 + close): items padding 10 4, tile 36 radius 8 (brand), title 16/24, sub 12, radio 20 (selected: 6 px primary border); trigger h 36. (Its chronicle is superseded by D6.)
**D4–D8 — the ticket «Хроника» as a dialog (row D′, replaces the chronicle of D1–D3).** Desktop: right column 384 wide — eyebrow «Хроника» with Segmented «Переписка | Всё» (D4 «Всё», D5 dark «Переписка» — no system lines), then one panel (border, radius 12, card) filling the column height: the feed (padding 12 20 16, justify-end, oldest on top) and the composer docked at the bottom (border-top soft, padding 12 16). Feed: day label 12/16 700 uppercase faint + hairline; «Новые · 1» (accent-text, line `primary/35`) above the first unread message; system lines 12/16 muted, hairlines both sides, icon 14, margin 12 0 6 — «Создана заявка · Соколова Марина · письмо», «В работе · Лебедев Игорь», «Работа · 1 ч 30 мин · Лебедев Игорь». Bubbles max-w 420 (phone 290): the viewer's side right on `--bubble-out`, radius 14 14 4 14; the other side left on `--bubble-in`, radius 14 14 14 4; padding 8 12 6 (photo 4 4 6); time 12 faint at the bottom right. Above a bubble: left — name 12/16 600 + marker; right — name 12/16 muted + marker, right-aligned. **Staff (D4–D6):** team on the right — «Лебедев Игорь → ✈ Telegram ✓✓», «Смирнов Олег»; the applicant on the left with only the marker («✉ письмо», «✈ Telegram»); a failed reply shows «Не доставлено · Повторить» (12, destructive, right) under the bubble. **End user (D7, D8 dark phone):** own messages on the right, no name, with their marker («письмо», «✈ Telegram»); the team on the left by name («Лебедев Игорь», «Смирнов Олег»), no delivery ticks. The e-mail bubble ends with «▸ Показать цитату» 12 faint; a photo is a 220×124 tile (phone 200×112) radius 10 inside the bubble with its caption under it. Composer: staff — textarea 64 «Написать комментарий…»; row: «Ответить через» trigger + «Файл» (outline xs) + spacer + «Отправить» (primary xs); end user — «Написать сообщение…», «Файл» + «Отправить». Phone (D6/D8): digest (number, title, status) + eyebrow over the panel, textarea 56 at 16 px, trigger sm + spacer + send icon 36 (end user: send only).
**E1/E2 — settings.** Section «Каналы связи» (after «Сбор заявок» in the rail): row «Telegram — корпоративный аккаунт» / «F1Lab Поддержка · +7 (423) 200-00-00», leading tile 36 brand, «Настроить» (outline sm); health row «Подключён · сообщение 2 мин назад» / «Через прокси relay.f1lab.ru · история загружена за 14 дней»; row «Почта» / «support@f1lab.ru — настраивается в разделе «Сбор заявок»» / «Сбор заявок →» (ghost sm). Section «Модули»: «Диалоги» / «Telegram, WhatsApp, MAX и форма сайта — переписка с клиентами в одном окне» + switch, first row.
**E3 — connect dialog** (drawn for WhatsApp; Telegram adaptation in Task 12): 680 wide, padding 24, title 18/28 «… — вход», subtitle 14 muted; left 216: white QR box 216 (border, radius 12) with QR 168, «Код обновится через 18 с» 12 muted, «Войти по коду из SMS» 14 600 `accent-text`; right: numbered steps (20 px circles on accent), «Прокси» 14 600 muted + input + «Проверить» (outline), result «✓ Прокси отвечает · 140 мс»; options (border-top soft): «Загрузить историю за 14 дней» / «Только текст; вложения — по клику», «Отмечать прочитанным при открытии» / «Клиент видит, что его сообщение прочитали», «Подписывать ответы» / ««— Игорь, F1Lab» — имя без контактов», switches; footer «Отмена» (outline) «Сохранить» (primary).
**E4 — phone settings.** Rows stack, buttons full width, no leading tiles.

**Deliberate deviations from the canvas (decided here, listed for the owner's live check):**
- System lines are impersonal («Создана заявка №56812 — дальше переписка идёт в неё · Лебедев Игорь») — the canvas' «Лебедев Игорь создал…» has a gendered verb; ticket events use the same impersonal style.
- D1's «новое» badge next to «Открыть диалог» is treated as a review annotation and not built.
- E3 is a WhatsApp board; the Telegram dialog uses Telegram steps, adds «Ключи приложения Telegram» (api_id / api_hash — the gateway needs them) and a «Пароль прокси» field that appears only for `user@host` proxy URLs, plus the code and 2FA forms.
- E1's WhatsApp, MAX and «Форма с сайта» rows arrive with P3–P5; P1b shows Telegram and «Почта».
- E1's «Модули» draws leading icons on every module; P1b adds only the «Диалоги» row (with the canvas hint) in the section's current style.
- A1 shows «Привязать» on open tickets while the chat is bound; the plan shows it only for an unbound chat (the server answers 409 otherwise).
- D1's group route subtitle «группа компании · ответ уйдёт цитатой» becomes «группа компании» — quote replies are P2.
- D6/D8 have no «Файл» on the phone chronicle composer; the plan keeps it as a 36 px icon button (staff and clients attach files on the phone today — no regression).
- D4's system lines use the existing event catalog (`util/ticket-events`): labels «Создана», «Принята в работу», «Добавлены работы» … and the icon in the event's tone (ok — teal, warn — amber, bad — red, muted — faint) instead of always teal; the «· письмо» suffix of the creation line is not in the event data and is not shown.
- The chronicle opens with the «Новые» divider at the top of the panel when there are unread messages (the first unread message is where reading starts), otherwise at the bottom; the old per-message unread dots are dropped (the divider is the marker), and a day label stays above the divider when a day starts there.
- E-mail comments get the «письмо» marker from a new `Comment.source`; e-mails stored before the change are recognised only when they carry a quoted tail.
- The contact tile uses the app monogram (`monogramFor`: «Со»), not canvas initials «СМ».
- Unknown Telegram contacts read «неизвестный контакт» (the canvas only shows WhatsApp's «неизвестный номер»); «подписан «Андрей»» is not shown (the card has no separate signed name; WhatsApp is P4).
- The MAX glyph is `RiMessage3Line` — Remix has no MAX logo and the guide allows only Remix icons.
- E3's history hint «Только текст; вложения — по клику» is kept, but in P1b a skipped attachment is a static placeholder (kind and size): tap-to-fetch needs P1a's `POST /api/messages/:id/media` and belongs to whichever plan lands second.

## How code is presented

New files are given in full. Changes to existing files are unified diffs against HEAD 2e1e693 as each earlier task leaves it (`a/…` → `b/…`, 3 lines of context); apply them with the Edit tool hunk by hunk, or save the block and run `git apply <file>` from the repository root (no `--index`: nothing may be staged). `docs/messaging.md` is the exception — it is shared with the P1a plan, so Task 14 gives anchored find/replace edits instead of a diff. A file changed by two tasks is captioned «(on top of Task N's change)»: its second diff applies to the result of the first. `components/Ticket/Chronicle.jsx` is rewritten as the dialog and given whole, captioned «(whole file — replaces the current one)». Every code block in this plan was type-checked, linted, unit-tested and production-built against HEAD 2e1e693, last replayed 2026-09-27 (typecheck: the 3 baseline errors only; full lint: the 3 baseline warnings only; `vite build` green; backend suite 543/543 after Task 13).

## File Structure

**Backend — modify:** `services/messaging/present.js` (+`candidateRow`) and its test; `controllers/conversation.js` (`counts`, `candidates`, card `boundAt`); `routes/internal/conversation.js`; `services/pulse.js` + test (topic `channels`); `services/pulseTopics.js` + `services/pulsePlugin.test.js` (`Channel` spec); `models/channel.js` (plugin, `errorAlertedAt`); `services/messaging/jobs.js` (command-ack bump); `services/messaging/ingest.js` (compare-and-set + alert); `models/inAppNotification.js` (kind `channelState`); `controllers/ticket.js` (comment authors' `isEndUser`); `models/comment.js` (`source`); `middleware/emailHandling.js` (`source: "email"`).
**Backend — create:** `scripts/seedDemoConversations.js`; `services/messaging/channelAlert.js` (+test) — who is told about a failed channel and what.

**Frontend — create:**
- `types/conversation.ts` — API row shapes.
- `components/Conversation/ChannelGlyph.tsx` (`ChannelIcon`, `ChannelTile`), `components/app/CountPill.tsx`, `components/app/QrCode.tsx` — shared primitives.
- `util/conversation-format.js` (+test) — texts, time labels, row meta, system lines; `util/conversation-thread.js` (+test) — merge, poll cursor, thread rows, draft ids.
- `store/conversations.ts` — list, filters, counts; `components/Conversation/CountsSync.tsx`, `NavBadges.tsx` — navigation badge.
- `pages/Conversation/Inbox.tsx`, `Thread.tsx`, `NewUser.tsx` — routes.
- `components/Conversation/` — `QueueChips`, `ConversationRow`, `ConversationList`, `ListFilter`, `use-thread.ts`, `ThreadHeader`, `MessagesPane`, `MessageBubble`, `MessageMedia`, `SystemLine`, `Composer`, `DecisionPrompt`, `ContextPane`, `ContactBlock`, `ContactChannelRow`, `TicketBlock`, `OpenTickets`, `AssigneePicker`, `WhoIsThis`, `ThreadMenu`, `ContextSheet`, `ConversationThread`, `conversation-actions.ts`.
- `components/Ticket/ticket-origin.js` (+test), `ChannelMarker.tsx`, `ReplyRoute.tsx`, `use-delivery-routes.ts`; `util/delivery-routes.js` (+test); `util/chronicle-dialog.js` (+test) — sides, names, markers, day labels and «Новые» of the ticket chronicle.
- `components/Preferences/modules-payload.js` (+test), `Channels.tsx`, `TelegramChannelDialog.tsx`; `util/channel-state.js` (+test).

**Frontend — modify:** `styles/tailwind.css`, `index.css`, `App.jsx`, `util/format-date.js`, `store/prefs.js`, `util/sections.ts` (+test), `layout/sheet-width.js` (+test), `layout/Navigation/menu.js`, `layout/Navbar.jsx`, `layout/NavDrawer.jsx`, `layout/MobileBottomNavbar.jsx`, `layout/Root.jsx`, `components/app/{FilterChip,SettingRow,Combobox}.tsx`, `components/User/UserForm.jsx`, `pages/Ticket/Add.jsx`, `components/Ticket/{TicketFormRoute.jsx,use-ticket-form.js,TicketFormFields.jsx}`, `components/Ticket/Chronicle.jsx` (replaced as a whole — the dialog), `components/Ticket/View/Sections.jsx`, `pages/Ticket/View.jsx`, `types/notification.ts`, `util/notification-{meta,facets}.ts` (+test), `components/Notifications/FacetChips.tsx`, `components/Preferences/{Notifications.jsx,Modules.jsx}`, `components/User/AccountSettings/Notifications.jsx`, `pages/Preferences.jsx`.

**Docs — modify:** `docs/messaging.md` (a P1b header line, Staff API rows, the «Frontend map» paragraph closing §7, Operations bullets), `docs/live-updates.md`, `docs/ux-ui-guide.md`, `docs/ux-ui-changelog.md`.

---

## Task 1: Backend — queue counts, identity candidates, `boundAt`

Three small additive endpoints/fields the UI needs and P0 does not have: the navigation badge must not download a list page every 15 seconds; «Кто это?» must search users without learning their contacts; the ticket block says «привязана с 10:03».

**Files:**
- Modify: `backend/services/messaging/present.js` (add `candidateRow`)
- Modify: `backend/controllers/conversation.js` (add `counts`, `candidates`; `ticket.boundAt` in `get`)
- Modify: `backend/routes/internal/conversation.js` (two routes)
- Test: `backend/services/messaging/present.test.js`

**Interfaces:**
- Consumes (P0, already in the tree): `queueCounts(auth)`, `loadVisibleIdentity(req)`, `escapeRegExp`, `wrap` in `controllers/conversation.js`; `isBanned` (`services/authBan`); `idOf`, `userName` in `present.js`; route guards `read` / `manage` in `routes/internal/conversation.js`.
- Produces (HTTP, used by Tasks 7 and 8):
  - `GET /api/conversations/counts` → `{ counts: { awaiting: number; mine: number; unbound: number; all: number } }`
  - `GET /api/identities/:id/candidates?q=` → `{ items: { id: string; name: string; position: string; company: string }[] }` — at most 8, clients first, banned and service accounts excluded, empty `q` → `[]`
  - `GET /api/conversations/:id` → `ticket.boundAt: string | null` (ISO date of the binding)
  - `candidateRow(user) → { id, name, position, company }` exported from `present.js`

- [ ] **Step 1: Write the failing test**

Extend the import and append the test:

`backend/services/messaging/present.test.js`:

```diff
--- a/backend/services/messaging/present.test.js
+++ b/backend/services/messaging/present.test.js
@@ -2,7 +2,7 @@
 const { test } = require("node:test");
 const assert = require("node:assert/strict");
 
-const { publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow } = require("./present");
+const { publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow, candidateRow } = require("./present");
 
 test("the comment channel block carries names only", () => {
   const block = commentChannel(
@@ -111,3 +111,19 @@
   const system = messageRow({ _id: "m3", seq: 5, direction: "system", origin: "system", kind: "event", text: "", sentAt: new Date(), attachments: [], event: { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь" } }, ctx);
   assert.deepEqual(system.event, { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь", targetName: "", count: null });
 });
+
+test("identity candidates carry name, position and company — never contacts", () => {
+  const row = candidateRow({
+    _id: "u1",
+    firstName: "Андрей",
+    lastName: "Кузнецов",
+    position: "завхоз",
+    company: { _id: "c1", alias: "Примавто" },
+    email: "a.kuznetsov@primavto.ru",
+    phone: "+79142073318",
+  });
+  assert.deepEqual(row, { id: "u1", name: "Кузнецов Андрей", position: "завхоз", company: "Примавто" });
+  assert.equal(JSON.stringify(row).includes("7914"), false);
+  assert.equal(JSON.stringify(row).includes("@"), false);
+  assert.deepEqual(candidateRow({ _id: "u2", firstName: "Ольга" }), { id: "u2", name: "Ольга", position: "", company: "" });
+});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && NODE_ENV=production node --test services/messaging/present.test.js`
Expected: FAIL — `not ok 8 - identity candidates carry name, position and company — never contacts` with `TypeError: candidateRow is not a function`; `# tests 8`, `# pass 7`, `# fail 1`.

- [ ] **Step 3: Add `candidateRow`**

`backend/services/messaging/present.js`:

```diff
--- a/backend/services/messaging/present.js
+++ b/backend/services/messaging/present.js
@@ -76,6 +76,17 @@
   };
 };
 
+/**
+ * Кандидат «Это он» в панели «Кто это?» (`GET /identities/:id/candidates`):
+ * имя, должность, компания — без почты и телефона, даже если нашли по ним.
+ */
+const candidateRow = (user) => ({
+  id: idOf(user),
+  name: userName(user),
+  position: user.position || "",
+  company: user.company?.alias || "",
+});
+
 const STAFF_ORIGINS = new Set(["hd", "device", "staff"]);
 
 const messageRow = (message, ctx = {}) => {
@@ -132,4 +143,4 @@
   };
 };
 
-module.exports = { userName, publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow };
+module.exports = { userName, publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow, candidateRow };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && NODE_ENV=production node --test services/messaging/present.test.js`
Expected: `# tests 8`, `# pass 8`, `# fail 0`.

- [ ] **Step 5: Controller — counts, candidates, `boundAt`**

`candidates` reuses the visibility check of `/identities/:id/link` (`loadVisibleIdentity` — 404 for an identity the caller cannot see) and returns only `candidateRow` fields, so a search by phone never echoes the phone back (spec «Staff contacts rule»).

`backend/controllers/conversation.js`:

```diff
--- a/backend/controllers/conversation.js
+++ b/backend/controllers/conversation.js
@@ -15,7 +15,7 @@
 const { bus } = require("@/services/pulse");
 const storage = require("@/services/storage");
 const { QUEUES, listFilter, canSeeConversation } = require("@/services/messaging/visibility");
-const { conversationRow, messageRow, userName } = require("@/services/messaging/present");
+const { conversationRow, messageRow, userName, candidateRow } = require("@/services/messaging/present");
 const { NETWORKS, GATEWAY_NETWORKS, identityName } = require("@/services/messaging/rules");
 const { addSystemLine } = require("@/services/messaging/conversationStore");
 const { bindConversation, unbindConversation, attachMessages } = require("@/services/messaging/bindings");
@@ -97,6 +97,15 @@
   return counts;
 };
 
+/** Счётчики очередей без списка — пилюля «Ждут ответа» у пункта меню. */
+exports.counts = async (req, res, next) => {
+  try {
+    res.status(200).json({ counts: await queueCounts(req.auth) });
+  } catch (error) {
+    next(wrap(error, "Не удалось посчитать диалоги"));
+  }
+};
+
 exports.list = async (req, res, next) => {
   try {
     const queue = String(req.query.queue || "all");
@@ -206,6 +215,7 @@
             state: ticket.state,
             deadline: ticket.deadline,
             responsibles: (ticket.responsibles || []).map((r) => userName(r)),
+            boundAt: binding.boundAt || null,
           }
         : null,
       openTickets: openTickets
@@ -547,6 +557,36 @@
   }
 };
 
+// Поля поиска «Это он» — те же, что у адресной книги (controllers/user.js)
+const CANDIDATE_SEARCH_FIELDS = ["firstName", "lastName", "email", "phone", "position", "company.alias"];
+
+/**
+ * Кандидаты для ручной связи собеседника («Кто это?» → «Это он»): каждое слово
+ * запроса должно найтись хоть в одном поле; клиенты первыми. Наружу — имя,
+ * должность и компания (present.candidateRow), контактов нет.
+ */
+exports.candidates = async (req, res, next) => {
+  try {
+    await loadVisibleIdentity(req);
+    const terms = String(req.query.q || "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
+    if (!terms.length) return res.status(200).json({ items: [] });
+    const and = terms.map((term) => {
+      const pattern = new RegExp(escapeRegExp(term.slice(0, 64)), "i");
+      return { $or: CANDIDATE_SEARCH_FIELDS.map((field) => ({ [field]: pattern })) };
+    });
+    const found = await User.find({ $and: [{ isServiceAccount: { $ne: true } }, ...and] })
+      .select("firstName lastName position company banned banExpires")
+      .sort({ isEndUser: -1, lastName: 1, firstName: 1 })
+      .limit(16)
+      .lean();
+    // Срок отключения смотрит isBanned, а не сырой banned (у отключения есть срок)
+    const items = found.filter((user) => !isBanned(user)).slice(0, 8).map(candidateRow);
+    res.status(200).json({ items });
+  } catch (error) {
+    next(wrap(error, "Не удалось найти пользователей"));
+  }
+};
+
 exports.deliveryRoutes = async (req, res, next) => {
   try {
     const result = await deliveryRoutes(req.ticket);
```

- [ ] **Step 6: Routes**

`/conversations/counts` must be declared before `/conversations/:id`, otherwise Express hands «counts» to `get` as an id.

`backend/routes/internal/conversation.js`:

```diff
--- a/backend/routes/internal/conversation.js
+++ b/backend/routes/internal/conversation.js
@@ -27,6 +27,8 @@
 const settings = [...canManageSettings];
 
 router.get("/conversations", ...read, conversation.list);
+// До «/conversations/:id»: иначе «counts» ушёл бы параметром и ответил 404
+router.get("/conversations/counts", ...read, conversation.counts);
 router.get("/conversations/:id", ...read, conversation.get);
 router.get("/conversations/:id/messages", ...read, conversation.messages);
 router.get("/conversations/:id/ticket-draft", ...read, conversation.ticketDraft);
@@ -45,6 +47,7 @@
 router.patch("/conversations/:id", ...manage, conversation.update);
 router.post("/identities/:id/link", ...manage, conversation.linkIdentity);
 router.post("/identities/:id/unlink", ...manage, conversation.unlinkIdentity);
+router.get("/identities/:id/candidates", ...manage, conversation.candidates);
 
 router.get(
   "/tickets/:num/delivery-routes",
```

- [ ] **Step 7: Syntax check and the full backend suite**

Run: `cd backend && node --check controllers/conversation.js && node --check routes/internal/conversation.js && echo OK`
Expected: `OK`

Run: `cd backend && NODE_ENV=production pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 537`, `# pass 537`, `# fail 0` (536 before this task).

- [ ] **Step 8: Checkpoint** — no commit, no staging. `git status --short backend` shows exactly the four files above modified.

---

## Task 2: Backend — pulse topic `channels`

The settings dialog must learn that the QR was scanned, the code accepted or the proxy test finished — without a timer. P0 has no pulse on `Channel`. This adds a staff-only topic that moves on meaningful channel writes and on the acknowledgement of a command job.

**Files:**
- Modify: `backend/services/pulse.js` (topic list)
- Modify: `backend/services/pulseTopics.js` (`Channel` spec)
- Modify: `backend/models/channel.js` (plugin)
- Modify: `backend/services/messaging/jobs.js` (bump on command ack)
- Test: `backend/services/pulse.test.js`, `backend/services/pulsePlugin.test.js`

**Interfaces:**
- Consumes: `services/pulsePlugin.js` (`classifyUpdate(op, update, spec)`, `SPECS`), `bus.bump({ topics })`, `ackJobs` in `services/messaging/jobs.js`.
- Produces: pulse topic `"channels"` (staff-only automatically — `controllers/pulse.js` gives clients only `CLIENT_TOPICS = ["tickets", "approval"]`). Frontend subscribes with `useLiveTopic("channels", fn)` (Task 12). Noise: `updatedAt`, `__v`, `gatewaySeenAt`, `lastMessageAt`.

- [ ] **Step 1: Write the failing tests**

`backend/services/pulse.test.js`:

```diff
--- a/backend/services/pulse.test.js
+++ b/backend/services/pulse.test.js
@@ -103,3 +103,12 @@
   bus.bump({ topics: ["conversations"] });
   assert.equal(bus.topics().conversations, bus.rev());
 });
+
+test("channels is a topic and starts at zero", () => {
+  const { createBus, TOPICS } = require("./pulse");
+  assert.ok(TOPICS.includes("channels"));
+  const bus = createBus();
+  assert.equal(bus.topics().channels, 0);
+  bus.bump({ topics: ["channels"] });
+  assert.equal(bus.topics().channels, bus.rev());
+});
```

`backend/services/pulsePlugin.test.js`:

```diff
--- a/backend/services/pulsePlugin.test.js
+++ b/backend/services/pulsePlugin.test.js
@@ -178,3 +178,16 @@
   assert.equal(resultChanged({ _id: oid() }), true);
   assert.equal(resultChanged({ ok: 1, value: null }), false);
 });
+
+test("channel: heartbeat and message stamps are noise, login state moves «channels»", () => {
+  assert.equal(classifyUpdate("updateOne", { $set: { gatewaySeenAt: new Date() } }, SPECS.Channel).meaningful, false);
+  assert.equal(classifyUpdate("updateOne", { $set: { lastMessageAt: new Date() } }, SPECS.Channel).meaningful, false);
+  assert.deepEqual(
+    classifyUpdate(
+      "updateOne",
+      { $set: { state: "awaitingQr", stateReason: "", gatewaySeenAt: new Date(), login: { qr: "tg://login?token=x", expiresAt: new Date() } } },
+      SPECS.Channel,
+    ),
+    { topics: ["channels"], meaningful: true },
+  );
+});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/pulse.test.js services/pulsePlugin.test.js 2>&1 | grep -E "^not ok|# (tests|pass|fail)"`
Expected: `# tests 24`, `# pass 22`, `# fail 2` — failing `channels is a topic and starts at zero` (AssertionError, `actual: false`) and `channel: heartbeat and message stamps are noise, login state moves «channels»` (`TypeError: Cannot read properties of undefined (reading 'noise')`). A line `Failed to initialize counter: MongooseError … buffering timed out` may appear — it is printed by a model loaded without a database and is not a failure.

- [ ] **Step 3: Topic and spec**

`backend/services/pulse.js`:

```diff
--- a/backend/services/pulse.js
+++ b/backend/services/pulse.js
@@ -19,7 +19,7 @@
  * See docs/live-updates.md.
  */
 
-const TOPICS = ["tickets", "presence", "team", "mikrotik", "approval", "knowledge", "conversations"];
+const TOPICS = ["tickets", "presence", "team", "mikrotik", "approval", "knowledge", "conversations", "channels"];
 
 const createBus = ({ ticketCapacity = 5000 } = {}) => {
   const epoch = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
```

`backend/services/pulseTopics.js`:

```diff
--- a/backend/services/pulseTopics.js
+++ b/backend/services/pulseTopics.js
@@ -36,6 +36,13 @@
   path === "channel.statusAt" ||
   path === "channel.error";
 
+// Канал «Диалогов»: сигнал шлюза (gatewaySeenAt — на каждый heartbeat) и
+// отметка последнего сообщения (lastMessageAt — на каждое сообщение) — шум;
+// состояние входа, QR и настройки — изменение. Тему «channels» читают только
+// настройки каналов (Preferences → «Каналы связи»).
+const channelNoise = (path) =>
+  isBookkeeping(path) || path === "gatewaySeenAt" || path === "lastMessageAt";
+
 // Monitoring cycle (services/mikrotik/monitorState.js): poll results, failure
 // counter and the online/offline state machine. Real transitions are bumped
 // explicitly there, so the per-poll writes stay silent. Alert stamps
@@ -106,6 +113,7 @@
   Conversation: { topics: ["conversations"], noise: isBookkeeping },
   Message: { topics: ["conversations"], noise: isBookkeeping },
   ChannelIdentity: { topics: ["conversations"], noise: isBookkeeping },
+  Channel: { topics: ["channels"], noise: channelNoise },
   TicketLog: { topics: ["tickets"], ticket: "ticketId", noise: isBookkeeping },
   Work: { topics: ["tickets", "approval"], ticket: "tickets", noise: notificationNoise },
   User: { byPath: { presence: PRESENCE_PATHS, team: TEAM_PATHS }, noise: isBookkeeping },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/pulse.test.js services/pulsePlugin.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 24`, `# pass 24`, `# fail 0`.

- [ ] **Step 5: Plugin on the model, bump on command acknowledgement**

A job acknowledgement writes `ChannelJob`, not `Channel`, so the proxy-test result («Прокси отвечает · 140 мс») would never move the topic without the explicit bump.

`backend/models/channel.js`:

```diff
--- a/backend/models/channel.js
+++ b/backend/models/channel.js
@@ -76,4 +76,8 @@
 channelSchema.index({ type: 1, isActive: 1 });
 channelSchema.index({ "settings.site.formKey": 1 }, { unique: true, sparse: true });
 
+// Настройки каналов узнают о входе по QR и смене состояния из пульса — тема
+// «channels» (сигнал шлюза и отметка сообщения — шум, services/pulseTopics.js)
+channelSchema.plugin(require("../services/pulsePlugin"), { model: "Channel" });
+
 module.exports = mongoose.model("Channel", channelSchema);
```

`backend/services/messaging/jobs.js`:

```diff
--- a/backend/services/messaging/jobs.js
+++ b/backend/services/messaging/jobs.js
@@ -12,6 +12,9 @@
  */
 
 const LEASE_MS = 2 * 60 * 1000;
+// Команды шлюзу, итог которых ждут настройки каналов: вход, выход, проверка
+// прокси, история. Их подтверждение двигает тему пульса «channels»
+const COMMAND_JOB_TYPES = new Set(["login", "logout", "testProxy", "loadHistory"]);
 const MAX_PAUSE_MS = 6 * 3600 * 1000;
 
 // Долгий опрос шлюза просыпается, как только появилось задание
@@ -191,6 +194,7 @@
       if (job.type === "login") job.payload = { ...job.payload, value: null };
       await job.save();
       applied += 1;
+      if (COMMAND_JOB_TYPES.has(job.type)) require("@/services/pulse").bus.bump({ topics: ["channels"] });
 
       // Итог в сообщение пишется отдельно, задание уже закрыто — ошибка здесь не отменяет подтверждение
       try {
```

- [ ] **Step 6: Syntax check and the full backend suite**

Run: `cd backend && node --check models/channel.js && node --check services/messaging/jobs.js && echo OK`
Expected: `OK`

Run: `cd backend && NODE_ENV=production pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 539`, `# pass 539`, `# fail 0`.

- [ ] **Step 7: Checkpoint** — no commit, no staging.

---

## Task 3: Backend — dev demo seed

The owner checks the UI live, but no gateway exists yet (P1a) and the dev database has no conversations. The seed builds realistic demo data through the real P0 paths (ingest, outbound, job lease/ack), so every surface of the canvas can be looked at: a bound chat with photo, voice and quote (Марина), a failed reply (Олег), an unknown sender (Андрей), a reply from the phone (Белов), a group and a form conversation (must render without breaking).

**Files:**
- Create: `backend/scripts/seedDemoConversations.js`

**Interfaces:**
- Consumes (P0): `services/messaging/events` (`validateEvent`), `services/messaging/ingest` (`ingestEvent`), `services/messaging/outbound` (`sendFromInbox`), `services/messaging/bindings` (`bindConversation`), `services/messaging/jobs` (`leaseJobs`, `ackJobs`), models `Channel`, `Conversation`, `Message`, `ChannelIdentity`, `ChannelJob`, `ConversationRead`, `Comment`, `Company`, `User`, `Ticket`, `TicketRead`, `TicketLog`, `InAppNotification`, `Preferences`.
- Produces: demo records tagged `[DEMO] ` (channel and company names, ticket title), external ids `demo-p1-*`, user e-mails `@demo-p1.invalid`. Removal: `--remove` counts per collection, then deletes by explicit `_id` lists.

- [ ] **Step 1: Create the script**

`backend/scripts/seedDemoConversations.js` (new file):

```js
// «Диалоги» P1: демо-данные для живой проверки интерфейса без шлюза.
// Только дев. НЕ миграция и НЕ часть migrate.js.
//
// Создаёт «[DEMO]»-каналы (Telegram и форма сайта), компанию, двух клиентов,
// заявку и диалоги НАСТОЯЩИМИ путями: приём событий (ingest), ответ из HD
// (outbound) и подтверждения шлюза (jobs). Автор ответов — существующий
// сотрудник (первый администратор): его документ не меняется, на него только
// ссылаются. Модуль «Диалоги» скрипт не включает — это делает человек в
// «Настройки → Модули».
//
// Уборка — `--remove`: всё демо находится от «[DEMO]»-каналов и адресов
// @demo-p1.invalid, сначала считается, потом удаляется по списку _id. Чужие
// данные не трогаются.
//
//   docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js
//   docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js --remove
require("module-alias/register");
const mongoose = require("mongoose");

const TAG = "[DEMO]";
const TAG_RE = /^\[DEMO\] /;
// Внешние id собеседников и чатов: ни с чем настоящим не совпадут
const EXT = "demo-p1-";
const MAIL_DOMAIN = "demo-p1.invalid";

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);

const models = () => ({
  Channel: require("@/models/channel"),
  Conversation: require("@/models/conversation"),
  Message: require("@/models/message"),
  ChannelIdentity: require("@/models/channelIdentity"),
  ChannelJob: require("@/models/channelJob"),
  ConversationRead: require("@/models/conversationRead"),
  Comment: require("@/models/comment"),
  Company: require("@/models/company"),
  User: require("@/models/user"),
  Ticket: require("@/models/ticket").Ticket,
  TicketRead: require("@/models/ticketRead"),
  TicketLog: require("@/models/ticketLog"),
  InAppNotification: require("@/models/inAppNotification"),
  Preferences: require("@/models/preferences"),
});

/** Все демо-документы по коллекциям — и для проверки «уже есть», и для уборки. */
const collect = async (m) => {
  const channels = await m.Channel.find({ name: TAG_RE }).select("_id").lean();
  const channelIds = channels.map((doc) => doc._id);
  const conversations = await m.Conversation.find({ channelId: { $in: channelIds } })
    .select("_id counterpartIdentityId participants binding")
    .lean();
  const conversationIds = conversations.map((doc) => doc._id);
  const messages = await m.Message.find({ conversationId: { $in: conversationIds } }).select("_id ticketId").lean();
  const identityIds = conversations
    .flatMap((doc) => [doc.counterpartIdentityId, ...(doc.participants || []).map((p) => p.identityId)])
    .filter(Boolean);
  const identities = await m.ChannelIdentity.find({
    _id: { $in: identityIds },
    externalId: { $regex: `^${EXT}` },
  })
    .select("_id")
    .lean();
  const jobs = await m.ChannelJob.find({ channelId: { $in: channelIds } }).select("_id").lean();
  const reads = await m.ConversationRead.find({ conversationId: { $in: conversationIds } }).select("_id").lean();
  const candidateTickets = [
    ...new Set(
      [...conversations.map((doc) => doc.binding?.ticketId), ...messages.map((doc) => doc.ticketId)]
        .filter(Boolean)
        .map(String),
    ),
  ];
  // Только заявки, заведённые скриптом: «[DEMO]» в теме
  const tickets = await m.Ticket.find({ _id: { $in: candidateTickets }, title: TAG_RE }).select("_id").lean();
  const ticketIds = tickets.map((doc) => doc._id);
  const comments = await m.Comment.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const ticketReads = await m.TicketRead.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const ticketLogs = await m.TicketLog.find({ ticketId: { $in: ticketIds } }).select("_id").lean();
  const notices = await m.InAppNotification.find({
    $or: [
      { link: { $in: conversationIds.map((id) => `/conversations/${id}`) } },
      { ticketId: { $in: ticketIds } },
    ],
  })
    .select("_id")
    .lean();
  const users = await m.User.find({ email: new RegExp(`@${MAIL_DOMAIN.replace(".", "\\.")}$`) }).select("_id").lean();
  const companies = await m.Company.find({ alias: TAG_RE }).select("_id").lean();
  return {
    InAppNotification: notices,
    TicketRead: ticketReads,
    TicketLog: ticketLogs,
    Comment: comments,
    Message: messages,
    ConversationRead: reads,
    ChannelJob: jobs,
    Conversation: conversations,
    ChannelIdentity: identities,
    Ticket: tickets,
    User: users,
    Company: companies,
    Channel: channels,
  };
};

const remove = async (m) => {
  const found = await collect(m);
  const total = Object.values(found).reduce((sum, list) => sum + list.length, 0);
  if (!total) {
    console.log("Демо-данных нет — удалять нечего.");
    return;
  }
  console.log("Будет удалено:");
  for (const [name, list] of Object.entries(found)) console.log(`  ${name}: ${list.length}`);
  // Порядок — от зависимых к основам; каждое удаление — по списку _id
  for (const [name, list] of Object.entries(found)) {
    if (!list.length) continue;
    await m[name].deleteMany({ _id: { $in: list.map((doc) => doc._id) } });
  }
  console.log("Готово.");
};

const seed = async (m) => {
  const already = await collect(m);
  if (already.Channel.length || already.User.length || already.Company.length) {
    throw new Error("Демо-данные уже есть — сначала `--remove`");
  }

  const { validateEvent } = require("@/services/messaging/events");
  const { ingestEvent } = require("@/services/messaging/ingest");
  const { bindConversation } = require("@/services/messaging/bindings");
  const { sendFromInbox } = require("@/services/messaging/outbound");
  const { leaseJobs, ackJobs } = require("@/services/messaging/jobs");

  const staff = await m.User.findOne({ isEndUser: false, isServiceAccount: { $ne: true }, banned: { $ne: true } })
    .sort({ isAdmin: -1, createdAt: 1 })
    .select("_id firstName lastName")
    .lean();
  if (!staff) throw new Error("Нет сотрудника (isEndUser: false) — ответы из HD писать некому");
  const auth = {
    userId: String(staff._id),
    isAdmin: true,
    isEndUser: false,
    can: () => true,
    legacy: { responsibleForCompanies: [] },
  };

  const ingest = async (raw) => {
    const checked = validateEvent(raw);
    if (!checked.ok) throw new Error(`Событие не прошло проверку: ${checked.error}`);
    const result = await ingestEvent(checked.event);
    if (!result.ok) throw new Error(`Событие не принято: ${result.error}`);
  };
  const say = (channel, chat, message, minutes) =>
    ingest({
      type: "message",
      channelId: String(channel._id),
      at: minutesAgo(minutes).toISOString(),
      chat,
      message: { sentAt: minutesAgo(minutes).toISOString(), kind: "text", ...message },
    });
  const conversationOf = (channel, chat) =>
    m.Conversation.findOne({ channelId: channel._id, externalChatId: chat.id }).lean();

  // Письма и бот о демо-заявке никому не нужны: крон уведомлений берёт только
  // `notifications.pending`, его и гасим после каждого шага
  const quiet = async (ticketId) => {
    await m.Comment.updateMany({ ticketId, "notifications.pending": true }, { $set: { "notifications.pending": false } });
    await m.Ticket.updateOne({ _id: ticketId }, { $set: { "notifications.pending": false } });
  };

  /**
   * Ответ из HD настоящим путём, затем «шлюз»: отправлено → нужный статус.
   * Время ответа сдвигается в прошлое сырым обновлением (демо должно
   * выглядеть как переписка, а не как пачка «только что»).
   */
  const reply = async ({ channel, chat, text, minutes, outcome, externalId }) => {
    const conversation = await conversationOf(channel, chat);
    const sent = await sendFromInbox({ conversationId: conversation._id, text, files: [], auth });
    const when = minutesAgo(minutes);
    await m.Message.collection.updateOne({ _id: sent._id }, { $set: { sentAt: when } });
    if (sent.commentId) await m.Comment.collection.updateOne({ _id: sent.commentId }, { $set: { createdAt: when } });
    await m.Conversation.collection.updateOne(
      { _id: conversation._id, "lastMessage.at": { $gt: when } },
      { $set: { "lastMessage.at": when } },
    );
    // Широкая выдача: в деве могут висеть чужие задания без шлюза
    const batch = await leaseJobs({ networks: [channel.type], limit: 50 });
    const job = batch.jobs.find((item) => String(item.messageId) === String(sent._id));
    if (!job) throw new Error("Задание отправки не выдано");
    if (outcome === "failed") {
      await ackJobs(batch.leaseId, [{ id: String(job._id), ok: false, retryable: false, error: "PEER_FLOOD" }]);
      return;
    }
    await ackJobs(batch.leaseId, [{ id: String(job._id), ok: true, result: { externalId } }]);
    if (outcome === "read") {
      await ingest({ type: "message.status", channelId: String(channel._id), status: "read", jobId: String(job._id) });
    }
  };

  const prefs = await m.Preferences.findOne({}).select("modules.messaging").lean();

  const telegram = await m.Channel.create({
    type: "telegram",
    name: `${TAG} Telegram`,
    state: "connected",
    account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00", username: "f1lab_support" },
    settings: { proxyUrl: "socks5://relay.example.invalid:1080", historyDays: 14 },
    gatewaySeenAt: new Date(),
  });
  const site = await m.Channel.create({
    type: "site",
    name: `${TAG} Форма с сайта`,
    state: "connected",
    settings: { site: { formKey: `${EXT}${Date.now()}` } },
  });
  const company = await m.Company.create({ alias: `${TAG} ТД Восток`, fullTitle: `${TAG} ООО «ТД Восток»` });
  const client = (firstName, lastName, position, key) =>
    m.User.create({
      email: `${key}@${MAIL_DOMAIN}`,
      firstName,
      lastName,
      position,
      isEndUser: true,
      company: { _id: company._id, alias: company.alias },
      // Опознание по Telegram id — как у настоящих клиентов; бот не включён
      telegramBot: { isActive: false, chatId: `${EXT}${key}` },
    });
  const marina = await client("Марина", "Соколова", "Бухгалтер", "marina");
  const oleg = await client("Олег", "Смирнов", "Директор", "oleg");

  const ticket = await m.Ticket.create({
    title: `${TAG} Не печатает принтер в бухгалтерии`,
    description: "<p>Доброе утро! В бухгалтерии опять не печатает принтер, документы висят в очереди.</p>",
    applicantId: marina._id,
    company: { _id: company._id, alias: company.alias },
    responsibles: [{ _id: staff._id, firstName: staff.firstName, lastName: staff.lastName }],
    source: "Telegram",
    state: "В работе",
    deadline: new Date(Date.now() + 6 * 3_600_000),
    createdBy: staff._id,
    updatedBy: staff._id,
    notifications: { lastAction: "new ticket", pending: false },
  });

  // 1. Соколова Марина — личный чат, привязан к заявке, ждёт ответа 12 мин
  const marinaPeer = { id: `${EXT}marina`, firstName: "Марина", lastName: "Соколова", username: "m_sokolova" };
  const marinaChat = { id: `${EXT}chat-marina`, kind: "direct", title: "Марина Соколова", peer: marinaPeer };
  await say(telegram, marinaChat, { id: "m1", direction: "in", sender: marinaPeer, text: "Доброе утро! В бухгалтерии опять не печатает принтер, документы висят в очереди." }, 44);
  await reply({ channel: telegram, chat: marinaChat, text: "Доброе утро, Марина! Сейчас посмотрю — подключусь удалённо.", minutes: 40, outcome: "read", externalId: `${EXT}out-1` });
  await bindConversation({ conversation: await conversationOf(telegram, marinaChat), ticket, by: staff, attachPending: true, eventKind: "ticketCreated" });
  await reply({ channel: telegram, chat: marinaChat, text: "Очередь очистил. Подскажите, какой индикатор горит на самом принтере?", minutes: 37, outcome: "read", externalId: `${EXT}out-2` });
  await say(telegram, marinaChat, {
    id: "m2",
    direction: "in",
    sender: marinaPeer,
    kind: "photo",
    text: "Вот так мигает",
    attachments: [{ status: "skipped", originalName: "IMG_2291.jpg", mimetype: "image/jpeg", size: 1_887_436 }],
  }, 12);
  await say(telegram, marinaChat, {
    id: "m3",
    direction: "in",
    sender: marinaPeer,
    kind: "voice",
    attachments: [{ status: "skipped", mimetype: "audio/ogg", size: 23_000, durationSec: 14 }],
  }, 11);
  await say(telegram, marinaChat, { id: "m4", direction: "in", sender: marinaPeer, text: "Оранжевый мигает. Бумагу вынимали, не помогло.", replyToId: `${EXT}out-2` }, 1);
  const marinaConversation = await conversationOf(telegram, marinaChat);
  await m.Conversation.updateOne({ _id: marinaConversation._id }, { $set: { assigneeId: staff._id } });
  await quiet(ticket._id);

  // 2. Смирнов Олег — опознан, без заявки; наш ответ не доставлен («Повторить»)
  const olegPeer = { id: `${EXT}oleg`, firstName: "Олег", lastName: "Смирнов" };
  const olegChat = { id: `${EXT}chat-oleg`, kind: "direct", title: "Олег Смирнов", peer: olegPeer };
  await say(telegram, olegChat, { id: "o1", direction: "in", sender: olegPeer, text: "Добрый день! Нужен доступ к общей папке для нового бухгалтера." }, 60);
  await reply({ channel: telegram, chat: olegChat, text: "Олег, добрый день! Уточните, пожалуйста, как зовут нового сотрудника.", minutes: 55, outcome: "failed" });
  await say(telegram, olegChat, { id: "o2", direction: "in", sender: olegPeer, text: "Коллеги, в 14:00 у нас встреча с партнёрами — успеете?" }, 23);
  await say(telegram, olegChat, { id: "o3", direction: "in", sender: olegPeer, text: "Есть кто живой?" }, 9);

  // 3. Андрей — неизвестный собеседник: «Кто это?»
  const andreyPeer = { id: `${EXT}andrey`, firstName: "Андрей", username: "andrey_primavto" };
  const andreyChat = { id: `${EXT}chat-andrey`, kind: "direct", title: "Андрей", peer: andreyPeer };
  await say(telegram, andreyChat, { id: "a1", direction: "in", sender: andreyPeer, text: "Здравствуйте! У нас в офисе на Алеутской, 45 с утра не работает интернет." }, 37);
  await say(telegram, andreyChat, { id: "a2", direction: "in", sender: andreyPeer, text: "Это Андрей, Примавто. Роутер перезагружали, не помогло." }, 36);

  // 4. Белов Сергей — вчерашний, ответили с телефона: не ждёт
  const belovPeer = { id: `${EXT}belov`, firstName: "Сергей", lastName: "Белов" };
  const belovChat = { id: `${EXT}chat-belov`, kind: "direct", title: "Сергей Белов", peer: belovPeer };
  await say(telegram, belovChat, { id: "b1", direction: "in", sender: belovPeer, text: "Когда приедет инженер?" }, 26 * 60);
  await say(telegram, belovChat, { id: "b2", direction: "out", text: "Завтра в 10 приедет инженер" }, 25 * 60);

  // 5. Группа — должна просто показываться (выбор сообщений — этап P2)
  const kostya = { id: `${EXT}kostya`, firstName: "Костя", username: "kostya_it" };
  const groupChat = {
    id: `${EXT}chat-group`,
    kind: "group",
    title: `${TAG} ТД Восток × F1Lab`,
    participants: [olegPeer, kostya],
  };
  await say(telegram, groupChat, { id: "g1", direction: "in", sender: olegPeer, text: "В переговорной не работает HDMI — проектор пишет «нет сигнала»" }, 31);
  await say(telegram, groupChat, { id: "g2", direction: "in", sender: kostya, text: "Кабель я проверял, он целый" }, 30);

  // 6. Форма сайта — должна просто показываться (карточка формы — этап P5)
  const formPerson = { id: `${EXT}form-1`, name: "Кравцова Елена" };
  await say(site, { id: `${EXT}form-1`, kind: "form", title: "Кравцова Елена", peer: formPerson }, {
    id: "f1",
    direction: "in",
    origin: "form",
    kind: "form",
    sender: formPerson,
    form: {
      fields: [
        { label: "Имя", value: "Кравцова Елена" },
        { label: "Компания", value: "ООО «Северный порт»" },
        { label: "Сообщение", value: "Нужна абонентская поддержка для 12 компьютеров и сервера 1С." },
      ],
    },
  }, 59);

  await quiet(ticket._id);

  const created = await collect(m);
  console.log("Демо «Диалогов» создано:");
  for (const [name, list] of Object.entries(created)) if (list.length) console.log(`  ${name}: ${list.length}`);
  console.log(`Автор ответов из HD: ${staff.lastName} ${staff.firstName}`);
  if (!prefs?.modules?.messaging?.isActive) {
    console.log("Модуль «Диалоги» выключен — включите его: Настройки системы → Модули → «Диалоги».");
  }
  console.log("Убрать всё демо: node scripts/seedDemoConversations.js --remove");
};

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const m = models();
  try {
    if (process.argv.includes("--remove")) await remove(m);
    else await seed(m);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check scripts/seedDemoConversations.js && echo OK`
Expected: `OK`

Do not run the script here — the owner runs it on the dev stack during the live check (Task 14, step 5). It is never added to `migrate.js`.

- [ ] **Step 3: Checkpoint** — no commit, no staging.

---

## Task 4: Frontend foundation — tokens, primitives, API types

Everything later tasks draw with: the brand tokens and bubble colours, the channel glyph, the count pill, the QR primitive, three small prop extensions of catalog primitives, the API row types, the display time zone for pure helpers and the module default.

**Files:**
- Modify: `frontend/src/styles/tailwind.css` (tokens, both themes, `@theme inline` mappings)
- Modify: `frontend/src/components/app/FilterChip.tsx` (`dot`)
- Modify: `frontend/src/components/app/SettingRow.tsx` (`leadingClassName`)
- Modify: `frontend/src/components/app/Combobox.tsx` (`leading`, single-select only)
- Modify: `frontend/src/util/format-date.js` (`displayTimeZone`)
- Modify: `frontend/src/store/prefs.js` (`modules.messaging` default)
- Create: `frontend/src/types/conversation.ts`
- Create: `frontend/src/components/Conversation/ChannelGlyph.tsx`
- Create: `frontend/src/components/app/CountPill.tsx`
- Create: `frontend/src/components/app/QrCode.tsx`

**Interfaces:**
- Consumes: `cn` (`@/lib/utils`), `qr-code-styling` (already a dependency — `User/TwoFactorSetup` uses it), `react-icons/ri`.
- Produces:
  - Tailwind colours: `text-channel-{telegram,whatsapp,max}`, `bg-channel-{telegram,whatsapp,max}-tint`, `bg-bubble-in`, `bg-bubble-out`, `bg-media-placeholder`, `text-media-placeholder-fg`, `bg-voice-wave`.
  - `ChannelGlyph.tsx`: `type ChannelKey = "telegram" | "whatsapp" | "max" | "site" | "mail" | "phone" | "group"`; `ChannelIcon({ network: string; size?: number /*16*/; className?: string })`; `ChannelTile({ network: string; iconSize?: number /*20*/; neutralClassName?: string /*"bg-accent text-muted-foreground"*/; className?: string })`; `channelTextClass(key: string): string`; `isBrandChannel(key: string): boolean`.
  - `CountPill({ children: ReactNode; className?: string })` (default export).
  - `QrCode({ data: string; size?: number /*168*/; className?: string })` (default export).
  - `FilterChip` prop `dot?: "default" | "warning" | "none"`; `SettingRow` prop `leadingClassName?: string`; `Combobox` prop `leading?: ReactNode`.
  - `displayTimeZone(): string` from `util/format-date.js`.
  - `useInitialPrefsStore` default `modules.messaging = { isActive: false }`.
  - `types/conversation.ts`: `Network`, `ConversationKind`, `ConversationQueue`, `ConversationRow`, `QueueCounts`, `ConversationListResponse`, `AttachmentStatus`, `MessageAttachment`, `MessageStatus`, `MessageRow`, `MessagesPage`, `MessagesChanges`, `ConversationPerson`, `ConversationCard` (with `ticket.boundAt`), `TicketDraft`, `DeliveryRoute`, `DeliveryRoutes`, `IdentityCandidate`, `ChannelState`, `MessagingChannel`, `ChannelJobView`, `CommentChannel` — shapes of `docs/messaging.md` §7 and Task 1.

- [ ] **Step 1: Tokens**

Values are the canvas' (see «Canvas reference»). The dark block is the existing `.dark` selector.

`frontend/src/styles/tailwind.css`:

```diff
--- a/frontend/src/styles/tailwind.css
+++ b/frontend/src/styles/tailwind.css
@@ -80,6 +80,22 @@
      «не указан», иначе вечером табло сливается в серое пятно */
   --ws-st-offshift: #5c6b7a;
   --ws-st-unset: #868e96;
+  /* «Диалоги»: фирменные цвета каналов — глиф и его подложка (решение
+     владельца 24.09, спека «Channel brand colours»). Сайт и почта —
+     нейтральные, своих токенов у них нет. */
+  --channel-telegram: #1b86ba;
+  --channel-telegram-tint: rgba(34, 158, 217, 0.14);
+  --channel-whatsapp: #128c46;
+  --channel-whatsapp-tint: rgba(37, 211, 102, 0.16);
+  --channel-max: #5a43d4;
+  --channel-max-tint: rgba(112, 86, 240, 0.14);
+  /* Пузыри переписки: входящий — серый, наш — бирюзовый (канва A1) */
+  --bubble-in: #f2f4f5;
+  --bubble-out: rgba(0, 188, 140, 0.13);
+  /* Заглушка фото, пока файл не загружен, и полосы голосового */
+  --media-placeholder: #dfe3e6;
+  --media-placeholder-fg: #7f8a93;
+  --voice-wave: #c3c9ce;
 }
 
 .dark {
@@ -127,6 +143,17 @@
   --ws-st-sick: #ff6b6b;
   --ws-st-offshift: #8b9aa8;
   --ws-st-unset: #7d8790;
+  --channel-telegram: #56b8ee;
+  --channel-telegram-tint: rgba(42, 171, 238, 0.18);
+  --channel-whatsapp: #3fd07f;
+  --channel-whatsapp-tint: rgba(37, 211, 102, 0.16);
+  --channel-max: #a594ff;
+  --channel-max-tint: rgba(130, 110, 255, 0.2);
+  --bubble-in: #272b31;
+  --bubble-out: rgba(0, 188, 140, 0.17);
+  --media-placeholder: #2c3137;
+  --media-placeholder-fg: #838c95;
+  --voice-wave: #4a5057;
 }
 
 @theme inline {
@@ -173,6 +200,17 @@
   --color-chart-3: var(--chart-3);
   --color-chart-4: var(--chart-4);
   --color-chart-5: var(--chart-5);
+  --color-channel-telegram: var(--channel-telegram);
+  --color-channel-telegram-tint: var(--channel-telegram-tint);
+  --color-channel-whatsapp: var(--channel-whatsapp);
+  --color-channel-whatsapp-tint: var(--channel-whatsapp-tint);
+  --color-channel-max: var(--channel-max);
+  --color-channel-max-tint: var(--channel-max-tint);
+  --color-bubble-in: var(--bubble-in);
+  --color-bubble-out: var(--bubble-out);
+  --color-media-placeholder: var(--media-placeholder);
+  --color-media-placeholder-fg: var(--media-placeholder-fg);
+  --color-voice-wave: var(--voice-wave);
   /* Аватар присутствия: своя пара тонов — от --accent/--muted-foreground она
      отличается намеренно (аватар стоит на карточке и должен от неё
      отделяться). Токены, а не произвольные значения в утилите. */
```

- [ ] **Step 2: API types**

`frontend/src/types/conversation.ts` (new file):

```ts
/**
 * «Диалоги» — формы ответов API так, как их отдаёт бэкенд
 * (backend/services/messaging/present.js, controllers/conversation.js,
 * controllers/channel.js, services/messaging/origin.js). Контракт —
 * docs/messaging.md, «Staff API».
 */

export type Network = "telegram" | "whatsapp" | "max" | "site";
export type ConversationKind = "direct" | "group" | "form";
export type ConversationQueue = "awaiting" | "mine" | "unbound" | "all" | "hidden";

/** Строка списка — `conversationRow`. */
export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  network: Network;
  title: string;
  /** Личный чат или форма без связанного пользователя. */
  unknown: boolean;
  company: { id: string; alias: string } | null;
  lastMessage: {
    at: string;
    direction: "in" | "out" | "system";
    origin: string;
    preview: string;
    authorName: string;
  } | null;
  awaitingSince: string | null;
  unread: number;
  ticket: { id: string; num: number } | null;
  decision: { ticketId: string; ticketNum: number } | null;
  assignee: { id: string; name: string } | null;
  hidden: boolean;
};

export type QueueCounts = {
  awaiting: number;
  mine: number;
  unbound: number;
  all: number;
};

export type ConversationListResponse = {
  items: ConversationRow[];
  counts: QueueCounts;
  nextBefore: string | null;
};

export type AttachmentStatus = "ready" | "pending" | "skipped" | "failed";

export type MessageAttachment = {
  name: string;
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: AttachmentStatus;
};

export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/** Сообщение ленты — `messageRow`. */
export type MessageRow = {
  id: string;
  seq: number;
  direction: "in" | "out" | "system";
  origin: string;
  kind: string;
  text: string;
  form: { fields: { label: string; value: string }[] } | null;
  sentAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: { name: string; userId: string | null; isStaff: boolean };
  attachments: MessageAttachment[];
  replyTo: { id: string; authorName: string; text: string } | null;
  status: MessageStatus;
  error: string;
  ticket: { id: string; num: number } | null;
  attachMode: string | null;
  suggestTicketId: string | null;
  event: {
    kind: string;
    ticketNum: number | null;
    byName: string;
    targetName: string;
    count: number | null;
  } | null;
};

/** Страница ленты: при открытии и по «Показать раньше». */
export type MessagesPage = { items: MessageRow[]; serverTime: string };

/** Ответ опроса `changedSince`. */
export type MessagesChanges = {
  items: MessageRow[];
  serverTime: string;
  hasMore: boolean;
  afterId?: string;
};

export type ConversationPerson = {
  identityId: string;
  name: string;
  username: string;
  phone: string;
  userId: string | null;
  linkMethod: string | null;
  isStaff: boolean;
};

/** Карточка диалога — `GET /api/conversations/:id`. */
export type ConversationCard = {
  conversation: ConversationRow;
  channel: {
    id: string;
    type: Network;
    name: string;
    state: string;
    isActive: boolean;
  } | null;
  counterpart: ConversationPerson | null;
  participants: ConversationPerson[];
  contact: {
    id: string;
    name: string;
    position: string;
    company: string;
    phone: string;
    email: string;
  } | null;
  otherChannels: {
    network: Network;
    handle: string;
    conversationId: string | null;
  }[];
  ticket: {
    id: string;
    num: number;
    title: string;
    state: string;
    deadline: string | null;
    responsibles: string[];
    boundAt: string | null;
  } | null;
  openTickets: {
    id: string;
    num: number;
    title: string;
    state: string;
    deadline: string | null;
  }[];
};

/** Черновик формы заявки — `GET /api/conversations/:id/ticket-draft`. */
export type TicketDraft = {
  description: string;
  applicantId: string | null;
  companyId: string | null;
  source: string;
  attachments: number;
};

/** Маршрут «Ответить через» — `GET /api/tickets/:num/delivery-routes`. */
export type DeliveryRoute = {
  conversationId: string;
  network: Network;
  kind: ConversationKind;
  title: string;
  available: boolean;
  reason: string | null;
  boundHere: boolean;
};

export type DeliveryRoutes = {
  routes: DeliveryRoute[];
  /** id диалога или `"notify"` — «Почта и бот HD, как сейчас». */
  defaultRoute: string;
  applicantName: string;
};

/** Кандидат «Это он» — `GET /api/identities/:id/candidates`. */
export type IdentityCandidate = {
  id: string;
  name: string;
  position: string;
  company: string;
};

export type ChannelState =
  | "disconnected"
  | "connecting"
  | "awaitingQr"
  | "awaitingCode"
  | "awaitingPassword"
  | "connected"
  | "loggedOut"
  | "banned"
  | "error";

/** Канал в настройках — `publicChannel` (секреты только признаком «задан»). */
export type MessagingChannel = {
  id: string;
  type: Network;
  name: string;
  isActive: boolean;
  state: ChannelState;
  stateReason: string;
  account: {
    externalId?: string;
    displayName?: string;
    username?: string;
    phone?: string;
  };
  login: { qr: string | null; expiresAt: string | null };
  gatewaySeenAt: string | null;
  lastMessageAt: string | null;
  settings: {
    proxyUrl?: string;
    historyDays?: number;
    importGroups?: boolean;
    markReadOnOpen?: boolean;
    signReplies?: boolean;
    maxMediaMb?: number;
  };
  secrets: Record<
    "tgApiId" | "tgApiHash" | "proxyPassword" | "maxToken" | "maxWebhookSecret",
    boolean
  >;
  serviceUserId: string | null;
};

/** Итог команды шлюзу — `GET /api/channels/:id/jobs/:jobId`. */
export type ChannelJobView = {
  id: string;
  type: string;
  state: "pending" | "done" | "failed" | "cancelled";
  error: string;
  result: unknown;
  finishedAt: string | null;
};

/** Блок `channel` комментария-зеркала (backend/services/messaging/present.js). */
export type CommentChannel = {
  network: Network;
  conversationId: string;
  messageId?: string;
  direction: "in" | "out";
  authorName?: string;
  status?: "preparing" | MessageStatus;
  statusAt?: string;
  error?: string;
};
```

- [ ] **Step 3: Channel glyph**

Brand colour only on the glyph and its tile (owner's decision; spec «Channel brand colours»). Remix has no MAX logo — `RiMessage3Line`.

`frontend/src/components/Conversation/ChannelGlyph.tsx` (new file):

```tsx
import type { IconType } from "react-icons";
import {
  RiChat3Line,
  RiGlobalLine,
  RiGroupLine,
  RiMailLine,
  RiMessage3Line,
  RiPhoneLine,
  RiTelegram2Line,
  RiWhatsappLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

/**
 * Глиф канала «Диалогов». Цвет — фирменный у мессенджеров (решение владельца
 * 24.09, спека «Channel brand colours»): Telegram, WhatsApp, MAX; форма сайта,
 * почта и телефон — нейтральные. Токены — `--channel-*` в styles/tailwind.css,
 * обе темы.
 */
export type ChannelKey =
  | "telegram"
  | "whatsapp"
  | "max"
  | "site"
  | "mail"
  | "phone"
  | "group";

const ICONS: Record<ChannelKey, IconType> = {
  telegram: RiTelegram2Line,
  whatsapp: RiWhatsappLine,
  // У MAX нет значка в наборе Remix — пузырь сообщения
  max: RiMessage3Line,
  site: RiGlobalLine,
  mail: RiMailLine,
  phone: RiPhoneLine,
  group: RiGroupLine,
};

const BRAND_TEXT: Partial<Record<ChannelKey, string>> = {
  telegram: "text-channel-telegram",
  whatsapp: "text-channel-whatsapp",
  max: "text-channel-max",
};

const BRAND_TILE: Partial<Record<ChannelKey, string>> = {
  telegram: "bg-channel-telegram-tint text-channel-telegram",
  whatsapp: "bg-channel-whatsapp-tint text-channel-whatsapp",
  max: "bg-channel-max-tint text-channel-max",
};

/** Фирменный цвет текста глифа; у нейтральных каналов — пусто (цвет наследуется). */
export const channelTextClass = (key: string): string =>
  BRAND_TEXT[key as ChannelKey] ?? "";

/** Есть ли у канала фирменный цвет. */
export const isBrandChannel = (key: string): boolean =>
  Boolean(BRAND_TILE[key as ChannelKey]);

/** Глиф канала фирменным цветом (метки хроники, шапка диалога, меню ответа). */
export const ChannelIcon = ({
  network,
  size = 16,
  className,
}: {
  network: string;
  size?: number;
  className?: string;
}) => {
  const Icon = ICONS[network as ChannelKey] ?? RiChat3Line;
  return (
    <Icon
      size={size}
      aria-hidden
      className={cn("flex-none", channelTextClass(network), className)}
    />
  );
};

/**
 * Плитка канала: фирменная подложка у мессенджеров, `neutralClassName` — у
 * остальных (строка списка — `bg-accent text-muted-foreground`, строка
 * контакта — `bg-primary/15 text-accent-text`). Размер и скругление — через
 * `className`.
 */
export const ChannelTile = ({
  network,
  iconSize = 20,
  neutralClassName = "bg-accent text-muted-foreground",
  className,
}: {
  network: string;
  iconSize?: number;
  neutralClassName?: string;
  className?: string;
}) => {
  const Icon = ICONS[network as ChannelKey] ?? RiChat3Line;
  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center",
        BRAND_TILE[network as ChannelKey] ?? neutralClassName,
        className,
      )}
    >
      <Icon size={iconSize} />
    </span>
  );
};
```

- [ ] **Step 4: `CountPill` and `QrCode`**

`frontend/src/components/app/CountPill.tsx` (new file):

```tsx
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Число-пилюля: непрочитанное в строке «Диалогов», счётчик «Ждут ответа» у
 * пункта меню «Диалоги». Бирюзовая подложка и читаемая бирюза текста — тот же
 * язык, что у включённого чипа (канва «Омниканальные диалоги», A1).
 */
const CountPill = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-md bg-primary/15 px-1.5 text-xs font-semibold text-accent-text tabular-nums",
      className,
    )}
  >
    {children}
  </span>
);

export default CountPill;
```

`frontend/src/components/app/QrCode.tsx` (new file):

```tsx
import { useEffect, useRef } from "react";

import QRCodeStyling from "qr-code-styling";

import { cn } from "@/lib/utils";

/** QR рисуется во внутреннем высоком разрешении — иначе модули округляются. */
const RES = 1024;

/**
 * QR-код для сканирования телефоном: вход в корпоративный аккаунт мессенджера
 * («Каналы связи»). Тёмные модули на белом в обеих темах — сканеры спотыкаются
 * о тёмный код на тёмном фоне; стиль модулей — как у QR второго фактора
 * (`User/TwoFactorSetup`).
 */
const QrCode = ({
  data,
  size = 168,
  className,
}: {
  /** Строка кода — как пришла от сервера (`tg://login?token=…`). */
  data: string;
  size?: number;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !data) return undefined;
    node.replaceChildren();
    const qr = new QRCodeStyling({
      width: RES,
      height: RES,
      type: "svg",
      data,
      margin: 0,
      qrOptions: { errorCorrectionLevel: "M" },
      backgroundOptions: { color: "#ffffff" },
      dotsOptions: { type: "rounded", color: "#14253a" },
      cornersSquareOptions: { type: "extra-rounded", color: "#14253a" },
      cornersDotOptions: { type: "dot", color: "#2a4a6e" },
    });
    qr.append(node);
    const svg = node.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${RES} ${RES}`);
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
    return () => node.replaceChildren();
  }, [data, size]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="QR-код для входа"
      className={cn("leading-none", className)}
      style={{ width: size, height: size }}
    />
  );
};

export default QrCode;
```

- [ ] **Step 5: Primitive extensions**

`FilterChip`: the «Ждут ответа» chip carries an amber dot whether it is on or off; the other queue chips have none (canvas A1).

`frontend/src/components/app/FilterChip.tsx`:

```diff
--- a/frontend/src/components/app/FilterChip.tsx
+++ b/frontend/src/components/app/FilterChip.tsx
@@ -6,6 +6,8 @@
 // во включённом состоянии — бирюзовая подложка. `size="sm"` — компактный
 // (28 px, 12-й кегль) для рядов внутри панелей: поповер уведомлений.
 // `count` — число рядом с подписью (непрочитанные вида), без него ничего.
+// `dot` — точка-индикатор: `default` (бирюза у включённого), `warning` —
+// янтарная всегда (очередь «Ждут ответа» в «Диалогах»), `none` — без точки.
 const FilterChip = ({
   active = false,
   onClick,
@@ -13,6 +15,7 @@
   className,
   size = "md",
   count,
+  dot = "default",
 }: {
   active?: boolean;
   onClick?: () => void;
@@ -20,6 +23,7 @@
   className?: string;
   size?: "md" | "sm";
   count?: number | null;
+  dot?: "default" | "warning" | "none";
 }) => {
   return (
     <button
@@ -34,10 +38,19 @@
         className,
       )}
     >
-      <span
-        aria-hidden
-        className={cn("size-1.5 rounded-full bg-faint", active && "bg-primary")}
-      />
+      {dot !== "none" && (
+        <span
+          aria-hidden
+          className={cn(
+            "size-1.5 rounded-full",
+            dot === "warning"
+              ? "bg-warning"
+              : active
+                ? "bg-primary"
+                : "bg-faint",
+          )}
+        />
+      )}
       {children}
       {count != null && count > 0 && (
         <span
```

`SettingRow`: the channel row's leading tile takes the channel tint.

`frontend/src/components/app/SettingRow.tsx`:

```diff
--- a/frontend/src/components/app/SettingRow.tsx
+++ b/frontend/src/components/app/SettingRow.tsx
@@ -12,6 +12,7 @@
   title,
   hint,
   leading,
+  leadingClassName,
   htmlFor,
   divider = false,
   className,
@@ -21,6 +22,11 @@
   hint?: ReactNode;
   /** Плитка-иконка слева (например, логотип интеграции). */
   leading?: ReactNode;
+  /**
+   * Цвет плитки вместо нейтрального: фирменный тон канала в «Каналах связи»
+   * (`bg-channel-telegram-tint text-channel-telegram inset-ring-transparent`).
+   */
+  leadingClassName?: string;
   /** id контрола строки — название становится `<label htmlFor>`. */
   htmlFor?: string;
   /** Тонкая линия сверху — между соседними строками. */
@@ -40,7 +46,10 @@
       {leading && (
         <span
           aria-hidden
-          className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border max-md:hidden"
+          className={cn(
+            "grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border max-md:hidden",
+            leadingClassName,
+          )}
         >
           {leading}
         </span>
```

`Combobox`: the «Ответственный за диалог» field shows the chosen person's presence avatar before the name. Only the single-select `Combobox` gets the prop — `MultiCombobox` is untouched.

`frontend/src/components/app/Combobox.tsx`:

```diff
--- a/frontend/src/components/app/Combobox.tsx
+++ b/frontend/src/components/app/Combobox.tsx
@@ -1,4 +1,10 @@
-import { useEffect, useRef, useState, type RefObject } from "react";
+import {
+  useEffect,
+  useRef,
+  useState,
+  type ReactNode,
+  type RefObject,
+} from "react";
 
 import {
   RiArrowDownSLine,
@@ -176,6 +182,7 @@
   required = false,
   name,
   ariaLabel,
+  leading,
   className,
 }: {
   id?: string;
@@ -198,6 +205,11 @@
   name?: string;
   /** Подпись для скринридера, когда видимого лейбла у поля нет. */
   ariaLabel?: string;
+  /**
+   * Перед подписью в поле: аватар выбранного человека («Ответственный за
+   * диалог»). Список опций он не меняет.
+   */
+  leading?: ReactNode;
   className?: string;
 }) => {
   const [open, setOpen] = useState(false);
@@ -246,6 +258,7 @@
               className,
             )}
           >
+            {leading}
             <span
               className={cn(
                 "min-w-0 flex-1 truncate",
```

- [ ] **Step 6: Display time zone and the module default**

Pure helpers (Tasks 5–6) cannot import `util/format-date.js` in `node --test` (it reads `localStorage` through `util/auth`), so components pass the zone in.

`frontend/src/util/format-date.js`:

```diff
--- a/frontend/src/util/format-date.js
+++ b/frontend/src/util/format-date.js
@@ -17,6 +17,13 @@
   return data.personalTimezone || data.timezone || DEFAULT_TIMEZONE;
 };
 
+/**
+ * Пояс показа — для чистых хелперов, которые форматируют сами и потому берут
+ * пояс параметром (util/conversation-format: этот модуль в node --test не
+ * грузится — он читает localStorage).
+ */
+export const displayTimeZone = () => tz();
+
 // Пустое значение — не дата: `new Date(null)` даёт эпоху, и в карточку попадает
 // «01.01.1970», а `new Date(undefined)` — «Invalid Date». Поэтому все хелперы
 // отображения возвращают null, а вызывающий сам решает, что показать вместо
```

`frontend/src/store/prefs.js`:

```diff
--- a/frontend/src/store/prefs.js
+++ b/frontend/src/store/prefs.js
@@ -29,6 +29,7 @@
     timeTracking: { isActive: false },
     knowledgeBase: { isActive: false },
     mikrotik: { isActive: false },
+    messaging: { isActive: false },
   },
   // Функции ИИ приходят из /api/me уже сведёнными с главным рубильником
   // (backend/services/ai/features.js): компонент читает одно булево
```

- [ ] **Step 7: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/types/conversation.ts src/components/Conversation/ChannelGlyph.tsx src/components/app/CountPill.tsx src/components/app/QrCode.tsx src/components/app/FilterChip.tsx src/components/app/SettingRow.tsx src/components/app/Combobox.tsx src/util/format-date.js src/store/prefs.js --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep "error TS"`
Expected: exactly the three baseline lines —
```
src/components/app/FormWrapper.tsx(100,32): error TS2345: …
src/pages/Finances/ApprovalReport.tsx(146,28): error TS2554: …
src/pages/Finances/ApprovalReport.tsx(166,26): error TS2554: …
```

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s` (the pre-existing "Some chunks are larger than 1000 kB after minification" warning above it is fine).

- [ ] **Step 8: Checkpoint** — no commit, no staging. Nothing is visible in the app yet.

---

## Task 5: `conversation-format` helpers (TDD)

Every visible string and time label of the inbox, in one pure module: queue meta, «ждёт 12 мин», list times, day labels, «Вы:» / «с телефона:» prefixes, row meta (including group and form rows), empty-list texts, impersonal system lines, file sizes, voice durations, composer texts.

**Files:**
- Create: `frontend/src/util/conversation-format.js`
- Test: `frontend/src/util/conversation-format.test.js`

**Interfaces:**
- Consumes: `plural(n, one, few, many)` from `util/plural.js` (imported as `./plural.js`).
- Produces (all named exports; `TimeOptions = { now?: Date; timeZone?: string }`, `LinePart = { text?: string; ticket?: number }`):
  - `NETWORK_LABEL: Record<"telegram"|"whatsapp"|"max"|"site", string>`; `networkLabel(network) → string` («Мессенджер» for unknown)
  - `QUEUES: { value: "awaiting"|"mine"|"unbound"|"all"; label: string; dot: "warning"|"none" }[]`; `QUEUE_VALUES: string[]`
  - `waitLabel(since, now?) → "12 мин" | "1 ч 14 мин" | "1 д 1 ч"`; `timeOf(date, timeZone) → "10:42"`
  - `listTimeLabel(at, TimeOptions?) → "10:42" | "вчера" | "пн" | "12.09"`; `dayLabel(at, TimeOptions?) → "Сегодня" | "Вчера" | "27 июля"`
  - `lastMessagePrefix(lastMessage, { kind?, myName? }?) → "Вы" | "с телефона" | author | ""`
  - `unknownLabel(network) → "неизвестный номер" | "неизвестный контакт"`
  - `rowMeta(row) → { text: string; tone: "muted" | "faint" }[]`
  - `emptyListText({ queue?, hidden?, q? }?) → string`
  - `shortPersonName(name) → "Соколова М."`; `splitPersonName(name) → { firstName, lastName }`
  - `boundSinceLabel(boundAt, TimeOptions?) → "привязана с 10:03" | "привязана с 12.09"`
  - `systemLineParts(event, { compact? }?) → LinePart[]`
  - `formatFileSize(bytes) → "1,8 МБ" | "240 КБ" | ""`; `voiceDuration(seconds) → "0:14"`; `attachmentKindLabel(kind) → "Фото" | "Голосовое" | … | "Файл"`
  - `counterpartHandle(person) → "@m_sokolova" | phone | ""`
  - `newCounterpartNote(network)`, `linkAdvice(network)`, `composerPlaceholder(network, ticketNum?)`, `phoneComposerHint(network, ticketNum?)` → strings

- [ ] **Step 1: Write the failing test**

`frontend/src/util/conversation-format.test.js` (new file):

```js
// node --test src/util/conversation-format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boundSinceLabel,
  composerPlaceholder,
  counterpartHandle,
  dayLabel,
  emptyListText,
  formatFileSize,
  lastMessagePrefix,
  linkAdvice,
  listTimeLabel,
  networkLabel,
  newCounterpartNote,
  phoneComposerHint,
  QUEUES,
  rowMeta,
  shortPersonName,
  splitPersonName,
  systemLineParts,
  voiceDuration,
  waitLabel,
} from "./conversation-format.js";

const tz = "Europe/Moscow";
// 25.09.2026 11:00 по Москве
const now = new Date("2026-09-25T08:00:00Z");

test("очереди — в порядке канвы, точка только у «Ждут ответа»", () => {
  assert.deepEqual(
    QUEUES.map((queue) => queue.label),
    ["Ждут ответа", "Мои", "Без заявки", "Все"],
  );
  assert.deepEqual(
    QUEUES.map((queue) => queue.dot),
    ["warning", "none", "none", "none"],
  );
});

test("waitLabel: минуты, часы с минутами, сутки с часами", () => {
  assert.equal(waitLabel(new Date(now.getTime() - 12 * 60_000), now), "12 мин");
  assert.equal(waitLabel(new Date(now.getTime() - 74 * 60_000), now), "1 ч 14 мин");
  assert.equal(waitLabel(new Date(now.getTime() - 60 * 60_000), now), "1 ч");
  assert.equal(waitLabel(new Date(now.getTime() - 25 * 3_600_000), now), "1 д 1 ч");
  assert.equal(waitLabel(new Date(now.getTime() - 30_000), now), "1 мин");
  assert.equal(waitLabel(null, now), "");
});

test("listTimeLabel: сегодня — время, вчера — слово, неделя — день, раньше — дата", () => {
  assert.equal(listTimeLabel("2026-09-25T07:42:00Z", { now, timeZone: tz }), "10:42");
  assert.equal(listTimeLabel("2026-09-24T07:42:00Z", { now, timeZone: tz }), "вчера");
  assert.equal(listTimeLabel("2026-09-21T09:00:00Z", { now, timeZone: tz }), "пн");
  assert.equal(listTimeLabel("2026-09-12T07:42:00Z", { now, timeZone: tz }), "12.09");
  assert.equal(listTimeLabel(null, { now, timeZone: tz }), "");
});

test("dayLabel: «Сегодня», «Вчера», «27 июля»", () => {
  assert.equal(dayLabel("2026-09-25T06:58:00Z", { now, timeZone: tz }), "Сегодня");
  assert.equal(dayLabel("2026-09-24T06:58:00Z", { now, timeZone: tz }), "Вчера");
  assert.equal(dayLabel("2026-07-27T06:58:00Z", { now, timeZone: tz }), "27 июля");
});

test("lastMessagePrefix: «Вы», «с телефона», коллега, автор в группе", () => {
  const myName = "Лебедев Игорь";
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "hd", authorName: "Лебедев Игорь" }, { kind: "direct", myName }),
    "Вы",
  );
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "hd", authorName: "Орлова Анна" }, { kind: "direct", myName }),
    "Орлова Анна",
  );
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "device", authorName: "F1Lab Поддержка · с телефона" }, { kind: "direct", myName }),
    "с телефона",
  );
  assert.equal(
    lastMessagePrefix({ direction: "in", origin: "client", authorName: "Смирнов Олег" }, { kind: "group", myName }),
    "Смирнов Олег",
  );
  assert.equal(
    lastMessagePrefix({ direction: "in", origin: "client", authorName: "Соколова Марина" }, { kind: "direct", myName }),
    "",
  );
  assert.equal(lastMessagePrefix(null, { kind: "direct", myName }), "");
});

test("rowMeta: заявка, «без заявки», неизвестный собеседник, форма", () => {
  const company = { id: "c1", alias: "ТД Восток" };
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "telegram", company, ticket: { num: 56812 }, unknown: false }),
    [
      { text: "ТД Восток", tone: "muted" },
      { text: "№56812", tone: "muted" },
    ],
  );
  assert.deepEqual(
    rowMeta({ kind: "group", network: "telegram", company, ticket: null, unknown: false }),
    [
      { text: "ТД Восток", tone: "muted" },
      { text: "без заявки", tone: "faint" },
    ],
  );
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "telegram", company: null, ticket: null, unknown: true }),
    [{ text: "неизвестный контакт", tone: "faint" }],
  );
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "whatsapp", company: null, ticket: null, unknown: true }),
    [{ text: "неизвестный номер", tone: "faint" }],
  );
  // Форма сайта: вместо компании — «Форма с сайта», неопознанность не выпячиваем
  assert.deepEqual(
    rowMeta({ kind: "form", network: "site", company: null, ticket: null, unknown: true }),
    [
      { text: "Форма с сайта", tone: "muted" },
      { text: "без заявки", tone: "faint" },
    ],
  );
});

test("emptyListText: поиск сильнее очереди, скрытые — своя фраза", () => {
  assert.equal(emptyListText({ queue: "awaiting" }), "Никто не ждёт ответа");
  assert.equal(emptyListText({ queue: "mine" }), "Ваших диалогов нет");
  assert.equal(emptyListText({ queue: "all", hidden: true }), "Скрытых диалогов нет");
  assert.equal(emptyListText({ queue: "awaiting", q: "принтер" }), "Ничего не нашлось");
});

test("имена: короткое для кнопки и разбор для формы пользователя", () => {
  assert.equal(shortPersonName("Соколова Марина"), "Соколова М.");
  assert.equal(shortPersonName("Андрей"), "Андрей");
  assert.equal(shortPersonName(""), "");
  assert.deepEqual(splitPersonName("Андрей Кузнецов"), { firstName: "Андрей", lastName: "Кузнецов" });
  assert.deepEqual(splitPersonName("Андрей"), { firstName: "Андрей", lastName: "" });
  assert.deepEqual(splitPersonName("  "), { firstName: "", lastName: "" });
});

test("boundSinceLabel: сегодня — время, раньше — дата", () => {
  assert.equal(boundSinceLabel("2026-09-25T07:03:00Z", { now, timeZone: tz }), "привязана с 10:03");
  assert.equal(boundSinceLabel("2026-09-12T07:03:00Z", { now, timeZone: tz }), "привязана с 12.09");
  assert.equal(boundSinceLabel(null, { now, timeZone: tz }), "");
});

test("systemLineParts: безлично, с номером заявки отдельной частью", () => {
  const created = { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь" };
  assert.deepEqual(systemLineParts(created), [
    { text: "Создана заявка " },
    { ticket: 56812 },
    { text: " — дальше переписка идёт в неё · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts(created, { compact: true }), [
    { text: "Создана заявка " },
    { ticket: 56812 },
    { text: " — переписка идёт в неё" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "handled", byName: "Лебедев Игорь" }), [
    { text: "Ответ не нужен · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "assigned", targetName: "Орлова Анна", byName: "Лебедев Игорь" }), [
    { text: "Ответственный за диалог — Орлова Анна · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "assigned", targetName: "", byName: "" }), [
    { text: "Ответственный за диалог снят" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "attached", ticketNum: 7, count: 3, byName: "" }), [
    { text: "3 сообщения добавлены в заявку " },
    { ticket: 7 },
    { text: "" },
  ]);
  // Номера нет — ссылки нет, строка не ломается
  assert.deepEqual(systemLineParts({ kind: "bound", ticketNum: null, byName: "" }), [
    { text: "Диалог привязан к заявке " },
    { text: "" },
    { text: "" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "somethingNew" }), [{ text: "Событие диалога" }]);
});

test("вложения: размер по-русски и длительность голосового", () => {
  assert.equal(formatFileSize(1_887_436), "1,8 МБ");
  assert.equal(formatFileSize(245_760), "240 КБ");
  assert.equal(formatFileSize(0), "");
  assert.equal(voiceDuration(14), "0:14");
  assert.equal(voiceDuration(75), "1:15");
});

test("подписи по сети: номер у WhatsApp, аккаунт у остальных", () => {
  assert.equal(networkLabel("telegram"), "Telegram");
  assert.equal(networkLabel("unknown"), "Мессенджер");
  assert.match(newCounterpartNote("whatsapp"), /этого номера нет/);
  assert.match(newCounterpartNote("telegram"), /этого аккаунта нет/);
  assert.match(linkAdvice("telegram"), /^Свяжите аккаунт с пользователем/);
  assert.equal(counterpartHandle({ username: "m_sokolova", phone: "+7914" }), "@m_sokolova");
  assert.equal(counterpartHandle({ username: "", phone: "+79145550142" }), "+79145550142");
  assert.equal(counterpartHandle(null), "");
});

test("поле ответа называет канал и заявку", () => {
  assert.equal(
    composerPlaceholder("telegram", 56812),
    "Сообщение в Telegram — попадёт в заявку №56812",
  );
  assert.equal(composerPlaceholder("telegram", null), "Сообщение в Telegram");
  assert.equal(
    phoneComposerHint("telegram", 56812),
    "Ответ уйдёт в Telegram и попадёт в заявку №56812",
  );
  assert.equal(phoneComposerHint("telegram", null), "Ответ уйдёт в Telegram");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/util/conversation-format.test.js`
Expected: FAIL — `Cannot find module '…/src/util/conversation-format.js'` (`ERR_MODULE_NOT_FOUND`); `# fail 1`.

- [ ] **Step 3: Implement**

`frontend/src/util/conversation-format.js` (new file):

```js
/**
 * Тексты «Диалогов»: подписи сетей и очередей, время строки списка, «ждёт …»,
 * мета строки, системные строки ленты, подписи вложений. Чистые функции —
 * тесты рядом: `node --test src/util/conversation-format.test.js`.
 *
 * Пояс показа приходит параметром (`timeZone`): util/format-date читает его из
 * localStorage и в тестах не грузится. Компоненты берут его из
 * `displayTimeZone()` того же util/format-date.
 */
import { plural } from "./plural.js";

/**
 * @typedef {{ now?: Date, timeZone?: string }} TimeOptions
 * @typedef {{ text?: string, ticket?: number }} LinePart
 */

/** Подписи сетей — те же, что у сервера (services/messaging/rules.js). */
export const NETWORK_LABEL = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  max: "MAX",
  site: "Форма с сайта",
};

export const networkLabel = (network) => NETWORK_LABEL[network] ?? "Мессенджер";

/** Очереди в порядке чипов; точка — только у «Ждут ответа» (канва A1). */
export const QUEUES = [
  { value: "awaiting", label: "Ждут ответа", dot: "warning" },
  { value: "mine", label: "Мои", dot: "none" },
  { value: "unbound", label: "Без заявки", dot: "none" },
  { value: "all", label: "Все", dot: "none" },
];

export const QUEUE_VALUES = QUEUES.map((queue) => queue.value);

const MINUTE = 60_000;

/** Сколько ждёт ответа: «12 мин», «1 ч 14 мин», «2 д 3 ч». Меньше минуты — «1 мин». */
export const waitLabel = (since, now = new Date()) => {
  if (!since) return "";
  const minutes = Math.max(
    1,
    Math.floor((new Date(now).getTime() - new Date(since).getTime()) / MINUTE),
  );
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} д ${restHours} ч` : `${days} д`;
};

const dayKeyOf = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone });

const daysAgo = (date, now, timeZone) =>
  Math.round(
    (Date.parse(`${dayKeyOf(now, timeZone)}T00:00:00Z`) -
      Date.parse(`${dayKeyOf(date, timeZone)}T00:00:00Z`)) /
      86_400_000,
  );

/** «10:42» в поясе показа. */
export const timeOf = (date, timeZone) =>
  new Date(date).toLocaleTimeString("ru", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Время строки списка: сегодня — «10:42», вчера — «вчера», на неделе — «пн», раньше — «12.09».
 * @param {string | Date | null | undefined} at
 * @param {TimeOptions} [options]
 */
export const listTimeLabel = (at, { now = new Date(), timeZone } = {}) => {
  if (!at) return "";
  const days = daysAgo(at, now, timeZone);
  if (days <= 0) return timeOf(at, timeZone);
  if (days === 1) return "вчера";
  if (days < 7) {
    return new Date(at).toLocaleDateString("ru", { timeZone, weekday: "short" });
  }
  return new Date(at).toLocaleDateString("ru", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });
};

/**
 * Метка дня над сообщениями: «Сегодня», «Вчера», «27 июля».
 * @param {string | Date} at
 * @param {TimeOptions} [options]
 */
export const dayLabel = (at, { now = new Date(), timeZone } = {}) => {
  const days = daysAgo(at, now, timeZone);
  if (days <= 0) return "Сегодня";
  if (days === 1) return "Вчера";
  return new Date(at).toLocaleDateString("ru", {
    timeZone,
    day: "numeric",
    month: "long",
  });
};

/**
 * Кто сказал последнее слово — подпись перед превью в строке списка: «Вы»,
 * «с телефона», имя автора в группе. У входящего в личном чате подписи нет.
 * @param {{ direction: string, origin: string, authorName: string } | null | undefined} lastMessage
 * @param {{ kind?: string, myName?: string }} [options]
 * @returns {string}
 */
export const lastMessagePrefix = (lastMessage, { kind, myName } = {}) => {
  if (!lastMessage) return "";
  if (lastMessage.direction === "out") {
    if (lastMessage.origin === "device") return "с телефона";
    if (lastMessage.authorName && lastMessage.authorName === myName) return "Вы";
    return lastMessage.authorName || "";
  }
  if (lastMessage.direction === "in" && kind === "group") {
    return lastMessage.authorName || "";
  }
  return "";
};

export const unknownLabel = (network) =>
  network === "whatsapp" ? "неизвестный номер" : "неизвестный контакт";

/**
 * Третья строка списка: компания (или «Форма с сайта») и номер заявки; без
 * заявки — «без заявки», у неопознанного личного чата — «неизвестный …».
 * Возвращает части с тоном: `muted` — факт, `faint` — отсутствие факта.
 * @param {{ kind: string, network: string, unknown: boolean, company: { alias: string } | null, ticket: { num: number } | null }} row
 * @returns {Array<{ text: string, tone: "muted" | "faint" }>}
 */
export const rowMeta = (row) => {
  const parts = [];
  if (row.kind === "form") {
    parts.push({ text: row.company?.alias || NETWORK_LABEL.site, tone: "muted" });
  } else if (row.company) {
    parts.push({ text: row.company.alias, tone: "muted" });
  }
  if (row.ticket) {
    parts.push({ text: `№${row.ticket.num}`, tone: "muted" });
  } else if (row.unknown && row.kind === "direct") {
    parts.push({ text: unknownLabel(row.network), tone: "faint" });
  } else {
    parts.push({ text: "без заявки", tone: "faint" });
  }
  return parts;
};

/**
 * Пустой список — по очереди, фильтру «Скрытые» и поиску.
 * @param {{ queue?: string, hidden?: boolean, q?: string }} [options]
 * @returns {string}
 */
export const emptyListText = ({ queue, hidden = false, q = "" } = {}) => {
  if (q.trim()) return "Ничего не нашлось";
  if (hidden) return "Скрытых диалогов нет";
  const byQueue = {
    awaiting: "Никто не ждёт ответа",
    mine: "Ваших диалогов нет",
    unbound: "Все диалоги привязаны к заявкам",
    all: "Диалогов пока нет",
  };
  return byQueue[queue] ?? "Диалогов нет";
};

/** «Соколова Марина» → «Соколова М.» — подпись кнопки «Ответить через». */
export const shortPersonName = (name) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[1][0]}.`;
};

/**
 * Имя из мессенджера → поля формы пользователя. Мессенджеры пишут имя первым
 * («Андрей Кузнецов»), форма хранит фамилию и имя порознь.
 */
export const splitPersonName = (name) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
};

/**
 * «привязана с 10:03» сегодня, «привязана с 12.09» раньше.
 * @param {string | Date | null | undefined} boundAt
 * @param {TimeOptions} [options]
 */
export const boundSinceLabel = (boundAt, { now = new Date(), timeZone } = {}) => {
  if (!boundAt) return "";
  const days = daysAgo(boundAt, now, timeZone);
  const when =
    days <= 0
      ? timeOf(boundAt, timeZone)
      : new Date(boundAt).toLocaleDateString("ru", {
          timeZone,
          day: "2-digit",
          month: "2-digit",
        });
  return `привязана с ${when}`;
};

/**
 * Системная строка ленты частями: `{ text }` — текст, `{ ticket }` — номер
 * заявки ссылкой. Подписи безличные («Создана заявка»), как у событий
 * хроники: пола автора мы не знаем. `compact` — короткая форма для телефона.
 * @param {{ kind?: string, ticketNum?: number | null, byName?: string, targetName?: string, count?: number | null } | null | undefined} event
 * @param {{ compact?: boolean }} [options]
 * @returns {LinePart[]}
 */
export const systemLineParts = (event, { compact = false } = {}) => {
  const by = event?.byName ? ` · ${event.byName}` : "";
  const num = event?.ticketNum ?? null;
  const ticket = num === null ? { text: "" } : { ticket: num };
  switch (event?.kind) {
    case "ticketCreated":
      return compact
        ? [{ text: "Создана заявка " }, ticket, { text: " — переписка идёт в неё" }]
        : [
            { text: "Создана заявка " },
            ticket,
            { text: ` — дальше переписка идёт в неё${by}` },
          ];
    case "bound":
      return [{ text: "Диалог привязан к заявке " }, ticket, { text: by }];
    case "unbound":
      return [{ text: "Диалог отвязан от заявки " }, ticket, { text: by }];
    case "bindingEnded":
      return [
        { text: "Заявка " },
        ticket,
        { text: " закрыта — диалог больше не привязан" },
      ];
    case "bindingRestored":
      return [
        { text: "Заявку " },
        ticket,
        { text: " вернули в работу — переписка снова идёт в неё" },
      ];
    case "handled":
      return [{ text: `Ответ не нужен${by}` }];
    case "assigned":
      return [
        {
          text: event.targetName
            ? `Ответственный за диалог — ${event.targetName}${by}`
            : `Ответственный за диалог снят${by}`,
        },
      ];
    case "attached": {
      const count = event.count ?? 0;
      return [
        {
          text: `${count} ${plural(count, "сообщение добавлено", "сообщения добавлены", "сообщений добавлено")} в заявку `,
        },
        ticket,
        { text: by },
      ];
    }
    default:
      return [{ text: "Событие диалога" }];
  }
};

/** «1,8 МБ», «240 КБ»; нет размера — пустая строка. */
export const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
};

/** Длительность голосового: 14 → «0:14», 75 → «1:15». */
export const voiceDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Вид вложения словом — подпись заглушки, пока файла нет. */
export const attachmentKindLabel = (kind) =>
  ({
    photo: "Фото",
    voice: "Голосовое",
    audio: "Аудио",
    video: "Видео",
    sticker: "Стикер",
  })[kind] ?? "Файл";

/** Ник или телефон собеседника — вторая строка в шапке и строке канала. */
export const counterpartHandle = (person) =>
  person?.username ? `@${person.username}` : person?.phone || "";

/** Первая строка ленты неопознанного собеседника (канва C2). */
export const newCounterpartNote = (network) =>
  network === "whatsapp"
    ? "Новый собеседник — этого номера нет ни у пользователей, ни у компаний"
    : "Новый собеседник — этого аккаунта нет ни у пользователей, ни у компаний";

/** Пояснение панели «Кто это?» (канва C2). */
export const linkAdvice = (network) =>
  `Свяжите ${network === "whatsapp" ? "номер" : "аккаунт"} с пользователем — дальше его сообщения будут узнаваться сами, а заявка получит компанию и инициатора.`;

/** Подсказка в поле ответа на десктопе (канва A1). */
export const composerPlaceholder = (network, ticketNum) =>
  ticketNum
    ? `Сообщение в ${networkLabel(network)} — попадёт в заявку №${ticketNum}`
    : `Сообщение в ${networkLabel(network)}`;

/** Строка над полем ответа на телефоне (канва B2). */
export const phoneComposerHint = (network, ticketNum) =>
  ticketNum
    ? `Ответ уйдёт в ${networkLabel(network)} и попадёт в заявку №${ticketNum}`
    : `Ответ уйдёт в ${networkLabel(network)}`;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test src/util/conversation-format.test.js`
Expected: `# tests 13`, `# pass 13`, `# fail 0`.

- [ ] **Step 5: Lint and typecheck**

Run: `cd frontend && pnpm exec eslint src/util/conversation-format.js src/util/conversation-format.test.js --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

- [ ] **Step 6: Checkpoint** — no commit, no staging.

---

## Task 6: `conversation-thread` helpers (TDD)

The thread's non-visual logic: merging polled pages without duplicates and in `seq` order, the `changedSince` / `afterId` cursor that drains a full page (Review Focus 2), which change is a new inbound message, grouping into day / system / bubble rows with the canvas gaps, and the default message selection for «Создать заявку».

**Files:**
- Create: `frontend/src/util/conversation-thread.js`
- Test: `frontend/src/util/conversation-thread.test.js`

**Interfaces:**
- Consumes: `dayLabel` from `./conversation-format.js` (Task 5); `MessageRow` type (Task 4).
- Produces:
  - `PAGE_SIZE = 50`
  - `mergeMessages<T extends { id: string; seq: number; sentAt: string }>(current: T[], incoming?: T[] | null) → T[]` — replaces by `id`, sorts by `seq`, then `sentAt`, then `id`; returns `current` itself when `incoming` is empty
  - `nextCursor(page: { serverTime: string; hasMore: boolean; afterId?: string }) → { since: string; afterId: string | null; drain: boolean }`
  - `changesQuery(cursor: { since: string; afterId: string | null }, limit = 200) → string` (`changedSince=…&limit=…[&afterId=…]`)
  - `hasNewInbound(changed: { id: string; direction: string }[], knownIds: Set<string>) → boolean`
  - `threadRows(messages, { kind?, timeZone?, now? }?) → ThreadRow[]` where `ThreadRow = { type: "day"; key; label } | { type: "system"; key; message } | { type: "message"; key; message; side: "in" | "out"; gap: number; showAuthor: boolean; showName: boolean }`
  - `defaultDraftMessageIds(messages, { limit = 20 }?) → string[]`

- [ ] **Step 1: Write the failing test**

`frontend/src/util/conversation-thread.test.js` (new file):

```js
// node --test src/util/conversation-thread.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  changesQuery,
  defaultDraftMessageIds,
  hasNewInbound,
  mergeMessages,
  nextCursor,
  threadRows,
} from "./conversation-thread.js";

const tz = "Europe/Moscow";
const now = new Date("2026-09-25T08:00:00Z");

const msg = (id, seq, extra = {}) => ({
  id,
  seq,
  direction: "in",
  sentAt: "2026-09-25T06:58:00Z",
  author: { name: "Соколова Марина", userId: "u-marina", isStaff: false },
  ticket: null,
  deletedAt: null,
  status: "received",
  ...extra,
});

test("mergeMessages: замена по id, новые по месту, порядок по seq", () => {
  const current = [msg("a", 1), msg("b", 2)];
  const merged = mergeMessages(current, [
    msg("c", 3),
    { ...msg("a", 1), status: "read" },
    msg("z", 0),
  ]);
  assert.deepEqual(
    merged.map((message) => message.id),
    ["z", "a", "b", "c"],
  );
  assert.equal(merged.find((message) => message.id === "a").status, "read");
  // Пустая порция не пересобирает ленту — ссылка та же
  assert.equal(mergeMessages(current, []), current);
});

test("nextCursor: полная страница дочитывается с afterId, неполная — от метки сервера", () => {
  assert.deepEqual(
    nextCursor({ items: [], serverTime: "2026-09-25T08:00:05Z", afterId: "m9", hasMore: true }),
    { since: "2026-09-25T08:00:05Z", afterId: "m9", drain: true },
  );
  assert.deepEqual(
    nextCursor({ items: [], serverTime: "2026-09-25T08:00:07Z", hasMore: false }),
    { since: "2026-09-25T08:00:07Z", afterId: null, drain: false },
  );
});

test("changesQuery: afterId только когда он есть", () => {
  assert.equal(
    changesQuery({ since: "2026-09-25T08:00:05.000Z", afterId: "m9" }),
    "changedSince=2026-09-25T08%3A00%3A05.000Z&limit=200&afterId=m9",
  );
  assert.equal(
    changesQuery({ since: "2026-09-25T08:00:05.000Z", afterId: null }, 50),
    "changedSince=2026-09-25T08%3A00%3A05.000Z&limit=50",
  );
});

test("hasNewInbound: только новое входящее, не правка известного", () => {
  const known = new Set(["a"]);
  assert.equal(hasNewInbound([msg("a", 1)], known), false);
  assert.equal(hasNewInbound([msg("b", 2, { direction: "out" })], known), false);
  assert.equal(hasNewInbound([msg("c", 3)], known), true);
});

test("threadRows: метки дней и отступы как на канве A1", () => {
  const rows = threadRows(
    [
      msg("m1", 1, { sentAt: "2026-09-24T06:58:00Z" }),
      msg("m2", 2),
      msg("r1", 3, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("s1", 4, { direction: "system", event: { kind: "ticketCreated" } }),
      msg("r2", 5, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("r3", 6, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("r4", 7, { direction: "out", author: { name: "Орлова Анна", userId: "u-anna" } }),
      msg("m3", 8),
      msg("m4", 9),
    ],
    { timeZone: tz, now },
  );
  assert.deepEqual(
    rows.map((row) =>
      row.type === "message"
        ? `${row.key}:${row.gap}${row.showAuthor ? "+author" : ""}`
        : row.type === "day"
          ? `day:${row.label}`
          : `sys:${row.key}`,
    ),
    [
      "day:Вчера",
      "m1:6",
      "day:Сегодня",
      "m2:6",
      "r1:12+author",
      "sys:s1",
      "r2:6+author",
      "r3:4",
      "r4:4+author",
      "m3:12",
      "m4:4",
    ],
  );
});

test("threadRows: в группе имя над входящим при смене автора, в личном — никогда", () => {
  const group = threadRows(
    [
      msg("g1", 1, { author: { name: "Смирнов Олег", userId: "u-oleg" } }),
      msg("g2", 2, { author: { name: "Смирнов Олег", userId: "u-oleg" } }),
      msg("g3", 3, { author: { name: "Костя", userId: null } }),
    ],
    { kind: "group", timeZone: tz, now },
  ).filter((row) => row.type === "message");
  assert.deepEqual(
    group.map((row) => row.showName),
    [true, false, true],
  );
  const direct = threadRows([msg("d1", 1), msg("d2", 2)], { kind: "direct", timeZone: tz, now }).filter(
    (row) => row.type === "message",
  );
  assert.deepEqual(
    direct.map((row) => row.showName),
    [false, false],
  );
});

test("defaultDraftMessageIds: хвост до первого сообщения в заявке, без системных и удалённых", () => {
  const messages = [
    msg("old", 1, { ticket: { id: "t1", num: 56700 } }),
    msg("a", 2),
    msg("sys", 3, { direction: "system" }),
    msg("b", 4, { direction: "out" }),
    msg("gone", 5, { deletedAt: "2026-09-25T07:00:00Z" }),
    msg("c", 6),
  ];
  assert.deepEqual(defaultDraftMessageIds(messages), ["a", "b", "c"]);
  assert.deepEqual(defaultDraftMessageIds(messages, { limit: 2 }), ["b", "c"]);
  assert.deepEqual(defaultDraftMessageIds([]), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/util/conversation-thread.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `conversation-thread.js`; `# fail 1`.

- [ ] **Step 3: Implement**

`frontend/src/util/conversation-thread.js` (new file):

```js
/**
 * Лента «Диалогов»: слияние порций сообщений, курсор опроса `changedSince`
 * (контракт — docs/messaging.md, «The changedSince polling contract»),
 * разметка ленты (метки дней, отступы, подписи авторов) и сообщения, из которых
 * «Создать заявку» собирает описание. Чистые функции — тесты рядом:
 * `node --test src/util/conversation-thread.test.js`.
 */
import { dayLabel } from "./conversation-format.js";

/**
 * @typedef {import("../types/conversation").MessageRow} MessageRow
 * @typedef {{ type: "day", key: string, label: string }} DayRow
 * @typedef {{ type: "system", key: string, message: MessageRow }} SystemRow
 * @typedef {{ type: "message", key: string, message: MessageRow, side: "in" | "out", gap: number, showAuthor: boolean, showName: boolean }} BubbleRow
 * @typedef {DayRow | SystemRow | BubbleRow} ThreadRow
 * @typedef {{ since: string, afterId: string | null }} PollCursor
 */

/** Страница ленты: столько сообщений приезжает при открытии и по «Показать раньше». */
export const PAGE_SIZE = 50;

// Порядок показа — по seq: сервер нумерует сообщения диалога в порядке
// прихода, а опрос отдаёт их в порядке ИЗМЕНЕНИЯ (правка и статус двигают
// updatedAt), поэтому сортирует клиент (docs/messaging.md, §7)
const bySeq = (a, b) =>
  (a.seq ?? 0) - (b.seq ?? 0) ||
  String(a.sentAt).localeCompare(String(b.sentAt)) ||
  String(a.id).localeCompare(String(b.id));

/**
 * Слить порцию в ленту: тот же id — заменить (правка, статус), новый — добавить.
 * @template {{ id: string, seq: number, sentAt: string }} T
 * @param {T[]} current
 * @param {T[] | null | undefined} incoming
 * @returns {T[]}
 */
export const mergeMessages = (current, incoming) => {
  if (!incoming?.length) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(bySeq);
};

/**
 * Следующий курсор опроса. Полная страница (`hasMore`) — продолжаем с её
 * последней строки (`serverTime` + `afterId`) сразу же; неполная — следующий
 * опрос от метки сервера без `afterId`, чтобы не потерять записанное между
 * чтением базы и ответом.
 * @param {{ serverTime: string, hasMore: boolean, afterId?: string }} page
 * @returns {PollCursor & { drain: boolean }}
 */
export const nextCursor = (page) =>
  page.hasMore
    ? { since: page.serverTime, afterId: page.afterId ?? null, drain: true }
    : { since: page.serverTime, afterId: null, drain: false };

/**
 * Строка запроса опроса по курсору.
 * @param {PollCursor} cursor
 * @param {number} [limit]
 */
export const changesQuery = (cursor, limit = 200) => {
  const params = new URLSearchParams({
    changedSince: String(cursor.since),
    limit: String(limit),
  });
  if (cursor.afterId) params.set("afterId", cursor.afterId);
  return params.toString();
};

/**
 * Пришло ли новое входящее — повод отметить диалог прочитанным.
 * @param {Array<{ id: string, direction: string }>} changed
 * @param {Set<string>} knownIds
 */
export const hasNewInbound = (changed, knownIds) =>
  changed.some(
    (message) => message.direction === "in" && !knownIds.has(message.id),
  );

/**
 * Ряды ленты в мессенджерном порядке (старые сверху, канва A1):
 *   day     — метка дня перед первым сообщением дня;
 *   system  — системная строка («Создана заявка №…»);
 *   message — пузырь; `gap` — отступ сверху в px (4 — та же сторона,
 *             12 — смена стороны, 6 — после метки дня или системной строки),
 *             `showAuthor` — подпись автора над исходящим, `showName` — имя
 *             над входящим в группе.
 * @param {MessageRow[]} messages
 * @param {{ kind?: string, timeZone?: string, now?: Date }} [options]
 * @returns {ThreadRow[]}
 */
export const threadRows = (
  messages,
  { kind = "direct", timeZone, now = new Date() } = {},
) => {
  const rows = [];
  let lastDay = null;
  let previous = null;
  for (const message of messages) {
    const day = new Date(message.sentAt).toLocaleDateString("en-CA", {
      timeZone,
    });
    if (day !== lastDay) {
      rows.push({
        type: "day",
        key: `day-${day}`,
        label: dayLabel(message.sentAt, { now, timeZone }),
      });
      lastDay = day;
      previous = { type: "day" };
    }
    if (message.direction === "system") {
      rows.push({ type: "system", key: message.id, message });
      previous = { type: "system" };
      continue;
    }
    const side = message.direction === "out" ? "out" : "in";
    const authorKey = message.author?.userId || message.author?.name || "";
    const sameSide = previous?.type === "message" && previous.side === side;
    const sameAuthor = sameSide && previous.authorKey === authorKey;
    rows.push({
      type: "message",
      key: message.id,
      message,
      side,
      gap: previous?.type === "message" ? (sameSide ? 4 : 12) : 6,
      showAuthor: side === "out" && !sameAuthor,
      showName: side === "in" && kind === "group" && !sameAuthor,
    });
    previous = { type: "message", side, authorKey };
  }
  return rows;
};

/**
 * Сообщения для «Создать заявку» в личном чате (выбора сообщений в P1 нет):
 * хвост переписки назад до первого сообщения, уже лежащего в заявке, без
 * системных строк и удалённых, не больше `limit`. Возвращает id от старых к
 * новым — в этом порядке их прочтёт описание.
 * @param {MessageRow[]} messages
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export const defaultDraftMessageIds = (messages, { limit = 20 } = {}) => {
  const picked = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "system" || message.deletedAt) continue;
    if (message.ticket) break;
    picked.push(message.id);
    if (picked.length >= limit) break;
  }
  return picked.reverse();
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test src/util/conversation-thread.test.js`
Expected: `# tests 7`, `# pass 7`, `# fail 0`.

- [ ] **Step 5: Lint and typecheck**

Run: `cd frontend && pnpm exec eslint src/util/conversation-thread.js src/util/conversation-thread.test.js --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

- [ ] **Step 6: Checkpoint** — no commit, no staging.

---

## Task 7: List store, navigation, phone shell

The conversations store (list, queues, filters, counts), the navigation entry «Диалоги» right after «Заявки» with the «Ждут ответа» pill (bar, burger), the new phone tab bar «Главная · Заявки · Диалоги · Пользователи · Компании» (staff «База» moves to the burger), and the shell switch that lets a route take the whole phone screen.

**Files:**
- Create: `frontend/src/store/conversations.ts`
- Create: `frontend/src/components/Conversation/NavBadges.tsx`
- Create: `frontend/src/components/Conversation/CountsSync.tsx`
- Modify: `frontend/src/util/sections.ts` (section «Диалоги»)
- Modify: `frontend/src/layout/sheet-width.js` (sheet width for `/conversations`)
- Modify: `frontend/src/layout/Navigation/menu.js`, `frontend/src/layout/Navbar.jsx`, `frontend/src/layout/NavDrawer.jsx`, `frontend/src/layout/MobileBottomNavbar.jsx`
- Modify: `frontend/src/layout/Root.jsx` (`CountsSync`, `handle.phoneFullscreen`)
- Modify: `frontend/src/index.css` (`.mobile-shell__scroll--full`)
- Test: `frontend/src/util/sections.test.js`, `frontend/src/layout/sheet-width.test.js`

**Interfaces:**
- Consumes: `api` (`@/lib/api`), `useLiveTopic(topic, fn, { enabled?, minIntervalMs? })` (`@/hooks/use-live-topic`), `useCan()` (`@/store/authed-user`), `useInitialPrefsStore` (`@/store/prefs`), `CountPill` (Task 4); HTTP `GET /api/conversations` (P0) and `GET /api/conversations/counts` (Task 1).
- Produces:
  - `useConversationsStore` (default export, zustand) — state `{ queue: "awaiting"|"mine"|"unbound"|"all"; q: string; company: string | null; hidden: boolean; items: ConversationRow[]; counts: QueueCounts | null; nextBefore: string | null; status: "idle"|"loading"|"ready"|"error"; loadingMore: boolean }`, actions `setQueue(queue)`, `setSearch(q)`, `setCompany(id | null)`, `setHidden(boolean)`, `resetFilters()`, `load(): Promise<void>`, `silentRefresh(): Promise<void>`, `loadMore(): Promise<void>`, `refreshCounts(): Promise<void>`, `markRead(id: string): void`. The queue is remembered in `localStorage["hd.conversations.queue"]`.
  - `NavCount()` and `TabCount()` (named exports of `NavBadges.tsx`) — render nothing at 0, «99+» above 99.
  - `CountsSync` (default export) — mounted once in `Root` for staff.
  - Route contract: a route with `handle: { phoneFullscreen: true }` gets the whole phone screen — no tab bar, no footer, `main.mobile-shell__scroll--full` (flex column, no page scroll); the page itself scrolls its feed.
  - Menu item field `badge: "conversations"`; section key `"conversations"` (`backLabel` «К диалогам»); sheet width 1488 for `/conversations…`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/util/sections.test.js`:

```diff
--- a/frontend/src/util/sections.test.js
+++ b/frontend/src/util/sections.test.js
@@ -32,3 +32,15 @@
   assert.equal(sectionAs(archive, true), archive);
   assert.equal(sectionAs(undefined, true), undefined);
 });
+
+test("диалог по адресу относится к «Диалогам»", () => {
+  const section = sectionForPath("/conversations/68f1a2b3c4d5e6f708192a3b");
+  assert.equal(section?.key, "conversations");
+  assert.equal(section?.label, "Диалоги");
+  assert.deepEqual(section?.can, { conversation: ["read"] });
+  // Форма поверх диалога — тот же раздел
+  assert.equal(
+    sectionForPath("/conversations/68f1a2b3c4d5e6f708192a3b/tickets/add")?.key,
+    "conversations",
+  );
+});
```

`frontend/src/layout/sheet-width.test.js`:

```diff
--- a/frontend/src/layout/sheet-width.test.js
+++ b/frontend/src/layout/sheet-width.test.js
@@ -82,3 +82,19 @@
     }
   }
 });
+
+test("«Диалоги» — широкий лист и под шторкой формы поверх диалога", () => {
+  assert.equal(resolveSheetWidth("/conversations"), 1488);
+  assert.equal(
+    resolveSheetWidth(
+      layoutPathname(
+        matches(
+          page("/conversations"),
+          page("/conversations/c1"),
+          sheet("/conversations/c1/tickets/add"),
+        ),
+      ),
+    ),
+    1488,
+  );
+});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && node --test src/util/sections.test.js src/layout/sheet-width.test.js 2>&1 | grep -E "^not ok|# (tests|pass|fail)"`
Expected: `# tests 12`, `# pass 10`, `# fail 2` — failing `диалог по адресу относится к «Диалогам»` (expected `'conversations'`, got `undefined`) and `«Диалоги» — широкий лист и под шторкой формы поверх диалога` (expected `1488`, actual `1328`).

- [ ] **Step 3: Section and sheet width**

`frontend/src/util/sections.ts`:

```diff
--- a/frontend/src/util/sections.ts
+++ b/frontend/src/util/sections.ts
@@ -53,6 +53,16 @@
   { key: "archive", listTo: "/archive", label: "Архив" },
 
   {
+    key: "conversations",
+    listTo: "/conversations",
+    label: "Диалоги",
+    can: { conversation: ["read"] },
+    acc: "диалог",
+    pronoun: "его",
+    backLabel: "К диалогам",
+  },
+
+  {
     key: "checklist-templates",
     listTo: "/tickets/checklist-templates",
     label: "Шаблоны чек-листов",
```

`frontend/src/layout/sheet-width.js`:

```diff
--- a/frontend/src/layout/sheet-width.js
+++ b/frontend/src/layout/sheet-width.js
@@ -24,6 +24,10 @@
   // «Окружение» в 1280 не хватало места
   { path: "/tickets/", maxWidth: 1488 },
   { path: "/tickets", maxWidth: 1328, exact: true },
+  // «Диалоги»: список 352 + переписка + контакт 320 — рабочее место во всю
+  // ширину, как карточка заявки (max-w-8xl + 2×24); на 1440 лист занимает
+  // рабочую область целиком (канва A1)
+  { path: "/conversations", maxWidth: 1488 },
   // Расположения: карточка (max-w-4xl, со слэшем) матчится
   // раньше списка (max-w-7xl) — порядок в .find важен
   { path: "/inventory/locations/", maxWidth: 944 },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd frontend && node --test src/util/sections.test.js src/layout/sheet-width.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 5: The store**

The list refetch keeps the last request's answer only (a generation counter), so a fast queue switch never shows the previous queue's rows. Background refreshes swallow errors — the next pulse retries (memory «Polling fetch error handling»).

`frontend/src/store/conversations.ts` (new file):

```ts
import { create } from "zustand";

import { api } from "@/lib/api";
import type {
  ConversationListResponse,
  ConversationQueue,
  ConversationRow,
  QueueCounts,
} from "@/types/conversation";

/**
 * Список «Диалогов» и счётчики очередей.
 *
 * Счётчики нужны не только списку: «Ждут ответа» стоит пилюлей у пункта меню и
 * значком у вкладки телефона. Поэтому они живут здесь, а обновляют их двое:
 * ответ списка (`load`/`silentRefresh`) и лёгкий `GET /api/conversations/counts`
 * (`refreshCounts`, его зовёт Conversation/CountsSync по теме пульса
 * «conversations»). Фоновые перечитывания сбои глотают — следующее изменение
 * подтянет данные (docs/live-updates.md).
 *
 * Очередь запоминается на устройстве: это удобство одного человека, а не
 * общее состояние.
 */

const QUEUE_KEY = "hd.conversations.queue";
const PAGE = 50;
// Фоновое перечитывание не тянет больше одной серверной страницы
const REFRESH_MAX = 100;

type BaseQueue = Exclude<ConversationQueue, "hidden">;
const BASE_QUEUES: BaseQueue[] = ["awaiting", "mine", "unbound", "all"];

const readQueue = (): BaseQueue => {
  try {
    const saved = localStorage.getItem(QUEUE_KEY);
    return BASE_QUEUES.find((queue) => queue === saved) ?? "awaiting";
  } catch {
    return "awaiting";
  }
};

const saveQueue = (queue: BaseQueue) => {
  try {
    localStorage.setItem(QUEUE_KEY, queue);
  } catch {
    // Хранилище недоступно (приватное окно) — очередь просто не запомнится
  }
};

type Filters = {
  queue: BaseQueue;
  q: string;
  company: string | null;
  /** Фильтр «Скрытые» — отдельная очередь сервера (`queue=hidden`). */
  hidden: boolean;
};

type ConversationsState = Filters & {
  items: ConversationRow[];
  counts: QueueCounts | null;
  nextBefore: string | null;
  status: "idle" | "loading" | "ready" | "error";
  loadingMore: boolean;
  setQueue: (queue: BaseQueue) => void;
  setSearch: (q: string) => void;
  setCompany: (company: string | null) => void;
  setHidden: (hidden: boolean) => void;
  resetFilters: () => void;
  load: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  /** Диалог открыт и отмечен прочитанным — непрочитанное в строке гаснет сразу. */
  markRead: (id: string) => void;
};

const listUrl = (
  filters: Filters,
  { limit, before }: { limit: number; before?: string | null },
) => {
  const params = new URLSearchParams({
    queue: filters.hidden ? "hidden" : filters.queue,
    limit: String(limit),
  });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.company) params.set("company", filters.company);
  if (before) params.set("before", before);
  return `/api/conversations?${params}`;
};

// Побеждает последний запрос: смена очереди посреди загрузки не должна
// нарисовать список предыдущей
let generation = 0;

const useConversationsStore = create<ConversationsState>()((set, get) => ({
  queue: readQueue(),
  q: "",
  company: null,
  hidden: false,
  items: [],
  counts: null,
  nextBefore: null,
  status: "idle",
  loadingMore: false,

  setQueue: (queue) => {
    saveQueue(queue);
    set({ queue, hidden: false });
    void get().load();
  },
  setSearch: (q) => {
    set({ q });
    void get().load();
  },
  setCompany: (company) => {
    set({ company });
    void get().load();
  },
  setHidden: (hidden) => {
    set({ hidden });
    void get().load();
  },
  resetFilters: () => {
    set({ company: null, hidden: false });
    void get().load();
  },

  load: async () => {
    const mine = ++generation;
    set({ status: "loading" });
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit: PAGE }),
      );
      if (mine !== generation) return;
      set({
        items: data.items,
        counts: data.counts,
        nextBefore: data.nextBefore,
        status: "ready",
      });
    } catch (error) {
      if (mine !== generation) return;
      console.warn("conversations: список не загрузился:", error);
      set({ status: "error" });
    }
  },

  silentRefresh: async () => {
    const mine = ++generation;
    const limit = Math.min(Math.max(get().items.length, PAGE), REFRESH_MAX);
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit }),
      );
      if (mine !== generation) return;
      set({
        items: data.items,
        counts: data.counts,
        nextBefore: data.nextBefore,
        status: "ready",
      });
    } catch (error) {
      console.warn("conversations: пропущено обновление списка:", error);
    }
  },

  loadMore: async () => {
    const { nextBefore, loadingMore } = get();
    if (!nextBefore || loadingMore) return;
    const mine = generation;
    set({ loadingMore: true });
    try {
      const data = await api<ConversationListResponse>(
        listUrl(get(), { limit: PAGE, before: nextBefore }),
      );
      if (mine !== generation) return;
      set((state) => {
        const known = new Set(state.items.map((row) => row.id));
        return {
          items: [...state.items, ...data.items.filter((row) => !known.has(row.id))],
          counts: data.counts,
          nextBefore: data.nextBefore,
        };
      });
    } catch (error) {
      console.warn("conversations: следующая страница не загрузилась:", error);
    } finally {
      set({ loadingMore: false });
    }
  },

  refreshCounts: async () => {
    try {
      const data = await api<{ counts: QueueCounts }>(
        "/api/conversations/counts",
      );
      set({ counts: data.counts });
    } catch (error) {
      console.warn("conversations: пропущено обновление счётчиков:", error);
    }
  },

  markRead: (id) =>
    set((state) => ({
      items: state.items.map((row) =>
        row.id === id && row.unread ? { ...row, unread: 0 } : row,
      ),
    })),
}));

export default useConversationsStore;
```

- [ ] **Step 6: Badges and the counts loader**

`frontend/src/components/Conversation/NavBadges.tsx` (new file):

```tsx
import CountPill from "@/components/app/CountPill";
import useConversationsStore from "@/store/conversations";

/**
 * Счётчик «Ждут ответа» в навигации: пилюлей у пункта «Диалоги» (бар и
 * бургер) и значком у вкладки телефона (канва A1, B1). Ноль не рисуется.
 * Подписка узкая — новый счётчик перерисовывает значок, а не оболочку.
 */
const useAwaitingCount = () =>
  useConversationsStore((state) => state.counts?.awaiting ?? 0);

const shortCount = (count: number) => (count > 99 ? "99+" : String(count));

export const NavCount = () => {
  const count = useAwaitingCount();
  if (!count) return null;
  return <CountPill>{shortCount(count)}</CountPill>;
};

export const TabCount = () => {
  const count = useAwaitingCount();
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-2.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground tabular-nums ring-2 ring-card">
      {shortCount(count)}
    </span>
  );
};
```

`frontend/src/components/Conversation/CountsSync.tsx` (new file):

```tsx
import { useEffect } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import { useCan } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import useInitialPrefsStore from "@/store/prefs";

/**
 * Единственный загрузчик счётчиков «Диалогов» для навигации: при входе и
 * когда пульс говорит, что тема «conversations» сдвинулась. Монтируется один
 * раз в layout/Root для сотрудника; без модуля или права не делает ничего.
 */
const CountsSync = () => {
  const can = useCan();
  const moduleOn = useInitialPrefsStore(
    (state) => !!state.modules?.messaging?.isActive,
  );
  const enabled = moduleOn && can({ conversation: ["read"] });
  const refreshCounts = useConversationsStore((state) => state.refreshCounts);

  useEffect(() => {
    if (enabled) void refreshCounts();
  }, [enabled, refreshCounts]);

  useLiveTopic("conversations", refreshCounts, {
    enabled,
    // Счётчик в меню — не лента: реже, чем раз в 15 с, его трогать незачем
    minIntervalMs: 15_000,
  });

  return null;
};

export default CountsSync;
```

- [ ] **Step 7: Menu, bar, burger, phone tabs**

`frontend/src/layout/Navigation/menu.js`:

```diff
--- a/frontend/src/layout/Navigation/menu.js
+++ b/frontend/src/layout/Navigation/menu.js
@@ -9,6 +9,7 @@
   RiContactsLine,
   RiDashboard2Line,
   RiDeviceLine,
+  RiDiscussLine,
   RiDraftLine,
   RiFileList3Line,
   RiListCheck2,
@@ -34,7 +35,8 @@
 // него нет — см. комментарий в ветке.
 //
 // Форма элемента:
-//   { key, label, shortLabel?, icon, to }               — ссылка
+//   { key, label, shortLabel?, icon, to, badge? }       — ссылка; badge:
+//     "conversations" — пилюля «Ждут ответа» (Conversation/NavBadges)
 //   { key, label, shortLabel?, icon, groups: [...] }    — раздел-дропдаун;
 //     группа: { label?, items: [item, …] } — label — uppercase-заголовок
 //     («Администрирование» подписывает группы по модулям), группы рендерятся
@@ -76,12 +78,14 @@
   const canReadKnowledge = can({ knowledge: ["read"] });
   const canReadApproval = can({ approval: ["read"] });
   const canReadSchedule = can({ schedule: ["read"] });
+  const canReadConversations = can({ conversation: ["read"] });
 
   const timeTracking = !!modules?.timeTracking?.isActive;
   const inventory = !!modules?.inventory?.isActive;
   const knowledgeBase = !!modules?.knowledgeBase?.isActive;
   const finances = !!modules?.finances?.isActive;
   const mikrotik = !!modules?.mikrotik?.isActive;
+  const messaging = !!modules?.messaging?.isActive;
 
   if (isEndUser) {
     const reports = [
@@ -325,6 +329,13 @@
   return [
     link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
     link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
+    // «Диалоги» — сразу за заявками: это та же работа с клиентом (канва A1).
+    // Пилюля — сколько диалогов ждут ответа
+    messaging &&
+      canReadConversations &&
+      link("conversations", "Диалоги", RiDiscussLine, "/conversations", {
+        badge: "conversations",
+      }),
     canReadCompanies &&
       link("companies", "Компании", RiBuilding2Line, "/companies"),
     canReadUsers && link("users", "Пользователи", RiContactsLine, "/users"),
```

`frontend/src/layout/Navbar.jsx`:

```diff
--- a/frontend/src/layout/Navbar.jsx
+++ b/frontend/src/layout/Navbar.jsx
@@ -26,6 +26,7 @@
   PopoverTrigger,
 } from "@/components/ui/popover";
 import BrandMark from "@/components/app/BrandMark";
+import { NavCount } from "@/components/Conversation/NavBadges";
 import NavProgress from "@/components/app/NavProgress";
 import Bell from "@/components/Notifications/Bell";
 import { THEME_OPTIONS } from "@/components/app/ThemeSegment";
@@ -380,6 +381,7 @@
                         )}
                       />
                       {item.shortLabel ?? item.label}
+                      {item.badge === "conversations" && <NavCount />}
                     </>
                   )}
                 </NavLink>
```

`frontend/src/layout/NavDrawer.jsx`:

```diff
--- a/frontend/src/layout/NavDrawer.jsx
+++ b/frontend/src/layout/NavDrawer.jsx
@@ -15,6 +15,7 @@
 } from "@/components/ui/collapsible";
 import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
 import ThemeSegment from "@/components/app/ThemeSegment";
+import { NavCount } from "@/components/Conversation/NavBadges";
 import { cn } from "@/lib/utils";
 
 import WorkStatusAvatar from "../components/User/WorkStatusAvatar";
@@ -169,7 +170,8 @@
                       aria-hidden
                       className={isActive ? activeIconClass : iconClass}
                     />
-                    {item.label}
+                    <span className="min-w-0 flex-1">{item.label}</span>
+                    {item.badge === "conversations" && <NavCount />}
                   </>
                 )}
               </NavLink>
```

`frontend/src/layout/MobileBottomNavbar.jsx`:

```diff
--- a/frontend/src/layout/MobileBottomNavbar.jsx
+++ b/frontend/src/layout/MobileBottomNavbar.jsx
@@ -9,8 +9,10 @@
   RiBookOpenLine,
   RiArchiveLine,
   RiCheckboxLine,
+  RiDiscussLine,
 } from "react-icons/ri";
 
+import { TabCount } from "@/components/Conversation/NavBadges";
 import { cn } from "@/lib/utils";
 
 import { AuthedUserContext } from "../store/authed-user-context";
@@ -37,6 +39,16 @@
     // У клиента вкладки «Заявки» нет, как и пункта в меню: его заявки — блок
     // на главной, закрытые — в «Архиве» (см. menu.js)
     !isEndUser && { to: "/tickets", icon: RiCheckboxLine, label: "Заявки" },
+    // «Диалоги» — третьей вкладкой, со значком «Ждут ответа» (решение владельца
+    // по канве, 24.09). Ради неё «База» у сотрудника ушла в бургер-меню
+    !isEndUser &&
+      modules?.messaging?.isActive &&
+      can({ conversation: ["read"] }) && {
+        to: "/conversations",
+        icon: RiDiscussLine,
+        label: "Диалоги",
+        badge: true,
+      },
     // Права и рубильники модулей — те же, что в десктопном меню. Прежде здесь
     // стоял голый `!isEndUser`, и вкладки «Люди» и «Компании» вели сотрудника
     // на 403, а «База» показывалась при выключенном модуле базы знаний.
@@ -50,7 +62,10 @@
       icon: RiBuilding2Line,
       label: "Компании",
     },
-    modules?.knowledgeBase?.isActive &&
+    // У сотрудника база знаний — в бургер-меню: пятую вкладку заняли
+    // «Диалоги». У клиента вкладок меньше, и «База» остаётся на месте
+    isEndUser &&
+      modules?.knowledgeBase?.isActive &&
       can({ knowledge: ["read"] }) && {
         to: "/knowledge-base",
         icon: RiBookOpenLine,
@@ -100,7 +115,10 @@
                   }
                 />
               )}
-              <Icon className="relative z-10 size-6" aria-hidden="true" />
+              <span className="relative z-10 flex">
+                <Icon className="size-6" aria-hidden="true" />
+                {tab.badge && <TabCount />}
+              </span>
               <span className="relative z-10 max-w-full truncate text-xs leading-none">
                 {tab.label}
               </span>
```

- [ ] **Step 8: Shell — `CountsSync` and `handle.phoneFullscreen`**

The rule sits outside the Tailwind layers on purpose: the `overflow-y-auto` utility on `<main>` would otherwise win (memory «CSS layers + !important»).

`frontend/src/index.css`:

```diff
--- a/frontend/src/index.css
+++ b/frontend/src/index.css
@@ -73,6 +73,16 @@
   padding-bottom: calc(5.25rem + env(safe-area-inset-bottom));
 }
 
+/* Экран-переписка на телефоне (handle.phoneFullscreen, «Диалоги»): острова
+   вкладок нет, прокручивает лента внутри страницы, поле ответа прижато к низу.
+   Вне слоя — как правило выше, иначе утилиты overflow-y-auto у <main> его бьют. */
+.mobile-shell__scroll--full {
+  display: flex;
+  flex-direction: column;
+  overflow: hidden;
+  padding-bottom: env(safe-area-inset-bottom);
+}
+
 /* Блокируем скролл страницы только когда shell в DOM (т.е. только мобайл;
    на десктопе MobileView = null, .mobile-shell отсутствует). */
 html:has(.mobile-shell),
```

`frontend/src/layout/Root.jsx`:

```diff
--- a/frontend/src/layout/Root.jsx
+++ b/frontend/src/layout/Root.jsx
@@ -20,6 +20,7 @@
 import Footer from "./Footer";
 import RouteGuard from "@/components/app/RouteGuard";
 import PulseLoop from "@/components/app/PulseLoop";
+import CountsSync from "@/components/Conversation/CountsSync";
 import PresenceSync from "@/components/User/PresenceSync";
 import { newerWorkStatus } from "@/components/User/presence";
 import usePulseStore from "@/store/pulse";
@@ -126,6 +127,12 @@
   // pathname — ширина как у карточки (944). Незнакомый путь до сюда не
   // доходит: его ловит errorElement и поднимает тот же флаг.
   const matches = useMatches();
+  // Переписка на телефоне — экран целиком: лента и поле ответа до нижнего
+  // края, без острова вкладок и подвала (канва B2). Маршрут просит это сам
+  // (`handle.phoneFullscreen`), оболочка не знает про «Диалоги».
+  const phoneFullscreen = matches.some(
+    (match) => match.handle?.phoneFullscreen,
+  );
   const sheetWidth = routeErrorActive
     ? 944
     : resolveSheetWidth(layoutPathname(matches));
@@ -232,6 +239,8 @@
           присутствия (docs/live-updates.md) — на обеих оболочках */}
       {isLoggedIn && <PulseLoop />}
       {isLoggedIn && !userData?.isEndUser && <PresenceSync />}
+      {/* Счётчик «Ждут ответа» у пункта «Диалоги» — сотрудникам */}
+      {isLoggedIn && !userData?.isEndUser && <CountsSync />}
       {isLoggedIn && (
         <BrowserView>
           <NavigationBar />
@@ -407,19 +416,30 @@
                 информации, которая нужна изредка. На телефоне команда — блок
                 «Команда сейчас» на главной (components/Dashboard/TeamNow) */}
             <main
-              className="mobile-shell__scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"
+              className={cn(
+                "mobile-shell__scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain",
+                phoneFullscreen && "mobile-shell__scroll--full",
+              )}
               ref={mobileScrollRef}
             >
-              <div className="mx-auto w-full px-3 pt-3">
-                <div ref={pageRef}>
+              {phoneFullscreen ? (
+                <div ref={pageRef} className="flex min-h-0 flex-1 flex-col">
                   <RouteGuard>
                     <Outlet />
                   </RouteGuard>
                 </div>
-                <Footer />
-              </div>
+              ) : (
+                <div className="mx-auto w-full px-3 pt-3">
+                  <div ref={pageRef}>
+                    <RouteGuard>
+                      <Outlet />
+                    </RouteGuard>
+                  </div>
+                  <Footer />
+                </div>
+              )}
             </main>
-            <MobileBottomNavbar />
+            {!phoneFullscreen && <MobileBottomNavbar />}
           </div>
         ) : (
           <div className="mx-auto w-full px-3 py-6">
```

- [ ] **Step 9: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/store/conversations.ts src/components/Conversation/NavBadges.tsx src/components/Conversation/CountsSync.tsx src/util/sections.ts src/util/sections.test.js src/layout/sheet-width.js src/layout/sheet-width.test.js src/layout/Navigation/menu.js src/layout/Navbar.jsx src/layout/NavDrawer.jsx src/layout/MobileBottomNavbar.jsx src/layout/Root.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 10: Checkpoint** — no commit, no staging. With the module on, the menu item leads to the app's 404 page until Task 8 adds the route; with the module off (the default) nothing changes.

---

## Task 8: The «Диалоги» page — list, thread, contact pane, «Кто это?», «Новый пользователь»

The section itself (canvas A1/A2, B1–B5, C2): the list with queues, search and filters; the thread in messenger order (old on top, composer at the bottom, a short feed hugs the composer); the contact column with the linked person, the ticket block, open tickets of the company and the assignee; «Кто это?» for an unknown sender; «Новый пользователь» as the existing user form in a sheet over the thread. On the phone: the list, then the thread full-screen with «⋯» → the bottom sheet «Контакт и действия».

**Files:**
- Create: `frontend/src/components/Conversation/conversation-actions.ts` — POST actions with toasts
- Create: `frontend/src/components/Conversation/use-thread.ts` — the feed: older pages, `changedSince` poll, send, retry
- Create: `frontend/src/components/Conversation/QueueChips.tsx`, `ConversationRow.tsx`, `ConversationList.tsx`, `ListFilter.tsx` — the list column
- Create: `frontend/src/components/Conversation/MessageMedia.tsx`, `MessageBubble.tsx`, `SystemLine.tsx`, `MessagesPane.tsx` — the feed
- Create: `frontend/src/components/Conversation/ThreadHeader.tsx`, `Composer.tsx`, `DecisionPrompt.tsx` — around the feed
- Create: `frontend/src/components/Conversation/ContactChannelRow.tsx`, `ContactBlock.tsx`, `TicketBlock.tsx`, `OpenTickets.tsx`, `AssigneePicker.tsx`, `WhoIsThis.tsx`, `ThreadMenu.tsx`, `ContextPane.tsx`, `ContextSheet.tsx` — the contact column and its phone sheet
- Create: `frontend/src/components/Conversation/ConversationThread.tsx` — composition
- Create: `frontend/src/pages/Conversation/Inbox.tsx`, `Thread.tsx`, `NewUser.tsx` — routes
- Modify: `frontend/src/components/User/UserForm.jsx` (`onCreated`, `successTo`)
- Modify: `frontend/src/App.jsx` (routes, stage 1)

**Interfaces:**
- Consumes:
  - Task 4: `ChannelIcon`, `ChannelTile`, `CountPill`, `FilterChip dot`, `Combobox leading`, `displayTimeZone()`, all `types/conversation.ts` types, `bg-bubble-*` / `bg-media-placeholder` / `bg-voice-wave` colours.
  - Task 5: `QUEUES`, `waitLabel`, `timeOf`, `listTimeLabel`, `lastMessagePrefix`, `rowMeta`, `emptyListText`, `boundSinceLabel`, `systemLineParts`, `formatFileSize`, `voiceDuration`, `attachmentKindLabel`, `counterpartHandle`, `newCounterpartNote`, `linkAdvice`, `composerPlaceholder`, `phoneComposerHint`, `networkLabel`, `unknownLabel`, `splitPersonName`.
  - Task 6: `PAGE_SIZE`, `mergeMessages`, `nextCursor`, `changesQuery`, `hasNewInbound`, `threadRows`, `defaultDraftMessageIds`.
  - Task 7: `useConversationsStore` (all of it), `handle.phoneFullscreen`.
  - Task 1: `GET /api/identities/:id/candidates?q=`, `ticket.boundAt`.
  - P0 HTTP (docs/messaging.md §7): `GET /api/conversations/:id`, `GET /api/conversations/:id/messages` (`limit`, `before`+`beforeSeq`, `changedSince`+`afterId`), `POST …/seen`, `POST …/messages` (multipart `text`, `attachments`), `POST …/handled`, `POST /api/messages/:id/retry`, `POST …/assign {userId}`, `POST …/bind {ticketNum}`, `POST …/unbind`, `POST …/decision {action:"none"}`, `POST …/hide {hidden}`, `POST /api/identities/:id/link {userId}`, `POST /api/identities/:id/unlink`.
  - Catalog: `PageHeader`, `SearchBar`, `Field`, `SwitchField`, `Panel`, `HealthRow`, `PropRow`, `Spinner`, `FormOutlet` (+ `SHEET_LG`), `useDeferredRevalidate` (`components/app/use-refresh-route`), `monogramFor` (`components/app/monogram`), `WorkStatusAvatar`, `presence`, `ticket-state`, `load` (`store/form-data`), `useLiveTopic`, `usePulseStore.requestCadence`, `useMinuteTick`, `useCan`, toast store.
- Produces:
  - Routes: `/conversations` (`handle: { module: "messaging", can: { conversation: ["read"] } }`), child `:id` (`handle: { phoneFullscreen: true }`, loader → `ThreadData = { card: ConversationCard; page: MessagesPage }`, `shouldRevalidate` also true when a child sheet closes), grandchild `users/add` (`can: { user: ["manage"] }`, `SHEET_LG`, the existing `addUserAction`).
  - «Создать заявку» navigates relative to the thread: `tickets/add?conversation=<conversationId>&messages=<id1,id2,…>` — the route is added in Task 9 (until then it resolves to the 404 page inside the sheet).
  - «Вернуть в работу» links to `/tickets/<num>` with `state: { openAction: "backToWork" }` — Task 10 opens the action dialog from it.
  - `conversation-actions.ts`: `failureText(error: unknown, fallback: string): string`, `markHandled(id)`, `assignConversation(id, userId | null)`, `bindConversation(id, ticketNum)`, `unbindConversation(id)`, `answerNoTicket(id)`, `setHidden(id, hidden)`, `linkIdentity(identityId, userId, name)`, `unlinkIdentity(identityId)` — each `Promise<boolean>` (true on success; the toast is shown inside). Task 12 uses `failureText`.
  - `UserForm` props `{ onCreated?: (userId: string) => Promise<unknown> | void; successTo?: string }` — `onCreated` runs only for a newly created user, before the sheet closes.

- [ ] **Step 1: Actions and the feed hook**

`use-thread.ts` has no timer: while a thread is open it asks the pulse for a 3-second cadence (`requestCadence`) and, when topic `conversations` moves, polls `changedSince`, draining full pages with `afterId` (at most 10 rounds per wake-up).

`frontend/src/components/Conversation/conversation-actions.ts` (new file):

```ts
import { ApiError, api } from "@/lib/api";
import useToastStore from "@/store/toast-store";

/**
 * Действия с диалогом (docs/messaging.md, «Staff API»). Каждое — запрос и
 * тост: при отказе человек видит причину сервера («Диалог уже привязан к
 * заявке №56790»), а не общую фразу. Возвращает true, если получилось.
 */

const toast = (variant: "success" | "danger", message: string) =>
  useToastStore.getState().showToast(variant, message);

export const failureText = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.status < 500 ? error.message : fallback;

const run = async (
  request: () => Promise<unknown>,
  { done, failed }: { done?: string; failed: string },
) => {
  try {
    await request();
    if (done) toast("success", done);
    return true;
  } catch (error) {
    toast("danger", failureText(error, failed));
    return false;
  }
};

const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", body: body ?? {} });

export const markHandled = (id: string) =>
  run(() => post(`/api/conversations/${id}/handled`), {
    failed: "Не удалось отметить диалог",
  });

export const assignConversation = (id: string, userId: string | null) =>
  run(() => post(`/api/conversations/${id}/assign`, { userId }), {
    failed: "Не удалось назначить ответственного",
  });

export const bindConversation = (id: string, ticketNum: number) =>
  run(() => post(`/api/conversations/${id}/bind`, { ticketNum }), {
    done: `Диалог привязан к заявке №${ticketNum}`,
    failed: "Не удалось привязать диалог",
  });

export const unbindConversation = (id: string) =>
  run(() => post(`/api/conversations/${id}/unbind`), {
    done: "Диалог отвязан от заявки",
    failed: "Не удалось отвязать диалог",
  });

export const answerNoTicket = (id: string) =>
  run(() => post(`/api/conversations/${id}/decision`, { action: "none" }), {
    failed: "Не удалось ответить на вопрос о заявке",
  });

export const setHidden = (id: string, hidden: boolean) =>
  run(() => post(`/api/conversations/${id}/hide`, { hidden }), {
    done: hidden
      ? "Диалог скрыт — он в фильтре «Скрытые»"
      : "Диалог снова в очередях",
    failed: "Не удалось скрыть диалог",
  });

export const linkIdentity = (identityId: string, userId: string, name: string) =>
  run(() => post(`/api/identities/${identityId}/link`, { userId }), {
    done: `Собеседник связан: ${name}`,
    failed: "Не удалось связать собеседника",
  });

export const unlinkIdentity = (identityId: string) =>
  run(() => post(`/api/identities/${identityId}/unlink`), {
    done: "Собеседник отвязан от пользователя",
    failed: "Не удалось отвязать собеседника",
  });
```

`frontend/src/components/Conversation/use-thread.ts` (new file):

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import usePulseStore from "@/store/pulse";
import type {
  MessageRow,
  MessagesChanges,
  MessagesPage,
} from "@/types/conversation";
import {
  PAGE_SIZE,
  changesQuery,
  mergeMessages,
  nextCursor,
} from "@/util/conversation-thread";

// Опрос изменений дочитывает полные страницы подряд, но не бесконечно
const MAX_DRAIN_ROUNDS = 10;
// Открытая переписка просит пульс чаще: сообщение клиента видно за 3 с,
// а не за 10 (спека «Live»)
const THREAD_CADENCE_MS = 3_000;

type Cursor = { since: string; afterId: string | null };

/**
 * Лента одного диалога: первая страница из загрузчика маршрута, дальше —
 * изменения по `changedSince` (контракт docs/messaging.md §7), когда пульс
 * говорит, что тема «conversations» сдвинулась. Своего таймера нет: частоту
 * задаёт пульс, которому открытая переписка заказывает 3 с.
 *
 * `onChanged` получает изменившиеся сообщения — страница по ним решает,
 * перечитать ли карточку и отметить ли прочитанным.
 */
export const useThread = (
  conversationId: string,
  initial: MessagesPage,
  onChanged?: (changed: MessageRow[]) => void,
) => {
  const [messages, setMessages] = useState<MessageRow[]>(initial.items);
  const [hasOlder, setHasOlder] = useState(initial.items.length >= PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = useRef<Cursor>({ since: initial.serverTime, afterId: null });
  const currentId = useRef(conversationId);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // Другой диалог в том же компоненте (переход по строке списка) — лента с
  // нуля; тот же диалог с новыми данными загрузчика — слить
  useEffect(() => {
    if (currentId.current !== conversationId) {
      currentId.current = conversationId;
      setMessages(initial.items);
      setHasOlder(initial.items.length >= PAGE_SIZE);
      cursor.current = { since: initial.serverTime, afterId: null };
      return;
    }
    setMessages((current) => mergeMessages(current, initial.items));
  }, [conversationId, initial]);

  const poll = useCallback(async () => {
    const id = conversationId;
    let changed: MessageRow[] = [];
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      const page = await api<MessagesChanges>(
        `/api/conversations/${id}/messages?${changesQuery(cursor.current)}`,
      );
      // Пока ждали ответ, открыли другой диалог — чужое в ленту не льём
      if (currentId.current !== id) return [];
      changed = changed.concat(page.items);
      const next = nextCursor(page);
      cursor.current = { since: next.since, afterId: next.afterId };
      if (!next.drain) break;
    }
    if (changed.length) {
      setMessages((current) => mergeMessages(current, changed));
      onChangedRef.current?.(changed);
    }
    return changed;
  }, [conversationId]);

  useLiveTopic("conversations", poll);

  useEffect(
    () => usePulseStore.getState().requestCadence(THREAD_CADENCE_MS),
    [],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({
        before: oldest.sentAt,
        beforeSeq: String(oldest.seq),
        limit: String(PAGE_SIZE),
      });
      const page = await api<MessagesPage>(
        `/api/conversations/${conversationId}/messages?${params}`,
      );
      setMessages((current) => mergeMessages(current, page.items));
      setHasOlder(page.items.length >= PAGE_SIZE);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messages, loadingOlder]);

  /** Ответ из «Диалогов»: текст и файлы уходят multipart, строка — сразу в ленту. */
  const send = useCallback(
    async ({ text, files }: { text: string; files: File[] }) => {
      const body = new FormData();
      body.append("text", text);
      for (const file of files) body.append("attachments", file);
      const { message } = await api<{ message: MessageRow }>(
        `/api/conversations/${conversationId}/messages`,
        { method: "POST", body },
      );
      setMessages((current) => mergeMessages(current, [message]));
      return message;
    },
    [conversationId],
  );

  /** Повтор неотправленного ответа — статус «в очереди» возвращается сразу. */
  const retry = useCallback(async (messageId: string) => {
    const { message } = await api<{ message: MessageRow }>(
      `/api/messages/${messageId}/retry`,
      { method: "POST" },
    );
    setMessages((current) => mergeMessages(current, [message]));
  }, []);

  return { messages, hasOlder, loadingOlder, loadOlder, poll, send, retry };
};
```

- [ ] **Step 2: The list column**

Chips are `FilterChip md` on the desktop header and `sm` on the phone; a group title gets a 15 px group glyph; «ждёт N мин» re-renders with `useMinuteTick`. The filter popover (phone: bottom sheet) holds «Компания» (the ticket form's company list, cached by `store/form-data`) and «Скрытые диалоги».

`frontend/src/components/Conversation/QueueChips.tsx` (new file):

```tsx
import FilterChip from "@/components/app/FilterChip";
import { cn } from "@/lib/utils";
import useConversationsStore from "@/store/conversations";
import { QUEUES } from "@/util/conversation-format";

type BaseQueue = "awaiting" | "mine" | "unbound" | "all";

/**
 * Очереди «Диалогов» чипами со счётчиками (канва A1 — `md`, B1 — `sm`).
 * Пока включён фильтр «Скрытые», ни один чип не горит: показана пятая,
 * служебная очередь; нажатие на чип её снимает.
 */
const QueueChips = ({
  size = "md",
  className,
}: {
  size?: "md" | "sm";
  className?: string;
}) => {
  const queue = useConversationsStore((state) => state.queue);
  const hidden = useConversationsStore((state) => state.hidden);
  const counts = useConversationsStore((state) => state.counts);
  const setQueue = useConversationsStore((state) => state.setQueue);

  return (
    <div
      role="group"
      aria-label="Очереди"
      className={cn(
        "flex items-center",
        size === "md" ? "gap-2" : "gap-1.5",
        className,
      )}
    >
      {QUEUES.map((item) => (
        <FilterChip
          key={item.value}
          size={size}
          dot={item.dot as "warning" | "none"}
          active={!hidden && queue === item.value}
          count={counts?.[item.value as BaseQueue] ?? null}
          onClick={() => setQueue(item.value as BaseQueue)}
          className="flex-none"
        >
          {item.label}
        </FilterChip>
      ))}
    </div>
  );
};

export default QueueChips;
```

`frontend/src/components/Conversation/ConversationRow.tsx` (new file):

```tsx
import { Link } from "react-router";
import { RiGroupLine } from "react-icons/ri";

import CountPill from "@/components/app/CountPill";
import { cn } from "@/lib/utils";
import type { ConversationRow as Row } from "@/types/conversation";
import {
  lastMessagePrefix,
  listTimeLabel,
  networkLabel,
  rowMeta,
  waitLabel,
} from "@/util/conversation-format";

import { ChannelTile } from "./ChannelGlyph";

/**
 * Строка списка «Диалогов» (канва A1, B1): плитка канала фирменного цвета ·
 * имя и время · последнее сообщение с подписью «Вы» / «с телефона» / автор
 * в группе · компания и номер заявки, «ждёт N мин» янтарём и непрочитанное.
 * Плитка здесь различает строки — канал разный у соседей (правило плитки
 * списка), поэтому она есть.
 */
const ConversationRow = ({
  row,
  first,
  selected,
  phone = false,
  now,
  timeZone,
  myName,
}: {
  row: Row;
  first: boolean;
  selected: boolean;
  phone?: boolean;
  now: Date;
  timeZone: string;
  myName: string;
}) => {
  const prefix = lastMessagePrefix(row.lastMessage, { kind: row.kind, myName });
  const meta = rowMeta(row);

  return (
    <Link
      to={`/conversations/${row.id}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-accent hover:text-foreground",
        selected && "bg-primary/10 hover:bg-primary/10",
      )}
    >
      {!first && (
        <span
          aria-hidden
          className="absolute top-0 right-0 left-4 h-px bg-border-soft"
        />
      )}
      <ChannelTile
        network={row.network}
        iconSize={20}
        className={cn("rounded-xl", phone ? "size-11" : "size-10")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-base leading-6",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {row.kind === "group" && (
              <RiGroupLine
                size={15}
                aria-hidden
                className="me-1.5 inline-block align-[-2px] text-muted-foreground"
              />
            )}
            {row.title || networkLabel(row.network)}
          </span>
          <span className="flex-none text-xs text-faint tabular-nums">
            {listTimeLabel(row.lastMessage?.at, { now, timeZone })}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {prefix && <span className="text-foreground">{prefix}: </span>}
          {row.lastMessage?.preview ?? ""}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            {meta.map((part, index) => (
              <span key={`${part.text}-${index}`}>
                {index > 0 && <span className="text-faint"> · </span>}
                <span
                  className={
                    part.tone === "muted" ? "text-muted-foreground" : "text-faint"
                  }
                >
                  {part.text}
                </span>
              </span>
            ))}
          </span>
          {row.awaitingSince && (
            <span className="flex-none font-semibold whitespace-nowrap text-warning-text">
              ждёт {waitLabel(row.awaitingSince, now)}
            </span>
          )}
          {row.unread > 0 && <CountPill>{row.unread}</CountPill>}
        </div>
      </div>
    </Link>
  );
};

export default ConversationRow;
```

`frontend/src/components/Conversation/ConversationList.tsx` (new file):

```tsx
import { useShallow } from "zustand/react/shallow";

import Spinner from "@/components/app/Spinner";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { useAuthedUser } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import { emptyListText } from "@/util/conversation-format";
import { displayTimeZone } from "@/util/format-date";

import ConversationRow from "./ConversationRow";

/**
 * Список «Диалогов»: строки, «Показать ещё» по курсору сервера, пустые
 * состояния по очереди. Живёт в своей прокрутке (панель слева на десктопе,
 * карточка-список на телефоне); данные — store/conversations.
 */
const ConversationList = ({
  selectedId = null,
  phone = false,
}: {
  selectedId?: string | null;
  phone?: boolean;
}) => {
  const { items, status, nextBefore, loadingMore, loadMore, queue, hidden, q } =
    useConversationsStore(
      useShallow((state) => ({
        items: state.items,
        status: state.status,
        nextBefore: state.nextBefore,
        loadingMore: state.loadingMore,
        loadMore: state.loadMore,
        queue: state.queue,
        hidden: state.hidden,
        q: state.q,
      })),
    );
  // «ждёт 12 мин» и время строк идут вместе с часами
  const now = useMinuteTick();
  const timeZone = displayTimeZone();
  const me = useAuthedUser();
  const myName = `${me.lastName ?? ""} ${me.firstName ?? ""}`.trim();

  if (!items.length) {
    if (status === "loading" || status === "idle") {
      return <Spinner className="min-h-40" size={32} />;
    }
    return (
      <p className="my-0 px-4 py-10 text-center text-sm text-muted-foreground">
        {status === "error"
          ? "Список не загрузился — обновите страницу"
          : emptyListText({ queue, hidden, q })}
      </p>
    );
  }

  return (
    <>
      {items.map((row, index) => (
        <ConversationRow
          key={row.id}
          row={row}
          first={index === 0}
          selected={row.id === selectedId}
          phone={phone}
          now={now}
          timeZone={timeZone}
          myName={myName}
        />
      ))}
      {nextBefore && (
        <div className="border-t border-border-soft p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Загрузка…" : "Показать ещё"}
          </Button>
        </div>
      )}
    </>
  );
};

export default ConversationList;
```

`frontend/src/components/Conversation/ListFilter.tsx` (new file):

```tsx
import { useEffect, useState } from "react";
import { RiFilter3Line } from "react-icons/ri";

import Combobox, { toOptions } from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import useConversationsStore from "@/store/conversations";
import { load } from "@/store/form-data";

type Company = { _id: string; alias: string };

/**
 * Фильтры списка «Диалогов» за кнопкой-иконкой (канва A1, B1): компания и
 * «Скрытые» — диалоги, убранные кнопкой «Скрыть диалог» (спам, ошибся
 * номером). Очереди остаются чипами: они и есть главный выбор.
 * Справочник компаний — тот же, что у формы заявки (кэш store/form-data).
 */
const FilterBody = () => {
  const company = useConversationsStore((state) => state.company);
  const hidden = useConversationsStore((state) => state.hidden);
  const setCompany = useConversationsStore((state) => state.setCompany);
  const setHidden = useConversationsStore((state) => state.setHidden);
  const resetFilters = useConversationsStore((state) => state.resetFilters);
  const [companies, setCompanies] = useState<Company[] | null>(null);

  useEffect(() => {
    let alive = true;
    load<{ companies?: Company[] }>("/api/tickets/form-data")
      .then((data) => {
        if (alive) setCompanies(data.companies ?? []);
      })
      .catch(() => {
        if (alive) setCompanies([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col">
      <Field label="Компания" htmlFor="conversations-company">
        <Combobox
          id="conversations-company"
          value={company}
          onChange={setCompany}
          options={toOptions(companies ?? [], {
            value: (item) => String(item._id),
            label: (item) => item.alias,
          })}
          loading={companies === null}
          clearable
          clearLabel="Все компании"
          placeholder="Все компании"
          searchPlaceholder="Найти компанию…"
          emptyText="Компания не нашлась."
        />
      </Field>
      <SwitchField
        id="conversations-hidden"
        label="Скрытые диалоги"
        hint="Те, что убрали кнопкой «Скрыть диалог»"
        checked={hidden}
        onCheckedChange={setHidden}
      />
      <Button
        variant="outline"
        className="mt-4 w-full"
        disabled={!company && !hidden}
        onClick={resetFilters}
      >
        Сбросить
      </Button>
    </div>
  );
};

const ListFilter = ({ phone = false }: { phone?: boolean }) => {
  const active = useConversationsStore(
    (state) => Boolean(state.company) || state.hidden,
  );
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button
      variant="outline"
      size="icon"
      aria-label="Фильтры"
      title="Фильтры"
      className={cn(
        "relative",
        active && "border-primary text-accent-text hover:text-accent-text",
      )}
      onClick={phone ? () => setOpen(true) : undefined}
    >
      <RiFilter3Line />
      {active && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card"
        />
      )}
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
          >
            <SheetTitle className="mb-4 text-lg font-semibold">Фильтры</SheetTitle>
            <SheetDescription className="sr-only">
              Компания и скрытые диалоги
            </SheetDescription>
            <FilterBody />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <FilterBody />
      </PopoverContent>
    </Popover>
  );
};

export default ListFilter;
```

- [ ] **Step 3: The feed — media, bubbles, system lines, pane**

Photos render as a background (`index.css` forces `img { width/height: auto !important }` for ticket images). The pane sticks to the bottom while the reader is within 80 px of it and offers «Показать раньше» for older pages.

`frontend/src/components/Conversation/MessageMedia.tsx` (new file):

```tsx
import { useEffect, useRef, useState } from "react";
import {
  RiAttachment2,
  RiImageLine,
  RiPauseFill,
  RiPlayFill,
} from "react-icons/ri";

import { cn } from "@/lib/utils";
import type { MessageAttachment } from "@/types/conversation";
import {
  attachmentKindLabel,
  formatFileSize,
  voiceDuration,
} from "@/util/conversation-format";

/**
 * Вложения сообщения в пузыре «Диалогов» (канва A1): фото, голосовое, файл.
 * Файл сообщения шлюз кладёт в хранилище; пока он не загружен (история,
 * крупный файл — `skipped`), вместо него заглушка с видом и размером.
 */

const uploadUrl = (name: string) =>
  `${import.meta.env.VITE_API_ADDRESS ?? ""}/uploads/${name}`;

// Полосы голосового — рисунок, а не спектр: звук мы не разбираем
const WAVE = [6, 10, 16, 12, 20, 24, 14, 9, 18, 22, 26, 16, 11, 7, 13, 19, 23, 17, 12, 8, 15, 21, 13, 9, 6, 11, 15, 9, 5];

const placeholderLabel = (kind: string, attachment: MessageAttachment) => {
  if (attachment.status === "failed") {
    return `${attachmentKindLabel(kind)} не загрузилось`;
  }
  const size = formatFileSize(attachment.size);
  return size ? `${attachmentKindLabel(kind)} · ${size}` : attachmentKindLabel(kind);
};

/** Фото или его заглушка. Фон, а не <img>: глобальный хак картинок заявок в
 *  index.css (`img { width/height: auto !important }`) ломает размеры. */
export const PhotoAttachment = ({
  attachment,
  kind,
  compact = false,
}: {
  attachment: MessageAttachment;
  kind: string;
  compact?: boolean;
}) => {
  const box = compact ? "h-28 w-50" : "h-31 w-55";
  if (attachment.status !== "ready" || !attachment.name) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-[10px] bg-media-placeholder text-media-placeholder-fg",
          box,
        )}
      >
        <div className="flex flex-col items-center gap-1.5 text-xs">
          <RiImageLine size={26} aria-hidden />
          <span>{placeholderLabel(kind, attachment)}</span>
        </div>
      </div>
    );
  }
  return (
    <a
      href={uploadUrl(attachment.name)}
      target="_blank"
      rel="noreferrer"
      className="block"
    >
      <span
        role="img"
        aria-label={attachment.originalName || "Фото"}
        className={cn("block rounded-[10px] bg-cover bg-center", box)}
        style={{ backgroundImage: `url("${uploadUrl(attachment.name)}")` }}
      />
    </a>
  );
};

/** Голосовое: кнопка, полосы и длительность; проигрывает, когда файл есть. */
export const VoiceAttachment = ({
  attachment,
  compact = false,
}: {
  attachment: MessageAttachment;
  compact?: boolean;
}) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const ready = attachment.status === "ready" && Boolean(attachment.name);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  };

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!ready}
        aria-label={playing ? "Пауза" : "Прослушать голосовое"}
        title={ready ? undefined : placeholderLabel("voice", attachment)}
        className="grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-full border-0 bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {playing ? <RiPauseFill size={16} /> : <RiPlayFill size={16} />}
      </button>
      <span aria-hidden className="flex h-7 items-center gap-0.5">
        {(compact ? WAVE.slice(0, 20) : WAVE).map((height, index) => (
          <span
            key={index}
            className="w-0.75 flex-none rounded-xs bg-voice-wave"
            style={{ height }}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {voiceDuration(attachment.durationSec)}
      </span>
      {ready && (
        <audio
          ref={audio}
          src={uploadUrl(attachment.name)}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  );
};

/** Файл — чипом, как вложение в хронике заявки. */
export const FileAttachment = ({
  attachment,
  kind,
}: {
  attachment: MessageAttachment;
  kind: string;
}) => {
  const label = attachment.originalName || attachmentKindLabel(kind);
  const chip =
    "mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground no-underline";
  if (attachment.status !== "ready" || !attachment.name) {
    return (
      <span className={chip} title={placeholderLabel(kind, attachment)}>
        <RiAttachment2 size={13} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <a
      href={uploadUrl(attachment.name)}
      target="_blank"
      rel="noreferrer"
      className={cn(chip, "hover:bg-accent")}
    >
      <RiAttachment2 size={13} aria-hidden />
      <span className="truncate">{label}</span>
    </a>
  );
};

/** Фото — отдельной подложкой пузыря (без внутренних полей); прочее — в тексте. */
export const isPhotoMessage = (kind: string, attachments: MessageAttachment[]) =>
  kind === "photo" ||
  (attachments.length > 0 &&
    attachments.every((item) => item.mimetype?.startsWith("image/")));
```

`frontend/src/components/Conversation/MessageBubble.tsx` (new file):

```tsx
import {
  RiCheckboxLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiTimeLine,
} from "react-icons/ri";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import type { MessageRow } from "@/types/conversation";
import { timeOf } from "@/util/conversation-format";

import {
  FileAttachment,
  PhotoAttachment,
  VoiceAttachment,
  isPhotoMessage,
} from "./MessageMedia";

/**
 * Пузырь сообщения — мессенджерный порядок (решение владельца 24.09, канва A1,
 * вариант A): входящие слева на сером, наши справа на бирюзовом, время и
 * статус доставки в углу. Цитата — полосой сверху; номер заявки («№56801») —
 * только в группе, где сообщения разных заявок идут вперемешку.
 */

const StatusIcon = ({ status }: { status: MessageRow["status"] }) => {
  switch (status) {
    case "read":
      return (
        <span className="flex text-accent-text" title="Прочитано">
          <RiCheckDoubleLine size={16} aria-label="Прочитано" />
        </span>
      );
    case "delivered":
      return (
        <span className="flex" title="Доставлено">
          <RiCheckDoubleLine size={16} aria-label="Доставлено" />
        </span>
      );
    case "sent":
      return (
        <span className="flex" title="Отправлено">
          <RiCheckLine size={14} aria-label="Отправлено" />
        </span>
      );
    case "failed":
      return (
        <span className="flex text-destructive" title="Не доставлено">
          <RiErrorWarningLine size={14} aria-label="Не доставлено" />
        </span>
      );
    default:
      return (
        <span className="flex" title="В очереди">
          <RiTimeLine size={13} aria-label="В очереди" />
        </span>
      );
  }
};

const Body = ({
  message,
  compact,
}: {
  message: MessageRow;
  compact: boolean;
}) => {
  if (message.deletedAt) {
    return <p className="my-0 text-faint italic">Сообщение удалено</p>;
  }
  const photo = isPhotoMessage(message.kind, message.attachments);
  // Анкета формы сайта (карточка — P5): поля строками «Имя: …»
  const text =
    message.text ||
    (message.form?.fields ?? [])
      .map((field) => `${field.label}: ${field.value}`)
      .join("\n");
  return (
    <>
      {message.replyTo && (
        <div className="mb-1.5 border-l-2 border-primary/35 py-0.5 pl-2 text-xs">
          <div className="font-semibold text-accent-text">
            {message.replyTo.authorName}
          </div>
          <div
            className={cn(
              "truncate text-muted-foreground",
              compact ? "max-w-55" : "max-w-75",
            )}
          >
            {message.replyTo.text}
          </div>
        </div>
      )}
      {photo &&
        message.attachments.map((attachment, index) => (
          <PhotoAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind="photo"
            compact={compact}
          />
        ))}
      {message.kind === "voice" &&
        message.attachments.map((attachment, index) => (
          <VoiceAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            compact={compact}
          />
        ))}
      {text && (
        <p className={cn("my-0 whitespace-pre-wrap break-words", photo && "px-2 pt-1.5")}>
          {text}
        </p>
      )}
      {!photo &&
        message.kind !== "voice" &&
        message.attachments.map((attachment, index) => (
          <FileAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind={message.kind}
          />
        ))}
    </>
  );
};

const MessageBubble = ({
  message,
  side,
  gap,
  showAuthor,
  showName,
  group,
  compact = false,
  timeZone,
  canRetry,
  onRetry,
}: {
  message: MessageRow;
  side: "in" | "out";
  gap: number;
  showAuthor: boolean;
  showName: boolean;
  group: boolean;
  compact?: boolean;
  timeZone: string;
  canRetry: boolean;
  onRetry: (id: string) => void;
}) => {
  const photo = !message.deletedAt && isPhotoMessage(message.kind, message.attachments);
  const time = (
    <div
      className={cn(
        "mt-0.5 flex items-center justify-end gap-1 text-xs text-faint tabular-nums",
        photo && "px-2",
      )}
    >
      {message.editedAt && !message.deletedAt && <span>изменено</span>}
      {timeOf(message.sentAt, timeZone)}
      {side === "out" && <StatusIcon status={message.status} />}
    </div>
  );

  return (
    <div
      className={cn("flex", side === "out" ? "justify-end" : "justify-start")}
      style={{ marginTop: gap }}
    >
      <div className={compact ? "max-w-72.5" : "max-w-105"}>
        {showAuthor && (
          <div className="mr-1 mb-0.5 text-right text-xs text-muted-foreground">
            {message.author.name}
          </div>
        )}
        {showName && (
          <div className="mb-0.5 ml-1 text-xs font-semibold">
            {message.author.name}
          </div>
        )}
        <div
          className={cn(
            "text-sm text-foreground",
            side === "out"
              ? "rounded-[14px] rounded-br-sm bg-bubble-out"
              : "rounded-[14px] rounded-bl-sm bg-bubble-in",
            photo ? "p-1 pb-1.5" : "px-3 pt-2 pb-1.5",
          )}
        >
          <Body message={message} compact={compact} />
          {time}
        </div>
        {group && message.ticket && (
          <div className="mt-1 ml-1">
            <Link
              to={`/tickets/${message.ticket.num}`}
              className="inline-flex h-5 items-center gap-1 rounded-md bg-accent px-1.75 text-xs font-semibold text-muted-foreground no-underline hover:text-foreground"
            >
              <RiCheckboxLine size={12} aria-hidden />№{message.ticket.num}
            </Link>
          </div>
        )}
        {side === "out" && message.status === "failed" && (
          <div className="mt-1 mr-1 flex items-center justify-end gap-2 text-xs text-destructive">
            {/* Сырой текст ошибки шлюза — сотруднику во всплывающей подсказке */}
            <span title={message.error || undefined}>Не доставлено</span>
            {canRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-destructive underline-offset-2 hover:underline"
              >
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
```

`frontend/src/components/Conversation/SystemLine.tsx` (new file):

```tsx
import type { IconType } from "react-icons";
import {
  RiCheckLine,
  RiInformationLine,
  RiLinkM,
  RiLinkUnlink,
  RiUserLine,
} from "react-icons/ri";
import { Link } from "react-router";

import type { MessageRow } from "@/types/conversation";
import { systemLineParts } from "@/util/conversation-format";

/**
 * Системная строка ленты (канва A1): тонкие линии по краям, иконка бирюзой и
 * фраза с номером заявки ссылкой. `note` — строка без события (первая строка
 * ленты неопознанного собеседника, канва C2).
 */

const ICON: Record<string, IconType> = {
  ticketCreated: RiLinkM,
  bound: RiLinkM,
  bindingRestored: RiLinkM,
  attached: RiLinkM,
  unbound: RiLinkUnlink,
  bindingEnded: RiLinkUnlink,
  handled: RiCheckLine,
  assigned: RiUserLine,
};

const SystemLine = ({
  message,
  note,
  compact = false,
}: {
  message?: MessageRow;
  note?: string;
  compact?: boolean;
}) => {
  const Icon = message ? (ICON[message.event?.kind ?? ""] ?? RiInformationLine) : RiInformationLine;
  const parts = message
    ? systemLineParts(message.event, { compact })
    : [{ text: note ?? "" }];

  return (
    <div className="mt-3 mb-1.5 flex items-center gap-2.5 text-xs text-muted-foreground">
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
      <span className="inline-flex max-w-115 items-center gap-1.5 text-center">
        <Icon size={14} aria-hidden className="flex-none text-accent-text" />
        <span>
          {parts.map((part, index) =>
            part.ticket ? (
              <Link
                key={index}
                to={`/tickets/${part.ticket}`}
                className="font-semibold text-accent-text no-underline hover:underline"
              >
                №{part.ticket}
              </Link>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
    </div>
  );
};

export default SystemLine;
```

`frontend/src/components/Conversation/MessagesPane.tsx` (new file):

```tsx
import { useLayoutEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { cn } from "@/lib/utils";
import type { ConversationKind, MessageRow } from "@/types/conversation";
import { threadRows } from "@/util/conversation-thread";

import MessageBubble from "./MessageBubble";
import SystemLine from "./SystemLine";

// Ближе к низу, чем столько px, — человек читает последнее, и новое
// сообщение прокручивает ленту само; выше — читает историю, не мешаем
const STICK_PX = 80;

/**
 * Лента диалога: старые сверху, новые снизу, у короткой ленты сообщения
 * прижаты к полю ответа (канва A1). Своя прокрутка; «Показать раньше» —
 * страница истории, без прыжка ленты.
 */
const MessagesPane = ({
  conversationId,
  messages,
  kind,
  timeZone,
  compact = false,
  note,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  canRetry,
  onRetry,
  className,
}: {
  conversationId: string;
  messages: MessageRow[];
  kind: ConversationKind;
  timeZone: string;
  compact?: boolean;
  /** Строка перед первым сообщением (неопознанный собеседник, канва C2). */
  note?: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  canRetry: boolean;
  onRetry: (id: string) => void;
  className?: string;
}) => {
  const now = useMinuteTick();
  const rows = useMemo(
    () => threadRows(messages, { kind, timeZone, now }),
    [messages, kind, timeZone, now],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const snapshot = useRef({
    conversationId: "",
    firstId: "",
    lastId: "",
    height: 0,
    nearBottom: true,
  });

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const previous = snapshot.current;
    const firstId = messages[0]?.id ?? "";
    const lastId = messages[messages.length - 1]?.id ?? "";
    if (previous.conversationId !== conversationId) {
      node.scrollTop = node.scrollHeight;
    } else if (previous.firstId !== firstId && previous.lastId === lastId) {
      // Приехала история сверху — держим то, что человек видел
      node.scrollTop += node.scrollHeight - previous.height;
    } else if (previous.lastId !== lastId && previous.nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
    snapshot.current = {
      conversationId,
      firstId,
      lastId,
      height: node.scrollHeight,
      nearBottom:
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX,
    };
  }, [conversationId, messages]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    snapshot.current.nearBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
    snapshot.current.height = node.scrollHeight;
  };

  // Строка неопознанного собеседника — после первой метки дня
  let noteShown = false;

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
    >
      <div
        className={cn(
          "mt-auto flex flex-col",
          compact ? "px-3 pt-3 pb-3" : "px-5 pt-3 pb-4",
        )}
      >
        {hasOlder && (
          <div className="mb-2 text-center">
            <Button
              variant="ghost"
              size="xs"
              disabled={loadingOlder}
              onClick={onLoadOlder}
            >
              {loadingOlder ? "Загрузка…" : "Показать раньше"}
            </Button>
          </div>
        )}
        {rows.map((row) => {
          if (row.type === "day") {
            const withNote = Boolean(note) && !noteShown;
            noteShown = noteShown || withNote;
            return (
              <div key={row.key}>
                <div className="flex items-center gap-2.5 py-1 text-xs font-bold tracking-wider text-faint uppercase">
                  {row.label}
                  <span aria-hidden className="h-px flex-1 bg-border-soft" />
                </div>
                {withNote && <SystemLine note={note} />}
              </div>
            );
          }
          if (row.type === "system") {
            return (
              <SystemLine key={row.key} message={row.message} compact={compact} />
            );
          }
          return (
            <MessageBubble
              key={row.key}
              message={row.message}
              side={row.side}
              gap={row.gap}
              showAuthor={row.showAuthor}
              showName={row.showName}
              group={kind === "group"}
              compact={compact}
              timeZone={timeZone}
              canRetry={canRetry}
              onRetry={onRetry}
            />
          );
        })}
        {!rows.length && (
          <p className="my-6 text-center text-sm text-muted-foreground">
            Сообщений пока нет
          </p>
        )}
      </div>
    </div>
  );
};

export default MessagesPane;
```

- [ ] **Step 4: Header, composer, the «closed ticket» question**

Enter sends, Shift+Enter breaks the line (desktop); the phone composer is a 44 px row. «Ответ не нужен» clears «ждёт ответа» (`POST …/handled`).

`frontend/src/components/Conversation/ThreadHeader.tsx` (new file):

```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";
import { RiGroupLine } from "react-icons/ri";

import { ticketTone } from "@/components/Ticket/ticket-state";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { plural } from "@/util/plural";
import {
  counterpartHandle,
  networkLabel,
  waitLabel,
} from "@/util/conversation-format";

import { ChannelIcon } from "./ChannelGlyph";

/**
 * Шапка переписки (канва A1 — 64 px, B2 — плотная для телефона): имя, строка
 * «Telegram · @ник · ждёт ответа 12 мин» и действия справа.
 */
const ThreadHeader = ({
  card,
  now,
  compact = false,
  children,
}: {
  card: ConversationCard;
  now: Date;
  compact?: boolean;
  /** Действия справа: номер заявки или «Создать заявку», «⋯». */
  children?: ReactNode;
}) => {
  const { conversation, counterpart, participants } = card;
  const group = conversation.kind === "group";
  const parts: ReactNode[] = [
    <span key="net" className="inline-flex items-center gap-1.5">
      <ChannelIcon network={conversation.network} size={compact ? 13 : 14} />
      {networkLabel(conversation.network)}
    </span>,
  ];
  if (group) {
    parts.push(
      <span key="group">
        группа · {participants.length}{" "}
        {plural(participants.length, "участник", "участника", "участников")}
      </span>,
    );
  } else if (!compact && counterpartHandle(counterpart)) {
    parts.push(<span key="handle">{counterpartHandle(counterpart)}</span>);
  }
  if (conversation.awaitingSince) {
    parts.push(
      <span key="wait" className="font-semibold text-warning-text">
        ждёт ответа {waitLabel(conversation.awaitingSince, now)}
      </span>,
    );
  }

  return (
    <div
      className={cn(
        "flex flex-none items-center gap-2.5",
        compact
          ? "min-h-13 px-3 pt-1 pb-2.5"
          : "min-h-16 border-b border-border-soft ps-5 pe-4",
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="my-0 truncate text-base leading-6 font-semibold">
          {group && (
            <RiGroupLine
              size={16}
              aria-hidden
              className="me-1.5 inline-block align-[-2px] text-muted-foreground"
            />
          )}
          {conversation.title || networkLabel(conversation.network)}
        </h2>
        <div
          className={cn(
            "flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {parts.map((part, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 && <span className="text-faint">·</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
};

/** Номер привязанной заявки со статусом — ссылкой на карточку (канва A1). */
export const TicketChip = ({
  num,
  state,
  small = false,
}: {
  num: number;
  state?: string | null;
  small?: boolean;
}) => {
  const tone = state ? ticketTone({ state }) : null;
  const Glyph = tone?.glyph;
  return (
    <Link
      to={`/tickets/${num}`}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-lg border border-border font-semibold whitespace-nowrap text-foreground no-underline hover:bg-accent hover:text-foreground",
        small ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
      )}
    >
      {Glyph && <Glyph size={16} aria-hidden className="text-muted-foreground" />}
      №{num}
      {!small && tone && (
        <span className="font-normal text-muted-foreground">{tone.label}</span>
      )}
    </Link>
  );
};

export default ThreadHeader;
```

`frontend/src/components/Conversation/Composer.tsx` (new file):

```tsx
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { RiAttachment2, RiSendPlane2Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";
import {
  composerPlaceholder,
  phoneComposerHint,
} from "@/util/conversation-format";

import { failureText } from "./conversation-actions";

/**
 * Поле ответа внизу переписки (канва A1 — десктоп, B2 — телефон). Enter
 * отправляет, Shift+Enter — новая строка (на телефоне Enter — строка, как в
 * мессенджерах). «Ответ не нужен» — только пока диалог ждёт: снимает ожидание
 * без ответа, в ленте остаётся системная строка.
 */
const Composer = ({
  network,
  ticketNum,
  awaiting,
  phone = false,
  onSend,
  onHandled,
}: {
  network: string;
  ticketNum: number | null;
  awaiting: boolean;
  phone?: boolean;
  onSend: (draft: { text: string; files: File[] }) => Promise<unknown>;
  onHandled: () => Promise<unknown>;
}) => {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const inputId = phone ? "conversation-files-phone" : "conversation-files";
  const empty = !text.trim() && files.length === 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (empty || sending) return;
    setSending(true);
    try {
      await onSend({ text: text.trim(), files });
      setText("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      // Текст остаётся в поле — повторить можно тем же нажатием
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось отправить сообщение"));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (phone) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const fileButton = (
    <>
      <input
        ref={fileInput}
        id={inputId}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => setFiles([...(event.target.files ?? [])])}
      />
      {phone ? (
        <Button asChild variant="ghost" size="icon-lg" className="relative">
          <label htmlFor={inputId} aria-label="Файл" className="cursor-pointer">
            <RiAttachment2 size={20} />
            {files.length > 0 && (
              <span className="absolute top-0.5 right-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground">
                {files.length}
              </span>
            )}
          </label>
        </Button>
      ) : (
        <Button asChild variant="outline" size="xs">
          <label htmlFor={inputId} className="cursor-pointer">
            <RiAttachment2 />
            {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
          </label>
        </Button>
      )}
    </>
  );

  if (phone) {
    return (
      <form
        onSubmit={submit}
        className="flex-none border-t border-border-soft bg-card px-3 pt-2 pb-3"
      >
        <div className="mb-1.5 text-xs text-faint">
          {phoneComposerHint(network, ticketNum)}
        </div>
        <div className="flex items-end gap-2">
          {fileButton}
          <Textarea
            rows={1}
            value={text}
            placeholder="Сообщение"
            aria-label="Сообщение"
            onChange={(event) => setText(event.target.value)}
            className="max-h-32 min-h-11 resize-none rounded-lg py-2.5 text-base"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Отправить"
            disabled={empty || sending}
          >
            <RiSendPlane2Line size={20} />
          </Button>
        </div>
        {awaiting && (
          <div className="mt-1.5 text-right">
            <Button type="button" variant="ghost" size="xs" onClick={() => void onHandled()}>
              Ответ не нужен
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex-none border-t border-border-soft px-4 py-3">
      <Textarea
        rows={2}
        value={text}
        placeholder={composerPlaceholder(network, ticketNum)}
        aria-label="Сообщение"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-40 resize-none rounded-lg bg-card"
      />
      <div className="mt-2 flex items-center gap-2">
        {fileButton}
        <span className="truncate text-xs whitespace-nowrap text-faint max-xl:hidden">
          Enter — отправить, Shift+Enter — новая строка
        </span>
        <span className="flex-1" />
        {awaiting && (
          <Button type="button" variant="ghost" size="xs" onClick={() => void onHandled()}>
            Ответ не нужен
          </Button>
        )}
        <Button
          type="submit"
          size="xs"
          disabled={empty || sending}
          className={cn(sending && "cursor-wait")}
        >
          <RiSendPlane2Line />
          {sending ? "Отправка…" : "Отправить"}
        </Button>
      </div>
    </form>
  );
};

export default Composer;
```

`frontend/src/components/Conversation/DecisionPrompt.tsx` (new file):

```tsx
import { Link } from "react-router";

import HealthRow from "@/components/app/HealthRow";
import { Button } from "@/components/ui/button";

/**
 * Клиент написал после закрытия привязанной заявки — вопрос «о ней?» над
 * полем ответа (спека «Chat ↔ ticket»). «Вернуть в работу» открывает карточку
 * заявки сразу с её диалогом возврата (там причина и права), «Новая заявка» —
 * форма заявки из диалога, «Без заявки» закрывает вопрос навсегда для этого
 * закрытия.
 */
const DecisionPrompt = ({
  ticketNum,
  canManage,
  onNewTicket,
  onNoTicket,
}: {
  ticketNum: number;
  canManage: boolean;
  onNewTicket: () => void;
  onNoTicket: () => void;
}) => (
  <HealthRow
    state="warning"
    title={`По заявке №${ticketNum} (закрыта)?`}
    hint="Клиент написал после закрытия заявки"
    className="flex-none"
    action={
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="xs">
          <Link
            to={`/tickets/${ticketNum}`}
            state={{ openAction: "backToWork" }}
          >
            Вернуть в работу
          </Link>
        </Button>
        <Button variant="outline" size="xs" onClick={onNewTicket}>
          Новая заявка
        </Button>
        {canManage && (
          <Button variant="ghost" size="xs" onClick={onNoTicket}>
            Без заявки
          </Button>
        )}
      </div>
    }
  />
);

export default DecisionPrompt;
```

- [ ] **Step 5: Contact column pieces**

The linked person's e-mail and phone (the card's `contact`) appear only in this staff-only section; they are copied with a button, not opened as `mailto:`/`tel:` links. «Привязать» on an open ticket appears only while the chat is unbound and direct (the server answers 409 otherwise).

`frontend/src/components/Conversation/ContactChannelRow.tsx` (new file):

```tsx
import type { ReactNode } from "react";
import { RiFileCopyLine } from "react-icons/ri";

import { copyText } from "@/components/app/PropRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChannelTile } from "./ChannelGlyph";

/**
 * Строка канала связи в карточке собеседника (канва A1, B3): плитка канала,
 * подпись, значение и действие справа («Написать» — в другой диалог этого
 * человека, копирование — у почты и телефона). Текущий диалог обведён
 * бирюзой. Геометрия — как у каналов `User/ContactCard`.
 */
const ContactChannelRow = ({
  channel,
  label,
  value,
  current = false,
  big = false,
  action,
}: {
  channel: string;
  label: string;
  value: string;
  current?: boolean;
  big?: boolean;
  action?: ReactNode;
}) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-xl border p-1.5",
      current ? "border-primary/35" : "border-border",
    )}
  >
    <ChannelTile
      network={channel}
      iconSize={18}
      neutralClassName="bg-primary/15 text-accent-text"
      className="size-9 rounded-lg"
    />
    <span className="block min-w-0 flex-1">
      <span className="block text-xs text-faint">{label}</span>
      <span
        className={cn(
          "block truncate leading-5 font-medium tabular-nums",
          big ? "text-base" : "text-sm",
        )}
      >
        {value}
      </span>
    </span>
    {action}
  </div>
);

/** Кнопка копирования для строки канала: «Скопировать почту». */
export const CopyAction = ({
  value,
  label,
  what,
}: {
  value: string;
  /** Для тоста: «Почта скопирован» не скажем — «Адрес», «Телефон». */
  label: string;
  /** Для подсказки: «почту», «телефон». */
  what: string;
}) => (
  <Button
    variant="ghost"
    size="icon-xs"
    aria-label={`Скопировать ${what}`}
    title={`Скопировать ${what}`}
    className="text-faint hover:text-muted-foreground"
    onClick={() => copyText(value, label)}
  >
    <RiFileCopyLine />
  </Button>
);

export default ContactChannelRow;
```

`frontend/src/components/Conversation/ContactBlock.tsx` (new file):

```tsx
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { counterpartHandle, networkLabel } from "@/util/conversation-format";
import { monogramFor } from "@/components/app/monogram";

import ContactChannelRow, { CopyAction } from "./ContactChannelRow";

/**
 * Собеседник, связанный с пользователем HD (канва A1, B3): плитка с
 * инициалами, имя, «должность · компания» и каналы связи — этот диалог,
 * другие мессенджеры человека («Написать» открывает тот диалог), почта и
 * телефон с копированием. Телефон, уже показанный как номер мессенджера,
 * второй строкой не повторяется.
 */
const ContactBlock = ({
  card,
  big = false,
}: {
  card: ConversationCard;
  big?: boolean;
}) => {
  const { contact, counterpart, conversation, otherChannels } = card;
  if (!contact) return null;
  const handles = new Set(otherChannels.map((item) => item.handle));

  return (
    <>
      {/* В шторке справа крестик — имя до него не доходит */}
      <div className={cn("flex items-center", big ? "gap-4 pr-9" : "gap-3")}>
        <span
          aria-hidden
          className={cn(
            "grid flex-none place-items-center rounded-[25%] bg-accent font-semibold text-muted-foreground inset-ring inset-ring-border",
            big ? "size-15 text-xl" : "size-11 text-base",
          )}
        >
          {monogramFor(contact.name)}
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "truncate leading-6 font-semibold",
              big ? "text-lg" : "text-base",
            )}
          >
            {contact.name}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {[contact.position, contact.company].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className={cn("flex flex-col gap-2", big ? "mt-4.5" : "mt-3.5")}>
        {counterpart && (
          <ContactChannelRow
            channel={conversation.network}
            label={`${networkLabel(conversation.network)} · этот диалог`}
            value={counterpartHandle(counterpart) || counterpart.name}
            current
            big={big}
          />
        )}
        {otherChannels.map((item) => (
          <ContactChannelRow
            key={`${item.network}-${item.handle}`}
            channel={item.network}
            label={networkLabel(item.network)}
            value={item.handle || "—"}
            big={big}
            action={
              item.conversationId ? (
                <Button asChild variant="ghost" size={big ? "sm" : "xs"}>
                  <Link to={`/conversations/${item.conversationId}`}>Написать</Link>
                </Button>
              ) : undefined
            }
          />
        ))}
        {contact.email && (
          <ContactChannelRow
            channel="mail"
            label="Почта"
            value={contact.email}
            big={big}
            action={<CopyAction value={contact.email} label="Адрес" what="почту" />}
          />
        )}
        {contact.phone && !handles.has(contact.phone) && (
          <ContactChannelRow
            channel="phone"
            label="Телефон"
            value={contact.phone}
            big={big}
            action={<CopyAction value={contact.phone} label="Телефон" what="телефон" />}
          />
        )}
      </div>
    </>
  );
};

export default ContactBlock;
```

`frontend/src/components/Conversation/TicketBlock.tsx` (new file):

```tsx
import { Link } from "react-router";
import { RiArrowRightLine, RiLinkUnlink } from "react-icons/ri";

import { deadlineText, ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import type { ConversationCard } from "@/types/conversation";
import { boundSinceLabel } from "@/util/conversation-format";

/**
 * Привязанная заявка в колонке собеседника (канва A1, B3): номер и «привязана
 * с 10:03», тема, статус и срок, ответственные; «Открыть заявку →» и
 * «Отвязать». Заявка вне яруса читателя приходит без подробностей
 * (`card.ticket` пуст) — тогда только номер.
 */
const TicketBlock = ({
  card,
  canManage,
  now,
  timeZone,
  onUnbind,
}: {
  card: ConversationCard;
  canManage: boolean;
  now: Date;
  timeZone: string;
  onUnbind: () => void;
}) => {
  const bound = card.conversation.ticket;
  if (!bound) return null;
  const ticket = card.ticket;
  const tone = ticket ? ticketTone({ state: ticket.state }) : null;
  const Glyph = tone?.glyph;

  return (
    <div className="rounded-xl border border-border px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          {bound.num}
        </span>
        {ticket?.boundAt && (
          <span className="ms-auto text-xs text-faint">
            {boundSinceLabel(ticket.boundAt, { now, timeZone })}
          </span>
        )}
      </div>
      {ticket && (
        <>
          <div className="mt-0.5 text-sm font-medium">{ticket.title}</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            {Glyph && <Glyph size={16} aria-hidden />}
            {tone?.label}
            <span className="text-faint">·</span>
            {deadlineText(ticket.deadline)}
          </div>
          {ticket.responsibles.length > 0 && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              {ticket.responsibles.join(", ")}
            </div>
          )}
        </>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Link
          to={`/tickets/${bound.num}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text no-underline hover:underline"
        >
          Открыть заявку
          <RiArrowRightLine size={16} aria-hidden />
        </Link>
        <span className="flex-1" />
        {canManage && (
          <Button variant="ghost" size="xs" onClick={onUnbind}>
            <RiLinkUnlink />
            Отвязать
          </Button>
        )}
      </div>
    </div>
  );
};

export default TicketBlock;
```

`frontend/src/components/Conversation/OpenTickets.tsx` (new file):

```tsx
import { Link } from "react-router";
import { RiLinkM } from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";

/**
 * Открытые заявки компании собеседника (канва A1): номер, тема, статус
 * глифом; «Привязать» — пока личный чат ни к чему не привязан (привязанный
 * сервер к другой открытой заявке не пустит — 409).
 */
const OpenTickets = ({
  card,
  canBind,
  onBind,
}: {
  card: ConversationCard;
  canBind: boolean;
  onBind: (num: number) => void;
}) => {
  const tickets = card.openTickets;
  if (!tickets.length) return null;
  const company = card.contact?.company || card.conversation.company?.alias || "";

  return (
    <>
      <SubLabel className="mt-5" count={tickets.length}>
        {company ? `Открытые заявки ${company}` : "Открытые заявки"}
      </SubLabel>
      {tickets.map((ticket, index) => {
        const tone = ticketTone({ state: ticket.state });
        const Glyph = tone.glyph;
        return (
          <div
            key={ticket.id}
            className={cn(
              "flex items-center gap-2.5 py-2",
              index > 0 && "border-t border-border-soft",
            )}
          >
            <span className="flex-none self-start text-sm font-medium text-muted-foreground tabular-nums">
              {ticket.num}
            </span>
            <span className="min-w-0 flex-1">
              <Link
                to={`/tickets/${ticket.num}`}
                className="block truncate text-sm text-foreground no-underline hover:underline"
              >
                {ticket.title}
              </Link>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  tone.tone === "warn" ? "text-warning-text" : "text-muted-foreground",
                )}
              >
                <Glyph size={13} aria-hidden />
                {tone.label}
              </span>
            </span>
            {canBind && (
              <Button variant="outline" size="xs" onClick={() => onBind(ticket.num)}>
                <RiLinkM />
                Привязать
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
};

export default OpenTickets;
```

`frontend/src/components/Conversation/AssigneePicker.tsx` (new file):

```tsx
import { useEffect, useState, type ComponentType } from "react";

import Combobox from "@/components/app/Combobox";
import WorkStatusAvatarJs from "@/components/User/WorkStatusAvatar";
import { presenceLine } from "@/components/User/presence";
import { load } from "@/store/form-data";
import useWorkStatusesStore from "@/store/work-statuses";
import { getWorkStatusMeta } from "@/util/work-statuses";

// Граница типизации: компонент на JS, его пропсы TS выводит обязательными
const WorkStatusAvatar = WorkStatusAvatarJs as unknown as ComponentType<{
  firstName?: string;
  lastName?: string;
  profileImagePath?: string;
  workStatus?: { code?: string } | null;
  size?: number;
  showBadge?: boolean;
}>;

type Person = {
  _id: string;
  firstName?: string;
  lastName?: string;
};

type PresenceUser = Person & {
  profileImagePath?: string;
  workStatus?: { code?: string } | null;
};

/**
 * «Ответственный за диалог» (канва A1, B3): аватар с кольцом присутствия и имя
 * в поле; список — те, кто ведёт заявки, с присутствием подсказкой, как в
 * выборе ответственных заявки. Назначенный видит диалог всегда и получает
 * колокольчик «ждёт ответа» первым.
 */
const AssigneePicker = ({
  assignee,
  disabled,
  onChange,
}: {
  assignee: { id: string; name: string } | null;
  disabled: boolean;
  onChange: (userId: string | null) => void;
}) => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const presence = useWorkStatusesStore((state) => state.users) as PresenceUser[];

  useEffect(() => {
    let alive = true;
    load<Person[]>("/api/users/can-perform-tickets")
      .then((list) => {
        if (alive) setPeople(list);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const liveById = new Map(presence.map((user) => [String(user._id), user]));
  const options = (people ?? []).map((person) => {
    const live = liveById.get(String(person._id));
    const meta = live ? getWorkStatusMeta(live.workStatus?.code) : null;
    return {
      value: String(person._id),
      label: `${person.lastName ?? ""} ${person.firstName ?? ""}`.trim(),
      hint: live ? presenceLine(live) : undefined,
      dot: meta && meta.code !== "unset" ? meta.color : undefined,
    };
  });
  const selected = assignee ? liveById.get(assignee.id) : undefined;

  return (
    <Combobox
      value={assignee?.id ?? null}
      onChange={onChange}
      options={options}
      loading={people === null}
      disabled={disabled}
      clearable
      clearLabel="Не назначен"
      placeholder={assignee?.name ?? "Не назначен"}
      searchPlaceholder="Найти сотрудника…"
      emptyText="Сотрудник не нашёлся."
      ariaLabel="Ответственный за диалог"
      leading={
        assignee ? (
          <WorkStatusAvatar
            size={24}
            showBadge={false}
            firstName={selected?.firstName ?? assignee.name.split(" ")[1]}
            lastName={selected?.lastName ?? assignee.name.split(" ")[0]}
            profileImagePath={selected?.profileImagePath}
            workStatus={selected?.workStatus ?? null}
          />
        ) : undefined
      }
    />
  );
};

export default AssigneePicker;
```

- [ ] **Step 6: «Кто это?», the «⋯» menu, the pane and its phone sheet**

Linking is manual only («Это он» after a search) — never by the messenger name (spec «Identity»). «Новый пользователь» opens `users/add` relative to the thread.

`frontend/src/components/Conversation/WhoIsThis.tsx` (new file):

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  RiAddLine,
  RiEyeOffLine,
  RiSearchLine,
  RiUserLine,
} from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCan } from "@/store/authed-user";
import type { ConversationCard, IdentityCandidate } from "@/types/conversation";
import {
  counterpartHandle,
  linkAdvice,
  networkLabel,
} from "@/util/conversation-format";

import { linkIdentity, setHidden } from "./conversation-actions";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

/**
 * «Кто это?» — собеседник не связан ни с одним пользователем (канва C2).
 * Связать можно только руками: поиск пользователя → «Это он». Имя из
 * мессенджера ничего не доказывает, поэтому сами мы не связываем (спека
 * «Identity»). «Новый пользователь» — обычная форма пользователя поверх
 * диалога, после сохранения собеседник связывается с новым человеком.
 * «Скрыть диалог» — для спама и ошибшихся номером.
 */
const WhoIsThis = ({
  card,
  canManage,
  onLinked,
}: {
  card: ConversationCard;
  canManage: boolean;
  onLinked: () => void;
}) => {
  const { conversation, counterpart } = card;
  const navigate = useNavigate();
  const canManageUsers = useCan()({ user: ["manage"] });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<IdentityCandidate[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!counterpart || q.length < MIN_QUERY) {
      setFound(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api<{ items: IdentityCandidate[] }>(
        `/api/identities/${counterpart.identityId}/candidates?${new URLSearchParams({ q })}`,
      )
        .then((data) => {
          if (alive) setFound(data.items);
        })
        .catch(() => {
          if (alive) setFound([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, counterpart]);

  const link = async (person: IdentityCandidate) => {
    if (!counterpart) return;
    setLinking(person.id);
    const ok = await linkIdentity(counterpart.identityId, person.id, person.name);
    setLinking(null);
    if (ok) onLinked();
  };

  const hide = async () => {
    if (await setHidden(conversation.id, true)) navigate("/conversations");
  };

  const handle = counterpartHandle(counterpart);

  return (
    <>
      <SubLabel>Кто это?</SubLabel>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 flex-none place-items-center rounded-[25%] bg-accent text-muted-foreground inset-ring inset-ring-border"
        >
          <RiUserLine size={22} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-base leading-6 font-semibold">
            {conversation.title || counterpart?.name || "Собеседник"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {[networkLabel(conversation.network), handle].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      <p className="mt-3 mb-0 text-sm text-muted-foreground">
        {linkAdvice(conversation.network)}
      </p>

      {canManage && counterpart && (
        <>
          <label
            htmlFor="who-is-this-search"
            className="mt-3.5 mb-1.5 block text-sm font-semibold text-muted-foreground"
          >
            Найти пользователя
          </label>
          <div className="relative">
            <RiSearchLine
              size={16}
              aria-hidden
              className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              id="who-is-this-search"
              type="search"
              value={query}
              placeholder="Имя, телефон или почта"
              onChange={(event) => setQuery(event.target.value)}
              className="bg-card pl-9"
            />
          </div>
          <div className="mt-1.5">
            {found?.map((person, index) => (
              <div
                key={person.id}
                className={cn(
                  "flex items-center gap-2.5 py-2",
                  index > 0 && "border-t border-border-soft",
                )}
              >
                <span
                  aria-hidden
                  className="grid size-7 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border"
                >
                  {monogramFor(person.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{person.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[person.company, person.position].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={linking !== null}
                  onClick={() => void link(person)}
                >
                  Это он
                </Button>
              </div>
            ))}
            {found?.length === 0 && (
              <p className="my-2 text-xs text-faint">Никого не нашли</p>
            )}
          </div>
        </>
      )}

      {(canManage || canManageUsers) && (
        <div className="mt-3.5 flex flex-col gap-2 border-t border-border-soft pt-3.5">
          {canManage && canManageUsers && counterpart && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("users/add")}>
              <RiAddLine />
              Новый пользователь
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => void hide()}>
              <RiEyeOffLine />
              Скрыть диалог
            </Button>
          )}
        </div>
      )}
    </>
  );
};

export default WhoIsThis;
```

`frontend/src/components/Conversation/ThreadMenu.tsx` (new file):

```tsx
import { Link, useNavigate } from "react-router";
import { RiMoreLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCan } from "@/store/authed-user";
import type { ConversationCard } from "@/types/conversation";

import { setHidden, unlinkIdentity } from "./conversation-actions";

/** Пункты «Действий с диалогом» — одни и те же в меню «⋯» и в шторке телефона. */
export const useThreadActions = (
  card: ConversationCard,
  { canManage, onChanged }: { canManage: boolean; onChanged: () => void },
) => {
  const navigate = useNavigate();
  const canReadUsers = useCan()({ user: ["read"] });
  const { conversation, counterpart, contact } = card;
  const items: { key: string; label: string; to?: string; run?: () => void }[] = [];

  if (contact && canReadUsers) {
    items.push({ key: "profile", label: "Открыть профиль", to: `/users/${contact.id}` });
  }
  if (canManage && counterpart?.userId) {
    items.push({
      key: "unlink",
      label: "Отвязать собеседника",
      run: () =>
        void unlinkIdentity(counterpart.identityId).then((ok) => ok && onChanged()),
    });
  }
  if (canManage) {
    items.push({
      key: "hide",
      label: conversation.hidden ? "Вернуть в очереди" : "Скрыть диалог",
      run: () =>
        void setHidden(conversation.id, !conversation.hidden).then((ok) => {
          if (!ok) return;
          if (conversation.hidden) onChanged();
          else navigate("/conversations");
        }),
    });
  }
  return items;
};

/** «⋯» в шапке переписки на десктопе (канва A1). Нечего предложить — кнопки нет. */
const ThreadMenu = ({
  card,
  canManage,
  onChanged,
}: {
  card: ConversationCard;
  canManage: boolean;
  onChanged: () => void;
}) => {
  const items = useThreadActions(card, { canManage, onChanged });
  if (!items.length) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Действия с диалогом"
          title="Действия с диалогом"
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {items.map((item) =>
          item.to ? (
            <DropdownMenuItem key={item.key} asChild>
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.key} onSelect={item.run}>
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ThreadMenu;
```

`frontend/src/components/Conversation/ContextPane.tsx` (new file):

```tsx
import { RiGroupLine } from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { networkLabel } from "@/util/conversation-format";

import AssigneePicker from "./AssigneePicker";
import ContactBlock from "./ContactBlock";
import OpenTickets from "./OpenTickets";
import TicketBlock from "./TicketBlock";
import WhoIsThis from "./WhoIsThis";

/**
 * Колонка «Контакт и заявка» справа от переписки (канва A1, C2) и её же
 * содержимое в шторке телефона (B3, `big`):
 *   • собеседник связан — карточка с каналами, привязанная заявка, открытые
 *     заявки компании, ответственный за диалог;
 *   • не связан — «Кто это?»;
 *   • группа (выбор сообщений — этап P2) — участники и ответственный.
 */
export type ContextHandlers = {
  onBind: (ticketNum: number) => void;
  onUnbind: () => void;
  onAssign: (userId: string | null) => void;
  onLinked: () => void;
};

const Participants = ({ card }: { card: ConversationCard }) => (
  <>
    <SubLabel className="mt-5" count={card.participants.length}>
      Участники
    </SubLabel>
    {card.participants.map((person, index) => (
      <div
        key={person.identityId}
        className={cn(
          "flex items-center gap-2.5 py-2",
          index > 0 && "border-t border-border-soft",
        )}
      >
        <span
          aria-hidden
          className="grid size-7 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border"
        >
          {monogramFor(person.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{person.name}</div>
          {!person.userId && (
            <div className="truncate text-xs text-warning-text">
              не связан с пользователем HD
            </div>
          )}
        </div>
      </div>
    ))}
  </>
);

const ContextPane = ({
  card,
  canManage,
  big = false,
  now,
  timeZone,
  handlers,
}: {
  card: ConversationCard;
  canManage: boolean;
  big?: boolean;
  now: Date;
  timeZone: string;
  handlers: ContextHandlers;
}) => {
  const { conversation } = card;
  const assignee = (
    <>
      <SubLabel className="mt-5">Ответственный за диалог</SubLabel>
      <AssigneePicker
        assignee={conversation.assignee}
        disabled={!canManage}
        onChange={handlers.onAssign}
      />
    </>
  );

  if (conversation.kind === "group") {
    return (
      <>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 flex-none place-items-center rounded-[25%] bg-accent text-muted-foreground inset-ring inset-ring-border"
          >
            <RiGroupLine size={22} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-base leading-6 font-semibold">
              {conversation.title}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {networkLabel(conversation.network)} · группа
            </div>
          </div>
        </div>
        <Participants card={card} />
        {assignee}
      </>
    );
  }

  if (!card.contact) {
    return <WhoIsThis card={card} canManage={canManage} onLinked={handlers.onLinked} />;
  }

  return (
    <>
      <ContactBlock card={card} big={big} />
      {conversation.ticket && (
        <>
          <SubLabel className="mt-5">Заявка</SubLabel>
          <TicketBlock
            card={card}
            canManage={canManage}
            now={now}
            timeZone={timeZone}
            onUnbind={handlers.onUnbind}
          />
        </>
      )}
      <OpenTickets
        card={card}
        canBind={canManage && !conversation.ticket && conversation.kind === "direct"}
        onBind={handlers.onBind}
      />
      {assignee}
    </>
  );
};

export default ContextPane;
```

`frontend/src/components/Conversation/ContextSheet.tsx` (new file):

```tsx
import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * «Контакт и действия» на телефоне — нижняя шторка поверх переписки (канва
 * B3): то же содержимое, что колонка справа на десктопе, крупнее под палец.
 */
const ContextSheet = ({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="bottom"
      className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
    >
      <SheetTitle className="sr-only">{title}</SheetTitle>
      <SheetDescription className="sr-only">Контакт и действия</SheetDescription>
      {children}
    </SheetContent>
  </Sheet>
);

export default ContextSheet;
```

- [ ] **Step 7: The thread composition**

`frontend/src/components/Conversation/ConversationThread.tsx` (new file):

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { isMobile } from "react-device-detect";
import { RiAddLine, RiArrowLeftSLine, RiMoreLine } from "react-icons/ri";

import FormOutlet from "@/components/app/FormOutlet";
import HealthRow from "@/components/app/HealthRow";
import { useDeferredRevalidate } from "@/components/app/use-refresh-route";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { api } from "@/lib/api";
import { useCan } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import useToastStore from "@/store/toast-store";
import type { ConversationCard, MessagesPage } from "@/types/conversation";
import { newCounterpartNote } from "@/util/conversation-format";
import {
  defaultDraftMessageIds,
  hasNewInbound,
} from "@/util/conversation-thread";
import { displayTimeZone } from "@/util/format-date";

import Composer from "./Composer";
import ContextPane, { type ContextHandlers } from "./ContextPane";
import ContextSheet from "./ContextSheet";
import DecisionPrompt from "./DecisionPrompt";
import MessagesPane from "./MessagesPane";
import ThreadHeader, { TicketChip } from "./ThreadHeader";
import ThreadMenu, { useThreadActions } from "./ThreadMenu";
import {
  answerNoTicket,
  assignConversation,
  bindConversation,
  failureText,
  markHandled,
  unbindConversation,
} from "./conversation-actions";
import { useThread } from "./use-thread";

export type ThreadData = { card: ConversationCard; page: MessagesPage };

/**
 * Один диалог: переписка и колонка собеседника (канва A1), на телефоне —
 * экран-переписка и шторка «Контакт и действия» (B2, B3). Данные — загрузчик
 * маршрута (карточка + первая страница ленты); лента живёт в useThread,
 * карточка перечитывается, когда в ленте что-то изменилось, и после каждого
 * действия. Формы поверх диалога («Создать заявку», «Новый пользователь») —
 * вложенные маршруты в шторке (FormOutlet).
 */
const ConversationThread = () => {
  const { card, page } = useLoaderData() as ThreadData;
  const { conversation, channel } = card;
  const conversationId = conversation.id;
  const navigate = useNavigate();
  const revalidate = useDeferredRevalidate();
  const can = useCan();
  const canReply = can({ conversation: ["reply"] });
  const canManage = can({ conversation: ["manage"] });
  const now = useMinuteTick();
  const timeZone = displayTimeZone();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Отметка «прочитано»: при открытии и на каждое новое входящее, пока
  // вкладка видна. Строка списка гаснет сразу, не дожидаясь пульса
  const markSeen = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api(`/api/conversations/${conversationId}/seen`, { method: "POST" })
      .then(() => useConversationsStore.getState().markRead(conversationId))
      .catch((error) => console.warn("Отметка «прочитано» не удалась:", error));
  }, [conversationId]);

  const known = useRef<Set<string>>(new Set());
  const thread = useThread(conversationId, page, (changed) => {
    // Изменилась лента — могли измениться и ожидание, и привязка, и статус
    void revalidate();
    if (hasNewInbound(changed, known.current)) markSeen();
  });

  useEffect(() => {
    known.current = new Set(thread.messages.map((message) => message.id));
  }, [thread.messages]);

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  /** После своего действия: карточка, лента и список — сразу, не ждать пульса. */
  const refresh = useCallback(() => {
    void revalidate();
    thread.poll().catch(() => {});
    void useConversationsStore.getState().silentRefresh();
  }, [revalidate, thread]);

  const handlers: ContextHandlers = {
    onBind: (num) => void bindConversation(conversationId, num).then((ok) => ok && refresh()),
    onUnbind: () => void unbindConversation(conversationId).then((ok) => ok && refresh()),
    onAssign: (userId) =>
      void assignConversation(conversationId, userId).then((ok) => ok && refresh()),
    onLinked: refresh,
  };

  const createTicket = () => {
    const params = new URLSearchParams({
      conversation: conversationId,
      messages: defaultDraftMessageIds(thread.messages).join(","),
    });
    setSheetOpen(false);
    navigate(`tickets/add?${params}`);
  };

  const retry = (messageId: string) =>
    void thread.retry(messageId).catch((error) =>
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось повторить отправку")),
    );

  // «Создать заявку» — у личного чата без живой привязки. Группа (выбор
  // сообщений — этап P2) и форма сайта (P5) заявку отсюда не заводят
  const canCreateTicket = conversation.kind === "direct" && !conversation.ticket;

  const composer = !canReply ? null : conversation.network === "site" ? (
    <HealthRow
      state="info"
      title="Ответ на форму сайта появится вместе с почтовым ответом"
      className="flex-none"
    />
  ) : channel && !channel.isActive ? (
    <HealthRow
      state="info"
      title="Канал отключён — ответить через него нельзя"
      className="flex-none"
    />
  ) : (
    <Composer
      network={conversation.network}
      ticketNum={conversation.ticket?.num ?? null}
      awaiting={Boolean(conversation.awaitingSince)}
      phone={isMobile}
      onSend={async (draft) => {
        await thread.send(draft);
        refresh();
      }}
      onHandled={() => markHandled(conversationId).then((ok) => ok && refresh())}
    />
  );

  const decision = conversation.decision && (
    <DecisionPrompt
      ticketNum={conversation.decision.ticketNum}
      canManage={canManage}
      onNewTicket={createTicket}
      onNoTicket={() =>
        void answerNoTicket(conversationId).then((ok) => ok && refresh())
      }
    />
  );

  const messagesPane = (
    <MessagesPane
      conversationId={conversationId}
      messages={thread.messages}
      kind={conversation.kind}
      timeZone={timeZone}
      compact={isMobile}
      note={
        conversation.unknown && conversation.kind === "direct"
          ? newCounterpartNote(conversation.network)
          : undefined
      }
      hasOlder={thread.hasOlder}
      loadingOlder={thread.loadingOlder}
      onLoadOlder={() => void thread.loadOlder()}
      canRetry={canReply}
      onRetry={retry}
    />
  );

  const context = (big: boolean) => (
    <ContextPane
      card={card}
      canManage={canManage}
      big={big}
      now={now}
      timeZone={timeZone}
      handlers={handlers}
    />
  );

  const phoneActions = useThreadActions(card, { canManage, onChanged: refresh });

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none border-b border-border-soft bg-card">
          <nav aria-label="Навигация" className="px-3 pt-2.5">
            <Link
              to="/conversations"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline"
            >
              <RiArrowLeftSLine size={16} aria-hidden />
              Диалоги
            </Link>
          </nav>
          <ThreadHeader card={card} now={now} compact>
            {conversation.ticket ? (
              <TicketChip num={conversation.ticket.num} small />
            ) : (
              canCreateTicket && (
                <Button size="xs" onClick={createTicket}>
                  <RiAddLine />
                  Создать заявку
                </Button>
              )
            )}
            <Button
              variant="outline"
              size="icon-xs"
              aria-label="Контакт и действия"
              title="Контакт и действия"
              onClick={() => setSheetOpen(true)}
            >
              <RiMoreLine />
            </Button>
          </ThreadHeader>
        </div>
        {messagesPane}
        {decision}
        {composer}
        <ContextSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={conversation.title || "Собеседник"}
        >
          {context(true)}
          {phoneActions.length > 0 && (
            <div className="mt-5 flex flex-col gap-1 border-t border-border-soft pt-3">
              {phoneActions.map((item) =>
                item.to ? (
                  <Button
                    key={item.key}
                    asChild
                    variant="ghost"
                    className="w-full justify-start"
                  >
                    <Link to={item.to}>{item.label}</Link>
                  </Button>
                ) : (
                  <Button
                    key={item.key}
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      setSheetOpen(false);
                      item.run?.();
                    }}
                  >
                    {item.label}
                  </Button>
                ),
              )}
            </div>
          )}
        </ContextSheet>
        <FormOutlet />
      </div>
    );
  }

  return (
    <>
      <section aria-label="Переписка" className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader card={card} now={now}>
          {conversation.ticket ? (
            <TicketChip
              num={conversation.ticket.num}
              state={card.ticket?.state ?? null}
            />
          ) : (
            canCreateTicket && (
              <Button size="sm" onClick={createTicket}>
                <RiAddLine />
                Создать заявку
              </Button>
            )
          )}
          <ThreadMenu card={card} canManage={canManage} onChanged={refresh} />
        </ThreadHeader>
        {messagesPane}
        {decision}
        {composer}
      </section>
      <aside
        aria-label="Контакт и заявка"
        className="w-80 flex-none overflow-y-auto border-l border-border-soft px-5 py-4"
      >
        {context(false)}
      </aside>
      <FormOutlet />
    </>
  );
};

export default ConversationThread;
```

- [ ] **Step 8: Pages and the user form hook**

`Inbox` keeps the list mounted while the thread changes (desktop); on the phone it renders either the list or, when `:id` matches, only the outlet. `NewUser` presets the user form from the card (name split, phone, company) and links the counterpart after saving.

`frontend/src/pages/Conversation/Inbox.tsx` (new file):

```tsx
import { useEffect, useState, type ChangeEvent } from "react";
import { useMatch, useOutlet } from "react-router";
import { isMobile } from "react-device-detect";

import PageHeader from "@/components/app/PageHeader";
import SearchBar from "@/components/app/SearchBar";
import ConversationList from "@/components/Conversation/ConversationList";
import ListFilter from "@/components/Conversation/ListFilter";
import QueueChips from "@/components/Conversation/QueueChips";
import useLiveTopic from "@/hooks/use-live-topic";
import useConversationsStore from "@/store/conversations";

/**
 * «Диалоги» — рабочее место переписки с клиентами (канва A1/A2 — десктоп,
 * B1/B4 — телефон).
 *
 * Десктоп: шапка (заголовок со счётчиком, чипы очередей, поиск, фильтры) и одна
 * панель на три колонки — список 352 · переписка · контакт 320. Переписка и
 * контакт — вложенный маршрут `:id` (pages/Conversation/Thread), список живёт
 * здесь и не перерисовывается при переходе между диалогами.
 *
 * Телефон: без выбранного диалога — список; с выбранным — только переписка на
 * весь экран (маршрут диалога просит оболочку об этом `handle.phoneFullscreen`).
 *
 * Список обновляется по теме пульса «conversations» (docs/live-updates.md).
 */

const SEARCH_DEBOUNCE_MS = 300;

/** Поиск с задержкой: запрос уходит, когда человек перестал печатать. */
const useSearchInput = () => {
  const q = useConversationsStore((state) => state.q);
  const setSearch = useConversationsStore((state) => state.setSearch);
  const [value, setValue] = useState(q);

  useEffect(() => {
    if (value === q) return undefined;
    const timer = setTimeout(() => setSearch(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, q, setSearch]);

  return {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setValue(event.target.value),
  };
};

const Title = ({ phone = false }: { phone?: boolean }) => {
  const total = useConversationsStore((state) => state.counts?.all ?? null);
  return (
    <h1
      className={
        phone
          ? "my-0 flex items-baseline gap-2 text-3xl leading-9 font-semibold tracking-tight"
          : "my-0 flex items-baseline gap-2.5 text-3xl leading-none font-semibold tracking-tight whitespace-nowrap"
      }
    >
      Диалоги
      {total !== null && (
        <span className="text-xl font-medium tracking-normal text-faint tabular-nums">
          {total}
        </span>
      )}
    </h1>
  );
};

const DesktopInbox = ({
  outlet,
  selectedId,
}: {
  outlet: ReturnType<typeof useOutlet>;
  selectedId: string | null;
}) => {
  const search = useSearchInput();
  return (
    // Высота — весь лист страницы: 100svh минус отступ под бар (5rem), поле
    // снизу (1.5rem) и внутренние поля листа (2 × 1rem) — layout/Root
    <div className="flex h-[calc(100svh-8.5rem)] min-h-[34rem] flex-col">
      <PageHeader
        title={
          <div className="flex items-center gap-x-3">
            <Title />
            <QueueChips className="ms-4" />
          </div>
        }
        search={
          <SearchBar
            placeholder="Поиск по диалогам"
            value={search.value}
            onChange={search.onChange}
          />
        }
        controls={<ListFilter />}
      />
      <div className="mt-4 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <nav
          aria-label="Список диалогов"
          className="w-88 flex-none overflow-y-auto border-r border-border-soft"
        >
          <ConversationList selectedId={selectedId} />
        </nav>
        {outlet ?? (
          <section
            aria-label="Переписка"
            className="grid min-w-0 flex-1 place-items-center p-6 text-center text-sm text-muted-foreground"
          >
            Выберите диалог в списке слева
          </section>
        )}
      </div>
    </div>
  );
};

const PhoneInbox = () => {
  const search = useSearchInput();
  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Title phone />
          <span className="flex-1" />
          <ListFilter phone />
        </div>
        <SearchBar
          placeholder="Поиск по диалогам"
          value={search.value}
          onChange={search.onChange}
        />
        <QueueChips size="sm" className="scrollbar-none overflow-x-auto" />
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <ConversationList phone />
      </div>
    </div>
  );
};

const Inbox = () => {
  const outlet = useOutlet();
  const match = useMatch("/conversations/:id/*");
  const selectedId = match?.params.id ?? null;

  useEffect(() => {
    void useConversationsStore.getState().load();
  }, []);

  // Заголовок вкладки ставит загрузчик диалога; вернулись к списку — свой
  useEffect(() => {
    if (!selectedId) document.title = "Диалоги";
  }, [selectedId]);

  useLiveTopic(
    "conversations",
    () => useConversationsStore.getState().silentRefresh(),
    // Шумная тема: каждое сообщение каждого диалога — не чаще раза в 5 с
    { minIntervalMs: 5_000 },
  );

  if (isMobile) return outlet ?? <PhoneInbox />;
  return <DesktopInbox outlet={outlet} selectedId={selectedId} />;
};

export default Inbox;

export function loader() {
  document.title = "Диалоги";
  return null;
}
```

`frontend/src/pages/Conversation/Thread.tsx` (new file):

```tsx
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";

import ConversationThread, {
  type ThreadData,
} from "@/components/Conversation/ConversationThread";
import { api } from "@/lib/api";
import type { ConversationCard, MessagesPage } from "@/types/conversation";
import { PAGE_SIZE } from "@/util/conversation-thread";

/**
 * Маршрут одного диалога (`/conversations/:id`): карточка и первая страница
 * ленты — одним загрузчиком, чтобы переписка открывалась готовой. Чужой или
 * исчезнувший диалог — 404 сервера, его рисует страница ошибок с контекстом
 * раздела «Диалоги» (util/sections).
 */
export default ConversationThread;

export async function loader({ params }: LoaderFunctionArgs): Promise<ThreadData> {
  const [card, page] = await Promise.all([
    api<ConversationCard>(`/api/conversations/${params.id}`),
    api<MessagesPage>(`/api/conversations/${params.id}/messages?limit=${PAGE_SIZE}`),
  ]);
  document.title = card.conversation.title
    ? `Диалог · ${card.conversation.title}`
    : "Диалог";
  return { card, page };
}

/**
 * Закрылась шторка формы поверх диалога («Создать заявку», «Новый
 * пользователь») — диалог перечитываем: привязка и собеседник могли
 * измениться, а роутер сам загрузчик оставшегося маршрута не повторяет.
 */
export const shouldRevalidate = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) =>
  defaultShouldRevalidate ||
  (currentUrl.pathname !== nextUrl.pathname &&
    currentUrl.pathname.startsWith(`${nextUrl.pathname}/`));
```

`frontend/src/pages/Conversation/NewUser.tsx` (new file):

```tsx
import type { ComponentType } from "react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import UserFormJs from "@/components/User/UserForm";
import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import type { ConversationCard } from "@/types/conversation";
import { splitPersonName } from "@/util/conversation-format";

import { linkIdentity } from "@/components/Conversation/conversation-actions";

// Граница типизации: форма на JS, пропсы с дефолтом TS выводит необязательными
// не всегда — описываем явно
const UserForm = UserFormJs as unknown as ComponentType<{
  onCreated?: (userId: string) => Promise<unknown> | void;
  successTo?: string;
}>;

type NewUserData = {
  companiesList: unknown[];
  categoriesList: unknown[];
  /** Заготовка формы: имя и телефон из мессенджера, компания диалога. */
  user: {
    firstName: string;
    lastName: string;
    phone: string;
    isEndUser: true;
    company: { _id: string } | null;
  };
  identityId: string;
  displayName: string;
};

/**
 * «Новый пользователь» из «Кто это?» (канва C2): та же форма пользователя,
 * что в справочнике, — шторкой поверх диалога и уже заполненная тем, что
 * известно о собеседнике. После сохранения собеседник связывается с новым
 * человеком, шторка возвращает в диалог.
 */
const ConversationNewUser = () => {
  const { identityId, displayName } = useLoaderData() as NewUserData;
  return (
    <UserForm
      successTo=".."
      onCreated={(userId) => linkIdentity(identityId, userId, displayName)}
    />
  );
};

export default ConversationNewUser;

export async function loader({ params }: LoaderFunctionArgs): Promise<NewUserData> {
  document.title = "Новый пользователь";
  const [card, companies, categories] = await Promise.all([
    api<ConversationCard>(`/api/conversations/${params.id}`),
    load<unknown[]>("/api/companies"),
    load<unknown[]>("/api/ticket-categories"),
  ]);
  const counterpart = card.counterpart;
  if (!counterpart) {
    throw new Response("Собеседник не найден", { status: 404 });
  }
  const { firstName, lastName } = splitPersonName(counterpart.name);
  return {
    companiesList: companies,
    categoriesList: categories,
    user: {
      firstName,
      lastName,
      phone: counterpart.phone,
      isEndUser: true,
      company: card.conversation.company ? { _id: card.conversation.company.id } : null,
    },
    identityId: counterpart.identityId,
    displayName: [lastName, firstName].filter(Boolean).join(" "),
  };
}
```

`frontend/src/components/User/UserForm.jsx`:

```diff
--- a/frontend/src/components/User/UserForm.jsx
+++ b/frontend/src/components/User/UserForm.jsx
@@ -140,7 +140,12 @@
   };
 };
 
-const UserForm = () => {
+/**
+ * `onCreated(userId)` — после сохранения НОВОГО пользователя, до закрытия
+ * шторки (форма поверх диалога связывает с ним собеседника, «Диалоги»);
+ * `successTo` — куда уходить после успеха вместо карточки пользователя.
+ */
+const UserForm = ({ onCreated, successTo } = {}) => {
   const {
     user,
     companiesList = [],
@@ -517,7 +522,13 @@
   useEffect(() => {
     if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
       const id = fetcher.data.userId;
-      close(id ? `/users/${id}` : "..", { replace: true });
+      const leave = () =>
+        close(successTo ?? (id ? `/users/${id}` : ".."), { replace: true });
+      if (id && !isEdit && onCreated) {
+        Promise.resolve(onCreated(id)).finally(leave);
+      } else {
+        leave();
+      }
     }
   }, [fetcher.state, fetcher.data]);
 
```

- [ ] **Step 9: Routes (stage 1)**

`frontend/src/App.jsx`:

```diff
--- a/frontend/src/App.jsx
+++ b/frontend/src/App.jsx
@@ -54,6 +54,19 @@
 
 import ArchivePage, { loader as archiveLoader } from "./pages/Archive.jsx";
 
+// «Диалоги»: список с очередями, диалог вложенным маршрутом, формы поверх
+// диалога («Создать заявку», «Новый пользователь») — его шторками
+import ConversationsInbox, {
+  loader as conversationsLoader,
+} from "./pages/Conversation/Inbox";
+import ConversationThreadPage, {
+  loader as conversationThreadLoader,
+  shouldRevalidate as conversationThreadShouldRevalidate,
+} from "./pages/Conversation/Thread";
+import ConversationNewUserPage, {
+  loader as conversationNewUserLoader,
+} from "./pages/Conversation/NewUser";
+
 // Companies
 import Companies, { loader as companiesLoader } from "./pages/Company/List.jsx";
 
@@ -569,6 +582,35 @@
                 },
               ],
             },
+            // Диалоги: модуль «Диалоги» + право их видеть. Диалог — вложенный
+            // маршрут списка (на десктопе список остаётся слева); на телефоне
+            // он занимает экран целиком (handle.phoneFullscreen, layout/Root)
+            {
+              path: "conversations",
+              handle: { module: "messaging", can: { conversation: ["read"] } },
+              element: <ConversationsInbox />,
+              loader: conversationsLoader,
+              children: [
+                {
+                  path: ":id",
+                  handle: { phoneFullscreen: true },
+                  element: <ConversationThreadPage />,
+                  loader: conversationThreadLoader,
+                  shouldRevalidate: conversationThreadShouldRevalidate,
+                  children: [
+                    // «Новый пользователь» из «Кто это?» — та же форма
+                    // пользователя; после сохранения собеседник связывается
+                    {
+                      path: "users/add",
+                      handle: { can: { user: ["manage"] }, ...SHEET_LG },
+                      loader: conversationNewUserLoader,
+                      action: addUserAction,
+                      element: <ConversationNewUserPage />,
+                    },
+                  ],
+                },
+              ],
+            },
             {
               path: "archive",
               element: <ArchivePage />,
```

- [ ] **Step 10: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/components/Conversation src/pages/Conversation src/components/User/UserForm.jsx src/App.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 11: Checkpoint** — no commit, no staging. The owner may look at the section now (Task 14, step 5 has the seed); «Создать заявку» needs Task 9.

---

## Task 9: «Создать заявку» from a chat — the existing ticket form, prefilled

«Создать заявку» opens the same ticket form as «Новая заявка», as a sheet over the thread, filled from `GET /api/conversations/:id/ticket-draft`: the description (HTML from the selected messages), the company and the applicant when the sender is linked. For an unknown sender «Инициатор» becomes optional (the server sets the service account and keeps the name in `realSender`). The generic local draft is off for such a form. After saving, the sheet returns to the conversation (the ticket exists to answer the client), not to the ticket card.

**Files:**
- Create: `frontend/src/components/Ticket/ticket-origin.js`
- Test: `frontend/src/components/Ticket/ticket-origin.test.js`
- Modify: `frontend/src/pages/Ticket/Add.jsx` (loader reads `?conversation=&messages=`)
- Modify: `frontend/src/components/Ticket/use-ticket-form.js` (origin, optional applicant, draft switch, payload)
- Modify: `frontend/src/components/Ticket/TicketFormRoute.jsx` (apply origin, error branch, no template pill, stay on the thread)
- Modify: `frontend/src/components/Ticket/TicketFormFields.jsx` (applicant not required + hint)
- Modify: `frontend/src/App.jsx` (stage 2: the form route under the thread)

**Interfaces:**
- Consumes: Task 8's navigation `tickets/add?conversation=<id>&messages=<id,…>` and the thread's `shouldRevalidate` (the thread reloads when the sheet closes); `ticketFormRoutes({ prefix, modes })` (`routes/ticket-forms.jsx`); P0 `GET /api/conversations/:id/ticket-draft?messages=<id,…>` → `TicketDraft = { description: string; applicantId: string | null; companyId: string | null; source: string; attachments: number }`; P0 `POST /api/tickets/add` fields `originConversationId`, `originMessageIds`.
- Produces:
  - `originFormValues(draft, formData = {}) → { description: string; companyId: string; applicantId: string; applicantOptional: boolean }` — ids not present in the form's lists are dropped.
  - `formDraftEnabled({ mode, userId, origin }) → boolean` — true only for `mode === "add"`, a known user and no origin.
  - `originPayload(origin) → { originConversationId: string; originMessageIds: string /* JSON array */ }`.
  - `Add.jsx` loader returns `{ formData, templates, presetTemplate, presetOrigin: { conversationId, messageIds, draft } | null, originError: string | null }`.
  - Route `/conversations/:id/tickets/add`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Ticket/ticket-origin.test.js` (new file):

```js
// node --test src/components/Ticket/ticket-origin.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formDraftEnabled,
  originFormValues,
  originPayload,
} from "./ticket-origin.js";

const formData = {
  companies: [{ _id: "c1", alias: "ТД Восток" }],
  applicants: [{ _id: "u1", lastName: "Соколова", firstName: "Марина" }],
};

test("опознанный собеседник: компания и инициатор из черновика", () => {
  assert.deepEqual(
    originFormValues(
      { description: "<p>Принтер</p>", applicantId: "u1", companyId: "c1" },
      formData,
    ),
    {
      description: "<p>Принтер</p>",
      companyId: "c1",
      applicantId: "u1",
      applicantOptional: false,
    },
  );
});

test("неопознанный: инициатор необязателен, пустые поля не выдумываются", () => {
  assert.deepEqual(
    originFormValues(
      { description: "<p>Интернет</p>", applicantId: null, companyId: null },
      formData,
    ),
    {
      description: "<p>Интернет</p>",
      companyId: "",
      applicantId: "",
      applicantOptional: true,
    },
  );
});

test("чужие справочникам id не подставляются, но инициатор остаётся обязательным", () => {
  const values = originFormValues(
    { description: "", applicantId: "u-banned", companyId: "c-closed" },
    formData,
  );
  assert.equal(values.companyId, "");
  assert.equal(values.applicantId, "");
  assert.equal(values.applicantOptional, false);
  assert.equal(originFormValues(null, formData).description, "");
});

test("originPayload: id диалога и сообщения JSON-массивом", () => {
  assert.deepEqual(originPayload({ conversationId: "conv1", messageIds: ["m1", "m2"] }), {
    originConversationId: "conv1",
    originMessageIds: '["m1","m2"]',
  });
  assert.equal(originPayload({ conversationId: "conv1" }).originMessageIds, "[]");
});

test("у заявки из диалога нет локального черновика", () => {
  assert.equal(formDraftEnabled({ mode: "add", userId: "u1", origin: null }), true);
  assert.equal(
    formDraftEnabled({ mode: "add", userId: "u1", origin: { conversationId: "c1", messageIds: [] } }),
    false,
  );
  assert.equal(formDraftEnabled({ mode: "update", userId: "u1", origin: null }), false);
  assert.equal(formDraftEnabled({ mode: "add", userId: "", origin: null }), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/components/Ticket/ticket-origin.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `ticket-origin.js`; `# fail 1`.

- [ ] **Step 3: Implement the helper**

`frontend/src/components/Ticket/ticket-origin.js` (new file):

```js
/**
 * «Создать заявку» из диалога: черновик сервера
 * (`GET /api/conversations/:id/ticket-draft`) → значения формы заявки и поля
 * запроса. Чистые функции — тесты рядом:
 * `node --test src/components/Ticket/ticket-origin.test.js`.
 *
 * Форма та же, что у «Новой заявки» (use-ticket-form): описание приходит
 * HTML-строкой, компанию и инициатора берём, только если они есть в
 * справочниках формы — иначе поле показало бы плейсхолдер при заполненном
 * значении.
 */
const asId = (value) => (value == null ? "" : String(value._id ?? value));

/**
 * @param {{ description?: string, applicantId?: string|null, companyId?: string|null }|null} draft
 * @param {{ companies?: object[], applicants?: object[] }} formData
 * @returns {{ description: string, companyId: string, applicantId: string, applicantOptional: boolean }}
 */
export const originFormValues = (draft, formData = {}) => {
  const companies = formData.companies ?? [];
  const applicants = formData.applicants ?? [];
  const companyId =
    draft?.companyId && companies.some((item) => asId(item) === draft.companyId)
      ? draft.companyId
      : "";
  const applicantId =
    draft?.applicantId &&
    applicants.some((item) => asId(item) === draft.applicantId)
      ? draft.applicantId
      : "";
  return {
    description: draft?.description ?? "",
    companyId,
    applicantId,
    // Собеседник не опознан: инициатора ставит сервер — служебная учётка, а
    // имя собеседника уходит в realSender (как у заявок из почты)
    applicantOptional: !draft?.applicantId,
  };
};

/**
 * Ведётся ли у формы локальный черновик (`ticket-draft`): только у новой
 * заявки своего автора и НЕ из диалога — её текст и есть переписка, и
 * сохранённый набросок всплыл бы потом в обычной «Новой заявке».
 */
export const formDraftEnabled = ({ mode, userId, origin }) =>
  mode === "add" && Boolean(userId) && !origin;

/** Поля запроса `POST /api/tickets/add`, которые связывают заявку с диалогом. */
export const originPayload = (origin) => ({
  originConversationId: origin.conversationId,
  originMessageIds: JSON.stringify(origin.messageIds ?? []),
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test src/components/Ticket/ticket-origin.test.js`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Loader, form state, form route, applicant field**

`frontend/src/pages/Ticket/Add.jsx`:

```diff
--- a/frontend/src/pages/Ticket/Add.jsx
+++ b/frontend/src/pages/Ticket/Add.jsx
@@ -1,4 +1,5 @@
 import TicketFormRoute from "../../components/Ticket/TicketFormRoute";
+import { api } from "@/lib/api";
 import { load } from "@/store/form-data";
 
 const AddTicketPage = () => <TicketFormRoute mode="add" />;
@@ -16,8 +17,9 @@
   // приезжает целиком, чтобы форма открылась уже заполненной. Шаблон —
   // сущность, а не справочник: всегда свежий, иначе устаревший состав
   // вопросов упёрся бы в проверку обязательных ответов на сервере
-  const presetId = new URL(request.url).searchParams.get("template");
-  const [formData, templates, presetTemplate] = await Promise.all([
+  const url = new URL(request.url);
+  const presetId = url.searchParams.get("template");
+  const [formData, templates, presetTemplate, origin] = await Promise.all([
     load("/api/tickets/form-data"),
     load("/api/ticket-templates").catch(() => []),
     presetId
@@ -26,9 +28,39 @@
           staleMax: 0,
         }).catch(() => null)
       : null,
+    loadOrigin(url.searchParams),
   ]);
 
-  return { formData, templates, presetTemplate };
+  return { formData, templates, presetTemplate, ...origin };
+}
+
+/**
+ * «Создать заявку» из диалога (`?conversation=<id>&messages=<id,id>`):
+ * черновик собирает сервер — описание из сообщений, заявитель и компания
+ * собеседника (`GET /api/conversations/:id/ticket-draft`). Отказ (диалог
+ * привязан к другой открытой заявке, модуль выключен) форма показывает
+ * вместо полей.
+ */
+async function loadOrigin(searchParams) {
+  const conversationId = searchParams.get("conversation");
+  if (!conversationId) return { presetOrigin: null, originError: null };
+  const messageIds = (searchParams.get("messages") || "")
+    .split(",")
+    .filter(Boolean);
+  try {
+    const draft = await api(
+      `/api/conversations/${conversationId}/ticket-draft?${new URLSearchParams({ messages: messageIds.join(",") })}`,
+    );
+    return {
+      presetOrigin: { conversationId, messageIds, draft },
+      originError: null,
+    };
+  } catch (error) {
+    return {
+      presetOrigin: null,
+      originError: error?.message || "Не удалось собрать заявку из диалога",
+    };
+  }
 }
 
 export async function action({ request }) {
```

`frontend/src/components/Ticket/use-ticket-form.js`:

```diff
--- a/frontend/src/components/Ticket/use-ticket-form.js
+++ b/frontend/src/components/Ticket/use-ticket-form.js
@@ -14,6 +14,7 @@
 } from "@/components/app/custom-fields";
 import { applicantOptions } from "./ticket-applicants";
 import { clearDraft, readDraft, saveDraft } from "./ticket-draft";
+import { formDraftEnabled, originPayload } from "./ticket-origin";
 
 /**
  * Состояние формы заявки — одно на три поверхности.
@@ -117,6 +118,7 @@
  * @param {boolean} params.canPerformTickets ведущий заявки может не назначать себя
  * @param {boolean} params.canCreateForOthers заводить заявку за другого: клиенту — инициатор-коллега, сотруднику — чужие компания, инициатор и ответственные
  * @param {string} params.userId чей это черновик (создание); без него черновика нет
+ * @param {{ conversationId: string, messageIds: string[], draft: object }|null} [params.origin] заявка из диалога («Диалоги» → «Создать заявку»)
  */
 export const useTicketForm = ({
   mode,
@@ -126,6 +128,7 @@
   canPerformTickets = false,
   canCreateForOthers = false,
   userId = "",
+  origin = null,
 }) => {
   const config = TICKET_FORM_MODES[mode] ?? TICKET_FORM_MODES.add;
 
@@ -161,6 +164,9 @@
   // Что шаблон велит делать с описанием: обязательно, по желанию, скрыто.
   // Без шаблона описание обязательно — как было всегда
   const [descriptionMode, setDescriptionMode] = useState("required");
+  // Заявка из диалога с неопознанным собеседником: инициатора ставит сервер
+  // (служебная учётка + имя собеседника в realSender), выбирать его не нужно
+  const [applicantOptional, setApplicantOptional] = useState(false);
   // Ошибки показываем по нажатию «Сохранить», а не блокируем кнопку:
   // заблокированная кнопка не объясняет, чего не хватает.
   const [attempted, setAttempted] = useState(false);
@@ -288,7 +294,8 @@
     // Скрытые поля не проверяем: заявку на себя нельзя «не заполнить»
     if (picksForOthers) {
       if (!companyId) found.company = "Выберите компанию";
-      if (!applicantId) found.applicant = "Выберите инициатора";
+      if (!applicantId && !applicantOptional)
+        found.applicant = "Выберите инициатора";
       if (!canPerformTickets && responsibleIds.length === 0)
         found.responsibles = "Назначьте ответственных";
     }
@@ -307,6 +314,7 @@
     canPerformTickets,
     canPickApplicant,
     picksForOthers,
+    applicantOptional,
   ]);
 
   const errorOf = (field) => (attempted ? errors[field] : undefined);
@@ -316,7 +324,8 @@
   // Не на каждую букву: черновик — страховка, а не автосохранение
   const DRAFT_DEBOUNCE_MS = 800;
 
-  const draftEnabled = mode === "add" && !!userId;
+  // У заявки из диалога своего черновика нет (ticket-origin#formDraftEnabled)
+  const draftEnabled = formDraftEnabled({ mode, userId, origin });
   const draftKeyId = template?._id ? String(template._id) : null;
 
   // Что переживает закрытие шторки. Файлы сюда не попадают — `File` в строку
@@ -496,6 +505,19 @@
   };
 
   /**
+   * Заявка из диалога: описание, компания и инициатор из черновика сервера
+   * (`ticket-origin#originFormValues`). Заполнение программное — следующий
+   * кадр становится точкой отсчёта, как у шаблона.
+   */
+  const applyOrigin = (values) => {
+    rebase();
+    setDescription(values.description);
+    if (values.companyId) setCompanyId(values.companyId);
+    if (values.applicantId) setApplicantId(values.applicantId);
+    setApplicantOptional(values.applicantOptional);
+  };
+
+  /**
    * Тело запроса. Возвращает `null`, если форму рано отправлять, — тогда
    * `app/FormWrapper` отменяет сабмит, а ошибки уже видны у своих полей.
    */
@@ -558,6 +580,12 @@
       for (const file of files) payload.append("attachments", file);
       // Одним id: вопросы, чек-лист и доступ сервер берёт из своего документа
       if (template?._id) payload.append("templateId", String(template._id));
+      // Из диалога: сервер разнесёт сообщения, привяжет чат и скопирует файлы
+      if (origin) {
+        const link = originPayload(origin);
+        payload.append("originConversationId", link.originConversationId);
+        payload.append("originMessageIds", link.originMessageIds);
+      }
       // Пока ответственных нет, заявка стоит в очереди «Новые»
       payload.append(
         "state",
@@ -611,6 +639,8 @@
     setState,
     template,
     applyTemplate,
+    applyOrigin,
+    applicantOptional,
     epoch,
     draft,
     restoreDraft,
```

`frontend/src/components/Ticket/TicketFormRoute.jsx`:

```diff
--- a/frontend/src/components/Ticket/TicketFormRoute.jsx
+++ b/frontend/src/components/Ticket/TicketFormRoute.jsx
@@ -11,6 +11,7 @@
 
 import DraftNote from "./DraftNote";
 import { ticketFormSections } from "./TicketFormFields";
+import { originFormValues } from "./ticket-origin";
 import { useTicketForm } from "./use-ticket-form";
 import { useCan } from "@/store/authed-user";
 
@@ -35,6 +36,8 @@
     ticketData,
     templates = [],
     presetTemplate = null,
+    presetOrigin = null,
+    originError = null,
   } = useLoaderData() ?? {};
   const ticket = ticketData?.ticket ?? null;
 
@@ -49,6 +52,7 @@
     canPerformTickets: !!can({ ticket: ["perform"] }),
     canCreateForOthers: !!can({ ticket: ["createForOthers"] }),
     userId: userId ? String(userId) : "",
+    origin: presetOrigin,
   });
 
   const [templateId, setTemplateId] = useState("");
@@ -61,6 +65,11 @@
       setTemplateId(String(presetTemplate._id));
       form.applyTemplate(presetTemplate);
     }
+    // Заявка из диалога: описание, компания и заявитель — из черновика
+    // сервера; свой черновик у такой формы не ведётся (use-ticket-form)
+    if (presetOrigin) {
+      form.applyOrigin(originFormValues(presetOrigin.draft, formData));
+    }
     form.restoreDraft(
       presetTemplate?._id ? String(presetTemplate._id) : null,
     );
@@ -91,8 +100,10 @@
 
   const sections = ticketFormSections({ form, formData });
 
+  // У заявки из диалога описание уже собрано из переписки — шаблон его бы
+  // затёр, поэтому выбора шаблона там нет
   const templatePill =
-    form.config.fromTemplate && templates.length > 0 ? (
+    form.config.fromTemplate && !presetOrigin && templates.length > 0 ? (
       <ChipCombobox
         placeholder="Из шаблона"
         allLabel="Без шаблона"
@@ -121,6 +132,16 @@
       </div>
     ) : null;
 
+  // Черновик из диалога не собрался — объясняем почему вместо пустой формы
+  if (originError) {
+    return (
+      <>
+        <FormHeader title={form.config.title} />
+        <AlertMessage variant="warning" message={originError} />
+      </>
+    );
+  }
+
   // Прямая ссылка на правку без прав раньше рисовала пустую шторку — теперь
   // она объясняет, что происходит (гайд, «Ошибки и гейты прав»)
   if (mode !== "add" && !can({ ticket: ["manage"] })) {
@@ -142,9 +163,11 @@
       formData={form.buildPayload}
       onSuccess={form.clearSavedDraft}
       // Создание ведёт на карточку созданной заявки, правка и обработка —
-      // обратно туда, откуда форму открыли
+      // обратно туда, откуда форму открыли. Заявка из диалога — шаг ответа
+      // клиенту: возвращаемся в переписку, она уже привязана к новой заявке
+      // (отступление от п.1 «Навигации после сабмита» — гайд)
       successTo={
-        mode === "add"
+        mode === "add" && !presetOrigin
           ? (data) => (data?.ticket?.num ? `/tickets/${data.ticket.num}` : "..")
           : undefined
       }
```

`frontend/src/components/Ticket/TicketFormFields.jsx`:

```diff
--- a/frontend/src/components/Ticket/TicketFormFields.jsx
+++ b/frontend/src/components/Ticket/TicketFormFields.jsx
@@ -192,6 +192,7 @@
     setResponsibleIds,
     responsibleOptions,
     applicants,
+    applicantOptional,
     canPickApplicant,
     picksForOthers,
     deadline,
@@ -325,8 +326,13 @@
           <Field
             label="Инициатор"
             htmlFor="ticket-applicant"
-            required
-            hint={errorOf("applicant")}
+            required={!applicantOptional}
+            hint={
+              errorOf("applicant") ??
+              (applicantOptional && !applicantId
+                ? "Пусто — инициатором станет служебная учётка, имя собеседника сохранится в заявке"
+                : undefined)
+            }
           >
             <Combobox
               id="ticket-applicant"
```

- [ ] **Step 6: Route under the thread (stage 2)**

`frontend/src/App.jsx` (on top of Task 8's change):

```diff
--- a/frontend/src/App.jsx
+++ b/frontend/src/App.jsx
@@ -598,6 +598,9 @@
                   loader: conversationThreadLoader,
                   shouldRevalidate: conversationThreadShouldRevalidate,
                   children: [
+                    // «Создать заявку» — та же форма заявки, заполненная из
+                    // переписки (?conversation=&messages=, pages/Ticket/Add)
+                    ...ticketFormRoutes({ prefix: "tickets/", modes: ["add"] }),
                     // «Новый пользователь» из «Кто это?» — та же форма
                     // пользователя; после сохранения собеседник связывается
                     {
```

- [ ] **Step 7: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/components/Ticket/ticket-origin.js src/components/Ticket/ticket-origin.test.js src/pages/Ticket/Add.jsx src/components/Ticket/use-ticket-form.js src/components/Ticket/TicketFormRoute.jsx src/components/Ticket/TicketFormFields.jsx src/App.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 8: Checkpoint** — no commit, no staging. An ordinary «Новая заявка» (list, dashboard, template) must behave exactly as before: local draft on, «Инициатор» required, success → the new ticket's card.

---

## Task 10: The ticket side — the «Хроника» as a dialog, «Ответить через», the «Диалог» row

The owner's decision on row D′ of the canvas (boards D4–D8, replacing the D1–D3 chronicle): the ticket's «Хроника» becomes a **dialog**, one component for staff and end users. On top of it come the messaging pieces of the ticket card: channel markers, delivery status with «Повторить», «Ответить через ▾», the «Диалог» row in «Детали» and «Вернуть в работу» arriving from a conversation.

- **Sides.** The viewer's side is on the right. Staff see every team member on the right (a colleague's name above the bubble, their own messages unlabeled) and the client side on the left: the applicant (unlabeled — named in «Детали»), other client users and unknown messenger senders (by name). An end user sees only their own messages on the right (no name) and the team on the left, by name. There are no internal notes in HD: every comment is visible to the client. The side comes from the channel block first (a mirrored inbound message is the client's, a reply — including «с телефона» — is the team's), then from the author: the backend now sends `isEndUser` with each comment author; an author without it (an old embedded snapshot, a deleted account) is on the left when it is the applicant or unknown and on the right otherwise.
- **Messenger order.** Oldest at the top, newest at the bottom; the composer is docked at the bottom of the panel, a short feed hugs it; day labels; the unread divider «Новые · N» above the first unread message of someone else (the same `seenAt` watermark as today). The panel opens with the divider at its top when there is one — the first unread message is where reading starts, as in D4 — and at the bottom otherwise; after that it follows new messages only while the reader is at the bottom, and always shows the viewer's own sent message. The day label stays above the divider when a day starts there; the old per-message unread dots are gone (the divider is the marker).
- **Events** (`util/ticket-events`: status, assignees, deadline, works, files added and removed, …) are short centered system lines in time order — icon in the event's tone, label, person — with the event's content (rejection reason), file chips, the removed file's name and the collapsed technical records underneath, exactly as the old entries had them. «Переписка | Всё» keeps its meaning and default: «Переписка» hides the system lines. End users get the events the backend selects for them (`feedForClient`), as today.
- **Markers above the bubble.** Staff: messenger block — glyph and network, «→» and the delivery status icon on our replies (✓ sent, ✓✓ delivered, teal ✓✓ read), «Не доставлено · Повторить» under a failed reply; e-mail — «письмо». E-mail comments are now tagged by the backend (`Comment.source = "email"`); older ones are recognised by their quoted tail. End users see a marker only on their own messages and never a delivery status; no ticks on team bubbles.
- **Inside the bubble:** text, photos (the «Диалоги» photo tile, 220×124, phone 200×112), other files as chips, the e-mail's collapsible quoted tail «▸ Показать цитату», the time.
- **Composer.** Staff: «Написать комментарий…», «Ответить через ▾» (when the messaging module is on and the person may reply) + «Файл» + «Отправить». End user: «Написать сообщение…», «Файл» + «Отправить», no route picker. Phone: textarea at 16 px, file and send as 36 px icon buttons. `canComment` still decides whether there is a composer at all; the AI panel's draft («Спросить заявителя») still lands in it; the card still refreshes through the pulse (the page revalidates, the store's comments change, the rows follow).
- **Fixed on the way:** the page renders two chronicles (the xl column and the last section on narrow screens), and both file inputs had the id `chronicle-files`, so «Файл» in the visible one opened the hidden one's input; each instance now has its own id (`useId`).
- **Unchanged:** the rest of the ticket page — hero, sections, «Детали» with the new «Диалог» row — and, for end users, the whole page shell.

**Files:**
- Create: `frontend/src/util/delivery-routes.js`
- Test: `frontend/src/util/delivery-routes.test.js`
- Create: `frontend/src/util/chronicle-dialog.js`
- Test: `frontend/src/util/chronicle-dialog.test.js`
- Create: `frontend/src/components/Ticket/ChannelMarker.tsx`
- Create: `frontend/src/components/Ticket/ReplyRoute.tsx`
- Create: `frontend/src/components/Ticket/use-delivery-routes.ts`
- Modify (whole file replaced): `frontend/src/components/Ticket/Chronicle.jsx`
- Modify: `frontend/src/components/Ticket/View/Sections.jsx` (row «Диалог», `realSender` of messenger tickets)
- Modify: `frontend/src/pages/Ticket/View.jsx` (routes hook, `messaging` prop, `openAction`)
- Modify: `backend/controllers/ticket.js` (`getOne`: comment authors carry `isEndUser`)
- Modify: `backend/models/comment.js` (optional `source: "email"`)
- Modify: `backend/middleware/emailHandling.js` (e-mail comments get `source: "email"`)

**Interfaces:**
- Consumes: Task 4 `ChannelIcon`, `displayTimeZone()`, `DeliveryRoute(s)`, `CommentChannel`, colours `bg-bubble-in` / `bg-bubble-out`; Task 5 `NETWORK_LABEL`, `networkLabel`, `shortPersonName`, `dayLabel`; Task 8 `PhotoAttachment({ attachment, kind, compact })` and `FileAttachment({ attachment, kind })` (`components/Conversation/MessageMedia.tsx`), the link state `{ openAction: "backToWork" }`; existing: `eventMeta`, `eventLabel`, `EVENT_TONE_CLASS`, `technicalSummary` (`util/ticket-events.js`), `AttachmentChip`, `useHttp`, `useViewTicketStore` (`comments`, `updateComments`, `commentDraft`, `clearCommentDraft`), `AuthedUserContext` (`_id`, `isEndUser`, names), `DIALOG_ACTIONS` / `setDialog` in `View.jsx`; HTTP (P0 and existing): `GET /api/tickets/:num/delivery-routes` → `DeliveryRoutes = { routes: DeliveryRoute[]; defaultRoute: string /* conversation id or "notify" */; applicantName: string }`, `POST /api/comments/add/` (multipart; `deliverVia` = a conversation id, absent = «Почта и бот HD»), `POST /api/messages/:id/retry`, `GET /api/tickets/:num/log?from=&to=`.
- Produces:
  - `delivery-routes.js`: `NOTIFY_ROUTE = "notify"`; `MESSENGER_SOURCES: Set<string>`; `routeTitle(route, applicantName?) → "Telegram · Соколова Марина"`; `routeSubtitle(route) → "личный чат · привязан к этой заявке" | "личный чат" | "группа компании" | reason`; `routeTriggerLabel(route | null, applicantName?) → "Telegram · Соколова М." | "Почта и бот HD"`; `initialRoute(data | null) → string`; `dialogRoute(routes, comments) → DeliveryRoute | null`; `dialogLabel(route) → "Telegram · личный чат" | "Telegram · группа"`; `chronicleAuthorName(comment, personName?) → string`; `deliveryStatusMeta(status) → { label; icon: "clock"|"check"|"double"|"warn"; tone: "faint"|"accent"|"destructive" } | null`.
  - `chronicle-dialog.js`: `GAP = { afterLabel: 6, sameAuthor: 4, sameSide: 8, sideSwitch: 12 }`; `authorIdOf(author) → string`; `commentSide(comment, { viewer: { id: string; isClient: boolean }, applicantId? }) → "in" | "out"`; `isEmailComment(comment) → boolean`; `commentMarker(comment, { viewer, side }) → { channel: { network: string; direction: "in" | "out"; status?: string }; label?: string } | null`; `chronicleRows({ comments, events, viewer, applicantId?, seenAt?, now?, timeZone? }) → Array<{ type: "day"; key; label } | { type: "new"; key; count } | { type: "event"; key; event } | { type: "comment"; key; comment; side; gap: number; showName: boolean }>`.
  - `ChannelMarker({ channel: MarkerChannel; label?: string })` with `MarkerChannel = { network: string; direction: "in" | "out"; status?: string }` (`network: "mail"` + `label: "письмо"` for e-mail); `ReplyRoute({ data: DeliveryRoutes; value: string; onChange(value: string): void })`; `useDeliveryRoutes(ticketNum, { enabled: boolean; revision?: string | null }) → { data: DeliveryRoutes | null; refresh(): void }`.
  - `Chronicle({ ticket, events, canComment, seenAt, messaging })` — `messaging: { canReply: boolean; routes: DeliveryRoutes | null; onRoutesChanged(): void } | null` (null for end users and with the module off); `FactsSection` prop `dialog: DeliveryRoute | null`.
  - Ticket payload (`GET /api/tickets/:num`): `comments[].createdBy.isEndUser: boolean`; `comments[].source?: "email"`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/util/delivery-routes.test.js` (new file):

```js
// node --test src/util/delivery-routes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFY_ROUTE,
  chronicleAuthorName,
  deliveryStatusMeta,
  dialogLabel,
  dialogRoute,
  initialRoute,
  routeSubtitle,
  routeTitle,
  routeTriggerLabel,
} from "./delivery-routes.js";

const marina = {
  conversationId: "c-marina",
  network: "telegram",
  kind: "direct",
  title: "Соколова Марина",
  available: true,
  reason: null,
  boundHere: true,
};
const group = {
  conversationId: "c-group",
  network: "telegram",
  kind: "group",
  title: "ТД Восток × F1Lab",
  available: true,
  reason: null,
  boundHere: false,
};
const busy = {
  conversationId: "c-wa",
  network: "whatsapp",
  kind: "direct",
  title: "",
  available: false,
  reason: "занят заявкой №56790",
  boundHere: false,
};

test("пункты меню: заголовок и подпись как на канве D1", () => {
  assert.equal(routeTitle(marina, "Соколова Марина"), "Telegram · Соколова Марина");
  assert.equal(routeTitle(busy, "Соколова Марина"), "WhatsApp · Соколова Марина");
  assert.equal(routeSubtitle(marina), "личный чат · привязан к этой заявке");
  assert.equal(routeSubtitle({ ...marina, boundHere: false }), "личный чат");
  assert.equal(routeSubtitle(group), "группа компании");
  assert.equal(routeSubtitle(busy), "занят заявкой №56790");
});

test("кнопка выбора: короткое имя или «Почта и бот HD»", () => {
  assert.equal(routeTriggerLabel(marina, ""), "Telegram · Соколова М.");
  assert.equal(routeTriggerLabel(null, ""), "Почта и бот HD");
  assert.equal(routeTriggerLabel({ ...marina, title: "" }, ""), "Telegram · собеседник");
});

test("initialRoute: занятый или пропавший маршрут не выбирается — «как сейчас»", () => {
  assert.equal(
    initialRoute({ routes: [marina, busy], defaultRoute: "c-marina", applicantName: "" }),
    "c-marina",
  );
  assert.equal(
    initialRoute({ routes: [marina, busy], defaultRoute: "c-wa", applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(
    initialRoute({ routes: [marina], defaultRoute: "c-gone", applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(
    initialRoute({ routes: [marina], defaultRoute: NOTIFY_ROUTE, applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(initialRoute(null), NOTIFY_ROUTE);
});

test("dialogRoute: привязанный чат, иначе чат последнего входящего", () => {
  const comments = [
    { createdAt: "2026-09-25T06:00:00Z", channel: { conversationId: "c-group", direction: "in" } },
    { createdAt: "2026-09-25T07:00:00Z", channel: { conversationId: "c-marina", direction: "out" } },
    { createdAt: "2026-09-25T05:00:00Z", channel: null },
  ];
  assert.equal(dialogRoute([marina, group], comments), marina);
  assert.equal(dialogRoute([{ ...marina, boundHere: false }, group], comments), group);
  assert.equal(dialogRoute([group], []), null);
  assert.equal(dialogRoute(null, comments), null);
});

test("dialogLabel: сеть и вид чата", () => {
  assert.equal(dialogLabel(marina), "Telegram · личный чат");
  assert.equal(dialogLabel(group), "Telegram · группа");
});

test("chronicleAuthorName: без хвоста сети, «с телефона» остаётся, иначе автор", () => {
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", authorName: "Андрей · Telegram" } }, "Служба техподдержки"),
    "Андрей",
  );
  assert.equal(
    chronicleAuthorName(
      { channel: { network: "telegram", authorName: "F1Lab Поддержка · с телефона" } },
      "Служба техподдержки",
    ),
    "F1Lab Поддержка · с телефона",
  );
  // Связанный клиент: подписи нет — имя автора комментария
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", direction: "in" } }, "Соколова Марина"),
    "Соколова Марина",
  );
  assert.equal(chronicleAuthorName({ channel: null }, "Лебедев Игорь"), "Лебедев Игорь");
  // Имя, совпадающее с хвостом целиком, не превращается в пустоту
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", authorName: " · Telegram" } }, "x"),
    "· Telegram",
  );
});

test("deliveryStatusMeta: каждый статус — свой значок и тон", () => {
  assert.equal(deliveryStatusMeta("read").tone, "accent");
  assert.equal(deliveryStatusMeta("read").icon, "double");
  assert.equal(deliveryStatusMeta("delivered").tone, "faint");
  assert.equal(deliveryStatusMeta("sent").icon, "check");
  assert.equal(deliveryStatusMeta("queued").icon, "clock");
  assert.equal(deliveryStatusMeta("preparing").icon, "clock");
  assert.equal(deliveryStatusMeta("failed").label, "Не доставлено");
  assert.equal(deliveryStatusMeta(undefined), null);
});
```

`frontend/src/util/chronicle-dialog.test.js` (new file):

```js
// node --test src/util/chronicle-dialog.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GAP,
  chronicleRows,
  commentMarker,
  commentSide,
  isEmailComment,
} from "./chronicle-dialog.js";

const tz = "Europe/Moscow";
// 26.09.2026 14:00 по Москве
const now = new Date("2026-09-26T11:00:00Z");

const marina = { _id: "u-marina", firstName: "Марина", lastName: "Соколова", isEndUser: true };
const lebedev = { _id: "u-lebedev", firstName: "Игорь", lastName: "Лебедев", isEndUser: false };
const smirnov = { _id: "u-smirnov", firstName: "Олег", lastName: "Смирнов", isEndUser: false };
const service = { _id: "u-service", firstName: "Служебная", lastName: "учётка", isEndUser: true };

const staffViewer = { id: "u-lebedev", isClient: false };
const clientViewer = { id: "u-marina", isClient: true };

const comment = (id, at, createdBy, extra = {}) => ({
  _id: id,
  createdAt: at,
  createdBy,
  content: `текст ${id}`,
  ...extra,
});

test("staff: the team on the right, the applicant, other clients and unknown senders on the left", () => {
  const ctx = { viewer: staffViewer, applicantId: "u-marina" };
  assert.equal(commentSide(comment("c1", now, lebedev), ctx), "out");
  assert.equal(commentSide(comment("c2", now, smirnov), ctx), "out");
  assert.equal(commentSide(comment("c3", now, marina), ctx), "in");
  // Зеркало неопознанного собеседника — от служебной учётки, но слева
  assert.equal(
    commentSide(comment("c4", now, service, { channel: { network: "telegram", direction: "in", authorName: "Андрей · Telegram" } }), ctx),
    "in",
  );
  // Ответ с корпоративного телефона — команда, хоть автор и служебный
  assert.equal(
    commentSide(comment("c5", now, service, { channel: { network: "telegram", direction: "out", authorName: "F1Lab Поддержка · с телефона" } }), ctx),
    "out",
  );
  // Старый снимок автора без признака: заявитель — слева, прочие — справа
  assert.equal(commentSide(comment("c6", now, { _id: "u-marina", firstName: "Марина" }), ctx), "in");
  assert.equal(commentSide(comment("c7", now, { _id: "u-old-engineer", firstName: "Пётр" }), ctx), "out");
  assert.equal(commentSide(comment("c8", now, "u-marina"), ctx), "in");
  // Автор удалён — слева
  assert.equal(commentSide(comment("c9", now, null), ctx), "in");
});

test("client: only their own messages on the right, the team on the left", () => {
  const ctx = { viewer: clientViewer, applicantId: "u-marina" };
  assert.equal(commentSide(comment("c1", now, marina), ctx), "out");
  assert.equal(commentSide(comment("c2", now, { _id: "u-marina" }), ctx), "out");
  assert.equal(commentSide(comment("c3", now, lebedev), ctx), "in");
  // Её сообщение из Telegram (собеседник связан с ней) — её
  assert.equal(commentSide(comment("c4", now, marina, { channel: { network: "telegram", direction: "in" } }), ctx), "out");
  // Ответ команды мессенджером — чужой
  assert.equal(commentSide(comment("c5", now, lebedev, { channel: { network: "telegram", direction: "out", status: "read" } }), ctx), "in");
  assert.equal(commentSide(comment("c6", now, { _id: "u-colleague", isEndUser: true }), ctx), "in");
});

test("markers: messenger block and «письмо» for staff; the client sees them only on own messages and without delivery status", () => {
  const reply = comment("c1", now, lebedev, { channel: { network: "telegram", direction: "out", status: "read" } });
  assert.deepEqual(commentMarker(reply, { viewer: staffViewer, side: "out" }), {
    channel: { network: "telegram", direction: "out", status: "read" },
  });
  assert.equal(commentMarker(reply, { viewer: clientViewer, side: "in" }), null);

  const mail = comment("c2", now, marina, { source: "email" });
  assert.deepEqual(commentMarker(mail, { viewer: staffViewer, side: "in" }), {
    channel: { network: "mail", direction: "in" },
    label: "письмо",
  });
  assert.deepEqual(commentMarker(mail, { viewer: clientViewer, side: "out" }), {
    channel: { network: "mail", direction: "in" },
    label: "письмо",
  });
  // Старое письмо узнаётся по отрезанной цитате
  assert.equal(isEmailComment(comment("c3", now, marina, { quotedText: "> Добрый день" })), true);
  assert.equal(isEmailComment(comment("c4", now, marina)), false);

  const own = comment("c5", now, marina, { channel: { network: "telegram", direction: "in", status: "delivered" } });
  assert.deepEqual(commentMarker(own, { viewer: clientViewer, side: "out" }), {
    channel: { network: "telegram", direction: "in" },
  });
  assert.equal(commentMarker(comment("c6", now, lebedev), { viewer: staffViewer, side: "out" }), null);
});

test("rows: oldest first, a day label per day, events between messages by time", () => {
  const rows = chronicleRows({
    comments: [
      comment("c2", "2026-09-26T07:46:00Z", lebedev),
      comment("c1", "2026-09-25T06:40:00Z", marina),
    ],
    events: [{ _id: "e1", kind: "taken", createdAt: "2026-09-26T07:45:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  });
  assert.deepEqual(
    rows.map((row) => (row.type === "day" ? `day:${row.label}` : row.key)),
    ["day:Вчера", "c-c1", "day:Сегодня", "e-e1", "c-c2"],
  );
  assert.equal(
    chronicleRows({ comments: [], events: [], viewer: staffViewer, now, timeZone: tz }).length,
    0,
  );
});

test("«Новые»: above the first unread message of someone else, with the count; own messages and events never count", () => {
  const input = {
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T08:00:00Z", lebedev),
      comment("c3", "2026-09-26T09:00:00Z", marina),
      comment("c4", "2026-09-26T10:00:00Z", smirnov),
    ],
    events: [{ _id: "e1", kind: "workAdded", createdAt: "2026-09-26T08:30:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    seenAt: "2026-09-26T07:00:00Z",
    now,
    timeZone: tz,
  };
  const keys = chronicleRows(input).map((row) => row.key);
  assert.deepEqual(keys, ["d-2026-09-26", "c-c1", "c-c2", "e-e1", "new", "c-c3", "c-c4"]);
  assert.equal(chronicleRows(input).find((row) => row.type === "new").count, 2);
  // Первый визит — черты нет
  assert.equal(chronicleRows({ ...input, seenAt: null }).some((row) => row.type === "new"), false);
  // Метка дня остаётся и над чертой
  const nextDay = chronicleRows({
    ...input,
    comments: [comment("c1", "2026-09-25T06:00:00Z", lebedev), comment("c2", "2026-09-26T08:00:00Z", marina)],
    events: [],
    seenAt: "2026-09-25T07:00:00Z",
  }).map((row) => row.key);
  assert.deepEqual(nextDay, ["d-2026-09-25", "c-c1", "d-2026-09-26", "new", "c-c2"]);
});

test("names: staff sees colleagues and unknown senders by name, the applicant and own messages unlabeled; runs are grouped", () => {
  const rows = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", lebedev),
      comment("c3", "2026-09-26T06:02:00Z", smirnov),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
      comment("c5", "2026-09-26T06:04:00Z", service, {
        channel: { network: "telegram", direction: "in", authorName: "Андрей · Telegram" },
      }),
      comment("c6", "2026-09-26T06:05:00Z", service, {
        channel: { network: "telegram", direction: "out", authorName: "F1Lab Поддержка · с телефона" },
      }),
    ],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    rows.map((row) => [row.key, row.side, row.showName]),
    [
      ["c-c1", "in", false],
      ["c-c2", "out", false],
      ["c-c3", "out", true],
      ["c-c4", "out", false],
      ["c-c5", "in", true],
      ["c-c6", "out", true],
    ],
  );

  const client = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", lebedev),
      comment("c3", "2026-09-26T06:02:00Z", lebedev),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
    ],
    viewer: clientViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    client.map((row) => [row.key, row.side, row.showName]),
    [
      ["c-c1", "out", false],
      ["c-c2", "in", true],
      ["c-c3", "in", false],
      ["c-c4", "in", true],
    ],
  );
});

test("gaps: 6 after a label or an event, 4 for the same author, 8 for the same side, 12 on a side switch", () => {
  const rows = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", marina),
      comment("c3", "2026-09-26T06:02:00Z", lebedev),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
      comment("c5", "2026-09-26T06:05:00Z", marina),
    ],
    events: [{ _id: "e1", kind: "taken", createdAt: "2026-09-26T06:04:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    rows.map((row) => row.gap),
    [GAP.afterLabel, GAP.sameAuthor, GAP.sideSwitch, GAP.sameSide, GAP.afterLabel],
  );
  assert.deepEqual(GAP, { afterLabel: 6, sameAuthor: 4, sameSide: 8, sideSwitch: 12 });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && node --test src/util/delivery-routes.test.js src/util/chronicle-dialog.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `delivery-routes.js` and `chronicle-dialog.js`; `# tests 2`, `# pass 0`, `# fail 2`.

- [ ] **Step 3: Implement the helpers**

`frontend/src/util/delivery-routes.js` (new file):

```js
/**
 * Заявка и мессенджеры: маршруты «Ответить через», строка «Диалог» в
 * «Деталях», подпись автора и статус доставки у записи хроники. Чистые
 * функции — тесты рядом: `node --test src/util/delivery-routes.test.js`.
 *
 * Маршруты отдаёт `GET /api/tickets/:num/delivery-routes`
 * (backend/services/messaging/origin.js#deliveryRoutes).
 */
import { NETWORK_LABEL, networkLabel, shortPersonName } from "./conversation-format.js";

/**
 * @typedef {import("../types/conversation").DeliveryRoute} DeliveryRoute
 * @typedef {import("../types/conversation").DeliveryRoutes} DeliveryRoutes
 * @typedef {{ createdAt: string, channel?: import("../types/conversation").CommentChannel | null }} ChannelComment
 */

/** «Почта и бот HD — как сейчас»: комментарий без доставки в мессенджер. */
export const NOTIFY_ROUTE = "notify";

/** Источники заявки из мессенджеров (backend/services/messaging/rules.js#TICKET_SOURCE). */
export const MESSENGER_SOURCES = new Set(["Telegram", "WhatsApp", "MAX", "Сайт"]);

/**
 * Заголовок пункта меню: «Telegram · Соколова Марина».
 * @param {DeliveryRoute} route
 * @param {string} [applicantName]
 */
export const routeTitle = (route, applicantName = "") =>
  `${networkLabel(route.network)} · ${route.title || applicantName || "собеседник"}`;

/**
 * Вторая строка пункта: занят — причиной, иначе вид чата и привязка.
 * @param {DeliveryRoute} route
 */
export const routeSubtitle = (route) => {
  if (!route.available) return route.reason || "недоступно";
  if (route.kind === "group") return "группа компании";
  return route.boundHere ? "личный чат · привязан к этой заявке" : "личный чат";
};

/**
 * Подпись кнопки выбора: «Telegram · Соколова М.»; без маршрута — «Почта и бот HD».
 * @param {DeliveryRoute | null | undefined} route
 * @param {string} [applicantName]
 */
export const routeTriggerLabel = (route, applicantName = "") =>
  route
    ? `${networkLabel(route.network)} · ${shortPersonName(route.title || applicantName) || "собеседник"}`
    : "Почта и бот HD";

/**
 * Маршрут, выбранный при открытии: тот, что предложил сервер, если он ещё
 * доступен; иначе «как сейчас». Занятый маршрут выбранным не встаёт никогда.
 * @param {DeliveryRoutes | null | undefined} data
 * @returns {string}
 */
export const initialRoute = (data) => {
  if (!data) return NOTIFY_ROUTE;
  const found = data.routes.find(
    (route) => route.conversationId === data.defaultRoute && route.available,
  );
  return found ? found.conversationId : NOTIFY_ROUTE;
};

/**
 * Строка «Диалог» в «Деталях»: привязанный к заявке чат, иначе чат последнего
 * сообщения клиента в хронике. Нет ни того, ни другого — строки нет.
 * @param {DeliveryRoute[] | null | undefined} routes
 * @param {ChannelComment[] | null | undefined} comments
 * @returns {DeliveryRoute | null}
 */
export const dialogRoute = (routes, comments) => {
  const list = routes ?? [];
  const bound = list.find((route) => route.boundHere);
  if (bound) return bound;
  const latest = [...(comments ?? [])]
    .filter(
      (comment) =>
        comment.channel?.conversationId && comment.channel.direction === "in",
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!latest) return null;
  return (
    list.find(
      (route) => route.conversationId === String(latest.channel.conversationId),
    ) ?? null
  );
};

/**
 * «Telegram · личный чат» / «Telegram · группа».
 * @param {DeliveryRoute} route
 */
export const dialogLabel = (route) =>
  `${networkLabel(route.network)} · ${route.kind === "group" ? "группа" : "личный чат"}`;

/**
 * Имя автора записи хроники. У зеркала сообщения неопознанного собеседника
 * подпись канала «Андрей · Telegram» — сеть уже названа меткой рядом, поэтому
 * хвост « · Telegram» срезаем; «F1Lab Поддержка · с телефона» остаётся как
 * есть. Без подписи — автор комментария (сотрудник или связанный клиент).
 * @param {{ channel?: import("../types/conversation").CommentChannel | null } | null | undefined} comment
 * @param {string} [personName]
 * @returns {string}
 */
export const chronicleAuthorName = (comment, personName = "") => {
  const authorName = comment?.channel?.authorName?.trim();
  if (!authorName) return personName;
  const suffix = ` · ${NETWORK_LABEL[comment.channel.network] ?? ""}`;
  return authorName.endsWith(suffix) && authorName.length > suffix.length
    ? authorName.slice(0, -suffix.length)
    : authorName;
};

/**
 * Статус доставки ответа в мессенджер → значок у метки канала: подпись для
 * `title`, вид значка и тон. `null` — статуса нет (входящее, обычный
 * комментарий).
 * @param {string | undefined} status
 * @returns {{ label: string, icon: "clock" | "check" | "double" | "warn", tone: "faint" | "accent" | "destructive" } | null}
 */
export const deliveryStatusMeta = (status) =>
  ({
    preparing: { label: "Готовится к отправке", icon: "clock", tone: "faint" },
    queued: { label: "В очереди", icon: "clock", tone: "faint" },
    sent: { label: "Отправлено", icon: "check", tone: "faint" },
    delivered: { label: "Доставлено", icon: "double", tone: "faint" },
    read: { label: "Прочитано", icon: "double", tone: "accent" },
    failed: { label: "Не доставлено", icon: "warn", tone: "destructive" },
  })[status] ?? null;
```

`frontend/src/util/chronicle-dialog.js` (new file):

```js
/**
 * «Хроника» заявки как диалог (канва D4–D8, решение владельца 26.09): чья
 * реплика с какой стороны, чья подпись и какая метка канала над пузырём, где
 * метки дней и черта «Новые». Чистые функции — тесты рядом:
 * `node --test src/util/chronicle-dialog.test.js`.
 *
 * Сторона смотрящего — справа. Сотруднику справа вся команда (своё — без
 * подписи), слева клиентская сторона: заявитель, его коллеги, собеседник из
 * мессенджера. Заявителю справа только его собственные сообщения, команда —
 * слева, по именам. Внутренних заметок в HD нет: клиент видит каждый
 * комментарий, поэтому и сторона считается одинаково честно для обоих.
 */
import { dayLabel } from "./conversation-format.js";

/**
 * @typedef {{ _id?: string, firstName?: string, lastName?: string, isEndUser?: boolean } | string | null | undefined} CommentAuthor
 * @typedef {{ network?: string, direction?: "in" | "out", authorName?: string, status?: string }} ChannelBlock
 * @typedef {{ _id: string, createdAt: string | Date, createdBy?: CommentAuthor, content?: string, quotedText?: string, source?: string, channel?: ChannelBlock | null }} ChronicleComment
 * @typedef {{ _id: string, createdAt: string | Date, kind?: string }} ChronicleEvent
 * @typedef {{ id: string, isClient: boolean }} Viewer
 * @typedef {{ type: "day", key: string, label: string }} DayRow
 * @typedef {{ type: "new", key: string, count: number }} NewRow
 * @typedef {{ type: "event", key: string, event: ChronicleEvent }} EventRow
 * @typedef {{ type: "comment", key: string, comment: ChronicleComment, side: "in" | "out", gap: number, showName: boolean }} CommentRow
 * @typedef {DayRow | NewRow | EventRow | CommentRow} ChronicleRow
 * @typedef {{ channel: { network: string, direction: "in" | "out", status?: string }, label?: string }} Marker
 */

// Отступ над пузырём, px: после метки дня, «Новых» и события — 6; та же
// сторона и тот же автор — 4; та же сторона, другой автор — 8; смена стороны — 12
export const GAP = { afterLabel: 6, sameAuthor: 4, sameSide: 8, sideSwitch: 12 };

/** id автора: у старых комментариев он лежит вложенным снимком `{ _id, … }`. */
export const authorIdOf = (author) =>
  author == null
    ? ""
    : typeof author === "object"
      ? String(author._id ?? "")
      : String(author);

/**
 * Сторона реплики для смотрящего: "out" — справа, "in" — слева.
 *
 * Клиенту справа только написанное им самим — письмом, в карточке или из
 * мессенджера; ответ команды мессенджером («out» в блоке канала) — чужой.
 * Сотруднику сторону сперва задаёт блок канала (зеркало входящего — клиент,
 * ответ — команда, в том числе «с телефона»), потом сам автор: свой — справа,
 * по признаку `isEndUser`. Автора без признака (старый снимок, удалённая
 * учётка) судим по заявителю: заявитель — слева, остальные — справа; автора
 * нет совсем — слева.
 * @param {ChronicleComment} comment
 * @param {{ viewer: Viewer, applicantId?: string | null }} context
 * @returns {"in" | "out"}
 */
export const commentSide = (comment, { viewer, applicantId = null }) => {
  const authorId = authorIdOf(comment.createdBy);
  const direction = comment.channel?.direction;
  if (viewer.isClient) {
    return authorId && authorId === viewer.id && direction !== "out" ? "out" : "in";
  }
  if (direction === "in") return "in";
  if (direction === "out") return "out";
  if (!authorId) return "in";
  if (authorId === viewer.id) return "out";
  const author = comment.createdBy;
  if (author && typeof author === "object" && typeof author.isEndUser === "boolean") {
    return author.isEndUser ? "in" : "out";
  }
  return applicantId && authorId === String(applicantId) ? "in" : "out";
};

/** Письмо: новые помечены `source`, старые узнаются по отрезанной цитате. */
export const isEmailComment = (comment) =>
  comment?.source === "email" || Boolean(comment?.quotedText);

/**
 * Метка канала над пузырём. Сотруднику — у каждой реплики с каналом (у ответа
 * мессенджером — со статусом доставки) и «письмо» у писем. Клиенту — только у
 * своих сообщений и без статуса: доставка ответов команды — не его забота.
 * @param {ChronicleComment} comment
 * @param {{ viewer: Viewer, side: "in" | "out" }} context
 * @returns {Marker | null}
 */
export const commentMarker = (comment, { viewer, side }) => {
  if (viewer.isClient && side !== "out") return null;
  const block = comment.channel?.network ? comment.channel : null;
  if (block) {
    return {
      channel: {
        network: String(block.network),
        direction: block.direction === "out" ? "out" : "in",
        ...(viewer.isClient || !block.status ? {} : { status: block.status }),
      },
    };
  }
  if (isEmailComment(comment)) {
    return { channel: { network: "mail", direction: "in" }, label: "письмо" };
  }
  return null;
};

// Кто говорит — для подписи и серий: неопознанный собеседник и ответы «с
// телефона» идут от служебной учётки, различает их подпись канала
const speakerOf = (comment) =>
  comment.channel?.authorName
    ? `name:${comment.channel.authorName}`
    : `id:${authorIdOf(comment.createdBy)}`;

/**
 * Нужна ли подпись автора (без учёта серии). Своё — без подписи. Сотруднику
 * справа — имя коллеги (и «F1Lab Поддержка · с телефона»); слева заявитель
 * без подписи — он назван в «Деталях», — а имя из подписи канала (неопознанный
 * собеседник) есть всегда. Клиенту команда слева — всегда по имени.
 */
const nameWanted = (comment, { viewer, side, applicantId }) => {
  const authorId = authorIdOf(comment.createdBy);
  const channelName = Boolean(comment.channel?.authorName);
  if (side === "out") {
    return !viewer.isClient && (channelName || authorId !== viewer.id);
  }
  if (viewer.isClient || channelName) return true;
  return !(applicantId && authorId === String(applicantId));
};

const dayKeyOf = (at, timeZone) =>
  new Date(at).toLocaleDateString("en-CA", { timeZone });

/**
 * Лента диалога: реплики и события по возрастанию времени; метка дня — при
 * смене дня; черта «Новые · N» — над первой чужой репликой новее водяного
 * знака визита (`seenAt` — знак ДО этого открытия, страница держит его весь
 * визит). События в «Новые» не входят: у записи хроники нет автора-
 * идентификатора, и своё же действие светилось бы новым. Нет знака (первый
 * визит) — нет и черты. Метка дня остаётся и над чертой: в мессенджерном
 * порядке без неё день новых реплик было бы не узнать.
 * @param {{ comments?: ChronicleComment[], events?: ChronicleEvent[], viewer: Viewer, applicantId?: string | null, seenAt?: string | Date | null, now?: Date, timeZone?: string }} input
 * @returns {ChronicleRow[]}
 */
export const chronicleRows = ({
  comments = [],
  events = [],
  viewer,
  applicantId = null,
  seenAt = null,
  now = new Date(),
  timeZone,
}) => {
  const watermark = seenAt ? new Date(seenAt).getTime() : 0;
  const isNew = (comment) =>
    watermark > 0 &&
    new Date(comment.createdAt).getTime() > watermark &&
    authorIdOf(comment.createdBy) !== viewer.id;
  const newCount = comments.filter(isNew).length;

  const items = [
    ...comments.map((comment) => ({ at: comment.createdAt, comment, event: null })),
    ...events.map((event) => ({ at: event.createdAt, comment: null, event })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  /** @type {ChronicleRow[]} */
  const rows = [];
  let lastDay = null;
  let dividerShown = false;
  /** @type {{ side: "in" | "out", speaker: string } | null} */
  let previous = null;

  for (const item of items) {
    const day = dayKeyOf(item.at, timeZone);
    if (day !== lastDay) {
      rows.push({ type: "day", key: `d-${day}`, label: dayLabel(item.at, { now, timeZone }) });
      lastDay = day;
      previous = null;
    }
    if (item.event) {
      rows.push({ type: "event", key: `e-${item.event._id}`, event: item.event });
      previous = null;
      continue;
    }
    const comment = item.comment;
    if (!dividerShown && isNew(comment)) {
      rows.push({ type: "new", key: "new", count: newCount });
      dividerShown = true;
      previous = null;
    }
    const side = commentSide(comment, { viewer, applicantId });
    const speaker = speakerOf(comment);
    const sameRun = previous !== null && previous.side === side && previous.speaker === speaker;
    const gap = !previous
      ? GAP.afterLabel
      : previous.side !== side
        ? GAP.sideSwitch
        : sameRun
          ? GAP.sameAuthor
          : GAP.sameSide;
    rows.push({
      type: "comment",
      key: `c-${comment._id}`,
      comment,
      side,
      gap,
      showName: !sameRun && nameWanted(comment, { viewer, side, applicantId }),
    });
    previous = { side, speaker };
  }
  return rows;
};
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd frontend && node --test src/util/delivery-routes.test.js src/util/chronicle-dialog.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 14`, `# pass 14`, `# fail 0`.

- [ ] **Step 5: Backend — the author's side and the e-mail tag**

`isEndUser` is a flag, not a contact, so it may travel to the end user's card like the names already do. The flag rides on the same populate that already resolves authors for the card; wherever it is missing (a deleted author, an old embedded snapshot that did not resolve), `commentSide` falls back to comparing the author with the applicant.

`backend/controllers/ticket.js`:

```diff
--- a/backend/controllers/ticket.js
+++ b/backend/controllers/ticket.js
@@ -494,7 +494,10 @@
         path: "comments",
         populate: {
           path: "createdBy",
-          select: "profileImagePath lastName firstName",
+          // isEndUser — сторона реплики в хронике-диалоге: команда справа,
+          // клиентская сторона слева (frontend util/chronicle-dialog). Не
+          // контакт: признак видит и заявитель
+          select: "profileImagePath lastName firstName isEndUser",
         },
       })
       .populate({
```

`backend/models/comment.js`:

```diff
--- a/backend/models/comment.js
+++ b/backend/models/comment.js
@@ -13,6 +13,14 @@
     quotedText: {
       type: String,
     },
+    // Откуда пришёл комментарий, если не из карточки: "email" — письмо
+    // (middleware/emailHandling.js). Хроника метит такую реплику «письмо»;
+    // у старых писем признака нет — их узнают по quotedText
+    source: {
+      type: String,
+      enum: ["email"],
+      default: undefined,
+    },
     attachments: [
       {
         mimetype: String,
```

`backend/middleware/emailHandling.js`:

```diff
--- a/backend/middleware/emailHandling.js
+++ b/backend/middleware/emailHandling.js
@@ -769,6 +769,8 @@
             const comment = new Comment({
               content,
               ...(quotedText ? { quotedText } : {}),
+              // Метка «письмо» у реплики в хронике заявки
+              source: "email",
               ticketId: ticket._id,
               attachments: email.attachments,
               notifications: {
```

Run: `cd backend && for f in controllers/ticket.js models/comment.js middleware/emailHandling.js; do node --check $f || exit 1; done && echo syntax-ok`
Expected: `syntax-ok`

Run: `cd backend && NODE_ENV=production pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 539`, `# pass 539`, `# fail 0` (no new backend tests in this task).

- [ ] **Step 6: Marker, route picker, routes hook**

`frontend/src/components/Ticket/ChannelMarker.tsx` (new file):

```tsx
import type { IconType } from "react-icons";
import {
  RiCheckDoubleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiTimeLine,
} from "react-icons/ri";

import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { cn } from "@/lib/utils";
import { networkLabel } from "@/util/conversation-format";
import { deliveryStatusMeta } from "@/util/delivery-routes";

const STATUS_ICON: Record<string, IconType> = {
  clock: RiTimeLine,
  check: RiCheckLine,
  double: RiCheckDoubleLine,
  warn: RiErrorWarningLine,
};

const TONE: Record<string, string> = {
  faint: "text-faint",
  accent: "text-accent-text",
  destructive: "text-destructive",
};

/** Что метке нужно от блока канала комментария; «mail» — письмо. */
export type MarkerChannel = {
  network: string;
  direction: "in" | "out";
  status?: string;
};

/**
 * Метка канала над пузырём хроники (канва D4): глиф и имя сети; у нашего
 * ответа — «→» и статус доставки значком («Прочитано» — бирюзой, «Не
 * доставлено» — красным). Фирменный цвет — только у глифа мессенджера; письмо
 * (`network: "mail"`, `label: "письмо"`) — нейтральное.
 */
const ChannelMarker = ({
  channel,
  label,
}: {
  channel: MarkerChannel;
  label?: string;
}) => {
  const out = channel.direction === "out";
  const status = out ? deliveryStatusMeta(channel.status) : null;
  const StatusIcon = status ? STATUS_ICON[status.icon] : null;

  return (
    <span className="inline-flex flex-none items-center gap-1 text-xs whitespace-nowrap text-faint">
      {out && <span aria-hidden>→</span>}
      <ChannelIcon network={channel.network} size={12} />
      {label ?? networkLabel(channel.network)}
      {status && StatusIcon && (
        <span className={cn("flex", TONE[status.tone])} title={status.label}>
          <StatusIcon
            size={status.icon === "double" ? 14 : 13}
            aria-label={status.label}
          />
        </span>
      )}
    </span>
  );
};

export default ChannelMarker;
```

`frontend/src/components/Ticket/ReplyRoute.tsx` (new file):

```tsx
import { useState } from "react";
import { isMobile } from "react-device-detect";
import { RiArrowDownSLine, RiCheckLine, RiMailLine } from "react-icons/ri";

import {
  ChannelIcon,
  ChannelTile,
} from "@/components/Conversation/ChannelGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { DeliveryRoute, DeliveryRoutes } from "@/types/conversation";
import {
  NOTIFY_ROUTE,
  routeSubtitle,
  routeTitle,
  routeTriggerLabel,
} from "@/util/delivery-routes";

/**
 * «Ответить через» в поле комментария заявки (канва D1 — меню, D3 — шторка
 * телефона): чаты заявителя и «Почта и бот HD — как сейчас». Занятый другой
 * заявкой чат виден, но погашен — с причиной. Выбор отправляет комментарий в
 * мессенджер (`deliverVia`), заявитель тогда не получает дубль письмом.
 */

type Option = {
  value: string;
  network: string;
  title: string;
  subtitle: string;
  disabled: boolean;
};

const optionsOf = (data: DeliveryRoutes): Option[] => [
  ...data.routes.map((route: DeliveryRoute) => ({
    value: route.conversationId,
    network: route.network,
    title: routeTitle(route, data.applicantName),
    subtitle: routeSubtitle(route),
    disabled: !route.available,
  })),
  {
    value: NOTIFY_ROUTE,
    network: "mail",
    title: "Почта и бот HD",
    subtitle: "как сейчас — уведомление о комментарии",
    disabled: false,
  },
];

const Item = ({
  option,
  selected,
  big,
  onPick,
}: {
  option: Option;
  selected: boolean;
  big: boolean;
  onPick: (value: string) => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={option.disabled}
    onClick={() => onPick(option.value)}
    className={cn(
      "flex w-full cursor-pointer appearance-none rounded-md border-0 text-left text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
      big ? "items-center gap-3 bg-transparent px-1 py-2.5" : "items-start gap-2.5 p-2 hover:bg-accent",
      !big && selected && "bg-accent",
    )}
  >
    {big ? (
      <ChannelTile
        network={option.network}
        iconSize={18}
        className="size-9 rounded-lg"
      />
    ) : option.network === "mail" ? (
      <RiMailLine size={16} aria-hidden className="mt-0.5 flex-none text-muted-foreground" />
    ) : (
      <ChannelIcon network={option.network} size={16} className="mt-0.5" />
    )}
    <span className="min-w-0 flex-1">
      <span className={cn("block", big ? "text-base leading-6" : "text-sm")}>
        {option.title}
      </span>
      <span className="block text-xs text-muted-foreground">{option.subtitle}</span>
    </span>
    {big ? (
      <span
        aria-hidden
        className={cn(
          "size-5 flex-none rounded-full",
          selected ? "border-6 border-primary" : "border-[1.5px] border-faint",
        )}
      />
    ) : (
      <span className="mt-0.5 flex w-4 flex-none text-accent-text">
        {selected && <RiCheckLine size={16} aria-hidden />}
      </span>
    )}
  </button>
);

const List = ({
  data,
  value,
  big,
  onPick,
}: {
  data: DeliveryRoutes;
  value: string;
  big: boolean;
  onPick: (value: string) => void;
}) => {
  const options = optionsOf(data);
  const notify = options[options.length - 1];
  return (
    <div role="radiogroup" aria-label="Канал ответа" className="flex flex-col">
      {options.slice(0, -1).map((option) => (
        <Item key={option.value} option={option} selected={value === option.value} big={big} onPick={onPick} />
      ))}
      <div aria-hidden className={cn("h-px bg-border-soft", big ? "my-1.5" : "-mx-1 my-1")} />
      <Item option={notify} selected={value === notify.value} big={big} onPick={onPick} />
    </div>
  );
};

const ReplyRoute = ({
  data,
  value,
  onChange,
}: {
  data: DeliveryRoutes;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const route = data.routes.find((item) => item.conversationId === value) ?? null;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={`Ответить через: ${routeTriggerLabel(route, data.applicantName)}`}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "inline-flex min-w-0 flex-none cursor-pointer appearance-none items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-semibold whitespace-nowrap text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
        isMobile ? "h-9" : "h-8",
        open ? "border-primary" : "border-border",
      )}
    >
      {route ? (
        <ChannelIcon network={route.network} size={14} />
      ) : (
        <RiMailLine size={14} aria-hidden className="flex-none text-muted-foreground" />
      )}
      <span className="truncate">{routeTriggerLabel(route, data.applicantName)}</span>
      <RiArrowDownSLine size={14} aria-hidden className="flex-none text-muted-foreground" />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border px-4 pt-4.5 pb-6"
          >
            <SheetTitle className="px-1 pb-2 text-lg font-semibold">Ответить через</SheetTitle>
            <SheetDescription className="sr-only">Канал ответа клиенту</SheetDescription>
            <List data={data} value={value} big onPick={pick} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-76 p-1">
        <div className="px-2 pt-1.5 pb-1 text-xs font-semibold text-faint">Ответить через</div>
        <List data={data} value={value} big={false} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
};

export default ReplyRoute;
```

`frontend/src/components/Ticket/use-delivery-routes.ts` (new file):

```ts
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { DeliveryRoutes } from "@/types/conversation";

/**
 * Маршруты «Ответить через» заявки (`GET /api/tickets/:num/delivery-routes`).
 * Перечитываются вместе с карточкой (`revision` — курсор её загрузчика) и после
 * ответа через мессенджер (`refresh`): ответ привязывает личный чат. Без
 * модуля «Диалоги» или права их читать запроса нет вовсе.
 */
export const useDeliveryRoutes = (
  ticketNum: number | string,
  { enabled, revision }: { enabled: boolean; revision?: string | null },
) => {
  const [data, setData] = useState<DeliveryRoutes | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return undefined;
    }
    let alive = true;
    api<DeliveryRoutes>(`/api/tickets/${ticketNum}/delivery-routes`)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((error) => console.warn("Маршруты ответа не загрузились:", error));
    return () => {
      alive = false;
    };
  }, [ticketNum, enabled, revision, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { data, refresh };
};
```

- [ ] **Step 7: The chronicle as a dialog**

The whole component is replaced: the old file is newest-first with the composer on top, and a diff would touch nearly every line. Everything the old chronicle did and the dialog does not replace is carried over: the «Переписка | Всё» switch, the «Новые · N» divider from `seenAt`, event content, file chips and the removed-file name, the collapsed technical records with their lazy log fetch, `canComment`, the AI draft handoff, the send error texts.

`frontend/src/components/Ticket/Chronicle.jsx` (whole file — replaces the current one):

```jsx
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isMobile } from "react-device-detect";
import { RiAttachment2, RiSendPlaneLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import {
  FileAttachment,
  PhotoAttachment,
} from "@/components/Conversation/MessageMedia";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { chronicleRows, commentMarker } from "@/util/chronicle-dialog";
import {
  NOTIFY_ROUTE,
  chronicleAuthorName,
  initialRoute,
} from "@/util/delivery-routes";

import useHttp from "../../hooks/use-http";
import { AuthedUserContext } from "../../store/authed-user-context";
import useViewTicketStore from "../../store/view-ticket";
import {
  displayTimeZone,
  formatDate,
  formatTime,
} from "../../util/format-date";
import {
  EVENT_TONE_CLASS,
  eventLabel,
  eventMeta,
  technicalSummary,
} from "../../util/ticket-events";
import AttachmentChip from "./View/AttachmentChip";
import ChannelMarker from "./ChannelMarker";
import ReplyRoute from "./ReplyRoute";

/**
 * Хроника заявки — переписка и события одной лентой, в виде диалога (канва
 * «Омниканальные диалоги», D4–D8; решение владельца 26.09). Один компонент для
 * сотрудника и заявителя.
 *
 * Порядок — мессенджерный: старые сверху, новые снизу, поле ответа прижато к
 * низу панели. Сторона смотрящего — справа: сотруднику справа вся команда,
 * слева клиентская сторона; заявителю справа его собственные сообщения, слева
 * команда по именам (util/chronicle-dialog). Внутренних заметок в HD нет —
 * заявитель видит каждый комментарий.
 *
 * События заявки — короткие строки по центру между репликами, в порядке
 * времени; «Переписка» их прячет. Служебные записи бэкенд сворачивает в
 * счётчик под своим событием (services/ticketEvents.js). Заявителю события
 * отбирает бэкенд (`feedForClient`), здесь отбора нет.
 */

// Лента держится низа, пока читатель у низа: пришедшая реплика не уводит
// того, кто листает вверх
const STICK_PX = 80;

const personName = (person) =>
  person && typeof person === "object"
    ? `${person.lastName || ""} ${person.firstName || ""}`.trim()
    : "";

const isImage = (attachment) =>
  Boolean(attachment.mimetype?.startsWith("image/"));

// Вложение комментария → вложение «Диалогов»: файл уже лежит в хранилище
const asMedia = (attachment) => ({
  name: attachment.name,
  originalName: attachment.originalName || attachment.name,
  mimetype: attachment.mimetype || "",
  size: 0,
  durationSec: null,
  status: "ready",
});

/**
 * Ответ, не доставленный в мессенджер (канва D4): «Не доставлено ·
 * Повторить» под пузырём; «Повторить» — тому, кто вправе отвечать
 * (`POST /api/messages/:id/retry`). Причина шлюза — в подсказке.
 */
const DeliveryFailure = ({ comment, canRetry, onRetried }) => {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await api(`/api/messages/${comment.channel.messageId}/retry`, {
        method: "POST",
      });
      onRetried(comment._id);
    } catch (error) {
      console.warn("Повтор отправки не удался:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <p
      className="mt-1 mb-0 text-right text-xs text-destructive"
      title={comment.channel.error || undefined}
    >
      Не доставлено
      {canRetry && comment.channel.messageId && (
        <>
          {" · "}
          <button
            type="button"
            disabled={busy}
            onClick={retry}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-50"
          >
            Повторить
          </button>
        </>
      )}
    </p>
  );
};

/** Цитата письма — свёрнутой строкой внутри пузыря (канва D4). */
const QuotedTail = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-1 block cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-faint hover:text-muted-foreground"
      >
        {open ? "▾ Скрыть цитату" : "▸ Показать цитату"}
      </button>
      {open && (
        <p className="mt-1 mb-0 border-s border-border ps-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {text}
        </p>
      )}
    </>
  );
};

/**
 * Реплика: подпись автора и метка канала над пузырём, текст, вложения,
 * цитата письма, время. Фото — подложкой пузыря без внутренних полей, как в
 * «Диалогах»; прочие файлы — чипами.
 */
const Bubble = ({ row, viewer, canRetry, onRetried }) => {
  const { comment, side } = row;
  const out = side === "out";
  const name = row.showName
    ? chronicleAuthorName(comment, personName(comment.createdBy)) || "—"
    : "";
  const marker = commentMarker(comment, { viewer, side });
  const attachments = comment.attachments ?? [];
  const photos = attachments.filter(isImage);
  const files = attachments.filter((attachment) => !isImage(attachment));
  const media = photos.length > 0;
  const failed =
    !viewer.isClient &&
    comment.channel?.direction === "out" &&
    comment.channel.status === "failed";

  return (
    <div
      className={cn("flex", out ? "justify-end" : "justify-start")}
      style={{ marginTop: row.gap }}
    >
      <div className="max-w-[88%] min-w-0">
        {(name || marker) && (
          <div
            className={cn(
              "mb-0.5 flex items-center gap-1.5 text-xs",
              out
                ? "me-1 justify-end text-muted-foreground"
                : "ms-1 font-semibold text-foreground",
            )}
          >
            {name && <span className="truncate">{name}</span>}
            {marker && (
              <ChannelMarker channel={marker.channel} label={marker.label} />
            )}
          </div>
        )}
        <div
          className={cn(
            "text-sm leading-5 break-words text-foreground",
            out
              ? "rounded-[14px_14px_4px_14px] bg-bubble-out"
              : "rounded-[14px_14px_14px_4px] bg-bubble-in",
            media ? "p-1 pb-1.5" : "px-3 pt-2 pb-1.5",
          )}
        >
          {photos.map((attachment) => (
            <div key={attachment.name} className="mb-1 last:mb-0">
              <PhotoAttachment
                attachment={asMedia(attachment)}
                kind="photo"
                compact={isMobile}
              />
            </div>
          ))}
          {comment.content && (
            <p
              className={cn("m-0 whitespace-pre-wrap", media && "px-2 pt-1.5")}
            >
              {comment.content}
            </p>
          )}
          {files.length > 0 && (
            <div className={cn("flex flex-wrap gap-x-1.5", media && "px-2")}>
              {files.map((attachment) => (
                <FileAttachment
                  key={attachment.name}
                  attachment={asMedia(attachment)}
                  kind="document"
                />
              ))}
            </div>
          )}
          {comment.quotedText && (
            <div className={cn(media && "px-2")}>
              <QuotedTail text={comment.quotedText} />
            </div>
          )}
          <div
            className={cn(
              "mt-0.5 text-right text-xs text-faint tabular-nums",
              media && "px-2",
            )}
            title={formatDate(comment.createdAt)}
          >
            {formatTime(comment.createdAt)}
          </div>
        </div>
        {failed && (
          <DeliveryFailure
            comment={comment}
            canRetry={canRetry}
            onRetried={onRetried}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Событие заявки — строка по центру между репликами (канва D4): значок тоном
 * каталога, подпись и человек. Под ней — содержание события (причина
 * отказа), файлы, имя удалённого файла и свёрнутые служебные записи.
 */
const EventLine = ({ event, ticketNum }) => {
  const meta = eventMeta(event.kind);
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState(null);
  const { sendRequest } = useHttp();
  const summary = technicalSummary(event.technical);
  const person = personName(event.user);

  const expand = () => {
    setExpanded((value) => !value);
    if (entries || !event.technical) return;
    const params = new URLSearchParams();
    if (event.technical.from) params.set("from", event.technical.from);
    if (event.technical.to) params.set("to", event.technical.to);
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/log?${params}`,
      },
      (data) => setEntries(data.entries ?? []),
    );
  };

  return (
    <div className="mt-3 mb-1.5">
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
        <span
          className="inline-flex max-w-[85%] items-center gap-1.5 text-center"
          title={formatDate(event.createdAt)}
        >
          <Icon
            size={14}
            aria-hidden
            className={cn("flex-none", EVENT_TONE_CLASS[meta.tone])}
          />
          <span>{[eventLabel(event), person].filter(Boolean).join(" · ")}</span>
        </span>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
      </div>

      {/* Содержание события — причина отказа: ради неё запись и открывают.
          Разбирает фразу лога бэкенд (services/ticketEvents.js#detailOf) */}
      {event.detail && (
        <p className="mx-auto mt-1 mb-0 max-w-[85%] text-center text-xs whitespace-pre-wrap text-muted-foreground">
          {event.detail}
        </p>
      )}

      {/* Файлы события — чипами: файл открывается прямо из ленты. Больше двух
          сворачиваем, как везде */}
      {event.files?.length > 0 && event.kind !== "attachmentRemoved" && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {event.files.slice(0, 2).map((file) => (
            <AttachmentChip key={file.name} attachment={file} compact />
          ))}
          {event.files.length > 2 && (
            <span className="self-center text-xs text-faint">
              ещё {event.files.length - 2}
            </span>
          )}
        </div>
      )}
      {event.kind === "attachmentRemoved" && event.files?.[0] && (
        // Удалённый файл не открыть — только назвать
        <div className="mt-1 text-center text-xs text-faint">
          «{event.files[0].originalName || event.files[0].name}»
        </div>
      )}

      {summary && (
        <div className="mt-1 text-center">
          <button
            type="button"
            onClick={expand}
            className={cn(
              "inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs hover:underline",
              event.technical.failed > 0 ? "text-warning" : "text-faint",
            )}
          >
            {expanded ? "▾" : "▸"} {summary}
          </button>
          {expanded && (
            <ul className="mx-auto mt-1.5 mb-0 max-w-[85%] list-none space-y-1 border-s border-border ps-3 text-left">
              {(entries ?? []).map((entry) => (
                <li key={entry._id} className="text-xs text-muted-foreground">
                  <span className="text-faint tabular-nums">
                    {formatTime(entry.createdAt)}
                  </span>{" "}
                  {entry.event}
                </li>
              ))}
              {entries?.length === 0 && (
                <li className="text-xs text-faint">Записей нет</li>
              )}
              {!entries && <li className="text-xs text-faint">Загрузка…</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * `messaging` — «Диалоги» для сотрудника с правом читать их (модуль включён):
 * `{ canReply, routes, onRoutesChanged }`. Без него (и у заявителя) выбора
 * «Ответить через» нет, а метки каналов у реплик остаются.
 */
const Chronicle = ({
  ticket,
  events = [],
  canComment,
  seenAt = null,
  messaging = null,
}) => {
  const { comments, updateComments } = useViewTicketStore();
  const authedUser = useContext(AuthedUserContext);
  const { sendRequest, isLoading, error } = useHttp();
  const viewer = {
    id: String(authedUser?._id ?? ""),
    isClient: Boolean(authedUser?.isEndUser),
  };

  const [mode, setMode] = useState("comments");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState([]);
  // Причина отказа сервера (например, «занят заявкой №56790»): по коду её не
  // угадать, useHttp отдаёт только statusText
  const [serverMessage, setServerMessage] = useState(null);
  const fileInput = useRef(null);
  // Хроник на странице две (колонка xl и последняя секция на узком экране):
  // у каждой свой id поля файла, иначе «Файл» видимой открывал поле скрытой
  const fileInputId = useId();
  const textarea = useRef(null);
  const scroller = useRef(null);
  const divider = useRef(null);
  const stick = useRef(true);
  const placed = useRef("");
  const forceBottom = useRef(false);

  // «Ответить через»: по умолчанию — маршрут, который предложил сервер
  // (привязанный чат, иначе канал последнего сообщения клиента). Выбор
  // человека переживает перечитывание маршрутов, пока он доступен; другая
  // заявка — выбор заново
  const routes = messaging?.routes ?? null;
  const showRoutes = Boolean(messaging?.canReply && routes?.routes.length);
  const [route, setRoute] = useState(NOTIFY_ROUTE);
  const routeChosen = useRef(false);
  useEffect(() => {
    routeChosen.current = false;
  }, [ticket._id]);
  useEffect(() => {
    setRoute((current) => {
      const stillThere =
        current === NOTIFY_ROUTE ||
        (routes?.routes ?? []).some(
          (item) => item.conversationId === current && item.available,
        );
      return routeChosen.current && stillThere ? current : initialRoute(routes);
    });
  }, [routes]);
  const pickRoute = (next) => {
    routeChosen.current = true;
    setRoute(next);
  };

  const markRetried = (commentId) =>
    updateComments(
      comments.map((comment) =>
        comment._id === commentId
          ? {
              ...comment,
              channel: { ...comment.channel, status: "queued", error: undefined },
            }
          : comment,
      ),
    );

  // Черновик из панели ИИ («Спросить заявителя»): дописываем к тому, что уже
  // набрано, забираем себе и очищаем канал — отправляет человек, не мы
  const commentDraft = useViewTicketStore((state) => state.commentDraft);
  const clearCommentDraft = useViewTicketStore(
    (state) => state.clearCommentDraft,
  );
  useEffect(() => {
    if (!commentDraft) return;
    setContent((previous) =>
      previous.trim() ? `${previous.trimEnd()}\n${commentDraft}` : commentDraft,
    );
    clearCommentDraft();
    textarea.current?.focus();
    textarea.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [commentDraft, clearCommentDraft]);

  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    if (!content.trim()) return;

    const formData = new FormData();
    formData.append("intent", "addComment");
    formData.append("content", content);
    formData.append("ticketId", ticket._id);
    for (const file of files) formData.append("attachments", file);
    const viaMessenger = showRoutes && route !== NOTIFY_ROUTE;
    if (viaMessenger) formData.append("deliverVia", route);
    setServerMessage(null);

    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/comments/add/`,
        method: "POST",
        isFormData: true,
        body: formData,
      },
      (data) => {
        if (!data.comment) {
          setServerMessage(data.message || null);
          return;
        }
        // Ответ через мессенджер привязывает личный чат — маршруты другие
        if (viaMessenger) messaging?.onRoutesChanged?.();
        setContent("");
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
        // Своё отправленное лента показывает всегда, даже если читатель
        // листал вверх
        forceBottom.current = true;
        updateComments([
          {
            ...data.comment,
            createdBy: {
              _id: authedUser._id,
              lastName: authedUser.lastName,
              firstName: authedUser.firstName,
              profileImagePath: authedUser.profileImagePath,
              isEndUser: Boolean(authedUser.isEndUser),
            },
          },
          ...comments,
        ]);
      },
    );
  };

  const rows = chronicleRows({
    comments,
    events: mode === "all" ? events : [],
    viewer,
    applicantId: ticket.applicant?._id ?? null,
    seenAt,
    timeZone: displayTimeZone(),
  });

  // Где лента открывается: при открытии заявки и смене вида — у черты
  // «Новые» (первая непрочитанная вверху панели), без неё — в конце. Дальше
  // лента держится низа, пока читатель у низа
  const anchorKey = `${ticket._id}:${mode}`;
  const lastKey = rows.length > 0 ? rows[rows.length - 1].key : "";
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (placed.current !== anchorKey) {
      placed.current = anchorKey;
      const mark = divider.current;
      node.scrollTop = mark
        ? mark.getBoundingClientRect().top -
          node.getBoundingClientRect().top +
          node.scrollTop -
          8
        : node.scrollHeight;
      stick.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
      return;
    }
    if (forceBottom.current || stick.current) {
      node.scrollTop = node.scrollHeight;
      forceBottom.current = false;
      stick.current = true;
    }
  }, [anchorKey, lastKey, rows.length]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    stick.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < STICK_PX;
  };

  const canRetry = Boolean(messaging?.canReply);

  return (
    <>
      {/* Метка — на канве над панелью и с переключателем в `action`, как у
          любой секции страницы */}
      <Eyebrow
        action={
          <Segmented
            ariaLabel="Что показывать в хронике"
            options={[
              { value: "comments", label: "Переписка" },
              { value: "all", label: "Всё" },
            ]}
            value={mode}
            onChange={setMode}
          />
        }
      >
        Хроника
      </Eyebrow>

      {/* Высота панели постоянная: лента листается внутри, поле ответа
          прижато к низу, у короткой ленты реплики стоят у поля */}
      <div className="flex h-[calc(100dvh-186px)] min-h-96 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div
          ref={scroller}
          onScroll={onScroll}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            isMobile ? "p-3" : "px-5 pt-3 pb-4",
          )}
        >
          <div className="flex min-h-full flex-col justify-end">
            {rows.length === 0 && (
              <p className="m-auto text-center text-sm text-muted-foreground">
                {mode === "comments"
                  ? "Переписки пока нет"
                  : "По заявке пока ничего не происходило"}
              </p>
            )}
            {rows.map((row) => {
              if (row.type === "day") {
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-faint uppercase first:pt-0"
                  >
                    {row.label}
                    <span aria-hidden className="h-px flex-1 bg-border-soft" />
                  </div>
                );
              }
              if (row.type === "new") {
                return (
                  <div
                    key={row.key}
                    ref={divider}
                    className="flex items-center gap-2.5 pt-3 pb-1 text-xs font-bold tracking-wider text-accent-text uppercase"
                  >
                    Новые
                    <span className="font-semibold tracking-normal tabular-nums">
                      · {row.count}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-primary/35" />
                  </div>
                );
              }
              if (row.type === "event") {
                return (
                  <EventLine
                    key={row.key}
                    event={row.event}
                    ticketNum={ticket.num}
                  />
                );
              }
              return (
                <Bubble
                  key={row.key}
                  row={row}
                  viewer={viewer}
                  canRetry={canRetry}
                  onRetried={markRetried}
                />
              );
            })}
          </div>
        </div>

        {canComment && (
          <form
            onSubmit={submit}
            className={cn(
              "flex-none border-t border-border-soft",
              isMobile ? "px-3 pt-2 pb-3" : "px-4 py-3",
            )}
          >
            <Textarea
              ref={textarea}
              rows={2}
              value={content}
              aria-label={viewer.isClient ? "Сообщение" : "Комментарий"}
              placeholder={
                viewer.isClient ? "Написать сообщение…" : "Написать комментарий…"
              }
              onChange={(changeEvent) => setContent(changeEvent.target.value)}
              // Поле растёт с текстом, но ленту не съедает: потолок — 160 px
              // на десктопе и 128 на телефоне (канва: 64 и 56 px пустым)
              className={cn(
                "resize-none",
                isMobile ? "max-h-32 min-h-14 text-base leading-5" : "max-h-40",
              )}
            />
            <div className="mt-2 flex items-center gap-2">
              {showRoutes && (
                <ReplyRoute data={routes} value={route} onChange={pickRoute} />
              )}
              <input
                ref={fileInput}
                id={fileInputId}
                type="file"
                multiple
                className="hidden"
                onChange={(changeEvent) =>
                  setFiles([...(changeEvent.target.files ?? [])])
                }
              />
              {isMobile ? (
                // Телефон (канва D6, D8): ряд короче — файл и отправка значками
                <Button
                  asChild
                  variant="outline"
                  size="icon-sm"
                  className="relative"
                >
                  <label
                    htmlFor={fileInputId}
                    aria-label="Файл"
                    className="cursor-pointer"
                  >
                    <RiAttachment2 />
                    {files.length > 0 && (
                      <span className="absolute -top-1 -right-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground">
                        {files.length}
                      </span>
                    )}
                  </label>
                </Button>
              ) : (
                <Button asChild variant="outline" size="xs">
                  <label htmlFor={fileInputId} className="cursor-pointer">
                    <RiAttachment2 />
                    {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
                  </label>
                </Button>
              )}
              {isMobile ? (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Отправить"
                  className="ms-auto"
                  disabled={isLoading || !content.trim()}
                >
                  <RiSendPlaneLine />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="xs"
                  className="ms-auto"
                  disabled={isLoading || !content.trim()}
                >
                  <RiSendPlaneLine />
                  {isLoading ? "Отправка…" : "Отправить"}
                </Button>
              )}
            </div>
            {/* Без строки отказ выглядел как «ничего не произошло»: кнопка
                отжималась, текст оставался, и человек не знал, ушёл ли он.
                Сбрасывается следующей отправкой (useHttp) */}
            {error && (
              <p className="mt-2 mb-0 text-sm text-destructive">
                {error.status === 409 && serverMessage
                  ? serverMessage
                  : sendErrorText(error.status)}
              </p>
            )}
          </form>
        )}
      </div>
    </>
  );
};

// Текст отказа — по коду, а не из ответа: у 500 и валидации сообщение служебное
// и английское, а у 403 оно про «просмотр страницы». Без кода — обрыв сети или
// не-JSON ответ (например, nginx на слишком большой файл)
const sendErrorText = (status) => {
  if (status === 403) return "Нет прав писать в эту заявку.";
  if (status === 404) return "Заявка не найдена: возможно, её удалили.";
  return "Не удалось отправить комментарий. Текст остался в поле — попробуйте ещё раз.";
};

export default Chronicle;
```

- [ ] **Step 8: «Детали» and the card**

`frontend/src/components/Ticket/View/Sections.jsx`:

```diff
--- a/frontend/src/components/Ticket/View/Sections.jsx
+++ b/frontend/src/components/Ticket/View/Sections.jsx
@@ -3,6 +3,7 @@
 import { Link, useFetcher } from "react-router";
 import DOMPurify from "dompurify";
 import {
+  RiArrowRightLine,
   RiBuilding2Line,
   RiCheckboxCircleLine,
   RiComputerLine,
@@ -20,6 +21,8 @@
 } from "react-icons/ri";
 
 import EntityLink from "@/components/app/EntityLink";
+import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
+import { MESSENGER_SOURCES, dialogLabel } from "@/util/delivery-routes";
 import UserLink from "@/components/app/UserLink";
 import ApplicantPopup from "./ApplicantPopup";
 import { useCrumbFrom } from "@/components/app/Crumbs";
@@ -385,12 +388,19 @@
   );
 };
 
+/**
+ * `dialog` — чат, через который идёт переписка по заявке (привязанный или
+ * канал последнего сообщения клиента, util/delivery-routes#dialogRoute), —
+ * строка «Диалог» со ссылкой в «Диалоги» (канва D1). Только сотруднику с
+ * правом видеть диалоги: заявителю её не передают.
+ */
 export const FactsSection = ({
   ticket,
   company,
   canEdit,
   onShowLogs,
   onEdit,
+  dialog = null,
 }) => {
   const { isEndUser } = useContext(AuthedUserContext);
   const can = useCan();
@@ -407,6 +417,15 @@
         ? formatMailSender(ticket.realSender)
         : parseMailSender(ticket.realSender)?.address
       : null;
+  // Заявка из мессенджера от неопознанного собеседника: инициатор —
+  // служебная учётка, а кто написал — «Андрей · Telegram» в realSender
+  const messengerSender =
+    !isEndUser &&
+    MESSENGER_SOURCES.has(ticket.source) &&
+    applicant?.isServiceAccount &&
+    ticket.realSender
+      ? ticket.realSender
+      : null;
   // Своя компания и свой адрес заявителю ничего не сообщают: он их знает. А
   // инициатор осмыслен, только когда им бывает НЕ он сам, — то есть у того, кто
   // заводит заявки за других (тогда инициатор — не он и в своей заявке) ИЛИ
@@ -552,6 +571,28 @@
                 {mailSender}
               </span>
             )}
+            {messengerSender && (
+              <span className="text-muted-foreground">
+                {" · собеседник: "}
+                {messengerSender}
+              </span>
+            )}
+          </PropRow>
+        )}
+
+        {dialog && (
+          <PropRow
+            icon={<ChannelIcon network={dialog.network} size={16} className="text-inherit" />}
+            label="Диалог"
+          >
+            {dialogLabel(dialog)}
+            <Link
+              to={`/conversations/${dialog.conversationId}`}
+              className="ms-1.5 inline-flex items-center gap-1 font-semibold text-accent-text no-underline hover:underline"
+            >
+              Открыть диалог
+              <RiArrowRightLine size={14} aria-hidden />
+            </Link>
           </PropRow>
         )}
 
```

`frontend/src/pages/Ticket/View.jsx`:

```diff
--- a/frontend/src/pages/Ticket/View.jsx
+++ b/frontend/src/pages/Ticket/View.jsx
@@ -4,6 +4,7 @@
   Link,
   useFetcher,
   useLoaderData,
+  useLocation,
   useNavigate,
 } from "react-router";
 import { BrowserView } from "react-device-detect";
@@ -43,6 +44,8 @@
   useChecklistTemplates,
 } from "../../components/Ticket/View/ChecklistTemplates";
 import Chronicle from "../../components/Ticket/Chronicle";
+import { useDeliveryRoutes } from "../../components/Ticket/use-delivery-routes";
+import { dialogRoute } from "@/util/delivery-routes";
 import CompanyLogsOffcanvas from "../../components/CompanyLogs/Offcanvas";
 import CustomFieldsAnswers from "@/components/app/CustomFieldsAnswers";
 import { hasAnswer } from "@/components/app/custom-fields";
@@ -118,6 +121,7 @@
   }
 
   const navigate = useNavigate();
+  const location = useLocation();
   const sheetOpen = useSheetOpen();
 
   // Справочники формы правки — заранее, чтобы «Изменить» и «Обработать» не
@@ -250,6 +254,38 @@
     works,
   });
 
+  // Пришли из «Диалогов» с «Вернуть в работу» — сразу открываем диалог
+  // возврата этой заявки (причина и права — там же). Действие должно быть
+  // среди доступных, иначе молчим
+  useEffect(() => {
+    const wanted = location.state?.openAction;
+    if (!wanted || !DIALOG_ACTIONS.includes(wanted)) return;
+    if ([primary, ...menu].some((action) => action?.key === wanted)) {
+      setDialog(wanted);
+    }
+  }, [ticket.num]);
+
+  // «Диалоги»: маршруты «Ответить через» и строка «Диалог» в «Деталях» —
+  // сотруднику с правом видеть диалоги при включённом модуле
+  const messagingOn =
+    !isEndUser &&
+    !!modules.messaging?.isActive &&
+    !!can({ conversation: ["read"] });
+  const deliveryRoutes = useDeliveryRoutes(ticket.num, {
+    enabled: messagingOn,
+    revision: data.pulse,
+  });
+  const messaging = messagingOn
+    ? {
+        canReply: !!can({ conversation: ["reply"] }),
+        routes: deliveryRoutes.data,
+        onRoutesChanged: deliveryRoutes.refresh,
+      }
+    : null;
+  const dialogChat = messagingOn
+    ? dialogRoute(deliveryRoutes.data?.routes, ticket.comments)
+    : null;
+
   // Живое обновление: пульс сообщает, что ИМЕННО эта заявка изменилась
   // (комментарий, работа, событие, ИИ), и лоадер перечитывается — когда все
   // fetcher'ы простаивают. Базой служит курсор, с которым пришли данные
@@ -582,6 +618,7 @@
           <FactsSection
             ticket={ticket}
             company={company}
+            dialog={dialogChat}
             canEdit={can({ ticket: ["manage"] }) && !ticket.isArchived}
             onShowLogs={
               // Журнал входов AD закрыт правом `company.readLogs` (ручка
@@ -739,6 +776,7 @@
             events={events}
             canComment={canComment}
             seenAt={visit.seenAt}
+            messaging={messaging}
           />
         </div>
       </div>
@@ -751,6 +789,7 @@
           events={events}
           canComment={canComment}
           seenAt={visit.seenAt}
+          messaging={messaging}
         />
       </div>
 
```

- [ ] **Step 9: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/util/delivery-routes.js src/util/delivery-routes.test.js src/util/chronicle-dialog.js src/util/chronicle-dialog.test.js src/components/Ticket/ChannelMarker.tsx src/components/Ticket/ReplyRoute.tsx src/components/Ticket/use-delivery-routes.ts src/components/Ticket/Chronicle.jsx src/components/Ticket/View/Sections.jsx src/pages/Ticket/View.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 10: Checkpoint** — no commit, no staging. With the messaging module off, the chronicle is the dialog without the route picker; the ticket card makes no request to `delivery-routes` and shows no «Диалог» row. The owner checks both viewers live (Task 14, step 5).

---

## Task 11: Notifications — the «Диалоги» category

P0 already sends in-app notices `conversationWaiting` in category `conversationMessage`. The bell needs its icon, context and a facet «Диалоги» (only for people who can open the section); «Настройки системы → Уведомления» and «Мой аккаунт → Уведомления» need the category row (in-app only — there is no e-mail or Telegram delivery for it).

**Files:**
- Modify: `frontend/src/types/notification.ts`
- Modify: `frontend/src/util/notification-meta.ts`
- Modify: `frontend/src/util/notification-facets.ts`
- Test: `frontend/src/util/notification-facets.test.js`
- Modify: `frontend/src/components/Notifications/FacetChips.tsx`
- Modify: `frontend/src/components/Preferences/Notifications.jsx`
- Modify: `frontend/src/components/User/AccountSettings/Notifications.jsx`

**Interfaces:**
- Consumes: P0 notice `{ kind: "conversationWaiting", category: "conversationMessage", link: "/conversations/<id>" }`; `useInitialPrefsStore` (`modules.messaging`), `useCan`.
- Produces: `NotificationCategory` += `"conversationMessage"`, `NotificationKind` += `"conversationWaiting"`; facet `{ key: "dialogs", label: "Диалоги", categories: ["conversationMessage"], module: "messaging" }`; `visibleFacets({ messaging: boolean }) → NotificationFacet[]`; `readAllLabel("dialogs") → "Прочитать диалоги"`.

- [ ] **Step 1: Write the failing test**

`frontend/src/util/notification-facets.test.js`:

```diff
--- a/frontend/src/util/notification-facets.test.js
+++ b/frontend/src/util/notification-facets.test.js
@@ -8,16 +8,18 @@
   facetCategories,
   readAllLabel,
   unreadInFacet,
+  visibleFacets,
 } from "./notification-facets.ts";
 
-test("шесть фасетов, «Все» первый, категории покрыты без дыр и дублей", () => {
-  assert.equal(NOTIFICATION_FACETS.length, 7);
+test("восемь фасетов, «Все» первый, категории покрыты без дыр и дублей", () => {
+  assert.equal(NOTIFICATION_FACETS.length, 8);
   assert.equal(NOTIFICATION_FACETS[0].key, "all");
   const covered = NOTIFICATION_FACETS.flatMap((facet) => facet.categories);
   assert.equal(new Set(covered).size, covered.length);
   assert.deepEqual([...covered].sort(), [
     "absenceDecision",
     "absenceRequest",
+    "conversationMessage",
     "newTicket",
     "reportApproval",
     "reportDecision",
@@ -59,3 +61,20 @@
   assert.equal(readAllLabel("comment"), "Прочитать комментарии");
   assert.equal(readAllLabel("new"), "Прочитать новые заявки");
 });
+
+test("«Диалоги» — сообщения, которые ждут ответа", () => {
+  assert.deepEqual(facetCategories("dialogs"), ["conversationMessage"]);
+  assert.equal(readAllLabel("dialogs"), "Прочитать диалоги");
+});
+
+test("фасет «Диалоги» — только тем, кому раздел открыт", () => {
+  assert.equal(
+    visibleFacets({ messaging: false }).some((facet) => facet.key === "dialogs"),
+    false,
+  );
+  assert.equal(
+    visibleFacets({ messaging: true }).some((facet) => facet.key === "dialogs"),
+    true,
+  );
+  assert.equal(visibleFacets({ messaging: false }).length, NOTIFICATION_FACETS.length - 1);
+});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/util/notification-facets.test.js`
Expected: FAIL — `SyntaxError: The requested module './notification-facets.ts' does not provide an export named 'visibleFacets'`; `# fail 1`.

- [ ] **Step 3: Types, meta, facets**

`frontend/src/types/notification.ts`:

```diff
--- a/frontend/src/types/notification.ts
+++ b/frontend/src/types/notification.ts
@@ -9,7 +9,8 @@
   | "absenceRequest"
   | "absenceDecision"
   | "reportApproval"
-  | "reportDecision";
+  | "reportDecision"
+  | "conversationMessage";
 
 /** Вид события: каталог хроники (util/ticket-events) плюс события вне заявок */
 export type NotificationKind =
@@ -36,7 +37,8 @@
   | "absenceRequest"
   | "absenceDecision"
   | "reportApproval"
-  | "reportDecision";
+  | "reportDecision"
+  | "conversationWaiting";
 
 export type NotificationActor = {
   _id: string;
```

`frontend/src/util/notification-meta.ts`:

```diff
--- a/frontend/src/util/notification-meta.ts
+++ b/frontend/src/util/notification-meta.ts
@@ -2,6 +2,7 @@
 import {
   RiCalendarEventLine,
   RiChat3Line,
+  RiDiscussLine,
   RiFileTextLine,
 } from "react-icons/ri";
 
@@ -21,6 +22,8 @@
   absenceDecision: { icon: RiCalendarEventLine, tone: "muted" },
   reportApproval: { icon: RiFileTextLine, tone: "muted" },
   reportDecision: { icon: RiFileTextLine, tone: "muted" },
+  // «Диалоги»: сообщение ждёт ответа (backend/services/messaging/notify.js)
+  conversationWaiting: { icon: RiDiscussLine, tone: "warn" },
 };
 
 export const notificationMeta = (kind: string): Meta => {
@@ -43,6 +46,7 @@
   }
   if (item.link.startsWith("/team/calendar")) return "Календарь команды";
   if (item.link.includes("/approval")) return "Согласование работ";
+  if (item.link.startsWith("/conversations")) return "Диалоги";
   return "";
 };
 
```

`frontend/src/util/notification-facets.ts`:

```diff
--- a/frontend/src/util/notification-facets.ts
+++ b/frontend/src/util/notification-facets.ts
@@ -14,6 +14,8 @@
   label: string;
   /** Пусто — «Все», фильтра нет */
   categories: NotificationCategory[];
+  /** Фасет раздела-модуля: виден, только когда раздел человеку открыт */
+  module?: "messaging";
 };
 
 export const NOTIFICATION_FACETS: NotificationFacet[] = [
@@ -26,6 +28,13 @@
     categories: ["ticketStateUpdate", "respStateUpdate"],
   },
   { key: "comment", label: "Комментарии", categories: ["ticketNewComment"] },
+  // «Диалоги» — сообщения клиентов, которые ждут ответа
+  {
+    key: "dialogs",
+    label: "Диалоги",
+    categories: ["conversationMessage"],
+    module: "messaging",
+  },
   { key: "deadline", label: "Сроки", categories: ["ticketDeadlineUpdate"] },
   { key: "works", label: "Работы", categories: ["scheduledWorks"] },
   {
@@ -40,6 +49,16 @@
   },
 ];
 
+/** Фасеты, которые стоит показать: без «Диалогов», если раздел закрыт. */
+export const visibleFacets = ({
+  messaging,
+}: {
+  messaging: boolean;
+}): NotificationFacet[] =>
+  NOTIFICATION_FACETS.filter(
+    (facet) => facet.module !== "messaging" || messaging,
+  );
+
 export const facetByKey = (key: string | null | undefined): NotificationFacet =>
   NOTIFICATION_FACETS.find((facet) => facet.key === key) ??
   NOTIFICATION_FACETS[0];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test src/util/notification-facets.test.js`
Expected: `# tests 7`, `# pass 7`, `# fail 0`.

- [ ] **Step 5: Chips and the two settings matrices**

`frontend/src/components/Notifications/FacetChips.tsx`:

```diff
--- a/frontend/src/components/Notifications/FacetChips.tsx
+++ b/frontend/src/components/Notifications/FacetChips.tsx
@@ -1,10 +1,9 @@
 import FilterChip from "@/components/app/FilterChip";
 import { cn } from "@/lib/utils";
+import { useCan } from "@/store/authed-user";
 import useNotificationsStore from "@/store/notifications";
-import {
-  NOTIFICATION_FACETS,
-  unreadInFacet,
-} from "@/util/notification-facets";
+import useInitialPrefsStore from "@/store/prefs";
+import { unreadInFacet, visibleFacets } from "@/util/notification-facets";
 
 /**
  * Ряд чипов-фасетов панели уведомлений: какой вид показать. У чипа — число
@@ -20,6 +19,13 @@
   const unreadByCategory = useNotificationsStore(
     (state) => state.unreadByCategory,
   );
+  const can = useCan();
+  const messagingOn = useInitialPrefsStore(
+    (state) => !!state.modules?.messaging?.isActive,
+  );
+  const facets = visibleFacets({
+    messaging: messagingOn && can({ conversation: ["read"] }),
+  });
 
   return (
     <div
@@ -33,7 +39,7 @@
         className,
       )}
     >
-      {NOTIFICATION_FACETS.map((item) => (
+      {facets.map((item) => (
         <FilterChip
           key={item.key}
           size="sm"
```

`frontend/src/components/Preferences/Notifications.jsx`:

```diff
--- a/frontend/src/components/Preferences/Notifications.jsx
+++ b/frontend/src/components/Preferences/Notifications.jsx
@@ -34,6 +34,8 @@
   { key: "absenceDecision", label: "Решение по отсутствию" },
   { key: "reportApproval", label: "Отчёт на согласование" },
   { key: "reportDecision", label: "Решение по отчёту" },
+  // «Диалоги»: колокольчик о сообщении, которое ждёт ответа (только в приложении)
+  { key: "conversationMessage", label: "Сообщения в диалогах" },
 ];
 
 const PrefsNotifications = ({ prefs }) => {
```

`frontend/src/components/User/AccountSettings/Notifications.jsx`:

```diff
--- a/frontend/src/components/User/AccountSettings/Notifications.jsx
+++ b/frontend/src/components/User/AccountSettings/Notifications.jsx
@@ -48,6 +48,15 @@
     label: "Запланированные работы",
     visibilityKey: "scheduledWorks",
   },
+  {
+    name: "ConversationMessage",
+    label: "Сообщения в диалогах",
+    visibilityKey: "conversationMessage",
+    // «Диалоги» — рабочее место сотрудника; письмо и бот о сообщении из
+    // мессенджера были бы шумом — только колокольчик
+    staffOnly: true,
+    inAppOnly: true,
+  },
 ];
 
 // На телефоне колонкам хватает только иконок: три подписи в 366 px не встают
@@ -101,6 +110,7 @@
     for (const { key: channel } of NOTIFY_CHANNELS) {
       notify[channel] = {};
       for (const category of CATEGORIES) {
+        if (category.inAppOnly && channel !== "inApp") continue;
         notify[channel][category.visibilityKey] =
           !!values[valueKey(channel, category)];
       }
@@ -191,7 +201,9 @@
           </span>
           {NOTIFY_CHANNELS.map(({ key: channel, label }) => {
             const key = valueKey(channel, category);
-            const disabled = channelDisabled[channel];
+            const disabled =
+              channelDisabled[channel] ||
+              (category.inAppOnly && channel !== "inApp");
             return (
               <span
                 key={channel}
```

- [ ] **Step 6: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/types/notification.ts src/util/notification-meta.ts src/util/notification-facets.ts src/util/notification-facets.test.js src/components/Notifications/FacetChips.tsx src/components/Preferences/Notifications.jsx src/components/User/AccountSettings/Notifications.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 7: Checkpoint** — no commit, no staging.

---

## Task 12: Settings — the «Диалоги» module switch and «Каналы связи»

«Модули» gets «Диалоги» as the first row — and stops switching it off on every save (Review Focus 1). A new section «Каналы связи» (after «Сбор заявок») lists the Telegram channel with its health row and «Настроить» / «Подключить», and «Почта» with a link to «Сбор заявок». «Telegram — вход» is the connect dialog: QR (with a countdown), «Войти по коду из SMS», the code and 2FA password forms, the Telegram app keys, the proxy with «Проверить», the history / read receipts / signature switches, «Отмена» / «Сохранить», and «Выйти из аккаунта» with confirmation. It learns about progress from the pulse topic `channels` (Task 2) and asks for a 2-second cadence only while a login or a proxy test is pending.

**Files:**
- Create: `frontend/src/components/Preferences/modules-payload.js`
- Test: `frontend/src/components/Preferences/modules-payload.test.js`
- Create: `frontend/src/util/channel-state.js`
- Test: `frontend/src/util/channel-state.test.js`
- Modify: `frontend/src/components/Preferences/Modules.jsx`
- Create: `frontend/src/components/Preferences/Channels.tsx`
- Create: `frontend/src/components/Preferences/TelegramChannelDialog.tsx`
- Modify: `frontend/src/pages/Preferences.jsx`

**Interfaces:**
- Consumes: Task 2 topic `channels`; Task 4 `QrCode`, `ChannelTile`, `ChannelIcon`, `SettingRow leadingClassName`, `MessagingChannel`, `ChannelJobView`; Task 8 `failureText`; `plural` (`util/plural.js`); `formatAgo` (`util/format-date`); P0 HTTP (settings gate): `GET /api/channels`, `POST /api/channels {type:"telegram", name}`, `PATCH /api/channels/:id {settings, secrets}`, `POST /api/channels/:id/login {step, value}`, `POST /api/channels/:id/logout`, `POST /api/channels/:id/test` → `{ jobId }`, `GET /api/channels/:id/jobs/:jobId` → `ChannelJobView`; `POST /api/preferences` (partial, `modules`).
- Produces:
  - `MODULE_KEYS = ["messaging","knowledgeBase","timeTracking","finances","inventory","mikrotik"]`; `modulesFromPrefs(prefsModules?) → Record<key, boolean>`; `modulesPayload(modules) → { modules: Record<key, { isActive: boolean }> }` (every key always present; finances only with time tracking).
  - `channel-state.js`: `GATEWAY_SILENCE_MS = 300000`; `proxyHost(url) → string`; `historyEnabled(settings) → boolean`; `channelHealth(channel | null, { now?, ago? }?) → { state: "ok"|"error"|"warning"|"busy"|"idle"; title; meta?; hint?; action?: "login" }`; `loginStage(channel) → "connected"|"qr"|"waiting"|"code"|"password"|"idle"`; `qrSecondsLeft(expiresAt, now?) → number | null`; `signatureExample(firstName, organization) → string`; `channelHint(channel) → string`.
  - Settings section id `channels` (anchor `#channels`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/Preferences/modules-payload.test.js` (new file):

```js
// node --test src/components/Preferences/modules-payload.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { MODULE_KEYS, modulesFromPrefs, modulesPayload } from "./modules-payload.js";

test("сохранение «Модулей» не выключает «Диалоги»: ключ уходит всегда", () => {
  const modules = modulesFromPrefs({
    messaging: { isActive: true },
    knowledgeBase: { isActive: true },
  });
  const { modules: body } = modulesPayload(modules);
  assert.deepEqual(Object.keys(body).sort(), [...MODULE_KEYS].sort());
  assert.equal(body.messaging.isActive, true);
  assert.equal(body.inventory.isActive, false);
});

test("отсутствующие в настройках модули читаются выключенными", () => {
  assert.deepEqual(modulesFromPrefs(undefined), {
    messaging: false,
    knowledgeBase: false,
    timeTracking: false,
    finances: false,
    inventory: false,
    mikrotik: false,
  });
});

test("финансы без учёта времени не включаются", () => {
  const { modules: body } = modulesPayload({ timeTracking: false, finances: true });
  assert.equal(body.finances.isActive, false);
  const { modules: on } = modulesPayload({ timeTracking: true, finances: true });
  assert.equal(on.finances.isActive, true);
});
```

`frontend/src/util/channel-state.test.js` (new file):

```js
// node --test src/util/channel-state.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelHealth,
  channelHint,
  historyEnabled,
  loginStage,
  proxyHost,
  qrSecondsLeft,
  signatureExample,
} from "./channel-state.js";

const now = new Date("2026-09-25T08:00:00Z");
const ago = () => "2 мин назад";
const channel = (extra = {}) => ({
  isActive: true,
  state: "connected",
  stateReason: "",
  gatewaySeenAt: "2026-09-25T07:59:00Z",
  lastMessageAt: "2026-09-25T07:58:00Z",
  settings: { proxyUrl: "socks5://relay.f1lab.ru:1080", historyDays: 14 },
  login: { qr: null, expiresAt: null },
  account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00" },
  ...extra,
});

test("подключён: прокси и история в подсказке (канва E1)", () => {
  assert.deepEqual(channelHealth(channel(), { now, ago }), {
    state: "ok",
    title: "Подключён",
    meta: "сообщение 2 мин назад",
    hint: "Через прокси relay.f1lab.ru · история загружена за 14 дней",
  });
  assert.equal(
    channelHealth(channel({ settings: { proxyUrl: "", historyDays: 0 } }), { now, ago }).hint,
    "Без прокси",
  );
  assert.equal(
    channelHealth(channel({ settings: { proxyUrl: "", historyDays: 1 } }), { now, ago }).hint,
    "Без прокси · история загружена за 1 день",
  );
});

test("подключён, но шлюз молчит дольше 5 минут — предупреждение", () => {
  const stale = channelHealth(channel({ gatewaySeenAt: "2026-09-25T07:50:00Z" }), { now, ago });
  assert.equal(stale.state, "warning");
  assert.equal(stale.title, "Шлюз не отвечает");
  assert.equal(stale.meta, "последний сигнал 2 мин назад");
  const never = channelHealth(channel({ gatewaySeenAt: null }), { now, ago });
  assert.equal(never.meta, "сигнала не было");
});

test("вход не завершён, сессия кончилась, ошибка — есть действие «login»", () => {
  for (const state of ["awaitingQr", "awaitingCode", "awaitingPassword"]) {
    const health = channelHealth(channel({ state }), { now, ago });
    assert.equal(health.state, "warning");
    assert.equal(health.title, "Нужен вход");
    assert.equal(health.action, "login");
  }
  const loggedOut = channelHealth(channel({ state: "loggedOut", stateReason: "" }), { now, ago });
  assert.equal(loggedOut.title, "Сессия завершена");
  assert.equal(loggedOut.hint, "Войдите заново — переписка сохранится");
  assert.equal(loggedOut.action, "login");
  const error = channelHealth(channel({ state: "error", stateReason: "Прокси не отвечает" }), { now, ago });
  assert.equal(error.state, "error");
  assert.equal(error.hint, "Прокси не отвечает");
  assert.equal(channelHealth(channel({ state: "banned" }), { now, ago }).action, undefined);
  assert.equal(channelHealth(channel({ state: "connecting" }), { now, ago }).state, "busy");
  assert.equal(channelHealth(channel({ state: "disconnected" }), { now, ago }).action, "login");
});

test("выключенный и отсутствующий канал", () => {
  assert.equal(channelHealth(channel({ isActive: false }), { now, ago }).title, "Отключён");
  assert.equal(channelHealth(null, { now, ago }).title, "Не подключён");
});

test("loginStage: что показать в диалоге входа", () => {
  assert.equal(loginStage(channel()), "connected");
  assert.equal(loginStage(channel({ state: "awaitingQr", login: { qr: "tg://login?token=x" } })), "qr");
  assert.equal(loginStage(channel({ state: "awaitingQr", login: { qr: null } })), "waiting");
  assert.equal(loginStage(channel({ state: "connecting" })), "waiting");
  assert.equal(loginStage(channel({ state: "awaitingCode" })), "code");
  assert.equal(loginStage(channel({ state: "awaitingPassword" })), "password");
  for (const state of ["disconnected", "loggedOut", "banned", "error"]) {
    assert.equal(loginStage(channel({ state })), "idle");
  }
  assert.equal(loginStage(null), "idle");
});

test("мелочи: хост прокси, секунды QR, пример подписи, подсказка канала", () => {
  assert.equal(proxyHost("socks5://user@relay.f1lab.ru:1080"), "relay.f1lab.ru");
  assert.equal(proxyHost("не адрес"), "");
  assert.equal(proxyHost(""), "");
  assert.equal(qrSecondsLeft("2026-09-25T08:00:18Z", now), 18);
  assert.equal(qrSecondsLeft("2026-09-25T07:59:00Z", now), 0);
  assert.equal(qrSecondsLeft(null, now), null);
  assert.equal(signatureExample("Игорь", "F1Lab"), "«— Игорь, F1Lab» — имя без контактов");
  assert.equal(signatureExample("", ""), "Имя и организация — без контактов");
  assert.equal(channelHint(channel()), "F1Lab Поддержка · +7 (423) 200-00-00");
  assert.equal(channelHint({ account: {} }), "Корпоративный аккаунт не подключён");
  assert.equal(historyEnabled({ historyDays: 14 }), true);
  assert.equal(historyEnabled({ historyDays: 0 }), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && node --test src/components/Preferences/modules-payload.test.js src/util/channel-state.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `modules-payload.js` and `channel-state.js`; `# fail 2`.

- [ ] **Step 3: Implement the helpers**

`frontend/src/components/Preferences/modules-payload.js` (new file):

```js
/**
 * «Модули» в настройках: состояние свитчей ↔ тело частичного POST
 * /api/preferences. Сервер ЗАМЕНЯЕТ объект modules целиком
 * (backend/controllers/preferences.js, ветка `has("modules")`): ключ, которого
 * нет в теле, выключается. Поэтому тело собирается из полного списка модулей,
 * а не из тех, что нарисованы. Чистые функции — тесты рядом:
 * `node --test src/components/Preferences/modules-payload.test.js`.
 */
export const MODULE_KEYS = [
  "messaging",
  "knowledgeBase",
  "timeTracking",
  "finances",
  "inventory",
  "mikrotik",
];

/** Свитчи из настроек: отсутствие ключа — «выключен». */
export const modulesFromPrefs = (prefsModules = {}) =>
  Object.fromEntries(
    MODULE_KEYS.map((key) => [key, Boolean(prefsModules?.[key]?.isActive)]),
  );

/** Тело сохранения: каждый модуль, финансы — только поверх учёта времени. */
export const modulesPayload = (modules) => ({
  modules: Object.fromEntries(
    MODULE_KEYS.map((key) => [
      key,
      {
        isActive:
          key === "finances"
            ? Boolean(modules.timeTracking && modules.finances)
            : Boolean(modules[key]),
      },
    ]),
  ),
});
```

`frontend/src/util/channel-state.js` (new file):

```js
/**
 * Каналы «Диалогов» в настройках: состояние канала → строка состояния
 * (`app/HealthRow`), стадия входа в диалоге подключения, подписи. Чистые
 * функции — тесты рядом: `node --test src/util/channel-state.test.js`.
 *
 * Состояния канала пишет шлюз msg-gateway событием `channel.state`
 * (docs/messaging.md, «Events»). `ago` — формат «2 мин назад» передаёт
 * вызывающий (util/format-date#formatAgo), чтобы модуль грузился в тестах.
 */
import { plural } from "./plural.js";

/** Сигнала шлюза нет дольше этого — строка состояния предупреждает. */
export const GATEWAY_SILENCE_MS = 5 * 60_000;

/** «socks5://relay.f1lab.ru:1080» → «relay.f1lab.ru»; не адрес — пусто. */
export const proxyHost = (url) => {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Включена ли загрузка истории (свитч «Загрузить историю за N дней»). */
export const historyEnabled = (settings) => (settings?.historyDays ?? 0) > 0;

const connectionHint = (channel) => {
  const host = proxyHost(channel.settings?.proxyUrl);
  const days = channel.settings?.historyDays ?? 0;
  const via = host ? `Через прокси ${host}` : "Без прокси";
  return days > 0
    ? `${via} · история загружена за ${days} ${plural(days, "день", "дня", "дней")}`
    : via;
};

/**
 * Строка состояния канала: `{ state, title, meta?, hint?, action? }` — пропсы
 * `app/HealthRow` плюс `action: "login"`, если человеку есть что сделать
 * («Показать QR»).
 * @param {import("../types/conversation").MessagingChannel | null | undefined} channel
 * @param {{ now?: Date, ago?: (date: string) => string | null }} [options]
 * @returns {{ state: "ok" | "error" | "warning" | "busy" | "idle", title: string, meta?: string, hint?: string, action?: "login" }}
 */
export const channelHealth = (channel, { now = new Date(), ago = () => "" } = {}) => {
  if (!channel) {
    return {
      state: "idle",
      title: "Не подключён",
      hint: "Войдите по QR-коду или коду из SMS",
    };
  }
  if (!channel.isActive) {
    return {
      state: "idle",
      title: "Отключён",
      hint: "Сообщения не принимаются и не отправляются",
    };
  }
  switch (channel.state) {
    case "connected": {
      const seenAt = channel.gatewaySeenAt ? new Date(channel.gatewaySeenAt) : null;
      if (!seenAt || new Date(now).getTime() - seenAt.getTime() > GATEWAY_SILENCE_MS) {
        return {
          state: "warning",
          title: "Шлюз не отвечает",
          meta: seenAt ? `последний сигнал ${ago(channel.gatewaySeenAt)}` : "сигнала не было",
          hint: "Сообщения не приходят, пока не запущен сервис msg-gateway",
        };
      }
      return {
        state: "ok",
        title: "Подключён",
        meta: channel.lastMessageAt ? `сообщение ${ago(channel.lastMessageAt)}` : undefined,
        hint: connectionHint(channel),
      };
    }
    case "connecting":
      return { state: "busy", title: "Подключается…" };
    case "awaitingQr":
    case "awaitingCode":
    case "awaitingPassword":
      return {
        state: "warning",
        title: "Нужен вход",
        hint: "Вход начат, но не завершён",
        action: "login",
      };
    case "loggedOut":
      return {
        state: "warning",
        title: "Сессия завершена",
        hint: channel.stateReason || "Войдите заново — переписка сохранится",
        action: "login",
      };
    case "banned":
      return {
        state: "error",
        title: "Аккаунт заблокирован",
        hint: channel.stateReason || "Telegram ограничил аккаунт",
      };
    case "error":
      return {
        state: "error",
        title: "Ошибка подключения",
        hint: channel.stateReason || "Проверьте прокси и войдите заново",
        action: "login",
      };
    default:
      return {
        state: "idle",
        title: "Не подключён",
        hint: "Войдите по QR-коду или коду из SMS",
        action: "login",
      };
  }
};

/**
 * Что показывать в левой колонке диалога входа:
 *   connected — аккаунт и «Выйти»;
 *   qr        — QR-код (есть `login.qr`);
 *   waiting   — вход начат, кода ещё нет;
 *   code      — поле кода из Telegram или SMS;
 *   password  — пароль двухэтапной проверки;
 *   idle      — «Получить QR-код» (не подключён, сессия кончилась, ошибка).
 * @param {import("../types/conversation").MessagingChannel | null | undefined} channel
 * @returns {"connected" | "qr" | "waiting" | "code" | "password" | "idle"}
 */
export const loginStage = (channel) => {
  switch (channel?.state) {
    case "connected":
      return "connected";
    case "awaitingQr":
      return channel.login?.qr ? "qr" : "waiting";
    case "connecting":
      return "waiting";
    case "awaitingCode":
      return "code";
    case "awaitingPassword":
      return "password";
    default:
      return "idle";
  }
};

/** Сколько секунд живёт QR-код; нет срока — null. */
export const qrSecondsLeft = (expiresAt, now = new Date()) =>
  expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - new Date(now).getTime()) / 1000))
    : null;

/** Подсказка свитча «Подписывать ответы»: пример подписи без контактов. */
export const signatureExample = (firstName, organization) => {
  const who = [firstName, organization].filter(Boolean).join(", ");
  return who ? `«— ${who}» — имя без контактов` : "Имя и организация — без контактов";
};

/** Подсказка строки канала: название аккаунта и номер (канва E1). */
export const channelHint = (channel) => {
  const account = channel?.account ?? {};
  const handle = account.phone || (account.username ? `@${account.username}` : "");
  const parts = [account.displayName, handle].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Корпоративный аккаунт не подключён";
};
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd frontend && node --test src/components/Preferences/modules-payload.test.js src/util/channel-state.test.js`
Expected: `# tests 9`, `# pass 9`, `# fail 0`.

- [ ] **Step 5: «Модули»**

`frontend/src/components/Preferences/Modules.jsx`:

```diff
--- a/frontend/src/components/Preferences/Modules.jsx
+++ b/frontend/src/components/Preferences/Modules.jsx
@@ -5,19 +5,16 @@
 import SettingRow from "@/components/app/SettingRow";
 
 import SectionForm from "./SectionForm";
+import { modulesFromPrefs, modulesPayload } from "./modules-payload";
 
 // «Модули»: функциональные области приложения. Выключенный модуль скрывает
 // свои разделы у всех пользователей и свои секции на этой странице.
 // «Учёт финансов» работает поверх «Учёта времени» — бэкенд гасит его сам,
-// UI показывает зависимость блокировкой свитча.
+// UI показывает зависимость блокировкой свитча. Тело сохранения собирается из
+// ПОЛНОГО списка модулей (modules-payload): сервер заменяет объект целиком, и
+// забытый ключ выключил бы модуль.
 const PrefsModules = ({ prefs }) => {
-  const [modules, setModules] = useState(() => ({
-    timeTracking: !!prefs.modules?.timeTracking?.isActive,
-    finances: !!prefs.modules?.finances?.isActive,
-    inventory: !!prefs.modules?.inventory?.isActive,
-    knowledgeBase: !!prefs.modules?.knowledgeBase?.isActive,
-    mikrotik: !!prefs.modules?.mikrotik?.isActive,
-  }));
+  const [modules, setModules] = useState(() => modulesFromPrefs(prefs.modules));
 
   const toggle = (key, value) =>
     setModules((current) => ({
@@ -28,17 +25,19 @@
     }));
 
   return (
-    <SectionForm
-      buildPayload={() => ({
-        modules: {
-          timeTracking: { isActive: modules.timeTracking },
-          finances: { isActive: modules.finances },
-          inventory: { isActive: modules.inventory },
-          knowledgeBase: { isActive: modules.knowledgeBase },
-          mikrotik: { isActive: modules.mikrotik },
-        },
-      })}
-    >
+    <SectionForm buildPayload={() => modulesPayload(modules)}>
+      <SettingRow
+        title="Диалоги"
+        hint="Telegram, WhatsApp, MAX и форма сайта — переписка с клиентами в одном окне"
+        htmlFor="prefs-module-messaging"
+        className="py-3"
+      >
+        <Switch
+          id="prefs-module-messaging"
+          checked={modules.messaging}
+          onCheckedChange={(value) => toggle("messaging", value)}
+        />
+      </SettingRow>
       <SettingRow
         title="База знаний"
         htmlFor="prefs-module-kb"
```

- [ ] **Step 6: «Каналы связи» and «Telegram — вход»**

Secrets are write-only: an empty secret field means «не менять» (only typed values are sent), the Telegram app keys (api_id / api_hash) are asked only while the channel has none, and «Пароль прокси» appears only when the proxy URL contains `@` (`user@host`). Login steps and «Проверить» save the draft first — the gateway reads the channel from the database.

`frontend/src/components/Preferences/Channels.tsx` (new file):

```tsx
import { useCallback, useEffect, useState } from "react";
import { RiArrowRightLine, RiMailLine, RiQrCodeLine } from "react-icons/ri";

import HealthRow from "@/components/app/HealthRow";
import SettingRow from "@/components/app/SettingRow";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import useToastStore from "@/store/toast-store";
import type { MessagingChannel } from "@/types/conversation";
import { channelHealth, channelHint } from "@/util/channel-state";
import { formatAgo } from "@/util/format-date";

import TelegramChannelDialog from "./TelegramChannelDialog";

/**
 * «Каналы связи» (канва E1 — десктоп, E4 — телефон): строка на канал —
 * название, аккаунт, «Настроить»; под ней строка состояния, которую пишет
 * шлюз msg-gateway (подключён, нужен вход, шлюз молчит). В P1 — Telegram и
 * почта (ссылкой на «Сбор заявок»); WhatsApp, MAX и форма сайта приходят со
 * своими этапами.
 *
 * Секция вне черновика страницы: канал сохраняется в своём диалоге сразу, и
 * подключают его ещё до включения модуля «Диалоги». Живые изменения — тема
 * пульса «channels» (вход по QR, итог проверки прокси).
 */
type Prefs = {
  mailbox?: { address?: string };
  contacts?: { title?: string };
};

const telegramTile = "bg-channel-telegram-tint text-channel-telegram inset-ring-transparent";

const Channels = ({ prefs }: { prefs: Prefs }) => {
  const [channels, setChannels] = useState<MessagingChannel[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ channels: MessagingChannel[] }>("/api/channels");
      setChannels(data.channels);
      setLoadFailed(false);
    } catch (error) {
      console.warn("Каналы не загрузились:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLiveTopic("channels", reload);

  const telegram = (channels ?? []).filter((channel) => channel.type === "telegram");
  const open = telegram.find((channel) => channel.id === openId) ?? null;

  // Канала ещё нет — заводим пустой и сразу открываем вход
  const connect = async () => {
    setCreating(true);
    try {
      const { channel } = await api<{ channel: MessagingChannel }>("/api/channels", {
        method: "POST",
        body: { type: "telegram", name: "Telegram" },
      });
      setChannels((current) => [...(current ?? []), channel]);
      setOpenId(channel.id);
    } catch (error) {
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось завести канал"));
    } finally {
      setCreating(false);
    }
  };

  const mailbox = prefs.mailbox?.address;

  return (
    <>
      {telegram.map((channel, index) => {
        const health = channelHealth(channel, {
          ago: (date) => formatAgo(date) ?? "",
        });
        return (
          <div key={channel.id}>
            <SettingRow
              title="Telegram — корпоративный аккаунт"
              hint={channelHint(channel)}
              leading={<ChannelIcon network="telegram" size={18} className="text-inherit" />}
              leadingClassName={telegramTile}
              divider={index > 0}
            >
              <Button
                variant="outline"
                size="sm"
                className="max-md:w-full"
                onClick={() => setOpenId(channel.id)}
              >
                Настроить
              </Button>
            </SettingRow>
            <HealthRow
              state={health.state}
              title={health.title}
              meta={health.meta}
              hint={health.hint}
              action={
                health.action === "login" ? (
                  <Button variant="outline" size="sm" onClick={() => setOpenId(channel.id)}>
                    <RiQrCodeLine />
                    Показать QR
                  </Button>
                ) : undefined
              }
            />
          </div>
        );
      })}

      {channels !== null && telegram.length === 0 && (
        <>
          <SettingRow
            title="Telegram — корпоративный аккаунт"
            hint="Клиенты пишут на корпоративный аккаунт, ответы уходят из HD"
            leading={<ChannelIcon network="telegram" size={18} className="text-inherit" />}
            leadingClassName={telegramTile}
          >
            <Button
              variant="outline"
              size="sm"
              className="max-md:w-full"
              disabled={creating}
              onClick={() => void connect()}
            >
              Подключить
            </Button>
          </SettingRow>
          <HealthRow
            state="idle"
            title="Не подключён"
            hint="Войдите по QR-коду или коду из SMS"
          />
        </>
      )}

      {loadFailed && channels === null && (
        <HealthRow
          state="error"
          title="Каналы не загрузились"
          hint="Обновите страницу"
          className="border-t-0"
        />
      )}

      <SettingRow
        title="Почта"
        hint={
          mailbox
            ? `${mailbox} — настраивается в разделе «Сбор заявок»`
            : "Настраивается в разделе «Сбор заявок»"
        }
        leading={<RiMailLine size={18} />}
        divider={channels !== null}
      >
        <Button asChild variant="ghost" size="sm" className="max-md:w-full">
          <a href="#tickets-collect">
            Сбор заявок
            <RiArrowRightLine />
          </a>
        </Button>
      </SettingRow>

      <TelegramChannelDialog
        channel={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        organization={prefs.contacts?.title ?? ""}
        onChanged={reload}
      />
    </>
  );
};

export default Channels;
```

`frontend/src/components/Preferences/TelegramChannelDialog.tsx` (new file):

```tsx
import { useEffect, useState, type ReactNode } from "react";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiQrCodeLine,
} from "react-icons/ri";

import ConfirmDialog from "@/components/app/ConfirmDialog";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import QrCode from "@/components/app/QrCode";
import { ChannelTile } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthedUser } from "@/store/authed-user";
import usePulseStore from "@/store/pulse";
import useToastStore from "@/store/toast-store";
import type { ChannelJobView, MessagingChannel } from "@/types/conversation";
import {
  historyEnabled,
  loginStage,
  qrSecondsLeft,
  signatureExample,
} from "@/util/channel-state";
import { plural } from "@/util/plural";

/**
 * «Telegram — вход» (канва E3 для WhatsApp, перенесённая на Telegram): слева
 * вход — QR-код, код из Telegram или SMS, пароль двухэтапной проверки; справа
 * шаги, ключи приложения Telegram и прокси с «Проверить»; ниже — настройки
 * канала свитчами. «Сохранить» пишет настройки и секреты канала; вход и
 * проверка сначала сохраняют введённое — шлюз читает канал из базы.
 *
 * Состояние входа пишет шлюз (`channel.state`), страница узнаёт о нём из
 * пульса (тема «channels»); пока вход или проверка идут, пульс чаще — 2 с.
 */

const DEFAULT_HISTORY_DAYS = 14;
const LOGIN_CADENCE_MS = 2_000;

type Draft = {
  proxyUrl: string;
  proxyPassword: string;
  apiId: string;
  apiHash: string;
  historyOn: boolean;
  historyDays: number;
  markReadOnOpen: boolean;
  signReplies: boolean;
};

const draftOf = (channel: MessagingChannel): Draft => ({
  proxyUrl: channel.settings.proxyUrl ?? "",
  proxyPassword: "",
  apiId: "",
  apiHash: "",
  historyOn: historyEnabled(channel.settings),
  historyDays: channel.settings.historyDays || DEFAULT_HISTORY_DAYS,
  markReadOnOpen: channel.settings.markReadOnOpen !== false,
  signReplies: channel.settings.signReplies !== false,
});

type ProxyCheck =
  | { state: "idle" }
  | { state: "busy"; jobId: string }
  | { state: "ok"; latencyMs: number | null }
  | { state: "error"; error: string };

const toast = (variant: "success" | "danger", message: string) =>
  useToastStore.getState().showToast(variant, message);

const OptionRow = ({
  id,
  title,
  hint,
  checked,
  onChange,
  first = false,
}: {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  first?: boolean;
}) => (
  <div
    className={cn(
      "flex items-center gap-3 py-2.5",
      !first && "border-t border-border-soft",
    )}
  >
    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </div>
);

const QrBox = ({ children }: { children: ReactNode }) => (
  <div className="grid size-54 place-items-center rounded-xl border border-border bg-white">
    {children}
  </div>
);

const TelegramChannelDialog = ({
  channel,
  onOpenChange,
  organization,
  onChanged,
}: {
  /** Открытый канал; `null` — диалог закрыт. */
  channel: MessagingChannel | null;
  onOpenChange: (open: boolean) => void;
  organization: string;
  onChanged: () => Promise<void> | void;
}) => {
  const me = useAuthedUser();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [codeLogin, setCodeLogin] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [proxy, setProxy] = useState<ProxyCheck>({ state: "idle" });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const channelId = channel?.id ?? null;
  // Другой канал или новое открытие — поля с сервера, вход с начала
  useEffect(() => {
    if (!channel) return;
    setDraft(draftOf(channel));
    setCodeLogin(false);
    setPhone("");
    setCode("");
    setPassword("");
    setProxy({ state: "idle" });
  }, [channelId]);

  const stage = loginStage(channel);
  const waitingGateway =
    stage === "waiting" || stage === "qr" || proxy.state === "busy";

  // Пока ждём шлюз — пульс чаще, чтобы QR и итог проверки приходили быстро
  useEffect(() => {
    if (!channel || !waitingGateway) return undefined;
    return usePulseStore.getState().requestCadence(LOGIN_CADENCE_MS);
  }, [channel, waitingGateway]);

  // Итог проверки прокси: задание шлюзу закрывается — тема «channels» движется
  useLiveTopic(
    "channels",
    async () => {
      if (!channel || proxy.state !== "busy") return;
      const { job } = await api<{ job: ChannelJobView }>(
        `/api/channels/${channel.id}/jobs/${proxy.jobId}`,
      );
      if (job.state === "done") {
        const latency = (job.result as { latencyMs?: number } | null)?.latencyMs;
        setProxy({ state: "ok", latencyMs: typeof latency === "number" ? latency : null });
      } else if (job.state === "failed" || job.state === "cancelled") {
        setProxy({ state: "error", error: job.error || "Прокси не отвечает" });
      }
    },
    { enabled: proxy.state === "busy" },
  );

  // Обратный отсчёт QR — часы экрана, не опрос данных
  useEffect(() => {
    if (stage !== "qr") return undefined;
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [stage]);

  if (!channel || !draft) return null;

  const patch = (values: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...values } : current));

  const keysSet = channel.secrets.tgApiId && channel.secrets.tgApiHash;
  const keysReady = Boolean(keysSet || (draft.apiId.trim() && draft.apiHash.trim()));

  /** Настройки и непустые секреты — в канал. Пустой секрет значит «не менять». */
  const save = async () => {
    const secrets: Record<string, string> = {};
    if (draft.apiId.trim()) secrets.tgApiId = draft.apiId.trim();
    if (draft.apiHash.trim()) secrets.tgApiHash = draft.apiHash.trim();
    if (draft.proxyPassword) secrets.proxyPassword = draft.proxyPassword;
    await api(`/api/channels/${channel.id}`, {
      method: "PATCH",
      body: {
        settings: {
          proxyUrl: draft.proxyUrl.trim(),
          historyDays: draft.historyOn ? draft.historyDays : 0,
          markReadOnOpen: draft.markReadOnOpen,
          signReplies: draft.signReplies,
        },
        ...(Object.keys(secrets).length ? { secrets } : {}),
      },
    });
    patch({ apiId: "", apiHash: "", proxyPassword: "" });
  };

  /** Действие со шлюзом: сперва сохранить введённое, потом команда. */
  const run = async (request: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await save();
      await request();
      await onChanged();
    } catch (error) {
      toast("danger", failureText(error, failed));
    } finally {
      setBusy(false);
    }
  };

  const loginStep = (step: "start" | "phone" | "code" | "password", value?: string) =>
    run(
      () =>
        api(`/api/channels/${channel.id}/login`, {
          method: "POST",
          body: value === undefined ? { step } : { step, value },
        }),
      "Не удалось передать шлюзу шаг входа",
    );

  const checkProxy = async () => {
    setBusy(true);
    try {
      await save();
      const { jobId } = await api<{ jobId: string }>(`/api/channels/${channel.id}/test`, {
        method: "POST",
      });
      setProxy({ state: "busy", jobId });
    } catch (error) {
      setProxy({ state: "error", error: failureText(error, "Проверка не запустилась") });
    } finally {
      setBusy(false);
    }
  };

  const saveAndClose = async () => {
    setBusy(true);
    try {
      await save();
      await onChanged();
      toast("success", "Канал сохранён");
      onOpenChange(false);
    } catch (error) {
      toast("danger", failureText(error, "Не удалось сохранить канал"));
    } finally {
      setBusy(false);
    }
  };

  const logout = () =>
    run(
      () => api(`/api/channels/${channel.id}/logout`, { method: "POST" }),
      "Не удалось выйти из аккаунта",
    ).then(() => setConfirmLogout(false));

  const seconds = qrSecondsLeft(channel.login.expiresAt, now);
  const account = channel.account;

  const subtitle =
    stage === "connected"
      ? "Клиенты пишут на этот аккаунт — ответы уходят из HD."
      : channel.state === "loggedOut"
        ? "Сессия завершена — войдите заново, переписка сохранится."
        : "Войдите корпоративным аккаунтом — переписка с клиентами появится в «Диалогах».";

  // Левая колонка — вход по стадиям (util/channel-state#loginStage)
  const loginPanel = (() => {
    if (stage === "connected") {
      return (
        <div className="rounded-xl border border-border p-4">
          <ChannelTile network="telegram" iconSize={22} className="size-11 rounded-xl" />
          <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-accent-text">
            <RiCheckLine size={16} aria-hidden />
            Подключён
          </div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {account.displayName || "Корпоративный аккаунт"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {account.phone || (account.username ? `@${account.username}` : "")}
          </div>
          <Button
            variant="ghost"
            size="xs"
            className="mt-3 -ml-2 text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmLogout(true)}
          >
            Выйти из аккаунта
          </Button>
        </div>
      );
    }
    if (stage === "code") {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) void loginStep("code", code.trim());
          }}
        >
          <Field label="Код из Telegram или SMS" htmlFor="tg-login-code">
            <Input
              id="tg-login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !code.trim()}>
            Войти
          </Button>
        </form>
      );
    }
    if (stage === "password") {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password) void loginStep("password", password);
          }}
        >
          <Field
            label="Пароль двухэтапной проверки"
            htmlFor="tg-login-password"
            hint="Облачный пароль аккаунта Telegram"
          >
            <PasswordInput
              id="tg-login-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !password}>
            Войти
          </Button>
        </form>
      );
    }
    if (codeLogin) {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (phone.trim()) void loginStep("phone", phone.trim());
          }}
        >
          <Field label="Номер телефона" htmlFor="tg-login-phone">
            <Input
              id="tg-login-phone"
              type="tel"
              autoComplete="tel"
              placeholder="+7 900 000-00-00"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !phone.trim() || !keysReady}
          >
            Получить код
          </Button>
          <button
            type="button"
            onClick={() => setCodeLogin(false)}
            className="mt-2 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-center text-sm font-semibold text-accent-text"
          >
            Войти по QR-коду
          </button>
        </form>
      );
    }
    return (
      <>
        <QrBox>
          {stage === "qr" && channel.login.qr ? (
            <QrCode data={channel.login.qr} size={168} />
          ) : stage === "waiting" ? (
            <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <RiLoader4Line size={24} aria-hidden className="animate-spin text-primary" />
              Получаем код…
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 text-center">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !keysReady}
                onClick={() => void loginStep("start")}
              >
                <RiQrCodeLine />
                Получить QR-код
              </Button>
              {!keysReady && (
                <span className="text-xs text-muted-foreground">
                  Сначала укажите ключи приложения
                </span>
              )}
            </span>
          )}
        </QrBox>
        {stage === "qr" && seconds !== null && (
          <div className="mt-2.5 text-center text-xs text-muted-foreground">
            {seconds > 0 ? `Код обновится через ${seconds} с` : "Код обновляется…"}
          </div>
        )}
        <div className="mt-1 text-center">
          <button
            type="button"
            onClick={() => setCodeLogin(true)}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-accent-text"
          >
            Войти по коду из SMS
          </button>
        </div>
        {channel.state === "error" && channel.stateReason && (
          <p className="mt-2 mb-0 text-center text-sm text-destructive">
            {channel.stateReason}
          </p>
        )}
      </>
    );
  })();

  const steps = [
    "Откройте Telegram на корпоративном телефоне.",
    "Настройки → Устройства → Подключить устройство.",
    "Наведите камеру на код слева.",
  ];

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="block max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-170">
          <DialogTitle className="text-lg leading-7 font-semibold">
            Telegram — вход
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {subtitle}
          </DialogDescription>

          <div className="mt-5 flex flex-col gap-6 md:flex-row">
            <div className="w-full flex-none md:w-54">{loginPanel}</div>
            <div className="min-w-0 flex-1">
              {stage !== "connected" && !codeLogin && stage !== "code" && stage !== "password" && (
                <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {steps.map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-sm">
                      <span className="grid size-5 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}

              {!keysSet && (
                <div className="mt-4.5">
                  <div className="mb-1.5 text-sm font-semibold text-muted-foreground">
                    Ключи приложения Telegram
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="api_id"
                      placeholder="api_id"
                      value={draft.apiId}
                      onChange={(event) => patch({ apiId: event.target.value })}
                    />
                    <Input
                      aria-label="api_hash"
                      placeholder="api_hash"
                      value={draft.apiHash}
                      onChange={(event) => patch({ apiHash: event.target.value })}
                    />
                  </div>
                  <p className="mt-1.5 mb-0 text-sm text-muted-foreground">
                    my.telegram.org → API development tools
                  </p>
                </div>
              )}

              <label htmlFor="tg-proxy" className="mt-4.5 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                  Прокси
                </span>
                <span className="flex gap-2">
                  <Input
                    id="tg-proxy"
                    placeholder="socks5://host:1080"
                    value={draft.proxyUrl}
                    onChange={(event) => {
                      patch({ proxyUrl: event.target.value });
                      setProxy({ state: "idle" });
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || proxy.state === "busy" || !draft.proxyUrl.trim()}
                    onClick={() => void checkProxy()}
                  >
                    Проверить
                  </Button>
                </span>
              </label>
              {draft.proxyUrl.includes("@") && (
                <Field
                  label="Пароль прокси"
                  htmlFor="tg-proxy-password"
                  hint={channel.secrets.proxyPassword ? "Задан — пусто значит «не менять»" : undefined}
                  className="mt-3 mb-0"
                >
                  <PasswordInput
                    id="tg-proxy-password"
                    autoComplete="new-password"
                    value={draft.proxyPassword}
                    onChange={(event) => patch({ proxyPassword: event.target.value })}
                  />
                </Field>
              )}
              {proxy.state !== "idle" && (
                <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                  {proxy.state === "busy" && (
                    <>
                      <RiLoader4Line size={16} aria-hidden className="animate-spin" />
                      Проверяем…
                    </>
                  )}
                  {proxy.state === "ok" && (
                    <>
                      <RiCheckLine size={16} aria-hidden className="text-accent-text" />
                      <span>
                        <span className="font-semibold text-accent-text">Прокси отвечает</span>
                        {proxy.latencyMs !== null && ` · ${proxy.latencyMs} мс`}
                      </span>
                    </>
                  )}
                  {proxy.state === "error" && (
                    <>
                      <RiErrorWarningLine size={16} aria-hidden className="text-destructive" />
                      <span>
                        <span className="font-semibold text-destructive">Прокси не отвечает</span>
                        {` · ${proxy.error}`}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-border-soft pt-1.5">
            <OptionRow
              id="tg-history"
              first
              title={`Загрузить историю за ${draft.historyDays} ${plural(draft.historyDays, "день", "дня", "дней")}`}
              hint="Только текст; вложения — по клику"
              checked={draft.historyOn}
              onChange={(value) => patch({ historyOn: value })}
            />
            <OptionRow
              id="tg-mark-read"
              title="Отмечать прочитанным при открытии"
              hint="Клиент видит, что его сообщение прочитали"
              checked={draft.markReadOnOpen}
              onChange={(value) => patch({ markReadOnOpen: value })}
            />
            <OptionRow
              id="tg-sign"
              title="Подписывать ответы"
              hint={signatureExample(me.firstName ?? "", organization)}
              checked={draft.signReplies}
              onChange={(value) => patch({ signReplies: value })}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button disabled={busy} onClick={() => void saveAndClose()}>
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Выйти из аккаунта Telegram?"
        description="Новые сообщения перестанут приходить в «Диалоги», пока не войдёте снова. Переписка сохранится."
        confirmLabel="Выйти"
        confirmVariant="destructive"
        isLoading={busy}
        onConfirm={() => void logout()}
      />
    </>
  );
};

export default TelegramChannelDialog;
```

- [ ] **Step 7: The settings page**

The section sits outside the page's draft bar (the dialog saves on its own), gated like the other general settings.

`frontend/src/pages/Preferences.jsx`:

```diff
--- a/frontend/src/pages/Preferences.jsx
+++ b/frontend/src/pages/Preferences.jsx
@@ -12,6 +12,7 @@
 import PrefsSecurity from "../components/Preferences/Security";
 import PrefsTickets from "../components/Preferences/Tickets";
 import PrefsTicketsCollect from "../components/Preferences/TicketsCollect";
+import PrefsChannels from "../components/Preferences/Channels";
 import PrefsNotifications from "../components/Preferences/Notifications";
 import PrefsModules from "../components/Preferences/Modules";
 import PrefsIntegrations from "../components/Preferences/Integrations";
@@ -158,6 +159,14 @@
       label: "Сбор заявок",
       element: <PrefsTicketsCollect prefs={prefs} />,
     },
+    // «Каналы связи» — мессенджеры и форма сайта для «Диалогов». Секция не
+    // входит в черновик страницы: канал сохраняется своей кнопкой в диалоге
+    // подключения, а подключают его и до включения модуля
+    general && {
+      id: "channels",
+      label: "Каналы связи",
+      element: <PrefsChannels prefs={prefs} />,
+    },
     // «Сбор заявок» — про то, как заявки приходят; «Заявки» — про то, как за
     // ними следят: срок, чек-листы, правила среза «давно без движения».
     general && {
```

- [ ] **Step 8: Lint, typecheck, build**

Run: `cd frontend && pnpm exec eslint src/components/Preferences/modules-payload.js src/components/Preferences/modules-payload.test.js src/util/channel-state.js src/util/channel-state.test.js src/components/Preferences/Modules.jsx src/components/Preferences/Channels.tsx src/components/Preferences/TelegramChannelDialog.tsx src/pages/Preferences.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 9: Checkpoint** — no commit, no staging.

---

## Task 13: Channel failure alert for admins

Spec, «Risks»: «ban/logout → channel state + admin alert»; «Session loss (WA 14-day rule, TG «terminate sessions»): loggedOut + in-app alert». P0 writes the state and Task 12 shows it in «Каналы связи», but nobody is told. Now, when a `channel.state` event moves a channel **into** `loggedOut`, `banned` or `error` from a different state, everyone who can open the channel settings gets one bell row «Канал «Telegram»: сессия завершена» with the gateway's reason, linking straight to the section.

- **Once per transition.** `ingestChannelState` reads the previous state and writes the new one with a compare-and-set filter (`{ _id, state: previous }`); only the delivery whose write matched rings the bell. A replay, a second delivery of the same event or a repeated state report finds `previous === next` and stays silent; a lost race re-reads and decides again (two attempts, then a plain write without a bell — the winner already rang).
- **Error flapping.** P1a reports `error` («Нет связи с Telegram — переподключаемся») after 60 s without a connection and `connected` when it is back, so a flaky network would ring on every blip. `error` therefore rings at most once per 6 hours per channel (`Channel.errorAlertedAt`, claimed in the same conditional write). `loggedOut` and `banned` always ring: they cannot repeat without a person logging in again in between. A disabled channel (`isActive: false`) never rings.
- **Recipients:** `permissionFilter("settings.manage")` (administrators and roles granting it; staff audience), minus service accounts and anyone `isBanned` (the ban's expiry is respected). The «Диалоги» module switch is deliberately not checked: channels are connected before the module is turned on (Task 12), and the link leads to the settings page these people can always open.
- **Kind and category.** New kind `channelState` (`EXTRA_KINDS`). There is no admin/system category in `services/notificationCategories.js`, and a new one would mean a new preference field in the organisation defaults and in both settings matrices for a single rare alert, so the alert uses the closest existing category, `conversationMessage`: the same module, the same in-app-only delivery (no e-mail or bot row exists for it), switched on for every organisation by the P0 migration `initMessaging`, and grouped under the bell facet «Диалоги» (Task 11). The price: a person who switches this category off loses both kinds, so the category row is renamed «Диалоги и каналы связи» in both settings matrices.
- **Texts** carry names only: the channel name and the gateway's reason (or a fixed hint), never the corporate account's phone or username. Link: `/preferences#channels` — and the settings page now scrolls to a section named by the URL hash (the router does not).

**Files:**
- Create: `backend/services/messaging/channelAlert.js`
- Test: `backend/services/messaging/channelAlert.test.js`
- Modify: `backend/services/messaging/ingest.js` (`ingestChannelState`)
- Modify: `backend/models/channel.js` (`errorAlertedAt`; on top of Task 2)
- Modify: `backend/models/inAppNotification.js` (`EXTRA_KINDS` += `channelState`)
- Modify: `frontend/src/types/notification.ts`, `frontend/src/util/notification-meta.ts`, `frontend/src/util/notification-facets.ts` (on top of Task 11)
- Modify: `frontend/src/components/Preferences/Notifications.jsx`, `frontend/src/components/User/AccountSettings/Notifications.jsx` (row label; on top of Task 11)
- Modify: `frontend/src/pages/Preferences.jsx` (scroll to the hash section; on top of Task 12)

**Interfaces:**
- Consumes: P0 `ingestEvent` → `ingestChannelState(event)` (`event: { type: "channel.state", channelId, state, reason?, account?, login? }`, validated by `services/messaging/events.js`); `pushInApp({ recipients, category, kind, title, text, link })` (`services/inAppNotifications.js` — drops service/banned users and anyone whose category is off); `permissionFilter(actionId)` (`services/permissions.js`); `isBanned(user)` (`services/authBan.js`); Task 2's pulse plugin on `Channel` (the conditional `updateOne` still moves topic `channels`); Task 11's `NotificationKind`, `EXTRA` meta map, facet «Диалоги», category rows; Task 12's settings section id `channels`; `scrollToSection(scroller, id, smooth)` (`components/app/AnchorRail.jsx`).
- Produces:
  - `channelAlert.js`: `ALERT_STATES: Set<"loggedOut" | "banned" | "error">`; `ERROR_REPEAT_MS = 21600000`; `CHANNEL_SETTINGS_LINK = "/preferences#channels"`; `shouldAlertChannelState({ previous?, next, active? = true, errorAlertedAt? = null, now? = new Date() }) → boolean`; `channelAlertText(channel, state, reason?) → { title: string; text: string }`; `alertChannelState({ channel, state, reason? }) → Promise<number>` (rows inserted; never throws — a failure is logged, the state is already written).
  - `Channel.errorAlertedAt: Date | null` (not exposed by `publicChannel`).
  - In-app notification `{ kind: "channelState", category: "conversationMessage", link: "/preferences#channels" }`; frontend `NotificationKind` += `"channelState"`, meta `{ icon: RiLinkUnlinkM, tone: "bad" }`, context «Настройки системы · Каналы связи».

- [ ] **Step 1: Write the failing test**

`backend/services/messaging/channelAlert.test.js` (new file):

```js
// node --test services/messaging/channelAlert.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  CHANNEL_SETTINGS_LINK,
  ERROR_REPEAT_MS,
  channelAlertText,
  shouldAlertChannelState,
} = require("./channelAlert");

const now = new Date("2026-09-26T08:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);

test("a channel falling into loggedOut, banned or error from another state alerts", () => {
  for (const next of ["loggedOut", "banned", "error"]) {
    assert.equal(shouldAlertChannelState({ previous: "connected", next, now }), true, next);
  }
  // Сбой сменился другим сбоем — это новость (ошибка → блокировка)
  assert.equal(shouldAlertChannelState({ previous: "error", next: "banned", now }), true);
  assert.equal(shouldAlertChannelState({ previous: "loggedOut", next: "error", now }), true);
  assert.equal(shouldAlertChannelState({ previous: "awaitingQr", next: "loggedOut", now }), true);
});

test("the same state again (replay, second delivery), healthy states and a disabled channel stay silent", () => {
  for (const state of ["loggedOut", "banned", "error"]) {
    assert.equal(shouldAlertChannelState({ previous: state, next: state, now }), false, state);
  }
  for (const next of ["connected", "connecting", "awaitingQr", "awaitingCode", "awaitingPassword", "disconnected"]) {
    assert.equal(shouldAlertChannelState({ previous: "error", next, now }), false, next);
  }
  assert.equal(shouldAlertChannelState({ previous: "connected", next: "loggedOut", active: false, now }), false);
});

test("error alerts at most once per 6 hours per channel; loggedOut and banned always", () => {
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "error", errorAlertedAt: ago(60 * 60_000), now }),
    false,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "error", errorAlertedAt: ago(ERROR_REPEAT_MS), now }),
    true,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "loggedOut", errorAlertedAt: ago(60_000), now }),
    true,
  );
  assert.equal(
    shouldAlertChannelState({ previous: "connected", next: "banned", errorAlertedAt: ago(60_000), now }),
    true,
  );
});

test("the bell row names the channel and the reason — never the account's phone or username", () => {
  const channel = {
    name: "Telegram",
    account: { displayName: "F1Lab Поддержка", phone: "+7 (423) 200-00-00", username: "f1lab_support" },
  };
  assert.deepEqual(
    channelAlertText(channel, "loggedOut", "Сессию завершили в Telegram — войдите заново (SESSION_REVOKED)"),
    {
      title: "Канал «Telegram»: сессия завершена",
      text: "Сессию завершили в Telegram — войдите заново (SESSION_REVOKED)",
    },
  );
  assert.equal(channelAlertText(channel, "banned").title, "Канал «Telegram»: аккаунт заблокирован");
  assert.equal(
    channelAlertText(channel, "error", "  ").text,
    "Сообщения не принимаются, пока канал не подключится",
  );
  const rows = JSON.stringify(["loggedOut", "banned", "error"].map((state) => channelAlertText(channel, state)));
  assert.equal(rows.includes("200-00-00"), false);
  assert.equal(rows.includes("f1lab_support"), false);
  assert.equal(CHANNEL_SETTINGS_LINK, "/preferences#channels");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_ENV=production node --test services/messaging/channelAlert.test.js`
Expected: FAIL — `Error: Cannot find module './channelAlert'`; `# tests 1`, `# pass 0`, `# fail 1`.

- [ ] **Step 3: Implement the decision, the texts and the send**

Models and services are required inside `alertChannelState`, so the test loads the module without a database or module aliases.

`backend/services/messaging/channelAlert.js` (new file):

```js
/**
 * Колокольчик администраторам, когда канал «Диалогов» перестал работать
 * (спека, «Risks»: блокировка и выход — состояние канала и оповещение;
 * потеря сессии — «Завершить другие сеансы» в Telegram, правило 14 дней у
 * WhatsApp). Шлюз сообщает это событием `channel.state`; ingest.js пишет
 * состояние условно по прежнему (compare-and-set) и зовёт alertChannelState,
 * только если решение ниже сказало «да» — повтор события, повторная доставка
 * и гонка двух доставок колокольчик второй раз не будят.
 *
 * Кому: каждому, кто может открыть настройки каналов (`settings.manage`),
 * кроме отключённых и служебных учёток. Категория — `conversationMessage`:
 * системной категории нет, а эта — тот же модуль «Диалоги» и тот же канал
 * доставки «только в приложении». Модуль «Диалоги» не проверяется: каналы
 * подключают и до его включения, а ссылка ведёт в настройки, которые
 * получателю открыты всегда.
 *
 * Чистые функции — тесты рядом: `node --test services/messaging/channelAlert.test.js`.
 */

/** Состояния, о входе в которые сообщаем. */
const ALERT_STATES = new Set(["loggedOut", "banned", "error"]);

// «error» шлюз сообщает и после минуты без связи с мессенджером («Нет связи
// с Telegram — переподключаемся»), а сеть может «моргать» — об этом не чаще
// раза в 6 часов на канал. loggedOut и banned сами не повторяются: между ними
// всегда новый вход человеком
const ERROR_REPEAT_MS = 6 * 60 * 60 * 1000;

/** Секция «Каналы связи» в «Настройках системы» (pages/Preferences, id `channels`). */
const CHANNEL_SETTINGS_LINK = "/preferences#channels";

/**
 * Будить ли колокольчик на этот переход.
 * @param {{ previous?: string | null, next: string, active?: boolean, errorAlertedAt?: Date | string | null, now?: Date }} input
 * @returns {boolean}
 */
const shouldAlertChannelState = ({ previous = null, next, active = true, errorAlertedAt = null, now = new Date() }) => {
  // Выключенный канал человек отключил сам — его сбои никого не ждут
  if (active === false) return false;
  if (!ALERT_STATES.has(next) || previous === next) return false;
  if (next !== "error" || !errorAlertedAt) return true;
  return now.getTime() - new Date(errorAlertedAt).getTime() >= ERROR_REPEAT_MS;
};

const STATE_TITLE = {
  loggedOut: "сессия завершена",
  banned: "аккаунт заблокирован",
  error: "нет подключения",
};

const STATE_HINT = {
  loggedOut: "Войдите заново в «Настройки системы → Каналы связи» — переписка сохранится",
  banned: "Мессенджер ограничил аккаунт — сообщения не принимаются и не отправляются",
  error: "Сообщения не принимаются, пока канал не подключится",
};

/**
 * Строка колокольчика: имя канала и причина от шлюза. Телефона и ника
 * корпоративного аккаунта в ней нет — только названия.
 * @param {{ name?: string } | null | undefined} channel
 * @param {string} state
 * @param {string} [reason]
 * @returns {{ title: string, text: string }}
 */
const channelAlertText = (channel, state, reason = "") => ({
  title: `Канал «${channel?.name || "Мессенджер"}»: ${STATE_TITLE[state] || "сбой"}`,
  text: String(reason || "").trim() || STATE_HINT[state] || "",
});

const USER_FIELDS = "_id firstName lastName notify isServiceAccount isEndUser banned banExpires";

/**
 * Разослать колокольчик. Состояние к этому моменту уже записано, поэтому сбой
 * рассылки не пробрасывается: иначе шлюз повторил бы событие, а повтор — уже
 * не переход. Возвращает число легших строк (0 — никому или сбой).
 * @param {{ channel: { _id: unknown, name?: string }, state: string, reason?: string }} input
 * @returns {Promise<number>}
 */
const alertChannelState = async ({ channel, state, reason = "" }) => {
  try {
    const User = require("@/models/user");
    const { permissionFilter } = require("@/services/permissions");
    const { isBanned } = require("@/services/authBan");
    const { pushInApp } = require("@/services/inAppNotifications");
    const canManage = await permissionFilter("settings.manage");
    const users = await User.find({ $and: [canManage, { isServiceAccount: { $ne: true } }] })
      .select(USER_FIELDS)
      .lean();
    const { title, text } = channelAlertText(channel, state, reason);
    return await pushInApp({
      // Срок отключения смотрит isBanned, а не сырой banned
      recipients: users.filter((user) => !isBanned(user)),
      category: "conversationMessage",
      kind: "channelState",
      title,
      text,
      link: CHANNEL_SETTINGS_LINK,
    });
  } catch (error) {
    require("@/utils/logger").log("error", "Channel state alert failed", {
      channelId: String(channel?._id ?? ""),
      state,
      error: error?.message,
    });
    return 0;
  }
};

module.exports = {
  ALERT_STATES,
  ERROR_REPEAT_MS,
  CHANNEL_SETTINGS_LINK,
  shouldAlertChannelState,
  channelAlertText,
  alertChannelState,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && NODE_ENV=production node --test services/messaging/channelAlert.test.js`
Expected: `# tests 4`, `# pass 4`, `# fail 0`.

- [ ] **Step 5: Wire it — model field, kind, compare-and-set in ingest**

`backend/models/channel.js` (on top of Task 2's change):

```diff
--- a/backend/models/channel.js
+++ b/backend/models/channel.js
@@ -45,6 +45,9 @@
     },
     gatewaySeenAt: { type: Date, default: null },
     lastMessageAt: { type: Date, default: null },
+    // Когда администраторам последний раз звонил колокольчик о состоянии
+    // «error» — не чаще раза в 6 часов (services/messaging/channelAlert.js)
+    errorAlertedAt: { type: Date, default: null },
     settings: {
       proxyUrl: { type: String, default: "" },
       historyDays: { type: Number, default: 14, min: 0, max: 90 },
```

`backend/models/inAppNotification.js`:

```diff
--- a/backend/models/inAppNotification.js
+++ b/backend/models/inAppNotification.js
@@ -25,6 +25,9 @@
   "reportApproval",
   "reportDecision",
   "conversationWaiting",
+  // Канал «Диалогов» отключился: сессия, блокировка, ошибка — администраторам
+  // (services/messaging/channelAlert.js)
+  "channelState",
 ];
 const KIND_NAMES = [...new Set([...Object.keys(KINDS), ...EXTRA_KINDS])];
 
```

`backend/services/messaging/ingest.js`:

```diff
--- a/backend/services/messaging/ingest.js
+++ b/backend/services/messaging/ingest.js
@@ -9,6 +9,7 @@
 const { nextSeq, addSystemLine, userTalksHere, displayNameFor } = require("./conversationStore");
 const { mirrorToTicket } = require("./mirror");
 const { notifyWaiting } = require("./notify");
+const { shouldAlertChannelState, alertChannelState } = require("./channelAlert");
 
 let identityDeps = null;
 const deps = () => (identityDeps ||= modelDeps());
@@ -382,6 +383,29 @@
   const set = { state: event.state, stateReason: event.reason || "", gatewaySeenAt: new Date() };
   if (event.account) set.account = event.account;
   set.login = event.login || { qr: null, expiresAt: null };
+  // Колокольчик администраторам — один на переход (channelAlert.js): запись
+  // условна по прежнему состоянию, поэтому повтор события, повторная доставка
+  // и гонка двух доставок второй раз его не будят
+  for (let attempt = 0; attempt < 2; attempt += 1) {
+    const before = await Channel.findById(event.channelId).select("name state isActive errorAlertedAt").lean();
+    if (!before) return { ok: false, retryable: false, error: "канал не найден" };
+    const now = new Date();
+    const alert = shouldAlertChannelState({
+      previous: before.state,
+      next: event.state,
+      active: before.isActive,
+      errorAlertedAt: before.errorAlertedAt,
+      now,
+    });
+    const claim = alert && event.state === "error" ? { errorAlertedAt: now } : {};
+    const result = await Channel.updateOne({ _id: before._id, state: before.state }, { $set: { ...set, ...claim } });
+    // Состояние успели сменить параллельно — перечитать и решить заново
+    if (!result.matchedCount) continue;
+    if (alert) await alertChannelState({ channel: before, state: event.state, reason: event.reason || "" });
+    return { ok: true };
+  }
+  // Дважды проиграли гонку: состояние всё равно пишем, а колокольчик за этот
+  // переход разослала доставка, которая выиграла
   const result = await Channel.updateOne({ _id: event.channelId }, { $set: set });
   return result.matchedCount ? { ok: true } : { ok: false, retryable: false, error: "канал не найден" };
 };
```

- [ ] **Step 6: Syntax check, module load, full backend suite**

The DB path (`ingestChannelState` → `alertChannelState`) has no unit test — a syntax check and a load check here, the live check in Task 14, step 5.

Run: `cd backend && for f in services/messaging/channelAlert.js services/messaging/ingest.js models/channel.js models/inAppNotification.js; do node --check $f || exit 1; done && echo syntax-ok`
Expected: `syntax-ok`

Run: `cd backend && node -e 'require("module-alias/register"); const K = require("./models/inAppNotification").KIND_NAMES; const C = require("./models/channel"); console.log(K.includes("channelState"), Boolean(C.schema.path("errorAlertedAt")), typeof require("./services/messaging/ingest").ingestEvent); process.exit(0)'`
Expected: `true true function`

Run: `cd backend && NODE_ENV=production pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 543`, `# pass 543`, `# fail 0` (539 before this task).

- [ ] **Step 7: The bell row, the category label, the section scroll**

`frontend/src/types/notification.ts` (on top of Task 11's change):

```diff
--- a/frontend/src/types/notification.ts
+++ b/frontend/src/types/notification.ts
@@ -38,7 +38,8 @@
   | "absenceDecision"
   | "reportApproval"
   | "reportDecision"
-  | "conversationWaiting";
+  | "conversationWaiting"
+  | "channelState";
 
 export type NotificationActor = {
   _id: string;
```

`frontend/src/util/notification-meta.ts` (on top of Task 11's change):

```diff
--- a/frontend/src/util/notification-meta.ts
+++ b/frontend/src/util/notification-meta.ts
@@ -4,6 +4,7 @@
   RiChat3Line,
   RiDiscussLine,
   RiFileTextLine,
+  RiLinkUnlinkM,
 } from "react-icons/ri";
 
 import type { NotificationItem } from "@/types/notification";
@@ -24,6 +25,9 @@
   reportDecision: { icon: RiFileTextLine, tone: "muted" },
   // «Диалоги»: сообщение ждёт ответа (backend/services/messaging/notify.js)
   conversationWaiting: { icon: RiDiscussLine, tone: "warn" },
+  // Канал связи отключился — сессия, блокировка, ошибка; администраторам
+  // (backend/services/messaging/channelAlert.js)
+  channelState: { icon: RiLinkUnlinkM, tone: "bad" },
 };
 
 export const notificationMeta = (kind: string): Meta => {
@@ -47,6 +51,9 @@
   if (item.link.startsWith("/team/calendar")) return "Календарь команды";
   if (item.link.includes("/approval")) return "Согласование работ";
   if (item.link.startsWith("/conversations")) return "Диалоги";
+  if (item.link.startsWith("/preferences#channels")) {
+    return "Настройки системы · Каналы связи";
+  }
   return "";
 };
 
```

`frontend/src/util/notification-facets.ts` (on top of Task 11's change):

```diff
--- a/frontend/src/util/notification-facets.ts
+++ b/frontend/src/util/notification-facets.ts
@@ -28,7 +28,8 @@
     categories: ["ticketStateUpdate", "respStateUpdate"],
   },
   { key: "comment", label: "Комментарии", categories: ["ticketNewComment"] },
-  // «Диалоги» — сообщения клиентов, которые ждут ответа
+  // «Диалоги» — сообщения клиентов, которые ждут ответа, и (администраторам)
+  // сбои каналов связи: у них та же категория
   {
     key: "dialogs",
     label: "Диалоги",
```

`frontend/src/components/Preferences/Notifications.jsx` (on top of Task 11's change):

```diff
--- a/frontend/src/components/Preferences/Notifications.jsx
+++ b/frontend/src/components/Preferences/Notifications.jsx
@@ -34,8 +34,9 @@
   { key: "absenceDecision", label: "Решение по отсутствию" },
   { key: "reportApproval", label: "Отчёт на согласование" },
   { key: "reportDecision", label: "Решение по отчёту" },
-  // «Диалоги»: колокольчик о сообщении, которое ждёт ответа (только в приложении)
-  { key: "conversationMessage", label: "Сообщения в диалогах" },
+  // «Диалоги»: колокольчик о сообщении, которое ждёт ответа, и — тем, кто
+  // ведёт настройки, — о сбое канала связи (только в приложении)
+  { key: "conversationMessage", label: "Диалоги и каналы связи" },
 ];
 
 const PrefsNotifications = ({ prefs }) => {
```

`frontend/src/components/User/AccountSettings/Notifications.jsx` (on top of Task 11's change):

```diff
--- a/frontend/src/components/User/AccountSettings/Notifications.jsx
+++ b/frontend/src/components/User/AccountSettings/Notifications.jsx
@@ -50,10 +50,11 @@
   },
   {
     name: "ConversationMessage",
-    label: "Сообщения в диалогах",
+    label: "Диалоги и каналы связи",
     visibilityKey: "conversationMessage",
     // «Диалоги» — рабочее место сотрудника; письмо и бот о сообщении из
-    // мессенджера были бы шумом — только колокольчик
+    // мессенджера были бы шумом — только колокольчик. Той же строкой —
+    // сбой канала связи (его получают те, кто ведёт настройки)
     staffOnly: true,
     inAppOnly: true,
   },
```

`frontend/src/pages/Preferences.jsx` (on top of Task 12's change):

```diff
--- a/frontend/src/pages/Preferences.jsx
+++ b/frontend/src/pages/Preferences.jsx
@@ -1,9 +1,9 @@
 import { useEffect } from "react";
-import { useBlocker, useFetcher, useLoaderData } from "react-router";
+import { useBlocker, useFetcher, useLoaderData, useLocation } from "react-router";
 import { BrowserView, MobileView } from "react-device-detect";
 
 import SettingsSection from "@/components/app/SettingsSection";
-import AnchorRail from "@/components/app/AnchorRail";
+import AnchorRail, { scrollToSection } from "@/components/app/AnchorRail";
 import ConfirmDialog from "@/components/app/ConfirmDialog";
 import DraftBar from "@/components/app/DraftBar";
 import { DraftProvider, useDraft } from "@/components/app/draft-context";
@@ -44,6 +44,17 @@
 
   const isSaving = fetcher.state !== "idle";
 
+  // Ссылка прямо на секцию (колокольчик «Канал «Telegram»: сессия завершена»
+  // ведёт на #channels): роутер к якорю не прокручивает — тем же механизмом,
+  // что форма (app/FormLayout), после отрисовки секций
+  const { hash } = useLocation();
+  useEffect(() => {
+    const id = decodeURIComponent(hash.replace(/^#/, ""));
+    if (!id) return undefined;
+    const timer = setTimeout(() => scrollToSection(null, id, false), 0);
+    return () => clearTimeout(timer);
+  }, [hash]);
+
   useEffect(() => {
     if (fetcher.state !== "idle" || !fetcher.data?.message) return;
 
```

- [ ] **Step 8: Tests, lint, typecheck, build**

Run: `cd frontend && node --test src/util/notification-facets.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 7`, `# pass 7`, `# fail 0` (the facet map is unchanged — only its comment).

Run: `cd frontend && pnpm exec eslint src/types/notification.ts src/util/notification-meta.ts src/util/notification-facets.ts src/components/Preferences/Notifications.jsx src/components/User/AccountSettings/Notifications.jsx src/pages/Preferences.jsx --max-warnings=0`
Expected: no output.

Run: `cd frontend && pnpm typecheck 2>&1 | grep -c "error TS"`
Expected: `3`.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

- [ ] **Step 9: Checkpoint** — no commit, no staging.

---

## Task 14: Docs, final verification, the owner's live check

**Files:**
- Modify: `docs/messaging.md` (a P1b header line, Staff API rows, «Frontend map» closing §7, Operations bullets)
- Modify: `docs/live-updates.md` (topics, consumers)
- Modify: `docs/ux-ui-guide.md` (catalog rows, chronicle bullet, section «Диалоги: переписка с клиентом»)
- Modify: `docs/ux-ui-changelog.md` (entry 2026-09-26)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: `docs/messaging.md`**

The P1a plan edits the same file: it replaces the two `_Last updated` header lines and the `fetchMedia` job row, adds a row after `POST /messages/:id/retry`, and appends a new «## 9. msg-gateway» after §8. None of the edits below touches those lines, and the frontend map closes §7 instead of becoming a top-level section — so the two plans apply in either order and the section numbers stay in sequence. Apply each edit with the Edit tool (find the exact text, then insert or replace).

(a) Header — after the line

```text
a snapshot of the backend contract as implemented — verify against the code._
```

insert (with one blank line before it)

```text
_P1b (2026-09-26): staff UI additions — queue counts, identity candidates,
`ticket.boundAt`, the `channels` pulse topic, the channel failure alert; the
frontend map closes §7._
```

(b) Staff API table — replace the row

```text
| `GET /conversations/:id` | read | Full card: conversation, channel, counterpart, participants, linked HD contact, that contact's other channels, bound/open tickets |
```

with

```text
| `GET /conversations/counts` | read | `{counts: {awaiting, mine, unbound, all}}` only — the navigation badge; declared before `/conversations/:id` |
| `GET /conversations/:id` | read | Full card: conversation, channel, counterpart, participants, linked HD contact, that contact's other channels, bound/open tickets (`ticket.boundAt` — when the binding started) |
```

(c) Staff API table — after the row

```text
| `POST /identities/:id/unlink` | manage | Remove that link |
```

insert

```text
| `GET /identities/:id/candidates?q=` | manage | Users to link a counterpart to: every word of `q` must match one of name/email/phone/position/company; returns `{items: [{id, name, position, company}]}` (≤8, clients first, banned and service accounts excluded) — names only, never the contacts it matched on |
```

(d) Operations — replace

```text
  never receives it. The spec's second staff topic, `conversationThreads`
  (per-conversation live updates), is **not** implemented in P0 — clients poll
  `GET /conversations/:id/messages?changedSince=...` instead (§7); whether a
  dedicated topic is worth adding is a P1 decision.
```

with

```text
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
```

(e) End of §7 — before the line

```text
## 8. Operations
```

insert the paragraph and table below, followed by one blank line:

```markdown
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
```

- [ ] **Step 2: `docs/live-updates.md`**

`docs/live-updates.md`:

```diff
--- a/docs/live-updates.md
+++ b/docs/live-updates.md
@@ -31,7 +31,9 @@
   a cursor with another epoch is ignored and the client refetches everything.
 - One global monotonic `rev`; each topic stores the `rev` of its last bump, so
   one cursor number compares against any topic.
-- Topics: `tickets`, `presence`, `team`, `mikrotik`, `approval`, `knowledge`.
+- Topics: `tickets`, `presence`, `team`, `mikrotik`, `approval`, `knowledge`,
+  `conversations`, `channels` (the last two staff-only: not in
+  `CLIENT_TOPICS`, `controllers/pulse.js`).
 - Per ticket: an LRU `Map<ticketId, rev>` (5000 entries). An evicted ticket
   reports the newest evicted revision (`ticketFloor`) — conservative, never
   "unchanged" by mistake. A write whose ticket is unknown bumps `anyTicketRev`,
@@ -171,6 +173,10 @@
 | Team calendar | team + presence | `silentFetch` | 30 s min |
 | Client device monitoring / tickets panels | mikrotik / tickets | panel refetch | 5 min max staleness / 30 s min |
 | Approval pipeline / report / preview | approval | `silentRefresh` / `load` | 20 s min; report paused while busy |
+| «Диалоги» list | conversations | `store/conversations.silentRefresh` | 5 s min |
+| «Диалоги» open thread | conversations | `changedSince` poll (`use-thread.ts`), then deferred card revalidate if anything changed | `requestCadence(3000)` while open |
+| «Диалоги» navigation badge | conversations | `refreshCounts` (`CountsSync`) | 15 s min; module + `conversation.read` only |
+| Channel settings («Каналы связи») | channels | channel list reload; proxy-test job read | `requestCadence(2000)` while a login or a proxy test is pending |
 
 Deliberately not live: archive, reports, catalogs, roles, templates, preferences.
 
```

- [ ] **Step 3: UX guide and changelog (Russian documents)**

`docs/ux-ui-guide.md`:

```diff
--- a/docs/ux-ui-guide.md
+++ b/docs/ux-ui-guide.md
@@ -40,6 +40,7 @@
 - [Статус, который протухает](#статус-который-протухает--предложение-а-не-бейдж)
 - [Что сделал ИИ, а что человек](#что-сделал-ии-а-что-человек)
 - [Хроника: переписка и события](#хроника-переписка-и-события-одной-лентой)
+- [Диалоги: переписка с клиентом](#диалоги-переписка-с-клиентом)
 - [Уведомления в приложении](#уведомления-в-приложении)
 - [Даты и время на экране](#даты-и-время-на-экране)
 - [Правка на месте (Obsidian-режим)](#правка-на-месте-obsidian-режим)
@@ -202,16 +203,18 @@
 | `SwitchField` | Строка свитча: свитч + подпись + hint + скрытый input `"true"/"false"` для FormData (`name`) |
 | `ListRow` | Строка списка: имя + мета, «⋯»-меню (Изменить/Удалить + `extraActions`); плитка слева только по `thumbSrc` (превью, с кольцом) или `glyph` (глиф вида, без кольца) — правило в «Анатомии списка с фильтром»; клик — правка или, с пропом `detailTo`, карточка (см. «Страница сущности»); права — `canManageEntity`. Свежесозданную строку подсвечивает сам |
 | `ListGroupLabel` | Uppercase-метка группы со счётчиком (`tone="on"/"off"`) |
-| `FilterChip` | Чип-фильтр с точкой-индикатором (`active`) |
+| `FilterChip` | Чип-фильтр с точкой-индикатором (`active`); `dot="warning"` — янтарная точка всегда (очередь «Ждут ответа»), `dot="none"` — без точки |
+| `CountPill` | Число-пилюля на бирюзовой подложке: непрочитанное в строке «Диалогов», «Ждут ответа» у пункта меню |
+| `QrCode` | QR для сканирования телефоном (вход в корпоративный мессенджер): тёмные модули на белом в обеих темах |
 | `ChipSelect` | Дропдаун-чип **одиночного выбора без поиска** — ключевой фасет с коротким набором значений; «Все …» сбрасывает (`clearable`). См. «Ключевой фасет» в анатомии списка |
 | `ChipCombobox` | Дропдаун-чип с **поиском** (Popover + shadcn Command/cmdk) — фасет с длинным списком значений; `clearable={false}` — обязательный контекст без пункта сброса |
 | `ChipMultiCombobox` | **Мульти**-фасет с поиском, значение — массив id (компании/пользователи в фильтре шаблонов) |
-| `Combobox` | **Единственный селект приложения** — поле формы с поиском (Popover + Command), не чип. Меню в слое radix, поэтому работает и в шторке, и в диалоге. Пропы сверх очевидных: `required` (нативная валидация через скрытый спутник-input), `loading`, `name` (кладёт значение в FormData), `ariaLabel`, `clearable`. Именованный `MultiCombobox` — то же с множественным выбором: токены внутри поля, меню не закрывается, `name` даёт по скрытому полю на значение. Опции строит `toOptions(items, {value, label, hint, group, disabled})`: `group` делит список заголовками («Ведут категорию» / «Остальные»), `disabled` оставляет вариант видимым, но невыбираемым — когда его отсутствие было бы враньём. Меню не выше места, которое ему оставил экран (потолок списка в `ui/command` считается от `--radix-popover-content-available-height`), и держит поле на виду: когда клавиатура поиска сжимает окно, поле подкручивается в видимую часть, иначе меню уехало бы за экран вслед за ним |
+| `Combobox` | **Единственный селект приложения** — поле формы с поиском (Popover + Command), не чип. Меню в слое radix, поэтому работает и в шторке, и в диалоге. Пропы сверх очевидных: `required` (нативная валидация через скрытый спутник-input), `loading`, `name` (кладёт значение в FormData), `ariaLabel`, `clearable`, `leading` (узел перед подписью в поле — аватар выбранного человека). Именованный `MultiCombobox` — то же с множественным выбором: токены внутри поля, меню не закрывается, `name` даёт по скрытому полю на значение. Опции строит `toOptions(items, {value, label, hint, group, disabled})`: `group` делит список заголовками («Ведут категорию» / «Остальные»), `disabled` оставляет вариант видимым, но невыбираемым — когда его отсутствие было бы враньём. Меню не выше места, которое ему оставил экран (потолок списка в `ui/command` считается от `--radix-popover-content-available-height`), и держит поле на виду: когда клавиатура поиска сжимает окно, поле подкручивается в видимую часть, иначе меню уехало бы за экран вслед за ним |
 | `DeleteItem` / `DeleteDialog` | Подтверждение удаления — см. «Диалоги» |
 | `ConfirmDialog` | Подтверждение действия вне router-action (архивация заметки, уход с несохранённым): заголовок · абзац · «Отмена»/действие с вариантом |
 | `BulkActionBar` / `MobileActionBar` | Плавающая панель массовых действий над выделением: десктоп — панель у нижнего края, мобайл — остров на месте таб-бара. Один массив `actions` на обе поверхности; заблокированное действие остаётся нажимаемым и объясняет причину (тултип / подмена строки статуса) — см. «Контекстный остров действий». `show` держит панель на экране весь режим выбора, `onClear` необязателен (выход живёт в `SelectionBar`) |
 | `SelectionBar` + `hooks/use-list-selection` | Режим выбора нескольких записей: липкая шапка панели (мастер-чекбокс · «Выбрано N из M» · «Выбрать все M» · «Отмена») и хук с состоянием, Shift-диапазоном, долгим тапом и Escape — см. «Режим выбора нескольких записей» |
-| `SettingsSection` / `SettingRow` | Секция страницы настроек (uppercase-метка + панель) и её строка (название + hint + контрол справа; `divider`; на узких экранах — столбец) — см. «Мой аккаунт» |
+| `SettingsSection` / `SettingRow` | Секция страницы настроек (uppercase-метка + панель) и её строка (название + hint + контрол справа; `divider`; на узких экранах — столбец; `leadingClassName` красит плитку, например фирменным тоном канала) — см. «Мой аккаунт» |
 | `HealthRow` | Постоянная строка состояния внешнего канала (почта, Telegram, интеграция): иконка · фраза состояния · приглушённые детали · действие проверки — см. «Секция внешнего сервиса обязана отвечать, работает ли она» |
 | `IssuedKey` | Единственный показ выданного ключа внутри окна выдачи: значение с «Скопировать», предупреждение «храним отпечаток», галочка «Я скопировал ключ», без которой «Готово» заперто. `children` — что показать между ключом и предупреждением (у ключей ИИ-агентов — готовый конфиг подключения). Делят API-ключи компании и ключи ИИ-агентов |
 | `PhotoGallery` | Снимки сущности: контактный лист квадратных плиток, зона перетаскивания, просмотр в диалоге (стрелки, ←/→, свайп). Делят карточки устройства, модели, типа и вендора |
@@ -1323,7 +1326,29 @@
 лентой**, а не двумя экранами. Эталон — карточка заявки
 (`components/Ticket/Chronicle.jsx`): раньше комментарии жили в правой колонке, а
 события — во вкладке «Лог», и связь «взял в работу → написал» приходилось
-восстанавливать по времени.
+восстанавливать по времени. Лента — **диалог** (канва «Омниканальные диалоги»,
+D4–D8): один компонент для сотрудника и заявителя.
+
+- **Сторона смотрящего — справа.** Сотруднику справа вся команда (над репликой
+  коллеги — имя, своя — без подписи), слева клиентская сторона: заявитель — без
+  подписи (он назван в «Деталях»), его коллеги и неопознанный собеседник из
+  мессенджера — по имени. Заявителю справа только его собственные сообщения,
+  команда слева — по именам. Внутренних заметок нет: заявитель видит каждый
+  комментарий, поэтому стороны честные для обоих. Сторону считает
+  `util/chronicle-dialog` (`commentSide`): сперва блок канала (зеркало
+  входящего — клиент, ответ, в том числе «с телефона», — команда), потом автор
+  (`isEndUser`); автор без признака — по сравнению с заявителем.
+- **Порядок — мессенджерный.** Старые сверху, новые снизу, поле ответа прижато
+  к низу панели постоянной высоты, короткая лента стоит у поля. Лента
+  открывается чертой «Новые» вверху панели (с первой непрочитанной и читают),
+  без неё — в конце; дальше идёт за новыми репликами, только пока читатель у
+  низа, а своё отправленное показывает всегда.
+- **События — строки по центру** между репликами, в порядке времени: значок
+  тоном каталога, подпись и человек; под строкой — содержание, файлы, имя
+  удалённого файла и свёрнутые служебные записи. «Переписка» их прячет.
+- **Пузырь** — текст, фото плиткой «Диалогов» (220×124, телефон 200×112),
+  прочие файлы чипами, свёрнутая цитата письма «▸ Показать цитату», время. Над
+  пузырём — имя (где нужно) и метка канала.
 
 - **Служебное сворачивается, а не показывается.** У живой заявки 1506 записей
   лога, из них 1476 — «при отправке email-уведомления». В ленте только события
@@ -1384,10 +1409,70 @@
   такой заголовок был на карточке единственным, а панели с ограниченной высотой
   дорог каждый ряд. Колонка с лентой гасит верхний отступ метки (`-mt-6`) — тем
   же приёмом, что колонка секций слева, иначе панели двух колонок разъедутся.
-- **Порядок — новыми вверх, поле ввода сверху.** День отбивается меткой
-  («Сегодня», «27 июля»), у записи — только время.
-- **Черта «Новые · N»** над непрочитанными комментариями и точка у каждого из
-  них — см. «Уведомления в приложении».
+- **День отбивается меткой** («Сегодня», «27 июля»), у реплики — только время.
+- **Черта «Новые · N»** над первой непрочитанной репликой — см. «Уведомления в
+  приложении».
+- **Метка канала — над пузырём:** глиф и имя сети, у нашего ответа — «→» и
+  статус доставки значком (отправлено ✓, доставлено ✓✓, прочитано ✓✓
+  бирюзой); не доставлено — «Не доставлено · Повторить» под пузырём (повторяет
+  тот, кто вправе отвечать); письмо — «письмо». Заявителю метка — только у его
+  сообщений и без статуса: доставка ответов команды — не его забота. Имя
+  неопознанного собеседника берётся из подписи канала без хвоста « · Telegram».
+- **Поле ответа** у сотрудника — «Написать комментарий…», «Ответить через ▾»
+  (выбор сети — см. «Диалоги»), «Файл», «Отправить»; у заявителя —
+  «Написать сообщение…», «Файл», «Отправить». На телефоне файл и отправка —
+  значками 36 px.
+
+---
+
+## Диалоги: переписка с клиентом
+
+«Диалоги» (`/conversations`) — рабочее место переписки с клиентами из
+мессенджеров. Эталон — канва «Омниканальные диалоги» (rev. 2, 24.09).
+
+- **Мессенджерный порядок** — старые сверху, новые снизу, поле ответа прижато
+  к низу, у короткой ленты сообщения стоят у поля. Так же устроена и хроника
+  заявки (см. «Хроника»): переписка с клиентом читается одинаково в обоих
+  местах.
+- **Фирменный цвет — только у глифа канала** (Telegram, WhatsApp, MAX;
+  токены `--channel-*` и их подложки `-tint`, обе темы). Форма сайта, почта и
+  телефон — нейтральные. Больше нигде цвет сети не появляется: строка, пузырь
+  и кнопки — палитра приложения.
+- **Раскладка.** Десктоп — шапка (заголовок со счётчиком «Все», чипы очередей,
+  поиск, «Фильтры») и одна панель на три колонки: список 352 · переписка ·
+  собеседник 320. Телефон — список; диалог — экран целиком без острова вкладок
+  (маршрут просит `handle.phoneFullscreen`), «⋯» открывает шторку «Контакт и
+  действия».
+- **Очереди** — «Ждут ответа · Мои · Без заявки · Все» чипами со счётчиками;
+  янтарная точка только у «Ждут ответа». «Скрытые» — в «Фильтрах».
+- **Строка списка** — плитка канала (различает строки), имя и время, последнее
+  сообщение с подписью «Вы» / «с телефона» / автор в группе, компания и номер
+  заявки, «ждёт N мин» (`warning-text`) и непрочитанное (`CountPill`).
+- **Пузыри** — `bg-bubble-in` / `bg-bubble-out`, радиус 14 с острым углом у
+  хвоста; подпись автора над нашим ответом при смене автора; статус доставки —
+  значок у времени. Системная строка — безлично: «Создана заявка №… — дальше
+  переписка идёт в неё · Имя».
+- **Собеседник.** Связан с пользователем — карточка с каналами (этот диалог
+  обведён бирюзой, «Написать» ведёт в другой диалог того же человека), заявка,
+  открытые заявки компании, ответственный за диалог. Не связан — «Кто это?»:
+  связывают только руками («Это он» после поиска); по имени из мессенджера
+  не связываем никогда. «Новый пользователь» — та же форма пользователя
+  шторкой поверх диалога.
+- **«Создать заявку»** — та же форма заявки, заполненная из переписки; после
+  сохранения — обратно в диалог (отступление от п.1 «Навигации после
+  сабмита»: заявка заведена ради ответа клиенту). Неопознанный собеседник —
+  инициатор необязателен: сервер ставит служебную учётку и имя в `realSender`.
+- **Заявка со стороны заявки** — метки каналов в хронике, «Ответить через ▾»
+  в поле комментария (меню на десктопе, шторка на телефоне; занятый чат
+  погашен с причиной), строка «Диалог» в «Деталях» со ссылкой «Открыть
+  диалог».
+- **Каналы связи** (Настройки) — строка на канал (`SettingRow`, плитка тоном
+  канала) и под ней `HealthRow`, которую пишет шлюз; вход — диалог «Telegram
+  — вход»: QR, код, пароль двухэтапной проверки, прокси с «Проверить». Канал
+  отключился (сессия завершена, аккаунт заблокирован, нет подключения) — тем,
+  кто ведёт настройки, приходит колокольчик «Канал «…»: сессия завершена» со
+  ссылкой прямо на секцию (`/preferences#channels`); «нет подключения» — не
+  чаще раза в 6 часов на канал.
 
 ---
 
@@ -1399,8 +1484,9 @@
 - **Колокольчик — только адресованное мне.** Заявки, где я заявитель или
   ответственный: назначение, запрос помощи, комментарий, статус, срок, закрытие
   и возврат; отказ и новая заявка — тем, кто «ведёт заявки»; отсутствия и
-  согласование отчётов. Движение по чужим заявкам в колокольчик не попадает:
-  тихий колокольчик и честный список.
+  согласование отчётов; сообщение клиента в «Диалогах», которое ждёт ответа, и
+  — тем, кто ведёт настройки, — сбой канала связи. Движение по чужим заявкам в
+  колокольчик не попадает: тихий колокольчик и честный список.
 - **«Непрочитано» в списке — чужое движение с моего последнего визита.**
   Считает сервер (`unread: { isUnseen, newComments }` у строки) по движению
   заявки и личному водяному знаку. Своё действие не новое. Заявка, которую ни
@@ -1416,11 +1502,13 @@
   В поповере — метка секции «Уведомления · N» и «Прочитать все» (ghost `xs`,
   при нуле прячется); в шторке — заголовок шторки и строка «N непрочитанных» с
   той же кнопкой. Внизу — «Показать ещё»; пусто — «Уведомлений пока нет».
-- **Фасеты панели — шесть слов, а не десять категорий.** Под заголовком ряд
+- **Фасеты панели — семь слов, а не одиннадцать категорий.** Под заголовком ряд
   `FilterChip size="sm"` (28 px, кегль 12): «Все · Новые заявки · Статусы ·
-  Комментарии · Сроки · Работы · Согласования» — категории настроек, сведённые
-  для читателя (`util/notification-facets`: «Статусы» = статус заявки и
-  ответственного, «Согласования» = отчёты и отсутствия). У чипа — число
+  Комментарии · Диалоги · Сроки · Работы · Согласования» — категории настроек,
+  сведённые для читателя (`util/notification-facets`: «Статусы» = статус
+  заявки и ответственного, «Согласования» = отчёты и отсутствия, «Диалоги» =
+  сообщения, ждущие ответа, и сбои каналов связи; «Диалоги» видны, только
+  когда модуль включён и раздел человеку открыт). У чипа — число
   непрочитанных вида (`count`, при нуле нет), у «Все» числа нет — оно в
   заголовке и от фильтра не зависит. На десктопе ряд переносится, на телефоне
   — одна строка с прокруткой без полосы. Фильтрует сервер (`?category=`):
@@ -1448,11 +1536,11 @@
   переключатель», нейтральная: цветом говорим о состоянии заявки, а не о моём
   к ней отношении. «Отметить прочитанными» (outline `sm`) стоит в строке
   инструментов только пока выбрана эта очередь; после — возврат в «Все».
-- **Хроника**: над первой новой записью — черта «Новые · N» акцентным тоном
-  (`text-accent-text`, линия `bg-primary/35`) вместо метки её дня; у каждого
-  нового комментария — точка после времени. Новое — чужие комментарии новее
-  водяного знака, с которым карточку открыли; при первом визите черты нет —
-  отделять нечего. Знак держится весь визит: черта не уезжает, пока читаешь.
+- **Хроника**: над первой новой репликой — черта «Новые · N» акцентным тоном
+  (`text-accent-text`, линия `bg-primary/35`); метка дня, если день начинается
+  там же, остаётся над чертой. Новое — чужие реплики новее водяного знака, с
+  которым карточку открыли; при первом визите черты нет — отделять нечего.
+  Знак держится весь визит: черта не уезжает, пока читаешь.
 - **Заявку открыли — она просмотрена**: страница отмечает это при монтировании
   и после каждого приезда лоадера, пока вкладка видна; уведомления по ней в
   колокольчике гаснут вместе с ней. Массовые действия из списка и свой
```

`docs/ux-ui-changelog.md`:

```diff
--- a/docs/ux-ui-changelog.md
+++ b/docs/ux-ui-changelog.md
@@ -10,6 +10,26 @@
 
 ---
 
+- **2026-09-26** — **«Диалоги»: интерфейс P1 по канве «Омниканальные
+  диалоги» (rev. 2).** Новый раздел `/conversations`: очереди, переписка в
+  мессенджерном порядке, колонка собеседника, «Кто это?», «Создать заявку» той
+  же формой заявки; в заявке — метки каналов, статус доставки с «Повторить»,
+  «Ответить через», строка «Диалог»; в настройках — «Каналы связи» со входом в
+  Telegram и свитч «Диалоги» в «Модулях»; сбой канала связи — колокольчиком
+  тем, кто ведёт настройки (категория уведомлений «Диалоги и каналы связи»,
+  фасет «Диалоги» в панели колокольчика). Пятая вкладка телефона — «Диалоги»
+  со значком «Ждут ответа», «База» у сотрудника ушла в бургер.
+  Решения владельца по канве: мессенджерный порядок (вариант A), фирменные
+  цвета глифов, вкладки телефона, строка «Диалог». **Отвергнуто:** диалог
+  лентой хроники новыми сверху (вариант F); нейтральные глифы каналов; свой
+  таймер опроса переписки (живость — пульс с учащением до 3 с). Системные
+  строки — безличные («Создана заявка №…»), хотя на канве стоял глагол
+  мужского рода: пола автора мы не знаем. **Хроника заявки — тоже диалог**
+  (канва D4–D8, решение владельца 26.09) для сотрудника и заявителя: сторона
+  смотрящего справа, старые сверху, поле ответа внизу, события — строками по
+  центру, метки каналов и «письмо» над пузырём; точки у новых комментариев
+  ушли — непрочитанное отмечает черта «Новые».
+
 - **2026-09-24** — **Главная на телефоне: ничего не шире экрана.** Живая
   проверка вчерашней раскладки провалилась: колонка главной оказалась шире
   телефона, и всё в ней резалось справа — строки заявок, часы отчёта, «Весь
```

- [ ] **Step 4: Final verification**

Run: `cd frontend && node --test src/util/conversation-format.test.js src/util/conversation-thread.test.js src/util/delivery-routes.test.js src/util/chronicle-dialog.test.js src/util/channel-state.test.js src/util/sections.test.js src/util/notification-facets.test.js src/layout/sheet-width.test.js src/components/Ticket/ticket-origin.test.js src/components/Preferences/modules-payload.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 67`, `# pass 67`, `# fail 0`.

Run: `cd frontend && pnpm typecheck 2>&1 | grep "error TS"`
Expected: only the three baseline lines (`FormWrapper.tsx(100,32)`, `ApprovalReport.tsx(146,28)`, `ApprovalReport.tsx(166,26)`).

Run: `cd frontend && pnpm lint 2>&1 | grep -E "✖|warning"`
Expected: exactly the baseline — `500.jsx` 7:32 `'status' is defined but never used`, `Tickets.jsx` 2:10 `'Link'…` and 4:10 `'Button'…`, then `✖ 3 problems (0 errors, 3 warnings)` and `ESLint found too many warnings (maximum: 0).`; nothing from this plan.

Run: `cd frontend && pnpm build 2>&1 | tail -1`
Expected: `✓ built in …s`.

Run: `cd backend && NODE_ENV=production pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 543`, `# pass 543`, `# fail 0`.

Run: `git status --short`
Expected: the files listed in Tasks 1–14 plus whatever was already modified or untracked before Task 1 (the owner's `sync-dev-db.sh`, the plan files under `docs/superpowers/plans/`); nothing staged — `git diff --cached --stat` prints nothing.

- [ ] **Step 5: Hand the live check to the owner** (the implementer does not click through the UI — memory «Timebox local E2E»)

Preconditions the owner controls: the dev stack is up (`compose.dev.yml`); the P0 migrations `2026-09-25-grantConversations` and `2026-09-25-initMessaging` are applied to the dev database by the owner (this plan never runs `migrate.js`); the backend container was recreated if `.env` changed.

1. Settings → «Модули» → turn on «Диалоги», «Сохранить»; reload — it stays on; then toggle another module and save — «Диалоги» still on.
2. Demo data: `docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js` (prints what it created and the author of HD replies).
3. Desktop, light and dark: menu «Диалоги» after «Заявки» with the «Ждут ответа» count pill; A1 — queues «Ждут ответа · Мои · Без заявки · Все» with counts, the three columns, Марина's thread (photo and voice placeholders, a quote, ✓✓ «Прочитано», the system line «Создана заявка №… — дальше переписка идёт в неё · …»), the ticket block «привязана с …», «Ответственный за диалог»; Олег — «Не доставлено» + «Повторить»; Белов — «с телефона»; Андрей — «Кто это?» (search any existing user by surname — the list shows name, position and company only; «Это он»; «Новый пользователь» opens the user form as a sheet over the thread; «Скрыть диалог» moves the chat to «Фильтры → Скрытые диалоги»); the group and the form rows render.
4. «Создать заявку» on Андрей's chat: the ticket form in a sheet, description filled, «Инициатор» optional with the hint; save → back in the thread, the ticket chip appears; an ordinary «Новая заявка» still requires «Инициатор» and restores its own draft.
5. Ticket card of the demo ticket (D4–D6): the «Хроника» is a dialog — oldest on top, the composer at the bottom; Марина on the left without a name, your colleagues on the right by name, your own replies unlabeled; markers «✈ Telegram» / «→ ✈ Telegram ✓✓» and «письмо» above the bubbles; «Всё» shows the events as centered lines, «Переписка» hides them; with unread messages the panel opens at «Новые · N»; «Ответить через ▾» (menu; phone — sheet); «Детали → Диалог → Открыть диалог». Then the same ticket as the client (D7/D8 — sign in as the demo client Соколова Марина, e.g. through «Войти под пользователем» and the copied link in another browser): her messages on the right without a name, the team on the left by name, no delivery ticks, composer «Написать сообщение…» without «Ответить через». Finally open an older ticket (comments from 2025): staff and clients sit on the expected sides.
6. Phone (DevTools device or a real phone): tab bar «Главная · Заявки · Диалоги · Пользователи · Компании» with the badge, «База» in the burger; list → thread full screen without the tab bar, «‹ Диалоги», «⋯» → «Контакт и действия».
7. Settings → «Каналы связи»: the `[DEMO] Telegram` row reads «Подключён» right after seeding and «Шлюз не отвечает» 5 minutes later (no gateway runs — expected); «Настроить» opens «Telegram — вход» on the connected stage (account, «Выйти из аккаунта»); the proxy «Проверить» and the QR stay pending without a gateway — expected until P1a.
8. The bell: facet «Диалоги» exists only with the module on; the category row in «Настройки системы → Уведомления» and «Мой аккаунт → Уведомления» reads «Диалоги и каналы связи».
9. Channel alert (there is no gateway yet, so this feeds one `channel.state` event to the demo channel the way the gateway would; it changes only that channel's state and adds one bell row per administrator):

   ```bash
   docker compose -f compose.dev.yml exec -T backend node -e '
   require("module-alias/register");
   const mongoose = require("mongoose");
   (async () => {
     await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
     const channel = await require("@/models/channel").findOne({ name: "[DEMO] Telegram" }).lean();
     const { ingestEvent } = require("@/services/messaging/ingest");
     const event = { type: "channel.state", channelId: String(channel._id), state: "loggedOut", reason: "Проверка: сессию завершили в Telegram" };
     console.log(await ingestEvent(event), await ingestEvent(event));
     await mongoose.disconnect();
   })();'
   ```

   Expected output `{ ok: true } { ok: true }`; every administrator gets exactly **one** row «Канал «[DEMO] Telegram»: сессия завершена» (the second, identical event does not ring), with context «Настройки системы · Каналы связи»; clicking it opens the settings scrolled to «Каналы связи», where the row reads «Сессия завершена». Mark the rows read; the seed removal below deletes the channel.
10. Clean up: `docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js --remove` (prints counts per collection, then deletes by `_id` lists); turn «Диалоги» off again if it should stay off.

- [ ] **Step 6: Checkpoint** — no commit, no staging. The owner reviews `git diff` and commits by hand.

---

## Self-review record

- **Spec coverage:** inbox list · thread · context (Task 8); «Кто это?» and «Новый пользователь» (Task 8); the ticket «Хроника» as a dialog for staff and end users (D4–D8), chronicle markers, delivery status/retry, «Ответить через», «Детали → Диалог» (Task 10); «Создать заявку» through the existing form prefilled from `ticket-draft` (Task 9); channel settings with QR / code / 2FA, proxy «Проверить», history days, «Отмечать прочитанным», «Подписывать ответы» (Task 12); «Диалоги» in «Модули» (Task 12); notification category row and facet (Task 11); spec «Risks» — ban/logout/session loss → admin in-app alert (Task 13); «Диалоги» after «Заявки» with a count pill, phone tab bar, «База» → burger (Task 7); brand glyph colours and messenger order (Tasks 4, 6, 8); group/form rows safe (Tasks 5, 8); dev seed (Task 3); backend gaps (Tasks 1–2).
- **Placeholder scan:** every code step carries the full file, an exact diff or an exact find/insert/replace text; no TBD/TODO, no «similar to Task N»; the owner-facing checklist names concrete demo records.
- **Type consistency:** names in Interfaces blocks were checked against the code blocks (`useConversationsStore`, `ThreadData`, `failureText`, `originFormValues` / `formDraftEnabled` / `originPayload`, `initialRoute` / `chronicleAuthorName`, `modulesPayload`, `channelHealth` / `loginStage`, `visibleFacets`, `shouldAlertChannelState` / `alertChannelState`, kind `channelState`).
- **Verification record:** each task was applied in order onto a copy of HEAD 2e1e693 and checked (Tasks 4–13 replayed again on 2026-09-27 after Task 10 became the chronicle dialog): typecheck = 3 baseline errors after every task, the task's files lint clean, its tests pass (13, 7, 12, 5, 14, 7, 9, 7), `vite build` green after every frontend task; backend 537 after Task 1, 539 after Task 2 and after Task 10 (its backend edits add no tests), 543 after Task 13; the Task 13 ingest path was also exercised against an in-memory channel stub (a replay and three racing identical deliveries ring once; two `error`s within 6 hours ring once); all diffs and whole files apply cleanly in task order onto HEAD (not onto the working tree, where execution has started) and reproduce the verified tree byte for byte; full frontend lint shows only the 3 baseline warnings and all 67 helper tests pass on the final tree; the backend diffs also apply on top of the P1a plan's edits to `controllers/conversation.js` and `routes/internal/conversation.js`, and the `docs/messaging.md` edits work before or after P1a's (its anchors survive them, theirs survive ours).
