# Knowledge Base — Implementation Notes

_Last updated: 2026-09-17. This document covers the data model, the API, the
background jobs, agent access over MCP and the operational rules of the Knowledge
Base module.
Interface rules live in `docs/ux-ui-guide.md` — the module's components are its
reference implementations («Правка на месте», «Статус, который протухает»,
`app/BulkActionBar`); the reasoning behind the current screens is the 2026-07-28
entry of `docs/ux-ui-changelog.md`. It is a snapshot, not a spec — verify against
the code before relying on any detail._

## Terminology: «Проверено» = `approved`

The UI calls the moderation state **«Проверено» / «Не проверено»** (verified /
not verified). The database and API still use `approved` / `approvedBy` /
`approvedAt`, plus `hideNotApproved`, `approvalPeriodDays`, the `pendingApproval`
counter and the `?moderation=all-unapproved` deep link. The rename was
**UI-copy-only** on purpose: renaming the fields would touch the model, indexes,
the approval-expiry cron, the visibility helper, preferences and every deep link,
for zero user-visible gain. When reading code, map «Проверено» → `approved`.

## Overview

The Knowledge Base ("База знаний") is a collection of markdown **notes**
(`KnowledgeNote`) written by staff and surfaced both on a dedicated page and
inside the ticket workflow. A note is plain markdown plus three kinds of
**denormalized bindings** (companies / users / ticket categories) and a **type**
(general info / known problem / instructions). The bindings drive two things:
**who can see the note** (visibility scoping) and **where it shows up** (related
notes on a ticket, AI guide context).

On top of the content sits a **moderation layer**:

1. **Approval** — every note is created **unapproved** and must be approved by a
   moderator. Any edit resets approval. Approval can be set to **expire** after N
   days.
2. **Two-phase deletion** — a manager *requests* deletion; a moderator *confirms*
   (hard delete) or *declines*.
3. **Two-phase archival** — a manager *requests* archival; a moderator *confirms*
   (note disappears everywhere but is restorable) or *declines*. A manager can
   *unarchive*.
4. **Secret leak scanning** — an hourly job greps every note for passwords / API
   keys / private keys and flags leaks for a moderator (raw secret never stored).
5. **Service-renewal tracking** — a daily job parses markdown tables of services
   (domains, hosting, …) and warns when a renewal date is near.

The module is gated by a **module flag** and three **dictionary rights**
(`knowledge.read`, `knowledge.manage`, `knowledge.moderate`), and everything is
additionally scoped per-user in the controllers (defence in depth).

## Module gating & permissions

| Gate | Where | Meaning |
| --- | --- | --- |
| `modules.knowledgeBase.isActive` | `Preferences` | Whole module on/off. Middleware `knowledgeBaseModuleIsActive` (`backend/middleware/permissions.js`) 403s every route when off. Toggled in Preferences → Модули (`frontend/src/components/Preferences/Modules.jsx`, label "База знаний"). |
| `knowledge.read` | role | Read access. Middleware `canReadKnowledge`. Audience `both` — a client sees notes bound to their own company. |
| `knowledge.manage` | role | Create / edit / request lifecycle actions. Middleware `canManageKnowledge`. Audience `staff`. |
| `knowledge.moderate` | role | Approve, decide on deletion / archive, ignore secret findings, moderation summary. Middleware `canModerateKnowledge`. Audience `staff`. |
| `isNotClient` | middleware | All mutations also require a non-client (staff) account. |

The three rights come from the permission dictionary
(`backend/auth/access.js`, group `knowledge`) and are granted by roles only —
there are no per-user flags any more, and no admin bypass branch: a full-access
role simply carries the whole staff dictionary, so `can()` decides for everybody.
`Preferences.knowledgeBase` still holds the hide / approval-period options and
both scanner switches (`frontend/src/components/Preferences/KnowledgeBase.jsx`);
the moderator list is gone from it.

### Moderators

A moderator is **a holder of `knowledge.moderate`**, i.e. a role — the catalogue
ships `kb-moderator` for exactly that. The stale
`Preferences.knowledgeBase.moderators` array is still declared in the model but
read by nothing except the one-off `scripts/migrateActions.js`, which grants the
role to the previous moderators; drop the field once that has run on production.

`canViewNote(note, auth, kbConfig)`
(`backend/helpers/knowledgeNoteVisibility.js`) asks `auth.can()` directly — the
same function the route gates use. A holder of `knowledge.moderate` sees every
note, like a holder of `knowledge.manage`: a moderate-only role that could not
see the notes awaiting approval would be useless.

Moderator-only actions are gated on the routes (`canModerateKnowledge`) **and**
re-checked in the controller: approve, confirm/decline deletion, confirm/decline
archive, ignore-secret-finding, moderation summary. `getModerationSummary` is
the exception that is deliberately open to any `knowledge.read` holder — the
ticket page calls it for everyone — and answers non-moderators with
`{isModerator: false}` plus zero counters.

There are **no moderator notifications** anywhere in the system; moderation
surfaces only through those summary counters.

## Data model

### `KnowledgeNote` — `backend/models/knowledgeNote.js`

