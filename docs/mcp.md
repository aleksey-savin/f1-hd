# MCP Access — Implementation Notes

_Last updated: 2026-10-10. This document covers the `/api/mcp` endpoint end to
end: keys and permissions, the request path, the knowledge-base, ticket and
Mikrotik tools, data protection and how to test the module. It is a snapshot, not a
spec — verify against the code before relying on any detail._

## Overview

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
endpoint that lets the organisation's staff-only AI agent (OpenClaw) read HD's
knowledge base, tickets and Mikrotik devices, and (with the separate `mikrotikChanges` access) propose Mikrotik configuration changes that people approve in HD; everything else is read-only. It is one endpoint inside the backend, not a
separate service: no OAuth, no per-person login — a key belongs to the
organisation, the same way a Telegram bot token does.

Two design specs cover the decisions behind this module:

- `docs/superpowers/specs/2026-09-17-kb-mcp-access-design.md` — the endpoint
  itself, keys, transport, and the two knowledge-base tools (approved
  2026-09-17).
- `docs/superpowers/specs/2026-09-17-mcp-tickets-design.md` — permissions
  (`scopes`), the four ticket tools, masking (approved 2026-09-17, backend
  implemented and verified live 2026-09-18).

`docs/knowledge-base.md`, «Agent access (MCP)» keeps a short pointer here now;
its `McpKey` data-model entry points here too. Operating the endpoint (rotating
a key, the OpenClaw config snippet) is documented in `docs/deployment.md`,
«AI agents (MCP)».

## Request path

### Mount order

`backend/routes/index.js` mounts `/mcp` (→ `backend/routes/mcp.js`) right after
`/bot` (the Telegram service) and **before** `internalRoutes.use(attachSession)`.
Both routes are mounted early for the same reason: the agent's own credential
arrives as `Authorization: Bearer …`, and better-auth's `bearer()` plugin
(wired by `attachSession`) would otherwise try to treat it as a session token.
Nothing under `/mcp` falls through to `attachSession` or the normal routes —
the router answers every method and every sub-path itself (see below).

### `mcpRouter.js` → `mcp.js`

`backend/routes/mcpRouter.js` is a dependency-free factory (`buildMcpRouter`),
the same pattern as `routes/inventoryMount.js`: gates and the handler arrive as
arguments, so the route's contract can be tested without a database or a file
logger (`routes/mcp.test.js`). `backend/routes/mcp.js` wires it with the real
`McpKey` model, `services/mcp/knowledgeSource.js` + `knowledgeTools.js`,
`services/mcp/ticketSource.js` + `ticketTools.js`, and the logger.

Chain on `POST /`: `requireKey` → per-key rate limiter → `handle`.

- The limiter (`express-rate-limit`) allows **120 requests/minute per key**
  (`RATE_LIMIT_MAX`), keyed `mcp:<keyId>` — it runs *after* the key check
  because the limit is per key, not per IP ("ключ → лимит (на ключ, поэтому
  после ключа) → MCP", `mcpRouter.js`). Over the limit → `429` with
  `{"error":true,"status":429,"message":"Слишком много запросов с этим ключом — попробуйте через минуту"}`.
- Any other method on `/` → `405` with `Allow: POST` (no sessions, so no `GET`
  stream or `DELETE`).
- Anything else under `/mcp` → `404` with
  `{"error":true,"status":404,"code":"ERR_404","message":"Endpoint not found"}`
  — the same shape as the app-wide 404 handler (`backend/app.js:185-191`).

### `requireMcpKey` — `backend/middleware/requireMcpKey.js`

- Accepts only `Authorization: Bearer hd_mcp_<64 hex>` — no query string, no
  `X-API-Key`. The format (`isMcpKeyFormat`, `utils/apiKeyGenerator.js`) is
  checked **before** any database read, so malformed tokens and company API
  keys (`hd_…`, a different prefix) never reach Mongo.
- Looks the key up by **sha256** (`hashApiKey`) in `mcpkeys`, selecting
  `name lastUsedAt scopes`.
- Sets `req.mcpKey = { _id, name, scopes: normalizeScopes(key.scopes) }` and
  **never** `req.auth` — that field is a staff session identity in this app,
  and an agent doesn't have one.
- Updates `lastUsedAt` **at most once an hour** (`TOUCH_EVERY_MS`), the same
  interval as company API keys (`middleware/isAuthApiKey.js`): fire-and-forget,
  failure swallowed, never blocks the response.
