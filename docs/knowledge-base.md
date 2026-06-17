# Knowledge Base — Implementation Notes

_Last updated: 2026-06-17. This document describes the Knowledge Base module as
currently implemented, so the code can be reviewed and optimized later. It is a
snapshot, not a spec — verify against the code before relying on any detail._

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
in `backend/types/user.ts`) and are edited under User → "База знаний"
(`frontend/src/components/User/Form.jsx`: "Просмотр базы знаний" /
"Управление базой знаний").

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
| `GET /knowledge-notes` | `getAll` | Visible notes, no `content`. `?archived=true` → archive; `?flaggedSecrets=true` → all flagged (incl. archived). Sorted `updatedAt` desc. |
| `GET /knowledge-notes/form-data` | `getFormData` | Companies / active non-service users / active categories for the editor selects. Manager-gated. |
| `GET /knowledge-notes/related` | `getRelated` | Notes matching a ticket (`?company&category&user`), with `matchesTicketContext`. Excludes pending-deletion + archived. |
| `GET /knowledge-notes/moderation-summary` | `getModerationSummary` | Counters for moderators (zeros otherwise). |
| `GET /knowledge-notes/service-expiry` | `getServiceExpiry` | Services within the renew window; dedup by service, overdue flag. |
| `GET /knowledge-notes/:id` | `getOne` | Full note incl. `content`; 403 if not visible. |
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

`getModerationSummary` and the moderation block of `preferences.getInitial`
return the same four counters: `pendingApproval` (unapproved, non-archived),
`pendingDeletion`, `pendingArchive` (both non-archived), and `secretsFlagged`
(incl. archived).

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
  (`услуг|сервис|service|домен|наимен|сайт|адрес|name|url|site`) or the first
  domain-shaped column not already taken.
- **Registrar column** — by header only (`регистр|хостер|host|provider`).

A table counts as a service table only if it has **both** a date and a service
column. Dates parse `DD.MM.YYYY` / `DD/MM/YYYY` / `YYYY-MM-DD` to **UTC midnight**
(so the day never drifts by timezone). Entries are deduped by service (case-insensitive).

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

## Frontend

### Routing & navigation

- Nested routes (`frontend/src/App.jsx`): `/knowledge-base` (list shell) with
  children `add` and `:id`.
- `pages/KnowledgeBase/List.jsx` — renders a left **Sidebar** (browser) and an
  `<Outlet>`; at the root it shows a placeholder. Reads `?moderation=<mode>` from
  the URL to enter a moderation filter (set by the cards/links on the tickets
  page).
- `pages/KnowledgeBase/Add.jsx` — `<NoteView mode="edit">` (blank note).
- `pages/KnowledgeBase/View.jsx` — loader fetches the note, `<NoteView mode="read">`
  keyed by `_id` so navigation remounts and resets state.
- Nav links in `layout/Navbar.jsx` and `layout/MobileBottomNavbar.jsx`
  ("База знаний", `RiBookOpenLine`), gated by module + `canSeeKnowledgeBase`.

### `NoteView` — `components/KnowledgeBase/NoteView.jsx`

The one component for **read and edit**, same layout in both. Top row = bindings +
actions; then title; then markdown. Read mode shows `NoteStatusBadges`, type +
binding badges, a **secrets alert** for moderators (each finding has a "Не секрет"
button), and the `MarkdownViewer`. Edit mode swaps in selects (type / categories /
companies / users) and the `MarkdownEditor`; form-data options are **lazy-loaded**;
a new note **prefills** bindings from the list's active filters. The "Действия"
dropdown assembles only the lifecycle items valid for the current state/role
(approve, send/confirm/decline deletion, request/confirm/decline archive); archived
notes show only "Восстановить из архива". Confirmations use `ApprovalModal`
(two switches), `ConfirmDeletionModal`, and the generic `ConfirmActionModal`
(archive request/confirm).

### Sidebar — `components/KnowledgeBase/Sidebar.jsx`