```
title            String, required
content          String                 // raw Markdown from Toast UI Editor
plainText        String                 // markdown stripped to text — for search + secret scan + AI
companies[]      { _id→Company, alias }                       // denormalized binding
users[]          { _id→User, firstName, lastName,
                   company { _id→Company, alias } }           // user's company kept for visibility
categories[]     { _id→TicketCategory, title }               // denormalized binding
type             "info" | "backlog" | "instructions"  (default "info")
createdBy/updatedBy  → User

// Moderation — approval
approved         Boolean (default false)
approvedBy       → User
approvedAt       Date

// Moderation — two-phase deletion
pendingDeletion        Boolean (default false)
pendingDeletionBy/At

// Moderation — two-phase archival
pendingArchive         Boolean (default false)
pendingArchiveBy/At
archivedAt             Date          // set ⇒ note is archived (hidden everywhere)
archivedBy             → User

// Secret scan result (raw secret never stored)
secretsScan {
  flagged       Boolean
  findings[]    { category, location("title"|"content"), maskedSnippet, hash }
  ignoredHashes [String]   // sha256 of values a moderator marked "not a secret"
  scannedAt     Date
}

// Service-renewal tracking (parsed from content tables)
serviceExpiry {
  entries[]     { service, registrar, expiresAt }
  scannedAt     Date
}
timestamps
```

Bindings are **denormalized on purpose** — the list endpoint, the sidebar
filters, and the relevance ranking all read `alias` / `title` / names without a
populate. The trade-off: renaming a company/category does **not** propagate to
existing notes until the note is re-saved. Indexes exist on each binding id, on
`title`, `type`, `approved+approvedAt`, `pendingDeletion`, `pendingArchive`,
`archivedAt`, `secretsScan.flagged`, and `serviceExpiry.entries.expiresAt`.

`approved` defaults to `false`, but the code everywhere treats **absence** of the
field as unapproved too (`note.approved !== true`) so legacy notes are safe before
the backfill script runs.

### `Preferences.knowledgeBase` — `backend/models/preferences.js`

```
moderators[]         { _id→User, firstName, lastName }
hideNotApproved      Boolean (default false)   // hide unapproved notes from non-managers
approvalPeriodDays   Number  (default 0)       // 0 = approvals never expire
scanForSecrets       Boolean (default false)   // enable hourly secret scan
trackServiceExpiry   Boolean (default false)   // enable daily service-table parse
serviceExpiryDays    Number  (default 30)      // "renew soon" window
```

Mirrored in `backend/types/preferences.ts`. Validated loosely
(`body("knowledgeBase").optional().isObject()`) and written in
`backend/controllers/preferences.js → update` (only when present in the body, to
avoid wiping moderation config on a partial POST).

### `McpKey` — `backend/models/mcpKey.js`

Access keys for AI agents (collection `mcpkeys`): `name`, `keyHash` (sha256,
`select: false`, unique index), `keyTail`, `createdBy → User`, `lastUsedAt`,
timestamps. The key value is never stored. See «Agent access (MCP)».

## Visibility model

`canViewNote(note, authedUser, kbConfig)` in
`backend/helpers/knowledgeNoteVisibility.js` is the **single** visibility
predicate. Every read endpoint fetches a candidate set then filters with it (the
DB query is not the security boundary — the predicate is). Order of checks:

1. **No `knowledge.read`** → deny. (Routes are also middleware-gated; this is
   defence in depth.)
2. **Manager** (`knowledge.manage` or `knowledge.moderate`) → allow
   **everything**, including unapproved and otherwise-scoped notes.
3. **`hideNotApproved` && note unapproved && not manager** → deny.
4. **End user / client** (`isEndUser`) → allow **only** notes bound to **their own
   company**. Global, category-only, and other-company notes are invisible to
   clients.
5. **Staff (non-manager)** — a note with **no bindings at all is "global"** and
   visible to every staffer. Otherwise allow if any holds:
   - note category ∈ user's `categories`, or
   - note company ∈ user's **accessible companies**, or
   - a linked user whose company ∈ user's accessible companies.

**Accessible companies** (`getAccessibleCompanyIds`) = the user's own company +
every company in `responsibleForCompanies` (stored under `id`, not `_id`).

### Ticket-context matching (restrictive bindings)

`getRelated` (the ticket "База знаний" card) and the AI context use a **second,
stricter** rule on top of `canViewNote`: `matchesTicketContext`. Here **company
and applicant are restrictions** — a note bound to companies (users) only appears
in tickets of *those* companies (*those* applicants) and never leaks into others.
**Category is not a restriction** — a category-only note matches a ticket of any
company sharing that category. To appear, a note must match **at least one**
ticket dimension. The same logic is duplicated server-side in
`backend/services/knowledgeBaseContext.js` and client-side in
`frontend/src/components/Ticket/View/KnowledgeSection.jsx` (ranking and grouping
only) — keep them in sync.

## Note lifecycle & moderation

```
            create
              │  approved=false
              ▼
        ┌──────────┐  edit (resets approved=false)
        │ unapproved│◀──────────────┐
        └────┬──────┘               │
   moderator │ approve              │ approval expiry cron
   (2 checks)▼                      │ (approvalPeriodDays)
         ┌────────┐                 │
         │approved │────────────────┘
         └────────┘
  manager request ▼ ▲ manager unarchive       manager request ▼
   archive  pendingArchive                      deletion  pendingDeletion
            │ moderator confirm ▲ decline                 │ moderator confirm ▲ decline
            ▼                                              ▼
        archivedAt set (hidden everywhere)            hard delete (pruned from DB)
```