- Refusals are answered **directly** — `401` JSON plus
  `WWW-Authenticate: Bearer realm="hd-mcp"` — instead of `next(AppError)`,
  because the shared error handler calls `next(error)` *after* replying and
  Express's `finalhandler` then destroys the socket; an MCP client needs a
  well-formed `401`. Reasons: `missing` (no header), `malformed` (wrong
  shape), `unknown` (no matching hash) — logged as `warn`
  `"MCP: ключ доступа не принят"` with `{ reason, endpoint, ip }`. A database
  error while looking the key up goes to `next(error)` instead (it isn't "the
  key is bad").

### Request context and tool families

`loadContext` (`routes/mcp.js`) reads `Preferences` **once per request** —
`.select("modules timezone defaultApplicant._id mikrotik.applicant._id").lean()`
— and returns:

```js
{
  modules: { knowledgeBase, timeTracking, inventory, mikrotik },  // booleans
  timezone,                                             // resolveTimezone(prefs)
  systemAccounts: { unidentifiedId, robotIds },         // ids as strings, or null/[]
}
```

Tools never read `Preferences` themselves. `toolFamilies({ scopes, modules })`
(`services/mcp/server.js`) then decides what this request can register:

```js
knowledge = scopes.includes("knowledge") && Boolean(modules.knowledgeBase);
tickets   = scopes.includes("tickets");   // no module gate — tickets are core
mikrotik  = scopes.includes("mikrotik") && Boolean(modules.mikrotik);
companies = scopes.includes("companies");
users = scopes.includes("users");
mikrotikChanges = scopes.includes("mikrotikChanges") && Boolean(modules.mikrotik);
```

If **no** family is available, `createMcpRequestHandler` answers `403`
before the SDK runs at all:

```json
{"error":true,"status":403,"message":"Ключу нечего читать: модули, к которым у него есть доступ, отключены."}
```

This replaces the previous design, where a `knowledgeBaseModuleIsActive`
middleware gated the whole route: the module gate now lives inside tool
registration, because a `tickets`-scoped key must keep working while the
knowledge-base module is off.

### Transport — SDK v2, stateless legacy path

`services/mcp/server.js` uses the official TypeScript SDK v2
(`@modelcontextprotocol/server` + `@modelcontextprotocol/node`, CJS builds):

- `createMcpHandler(factory, { maxSubscriptions: 0, onerror })` — stateless, a
  fresh `McpServer` per request (`buildHdServer`), server info
  `{ name: "hd-helpdesk", version }` (from `package.json`). No subscriptions,
  no long-lived streams.
- OpenClaw 2026.9.4 bundles `@modelcontextprotocol/sdk@1.30.0` (protocol
  2025-11-25) and is served on the SDK's **legacy stateless path**: every
  `POST` gets a short `text/event-stream` response (`X-Accel-Buffering: no`)
  that closes with the result, so neither the built-in nginx nor an external
  proxy needs any special configuration. The request `Accept` header must
  list both `application/json` and `text/event-stream`, or the SDK answers
  `406`.
- Identity reaches the tools through `authInfo.extra`, not `req.auth`:
  `createMcpRequestHandler` builds
  `authInfo = { token: "", clientId: keyId, scopes, extra: { caller: { keyId, keyName }, context } }`
  and calls `mcp.fetch(request, { ...options, authInfo })` via
  `toNodeHandler({ fetch })`.
- Tool argument schemas are plain JSON Schema through `fromJsonSchema` — no
  zod (`docs/typescript-guide.md`). Arguments outside a tool's schema are
  rejected by the SDK before the tool handler runs.
- SDK-level rejections (wrong `Accept`, malformed JSON-RPC) and any failure
  after the response has already started are logged as `warn`
  `"MCP: запрос отклонён"` with `{ error }` via the shared `onError` callback
  (`routes/mcp.js`).

### Tool execution and failures

Every registered tool handler, in every family, is wrapped by `guard()` in
`server.js`. On success it just calls through; on a **thrown** error (a data
source that fails — a DB timeout, for instance) it:

1. logs one `error`-level line `"MCP tool call failed"` with
   `{ mcpKeyId, mcpKeyName, tool, error: error.message, durationMs }`;
2. returns a **neutral** tool error to the agent —
   `{ isError: true, content: [{ type: "text", text: "HD could not answer this call because of an internal error. Try again later." }] }`
   — the database's own error message never reaches the agent.

One gap remains outside `guard()`'s reach: a failure in `loadContext` or in the
key lookup (before a tool, or even an `McpServer`, exists) still falls through
to the app's shared error handler (`errorResponse`), which puts the **raw**
error message in the JSON body — the same pre-existing behaviour as any other
route-setup failure in this codebase. Ruled acceptable for a staff-only
audience (`.superpowers/sdd/2026-09-17-mcp-tickets/progress.md`, Task 9).

## Keys and permissions

### `McpKey` — `backend/models/mcpKey.js`

Collection `mcpkeys`: `name` (required, trimmed, ≤100), `keyHash` (sha256,
`select: false`, unique index), `keyTail` (last 4 characters, for display),
`createdBy → User`, `lastUsedAt` (`Date`, default `null`), `scopes`
(`["knowledge" | "tickets" | "companies" | "users" | "mikrotik" | "mikrotikChanges"]`, default `["knowledge"]`), timestamps. The key
value itself is **never stored** — only its hash and tail.

`services/mcp/keys.js`:

- `issueMcpKey()` — `generateMcpKey()` (`hd_mcp_` + 64 hex,
  `utils/apiKeyGenerator.js`) plus its sha256 (`keyHash`) and last-4
  (`keyTail`). The plaintext value exists only in the create response.
- `MCP_SCOPES = ["knowledge", "tickets", "companies", "users", "mikrotik", "mikrotikChanges"]` (frozen, this exact order).
- `normalizeScopes(scopes)` — filters an arbitrary array down to known scopes
  in `MCP_SCOPES` order; an empty, missing or all-unknown input becomes
  `["knowledge"]`. This is what makes a key stored before `scopes` existed
  (or narrowed to nothing by mistake) read as knowledge-only, never as "no
  access".
- `toKeyRow(key)` — the whitelist every list/create/update response is built
  from: `_id, name, keyTail, scopes (normalized), createdAt, lastUsedAt,
  createdBy { _id, firstName, lastName }`. `keyHash` is never in this object,
  even though a freshly-created Mongoose document still has it in memory
  (`select: false` only affects queries).

### API — `backend/controllers/mcpKey.js`, mounted in `routes/internal/preferences.js`

All four routes are `isAuth, canManageSettings` and **not** module-gated — a
key must always be revocable, even with the knowledge-base module off.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/preferences/mcp-keys` | — | `200 { endpoint, keys: [...toKeyRow] }` |
| `POST` | `/api/preferences/mcp-keys` | `{ name, scopes? }` | `201 { message, endpoint, key: { ...row, value } }`; `409` on a case-insensitive duplicate name |
| `POST` | `/api/preferences/mcp-keys/update` | `{ _id, scopes }` | `200 { message, key }`; `404` if `_id` doesn't exist |
| `POST` | `/api/preferences/mcp-keys/delete` | `{ _id }` | `200 { message }`; `404` if `_id` doesn't exist |

`endpoint` is always `${ADDRESS}/api/mcp` (`ADDRESS` with trailing slashes
trimmed) — the installation's public address, not whatever host the admin's
browser happened to hit behind a reverse proxy.

Validation (`backend/validations/mcpKey.js`):

- `create` — `name` required (string, trimmed, non-empty, ≤100 — the
  controller re-checks the trimmed value for duplicates); `scopes`
  **optional**, but if present must be a non-empty array of known scopes
  (`isArray({ min: 1 })`, so `scopes: []` is rejected — omit the field
  entirely to fall back to `["knowledge"]`).
- `update` — `_id` must be a Mongo id; `scopes` **required**, same
  non-empty/known-values rule.
- `remove` — `_id` must be a Mongo id.

Audit log (`logger.addContext(req)`, level `info`; key values are never
logged):

| Action | Message | Fields |
|---|---|---|
| create | `MCP: выдан ключ доступа` | `mcpKeyId, mcpKeyName` |
| update | `MCP: изменён доступ ключа` | `mcpKeyId, mcpKeyName, scopes` |
| delete | `MCP: ключ доступа удалён` | `mcpKeyId, mcpKeyName` |

Deleting **is** revoking — `requireMcpKey` looks the key up on every request,
there is no cache, so the very next call with a deleted key gets `401`.

The Settings UI for permissions waits for mockup approval (see the tickets
spec's Status line); a key created through Settings today gets the default
`scopes: ["knowledge"]`. Granting `tickets` currently requires calling
`/mcp-keys` or `/mcp-keys/update` directly with an explicit `scopes` body.

## Knowledge base tools

Moved here from `docs/knowledge-base.md`, «Agent access (MCP)» (that doc now
only points here); unchanged unless noted.

### Scope

`services/mcp/knowledgeTools.js#scopeFilter` is applied in the query, and
`isServable` re-checks every note in memory, so a data source that returns too
much cannot widen the boundary:

```js
{ archivedAt: null, pendingDeletion: { $ne: true }, approved: true, "secretsScan.flagged": { $ne: true } }
```

- **Only the current `secretsScan.flagged` decides.** A note whose findings a
  moderator marked «Не секрет» is served: `ignoreSecretFinding` recomputes
  `flagged = findings.length > 0`, and the hourly and on-save scans honour
  `ignoredHashes`. `findings`, `ignoredHashes` and `scannedAt` are never
  consulted; a note without a `secretsScan` subdocument is served.
- **Approval does not clear the flag** (`approve` leaves `secretsScan`
  alone): an approved note with undismissed findings stays hidden.
- **Why this is enough:** approving requires `confirmNoSecrets: true`, any
  edit resets approval, and the scanner flags credentials. HD does **no
  secret scanning of its own** on this path (owner decision, 2026-09-17) —
  the moderation flag is the only guard. Limits: the flag is only maintained
  while `knowledgeBase.scanForSecrets` is on; notes never scanned stay
  visible until the hourly pass after scanning is switched on; the scanner
  stores at most 25 findings, so dismissing those 25 on a note with more
  leaves it unflagged until the next scan.
- **Not per user.** `canViewNote` is not applied (there is no viewer) and
  company bindings do not restrict: whoever holds a `knowledge`-scoped key
  can read every servable note. **Note text is returned unmasked** — unlike
  tickets (see «Data protection»), scope is the only protection here; there
  is no `maskText` pass over note content.
- A hidden, missing or malformed id gets the same `isError` answer, so the
  agent cannot tell that a hidden note exists.

### Tools

| Tool | Arguments | Result |
|---|---|---|
| `search_knowledge_base` | `query` (1–300 chars), `limit` (1–20, default 8) | `Found N approved notes…`, then per note: title, id, type label, `approved` (ISO instant), companies, categories, link `${ADDRESS}/knowledge-base/<id>`, snippet |
| `get_knowledge_note` | `id` | title, id, type, `approved`, companies, categories, link, bound users, then the Markdown `content` |

Both are annotated `readOnlyHint`, `idempotentHint`, not destructive, closed
world.

- **Ranking** reuses `knowledgeBaseContext.toStems` / `scoreNote` (title stem
  3, body stem 1) plus 2 for each query stem found in a company alias,
  category title or bound user name. If the query has no stems or nothing
  scores, it falls back to the shared substring helpers in
  `services/mcp/text.js` — `fallbackTerms` (≤8 whitespace-separated terms)
  and `hasAllTerms` (every term must occur) — over title + `plainText` +
  bindings (IP addresses, host names; fenced code is not part of
  `plainText`). The same two helpers now back the ticket tools' fallback
  search too (previously duplicated code, unified in this batch). Order:
  score → type priority → `approvedAt` desc.
- **`updatedAt` is deliberately unused.** Existing notes still carry the
  time of the last scan from before the 2026-09-17 fix
  (`docs/knowledge-base.md`, «Background jobs»), while an edit resets
  approval — so for an approved note `approvedAt` is the reliable freshness
  of its text.
- **Snippet:** `services/mcp/text.js#buildSnippet` — 100 chars before and
  200 after the first match in `plainText`.
- **Content:** `![alt](data:…)` → `[изображение: alt]`, other base64 data
  URIs → `[данные]`, capped at 40,000 chars with a truncation marker.
- **Data access:** `services/mcp/knowledgeSource.js` — `findCandidates()`
  without `content` (reads every servable note, unlimited — the base is
  small, ~200 notes), `findNoteById(id)` with it; the scope fields are
  always selected because `isServable` re-checks them.
- **Logging:** one `info` line `MCP tool call` per call with `mcpKeyId`,
  `mcpKeyName`, `tool`, `query` (≤100 chars) or `noteId` (≤64 chars), `hits`
  / `found`, `durationMs`. Key values are never logged.

## Ticket tools

Four read-only tools (`services/mcp/ticketTools.js`), registered only when the
key has the `tickets` scope (no module gate). Data access is
`services/mcp/ticketSource.js`; formatting is `services/mcp/ticketFormat.js`;
ranking and filters are `services/mcp/ticketQuery.js`; grouping is
`services/mcp/ticketStats.js`.

### Common rules

- **Name resolution** (`ticketQuery.js#resolveByName`) — every word of the
  given name must occur in the candidate's label, case-insensitive with ё
  folded to е (`text.js#normalize`); if one or more candidates match
  **exactly** (full alias/title, or «Фамилия Имя» / «Имя Фамилия» for a
  person), the exact ones win over containing matches (`«Ромашка»` doesn't
  lose to `«Ромашка-Строй»`). Zero matches, or several matches left after the
  exact-match tie-break, is a **tool error** naming the options (up to 10) —
  the agent narrows the name itself, it never gets a guess.
- **People** are shown as «Фамилия Имя», with position and a marker:
  `client`, `staff`, or `system` (`ticketFormat.js#personLabel`). The
  unidentified e-mail sender (`Preferences.defaultApplicant`) prints as
  `unidentified e-mail sender (system)`; the Mikrotik monitoring account
  (`Preferences.mikrotik.applicant`) and any user flagged
  `isServiceAccount`/`isCloudTelephony` print `(system)` too
  (`ticketFormat.js#isSystemUser`). An id absent from the user directory
  prints `unknown person` (see the `authorId` data quirk below).
- **Links** — `ticketFormat.js#ticketLink`: `${ADDRESS}/tickets/<num>` with
  trailing slashes of `ADDRESS` trimmed.
- **Instants** are full ISO (`text.js#iso`); no calendar-date truncation.
- **Logging** — one `info` line `"MCP tool call"` per call
  (`ticketTools.js#logCall`) with `mcpKeyId`, `mcpKeyName`, `tool`, and
  tool-specific fields (`query`/`filters`/`results`, `num`/`found`,
  `groupBy`, or `error: "name" | "date"` when the call was rejected before
  touching data).
- **Directory** — every tool call starts with `source.loadDirectory()`
  (companies, users, categories, unfiltered) to resolve names and build
  labels; it is reloaded from scratch on **every** call, not cached (see
  «Known limits»).

### Data quirks in `ticketSource.js`

- **`Ticket` must be destructured.** `backend/models/ticket.js` exports
  `{ Ticket, ticketDefaultFieldsSchema, initializeCounter }`, not the model
  itself, so `ticketSource.js` destructures it
  (`const { Ticket } = require("@/models/ticket")`). A non-destructured
  import (`const Ticket = require(...)`) still loads without error but
  leaves `Ticket.find`/`.countDocuments`/`.findOne` all `undefined` — this
  broke every ticket tool call and was only caught by the 2026-09-18 live
  check, since a wiring test only catches it if its model stub is
  deliberately shaped like the real `{ Ticket, … }` export (see
  `services/mcp/ticketSource.test.js`).
- **`comments.createdBy` — two shapes.** `Comment`'s schema declares
  `createdBy` as an `ObjectId` ref, but in the 2026-09-18 production copy
  **6,865 of 14,000** comments (≈49%) still store it as a legacy embedded
  snapshot `{ _id, firstName, lastName }` predating a schema refactor — old
  documents were never back-migrated. `authorId()` (`ticketSource.js`)
  normalizes both shapes: it reads `_id` off an object, or uses a plain id
  as-is, and returns a string either way; without it, `String()` on the
  object shape produces the literal text `"[object Object]"`, which the
  user directory can never match. Authors are labelled only through that
  directory (`ticketFormat.js#personLabel`) — the legacy snapshot itself
  carries no e-mail/phone keys to worry about masking (checked in dev). An
  id neither shape resolves in the directory prints `unknown person`.
- **Other embedded ids were checked too.** `applicantId`, `categoryId`,
  `company._id` and `routineTask` are never stored as embedded objects on a
  ticket — only `comments.createdBy` has this legacy shape.

### `search_tickets`

| Argument | Rule |
|---|---|
| `query?` | words, an IP/host name, or a ticket number; ≤300 chars |
| `status` | `open` \| `closed` \| `any` (default `any`) |
| `company?`, `user?`, `category?` | resolved names (see «Common rules») |
| `from?` / `to?` | `YYYY-MM-DD`, organisation timezone, both ends inclusive, by creation date |
| `limit` | 1–50, default 10 |
| `page` | 1–1000, default 1 |

Filters map to existing indexes on `Ticket` (`isClosed`, `"company._id"`,
`applicantId`, `categoryId`, `createdAt`, and the unique `num` —
`backend/models/ticket.js`), several already compound in the shape these
queries use (`"company._id"+isClosed+createdAt`, `applicantId+createdAt`).

**Search, with a query:**

1. **An all-digit term also matches `num`.** Every whitespace-separated term
   in the query that is all digits is looked up as a ticket number
   (`num: { $in: [...] }`, same status/name/date filters) — these matches
   are listed **first**. This runs *in addition to*, not instead of, the
   normal ranking: `search_tickets({ query: "2900" })` returns both the
   ticket literally numbered 2900 (if it exists and passes the filters)
   *and* tickets whose title/description mention "2900" (e.g. a printer
   model), because `toStems` drops all-digit words and they would otherwise
   only ever be found through the substring fallback below. Numbered matches
   are de-duplicated out of the ranked list by `_id`.
2. Up to `MAX_CANDIDATES = 20 000` newest matching tickets (same filters)
   are loaded and ranked by `ticketQuery.js#rankTickets`: word stems over
   the title (weight 3) and the plain description (`ticketPlainText`,
   weight 1); if the query has no stems or nothing scores, it falls back to
   the same `fallbackTerms`/`hasAllTerms` substring match as the knowledge
   base (≤8 terms, every term must occur in title + text).
3. Result rows are paged in memory (`total = ranked.length`) — with a
   query, pagination is over the ranked list, not a second database query.
4. When the candidate list actually hit the cap, the header adds
   `ranked the newest 20,000 tickets only`, so `Found N` is not read as the
   whole archive.

A page past the last one answers `No tickets on page N (M found). Ask for an
earlier page.` instead of an empty `showing 21–20` range (both with and
without a query); the call is logged as usual.

**Search, without a query:** newest first, paged in the database
(`countTickets` + `findTickets` with `skip`/`limit`).

**Dates that aren't real calendar days are a tool error, not a silent
rollover.** `buildTicketFilter`'s `checkDay` throws
`` `<from|to> must be a calendar day as YYYY-MM-DD, got "<value>"` `` for
anything that fails a real calendar-day check (e.g. `2026-09-31`,
`2026-02-30`) — the tool's JSON Schema only checks the `YYYY-MM-DD`
**shape** (`pattern: "^\\d{4}-\\d{2}-\\d{2}$"`), so an agent-supplied
`2026-09-31` reaches this check and gets a message it can act on, instead of
`dayjs` silently rolling it into October. `search_tickets` and
`ticket_stats` both catch this and return a tool error with the exact
message (logged as `{ error: "date" }`).

**Result:** total count, then per ticket — number, masked title, status
label (`open`/`closed` + the raw `state` string) and open/closed, company,
applicant, category, created/closed instants, link, and (with a query) a
masked snippet built from the **already-masked** text (see «Data
protection»).

### `get_ticket`

Argument: `num`. Not found → tool error naming `search_tickets` as the way to
get a number. Sections, in order:

- **Header** — title (masked), status + raw `state`, source, category,
  company (alias + full title), applicant, responsibles (names only),
  routine task title (masked, if any), created / processed / started /
  closed / deadline (full ISO), link.
- **Description** — `text.js#ticketPlainText`: HTML from the portal editor
  → lines (`htmlToPlainLines`, `backend/helpers/htmlToPlainText.js`), but only
  when the text actually looks like HTML. That test is `text.js#hasHtmlTag`, a
  linear scan: an optional `/`, a tag name and then `>`, `/>` or a blank with
  a `>` somewhere to the right (the regex it replaced re-scanned the whole
  tail from every `<a `). Plain text takes the other branch and is cut by the
  same `clampInput` (`backend/helpers/textScan.js`), so the description
  reaches the masks at **no more than 256 K characters** (`MAX_INPUT_LENGTH`)
  on **both** branches — the request body allows 10 MB, and `maskText` runs
  over the whole text before the output is clipped. Above the cap `clampInput`
  cuts base64 data URIs out first, without a marker, so the `[данные]` marker
  shows up only on texts up to the cap. Then the quoted reply chain is cut
  for e-mail tickets (`stripQuotedReply`,
  `backend/services/emailReplyStripper.js` — the signature stays,
  `maskText` closes its contacts), the remaining base64 data URIs become
  `[данные]`, the text is masked, capped at 20,000 chars, and quoted with
  `> ` line by line.
- **Questionnaire** — `name: answer` per custom field
  (`formatAnswer`, `backend/services/ticketQuestionnaire.js`), both masked
  and collapsed to one line.
- **Checklist** — `- [x]`/`- [ ]` per item, description masked and collapsed
  to one line.
- **Comments (`N`)** — **all**, oldest first, each `instant · person:`
  followed by the content on its own quoted lines (masked, capped 4,000
  chars, every line prefixed with `> ` — see «Untrusted text is fenced»).
  Loaded by `{ ticketId }` **and** the ticket's own `comments` array ids
  (`$or`), so e-mail replies that predate the array push (before 2026-07-08) are
  still included; a `{ ticketId: 1, createdAt: 1 }` index on `Comment`
  backs this (`backend/models/comment.js:83`).
- **Works (`N`)** — only while `modules.timeTracking.isActive`: performer
  (`finishedBy` if set, else `executor`), start/finish instants, duration
  in minutes (`workDurationMs`, `backend/services/workSummary.js`),
  on-site/remote (`visitRequired`), description masked, capped at
  4,000 chars and quoted on its own lines. No `finances`, no `withinPlan`,
  no money anywhere.
- **Devices (`N`)** — only while `modules.inventory.isActive`: the
  ticket's `relatedClientDeviceId` plus, unless the applicant is a system
  account, the applicant's own top-level devices (`{ userId: applicantId,
  parentDeviceId: null }`, `deletedAt: null`). Per device: type, vendor +
  model, inventory number, serial number, status, OS — **no** IP, MAC,
  hostname, license/purchase data, notes or photos
  (`ticketSource.js#DEVICE_FIELDS` is a positive projection:
  `deviceModelId deviceTypeId serialNumber inventoryNumber status
  operatingSystem`, nothing else is ever read from Mongo).

