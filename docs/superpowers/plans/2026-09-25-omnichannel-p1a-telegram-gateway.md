# Omnichannel «Диалоги» — P1a msg-gateway (Telegram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new TypeScript service `msg-gateway/` that holds the corporate Telegram account session (MTProto user session via GramJS) and connects Telegram **direct** chats to HD only through the P0 gateway API — messages, edits, deletions, read receipts and media in; HD replies out exactly once; login, logout, proxy test, history import and on-demand media as jobs — plus its compose/deploy wiring and three small backend additions: an endpoint that enqueues media downloads, fetched media copied into the ticket's comment, and retried/repaired replies that keep the signature; and — on top of the P1b UI, which lands first — tap-to-download for skipped attachments in the «Диалоги» thread.

**Architecture:** A network-agnostic core (an encrypted `node:sqlite` store, a durable event journal pumped to `POST /api/gateway/events`, a lease/ack job runner, channel polling, heartbeat) drives one `NetworkAdapter` — Telegram — which keeps a runtime per channel. All GramJS usage sits in `src/telegram/mtproto.ts` behind a small `TgPort` interface; every rule (filters, normalization, message parts, random_id, pacing, error classes, echo classification, gap check, login steps) is a plain module tested with fixtures and an in-memory Telegram. Exactly-once delivery rests on three legs: Telegram's `random_id` deduplication (derived from the job id), the local send journal (check → send → record → ack) and the backend's unique message keys.

**Tech Stack:** Node 24 (type stripping, `node:sqlite`), TypeScript 6.0 (`tsc --noEmit` only), `telegram` 2.26.22 (GramJS, pinned exactly), `node:test`, pnpm 10 (own lockfile, like `tg-service`), Docker Compose profile `messengers`, bash (`deploy.sh`); Task 19: React 19 + TypeScript on top of P1b's «Диалоги» components, Tailwind v4, react-icons (Remix).

**Spec:** `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` (Architecture → msg-gateway; Flows; Risks; Phases → P1). Contract: `docs/messaging.md` §3–§6 and the P0 code — `backend/services/messaging/events.js` (event shapes, limits), `jobs.js` (job types, lease/ack, `applyAck`), `ingest.js` (`confirmOwn`, device echoes, `channel.state`), `backend/controllers/gateway.js`, `backend/controllers/channel.js` (login/logout/test/history commands), `backend/models/channel.js`.

## Verified sources

- **GramJS = npm `telegram`, pinned `2.26.22`.** The latest release (2025-02-12, TL layer 198). Since 2026-07 the package carries an npm deprecation notice: "archived and no longer maintained. Development continues in teleproto" (`teleproto` 1.229.0 of 2026-08-25, layer 229, one maintainer, a different updates API). Sources: https://registry.npmjs.org/telegram, https://registry.npmjs.org/teleproto, the tarball https://registry.npmjs.org/telegram/-/telegram-2.26.22.tgz (browsable at https://cdn.jsdelivr.net/npm/telegram@2.26.22/). Read in that source:
  - `client/telegramBaseClient.js` — options: `connectionRetries` defaults to `Infinity` (we pass 3), `floodSleepThreshold` to 60 s (we pass 0), `baseLogger`, `proxy`; a *string* given as session becomes a file-backed `StoreSession`, so the port passes a `StringSession` object; an MTProxy proxy switches the connection class to `ConnectionTCPMTProxyAbridged` by itself; the constructor throws on an empty api id or hash.
  - `network/connection/TCPMTProxy.d.ts` — `ProxyInterface = {ip, port, socksType: 4|5, username?, password?, timeout?} | {ip, port, secret, MTProxy: true, timeout?}`; `TCPMTProxy.js` accepts a 16-byte secret or `dd` + 16 bytes — no FakeTLS (`ee…`); `extensions/PromisedNetSockets.js` uses `socks` for SOCKS4/5.
  - `sessions/StringSession.js` — `save()` returns `""` until an auth key exists; the entity cache (access hashes) lives in memory only, so the gateway stores access hashes itself.
  - `client/auth.js` — `signInUserWithQrCode(apiCredentials, {qrCode({token, expires}), password(hint), onError})` exports a new login token every 30 s; after a scan with 2FA it calls `signInWithPassword`, which asks `password(hint)` and hands failures to `onError` (a re-throwing `onError` rejects the whole call); `sendCode(apiCredentials, phone)` → `{phoneCodeHash, isCodeViaApp}`; `auth.SignIn` fails with `SESSION_PASSWORD_NEEDED` on 2FA accounts.
  - `events/NewMessage.js`, `EditedMessage.js`, `DeletedMessage.js`, `Raw.js` — `NewMessage` covers `UpdateNewMessage` and `UpdateShortMessage` (a short *outgoing* update needs the own id that `getMe()` stores in `_selfInputPeer`); `DeletedMessage` carries no peer for private chats; `Raw({types})` filters by class; `telegram/events` re-exports only `Raw` and `NewMessage`, the others are deep imports (`telegram/events/EditedMessage.js`).
  - `client/updates.js` — `catchUp()` is an empty stub (updates missed while offline are never replayed); handlers run without `await`; connection changes arrive as `UpdateConnectionState` on the same path.
  - `network/MTProtoSender.js` — RPC results resolve only the caller and are never dispatched to event handlers (our own sends do not come back as `NewMessage`).
  - `client/users.js` (`invoke`) — a FLOOD_WAIT up to `floodSleepThreshold` is slept inside the call, above it `FloodWaitError {seconds}` is thrown; `ServerError`/`RPC_CALL_FAIL` are retried with the same request object (the same `random_id`).
  - `tl/api.d.ts` (layer 198) — `messages.SendMessage` / `SendMedia` `{peer, message, randomId?, media}` → `TypeUpdates`; `UpdateShortSentMessage {id}`; `UpdateMessageID {id, randomId}`; `messages.ReadHistory {peer, maxId}`; `UpdateReadHistoryOutbox {peer, maxId}`; `Document.size` is a `long`.
  - `client/messages.d.ts`, `downloads.d.ts`, `uploads.d.ts` — `iterMessages(entity, {limit, minId, reverse})`, `getMessages(entity, {ids})`, `downloadMedia(message, {})` → `Buffer`, `uploadFile({file: CustomFile, workers})`.
  - `errors/` — `RPCError {errorMessage, code}`; `FloodWaitError {seconds}` with `errorMessage: "FLOOD"`.
  - Executed, not only read: on the host's Node 22.22 and in `node:24-alpine` (Node 24.16.0) the named and deep ESM imports load, `Api` objects build offline, and `_handleUpdate` delivers crafted updates into handlers exactly as `wireEvents` expects (kept as a test in Task 9). A prototype of this plan's code passed `tsc --noEmit` and all 126 tests on both runtimes, every task checkpoint was replayed cumulatively (the counts below are the real ones), and the prod image built with `--frozen-lockfile` and served `/health`.
- **random_id deduplication** — https://core.telegram.org/api/updates: "if the client attempts invoking a method passing a random_id which was already used by a previous method call … towards the same peer, from any session of the current account at any time in the past (used random_ids stored by the server do not expire), the method call will simply return the messages generated by the previous method call … and if the previous method call is currently inflight … a RANDOM_ID_DUPLICATE error will be emitted." See also https://core.telegram.org/method/messages.sendMessage (`RANDOM_ID_DUPLICATE`).
- **node:sqlite** — https://nodejs.org/docs/latest-v24.x/api/sqlite.html: no flag since v22.13/v23.4; "Stability: 1.2 – Release candidate" since v24.15.0, no `ExperimentalWarning` any more (the host's Node 22.22 still prints one — harmless). Checked: `VACUUM INTO ?` with a bound path works, also on a `readOnly` connection, and refuses an existing target; BLOB columns come back as `Uint8Array`; `BEGIN`/`COMMIT` through `exec`.
- **Encryption at rest** — `node:sqlite` has no SQLCipher, so rows are sealed in the application: AES-256-GCM (`node:crypto`), key = `MSG_GATEWAY_ENC_KEY` (base64, 32 bytes — the `APP_ENC_KEY` convention), AAD = `<purpose>|<APP_PUBLIC_URL>`.
- **Backend and frontend tasks** — Tasks 17–18 were applied to a copy of `backend/` and run: the messaging tests (13) pass, and the whole suite passes apart from `validations/company.test.js`, which failed only because the copy lacked `backend/data/` (it passes in the real tree). Task 19 was applied to a copy of `frontend/` holding the P1b plan's Task 8 files (`MessageMedia.tsx`, `MessageBubble.tsx`, `conversation-actions.ts`, `types/conversation.ts`, `util/conversation-format.js`, taken verbatim from `docs/superpowers/plans/2026-09-25-omnichannel-p1b-dialogs-ui.md`): `tsc --noEmit` shows only the 3 baseline errors, ESLint is clean on the touched files, the helper's tests pass, and esbuild compiles every touched file.

## Decisions this plan takes

1. **`telegram@2.26.22`, pinned exactly, although archived.** The spec names GramJS; a frozen package also means no silent updates to the library that holds the account session. Cost: no upstream fixes and no FakeTLS MTProxy (`ee…` secrets are refused with a clear message; SOCKS5 and `dd` MTProxy work). A later move to `teleproto` touches only `src/telegram/mtproto.ts` and `package.json`.
2. **The gateway never signs.** The signature is already in `payload.text` (`queueOutbound` → `signReply` per `Channel.settings.signReplies`). Edits of HD replies made on the phone are not forwarded — §6 allows that, and the gateway cannot know the unsigned text.
3. **Echoes only with evidence.** The send result gives the ids (ack `result.externalId/externalIds`); an own message seen later by the gap check goes out as an echo with `origin:"hd"` + `jobId`, never as `device`. Read receipts for HD replies go by `jobId`, so they work even before the ack lands.
4. **Media travels through the journal.** Downloaded bytes are sealed into the gateway DB and uploaded right before their event. A 5xx from `POST /media` is tried 3 times, then the attachment is `failed` — bounded, instead of §6's "do not retry": the gateway never uploads above `maxMediaMb` ≤ 200 MB (multer's limit), so a 5xx means a storage hiccup, not an oversized file.
5. **Groups are invisible in P1a** (not stored, not forwarded); `settings.importGroups` has no effect until P2.
6. **Health = the backend answers.** Blocked Telegram or a logged-out channel is a channel state in Settings, not a reason to restart the container.
7. **A channel removed in HD keeps its session in the volume** until someone logs it out — killing a live corporate session behind the owner's back is worse.
8. **Execution order: P1b (UI) first, then this plan.** P1a therefore owns the one piece that needs both sides — tap-to-download for skipped attachments (Task 19, on top of P1b's thread components).
9. **Contract with P1b's settings UI:** a `testProxy` job answers `result.latencyMs` (P1b's dialog prints «✓ Прокси отвечает · N мс»), a failed one a Russian `error`; `login {step: "phone"}` works without a preceding `start`; `channel.state` carries `login.qr` as the raw `tg://login?token=…` string; heartbeats every 60 s.

## Backend changes

All additive; the P0 event/job schema, ingest and the existing routes stay as they are.

1. **`POST /api/messages/:id/media`** (gate `read` = `conversation.read` + module switch; visibility as for the conversation) enqueues a `fetchMedia` job — payload `{chatId, externalId, attachments: [{originalName, mimetype, size, status, externalRef}]}`, no `conversationId`, a pending job for the same message is reused — and answers `202 {jobId}`. Files: `backend/services/messaging/media.js` (+ `media.test.js`), `backend/controllers/conversation.js` (`fetchMedia`), `backend/routes/internal/conversation.js` (Task 17).
2. **`docs/messaging.md`** — the `fetchMedia` payload and enqueuer (§5), the new staff route (§7), new §9 «msg-gateway» (Task 17).
3. **Infrastructure** (no backend code): `compose.yml` / `compose.dev.yml` service `msg-gateway` (profile `messengers`, volume `hd_msg_gateway_data`); `.env.example` (`MSG_GATEWAY_ENC_KEY`, `MSG_GATEWAY`); `deploy.sh` (generates both gateway secrets, profile, non-fatal start, snapshot in `backup`, `restore`); `docs/deployment.md` (Task 16).
4. **Fetched media reaches the ticket** (Task 18): `services/messaging/jobs.js` — **only the `applyMediaOutcome` function** — now also calls new `media.js#copyFetchedToComment`: new `ready` files are copied (`storage.copyObject`, the attachment shape of `mirror.js`) and `$push`ed onto the mirrored `Comment.attachments`, matched by file name + type (conditional push, a failed copy is logged and skipped), the comment text («Фото» etc.) untouched. The parallel P1b plan adds `bus.bump({ topics: ["channels"] })` inside `ackJobs` — a different hunk of the same file — so the two edits apply in either order.
5. **Retries keep the signature** (Task 18): `services/messaging/outbound.js` gets one exported builder `sendPayload({conversation, channel, text, attachments, author, prefs})` that signs (`signReply` per `Channel.settings.signReplies`, author's first name + organisation) for `queueOutbound`, `retryMessage`'s fallback and `repairOutbound`'s orphan branch.

Task 19 (frontend) adds no backend change: it calls item 1's route and relies on the `Message` pulse plugin to refresh the open thread.

Noticed, not changed here: the admin alert when a channel turns `loggedOut`/`banned` and the settings UI for channels, QR and login steps are P1b's (its Tasks 12–13).

## Global Constraints

- **No commits and no staging** in any step — every task ends with a checkpoint (tests green); the owner commits by hand.
- pnpm only. `msg-gateway` has its own `package.json` + `pnpm-lock.yaml`, like `tg-service` (the repo root has no workspace file; `frontend/pnpm-workspace.yaml` belongs to the frontend). One new runtime dependency: `telegram` `2.26.22` exactly (GramJS — spec decision 4); dev dependencies as `tg-service`: `typescript` `^6.0.3`, `@types/node` `^24.10.1`. `pnpm install` runs with the sandbox disabled (it writes the pnpm store under `~/.local/share/pnpm`).
- TypeScript per `docs/typescript-guide.md`: erasable syntax only (no `enum`, `namespace`, parameter properties), `type` aliases (no Mongoose here, so no `interface I*`), `unknown` instead of `any`, `import type` / inline `type` imports, `.ts` extensions in relative imports, no `@ts-ignore`. Tests: built-in `node:test`; `pnpm test` = `node --test "src/**/*.test.ts"` (as `tg-service`); the gate is `pnpm typecheck && pnpm test`.
- Code comments in Russian; docs in English; user-visible text in Russian (channel state reasons, job errors that staff see); log messages in English, as in `tg-service`.
- Clients never receive staff personal contacts: the gateway sends people's names only (`name` = first + last name, never a phone or an `@handle`); the reply signature (first name + organisation) is the backend's. Logs never carry message text, session strings, API hashes, proxy passwords, login codes or 2FA passwords — only ids, types and error names.
- Nothing touches production; `sync-dev-db.sh` is never run; `node scripts/migrate.js up` is never run (this plan has no migrations).
- Contract limits (`backend/services/messaging/events.js`): ≤ 50 events per batch, text ≤ 20 000, ≤ 20 attachments, ≤ 100 ids per `message.deleted` / `message.status`; header `X-Gateway-Token`; job outcomes per `applyAck` (`retryAfterMs` = a pause that is not an attempt, `retryable: false` = failed at once).
- Scope: Telegram direct chats only (groups → P2, WhatsApp → P4 as a second `NetworkAdapter`); no frontend (P1b).
- Runtime Node 24 (`node:24-alpine`); the dev machine runs the tests on Node 22.22 (type stripping on; `node:sqlite` prints an `ExperimentalWarning` — harmless). Docker commands need the sandbox disabled (Docker socket).
- Frontend (Task 19 only; P1b is in the tree first): typecheck baseline is red with exactly 3 known errors (`src/components/app/FormWrapper.tsx(100,32)` TS2345, `src/pages/Finances/ApprovalReport.tsx(146,28)` and `(166,26)` TS2554) — "no new errors" is the gate; `pnpm lint` has 3 baseline warnings, so lint the touched files with `pnpm exec eslint <files> --max-warnings=0`; never add `eslint-disable react-hooks/*` (the plugin is not installed). Pure helpers are `.js` with JSDoc and `.js` extensions in relative imports, tested with `cd frontend && node --test <file>`; components and hooks are TypeScript. Live data only through the pulse — no data-polling timers (a display ceiling is not a poll). UI texts in Russian; the look follows the approved canvas — no new visual element beyond what the task names (mockup-first rule).
- Steps that need a real Telegram account, an API id/hash or a proxy are in «Owner checks» at the end.

## Review Focus

1. **A crash between the Telegram send and the local record** (`kill -9` mid-send): the re-leased job re-sends with the same `random_id`, the client sees each part once, HD shows one message and never a «с телефона» twin — pinned by Task 10 «kill -9 между отправкой и записью…», Task 11 «проверка пропусков откладывает незнакомое исходящее…», Task 12 «незаконченная наша отправка в чате…».
2. **The backend down for minutes** (a deploy, a migration with the app stopped): inbound messages, their media and state changes wait in the journal and arrive later in order, nothing dropped — Task 4 «бэкенд лежит — журнал цел…» and «медиа: бэкенд лежит — событие ждёт вместе с файлом».
3. **Login codes from 777000, Saved Messages and bots** must never reach HD on any path (live, gap check, history) — Task 6 filter tests, Task 11 «служебные уведомления 777000…», Task 12 baseline and history tests.
4. **A gateway volume copied to another installation** (a prod snapshot on dev, a backup restored with another key or URL) must not start a session — no `AUTH_KEY_DUPLICATED` — Task 2 box/session tests, Task 14 «сессия с чужой установки не поднимается».
5. **Our own HD reply seen again** (by the gap check, or an outgoing update during our send) must not become a device message and must carry `jobId` — Task 11 «набранное на телефоне — origin device; наш ответ из HD — эхо с jobId…» and «исходящее во время нашей отправки ждёт её конца…».

---

## File Structure

```
msg-gateway/
  package.json · pnpm-lock.yaml (generated) · tsconfig.json · .gitignore · .dockerignore · Dockerfile · README.md
  src/
    main.ts                 assembly, loops, graceful shutdown
    config.ts (+test)       environment, fails fast
    logger.ts               JSON to stdout (as tg-service)
    health.ts (+test)       loopback /health: healthy while the backend answers
    util/async.ts           sleep, withTimeout, waker, every
    util/rateLimit.ts (+t)  pacing: 1/s per chat, 20/min per account
    util/serial.ts (+t)     per-key serial queue
    crypto/box.ts (+t)      AES-256-GCM, AAD bound to APP_PUBLIC_URL
    store/db.ts             schema, transactions, install fingerprint
    store/sessions.ts (+t)  encrypted sessions
    store/journal.ts (+t)   durable event journal + media blobs
    store/sent.ts           send journal (sent_jobs, sent_parts)
    store/chats.ts          peers (access hashes), watermarks, outgoing ids, channel state
    store/state.test.ts     tests for sent.ts and chats.ts
    backend/types.ts        the P0 contract as types
    backend/client.ts       fetch + X-Gateway-Token + timeouts + own pace
    backend/api.ts (+t)     named calls of /api/gateway/*
    core/backoff.ts         1 s → 60 s
    core/pump.ts (+t)       journal → POST /events (and media → POST /media)
    core/jobs.ts (+t)       GET /jobs?wait=25 → run → POST /jobs/ack
    core/adapter.ts         NetworkAdapter — the boundary for WhatsApp (P4)
    core/channels.ts (+t)   channel polling, job router, heartbeat
    telegram/types.ts       plain Telegram DTOs
    telegram/port.ts        TgPort — what the gateway needs from a Telegram client
    telegram/filters.ts (+t)    777000, Saved Messages, bots, groups, channels, ignoredChatIds
    telegram/normalize.ts (+t)  DTO → gateway events
    telegram/randomId.ts (+t)   random_id from job id + part
    telegram/plan.ts (+t)       text chunks, captions, photo vs document
    telegram/payloads.ts (+t)   job payloads
    telegram/classify.ts (+t)   Telegram errors → job outcome / channel state
    telegram/proxy.ts (+t)      proxyUrl → SOCKS / MTProxy
    telegram/mtproto.ts (+t)    the ONLY GramJS import
    telegram/tracker.ts (+t)    sends in flight per chat
    telegram/sender.ts (+t)     the send job
    telegram/inbound.ts (+t)    everything from Telegram → journal
    telegram/sync.ts (+t)       baseline, gap check, history import
    telegram/login.ts (+t)      login steps (QR, phone, code, password)
    telegram/runtime.ts (+t)    one channel: session, client, jobs, state
    telegram/adapter.ts         the Telegram NetworkAdapter
    cli/snapshot.ts (+t)        VACUUM INTO → stdout (deploy.sh backup)
    testing/fixtures.ts         test data
    testing/fakePort.ts         Telegram in memory (random_id dedup included)
backend/services/messaging/media.js (+ media.test.js)    fetchMedia enqueue; fetched files → ticket comment (new)
Modified: compose.yml · compose.dev.yml · .env.example · deploy.sh · docs/deployment.md · docs/messaging.md ·
          backend/controllers/conversation.js · backend/routes/internal/conversation.js ·
          backend/services/messaging/jobs.js (applyMediaOutcome only) · backend/services/messaging/outbound.js (+ outbound.test.js)
Frontend (Task 19, on top of P1b):
  create  frontend/src/util/attachment-fetch.js (+ .test.js)                   which attachments are fetchable, captions, aria-labels
  create  frontend/src/components/Conversation/use-attachment-fetch.ts          one POST, spinner, error line, display ceiling
  modify  frontend/src/components/Conversation/MessageMedia.tsx, MessageBubble.tsx   placeholders become «Загрузить» buttons
```

---

### Task 1: Service scaffold and configuration

**Files:**
- Create: `msg-gateway/package.json`, `msg-gateway/tsconfig.json`, `msg-gateway/.gitignore`
- Create: `msg-gateway/src/logger.ts`, `msg-gateway/src/util/async.ts`, `msg-gateway/src/config.ts`
- Test: `msg-gateway/src/config.test.ts`
- Generated: `msg-gateway/pnpm-lock.yaml`

**Interfaces:**
- Produces: `parseConfig(env: Env): Config` — `Config = {backendUrl, gatewayToken, encKey: Buffer, publicUrl, dbPath, healthPort, logLevel, channelsRefreshMs, heartbeatMs, gapCheckMs, isProduction}`, `Env = Record<string, string | undefined>`; `logger.error|warn|info|debug(message: string, meta?: unknown)`, `setLogLevel(level: string)`; `util/async.ts`: `sleep(ms, signal?): Promise<void>`, `withTimeout<T>(promise, ms, message): Promise<T>`, `class TimeoutError`, `messageOf(error: unknown): string`, `createWaker(): {wait(ms, signal?): Promise<void>; wake(): void}`, `every(ms, task: () => Promise<void>, signal, onError): Promise<void>`.

- [ ] **Step 1: Package files**

Create `msg-gateway/package.json`:

```json
{
  "name": "f1-hd-msg-gateway",
  "version": "1.0.0",
  "private": true,
  "description": "Шлюз «Диалогов»: держит сессии корпоративных аккаунтов мессенджеров, с бэкендом говорит только по HTTP",
  "type": "module",
  "main": "src/main.ts",
  "scripts": {
    "start": "node --watch src/main.ts",
    "start:prod": "node src/main.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --test \"src/**/*.test.ts\""
  },
  "author": "Aleksey Savin",
  "license": "ISC",
  "engines": {
    "node": ">=24"
  },
  "dependencies": {
    "telegram": "2.26.22"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "typescript": "^6.0.3"
  },
  "packageManager": "pnpm@10.10.0+sha512.d615db246fe70f25dcfea6d8d73dee782ce23e2245e3c4f6f888249fb568149318637dca73c2c5c8ef2a4ca0d5657fb9567188bfab47f566d1ee6ce987815c39"
}
```

Create `msg-gateway/tsconfig.json` (the same settings as `tg-service/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],

    "strict": true,
    "noEmit": true,

    "allowImportingTsExtensions": true,

    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,

    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "data"]
}
```

Create `msg-gateway/.gitignore`:

```gitignore
# Состояние шлюза: сессии мессенджеров, журнал событий, водяные знаки. Живёт
# в томе и принадлежит конкретной установке — в репозитории ему делать нечего.
data/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 2: Install dependencies** (run with the sandbox disabled — the pnpm store is in the home directory)

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm install`

Expected: pnpm switches itself to 10.10.0 (`packageManager`), lists `+ telegram 2.26.22 deprecated`, `+ @types/node 24.x`, `+ typescript 6.0.x`, and warns `Ignored build scripts: bufferutil, es5-ext, utf-8-validate` — GramJS's optional native WebSocket helpers, not used on Node; leave them ignored. `pnpm-lock.yaml` appears. Never `npm`/`yarn`.

- [ ] **Step 3: Write the failing test**

Create `msg-gateway/src/config.test.ts`:

```ts
// node --test src/config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseConfig } from "./config.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const BASE = {
  BACKEND_URL: "http://backend:8080/",
  MSG_GATEWAY_TOKEN: "token",
  MSG_GATEWAY_ENC_KEY: KEY,
  APP_PUBLIC_URL: "https://hd.example.com/",
};

test("обязательные переменные: без любой — падаем с её именем", () => {
  for (const name of Object.keys(BASE)) {
    const env: Record<string, string | undefined> = { ...BASE, [name]: undefined };
    assert.throws(() => parseConfig(env), new RegExp(name));
  }
});

test("ключ шифрования — ровно 32 байта", () => {
  assert.throws(
    () => parseConfig({ ...BASE, MSG_GATEWAY_ENC_KEY: Buffer.alloc(16).toString("base64") }),
    /32 bytes/,
  );
});

test("адреса без хвостового слэша, значения по умолчанию", () => {
  const config = parseConfig(BASE);
  assert.equal(config.backendUrl, "http://backend:8080");
  assert.equal(config.publicUrl, "https://hd.example.com");
  assert.equal(config.encKey.length, 32);
  assert.equal(config.dbPath, "./data/msg-gateway.db");
  assert.equal(config.healthPort, 8082);
  assert.equal(config.gapCheckMs, 300_000);
  assert.equal(config.isProduction, false);
});

test("числовые настройки проверяются", () => {
  assert.throws(() => parseConfig({ ...BASE, HEARTBEAT_MS: "-1" }), /HEARTBEAT_MS/);
  assert.equal(parseConfig({ ...BASE, HEARTBEAT_MS: "30000" }).heartbeatMs, 30_000);
});
```

- [ ] **Step 4: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/config.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/config.ts`).

- [ ] **Step 5: Implement**

Create `msg-gateway/src/logger.ts`:

```ts
/**
 * Журнал — JSON в stdout, и всё.
 *
 * Прежний бот писал winston с ротацией в собственный каталог `logs/`, который
 * рос внутри контейнера и читался только через `docker exec`. Для сервиса,
 * который должен разворачиваться где угодно, правильный сток — stdout: его
 * забирает `docker logs`, journald или что там стоит на той машине. Заодно
 * уходят две зависимости, а вместе с ними — падение процесса, когда файл
 * журнала оказывается чужим (ровно это ловится на этой машине).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;

export type LogLevel = keyof typeof LEVELS;

const isLevel = (value: string): value is LogLevel => value in LEVELS;

let threshold: number = LEVELS.info;

export const setLogLevel = (level: string): void => {
  threshold = isLevel(level) ? LEVELS[level] : LEVELS.info;
};

const write = (level: LogLevel, message: string, meta?: unknown): void => {
  if (LEVELS[level] > threshold) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
  };

  if (meta !== undefined) {
    // Ошибку разворачиваем руками: JSON.stringify отдаёт от Error пустой
    // объект, и в журнале оставалось бы `{}` вместо причины.
    line.meta =
      meta instanceof Error
        ? { error: meta.message, stack: meta.stack }
        : meta;
  }

  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
};

export const logger = {
  error: (message: string, meta?: unknown) => write("error", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  info: (message: string, meta?: unknown) => write("info", message, meta),
  debug: (message: string, meta?: unknown) => write("debug", message, meta),
};
```

Create `msg-gateway/src/util/async.ts`:

```ts
/**
 * Мелочи асинхронности, общие для всех циклов шлюза.
 */

/** Сон, который рвётся сигналом остановки (без него SIGTERM ждал бы полный интервал). */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener("abort", done, { once: true });
  });

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Промис с потолком ожидания. Сам запрос не отменяется — только ожидание. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Будильник цикла: `wait` спит до таймаута, `wake` будит раньше. Так насос
 * журнала отправляет свежее событие сразу, а не на следующем тике.
 */
export const createWaker = () => {
  let pending: (() => void) | null = null;
  return {
    wait(ms: number, signal?: AbortSignal): Promise<void> {
      return new Promise((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", finish);
          if (pending === finish) pending = null;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        pending = finish;
        signal?.addEventListener("abort", finish, { once: true });
      });
    },
    wake(): void {
      pending?.();
    },
  };
};

/**
 * Периодическая задача: следующий проход — после конца предыдущего (без
 * наложения), ошибка прохода не убивает цикл.
 */
export const every = async (
  ms: number,
  task: () => Promise<void>,
  signal: AbortSignal,
  onError: (error: unknown) => void,
): Promise<void> => {
  while (!signal.aborted) {
    await sleep(ms, signal);
    if (signal.aborted) break;
    try {
      await task();
    } catch (error) {
      onError(error);
    }
  }
};
```

Create `msg-gateway/src/config.ts`:

```ts
/**
 * Окружение разбирается ОДИН раз и на старте: падаем сразу и с именем
 * переменной, а не на первом запросе. Функция чистая — её проверяет тест,
 * а читает process.env только main.ts.
 */

export type Config = {
  /** База API. Внутри compose — `http://backend:8080`, с хоста за рубежом — `https://…`. */
  backendUrl: string;
  /** Общий секрет с бэкендом, заголовок `X-Gateway-Token` (backend/middleware/isGateway.js). */
  gatewayToken: string;
  /** 32 байта: ключ AES-256-GCM для всего, что шлюз кладёт на диск. */
  encKey: Buffer;
  /** Адрес установки: входит в AAD шифрования, том с другой установки не читается. */
  publicUrl: string;
  dbPath: string;
  healthPort: number;
  logLevel: string;
  channelsRefreshMs: number;
  heartbeatMs: number;
  gapCheckMs: number;
  isProduction: boolean;
};

export type Env = Record<string, string | undefined>;

export const parseConfig = (env: Env): Config => {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const positive = (name: string, fallback: number): number => {
    const raw = env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive number, got "${raw}"`);
    }
    return parsed;
  };

  const encKey = Buffer.from(required("MSG_GATEWAY_ENC_KEY"), "base64");
  if (encKey.length !== 32) {
    throw new Error(`MSG_GATEWAY_ENC_KEY must decode to 32 bytes (got ${encKey.length})`);
  }

  return {
    backendUrl: required("BACKEND_URL").replace(/\/+$/, ""),
    gatewayToken: required("MSG_GATEWAY_TOKEN"),
    encKey,
    publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
    dbPath: env.MSG_GATEWAY_DB_PATH || "./data/msg-gateway.db",
    healthPort: positive("HEALTH_PORT", 8082),
    logLevel: env.LOG_LEVEL || "info",
    channelsRefreshMs: positive("CHANNELS_REFRESH_MS", 60_000),
    heartbeatMs: positive("HEARTBEAT_MS", 60_000),
    gapCheckMs: positive("GAP_CHECK_MS", 5 * 60_000),
    isProduction: env.NODE_ENV === "production",
  };
};
```

- [ ] **Step 6: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/config.test.ts`

Expected: PASS — summary `tests 4` · `pass 4` · `fail 0`.

- [ ] **Step 7: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 4` · `pass 4` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 2: Encryption and the SQLite store

**Files:**
- Create: `msg-gateway/src/crypto/box.ts`, `msg-gateway/src/store/db.ts`, `msg-gateway/src/store/sessions.ts`
- Test: `msg-gateway/src/crypto/box.test.ts`, `msg-gateway/src/store/sessions.test.ts`

**Interfaces:**
- Produces: `createBox(key: Buffer, publicUrl: string): Box` — `Box = {seal(plain: Buffer | string, purpose): Buffer; open(sealed: Uint8Array, purpose): Buffer; sealJson(value, purpose): Buffer; openJson(sealed, purpose): unknown; fingerprint: string}`; `openDatabase(path: string): DatabaseSync` (tables `meta, sessions, journal, blobs, sent_jobs, sent_parts, peers, chats, outgoing, channel_state`); `inTransaction<T>(db, work: () => T): T`; `checkInstall(db, fingerprint): "fresh" | "same" | "other"`; `createSessionStore(db, box): SessionStore` — `{load(channelId): LoadedSession; save(channelId, session): void; remove(channelId): void}`, `LoadedSession = {ok: true; session: string} | {ok: false; reason: "none" | "foreign"}`.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/crypto/box.test.ts`:

```ts
// node --test src/crypto/box.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createBox } from "./box.ts";

const KEY = Buffer.alloc(32, 1);
const PROD = "https://hd.example.com";

test("запечатанное открывается тем же ключом, адресом и назначением", () => {
  const box = createBox(KEY, PROD);
  const sealed = box.seal("1AgAOMTQ5LjE1NC4xNjcuNTA", "session:c1");
  assert.equal(box.open(sealed, "session:c1").toString("utf8"), "1AgAOMTQ5LjE1NC4xNjcuNTA");
  assert.deepEqual(box.openJson(box.sealJson({ text: "Привет" }, "journal"), "journal"), { text: "Привет" });
});

test("на диске нет открытого текста", () => {
  const sealed = createBox(KEY, PROD).seal("секретная сессия", "session:c1");
  assert.equal(sealed.includes(Buffer.from("секретная сессия")), false);
});

test("том с другой установки не читается: другой адрес, другой ключ, другое назначение", () => {
  const sealed = createBox(KEY, PROD).seal("session", "session:c1");
  assert.throws(() => createBox(KEY, "http://localhost:3000").open(sealed, "session:c1"));
  assert.throws(() => createBox(Buffer.alloc(32, 2), PROD).open(sealed, "session:c1"));
  assert.throws(() => createBox(KEY, PROD).open(sealed, "session:c2"));
});

test("подмена байта — отказ, а не мусор", () => {
  const box = createBox(KEY, PROD);
  const sealed = box.seal("session", "session:c1");
  const last = sealed.length - 1;
  sealed.writeUInt8(sealed.readUInt8(last) ^ 0xff, last);
  assert.throws(() => box.open(sealed, "session:c1"));
});

test("ключ не 32 байта — отказ; отпечаток зависит от адреса", () => {
  assert.throws(() => createBox(Buffer.alloc(16), PROD));
  assert.equal(createBox(KEY, PROD).fingerprint, createBox(KEY, PROD).fingerprint);
  assert.notEqual(createBox(KEY, PROD).fingerprint, createBox(KEY, "http://localhost:3000").fingerprint);
});
```

Create `msg-gateway/src/store/sessions.test.ts`:

```ts
// node --test src/store/sessions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createBox } from "../crypto/box.ts";
import { checkInstall, openDatabase } from "./db.ts";
import { createSessionStore } from "./sessions.ts";

const KEY = Buffer.alloc(32, 3);

test("сессия сохраняется зашифрованной и читается обратно", () => {
  const db = openDatabase(":memory:");
  const sessions = createSessionStore(db, createBox(KEY, "https://hd.example.com"));
  assert.deepEqual(sessions.load("c1"), { ok: false, reason: "none" });
  sessions.save("c1", "1BQANOTE0OS4xNTQuMTY3LjkxAbs");
  assert.deepEqual(sessions.load("c1"), { ok: true, session: "1BQANOTE0OS4xNTQuMTY3LjkxAbs" });
  const raw = db.prepare("SELECT data FROM sessions WHERE channel_id = 'c1'").get() as { data: Uint8Array };
  assert.equal(Buffer.from(raw.data).includes(Buffer.from("1BQANOTE0OS4xNTQuMTY3LjkxAbs")), false);
  sessions.remove("c1");
  assert.deepEqual(sessions.load("c1"), { ok: false, reason: "none" });
});

test("том, скопированный с другой установки, сессию не поднимает", () => {
  const db = openDatabase(":memory:");
  createSessionStore(db, createBox(KEY, "https://hd.example.com")).save("c1", "prod-session");
  const onDev = createSessionStore(db, createBox(KEY, "http://localhost:3000"));
  assert.deepEqual(onDev.load("c1"), { ok: false, reason: "foreign" });
});

test("отпечаток установки: новый, тот же, чужой", () => {
  const db = openDatabase(":memory:");
  assert.equal(checkInstall(db, "aaa"), "fresh");
  assert.equal(checkInstall(db, "aaa"), "same");
  assert.equal(checkInstall(db, "bbb"), "other");
  assert.equal(checkInstall(db, "bbb"), "same");
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/crypto/box.test.ts src/store/sessions.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/crypto/box.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/crypto/box.ts`:

```ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Шифрование всего, что шлюз кладёт на диск: сессии, журнал событий, медиа
 * до загрузки в HD. AES-256-GCM с ключом MSG_GATEWAY_ENC_KEY; в AAD —
 * назначение записи и APP_PUBLIC_URL. Том, скопированный на другую установку
 * (другой адрес или другой ключ), не расшифровывается — сессия прода на деве
 * не оживёт и не получит AUTH_KEY_DUPLICATED.
 *
 * Формат: версия (1 байт) | iv (12) | tag (16) | шифртекст.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Box = {
  seal(plain: Buffer | string, purpose: string): Buffer;
  open(sealed: Uint8Array, purpose: string): Buffer;
  sealJson(value: unknown, purpose: string): Buffer;
  openJson(sealed: Uint8Array, purpose: string): unknown;
  /** Отпечаток пары «ключ + адрес»: чей том, без раскрытия ключа. */
  fingerprint: string;
};

export const createBox = (key: Buffer, publicUrl: string): Box => {
  if (key.length !== 32) throw new Error("Ключ шифрования шлюза должен быть 32 байта");
  const aad = (purpose: string): Buffer => Buffer.from(`${purpose}|${publicUrl}`, "utf8");

  const seal = (plain: Buffer | string, purpose: string): Buffer => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(purpose));
    const body = Buffer.concat([
      cipher.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  };

  const open = (sealed: Uint8Array, purpose: string): Buffer => {
    const data = Buffer.from(sealed);
    if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
      throw new Error("Запись шлюза повреждена или в неизвестном формате");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(aad(purpose));
    decipher.setAuthTag(data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
  };

  return {
    seal,
    open,
    sealJson: (value, purpose) => seal(JSON.stringify(value), purpose),
    openJson: (sealed, purpose) => JSON.parse(open(sealed, purpose).toString("utf8")) as unknown,
    fingerprint: createHmac("sha256", key).update(publicUrl).digest("hex").slice(0, 16),
  };
};
```

Create `msg-gateway/src/store/db.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Единственное состояние шлюза — файл SQLite в его томе (node:sqlite: без
 * нативных модулей, образ собирается без тулчейна). Здесь живут сессии
 * мессенджеров (НИКОГДА не в MongoDB: иначе sync-dev-db.sh унёс бы живую
 * сессию прода на дев), журнал событий до бэкенда, журнал отправок и водяные
 * знаки чатов. Всё, что несёт содержимое переписки или ключи, зашифровано
 * (crypto/box.ts); таблицы с номерами сообщений — открыты.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     channel_id TEXT PRIMARY KEY,
     data       BLOB NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS journal (
     seq        INTEGER PRIMARY KEY AUTOINCREMENT,
     channel_id TEXT NOT NULL,
     kind       TEXT NOT NULL,
     payload    BLOB NOT NULL,
     attempts   INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS journal_state ON journal (channel_id, kind)`,
  `CREATE TABLE IF NOT EXISTS blobs (
     id          TEXT PRIMARY KEY,
     journal_seq INTEGER NOT NULL,
     data        BLOB NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS blobs_seq ON blobs (journal_seq)`,
  `CREATE TABLE IF NOT EXISTS sent_jobs (
     job_id     TEXT PRIMARY KEY,
     channel_id TEXT NOT NULL,
     chat_id    TEXT NOT NULL,
     state      TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sent_jobs_chat ON sent_jobs (channel_id, chat_id, state)`,
  `CREATE TABLE IF NOT EXISTS sent_parts (
     job_id     TEXT NOT NULL,
     part       INTEGER NOT NULL,
     random_id  TEXT NOT NULL,
     message_id INTEGER NOT NULL,
     PRIMARY KEY (job_id, part)
   )`,
  `CREATE INDEX IF NOT EXISTS sent_parts_message ON sent_parts (message_id)`,
  `CREATE TABLE IF NOT EXISTS peers (
     channel_id  TEXT NOT NULL,
     peer_id     TEXT NOT NULL,
     access_hash TEXT NOT NULL,
     first_name  TEXT NOT NULL DEFAULT '',
     last_name   TEXT NOT NULL DEFAULT '',
     updated_at  INTEGER NOT NULL,
     PRIMARY KEY (channel_id, peer_id)
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     channel_id   TEXT NOT NULL,
     chat_id      TEXT NOT NULL,
     top_id       INTEGER NOT NULL DEFAULT 0,
     read_out_max INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (channel_id, chat_id)
   )`,
  `CREATE TABLE IF NOT EXISTS outgoing (
     channel_id TEXT NOT NULL,
     chat_id    TEXT NOT NULL,
     message_id INTEGER NOT NULL,
     job_id     TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (channel_id, chat_id, message_id)
   )`,
  `CREATE TABLE IF NOT EXISTS channel_state (
     channel_id  TEXT PRIMARY KEY,
     account_id  TEXT NOT NULL DEFAULT '',
     alive_at    INTEGER NOT NULL DEFAULT 0,
     baseline_at INTEGER NOT NULL DEFAULT 0
   )`,
];

export const openDatabase = (path: string): DatabaseSync => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL — чтобы снимок для бэкапа (VACUUM INTO) не спотыкался о запись журнала
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  for (const statement of SCHEMA) db.exec(statement);
  return db;
};

/** Несколько записей — одной транзакцией: журнал и его медиа появляются вместе. */
export const inTransaction = <T>(db: DatabaseSync, work: () => T): T => {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

/**
 * Чей это том. Новый — запоминаем отпечаток; чужой (другой ключ или
 * APP_PUBLIC_URL) — сообщаем и перезаписываем: старые записи всё равно не
 * расшифруются, а новые будут уже наши.
 */
export const checkInstall = (db: DatabaseSync, fingerprint: string): "fresh" | "same" | "other" => {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'install'").get() as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('install', ?)").run(fingerprint);
    return "fresh";
  }
  if (row.value === fingerprint) return "same";
  db.prepare("UPDATE meta SET value = ? WHERE key = 'install'").run(fingerprint);
  return "other";
};
```

Create `msg-gateway/src/store/sessions.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

import type { Box } from "../crypto/box.ts";

/**
 * Сессии мессенджеров по каналам. Строка сессии GramJS (StringSession) — это
 * ключ авторизации аккаунта: только в шифрованном виде и только здесь.
 */
export type LoadedSession = { ok: true; session: string } | { ok: false; reason: "none" | "foreign" };

export type SessionStore = {
  load(channelId: string): LoadedSession;
  save(channelId: string, session: string): void;
  remove(channelId: string): void;
};

const purpose = (channelId: string): string => `session:${channelId}`;

export const createSessionStore = (db: DatabaseSync, box: Box): SessionStore => ({
  load(channelId) {
    const row = db.prepare("SELECT data FROM sessions WHERE channel_id = ?").get(channelId) as
      | { data: Uint8Array }
      | undefined;
    if (!row) return { ok: false, reason: "none" };
    try {
      return { ok: true, session: box.open(row.data, purpose(channelId)).toString("utf8") };
    } catch {
      // Том с другой установки или другой ключ: запись не наша, сессию не поднимаем
      return { ok: false, reason: "foreign" };
    }
  },
  save(channelId, session) {
    db.prepare(
      `INSERT INTO sessions (channel_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).run(channelId, box.seal(session, purpose(channelId)), Date.now());
  },
  remove(channelId) {
    db.prepare("DELETE FROM sessions WHERE channel_id = ?").run(channelId);
  },
});
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/crypto/box.test.ts src/store/sessions.test.ts`

Expected: PASS — summary `tests 8` · `pass 8` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 12` · `pass 12` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 3: Backend contract and HTTP client

**Files:**
- Create: `msg-gateway/src/backend/types.ts`, `msg-gateway/src/backend/client.ts`, `msg-gateway/src/backend/api.ts`
- Test: `msg-gateway/src/backend/api.test.ts`

**Interfaces:**
- Consumes: `sleep` (Task 1).
- Produces: types `Network, ChannelState, ChannelSettings, GatewayChannel, Person, ChatRef, MessageKind, Attachment, PendingAttachment, MessageEvent, EditedEvent, DeletedEvent, StatusEvent, StateAccount, StateEvent, GatewayEvent, EventResult, JobType, GatewayJob, JobBatch, JobOutcome, AckResult, StoredMedia`; `class BackendError {status: number}`; `isTransient(error: unknown): boolean`; `createHttp({baseUrl, token, minGapMs?, fetchImpl?}): Http` — `{json<T>(path, options?): Promise<T>; buffer(path, options?): Promise<Buffer>}`; `createBackendApi(http): BackendApi` — `{channels(types): Promise<GatewayChannel[]>; postEvents(events): Promise<EventResult[]>; uploadMedia({data, originalName, mimetype}): Promise<StoredMedia>; downloadMedia(name): Promise<Buffer>; leaseJobs(types, waitSec, signal?): Promise<JobBatch>; ackJobs(leaseId, results): Promise<{applied, ignored}>; heartbeat(channelIds): Promise<void>}`.

The types mirror `backend/services/messaging/events.js` and `controllers/gateway.js` — read both before editing them.

- [ ] **Step 1: Write the failing test** (a real local HTTP server — no mocks of `fetch`)

Create `msg-gateway/src/backend/api.test.ts`:

```ts
// node --test src/backend/api.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createBackendApi } from "./api.ts";
import { BackendError, createHttp, isTransient } from "./client.ts";

type Seen = { method: string; url: string; token: string; body: Buffer; type: string };

const serve = async (reply: (seen: Seen, res: ServerResponse) => void) => {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const item = {
        method: req.method ?? "",
        url: req.url ?? "",
        token: String(req.headers["x-gateway-token"] ?? ""),
        body: Buffer.concat(chunks),
        type: String(req.headers["content-type"] ?? ""),
      };
      seen.push(item);
      reply(item, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { seen, baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

test("события уходят пачкой с токеном в заголовке, ответ — по событию", async () => {
  const backend = await serve((_, res) => json(res, 200, { results: [{ ok: true }, { ok: false, retryable: true }] }));
  const api = createBackendApi(createHttp({ baseUrl: backend.baseUrl, token: "secret", minGapMs: 0 }));
  const results = await api.postEvents([
    { type: "message.deleted", channelId: "64f600000000000000000001", messageIds: ["1"] },
    { type: "message.deleted", channelId: "64f600000000000000000001", messageIds: ["2"] },
  ]);
  assert.deepEqual(results, [{ ok: true }, { ok: false, retryable: true }]);
  const [call] = backend.seen;
  assert.equal(call?.method, "POST");
  assert.equal(call?.url, "/api/gateway/events");
  assert.equal(call?.token, "secret");
  assert.equal(JSON.parse(call?.body.toString() ?? "{}").events.length, 2);
  await backend.close();
});

test("медиа уходит multipart-ом с исходным именем", async () => {
  const backend = await serve((_, res) =>
    json(res, 201, { name: "msg-1.jpg", originalName: "фото.jpg", mimetype: "image/jpeg", size: 3 }),
  );
  const api = createBackendApi(createHttp({ baseUrl: backend.baseUrl, token: "secret", minGapMs: 0 }));
  const stored = await api.uploadMedia({ data: Buffer.from([1, 2, 3]), originalName: "фото.jpg", mimetype: "image/jpeg" });
  assert.equal(stored.name, "msg-1.jpg");
  const [call] = backend.seen;
  assert.match(call?.type ?? "", /^multipart\/form-data/);
  assert.ok(call?.body.includes(Buffer.from('name="file"')));
  assert.ok(call?.body.includes(Buffer.from("фото.jpg")));
  await backend.close();
});

test("ошибки: статус и текст бэкенда; недоступный бэкенд — статус 0", async () => {
  const backend = await serve((_, res) => json(res, 401, { message: "Некорректный токен" }));
  const api = createBackendApi(createHttp({ baseUrl: backend.baseUrl, token: "wrong", minGapMs: 0 }));
  await assert.rejects(api.heartbeat(["64f600000000000000000001"]), (error: unknown) => {
    assert.ok(error instanceof BackendError);
    assert.equal(error.status, 401);
    assert.equal(error.message, "Некорректный токен");
    return true;
  });
  await backend.close();

  const dead = createBackendApi(createHttp({ baseUrl: backend.baseUrl, token: "secret", minGapMs: 0 }));
  await assert.rejects(dead.heartbeat([]), (error: unknown) => error instanceof BackendError && error.status === 0);
});

test("что повторяемо: сеть, токен, перегрузка, 5xx — да; прочие 4xx — нет", () => {
  assert.equal(isTransient(new BackendError(0, "")), true);
  assert.equal(isTransient(new BackendError(401, "")), true);
  assert.equal(isTransient(new BackendError(429, "")), true);
  assert.equal(isTransient(new BackendError(503, "")), true);
  assert.equal(isTransient(new BackendError(400, "")), false);
  assert.equal(isTransient(new BackendError(413, "")), false);
  assert.equal(isTransient(new Error("TypeError")), true);
});

test("свой темп: запросы не чаще раза в minGapMs", async () => {
  const backend = await serve((_, res) => json(res, 200, { ok: true }));
  const api = createBackendApi(createHttp({ baseUrl: backend.baseUrl, token: "secret", minGapMs: 60 }));
  const started = Date.now();
  await Promise.all([api.heartbeat([]), api.heartbeat([]), api.heartbeat([])]);
  assert.ok(Date.now() - started >= 110, `прошло ${Date.now() - started} мс`);
  await backend.close();
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/backend/api.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/backend/api.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/backend/types.ts`:

```ts
/**
 * Контракт с бэкендом — в одном месте. Источник правды —
 * backend/services/messaging/events.js (формы событий и пределы),
 * backend/controllers/gateway.js и backend/services/messaging/jobs.js
 * (каналы, задания, подтверждения); описание — docs/messaging.md, §3, §5, §6.
 */

export type Network = "telegram" | "whatsapp";

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

export type ChannelSettings = {
  proxyUrl: string;
  historyDays: number;
  importGroups: boolean;
  markReadOnOpen: boolean;
  maxMediaMb: number;
  ignoredChatIds: string[];
};

/** Строка `GET /api/gateway/channels`: секреты здесь уже расшифрованы. */
export type GatewayChannel = {
  id: string;
  type: Network;
  name: string;
  state: ChannelState;
  account: { externalId?: string; displayName?: string; username?: string; phone?: string };
  settings: ChannelSettings;
  secrets: { tgApiId: string; tgApiHash: string; proxyPassword: string };
};

/** Собеседник. `name` — только имя: не телефон и не @ник (контракт §6). */
export type Person = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot?: boolean;
};

export type ChatRef = {
  id: string;
  kind?: "direct" | "group";
  title?: string;
  peer?: Person | null;
};

export type MessageKind =
  | "text"
  | "photo"
  | "voice"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "other";

export type Attachment = {
  name?: string;
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: "ready" | "skipped" | "failed";
  externalRef: string;
};

/** Вложение, которое ещё лежит в журнале шлюза: насос загрузит его и заменит на ready/failed. */
export type PendingAttachment = {
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: "pending";
  blobId: string;
  externalRef: string;
};

export type MessageEvent = {
  type: "message";
  channelId: string;
  chat: ChatRef & { kind: "direct" | "group" };
  message: {
    id: string;
    direction: "in" | "out";
    origin?: "device" | "hd";
    jobId?: string;
    sender?: Person;
    kind: MessageKind;
    text: string;
    attachments: (Attachment | PendingAttachment)[];
    replyToId: string | null;
    sentAt: string;
    imported: boolean;
  };
};

export type EditedEvent = {
  type: "message.edited";
  channelId: string;
  chat: ChatRef;
  message: { id: string; text: string; editedAt: string };
};

export type DeletedEvent = {
  type: "message.deleted";
  channelId: string;
  messageIds: string[];
};

/** Прочтение наших сообщений: ответы из HD — по jobId, отправленные с телефона — по id в чате. */
export type StatusEvent =
  | { type: "message.status"; channelId: string; status: "read"; jobId: string }
  | { type: "message.status"; channelId: string; status: "read"; chat: ChatRef; messageIds: string[] };

export type StateAccount = { externalId: string; displayName: string; username: string; phone: string };

export type StateEvent = {
  type: "channel.state";
  channelId: string;
  state: ChannelState;
  reason: string;
  account: StateAccount | null;
  login: { qr: string; expiresAt: string } | null;
};

export type GatewayEvent = MessageEvent | EditedEvent | DeletedEvent | StatusEvent | StateEvent;

/** Итог приёма одного события (`POST /api/gateway/events`, по порядку). */
export type EventResult = { ok: boolean; retryable?: boolean; error?: string; ignored?: boolean };

export type JobType = "send" | "markRead" | "fetchMedia" | "login" | "logout" | "loadHistory" | "testProxy";

export type GatewayJob = {
  id: string;
  type: JobType;
  channelId: string;
  conversationId: string | null;
  messageId: string | null;
  attempt: number;
  payload: Record<string, unknown>;
};

export type JobBatch = { leaseId: string; leaseExpiresAt: string; jobs: GatewayJob[] };

/**
 * Итог задания. `retryAfterMs` — пауза без счёта попытки (FLOOD_WAIT);
 * `retryable: false` — сразу failed (backend/services/messaging/jobs.js, applyAck).
 */
export type JobOutcome =
  | { ok: true; result?: unknown }
  | { ok: false; error: string; retryable: boolean; retryAfterMs?: number };

export type AckResult = {
  id: string;
  ok: boolean;
  error?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  result?: unknown;
};

/** Ответ `POST /api/gateway/media`. */
export type StoredMedia = { name: string; originalName: string; mimetype: string; size: number };
```

Create `msg-gateway/src/backend/client.ts`:

```ts
import { sleep } from "../util/async.ts";

/**
 * Единственная дверь в бэкенд: заголовок `X-Gateway-Token`, таймаут на
 * каждый запрос и свой темп — не чаще раза в `minGapMs` (у бэкенда общий
 * предел шлюза 600 запросов в минуту, backend/routes/gateway.js). Здесь же
 * единственное приведение типа ответа — ровно на границе.
 */
export class BackendError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

/**
 * Связь или перегрузка — «повторим позже», ничего не теряя: сеть (0), неверный
 * токен (401 — чинится правкой .env, события должны дожить), таймаут, 429, 5xx.
 */
export const isTransient = (error: unknown): boolean =>
  !(error instanceof BackendError) ||
  error.status === 0 ||
  error.status === 401 ||
  error.status === 408 ||
  error.status === 429 ||
  error.status >= 500;

export type RequestOptions = {
  method?: string;
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type Http = {
  json<T>(path: string, options?: RequestOptions): Promise<T>;
  buffer(path: string, options?: RequestOptions): Promise<Buffer>;
};

export type HttpOptions = {
  baseUrl: string;
  token: string;
  minGapMs?: number;
  fetchImpl?: typeof fetch;
};

export const createHttp = ({ baseUrl, token, minGapMs = 150, fetchImpl = fetch }: HttpOptions): Http => {
  let nextSlot = 0;

  const pace = async (): Promise<void> => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + minGapMs;
    if (at > now) await sleep(at - now);
  };

  const request = async (path: string, options: RequestOptions): Promise<Response> => {
    await pace();
    const headers: Record<string, string> = { "X-Gateway-Token": token };
    let body: RequestInit["body"];
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { method: options.method ?? "GET", headers, body, signal });
    } catch (error) {
      // Под «fetch failed» лежит настоящая причина (отказ соединения, DNS) — в cause
      const reason = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
      throw new BackendError(0, `Backend unreachable: ${reason}${cause}`);
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const message = (payload as { message?: string } | null)?.message || `Request failed (${response.status})`;
      throw new BackendError(response.status, message);
    }
    return response;
  };

  return {
    async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
      const response = await request(path, options);
      return (await response.json()) as T;
    },
    async buffer(path: string, options: RequestOptions = {}): Promise<Buffer> {
      const response = await request(path, options);
      return Buffer.from(await response.arrayBuffer());
    },
  };
};
```

Create `msg-gateway/src/backend/api.ts`:

```ts
import type { Http } from "./client.ts";
import type {
  AckResult,
  EventResult,
  GatewayChannel,
  GatewayEvent,
  JobBatch,
  Network,
  StoredMedia,
} from "./types.ts";

/**
 * Вся поверхность бэкенда, которой пользуется шлюз, — она совпадает с
 * закрытым списком backend/routes/gateway.js.
 */
export type BackendApi = {
  channels(types: Network[]): Promise<GatewayChannel[]>;
  postEvents(events: GatewayEvent[]): Promise<EventResult[]>;
  uploadMedia(file: { data: Buffer; originalName: string; mimetype: string }): Promise<StoredMedia>;
  downloadMedia(name: string): Promise<Buffer>;
  leaseJobs(types: Network[], waitSec: number, signal?: AbortSignal): Promise<JobBatch>;
  ackJobs(leaseId: string, results: AckResult[]): Promise<{ applied: number; ignored: number }>;
  heartbeat(channelIds: string[]): Promise<void>;
};

export const createBackendApi = (http: Http): BackendApi => ({
  async channels(types) {
    const body = await http.json<{ channels: GatewayChannel[] }>(`/api/gateway/channels?types=${types.join(",")}`);
    return body.channels;
  },

  async postEvents(events) {
    const body = await http.json<{ results: EventResult[] }>("/api/gateway/events", {
      method: "POST",
      json: { events },
    });
    return body.results;
  },

  async uploadMedia({ data, originalName, mimetype }) {
    const form = new FormData();
    form.append("originalName", originalName);
    form.append("file", new Blob([new Uint8Array(data)], { type: mimetype || "application/octet-stream" }), originalName || "file");
    // Медиа до 200 МБ идёт через прокси бэкенда в хранилище — щедрый таймаут
    return http.json<StoredMedia>("/api/gateway/media", { method: "POST", form, timeoutMs: 10 * 60_000 });
  },

  downloadMedia(name) {
    return http.buffer(`/api/gateway/media/${encodeURIComponent(name)}`, { timeoutMs: 10 * 60_000 });
  },

  leaseJobs(types, waitSec, signal) {
    return http.json<JobBatch>(`/api/gateway/jobs?types=${types.join(",")}&wait=${waitSec}`, {
      // Долгий опрос: бэкенд держит запрос до waitSec секунд
      timeoutMs: (waitSec + 15) * 1000,
      ...(signal ? { signal } : {}),
    });
  },

  ackJobs(leaseId, results) {
    return http.json<{ applied: number; ignored: number }>("/api/gateway/jobs/ack", {
      method: "POST",
      json: { leaseId, results },
    });
  },

  async heartbeat(channelIds) {
    await http.json<{ ok: boolean }>("/api/gateway/heartbeat", {
      method: "POST",
      json: { channels: channelIds.map((id) => ({ id })) },
    });
  },
});
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/backend/api.test.ts`

Expected: PASS — summary `tests 5` · `pass 5` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 17` · `pass 17` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 4: Durable event journal and its pump

**Files:**
- Create: `msg-gateway/src/store/journal.ts`, `msg-gateway/src/core/backoff.ts`, `msg-gateway/src/core/pump.ts`
- Test: `msg-gateway/src/store/journal.test.ts`, `msg-gateway/src/core/pump.test.ts`

**Interfaces:**
- Consumes: `Box` (Task 2), `openDatabase`, `inTransaction` (Task 2), `GatewayEvent`, `StateEvent`, `MessageEvent`, `Attachment`, `PendingAttachment`, `BackendApi`, `BackendError` (Task 3), `createWaker`, `sleep`, `messageOf` (Task 1).
- Produces: `createJournal(db, box): Journal` — `{push(channelId, event, blobs?: BlobInput[]); pushState(event: StateEvent); head(limit): JournalRow[]; update(seq, event); blob(id): Buffer | null; dropBlob(id); remove(seqs: number[]); setAttempts(seq, attempts); size(): number}`, `JournalRow = {seq, channelId, event, attempts}`, `BlobInput = {id, data: Buffer}`; `backoffMs(failures, capMs = 60000): number`; `createPump({journal, api, onBackendOk?, pauseMs?}): Pump` — `{drainOnce(): Promise<"idle" | "progress" | "blocked">; run(signal): Promise<void>; wake(): void; failures(): number}`; constants `BATCH_SIZE = 50`, `MAX_EVENT_ATTEMPTS = 20`, `MAX_MEDIA_ATTEMPTS = 3`.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/store/journal.test.ts`:

```ts
// node --test src/store/journal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GatewayEvent, StateEvent } from "../backend/types.ts";
import { createBox } from "../crypto/box.ts";
import { openDatabase } from "./db.ts";
import { createJournal } from "./journal.ts";

const CHANNEL = "64f600000000000000000001";
const box = createBox(Buffer.alloc(32, 5), "https://hd.example.com");

const deleted = (id: string): GatewayEvent => ({ type: "message.deleted", channelId: CHANNEL, messageIds: [id] });
const state = (value: StateEvent["state"]): StateEvent => ({
  type: "channel.state",
  channelId: CHANNEL,
  state: value,
  reason: "",
  account: null,
  login: null,
});

test("события выдаются в порядке записи и удаляются по seq", () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.push(CHANNEL, deleted("1"));
  journal.push(CHANNEL, deleted("2"));
  journal.push(CHANNEL, deleted("3"));
  const head = journal.head(2);
  assert.deepEqual(head.map((row) => row.event), [deleted("1"), deleted("2")]);
  journal.remove(head.map((row) => row.seq));
  assert.deepEqual(journal.head(10).map((row) => row.event), [deleted("3")]);
  assert.equal(journal.size(), 1);
});

test("новое состояние канала вытесняет неотправленное старое", () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.pushState(state("awaitingQr"));
  journal.push(CHANNEL, deleted("1"));
  journal.pushState(state("connected"));
  assert.deepEqual(journal.head(10).map((row) => row.event.type === "channel.state" ? row.event.state : "deleted"), ["deleted", "connected"]);
});

test("текст и медиа на диске зашифрованы, медиа уходит вместе со строкой", () => {
  const db = openDatabase(":memory:");
  const journal = createJournal(db, box);
  const event: GatewayEvent = {
    type: "message.edited",
    channelId: CHANNEL,
    chat: { id: "5550001" },
    message: { id: "10", text: "Секретный текст", editedAt: "2026-09-25T10:00:00.000Z" },
  };
  journal.push(CHANNEL, event, [{ id: "blob-1", data: Buffer.from("фото-байты") }]);
  const raw = db.prepare("SELECT payload FROM journal").get() as { payload: Uint8Array };
  assert.equal(Buffer.from(raw.payload).includes(Buffer.from("Секретный текст")), false);
  const rawBlob = db.prepare("SELECT data FROM blobs").get() as { data: Uint8Array };
  assert.equal(Buffer.from(rawBlob.data).includes(Buffer.from("фото-байты")), false);
  assert.equal(journal.blob("blob-1")?.toString(), "фото-байты");
  const [row] = journal.head(1);
  journal.remove([row!.seq]);
  assert.equal(journal.blob("blob-1"), null);
});

test("строку чужой установки журнал выбрасывает, а не отдаёт", () => {
  const db = openDatabase(":memory:");
  createJournal(db, createBox(Buffer.alloc(32, 5), "https://other.example.com")).push(CHANNEL, deleted("1"));
  const journal = createJournal(db, box);
  assert.deepEqual(journal.head(10), []);
  assert.equal(journal.size(), 0);
});
```

Create `msg-gateway/src/core/pump.test.ts`:

```ts
// node --test src/core/pump.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { BackendApi } from "../backend/api.ts";
import { BackendError } from "../backend/client.ts";
import type { EventResult, GatewayEvent, MessageEvent } from "../backend/types.ts";
import { createBox } from "../crypto/box.ts";
import { openDatabase } from "../store/db.ts";
import { createJournal } from "../store/journal.ts";
import { sleep } from "../util/async.ts";
import { backoffMs } from "./backoff.ts";
import { createPump, MAX_EVENT_ATTEMPTS } from "./pump.ts";

const CHANNEL = "64f600000000000000000001";
const box = createBox(Buffer.alloc(32, 9), "https://hd.example.com");
const deleted = (id: string): GatewayEvent => ({ type: "message.deleted", channelId: CHANNEL, messageIds: [id] });
const ids = (events: GatewayEvent[]) => events.map((event) => (event.type === "message.deleted" ? event.messageIds[0] : event.type));

type Api = Pick<BackendApi, "postEvents" | "uploadMedia">;

const fakeApi = (handler: (events: GatewayEvent[]) => EventResult[]): Api & { posted: GatewayEvent[][] } => {
  const posted: GatewayEvent[][] = [];
  return {
    posted,
    async postEvents(events) {
      posted.push(events);
      return handler(events);
    },
    async uploadMedia() {
      throw new Error("not expected");
    },
  };
};

test("пауза журнала: 1 с, 2 с, 4 с … потолок минута", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 50].map((n) => backoffMs(n)), [0, 1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});

test("бэкенд лежит — журнал цел; вернулся — уходит всё и по порядку", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  for (const id of ["1", "2", "3"]) journal.push(CHANNEL, deleted(id));
  let down = true;
  const api = fakeApi((events) => {
    if (down) throw new BackendError(0, "Backend unreachable: fetch failed");
    return events.map(() => ({ ok: true }));
  });
  const pump = createPump({ journal, api, pauseMs: () => 5 });
  const controller = new AbortController();
  const running = pump.run(controller.signal);
  await sleep(40);
  assert.ok(pump.failures() >= 2, `неудач ${pump.failures()}`);
  assert.equal(journal.size(), 3);
  down = false;
  await sleep(40);
  controller.abort();
  await running;
  assert.equal(journal.size(), 0);
  assert.equal(pump.failures(), 0);
  assert.deepEqual(ids(api.posted.at(-1) ?? []), ["1", "2", "3"]);
});

test("«повторите» держит это событие и все следующие; «не повторять» — выбрасывает", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  for (const id of ["1", "2", "3", "4"]) journal.push(CHANNEL, deleted(id));
  const api = fakeApi(() => [{ ok: true }, { ok: false, retryable: false, error: "канал не найден" }, { ok: false, retryable: true }, { ok: true }]);
  const pump = createPump({ journal, api });
  assert.equal(await pump.drainOnce(), "blocked");
  assert.deepEqual(ids(journal.head(10).map((row) => row.event)), ["3", "4"]);
  assert.equal(journal.head(1)[0]?.attempts, 1);
});

test("событие, которое бэкенд раз за разом просит повторить, в конце концов выбрасывается", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.push(CHANNEL, deleted("1"));
  journal.push(CHANNEL, deleted("2"));
  const api = fakeApi((events) => events.map((event) => (ids([event])[0] === "1" ? { ok: false, retryable: true } : { ok: true })));
  const pump = createPump({ journal, api });
  for (let round = 1; round < MAX_EVENT_ATTEMPTS; round += 1) await pump.drainOnce();
  assert.equal(journal.size(), 2);
  await pump.drainOnce();
  assert.deepEqual(ids(journal.head(10).map((row) => row.event)), ["2"]);
  assert.equal(await pump.drainOnce(), "progress");
  assert.equal(journal.size(), 0);
});

const photoEvent = (blobId: string): MessageEvent => ({
  type: "message",
  channelId: CHANNEL,
  chat: { id: "5550001", kind: "direct" },
  message: {
    id: "42",
    direction: "in",
    sender: { id: "5550001", name: "Анна" },
    kind: "photo",
    text: "",
    attachments: [
      { originalName: "photo-42.jpg", mimetype: "image/jpeg", size: 3, durationSec: null, status: "pending", blobId, externalRef: "tg:5550001:42" },
    ],
    replyToId: null,
    sentAt: "2026-09-25T10:00:00.000Z",
    imported: false,
  },
});

test("медиа из журнала загружается в HD до отправки события", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.push(CHANNEL, photoEvent("b1"), [{ id: "b1", data: Buffer.from([1, 2, 3]) }]);
  const uploads: string[] = [];
  const api: Api & { posted: GatewayEvent[][] } = {
    posted: [],
    async postEvents(events) {
      this.posted.push(events);
      return events.map(() => ({ ok: true }));
    },
    async uploadMedia(file) {
      uploads.push(`${file.originalName}:${file.data.length}`);
      return { name: "msg-abc.jpg", originalName: file.originalName, mimetype: file.mimetype, size: file.data.length };
    },
  };
  const pump = createPump({ journal, api });
  assert.equal(await pump.drainOnce(), "progress");
  assert.deepEqual(uploads, ["photo-42.jpg:3"]);
  const sent = api.posted[0]?.[0];
  assert.equal(sent?.type, "message");
  assert.deepEqual(sent?.type === "message" ? sent.message.attachments[0] : null, {
    name: "msg-abc.jpg",
    originalName: "photo-42.jpg",
    mimetype: "image/jpeg",
    size: 3,
    durationSec: null,
    status: "ready",
    externalRef: "tg:5550001:42",
  });
  assert.equal(journal.blob("b1"), null);
});

test("медиа: отказ 4xx — вложение failed сразу, событие всё равно уходит", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.push(CHANNEL, photoEvent("b1"), [{ id: "b1", data: Buffer.from([1]) }]);
  const posted: GatewayEvent[][] = [];
  const pump = createPump({
    journal,
    api: {
      async postEvents(events) {
        posted.push(events);
        return events.map(() => ({ ok: true }));
      },
      async uploadMedia() {
        throw new BackendError(413, "too large");
      },
    },
  });
  assert.equal(await pump.drainOnce(), "progress");
  const sent = posted[0]?.[0];
  assert.equal(sent?.type === "message" ? sent.message.attachments[0]?.status : "", "failed");
});

test("медиа: бэкенд лежит — событие ждёт вместе с файлом", async () => {
  const journal = createJournal(openDatabase(":memory:"), box);
  journal.push(CHANNEL, photoEvent("b1"), [{ id: "b1", data: Buffer.from([1]) }]);
  const pump = createPump({
    journal,
    api: {
      async postEvents() {
        throw new Error("not expected");
      },
      async uploadMedia() {
        throw new BackendError(0, "Backend unreachable");
      },
    },
  });
  await assert.rejects(pump.drainOnce(), BackendError);
  assert.equal(journal.size(), 1);
  assert.equal(journal.blob("b1")?.length, 1);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/store/journal.test.ts src/core/pump.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/store/journal.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/store/journal.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

import type { GatewayEvent, StateEvent } from "../backend/types.ts";
import type { Box } from "../crypto/box.ts";
import { logger } from "../logger.ts";
import { inTransaction } from "./db.ts";

/**
 * Журнал событий до бэкенда. Всё, что шлюз узнал от мессенджера, СНАЧАЛА
 * пишется сюда и только потом уходит в `POST /api/gateway/events` (насос,
 * core/pump.ts): бэкенд лежит пять минут — события ждут и уходят потом, в
 * своём порядке. Тексты и медиа — зашифрованы.
 *
 * Состояние канала (QR, «ждём код») не копится: новое вытесняет неотправленное
 * старое — устаревший QR-код никому не нужен.
 */
export type JournalRow = { seq: number; channelId: string; event: GatewayEvent; attempts: number };
export type BlobInput = { id: string; data: Buffer };

export type Journal = {
  push(channelId: string, event: GatewayEvent, blobs?: BlobInput[]): void;
  pushState(event: StateEvent): void;
  head(limit: number): JournalRow[];
  update(seq: number, event: GatewayEvent): void;
  blob(id: string): Buffer | null;
  dropBlob(id: string): void;
  remove(seqs: number[]): void;
  setAttempts(seq: number, attempts: number): void;
  size(): number;
};

const EVENT = "journal";
const BLOB = "blob";

export const createJournal = (db: DatabaseSync, box: Box): Journal => {
  const insert = (channelId: string, kind: "event" | "state", event: GatewayEvent): number => {
    const result = db
      .prepare("INSERT INTO journal (channel_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(channelId, kind, box.sealJson(event, EVENT), Date.now());
    return Number(result.lastInsertRowid);
  };

  const removeRows = (seqs: number[]): void => {
    for (const seq of seqs) {
      db.prepare("DELETE FROM blobs WHERE journal_seq = ?").run(seq);
      db.prepare("DELETE FROM journal WHERE seq = ?").run(seq);
    }
  };

  return {
    push(channelId, event, blobs = []) {
      inTransaction(db, () => {
        const seq = insert(channelId, "event", event);
        for (const blob of blobs) {
          db.prepare("INSERT INTO blobs (id, journal_seq, data) VALUES (?, ?, ?)").run(blob.id, seq, box.seal(blob.data, BLOB));
        }
      });
    },

    pushState(event) {
      inTransaction(db, () => {
        db.prepare("DELETE FROM journal WHERE channel_id = ? AND kind = 'state'").run(event.channelId);
        insert(event.channelId, "state", event);
      });
    },

    head(limit) {
      const rows = db
        .prepare("SELECT seq, channel_id, payload, attempts FROM journal ORDER BY seq LIMIT ?")
        .all(limit) as { seq: number; channel_id: string; payload: Uint8Array; attempts: number }[];
      const out: JournalRow[] = [];
      for (const row of rows) {
        try {
          // Запись наша (шифр с проверкой подлинности) — форма та, что мы положили
          const event = box.openJson(row.payload, EVENT) as GatewayEvent;
          out.push({ seq: row.seq, channelId: row.channel_id, event, attempts: row.attempts });
        } catch {
          // Запись чужой установки или повреждённая — отправить её нельзя, держать незачем
          logger.warn("Dropping unreadable journal row", { seq: row.seq, channelId: row.channel_id });
          removeRows([row.seq]);
        }
      }
      return out;
    },

    update(seq, event) {
      db.prepare("UPDATE journal SET payload = ? WHERE seq = ?").run(box.sealJson(event, EVENT), seq);
    },

    blob(id) {
      const row = db.prepare("SELECT data FROM blobs WHERE id = ?").get(id) as { data: Uint8Array } | undefined;
      if (!row) return null;
      try {
        return box.open(row.data, BLOB);
      } catch {
        return null;
      }
    },

    dropBlob(id) {
      db.prepare("DELETE FROM blobs WHERE id = ?").run(id);
    },

    remove(seqs) {
      if (seqs.length) inTransaction(db, () => removeRows(seqs));
    },

    setAttempts(seq, attempts) {
      db.prepare("UPDATE journal SET attempts = ? WHERE seq = ?").run(attempts, seq);
    },

    size() {
      return (db.prepare("SELECT count(*) AS n FROM journal").get() as { n: number }).n;
    },
  };
};
```

Create `msg-gateway/src/core/backoff.ts`:

```ts
/**
 * Пауза после `failures` неудач подряд: 1 с, 2 с, 4 с … не больше минуты.
 * Общая для насоса журнала и опроса заданий: бэкенд вернулся — через минуту
 * самое позднее шлюз это заметит.
 */
export const backoffMs = (failures: number, capMs = 60_000): number =>
  failures <= 0 ? 0 : Math.min(capMs, 1000 * 2 ** Math.min(failures - 1, 16));
```

Create `msg-gateway/src/core/pump.ts`:

```ts
import type { BackendApi } from "../backend/api.ts";
import { BackendError } from "../backend/client.ts";
import type { Attachment, MessageEvent, PendingAttachment } from "../backend/types.ts";
import { logger } from "../logger.ts";
import type { Journal, JournalRow } from "../store/journal.ts";
import { createWaker, messageOf, sleep } from "../util/async.ts";
import { backoffMs } from "./backoff.ts";

/**
 * Насос журнала: старейшие события пачками до 50 (предел бэкенда) уходят в
 * `POST /api/gateway/events`. Сначала медиа строки — в `POST /api/gateway/media`.
 *
 * - Бэкенд недоступен (сеть, 401, 429, 5xx на пачку) — ничего не теряем, ждём
 *   с паузой 1 с → 2 с → … → 60 с и шлём те же строки снова.
 * - Событие «ok» — удаляем; «не повторять» — удаляем с предупреждением.
 * - Событие «повторите» — оно и все следующие ждут следующего круга: порядок
 *   важнее (правка не должна обогнать своё сообщение). Приём на бэкенде
 *   идемпотентен, повтор уже принятых безвреден. После 20 таких отказов
 *   подряд событие уходит в журнал ошибок — иначе оно заперло бы очередь.
 */
export const BATCH_SIZE = 50;
export const MAX_EVENT_ATTEMPTS = 20;
export const MAX_MEDIA_ATTEMPTS = 3;

export type DrainOutcome = "idle" | "progress" | "blocked";

export type Pump = {
  drainOnce(): Promise<DrainOutcome>;
  run(signal: AbortSignal): Promise<void>;
  wake(): void;
  failures(): number;
};

export type PumpDeps = {
  journal: Journal;
  api: Pick<BackendApi, "postEvents" | "uploadMedia">;
  onBackendOk?: () => void;
  pauseMs?: (failures: number) => number;
};

const isPending = (attachment: Attachment | PendingAttachment): attachment is PendingAttachment =>
  attachment.status === "pending";

const failedOf = (attachment: PendingAttachment): Attachment => ({
  originalName: attachment.originalName,
  mimetype: attachment.mimetype,
  size: attachment.size,
  durationSec: attachment.durationSec,
  status: "failed",
  externalRef: attachment.externalRef,
});

export const createPump = ({ journal, api, onBackendOk = () => {}, pauseMs = backoffMs }: PumpDeps): Pump => {
  let failures = 0;
  const waker = createWaker();

  /** Медиа строки — в хранилище HD. Сеть/токен/429 — бросает: ждёт весь насос. */
  const resolveMedia = async (row: JournalRow): Promise<"ready" | "blocked"> => {
    if (row.event.type !== "message") return "ready";
    let event: MessageEvent = row.event;
    for (let index = 0; index < event.message.attachments.length; index += 1) {
      const attachment = event.message.attachments[index];
      if (!attachment || !isPending(attachment)) continue;
      let resolved: Attachment;
      const data = journal.blob(attachment.blobId);
      if (!data) {
        resolved = failedOf(attachment);
      } else {
        try {
          const stored = await api.uploadMedia({
            data,
            originalName: attachment.originalName,
            mimetype: attachment.mimetype,
          });
          resolved = {
            name: stored.name,
            originalName: attachment.originalName,
            mimetype: attachment.mimetype,
            size: stored.size || attachment.size,
            durationSec: attachment.durationSec,
            status: "ready",
            externalRef: attachment.externalRef,
          };
        } catch (error) {
          const status = error instanceof BackendError ? error.status : 0;
          if (status === 0 || status === 401 || status === 408 || status === 429) throw error;
          if (status >= 500 && row.attempts + 1 < MAX_MEDIA_ATTEMPTS) {
            row.attempts += 1;
            journal.setAttempts(row.seq, row.attempts);
            return "blocked";
          }
          // Отказ насовсем (контракт §6: слишком большой файл не повторять) — вложение failed
          logger.warn("Media upload failed for good", { seq: row.seq, channelId: row.channelId, status });
          resolved = failedOf(attachment);
        }
      }
      const attachments = [...event.message.attachments];
      attachments[index] = resolved;
      event = { ...event, message: { ...event.message, attachments } };
      row.event = event;
      journal.update(row.seq, event);
      journal.dropBlob(attachment.blobId);
    }
    return "ready";
  };

  const drainOnce = async (): Promise<DrainOutcome> => {
    const rows = journal.head(BATCH_SIZE);
    if (!rows.length) return "idle";
    const ready: JournalRow[] = [];
    for (const row of rows) {
      if ((await resolveMedia(row)) === "blocked") break;
      ready.push(row);
    }
    if (!ready.length) return "blocked";

    const results = await api.postEvents(ready.map((row) => row.event));
    onBackendOk();
    const done: number[] = [];
    let blocked = false;
    for (const [index, row] of ready.entries()) {
      const result = results[index];
      if (result?.ok) {
        done.push(row.seq);
        continue;
      }
      if (result && result.retryable === false) {
        logger.warn("Event rejected by backend", { seq: row.seq, channelId: row.channelId, type: row.event.type, error: result.error ?? "" });
        done.push(row.seq);
        continue;
      }
      const attempts = row.attempts + 1;
      if (attempts >= MAX_EVENT_ATTEMPTS) {
        logger.error("Event dropped after repeated failures", { seq: row.seq, channelId: row.channelId, type: row.event.type, error: result?.error ?? "" });
        done.push(row.seq);
      } else {
        journal.setAttempts(row.seq, attempts);
      }
      blocked = true;
      break;
    }
    journal.remove(done);
    return blocked ? "blocked" : "progress";
  };

  const run = async (signal: AbortSignal): Promise<void> => {
    while (!signal.aborted) {
      let outcome: DrainOutcome;
      try {
        outcome = await drainOnce();
      } catch (error) {
        outcome = "blocked";
        logger.warn("Journal pump: backend unavailable", { error: messageOf(error), backlog: journal.size() });
      }
      if (outcome === "progress") {
        failures = 0;
        continue;
      }
      if (outcome === "idle") {
        failures = 0;
        await waker.wait(1000, signal);
        continue;
      }
      failures += 1;
      await sleep(pauseMs(failures), signal);
    }
  };

  return { drainOnce, run, wake: () => waker.wake(), failures: () => failures };
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/store/journal.test.ts src/core/pump.test.ts`

Expected: PASS — summary `tests 11` · `pass 11` · `fail 0`.


The warnings the tests provoke on purpose (`Journal pump: backend unavailable`, `Event rejected by backend`, `Event dropped after repeated failures`, `Media upload failed for good`, `Dropping unreadable journal row`) print as JSON lines — expected.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 28` · `pass 28` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 5: Job runner, network boundary, channels and heartbeat

**Files:**
- Create: `msg-gateway/src/core/jobs.ts`, `msg-gateway/src/core/adapter.ts`, `msg-gateway/src/core/channels.ts`
- Test: `msg-gateway/src/core/jobs.test.ts`, `msg-gateway/src/core/channels.test.ts`

**Interfaces:**
- Consumes: `BackendApi`, `GatewayJob`, `JobOutcome`, `AckResult`, `GatewayChannel`, `Network`, `JobType` (Task 3); `backoffMs` (Task 4); `sleep`, `withTimeout`, `TimeoutError`, `messageOf` (Task 1).
- Produces: `JOB_TIMEOUT_MS: Record<JobType, number>`; `createJobRunner({api, networks, run, timeoutMs?, onBackendOk?, waitSec?, pauseMs?, now?}): JobRunner` — `{deliver(job, leaseId): Promise<void>; loop(signal): Promise<void>; inFlight(): number}`; `type NetworkAdapter = {network; apply(channels); runJob(job); channelIds(); status(); stop()}`; `createChannelSync({api, adapters, onBackendOk?}): {refresh(): Promise<void>}`; `createJobRouter({adapters, refresh}): (job) => Promise<JobOutcome>`; `sendHeartbeat(api, adapters): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/core/jobs.test.ts`:

```ts
// node --test src/core/jobs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { AckResult, GatewayJob, JobOutcome } from "../backend/types.ts";
import { sleep } from "../util/async.ts";
import { createJobRunner } from "./jobs.ts";

const job = (id: string, type: GatewayJob["type"] = "send"): GatewayJob => ({
  id,
  type,
  channelId: "64f600000000000000000001",
  conversationId: null,
  messageId: null,
  attempt: 0,
  payload: {},
});

const recorder = () => {
  const acks: { leaseId: string; results: AckResult[] }[] = [];
  return {
    acks,
    api: {
      async leaseJobs() {
        return { leaseId: "unused", leaseExpiresAt: "", jobs: [] };
      },
      async ackJobs(leaseId: string, results: AckResult[]) {
        acks.push({ leaseId, results });
        return { applied: results.length, ignored: 0 };
      },
    },
  };
};

test("итог задания уходит подтверждением под той же арендой", async () => {
  const { acks, api } = recorder();
  const runner = createJobRunner({
    api,
    networks: () => ["telegram"],
    run: async (item) =>
      item.id === "j1"
        ? { ok: true, result: { externalId: "10", externalIds: ["10"] } }
        : { ok: false, retryable: true, retryAfterMs: 17_000, error: "FLOOD_WAIT_17" },
  });
  await runner.deliver(job("j1"), "lease-1");
  await runner.deliver(job("j2"), "lease-1");
  assert.deepEqual(acks, [
    { leaseId: "lease-1", results: [{ id: "j1", ok: true, result: { externalId: "10", externalIds: ["10"] } }] },
    { leaseId: "lease-1", results: [{ id: "j2", ok: false, error: "FLOOD_WAIT_17", retryable: true, retryAfterMs: 17_000 }] },
  ]);
});

test("повторная выдача, пока задание идёт, второй раз его не запускает", async () => {
  const { acks, api } = recorder();
  let runs = 0;
  let finish: (outcome: JobOutcome) => void = () => {};
  const runner = createJobRunner({
    api,
    networks: () => ["telegram"],
    run: () => {
      runs += 1;
      return new Promise<JobOutcome>((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = runner.deliver(job("j1", "loadHistory"), "lease-1");
  const second = runner.deliver(job("j1", "loadHistory"), "lease-2");
  finish({ ok: true, result: { chats: 3 } });
  await Promise.all([first, second]);
  assert.equal(runs, 1);
  assert.deepEqual(acks.map((item) => item.leaseId), ["lease-2"]);
});

test("зависшее задание: «повторите» по таймауту, настоящий итог — при следующей выдаче, без второго запуска", async () => {
  const { acks, api } = recorder();
  let runs = 0;
  const runner = createJobRunner({
    api,
    networks: () => ["telegram"],
    timeoutMs: () => 20,
    run: async () => {
      runs += 1;
      await sleep(60);
      return { ok: true, result: { externalId: "11" } };
    },
  });
  await runner.deliver(job("j1"), "lease-1");
  assert.equal(acks[0]?.results[0]?.ok, false);
  assert.equal(acks[0]?.results[0]?.retryable, true);
  await sleep(80);
  await runner.deliver(job("j1"), "lease-2");
  assert.equal(runs, 1);
  assert.deepEqual(acks[1], { leaseId: "lease-2", results: [{ id: "j1", ok: true, result: { externalId: "11" } }] });
});

test("упавшее выполнение — «повторите», а не тишина", async () => {
  const { acks, api } = recorder();
  const runner = createJobRunner({
    api,
    networks: () => ["telegram"],
    run: async () => {
      throw new Error("boom");
    },
  });
  await runner.deliver(job("j1"), "lease-1");
  assert.deepEqual(acks[0]?.results[0], { id: "j1", ok: false, error: "boom", retryable: true });
});

test("цикл: берёт пачку и раздаёт задания; бэкенд недоступен — пауза и снова", async () => {
  const leased: string[] = [];
  const acks: string[] = [];
  let calls = 0;
  const controller = new AbortController();
  const runner = createJobRunner({
    api: {
      async leaseJobs(types) {
        calls += 1;
        leased.push(types.join(","));
        if (calls === 1) throw new Error("fetch failed");
        if (calls === 2) return { leaseId: "lease-1", leaseExpiresAt: "", jobs: [job("j1")] };
        controller.abort();
        return { leaseId: "lease-2", leaseExpiresAt: "", jobs: [] };
      },
      async ackJobs(leaseId, results) {
        acks.push(`${leaseId}:${results[0]?.id}`);
        return { applied: 1, ignored: 0 };
      },
    },
    networks: () => ["telegram"],
    pauseMs: () => 5,
    run: async () => ({ ok: true }),
  });
  await runner.loop(controller.signal);
  await sleep(10);
  assert.deepEqual(leased, ["telegram", "telegram", "telegram"]);
  assert.deepEqual(acks, ["lease-1:j1"]);
});
```

Create `msg-gateway/src/core/channels.test.ts`:

```ts
// node --test src/core/channels.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GatewayChannel, GatewayJob } from "../backend/types.ts";
import type { NetworkAdapter } from "./adapter.ts";
import { createChannelSync, createJobRouter, sendHeartbeat } from "./channels.ts";

const channel = (id: string): GatewayChannel => ({
  id,
  type: "telegram",
  name: "Поддержка",
  state: "disconnected",
  account: {},
  settings: { proxyUrl: "", historyDays: 14, importGroups: true, markReadOnOpen: true, maxMediaMb: 50, ignoredChatIds: [] },
  secrets: { tgApiId: "1", tgApiHash: "hash", proxyPassword: "" },
});

const fakeAdapter = (): NetworkAdapter & { applied: string[][] } => {
  let known: string[] = [];
  const applied: string[][] = [];
  return {
    network: "telegram",
    applied,
    async apply(channels) {
      known = channels.map((item) => item.id);
      applied.push(known);
    },
    async runJob(job) {
      return { ok: true, result: { ran: job.id } };
    },
    channelIds: () => known,
    status: () => [],
    async stop() {},
  };
};

const job: GatewayJob = { id: "j1", type: "login", channelId: "c2", conversationId: null, messageId: null, attempt: 0, payload: {} };

test("список каналов раздаётся адаптерам своей сети", async () => {
  const adapter = fakeAdapter();
  const asked: string[][] = [];
  const sync = createChannelSync({
    api: { async channels(types) { asked.push(types); return [channel("c1"), channel("c2")]; } },
    adapters: [adapter],
  });
  await sync.refresh();
  assert.deepEqual(asked, [["telegram"]]);
  assert.deepEqual(adapter.applied, [["c1", "c2"]]);
});

test("задание для незнакомого канала: перечитать список, потом отказать", async () => {
  const adapter = fakeAdapter();
  let lists = [[channel("c1")], [channel("c1"), channel("c2")]];
  const sync = createChannelSync({ api: { async channels() { return lists.shift() ?? []; } }, adapters: [adapter] });
  await sync.refresh();
  const route = createJobRouter({ adapters: [adapter], refresh: sync.refresh });
  assert.deepEqual(await route(job), { ok: true, result: { ran: "j1" } });
  lists = [[]];
  assert.deepEqual(await route({ ...job, channelId: "c9" }), { ok: false, retryable: false, error: "Канал не найден или отключён" });
});

test("heartbeat — пачками по 50", async () => {
  const adapter = fakeAdapter();
  await adapter.apply(Array.from({ length: 120 }, (_, index) => channel(`c${index}`)));
  const sizes: number[] = [];
  await sendHeartbeat({ async heartbeat(ids) { sizes.push(ids.length); } }, [adapter]);
  assert.deepEqual(sizes, [50, 50, 20]);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/core/jobs.test.ts src/core/channels.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/core/jobs.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/core/jobs.ts`:

```ts
import type { BackendApi } from "../backend/api.ts";
import type { AckResult, GatewayJob, JobOutcome, JobType, Network } from "../backend/types.ts";
import { logger } from "../logger.ts";
import { messageOf, sleep, TimeoutError, withTimeout } from "../util/async.ts";
import { backoffMs } from "./backoff.ts";

/**
 * Задания бэкенда: долгий опрос `GET /api/gateway/jobs?wait=25` → выполнение →
 * `POST /api/gateway/jobs/ack`.
 *
 * - Одно выполнение на задание. Аренда (2 мин) может истечь раньше, чем
 *   задание кончится (загрузка истории, большой файл через прокси); бэкенд
 *   выдаст его снова — второй раз НЕ запускаем, а подтверждаем итог первого
 *   под новой арендой.
 * - Каждая выдача ждёт не дольше своего потолка: зависший Telegram не держит
 *   сообщение «в очереди» вечно — отвечаем «повторите», бэкенд считает попытку.
 * - Итог помним час: потерянное подтверждение, повторная выдача — тот же итог
 *   без повторного выполнения. (После перезапуска процесса от двойной отправки
 *   бережёт журнал отправок, store/sent.ts.)
 */
export const JOB_TIMEOUT_MS: Record<JobType, number> = {
  send: 90_000,
  markRead: 30_000,
  fetchMedia: 5 * 60_000,
  login: 60_000,
  logout: 30_000,
  testProxy: 45_000,
  loadHistory: 30 * 60_000,
};

const REMEMBER_MS = 60 * 60_000;

export type JobRunnerDeps = {
  api: Pick<BackendApi, "leaseJobs" | "ackJobs">;
  networks: () => Network[];
  run: (job: GatewayJob) => Promise<JobOutcome>;
  timeoutMs?: (job: GatewayJob) => number;
  onBackendOk?: () => void;
  waitSec?: number;
  pauseMs?: (failures: number) => number;
  now?: () => number;
};

export type JobRunner = {
  /** Одна выдача задания; промис — до отправки подтверждения (для тестов). */
  deliver(job: GatewayJob, leaseId: string): Promise<void>;
  loop(signal: AbortSignal): Promise<void>;
  inFlight(): number;
};

const toAck = (id: string, outcome: JobOutcome): AckResult =>
  outcome.ok
    ? { id, ok: true, ...(outcome.result === undefined ? {} : { result: outcome.result }) }
    : {
        id,
        ok: false,
        error: outcome.error.slice(0, 500),
        retryable: outcome.retryable,
        ...(outcome.retryAfterMs ? { retryAfterMs: outcome.retryAfterMs } : {}),
      };

export const createJobRunner = ({
  api,
  networks,
  run,
  timeoutMs = (job) => JOB_TIMEOUT_MS[job.type] ?? 60_000,
  onBackendOk = () => {},
  waitSec = 25,
  pauseMs = backoffMs,
  now = Date.now,
}: JobRunnerDeps): JobRunner => {
  const current = new Map<string, { leaseId: string; execution: Promise<JobOutcome> }>();
  const finished = new Map<string, { outcome: JobOutcome; at: number }>();

  const ack = async (job: GatewayJob, leaseId: string, outcome: JobOutcome): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await api.ackJobs(leaseId, [toAck(job.id, outcome)]);
        return;
      } catch (error) {
        if (attempt === 3) {
          // Не дошло — аренда истечёт, задание вернётся, итог отдадим из памяти
          logger.warn("Job ack failed", { jobId: job.id, type: job.type, error: messageOf(error) });
          return;
        }
        await sleep(1000 * attempt);
      }
    }
  };

  const forgetOld = (): void => {
    const cutoff = now() - REMEMBER_MS;
    for (const [id, item] of finished) if (item.at < cutoff) finished.delete(id);
  };

  const deliver = async (job: GatewayJob, leaseId: string): Promise<void> => {
    const known = finished.get(job.id);
    if (known && !current.has(job.id)) {
      await ack(job, leaseId, known.outcome);
      return;
    }
    let entry = current.get(job.id);
    if (entry) {
      entry.leaseId = leaseId;
    } else {
      const execution = run(job).catch((error: unknown): JobOutcome => ({ ok: false, retryable: true, error: messageOf(error) }));
      const created = { leaseId, execution };
      entry = created;
      current.set(job.id, created);
      void execution.then((outcome) => {
        forgetOld();
        finished.set(job.id, { outcome, at: now() });
        if (current.get(job.id) === created) current.delete(job.id);
      });
    }
    const mine = entry;
    const outcome = await withTimeout(mine.execution, timeoutMs(job), "job timeout").catch(
      (error: unknown): JobOutcome => ({
        ok: false,
        retryable: true,
        error: error instanceof TimeoutError ? "Telegram не ответил вовремя — повторим" : messageOf(error),
      }),
    );
    // Пока ждали, задание выдали заново — подтверждать будет новая выдача
    if (mine.leaseId !== leaseId) return;
    await ack(job, leaseId, outcome);
  };

  const loop = async (signal: AbortSignal): Promise<void> => {
    let failures = 0;
    while (!signal.aborted) {
      const types = networks();
      if (!types.length) {
        await sleep(5000, signal);
        continue;
      }
      try {
        const batch = await api.leaseJobs(types, waitSec, signal);
        failures = 0;
        onBackendOk();
        for (const job of batch.jobs) void deliver(job, batch.leaseId);
      } catch (error) {
        if (signal.aborted) break;
        failures += 1;
        logger.warn("Job lease failed", { error: messageOf(error) });
        await sleep(pauseMs(failures), signal);
      }
    }
  };

  return { deliver, loop, inFlight: () => current.size };
};
```

Create `msg-gateway/src/core/adapter.ts`:

```ts
import type { GatewayChannel, GatewayJob, JobOutcome, Network } from "../backend/types.ts";

/**
 * Граница сети. Ядро шлюза (журнал, задания, каналы, heartbeat) о Telegram
 * ничего не знает; вторая сеть (WhatsApp, P4) — ещё одна реализация этого
 * типа рядом с telegram/adapter.ts.
 */
export type NetworkAdapter = {
  readonly network: Network;
  /** Полный список активных каналов своей сети: новые поднять, пропавшие остановить. */
  apply(channels: GatewayChannel[]): Promise<void>;
  runJob(job: GatewayJob): Promise<JobOutcome>;
  channelIds(): string[];
  status(): { channelId: string; state: string }[];
  stop(): Promise<void>;
};
```

Create `msg-gateway/src/core/channels.ts`:

```ts
import type { BackendApi } from "../backend/api.ts";
import type { GatewayJob, JobOutcome } from "../backend/types.ts";
import type { NetworkAdapter } from "./adapter.ts";

/**
 * Каналы — с бэкенда (`GET /api/gateway/channels`), раз в минуту и по
 * требованию: новый канал подключают из настроек, и первая команда входа
 * может прийти раньше очередного опроса.
 */
export const createChannelSync = ({
  api,
  adapters,
  onBackendOk = () => {},
}: {
  api: Pick<BackendApi, "channels">;
  adapters: NetworkAdapter[];
  onBackendOk?: () => void;
}) => ({
  async refresh(): Promise<void> {
    const channels = await api.channels(adapters.map((adapter) => adapter.network));
    onBackendOk();
    for (const adapter of adapters) {
      await adapter.apply(channels.filter((channel) => channel.type === adapter.network));
    }
  },
});

/** Задание — в адаптер, который знает канал; незнакомый канал — сначала перечитать список. */
export const createJobRouter = ({
  adapters,
  refresh,
}: {
  adapters: NetworkAdapter[];
  refresh: () => Promise<void>;
}) => async (job: GatewayJob): Promise<JobOutcome> => {
  const find = () => adapters.find((adapter) => adapter.channelIds().includes(job.channelId));
  let adapter = find();
  if (!adapter) {
    await refresh().catch(() => undefined);
    adapter = find();
  }
  if (!adapter) return { ok: false, retryable: false, error: "Канал не найден или отключён" };
  return adapter.runJob(job);
};

/** Отметка «шлюз жив и держит канал» — пачками по 50 (предел бэкенда). */
export const sendHeartbeat = async (api: Pick<BackendApi, "heartbeat">, adapters: NetworkAdapter[]): Promise<void> => {
  const ids = adapters.flatMap((adapter) => adapter.channelIds());
  for (let index = 0; index < ids.length; index += 50) await api.heartbeat(ids.slice(index, index + 50));
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/core/jobs.test.ts src/core/channels.test.ts`

Expected: PASS — summary `tests 8` · `pass 8` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 36` · `pass 36` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 6: Telegram model, ingest filters and normalization

**Files:**
- Create: `msg-gateway/src/telegram/types.ts`, `msg-gateway/src/telegram/port.ts`, `msg-gateway/src/telegram/filters.ts`, `msg-gateway/src/telegram/normalize.ts`, `msg-gateway/src/testing/fixtures.ts`
- Test: `msg-gateway/src/telegram/filters.test.ts`, `msg-gateway/src/telegram/normalize.test.ts`

**Interfaces:**
- Consumes: the contract types (Task 3).
- Produces: DTOs `TgPeerKind, TgUser, TgFileMedia, TgMedia, TgMessage, TgItem, TgDialog, InputPeer`, `isFileMedia(media): media is TgFileMedia`; `type TgPort` (connect, destroy, saveSession, ping, me, listen, sendText, sendFile, readHistory, dialogs, historyAfter, historySince, messageById, download, qrLogin, sendCode, signIn, checkPassword, logOut), `TgPortEvents`, `SendFile`, `class PasswordNeeded {hint}`; `SERVICE_NOTIFICATIONS_ID = "777000"`, `skipReason({chatId, peerKind, user, selfId, ignoredChatIds}): SkipReason | null`; normalize: `displayName, phoneOf, personOf, accountOf, iso, kindOf, textOf, mediaRef, mediaPlan, skippedAttachment, failedAttachment, pendingAttachment, messageEvent, echoEvent, editEvent, deleteEvents, readEvents, stateEvent`; fixtures `CHANNEL_ID, SELF_ID, CLIENT_ID, tgUser, tgMessage, tgItem, gatewayChannel`.

- [ ] **Step 1: Write the failing tests** (and the shared fixtures)

Create `msg-gateway/src/testing/fixtures.ts`:

```ts
import type { GatewayChannel } from "../backend/types.ts";
import type { TgItem, TgMessage, TgUser } from "../telegram/types.ts";

/** Заготовки для тестов: клиент, корпоративный аккаунт, сообщения лички. */
export const CHANNEL_ID = "64f600000000000000000001";
export const SELF_ID = "100";
export const CLIENT_ID = "5550001";

export const tgUser = (id: string, extra: Partial<TgUser> = {}): TgUser => ({
  id,
  accessHash: `hash-${id}`,
  firstName: "Анна",
  lastName: "Петрова",
  username: "anna_p",
  phone: "79991234567",
  isBot: false,
  isSelf: false,
  ...extra,
});

export const tgMessage = (id: number, extra: Partial<TgMessage> = {}): TgMessage => ({
  id,
  chatId: CLIENT_ID,
  peerKind: "user",
  out: false,
  date: 1_758_800_000 + id,
  editDate: null,
  text: `Сообщение ${id}`,
  replyToId: null,
  media: null,
  service: false,
  ...extra,
});

export const tgItem = (id: number, extra: Partial<TgMessage> = {}, peer: TgUser | null = tgUser(CLIENT_ID)): TgItem => ({
  message: tgMessage(id, extra),
  peer,
  handle: { id },
});

export const gatewayChannel = (extra: Partial<GatewayChannel> = {}): GatewayChannel => ({
  id: CHANNEL_ID,
  type: "telegram",
  name: "Поддержка",
  state: "disconnected",
  account: {},
  settings: { proxyUrl: "", historyDays: 14, importGroups: true, markReadOnOpen: true, maxMediaMb: 50, ignoredChatIds: [] },
  secrets: { tgApiId: "12345", tgApiHash: "0123456789abcdef", proxyPassword: "" },
  ...extra,
});
```

Create `msg-gateway/src/telegram/filters.test.ts`:

```ts
// node --test src/telegram/filters.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { skipReason } from "./filters.ts";
import type { TgUser } from "./types.ts";

const user = (id: string, extra: Partial<TgUser> = {}): TgUser => ({
  id,
  accessHash: "1",
  firstName: "Анна",
  lastName: "",
  username: "",
  phone: "",
  isBot: false,
  isSelf: false,
  ...extra,
});

const base = { selfId: "100", ignoredChatIds: ["300"] };

test("777000 (коды входа Telegram) не попадает в HD никогда", () => {
  assert.equal(skipReason({ ...base, chatId: "777000", peerKind: "user", user: user("777000") }), "service");
  // даже если собеседника не удалось получить
  assert.equal(skipReason({ ...base, chatId: "777000", peerKind: "user", user: null }), "service");
});

test("«Избранное», боты, группы, каналы и игнор-лист — мимо", () => {
  assert.equal(skipReason({ ...base, chatId: "100", peerKind: "user", user: null }), "self");
  assert.equal(skipReason({ ...base, chatId: "101", peerKind: "user", user: user("101", { isSelf: true }) }), "self");
  assert.equal(skipReason({ ...base, chatId: "200", peerKind: "user", user: user("200", { isBot: true }) }), "bot");
  assert.equal(skipReason({ ...base, chatId: "-555", peerKind: "chat", user: null }), "notDirect");
  assert.equal(skipReason({ ...base, chatId: "-100555", peerKind: "channel", user: null }), "notDirect");
  assert.equal(skipReason({ ...base, chatId: "300", peerKind: "user", user: user("300") }), "ignored");
});

test("обычный клиент в личке — принимаем", () => {
  assert.equal(skipReason({ ...base, chatId: "5550001", peerKind: "user", user: user("5550001") }), null);
});
```

Create `msg-gateway/src/telegram/normalize.test.ts`:

```ts
// node --test src/telegram/normalize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHANNEL_ID, CLIENT_ID, tgMessage, tgUser } from "../testing/fixtures.ts";
import {
  accountOf,
  deleteEvents,
  echoEvent,
  editEvent,
  mediaPlan,
  messageEvent,
  pendingAttachment,
  readEvents,
  skippedAttachment,
  stateEvent,
} from "./normalize.ts";
import type { TgFileMedia } from "./types.ts";

const client = tgUser(CLIENT_ID);

test("входящее: отправитель и собеседник чата — клиент; имя — не телефон и не ник", () => {
  const event = messageEvent({ channelId: CHANNEL_ID, message: tgMessage(42, { replyToId: 41 }), peer: client, attachments: [], imported: false });
  assert.deepEqual(event, {
    type: "message",
    channelId: CHANNEL_ID,
    chat: {
      id: CLIENT_ID,
      kind: "direct",
      title: "Анна Петрова",
      peer: { id: CLIENT_ID, name: "Анна Петрова", firstName: "Анна", lastName: "Петрова", username: "anna_p", phone: "+79991234567", isBot: false },
    },
    message: {
      id: "42",
      direction: "in",
      sender: { id: CLIENT_ID, name: "Анна Петрова", firstName: "Анна", lastName: "Петрова", username: "anna_p", phone: "+79991234567", isBot: false },
      kind: "text",
      text: "Сообщение 42",
      attachments: [],
      replyToId: "41",
      sentAt: new Date((1_758_800_000 + 42) * 1000).toISOString(),
      imported: false,
    },
  });
});

test("у безымянного собеседника имя пустое, а не @ник или номер", () => {
  const nameless = tgUser(CLIENT_ID, { firstName: "", lastName: "" });
  const event = messageEvent({ channelId: CHANNEL_ID, message: tgMessage(1), peer: nameless, attachments: [], imported: false });
  assert.equal(event.chat.peer?.name, "");
  assert.equal(event.message.sender?.name, "");
});

test("исходящее с телефона: origin device, без отправителя, собеседник в чате", () => {
  const event = messageEvent({ channelId: CHANNEL_ID, message: tgMessage(43, { out: true }), peer: client, attachments: [], imported: false });
  assert.equal(event.message.direction, "out");
  assert.equal(event.message.origin, "device");
  assert.equal(event.message.sender, undefined);
  assert.equal(event.chat.peer?.id, CLIENT_ID);
});

test("эхо ответа из HD: origin hd и jobId, без медиа — бэкенд лишь подтверждает своё сообщение", () => {
  const photo = { kind: "photo" as const, fileName: "photo-47.jpg", mimetype: "image/jpeg", size: 10, durationSec: null };
  const event = echoEvent({
    channelId: CHANNEL_ID,
    message: tgMessage(47, { out: true, text: "Смотрим\n\n— Игорь, F1Lab", media: photo }),
    peer: client,
    jobId: "64f600000000000000000aaa",
  });
  assert.equal(event.message.direction, "out");
  assert.equal(event.message.origin, "hd");
  assert.equal(event.message.jobId, "64f600000000000000000aaa");
  assert.deepEqual(event.message.attachments, []);
  assert.equal(event.message.imported, false);
  assert.equal(event.chat.peer?.id, CLIENT_ID);
});

test("история помечается imported; геопозиция без подписи — координатами", () => {
  const event = messageEvent({
    channelId: CHANNEL_ID,
    message: tgMessage(44, { text: "", media: { kind: "location", text: "55.755800, 37.617300" } }),
    peer: client,
    attachments: [],
    imported: true,
  });
  assert.equal(event.message.imported, true);
  assert.equal(event.message.kind, "location");
  assert.equal(event.message.text, "55.755800, 37.617300");
});

const photo: TgFileMedia = { kind: "photo", fileName: "photo-45.jpg", mimetype: "image/jpeg", size: 2 * 1024 * 1024, durationSec: null };

test("медиа: больше предела канала или из истории — пропуск, иначе скачать", () => {
  assert.equal(mediaPlan(photo, { maxMediaMb: 50, imported: false }), "download");
  assert.equal(mediaPlan(photo, { maxMediaMb: 1, imported: false }), "skip");
  assert.equal(mediaPlan(photo, { maxMediaMb: 50, imported: true }), "skip");
  assert.equal(mediaPlan({ kind: "sticker" }, { maxMediaMb: 50, imported: false }), "none");
  assert.equal(mediaPlan(null, { maxMediaMb: 50, imported: false }), "none");
  assert.deepEqual(skippedAttachment(photo, "tg:5550001:45"), {
    originalName: "photo-45.jpg",
    mimetype: "image/jpeg",
    size: 2 * 1024 * 1024,
    durationSec: null,
    externalRef: "tg:5550001:45",
    status: "skipped",
  });
  assert.equal(pendingAttachment(photo, "tg:5550001:45", "b1", 1234).size, 1234);
});

test("правка, удаление пачками по 100, прочтение: HD — по jobId, телефон — по номерам", () => {
  assert.deepEqual(editEvent(CHANNEL_ID, tgMessage(46, { text: "Исправил", editDate: 1_758_900_000 })), {
    type: "message.edited",
    channelId: CHANNEL_ID,
    chat: { id: CLIENT_ID, kind: "direct" },
    message: { id: "46", text: "Исправил", editedAt: new Date(1_758_900_000_000).toISOString() },
  });
  const deletions = deleteEvents(CHANNEL_ID, Array.from({ length: 150 }, (_, index) => index + 1));
  assert.deepEqual(deletions.map((event) => event.messageIds.length), [100, 50]);
  assert.deepEqual(
    readEvents(CHANNEL_ID, CLIENT_ID, [
      { messageId: 50, jobId: "64f600000000000000000aaa" },
      { messageId: 51, jobId: "64f600000000000000000aaa" },
      { messageId: 52, jobId: null },
    ]),
    [
      { type: "message.status", channelId: CHANNEL_ID, status: "read", jobId: "64f600000000000000000aaa" },
      { type: "message.status", channelId: CHANNEL_ID, status: "read", chat: { id: CLIENT_ID }, messageIds: ["52"] },
    ],
  );
});

test("состояние канала: аккаунт с номером E.164, QR, пустые поля — null", () => {
  assert.deepEqual(stateEvent(CHANNEL_ID, "connected", { account: accountOf(tgUser("100", { firstName: "Поддержка", lastName: "F1Lab", username: "f1lab", phone: "79990000000" })) }), {
    type: "channel.state",
    channelId: CHANNEL_ID,
    state: "connected",
    reason: "",
    account: { externalId: "100", displayName: "Поддержка F1Lab", username: "f1lab", phone: "+79990000000" },
    login: null,
  });
  assert.equal(stateEvent(CHANNEL_ID, "awaitingQr", { login: { qr: "tg://login?token=abc", expiresAt: "2026-09-25T10:00:30.000Z" } }).login?.qr, "tg://login?token=abc");
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/filters.test.ts src/telegram/normalize.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/types.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/types.ts`:

```ts
/**
 * Telegram глазами шлюза — простые объекты без GramJS. В них объекты GramJS
 * переводит telegram/mtproto.ts (единственный модуль, который импортирует
 * библиотеку `telegram`); всё остальное — логика на этих типах, и её
 * проверяют тесты без сети.
 */

export type TgPeerKind = "user" | "chat" | "channel";

export type TgUser = {
  /** id пользователя строкой (для лички — он же id чата). */
  id: string;
  /** "" — неизвестен или «min»-хеш, по которому писать нельзя. */
  accessHash: string;
  firstName: string;
  lastName: string;
  username: string;
  /** Цифры без «+», как отдаёт Telegram; "" — номер скрыт. */
  phone: string;
  isBot: boolean;
  isSelf: boolean;
};

export type TgFileMedia = {
  kind: "photo" | "voice" | "audio" | "video" | "document";
  fileName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
};

export type TgMedia =
  | TgFileMedia
  | { kind: "sticker" }
  | { kind: "location" | "contact"; text: string }
  | { kind: "other" };

export type TgMessage = {
  id: number;
  /** Помеченный id чата (utils.getPeerId): личка — id пользователя, группы — отрицательные. */
  chatId: string;
  peerKind: TgPeerKind;
  out: boolean;
  /** unix, секунды */
  date: number;
  editDate: number | null;
  text: string;
  replyToId: number | null;
  media: TgMedia | null;
  /** MessageService: звонок, закреп и прочие служебные строки — не сообщение. */
  service: boolean;
};

/** Сообщение + собеседник + непрозрачная ссылка на объект GramJS (для скачивания медиа). */
export type TgItem = { message: TgMessage; peer: TgUser | null; handle: unknown };

export type TgDialog = {
  chatId: string;
  peerKind: TgPeerKind;
  user: TgUser | null;
  topId: number;
  topDate: number;
};

/** Куда писать: без access_hash Telegram личку не примет. */
export type InputPeer = { userId: string; accessHash: string };

export const isFileMedia = (media: TgMedia | null): media is TgFileMedia =>
  media !== null && (media.kind === "photo" || media.kind === "voice" || media.kind === "audio" || media.kind === "video" || media.kind === "document");
```

Create `msg-gateway/src/telegram/port.ts`:

```ts
import type { InputPeer, TgDialog, TgItem, TgPeerKind, TgUser } from "./types.ts";

/**
 * Всё, что шлюзу нужно от клиента Telegram. Настоящая реализация —
 * telegram/mtproto.ts (GramJS), в тестах — testing/fakePort.ts.
 */
export type TgPortEvents = {
  message(item: TgItem): void;
  edited(item: TgItem): void;
  deleted(ids: number[], inChannel: boolean): void;
  readOutbox(chatId: string, peerKind: TgPeerKind, maxId: number): void;
  connection(state: "connected" | "disconnected" | "broken"): void;
};

export type SendFile = { buffer: Buffer; name: string; mimetype: string; asPhoto: boolean };

export type TgPort = {
  /** true — связь есть; false — не достучались (прокси, блокировка). RPC-ошибку бросает. */
  connect(): Promise<boolean>;
  destroy(): Promise<void>;
  saveSession(): string;
  /** Авторизована ли сессия: updates.GetState, ошибку бросает как есть. */
  ping(): Promise<void>;
  me(): Promise<TgUser>;
  listen(events: TgPortEvents): void;
  /** id отправленного сообщения; null — Telegram не вернул сопоставления random_id → id. */
  sendText(peer: InputPeer, text: string, randomId: bigint): Promise<number | null>;
  sendFile(peer: InputPeer, file: SendFile, caption: string, randomId: bigint): Promise<number | null>;
  readHistory(peer: InputPeer, maxId: number): Promise<void>;
  dialogs(limit: number): Promise<TgDialog[]>;
  /** Сообщения с id > minId, от старых к новым, не больше limit. */
  historyAfter(peer: InputPeer, minId: number, limit: number): Promise<TgItem[]>;
  /** Сообщения не старше sinceUnix, от старых к новым, не больше limit (самые свежие). */
  historySince(peer: InputPeer, sinceUnix: number, limit: number): Promise<TgItem[]>;
  messageById(peer: InputPeer, id: number): Promise<TgItem | null>;
  download(handle: unknown, maxBytes: number): Promise<Buffer>;
  /** Вход по QR; onQr — на каждый новый код (раз в ~30 с). Нужен пароль — бросает PasswordNeeded. */
  qrLogin(onQr: (url: string, expiresAt: Date) => void): Promise<TgUser>;
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>;
  /** Нужен пароль двухэтапной проверки — бросает PasswordNeeded. */
  signIn(phone: string, phoneCodeHash: string, code: string): Promise<TgUser>;
  checkPassword(password: string): Promise<TgUser>;
  logOut(): Promise<void>;
};

/** Аккаунт под двухэтапной проверкой: вход продолжит шаг `password`. */
export class PasswordNeeded extends Error {
  hint: string;

  constructor(hint: string) {
    super("SESSION_PASSWORD_NEEDED");
    this.name = "PasswordNeeded";
    this.hint = hint;
  }
}
```

Create `msg-gateway/src/telegram/filters.ts`:

```ts
import type { TgPeerKind, TgUser } from "./types.ts";

/**
 * Какие чаты попадают в HD. Аккаунт корпоративный и только для клиентов,
 * но в нём всё равно есть то, чему в HD не место:
 * - 777000 — служебные уведомления Telegram, в том числе КОДЫ ВХОДА;
 * - «Избранное» (чат с самим собой);
 * - боты;
 * - группы (P2) и каналы (никогда) — в P1a шлюз ведёт только личные чаты;
 * - чаты из настройки канала ignoredChatIds.
 */
export const SERVICE_NOTIFICATIONS_ID = "777000";

export type SkipReason = "notDirect" | "service" | "self" | "bot" | "ignored";

export const skipReason = ({
  chatId,
  peerKind,
  user,
  selfId,
  ignoredChatIds,
}: {
  chatId: string;
  peerKind: TgPeerKind;
  user: TgUser | null;
  selfId: string;
  ignoredChatIds: string[];
}): SkipReason | null => {
  if (peerKind !== "user") return "notDirect";
  if (chatId === SERVICE_NOTIFICATIONS_ID) return "service";
  if (chatId === selfId || user?.isSelf) return "self";
  if (user?.isBot) return "bot";
  if (ignoredChatIds.includes(chatId)) return "ignored";
  return null;
};
```

Create `msg-gateway/src/telegram/normalize.ts`:

```ts
import type {
  Attachment,
  ChannelState,
  DeletedEvent,
  EditedEvent,
  MessageEvent,
  MessageKind,
  PendingAttachment,
  Person,
  StateAccount,
  StateEvent,
  StatusEvent,
} from "../backend/types.ts";
import { isFileMedia, type TgFileMedia, type TgMedia, type TgMessage, type TgUser } from "./types.ts";

/**
 * Telegram → нормализованные события бэкенда (backend/services/messaging/events.js).
 * Чисто: вход — простые объекты (types.ts), выход — JSON контракта.
 */

const MB = 1024 * 1024;

/** Имя — только имя и фамилия: не телефон и не @ник (оно видно клиенту, контракт §6). */
export const displayName = (user: TgUser): string =>
  [user.firstName, user.lastName].map((part) => part.trim()).filter(Boolean).join(" ");

/** E.164: Telegram отдаёт цифры без «+». */
export const phoneOf = (user: TgUser): string => {
  const digits = user.phone.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
};

export const personOf = (user: TgUser): Person => ({
  id: user.id,
  name: displayName(user),
  firstName: user.firstName,
  lastName: user.lastName,
  username: user.username,
  phone: phoneOf(user),
  isBot: user.isBot,
});

export const accountOf = (user: TgUser): StateAccount => ({
  externalId: user.id,
  displayName: displayName(user),
  username: user.username,
  phone: phoneOf(user),
});

export const iso = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString();

export const kindOf = (media: TgMedia | null): MessageKind => (media ? media.kind : "text");

/** Текст сообщения; у геопозиции и контакта без подписи — их содержимое. */
export const textOf = (message: TgMessage): string => {
  if (message.text) return message.text;
  if (message.media && (message.media.kind === "location" || message.media.kind === "contact")) return message.media.text;
  return "";
};

export const mediaRef = (chatId: string, messageId: number): string => `tg:${chatId}:${messageId}`;

/** Скачивать сейчас, пропустить (докачка по клику — fetchMedia) или файла нет. */
export const mediaPlan = (
  media: TgMedia | null,
  { maxMediaMb, imported }: { maxMediaMb: number; imported: boolean },
): "none" | "skip" | "download" => {
  if (!isFileMedia(media)) return "none";
  if (imported || media.size > maxMediaMb * MB) return "skip";
  return "download";
};

const described = (media: TgFileMedia, ref: string) => ({
  originalName: media.fileName,
  mimetype: media.mimetype,
  size: media.size,
  durationSec: media.durationSec,
  externalRef: ref,
});

export const skippedAttachment = (media: TgFileMedia, ref: string): Attachment => ({ ...described(media, ref), status: "skipped" });
export const failedAttachment = (media: TgFileMedia, ref: string): Attachment => ({ ...described(media, ref), status: "failed" });
export const pendingAttachment = (media: TgFileMedia, ref: string, blobId: string, bytes: number): PendingAttachment => ({
  ...described(media, ref),
  size: bytes,
  status: "pending",
  blobId,
});

/**
 * Сообщение личного чата. Входящее — с отправителем; исходящее без jobId —
 * «с телефона» (origin: device): его набрали на корпоративном телефоне.
 * `chat.peer` — всегда собеседник, чтобы бэкенд знал его и по исходящему.
 */
export const messageEvent = ({
  channelId,
  message,
  peer,
  attachments,
  imported,
}: {
  channelId: string;
  message: TgMessage;
  peer: TgUser;
  attachments: (Attachment | PendingAttachment)[];
  imported: boolean;
}): MessageEvent => {
  const person = personOf(peer);
  return {
    type: "message",
    channelId,
    chat: { id: message.chatId, kind: "direct", title: person.name ?? "", peer: person },
    message: {
      id: String(message.id),
      direction: message.out ? "out" : "in",
      ...(message.out ? { origin: "device" as const } : { sender: person }),
      kind: kindOf(message.media),
      text: textOf(message),
      attachments,
      replyToId: message.replyToId ? String(message.replyToId) : null,
      sentAt: iso(message.date),
      imported,
    },
  };
};

/**
 * Эхо нашего ответа из HD (увидели его при проверке пропусков): несёт jobId,
 * бэкенд подтверждает им своё сообщение (confirmOwn), нового не создаёт
 * (контракт §6). Медиа не качаем — оно уже в HD.
 */
export const echoEvent = ({
  channelId,
  message,
  peer,
  jobId,
}: {
  channelId: string;
  message: TgMessage;
  peer: TgUser;
  jobId: string;
}): MessageEvent => ({
  type: "message",
  channelId,
  chat: { id: message.chatId, kind: "direct", peer: personOf(peer) },
  message: {
    id: String(message.id),
    direction: "out",
    origin: "hd",
    jobId,
    kind: kindOf(message.media),
    text: textOf(message),
    attachments: [],
    replyToId: null,
    sentAt: iso(message.date),
    imported: false,
  },
});

export const editEvent = (channelId: string, message: TgMessage): EditedEvent => ({
  type: "message.edited",
  channelId,
  chat: { id: message.chatId, kind: "direct" },
  message: { id: String(message.id), text: textOf(message), editedAt: iso(message.editDate ?? message.date) },
});

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

/**
 * Удаление в личке приходит без чата (номера сообщений аккаунта уникальны),
 * пачками до 100 — предел бэкенда.
 */
export const deleteEvents = (channelId: string, ids: number[]): DeletedEvent[] =>
  chunk(ids.map(String), 100).map((messageIds) => ({ type: "message.deleted", channelId, messageIds }));

/**
 * Клиент прочитал наши сообщения. Ответы из HD — по jobId (бэкенд найдёт своё
 * сообщение, даже если подтверждение отправки ещё не дошло), отправленные с
 * телефона — по номерам в чате.
 */
export const readEvents = (
  channelId: string,
  chatId: string,
  rows: { messageId: number; jobId: string | null }[],
): StatusEvent[] => {
  const jobIds = [...new Set(rows.flatMap((row) => (row.jobId ? [row.jobId] : [])))];
  const device = rows.filter((row) => !row.jobId).map((row) => String(row.messageId));
  return [
    ...jobIds.map((jobId): StatusEvent => ({ type: "message.status", channelId, status: "read", jobId })),
    ...chunk(device, 100).map((messageIds): StatusEvent => ({
      type: "message.status",
      channelId,
      status: "read",
      chat: { id: chatId },
      messageIds,
    })),
  ];
};

export const stateEvent = (
  channelId: string,
  state: ChannelState,
  extra: { reason?: string; account?: StateAccount; login?: { qr: string; expiresAt: string } } = {},
): StateEvent => ({
  type: "channel.state",
  channelId,
  state,
  reason: extra.reason ?? "",
  account: extra.account ?? null,
  login: extra.login ?? null,
});
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/filters.test.ts src/telegram/normalize.test.ts`

Expected: PASS — summary `tests 11` · `pass 11` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 47` · `pass 47` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 7: Outbound rules — random_id, message parts, job payloads, pacing

**Files:**
- Create: `msg-gateway/src/telegram/randomId.ts`, `msg-gateway/src/telegram/plan.ts`, `msg-gateway/src/telegram/payloads.ts`, `msg-gateway/src/util/rateLimit.ts`
- Test: `msg-gateway/src/telegram/randomId.test.ts`, `msg-gateway/src/telegram/plan.test.ts`, `msg-gateway/src/telegram/payloads.test.ts`, `msg-gateway/src/util/rateLimit.test.ts`

**Interfaces:**
- Produces: `deriveRandomId(jobId: string, part: number): bigint`; `TEXT_LIMIT = 4096`, `CAPTION_LIMIT = 1024`, `SendAttachment = {name, originalName, mimetype, size}`, `SendPart = {kind: "text"; text} | {kind: "file"; attachment; caption}`, `splitText(text, limit?)`, `planParts(text, attachments): SendPart[]`, `sendsAsPhoto(mimetype, bytes): boolean`; `SendPayload = {chatId, kind: "direct" | "group", text, attachments}`, `parseSend`, `parseMarkRead(raw): {chatId, maxId} | null`, `parseFetchMedia(raw): {chatId, messageId} | null`, `LoginStep`, `parseLogin(raw): {step, value} | null`, `parseDays(raw): number`; `createRateLimiter({perChatMs = 1000, globalLimit = 20, globalWindowMs = 60000, now}): RateLimiter` — `{acquire(key): number}` (0 = go now, else ms to wait; a refusal takes no slot).

The random_id test pins two values: changing the formula would make a job leased before a deploy and retried after it send a second copy.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/telegram/randomId.test.ts`:

```ts
// node --test src/telegram/randomId.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveRandomId } from "./randomId.ts";

const JOB = "64f600000000000000000abc";

test("то же задание и та же часть — тот же random_id (повтор не дублирует)", () => {
  assert.equal(deriveRandomId(JOB, 0), deriveRandomId(JOB, 0));
});

test("контрольные значения: формула не менялась", () => {
  assert.equal(deriveRandomId(JOB, 0), -7290928017531797533n);
  assert.equal(deriveRandomId(JOB, 1), -4180331057472121638n);
});

test("разные части и разные задания — разные random_id, все в int64 и не ноль", () => {
  const seen = new Set<bigint>();
  for (let job = 0; job < 50; job += 1) {
    for (let part = 0; part < 5; part += 1) {
      const value = deriveRandomId(`64f6000000000000000${String(job).padStart(5, "0")}`, part);
      assert.ok(value >= -(2n ** 63n) && value < 2n ** 63n);
      assert.notEqual(value, 0n);
      seen.add(value);
    }
  }
  assert.equal(seen.size, 250);
});
```

Create `msg-gateway/src/telegram/plan.test.ts`:

```ts
// node --test src/telegram/plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPTION_LIMIT, planParts, sendsAsPhoto, splitText, TEXT_LIMIT } from "./plan.ts";

const file = (name: string, mimetype = "application/pdf") => ({ name, originalName: `${name}.pdf`, mimetype, size: 10 });

test("короткий текст — одна часть", () => {
  assert.deepEqual(planParts("  Добрый день!  ", []), [{ kind: "text", text: "Добрый день!" }]);
  assert.deepEqual(planParts("   ", []), []);
});

test("длинный текст режется по абзацам, ни одна часть не длиннее 4096", () => {
  const paragraph = "Проверили сервер, всё работает. ".repeat(60).trim();
  const parts = splitText([paragraph, paragraph, paragraph].join("\n\n"));
  assert.ok(parts.length >= 2);
  for (const part of parts) assert.ok(part.length <= TEXT_LIMIT, `${part.length}`);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), [paragraph, paragraph, paragraph].join(" ").replace(/\s+/g, " "));
});

test("сплошной текст без пробелов режется по пределу, эмодзи пополам не рвётся", () => {
  const text = `${"а".repeat(TEXT_LIMIT - 1)}😀${"б".repeat(10)}`;
  const [first, second] = splitText(text);
  assert.equal(first, "а".repeat(TEXT_LIMIT - 1));
  assert.equal(second, `😀${"б".repeat(10)}`);
});

test("текст до 1024 — подписью к первому файлу; длиннее — отдельными сообщениями перед файлами", () => {
  assert.deepEqual(planParts("Акт во вложении", [file("act"), file("bill")]), [
    { kind: "file", attachment: file("act"), caption: "Акт во вложении" },
    { kind: "file", attachment: file("bill"), caption: "" },
  ]);
  const long = "х".repeat(CAPTION_LIMIT + 1);
  assert.deepEqual(planParts(long, [file("act")]), [
    { kind: "text", text: long },
    { kind: "file", attachment: file("act"), caption: "" },
  ]);
});

test("фото — jpeg/png/webp до 10 МБ, остальное документом", () => {
  assert.equal(sendsAsPhoto("image/jpeg", 2_000_000), true);
  assert.equal(sendsAsPhoto("IMAGE/PNG", 1), true);
  assert.equal(sendsAsPhoto("image/jpeg", 11 * 1024 * 1024), false);
  assert.equal(sendsAsPhoto("image/gif", 1000), false);
  assert.equal(sendsAsPhoto("application/pdf", 1000), false);
});
```

Create `msg-gateway/src/telegram/payloads.test.ts`:

```ts
// node --test src/telegram/payloads.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDays, parseFetchMedia, parseLogin, parseMarkRead, parseSend } from "./payloads.ts";

test("send: чат, текст и вложения из очереди бэкенда (queueOutbound)", () => {
  assert.deepEqual(
    parseSend({
      chatId: "5550001",
      kind: "direct",
      text: "Добрый день\n\n— Игорь, F1Lab",
      attachments: [{ name: "cp-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 0 }, { bad: true }],
    }),
    {
      chatId: "5550001",
      kind: "direct",
      text: "Добрый день\n\n— Игорь, F1Lab",
      attachments: [{ name: "cp-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 0 }],
    },
  );
  assert.equal(parseSend({ text: "без чата" }), null);
});

test("markRead и fetchMedia: номер сообщения — целое больше нуля", () => {
  assert.deepEqual(parseMarkRead({ chatId: "5550001", upToExternalId: "42" }), { chatId: "5550001", maxId: 42 });
  assert.equal(parseMarkRead({ chatId: "5550001", upToExternalId: "abc" }), null);
  assert.deepEqual(parseFetchMedia({ chatId: "5550001", externalId: "43" }), { chatId: "5550001", messageId: 43 });
  assert.equal(parseFetchMedia({ chatId: "5550001" }), null);
});

test("login: шаг из списка, значение обязательно везде, кроме start", () => {
  assert.deepEqual(parseLogin({ step: "start", value: null }), { step: "start", value: "" });
  assert.deepEqual(parseLogin({ step: "code", value: " 12345 " }), { step: "code", value: "12345" });
  assert.equal(parseLogin({ step: "code", value: "" }), null);
  assert.equal(parseLogin({ step: "hack" }), null);
});

test("история: 1–90 дней, по умолчанию 14", () => {
  assert.equal(parseDays({ days: 30 }), 30);
  assert.equal(parseDays({ days: 900 }), 90);
  assert.equal(parseDays({}), 14);
});
```

Create `msg-gateway/src/util/rateLimit.test.ts`:

```ts
// node --test src/util/rateLimit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "./rateLimit.ts";

test("один чат — не чаще раза в секунду", () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ now: () => now });
  assert.equal(limiter.acquire("chat-1"), 0);
  assert.equal(limiter.acquire("chat-1"), 1000);
  now += 400;
  assert.equal(limiter.acquire("chat-1"), 600);
  // Отказ слот не занимает: ожидание не растёт от повторных вопросов
  assert.equal(limiter.acquire("chat-1"), 600);
  now += 600;
  assert.equal(limiter.acquire("chat-1"), 0);
});

test("разные чаты друг друга не ждут", () => {
  const limiter = createRateLimiter({ now: () => 5_000 });
  assert.equal(limiter.acquire("chat-1"), 0);
  assert.equal(limiter.acquire("chat-2"), 0);
});

test("на весь аккаунт — не больше 20 в минуту", () => {
  let now = 0;
  const limiter = createRateLimiter({ now: () => now });
  for (let index = 0; index < 20; index += 1) {
    assert.equal(limiter.acquire(`chat-${index}`), 0);
    now += 1000;
  }
  // 21-е — ждёт, пока из окна не выпадет самое первое (было в момент 0)
  assert.equal(limiter.acquire("chat-new"), 40_000);
  now = 60_000;
  assert.equal(limiter.acquire("chat-new"), 0);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/randomId.test.ts src/telegram/plan.test.ts src/telegram/payloads.test.ts src/util/rateLimit.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/randomId.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/randomId.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * random_id отправки — из id задания и номера части. Повтор того же задания
 * (аренда истекла, шлюз упал между отправкой и записью в журнал отправок)
 * шлёт ТОТ ЖЕ random_id, и Telegram вместо второго сообщения возвращает
 * первое: «a random_id already used … will simply return the messages
 * generated by the previous method call» (core.telegram.org/api/updates).
 *
 * Формулу менять НЕЛЬЗЯ: задание, выданное до обновления и повторённое после,
 * получило бы другой random_id — и клиент увидел бы сообщение дважды. Тест
 * держит контрольное значение.
 */
export const deriveRandomId = (jobId: string, part: number): bigint => {
  const digest = createHash("sha256").update(`hd-msg-gateway:${jobId}:${part}`).digest();
  const value = digest.readBigInt64BE(0);
  // 0 Telegram не примет (RANDOM_ID_EMPTY)
  return value === 0n ? 1n : value;
};
```

Create `msg-gateway/src/telegram/plan.ts`:

```ts
/**
 * Как ответ из HD ложится в сообщения Telegram. Текст в HD — до 20 000 знаков,
 * у Telegram — 4096 на сообщение и 1024 на подпись к файлу. Каждая часть —
 * отдельное сообщение со своим random_id (номер части входит в формулу).
 */
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;
const MB = 1024 * 1024;

export type SendAttachment = { name: string; originalName: string; mimetype: string; size: number };

export type SendPart =
  | { kind: "text"; text: string }
  | { kind: "file"; attachment: SendAttachment; caption: string };

const cutAt = (window: string, min: number): number => {
  for (const separator of ["\n\n", "\n", " "]) {
    const at = window.lastIndexOf(separator);
    if (at >= min) return at;
  }
  return -1;
};

/** Режем по абзацу, строке, пробелу; суррогатную пару (эмодзи) пополам не рвём. */
export const splitText = (text: string, limit = TEXT_LIMIT): string[] => {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = cutAt(rest.slice(0, limit), Math.floor(limit / 2));
    if (cut <= 0) {
      cut = limit;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
};

/**
 * Части ответа по порядку. Текст до 1024 знаков — подписью к первому файлу;
 * длиннее — отдельными сообщениями перед файлами.
 */
export const planParts = (text: string, attachments: SendAttachment[]): SendPart[] => {
  const body = text.trim();
  if (!attachments.length) return splitText(body).map((part) => ({ kind: "text", text: part }));
  const asCaption = body.length <= CAPTION_LIMIT;
  const texts: SendPart[] = asCaption ? [] : splitText(body).map((part) => ({ kind: "text", text: part }));
  const files: SendPart[] = attachments.map((attachment, index) => ({
    kind: "file",
    attachment,
    caption: asCaption && index === 0 ? body : "",
  }));
  return [...texts, ...files];
};

/** Фото — только привычные форматы до 10 МБ (предел Telegram), остальное — файлом. */
export const sendsAsPhoto = (mimetype: string, bytes: number): boolean =>
  ["image/jpeg", "image/png", "image/webp"].includes(mimetype.toLowerCase()) && bytes > 0 && bytes <= 10 * MB;
```

Create `msg-gateway/src/telegram/payloads.ts`:

```ts
import type { SendAttachment } from "./plan.ts";

/**
 * Полезные нагрузки заданий (docs/messaging.md, §5) — из `unknown` в типы.
 * Кривая нагрузка — null: такое задание закрывается отказом без повторов.
 */
const text = (raw: Record<string, unknown>, key: string): string => {
  const value = raw[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
};

export type SendPayload = { chatId: string; kind: "direct" | "group"; text: string; attachments: SendAttachment[] };

export const parseSend = (raw: Record<string, unknown>): SendPayload | null => {
  const chatId = text(raw, "chatId");
  if (!chatId) return null;
  const list = Array.isArray(raw.attachments) ? raw.attachments : [];
  const attachments: SendAttachment[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const name = text(entry, "name");
    if (!name) continue;
    attachments.push({
      name,
      originalName: text(entry, "originalName") || name,
      mimetype: text(entry, "mimetype") || "application/octet-stream",
      size: Number(entry.size) || 0,
    });
  }
  return { chatId, kind: raw.kind === "group" ? "group" : "direct", text: text(raw, "text"), attachments };
};

export const parseMarkRead = (raw: Record<string, unknown>): { chatId: string; maxId: number } | null => {
  const chatId = text(raw, "chatId");
  const maxId = Number(text(raw, "upToExternalId"));
  return chatId && Number.isInteger(maxId) && maxId > 0 ? { chatId, maxId } : null;
};

export const parseFetchMedia = (raw: Record<string, unknown>): { chatId: string; messageId: number } | null => {
  const chatId = text(raw, "chatId");
  const messageId = Number(text(raw, "externalId"));
  return chatId && Number.isInteger(messageId) && messageId > 0 ? { chatId, messageId } : null;
};

export type LoginStep = "start" | "phone" | "code" | "password";

export const parseLogin = (raw: Record<string, unknown>): { step: LoginStep; value: string } | null => {
  const step = text(raw, "step");
  if (step !== "start" && step !== "phone" && step !== "code" && step !== "password") return null;
  const value = text(raw, "value").trim();
  if (step !== "start" && !value) return null;
  return { step, value };
};

/** Глубина истории: 1–90 дней, по умолчанию 14 (как у backend/controllers/channel.js). */
export const parseDays = (raw: Record<string, unknown>): number => {
  const days = Math.round(Number(raw.days));
  return Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 14;
};
```

Create `msg-gateway/src/util/rateLimit.ts`:

```ts
/**
 * Темп отправки одного аккаунта: не чаще раза в `perChatMs` в один чат и не
 * больше `globalLimit` сообщений за `globalWindowMs` на весь аккаунт (Telegram:
 * 1/с на чат и 20/мин — спека, «Rate limits»). `acquire` либо сразу отдаёт
 * слот (0), либо говорит, сколько ждать, и слот НЕ занимает — вызывающий
 * решает, ждать ему или вернуть задание в очередь с паузой.
 */
export type RateLimiter = { acquire(key: string): number };

export type RateLimitOptions = {
  perChatMs?: number;
  globalLimit?: number;
  globalWindowMs?: number;
  now?: () => number;
};

export const createRateLimiter = ({
  perChatMs = 1000,
  globalLimit = 20,
  globalWindowMs = 60_000,
  now = Date.now,
}: RateLimitOptions = {}): RateLimiter => {
  const lastByKey = new Map<string, number>();
  const sent: number[] = [];

  return {
    acquire(key: string): number {
      const at = now();
      while (sent.length && sent[0]! <= at - globalWindowMs) sent.shift();
      const last = lastByKey.get(key);
      const chatWait = last === undefined ? 0 : Math.max(0, last + perChatMs - at);
      const globalWait = sent.length >= globalLimit ? sent[0]! + globalWindowMs - at : 0;
      const wait = Math.max(chatWait, globalWait);
      if (wait > 0) return wait;
      lastByKey.set(key, at);
      sent.push(at);
      // Старые чаты из памяти: отметка старше интервала уже ничего не ограничивает
      if (lastByKey.size > 1000) {
        for (const [chat, time] of lastByKey) if (time <= at - perChatMs) lastByKey.delete(chat);
      }
      return 0;
    },
  };
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/randomId.test.ts src/telegram/plan.test.ts src/telegram/payloads.test.ts src/util/rateLimit.test.ts`

Expected: PASS — summary `tests 15` · `pass 15` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 62` · `pass 62` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 8: Telegram errors and proxies

**Files:**
- Create: `msg-gateway/src/telegram/classify.ts`, `msg-gateway/src/telegram/proxy.ts`
- Test: `msg-gateway/src/telegram/classify.test.ts`, `msg-gateway/src/telegram/proxy.test.ts`

**Interfaces:**
- Consumes: `JobOutcome` (Task 3).
- Produces: `TgFailure = {kind: "flood"; retryAfterMs; error} | {kind: "session"; state: "loggedOut" | "banned" | "error"; error} | {kind: "permanent"; error} | {kind: "transient"; error}`, `class PermanentError`, `rpcNameOf(error): string | null`, `classifyTgError(error: unknown): TgFailure`, `outcomeOf(failure): JobOutcome`; `ProxyConfig = {kind: "socks"; ip; port; socksType: 4 | 5; username?; password?} | {kind: "mtproxy"; ip; port; secret}`, `class ProxyError`, `parseProxy(raw, password?): ProxyConfig | null`.

`classify.ts` reads errors by shape (`errorMessage`, `code`, `seconds`) and does not import GramJS; Task 9 checks the same shapes against real GramJS error objects.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/telegram/classify.test.ts`:

```ts
// node --test src/telegram/classify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyTgError, outcomeOf, PermanentError } from "./classify.ts";

const rpc = (errorMessage: string, code: number) => Object.assign(new Error(errorMessage), { errorMessage, code });

test("FLOOD_WAIT — пауза на столько секунд, сколько просит Telegram, и не попытка", () => {
  const failure = classifyTgError(Object.assign(new Error("FLOOD"), { errorMessage: "FLOOD", code: 420, seconds: 17 }));
  assert.deepEqual(failure, { kind: "flood", retryAfterMs: 17_000, error: "FLOOD_WAIT_17" });
  assert.deepEqual(outcomeOf(failure), { ok: false, retryable: true, retryAfterMs: 17_000, error: "FLOOD_WAIT_17" });
});

test("RANDOM_ID_DUPLICATE — то же сообщение ещё в полёте: короткая пауза", () => {
  assert.deepEqual(classifyTgError(rpc("RANDOM_ID_DUPLICATE", 500)), { kind: "flood", retryAfterMs: 5000, error: "RANDOM_ID_DUPLICATE" });
});

test("потеря сессии: выход на телефоне, бан, ключ в двух местах", () => {
  assert.deepEqual(classifyTgError(rpc("AUTH_KEY_UNREGISTERED", 401)), { kind: "session", state: "loggedOut", error: "AUTH_KEY_UNREGISTERED" });
  assert.deepEqual(classifyTgError(rpc("SESSION_REVOKED", 401)), { kind: "session", state: "loggedOut", error: "SESSION_REVOKED" });
  assert.deepEqual(classifyTgError(rpc("USER_DEACTIVATED_BAN", 401)), { kind: "session", state: "banned", error: "USER_DEACTIVATED_BAN" });
  assert.deepEqual(classifyTgError(rpc("AUTH_KEY_DUPLICATED", 406)), { kind: "session", state: "error", error: "AUTH_KEY_DUPLICATED" });
  assert.equal(classifyTgError(rpc("SOMETHING_NEW_UNAUTHORIZED", 401)).kind, "session");
});

test("бессмысленно повторять: блокировка, приватность, спам-ограничение, любой 400", () => {
  const blocked = classifyTgError(rpc("USER_IS_BLOCKED", 403));
  assert.deepEqual(blocked, { kind: "permanent", error: "Собеседник заблокировал аккаунт (USER_IS_BLOCKED)" });
  assert.deepEqual(outcomeOf(blocked), { ok: false, retryable: false, error: "Собеседник заблокировал аккаунт (USER_IS_BLOCKED)" });
  assert.equal(classifyTgError(rpc("PEER_FLOOD", 400)).kind, "permanent");
  assert.equal(classifyTgError(rpc("SOME_NEW_BAD_REQUEST", 400)).kind, "permanent");
  assert.deepEqual(classifyTgError(new PermanentError("Файл вложения не найден")), { kind: "permanent", error: "Файл вложения не найден" });
});

test("сеть и внутренние сбои Telegram — повторить позже", () => {
  assert.deepEqual(classifyTgError(new Error("Not connected")), { kind: "transient", error: "Not connected" });
  assert.equal(classifyTgError(rpc("RPC_CALL_FAIL", 500)).kind, "transient");
  assert.deepEqual(outcomeOf({ kind: "session", state: "loggedOut", error: "SESSION_REVOKED" }), {
    ok: false,
    retryable: true,
    error: "Сессия Telegram потеряна (SESSION_REVOKED)",
  });
});
```

Create `msg-gateway/src/telegram/proxy.test.ts`:

```ts
// node --test src/telegram/proxy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseProxy, ProxyError } from "./proxy.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

test("пусто — без прокси", () => {
  assert.equal(parseProxy(""), null);
  assert.equal(parseProxy("   "), null);
});

test("SOCKS5: логин из адреса, пароль из секрета канала", () => {
  assert.deepEqual(parseProxy("socks5://relay@10.0.0.5:1080", "p@ss"), {
    kind: "socks",
    ip: "10.0.0.5",
    port: 1080,
    socksType: 5,
    username: "relay",
    password: "p@ss",
  });
  assert.deepEqual(parseProxy("socks4://proxy.example.com:1081"), {
    kind: "socks",
    ip: "proxy.example.com",
    port: 1081,
    socksType: 4,
  });
});

test("MTProxy: адрес, ссылка tg:// и t.me, секрет dd…", () => {
  assert.deepEqual(parseProxy("mtproxy://mt.example.com:443", SECRET), { kind: "mtproxy", ip: "mt.example.com", port: 443, secret: SECRET });
  assert.deepEqual(parseProxy(`tg://proxy?server=1.2.3.4&port=8443&secret=dd${SECRET}`), {
    kind: "mtproxy",
    ip: "1.2.3.4",
    port: 8443,
    secret: `dd${SECRET}`,
  });
  assert.deepEqual(parseProxy(`https://t.me/proxy?server=1.2.3.4&port=443&secret=${SECRET}`), {
    kind: "mtproxy",
    ip: "1.2.3.4",
    port: 443,
    secret: SECRET,
  });
});

test("FakeTLS (ee…), кривой секрет, без порта, неизвестная схема — понятный отказ", () => {
  assert.throws(() => parseProxy(`tg://proxy?server=1.2.3.4&port=443&secret=ee${SECRET}676f6f676c652e636f6d`), /FakeTLS/);
  assert.throws(() => parseProxy("mtproxy://mt.example.com:443", "abcd"), /16 байт/);
  assert.throws(() => parseProxy("mtproxy://mt.example.com:443"), /секрет/);
  assert.throws(() => parseProxy("socks5://10.0.0.5"), /порт/);
  assert.throws(() => parseProxy("http://10.0.0.5:3128"), ProxyError);
  assert.throws(() => parseProxy("not a url"), ProxyError);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/classify.test.ts src/telegram/proxy.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/classify.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/classify.ts`:

```ts
import type { JobOutcome } from "../backend/types.ts";

/**
 * Ошибки Telegram → что делать. Разбор по форме (errorMessage, code,
 * seconds), без импорта GramJS: так же выглядят ошибки RPCError и
 * FloodWaitError библиотеки `telegram`.
 *
 * - flood — FLOOD_WAIT и родня: пауза, а не попытка (бэкенд переносит
 *   задание на retryAfterMs, backend/services/messaging/jobs.js);
 * - session — сессия потеряна (завершили на телефоне, бан, ключ используется
 *   где-то ещё): канал уходит в loggedOut / banned / error;
 * - permanent — повторять бессмысленно (клиент заблокировал аккаунт и т. п.);
 * - transient — сеть и сбои Telegram: повторить позже.
 */
export type TgFailure =
  | { kind: "flood"; retryAfterMs: number; error: string }
  | { kind: "session"; state: "loggedOut" | "banned" | "error"; error: string }
  | { kind: "permanent"; error: string }
  | { kind: "transient"; error: string };

/** Отказ, который мы распознали сами (файл вложения пропал и т. п.). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

const SESSION_LOST: Record<string, "loggedOut" | "banned" | "error"> = {
  AUTH_KEY_UNREGISTERED: "loggedOut",
  AUTH_KEY_INVALID: "loggedOut",
  AUTH_KEY_PERM_EMPTY: "loggedOut",
  SESSION_REVOKED: "loggedOut",
  SESSION_EXPIRED: "loggedOut",
  USER_DEACTIVATED: "banned",
  USER_DEACTIVATED_BAN: "banned",
  PHONE_NUMBER_BANNED: "banned",
  AUTH_KEY_DUPLICATED: "error",
};

const PERMANENT: Record<string, string> = {
  PEER_FLOOD: "Telegram ограничил аккаунт в отправке",
  USER_IS_BLOCKED: "Собеседник заблокировал аккаунт",
  YOU_BLOCKED_USER: "Аккаунт заблокировал собеседника",
  INPUT_USER_DEACTIVATED: "Аккаунт собеседника удалён",
  USER_PRIVACY_RESTRICTED: "Настройки приватности собеседника не позволяют написать",
  PRIVACY_PREMIUM_REQUIRED: "Собеседник принимает сообщения только от Premium",
  PEER_ID_INVALID: "Собеседник не найден в Telegram",
  CHAT_WRITE_FORBIDDEN: "Писать в этот чат нельзя",
  MESSAGE_TOO_LONG: "Сообщение слишком длинное",
  MESSAGE_EMPTY: "Пустое сообщение",
  MEDIA_CAPTION_TOO_LONG: "Подпись к файлу слишком длинная",
  MEDIA_INVALID: "Telegram не принял файл",
  PHOTO_INVALID_DIMENSIONS: "Telegram не принял фото",
  FILE_PARTS_INVALID: "Telegram не принял файл",
};

export const rpcNameOf = (error: unknown): string | null => {
  const name = (error as { errorMessage?: unknown } | null)?.errorMessage;
  return typeof name === "string" && name ? name : null;
};

export const classifyTgError = (error: unknown): TgFailure => {
  if (error instanceof PermanentError) return { kind: "permanent", error: error.message };
  const seconds = (error as { seconds?: unknown } | null)?.seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return { kind: "flood", retryAfterMs: Math.max(1, seconds) * 1000, error: `FLOOD_WAIT_${seconds}` };
  }
  const name = rpcNameOf(error);
  const code = (error as { code?: unknown } | null)?.code;
  // Такой random_id сейчас в полёте — подождать, повтор вернёт то же сообщение
  if (name === "RANDOM_ID_DUPLICATE") return { kind: "flood", retryAfterMs: 5000, error: name };
  if (name && name in SESSION_LOST) return { kind: "session", state: SESSION_LOST[name] ?? "loggedOut", error: name };
  if (name && name in PERMANENT) return { kind: "permanent", error: `${PERMANENT[name]} (${name})` };
  if (name && code === 401) return { kind: "session", state: "loggedOut", error: name };
  if (name && (code === 400 || code === 403 || code === 406)) return { kind: "permanent", error: name };
  return { kind: "transient", error: name ?? (error instanceof Error ? error.message : String(error)) };
};

/** Ошибка → итог задания для подтверждения бэкенду. */
export const outcomeOf = (failure: TgFailure): JobOutcome => {
  switch (failure.kind) {
    case "flood":
      return { ok: false, retryable: true, retryAfterMs: failure.retryAfterMs, error: failure.error };
    case "permanent":
      return { ok: false, retryable: false, error: failure.error };
    case "session":
      return { ok: false, retryable: true, error: `Сессия Telegram потеряна (${failure.error})` };
    default:
      return { ok: false, retryable: true, error: failure.error };
  }
};
```

Create `msg-gateway/src/telegram/proxy.ts`:

```ts
/**
 * Прокси канала (Channel.settings.proxyUrl + секрет proxyPassword). В РФ 2026
 * Telegram часто недоступен напрямую — шлюз ходит через SOCKS5 или MTProxy.
 *
 * Понимаем:
 * - socks5://[user[:password]@]host:port, socks4://host:port — пароль можно
 *   держать в секрете канала proxyPassword, а не в адресе;
 * - mtproxy://host:port (секрет — в proxyPassword или ?secret=…),
 *   tg://proxy?server=…&port=…&secret=…, https://t.me/proxy?server=…
 *
 * GramJS 2.26.22 знает MTProxy только с секретом 16 байт или «dd»+16 байт;
 * FakeTLS-секреты («ee…») не поддерживает — отказываем сразу и понятно.
 */
export type ProxyConfig =
  | { kind: "socks"; ip: string; port: number; socksType: 4 | 5; username?: string; password?: string }
  | { kind: "mtproxy"; ip: string; port: number; secret: string };

export class ProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyError";
  }
}

const portOf = (raw: string | null): number => {
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ProxyError("У прокси нужен порт 1–65535");
  return port;
};

const secretBytes = (secret: string): Buffer =>
  /^[0-9a-f]+$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : Buffer.from(secret.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const checkSecret = (secret: string): string => {
  const bytes = secretBytes(secret.trim());
  if (bytes[0] === 0xee) {
    throw new ProxyError("MTProxy с FakeTLS-секретом (ee…) шлюз не поддерживает — нужен секрет dd… или SOCKS5");
  }
  if (bytes.length === 16 || (bytes.length === 17 && bytes[0] === 0xdd)) return bytes.toString("hex");
  throw new ProxyError("Секрет MTProxy — 16 байт (32 hex-символа), можно с префиксом dd");
};

export const parseProxy = (raw: string, password = ""): ProxyConfig | null => {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProxyError("Адрес прокси не разобран — пример: socks5://user@host:1080");
  }
  const protocol = url.protocol.replace(/:$/, "").toLowerCase();

  if (protocol === "socks5" || protocol === "socks" || protocol === "socks4") {
    if (!url.hostname) throw new ProxyError("У SOCKS-прокси нужен хост");
    const username = decodeURIComponent(url.username);
    const pass = decodeURIComponent(url.password) || password;
    return {
      kind: "socks",
      ip: url.hostname,
      port: portOf(url.port),
      socksType: protocol === "socks4" ? 4 : 5,
      ...(username ? { username } : {}),
      ...(pass ? { password: pass } : {}),
    };
  }

  if (protocol === "mtproxy") {
    if (!url.hostname) throw new ProxyError("У MTProxy нужен хост");
    const secret = url.searchParams.get("secret") || password;
    if (!secret) throw new ProxyError("Для MTProxy нужен секрет — в адресе (?secret=) или в поле пароля прокси");
    return { kind: "mtproxy", ip: url.hostname, port: portOf(url.port), secret: checkSecret(secret) };
  }

  const isLink =
    (protocol === "tg" && url.hostname === "proxy") ||
    ((protocol === "https" || protocol === "http") && url.hostname === "t.me" && url.pathname === "/proxy");
  if (isLink) {
    const server = url.searchParams.get("server");
    const secret = url.searchParams.get("secret") || password;
    if (!server || !secret) throw new ProxyError("В ссылке MTProxy нужны server, port и secret");
    return { kind: "mtproxy", ip: server, port: portOf(url.searchParams.get("port")), secret: checkSecret(secret) };
  }

  throw new ProxyError(`Тип прокси «${protocol}» не поддерживается: socks5, socks4 или MTProxy`);
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/classify.test.ts src/telegram/proxy.test.ts`

Expected: PASS — summary `tests 9` · `pass 9` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 71` · `pass 71` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 9: The GramJS boundary

**Files:**
- Create: `msg-gateway/src/telegram/mtproto.ts`
- Test: `msg-gateway/src/telegram/mtproto.test.ts`

**Interfaces:**
- Consumes: `TgPort`, `TgPortEvents`, `PasswordNeeded`, DTO types (Task 6); `rpcNameOf`, `parseProxy`, `ProxyConfig` (Task 8); `GatewayChannel` (Task 3); `withTimeout`, `messageOf` (Task 1).
- Produces: `toGramProxy(proxy): ProxyInterface`; `toTgUser(entity: unknown): TgUser | null`; `toTgMedia(media, messageId): TgMedia | null`; `toTgMessage(message): TgMessage | null`; `sentMessageId(result: Api.TypeUpdates, randomId: bigint): number | null`; `wireEvents(client: TelegramClient, events: TgPortEvents): void`; `createGramPort({channelId, session, apiId, apiHash, proxy}): TgPort`; `makeGramPort({channel, session, probe?}): TgPort` — throws on a bad proxy URL, and on missing API id/hash unless `probe`.

This is the only module that imports `telegram`. Every other module works on the DTOs, so moving to `teleproto` later touches this file only. The test uses GramJS's internal `_handleUpdate` and `_selfInputPeer` on purpose: they are the dispatch path of the pinned 2.26.22, and the test proves our handlers receive what GramJS actually emits.

- [ ] **Step 1: Write the failing test**

Create `msg-gateway/src/telegram/mtproto.test.ts`:

```ts
// node --test src/telegram/mtproto.test.ts
// Граница с GramJS: настоящие объекты Api библиотеки, без сети.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Api, errors, helpers, Logger, TelegramClient } from "telegram";
import { _handleUpdate } from "telegram/client/updates.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import { UpdateConnectionState } from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

import { gatewayChannel } from "../testing/fixtures.ts";
import { sleep } from "../util/async.ts";
import { classifyTgError } from "./classify.ts";
import { makeGramPort, sentMessageId, toGramProxy, toTgMedia, toTgMessage, toTgUser, wireEvents } from "./mtproto.ts";

const big = helpers.returnBigInt;
const peer = new Api.PeerUser({ userId: big(5550001) });

test("пользователь Telegram → TgUser; «min»-хеш не храним", () => {
  const user = new Api.User({
    id: big(5550001),
    accessHash: big("-4242"),
    firstName: "Анна",
    lastName: "Петрова",
    username: "anna_p",
    phone: "79991234567",
  });
  assert.deepEqual(toTgUser(user), {
    id: "5550001",
    accessHash: "-4242",
    firstName: "Анна",
    lastName: "Петрова",
    username: "anna_p",
    phone: "79991234567",
    isBot: false,
    isSelf: false,
  });
  assert.equal(toTgUser(new Api.User({ id: big(1), accessHash: big(5), min: true }))?.accessHash, "");
  assert.equal(toTgUser(new Api.User({ id: big(2), bot: true }))?.isBot, true);
  assert.equal(toTgUser(new Api.UserEmpty({ id: big(3) })), null);
});

test("сообщение лички: чат, направление, ответ на сообщение; служебное — service", () => {
  const message = new Api.Message({
    id: 42,
    peerId: peer,
    date: 1_758_800_042,
    message: "Привет",
    out: true,
    replyTo: new Api.MessageReplyHeader({ replyToMsgId: 41 }),
  });
  assert.deepEqual(toTgMessage(message), {
    id: 42,
    chatId: "5550001",
    peerKind: "user",
    out: true,
    date: 1_758_800_042,
    editDate: null,
    text: "Привет",
    replyToId: 41,
    media: null,
    service: false,
  });
  const service = new Api.MessageService({ id: 43, peerId: peer, date: 1, action: new Api.MessageActionHistoryClear() });
  assert.equal(toTgMessage(service)?.service, true);
  const group = new Api.Message({ id: 44, peerId: new Api.PeerChat({ chatId: big(777) }), date: 1, message: "" });
  assert.deepEqual([toTgMessage(group)?.chatId, toTgMessage(group)?.peerKind], ["-777", "chat"]);
  const supergroup = new Api.Message({ id: 45, peerId: new Api.PeerChannel({ channelId: big(777) }), date: 1, message: "" });
  assert.deepEqual([toTgMessage(supergroup)?.chatId, toTgMessage(supergroup)?.peerKind], ["-100777", "channel"]);
});

test("медиа: фото по крупнейшему размеру, голосовое с длительностью, документ с именем, стикер, место, контакт", () => {
  const photo = new Api.MessageMediaPhoto({
    photo: new Api.Photo({
      id: big(1),
      accessHash: big(2),
      fileReference: Buffer.alloc(0),
      date: 1,
      dcId: 2,
      sizes: [
        new Api.PhotoSize({ type: "x", w: 800, h: 600, size: 51_200 }),
        new Api.PhotoSizeProgressive({ type: "y", w: 1280, h: 960, sizes: [1000, 90_000] }),
      ],
    }),
  });
  assert.deepEqual(toTgMedia(photo, 7), { kind: "photo", fileName: "photo-7.jpg", mimetype: "image/jpeg", size: 90_000, durationSec: null });

  const document = (mimeType: string, attributes: Api.TypeDocumentAttribute[]) =>
    new Api.MessageMediaDocument({
      document: new Api.Document({ id: big(1), accessHash: big(2), fileReference: Buffer.alloc(0), date: 1, mimeType, size: big(12_345), dcId: 2, attributes }),
    });
  assert.deepEqual(toTgMedia(document("audio/ogg", [new Api.DocumentAttributeAudio({ voice: true, duration: 12 })]), 8), {
    kind: "voice",
    fileName: "voice-8.ogg",
    mimetype: "audio/ogg",
    size: 12_345,
    durationSec: 12,
  });
  assert.deepEqual(toTgMedia(document("application/pdf", [new Api.DocumentAttributeFilename({ fileName: "акт.pdf" })]), 9), {
    kind: "document",
    fileName: "акт.pdf",
    mimetype: "application/pdf",
    size: 12_345,
    durationSec: null,
  });
  assert.deepEqual(
    toTgMedia(document("image/webp", [new Api.DocumentAttributeSticker({ alt: "🙂", stickerset: new Api.InputStickerSetEmpty() })]), 10),
    { kind: "sticker" },
  );
  assert.deepEqual(
    toTgMedia(new Api.MessageMediaGeo({ geo: new Api.GeoPoint({ lat: 55.7558, long: 37.6173, accessHash: big(0) }) }), 11),
    { kind: "location", text: "55.755800, 37.617300" },
  );
  assert.deepEqual(
    toTgMedia(new Api.MessageMediaContact({ phoneNumber: "79990001122", firstName: "Иван", lastName: "", vcard: "", userId: big(0) }), 12),
    { kind: "contact", text: "Иван, +79990001122" },
  );
  assert.equal(toTgMedia(new Api.MessageMediaEmpty(), 13), null);
});

test("id отправленного: короткий ответ, полный ответ по нашему random_id, иначе null", () => {
  assert.equal(sentMessageId(new Api.UpdateShortSentMessage({ id: 501, pts: 1, ptsCount: 1, date: 1 }), 7n), 501);
  const updates = new Api.Updates({
    updates: [
      new Api.UpdateMessageID({ id: 600, randomId: big(-5n) }),
      new Api.UpdateMessageID({ id: 601, randomId: big(7n) }),
    ],
    users: [],
    chats: [],
    date: 1,
    seq: 0,
  });
  assert.equal(sentMessageId(updates, 7n), 601);
  assert.equal(sentMessageId(new Api.UpdatesTooLong(), 7n), null);
});

test("настоящие ошибки GramJS разбираются так же, как их формы в classify.test.ts", () => {
  const request = new Api.updates.GetState();
  const flood = new errors.FloodWaitError({ request, capture: 30 });
  assert.deepEqual(classifyTgError(flood), { kind: "flood", retryAfterMs: 30_000, error: "FLOOD_WAIT_30" });
  const blocked = new errors.RPCError("USER_IS_BLOCKED", request, 403);
  assert.equal(classifyTgError(blocked).kind, "permanent");
  const revoked = new errors.RPCError("AUTH_KEY_UNREGISTERED", request, 401);
  assert.deepEqual(classifyTgError(revoked), { kind: "session", state: "loggedOut", error: "AUTH_KEY_UNREGISTERED" });
});

test("прокси → параметры GramJS; без api_id канал не подключается, проверка прокси — может", () => {
  assert.deepEqual(toGramProxy({ kind: "socks", ip: "10.0.0.5", port: 1080, socksType: 5, username: "u", password: "p" }), {
    ip: "10.0.0.5",
    port: 1080,
    socksType: 5,
    timeout: 10,
    username: "u",
    password: "p",
  });
  assert.deepEqual(toGramProxy({ kind: "mtproxy", ip: "1.2.3.4", port: 443, secret: "dd0123456789abcdef0123456789abcdef" }), {
    ip: "1.2.3.4",
    port: 443,
    secret: "dd0123456789abcdef0123456789abcdef",
    MTProxy: true,
    timeout: 10,
  });
  const empty = gatewayChannel({ secrets: { tgApiId: "", tgApiHash: "", proxyPassword: "" } });
  assert.throws(() => makeGramPort({ channel: empty, session: "" }), /api_id/);
  assert.equal(typeof makeGramPort({ channel: empty, session: "", probe: true }).connect, "function");
  assert.throws(
    () => makeGramPort({ channel: gatewayChannel({ settings: { ...gatewayChannel().settings, proxyUrl: "ftp://x:1" } }), session: "" }),
    /не поддерживается/,
  );
});

test("обновления GramJS доходят до шлюза: новое полное и короткое, правка, удаление, прочтение, связь", async () => {
  const client = new TelegramClient(new StringSession(""), 1, "x", { baseLogger: new Logger(LogLevel.NONE), connectionRetries: 1 });
  // Как после getMe(): без своего id GramJS не соберёт короткое исходящее
  (client as unknown as { _selfInputPeer: Api.InputPeerUser })._selfInputPeer = new Api.InputPeerUser({ userId: big(100), accessHash: big(1) });
  const seen: string[] = [];
  wireEvents(client, {
    message: (item) => void seen.push(`new:${item.message.id}:${item.message.out}:${item.peer?.firstName ?? "-"}`),
    edited: (item) => void seen.push(`edit:${item.message.id}:${item.message.editDate}`),
    deleted: (ids, inChannel) => void seen.push(`del:${ids.join(",")}:${inChannel}`),
    readOutbox: (chatId, kind, maxId) => void seen.push(`read:${chatId}:${kind}:${maxId}`),
    connection: (state) => void seen.push(`conn:${state}`),
  });
  // Типы внутреннего _handleUpdate уже, чем он принимает на деле (Updates, UpdateShort…)
  const feed = (update: unknown): void => _handleUpdate(client, update as Api.TypeUpdate);
  const anna = new Api.User({ id: big(5550001), accessHash: big(99), firstName: "Анна" });
  feed(new Api.Updates({
    updates: [new Api.UpdateNewMessage({ message: new Api.Message({ id: 10, peerId: peer, date: 1, message: "полное" }), pts: 1, ptsCount: 1 })],
    users: [anna],
    chats: [],
    date: 1,
    seq: 0,
  }));
  // Короткое обновление (набрано на телефоне) — без сущностей; без сети собеседник неизвестен
  feed(new Api.UpdateShortMessage({ id: 11, userId: big(5550001), message: "с телефона", pts: 2, ptsCount: 1, date: 2, out: true }));
  feed(new Api.UpdateShort({
    update: new Api.UpdateEditMessage({ message: new Api.Message({ id: 10, peerId: peer, date: 1, message: "исправлено", editDate: 5 }), pts: 3, ptsCount: 1 }),
    date: 5,
  }));
  feed(new Api.UpdateShort({ update: new Api.UpdateDeleteMessages({ messages: [10, 11], pts: 4, ptsCount: 2 }), date: 6 }));
  feed(new Api.UpdateShort({ update: new Api.UpdateReadHistoryOutbox({ peer, maxId: 11, pts: 5, ptsCount: 1 }), date: 7 }));
  feed(new UpdateConnectionState(UpdateConnectionState.connected));
  await sleep(200);
  assert.deepEqual(seen.sort(), [
    "conn:connected",
    "del:10,11:false",
    "edit:10:5",
    "new:10:false:Анна",
    "new:11:true:-",
    "read:5550001:user:11",
  ]);
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/mtproto.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/mtproto.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/mtproto.ts`:

```ts
import { Api, helpers, Logger, TelegramClient, utils } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { DeletedMessage, type DeletedMessageEvent } from "telegram/events/DeletedMessage.js";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage.js";
import { NewMessage, type NewMessageEvent, Raw } from "telegram/events/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import type { ProxyInterface } from "telegram/network/connection/TCPMTProxy.js";
import { UpdateConnectionState } from "telegram/network/index.js";
import { StringSession } from "telegram/sessions/index.js";

import type { GatewayChannel } from "../backend/types.ts";
import { logger } from "../logger.ts";
import { messageOf, withTimeout } from "../util/async.ts";
import { rpcNameOf } from "./classify.ts";
import { PasswordNeeded, type TgPort, type TgPortEvents } from "./port.ts";
import { parseProxy, type ProxyConfig } from "./proxy.ts";
import type { InputPeer, TgDialog, TgItem, TgMedia, TgMessage, TgPeerKind, TgUser } from "./types.ts";

/**
 * ЕДИНСТВЕННЫЙ модуль, который импортирует GramJS (npm `telegram`, 2.26.22,
 * слой 198). Пакет в архиве с 2026-07; продолжение — форк `teleproto`.
 * Переезд, если понадобится, — этот файл и package.json.
 *
 * Проверено по исходникам 2.26.22:
 * - результаты собственных запросов в обработчики событий не попадают
 *   (MTProtoSender отдаёт их только вызвавшему) — эхо своих отправок шлюз
 *   узнаёт по ответу и журналу отправок, а не по NewMessage;
 * - catchUp — заглушка: пропуски догоняет telegram/sync.ts;
 * - floodSleepThreshold 0: любой FLOOD_WAIT отдаётся нам, а не пересыпается
 *   внутри запроса, пока истекает аренда задания.
 */

const MB = 1024 * 1024;

export const toGramProxy = (proxy: ProxyConfig): ProxyInterface =>
  proxy.kind === "socks"
    ? {
        ip: proxy.ip,
        port: proxy.port,
        socksType: proxy.socksType,
        timeout: 10,
        ...(proxy.username ? { username: proxy.username } : {}),
        ...(proxy.password ? { password: proxy.password } : {}),
      }
    : { ip: proxy.ip, port: proxy.port, secret: proxy.secret, MTProxy: true, timeout: 10 };

const peerKindOf = (peer: Api.TypePeer): TgPeerKind =>
  peer instanceof Api.PeerUser ? "user" : peer instanceof Api.PeerChannel ? "channel" : "chat";

/** Сущность GramJS → TgUser; не пользователь (группа, канал, пусто) — null. */
export const toTgUser = (user: unknown): TgUser | null => {
  if (!(user instanceof Api.User)) return null;
  return {
    id: user.id.toString(),
    // «min»-хеш писать не позволяет — такой не храним
    accessHash: user.min || !user.accessHash ? "" : user.accessHash.toString(),
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    username: user.username ?? user.usernames?.[0]?.username ?? "",
    phone: user.phone ?? "",
    isBot: Boolean(user.bot),
    isSelf: Boolean(user.self),
  };
};

const largestPhoto = (sizes: Api.TypePhotoSize[]): number =>
  sizes.reduce((max, size) => {
    if (size instanceof Api.PhotoSize) return Math.max(max, size.size);
    if (size instanceof Api.PhotoSizeProgressive) return Math.max(max, ...size.sizes);
    return max;
  }, 0);

export const toTgMedia = (media: Api.TypeMessageMedia | undefined, messageId: number): TgMedia | null => {
  if (!media || media instanceof Api.MessageMediaEmpty || media instanceof Api.MessageMediaWebPage) return null;
  if (media instanceof Api.MessageMediaPhoto) {
    const size = media.photo instanceof Api.Photo ? largestPhoto(media.photo.sizes) : 0;
    return { kind: "photo", fileName: `photo-${messageId}.jpg`, mimetype: "image/jpeg", size, durationSec: null };
  }
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (!(doc instanceof Api.Document)) return { kind: "other" };
    const attributes = doc.attributes;
    if (attributes.some((item) => item instanceof Api.DocumentAttributeSticker)) return { kind: "sticker" };
    const named = attributes.find((item): item is Api.DocumentAttributeFilename => item instanceof Api.DocumentAttributeFilename);
    const audio = attributes.find((item): item is Api.DocumentAttributeAudio => item instanceof Api.DocumentAttributeAudio);
    const video = attributes.find((item): item is Api.DocumentAttributeVideo => item instanceof Api.DocumentAttributeVideo);
    const mimetype = doc.mimeType || "application/octet-stream";
    const size = Number(doc.size.toString());
    const fileName = named?.fileName ?? "";
    if (audio?.voice) return { kind: "voice", fileName: fileName || `voice-${messageId}.ogg`, mimetype, size, durationSec: audio.duration };
    if (audio) return { kind: "audio", fileName: fileName || `audio-${messageId}`, mimetype, size, durationSec: audio.duration };
    if (video || attributes.some((item) => item instanceof Api.DocumentAttributeAnimated)) {
      return { kind: "video", fileName: fileName || `video-${messageId}.mp4`, mimetype, size, durationSec: video ? Math.round(video.duration) : null };
    }
    return { kind: "document", fileName: fileName || `file-${messageId}`, mimetype, size, durationSec: null };
  }
  if (media instanceof Api.MessageMediaVenue) {
    return { kind: "location", text: [media.title, media.address].filter(Boolean).join(", ") };
  }
  if (media instanceof Api.MessageMediaGeo || media instanceof Api.MessageMediaGeoLive) {
    const geo = media.geo;
    return { kind: "location", text: geo instanceof Api.GeoPoint ? `${geo.lat.toFixed(6)}, ${geo.long.toFixed(6)}` : "" };
  }
  if (media instanceof Api.MessageMediaContact) {
    const name = [media.firstName, media.lastName].filter(Boolean).join(" ");
    const digits = media.phoneNumber.replace(/\D/g, "");
    return { kind: "contact", text: [name, digits ? `+${digits}` : ""].filter(Boolean).join(", ") };
  }
  return { kind: "other" };
};

export const toTgMessage = (message: Api.TypeMessage): TgMessage | null => {
  if (!(message instanceof Api.Message) && !(message instanceof Api.MessageService)) return null;
  const base = {
    id: message.id,
    chatId: utils.getPeerId(message.peerId),
    peerKind: peerKindOf(message.peerId),
    out: Boolean(message.out),
    date: message.date,
  };
  if (message instanceof Api.MessageService) {
    return { ...base, editDate: null, text: "", replyToId: null, media: null, service: true };
  }
  const reply = message.replyTo;
  return {
    ...base,
    editDate: message.editDate ?? null,
    text: message.message ?? "",
    replyToId: reply instanceof Api.MessageReplyHeader && reply.replyToMsgId && !reply.replyToPeerId ? reply.replyToMsgId : null,
    media: toTgMedia(message.media, message.id),
    service: false,
  };
};

/** id нашего сообщения из ответа на SendMessage/SendMedia — по нашему random_id. */
export const sentMessageId = (result: Api.TypeUpdates, randomId: bigint): number | null => {
  if (result instanceof Api.UpdateShortSentMessage) return result.id;
  if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
    const wanted = randomId.toString();
    for (const update of result.updates) {
      if (update instanceof Api.UpdateMessageID && update.randomId?.toString() === wanted) return update.id;
    }
    for (const update of result.updates) {
      if (update instanceof Api.UpdateNewMessage && update.message instanceof Api.Message) return update.message.id;
    }
  }
  return null;
};

const itemOf = (message: Api.TypeMessage, peer: TgUser | null): TgItem | null => {
  const dto = toTgMessage(message);
  return dto ? { message: dto, peer, handle: message } : null;
};

/** Собеседник лички: из сущностей обновления, иначе — запросом (не дольше 15 с). */
const peerUser = async (message: Api.Message): Promise<TgUser | null> => {
  if (!(message.peerId instanceof Api.PeerUser)) return null;
  const cached = toTgUser(message.chat);
  if (cached) return cached;
  try {
    return toTgUser(await withTimeout(message.getChat(), 15_000, "getChat timeout"));
  } catch {
    return null;
  }
};

/**
 * Подписка на обновления клиента. GramJS зовёт обработчики без await
 * (client/updates.js, _processUpdate) — ошибки внутри ловит main.ts
 * (unhandledRejection). Короткое исходящее GramJS собирает только при
 * известном своём id: порт зовёт getMe() до подписки (me, вход).
 */
export const wireEvents = (client: TelegramClient, events: TgPortEvents): void => {
  const withPeer = (handler: (item: TgItem) => void) => async (event: NewMessageEvent | EditedMessageEvent) => {
    const item = itemOf(event.message, await peerUser(event.message));
    if (item) handler(item);
  };
  client.addEventHandler(withPeer(events.message), new NewMessage({}));
  client.addEventHandler(withPeer(events.edited), new EditedMessage({}));
  client.addEventHandler((event: DeletedMessageEvent) => events.deleted(event.deletedIds, event.peer !== undefined), new DeletedMessage({}));
  client.addEventHandler(
    (update: Api.UpdateReadHistoryOutbox) => events.readOutbox(utils.getPeerId(update.peer), peerKindOf(update.peer), update.maxId),
    new Raw({ types: [Api.UpdateReadHistoryOutbox] }),
  );
  client.addEventHandler(
    (update: UpdateConnectionState) =>
      events.connection(
        update.state === UpdateConnectionState.connected ? "connected" : update.state === UpdateConnectionState.broken ? "broken" : "disconnected",
      ),
    new Raw({ types: [UpdateConnectionState] }),
  );
};

export type GramPortOptions = {
  channelId: string;
  session: string;
  apiId: number;
  apiHash: string;
  proxy: ProxyConfig | null;
};

export const createGramPort = (options: GramPortOptions): TgPort => {
  const session = new StringSession(options.session);
  const client = new TelegramClient(session, options.apiId, options.apiHash, {
    connectionRetries: 3,
    retryDelay: 2000,
    requestRetries: 3,
    autoReconnect: true,
    floodSleepThreshold: 0,
    deviceModel: "HD msg-gateway",
    systemVersion: "Linux",
    appVersion: "1.0",
    langCode: "ru",
    systemLangCode: "ru",
    useWSS: false,
    // Журнал GramJS молчит: ошибки приходят в onError и пишутся нашим JSON без текстов сообщений
    baseLogger: new Logger(LogLevel.NONE),
    ...(options.proxy ? { proxy: toGramProxy(options.proxy) } : {}),
  });
  client.onError = async (error: Error) => {
    logger.warn("GramJS error", { channelId: options.channelId, error: messageOf(error) });
  };

  const inputPeer = (peer: InputPeer) =>
    new Api.InputPeerUser({ userId: helpers.returnBigInt(peer.userId), accessHash: helpers.returnBigInt(peer.accessHash || "0") });

  /** Аккаунт после входа — через getMe(): заодно GramJS запоминает свой id. */
  const self = async (): Promise<TgUser> => {
    const me = toTgUser(await client.getMe());
    if (!me) throw new Error("Telegram не вернул аккаунт");
    return me;
  };
  const password = async (hint?: string): Promise<string> => {
    throw new PasswordNeeded(hint ?? "");
  };
  const rethrow = async (error: Error): Promise<boolean> => {
    throw error;
  };

  return {
    async connect() {
      try {
        return await client.connect();
      } catch (error) {
        if (rpcNameOf(error)) throw error;
        logger.warn("Telegram connect error", { channelId: options.channelId, error: messageOf(error) });
        return false;
      }
    },
    async destroy() {
      await client.destroy();
    },
    saveSession: () => session.save(),
    async ping() {
      await client.invoke(new Api.updates.GetState());
    },
    me: self,
    listen(events) {
      wireEvents(client, events);
    },
    async sendText(peer, text, randomId) {
      const result = await client.invoke(
        new Api.messages.SendMessage({ peer: inputPeer(peer), message: text, randomId: helpers.returnBigInt(randomId) }),
      );
      return sentMessageId(result, randomId);
    },
    async sendFile(peer, file, caption, randomId) {
      const uploaded = await client.uploadFile({ file: new CustomFile(file.name, file.buffer.length, "", file.buffer), workers: 2 });
      const media = file.asPhoto
        ? new Api.InputMediaUploadedPhoto({ file: uploaded })
        : new Api.InputMediaUploadedDocument({
            file: uploaded,
            mimeType: file.mimetype || "application/octet-stream",
            attributes: [new Api.DocumentAttributeFilename({ fileName: file.name })],
          });
      const result = await client.invoke(
        new Api.messages.SendMedia({ peer: inputPeer(peer), media, message: caption, randomId: helpers.returnBigInt(randomId) }),
      );
      return sentMessageId(result, randomId);
    },
    async readHistory(peer, maxId) {
      await client.invoke(new Api.messages.ReadHistory({ peer: inputPeer(peer), maxId }));
    },
    async dialogs(limit) {
      const list = await client.getDialogs({ limit });
      return list.map(
        (dialog): TgDialog => ({
          chatId: dialog.id?.toString() ?? "",
          peerKind: dialog.isUser ? "user" : dialog.entity instanceof Api.Channel ? "channel" : "chat",
          user: toTgUser(dialog.entity),
          topId: dialog.message?.id ?? 0,
          topDate: dialog.message?.date ?? dialog.date ?? 0,
        }),
      );
    },
    async historyAfter(peer, minId, limit) {
      const out: TgItem[] = [];
      for await (const message of client.iterMessages(inputPeer(peer), { minId, reverse: true, limit })) {
        const item = itemOf(message, null);
        if (item) out.push(item);
      }
      return out;
    },
    async historySince(peer, sinceUnix, limit) {
      const out: TgItem[] = [];
      for await (const message of client.iterMessages(inputPeer(peer), { limit })) {
        if (message.date < sinceUnix) break;
        const item = itemOf(message, null);
        if (item) out.push(item);
      }
      return out.reverse();
    },
    async messageById(peer, id) {
      const [message] = await client.getMessages(inputPeer(peer), { ids: [id] });
      return message ? itemOf(message, null) : null;
    },
    async download(handle, maxBytes) {
      if (!(handle instanceof Api.Message)) throw new Error("Нет сообщения для скачивания");
      const data = await client.downloadMedia(handle, {});
      if (!Buffer.isBuffer(data)) throw new Error("Telegram не отдал файл");
      if (data.length > maxBytes) throw new Error(`Файл больше ${Math.round(maxBytes / MB)} МБ`);
      return data;
    },
    async qrLogin(onQr) {
      await client.signInUserWithQrCode(
        { apiId: options.apiId, apiHash: options.apiHash },
        {
          qrCode: async ({ token, expires }) => onQr(`tg://login?token=${token.toString("base64url")}`, new Date(expires * 1000)),
          password,
          onError: rethrow,
        },
      );
      return self();
    },
    async sendCode(phone) {
      const { phoneCodeHash } = await client.sendCode({ apiId: options.apiId, apiHash: options.apiHash }, phone);
      return { phoneCodeHash };
    },
    async signIn(phone, phoneCodeHash, code) {
      try {
        const result = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
        if (result instanceof Api.auth.AuthorizationSignUpRequired) throw new Error("Номер не зарегистрирован в Telegram");
        return await self();
      } catch (error) {
        if (rpcNameOf(error) !== "SESSION_PASSWORD_NEEDED") throw error;
        const state = await client.invoke(new Api.account.GetPassword()).catch(() => null);
        throw new PasswordNeeded(state?.hint ?? "");
      }
    },
    async checkPassword(value) {
      await client.signInWithPassword({ apiId: options.apiId, apiHash: options.apiHash }, { password: async () => value, onError: rethrow });
      return self();
    },
    async logOut() {
      await client.invoke(new Api.auth.LogOut());
    },
  };
};

/**
 * Клиент канала по его настройкам. Проверка прокси (probe) обходится без
 * ключей API: любой ответ Telegram уже доказывает связь.
 */
export const makeGramPort = ({ channel, session, probe = false }: { channel: GatewayChannel; session: string; probe?: boolean }): TgPort => {
  const apiId = Number(channel.secrets.tgApiId);
  const apiHash = channel.secrets.tgApiHash;
  if (!probe && (!Number.isInteger(apiId) || apiId <= 0 || !apiHash)) {
    throw new Error("Не заданы api_id и api_hash канала (my.telegram.org)");
  }
  return createGramPort({
    channelId: channel.id,
    session,
    apiId: Number.isInteger(apiId) && apiId > 0 ? apiId : 1,
    apiHash: apiHash || "0",
    proxy: parseProxy(channel.settings.proxyUrl, channel.secrets.proxyPassword),
  });
};
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/mtproto.test.ts`

Expected: PASS — summary `tests 7` · `pass 7` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 78` · `pass 78` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 10: Send journal, chat state and the send job

**Files:**
- Create: `msg-gateway/src/store/sent.ts`, `msg-gateway/src/store/chats.ts`, `msg-gateway/src/telegram/tracker.ts`, `msg-gateway/src/testing/fakePort.ts`, `msg-gateway/src/telegram/sender.ts`
- Test: `msg-gateway/src/store/state.test.ts`, `msg-gateway/src/telegram/tracker.test.ts`, `msg-gateway/src/telegram/sender.test.ts`

**Interfaces:**
- Consumes: `openDatabase` (Task 2); `BackendError`, `GatewayJob`, `JobOutcome` (Task 3); `TgPort`, `SendFile`, `TgUser`, `InputPeer` (Task 6); `deriveRandomId`, `planParts`, `sendsAsPhoto`, `SendPayload`, `RateLimiter` (Task 7); `classifyTgError`, `outcomeOf`, `PermanentError`, `TgFailure` (Task 8).
- Produces: `createSentStore(db): SentStore` — `{begin(jobId, channelId, chatId): SentState; recordPart(jobId, part, randomId: bigint, messageId: number); finish(jobId); ownJobOf(channelId, chatId, messageId): string | null; unfinishedSince(channelId, chatId, since: number): boolean; prune(olderThanMs, now?): number}`, `SentState = {state: "sending" | "done"; parts: Map<number, number>}`; `createChatStore(db): ChatStore` — `{peer(channelId, userId); rememberPeer(channelId, user); top(channelId, chatId): number | null; advance(channelId, chatId, messageId); addOutgoing(channelId, chatId, messageId, jobId | null); takeRead(channelId, chatId, maxId): {messageId, jobId}[]; aliveAt(channelId); touchAlive(channelId, at); baselineDone(channelId); markBaseline(channelId, at); bindAccount(channelId, accountId): "same" | "changed"; prune(olderThanMs, now?)}`; `createTracker(): OutboundTracker` — `{begin(chatId); end(chatId); settled(chatId, maxWaitMs = 30000): Promise<void>}`; `createFakePort(overrides?): FakePort`; `MAX_WAIT_MS = 20000`, `SenderDeps = {channelId, port, sent, chats, limiter, tracker, resolvePeer, downloadMedia, onSessionLost, sleep?}`, `runSend(job, payload, deps): Promise<JobOutcome>`.

Order inside `runSend` and why (§ «Outbound» of the spec): `sent.begin` (a `done` row answers from the record — nothing goes to Telegram) → pace → send the part with `deriveRandomId(job.id, part)` → `recordPart` → … → `finish` → ack. The fake port reproduces Telegram's random_id rule, so the «kill -9» test shows a re-sent part returning the first message instead of a second one.

- [ ] **Step 1: Write the failing tests** (with the in-memory Telegram)

Create `msg-gateway/src/testing/fakePort.ts`:

```ts
import type { SendFile, TgPort, TgPortEvents } from "../telegram/port.ts";
import type { InputPeer, TgDialog, TgItem, TgUser } from "../telegram/types.ts";
import { SELF_ID, tgUser } from "./fixtures.ts";

/**
 * Telegram в памяти — для тестов. Главное свойство настоящего повторено:
 * тот же random_id возвращает то же сообщение и второй раз ничего не
 * доставляет (core.telegram.org/api/updates, random_id deduplication).
 */
export type Delivered = { peer: string; text: string; file: string | null; randomId: bigint; messageId: number };

export type FakePort = TgPort & {
  delivered: Delivered[];
  handlers: TgPortEvents | null;
  dialogList: TgDialog[];
  history: Map<string, TgItem[]>;
  files: Map<number, Buffer>;
  failNextSend: unknown;
  connected: boolean;
  destroyed: boolean;
  session: string;
};

export const createFakePort = (overrides: Partial<TgPort> = {}): FakePort => {
  const byRandomId = new Map<string, number>();
  let nextId = 1000;

  const deliver = (peer: InputPeer, text: string, file: string | null, randomId: bigint): number => {
    if (port.failNextSend) {
      const error = port.failNextSend;
      port.failNextSend = null;
      throw error;
    }
    const known = byRandomId.get(randomId.toString());
    if (known !== undefined) return known;
    nextId += 1;
    byRandomId.set(randomId.toString(), nextId);
    port.delivered.push({ peer: peer.userId, text, file, randomId, messageId: nextId });
    return nextId;
  };

  const port: FakePort = {
    delivered: [],
    handlers: null,
    dialogList: [],
    history: new Map(),
    files: new Map(),
    failNextSend: null,
    connected: false,
    destroyed: false,
    session: "fake-session",

    async connect() {
      port.connected = true;
      return true;
    },
    async destroy() {
      port.destroyed = true;
    },
    saveSession: () => port.session,
    async ping() {},
    async me(): Promise<TgUser> {
      return tgUser(SELF_ID, { firstName: "Поддержка", lastName: "F1Lab", username: "f1lab", phone: "79990000000", isSelf: true });
    },
    listen(events) {
      port.handlers = events;
    },
    async sendText(peer, text, randomId) {
      return deliver(peer, text, null, randomId);
    },
    async sendFile(peer, file: SendFile, caption, randomId) {
      return deliver(peer, caption, `${file.name}:${file.asPhoto ? "photo" : "document"}`, randomId);
    },
    async readHistory() {},
    async dialogs(limit) {
      return port.dialogList.slice(0, limit);
    },
    async historyAfter(peer, minId, limit) {
      return (port.history.get(peer.userId) ?? []).filter((item) => item.message.id > minId).slice(0, limit);
    },
    async historySince(peer, sinceUnix, limit) {
      return (port.history.get(peer.userId) ?? []).filter((item) => item.message.date >= sinceUnix).slice(-limit);
    },
    async messageById(peer, id) {
      return (port.history.get(peer.userId) ?? []).find((item) => item.message.id === id) ?? null;
    },
    async download(handle) {
      const id = (handle as { id?: number } | null)?.id ?? 0;
      const data = port.files.get(id);
      if (!data) throw new Error("no file");
      return data;
    },
    async qrLogin() {
      throw new Error("qrLogin not scripted");
    },
    async sendCode() {
      return { phoneCodeHash: "hash-1" };
    },
    async signIn() {
      return port.me();
    },
    async checkPassword() {
      return port.me();
    },
    async logOut() {},
    ...overrides,
  };
  return port;
};
```

Create `msg-gateway/src/store/state.test.ts`:

```ts
// node --test src/store/state.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { tgUser } from "../testing/fixtures.ts";
import { createChatStore } from "./chats.ts";
import { openDatabase } from "./db.ts";
import { createSentStore } from "./sent.ts";

const C = "64f600000000000000000001";

test("журнал отправок: begin идемпотентен, части копятся, done после finish", () => {
  const sent = createSentStore(openDatabase(":memory:"));
  assert.deepEqual(sent.begin("job-1", C, "555"), { state: "sending", parts: new Map() });
  sent.recordPart("job-1", 0, 123n, 900);
  sent.recordPart("job-1", 0, 123n, 900);
  assert.deepEqual(sent.begin("job-1", C, "555"), { state: "sending", parts: new Map([[0, 900]]) });
  sent.finish("job-1");
  assert.equal(sent.begin("job-1", C, "555").state, "done");
  assert.equal(sent.ownJobOf(C, "555", 900), "job-1");
  assert.equal(sent.ownJobOf(C, "556", 900), null);
});

test("незаконченная отправка в чате видна проверке пропусков", () => {
  const sent = createSentStore(openDatabase(":memory:"));
  sent.begin("job-2", C, "555");
  assert.equal(sent.unfinishedSince(C, "555", Date.now() - 60_000), true);
  assert.equal(sent.unfinishedSince(C, "777", Date.now() - 60_000), false);
  sent.finish("job-2");
  assert.equal(sent.unfinishedSince(C, "555", Date.now() - 60_000), false);
  assert.equal(sent.prune(1000, Date.now() + 10_000), 1);
  assert.equal(sent.ownJobOf(C, "555", 900), null);
});

test("водяной знак только растёт; прочтение отдаёт каждое исходящее один раз", () => {
  const chats = createChatStore(openDatabase(":memory:"));
  assert.equal(chats.top(C, "555"), null);
  chats.advance(C, "555", 10);
  chats.advance(C, "555", 7);
  assert.equal(chats.top(C, "555"), 10);
  chats.addOutgoing(C, "555", 11, "job-1");
  chats.addOutgoing(C, "555", 12, null);
  chats.addOutgoing(C, "555", 14, null);
  assert.deepEqual(chats.takeRead(C, "555", 12), [
    { messageId: 11, jobId: "job-1" },
    { messageId: 12, jobId: null },
  ]);
  assert.deepEqual(chats.takeRead(C, "555", 12), []);
  assert.deepEqual(chats.takeRead(C, "555", 20), [{ messageId: 14, jobId: null }]);
});

test("собеседники: access_hash помним, пустой не пишем", () => {
  const chats = createChatStore(openDatabase(":memory:"));
  chats.rememberPeer(C, tgUser("555"));
  chats.rememberPeer(C, tgUser("556", { accessHash: "" }));
  assert.deepEqual(chats.peer(C, "555"), { accessHash: "hash-555", firstName: "Анна", lastName: "Петрова" });
  assert.equal(chats.peer(C, "556"), null);
});

test("вход другим аккаунтом стирает водяные знаки канала и базовую линию", () => {
  const chats = createChatStore(openDatabase(":memory:"));
  assert.equal(chats.bindAccount(C, "100"), "changed");
  chats.advance(C, "555", 10);
  chats.markBaseline(C, 1);
  chats.touchAlive(C, 5);
  assert.equal(chats.bindAccount(C, "100"), "same");
  assert.equal(chats.top(C, "555"), 10);
  assert.equal(chats.bindAccount(C, "200"), "changed");
  assert.equal(chats.top(C, "555"), null);
  assert.equal(chats.baselineDone(C), false);
  assert.equal(chats.aliveAt(C), 0);
});
```

Create `msg-gateway/src/telegram/tracker.test.ts`:

```ts
// node --test src/telegram/tracker.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { sleep } from "../util/async.ts";
import { createTracker } from "./tracker.ts";

test("исходящее ждёт конца нашей отправки в том же чате, другие чаты — нет", async () => {
  const tracker = createTracker();
  tracker.begin("chat-1");
  let settled = false;
  const waiting = tracker.settled("chat-1").then(() => void (settled = true));
  await tracker.settled("chat-2");
  await sleep(5);
  assert.equal(settled, false);
  tracker.end("chat-1");
  await waiting;
  assert.equal(settled, true);
});

test("зависшая отправка очередь чата не держит: ожидание с потолком", async () => {
  const tracker = createTracker();
  tracker.begin("chat-1");
  const started = Date.now();
  await tracker.settled("chat-1", 20);
  assert.ok(Date.now() - started < 1000);
});
```

Create `msg-gateway/src/telegram/sender.test.ts`:

```ts
// node --test src/telegram/sender.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { BackendError } from "../backend/client.ts";
import type { GatewayJob } from "../backend/types.ts";
import { createChatStore } from "../store/chats.ts";
import { openDatabase } from "../store/db.ts";
import { createSentStore, type SentStore } from "../store/sent.ts";
import { createFakePort, type FakePort } from "../testing/fakePort.ts";
import { CHANNEL_ID, CLIENT_ID } from "../testing/fixtures.ts";
import { createRateLimiter } from "../util/rateLimit.ts";
import type { SendPayload } from "./payloads.ts";
import { deriveRandomId } from "./randomId.ts";
import { runSend, type SenderDeps } from "./sender.ts";
import { createTracker } from "./tracker.ts";

const job = (id = "64f600000000000000000abc"): GatewayJob => ({
  id,
  type: "send",
  channelId: CHANNEL_ID,
  conversationId: "64f600000000000000000c01",
  messageId: "64f600000000000000000d01",
  attempt: 0,
  payload: {},
});

const payload = (extra: Partial<SendPayload> = {}): SendPayload => ({
  chatId: CLIENT_ID,
  kind: "direct",
  text: "Добрый день!\n\n— Игорь, F1Lab",
  attachments: [],
  ...extra,
});

const setup = (port: FakePort | null = createFakePort(), sent: SentStore = createSentStore(openDatabase(":memory:"))) => {
  const db = openDatabase(":memory:");
  const lost: string[] = [];
  const deps: SenderDeps = {
    channelId: CHANNEL_ID,
    port: () => port,
    sent,
    chats: createChatStore(db),
    limiter: createRateLimiter({ perChatMs: 0 }),
    tracker: createTracker(),
    resolvePeer: async (chatId) => ({ userId: chatId, accessHash: "hash" }),
    downloadMedia: async (name) => Buffer.from(`bytes-of-${name}`),
    onSessionLost: (failure) => lost.push(failure.error),
    sleep: async () => {},
  };
  return { deps, lost };
};

test("текст уходит одним сообщением с random_id из id задания; id — в итог", async () => {
  const port = createFakePort();
  const { deps } = setup(port);
  const outcome = await runSend(job(), payload(), deps);
  assert.equal(port.delivered.length, 1);
  assert.equal(port.delivered[0]?.randomId, deriveRandomId(job().id, 0));
  assert.equal(port.delivered[0]?.text, "Добрый день!\n\n— Игорь, F1Lab");
  assert.deepEqual(outcome, { ok: true, result: { externalId: "1001", externalIds: ["1001"] } });
  assert.equal(deps.sent.ownJobOf(CHANNEL_ID, CLIENT_ID, 1001), job().id);
});

test("kill -9 между отправкой и записью: повтор того же задания не дублирует сообщение", async () => {
  const port = createFakePort();
  const real = createSentStore(openDatabase(":memory:"));
  let crash = true;
  const crashing: SentStore = {
    ...real,
    recordPart(...args) {
      if (crash) {
        crash = false;
        throw new Error("process killed");
      }
      real.recordPart(...args);
    },
  };
  const { deps } = setup(port, crashing);
  const first = await runSend(job(), payload(), deps);
  assert.equal(first.ok, false);
  assert.equal(port.delivered.length, 1);
  // Аренда истекла — бэкенд выдаёт то же задание снова
  const second = await runSend(job(), payload(), deps);
  assert.equal(port.delivered.length, 1, "клиент получил сообщение один раз");
  assert.deepEqual(second, { ok: true, result: { externalId: "1001", externalIds: ["1001"] } });
});

test("отправлено, но подтверждение потерялось — повтор отвечает записанным, в Telegram не ходит", async () => {
  const port = createFakePort();
  const { deps } = setup(port);
  await runSend(job(), payload(), deps);
  const again = await runSend(job(), payload(), { ...deps, port: () => null });
  assert.equal(port.delivered.length, 1);
  assert.deepEqual(again, { ok: true, result: { externalId: "1001", externalIds: ["1001"] } });
});

test("длинный текст и файлы: части по порядку, фото — фото, pdf — документом", async () => {
  const port = createFakePort();
  const { deps } = setup(port);
  const outcome = await runSend(
    job(),
    payload({
      text: "длинно ".repeat(300),
      attachments: [
        { name: "cp-1.jpg", originalName: "схема.jpg", mimetype: "image/jpeg", size: 0 },
        { name: "cp-2.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 0 },
      ],
    }),
    deps,
  );
  assert.deepEqual(port.delivered.map((item) => item.file), [null, "схема.jpg:photo", "акт.pdf:document"]);
  assert.deepEqual(
    port.delivered.map((item) => item.randomId),
    [0, 1, 2].map((part) => deriveRandomId(job().id, part)),
  );
  assert.deepEqual(outcome, { ok: true, result: { externalId: "1001", externalIds: ["1001", "1002", "1003"] } });
});

test("FLOOD_WAIT посреди частей: пауза без попытки, повтор досылает только недостающее", async () => {
  const port = createFakePort();
  const { deps } = setup(port);
  const twoParts = payload({ text: "а ".repeat(3000) });
  let calls = 0;
  const original = port.sendText;
  port.sendText = async (peer, text, randomId) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error("FLOOD"), { errorMessage: "FLOOD", code: 420, seconds: 30 });
    return original(peer, text, randomId);
  };
  const first = await runSend(job(), twoParts, deps);
  assert.deepEqual(first, { ok: false, retryable: true, retryAfterMs: 30_000, error: "FLOOD_WAIT_30" });
  const second = await runSend(job(), twoParts, deps);
  assert.equal(second.ok, true);
  assert.equal(port.delivered.length, 2);
});

test("темп: ждать дольше 20 с не будем — вернём задание с паузой, ничего не отправив", async () => {
  const port = createFakePort();
  const { deps } = setup(port);
  const limiter = { acquire: () => 45_000 };
  assert.deepEqual(await runSend(job(), payload(), { ...deps, limiter }), {
    ok: false,
    retryable: true,
    retryAfterMs: 45_000,
    error: "Темп отправки Telegram — позже",
  });
  assert.equal(port.delivered.length, 0);
});

test("сессию завершили — канал узнаёт об этом, задание повторится позже", async () => {
  const port = createFakePort();
  port.failNextSend = Object.assign(new Error("401"), { errorMessage: "AUTH_KEY_UNREGISTERED", code: 401 });
  const { deps, lost } = setup(port);
  const outcome = await runSend(job(), payload(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.retryable, true);
  assert.deepEqual(lost, ["AUTH_KEY_UNREGISTERED"]);
});

test("отказы без повторов: группа, неизвестный собеседник, пропавший файл, блокировка", async () => {
  const { deps } = setup();
  assert.equal((await runSend(job("64f600000000000000000001"), payload({ kind: "group" }), deps)).ok, false);
  const noPeer = await runSend(job("64f600000000000000000002"), payload(), { ...deps, resolvePeer: async () => null });
  assert.deepEqual(noPeer, { ok: false, retryable: false, error: "Собеседник не найден в Telegram" });
  const noFile = await runSend(
    job("64f600000000000000000003"),
    payload({ text: "", attachments: [{ name: "cp-9.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 0 }] }),
    { ...deps, downloadMedia: async () => { throw new BackendError(404, "Файл не найден"); } },
  );
  assert.deepEqual(noFile, { ok: false, retryable: false, error: "Файл вложения «акт.pdf» не найден в хранилище HD" });
  const port = createFakePort();
  port.failNextSend = Object.assign(new Error("403"), { errorMessage: "USER_IS_BLOCKED", code: 403 });
  const blocked = await runSend(job("64f600000000000000000004"), payload(), { ...deps, port: () => port });
  assert.deepEqual(blocked, { ok: false, retryable: false, error: "Собеседник заблокировал аккаунт (USER_IS_BLOCKED)" });
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/store/state.test.ts src/telegram/tracker.test.ts src/telegram/sender.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/store/chats.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/store/sent.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

/**
 * Журнал отправок — защита от двойной отправки. Порядок один и менять его
 * нельзя: СВЕРИТЬСЯ (begin) → отправить часть с random_id → ЗАПИСАТЬ часть
 * (recordPart) → … → finish → подтвердить бэкенду.
 *
 * - Упали между отправкой и записью — задание вернётся с тем же id, часть
 *   уйдёт с тем же random_id, Telegram вернёт уже отправленное сообщение.
 * - Упали после finish, но до подтверждения — повтор сразу подтверждается
 *   записанными id, в Telegram ничего не уходит.
 * - Строка «sending» ещё и говорит проверке пропусков: исходящее в этом чате
 *   может оказаться нашим — не записывать его «с телефона» (telegram/inbound.ts).
 */
export type SentState = { state: "sending" | "done"; parts: Map<number, number> };

export type SentStore = {
  begin(jobId: string, channelId: string, chatId: string): SentState;
  recordPart(jobId: string, part: number, randomId: bigint, messageId: number): void;
  finish(jobId: string): void;
  ownJobOf(channelId: string, chatId: string, messageId: number): string | null;
  unfinishedSince(channelId: string, chatId: string, since: number): boolean;
  prune(olderThanMs: number, now?: number): number;
};

export const createSentStore = (db: DatabaseSync): SentStore => ({
  begin(jobId, channelId, chatId) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO sent_jobs (job_id, channel_id, chat_id, state, created_at, updated_at)
       VALUES (?, ?, ?, 'sending', ?, ?) ON CONFLICT(job_id) DO NOTHING`,
    ).run(jobId, channelId, chatId, now, now);
    const job = db.prepare("SELECT state FROM sent_jobs WHERE job_id = ?").get(jobId) as { state: "sending" | "done" };
    const rows = db.prepare("SELECT part, message_id FROM sent_parts WHERE job_id = ? ORDER BY part").all(jobId) as {
      part: number;
      message_id: number;
    }[];
    return { state: job.state, parts: new Map(rows.map((row) => [row.part, row.message_id])) };
  },

  recordPart(jobId, part, randomId, messageId) {
    db.prepare(
      `INSERT INTO sent_parts (job_id, part, random_id, message_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id, part) DO NOTHING`,
    ).run(jobId, part, randomId.toString(), messageId);
    db.prepare("UPDATE sent_jobs SET updated_at = ? WHERE job_id = ?").run(Date.now(), jobId);
  },

  finish(jobId) {
    db.prepare("UPDATE sent_jobs SET state = 'done', updated_at = ? WHERE job_id = ?").run(Date.now(), jobId);
  },

  ownJobOf(channelId, chatId, messageId) {
    const row = db
      .prepare(
        `SELECT p.job_id AS jobId FROM sent_parts p JOIN sent_jobs j ON j.job_id = p.job_id
         WHERE p.message_id = ? AND j.channel_id = ? AND j.chat_id = ? LIMIT 1`,
      )
      .get(messageId, channelId, chatId) as { jobId: string } | undefined;
    return row?.jobId ?? null;
  },

  unfinishedSince(channelId, chatId, since) {
    return Boolean(
      db
        .prepare("SELECT 1 FROM sent_jobs WHERE channel_id = ? AND chat_id = ? AND state = 'sending' AND created_at >= ? LIMIT 1")
        .get(channelId, chatId, since),
    );
  },

  prune(olderThanMs, now = Date.now()) {
    const cutoff = now - olderThanMs;
    db.prepare("DELETE FROM sent_parts WHERE job_id IN (SELECT job_id FROM sent_jobs WHERE updated_at < ?)").run(cutoff);
    return Number(db.prepare("DELETE FROM sent_jobs WHERE updated_at < ?").run(cutoff).changes);
  },
});
```

Create `msg-gateway/src/store/chats.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";

import type { TgUser } from "../telegram/types.ts";

/**
 * Что шлюз помнит о чатах канала (без содержимого переписки):
 * - peers — access_hash собеседников: без него Telegram личку не примет, а
 *   кэш GramJS живёт только в памяти процесса;
 * - chats.top_id — водяной знак: до какого сообщения чат уже разобран
 *   (проверка пропусков берёт только то, что новее);
 * - outgoing — наши исходящие, чтобы по «прочитано до N» отметить прочтение;
 * - channel_state — чей аккаунт, когда были на связи, сделана ли базовая линия.
 */
export type ChatStore = {
  peer(channelId: string, userId: string): { accessHash: string; firstName: string; lastName: string } | null;
  rememberPeer(channelId: string, user: TgUser): void;
  top(channelId: string, chatId: string): number | null;
  advance(channelId: string, chatId: string, messageId: number): void;
  addOutgoing(channelId: string, chatId: string, messageId: number, jobId: string | null): void;
  /** Наши исходящие с номером в (прочитано ранее, maxId], отметку прочтения двигает вперёд. */
  takeRead(channelId: string, chatId: string, maxId: number): { messageId: number; jobId: string | null }[];
  aliveAt(channelId: string): number;
  touchAlive(channelId: string, at: number): void;
  baselineDone(channelId: string): boolean;
  markBaseline(channelId: string, at: number): void;
  /** Вошли другим аккаунтом — номера сообщений из другого пространства: забыть всё по каналу. */
  bindAccount(channelId: string, accountId: string): "same" | "changed";
  prune(olderThanMs: number, now?: number): number;
};

export const createChatStore = (db: DatabaseSync): ChatStore => {
  const ensureState = (channelId: string): void => {
    db.prepare("INSERT INTO channel_state (channel_id) VALUES (?) ON CONFLICT(channel_id) DO NOTHING").run(channelId);
  };

  return {
    peer(channelId, userId) {
      const row = db
        .prepare("SELECT access_hash, first_name, last_name FROM peers WHERE channel_id = ? AND peer_id = ?")
        .get(channelId, userId) as { access_hash: string; first_name: string; last_name: string } | undefined;
      return row ? { accessHash: row.access_hash, firstName: row.first_name, lastName: row.last_name } : null;
    },

    rememberPeer(channelId, user) {
      if (!user.accessHash) return;
      db.prepare(
        `INSERT INTO peers (channel_id, peer_id, access_hash, first_name, last_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, peer_id) DO UPDATE SET access_hash = excluded.access_hash,
           first_name = excluded.first_name, last_name = excluded.last_name, updated_at = excluded.updated_at`,
      ).run(channelId, user.id, user.accessHash, user.firstName, user.lastName, Date.now());
    },

    top(channelId, chatId) {
      const row = db.prepare("SELECT top_id FROM chats WHERE channel_id = ? AND chat_id = ?").get(channelId, chatId) as
        | { top_id: number }
        | undefined;
      return row ? row.top_id : null;
    },

    advance(channelId, chatId, messageId) {
      db.prepare(
        `INSERT INTO chats (channel_id, chat_id, top_id) VALUES (?, ?, ?)
         ON CONFLICT(channel_id, chat_id) DO UPDATE SET top_id = max(top_id, excluded.top_id)`,
      ).run(channelId, chatId, messageId);
    },

    addOutgoing(channelId, chatId, messageId, jobId) {
      db.prepare(
        `INSERT INTO outgoing (channel_id, chat_id, message_id, job_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, chat_id, message_id) DO UPDATE SET job_id = coalesce(outgoing.job_id, excluded.job_id)`,
      ).run(channelId, chatId, messageId, jobId, Date.now());
    },

    takeRead(channelId, chatId, maxId) {
      const mark = db.prepare("SELECT read_out_max FROM chats WHERE channel_id = ? AND chat_id = ?").get(channelId, chatId) as
        | { read_out_max: number }
        | undefined;
      const from = mark?.read_out_max ?? 0;
      if (maxId <= from) return [];
      const rows = db
        .prepare(
          `SELECT message_id AS messageId, job_id AS jobId FROM outgoing
           WHERE channel_id = ? AND chat_id = ? AND message_id > ? AND message_id <= ? ORDER BY message_id`,
        )
        .all(channelId, chatId, from, maxId) as { messageId: number; jobId: string | null }[];
      db.prepare(
        `INSERT INTO chats (channel_id, chat_id, read_out_max) VALUES (?, ?, ?)
         ON CONFLICT(channel_id, chat_id) DO UPDATE SET read_out_max = max(read_out_max, excluded.read_out_max)`,
      ).run(channelId, chatId, maxId);
      return rows.map((row) => ({ messageId: row.messageId, jobId: row.jobId }));
    },

    aliveAt(channelId) {
      const row = db.prepare("SELECT alive_at FROM channel_state WHERE channel_id = ?").get(channelId) as { alive_at: number } | undefined;
      return row?.alive_at ?? 0;
    },

    touchAlive(channelId, at) {
      ensureState(channelId);
      db.prepare("UPDATE channel_state SET alive_at = ? WHERE channel_id = ?").run(at, channelId);
    },

    baselineDone(channelId) {
      const row = db.prepare("SELECT baseline_at FROM channel_state WHERE channel_id = ?").get(channelId) as
        | { baseline_at: number }
        | undefined;
      return Boolean(row?.baseline_at);
    },

    markBaseline(channelId, at) {
      ensureState(channelId);
      db.prepare("UPDATE channel_state SET baseline_at = ? WHERE channel_id = ?").run(at, channelId);
    },

    bindAccount(channelId, accountId) {
      ensureState(channelId);
      const row = db.prepare("SELECT account_id FROM channel_state WHERE channel_id = ?").get(channelId) as { account_id: string };
      if (row.account_id === accountId) return "same";
      for (const table of ["peers", "chats", "outgoing"]) {
        db.prepare(`DELETE FROM ${table} WHERE channel_id = ?`).run(channelId);
      }
      db.prepare("UPDATE channel_state SET account_id = ?, alive_at = 0, baseline_at = 0 WHERE channel_id = ?").run(accountId, channelId);
      return "changed";
    },

    prune(olderThanMs, now = Date.now()) {
      return Number(db.prepare("DELETE FROM outgoing WHERE created_at < ?").run(now - olderThanMs).changes);
    },
  };
};
```

Create `msg-gateway/src/telegram/tracker.ts`:

```ts
/**
 * Отправки «в полёте» по чатам. Исходящее, пришедшее в чат, где наша
 * отправка ещё не вернула id, разбираем после неё: иначе своё же сообщение
 * приняли бы за набранное на телефоне и показали в HD дважды. Ждём не дольше
 * maxWaitMs: зависшая отправка не должна держать очередь чата.
 */
export type OutboundTracker = {
  begin(chatId: string): void;
  end(chatId: string): void;
  settled(chatId: string, maxWaitMs?: number): Promise<void>;
};

export const createTracker = (): OutboundTracker => {
  const active = new Map<string, { count: number; waiters: (() => void)[] }>();
  return {
    begin(chatId) {
      const entry = active.get(chatId) ?? { count: 0, waiters: [] };
      entry.count += 1;
      active.set(chatId, entry);
    },
    end(chatId) {
      const entry = active.get(chatId);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count > 0) return;
      active.delete(chatId);
      for (const wake of entry.waiters) wake();
    },
    settled(chatId, maxWaitMs = 30_000) {
      const entry = active.get(chatId);
      if (!entry) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, maxWaitMs);
        entry.waiters.push(done);
      });
    },
  };
};
```

Create `msg-gateway/src/telegram/sender.ts`:

```ts
import { BackendError } from "../backend/client.ts";
import type { GatewayJob, JobOutcome } from "../backend/types.ts";
import type { ChatStore } from "../store/chats.ts";
import type { SentStore } from "../store/sent.ts";
import { sleep } from "../util/async.ts";
import type { RateLimiter } from "../util/rateLimit.ts";
import { classifyTgError, outcomeOf, PermanentError, type TgFailure } from "./classify.ts";
import type { SendPayload } from "./payloads.ts";
import { planParts, sendsAsPhoto, type SendAttachment } from "./plan.ts";
import type { SendFile, TgPort } from "./port.ts";
import { deriveRandomId } from "./randomId.ts";
import type { OutboundTracker } from "./tracker.ts";
import type { InputPeer } from "./types.ts";

/**
 * Задание `send`: ответ из HD уходит в Telegram. Подпись «— Имя, Организация»
 * уже в тексте — её ставит бэкенд (backend/services/messaging/outbound.js,
 * signReply по Channel.settings.signReplies); шлюз текст не трогает.
 *
 * Порядок: журнал отправок (store/sent.ts) → темп (1/с на чат, 20/мин) →
 * часть с random_id из id задания → запись части → … → итог бэкенду.
 */
export const MAX_WAIT_MS = 20_000;

export type SenderDeps = {
  channelId: string;
  port: () => TgPort | null;
  sent: SentStore;
  chats: ChatStore;
  limiter: RateLimiter;
  tracker: OutboundTracker;
  resolvePeer: (chatId: string) => Promise<InputPeer | null>;
  downloadMedia: (name: string) => Promise<Buffer>;
  onSessionLost: (failure: Extract<TgFailure, { kind: "session" }>) => void;
  sleep?: (ms: number) => Promise<void>;
};

const resultOf = (parts: Map<number, number>): { externalId?: string; externalIds?: string[] } => {
  const ids = [...parts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, id]) => id)
    .filter((id) => id > 0)
    .map(String);
  return ids.length ? { externalId: ids[0]!, externalIds: ids } : {};
};

const fileOf = async (attachment: SendAttachment, download: SenderDeps["downloadMedia"]): Promise<SendFile> => {
  let buffer: Buffer;
  try {
    buffer = await download(attachment.name);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) {
      throw new PermanentError(`Файл вложения «${attachment.originalName}» не найден в хранилище HD`);
    }
    throw error;
  }
  return {
    buffer,
    name: attachment.originalName || attachment.name,
    mimetype: attachment.mimetype,
    asPhoto: sendsAsPhoto(attachment.mimetype, buffer.length),
  };
};

export const runSend = async (job: GatewayJob, payload: SendPayload, deps: SenderDeps): Promise<JobOutcome> => {
  if (payload.kind !== "direct") {
    return { ok: false, retryable: false, error: "Ответы в группы Telegram появятся в следующей фазе" };
  }
  const parts = planParts(payload.text, payload.attachments);
  if (!parts.length) return { ok: false, retryable: false, error: "Пустое сообщение" };

  const record = deps.sent.begin(job.id, deps.channelId, payload.chatId);
  // Уже отправлено, не дошло только подтверждение — подтверждаем тем же, в Telegram ничего не шлём
  if (record.state === "done") return { ok: true, result: resultOf(record.parts) };

  const port = deps.port();
  if (!port) return { ok: false, retryable: true, error: "Канал не подключён к Telegram" };
  const pause = deps.sleep ?? sleep;

  deps.tracker.begin(payload.chatId);
  try {
    const peer = await deps.resolvePeer(payload.chatId);
    if (!peer) return { ok: false, retryable: false, error: "Собеседник не найден в Telegram" };

    for (const [index, part] of parts.entries()) {
      if (record.parts.has(index)) continue;
      for (;;) {
        const wait = deps.limiter.acquire(payload.chatId);
        if (!wait) break;
        // Долго ждать нельзя — держим аренду; пусть очередь бэкенда подождёт без счёта попытки
        if (wait > MAX_WAIT_MS) return { ok: false, retryable: true, retryAfterMs: wait, error: "Темп отправки Telegram — позже" };
        await pause(wait);
      }
      const randomId = deriveRandomId(job.id, index);
      const messageId =
        part.kind === "text"
          ? await port.sendText(peer, part.text, randomId)
          : await port.sendFile(peer, await fileOf(part.attachment, deps.downloadMedia), part.caption, randomId);
      deps.sent.recordPart(job.id, index, randomId, messageId ?? 0);
      record.parts.set(index, messageId ?? 0);
      if (messageId) deps.chats.addOutgoing(deps.channelId, payload.chatId, messageId, job.id);
    }
    deps.sent.finish(job.id);
    return { ok: true, result: resultOf(record.parts) };
  } catch (error) {
    const failure = classifyTgError(error);
    if (failure.kind === "session") deps.onSessionLost(failure);
    return outcomeOf(failure);
  } finally {
    deps.tracker.end(payload.chatId);
  }
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/store/state.test.ts src/telegram/tracker.test.ts src/telegram/sender.test.ts`

Expected: PASS — summary `tests 15` · `pass 15` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 93` · `pass 93` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 11: Inbound pipeline

**Files:**
- Create: `msg-gateway/src/util/serial.ts`, `msg-gateway/src/telegram/inbound.ts`
- Test: `msg-gateway/src/util/serial.test.ts`, `msg-gateway/src/telegram/inbound.test.ts`

**Interfaces:**
- Consumes: `Journal`, `BlobInput` (Task 4); `SentStore`, `ChatStore`, `OutboundTracker` (Task 10); `skipReason` and the normalize functions (Task 6).
- Produces: `createSerialQueue(): SerialQueue` — `<T>(key, task: () => Promise<T>) => Promise<T>`; `UNFINISHED_WINDOW_MS = 3600000`; `Mode = "live" | "gap" | "history"`; `Handled = "journaled" | "skipped" | "own" | "deferred"`; `InboundDeps = {channelId, selfId, settings, journal, sent, chats, tracker, download, wake?, now?}`; `createInbound(deps): Inbound` — `{handle(item, mode): Promise<Handled>; handleEdit(item): Promise<void>; handleDeleted(ids, inChannel): void; handleReadOutbox(chatId, peerKind, maxId): Promise<void>}`.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/util/serial.test.ts`:

```ts
// node --test src/util/serial.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { sleep } from "./async.ts";
import { createSerialQueue } from "./serial.ts";

test("задачи одного ключа — по очереди, даже если первая дольше", async () => {
  const queue = createSerialQueue();
  const order: string[] = [];
  await Promise.all([
    queue("chat-1", async () => {
      await sleep(20);
      order.push("photo");
    }),
    queue("chat-1", async () => {
      order.push("text");
    }),
  ]);
  assert.deepEqual(order, ["photo", "text"]);
});

test("ошибка задачи не останавливает очередь ключа", async () => {
  const queue = createSerialQueue();
  await assert.rejects(queue("chat-1", async () => {
    throw new Error("boom");
  }));
  assert.equal(await queue("chat-1", async () => "next"), "next");
});
```

Create `msg-gateway/src/telegram/inbound.test.ts`:

```ts
// node --test src/telegram/inbound.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GatewayEvent } from "../backend/types.ts";
import { createChatStore } from "../store/chats.ts";
import { openDatabase } from "../store/db.ts";
import type { BlobInput } from "../store/journal.ts";
import { createSentStore } from "../store/sent.ts";
import { CHANNEL_ID, CLIENT_ID, SELF_ID, tgItem, tgUser } from "../testing/fixtures.ts";
import { sleep } from "../util/async.ts";
import { createInbound, type InboundDeps } from "./inbound.ts";
import { createTracker } from "./tracker.ts";

const photo = { kind: "photo" as const, fileName: "photo-7.jpg", mimetype: "image/jpeg", size: 3, durationSec: null };

const setup = (extra: Partial<InboundDeps> = {}) => {
  const db = openDatabase(":memory:");
  const pushed: { event: GatewayEvent; blobs: BlobInput[] }[] = [];
  const sent = createSentStore(db);
  const chats = createChatStore(db);
  const deps: InboundDeps = {
    channelId: CHANNEL_ID,
    selfId: () => SELF_ID,
    settings: () => ({ ignoredChatIds: [], maxMediaMb: 50 }),
    journal: { push: (_channelId, event, blobs = []) => void pushed.push({ event, blobs }) },
    sent,
    chats,
    tracker: createTracker(),
    download: async () => Buffer.from([1, 2, 3]),
    ...extra,
  };
  return { inbound: createInbound(deps), pushed, sent, chats };
};

const typeOf = (entry: { event: GatewayEvent }) => entry.event.type;

test("служебные уведомления 777000 (коды входа) в журнал не попадают", async () => {
  const { inbound, pushed } = setup();
  const code = tgItem(5, { chatId: "777000", text: "Код для входа в Telegram: 12345" }, tgUser("777000", { firstName: "Telegram" }));
  assert.equal(await inbound.handle(code, "live"), "skipped");
  assert.equal(await inbound.handle(code, "gap"), "skipped");
  assert.equal(await inbound.handle(code, "history"), "skipped");
  assert.equal(pushed.length, 0);
});

test("входящее клиента — в журнал; водяной знак двигается; повтор того же — мимо", async () => {
  const { inbound, chats, pushed } = setup();
  assert.equal(await inbound.handle(tgItem(10), "live"), "journaled");
  assert.equal(chats.top(CHANNEL_ID, CLIENT_ID), 10);
  assert.equal(chats.peer(CHANNEL_ID, CLIENT_ID)?.accessHash, `hash-${CLIENT_ID}`);
  assert.equal(await inbound.handle(tgItem(10), "gap"), "skipped");
  assert.equal(pushed.length, 1);
  const event = pushed[0]?.event;
  assert.equal(event?.type === "message" ? event.message.sender?.id : "", CLIENT_ID);
});

test("набранное на телефоне — origin device; наш ответ из HD — эхо с jobId, без медиа", async () => {
  const { inbound, sent, pushed } = setup();
  assert.equal(await inbound.handle(tgItem(20, { out: true, text: "Ответ с телефона" }), "live"), "journaled");
  const device = pushed[0]?.event;
  assert.equal(device?.type === "message" ? device.message.origin : "", "device");

  const job = "64f600000000000000000aaa";
  sent.begin(job, CHANNEL_ID, CLIENT_ID);
  sent.recordPart(job, 0, 1n, 21);
  assert.equal(await inbound.handle(tgItem(21, { out: true, text: "Ответ из HD", media: photo }), "gap"), "own");
  const echo = pushed[1];
  assert.equal(echo?.event.type === "message" ? `${echo.event.message.origin}:${echo.event.message.jobId}` : "", `hd:${job}`);
  assert.deepEqual(echo?.event.type === "message" ? echo.event.message.attachments : null, []);
  assert.equal(echo?.blobs.length, 0);
  // Старый ответ из HD в истории — молчим
  assert.equal(await inbound.handle(tgItem(21, { out: true }), "history"), "own");
  assert.equal(pushed.length, 2);
});

test("исходящее во время нашей отправки ждёт её конца и узнаётся как наше", async () => {
  const tracker = createTracker();
  const { inbound, sent, pushed } = setup({ tracker });
  tracker.begin(CLIENT_ID);
  const pending = inbound.handle(tgItem(30, { out: true }), "live");
  await sleep(10);
  sent.begin("job-2", CHANNEL_ID, CLIENT_ID);
  sent.recordPart("job-2", 0, 2n, 30);
  tracker.end(CLIENT_ID);
  assert.equal(await pending, "own");
  assert.deepEqual(pushed.map((entry) => (entry.event.type === "message" ? entry.event.message.origin : "")), ["hd"]);
});

test("проверка пропусков откладывает незнакомое исходящее, пока наша отправка в чате не закончена", async () => {
  const { inbound, sent, chats, pushed } = setup();
  sent.begin("job-3", CHANNEL_ID, CLIENT_ID);
  assert.equal(await inbound.handle(tgItem(40, { out: true }), "gap"), "deferred");
  assert.equal(chats.top(CHANNEL_ID, CLIENT_ID), null);
  assert.equal(pushed.length, 0);
});

test("медиа: скачиваем до предела, больше предела и история — пропуск, сбой — failed", async () => {
  const { inbound, pushed } = setup();
  await inbound.handle(tgItem(7, { text: "", media: photo }), "live");
  const first = pushed[0];
  assert.equal(first?.event.type === "message" ? first.event.message.attachments[0]?.status : "", "pending");
  assert.equal(first?.blobs[0]?.data.length, 3);

  const big = setup({ settings: () => ({ ignoredChatIds: [], maxMediaMb: 1 }) });
  await big.inbound.handle(tgItem(8, { media: { ...photo, size: 5 * 1024 * 1024 } }), "live");
  const skippedBig = big.pushed[0]?.event;
  assert.equal(skippedBig?.type === "message" ? skippedBig.message.attachments[0]?.status : "", "skipped");

  const history = setup();
  await history.inbound.handle(tgItem(9, { media: photo }), "history");
  const imported = history.pushed[0]?.event;
  assert.equal(imported?.type === "message" ? imported.message.imported : false, true);
  assert.equal(imported?.type === "message" ? imported.message.attachments[0]?.status : "", "skipped");

  const broken = setup({ download: async () => { throw new Error("timeout"); } });
  await broken.inbound.handle(tgItem(11, { media: photo }), "live");
  const failed = broken.pushed[0]?.event;
  assert.equal(failed?.type === "message" ? failed.message.attachments[0]?.status : "", "failed");
});

test("правки: входящую пересылаем, наш ответ из HD — нет, без даты правки — нет", async () => {
  const { inbound, sent, pushed } = setup();
  await inbound.handleEdit(tgItem(50, { text: "Исправлено", editDate: 1_758_900_000 }));
  await inbound.handleEdit(tgItem(51, { text: "Реакция" }));
  sent.begin("job-4", CHANNEL_ID, CLIENT_ID);
  sent.recordPart("job-4", 0, 4n, 52);
  await inbound.handleEdit(tgItem(52, { out: true, text: "Ответ\n\n— Игорь, F1Lab", editDate: 1_758_900_001 }));
  assert.deepEqual(pushed.map(typeOf), ["message.edited"]);
});

test("удаление — пачками без чата; в каналах — мимо; прочтение — по нашим исходящим", async () => {
  const { inbound, chats, pushed } = setup();
  inbound.handleDeleted([1, 2, 3], false);
  inbound.handleDeleted([4], true);
  chats.addOutgoing(CHANNEL_ID, CLIENT_ID, 60, "64f600000000000000000aaa");
  chats.addOutgoing(CHANNEL_ID, CLIENT_ID, 61, null);
  await inbound.handleReadOutbox(CLIENT_ID, "user", 61);
  await inbound.handleReadOutbox(CLIENT_ID, "user", 61);
  assert.deepEqual(pushed.map(typeOf), ["message.deleted", "message.status", "message.status"]);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/util/serial.test.ts src/telegram/inbound.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/util/serial.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/util/serial.ts`:

```ts
/**
 * Очередь по ключу: задачи одного ключа идут строго друг за другом, разных —
 * параллельно. Так сообщения одного чата попадают в журнал в своём порядке,
 * даже если первое ждёт скачивания фото.
 */
export type SerialQueue = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export const createSerialQueue = (): SerialQueue => {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
};
```

Create `msg-gateway/src/telegram/inbound.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { Attachment, PendingAttachment } from "../backend/types.ts";
import { logger } from "../logger.ts";
import type { ChatStore } from "../store/chats.ts";
import type { BlobInput, Journal } from "../store/journal.ts";
import type { SentStore } from "../store/sent.ts";
import { messageOf } from "../util/async.ts";
import { createSerialQueue } from "../util/serial.ts";
import { skipReason } from "./filters.ts";
import {
  deleteEvents,
  echoEvent,
  editEvent,
  failedAttachment,
  mediaPlan,
  mediaRef,
  messageEvent,
  pendingAttachment,
  readEvents,
  skippedAttachment,
} from "./normalize.ts";
import type { OutboundTracker } from "./tracker.ts";
import { isFileMedia, type TgItem, type TgPeerKind, type TgUser } from "./types.ts";

/**
 * Всё, что приходит из Telegram, — в журнал (store/journal.ts), по чату строго
 * по очереди. Живые обновления, проверка пропусков и история идут одной
 * дорогой, поэтому правила одни:
 *
 * - фильтры (telegram/filters.ts): 777000, «Избранное», боты, группы, каналы, игнор;
 * - исходящее, которое есть в журнале отправок, — наше (ответ из HD): уходит
 *   эхом с jobId, бэкенд лишь подтверждает им своё сообщение (в истории — молчим);
 * - исходящее, которого там нет, — набрано на корпоративном телефоне
 *   (origin: device); при проверке пропусков, пока в чате есть незаконченная
 *   наша отправка, решение откладываем — вдруг это она;
 * - правка нашего ответа из HD не пересылается: в тексте Telegram стоит
 *   подпись, а в HD — нет (контракт §6 разрешает такую правку не слать).
 */
const MB = 1024 * 1024;
export const UNFINISHED_WINDOW_MS = 60 * 60_000;

export type Mode = "live" | "gap" | "history";
export type Handled = "journaled" | "skipped" | "own" | "deferred";

export type InboundDeps = {
  channelId: string;
  selfId: () => string;
  settings: () => { ignoredChatIds: string[]; maxMediaMb: number };
  journal: Pick<Journal, "push">;
  sent: Pick<SentStore, "ownJobOf" | "unfinishedSince">;
  chats: ChatStore;
  tracker: Pick<OutboundTracker, "settled">;
  download: (handle: unknown, maxBytes: number) => Promise<Buffer>;
  wake?: () => void;
  now?: () => number;
};

export type Inbound = {
  handle(item: TgItem, mode: Mode): Promise<Handled>;
  handleEdit(item: TgItem): Promise<void>;
  handleDeleted(ids: number[], inChannel: boolean): void;
  handleReadOutbox(chatId: string, peerKind: TgPeerKind, maxId: number): Promise<void>;
};

export const createInbound = (deps: InboundDeps): Inbound => {
  const queue = createSerialQueue();
  const now = deps.now ?? Date.now;
  const { channelId } = deps;

  const skipped = (item: TgItem): boolean =>
    skipReason({
      chatId: item.message.chatId,
      peerKind: item.message.peerKind,
      user: item.peer,
      selfId: deps.selfId(),
      ignoredChatIds: deps.settings().ignoredChatIds,
    }) !== null;

  /** Собеседник известен не всегда (короткое обновление, сбой сети) — берём что помним. */
  const peerOf = (item: TgItem): TgUser => {
    if (item.peer) return item.peer;
    const known = deps.chats.peer(channelId, item.message.chatId);
    return {
      id: item.message.chatId,
      accessHash: known?.accessHash ?? "",
      firstName: known?.firstName ?? "",
      lastName: known?.lastName ?? "",
      username: "",
      phone: "",
      isBot: false,
      isSelf: false,
    };
  };

  const attachmentsOf = async (item: TgItem, mode: Mode): Promise<{ list: (Attachment | PendingAttachment)[]; blobs: BlobInput[] }> => {
    const media = item.message.media;
    if (!isFileMedia(media)) return { list: [], blobs: [] };
    const ref = mediaRef(item.message.chatId, item.message.id);
    const { maxMediaMb } = deps.settings();
    if (mediaPlan(media, { maxMediaMb, imported: mode === "history" }) === "skip") {
      return { list: [skippedAttachment(media, ref)], blobs: [] };
    }
    try {
      const data = await deps.download(item.handle, maxMediaMb * MB);
      const blobId = randomUUID();
      return { list: [pendingAttachment(media, ref, blobId, data.length)], blobs: [{ id: blobId, data }] };
    } catch (error) {
      logger.warn("Media download failed", { channelId, chatId: item.message.chatId, messageId: item.message.id, error: messageOf(error) });
      return { list: [failedAttachment(media, ref)], blobs: [] };
    }
  };

  const process = async (item: TgItem, mode: Mode): Promise<Handled> => {
    const { message } = item;
    if (skipped(item)) return "skipped";
    const top = deps.chats.top(channelId, message.chatId);
    if (mode !== "history" && top !== null && message.id <= top) return "skipped";
    if (message.service) {
      if (mode !== "history") deps.chats.advance(channelId, message.chatId, message.id);
      return "skipped";
    }
    if (item.peer) deps.chats.rememberPeer(channelId, item.peer);

    if (message.out) {
      await deps.tracker.settled(message.chatId);
      const jobId = deps.sent.ownJobOf(channelId, message.chatId, message.id);
      if (jobId) {
        if (mode === "history") return "own";
        deps.journal.push(channelId, echoEvent({ channelId, message, peer: peerOf(item), jobId }));
        deps.chats.advance(channelId, message.chatId, message.id);
        deps.wake?.();
        return "own";
      }
      if (mode === "gap" && deps.sent.unfinishedSince(channelId, message.chatId, now() - UNFINISHED_WINDOW_MS)) {
        return "deferred";
      }
    }

    const { list, blobs } = await attachmentsOf(item, mode);
    const event = messageEvent({ channelId, message, peer: peerOf(item), attachments: list, imported: mode === "history" });
    deps.journal.push(channelId, event, blobs);
    if (message.out) deps.chats.addOutgoing(channelId, message.chatId, message.id, null);
    if (mode !== "history") deps.chats.advance(channelId, message.chatId, message.id);
    deps.wake?.();
    return "journaled";
  };

  return {
    handle: (item, mode) => queue(item.message.chatId, () => process(item, mode)),

    handleEdit: (item) =>
      queue(item.message.chatId, async () => {
        const { message } = item;
        // Без даты правки это не правка текста (реакции и т. п.)
        if (skipped(item) || message.service || !message.editDate) return;
        if (message.out && deps.sent.ownJobOf(channelId, message.chatId, message.id)) return;
        deps.journal.push(channelId, editEvent(channelId, message));
        deps.wake?.();
      }),

    handleDeleted(ids, inChannel) {
      // Удаления в супергруппах и каналах — не наша забота в P1a
      if (inChannel || !ids.length) return;
      for (const event of deleteEvents(channelId, ids)) deps.journal.push(channelId, event);
      deps.wake?.();
    },

    handleReadOutbox: (chatId, peerKind, maxId) =>
      queue(chatId, async () => {
        if (peerKind !== "user") return;
        const rows = deps.chats.takeRead(channelId, chatId, maxId);
        for (const event of readEvents(channelId, chatId, rows)) deps.journal.push(channelId, event);
        if (rows.length) deps.wake?.();
      }),
  };
};
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/util/serial.test.ts src/telegram/inbound.test.ts`

Expected: PASS — summary `tests 10` · `pass 10` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 103` · `pass 103` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 12: Sync — baseline, gap check, history import

**Files:**
- Create: `msg-gateway/src/telegram/sync.ts`
- Test: `msg-gateway/src/telegram/sync.test.ts`

**Interfaces:**
- Consumes: `Inbound`, `Mode`, `Handled` (Task 11); `ChatStore` (Task 10); `TgPort`, `TgDialog`, `TgItem`, `TgUser`, `InputPeer` (Task 6); `skipReason` (Task 6); `classifyTgError` (Task 8).
- Produces: `DIALOGS_LIMIT = 200`, `GAP_PER_CHAT = 200`, `HISTORY_PER_CHAT = 1000`; `SyncDeps = {channelId, port, inbound, chats, selfId, settings, now?, sleep?}`; `baseline(deps): Promise<number>`; `gapCheck(deps): Promise<{chats, messages}>`; `importHistory(deps, days): Promise<{chats, messages}>`.

- [ ] **Step 1: Write the failing test**

Create `msg-gateway/src/telegram/sync.test.ts`:

```ts
// node --test src/telegram/sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createChatStore } from "../store/chats.ts";
import { openDatabase } from "../store/db.ts";
import { createSentStore } from "../store/sent.ts";
import { createFakePort } from "../testing/fakePort.ts";
import { CHANNEL_ID, CLIENT_ID, SELF_ID, tgItem, tgUser } from "../testing/fixtures.ts";
import { createInbound, type Handled, type Mode } from "./inbound.ts";
import { baseline, gapCheck, importHistory, type SyncDeps } from "./sync.ts";
import { createTracker } from "./tracker.ts";
import type { TgDialog, TgItem } from "./types.ts";

const DAY = 86_400;
const NOW = 1_758_800_000;
const client = tgUser(CLIENT_ID);
const dialog = (chatId: string, topId: number, topDate: number, user = tgUser(chatId)): TgDialog => ({
  chatId,
  peerKind: "user",
  user,
  topId,
  topDate,
});

const setup = () => {
  const db = openDatabase(":memory:");
  const port = createFakePort();
  const chats = createChatStore(db);
  const sent = createSentStore(db);
  const handled: { id: number; chatId: string; mode: Mode }[] = [];
  const inbound = createInbound({
    channelId: CHANNEL_ID,
    selfId: () => SELF_ID,
    settings: () => ({ ignoredChatIds: [], maxMediaMb: 50 }),
    journal: { push: () => undefined },
    sent,
    chats,
    tracker: createTracker(),
    download: async () => Buffer.alloc(0),
  });
  const spy = {
    async handle(item: TgItem, mode: Mode): Promise<Handled> {
      const outcome = await inbound.handle(item, mode);
      if (outcome === "journaled") handled.push({ id: item.message.id, chatId: item.message.chatId, mode });
      return outcome;
    },
  };
  const deps: SyncDeps = {
    channelId: CHANNEL_ID,
    port: () => port,
    inbound: spy,
    chats,
    selfId: () => SELF_ID,
    settings: () => ({ ignoredChatIds: [] }),
    now: () => NOW * 1000,
    sleep: async () => {},
  };
  return { port, chats, sent, handled, deps };
};

test("базовая линия: всё, что было до входа, — не «пропущенное»; 777000 и боты мимо", async () => {
  const { port, chats, deps } = setup();
  port.dialogList = [
    dialog(CLIENT_ID, 50, NOW - 100, client),
    dialog("777000", 90, NOW - 10, tgUser("777000")),
    dialog("600", 70, NOW - 10, tgUser("600", { isBot: true })),
  ];
  assert.equal(await baseline(deps), 1);
  assert.equal(chats.top(CHANNEL_ID, CLIENT_ID), 50);
  assert.equal(chats.top(CHANNEL_ID, "777000"), null);
  assert.equal(chats.baselineDone(CHANNEL_ID), true);
});

test("проверка пропусков дочитывает новое после водяного знака как живое, по порядку", async () => {
  const { port, chats, handled, deps } = setup();
  port.dialogList = [dialog(CLIENT_ID, 50, NOW - 100, client)];
  await baseline(deps);
  port.dialogList = [dialog(CLIENT_ID, 53, NOW, client)];
  port.history.set(CLIENT_ID, [tgItem(50), tgItem(51), tgItem(52, { out: true }), tgItem(53)]);
  assert.deepEqual(await gapCheck(deps), { chats: 1, messages: 3 });
  assert.deepEqual(handled.map((item) => `${item.id}:${item.mode}`), ["51:gap", "52:gap", "53:gap"]);
  assert.equal(chats.top(CHANNEL_ID, CLIENT_ID), 53);
  // Второй проход ничего нового не находит
  assert.deepEqual(await gapCheck(deps), { chats: 0, messages: 0 });
});

test("новый чат за время простоя — с момента последней связи; старый незнакомый — только отметка", async () => {
  const { port, chats, handled, deps } = setup();
  await baseline(deps);
  chats.touchAlive(CHANNEL_ID, (NOW - 3600) * 1000);
  const fresh = tgUser("5550002");
  const old = tgUser("5550003");
  port.dialogList = [dialog("5550002", 12, NOW - 60, fresh), dialog("5550003", 99, NOW - 30 * DAY, old)];
  port.history.set("5550002", [
    tgItem(10, { chatId: "5550002", date: NOW - 7200 }, fresh),
    tgItem(11, { chatId: "5550002", date: NOW - 120 }, fresh),
    tgItem(12, { chatId: "5550002", date: NOW - 60 }, fresh),
  ]);
  await gapCheck(deps);
  assert.deepEqual(handled.map((item) => item.id), [11, 12]);
  assert.equal(chats.top(CHANNEL_ID, "5550003"), 99);
});

test("незаконченная наша отправка в чате: проверка останавливается на незнакомом исходящем", async () => {
  const { port, sent, chats, handled, deps } = setup();
  port.dialogList = [dialog(CLIENT_ID, 50, NOW - 100, client)];
  await baseline(deps);
  sent.begin("job-9", CHANNEL_ID, CLIENT_ID);
  port.dialogList = [dialog(CLIENT_ID, 52, NOW, client)];
  port.history.set(CLIENT_ID, [tgItem(51, { out: true }), tgItem(52)]);
  await gapCheck(deps);
  assert.deepEqual(handled, []);
  assert.equal(chats.top(CHANNEL_ID, CLIENT_ID), 50);
});

test("история за N дней: imported, по чатам, 777000 мимо, старые чаты не трогаем", async () => {
  const { port, handled, deps } = setup();
  port.dialogList = [
    dialog(CLIENT_ID, 3, NOW - DAY, client),
    dialog("777000", 9, NOW, tgUser("777000")),
    dialog("5550004", 7, NOW - 40 * DAY, tgUser("5550004")),
  ];
  port.history.set(CLIENT_ID, [
    tgItem(1, { date: NOW - 20 * DAY }),
    tgItem(2, { date: NOW - 5 * DAY }),
    tgItem(3, { date: NOW - DAY }),
  ]);
  port.history.set("777000", [tgItem(9, { chatId: "777000", date: NOW }, tgUser("777000"))]);
  assert.deepEqual(await importHistory(deps, 14), { chats: 1, messages: 2 });
  assert.deepEqual(handled.map((item) => `${item.id}:${item.mode}`), ["2:history", "3:history"]);
});

test("FLOOD_WAIT при чтении истории: короткий — выждать и продолжить", async () => {
  const { port, deps } = setup();
  let calls = 0;
  const waits: number[] = [];
  port.dialogs = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("FLOOD"), { errorMessage: "FLOOD", code: 420, seconds: 3 });
    return [];
  };
  await baseline({ ...deps, sleep: async (ms) => void waits.push(ms) });
  assert.deepEqual(waits, [3000]);
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/sync.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/sync.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/sync.ts`:

```ts
import type { ChatStore } from "../store/chats.ts";
import { sleep } from "../util/async.ts";
import { classifyTgError } from "./classify.ts";
import { skipReason } from "./filters.ts";
import type { Handled, Mode } from "./inbound.ts";
import type { TgPort } from "./port.ts";
import type { InputPeer, TgDialog, TgItem, TgUser } from "./types.ts";

/**
 * Сверка с Telegram. GramJS пропущенные за время обрыва обновления не
 * догоняет (catchUp в 2.26.22 — пустая заглушка), поэтому шлюз сам:
 *
 * - baseline — сразу после первого входа аккаунта: всё, что уже лежит в
 *   чатах, — история, а не «пропущенное»; помечаем водяные знаки;
 * - gapCheck — при переподключении и раз в 5 минут: для личных чатов, где
 *   верхнее сообщение новее водяного знака, дочитываем недостающее как
 *   живые сообщения (они ставят «ждёт ответа»). Чат, которого не знали, —
 *   с момента, когда шлюз последний раз был на связи;
 * - importHistory — `historyDays` после входа и задание loadHistory: только
 *   текст, медиа — «пропущено» (докачка по клику), imported: true.
 */
export const DIALOGS_LIMIT = 200;
export const GAP_PER_CHAT = 200;
export const HISTORY_PER_CHAT = 1000;
const MAX_FLOOD_SLEEP_MS = 10 * 60_000;

export type SyncDeps = {
  channelId: string;
  port: () => TgPort | null;
  inbound: { handle(item: TgItem, mode: Mode): Promise<Handled> };
  chats: ChatStore;
  selfId: () => string;
  settings: () => { ignoredChatIds: string[] };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Запрос истории с учётом FLOOD_WAIT: короткую паузу выждать самим, длинную — отдать наверх. */
const patiently = async <T>(call: () => Promise<T>, deps: SyncDeps): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const failure = classifyTgError(error);
      if (failure.kind !== "flood" || failure.retryAfterMs > MAX_FLOOD_SLEEP_MS || attempt >= 3) throw error;
      await (deps.sleep ?? sleep)(failure.retryAfterMs);
    }
  }
};

const portOf = (deps: SyncDeps): TgPort => {
  const port = deps.port();
  if (!port) throw new Error("Канал не подключён к Telegram");
  return port;
};

const peerOf = (user: TgUser): InputPeer => ({ userId: user.id, accessHash: user.accessHash });

/** Личные чаты с людьми — по тем же фильтрам, что и живые сообщения. */
const directDialogs = (dialogs: TgDialog[], deps: SyncDeps): (TgDialog & { user: TgUser })[] =>
  dialogs.flatMap((dialog) =>
    dialog.user &&
    dialog.user.accessHash &&
    !skipReason({
      chatId: dialog.chatId,
      peerKind: dialog.peerKind,
      user: dialog.user,
      selfId: deps.selfId(),
      ignoredChatIds: deps.settings().ignoredChatIds,
    })
      ? [{ ...dialog, user: dialog.user }]
      : [],
  );

export const baseline = async (deps: SyncDeps): Promise<number> => {
  const now = (deps.now ?? Date.now)();
  const dialogs = directDialogs(await patiently(() => portOf(deps).dialogs(DIALOGS_LIMIT), deps), deps);
  for (const dialog of dialogs) {
    deps.chats.rememberPeer(deps.channelId, dialog.user);
    deps.chats.advance(deps.channelId, dialog.chatId, dialog.topId);
  }
  deps.chats.markBaseline(deps.channelId, now);
  deps.chats.touchAlive(deps.channelId, now);
  return dialogs.length;
};

export const gapCheck = async (deps: SyncDeps): Promise<{ chats: number; messages: number }> => {
  if (!deps.chats.baselineDone(deps.channelId)) {
    await baseline(deps);
    return { chats: 0, messages: 0 };
  }
  const now = (deps.now ?? Date.now)();
  const since = deps.chats.aliveAt(deps.channelId);
  const port = portOf(deps);
  const dialogs = directDialogs(await patiently(() => port.dialogs(DIALOGS_LIMIT), deps), deps);
  let chats = 0;
  let messages = 0;
  for (const dialog of dialogs) {
    deps.chats.rememberPeer(deps.channelId, dialog.user);
    const top = deps.chats.top(deps.channelId, dialog.chatId);
    if (top !== null && dialog.topId <= top) continue;
    if (top === null && dialog.topDate * 1000 < since) {
      // Чат старше последней связи и не менялся — просто запомнить, где он
      deps.chats.advance(deps.channelId, dialog.chatId, dialog.topId);
      continue;
    }
    const items =
      top !== null
        ? await patiently(() => port.historyAfter(peerOf(dialog.user), top, GAP_PER_CHAT), deps)
        : await patiently(() => port.historySince(peerOf(dialog.user), Math.floor(since / 1000), GAP_PER_CHAT), deps);
    chats += 1;
    for (const item of items) {
      const outcome = await deps.inbound.handle({ ...item, peer: dialog.user }, "gap");
      if (outcome === "deferred") break;
      if (outcome === "journaled") messages += 1;
    }
  }
  deps.chats.touchAlive(deps.channelId, now);
  return { chats, messages };
};

export const importHistory = async (deps: SyncDeps, days: number): Promise<{ chats: number; messages: number }> => {
  if (days <= 0) return { chats: 0, messages: 0 };
  const sinceUnix = Math.floor(((deps.now ?? Date.now)() - days * 86_400_000) / 1000);
  const port = portOf(deps);
  const dialogs = directDialogs(await patiently(() => port.dialogs(DIALOGS_LIMIT), deps), deps);
  let chats = 0;
  let messages = 0;
  for (const dialog of dialogs) {
    if (dialog.topDate < sinceUnix) continue;
    const items = await patiently(() => port.historySince(peerOf(dialog.user), sinceUnix, HISTORY_PER_CHAT), deps);
    chats += 1;
    for (const item of items) {
      if ((await deps.inbound.handle({ ...item, peer: dialog.user }, "history")) === "journaled") messages += 1;
    }
  }
  return { chats, messages };
};
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/sync.test.ts`

Expected: PASS — summary `tests 6` · `pass 6` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 109` · `pass 109` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 13: Login flow

**Files:**
- Create: `msg-gateway/src/telegram/login.ts`
- Test: `msg-gateway/src/telegram/login.test.ts`

**Interfaces:**
- Consumes: `TgPort`, `PasswordNeeded`, `TgUser` (Task 6); `LoginStep` (Task 7); `rpcNameOf` (Task 8); `ChannelState`, `JobOutcome` (Task 3); `messageOf` (Task 1).
- Produces: `StateExtra = {reason?; login?: {qr; expiresAt}}`; `LoginHost = {isConnected(); freshPort(): Promise<TgPort>; emit(state, extra?); authorized(port, me): Promise<void>; discard(port): Promise<void>; qrWaitMs?}`; `LoginFlow = {step(step, value): Promise<JobOutcome>; cancel(): Promise<void>}`; `loginErrorText(error): string`; `createLoginFlow(host): LoginFlow`.

What the backend stores and shows (checked in `ingest.js#ingestChannelState` and `controllers/channel.js`): `state`, `stateReason` = our `reason`, `account` (only when sent), `login {qr, expiresAt}` (reset to nulls by any state event without `login`), `gatewaySeenAt`. `POST /channels/:id/login {step: "start"}` sets `connecting` itself; the other steps carry `value` decrypted in the job payload, and the backend nulls it on ack. Login jobs always fail with `retryable: false` — repeating a wrong password is pointless and looks like brute force.

- [ ] **Step 1: Write the failing test**

Create `msg-gateway/src/telegram/login.test.ts`:

```ts
// node --test src/telegram/login.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChannelState } from "../backend/types.ts";
import { createFakePort, type FakePort } from "../testing/fakePort.ts";
import { SELF_ID, tgUser } from "../testing/fixtures.ts";
import { sleep } from "../util/async.ts";
import { createLoginFlow, type LoginHost, type StateExtra } from "./login.ts";
import { PasswordNeeded, type TgPort } from "./port.ts";
import type { TgUser } from "./types.ts";

const me = tgUser(SELF_ID, { isSelf: true });

const host = (port: FakePort | (() => Promise<TgPort>), connected = false) => {
  const states: { state: ChannelState; extra: StateExtra | undefined }[] = [];
  const authorized: TgUser[] = [];
  const discarded: TgPort[] = [];
  let isConnected = connected;
  const value: LoginHost = {
    isConnected: () => isConnected,
    freshPort: typeof port === "function" ? port : async () => port,
    emit: (state, extra) => void states.push({ state, extra }),
    authorized: async (_port, user) => {
      isConnected = true;
      authorized.push(user);
    },
    discard: async (item) => void discarded.push(item),
    qrWaitMs: 50,
  };
  return { value, states, authorized, discarded };
};

const rpc = (errorMessage: string, code = 400) => Object.assign(new Error(errorMessage), { errorMessage, code });

test("QR: код уходит в настройки как tg://login, после сканирования — вход", async () => {
  let scanned: (user: TgUser) => void = () => {};
  const port = createFakePort({
    qrLogin: (onQr) => {
      onQr("tg://login?token=AAEC", new Date("2026-09-25T10:00:30Z"));
      return new Promise<TgUser>((resolve) => {
        scanned = resolve;
      });
    },
  });
  const { value, states, authorized } = host(port);
  const flow = createLoginFlow(value);
  assert.deepEqual(await flow.step("start", ""), { ok: true, result: { state: "awaitingQr" } });
  assert.deepEqual(states[0], {
    state: "awaitingQr",
    extra: { login: { qr: "tg://login?token=AAEC", expiresAt: "2026-09-25T10:00:30.000Z" } },
  });
  scanned(me);
  await sleep(5);
  assert.deepEqual(authorized, [me]);
});

test("QR + двухэтапная проверка: неверный пароль — отказ без повтора, верный — вход", async () => {
  let attempts = 0;
  const port = createFakePort({
    qrLogin: async (onQr) => {
      onQr("tg://login?token=AAEC", new Date());
      await sleep(5);
      throw new PasswordNeeded("кот");
    },
    checkPassword: async (password) => {
      attempts += 1;
      if (password !== "верный") throw rpc("PASSWORD_HASH_INVALID");
      return me;
    },
  });
  const { value, states, authorized } = host(port);
  const flow = createLoginFlow(value);
  await flow.step("start", "");
  await sleep(20);
  assert.equal(states.at(-1)?.state, "awaitingPassword");
  assert.equal(states.at(-1)?.extra?.reason, "Нужен пароль двухэтапной проверки (подсказка: кот)");
  assert.deepEqual(await flow.step("password", "неверный"), { ok: false, retryable: false, error: "Неверный пароль" });
  assert.equal(states.at(-1)?.extra?.reason, "Неверный пароль — попробуйте ещё раз");
  assert.deepEqual(await flow.step("password", "верный"), { ok: true, result: { state: "connected" } });
  assert.equal(attempts, 2);
  assert.deepEqual(authorized, [me]);
});

test("по номеру: код, неверный код, пароль", async () => {
  const port = createFakePort({
    signIn: async (_phone, hash, code) => {
      assert.equal(hash, "hash-1");
      if (code === "00000") throw rpc("PHONE_CODE_INVALID");
      throw new PasswordNeeded("");
    },
  });
  const { value, states, authorized } = host(port);
  const flow = createLoginFlow(value);
  assert.deepEqual(await flow.step("code", "12345"), { ok: false, retryable: false, error: "Сначала запросите код по номеру телефона" });
  assert.deepEqual(await flow.step("phone", "+79990000000"), { ok: true, result: { state: "awaitingCode" } });
  assert.deepEqual(await flow.step("code", "00000"), { ok: false, retryable: false, error: "Неверный код" });
  assert.deepEqual(await flow.step("code", "12345"), { ok: true, result: { state: "awaitingPassword" } });
  assert.deepEqual(await flow.step("password", "верный"), { ok: true, result: { state: "connected" } });
  assert.deepEqual(states.map((item) => item.state), ["awaitingCode", "awaitingCode", "awaitingPassword"]);
  assert.equal(authorized.length, 1);
});

test("подключённый канал заново не входит; нет связи — ошибка и понятная причина", async () => {
  const connected = host(createFakePort(), true);
  assert.deepEqual(await createLoginFlow(connected.value).step("start", ""), {
    ok: false,
    retryable: false,
    error: "Канал уже подключён — сначала выйдите",
  });
  const offline = host(async () => {
    throw new Error("Нет связи с Telegram — проверьте прокси");
  });
  const outcome = await createLoginFlow(offline.value).step("phone", "+79990000000");
  assert.equal(outcome.ok, false);
  assert.equal(offline.states.at(-1)?.state, "error");
});

test("Telegram не выдал QR вовремя — отказ, клиент входа закрыт", async () => {
  const port = createFakePort({ qrLogin: () => new Promise<TgUser>(() => {}) });
  const { value, states, discarded } = host(port);
  const outcome = await createLoginFlow(value).step("start", "");
  assert.equal(outcome.ok, false);
  assert.equal(states.at(-1)?.state, "error");
  assert.deepEqual(discarded, [port]);
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/login.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/login.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/login.ts`:

```ts
import type { ChannelState, JobOutcome } from "../backend/types.ts";
import { messageOf } from "../util/async.ts";
import { rpcNameOf } from "./classify.ts";
import type { LoginStep } from "./payloads.ts";
import { PasswordNeeded, type TgPort } from "./port.ts";
import type { TgUser } from "./types.ts";

/**
 * Вход в корпоративный аккаунт по шагам — заданиями `login {step, value}`
 * (backend/controllers/channel.js). Состояние видно в настройках через
 * события `channel.state`:
 *
 *   start    → свежий клиент, QR-код (tg://login?token=…, новый раз в ~30 с) — awaitingQr
 *   phone    → код в Telegram на телефон аккаунта — awaitingCode
 *   code     → вход; нужна двухэтапная проверка — awaitingPassword
 *   password → вход
 *
 * Неверный код или пароль — отказ задания без повторов (повтор тем же
 * паролем бессмысленен и похож на перебор) и то же состояние с причиной.
 */
export type StateExtra = { reason?: string; login?: { qr: string; expiresAt: string } };

export type LoginHost = {
  isConnected(): boolean;
  /** Новый клиент с пустой сессией и прокси канала, уже на связи. */
  freshPort(): Promise<TgPort>;
  emit(state: ChannelState, extra?: StateExtra): void;
  authorized(port: TgPort, me: TgUser): Promise<void>;
  discard(port: TgPort): Promise<void>;
  qrWaitMs?: number;
};

export type LoginFlow = {
  step(step: LoginStep, value: string): Promise<JobOutcome>;
  cancel(): Promise<void>;
};

type Pending = {
  port: TgPort;
  generation: number;
  awaiting: "qr" | "code" | "password";
  phone?: string;
  phoneCodeHash?: string;
};

const refuse = (error: string): JobOutcome => ({ ok: false, retryable: false, error });

const passwordReason = (hint: string): string =>
  hint ? `Нужен пароль двухэтапной проверки (подсказка: ${hint})` : "Нужен пароль двухэтапной проверки";

const LOGIN_ERRORS: Record<string, string> = {
  PHONE_NUMBER_INVALID: "Неверный номер телефона",
  PHONE_NUMBER_BANNED: "Номер заблокирован в Telegram",
  PHONE_NUMBER_UNOCCUPIED: "Номер не зарегистрирован в Telegram",
  PHONE_CODE_EXPIRED: "Код истёк — запросите новый",
  PHONE_CODE_INVALID: "Неверный код",
  PASSWORD_HASH_INVALID: "Неверный пароль",
  API_ID_INVALID: "Неверные api_id / api_hash канала",
  AUTH_TOKEN_EXPIRED: "QR-код истёк — начните вход заново",
  FLOOD: "Слишком много попыток входа — подождите и повторите",
};

export const loginErrorText = (error: unknown): string => {
  const name = rpcNameOf(error);
  return (name && LOGIN_ERRORS[name]) || `Вход не удался: ${name ?? messageOf(error)}`;
};

export const createLoginFlow = (host: LoginHost): LoginFlow => {
  let pending: Pending | null = null;
  let generation = 0;

  const reset = async (): Promise<void> => {
    const current = pending;
    pending = null;
    generation += 1;
    if (current) await host.discard(current.port);
  };

  const fail = async (error: unknown): Promise<JobOutcome> => {
    await reset();
    const text = loginErrorText(error);
    host.emit("error", { reason: text });
    return refuse(text);
  };

  const start = async (): Promise<JobOutcome> => {
    await reset();
    let port: TgPort;
    try {
      port = await host.freshPort();
    } catch (error) {
      return fail(error);
    }
    const mine = generation;
    pending = { port, generation: mine, awaiting: "qr" };
    let shown: () => void = () => {};
    const firstQr = new Promise<"qr">((resolve) => {
      shown = () => resolve("qr");
    });
    const flow = port
      .qrLogin((url, expiresAt) => {
        if (generation !== mine) return;
        host.emit("awaitingQr", { login: { qr: url, expiresAt: expiresAt.toISOString() } });
        shown();
      })
      .then(
        async (me): Promise<"done"> => {
          if (generation !== mine) return "done";
          pending = null;
          await host.authorized(port, me);
          return "done";
        },
        async (error: unknown): Promise<"done"> => {
          if (generation !== mine) return "done";
          if (error instanceof PasswordNeeded) {
            pending = { port, generation: mine, awaiting: "password" };
            host.emit("awaitingPassword", { reason: passwordReason(error.hint) });
            return "done";
          }
          await fail(error);
          return "done";
        },
      );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), host.qrWaitMs ?? 20_000);
    });
    const first = await Promise.race([firstQr, flow, timeout]);
    clearTimeout(timer);
    if (first === "qr") return { ok: true, result: { state: "awaitingQr" } };
    if (first === "timeout") return fail(new Error("Telegram не выдал QR-код — проверьте связь и прокси"));
    if (host.isConnected()) return { ok: true, result: { state: "connected" } };
    if (pending?.awaiting === "password") return { ok: true, result: { state: "awaitingPassword" } };
    return refuse("Вход по QR-коду не удался");
  };

  const phone = async (number: string): Promise<JobOutcome> => {
    await reset();
    let port: TgPort;
    try {
      port = await host.freshPort();
    } catch (error) {
      return fail(error);
    }
    const mine = generation;
    pending = { port, generation: mine, awaiting: "code" };
    try {
      const { phoneCodeHash } = await port.sendCode(number);
      if (generation !== mine) return refuse("Вход перезапущен");
      pending = { port, generation: mine, awaiting: "code", phone: number, phoneCodeHash };
      host.emit("awaitingCode", { reason: "Код отправлен в Telegram на телефон аккаунта" });
      return { ok: true, result: { state: "awaitingCode" } };
    } catch (error) {
      return fail(error);
    }
  };

  const code = async (value: string): Promise<JobOutcome> => {
    const current = pending;
    if (!current || current.awaiting !== "code" || !current.phone || !current.phoneCodeHash) {
      return refuse("Сначала запросите код по номеру телефона");
    }
    try {
      const me = await current.port.signIn(current.phone, current.phoneCodeHash, value);
      pending = null;
      await host.authorized(current.port, me);
      return { ok: true, result: { state: "connected" } };
    } catch (error) {
      if (error instanceof PasswordNeeded) {
        current.awaiting = "password";
        host.emit("awaitingPassword", { reason: passwordReason(error.hint) });
        return { ok: true, result: { state: "awaitingPassword" } };
      }
      if (rpcNameOf(error) === "PHONE_CODE_INVALID") {
        host.emit("awaitingCode", { reason: "Неверный код — попробуйте ещё раз" });
        return refuse("Неверный код");
      }
      return fail(error);
    }
  };

  const password = async (value: string): Promise<JobOutcome> => {
    const current = pending;
    if (!current || current.awaiting !== "password") return refuse("Пароль сейчас не запрашивался");
    try {
      const me = await current.port.checkPassword(value);
      pending = null;
      await host.authorized(current.port, me);
      return { ok: true, result: { state: "connected" } };
    } catch (error) {
      if (rpcNameOf(error) === "PASSWORD_HASH_INVALID") {
        host.emit("awaitingPassword", { reason: "Неверный пароль — попробуйте ещё раз" });
        return refuse("Неверный пароль");
      }
      return fail(error);
    }
  };

  return {
    async step(step, value) {
      if (host.isConnected()) return refuse("Канал уже подключён — сначала выйдите");
      switch (step) {
        case "start":
          return start();
        case "phone":
          return phone(value);
        case "code":
          return code(value);
        case "password":
          return password(value);
      }
    },
    cancel: reset,
  };
};
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/login.test.ts`

Expected: PASS — summary `tests 5` · `pass 5` · `fail 0`.

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 114` · `pass 114` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 14: Channel runtime and the Telegram adapter

**Files:**
- Create: `msg-gateway/src/telegram/runtime.ts`, `msg-gateway/src/telegram/adapter.ts`
- Test: `msg-gateway/src/telegram/runtime.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–13: `SessionStore`, `Journal`, `SentStore`, `ChatStore`, `RateLimiter`, `createInbound`, `createLoginFlow`, `baseline`, `gapCheck`, `importHistory`, `runSend`, `createTracker`, the payload parsers, `accountOf`, `mediaRef`, `stateEvent`, `classifyTgError`, `outcomeOf`, `rpcNameOf`, `NetworkAdapter`.
- Produces: `type MakePort = (options: {channel: GatewayChannel; session: string; probe?: boolean}) => TgPort` (implemented by `makeGramPort`, Task 9); `RuntimeDeps = {channel, makePort, sessions, chats, sent, journal, limiter, wakePump, downloadMedia, uploadMedia, gapCheckMs, now?}`; `TelegramRuntime = {channelId; start(); update(channel); runJob(job): Promise<JobOutcome>; stop(); status(): string}`; `createRuntime(deps): TelegramRuntime`; `createTelegramAdapter(deps: Omit<RuntimeDeps, "channel" | "limiter">): NetworkAdapter`.

Job types handled: `send`, `markRead` (`messages.ReadHistory` up to `upToExternalId`), `fetchMedia`, `loadHistory`, `login`, `logout`, `testProxy`. Changing API id/hash or the proxy reconnects; other settings apply on the fly.

- [ ] **Step 1: Write the failing test**

Create `msg-gateway/src/telegram/runtime.test.ts`:

```ts
// node --test src/telegram/runtime.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { GatewayEvent, GatewayJob, StateEvent } from "../backend/types.ts";
import { createBox } from "../crypto/box.ts";
import { createChatStore } from "../store/chats.ts";
import { openDatabase } from "../store/db.ts";
import { createJournal } from "../store/journal.ts";
import { createSentStore } from "../store/sent.ts";
import { createSessionStore } from "../store/sessions.ts";
import { createFakePort, type FakePort } from "../testing/fakePort.ts";
import { CHANNEL_ID, CLIENT_ID, gatewayChannel, SELF_ID, tgItem, tgUser } from "../testing/fixtures.ts";
import { sleep } from "../util/async.ts";
import { createRateLimiter } from "../util/rateLimit.ts";
import { PasswordNeeded } from "./port.ts";
import { createRuntime, type MakePort } from "./runtime.ts";

const box = createBox(Buffer.alloc(32, 4), "https://hd.example.com");

const setup = ({
  channel = gatewayChannel(),
  session = "",
  ports = [createFakePort()] as FakePort[],
  db = openDatabase(":memory:"),
} = {}) => {
  const journal = createJournal(db, box);
  const sessions = createSessionStore(db, box);
  if (session) sessions.save(CHANNEL_ID, session);
  const made: { session: string; probe: boolean }[] = [];
  const makePort: MakePort = ({ session: value, probe }) => {
    made.push({ session: value, probe: Boolean(probe) });
    const port = ports.shift();
    if (!port) throw new Error("no more fake ports");
    return port;
  };
  const runtime = createRuntime({
    channel,
    makePort,
    sessions,
    chats: createChatStore(db),
    sent: createSentStore(db),
    journal,
    limiter: createRateLimiter({ perChatMs: 0 }),
    wakePump: () => undefined,
    downloadMedia: async () => Buffer.from("file"),
    uploadMedia: async (file) => ({ name: "msg-1.jpg", originalName: file.originalName, mimetype: file.mimetype, size: file.data.length }),
    gapCheckMs: 3_600_000,
  });
  const events = () => journal.head(100).map((row) => row.event);
  const states = () => events().filter((event): event is StateEvent => event.type === "channel.state").map((event) => event.state);
  return { runtime, sessions, journal, made, events, states };
};

const job = (type: GatewayJob["type"], payload: Record<string, unknown> = {}, id = "64f600000000000000000abc"): GatewayJob => ({
  id,
  type,
  channelId: CHANNEL_ID,
  conversationId: null,
  messageId: null,
  attempt: 0,
  payload,
});

const client = tgUser(CLIENT_ID);

test("есть сессия: подключаемся, сообщаем «подключён» с аккаунтом, делаем базовую линию", async () => {
  const port = createFakePort();
  port.dialogList = [{ chatId: CLIENT_ID, peerKind: "user", user: client, topId: 10, topDate: 1 }];
  const { runtime, made, events } = setup({ session: "saved-session", ports: [port] });
  await runtime.start();
  await sleep(5);
  assert.deepEqual(made, [{ session: "saved-session", probe: false }]);
  assert.equal(runtime.status(), "connected");
  const connected = events().find((event) => event.type === "channel.state");
  assert.deepEqual(connected?.type === "channel.state" ? connected.account : null, {
    externalId: SELF_ID,
    displayName: "Поддержка F1Lab",
    username: "f1lab",
    phone: "+79990000000",
  });
  await runtime.stop();
});

test("сессии нет: канал ждёт входа; висевший «подключён» в HD поправляется", async () => {
  const quiet = setup();
  await quiet.runtime.start();
  assert.equal(quiet.runtime.status(), "idle");
  assert.deepEqual(quiet.states(), []);
  const stale = setup({ channel: gatewayChannel({ state: "connected" }) });
  await stale.runtime.start();
  assert.deepEqual(stale.states(), ["disconnected"]);
});

test("сессию завершили на телефоне: удаляем её и сообщаем loggedOut", async () => {
  const port = createFakePort({
    ping: async () => {
      throw Object.assign(new Error("401"), { errorMessage: "AUTH_KEY_UNREGISTERED", code: 401 });
    },
  });
  const { runtime, sessions, states } = setup({ session: "revoked", ports: [port] });
  await runtime.start();
  assert.deepEqual(states(), ["loggedOut"]);
  assert.deepEqual(sessions.load(CHANNEL_ID), { ok: false, reason: "none" });
  assert.equal(port.destroyed, true);
});

test("сессия с чужой установки не поднимается", async () => {
  const db = openDatabase(":memory:");
  createSessionStore(db, createBox(Buffer.alloc(32, 4), "https://prod.example.com")).save(CHANNEL_ID, "prod-session");
  const { runtime, made, states } = setup({ db });
  await runtime.start();
  assert.deepEqual(states(), ["error"]);
  assert.equal(made.length, 0);
});

test("живое сообщение клиента попадает в журнал; ответ из HD уходит в Telegram", async () => {
  const port = createFakePort();
  const { runtime, events } = setup({ session: "saved", ports: [port] });
  await runtime.start();
  await sleep(5);
  port.handlers?.message(tgItem(11, { text: "Не работает касса" }));
  await sleep(5);
  const inbound = events().find((event): event is Extract<GatewayEvent, { type: "message" }> => event.type === "message");
  assert.equal(inbound?.message.text, "Не работает касса");
  const outcome = await runtime.runJob(job("send", { chatId: CLIENT_ID, kind: "direct", text: "Смотрим", attachments: [] }));
  assert.deepEqual(outcome, { ok: true, result: { externalId: "1001", externalIds: ["1001"] } });
  assert.equal(port.delivered[0]?.text, "Смотрим");
  await runtime.stop();
});

test("без подключения задания отправки ждут: «повторите»", async () => {
  const { runtime } = setup();
  await runtime.start();
  assert.deepEqual(await runtime.runJob(job("send", { chatId: CLIENT_ID, text: "Смотрим" })), {
    ok: false,
    retryable: true,
    error: "Канал не подключён к Telegram",
  });
});

test("вход по QR с паролем через задания; после входа сессия сохранена", async () => {
  const port = createFakePort({
    qrLogin: async (onQr) => {
      onQr("tg://login?token=AAEC", new Date("2026-09-25T10:00:30Z"));
      await sleep(5);
      throw new PasswordNeeded("");
    },
  });
  port.session = "new-session";
  const { runtime, sessions, states } = setup({ ports: [port] });
  await runtime.start();
  assert.deepEqual(await runtime.runJob(job("login", { step: "start", value: null })), { ok: true, result: { state: "awaitingQr" } });
  await sleep(20);
  assert.deepEqual(await runtime.runJob(job("login", { step: "password", value: "секрет" }, "64f600000000000000000abd")), {
    ok: true,
    result: { state: "connected" },
  });
  await sleep(5);
  assert.equal(runtime.status(), "connected");
  assert.deepEqual(sessions.load(CHANNEL_ID), { ok: true, session: "new-session" });
  assert.deepEqual(states(), ["connected"]);
  await runtime.stop();
});

test("выход: logOut в Telegram, сессия удалена, loggedOut", async () => {
  let loggedOut = false;
  const port = createFakePort({ logOut: async () => void (loggedOut = true) });
  const { runtime, sessions, states } = setup({ session: "saved", ports: [port] });
  await runtime.start();
  await sleep(5);
  assert.deepEqual(await runtime.runJob(job("logout")), { ok: true, result: { state: "loggedOut" } });
  assert.equal(loggedOut, true);
  assert.deepEqual(sessions.load(CHANNEL_ID), { ok: false, reason: "none" });
  assert.equal(states().at(-1), "loggedOut");
});

test("смена прокси в настройках — переподключение новым клиентом", async () => {
  const first = createFakePort();
  const second = createFakePort();
  const { runtime, made } = setup({ session: "saved", ports: [first, second] });
  await runtime.start();
  await runtime.update(gatewayChannel({ settings: { ...gatewayChannel().settings, proxyUrl: "socks5://10.0.0.5:1080" } }));
  await sleep(5);
  assert.equal(made.length, 2);
  assert.equal(first.destroyed, true);
  assert.equal(runtime.status(), "connected");
  // Смена прочих настроек — без переподключения
  await runtime.update(gatewayChannel({ settings: { ...gatewayChannel().settings, proxyUrl: "socks5://10.0.0.5:1080", maxMediaMb: 10 } }));
  assert.equal(made.length, 2);
  await runtime.stop();
});

test("проверка прокси: связь есть / ответ Telegram / связи нет", async () => {
  const ok = setup({ ports: [createFakePort()] });
  const reached = await ok.runtime.runJob(job("testProxy"));
  assert.equal(reached.ok && (reached.result as { reachable: boolean }).reachable, true);
  assert.equal(reached.ok && typeof (reached.result as { latencyMs: unknown }).latencyMs, "number");
  assert.deepEqual(ok.made, [{ session: "", probe: true }]);

  const answered = setup({
    ports: [createFakePort({ connect: async () => { throw Object.assign(new Error("400"), { errorMessage: "API_ID_INVALID", code: 400 }); } })],
  });
  const note = await answered.runtime.runJob(job("testProxy"));
  assert.equal(note.ok && (note.result as { note: string }).note, "API_ID_INVALID");

  const dead = setup({ ports: [createFakePort({ connect: async () => false })] });
  assert.deepEqual(await dead.runtime.runJob(job("testProxy")), {
    ok: false,
    retryable: false,
    error: "Telegram недоступен через этот прокси",
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/runtime.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/telegram/runtime.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/telegram/runtime.ts`:

```ts
import { createHash } from "node:crypto";

import type { ChannelState, GatewayChannel, GatewayJob, JobOutcome, StoredMedia } from "../backend/types.ts";
import { logger } from "../logger.ts";
import type { ChatStore } from "../store/chats.ts";
import type { Journal } from "../store/journal.ts";
import type { SentStore } from "../store/sent.ts";
import type { SessionStore } from "../store/sessions.ts";
import { messageOf, withTimeout } from "../util/async.ts";
import type { RateLimiter } from "../util/rateLimit.ts";
import { classifyTgError, outcomeOf, rpcNameOf, type TgFailure } from "./classify.ts";
import { createInbound } from "./inbound.ts";
import { createLoginFlow, type StateExtra } from "./login.ts";
import { accountOf, mediaRef, stateEvent } from "./normalize.ts";
import { parseDays, parseFetchMedia, parseLogin, parseMarkRead, parseSend } from "./payloads.ts";
import type { TgPort } from "./port.ts";
import { runSend } from "./sender.ts";
import { baseline, DIALOGS_LIMIT, gapCheck, importHistory, type SyncDeps } from "./sync.ts";
import { createTracker } from "./tracker.ts";
import { isFileMedia, type InputPeer, type TgUser } from "./types.ts";

/**
 * Один канал Telegram: сессия, клиент, обработчики, задания. Состояние
 * канала в HD меняется только событиями `channel.state` через журнал.
 */
export type MakePort = (options: { channel: GatewayChannel; session: string; probe?: boolean }) => TgPort;

export type RuntimeDeps = {
  channel: GatewayChannel;
  makePort: MakePort;
  sessions: SessionStore;
  chats: ChatStore;
  sent: SentStore;
  journal: Journal;
  limiter: RateLimiter;
  wakePump: () => void;
  downloadMedia: (name: string) => Promise<Buffer>;
  uploadMedia: (file: { data: Buffer; originalName: string; mimetype: string }) => Promise<StoredMedia>;
  gapCheckMs: number;
  now?: () => number;
};

export type TelegramRuntime = {
  readonly channelId: string;
  start(): Promise<void>;
  update(channel: GatewayChannel): Promise<void>;
  runJob(job: GatewayJob): Promise<JobOutcome>;
  stop(): Promise<void>;
  status(): string;
};

const HARD_MAX_BYTES = 200 * 1024 * 1024;
const LOST_REPORT_MS = 60_000;
const RETRY_MS = [30_000, 60_000, 120_000, 300_000];

/** Смена ключей API или прокси требует нового подключения; прочие настройки — на лету. */
const connectionKey = (channel: GatewayChannel): string =>
  createHash("sha256")
    .update([channel.secrets.tgApiId, channel.secrets.tgApiHash, channel.settings.proxyUrl, channel.secrets.proxyPassword].join("\n"))
    .digest("hex");

export const createRuntime = (deps: RuntimeDeps): TelegramRuntime => {
  const channelId = deps.channel.id;
  const now = deps.now ?? Date.now;
  let channel = deps.channel;
  let port: TgPort | null = null;
  let me: TgUser | null = null;
  let status: "idle" | "connecting" | "connected" | "stopped" = "idle";
  let retries = 0;
  let retryTimer: NodeJS.Timeout | undefined;
  let gapTimer: NodeJS.Timeout | undefined;
  let lostTimer: NodeJS.Timeout | undefined;
  let reportedDown = false;
  const tracker = createTracker();

  const emit = (state: ChannelState, extra: StateExtra & { account?: ReturnType<typeof accountOf> } = {}): void => {
    deps.journal.pushState(stateEvent(channelId, state, extra));
    deps.wakePump();
  };

  const warn = (message: string, error: unknown): void =>
    logger.warn(message, { channelId, error: messageOf(error) });

  const inbound = createInbound({
    channelId,
    selfId: () => me?.id ?? "",
    settings: () => ({ ignoredChatIds: channel.settings.ignoredChatIds, maxMediaMb: channel.settings.maxMediaMb }),
    journal: deps.journal,
    sent: deps.sent,
    chats: deps.chats,
    tracker,
    download: (handle, maxBytes) => (port ? port.download(handle, maxBytes) : Promise.reject(new Error("Нет связи с Telegram"))),
    wake: deps.wakePump,
    now,
  });

  const syncDeps: SyncDeps = {
    channelId,
    port: () => port,
    inbound,
    chats: deps.chats,
    selfId: () => me?.id ?? "",
    settings: () => ({ ignoredChatIds: channel.settings.ignoredChatIds }),
    now,
  };

  const clearTimers = (): void => {
    clearTimeout(retryTimer);
    clearTimeout(gapTimer);
    clearTimeout(lostTimer);
  };

  const sessionLost = (failure: Extract<TgFailure, { kind: "session" }>): void => {
    const lost = port;
    port = null;
    me = null;
    status = "idle";
    clearTimers();
    if (lost) void lost.destroy().catch(() => undefined);
    deps.sessions.remove(channelId);
    const reason =
      failure.state === "banned"
        ? "Аккаунт заблокирован в Telegram"
        : failure.state === "error"
          ? "Сессия используется в другом месте — войдите заново"
          : "Сессию завершили в Telegram — войдите заново";
    logger.warn("Telegram session lost", { channelId, error: failure.error });
    emit(failure.state, { reason: `${reason} (${failure.error})` });
  };

  const handleFailure = (message: string, error: unknown): void => {
    const failure = classifyTgError(error);
    if (failure.kind === "session") sessionLost(failure);
    else warn(message, error);
  };

  const scheduleGap = (): void => {
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => {
      void runGap().finally(() => {
        if (status === "connected") scheduleGap();
      });
    }, deps.gapCheckMs);
  };

  const runGap = async (): Promise<void> => {
    if (status !== "connected") return;
    try {
      const found = await gapCheck(syncDeps);
      if (found.messages) logger.info("Gap check recovered messages", { channelId, ...found });
    } catch (error) {
      handleFailure("Gap check failed", error);
    }
  };

  const onConnection = (state: "connected" | "disconnected" | "broken"): void => {
    if (status !== "connected") return;
    if (state === "connected") {
      clearTimeout(lostTimer);
      lostTimer = undefined;
      if (reportedDown && me) emit("connected", { account: accountOf(me) });
      reportedDown = false;
      void runGap();
      return;
    }
    if (lostTimer) return;
    // Короткие обрывы GramJS чинит сам; о долгом — сказать в настройках
    lostTimer = setTimeout(() => {
      reportedDown = true;
      emit("error", { reason: "Нет связи с Telegram — переподключаемся" });
    }, LOST_REPORT_MS);
  };

  /** Первая сверка после подключения: базовая линия (+ история) для нового аккаунта, иначе — пропуски. */
  const initialSync = async (fresh: boolean): Promise<void> => {
    try {
      if (fresh || !deps.chats.baselineDone(channelId)) {
        await baseline(syncDeps);
        const days = channel.settings.historyDays;
        if (days > 0) {
          const found = await importHistory(syncDeps, days);
          logger.info("History imported", { channelId, ...found });
        }
      } else {
        await gapCheck(syncDeps);
      }
    } catch (error) {
      handleFailure("Initial sync failed", error);
    }
    if (status === "connected") scheduleGap();
  };

  const goLive = (live: TgPort, user: TgUser): void => {
    port = live;
    me = user;
    status = "connected";
    retries = 0;
    deps.sessions.save(channelId, live.saveSession());
    const account = deps.chats.bindAccount(channelId, user.id);
    emit("connected", { account: accountOf(user) });
    live.listen({
      message: (item) => void inbound.handle(item, "live").catch((error) => warn("Inbound message failed", error)),
      edited: (item) => void inbound.handleEdit(item).catch((error) => warn("Inbound edit failed", error)),
      deleted: (ids, inChannel) => inbound.handleDeleted(ids, inChannel),
      readOutbox: (chatId, peerKind, maxId) =>
        void inbound.handleReadOutbox(chatId, peerKind, maxId).catch((error) => warn("Read receipt failed", error)),
      connection: onConnection,
    });
    // Сверка — в фоне: задание входа не должно ждать сотни диалогов и FLOOD_WAIT
    void initialSync(account === "changed");
  };

  const scheduleRetry = (): void => {
    clearTimeout(retryTimer);
    const delay = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)] ?? 300_000;
    retries += 1;
    retryTimer = setTimeout(() => void connectExisting(), delay);
  };

  const connectExisting = async (): Promise<void> => {
    if (status === "stopped" || status === "connected") return;
    const loaded = deps.sessions.load(channelId);
    if (!loaded.ok) {
      status = "idle";
      if (loaded.reason === "foreign") {
        emit("error", { reason: "Сессия создана другой установкой (другой APP_PUBLIC_URL или ключ) — войдите заново" });
      } else if (!["disconnected", "loggedOut", "banned"].includes(channel.state)) {
        emit("disconnected", { reason: "Сессии нет — подключите канал" });
      }
      return;
    }
    status = "connecting";
    let live: TgPort;
    try {
      live = deps.makePort({ channel, session: loaded.session });
    } catch (error) {
      // Кривой прокси или пустые api_id/api_hash — чинится в настройках, не повтором
      status = "idle";
      emit("error", { reason: messageOf(error) });
      return;
    }
    try {
      if (!(await live.connect())) throw new Error("Нет связи с Telegram — проверьте прокси");
      await live.ping();
      const user = await live.me();
      if (status !== "connecting") {
        await live.destroy();
        return;
      }
      goLive(live, user);
    } catch (error) {
      await live.destroy().catch(() => undefined);
      const failure = classifyTgError(error);
      if (failure.kind === "session") {
        sessionLost(failure);
        return;
      }
      status = "idle";
      warn("Telegram connect failed", error);
      emit("error", { reason: messageOf(error) });
      scheduleRetry();
    }
  };

  const login = createLoginFlow({
    isConnected: () => status === "connected",
    freshPort: async () => {
      const fresh = deps.makePort({ channel, session: "" });
      if (!(await fresh.connect())) {
        await fresh.destroy().catch(() => undefined);
        throw new Error("Нет связи с Telegram — проверьте прокси");
      }
      return fresh;
    },
    emit,
    authorized: async (live, user) => goLive(live, user),
    discard: async (stale) => {
      if (stale !== port) await stale.destroy().catch(() => undefined);
    },
  });

  const resolvePeer = async (chatId: string): Promise<InputPeer | null> => {
    const known = deps.chats.peer(channelId, chatId);
    if (known) return { userId: chatId, accessHash: known.accessHash };
    if (!port) return null;
    // Собеседника не помним (том шлюза новый) — ищем среди диалогов аккаунта
    for (const dialog of await port.dialogs(DIALOGS_LIMIT)) {
      if (dialog.user) deps.chats.rememberPeer(channelId, dialog.user);
    }
    const found = deps.chats.peer(channelId, chatId);
    return found ? { userId: chatId, accessHash: found.accessHash } : null;
  };

  const requireLive = (): TgPort | null => (status === "connected" ? port : null);
  const offline: JobOutcome = { ok: false, retryable: true, error: "Канал не подключён к Telegram" };
  const malformed: JobOutcome = { ok: false, retryable: false, error: "Задание без нужных полей" };

  const logout = async (): Promise<JobOutcome> => {
    await login.cancel();
    const live = port;
    port = null;
    me = null;
    status = "idle";
    clearTimers();
    if (live) {
      await live.logOut().catch((error) => warn("Telegram logout failed", error));
      await live.destroy().catch(() => undefined);
    }
    deps.sessions.remove(channelId);
    emit("loggedOut", { reason: "Выход выполнен из HD" });
    return { ok: true, result: { state: "loggedOut" } };
  };

  // Итог читает окно настроек (P1b): «✓ Прокси отвечает · {latencyMs} мс»
  const testProxy = async (): Promise<JobOutcome> => {
    const started = now();
    let probe: TgPort;
    try {
      probe = deps.makePort({ channel, session: "", probe: true });
    } catch (error) {
      return { ok: false, retryable: false, error: messageOf(error) };
    }
    try {
      const reachable = await withTimeout(probe.connect(), 30_000, "Telegram не ответил за 30 с");
      if (!reachable) return { ok: false, retryable: false, error: "Telegram недоступен через этот прокси" };
      return { ok: true, result: { reachable: true, latencyMs: now() - started, viaProxy: Boolean(channel.settings.proxyUrl) } };
    } catch (error) {
      // Ответ Telegram (даже отказ) — значит, связь есть
      const answer = rpcNameOf(error);
      if (answer) {
        return { ok: true, result: { reachable: true, latencyMs: now() - started, viaProxy: Boolean(channel.settings.proxyUrl), note: answer } };
      }
      return { ok: false, retryable: false, error: `Telegram недоступен: ${messageOf(error)}` };
    } finally {
      await probe.destroy().catch(() => undefined);
    }
  };

  const fetchMedia = async (job: GatewayJob, live: TgPort): Promise<JobOutcome> => {
    const payload = parseFetchMedia(job.payload);
    if (!payload) return malformed;
    const peer = await resolvePeer(payload.chatId);
    if (!peer) return { ok: false, retryable: false, error: "Собеседник не найден в Telegram" };
    const item = await live.messageById(peer, payload.messageId);
    const media = item?.message.media ?? null;
    if (!item || !isFileMedia(media)) return { ok: false, retryable: false, error: "Сообщение или файл в Telegram не найдены" };
    const data = await live.download(item.handle, HARD_MAX_BYTES);
    const stored = await deps.uploadMedia({ data, originalName: media.fileName, mimetype: media.mimetype });
    return {
      ok: true,
      result: {
        attachments: [
          {
            name: stored.name,
            originalName: media.fileName,
            mimetype: media.mimetype,
            size: stored.size || data.length,
            durationSec: media.durationSec,
            status: "ready",
            externalRef: mediaRef(payload.chatId, payload.messageId),
          },
        ],
      },
    };
  };

  const runJob = async (job: GatewayJob): Promise<JobOutcome> => {
    try {
      switch (job.type) {
        case "send": {
          const payload = parseSend(job.payload);
          if (!payload) return malformed;
          return await runSend(job, payload, {
            channelId,
            port: requireLive,
            sent: deps.sent,
            chats: deps.chats,
            limiter: deps.limiter,
            tracker,
            resolvePeer,
            downloadMedia: deps.downloadMedia,
            onSessionLost: sessionLost,
          });
        }
        case "markRead": {
          const payload = parseMarkRead(job.payload);
          if (!payload) return malformed;
          const live = requireLive();
          if (!live) return offline;
          const peer = await resolvePeer(payload.chatId);
          if (!peer) return { ok: false, retryable: false, error: "Собеседник не найден в Telegram" };
          await live.readHistory(peer, payload.maxId);
          return { ok: true };
        }
        case "fetchMedia": {
          const live = requireLive();
          return live ? await fetchMedia(job, live) : offline;
        }
        case "loadHistory": {
          if (!requireLive()) return offline;
          return { ok: true, result: await importHistory(syncDeps, parseDays(job.payload)) };
        }
        case "login": {
          const payload = parseLogin(job.payload);
          if (!payload) return malformed;
          return await login.step(payload.step, payload.value);
        }
        case "logout":
          return await logout();
        case "testProxy":
          return await testProxy();
        default:
          return { ok: false, retryable: false, error: `Неизвестное задание ${String(job.type)}` };
      }
    } catch (error) {
      const failure = classifyTgError(error);
      if (failure.kind === "session") sessionLost(failure);
      return outcomeOf(failure);
    }
  };

  const restart = async (): Promise<void> => {
    const live = port;
    port = null;
    me = null;
    status = "idle";
    clearTimers();
    if (live) await live.destroy().catch(() => undefined);
    await connectExisting();
  };

  return {
    channelId,
    start: connectExisting,
    async update(next) {
      const reconnect = connectionKey(next) !== connectionKey(channel);
      channel = next;
      if (reconnect && status !== "stopped" && deps.sessions.load(channelId).ok) await restart();
    },
    runJob,
    async stop() {
      status = "stopped";
      clearTimers();
      await login.cancel();
      const live = port;
      port = null;
      if (live) await live.destroy().catch(() => undefined);
    },
    status: () => status,
  };
};
```

Create `msg-gateway/src/telegram/adapter.ts`:

```ts
import type { NetworkAdapter } from "../core/adapter.ts";
import { createRateLimiter } from "../util/rateLimit.ts";
import { createRuntime, type RuntimeDeps, type TelegramRuntime } from "./runtime.ts";

/**
 * Сеть Telegram: по рантайму на канал. Темп отправки — свой у каждого
 * канала: пределы Telegram считаются на аккаунт.
 */
export const createTelegramAdapter = (deps: Omit<RuntimeDeps, "channel" | "limiter">): NetworkAdapter => {
  const runtimes = new Map<string, TelegramRuntime>();

  return {
    network: "telegram",

    async apply(channels) {
      const seen = new Set<string>();
      for (const channel of channels) {
        seen.add(channel.id);
        const existing = runtimes.get(channel.id);
        if (existing) {
          await existing.update(channel);
          continue;
        }
        const runtime = createRuntime({ ...deps, channel, limiter: createRateLimiter() });
        runtimes.set(channel.id, runtime);
        void runtime.start();
      }
      // Канал выключили или удалили в HD — отключаемся; сессия остаётся в томе
      for (const [id, runtime] of runtimes) {
        if (seen.has(id)) continue;
        runtimes.delete(id);
        await runtime.stop();
      }
    },

    async runJob(job) {
      const runtime = runtimes.get(job.channelId);
      return runtime ? runtime.runJob(job) : { ok: false, retryable: false, error: "Канал не найден или отключён" };
    },

    channelIds: () => [...runtimes.keys()],
    status: () => [...runtimes.values()].map((runtime) => ({ channelId: runtime.channelId, state: runtime.status() })),

    async stop() {
      for (const runtime of runtimes.values()) await runtime.stop();
      runtimes.clear();
    },
  };
};
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/telegram/runtime.test.ts`

Expected: PASS — summary `tests 10` · `pass 10` · `fail 0`.


The `History imported` / `Initial sync failed` JSON lines during this test are expected (the fake port has no dialogs; one test logs out before the background sync ends).

- [ ] **Step 5: Typecheck and checkpoint**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 124` · `pass 124` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

### Task 15: Assembly — health, backup snapshot, main; local smoke run

**Files:**
- Create: `msg-gateway/src/health.ts`, `msg-gateway/src/cli/snapshot.ts`, `msg-gateway/src/main.ts`
- Test: `msg-gateway/src/health.test.ts`, `msg-gateway/src/cli/snapshot.test.ts`

**Interfaces:**
- Consumes: everything above; `makeGramPort` (Task 9); `createTelegramAdapter` (Task 14).
- Produces: `GRACE_MS = 300000`, `isHealthy({now, startedAt, backendOkAt}): boolean`, `startHealthServer(port, startedAt, report: () => HealthReport): Server`, `HealthReport = {backendOkAt, journal, channels}`; the CLI `node src/cli/snapshot.ts` (VACUUM INTO → stdout; reads `MSG_GATEWAY_DB_PATH`); the process entry `src/main.ts`.

- [ ] **Step 1: Write the failing tests**

Create `msg-gateway/src/health.test.ts`:

```ts
// node --test src/health.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { GRACE_MS, isHealthy } from "./health.ts";

test("первые 5 минут здоров всегда, потом — только при свежем ответе бэкенда", () => {
  const startedAt = 1_000_000;
  assert.equal(isHealthy({ now: startedAt + 1000, startedAt, backendOkAt: 0 }), true);
  assert.equal(isHealthy({ now: startedAt + GRACE_MS + 1, startedAt, backendOkAt: 0 }), false);
  assert.equal(isHealthy({ now: startedAt + GRACE_MS + 1, startedAt, backendOkAt: startedAt + GRACE_MS - 1000 }), true);
});
```

Create `msg-gateway/src/cli/snapshot.test.ts`:

```ts
// node --test src/cli/snapshot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../store/db.ts";

test("снимок для бэкапа: целая копия базы уходит в stdout, временный файл не остаётся", () => {
  const dir = mkdtempSync(join(tmpdir(), "msg-gateway-snapshot-"));
  try {
    const path = join(dir, "msg-gateway.db");
    const db = openDatabase(path);
    db.prepare("INSERT INTO meta (key, value) VALUES ('install', 'abc')").run();
    const script = fileURLToPath(new URL("./snapshot.ts", import.meta.url));
    const output = execFileSync(process.execPath, [script], {
      env: { ...process.env, MSG_GATEWAY_DB_PATH: path },
      stdio: ["ignore", "pipe", "ignore"],
    });
    db.close();
    const copy = join(dir, "copy.sqlite");
    writeFileSync(copy, output);
    const restored = new DatabaseSync(copy, { readOnly: true });
    assert.deepEqual({ ...(restored.prepare("SELECT value FROM meta WHERE key = 'install'").get() as object) }, { value: "abc" });
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/health.test.ts src/cli/snapshot.test.ts`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/health.ts`).

- [ ] **Step 3: Implement**

Create `msg-gateway/src/health.ts`:

```ts
import { createServer, type Server } from "node:http";

import { logger } from "./logger.ts";

/**
 * Здоровье контейнера — это связь с бэкендом (опрос заданий отвечает не
 * реже раза в 25 с). Связь с Telegram сюда НЕ входит: заблокированный
 * Telegram или вышедший аккаунт — повод для состояния канала в настройках,
 * а не для перезапуска контейнера по кругу.
 */
export const GRACE_MS = 5 * 60_000;

export const isHealthy = ({ now, startedAt, backendOkAt }: { now: number; startedAt: number; backendOkAt: number }): boolean =>
  now - startedAt < GRACE_MS || now - backendOkAt < GRACE_MS;

export type HealthReport = {
  backendOkAt: number;
  journal: number;
  channels: { channelId: string; state: string }[];
};

export const startHealthServer = (port: number, startedAt: number, report: () => HealthReport): Server => {
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const current = report();
    const healthy = isHealthy({ now: Date.now(), startedAt, backendOkAt: current.backendOkAt });
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "degraded",
        backendOkAt: current.backendOkAt || null,
        journal: current.journal,
        channels: current.channels,
      }),
    );
  });
  // Только петля: наружу шлюзу слушать нечего
  server.listen(port, "127.0.0.1", () => logger.info("Health endpoint listening", { port }));
  return server;
};
```

Create `msg-gateway/src/cli/snapshot.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createReadStream, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";

/**
 * Снимок базы шлюза в stdout — для `./deploy.sh backup`:
 *
 *   docker compose exec -T msg-gateway node src/cli/snapshot.ts > backups/…/msg-gateway.sqlite
 *
 * VACUUM INTO даёт целостную копию и при работающем шлюзе (WAL). Записи в
 * снимке остаются зашифрованными: без того же MSG_GATEWAY_ENC_KEY и
 * APP_PUBLIC_URL он бесполезен — сессия прода на чужой установке не оживёт.
 */
const source = process.env.MSG_GATEWAY_DB_PATH || "./data/msg-gateway.db";
const target = join(tmpdir(), `msg-gateway-${randomUUID()}.sqlite`);

const db = new DatabaseSync(source, { readOnly: true });
try {
  db.prepare("VACUUM INTO ?").run(target);
} finally {
  db.close();
}
try {
  await pipeline(createReadStream(target), process.stdout);
} finally {
  rmSync(target, { force: true });
}
```

Create `msg-gateway/src/main.ts`:

```ts
import { createBackendApi } from "./backend/api.ts";
import { createHttp } from "./backend/client.ts";
import { parseConfig } from "./config.ts";
import type { NetworkAdapter } from "./core/adapter.ts";
import { createChannelSync, createJobRouter, sendHeartbeat } from "./core/channels.ts";
import { createJobRunner } from "./core/jobs.ts";
import { createPump } from "./core/pump.ts";
import { createBox } from "./crypto/box.ts";
import { startHealthServer } from "./health.ts";
import { logger, setLogLevel } from "./logger.ts";
import { createChatStore } from "./store/chats.ts";
import { checkInstall, openDatabase } from "./store/db.ts";
import { createJournal } from "./store/journal.ts";
import { createSentStore } from "./store/sent.ts";
import { createSessionStore } from "./store/sessions.ts";
import { createTelegramAdapter } from "./telegram/adapter.ts";
import { makeGramPort } from "./telegram/mtproto.ts";
import { every, messageOf } from "./util/async.ts";

/**
 * Сборка шлюза: конфиг → база → бэкенд → журнал → сети → циклы → здоровье.
 * С бэкендом — только HTTP (`/api/gateway/*`, X-Gateway-Token); входящих
 * портов нет, поэтому шлюз может жить и на хосте за рубежом.
 */
const SHUTDOWN_DEADLINE_MS = 5000;
const PRUNE_EVERY_MS = 60 * 60_000;
const KEEP_MS = 30 * 24 * 60 * 60_000;

const main = async (): Promise<void> => {
  const config = parseConfig(process.env);
  setLogLevel(config.logLevel);
  logger.info("Starting msg-gateway", { backend: config.backendUrl, production: config.isProduction });

  const db = openDatabase(config.dbPath);
  const box = createBox(config.encKey, config.publicUrl);
  if (checkInstall(db, box.fingerprint) === "other") {
    logger.warn("Gateway volume was written by another installation (different key or APP_PUBLIC_URL); its sessions will not start");
  }

  const api = createBackendApi(createHttp({ baseUrl: config.backendUrl, token: config.gatewayToken }));
  const journal = createJournal(db, box);
  const chats = createChatStore(db);
  const sent = createSentStore(db);
  const startedAt = Date.now();
  let backendOkAt = 0;
  const markBackendOk = (): void => {
    backendOkAt = Date.now();
  };

  const pump = createPump({ journal, api, onBackendOk: markBackendOk });
  const telegram = createTelegramAdapter({
    makePort: makeGramPort,
    sessions: createSessionStore(db, box),
    chats,
    sent,
    journal,
    wakePump: pump.wake,
    downloadMedia: api.downloadMedia,
    uploadMedia: api.uploadMedia,
    gapCheckMs: config.gapCheckMs,
  });
  const adapters: NetworkAdapter[] = [telegram];
  const channels = createChannelSync({ api, adapters, onBackendOk: markBackendOk });
  const jobs = createJobRunner({
    api,
    networks: () => adapters.map((adapter) => adapter.network),
    run: createJobRouter({ adapters, refresh: channels.refresh }),
    onBackendOk: markBackendOk,
  });

  const controller = new AbortController();
  const { signal } = controller;
  const logLoop = (name: string) => (error: unknown) => logger.warn(`Loop "${name}" failed`, { error: messageOf(error) });

  await channels.refresh().catch(logLoop("channels"));

  const loops = [
    pump.run(signal),
    jobs.loop(signal),
    every(config.channelsRefreshMs, channels.refresh, signal, logLoop("channels")),
    every(config.heartbeatMs, () => sendHeartbeat(api, adapters), signal, logLoop("heartbeat")),
    every(
      PRUNE_EVERY_MS,
      async () => {
        const jobsPruned = sent.prune(KEEP_MS);
        const outgoingPruned = chats.prune(KEEP_MS);
        if (jobsPruned || outgoingPruned) logger.debug("Pruned local state", { jobsPruned, outgoingPruned });
      },
      signal,
      logLoop("prune"),
    ),
  ];

  const health = startHealthServer(config.healthPort, startedAt, () => ({
    backendOkAt,
    journal: journal.size(),
    channels: adapters.flatMap((adapter) => adapter.status()),
  }));

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${reason}, shutting down`);
    // Остановка ограничена по времени: что не успело — не успело
    const force = setTimeout(() => {
      logger.warn("Shutdown took too long, exiting anyway");
      process.exit(0);
    }, SHUTDOWN_DEADLINE_MS);
    controller.abort();
    await Promise.allSettled(adapters.map((adapter) => adapter.stop()));
    await Promise.allSettled(loops);
    try {
      health.close();
      db.close();
    } catch (error) {
      logger.warn("Cleanup was not clean", { error: messageOf(error) });
    }
    clearTimeout(force);
    logger.info("Stopped");
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
};

// GramJS разбирает обновления без await (client/updates.js): ошибка внутри
// библиотеки — отклонённый промис без обработчика. Процесс из-за неё не роняем
process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled rejection", { error: messageOf(reason) });
});

main().catch((error: unknown) => {
  logger.error("msg-gateway failed to start", error);
  process.exit(1);
});
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `cd /home/aleksey/projects/hd/msg-gateway && node --test src/health.test.ts src/cli/snapshot.test.ts`

Expected: PASS — summary `tests 2` · `pass 2` · `fail 0`.

- [ ] **Step 5: Typecheck and the whole suite**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test`

Expected: `tsc --noEmit` prints nothing; summary `tests 126` · `pass 126` · `fail 0`.
Checkpoint — no commit, no staging (the owner commits by hand).

- [ ] **Step 6: Smoke run against a fake backend** (sandboxed is fine: loopback ports only; nothing is written into the repo)

Run from `/home/aleksey/projects/hd/msg-gateway`:

```bash
SMOKE="$TMPDIR/msg-gateway-smoke"; rm -rf "$SMOKE"; mkdir -p "$SMOKE"
cat > "$SMOKE/backend.mjs" <<'EOF'
// Поддельный бэкенд для дымового прогона: один канал без сессии, пустые задания
import { createServer } from "node:http";
const seen = [];
const json = (res, body) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const channel = {
  id: "64f600000000000000000001",
  type: "telegram",
  name: "Поддержка",
  state: "connected",
  account: {},
  settings: { proxyUrl: "", historyDays: 14, importGroups: true, markReadOnOpen: true, maxMediaMb: 50, ignoredChatIds: [] },
  secrets: { tgApiId: "", tgApiHash: "", proxyPassword: "" },
};
createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const path = req.url.split("?")[0];
    seen.push(`${req.method} ${path} ${req.headers["x-gateway-token"] === "smoke-token" ? "token-ok" : "token-bad"}`);
    if (path === "/api/gateway/channels") return json(res, { channels: [channel] });
    if (path === "/api/gateway/jobs") {
      return setTimeout(() => json(res, { leaseId: "lease-1", leaseExpiresAt: new Date().toISOString(), jobs: [] }), 300);
    }
    if (path === "/api/gateway/events") {
      const events = JSON.parse(body).events;
      seen.push(`events ${events.map((event) => `${event.type}:${event.state ?? ""}`).join(",")}`);
      return json(res, { results: events.map(() => ({ ok: true })) });
    }
    if (path === "/api/gateway/heartbeat") return json(res, { ok: true });
    res.writeHead(404);
    res.end();
  });
}).listen(18090, "127.0.0.1");
process.on("SIGTERM", () => {
  console.log([...new Set(seen)].sort().join("\n"));
  process.exit(0);
});
EOF
node "$SMOKE/backend.mjs" > "$SMOKE/backend.log" 2>&1 & BACKEND_PID=$!
sleep 0.5
BACKEND_URL=http://127.0.0.1:18090 MSG_GATEWAY_TOKEN=smoke-token MSG_GATEWAY_ENC_KEY="$(openssl rand -base64 32)" \
  APP_PUBLIC_URL=http://localhost:3000 MSG_GATEWAY_DB_PATH="$SMOKE/data/msg-gateway.db" HEALTH_PORT=18091 HEARTBEAT_MS=1000 \
  node src/main.ts > "$SMOKE/gateway.log" 2>&1 & GATEWAY_PID=$!
sleep 3
curl -s http://127.0.0.1:18091/health; echo
MSG_GATEWAY_DB_PATH="$SMOKE/data/msg-gateway.db" node src/cli/snapshot.ts 2>/dev/null | wc -c
kill -TERM "$GATEWAY_PID"; sleep 1.5; kill -TERM "$BACKEND_PID"; sleep 0.5
grep -v -i -e experimental -e trace-warnings "$SMOKE/gateway.log"
cat "$SMOKE/backend.log"
```

Expected, in this order:
- `{"status":"ok","backendOkAt":<ms>,"journal":0,"channels":[{"channelId":"64f600000000000000000001","state":"idle"}]}`
- a byte count above 0 (about `102400`) — the snapshot CLI works on a live database;
- four gateway log lines: `Starting msg-gateway`, `Health endpoint listening`, `Received SIGTERM, shutting down`, `Stopped`;
- the fake backend's list:

```
GET /api/gateway/channels token-ok
GET /api/gateway/jobs token-ok
POST /api/gateway/events token-ok
POST /api/gateway/heartbeat token-ok
events channel.state:disconnected
```

The last line is the runtime correcting HD: the channel says `connected`, but this gateway has no session for it.

Checkpoint — no commit, no staging.

### Task 16: Container, compose, deploy and a dev run

**Files:**
- Create: `msg-gateway/Dockerfile`, `msg-gateway/.dockerignore`, `msg-gateway/README.md`
- Modify: `compose.yml`, `compose.dev.yml`, `.env.example`, `deploy.sh`, `docs/deployment.md`
- Local only (not committed, gitignored): the dev machine's `.env` gains `MSG_GATEWAY_TOKEN` and `MSG_GATEWAY_ENC_KEY`

**Interfaces:**
- Consumes: `src/main.ts`, `src/cli/snapshot.ts`, `HEALTH_PORT` 8082 (Task 15).
- Produces: compose service `msg-gateway` (profile `messengers`, volume `msg_gateway_data` → `hd_msg_gateway_data`, env `MSG_GATEWAY_TOKEN`, `MSG_GATEWAY_ENC_KEY`, `APP_PUBLIC_URL`, `BACKEND_URL=http://backend:8080`); `.env` keys `MSG_GATEWAY_ENC_KEY` (generated) and `MSG_GATEWAY` (`yes` → profile `messengers`); `deploy.sh backup` → `backups/<ts>/msg-gateway.sqlite`, `deploy.sh restore` puts it back.

- [ ] **Step 1: Image and README**

Create `msg-gateway/Dockerfile`:

```dockerfile
# msg-gateway image. Two targets:
#   dev  — `node --watch`, bind-mounted sources (compose.dev.yml)
#   prod — production deps only, runs as `node`, healthcheck built in
#
# No build step: Node executes the .ts files by stripping types. No compiler in
# the image either — state lives in the built-in `node:sqlite`, and GramJS is
# pure JavaScript (its optional native helpers are skipped by pnpm).
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

FROM base AS dev
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p data
CMD ["pnpm", "start"]

FROM base AS deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# The SQLite file lives in a volume; its mount point must belong to the user
# that runs the process, or the first write fails with EACCES.
RUN mkdir -p data && chown -R node:node /app
USER node
# Healthy = the backend answered recently; Telegram reachability is a channel
# state in Settings, not a reason to restart the container.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HEALTH_PORT||8082)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/main.ts"]
```

Create `msg-gateway/.dockerignore`:

```
node_modules
data
logs
.git
*.log
Dockerfile
.dockerignore
```

Create `msg-gateway/README.md`:

````markdown
# msg-gateway

The messenger gateway of «Диалоги». It holds the corporate accounts' sessions
(Telegram through MTProto/GramJS in this release) and talks to the HD backend
over its gateway API only (`/api/gateway/*`, header `X-Gateway-Token`). No
database connection, no incoming ports. Contract and behaviour:
`docs/messaging.md`, §6 and §9; operations: `docs/deployment.md`,
«Messengers (msg-gateway)».

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `BACKEND_URL` | yes | API base: `http://backend:8080` inside compose, `https://…` from another host |
| `MSG_GATEWAY_TOKEN` | yes | shared secret with the backend — the same value as in HD's `.env` |
| `MSG_GATEWAY_ENC_KEY` | yes | base64 of 32 bytes; encrypts sessions, the event journal and media in the volume |
| `APP_PUBLIC_URL` | yes | HD's public URL; binds the volume to this installation |
| `MSG_GATEWAY_DB_PATH` | no | SQLite file, default `./data/msg-gateway.db` |
| `HEALTH_PORT` | no | loopback `/health`, default 8082 |
| `LOG_LEVEL` | no | `error`, `warn`, `info` (default), `debug` |
| `CHANNELS_REFRESH_MS`, `HEARTBEAT_MS`, `GAP_CHECK_MS` | no | 60 s, 60 s, 5 min |

Per-channel settings — API id/hash, proxy, history depth, media limit, ignored
chats — live in HD (Settings → «Каналы связи»), not here.

## Run

Node 24+ (built-in `node:sqlite`; no build step — Node strips the types).

```
pnpm install
pnpm typecheck
pnpm test
pnpm start          # node --watch src/main.ts
```

In the HD stack: `docker compose --profile messengers up -d msg-gateway`.

On a host abroad (Telegram blocked where HD runs) the gateway needs outgoing
connections only:

```
docker build -t hd-msg-gateway --target prod .
docker run -d --name hd-msg-gateway --restart unless-stopped \
  -e BACKEND_URL=https://hd.example.com \
  -e MSG_GATEWAY_TOKEN=<value from HD's .env> \
  -e MSG_GATEWAY_ENC_KEY="$(openssl rand -base64 32)" \
  -e APP_PUBLIC_URL=https://hd.example.com \
  -v hd_msg_gateway_data:/app/data hd-msg-gateway
```

Keep the generated key: without it the volume is unreadable and every channel
logs in again. Run one gateway per installation — two copies of a session make
Telegram answer `AUTH_KEY_DUPLICATED`.

## Layout

```
src/
  main.ts          assembly: config → store → backend → journal → networks → loops → health
  config.ts        environment, fails fast with the variable's name
  health.ts        /health: healthy while the backend answers
  backend/         HTTP client and the contract types
  core/            network-agnostic: event journal pump, job runner, channels, heartbeat
  store/           node:sqlite: sessions, journal, send journal, chat watermarks
  crypto/box.ts    AES-256-GCM bound to APP_PUBLIC_URL
  telegram/        the Telegram adapter; mtproto.ts is the only module importing GramJS
  cli/snapshot.ts  VACUUM INTO snapshot to stdout (deploy.sh backup)
  testing/         fixtures and an in-memory Telegram for tests
  util/            sleep/timeouts, per-key queue, send pacing
```
````

- [ ] **Step 2: Compose files**

Edit 1 of 2 — in `compose.yml` replace exactly:

```yaml
volumes:
  # Data volumes are external: deploy.sh creates them once, and `docker compose
  # down -v` can never take them away.
```

with:

```yaml
  # Runs only when the `messengers` profile is on — deploy.sh adds it to
  # COMPOSE_PROFILES when MSG_GATEWAY=yes. Holds the corporate messenger
  # sessions of «Диалоги» (Telegram now, WhatsApp later) in its own encrypted
  # volume — never in MongoDB — and talks to the backend over the API only
  # (X-Gateway-Token), so it can also run on a host abroad instead.
  msg-gateway:
    build:
      context: ./msg-gateway
      target: prod
    profiles: [messengers]
    restart: unless-stopped
    init: true
    environment:
      MSG_GATEWAY_TOKEN: ${MSG_GATEWAY_TOKEN}
      MSG_GATEWAY_ENC_KEY: ${MSG_GATEWAY_ENC_KEY}
      APP_PUBLIC_URL: ${APP_PUBLIC_URL}
      BACKEND_URL: http://backend:8080
    volumes:
      - msg_gateway_data:/app/data
    depends_on:
      backend:
        condition: service_healthy
    logging: *logging

volumes:
  # Data volumes are external: deploy.sh creates them once, and `docker compose
  # down -v` can never take them away.
```

Edit 2 of 2 — in `compose.yml` replace exactly:

```yaml
  tg_service_data:
    name: hd_tg_service_data
```

with:

```yaml
  tg_service_data:
    name: hd_tg_service_data
  msg_gateway_data:
    name: hd_msg_gateway_data
```

Edit 1 of 2 — in `compose.dev.yml` replace exactly:

```yaml
volumes:
  hd_data:
    external: true
```

with:

```yaml
  msg-gateway:
    build:
      context: ./msg-gateway
      target: dev
    profiles: [messengers]
    volumes:
      - ./msg-gateway:/app
      - /app/node_modules
      - msg_gateway_data:/app/data
    environment:
      MSG_GATEWAY_TOKEN: ${MSG_GATEWAY_TOKEN}
      MSG_GATEWAY_ENC_KEY: ${MSG_GATEWAY_ENC_KEY}
      APP_PUBLIC_URL: ${APP_PUBLIC_URL:-http://localhost:3000}
      BACKEND_URL: http://backend:8080
    depends_on:
      - backend

volumes:
  hd_data:
    external: true
```

Edit 2 of 2 — in `compose.dev.yml` replace exactly:

```yaml
  tg_service_data:
    name: hd_tg_service_data
```

with:

```yaml
  tg_service_data:
    name: hd_tg_service_data
  msg_gateway_data:
    name: hd_msg_gateway_data
```

- [ ] **Step 3: `.env.example`**

Edit 1 of 2 — in `.env.example` replace exactly:

```bash
# Shared secret between the backend and msg-gateway (Telegram and WhatsApp
# sessions of «Диалоги»). Empty = the gateway API refuses every request.
MSG_GATEWAY_TOKEN=
```

with:

```bash
# Shared secret between the backend and msg-gateway (Telegram and WhatsApp
# sessions of «Диалоги»). Empty = the gateway API refuses every request.
MSG_GATEWAY_TOKEN=

# AES-256 key (base64, 32 bytes) of msg-gateway: encrypts the messenger sessions
# and the undelivered event journal in its own volume. Together with
# APP_PUBLIC_URL it binds that volume to this installation — a copy on another
# host starts no session. Rotating it = every messenger channel logs in again.
MSG_GATEWAY_ENC_KEY=
```

Edit 2 of 2 — in `.env.example` replace exactly:

```bash
# Telegram bot token from @BotFather. Empty = no Telegram. deploy.sh switches
# the `telegram` compose profile on when this is filled in.
TG_TOKEN=
COMPOSE_PROFILES=
```

with:

```bash
# Telegram bot token from @BotFather. Empty = no Telegram. deploy.sh switches
# the `telegram` compose profile on when this is filled in.
TG_TOKEN=
# "yes" runs msg-gateway here (corporate Telegram accounts of «Диалоги»);
# deploy.sh switches the `messengers` profile on. Empty when the gateway runs
# on another host (abroad) with BACKEND_URL pointing at this installation.
MSG_GATEWAY=
# Written by deploy.sh from the two keys above (telegram, messengers).
COMPOSE_PROFILES=
```

- [ ] **Step 4: `deploy.sh`**

Edit 1 of 9 — in `deploy.sh` replace exactly:

```bash
#   ./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
```

with:

```bash
#   ./deploy.sh backup          mongodump + uploads (+ msg-gateway snapshot) → backups/<timestamp>/
```

Edit 2 of 9 — in `deploy.sh` replace exactly:

```bash
  [ -n "$(env_get TG_API_TOKEN)" ]       || env_set TG_API_TOKEN "$(openssl rand -hex 32)"
```

with:

```bash
  [ -n "$(env_get TG_API_TOKEN)" ]       || env_set TG_API_TOKEN "$(openssl rand -hex 32)"
  [ -n "$(env_get MSG_GATEWAY_TOKEN)" ]  || env_set MSG_GATEWAY_TOKEN "$(openssl rand -hex 32)"
  [ -n "$(env_get MSG_GATEWAY_ENC_KEY)" ] || env_set MSG_GATEWAY_ENC_KEY "$(openssl rand -base64 32)"
```

Edit 3 of 9 — in `deploy.sh` replace exactly:

```bash
  ask_optional TG_TOKEN "Telegram bot token from @BotFather"
  if [ -n "$(env_get TG_TOKEN)" ]; then
    env_set COMPOSE_PROFILES telegram
  else
    env_set COMPOSE_PROFILES ""
  fi
}
```

with:

```bash
  ask_optional TG_TOKEN "Telegram bot token from @BotFather"
  ask_optional MSG_GATEWAY "Run msg-gateway here (corporate Telegram accounts of «Диалоги»)? yes/no"
  local profiles=""
  [ -n "$(env_get TG_TOKEN)" ] && profiles=telegram
  [ "$(env_get MSG_GATEWAY)" = yes ] && profiles="${profiles:+$profiles,}messengers"
  env_set COMPOSE_PROFILES "$profiles"
}
```

Edit 4 of 9 — in `deploy.sh` replace exactly:

```bash
  for service in backend frontend tg-service; do
```

with:

```bash
  for service in backend frontend tg-service msg-gateway; do
```

Edit 5 of 9 — in `deploy.sh` replace exactly:

```bash
    docker run --rm -v "$volume:/src:ro" -v "$PWD/$dir:/out" alpine tar czf "/out/$volume.tar.gz" -C /src .
  done
```

with:

```bash
    docker run --rm -v "$volume:/src:ro" -v "$PWD/$dir:/out" alpine tar czf "/out/$volume.tar.gz" -C /src .
  done
  # msg-gateway: messenger sessions and the not-yet-delivered event journal, as
  # an SQLite snapshot (VACUUM INTO). Rows stay encrypted — only this .env
  # (MSG_GATEWAY_ENC_KEY + APP_PUBLIC_URL) can read them.
  if [ -n "$(dc ps -q msg-gateway 2>/dev/null)" ]; then
    dc exec -T msg-gateway node src/cli/snapshot.ts > "$dir/msg-gateway.sqlite" \
      || { rm -f "$dir/msg-gateway.sqlite"; echo "WARNING: msg-gateway snapshot failed; the rest of the backup is fine"; }
  fi
```

Edit 6 of 9 — in `deploy.sh` replace exactly:

```bash
  dc stop backend frontend tg-service >/dev/null 2>&1 || true
  dc up -d --wait mongodb
```

with:

```bash
  dc stop backend frontend tg-service msg-gateway >/dev/null 2>&1 || true
  dc up -d --wait mongodb
```

Edit 7 of 9 — in `deploy.sh` replace exactly:

```bash
    docker run --rm -v "$volume:/dst" -v "$PWD/$dir:/in:ro" alpine sh -c \
      "tar xzf /in/$volume.tar.gz -C /dst && chown -R 1000:1000 /dst"
  done
```

with:

```bash
    docker run --rm -v "$volume:/dst" -v "$PWD/$dir:/in:ro" alpine sh -c \
      "tar xzf /in/$volume.tar.gz -C /dst && chown -R 1000:1000 /dst"
  done
  if [ -f "$dir/msg-gateway.sqlite" ]; then
    docker volume create hd_msg_gateway_data >/dev/null
    docker run --rm -v hd_msg_gateway_data:/dst -v "$PWD/$dir:/in:ro" alpine sh -c \
      "cp /in/msg-gateway.sqlite /dst/msg-gateway.db && rm -f /dst/msg-gateway.db-wal /dst/msg-gateway.db-shm && chown 1000:1000 /dst/msg-gateway.db"
  fi
```

Edit 8 of 9 — in `deploy.sh` replace exactly:

```bash
  if [ "$(env_get COMPOSE_PROFILES)" = telegram ]; then
```

with:

```bash
  if [[ ",$(env_get COMPOSE_PROFILES)," == *,telegram,* ]]; then
```

Edit 9 of 9 — in `deploy.sh` replace exactly:

```bash
      echo "         (a bot token can poll Telegram from ONE place only — stop the old bot first)"
    fi
  fi
```

with:

```bash
      echo "         (a bot token can poll Telegram from ONE place only — stop the old bot first)"
    fi
  fi
  # msg-gateway depends on the outside world too (Telegram reachability, the
  # channel's proxy): it never fails the deployment either.
  if [[ ",$(env_get COMPOSE_PROFILES)," == *,messengers,* ]]; then
    log "Starting msg-gateway"
    if ! dc up -d --wait msg-gateway; then
      echo "WARNING: msg-gateway is not healthy. The app works without it; see: ./deploy.sh logs msg-gateway"
    fi
  fi
```

- [ ] **Step 5: `docs/deployment.md`**

Edit 1 of 9 — in `docs/deployment.md` replace exactly:

```markdown
| `compose.yml` | production stack (default file): `mongodb`, `backend`, `frontend`, optional `tg-service` |
```

with:

```markdown
| `compose.yml` | production stack (default file): `mongodb`, `backend`, `frontend`, optional `tg-service` and `msg-gateway` |
```

Edit 2 of 9 — in `docs/deployment.md` replace exactly:

```markdown
./deploy.sh backup          mongodump + uploads → backups/<timestamp>/
```

with:

```markdown
./deploy.sh backup          mongodump + uploads (+ msg-gateway snapshot) → backups/<timestamp>/
```

Edit 3 of 9 — in `docs/deployment.md` replace exactly:

```markdown
| generated | `MONGODB_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_ENC_KEY`, `TG_API_TOKEN` | keep a copy with the backups — see rotation costs below |
```

with:

```markdown
| generated | `MONGODB_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_ENC_KEY`, `TG_API_TOKEN`, `MSG_GATEWAY_TOKEN`, `MSG_GATEWAY_ENC_KEY` | keep a copy with the backups — see rotation costs below |
```

Edit 4 of 9 — in `docs/deployment.md` replace exactly:

```markdown
| optional | `HTTP_PORT`, `TRUST_PROXY_HOPS`, `TG_TOKEN`, `S3_*`,
```

with:

```markdown
| optional | `HTTP_PORT`, `TRUST_PROXY_HOPS`, `TG_TOKEN`, `MSG_GATEWAY`, `S3_*`,
```

Edit 5 of 9 — in `docs/deployment.md` replace exactly:

```markdown
old name. `MONGODB_PASSWORD` — change it in MongoDB too.
```

with:

```markdown
old name. `MONGODB_PASSWORD` — change it in MongoDB too. `MSG_GATEWAY_ENC_KEY` —
msg-gateway can no longer read its volume: every messenger channel logs in
again, and events it had not delivered yet are lost.
```

Edit 6 of 9 — in `docs/deployment.md` replace exactly:

```markdown
### AI agents (MCP)
```

with:

```markdown
### Messengers (msg-gateway)

`msg-gateway` holds the corporate messenger sessions of «Диалоги» (Telegram in
this release; WhatsApp later). `deploy.sh` asks once (`MSG_GATEWAY`; `yes` =
run it on this host) and switches the `messengers` compose profile on. It
always generates `MSG_GATEWAY_TOKEN` (shared with the backend, header
`X-Gateway-Token`) and `MSG_GATEWAY_ENC_KEY` (encrypts the gateway's volume
`hd_msg_gateway_data`). Sessions never go to MongoDB, so `sync-dev-db.sh` cannot
copy one, and a copied volume starts no session either: every row is bound to
the key and to `APP_PUBLIC_URL`.

The gateway only makes outgoing connections (Telegram — directly or through the
channel's proxy — and the HD API), so it can run on a host abroad when Telegram
is blocked here: leave `MSG_GATEWAY` empty on this host and follow
`msg-gateway/README.md`. Run one gateway per installation — two copies of a
session make Telegram answer `AUTH_KEY_DUPLICATED`. An unhealthy `msg-gateway`
never blocks the deployment; its health means "the backend answers", not
"Telegram is reachable" — each channel's state is in Settings → «Каналы связи».
Behaviour and limits: `docs/messaging.md`, §9.

### AI agents (MCP)
```

Edit 7 of 9 — in `docs/deployment.md` replace exactly:

```markdown
`hd_storage.tar.gz` and a `manifest`. The last five are kept.
```

with:

```markdown
`hd_storage.tar.gz`, a `manifest` and — when msg-gateway runs —
`msg-gateway.sqlite` (an encrypted `VACUUM INTO` snapshot of its sessions and
undelivered events, readable only with the same `MSG_GATEWAY_ENC_KEY` and
`APP_PUBLIC_URL`). The last five are kept.
```

Edit 8 of 9 — in `docs/deployment.md` replace exactly:

```markdown
another name), unpacks the volumes and fixes ownership.
```

with:

```markdown
another name), unpacks the volumes (and `msg-gateway.sqlite` into
`hd_msg_gateway_data`) and fixes ownership.
```

Edit 9 of 9 — in `docs/deployment.md` replace exactly:

```markdown
   - `TICKET_COUNTER_STARTING_NUMBER`, `TG_TOKEN`, `TRUST_PROXY_HOPS=2`,
     `HTTP_PORT=127.0.0.1:8080` as needed;
```

with:

```markdown
   - `TICKET_COUNTER_STARTING_NUMBER`, `TG_TOKEN`, `TRUST_PROXY_HOPS=2`,
     `HTTP_PORT=127.0.0.1:8080` as needed;
   - `MSG_GATEWAY_ENC_KEY` and the same `APP_PUBLIC_URL` to keep the messenger
     sessions (otherwise the channels log in again); stop the old gateway
     before starting the new one;
```

- [ ] **Step 6: Static checks**

Run: `cd /home/aleksey/projects/hd && bash -n deploy.sh && echo syntax-ok`

Expected: `syntax-ok`.

Run: `cd /home/aleksey/projects/hd && docker compose -f compose.yml --profile messengers config --services && docker compose -f compose.dev.yml --profile messengers config --services`

Expected: both lists contain `msg-gateway` next to `mongodb`, `backend`, `frontend` (and `tg-service` — the dev `.env` turns the `telegram` profile on). `config` needs no Docker daemon; warnings about unset variables are fine here.

- [ ] **Step 7: Dev secrets** (the dev `.env` only — gitignored, never production; values are never printed)

Run:

```bash
cd /home/aleksey/projects/hd
for key in MSG_GATEWAY_TOKEN MSG_GATEWAY_ENC_KEY; do
  if ! grep -q "^$key=." .env; then
    if [ "$key" = MSG_GATEWAY_TOKEN ]; then value=$(openssl rand -hex 32); else value=$(openssl rand -base64 32); fi
    sed -i "/^$key=/d" .env
    printf '%s=%s\n' "$key" "$value" >> .env
    echo "added $key"
  fi
done
grep -c '^MSG_GATEWAY_' .env
```

Expected: `added MSG_GATEWAY_TOKEN`, `added MSG_GATEWAY_ENC_KEY` (or nothing, if the keys were already filled) and `2`.

- [ ] **Step 8: Recreate the dev backend with the token** (sandbox disabled — Docker socket; `.env` is read only at container creation)

Run: `cd /home/aleksey/projects/hd && docker compose up -d --force-recreate --no-deps backend && docker compose exec -T backend sh -c 'test -n "$MSG_GATEWAY_TOKEN" && echo token-set'`

Expected: `Container hd-backend-1 Started`, then `token-set`.

- [ ] **Step 9: Build and start the gateway in the dev stack** (sandbox disabled)

Run: `cd /home/aleksey/projects/hd && docker compose --profile messengers up -d --build --wait msg-gateway`

Expected: the dev image builds (`pnpm install --frozen-lockfile` inside), then `Container hd-msg-gateway-1 Started` / `Running`.

Run: `cd /home/aleksey/projects/hd && sleep 5 && docker compose logs --no-log-prefix msg-gateway | grep -v -i experimental | head -5`

Expected: JSON lines `Starting msg-gateway` (`"production":false`) and `Health endpoint listening` (`"port":8082`).

Run: `cd /home/aleksey/projects/hd && docker compose logs msg-gateway | grep -c "Job lease failed" || true`

Expected: `0` — the token matches the backend's (a 401 would log `Job lease failed … Некорректный токен`).

Run: `cd /home/aleksey/projects/hd && docker compose exec -T msg-gateway node -e "fetch('http://127.0.0.1:8082/health').then((r) => r.text()).then(console.log)"`

Expected: `{"status":"ok",…,"journal":0,"channels":[…]}` — one entry per active Telegram channel of the dev database (none is fine).

Run: `cd /home/aleksey/projects/hd && docker compose exec -T msg-gateway node src/cli/snapshot.ts > "$TMPDIR/msg-gateway-dev.sqlite" && test -s "$TMPDIR/msg-gateway-dev.sqlite" && echo snapshot-ok`

Expected: `snapshot-ok` (the same command `deploy.sh backup` runs).

- [ ] **Step 10: Build the production image** (sandbox disabled)

Run: `cd /home/aleksey/projects/hd && docker compose -f compose.yml --profile messengers build msg-gateway`

Expected: the `prod` target builds (`pnpm install --prod --frozen-lockfile`, the pnpm `Ignored build scripts` warning is fine) and the image is tagged `hd-msg-gateway`.

- [ ] **Step 11: Leave the dev stack as it was**

Run: `cd /home/aleksey/projects/hd && docker compose --profile messengers stop msg-gateway`

Expected: `Container hd-msg-gateway-1 Stopped`. (The owner starts it again for the live checks.)

Checkpoint — no commit, no staging.

### Task 17: Backend — media on request; messaging docs

**Files:**
- Create: `backend/services/messaging/media.js`
- Test: `backend/services/messaging/media.test.js`
- Modify: `backend/controllers/conversation.js`, `backend/routes/internal/conversation.js`, `docs/messaging.md`

**Interfaces:**
- Consumes: `enqueueJob` (`services/messaging/jobs.js`), `canSeeConversation` (`services/messaging/visibility.js`), `GATEWAY_NETWORKS` (`services/messaging/rules.js`), models `Message`, `Conversation`, `Channel`, `ChannelJob`; the gateway's `fetchMedia` handler (Task 14) reads `payload.chatId` and `payload.externalId`.
- Produces: `needsFetch(message): boolean`, `fetchMediaPayload(message): {chatId, externalId, attachments}`, `requestMedia({messageId, auth}): Promise<{jobId}>`; route `POST /api/messages/:id/media` → `202 {jobId}` (404 unknown/invisible, 409 nothing to fetch or channel off).

Backend conventions (P0): CommonJS; unit-tested modules require models, `utils/logger` and `middleware/errorHandling` lazily inside functions; tests run with `NODE_ENV=production` (root-owned `backend/logs` breaks the logger otherwise); `node --check` for files without tests (the backend eslint is broken).

- [ ] **Step 1: Write the failing test**

Create `backend/services/messaging/media.test.js`:

```js
// node --test services/messaging/media.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { needsFetch, fetchMediaPayload } = require("./media");

const message = (attachments, extra = {}) => ({
  externalChatId: "5550001",
  externalId: "42",
  attachments,
  ...extra,
});

test("докачивать есть что: вложение пропущено или не скачалось, и id в мессенджере известен", () => {
  assert.equal(needsFetch(message([{ status: "skipped" }])), true);
  assert.equal(needsFetch(message([{ status: "failed" }])), true);
  assert.equal(needsFetch(message([{ status: "ready" }])), false);
  assert.equal(needsFetch(message([])), false);
  assert.equal(needsFetch(message([{ status: "skipped" }], { externalId: undefined })), false);
  assert.equal(needsFetch(null), false);
});

test("задание знает чат, сообщение и вложения — без имени файла в хранилище", () => {
  assert.deepEqual(
    fetchMediaPayload(
      message([
        {
          name: "",
          originalName: "видео.mp4",
          mimetype: "video/mp4",
          size: 80 * 1024 * 1024,
          durationSec: 31,
          status: "skipped",
          externalRef: "tg:5550001:42",
        },
      ]),
    ),
    {
      chatId: "5550001",
      externalId: "42",
      attachments: [
        { originalName: "видео.mp4", mimetype: "video/mp4", size: 80 * 1024 * 1024, status: "skipped", externalRef: "tg:5550001:42" },
      ],
    },
  );
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/backend && NODE_ENV=production node --test services/messaging/media.test.js`

Expected: FAIL — `Cannot find module './media'`.

- [ ] **Step 3: Implement the service**

Create `backend/services/messaging/media.js`:

```js
/**
 * Докачка медиа по клику. Вложения, которые шлюз пропустил (больше лимита
 * канала или из истории), он скачивает заданием `fetchMedia`; здесь только
 * постановка задания. Итог пишет ackJobs → applyMediaOutcome (jobs.js):
 * список вложений сообщения заменяется присланным.
 */
const { GATEWAY_NETWORKS } = require("./rules");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

/** Есть что докачивать: сообщение знает свой id в мессенджере, вложение не «ready». Чисто. */
const needsFetch = (message) =>
  Boolean(message?.externalId) &&
  (message.attachments || []).some((attachment) => attachment.status === "skipped" || attachment.status === "failed");

/** Полезная нагрузка задания: где сообщение в мессенджере и что в нём было. Чисто. */
const fetchMediaPayload = (message) => ({
  chatId: message.externalChatId,
  externalId: message.externalId,
  attachments: (message.attachments || []).map((attachment) => ({
    originalName: attachment.originalName || "",
    mimetype: attachment.mimetype || "",
    size: attachment.size || 0,
    status: attachment.status,
    externalRef: attachment.externalRef || "",
  })),
});

/**
 * Поставить докачку. Видимость — как у самого диалога; одно ожидающее
 * задание на сообщение (повторный клик возвращает то же). Без диалога в
 * задании: докачка не ждёт очереди ответов этого чата.
 */
const requestMedia = async ({ messageId, auth }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const Channel = require("@/models/channel");
  const ChannelJob = require("@/models/channelJob");
  const { canSeeConversation } = require("./visibility");
  const { enqueueJob } = require("./jobs");

  const message = await Message.findById(messageId).lean();
  if (!message) throw fail("Сообщение не найдено", 404);
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Сообщение не найдено", 404);
  if (!needsFetch(message)) throw fail("Докачивать нечего", 409);
  const channel = await Channel.findById(conversation.channelId).select("type isActive").lean();
  if (!channel?.isActive || !GATEWAY_NETWORKS.includes(channel.type)) throw fail("Канал отключён — файл не получить", 409);
  const pending = await ChannelJob.findOne({ messageId: message._id, type: "fetchMedia", state: "pending" }).select("_id").lean();
  if (pending) return { jobId: String(pending._id) };
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "fetchMedia",
    messageId: message._id,
    payload: fetchMediaPayload(message),
  });
  return { jobId: String(job._id) };
};

module.exports = { needsFetch, fetchMediaPayload, requestMedia };
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /home/aleksey/projects/hd/backend && NODE_ENV=production node --test services/messaging/media.test.js`

Expected: PASS — `tests 2` · `pass 2` · `fail 0`.

- [ ] **Step 5: Controller and route**

Edit 1 of 2 — in `backend/controllers/conversation.js` replace exactly:

```js
const { enqueueJob } = require("@/services/messaging/jobs");
```

with:

```js
const { enqueueJob } = require("@/services/messaging/jobs");
const { requestMedia } = require("@/services/messaging/media");
```

Edit 2 of 2 — in `backend/controllers/conversation.js` replace exactly:

```js
exports.assign = async (req, res, next) => {
```

with:

```js
/** Докачать пропущенное вложение из мессенджера (задание fetchMedia). */
exports.fetchMedia = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next(new AppError("Сообщение не найдено", 404));
    res.status(202).json(await requestMedia({ messageId: req.params.id, auth: req.auth }));
  } catch (error) {
    next(wrap(error, "Не удалось запросить файл"));
  }
};

exports.assign = async (req, res, next) => {
```

Edit 1 of 1 — in `backend/routes/internal/conversation.js` replace exactly:

```js
router.post("/messages/:id/retry", ...reply, conversation.retry);
```

with:

```js
router.post("/messages/:id/retry", ...reply, conversation.retry);
router.post("/messages/:id/media", ...read, conversation.fetchMedia);
```

Run: `cd /home/aleksey/projects/hd/backend && node --check controllers/conversation.js && node --check routes/internal/conversation.js && node --check services/messaging/media.js && echo syntax-ok`

Expected: `syntax-ok`.

- [ ] **Step 6: Backend suite**

Run: `cd /home/aleksey/projects/hd/backend && NODE_ENV=production pnpm test`

Expected: summary with `fail 0` (the P0 suite plus the 2 new tests).

- [ ] **Step 7: The route is mounted behind auth** (sandbox disabled — Docker; the dev backend reloads the files itself)

Run: `cd /home/aleksey/projects/hd && sleep 5 && docker compose exec -T backend node -e "fetch('http://127.0.0.1:8080/api/messages/64f600000000000000000001/media', { method: 'POST' }).then((r) => console.log(r.status))"`

Expected: `401` — the route exists and requires a session (an unmounted route would answer `404`).

- [ ] **Step 8: `docs/messaging.md`**

Edit 1 of 3 — in `docs/messaging.md` replace exactly:

```markdown
_Last updated: 2026-09-25. P0 backend foundation: channels, ingest, mirroring
into tickets, the outbound queue, the gateway and staff HTTP contracts. Design
```

with:

```markdown
_Last updated: 2026-09-26. P0 backend foundation: channels, ingest, mirroring
into tickets, the outbound queue, the gateway and staff HTTP contracts; P1a:
the msg-gateway service for Telegram direct chats (§9). Design
```

Edit 2 of 3 — in `docs/messaging.md` replace exactly:

```markdown
| `fetchMedia` | — | Not yet enqueued by any P0 endpoint (contract for a later re-fetch of skipped/deferred media); the ack consumer already exists — a `done` result's `result.attachments[]` (≤20) replaces the message's attachment list |
```

with:

```markdown
| `fetchMedia` | `{chatId, externalId, attachments: [{originalName, mimetype, size, status, externalRef}]}` | `POST /messages/:id/media` (`services/messaging/media.js`); no `conversationId`, so it never waits behind the chat's replies. A `done` result's `result.attachments[]` (≤20) replaces the message's attachment list |
```

Edit 3 of 3 — in `docs/messaging.md` replace exactly:

```markdown
| `POST /messages/:id/retry` | reply | Re-enqueue a `failed` outbound message |
```

with:

```markdown
| `POST /messages/:id/retry` | reply | Re-enqueue a `failed` outbound message |
| `POST /messages/:id/media` | read | Fetch a `skipped`/`failed` attachment from the messenger (`fetchMedia` job; a pending one is reused) → `202 {jobId}` |
```

Then append at the very end of `docs/messaging.md` (after §8, separated by one blank line):

```markdown

## 9. msg-gateway (P1a: Telegram direct chats)

`msg-gateway/` — a TypeScript service (Node 24, type stripping, `node:sqlite`)
cloned from the `tg-service` skeleton, compose profile `messengers`. It holds
the corporate Telegram account session (MTProto user session through GramJS,
npm `telegram` **2.26.22**, pinned; the package is archived since 2026-07, its
maintained fork is `teleproto` — only `src/telegram/mtproto.ts` imports it) and
talks to the backend only over §6. Operations: `docs/deployment.md`,
«Messengers (msg-gateway)»; running it elsewhere: `msg-gateway/README.md`.

**Scope.** Direct (1:1) chats. Never ingested: groups and supergroups (P2),
channels, bots, Saved Messages, service notifications from `777000` (login
codes), `settings.ignoredChatIds`. `settings.importGroups` has no effect until
P2. Only `telegram` jobs are leased; WhatsApp (P4) is a second
`NetworkAdapter` (`src/core/adapter.ts`).

**State** (`/app/data/msg-gateway.db`, volume `hd_msg_gateway_data`):
sessions, the event journal with its media, the send journal
(`sent_jobs`/`sent_parts`), access hashes, per-chat watermarks, outgoing
message ids for read receipts. Session strings, journal rows and media are
AES-256-GCM with `MSG_GATEWAY_ENC_KEY`; the AAD contains `APP_PUBLIC_URL`, so a
volume copied to another installation starts no session (channel state
`error`). `./deploy.sh backup` adds an encrypted `VACUUM INTO` snapshot
(`src/cli/snapshot.ts`).

**Inbound.** Every update is written to the local journal first and then
posted to `POST /events` in batches of ≤50; a backend that is down only delays
delivery (pause 1 s → 2 s → … → 60 s, nothing is dropped). Per-event results:
`ok` and `retryable:false` remove the row (the latter with a warning);
`retryable` keeps that row and every later one for the next round (order
matters: an edit must not overtake its message); after 20 such answers the row
is dropped with an error log. Messages typed on the corporate phone are
`direction:"out"`, `origin:"device"`. Our own HD replies seen again (by the gap
check) go out as echoes with `origin:"hd"` + `jobId` — `confirmOwn` matches
them, they never become `device`; while a send to the same chat is unfinished,
an unknown outgoing message found by the gap check waits for the next round.
Edits of HD replies are not forwarded (Telegram holds the signed text, §6).
Deletions come without `chat` (message ids are account-wide in private chats).
`UpdateReadHistoryOutbox` becomes `message.status: read` — by `jobId` for HD
replies, by `chat` + `messageIds` for phone messages. `channel.state` rows are
coalesced: a newer state replaces an unsent older one (stale QR codes are
never delivered).

**Media.** Files up to `settings.maxMediaMb` are downloaded through the
channel proxy, kept encrypted in the journal and uploaded with `POST /media`
right before their event is posted (network/401/429 — the whole journal waits;
5xx — up to 3 tries; other 4xx — the attachment becomes `failed`). Larger
files and all history media are sent as `status:"skipped"` with
`externalRef: "tg:<chatId>:<messageId>"`. `POST /api/messages/:id/media` (§7)
enqueues `fetchMedia`; the gateway downloads the file (≤200 MB) and answers
`result.attachments[]`, which replaces the message's list.

**Outbound (`send`).** The signature is already in `payload.text`
(`signReply`, `services/messaging/outbound.js`); the gateway never changes the
text. Text over 4096 characters is split (paragraph, line, word); text up to
1024 characters is the caption of the first file, longer text goes first as
separate messages; JPEG/PNG/WebP up to 10 MB go as photos, everything else as
documents. Each part carries `random_id = int64(sha256("hd-msg-gateway:<jobId>:<part>")[0..8])`:
a retried job re-sends the same `random_id` and Telegram returns the original
message instead of a new one (core.telegram.org/api/updates). Order per part:
`sent_jobs` row → pace (1 message/s per chat, 20/min per account; a wait over
20 s returns the job with `retryAfterMs`) → send → `sent_parts` row; the ack
carries `result {externalId, externalIds}`. `FLOOD_WAIT_X` → `retryAfterMs`
X s; `RANDOM_ID_DUPLICATE` → 5 s; blocked user, privacy, `PEER_FLOOD` and other
400/403 answers → `retryable:false`; a lost session → retryable, and the channel
moves to `loggedOut` / `banned` / `error`. Job results: `send` `{externalId,
externalIds}`; `login` `{state}`; `logout` `{state:"loggedOut"}`; `testProxy`
`{reachable, latencyMs, viaProxy, note?}`; `loadHistory` `{chats, messages}`;
`fetchMedia` `{attachments}`.

**Gap check.** GramJS does not replay updates missed while disconnected, so
after every reconnect and every 5 minutes the gateway reads the dialog list and
fetches, per direct chat, the messages newer than its watermark (a chat it has
never seen: since the gateway was last alive) — as live messages, which can
start «Ждёт ответа». Right after the first login of an account the current
state becomes the baseline and `settings.historyDays` of history is imported
(`imported:true`, text only). `loadHistory {days}` repeats the import; the
backend deduplicates.

**Login** (`login {step, value}`): `start` → QR login (`channel.state
awaitingQr`, `login.qr = tg://login?token=<base64url>`, a fresh code about every
30 s); `phone` → `awaitingCode`; `code` → connected, or `awaitingPassword` (the
reason carries the 2FA hint); `password` → connected. A wrong code or password
fails the job with `retryable:false`, and the state keeps asking. `logout` →
`auth.logOut`, the session is deleted, `loggedOut`. A session terminated from
the phone is noticed by the next request or gap check → `loggedOut`. Proxy
formats (`settings.proxyUrl`, password in the `proxyPassword` secret):
`socks5://[user[:pass]@]host:port`, `socks4://host:port`,
`mtproxy://host:port?secret=…`, `tg://proxy?server=…&port=…&secret=…`,
`https://t.me/proxy?…`. MTProxy FakeTLS secrets (`ee…`) are rejected — GramJS
2.26.22 cannot speak them.

**Known limits (P1a).** A multi-part reply that fails for good after some parts
went out is re-sent whole by «Повторить». Edits and deletions made while the
gateway was down are not recovered (the gap check finds new messages only). A
channel deleted in HD keeps its session in the volume — log out first. Only the
200 most recent dialogs are scanned by the gap check and the history import.
```

- [ ] **Step 9: Gate**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test && cd ../backend && NODE_ENV=production pnpm test`

Expected: `tsc --noEmit` silent; gateway summary `tests 126` · `fail 0`; backend summary `fail 0`. Checkpoint — no commit, no staging; report the changed paths to the owner.

### Task 18: Backend — fetched media reaches the ticket; retries keep the signature

**Files:**
- Modify: `backend/services/messaging/media.js` (created in Task 17), `backend/services/messaging/media.test.js`
- Modify: `backend/services/messaging/jobs.js` — **only the `applyMediaOutcome` function**
- Modify: `backend/services/messaging/outbound.js`, `backend/services/messaging/outbound.test.js`
- Modify: `docs/messaging.md`

**Interfaces:**
- Consumes: `storage.copyObject(name)` / `storage.deleteObject(name)` (`services/storage.js`), `bus.bump({topics, ticketIds})` (`services/pulse.js`), `rules.signReply(text, {firstName, organization})`, models `Message`, `Comment`, `User`, `Preferences`; Task 17's `media.js` (`needsFetch`, `fetchMediaPayload`, `requestMedia`).
- Produces: `missingInComment(messageAttachments, commentAttachments): Attachment[]` (pure) and `copyFetchedToComment(messageId, attachments): Promise<number>` in `media.js`; `sendPayload({conversation, channel, text, attachments, author, prefs}): {chatId, kind, text, attachments}` (pure, now exported) and the internal `rebuildPayload({conversation, channel, message})` in `outbound.js`; `applyMediaOutcome(job, result)` keeps its signature and now ends with `copyFetchedToComment`.

**1. Fetched media reaches the ticket.** A message mirrored into a ticket while its file was `skipped` has a comment without the file (`mirror.js` copies only `ready` attachments). When a `fetchMedia` job succeeds, `applyMediaOutcome` replaces the message's attachments (as in P0) and then calls `copyFetchedToComment`: every new `ready` file is copied with `storage.copyObject` and pushed onto `Comment.attachments` in the shape `mirror.js` uses (`{name, originalName, mimetype}`); the comment's text («Фото», «Голосовое 0:12», «Файл «…»») stays as it is; a copy that fails is logged and the rest go on; the ticket and the inbox get a pulse bump.

*Idempotence — matched by file name + type (`originalName` + `mimetype`).* Of the two options, recording the source would need a new field on the comment's attachment, and the natural source (`externalRef` = `tg:<chatId>:<messageId>`) would put a messenger chat/message id into a payload the client and colleagues see — the P0 rule is names-only. `originalName` + `size` is not available: the comment's attachment has no `size` (`models/comment.js`), and adding one is a schema change for a comparison. Name + type are already stored, stable across repeated fetches (the storage `name` is not — each fetch uploads a new object), and a messenger message carries one file, so an equal name and type inside one mirror is the same file. `missingInComment` makes the decision (pure, tested); the push itself is conditional (`attachments: {$not: {$elemMatch: {originalName, mimetype}}}`), so two racing results cannot add the file twice — the loser deletes its copy.

**2. Retries keep the signature.** P0 signs only in `queueOutbound`; `retryMessage`'s fallback (when the failed message's previous job has expired — `channeljobs` keep finished jobs 30 days) and `repairOutbound`'s orphan branch build the payload from `message.text`, which is stored unsigned, so those sends went out without «— Имя, Организация». One exported `sendPayload` now builds every `send` payload and signs per `Channel.settings.signReplies` with the author's first name and `Preferences.contacts.title`; `rebuildPayload` loads the author and the organisation for the two paths that start from a stored message.

**Coexistence with P1b.** The P1b plan adds `bus.bump({ topics: ["channels"] })` inside `ackJobs` in the same `jobs.js`. This task's edit of `jobs.js` replaces the `applyMediaOutcome` function and nothing else (its old text does not overlap `ackJobs`), so the two edits apply in either order.

**DB paths** (`copyFetchedToComment`, `rebuildPayload`, the call sites): `node --check` here. The P0 smoke (`backend/scripts/smokeMessaging.js`, dev only, removes what it creates by an explicit `_id` list) sends a reply through `sendFromInbox` → `queueOutbound` → the new `sendPayload` and acks it through `ackJobs` — Step 7 runs it. The retry fallback, the repair branch and the media copy are not in that smoke: their pure parts are unit-tested here and the whole paths are owner checks 11 and 14.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `backend/services/messaging/media.test.js` (Task 17 version) with:

```js
// node --test services/messaging/media.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { needsFetch, fetchMediaPayload, missingInComment } = require("./media");

const message = (attachments, extra = {}) => ({
  externalChatId: "5550001",
  externalId: "42",
  attachments,
  ...extra,
});

test("докачивать есть что: вложение пропущено или не скачалось, и id в мессенджере известен", () => {
  assert.equal(needsFetch(message([{ status: "skipped" }])), true);
  assert.equal(needsFetch(message([{ status: "failed" }])), true);
  assert.equal(needsFetch(message([{ status: "ready" }])), false);
  assert.equal(needsFetch(message([])), false);
  assert.equal(needsFetch(message([{ status: "skipped" }], { externalId: undefined })), false);
  assert.equal(needsFetch(null), false);
});

test("задание знает чат, сообщение и вложения — без имени файла в хранилище", () => {
  assert.deepEqual(
    fetchMediaPayload(
      message([
        {
          name: "",
          originalName: "видео.mp4",
          mimetype: "video/mp4",
          size: 80 * 1024 * 1024,
          durationSec: 31,
          status: "skipped",
          externalRef: "tg:5550001:42",
        },
      ]),
    ),
    {
      chatId: "5550001",
      externalId: "42",
      attachments: [
        { originalName: "видео.mp4", mimetype: "video/mp4", size: 80 * 1024 * 1024, status: "skipped", externalRef: "tg:5550001:42" },
      ],
    },
  );
});

const ready = (originalName, mimetype = "image/jpeg", extra = {}) => ({
  name: `msg-${originalName}`,
  originalName,
  mimetype,
  size: 10,
  durationSec: null,
  status: "ready",
  externalRef: "tg:5550001:42",
  ...extra,
});

test("в комментарий заявки — только готовые докачанные файлы, которых там ещё нет", () => {
  const fetched = [
    ready("photo-42.jpg"),
    ready("voice-43.ogg", "audio/ogg", { status: "skipped" }),
    ready("scan.pdf", "application/pdf"),
    ready("lost.jpg", "image/jpeg", { name: "" }),
  ];
  // Фото уже скопировано прошлой докачкой — под другим именем в хранилище
  const comment = [{ name: "cp-1.jpg", originalName: "photo-42.jpg", mimetype: "image/jpeg" }];
  assert.deepEqual(missingInComment(fetched, comment).map((item) => item.originalName), ["scan.pdf"]);
});

test("сверка по имени и типу: тот же файл дважды — один раз, то же имя другого типа — другой файл", () => {
  const fetched = [ready("scan.pdf", "application/pdf"), ready("scan.pdf", "application/pdf"), ready("scan.pdf", "image/png")];
  assert.deepEqual(
    missingInComment(fetched, []).map((item) => `${item.originalName}:${item.mimetype}`),
    ["scan.pdf:application/pdf", "scan.pdf:image/png"],
  );
  assert.deepEqual(missingInComment(undefined, undefined), []);
});
```

Edit 1 of 1 — in `backend/services/messaging/outbound.test.js` replace exactly:

```js
const { attachmentsOf, kindOf } = require("./outbound");
```

with:

```js
const { attachmentsOf, kindOf, sendPayload } = require("./outbound");
```

Then append at the end of `backend/services/messaging/outbound.test.js`:

```js

test("a send payload is signed the same on every path: first send, retry, repair", () => {
  const conversation = { externalChatId: "5550001", kind: "direct" };
  const attachments = [
    { name: "cp-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 1200, status: "ready", durationSec: null },
  ];
  const author = { firstName: "Игорь", lastName: "Петров", email: "igor@example.com", phone: "+79990000000" };
  const prefs = { contacts: { title: "F1Lab" } };
  const signing = { settings: { signReplies: true } };
  assert.deepEqual(sendPayload({ conversation, channel: signing, text: "Готово", attachments, author, prefs }), {
    chatId: "5550001",
    kind: "direct",
    text: "Готово\n\n— Игорь, F1Lab",
    attachments: [{ name: "cp-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 1200 }],
  });
  // Подпись выключена — текст как есть
  assert.equal(
    sendPayload({ conversation, channel: { settings: { signReplies: false } }, text: "Готово", attachments: [], author, prefs }).text,
    "Готово",
  );
  // Автора не нашли (удалён) — остаётся организация; контактов сотрудника в тексте нет никогда
  const orphan = sendPayload({ conversation, channel: signing, text: "Готово", attachments: undefined, author: null, prefs });
  assert.equal(orphan.text, "Готово\n\n— F1Lab");
  assert.deepEqual(orphan.attachments, []);
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `cd /home/aleksey/projects/hd/backend && NODE_ENV=production node --test services/messaging/media.test.js services/messaging/outbound.test.js`

Expected: FAIL — 3 tests fail with `TypeError: missingInComment is not a function` (2) and `TypeError: sendPayload is not a function` (1); the other 5 pass.

- [ ] **Step 3: Implement `media.js`**

Replace the whole of `backend/services/messaging/media.js` (Task 17 version) with:

```js
/**
 * Докачка медиа по клику. Вложения, которые шлюз пропустил (больше лимита
 * канала или из истории), он скачивает заданием `fetchMedia`; здесь —
 * постановка задания и перенос докачанного в заявку. Итог задания пишет
 * ackJobs → applyMediaOutcome (jobs.js): список вложений сообщения
 * заменяется присланным, а новые готовые файлы копируются в комментарий-зеркало.
 */
const { GATEWAY_NETWORKS } = require("./rules");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

/** Есть что докачивать: сообщение знает свой id в мессенджере, вложение не «ready». Чисто. */
const needsFetch = (message) =>
  Boolean(message?.externalId) &&
  (message.attachments || []).some((attachment) => attachment.status === "skipped" || attachment.status === "failed");

/** Полезная нагрузка задания: где сообщение в мессенджере и что в нём было. Чисто. */
const fetchMediaPayload = (message) => ({
  chatId: message.externalChatId,
  externalId: message.externalId,
  attachments: (message.attachments || []).map((attachment) => ({
    originalName: attachment.originalName || "",
    mimetype: attachment.mimetype || "",
    size: attachment.size || 0,
    status: attachment.status,
    externalRef: attachment.externalRef || "",
  })),
});

/**
 * Файл в комментарии узнаём по имени и типу. Не по ссылке на источник: у
 * вложения комментария нет такого поля, а внешний id сообщения или чата в
 * нём увидели бы клиент и его коллеги (в клиентских данных — только имена).
 * Не по имени в хранилище: каждая докачка кладёт новый объект. Не по размеру:
 * у вложения комментария его нет. В сообщении мессенджера файл один, так что
 * одинаковые имя и тип в одном зеркале — один и тот же файл.
 */
const attachmentKey = (attachment) => `${attachment?.originalName || ""}\u0000${attachment?.mimetype || ""}`;

/** Какие готовые докачанные файлы ещё не лежат в комментарии-зеркале. Чисто. */
const missingInComment = (messageAttachments, commentAttachments) => {
  const present = new Set((commentAttachments || []).map(attachmentKey));
  const missing = [];
  for (const attachment of messageAttachments || []) {
    if (attachment?.status !== "ready" || !attachment.name) continue;
    const key = attachmentKey(attachment);
    if (present.has(key)) continue;
    present.add(key);
    missing.push(attachment);
  }
  return missing;
};

/**
 * Поставить докачку. Видимость — как у самого диалога; одно ожидающее
 * задание на сообщение (повторный клик возвращает то же). Без диалога в
 * задании: докачка не ждёт очереди ответов этого чата.
 */
const requestMedia = async ({ messageId, auth }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const Channel = require("@/models/channel");
  const ChannelJob = require("@/models/channelJob");
  const { canSeeConversation } = require("./visibility");
  const { enqueueJob } = require("./jobs");

  const message = await Message.findById(messageId).lean();
  if (!message) throw fail("Сообщение не найдено", 404);
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Сообщение не найдено", 404);
  if (!needsFetch(message)) throw fail("Докачивать нечего", 409);
  const channel = await Channel.findById(conversation.channelId).select("type isActive").lean();
  if (!channel?.isActive || !GATEWAY_NETWORKS.includes(channel.type)) throw fail("Канал отключён — файл не получить", 409);
  const pending = await ChannelJob.findOne({ messageId: message._id, type: "fetchMedia", state: "pending" }).select("_id").lean();
  if (pending) return { jobId: String(pending._id) };
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "fetchMedia",
    messageId: message._id,
    payload: fetchMediaPayload(message),
  });
  return { jobId: String(job._id) };
};

/**
 * Докачанное — и в заявку, если сообщение уже зеркалировано в комментарий.
 * Копиями, как mirror.js (удаление вложения из заявки удаляет его файл);
 * текст комментария («Фото», «Голосовое 0:12») не трогаем. Каждый файл
 * добавляется условным $push: гонка двух итогов не даст дубля, а лишняя копия
 * удаляется. Сбой копирования — в журнал, остальные файлы идут дальше.
 * Возвращает, сколько файлов добавлено.
 */
const copyFetchedToComment = async (messageId, attachments) => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  const storage = require("@/services/storage");
  const logger = require("@/utils/logger");

  const message = await Message.findById(messageId).select("commentId").lean();
  if (!message?.commentId) return 0;
  const comment = await Comment.findById(message.commentId).select("attachments ticketId").lean();
  if (!comment) return 0;

  let added = 0;
  for (const attachment of missingInComment(attachments, comment.attachments)) {
    let name;
    try {
      name = await storage.copyObject(attachment.name);
    } catch (error) {
      logger.log("warn", "Докачанное вложение не скопировано в заявку", {
        module: "messaging",
        messageId: String(messageId),
        error: error.message,
      });
      continue;
    }
    const pushed = await Comment.updateOne(
      {
        _id: comment._id,
        attachments: { $not: { $elemMatch: { originalName: attachment.originalName, mimetype: attachment.mimetype } } },
      },
      { $push: { attachments: { name, originalName: attachment.originalName, mimetype: attachment.mimetype } } },
    );
    if (pushed.modifiedCount) added += 1;
    else await storage.deleteObject(name).catch(() => {});
  }
  if (added) require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds: [comment.ticketId] });
  return added;
};

module.exports = { needsFetch, fetchMediaPayload, missingInComment, requestMedia, copyFetchedToComment };
```

- [ ] **Step 4: `applyMediaOutcome` calls it** — the only change in `jobs.js`

Edit 1 of 1 — in `backend/services/messaging/jobs.js` replace exactly:

```js
const applyMediaOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const list = result?.result?.attachments;
  if (job.state !== "done" || !Array.isArray(list)) return;
  await Message.updateOne(
    { _id: job.messageId },
    {
      $set: {
        attachments: list.slice(0, 20).map((a) => ({
          name: String(a.name || ""),
          originalName: String(a.originalName || ""),
          mimetype: String(a.mimetype || ""),
          size: Number(a.size) || 0,
          durationSec: Number.isFinite(a.durationSec) ? a.durationSec : null,
          status: ["ready", "skipped", "failed"].includes(a.status) ? a.status : "ready",
          externalRef: String(a.externalRef || ""),
        })),
      },
    },
  );
};
```

with:

```js
const applyMediaOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const list = result?.result?.attachments;
  if (job.state !== "done" || !Array.isArray(list)) return;
  const attachments = list.slice(0, 20).map((a) => ({
    name: String(a.name || ""),
    originalName: String(a.originalName || ""),
    mimetype: String(a.mimetype || ""),
    size: Number(a.size) || 0,
    durationSec: Number.isFinite(a.durationSec) ? a.durationSec : null,
    status: ["ready", "skipped", "failed"].includes(a.status) ? a.status : "ready",
    externalRef: String(a.externalRef || ""),
  }));
  await Message.updateOne({ _id: job.messageId }, { $set: { attachments } });
  // Сообщение уже в заявке — докачанные файлы и туда, копиями (media.js)
  await require("./media").copyFetchedToComment(job.messageId, attachments);
};
```

- [ ] **Step 5: One payload builder in `outbound.js`**

Edit 1 of 5 — in `backend/services/messaging/outbound.js` replace exactly:

```js
const sendPayload = (conversation, text, attachments) => ({
  chatId: conversation.externalChatId,
  kind: conversation.kind,
  text,
  attachments: attachments.map(({ name, originalName, mimetype, size }) => ({ name, originalName, mimetype, size })),
});
```

with:

```js
/**
 * Задание отправки — одно на все пути: первая отправка (queueOutbound),
 * повтор без прежнего задания (retryMessage) и починка (repairOutbound).
 * Подпись «— Имя, Организация» (Channel.settings.signReplies) ставится здесь
 * и только здесь, поэтому повтор уходит с той же подписью, что и первая
 * отправка. В подписи — имя сотрудника и организация, никаких контактов. Чисто.
 */
const sendPayload = ({ conversation, channel, text, attachments, author, prefs }) => ({
  chatId: conversation.externalChatId,
  kind: conversation.kind,
  text: channel?.settings?.signReplies
    ? rules.signReply(text, { firstName: author?.firstName || "", organization: prefs?.contacts?.title || "" })
    : text,
  attachments: (attachments || []).map(({ name, originalName, mimetype, size }) => ({ name, originalName, mimetype, size })),
});

/** Задание заново — из самого сообщения: в нём текст без подписи, автор и вложения. */
const rebuildPayload = async ({ conversation, channel, message }) => {
  const User = require("@/models/user");
  const Preferences = require("@/models/preferences");
  const author = message.authorUserId ? await User.findById(message.authorUserId).select("firstName").lean() : null;
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  return sendPayload({ conversation, channel, text: message.text, attachments: message.attachments || [], author, prefs });
};
```

Edit 2 of 5 — in `backend/services/messaging/outbound.js` replace exactly:

```js
  const signed = channel.settings?.signReplies
    ? rules.signReply(text, { firstName: author.firstName, organization: prefs?.contacts?.title || "" })
    : text;
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: sendPayload(conversation, signed, attachments),
  });
```

with:

```js
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: sendPayload({ conversation, channel, text, attachments, author, prefs }),
  });
```

Edit 3 of 5 — in `backend/services/messaging/outbound.js` replace exactly:

```js
    payload: previous?.payload || sendPayload(conversation, message.text, message.attachments || []),
```

with:

```js
    payload: previous?.payload || (await rebuildPayload({ conversation, channel, message })),
```

Edit 4 of 5 — in `backend/services/messaging/outbound.js` replace exactly:

```js
      payload: sendPayload(conversation, message.text, message.attachments || []),
```

with:

```js
      payload: await rebuildPayload({ conversation, channel, message }),
```

Edit 5 of 5 — in `backend/services/messaging/outbound.js` replace exactly:

```js
module.exports = { attachmentsOf, kindOf, sendFromInbox, validateDeliverRoute, deliverComment, retryMessage, repairOutbound };
```

with:

```js
module.exports = { attachmentsOf, kindOf, sendPayload, sendFromInbox, validateDeliverRoute, deliverComment, retryMessage, repairOutbound };
```

- [ ] **Step 6: Run the tests — expect pass; syntax of the DB paths**

Run: `cd /home/aleksey/projects/hd/backend && NODE_ENV=production node --test services/messaging/media.test.js services/messaging/outbound.test.js services/messaging/jobs.test.js`

Expected: PASS — `tests 13` · `pass 13` · `fail 0`.

Run: `cd /home/aleksey/projects/hd/backend && node --check services/messaging/jobs.js && node --check services/messaging/outbound.js && node --check services/messaging/media.js && echo syntax-ok`

Expected: `syntax-ok`.

- [ ] **Step 7: The P0 smoke on dev** (sandbox disabled — Docker; the dev backend reloads the files itself; the module «Диалоги» is on in dev)

Run: `cd /home/aleksey/projects/hd && sleep 5 && docker compose exec -T backend node scripts/smokeMessaging.js`

Expected: the `•` steps (replay, binding, bound, outbound, echo before ack, after close) and `PASS` at the end.

- [ ] **Step 8: `docs/messaging.md`** (edits on top of Task 17's)

Edit 1 of 3 — in `docs/messaging.md` replace exactly:

```markdown
| `send` | `{chatId, kind, text, attachments: [{name, originalName, mimetype, size}]}` | `queueOutbound` (a reply); `repairOutbound` (recovery) |
```

with:

```markdown
| `send` | `{chatId, kind, text, attachments: [{name, originalName, mimetype, size}]}`; `text` is already signed | `queueOutbound` (a reply), `retryMessage` when the failed job is gone, `repairOutbound` (recovery) — all through `sendPayload` (`outbound.js`), so every path carries the same `signReply` signature (`Channel.settings.signReplies`) |
```

Edit 2 of 3 — in `docs/messaging.md` replace exactly:

```markdown
A `done` result's `result.attachments[]` (≤20) replaces the message's attachment list |
```

with:

```markdown
A `done` result's `result.attachments[]` (≤20) replaces the message's attachment list; if the message is mirrored into a ticket, its new `ready` files are also copied into that comment (`copyFetchedToComment`, `media.js`: matched by file name + type, the comment text stays) |
```

Edit 3 of 3 — in `docs/messaging.md` replace exactly:

```markdown
`result.attachments[]`, which replaces the message's list.
```

with:

```markdown
`result.attachments[]`, which replaces the message's list; a message already
mirrored into a ticket also gets the new files copied into its comment.
```

- [ ] **Step 9: Final gate**

Run: `cd /home/aleksey/projects/hd/msg-gateway && pnpm typecheck && pnpm test && cd ../backend && NODE_ENV=production pnpm test`

Expected: `tsc --noEmit` silent; gateway summary `tests 126` · `fail 0`; backend summary `fail 0`. Checkpoint — no commit, no staging; report the changed paths to the owner.

### Task 19: Frontend — tap to download a skipped attachment

**Precondition — P1b first.** Execution order is P1b (the «Диалоги» UI, `docs/superpowers/plans/2026-09-25-omnichannel-p1b-dialogs-ui.md`) and then this plan, so this task edits files P1b's Task 8 created: `MessageMedia.tsx` (the `placeholderLabel` placeholders on `bg-media-placeholder`), `MessageBubble.tsx`, `conversation-actions.ts` (`failureText`), `types/conversation.ts` (`AttachmentStatus`, `MessageAttachment`) and `util/conversation-format.js` (`attachmentKindLabel`, `formatFileSize`). P1b left tap-to-fetch to «whichever plan lands second» (its deviation list); that is this task.

**Files:**
- Create: `frontend/src/util/attachment-fetch.js`, `frontend/src/components/Conversation/use-attachment-fetch.ts`
- Test: `frontend/src/util/attachment-fetch.test.js`
- Modify (on top of P1b Task 8): `frontend/src/components/Conversation/MessageMedia.tsx`, `frontend/src/components/Conversation/MessageBubble.tsx`

**Interfaces:**
- Consumes: from P1b — `MessageAttachment` (`@/types/conversation`), `attachmentKindLabel(kind)`, `formatFileSize(bytes)` (`./conversation-format.js`), `failureText(error, fallback)` (`./conversation-actions`), `api<T>(path, {method})` (`@/lib/api`), `useCan()` (`@/store/authed-user`), and the thread's live path in `use-thread.ts` (`useLiveTopic("conversations", poll)` → `changedSince` → `mergeMessages`), which this task does not change; from Task 17 — `POST /api/messages/:id/media` → `202 {jobId}`, `404`/`409` with a Russian message, a pending job for the same message reused; from Task 18 — `applyMediaOutcome` writes the `Message`, whose pulse plugin moves topic `conversations`.
- Produces: `FETCH_WAIT_MS`, `isFetchable(attachment)`, `fetchAction(attachment, waiting)`, `photoFetchCaption(attachment, waiting)`, `fetchAriaLabel(kind, attachment)` (`util/attachment-fetch.js`); `useAttachmentFetch(messageId, attachment): AttachmentFetch = {available, waiting, error, request}`; `PhotoAttachment`, `VoiceAttachment`, `FileAttachment` take an optional `messageId` (without it they render exactly as in P1b); `MessageBubble` passes `message.id`.

**Behaviour.** A `skipped` or `failed` attachment's placeholder becomes a button — for staff who hold `conversation.read` (the route is read-gated anyway); others, and `pending`, keep P1b's static placeholder. One click → one `POST /api/messages/:id/media` (a ref guards double clicks) → the icon turns into a spinner. No polling of our own: when the gateway's job finishes, `applyMediaOutcome` writes the message, the `Message` pulse plugin moves topic `conversations`, the open thread pulls `changedSince`, and the attachment arrives `ready` — its React key (`${name}-${index}`) changes, so the placeholder unmounts and the real photo/voice/file renders. A 4xx shows the server's short text inline («Канал отключён — файл не получить», «Докачивать нечего»), a 5xx or no network shows «Не удалось запросить файл — попробуйте ещё раз»; the button is active again either way. The only timer is a display ceiling: if the file has not arrived after 5 minutes (the gateway's `fetchMedia` job timeout), the spinner stops with «Файл пока не пришёл — попробуйте ещё раз»; another click reuses the pending job. Look: the photo tile, the voice button and the file chip keep P1b's canvas look — the tile's caption reads «Загрузить · 2,4 МБ», the voice button shows a download glyph, the chip adds the word «Загрузить»; the only new visual elements are the spinner and the error line.

- [ ] **Step 1: P1b is in the tree**

Run: `cd /home/aleksey/projects/hd/frontend && for f in src/components/Conversation/MessageMedia.tsx src/components/Conversation/MessageBubble.tsx src/components/Conversation/conversation-actions.ts src/util/conversation-format.js src/types/conversation.ts; do test -f "$f" || echo "missing $f"; done; echo checked`

Expected: only `checked`. A `missing …` line means P1b has not landed — stop and report; this task must not recreate P1b's files.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/util/attachment-fetch.test.js`:

```js
// node --test src/util/attachment-fetch.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FETCH_WAIT_MS,
  fetchAction,
  fetchAriaLabel,
  isFetchable,
  photoFetchCaption,
} from "./attachment-fetch.js";

const MB = 1024 * 1024;

test("кнопка «Загрузить» — только у пропущенного и не скачавшегося", () => {
  assert.equal(isFetchable({ status: "skipped" }), true);
  assert.equal(isFetchable({ status: "failed" }), true);
  assert.equal(isFetchable({ status: "ready" }), false);
  assert.equal(isFetchable({ status: "pending" }), false);
  assert.equal(isFetchable(null), false);
  assert.equal(isFetchable(undefined), false);
});

test("слово на кнопке: загрузить, после сбоя — снова, пока ждём — загружается", () => {
  assert.equal(fetchAction({ status: "skipped" }, false), "Загрузить");
  assert.equal(fetchAction({ status: "failed" }, false), "Загрузить снова");
  assert.equal(fetchAction({ status: "skipped" }, true), "Загружается…");
});

test("подпись фото — действие и размер; без размера и во время ожидания — только слово", () => {
  assert.equal(photoFetchCaption({ status: "skipped", size: 2.4 * MB }, false), "Загрузить · 2,4 МБ");
  assert.equal(photoFetchCaption({ status: "failed", size: 240 * 1024 }, false), "Загрузить снова · 240 КБ");
  assert.equal(photoFetchCaption({ status: "skipped", size: 0 }, false), "Загрузить");
  assert.equal(photoFetchCaption({ status: "skipped", size: 2.4 * MB }, true), "Загружается…");
});

test("имя для диктора называет вид, файл — по имени, и размер", () => {
  assert.equal(fetchAriaLabel("photo", { size: 2.4 * MB }), "Загрузить фото, 2,4 МБ");
  assert.equal(fetchAriaLabel("voice", { size: 0 }), "Загрузить голосовое");
  assert.equal(fetchAriaLabel("document", { originalName: "акт.pdf", size: 240 * 1024 }), "Загрузить файл «акт.pdf», 240 КБ");
  assert.equal(fetchAriaLabel("video", { originalName: "clip.mp4", size: 80 * MB }), "Загрузить видео, 80,0 МБ");
});

test("ждём файл не дольше потолка задания шлюза — 5 минут", () => {
  assert.equal(FETCH_WAIT_MS, 300_000);
});
```

- [ ] **Step 3: Run it — expect failure**

Run: `cd /home/aleksey/projects/hd/frontend && node --test src/util/attachment-fetch.test.js`

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (cannot find `src/util/attachment-fetch.js`).

- [ ] **Step 4: The pure helper**

Create `frontend/src/util/attachment-fetch.js` (JS with JSDoc and a `.js` import, like P1b's helpers — it runs under `node --test`):

```js
import { attachmentKindLabel, formatFileSize } from "./conversation-format.js";

/**
 * Докачка вложения по клику в «Диалогах»: какие заглушки становятся кнопкой
 * «Загрузить» и что на ней написано. Файл качает шлюз заданием `fetchMedia`
 * (`POST /api/messages/:id/media`), готовый файл приходит обычным обновлением
 * ленты. Чисто — тест рядом.
 */

/**
 * Сколько ждать файл после запроса, пока не вернуть кнопку с подсказкой:
 * шлюз качает большой файл через прокси до 5 минут (потолок задания fetchMedia).
 */
export const FETCH_WAIT_MS = 5 * 60_000;

/**
 * Докачать можно то, что шлюз пропустил (крупнее предела канала, история)
 * или не смог скачать. «pending» — уже в пути, кнопки нет.
 * @param {{ status?: string } | null | undefined} attachment
 */
export const isFetchable = (attachment) =>
  attachment?.status === "skipped" || attachment?.status === "failed";

/**
 * Слово на кнопке: «Загрузить», после неудачи шлюза — «Загрузить снова»,
 * пока ждём файл — «Загружается…».
 * @param {{ status?: string } | null | undefined} attachment
 * @param {boolean} waiting
 */
export const fetchAction = (attachment, waiting) => {
  if (waiting) return "Загружается…";
  return attachment?.status === "failed" ? "Загрузить снова" : "Загрузить";
};

/**
 * Подпись заглушки фото: «Загрузить · 2,4 МБ» (вид файла уже говорит значок).
 * @param {{ status?: string; size?: number } | null | undefined} attachment
 * @param {boolean} waiting
 */
export const photoFetchCaption = (attachment, waiting) => {
  const action = fetchAction(attachment, waiting);
  const size = waiting ? "" : formatFileSize(attachment?.size);
  return size ? `${action} · ${size}` : action;
};

/**
 * Имя кнопки для экранного диктора: «Загрузить фото, 2,4 МБ»,
 * «Загрузить файл «акт.pdf», 240 КБ».
 * @param {string} kind
 * @param {{ originalName?: string; size?: number } | null | undefined} attachment
 */
export const fetchAriaLabel = (kind, attachment) => {
  const what = attachmentKindLabel(kind).toLowerCase();
  const name = what === "файл" && attachment?.originalName ? ` «${attachment.originalName}»` : "";
  const size = formatFileSize(attachment?.size);
  return `Загрузить ${what}${name}${size ? `, ${size}` : ""}`;
};
```

- [ ] **Step 5: Run it — expect pass**

Run: `cd /home/aleksey/projects/hd/frontend && node --test src/util/attachment-fetch.test.js src/util/conversation-format.test.js`

Expected: PASS — `fail 0` (5 new tests plus P1b's `conversation-format` suite, which the helper imports).

- [ ] **Step 6: The hook**

Create `frontend/src/components/Conversation/use-attachment-fetch.ts`:

```ts
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useCan } from "@/store/authed-user";
import type { MessageAttachment } from "@/types/conversation";
import { FETCH_WAIT_MS, isFetchable } from "@/util/attachment-fetch";

import { failureText } from "./conversation-actions";

export type AttachmentFetch = {
  /** Показывать кнопку: вложение докачиваемо, сообщение известно, право видеть диалоги есть. */
  available: boolean;
  /** Запрос принят, ждём файл — вместо значка спиннер. */
  waiting: boolean;
  /** Короткая причина неудачи — строкой под заглушкой; следующая попытка её стирает. */
  error: string;
  request: () => void;
};

/**
 * Докачка одного вложения по клику: один `POST /api/messages/:id/media`,
 * дальше — ожидание. Готовый файл приносит обычное обновление ленты (пульс
 * «conversations» → `changedSince`, use-thread.ts): статус станет «ready», и
 * заглушку сменит само вложение. Своего опроса нет; таймер здесь — только
 * потолок ожидания спиннера (FETCH_WAIT_MS), данных он не запрашивает.
 */
export const useAttachmentFetch = (
  messageId: string | undefined,
  attachment: MessageAttachment,
): AttachmentFetch => {
  const can = useCan();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  // Двойной клик до перерисовки не должен дать второй запрос
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const available =
    Boolean(messageId) && isFetchable(attachment) && can({ conversation: ["read"] });

  const release = (reason: string) => {
    busy.current = false;
    setWaiting(false);
    setError(reason);
  };

  const request = () => {
    if (!messageId || busy.current) return;
    busy.current = true;
    setError("");
    setWaiting(true);
    api(`/api/messages/${messageId}/media`, { method: "POST" })
      .then(() => {
        if (!mounted.current) return;
        timer.current = setTimeout(
          () => release("Файл пока не пришёл — попробуйте ещё раз"),
          FETCH_WAIT_MS,
        );
      })
      .catch((failure: unknown) => {
        if (!mounted.current) return;
        release(failureText(failure, "Не удалось запросить файл — попробуйте ещё раз"));
      });
  };

  return { available, waiting, error, request };
};
```

- [ ] **Step 7: The placeholders become buttons** (on top of P1b Task 8's `MessageMedia.tsx`)

Edit 1 of 5 — in `frontend/src/components/Conversation/MessageMedia.tsx` replace exactly:

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
```

with:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  RiAttachment2,
  RiDownload2Line,
  RiImageLine,
  RiLoader4Line,
  RiPauseFill,
  RiPlayFill,
} from "react-icons/ri";

import { cn } from "@/lib/utils";
import type { MessageAttachment } from "@/types/conversation";
import {
  fetchAction,
  fetchAriaLabel,
  photoFetchCaption,
} from "@/util/attachment-fetch";
import {
  attachmentKindLabel,
  formatFileSize,
  voiceDuration,
} from "@/util/conversation-format";

import { useAttachmentFetch } from "./use-attachment-fetch";
```

Edit 2 of 5 — in `frontend/src/components/Conversation/MessageMedia.tsx` replace exactly:

```tsx
 * Вложения сообщения в пузыре «Диалогов» (канва A1): фото, голосовое, файл.
 * Файл сообщения шлюз кладёт в хранилище; пока он не загружен (история,
 * крупный файл — `skipped`), вместо него заглушка с видом и размером.
 */
```

with:

```tsx
 * Вложения сообщения в пузыре «Диалогов» (канва A1): фото, голосовое, файл.
 * Файл сообщения шлюз кладёт в хранилище; пока он не загружен (история,
 * крупный файл — `skipped`), вместо него заглушка с видом и размером.
 * Заглушка пропущенного или не скачавшегося файла — кнопка «Загрузить»
 * (докачка по клику, use-attachment-fetch.ts): вид прежний, добавлены только
 * спиннер ожидания и строка ошибки.
 */
```

Edit 3 of 5 — in `frontend/src/components/Conversation/MessageMedia.tsx` replace exactly:

```tsx
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
```

with:

```tsx
const PHOTO_PLACEHOLDER =
  "grid place-items-center rounded-[10px] bg-media-placeholder text-media-placeholder-fg";

/** Строка ошибки докачки — под заглушкой, коротко. */
const FetchError = ({ text }: { text: string }) =>
  text ? (
    <p role="alert" className="mt-1 mb-0 text-xs text-destructive">
      {text}
    </p>
  ) : null;

/** Заглушка фото; докачиваемая — та же подложка кнопкой «Загрузить». */
const PhotoPlaceholder = ({
  attachment,
  kind,
  box,
  messageId,
}: {
  attachment: MessageAttachment;
  kind: string;
  box: string;
  messageId?: string;
}) => {
  const download = useAttachmentFetch(messageId, attachment);
  if (!download.available) {
    return (
      <div className={cn(PHOTO_PLACEHOLDER, box)}>
        <div className="flex flex-col items-center gap-1.5 text-xs">
          <RiImageLine size={26} aria-hidden />
          <span>{placeholderLabel(kind, attachment)}</span>
        </div>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={download.request}
        disabled={download.waiting}
        aria-busy={download.waiting || undefined}
        aria-label={fetchAriaLabel(kind, attachment)}
        className={cn(
          PHOTO_PLACEHOLDER,
          box,
          "cursor-pointer appearance-none border-0 p-0 outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
          download.waiting && "cursor-progress",
        )}
      >
        <span className="flex flex-col items-center gap-1.5 text-xs">
          {download.waiting ? (
            <RiLoader4Line size={26} aria-hidden className="animate-spin" />
          ) : (
            <RiImageLine size={26} aria-hidden />
          )}
          <span>{photoFetchCaption(attachment, download.waiting)}</span>
        </span>
      </button>
      <FetchError text={download.error} />
    </div>
  );
};

/** Фото или его заглушка. Фон, а не <img>: глобальный хак картинок заявок в
 *  index.css (`img { width/height: auto !important }`) ломает размеры. */
export const PhotoAttachment = ({
  attachment,
  kind,
  compact = false,
  messageId,
}: {
  attachment: MessageAttachment;
  kind: string;
  compact?: boolean;
  /** Id сообщения — для докачки по клику; без него заглушка остаётся заглушкой. */
  messageId?: string;
}) => {
  const box = compact ? "h-28 w-50" : "h-31 w-55";
  if (attachment.status !== "ready" || !attachment.name) {
    return (
      <PhotoPlaceholder
        attachment={attachment}
        kind={kind}
        box={box}
        messageId={messageId}
      />
    );
  }
```

Edit 4 of 5 — in `frontend/src/components/Conversation/MessageMedia.tsx` replace exactly:

```tsx
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
```

with:

```tsx
/**
 * Голосовое: кнопка, полосы и длительность; проигрывает, когда файл есть.
 * Пропущенное — та же круглая кнопка качает файл (значок «скачать»).
 */
export const VoiceAttachment = ({
  attachment,
  compact = false,
  messageId,
}: {
  attachment: MessageAttachment;
  compact?: boolean;
  messageId?: string;
}) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const ready = attachment.status === "ready" && Boolean(attachment.name);
  const download = useAttachmentFetch(messageId, attachment);
  const fetchable = !ready && download.available;

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  };

  let icon = playing ? <RiPauseFill size={16} /> : <RiPlayFill size={16} />;
  let label = playing ? "Пауза" : "Прослушать голосовое";
  let hint = ready ? undefined : placeholderLabel("voice", attachment);
  if (fetchable) {
    icon = download.waiting ? (
      <RiLoader4Line size={16} className="animate-spin" />
    ) : (
      <RiDownload2Line size={16} />
    );
    label = fetchAriaLabel("voice", attachment);
    hint = fetchAction(attachment, download.waiting);
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 py-0.5">
        <button
          type="button"
          onClick={fetchable ? download.request : toggle}
          disabled={!ready && !fetchable}
          aria-busy={(fetchable && download.waiting) || undefined}
          aria-label={label}
          title={hint}
          className="grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-full border-0 bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {icon}
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
      <FetchError text={download.error} />
    </div>
  );
};
```

Edit 5 of 5 — in `frontend/src/components/Conversation/MessageMedia.tsx` replace exactly:

```tsx
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
```

with:

```tsx
/** Файл — чипом, как вложение в хронике заявки; пропущенный — чип-кнопка «Загрузить». */
export const FileAttachment = ({
  attachment,
  kind,
  messageId,
}: {
  attachment: MessageAttachment;
  kind: string;
  messageId?: string;
}) => {
  const download = useAttachmentFetch(messageId, attachment);
  const label = attachment.originalName || attachmentKindLabel(kind);
  const chip =
    "mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground no-underline";
  if (attachment.status !== "ready" || !attachment.name) {
    if (!download.available) {
      return (
        <span className={chip} title={placeholderLabel(kind, attachment)}>
          <RiAttachment2 size={13} aria-hidden />
          <span className="truncate">{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex max-w-full flex-col items-start">
        <button
          type="button"
          onClick={download.request}
          disabled={download.waiting}
          aria-busy={download.waiting || undefined}
          aria-label={fetchAriaLabel(kind, attachment)}
          className={cn(
            chip,
            "cursor-pointer appearance-none outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
            download.waiting && "cursor-progress",
          )}
        >
          {download.waiting ? (
            <RiLoader4Line size={13} aria-hidden className="animate-spin" />
          ) : (
            <RiAttachment2 size={13} aria-hidden />
          )}
          <span className="truncate">{label}</span>
          <span className="flex-none font-semibold text-accent-text">
            {fetchAction(attachment, download.waiting)}
          </span>
        </button>
        <FetchError text={download.error} />
      </span>
    );
  }
```

- [ ] **Step 8: The bubble passes the message id** (on top of P1b Task 8's `MessageBubble.tsx`)

Edit 1 of 3 — in `frontend/src/components/Conversation/MessageBubble.tsx` replace exactly:

```tsx
          <PhotoAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind="photo"
            compact={compact}
          />
```

with:

```tsx
          <PhotoAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind="photo"
            compact={compact}
            messageId={message.id}
          />
```

Edit 2 of 3 — in `frontend/src/components/Conversation/MessageBubble.tsx` replace exactly:

```tsx
          <VoiceAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            compact={compact}
          />
```

with:

```tsx
          <VoiceAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            compact={compact}
            messageId={message.id}
          />
```

Edit 3 of 3 — in `frontend/src/components/Conversation/MessageBubble.tsx` replace exactly:

```tsx
          <FileAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind={message.kind}
          />
```

with:

```tsx
          <FileAttachment
            key={`${attachment.name}-${index}`}
            attachment={attachment}
            kind={message.kind}
            messageId={message.id}
          />
```

- [ ] **Step 9: Lint, typecheck at baseline, build**

Run: `cd /home/aleksey/projects/hd/frontend && pnpm exec eslint src/util/attachment-fetch.js src/util/attachment-fetch.test.js src/components/Conversation/use-attachment-fetch.ts src/components/Conversation/MessageMedia.tsx src/components/Conversation/MessageBubble.tsx --max-warnings=0`

Expected: no output.

Run: `cd /home/aleksey/projects/hd/frontend && pnpm typecheck`

Expected: exactly the three baseline errors and nothing else — `src/components/app/FormWrapper.tsx(100,32)` TS2345, `src/pages/Finances/ApprovalReport.tsx(146,28)` and `(166,26)` TS2554 (the command exits non-zero because of them; "no new errors" is the gate).

Run: `cd /home/aleksey/projects/hd/frontend && pnpm build`

Expected: `vite build` finishes with `✓ built in …` (the thread page imports `MessageBubble` → `MessageMedia` → the hook, so all of it is in the bundle).

- [ ] **Step 10: Look in the browser** (dev stack running)

With P1b's demo data (`docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js` — its «[DEMO]» Telegram chat with Марина has a skipped photo `IMG_2291.jpg` and a skipped voice note), open that chat in «Диалоги». Expected, in both themes, on the desktop and on the phone: the photo tile and the voice button look as before, the tile reads «Загрузить · 1,8 МБ», the voice button shows the download glyph; a click turns the icon into a spinner and the request is accepted (`202`). No gateway serves the demo channel, so after 5 minutes the spinner stops with «Файл пока не пришёл — попробуйте ещё раз» and the button works again. A file chip is checked the same way on a live channel (owner check 11). The owner compares the look with the canvas placeholders (A1/B2) — per the mockup-first rule nothing else may change visually. Clean up with `docker compose -f compose.dev.yml exec backend node scripts/seedDemoConversations.js --remove` if the demo is no longer needed.

Checkpoint — no commit, no staging; report the changed paths to the owner.

---

## Owner checks (live Telegram — the owner runs these)

Everything above runs without Telegram. These need real accounts and are the spec's P1 live list. The settings UI arrives in P1b, so the steps use the staff API with the owner's browser session.

**The owner provides:**
- a **test** Telegram account (not the production corporate one) with its phone at hand, preferably with 2FA on — and a second, "client" account to write to it;
- an **API id/hash** from https://my.telegram.org for the test account;
- a **proxy** reachable from the dev host if Telegram is blocked there: SOCKS5 (with a password if you like) and, optionally, an MTProxy with a `dd…` secret (FakeTLS `ee…` is not supported);
- a staff **session cookie** with `settings.manage` and `conversation.*` (browser devtools → the `Cookie` header of any `/api` request).

**Setup:** the dev stack runs; `docker compose --profile messengers up -d msg-gateway`; the module «Диалоги» is on (it already is on dev). In a shell: `HD=http://localhost:8080/api` and `C="Cookie: <paste>"`.

1. **Channel + QR login + 2FA.** `curl -s -H "$C" -H 'Content-Type: application/json' -d '{"type":"telegram","name":"Тест TG","secrets":{"tgApiId":"<id>","tgApiHash":"<hash>"},"settings":{"proxyUrl":"","historyDays":3}}' $HD/channels` → note `channel.id` as `CH`. `curl -s -H "$C" -H 'Content-Type: application/json' -d '{"step":"start"}' $HD/channels/$CH/login`. Within a few seconds `curl -s -H "$C" $HD/channels | jq '.channels[] | select(.id=="'$CH'") | {state, login}'` shows `awaitingQr` and `login.qr` = `tg://login?token=…`; render it (`qrencode -t ansiutf8 '<qr>'` or any QR generator) and scan it on the test phone (Settings → Devices → Link Desktop Device). With 2FA the state becomes `awaitingPassword`; send `{"step":"password","value":"<2FA password>"}` — a wrong one fails the job (`GET /channels/$CH/jobs/<jobId>` → `failed`, «Неверный пароль») and the state keeps asking. Expected end: `state: "connected"`, `account` filled; Telegram → Devices lists «HD msg-gateway».
2. **Phone-code login.** Log out first: `curl -s -X POST -H "$C" $HD/channels/$CH/logout` → `loggedOut`. Then `POST $HD/channels/$CH/login` with `{"step":"phone","value":"+7…"}` → `awaitingCode`; `{"step":"code","value":"<code from Telegram>"}` → `connected`, or `awaitingPassword` → `{"step":"password",…}` → `connected`.
3. **Receive.** From the client account send: text, a photo, a voice note, an edit of the text, a deletion. `GET $HD/conversations?queue=all` shows the chat; `GET $HD/conversations/<id>/messages` shows them in order — photo and voice `ready`, the edit applied, the deleted one with `deletedAt`, «Ждёт ответа» on.
4. **777000 and Saved Messages.** Log the test account in somewhere else to get a login code, and write to Saved Messages from the phone. Neither appears in HD.
5. **Send once.** `curl -s -H "$C" -F text='Проверка связи' $HD/conversations/<id>/messages`. The client gets it exactly once; within a minute the message is `sent`, and `read` after the client opens the chat; «Ждёт ответа» cleared.
6. **Phone reply appears once.** Reply from the test account's phone app. HD shows it once as «с телефона» (`origin: device`), and it clears «Ждёт ответа».
7. **kill -9 mid-send.** Send a long reply (`-F text="$(python3 -c 'print("Длинный ответ. " * 1000)')"` — 15 000 characters, four parts) and right away `docker kill -s KILL hd-msg-gateway-1`; then `docker compose --profile messengers up -d msg-gateway`. Within 2–3 minutes (lease expiry) the job is re-leased. The client sees each part exactly once; HD shows one message, `sent`, and no «с телефона» duplicate — even after the next gap check (5 min).
8. **Backend down 5 minutes.** `docker compose stop backend`; the client writes three messages and a photo; wait 5 minutes (`/health` inside the gateway container shows `journal` > 0); `docker compose start backend`. Within about a minute all four appear in order, and `journal` returns to 0.
9. **Proxy on/off.** `curl -s -X PATCH -H "$C" -H 'Content-Type: application/json' -d '{"settings":{"proxyUrl":"socks5://user@host:1080"},"secrets":{"proxyPassword":"<pass>"}}' $HD/channels/$CH` → the gateway reconnects (logs), `POST $HD/channels/$CH/test` → job `done` with `result.latencyMs` and `viaProxy: true` (the settings dialog shows «✓ Прокси отвечает · N мс»). A dead proxy → the test job fails with «Telegram недоступен…» and, after reconnecting fails, the channel shows `error`. An `ee…` MTProxy secret → `error` «MTProxy с FakeTLS-секретом…». Clear `proxyUrl` → `connected` again.
10. **History import.** `curl -s -H "$C" -H 'Content-Type: application/json' -d '{"days":3}' $HD/channels/$CH/history` → the job ends `done` with `result {chats, messages}`; imported messages are `imported: true`, their media `skipped`, and no chat starts «Ждёт ответа».
11. **Media on request.** Set `maxMediaMb` to 1 (`PATCH` settings), send a 3 MB photo and a 3 MB PDF from the client → both attachments `skipped`. In the thread, click «Загрузить» on the photo tile: a spinner, then the photo within seconds (or `curl -s -X POST -H "$C" $HD/messages/<messageId>/media` → `202 {jobId}`); the PDF chip the same way. Repeat with the chat bound to a ticket (`POST $HD/conversations/<id>/bind`): after the fetch, the ticket's comment for that message carries the file too, and its text stays «Файл «…»».
12. **Session terminated on the phone.** Telegram → Devices → terminate «HD msg-gateway». Within 5 minutes (gap check) the channel is `loggedOut` with «Сессию завершили в Telegram…».
13. **A copied volume starts nothing.** Optional: copy the volume content to another dev checkout with another `APP_PUBLIC_URL` — the channel shows `error` «Сессия создана другой установкой…», and Telegram shows no second login.

14. **Retry keeps the signature.** With `signReplies` on (the default): block the test account from the client account, send a reply from HD → it ends `failed` («Не доставлено», `USER_IS_BLOCKED`); unblock, `curl -s -X POST -H "$C" $HD/messages/<messageId>/retry` → the client receives the text with «— <first name>, <organisation>», exactly as a first send would.

Record the results in the P1 report; failures go back to the controller with the gateway logs (`./deploy.sh logs msg-gateway` or `docker compose logs msg-gateway`).