- **Create / edit** (`add` / `update`) — manager only. `update` recomputes
  `plainText` and **resets approval** (`approved=false`, clears approvedBy/At).
  Both also **re-derive the scan fields synchronously** (`rescanNoteDerived`):
  the secret scan (gated by `scanForSecrets`, `ignoredHashes` preserved) and the
  service-expiry parse (gated by `trackServiceExpiry`, skipped for archived notes)
  run with the same semantics as their crons — so a leak flag clears, and renewal
  dates refresh, the moment the content changes instead of waiting for the cron.
- **Approve** — moderator only, requires **both** confirmations in the dialog
  (`confirmCurrent` = data is current, `confirmNoSecrets` = no secrets). Sets
  `approved/approvedBy/approvedAt`.
- **Approval expiry** — daily cron reverts approvals older than
  `approvalPeriodDays` (notes without `approvedAt` and archived notes are left
  alone).
- **Deletion** — `sendToDeletion` (manager) sets `pendingDeletion`;
  `confirmDeletion` (moderator) **hard-deletes**; `declineDeletion` (moderator)
  clears the flag. A direct `delete` route also exists (manager-gated, no
  moderation) but the UI drives the two-phase path.
- **Archival** — `requestArchive` (manager) sets `pendingArchive`;
  `confirmArchive` (moderator) sets `archivedAt` (note vanishes from all default
  queries); `declineArchive` (moderator) clears the request; `unarchive`
  (manager) clears `archivedAt`. Archived notes are excluded from moderation
  counters, related-notes, AI context, and the service/approval scans — **except**
  the secrets list, which still surfaces leaks in the archive.

## Backend endpoints

All under `/api` (mounted in `backend/routes/index.js`; defined in
`backend/routes/internal/knowledgeNote.js`). Every route carries `isAuth`,
`knowledgeBaseModuleIsActive`, `canReadKnowledge`; mutations add `isNotClient`
+ `canManageKnowledge`, moderation routes `canModerateKnowledge`; the
record-level logic is re-checked **inside** the controller. Two deliberate
exceptions: `moderation-summary` runs without `canModerateKnowledge` (it is
polled for every reader and answers zeros), and one route runs without
`canReadKnowledge` — see the table. Literal sub-paths (`form-data`, `related`, `moderation-summary`,
`service-expiry`) are declared **before** `:id` so the dynamic segment doesn't
swallow them.

| Method & path | Handler | Notes |
| --- | --- | --- |
| `GET /knowledge-notes` | `getAll` | Visible notes, slimmed by `LIST_PROJECTION` (no `content`, `plainText`, `serviceExpiry`, `secretsScan.findings`/`.ignoredHashes`). `?archived=true` → archive; `?flaggedSecrets=true` → all flagged (incl. archived); `?search=` → server-side search. Sorted `updatedAt` desc. |
| `GET /knowledge-notes/form-data` | `getFormData` | Companies / active non-service users / active categories for the editor selects. Manager-gated. |
| `GET /knowledge-notes/related` | `getRelated` | Notes matching a ticket (`?company&category&user`), with `matchesTicketContext`. Excludes pending-deletion + archived. |
| `GET /knowledge-notes/moderation-summary` | `getModerationSummary` | Counters for moderators (zeros otherwise). |
| `GET /knowledge-notes/service-expiry` | `getServiceExpiry` | Services within the renew window; dedup by service, overdue flag. |
| `GET /knowledge-notes/:id` | `getOne` | Full note incl. `content`; 403 if not visible. Actor refs (`approvedBy`, `updatedBy`, `pendingDeletionBy`, `pendingArchiveBy`, `archivedBy`) are **populated** with `firstName lastName` (`ACTOR_PATHS`) so the UI can print names, not ids. Every mutation response populates them too; `getAll` does **not** (the list only needs the verification icon). |
| `POST /knowledge-notes/add` | `add` | Create (title required). Starts unapproved. |
| `POST /knowledge-notes/update/:id` | `update` | Edit; resets approval. |
| `POST /knowledge-notes/approve/:id` | `approve` | Moderator; both confirmations required. |
| `POST /knowledge-notes/send-to-deletion/:id` | `sendToDeletion` | Manager; sets `pendingDeletion`. |
| `POST /knowledge-notes/confirm-deletion/:id` | `confirmDeletion` | Moderator; **hard delete**. |
| `POST /knowledge-notes/decline-deletion/:id` | `declineDeletion` | Moderator; clears request. |
| `POST /knowledge-notes/request-archive/:id` | `requestArchive` | Manager; sets `pendingArchive`. |
| `POST /knowledge-notes/confirm-archive/:id` | `confirmArchive` | Moderator; sets `archivedAt`. |
| `POST /knowledge-notes/decline-archive/:id` | `declineArchive` | Moderator; clears request. |
| `POST /knowledge-notes/unarchive/:id` | `unarchive` | Manager; clears `archivedAt`. |
| `POST /knowledge-notes/:id/ignore-secret` | `ignoreSecretFinding` | Moderator; adds value hash to `ignoredHashes`, drops the finding. |
| `POST /knowledge-notes/delete/:id` | `delete` | Manager; direct hard delete (no moderation). |