### `find_similar_tickets`

| Argument | Rule |
|---|---|
| `num` | required, ticket to compare with |
| `scope` | `same_company` \| `all` (default `same_company`) |
| `status` | `closed` \| `any` (default `closed`) |
| `limit` | 1–30, default 10 |

Query = word stems of the source ticket's title + `ticketPlainText`
(`ticketQuery.js#rankSimilar`); if the source ticket has no stems, the answer
is "No similar tickets" (nothing to compare). Candidates: up to
`MAX_CANDIDATES` newest tickets matching scope/status, with the source ticket
excluded by the database filter itself (`_id: { $ne: origin._id }`). Ranking:
score desc, then **same category** first, then the **latest close**
(`finishedAt` desc), then newest `createdAt`.

Each result adds **"how it was solved"**:

- the **closing comment**, only when it is *meaningful* — trimmed length
  ≥ 100 chars (`MEANINGFUL_CLOSING`, the same threshold the AI guide uses),
  masked, capped at 600 chars;
- the matched ticket's **work descriptions** (`source.loadWorkDescriptions`),
  only while `modules.timeTracking.isActive` — the same module rule as
  `get_ticket`'s `## Works` section — joined with " / ", masked, capped at
  600 chars.

Both are collapsed to one line, like the snippet: a result row is a fixed set
of one-line fields, and a newline in ticket text must not break out of it.

