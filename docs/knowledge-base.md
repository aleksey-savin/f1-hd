# Knowledge Base — Implementation Notes

_Last updated: 2026-07-29. This document covers the data model, the API, the
background jobs and the operational rules of the Knowledge Base module.
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

The module is gated by a **module flag** and two **per-user permissions**, and
everything is additionally scoped per-user in the controllers (defence in depth).

## Module gating & permissions

| Gate | Where | Meaning |
| --- | --- | --- |
| `modules.knowledgeBase.isActive` | `Preferences` | Whole module on/off. Middleware `knowledgeBaseModuleIsActive` (`backend/middleware/permissions.js`) 403s every route when off. Toggled in Preferences → Модули (`frontend/src/components/Preferences/Modules.jsx`, label "База знаний"). |
| `permissions.canSeeKnowledgeBase` | `User` | Read access. Middleware `canSeeKnowledgeBase`. Default **false**. |
| `permissions.canManageKnowledgeBase` | `User` | Create / edit / request lifecycle actions. Middleware `canManageKnowledgeBase` (admin bypasses). Default **false**. |
| `isNotClient` | middleware | All mutations also require a non-client (staff) account. |

Both permissions live on `User.permissions` (`backend/models/user.js`, mirrored
in `backend/types/user.ts`) and are declared in the shared permission catalog
`frontend/src/components/User/permissions-catalog.js` (group «База знаний»:
"Просмотр базы знаний" / "Управление базой знаний") — one source for both the
user form and the user card, so saving never silently drops a flag.
`Preferences.knowledgeBase` itself (moderators, the hide / approval-period
options and both scanner switches) is edited in
`frontend/src/components/Preferences/KnowledgeBase.jsx`.

### Moderators

Moderators are a **subset of managers** listed in
`Preferences.knowledgeBase.moderators`. An **admin is always a moderator**.
`isModerator(authedUser, moderatorIds)` (`backend/helpers/knowledgeNoteVisibility.js`)
is the single source of truth. The settings UI only offers users who have **both**
`canSeeKnowledgeBase` **and** `canManageKnowledgeBase` (or are admin) as candidates
(`GET /api/users/knowledge-base-moderators`, `isAdmin`-gated;
`backend/controllers/user.js → getKnowledgeBaseModerators`).

Moderator-only actions (verified **in the controller**, not just by middleware,
because the routes are open to all managers): approve, confirm/decline deletion,
confirm/decline archive, ignore-secret-finding, moderation summary.

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

## Visibility model

`canViewNote(note, authedUser, kbConfig)` in
`backend/helpers/knowledgeNoteVisibility.js` is the **single** visibility
predicate. Every read endpoint fetches a candidate set then filters with it (the
DB query is not the security boundary — the predicate is). Order of checks:

1. **No `canSeeKnowledgeBase` (and not admin)** → deny. (Routes are also
   middleware-gated; this is defence in depth.)
2. **Manager** (`isAdmin || canManageKnowledgeBase`) → allow **everything**,
   including unapproved and otherwise-scoped notes.
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
`frontend/src/components/Ticket/RelatedNotes.jsx` (ranking only) — keep them in
sync.

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
`knowledgeBaseModuleIsActive`, `canSeeKnowledgeBase`; mutations add `isNotClient`
+ `canManageKnowledgeBase`; moderator-only logic is enforced **inside** the
controller. Literal sub-paths (`form-data`, `related`, `moderation-summary`,
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
- **Still legacy (react-bootstrap)** — the notes panel and the moderation /
  service-expiry cards on the ticket page; they migrate with that screen.
  `UI/knowledgeBase.css` survives only as `.kb-chip` for them, and
  `BindingChips.jsx` is their twin of `BindingPills.jsx`.

### Ticket-page integration

- `components/Ticket/RelatedNotes.jsx` (ticket View) — fetches `/related` and
  ranks client-side with the same `matchesTicketContext` logic as the backend
  (**keep the two in sync**); the approval state is hidden when `hideNotApproved`.
- `components/KnowledgeBase/ModerationCard.jsx` (ticket List) — moderator-only,
  links into `?moderation=…`, reads the shared `store/knowledgeModeration.js`
  (seeded from the prefs snapshot, refreshed via `/moderation-summary` and after
  every bulk action).
- `components/KnowledgeBase/ServiceExpiryCard.jsx` (ticket List) — for anyone
  with `canSeeKnowledgeBase`; renders only when `/service-expiry` returns
  services, formats dates with the shared calendar-date helper and links to
  the source note.
- `store/prefs.js` holds the global KB moderation snapshot
  (`isModerator/hideNotApproved/scanForSecrets/counts`) from `preferences.getInitial`.

## Migration / one-off scripts (`backend/scripts/`)

All idempotent, run directly against Mongo. Run inside the backend container.

- `backfillNoteApproval.js` — sets `approved:false` on legacy notes missing the
  field. (Code already treats missing as unapproved; this makes it explicit.)
- `grantSeeKnowledgeBase.js` — grants `canSeeKnowledgeBase` to all non-client
  users, so the base stays visible to everyone who saw it before the permission
  existed. Schema default stays `false`, so new users must be granted explicitly.
- `migrateDomainExpiryToServiceExpiry.js` — renames the old
  `trackDomainExpiry/domainExpiryDays` prefs → `trackServiceExpiry/serviceExpiryDays`,
  drops the stale `note.domainExpiry` field + index, and re-runs the service scan.
  (The feature was renamed "domain" → "service"; the rename touched the model,
  services, controllers, and the `DomainExpiryCard.jsx → ServiceExpiryCard.jsx`
  component.)

## How to test end-to-end

1. Enable the module (Preferences → Модули → "База знаний"); grant a test staffer
   `canSeeKnowledgeBase` + `canManageKnowledgeBase`; add them to **Модераторы базы
   знаний** in Preferences → База знаний.
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