### Bulk moderation

Moderation queues are worked through in batches, so each moderator decision has a
`*-multiple` twin. Literal paths are declared **before** the `:id` routes.
Guards mirror the singular versions; `isModerator` is checked in the controller.

| Method & path | Body | Semantics |
| --- | --- | --- |
| `POST /knowledge-notes/approve-multiple` | `{ ids[], confirmCurrent, confirmNoSecrets }` | Both confirmations required (422 otherwise) — bulk does not weaken the attestation. Skips archived notes. |
| `POST /knowledge-notes/confirm-deletion-multiple` | `{ ids[] }` | Hard-deletes notes that carry `pendingDeletion`. |
| `POST /knowledge-notes/decline-deletion-multiple` | `{ ids[] }` | Clears `pendingDeletion*`. |
| `POST /knowledge-notes/confirm-archive-multiple` | `{ ids[] }` | Sets `archivedAt`/`archivedBy`, clears `pendingArchive*`. |
| `POST /knowledge-notes/decline-archive-multiple` | `{ ids[] }` | Clears `pendingArchive*`. |

All five share `runBulkModeration` / `bulkModerationHandler`: moderator gate →
`canViewNote` filter (defence in depth) → per-note precondition → apply. They
iterate note-by-note rather than `updateMany`, because a skipped note must come
back with a **human-readable reason** (`«VPN» — нет запроса на удаление`), not
silently drop out of a count. Response:
`{ message, processed, skipped: [{ title, reason }] }`. The precondition lives in
the loop, so a note whose status changed while the moderator was looking at the
list is skipped, not mis-transitioned.

### Moderation counters

`getModerationSummary` and the moderation block of `preferences.getInitial`
share one implementation — **`services/knowledgeModerationCounts.js`** — and
return the same counters: `pendingApproval` (unapproved, non-archived),
`pendingDeletion`, `pendingArchive` (both non-archived), `secretsFlagged`
(incl. archived) and **`total`**. `total` is a single `$or` `countDocuments`, not
the sum: the queues **overlap** (an unapproved note with a scanner finding sits
in two), so summing counted the same note twice — the counter read 195 on a base
of ~180 notes. With `scanForSecrets` off the hidden secrets queue is left out of
`total` too, so the number never promises work with nowhere to go. `getInitial`
additionally exposes `approvalPeriodDays`, which the client needs to print
«действует ещё N дн.» next to the approval state.

### List search — `?search=`

Search runs on the server, and `plainText` never leaves it. The client used to
receive the full text of every note just to `String.includes()` it: at ~200 notes
that is megabytes on every visit to the section, paid by everyone who only wanted
to open one article.

`buildSearchConditions` splits the query on whitespace (max `MAX_SEARCH_TERMS = 8`
terms), escapes each term (`escapeRegex` — otherwise a stray `.*` in the box is a
scan of the whole collection), and requires **every** term to match at least one
of `title`, `plainText`, `companies.alias`, `categories.title`,
`users.firstName`, `users.lastName`. The terms go into `filter.$and`, so they
compose with the visibility filter instead of replacing it.

Case-insensitive regex, no text index: at this size a collection scan of ~200
short documents is cheaper than the index it would need, and substring matching
(`сет` → «Сеть») is what people expect from a filter box. If the base grows an
order of magnitude, this is the place to add `$text` — the contract with the
client (`?search=`) does not change.

## Background jobs

Registered in `backend/app.js` next to the other crons, each with an in-flight
boolean lock and a `mongoose.connection.readyState === 1` guard, and each a no-op
unless its preference flag is on.

| Schedule | Job | Service |
| --- | --- | --- |
| `0 3 * * *` (daily 03:00) | Approval expiry | `services/knowledgeApprovalExpiry.js → runKnowledgeApprovalExpiry` |
| `0 * * * *` (hourly) | Secret scan | `services/secretsScanRun.js → runSecretsScan` |
| `30 3 * * *` (daily 03:30) | Service-renewal parse | `services/serviceExpiryScanRun.js → runServiceExpiryScan` |

- **Approval expiry** — `updateMany({ approved, approvedAt ≤ now − days, archivedAt: null }, …)` flips them back to unapproved when `approvalPeriodDays > 0`.
- **Secret scan** — scans every note (`title` + `plainText`), `bulkWrite`s
  `secretsScan.flagged/findings/scannedAt` via targeted `$set` so the moderator's
  `ignoredHashes` survive.
- **Service-renewal parse** — parses `content` of **non-archived** notes,
  `bulkWrite`s `serviceExpiry.entries/scannedAt`.

All three write with **`timestamps: false`**, so `updatedAt` changes only when a
person saves the note (edit or moderation action). Mongoose stamps `updatedAt`
into every `bulkWrite` / `updateMany` by default, and until 2026-09-17 the hourly
scan did exactly that: every note's `updatedAt` became the last scan time, which
broke the list order, the related-notes order on tickets and every «обновлено»
date. The owner chose not to repair existing values: a note keeps its last scan
time until someone next saves it. Guarded by
`services/knowledgeNoteBackgroundWrites.test.js`.