### `ticket_stats`

| Argument | Rule |
|---|---|
| `groupBy` | `category` \| `month` \| `company` \| `applicant` \| `source` (default `category`) |
| `status` | `any` \| `open` \| `closed` (default `any`) |
| `company?`, `user?`, `category?`, `from?`, `to?` | same as `search_tickets` |

`source.loadStatsRows(filter)` loads a slim projection (`STATS_FIELDS =
"categoryId company._id applicantId source createdAt finishedAt isClosed"`)
of **every** matching ticket — no row cap, unlike search/similar — and
`ticketStats.js#aggregateTicketStats` groups and aggregates **in code**, not
with `$group`/`$median` (MongoDB's `$median` accumulator needs MongoDB 7+, so
the code aggregates the slim projection in JavaScript instead).

Per group: ticket count, open, closed, **median hours** from creation to
close (closed tickets with a `finishedAt` only, rounded to 1 decimal), and
**share** of the filtered total (%, 1 decimal). Group labels are always
names, never ids (`labelOf`, built from the same directory as name
resolution).

- **`month`** groups key on `dayKey(row.createdAt, timezone).slice(0, 7)`
  (`YYYY-MM`, organisation timezone — `utils/datetime.js`), sorted
  chronologically, and are **never folded** — every month in range gets its
  own row, however many there are.
- **Every other `groupBy`** sorts by ticket count desc (ties by key), keeps
  the **top 50**, and merges the rest into one trailing `«остальные»` row
  (counts summed, hours concatenated before computing its own median).

Rendered as a Markdown table (`ticketFormat.js#formatStats`):
`| <groupBy> | tickets | open | closed | median hours to close | share |`.

## Directory tools

Two read-only tools (`services/mcp/directoryTools.js`), each behind its own key
scope and with no module switch: `list_companies` needs `companies`,
`list_users` needs `users`. They exist so an agent can check that a company
exists and that a person works in it before acting on a request such as
"remote access for Pukhova at Avtogarant".

**What leaves `directorySource.js`.** The source is the only reader of the
models and returns a positive projection, so the tool has nothing to leak:

- company: `alias`, `fullTitle`, `isActive`; subdivision: `name`, company id;
- user: first and last name, `position`, `isEndUser`, company and subdivision
  ids, and three derived flags — `isSystem` (service account or cloud
  telephony), `isBlocked` (`isBanned(user)`, so a ban with an expired term is
  not a ban) and `telegramLinked` (bot active and a chat id present).

E-mail, phone, the Telegram chat id, addresses, map links and company
requisites are never selected. Names and positions are personal data that
tickets already give the agent (`personLabel`); nothing beyond them is added.

| Tool | Arguments | Returns |
|---|---|---|
| `list_companies` | `query?` (part of alias or full title), `status?` (`active` default, `inactive`, `any`), `limit?` (1-200, default 50) | Sorted by alias: alias, full title when it differs, `active`/`inactive`, `people: N` (not blocked, not system), subdivisions |
| `list_users` | `query?` (words of the name or position), `company?` (resolved with `resolveByName`: none or several matches is an error result with the options), `kind?` (`client`, `staff`, `any` default), `status?` (`active` default, `blocked`, `any`), `limit?` | Sorted by name: name, company, subdivision, position, `client`/`staff`, `active`/`blocked`, `Telegram linked: yes/no` |

Rules: system accounts (`isSystem`, the unidentified sender and the robot
applicants from the request context) are never listed; search ignores case and
`ё`/`е`; an empty result is a normal answer, not an error; a truncated list
says so. Every cell is single-lined, cut to 120 characters and has `·`
replaced, because names are written by people; the answer ends with a line
saying they are data, and `INSTRUCTIONS.directoryData` repeats it. The call
log carries counts and filters, never the query text.

## Mikrotik tools

Added 2026-10-10. The family is registered when the key has the `mikrotik`
scope **and** `modules.mikrotik.isActive` is on. Code: `services/mcp/mikrotikTools.js`
(tools), `mikrotikFormat.js` (text), `mikrotikSource.js` (the only file that
touches models, storage and the connector). The tools in this section (and the diagnostics below) only read and
address a device by `device`: a record id, or a name / host / serial number
resolved with `resolveByName` — zero or several matches are a tool error
listing the candidates.

| Tool | Returns |
|---|---|
| `list_mikrotik_devices` | `query`, `company`, `status`, `limit` (50, max 200) → name, company, model, RouterOS, serial, status, host, id, link |
| `get_mikrotik_device` | `device`, `days` (1/7/30/90, default 30) → addresses, license, status and last poll error, firmware against the latest release with CVEs (`evaluateFirmware`), availability and outages (`computeAvailability`), planned offline windows, stored exports with their ids |
| `get_mikrotik_config` | `device`, `section?`, `search?` → the **running** configuration read from the device. No `section`: header and the list of sections with line counts. `section`: that section and its subsections (`/ip firewall` covers `/ip firewall filter`, `nat`, …). `search`: matching lines, each prefixed with its section (max 200) |
| `compare_mikrotik_exports` | `device`, `from?`, `to?` (export ids; default the two latest, swapped ids are reordered) → per section, lines removed and added between two **stored** exports |

Output is capped at 40 000 characters by whole lines, with a hint to narrow
the request.