Search box, multi-selects (companies / users / categories — options derived from
the loaded notes), per-type toggle switches, an "Показать архив" switch, and —
for moderators in the active view — moderation filter buttons ("На одобрение",
"На удаление", "На архивацию", "Учётные данные"; the last only when
`scanForSecrets`). List items show an approval icon, title, company badges, and
status icons (secrets / pending-archive / pending-deletion).

### Store — `store/lists/knowledgeNotes.js`

Zustand. Notes are **not** auto-loaded — only on demand (`ensureLoaded` when a
filter select opens, or `fetch`). `datasetQuery` picks the server set
(active / `?archived=true` / `?flaggedSecrets=true`); `refresh` refetches only
when the set changed, otherwise re-filters client-side. Without an active filter
the active view shows **only global notes** (no bindings) — bound notes require a
search/filter to appear. `moderationMode` bypasses binding-scoping but still
honours type + search. `setModerationMode` and `setShowArchived` are mutually
exclusive.

### Note types — `util/knowledgeNoteTypes.js`

Single source for labels / badge colors / ranking priority:
`info` ("Информация", primary, 1) · `backlog` ("Бэклог", warning, 3) ·
`instructions` ("Инструкции", success, 2). `getApprovalMeta` returns the
approved/unapproved icon+label. The backend mirrors the priority in
`knowledgeBaseContext.js` (`TYPE_PRIORITY`) — **keep them in sync**.

### Ticket-page integration

- `components/Ticket/RelatedNotes.jsx` (ticket View) — fetches `/related`, ranks
  client-side, shows a type-filtered list with per-note match badges, opens a note
  in an `Offcanvas`. Approval badge hidden when `hideNotApproved`.
- `components/KnowledgeBase/ModerationCard.jsx` (ticket List) — moderator-only
  card with counter buttons linking into `?moderation=…`. Seeds counts from the
  prefs snapshot, refreshes via `/moderation-summary`.
- `components/KnowledgeBase/ServiceExpiryCard.jsx` (ticket List) — "Продление
  услуг" card for anyone with `canSeeKnowledgeBase`; renders only when
  `/service-expiry` returns services. UTC date formatting; "просрочена"/"скоро"
  badge; links to the source note.
- `store/prefs.js` holds the global KB moderation snapshot
  (`isModerator/hideNotApproved/scanForSecrets/counts`) from `preferences.getInitial`.

### Settings UI — `components/Preferences/KnowledgeBase.jsx`

Edits `Preferences.knowledgeBase`: moderators multi-select (candidates from the
admin endpoint), "скрывать неодобренные", approval-period days, "искать секреты",
"отслеживать продление услуг", and the warn-days field (disabled unless tracking
is on).

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
2. **Create** a note (`/knowledge-base/add`). It saves **unapproved** (warning
   icon). Bind it to a company/category/user to exercise scoping.
3. **Visibility** — log in as a staffer of another company: a bound note is hidden;
   a note with no bindings is visible; turn on "скрывать неодобренные" and confirm
   non-managers stop seeing the unapproved note.
4. **Approve** via the "Действия" menu — both switches required. Edit the note and
   confirm approval resets to unapproved.
5. **Deletion** — "Отправить на удаление" as a manager → trash icon in the list;
   as a moderator "Подтвердить удаление" prunes it (or "Отклонить" clears it).
6. **Archival** — "Запросить архивацию" → moderator "Подтвердить архивацию"; the
   note leaves the default list and appears under "Показать архив"; "Восстановить
   из архива" brings it back.
7. **Secrets** — enable "искать секреты", put `password = R00tP@ss123` in a note,
   run the hourly job (or call `runSecretsScan` manually). The note flags; the
   moderator sees the masked finding and can mark "Не секрет".
8. **Service expiry** — enable tracking, add a markdown table with service + renew
   date columns, run `runServiceExpiryScan`. Within `serviceExpiryDays` the service
   shows on the tickets page "Продление услуг" card (overdue dates always show).
9. **Tickets** — open a ticket whose company/category/applicant matches a note and
   confirm it appears under "База знаний"; with AI enabled, confirm the note is
   listed as a guide source.