Both whole-base scans also run **on demand the moment their flag is switched on**:
`preferences.update` (`backend/controllers/preferences.js`) detects the off→on
transition of `scanForSecrets` / `trackServiceExpiry` and awaits `runSecretsScan` /
`runServiceExpiryScan` before responding (failures are logged, not fatal to the
save), so results exist immediately instead of after the next cron tick.

## Secret scanner — `backend/services/secretsScanner.js`

No AI — regexes + Shannon entropy. The runner (`secretsScanRun.js`) calls
`scanNote(note, ignoredHashes)`, which scans the title and the markdown-stripped
`plainText`. Detection layers:

1. **Known formats** — private-key blocks, AWS `AKIA…`, Google `AIza…`, Stripe
   `sk/rk_live/test_…`, Slack `xox[baprs]-…`, GitHub `gh[pousr]_…`, JWTs, and a
   generic `key: value` / `пароль = …` assignment rule (RU + EN keywords).
2. **Password-near-keyword** — a password-like token in a window around a RU/EN
   secret keyword (`парол…`, `password`, `token`, …) even without `:`/`=`.
3. **Complex tokens** — letter + digit + strong special char anywhere (catches
   login/password tables); emails and URLs excluded.
4. **High-entropy tokens** — mixed letter+digit runs ≥ 24 chars with Shannon
   entropy ≥ 4.0.

Output per finding: `{ category, location, maskedSnippet, hash }`. The raw secret
is **never stored** — `maskedSnippet` keeps only head/tail (e.g. `AKIA••••1234`)
and `hash` is the first 16 hex of its sha256, used for dedup and the ignore-list.
Placeholders (`example`, `changeme`, `xxxx`, all-same-char, …) are dropped;
results capped at 25 per note. "Не секрет" stores the **value hash**, so a
*different* real secret in the same note still trips on the next scan.

## Service-renewal scanner — `backend/services/serviceExpiryScanner.js`

`parseServiceTables(content)` (no AI) extracts every markdown pipe-table, then
classifies columns:

- **Date column** — by header (`продл|действ|оплач|срок|дата|expir|valid|renew|до`)
  or, failing that, by content (≥ half the cells parse as a date).
- **Service column** — by header
  (`услуг|сервис|service|домен|наимен|сайт|адрес|name|url|site`), else the first
  domain-shaped column not already taken, else — last resort — a **service-owner**
  header (`юр.лиц|организац|компан|владел|подписант|контрагент`), so tables keyed by
  legal entity (e.g. e-signatures per юрлицо, where the value is a company name, not
  a domain) are still recognised. The owner fallback runs **only** when neither a
  strong header nor domain-shaped content matched — so in a domain table the service
  stays the domain, not the owner company.
- **Registrar column** — by header only (`регистр|хостер|host|provider`).

A table counts as a service table only if it has **both** a date and a service
column. Dates parse `DD.MM.YYYY` / `DD/MM/YYYY` / `YYYY-MM-DD` into the calendar-date
form used across the app — see `docs/datetime-conventions.md`, «Модель данных».
Entries are deduped by service (case-insensitive).

`getServiceExpiry` reads `serviceExpiryDays` (default 30), computes a cutoff
`now + days`, finds non-archived notes with any `entries.expiresAt ≤ cutoff`,
dedups across notes (keeping the nearest date per service), flags `overdue`
(`expiresAt < now`), and returns `{ services[], count }` sorted by date.

## AI guide integration — `backend/services/knowledgeBaseContext.js`

When the ticket AI guide runs (`backend/services/ticketAiGuide.js`), it pulls the
most relevant notes into the prompt:

- `collectRelevantNotes({ companyId, categoryId, applicantId })` — same
  `matchesTicketContext` restriction as `getRelated`, ranks by
  `matchCount → type priority (backlog > instructions > info) → recency`, and
  returns the top **5** (`MAX_NOTES`), each truncated to **1500** chars
  (`MAX_NOTE_LENGTH`) of `plainText`. Archived notes are excluded.
- `buildKnowledgeContext(notes)` formats them into a labelled text block
  (`--- [Известная проблема] <title> --- …`) appended to the user prompt as a
  "приоритетный источник".
- The chosen notes are recorded on the guide as `sources` (`_id/title/type`).

