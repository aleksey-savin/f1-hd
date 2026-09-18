# Ticket analysis for AI agents over MCP — design

Status: backend implemented and verified live 2026-09-18; the Settings UI waits
for the mockup approval. Builds on `2026-09-17-kb-mcp-access-design.md`
(the MCP endpoint, keys, transport). Implementation notes: `docs/mcp.md`.

## Problem

The organisation's staff-only AI agent (OpenClaw) already reads the knowledge base
over MCP. The owner wants it to analyse tickets as well: find similar tickets of a
company to reach a better and faster solution, look at open or closed tickets of a
company or a person, and spot patterns. Each ticket should come with its related
information — comments, works, devices, applicant and company — but without
addresses, phone numbers and other contact data.

## Decisions

1. **Keys carry permissions, the agent chooses filters.** A key gets checkboxes
   «База знаний» and «Заявки». There are no per-key allowlists of companies or
   users: the agent serves staff only, and a key with «Заявки» sees every ticket
   (like a staff member with `ticket.readAll`). The agent narrows each request
   itself (open/closed, company, user, category, dates). Allowlists can be added
   later without changing the tools.
2. **Existing keys stay knowledge-only.** A key without stored permissions is
   treated as «База знаний».
3. **Contact data is excluded by field and masked in text.** Structured contact,
   secret and finance fields are never selected (allowlists in code). Free text
   (titles, descriptions, comments, questionnaire answers, checklist items, work
   descriptions, closing comments) is masked: phone numbers → `[телефон]`,
   e-mail addresses → `[e-mail]`, credentials found by the secrets scanner rules →
   `[секрет скрыт]`. IP addresses are kept (technical analysis needs them).
   Street addresses typed as free text are not detected.
4. **Search is word-stem ranking in memory** (approach A): candidates are narrowed
   by indexed filters and ranked with the knowledge-base stems (`toStems` /
   `scoreNote`). The agent judges meaning from the top candidates. Ticket texts are
   small (median description 113 chars, all descriptions ≈3.3 MB on 13,750 dev
   tickets); the heavy `htmlDescription` (≈51 KB average raw e-mail HTML) is never
   read. A Mongo text index and embeddings were considered and postponed.
5. **Four tools**, all read-only: `search_tickets`, `get_ticket`,
   `find_similar_tickets`, `ticket_stats`.
6. **Modules decide sections.** Tickets are core. Works appear only while
   «Учёт времени» is on, devices only while «Учёт техники» is on, knowledge-base
   tools only while «База знаний» is on. The module gate moves from the whole
   `/api/mcp` route into tool registration.
7. **Open = `isClosed: false`, archive = `isClosed: true`.** `isArchived` is a dead
   legacy flag (nothing sets it since 2026-07-28) and is ignored; `state` is shown
   as a label only (it can disagree with `isClosed`).