### What leaves `mikrotikSource.js`

Positive projections only. From `credentials` the source selects `host` and
`port`; the login, password, TLS certificate pin, SSH host key, SSH port and
knock sequence are never read for the row and card tools. `readLiveConfig`
loads the full record (it has to connect) but returns only the redacted
configuration.

### Live read — `services/mikrotik/liveConfig.js`

`get_mikrotik_config` runs one `/export` over SSH through the same path and
guards as a backup export (`resolveJumpContext`, `assertPublicHost` /
`assertJumpTargetHost`, `withSshSession`), with these differences:

- **Nothing is written**: no artifact, no change to the record (the SSH host
  key is not pinned from this path), no config-change ticket.
- The command is a constant. `section` and `search` never reach the device —
  they filter the text already fetched, so the agent cannot run a command.
- On RouterOS 6 the command is `/export hide-sensitive` (v6 prints secrets
  by default; v7 hides them and rejects the flag). The major version comes from
  the record's `currentFirmware`; with no version known the plain `/export` is
  used and redaction alone does the work. An answer that does not start with
  `#` or `/` is treated as a command error (`MIKROTIK_LIVE_BAD_EXPORT`).
- Routers are shielded from the agent: the **redacted** result is cached per
  device for 5 minutes (outline → section costs one session), concurrent calls
  for one device share one read, devices behind one transit router are read
  one at a time, at most two sessions run at once, and at most six calls may
  wait — for a slot or for their turn at a device — before further ones are
  refused (`MIKROTIK_LIVE_BUSY`), and a device or its transit router under a
  firmware upgrade is refused (`MIKROTIK_LIVE_UPGRADING`).
- A failed read is a tool error with the reason (`describeLiveError`, built on
  `describeConnectionError`), not the neutral internal-failure text. The raw
  error goes to the log (`MCP: Mikrotik live read failed`).

The cache is per process and holds redacted text only; the raw export exists
only inside `readExport` → `redactConfig` and is never logged.

### Redaction — `services/mikrotik/configRedact.js`

`redactConfig(raw)` is a pure function over a copy in memory. **Stored exports
are not affected**: backups stay complete and importable, `createArtifact`,
the OTP download and `contentHash` are unchanged, and `exportConfig` takes
`hideSensitive` only from the live read. `compare_mikrotik_exports` decrypts
two stored files, redacts both in memory and diffs the redacted text — so a
changed password or key does not show as a difference (the answer says so).

The parser joins `\`-continued lines, tracks the section (`/path`, including
the one-line `/path add …` form) and scans `name=value` pairs with quoted
values. Layers:

1. **Secret by name** — a field whose name contains `key`, `pass`, `secret`,
   `psk`, `token` or `community`, has `pin` as a whole word of its name
   (`pin`, `sim-pin`, `pin-number`), or is `passcode` or `cak` (MACsec), gets
   `[секрет скрыт]`. This is fail-closed: a field RouterOS adds tomorrow
   with such a name is hidden without a code change. Explicit public
   exceptions: `public-key`, `key-size`, `key-type`, `key-usage`, `key-id`,
   `authentication-key-id`, `host-key-size`, `host-key-type`,
   `group-key-update`, `passthrough`, `passive`.
2. **Secret by section** — `identity` under `/zerotier`, `value` under
   `/container envs`.
3. **Account sections keep names only** — `/user`, `/user ssh-keys`,
   `/ppp secret`, `/ip hotspot user`, `/certificate…`, `/user-manager…`,
   `/tool user-manager…`: `name`, `comment`, `disabled`, `group`, `profile`,
   `service` stay, every other value becomes `[скрыто]`. In `/snmp community`
   the name is the secret, so only `comment` and `disabled` stay.
4. **Script bodies** — `source`, `script`, `on-event`, `on-up`, `on-down`,
   `on-login`, `on-logout`, `on-error`, `up-script`, `down-script`,
   `test-script`, `lease-script`, and **any field named `on-…`** (`on-alert`,
   `on-message`, …) become `"[скрипт скрыт: N строк]"` in any section.
5. **Free text** — `comment`, `note`, `description`, `contact`, `location`,
   `label` go through `redactSecrets` (the general scanner). It is applied to
   these fields only: on every value it would also mask public keys and
   model strings.
6. **Credentials inside a URL** — `scheme://user:password@host` in any value
   becomes `scheme://[скрыто]@host`.
7. **Unparsable line** (an unclosed quote) is replaced whole. While a quote is
   open, the end of a physical line is always a continuation, so a wrap that
   falls inside an escape sequence cannot leave the tail of a script as a
   separate line; a quote that never closes hides everything after it.

IP addresses, public WireGuard keys, peer endpoints and user names stay.

A device account without the `sensitive` policy (the recommended group, see
`docs/mikrotik-management.md`) is not shown secrets by RouterOS in the first
place. Redaction does not rely on that.

### Live diagnostics — `services/mcp/mikrotikDiagnostics.js`

Added 2026-10-10 so an agent can answer "site X lost its link to service Y".
Three more tools in the same family, same scope and module gate:

| Tool | Returns |
|---|---|
| `get_mikrotik_state` | `device`, `checks?` (`interfaces`, `tunnels`, `routes`, `arp`, `dhcp`, `resources`; default the first three) → per command a section `## <title> (<n> rows)` with one quoted line per row as `field=value …`, or `## <title>: failed — <reason>` |
| `ping_from_mikrotik` | `device`, `address` (IPv4), `count?` (1–5, default 3), `trace?` → the rows of `/ping` or `/tool/traceroute` run on the device |
| `get_mikrotik_log` | `device`, `topics?`, `search?`, `limit?` (1–200, default 100) → the newest matching log lines, oldest first |

**Commands** — `services/mikrotik/liveState.js`, a pure module. The state
commands are a fixed table of `…/print` words with no arguments:

| Check | Commands |
|---|---|
| `interfaces` | `/interface/print` |
| `tunnels` | `/interface/print` (rows kept in code by `type`: `wg`, GRE/IPIP/EoIP, L2TP/SSTP/OVPN/PPTP/PPPoE in and out, `ipsec`, `vxlan`, `zerotier`), `/interface/wireguard/peers/print`, `/ppp/active/print`, `/ip/ipsec/active-peers/print` |
| `routes` | `/ip/route/print` |
| `arp` | `/ip/arp/print` |
| `dhcp` | `/ip/dhcp-server/lease/print` |
| `resources` | `/system/resource/print` |

Nothing the agent sends reaches a state command. `/ping` and
`/tool/traceroute` take the validated address and a clamped count
(`pingWords`, `traceWords`); the log is a plain `/log/print`.

**Session** — `runOnDevice(id, commands)` in `mikrotikSource.js`: one API
session through `withApiSession` (TLS pin, knock, transit router — as for a
poll), under the shared `liveLimiter` (`services/mikrotik/liveLimiter.js`),
which configuration reads use too: two sessions at once, one per transit
router, a queue of six. `runCommands` sends the commands one at a time:

- a RouterOS error (`!trap`: unknown command, package not installed) is a
  complete reply — that command is reported as failed and the next one runs;
- silence (8 s per command, 20 s for ping, 15 s for the log) is not: a late
  reply would be read as the next command's rows, so nothing else is sent on
  that session and the remaining commands are reported as not run.

A session that cannot be opened at all is a tool error with the reason
(`describeLiveError`).

**Rows** — `redactRow(path, row)`: `.id` is dropped; a field is hidden by the
same `isSecretField` rule as in configurations (`private-key`,
`preshared-key`, IPsec `auth-key` / `enc-key`, …); script fields become
`[скрипт скрыт]`; free-text fields (`comment` and the like) go through
`redactSecrets` and URL credentials are cut, as in configurations; values are
collapsed to one line. An address that belongs
to another managed device (`loadAddressBook`: every record's host and
addresses) is followed by `(= <device name>)`, which is how the agent sees
which router is on the other end of a tunnel. At most 300 rows per command.

State and the log are cached per device and check for 30 seconds, and reads
of one device run one after another, so identical concurrent calls cost one
session; a ping is never cached. The address sent to the device is rebuilt
from the validated number (`canonicalIp`), not taken from the agent's string;
a traceroute is limited to 10 hops.

**Ping guard** — `pingTarget(address, { addresses, routes, extra })`. The
tool first reads the device's `/ip/address`, `/ip/route`, `/ip/dns`,
WireGuard peers, IPsec active peers and GRE / IPIP / EoIP interfaces (cached
with the state; a command the device does not know is skipped), then allows
the target when it