**Note:** per-user `canViewNote` is intentionally **not** applied here — the AI
guide is a staff-only artifact generated in the background without a viewer
context (it's stripped for end-users in the ticket `getOne`), so it sees all
context-matched notes.

## Agent access (MCP) — `backend/routes/mcp.js`

A read-only [Model Context Protocol](https://modelcontextprotocol.io) endpoint
lets the organisation's AI agents (OpenClaw) answer from the knowledge base.
Owner decisions (2026-09-16/17): only staff talk to the agent; it gets **only
approved notes without a leak flag**; the MCP path does no secret scanning of its
own; access keys are issued by admins in Settings.

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
- **Approval does not clear the flag** (`approve` leaves `secretsScan` alone): an
  approved note with undismissed findings stays hidden.
- **Why this is enough:** approving requires `confirmNoSecrets: true`, any edit
  resets approval, and the scanner flags credentials. Limits: the flag is only
  maintained while `knowledgeBase.scanForSecrets` is on (otherwise the approval
  confirmation is the only guard); notes never scanned stay visible until the
  hourly pass after scanning is switched on; the scanner stores at most 25
  findings, so dismissing those 25 on a note with more leaves it unflagged until
  the next scan.
- **Not per user.** `canViewNote` is not applied (there is no viewer) and
  company bindings do not restrict: whoever can talk to the agent can read every
  servable note.
- A hidden, missing or malformed id gets the same `isError` answer, so the agent
  cannot tell that a hidden note exists.

### Request path

- `POST /api/mcp` is mounted in `backend/routes/index.js` right after `/bot`,
  **before** `attachSession`: the agent has its own credential, and its
  `Authorization: Bearer` header would otherwise reach better-auth's `bearer()`
  plugin as a session token.
- `backend/routes/mcpRouter.js` (dependency-free factory; wired with real
  models and the logger in `routes/mcp.js`): `requireMcpKey` → per-key limiter
  (120 requests/min, key `mcp:<keyId>`) → `knowledgeBaseModuleIsActive` → MCP
  handler. Any other method on the path → `405` with `Allow: POST`; anything
  below it → `404`, so nothing under `/mcp` falls through to the session layer.
- `backend/middleware/requireMcpKey.js`:
  - accepts only `Authorization: Bearer hd_mcp_<64 hex>` (no query string, no
    `X-API-Key`); the format is checked before any database read;
  - looks the key up by sha256 in `mcpkeys`; updates `lastUsedAt` at most hourly
    (fire-and-forget); sets `req.mcpKey = { _id, name }` and never `req.auth`;
  - refusals are answered directly — `401` JSON plus
    `WWW-Authenticate: Bearer realm="hd-mcp"` — because `errorResponse` calls
    `next(error)` after replying and finalhandler then destroys the socket;
    database errors go to `next(error)`;
  - refusals are logged as `warn` `MCP: ключ доступа не принят` with
    `reason: missing | malformed | unknown`.
- `backend/services/mcp/server.js` uses the official TypeScript SDK v2
  (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`, CJS builds):
  - `createMcpHandler(factory, { maxSubscriptions: 0 })` — stateless, a fresh
    `McpServer` per request, no subscription streams;
  - 2025-era clients are served on the SDK's legacy stateless path. OpenClaw
    2026.9.4 bundles `@modelcontextprotocol/sdk@1.30.0` (protocol 2025-11-25):
    every POST gets a short `text/event-stream` (`X-Accel-Buffering: no`) that
    closes with the result, so the built-in nginx and an external proxy need no
    settings. The request `Accept` header must list both `application/json` and
    `text/event-stream` (`406` otherwise);
  - the key identity reaches the tools through `authInfo.extra` (`toNodeHandler`
    would forward `req.auth`, which in this app is the staff session context);
  - tool arguments are plain JSON Schema via `fromJsonSchema` (no zod);
    arguments outside the schema come back as a tool error before the tool runs;
  - server `instructions` tell the agent that notes are mostly in Russian, to
    search first and then read by id, to cite links, and that only approved
    notes exist for it.

### Tools

| Tool | Arguments | Result |
|---|---|---|
| `search_knowledge_base` | `query` (1–300 chars), `limit` (1–20, default 8) | `Found N approved notes…`, then per note: title, id, type label, `approved` (ISO instant), companies, categories, link `${ADDRESS}/knowledge-base/<id>`, snippet |
| `get_knowledge_note` | `id` | title, id, type, `approved`, companies, categories, link, bound users, then the Markdown `content` |

Both are annotated `readOnlyHint`, `idempotentHint`, not destructive, closed
world.

- **Ranking** reuses `knowledgeBaseContext.toStems` / `scoreNote` (title stem 3,
  body stem 1) plus 2 for each query stem found in a company alias, category
  title or bound user name. If the query has no stems or nothing scores, every
  whitespace-separated term must be a substring of title + `plainText` +
  bindings (IP addresses, host names; fenced code is not part of `plainText`).
  Order: score → type priority → `approvedAt` desc.
- **`updatedAt` is deliberately unused.** Existing notes still carry the time of
  the last scan from before the 2026-09-17 fix (see «Background jobs»), while an
  edit resets approval — so for an approved note `approvedAt` is the reliable
  freshness of its text.
- **Snippet:** 100 chars before and 200 after the first match in `plainText`.
- **Content:** `![alt](data:…)` → `[изображение: alt]`, other base64 data URIs →
  `[данные]`, capped at 40 000 chars with a truncation marker.
- **Data access:** `services/mcp/knowledgeSource.js` — `findCandidates()` without
  `content`, `findNoteById(id)` with it; the scope fields are always selected
  because `isServable` re-checks them.
- **Logging:** one `info` line `MCP tool call` per call with `mcpKeyId`,
  `mcpKeyName`, `tool`, `query` (≤100 chars) or `noteId`, `hits` / `found`,
  `durationMs`. Key values are never logged.

### Keys — `backend/controllers/mcpKey.js`

Values are `hd_mcp_` + 64 hex (`utils/apiKeyGenerator.js#generateMcpKey`),
returned once on creation; `services/mcp/keys.js#toKeyRow` whitelists what list
and create responses expose. All routes are `isAuth, canManageSettings` and not
module-gated, so a key can always be revoked:

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/preferences/mcp-keys` | — | `{ endpoint, keys: [{ _id, name, keyTail, createdAt, lastUsedAt, createdBy }] }` |
| POST | `/api/preferences/mcp-keys` | `{ name }` (1–100, trimmed) | `201 { message, endpoint, key: { …row, value } }`; `409` when the name exists (case-insensitive) |
| POST | `/api/preferences/mcp-keys/delete` | `{ _id }` | `200` / `404` |

`endpoint` is `${ADDRESS}/api/mcp`. Create and delete write an audit `info`
line with the key id and name. Deleting is revoking: there is no cache.
Connecting an agent is described in `docs/deployment.md`, «AI agents (MCP)».

### Tests and a manual check

Unit and contract tests: `services/mcp/knowledgeTools.test.js` (scope checked
with `sift`, i.e. MongoDB matching rules; ranking, snippet, content, logging),
`middleware/requireMcpKey.test.js`, `routes/mcp.test.js` (the whole route over
the real SDK with a 2025-11-25 client — the guard for SDK upgrades),
`services/mcp/keys.test.js`, `validations/mcpKey.test.js`.

By hand, with a key from Settings:

```bash
M=(-sS -X POST "$APP_PUBLIC_URL/api/mcp" -H "Authorization: Bearer $KEY" \
   -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
curl "${M[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl "${M[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_knowledge_base","arguments":{"query":"vpn"}}}'
```

Answers arrive as `data: {…}` lines. A flagged or unapproved note's id must give
`isError` from `get_knowledge_note`; marking all of a note's findings «Не секрет»
must make it readable on the next call.

## Frontend map

Interface rules are in `docs/ux-ui-guide.md` — this module's components are its
reference implementations for in-place document editing, the trust line and
`app/BulkActionBar`; the decisions behind the current screens are the 2026-07-28
entry of `docs/ux-ui-changelog.md`. Component internals live in each component's
own header.

- **Routes** (`frontend/src/App.jsx`): `/knowledge-base` with children `add` and
  `:id`. The page owns its two-pane layout — the shell sidebar (`store/sidebar`,
  the `/knowledge-base` branch of `layout/Root.jsx`) is legacy and unused here;
  the route is listed in `MIGRATED_ROUTES`.
- **Pages** — `pages/KnowledgeBase/{List,Add,View}.jsx`: the list shell (loads
  notes on mount, reads `?moderation=<mode>` to enter a queue), a blank note in
  edit mode, and the note loader (`NoteView` keyed by `_id`, so navigating
  between notes remounts and resets state).
- **Components** (`components/KnowledgeBase/`): `NoteView` — the document page,
  read and edit in the same place — composed of `NoteHero`, `VerificationLine`,
  `NoteActions`, `PendingRequestAlert`, `SecretsAlert`, `NoteProperties`,
  `BindingPills` and `VerifyModal` (the two-switch approval attestation);
  `Explorer` + `NoteList` / `NoteItem` / `Filter` / `CompanyFolders` (the list
  and its filters); `NoteBulkActionBar` (queue selection → `app/BulkActionBar`);
  `useModerationSummary` (seeds queue counters from the prefs snapshot, then
  refreshes them from `/moderation-summary`).
- **Agent keys** — `components/Preferences/McpKeys.jsx` at the end of the
  «База знаний» settings section (`Preferences/KnowledgeBase.jsx`), backed by
  `/api/preferences/mcp-keys`; status-row logic and the OpenClaw config snippet
  live in `util/mcp-keys.ts` (tested with `node --test`); the one-time key
  dialog is the shared `components/app/IssuedKey.tsx`.
- **Store** — `store/lists/knowledgeNotes.js` (Zustand): `datasetQuery` builds
  the server query (`archived` / `flaggedSecrets` / `search`) and `refresh`
  refetches **only when that query changed**, otherwise re-filters client-side.
  `scope` (`active`/`archived`) and `moderationMode` are mutually exclusive; a
  queue bypasses binding scoping but still honours the type filter. Search is
  debounced 300 ms — it costs a round-trip now. The binding facets hold
  **objects, not ids**: options are derived from the loaded notes and a server
  search narrows that set, so with ids alone a selected company would vanish
  from its own select the moment you typed. Without a filter the list shows
  everything the user may see — the old "only global notes until you search"
  rule is gone, the backend is already the visibility boundary.
- **Shared utilities** (`frontend/src/util/`): `knowledgeNoteTypes.js` — labels,
  icons and ranking priority (`TYPE_PRIORITY` is **duplicated** in
  `backend/services/knowledgeBaseContext.js` — keep them in sync), plus
  `getApprovalMeta` / `getVerificationSummary` / `getNoteFlags` (list exceptions
  in severity order) / `formatActor` («Иванов И.»); `knowledgeNoteBindings.js`
  (binding kinds and label formatting); `knowledgeNoteGrouping.js` (a note's
  companies = `companies[]` ∪ `users[].company`, none ⇒ «Общие»);
  `knowledge-bulk-eligibility.js` (why a given note can't take a bulk action).
- **Nothing legacy is left in the KB surface** — the ticket-page notes panel was
  the last consumer of `UI/knowledgeBase.css` and `BindingChips.jsx`; both are
  gone, `BindingPills.jsx` is the only binding-pill component.

### Ticket-page integration

- `components/Ticket/View/KnowledgeSection.jsx` (ticket View) — fetches
  `/related`, ranks client-side with the same `matchesTicketContext` logic as the
  backend (**keep the two in sync**) and groups rows by the narrowest match
  (category → company → applicant). Reading opens a right sheet; the body is
  fetched per note by `_id` because `/related` returns no `content`. «Новая
  заметка» seeds the section's facet store with the ticket's company and category
  and navigates to `/knowledge-base/add`, where `NoteView` (`isNew`) inherits
  them. Type filter, secrets flag and approval-expiry warning are deliberately
  not shown here — see docs/ux-ui-changelog.md, 2026-07-30.
- `components/KnowledgeBase/ModerationCard.jsx` (ticket List) — moderator-only,
  links into `?moderation=…`, reads the shared `store/knowledgeModeration.js`
  (seeded from the prefs snapshot, refreshed via `/moderation-summary` and after
  every bulk action).
- `components/Dashboard/ServiceExpiry.jsx` — for **anyone**, no right required:
  `/service-expiry` is the one route of the section without `canReadKnowledge`
  and decides per caller what to return (staff by the visibility rules, a
  client responsible for a company only for that company). Renders only when
  the route returns services, formats dates with the shared calendar-date
  helper and links to the source note.
- `store/prefs.js` holds the global KB moderation snapshot
  (`isModerator/hideNotApproved/scanForSecrets/counts`) from `preferences.getInitial`.

## Migration / one-off scripts (`backend/scripts/`)

All idempotent, run directly against Mongo. Run inside the backend container.

- `backfillNoteApproval.js` — sets `approved:false` on legacy notes missing the
  field. (Code already treats missing as unapproved; this makes it explicit.)
- `migrateDomainExpiryToServiceExpiry.js` — renames the old
  `trackDomainExpiry/domainExpiryDays` prefs → `trackServiceExpiry/serviceExpiryDays`,
  drops the stale `note.domainExpiry` field + index, and re-runs the service scan.
  (The feature was renamed "domain" → "service"; the rename touched the model,
  services, controllers, and the `DomainExpiryCard.jsx → ServiceExpiryCard.jsx`
  component.)

## How to test end-to-end

1. Enable the module in the settings; give a test staffer a role carrying
   `knowledge.read` + `knowledge.manage`, and the `kb-moderator` role (or any
   role with `knowledge.moderate`) to exercise moderation.
2. **Create** a note (`/knowledge-base/add`). It saves **unapproved**. Bind it to
   a company/category/user to exercise scoping.
3. **Visibility** — log in as a staffer of another company: a bound note is hidden;
   a note with no bindings is visible; turn on "скрывать неодобренные" and confirm
   non-managers stop seeing the unapproved note.
4. **Verify** — «Проверить» requires **both** confirmations; the note then
   reports «Проверено · <имя> · <дата>» (plus «действует ещё N дн.» when
   `approvalPeriodDays > 0`). Edit it and confirm the approval drops back to
   unverified, naming the editor.
5. **Deletion** — request it as a manager, then as a moderator confirm or
   decline; confirming **hard-deletes** the document from the collection.
6. **Archival** — request, confirm, then restore: `archivedAt` set ⇒ the note
   disappears from the default list and every scan except the secrets queue, and
   `unarchive` brings it back.
7. **Bulk** — as a moderator open `?moderation=all-unapproved`, select several
   notes and verify them in one call. The response reports `processed` plus a
   `skipped[]` list naming, **by title**, every note whose status changed while
   the queue was open — those must not be mis-transitioned.
8. **Search** — `GET /knowledge-notes?search=…` fires once per 300 ms (not per
   keystroke) and its response carries **no `plainText`**; every term must match,
   and a regex-special character in the box must not scan the collection.
   Selecting a company and then typing a query must not drop the company from
   its own filter.
9. **Secrets** — enable "искать секреты", put `password = R00tP@ss123` in a note,
   run the hourly job (or call `runSecretsScan` manually). The note flags; the
   moderator sees the masked finding and can mark "Не секрет" — the raw value is
   never stored, only its hash.
10. **Service expiry** — enable tracking, add a markdown table with service +
    renew date columns, run `runServiceExpiryScan`. Within `serviceExpiryDays`
    the service shows on the tickets page (overdue dates always show).
11. **Tickets** — open a ticket whose company/category/applicant matches a note
    and confirm it appears under "База знаний"; with AI enabled, confirm the note
    is listed as a guide source. A note bound to another company must **not**
    leak in.
12. **Agent access (MCP)** — create a key in Settings and run the manual check
    from «Agent access (MCP)»: an approved note is found and readable, a flagged
    or unapproved one is not; delete the key and the next call gets `401`.