8. **The ticket-card leak is a separate fix.** `GET /api/tickets/:num` returns the
   whole company document (API keys, employees' e-mails and phones) to everyone who
   can open the ticket, clients included. It is out of scope here and should be
   fixed first, separately.

## Access

- `McpKey.scopes: ["knowledge" | "tickets"]`, at least one. Missing or empty on a
  stored key reads as `["knowledge"]` (lean reads skip schema defaults).
- `requireMcpKey` passes `scopes` into `req.mcpKey`; the MCP handler forwards them in
  `authInfo.scopes`.
- Per request the server reads the needed Preferences once (modules, organisation
  timezone, `defaultApplicant`, `defaultCompany`, `mikrotik.applicant`) and
  registers only the tools the key's scopes and the active modules allow. A key
  that ends up with no tools gets `403` with a message naming the reason (same as
  today's knowledge-only key with the module off).
- Server instructions are composed from the registered tools.

## Tools

Common rules: names are resolved server-side (company by alias/full title, user by
first/last name, category by title, case-insensitive substring); several matches →
the tool lists them and asks for a more specific name, no guessing; no match → says
so. People are shown as «Фамилия Имя», with position and a marker: client, staff,
or system (service accounts, the unidentified e-mail sender `defaultApplicant`, the
monitoring robot). Every result carries a link `${ADDRESS}/tickets/<num>` and
full-ISO instants. Each call writes one `MCP tool call` log line (key, tool,
arguments summary, result size, duration).

### `search_tickets`

Arguments: `query?` (words or a ticket number), `status` open | closed | any
(default any), `company?`, `user?` (applicant), `category?`, `from?` / `to?`
(`YYYY-MM-DD`, by creation date, organisation timezone, both inclusive),
`limit` 1–50 (default 10), `page` (default 1).

- Filters map to existing indexes (`isClosed`, `company._id`, `applicantId`,
  `categoryId`, `createdAt`).
- With `query`: an all-digit term also matches `num`; ranking = stems over title
  (3) and plain description (1); fallback substring match as in the knowledge
  base. Without `query`: newest first.
- Result: total count, then per ticket — number, title, status label and
  open/closed, company, applicant, category, created, closed, link, masked snippet.

### `get_ticket`

Argument: `num`. Result sections:

- **Header** — title, status, source, category, company (alias, full title),
  applicant, responsibles (names), routine task title, created / processed /
  started / closed / deadline, link.
- **Description** — plain text: HTML → lines (`htmlToPlainLines`), quoted e-mail
  chain cut for e-mail tickets (`stripQuotedReply`), `data:` URIs dropped, masked,
  capped at 20 000 chars.
- **Questionnaire** — `name: answer` (`formatAnswer`), masked.
- **Checklist** — items with done marks, masked.
- **Comments** — all, oldest first: author (with marker), time, masked content
  (capped 4 000 chars each). Loaded by `ticketId` **and** the ticket's `comments`
  ids, so e-mail replies missing from the array (before 2026-07-08) are included.
  A `{ ticketId: 1 }` index is added to comments.
- **Works** (module «Учёт времени») — performer, start, finish, duration
  (`workDurationMs`), on-site or remote, masked description. No `finances`,
  `withinPlan` or money.
- **Devices** (module «Учёт техники») — the ticket's related device
  (`relatedClientDeviceId`) and the applicant's personal devices (not for system
  accounts): type, vendor, model, inventory number, serial number, status, OS.

Never selected: `htmlDescription`, `realSender`, `attachments` (file keys,
transcripts), the legacy `applicant` snapshot, responsibles' e-mail/phone, AI
fields, logs, `notifications`, Pro32 sessions; on users — e-mail, phone, photos,
Telegram, work status, salary, subdivision; on companies — phones, addresses, map
links, domains, API keys, service plans, people snapshots; on devices — IP, MAC,
hostname, license keys, prices, purchase and supplier data, notes, photos,
location.

### `find_similar_tickets`

Arguments: `num`, `scope` same_company | all (default same_company), `status`
closed | any (default closed), `limit` 1–30 (default 10).

- Query = stems of the source ticket's title and description; the source ticket is
  excluded; ties prefer the same category, then the latest close.
- Each match adds "how it was solved": the closing comment when it is meaningful
  (≥ 100 chars, the AI guide's threshold) and its works' descriptions, masked.

### `ticket_stats`

Arguments: `groupBy` category | month | company | applicant | source (default
category), `status` any | open | closed (default any), `company?`, `user?`,
`category?`, `from?` / `to?`.

- Loads a slim projection of the matching tickets and aggregates in code (no
  dependency on newer MongoDB operators): per group — tickets, open, closed,
  median hours from creation to close for closed ones, share of the total.
- Month groups are by creation date in the organisation timezone
  (`utils/datetime.js#dayKey`); group
  labels are names, never ids; rows sorted by tickets, top 50 plus an «остальные»
  row.

## Masking

A pure module `services/mcp/maskText.js`, applied to every text a ticket tool
returns:

1. credentials — `redactSecrets` in `services/secretsScanner.js`: the scanner's
   detection rules refactored into an internal value collector shared with
   `scanText` (whose output stays identical), values replaced longest-first;
2. e-mail addresses;
3. phone numbers — Russian and international formats (`+7`/`8` + 10 digits in any
   grouping, `(3xx) xxx-xx-xx`, local `xxx-xx-xx`), not dates, times, IP
   addresses, versions, ticket numbers or plain serials. A table-driven test fixes
   what counts.

## Settings UI (mockup first)

- The keys block leaves «База знаний» (keys now also open tickets); the mockup
  shows «Интеграции» and a separate section as options.
- «Создать ключ» gets permission checkboxes «База знаний» / «Заявки» (at least
  one, with a hint what tickets include and exclude).
- Key rows show their permissions; «Изменить доступ» changes them without
  reissuing the key (the OpenClaw key keeps its value).
- The «Поиск секретов выключен» warning applies only while some key has
  «База знаний»; outside the knowledge base section it reads the saved setting.

API: `POST /api/preferences/mcp-keys` accepts `scopes`; list rows return
`scopes`; new `POST /api/preferences/mcp-keys/update { _id, scopes }` with an
audit log line.

## Known limits

- Masking is pattern-based: unusual phone formats and credentials the scanner
  rules do not know can pass; free-text street addresses are not detected; some
  long digit sequences may be masked as phones.
- The same patterns also over-mask: technical tokens that mix letters, digits
  and `+` (a device model such as `MikroTik CRS328-24P-4S+`) are redacted as
  credentials.
- Similarity is lexical: the same problem described with different words is found
  only if the agent searches again with other words.
- Comments without `ticketId` from before `ticketId` existed are not loaded.
- A key with «Заявки» reads every ticket of every company.

## Verification

Unit tests: masking table, `redactSecrets` characterization, a ticket fixture with
contact data in every excluded field (none may appear in the output), search /
similar ranking and name resolution, stats aggregation (grouping, median,
timezone months), scope and module tool registration through `routes/mcp.test.js`,
key API validation. Live on the dev stack with a real `@modelcontextprotocol/sdk`
1.30 client: every tool on real data, no phone or e-mail pattern in any output,
response times for the largest company (≈3,450 tickets) and for all tickets.