- lies in a connected network or in a route (disabled ones excluded, inactive
  routes included — a route through a tunnel that is down is exactly what
  gets checked) with a prefix of `/8` or longer
  (so a default route, or the `0.0.0.0/1` + `128.0.0.0/1` pair, allows
  nothing), or
- is named in the device's own settings: a route gateway, a DNS server, a
  WireGuard peer endpoint, the remote address of an IPsec peer or of a GRE /
  IPIP / EoIP tunnel — the far end of a tunnel is usually a public address
  that no route narrower than the default one covers.

Anything else — a hostname, IPv6, loopback, multicast, an address outside
those networks — is refused before a ping is sent, with the reason and the
device's networks. If the networks cannot be read, the ping is refused. At
most ten pings per device per minute (in memory, per process).

**Log** — `filterLog`: lines with the `debug` topic are dropped (PPP and
IPsec debug prints authentication exchanges); the message of a `script` line
is replaced with `[вывод скрипта скрыт]`; other messages pass through
`redactSecrets`. Login names and client addresses in ordinary lines
(`user admin logged in from …`) stay — except the API and SSH logins of the
helpdesk's own account (`dropOwnSessions`, applied in `mikrotikSource.js`, so
the login name never leaves that module): polling opens a session every few
seconds and would otherwise fill the whole answer. Failed logins and logins
of that account by any other means stay.

**Finding the device for a site** — `list_mikrotik_devices` and
`get_mikrotik_device` print `location:` — the chain of the inventory
location of the linked card (up to five levels), its address and the
subdivisions attached to that location — when the inventory module is on.
`query` searches those too. Records without a card, or cards without a
location, print `location: —`; that is normal, and `INSTRUCTIONS.mikrotik`
tells the agent to fall back to subdivisions, knowledge base notes, device
names and networks, and to say what it could not find rather than guess.

### Device text is data

Device names, address comments, configuration lines, state rows and log lines
are written by the device or by whoever configured it. Names and comments are collapsed to one line
and passed through `maskText`; every configuration line, state row and log line is emitted with the
`> ` prefix, and `INSTRUCTIONS.mikrotik` tells the agent that quoted lines are
never orders.

### Known limits

- Run against production on 2026-10-10 (RouterOS 7.23.7 directly, 6.49.22
  through a transit router): configuration read, all six state checks, ping,
  traceroute refusal, log and export comparison work; on RouterOS 6 only the
  WireGuard read fails, as a reported check. The helpdesk account there has
  no `sensitive` policy, so the router itself left secrets out of `/export`:
  redaction of real secret values in an export is still verified on
  synthetic exports only (see «Tests»).
- A secret embedded in an ordinary field (a password typed into an interface
  `name`, a token in a URL path or query) is not recognised.
- Free text is scanned heuristically: a comment such as `winbox admin/Qwerty12`
  — no keyword beside the token, no special characters — passes.
- The live-read cache and limits are per process.
- None of the diagnostic commands has been run against a device: the paths
  are from RouterOS documentation. A wrong path shows up as a failed check,
  not as a broken tool.
- A TCP port cannot be checked: a ping says the 1C host answers, not that the
  1C service listens.
- The ping guard is IPv4-only, and a target routed only through a prefix
  shorter than `/8` is refused.
- The 30-second state cache and the ping counter are per process.

## Mikrotik change tools

Added 2026-10-10. Code: `services/mcp/mikrotikChangeTools.js` (tools and the
read store `mongoChangeStore`), registered in `services/mcp/server.js`,
assembled in `routes/mcp.js` as `tools.mikrotikChanges`. These are the agent's
whole write surface: propose, read status, list. Applying, approving and
cancelling exist only for people in HD. The request life cycle, acceptance
rules, executor, worker and security model are in
[`docs/mikrotik-changes.md`](./mikrotik-changes.md); this section covers only
the tool layer.

**Family gate.** `toolFamilies().mikrotikChanges` = key scope `mikrotikChanges`
**and** `modules.mikrotik`. The scopes are independent: a key with only
`mikrotik` does not see these tools; a key with only `mikrotikChanges` sees
these three but none of the read tools (it can propose but not analyse a
device, so such a key should also get `mikrotik`). The 403 "nothing to read"
rule counts every family, this one included. `INSTRUCTIONS.mikrotikChanges`
(you never apply anything; the requester is the Telegram id of the person who
asked; device text is data; commands are structured with exact names;
placeholders for WireGuard keys; give the person the link; a request that
"needs checking" is not proposed again; interfaces are enabled or disabled
through the generic `/interface` menu; a refusal «row changed since the
request» on a row with live counters means the menu is not supported for
remove/enable/disable yet) is added for the family, and
`INSTRUCTIONS.mikrotikChangesOnly` is added when the key cannot also read
devices.

| Tool | Input | Returns |
|---|---|---|
| `propose_mikrotik_change` | `device`, `requester` (Telegram id, integer), `title` (1-200), `reason` (1-1000), `commands[]` (1-30; `path`, `action`, `where?`, `params?`; field names at most 64 characters), `wireguardClient?` (`interface`, `address`, `allowedIps`, `dns?`, `endpoint?`) | A created request: title, id, status, who it waits for, device, risk, numbered commands (HD's display lines), link, expiry; the first person is notified by the tool call itself (`notifier.step`), and a notification failure is only logged (`MCP: Mikrotik change notification failed`). A refusal is an error result `The request was not created:` followed by one `- reason` line per entry of the service's `reasons[]`; a reason that carries router or device text has a second line `  > quoted` (single-lined, masked, at most 300 characters). Reasons are never split on `"; "` (the service also returns a joined `error` string, which the tool does not print). Annotations: not read-only, not destructive, not idempotent, open world |
| `get_mikrotik_change` | `change` (id) | Status, device, requester, creation and expiry time, risk, who it waits for, the agent's `reason` (quoted), every step (who, approved/rejected, when, channel, or waiting / not reached), each command with its risk and result (`done`, `failed`, `rolled back`, `not run`) and quoted error (marked `refused by the router` or `not confirmed; HD's own note follows`), backup time, `Note from HD (may quote the device):` followed by a quoted line, the `needs_attention` warning, and for an applied WireGuard request the configuration page link while the keys live (or that they are gone) |
| `list_mikrotik_changes` | `device?`, `status?` (one of the status values), `limit?` (1-20, default 10) | Newest first: id, title, status, device, created, waiting for |

Status words in answers (`STATUS_TEXT`): waiting for the requester to confirm /
waiting for the responsible person to approve / approved, queued to be applied /
being applied / applied / rolled back / not applied / rejected / expired /
cancelled / needs checking by a person.

**Where validation lives.** The JSON Schema in `server.js` is only a first
filter (types and sizes). Menus, fields, secrets, reconciliation with the
router and the per-device / per-key limits are in
`services/mikrotik/changeProposals.js`; the tool layer adds no second rate
limit. `propose` prints the service's `reasons[]` line by line (see the table).

**What the agent can and cannot do.** It cannot apply, approve, reject or
cancel anything and cannot pass a secret (WireGuard keys come from HD through
the `{{wireguard.…}}` placeholders). Nothing is applied until the people on the
request approve it.

**Visibility.** `get` and `list` read only requests created through an MCP key
(`requestedVia.keyId` exists - all of them). There is no per-key isolation
(keys are shared agents), but a request whose device the read tools would not
show is treated as not found.

**Never returned.** User ids, Telegram ids, e-mails, the key's own id, any
WireGuard key field (private, preshared, public, server public), raw `params` /
`where` (only the stored display `text` of each command). Names of people are
single-lined and cut to 80 characters. Texts from people and routers
(`reason`, router errors) are one line per row with the `> ` prefix and
masked; the request's `failure` (HD's own sentence, which may quote the device)
is printed as `Note from HD (may quote the device):` followed by one quoted
`> ` line. A failed command is marked `result: failed (refused by the router)`
when the router refused it, or `result: failed (not confirmed; HD's own note
follows)` when it was sent but not confirmed. Logs
carry key id and name, tool, device, command count and outcome
(`created #N` / `refused`); the requester appears as the last three digits.

## Data protection

Knowledge base and tickets protect contact/secret data through **different**
mechanisms — a deliberate difference between the two specs, not an
inconsistency:

- **Knowledge base** — the moderation gate is the only guard (see
  «Knowledge base tools» → Scope). Note content is returned **unmasked**,
  exactly as written; HD does no secret scanning of its own on this path.
- **Tickets** — structured contact/secret/finance fields are **never
  selected** from the database at all (positive projections — see below),
  and every piece of free text that *is* selected is passed through
  `maskText`.
- **Mikrotik** — credentials of the record are never selected, and a
  configuration is redacted by field name and section before it leaves the
  source (see «Mikrotik tools» → Redaction).

### Never-selected ticket fields

`services/mcp/ticketSource.js` uses `.select("field list")` — Mongoose's
**positive** projection — everywhere, so a field not named in the list is
never read from Mongo, regardless of what any formatter does with it later:

| Entity | Selected | Excludes (by omission) |
|---|---|---|
| Ticket (search) | `num title description source state isClosed categoryId company applicantId createdAt finishedAt closingComment` | `htmlDescription`, `realSender`, `attachments`, legacy `applicant` snapshot, AI fields (`aiGuide`, `aiTerms`, `aiSpeech`, `aiCategory`, `aiTitle`), `notifications` |
| Ticket (detail, adds) | `processedAt startedAt deadline routineTask relatedClientDeviceId comments responsibles._id/firstName/lastName customFields.name/type/value checklist.description/checked` | `responsibles.email`, `responsibles.phone` |
| `company` (embedded on the ticket) | `_id, alias` only — the schema embeds nothing else | phones, address, map link, e-mail domains, API keys, service plans, people snapshots (these live on the `Company` document, which this path never populates — unlike the separate, out-of-scope `GET /api/tickets/:num` leak) |
| `User` (directory) | `firstName lastName position isEndUser isServiceAccount isCloudTelephony company._id` | `email`, `phone`, photos, `telegramBot`, `workStatus`, `finances`, `subdivision` |
| `Company` (directory) | `alias fullTitle` | `phones`, `address`, `linkToMap`, `location`, `emailDomains`, `apiKeys`, `servicePlans`, `users`, `responsibles`, `clientsSideResponsibles` |
| `Work` | `description visitRequired startedAt finishedAt finishedBy._id/firstName/lastName executor._id/firstName/lastName` | `finances`, `withinPlan` |
| `ClientDevice` | `deviceModelId deviceTypeId serialNumber inventoryNumber status operatingSystem` (+ populated `name`/`vendorId.name`/`deviceTypeId.name`) | `ipAddress`, `macAddress`, `hostname`, `installedSoftware`, `price`, `currentValue`, `purchaseDocument`, `supplierId`, `notes`, `comment`, `photos`, `locationId` |
| `Comment` | `content createdBy createdAt` | `attachments`, `quotedText`, `notifications` |

### `maskText` — `services/mcp/maskText.js`

Applied to every free-text field a ticket tool returns to the agent: title,
description, questionnaire name/answer, checklist item, comment, work
description, routine task title, and the closing comment / work descriptions
used for "how it was solved". (`search_tickets`' own `query` argument is
masked only in the human-readable summary line echoed back to the agent —
`query: "${maskText(query)}"` — the structured log line still records the raw
query text, same as the knowledge-base tool's logging.)

**Order matters:**

1. **Secrets** — `secretsScanner.js#redactSecrets`, the same rule set as the
   knowledge-base scanner (known formats, password-near-keyword, complex
   tokens, high-entropy tokens), values replaced longest-first →
   `[секрет скрыт]`.
2. **E-mail addresses** → `[e-mail]`.
3. **Phone numbers** (Russian and international) → `[телефон]`.

Secrets run first because the password-near-keyword rule's token pattern
(`[A-Za-z0-9@#$%^&*!?_.+/=-]{6,40}`) includes `@` and `.` and does **not**
exclude e-mail-shaped values (unlike the complex-token rule, which does): an
e-mail address sitting within that rule's window — 30 chars before a secret
keyword (`парол…`, `password`, `логин`, `login`, `секрет…`, `token`, …) to 40
chars after it — is consumed as a `password-near-keyword` finding and
replaced with `[секрет скрыт]` before the e-mail regex ever runs. This is
intentional: an e-mail printed next to a password in ticket text is
credential material, not a contact to disclose.

Row snippets are cut from the **already-masked** text
(`buildSnippet(maskText(entry.text), needles)` in
`ticketFormat.js#formatTicketRow`) rather than masking after cutting: a
snippet window that started mid-phone-number would otherwise leave an
unmasked tail of digits in view. Live-verified 2026-09-18: a real phone
number inside a ticket's e-mail signature came back as
`"Тел.:   [телефон] (+7 Москвы)"`.

Phone detection (`PHONE_CANDIDATE` + `maskCandidate`) treats runs of digits,
spaces, parens and dashes as candidates, bounded to stop the match growing
past 13 digits or 13 groups (`MAX_PHONE_DIGITS`, `MAX_PHONE_GROUPS`, the
latter being a number dictated digit by digit) — an earlier version was
effectively cubic on a long whitespace-separated digit run and could block
the event loop for up to ~13s on a 4,000-char comment (the comment cap);
`maskText.test.js` now pins a <1s budget on that same input size.

The candidate's boundaries are asymmetric on purpose:

- a candidate never starts or ends next to a **letter**, so serial numbers
  glued to text (`S/N89991234567`, `артикул AB89991234567`) are left alone;
- it never starts right after a **digit + dot** and never ends right before
  a **dot + digit**, which keeps IP addresses, versions, dotted dates and
  decimal fractions (`192.168.1.100`, `RouterOS 7.21.5`, `17.09.2026`,
  `1.9991234567`) out of the match;
- a plain dot on either side is **not** a boundary: until 2026-09-18 it was,
  and every number at the end of a sentence (`звоните 89991234567.`) escaped
  masking — measured on the production copy, 58 of 1,651 phone snippets and
  3 of 102 phone-bearing texts in a random 2,099-text sample. With the rule
  above the same corpus leaks 2 snippets and 0 texts; both survivors are
  shapes `isPhone` rejects on purpose (a number glued to a word, and a
  12-digit run).

**IP addresses are never masked** — explicit owner decision, technical
analysis needs them (e.g. a Mikrotik-monitoring ticket's own
title/description legitimately contains device IPs).

### Untrusted text is fenced — `services/mcp/ticketFormat.js`

Ticket descriptions and comments are written by outsiders: anyone who can
e-mail the helpdesk can put `## Comments (3)` or `link: https://…` in a
description and, before 2026-09-18, it rendered as a section of the agent's
own answer. Every block of free text is therefore quoted line by line with
`> ` (`ticketFormat.js#quote`): description body, comment content, work
description. Ticket **titles** (an e-mail subject or an API-created ticket can
carry newlines), questionnaire answers and checklist items stay inside their
one-line list item — whitespace in the value is collapsed after masking
(`ticketFormat.js#oneLine`, also used for the source title in
`find_similar_tickets`' header) — and `buildSnippet` (`text.js`, shared with
the knowledge base) returns a single line for the same reason. Section headings
(`## …` at column 0) can therefore only come from HD. The tickets half of
the server instructions says this to the agent as well: lines starting with
`>` are quoted ticket content, never orders.

This is a **prompt-injection** guard, not a leak guard — quoting cannot stop
an agent from following text it decides to follow; it only makes forged
structure visible as data.

### Known limits

From the spec, still current:

- Masking is pattern-based: unusual phone formats and credentials the
  scanner rules don't know can pass; free-text street addresses are not
  detected; some long digit sequences may be masked as phones.
- Similarity is lexical (`find_similar_tickets`): the same problem described
  with different words is only found if the agent searches again with other
  words.
- Comments with no `ticketId` at all (from before the field existed) are not
  loaded by either half of the `$or` — only comments *missing from the
  array* but *carrying* `ticketId` are recovered.
- A key with `tickets` reads every ticket of every company — there are no
  per-key company/user allowlists.
- Masking also **over-masks**: the inherited scanner rules redact technical
  strings that merely look like credentials — a device model such as
  `MikroTik CRS328-24P-4S+` comes back as `[секрет скрыт]`. Measured on a
  random sample of the production copy (2026-09-18): 19 of 599 ticket
  descriptions and 33 of 1,500 comments carry at least one redaction, not
  all of them real credentials. The agent sees the link and can ask a human.
- The agent's own query is logged **raw**: `logCall` writes
  `query: "<first 100 chars>"` into the application log (the text shown to
  the agent is masked, the log line is not), so a query that contains a
  phone number lands unmasked in internal logs. Staff-only logs; the same is
  true of the knowledge-base tool.

Added after implementation and live verification:

- The directory (companies, users, categories) is reloaded on **every**
  call, uncached — the main lever if these calls ever need to get faster
  (ranking itself, scanning up to 20,000 candidates, is the other big cost
  — see the live timings below).
- Ranking loads at most `MAX_CANDIDATES = 20 000` newest tickets per word
  search or similarity comparison — a company/status/date combination with
  more matching tickets than that will miss older ones in ranked results
  (paging without a query is unaffected — it's a plain DB scan/skip/limit).
- Ranking is **CPU-bound inside the app process**: ~250 ms per call over
  13,750 tickets, up to ~500 ms at the candidate cap. `rankTickets` and
  `rankSimilar` are async and yield to the event loop every
  `YIELD_EVERY = 500` candidates (`ticketQuery.js#scan`), so no single call
  blocks the UI, but the work itself still competes with web requests — the
  per-key rate limit (120 calls/minute) is the only budget on it.
- `ticketSource.js` (tickets) and `knowledgeSource.js` (notes) are the two
  MCP modules that `require` real Mongoose models directly — every other
  module receives data through injected function arguments instead, which is
  what lets it be unit-tested without a database. Only `ticketSource.js` has
  its own test file, and it covers **wiring and projections** only (models
  stubbed via `require.cache`, `services/mcp/ticketSource.test.js`, added
  during live verification); `knowledgeSource.js` has none. Real query behaviour for both
  is verified live, not by a unit test that would otherwise need a live
  database.

## Tests and manual check

### Automated

| File | Covers |
|---|---|
| `services/secretsScanner.test.js` | `scanText` unchanged by the rule-collector refactor; `redactSecrets` (replacement, repeated values, a longer secret containing a shorter one, no-secret/empty input) |
| `services/mcp/maskText.test.js` | masked/unchanged table (20 masked rows incl. sentence-final and bracketed phones, 24 technical-number rows that must survive: IPs, versions, dates, serials, invoice/inventory numbers); empty input; a performance guard for long digit runs |
| `services/mcp/text.test.js` | `ticketPlainText` (HTML→lines, e-mail quote stripping, data-URI drop), `buildSnippet` (matching passage, single line)/`iso`, `fallbackTerms`/`hasAllTerms` |
| `services/mcp/knowledgeTools.test.js` | scope filter via `sift` (MongoDB matching rules), ranking, snippet, content shaping, logging |
| `services/mcp/ticketQuery.test.js` | `resolveByName` (substring + exact tie-break), `buildTicketFilter` (status/ids/inclusive days/timezone/invalid-day throw), `rankTickets`/`rankSimilar`, and that ranking yields the event loop while scanning candidates |
| `services/mcp/ticketStats.test.js` | `aggregateTicketStats` grouping, median (a close earlier than the creation counts as 0 hours), share |
| `services/mcp/ticketFormat.test.js` | row/detail/stats text formatting; no contact/secret/file key from any field reaches the text; injected `## …`/`link:` lines from ticket text stay quoted and one-line |
| `services/mcp/ticketTools.test.js` | all four tools over a fake source: ranking within filters, newest-first without a query, ambiguous-name error, a number matching both `num` and text, works gated by the time-tracking module, similar-with-"how it was solved", a stats table, calendar-day tool errors with their log line, one log line per call, a page past the last one, the candidate-cap note in the header |
| `services/mcp/ticketSource.test.js` | wiring only — models stubbed via `require.cache` (the `Ticket` stub is shaped exactly like the real `{ Ticket, … }` export, so a broken non-destructured import fails the same way it would live): `findTickets`/`countTickets`/`loadStatsRows` call the right Mongoose method with the given filter; every `select()` string is pinned (ticket search/detail, comments, works, devices, work descriptions) and none may name `htmlDescription`, `realSender`, `attachments` or the legacy `applicant`; `authorId` for a real `ObjectId`, a plain string, and both shapes of the legacy embedded comment snapshot |
| `services/mikrotik/configRedact.test.js` | one case per secret class (WireGuard private and preshared keys, PPP, IPsec, Wi-Fi v6/v7, CAPsMAN, SNMP, RADIUS, e-mail, users, OSPF, ZeroTier, container env, SIM pin, scripts, an unknown `*-key` field, a token in a comment): the value must not appear in the output; continuation lines, quoted values, public look-alikes, account sections, unparsable lines, section merging |
| `services/mikrotik/liveConfig.test.js` | cache and expiry, shared in-flight read, a command error is refused and not cached, a failed read is not cached |
| `services/mcp/mikrotikTools.test.js` | device resolution, list filters, outline / section / search, quoting of every configuration line, truncation, an unreachable device as a tool error, compare defaults and swapped ids, the device card, `diffConfigs` |
| `services/mikrotik/liveLimiter.test.js` | one session per transit router, the session cap and queue refusal, a failed run frees its slot |
| `services/mikrotik/liveState.test.js` | every state command is a bare `…/print`; `redactRow`; the ping guard table (networks, routes, named endpoints, non-unicast, IPv6, hostnames, injection text, the default route); bounded ping words; `filterLog`; `runCommands` on a trap and on silence |
| `services/mcp/mikrotikDiagnostics.test.js` | the three tools over a fake source: sections and quoting, a failed check beside working ones, peer naming, the 30-second cache, allowed and refused ping targets, the ping rate limit, traceroute, unreadable networks, log filters, an unreachable device, an unknown device |
| `services/mcp/keys.test.js` | `issueMcpKey`/`toKeyRow`/`normalizeScopes`; an issued key is accepted by `requireMcpKey` |
| `validations/mcpKey.test.js` | name/scopes/`_id` validation for create/update/remove |
| `middleware/requireMcpKey.test.js` | format/hash lookup/hourly touch/401 paths |
| `services/mcp/mikrotikChangeTools.test.js` | the three change tools over a fake service and store: success / refusal text, steps and channels, per-command results, the `needs_attention` warning, WireGuard link, quoting, device visibility, list filters, logging without parameter values, no id or key in any output |
| `routes/mcp.test.js` | the whole route over the **real SDK** with a 2025-11-25 client: `405`/`401`/`403`, tool lists by scope×module, a ticket read masking a phone and linking to HD, `initialize`, `tools/list`, scope leak checks (flagged/unapproved ids never appear), per-key call attribution, schema rejection, `429` over the per-key limit, `404` with no fallthrough below `/api/mcp`, and the failure-guard's neutral error + log line |

Run a single file: `node --test <file>`. Full backend suite:
`cd backend && NODE_ENV=production pnpm test` (`backend/logs` must not be
root-owned, or the logger breaks the run).

### Live verification (2026-09-18, dev = production copy)

Environment: `modules.knowledgeBase`/`timeTracking` on, `inventory` off,
timezone `Asia/Vladivostok`, both system accounts configured
(`defaultApplicant`, `mikrotik.applicant`), a real
`@modelcontextprotocol/sdk@1.30.0` client (protocol 2025-11-25).

| Call | Arguments | Duration |
|---|---|---|
| `search_tickets` | `query: "принтер"`, `status: "closed"`, `limit: 5` | 952 ms |
| `search_tickets` | the largest company (≈3,450 tickets), `status: "closed"`, `limit: 20` | 38 ms |
| `search_tickets` | `query: "не работает"`, `limit: 50` | 752 ms |
| `get_ticket` | one ticket by `num` | 31 ms |
| `find_similar_tickets` | same company (default scope) | 222 ms |
| `find_similar_tickets` | `scope: "all"`, `status: "any"`, `limit: 30` | 830 ms |
| `ticket_stats` | `groupBy: "month"`, `from: "2026-01-01"` | 722 ms |
| `ticket_stats` | `groupBy: "category"`, the largest company | 86 ms |

All 8 calls succeeded (`isError: false`); slowest 952 ms, comfortably under a
~2 s budget. A scan of every output for phone/e-mail patterns came back
clean — the one flagged span was the verification script's own regex
crossing a newline inside `get_ticket`'s output for ticket #30128,
`"## Works (1)\n- 2022-07-28…"` (gluing the section's `1` to a work's date),
not app output and never something that passes through `maskText`; in the
same ticket's description, `maskText` correctly
masked a real phone number inside an e-mail signature (see «Data
protection»). `htmlDescription` (48,332 raw chars on the telephony ticket
checked) never appeared in `get_ticket`'s output. The devices section —
untestable end-to-end with `inventory` off on dev — was verified by calling
`ticketSource.loadTicketDetail` directly with `devices: true` for a ticket
with a related device: output included type, vendor/model, inventory
number, serial number, status and OS, with **no IP address** anywhere.

### Manual check with curl

```bash
M=(-sS -X POST "$APP_PUBLIC_URL/api/mcp" -H "Authorization: Bearer $KEY" \
   -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
curl "${M[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl "${M[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
curl "${M[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_tickets","arguments":{"query":"vpn","status":"closed"}}}'
```

Answers arrive as `data: {…}` lines (the SDK's legacy stateless path — see
«Transport»). `tools/list` must show exactly the tools the key's `scopes` and
the active modules allow; a flagged or unapproved knowledge-base id must give
`isError` from `get_knowledge_note`; a ticket search result must never
contain a raw phone number or e-mail address.
