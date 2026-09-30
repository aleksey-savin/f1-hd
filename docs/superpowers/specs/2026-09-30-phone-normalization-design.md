# Phone numbers: digits in the database, one format on screen — design

Status: spec and mockup approved 2026-09-30 (display variant A); implementation plan
`docs/superpowers/plans/2026-09-30-phone-normalization.md`.
Mockup (canvas «Единый формат телефонов»): https://claude.ai/artifact/QgYZ4UgVxpLc5wzj5Zrsk4

## Problem

Phone numbers are stored exactly as somebody typed them, and nothing formats them on
the way out. The web input mask (`app/PhoneInput`) is used by 2 of 8 phone inputs, so
`users.phone` alone holds `+7 (914) 555-01-42`, `+79145550142`, `+7 914 555-01-42`,
`89145550142`, bare `+7` and incomplete numbers side by side. Every screen prints the
raw string, 10 of 11 `tel:` links use it unstripped, and every matcher has to guess
the format (a last-10-digits regex, duplicated twice). Caller ID additionally runs
numbers through the `phone` package, which rejects most landlines.

Goal: **one canonical form in the database, one display format on screen.** Numbers are
converted where they enter the system and formatted where people read them.

## Decisions (owner, 2026-09-30)

1. **Storage:** digits only, no `+ ( ) -` or spaces (owner's request). The country code
   is always included — E.164 without the plus: `79145550142`, `375291234567`.
2. **Any country** is accepted. `+7` numbers get the Russian mask; others are entered
   after typing `+` and shown as `+<digits>` without grouping.
3. **Full numbers only.** A number without a country/area code (`222-29-99`) is invalid;
   the migration keeps such legacy values as digits and lists them for a manual fix.
4. **Caller ID** recognises landlines, and matches a user or a company only when the
   number leads to exactly one of them (the rule messengers already use).
5. **Texts composed by the server** (client e-mails, the Telegram bot's ticket card,
   titles of unknown contacts in «Диалоги») use the same display format — one small
   formatter in the backend and one in tg-service, same rule and test vectors as the web.
6. Display variant **A `+7 (914) 555-01-42`** (chosen over B `+7 914 555-01-42`; it is
   the input mask, 62 % of stored values and the approved applicant-popup canvas).

## Inventory (2026-09-30)

Counts are from the local copy of production (synced 2026-09-03).

### Stored fields

| Path | Values | Written by | Read by |
|---|---|---|---|
| `users.phone` | 721 | `controllers/user.js` add :805, update :1070, update-account :1829 — raw, no validation (`validations/user.js` is imported by no route) | user card, contact card/sheet, list rows, company employees, ticket applicant, «Диалоги» contact, bot, caller ID, messenger linking, users search |
| `companies.phones[]` | 33 | `controllers/company.js` add :434, update :482 — raw | company card, company contact sheet, MySupport fallback, caller ID |
| `companies.responsibles[].phone`, `.clientsSideResponsibles[].phone` | 197 + 36 | copied from User docs, `controllers/company.js` :418-439, :491-540 | `Company/View/ResponsiblesSection` |
| `companies.users[].phone` (legacy) | 605 | `services/bootstrapSeed.js` :126, company add :438 | count only |
| `subdivisions.phone` | 25 | `controllers/company.js` :897 (trimmed), :1012 (raw) | subdivision sheet, ticket card populate |
| `suppliers.phone` | 0 | `controllers/inventory/supplier.js` :10-21 (schema `trim`) | supplier card and row |
| `preferences.contacts.tel` | 1 | `controllers/preferences.js` :328 — raw | login screen, footer, MySupport, 4 client e-mails (`middleware/notifications.js`) |
| `tickets.responsibles[].phone` | 16 478 | client JSON or `req.auth.legacy` (`controllers/ticket.js`), close rebuilds from User | tickets list filter, bot payload |
| `tickets.applicant.phone` (legacy, «delete after 1.8.9») | 8 324 | nothing | nothing |
| `routinetasks.responsibles[].phone` | 0 | `controllers/routineTask.js` :83 from the request body | copied into tickets (`middleware/routineTasks.js` :50-59) |
| `channelidentities.phone` | 0 | `services/messaging/identity.js` :34 — `normalizeRuPhone` → `+7…`, the only normalized field | «Диалоги», contact block |
| `channels.account.phone` | 1 (empty) | gateway state event, `services/messaging/ingest.js` :384 — raw | channel settings |

Not phone fields and left alone: `conversations.lastMessage.authorName` and in-app
notification titles (display text that may hold a phone from `identityName`),
`channeljobs` (encrypted login step, TTL), `users_before_banned` (backup collection).

### Stored shapes

- `users.phone`: 444 `+7 (XXX) XXX-XX-XX`, 200 `+7XXXXXXXXXX`, 4 `+7 XXX XXX-XX-XX`,
  2 `8XXXXXXXXXX`, 1 `+ 7XXXXXXXXXX`, 7 bare `+7`, 2 incomplete, 61 empty.
- `companies.phones[]`: 24 masked, 9 bare `+7`.
- `subdivisions.phone`: 6 masked, 2 `XXX‒XX‒XX` (figure dashes, no area code), 2
  `+7 (XXXX) XX‒XX‒XX`, 17 empty.
- Legacy ticket applicant copies also hold 198 `телефон`, 5 two-numbers-in-one-string,
  4 seven-digit locals.
- No foreign numbers anywhere. 30 numbers are shared by 2+ users (≈17 of them by 2+
  active users). 21 of 24 company numbers and 12 user numbers are landlines that
  today's caller ID cannot match.

### Formatters and matchers today

- `services/callerIdentityService.js`: `normalizeRuPhone` (npm `phone`, RU,
  `validateMobilePrefix` on → accepts only 9xx/495/498/499/835), `buildPhoneSuffixRegex`
  (last 10 digits, separators `[\s()-]`), `findApplicantByPhone` (`findOne`, first match,
  no service/banned filter), `findCompanyByPhone`.
- `services/messaging/identity.js`: a copy of `buildPhoneSuffixRegex`,
  `findUsersByPhone` (exactly-one rule).
- `components/app/PhoneInput.tsx`: private `formatPhoneNumber` mask; the initial value is
  shown unformatted; a leading 8 becomes `+8 (`; digits past 11 are dropped.
- `services/mcp/maskText.js` masks phones inside free text for AI agents — a different
  job (stored phone fields never reach MCP). **Unchanged.**

### Display sites (frontend)

| Field | Where | Today |
|---|---|---|
| `user.phone` | `User/Item.jsx` :143-153 | icon, raw `title`, raw `tel:` |
| | `User/ContactCard.jsx` :147-160 (address-book sheet, applicant popup) | raw text, raw `tel:`, copy raw |
| | `User/View.jsx` :471-486 | `PropRow`, raw `tel:`, copy raw |
| | `Company/View/EmployeesSection.jsx` :211-219 | icon, raw `title`/`tel:` |
| | `Company/View/ResponsiblesSection.jsx` :77-86 (snapshot) | icon, raw `title`/`tel:` |
| | `Ticket/View/Sections.jsx` :556-568 | icon, raw `title`/`tel:` |
| | `Conversation/ContactBlock.tsx` :92-100 | raw, copy raw; dedupe by exact string vs messenger handle |
| `company.phones[]` | `Company/View.jsx` :301-319 | raw, raw `tel:`, `key={phone}` |
| | `Company/ContactSheet.jsx` :255-277 | raw, raw `tel:`, copy raw |
| | `Dashboard/MySupport.jsx` :44 | first company phone as support-line fallback |
| `subdivision.phone` | `Company/View/SubdivisionPreviewSheet.jsx` :155-164 | raw, raw `tel:` |
| `supplier.phone` | `Supplier/Item.jsx` :26, :35 | raw in meta line |
| | `Supplier/View.jsx` :179-185 | `PropRow`, copy raw, no `tel:` |
| `contacts.tel` | `Auth/AuthShell.tsx` :173-180 | raw text, the only stripped `tel:` |
| | `layout/Footer.jsx` :31-39 | raw, raw `tel:` |
| | `Dashboard/MySupport.jsx` :75-89 | raw, no link |
| messenger phones | `util/conversation-format.js` :297 `counterpartHandle` → ThreadHeader, WhoIsThis, ContactBlock | raw |
| | `util/channel-state.js` :199 `channelHint` → `Preferences/Channels.tsx` :93; `TelegramChannelDialog.tsx` :415 | raw |
| | conversation titles from the backend (`identityName`) | raw `+7…` |

### Inputs (frontend)

`Company/Form.jsx` :371-403 and `User/AccountSettings/Profile.jsx` :110-116 use
`PhoneInput`. Plain inputs: `User/UserForm.jsx` :719-726 (also pre-filled by
`pages/Conversation/NewUser.tsx` :70), `Company/View/SubdivisionFormDialog.jsx` :96-98,
`Supplier/FormFields.jsx` :59-67 (+ `ClientDevice/InlineCreateDialog.jsx` :58-61),
`Preferences/Globals.jsx` :128-136, `Preferences/TelegramChannelDialog.tsx` :513-531
(login step, not stored). Four different placeholders; only the Telegram login uses
`type="tel"`.

### Texts composed outside the web UI

- `middleware/notifications.js` :500, :755, :1257, :1470 — «позвоните нам по номеру
  ${prefs.contacts.tel}» in client e-mails.
- `services/messaging/rules.js` :142 `identityName` falls back to `identity.phone` →
  conversation titles, author names, the bell title «Новое сообщение от …».
- `tg-service/src/bot/render.ts` :172 — «Телефон: ${applicant.phone}» (staff card).

### Searches over phones

`controllers/user.js` :223-231 (users list, substring per whitespace term),
`controllers/conversation.js` :549-570 («Это он» candidates, same),
`store/lists/companies.js` :58, `store/lists/tickets.js` :61, `store/lists/suppliers.js`
:23, `Company/View/EmployeesSection.jsx` :64-92 — all compare raw strings, so
`9145550142` does not find `+7 (914) 555-01-42`.

## Design

### Canonical form and the three functions

- **Canonical value:** digits only, country code included, `""` when there is no
  number. Valid when it is `7` + 10 digits, or 8–15 digits starting with `1-6`, `8`
  or `9` (no country code starts with `0`, and `7` is only ever `+7`).
- **`parsePhoneInput(raw)`** — raw human input → canonical. Used where the input is
  certainly raw: the web field, API sanitizers, the migration, caller-ID text scanning,
  search queries.
  1. Trim. Remember whether it starts with `+`. Keep the digits; none → `""`.
  2. No `+`: a leading `00` or `810` is an international prefix → drop it, treat as `+`.
  3. Still no `+`: 11 digits starting with `8` → `7…` (trunk prefix); exactly 10
     digits → `7` + digits (national number).
  4. A lone `7` or `8` (the mask with no number) → `""`.
- **`toCanonicalPhone(value)`** — the Mongoose setter, idempotent: digits only → kept
  as is (already canonical); anything with other characters → `parsePhoneInput`.
  Idempotency matters: a canonical German `4930901820` must not become `74930901820`
  when it is copied into a snapshot.
- **`formatPhone(value)`** — display: `toCanonicalPhone` first (tolerates legacy text),
  then `+7 (XXX) XXX-XX-XX` for valid `+7`, `+<digits>` for other valid numbers, the
  digits as they are for invalid ones. `phoneHref` = `tel:+<digits>` for valid numbers,
  none otherwise.

**Wire format.** The web client sends phones as E.164 with the plus (`+79145550142`),
the API returns canonical digits. The plus on the way in is what keeps
`parsePhoneInput` unambiguous: without it a 10-digit German number and a Russian number
typed without `+7` look the same. API sanitizers therefore always run the raw parser,
which also cleans up what stale browser tabs send right after a deploy.

### Backend

- **`backend/services/phone.js`** (new; `services/` because `pnpm test` covers it and
  not `utils/`): `parsePhoneInput`, `toCanonicalPhone`, `isValidPhone`, `formatPhone`,
  `phoneSearchDigits` (query → digit string plus the `8→7` variant). Table-driven
  `services/phone.test.js`.
- **Setters on every stored path** (`set: toCanonicalPhone`): `user.js` `phone`;
  `company.js` `phones: [{ type: String, set }]`, `users/responsibles/
  clientsSideResponsibles[].phone`; `subdivision.js` `phone`; `inventory/supplier.js`
  `phone`; `routineTask.js` `responsibles[].phone`; `ticket.js` `applicant.phone`,
  `responsibles[].phone`; `preferences.js` `contacts.tel`; `channel.js`
  `account.phone`; `channelIdentity.js` `phone`. Mongoose 9 applies setters on
  save/create, on `$set` in updates **and on query filter values**
  (`SchemaType.castForQuery` → `applySetters`; RegExp values bypass them) — so
  `User.find({ phone: "+7 (914) 555-01-42" })` finds `79145550142`. Only native-driver
  writes skip setters: better-auth has no phone field, migrations call the parser
  themselves.
- **API validation** — new `validations/phone.js` with `phoneBody(path)` and
  `phoneListBody(path)`: `customSanitizer(parsePhoneInput)` then
  `custom(isValidPhone)` → 400 «Проверьте номер телефона: нужен полный номер с кодом
  страны и города». Wired into: user add,
  update, update-account (`routes/internal/user.js`; the dead `validations/user.js`
  rule is replaced, not revived), company add/update (`phones`, replacing
  `isPhoneList`), subdivision add/update, supplier add/update, preferences
  (`contacts.tel`). Company phones are also de-duplicated and emptied rows dropped.
- **«Мой аккаунт» can clear its phone**: `controllers/user.js` :1829 becomes
  `phone !== undefined ? phone : user.phone`.
- **Matching becomes equality.** Both `buildPhoneSuffixRegex` copies and the npm
  `phone` dependency are removed.
  - One lookup, `findUsersByPhone(canonical)`, owned by `callerIdentityService` and used
    by messaging too: `User.find({ phone, isServiceAccount ≠ true, isCloudTelephony ≠
    true, "company.isActive" ≠ false })`, banned dropped via `isBanned`; exactly one →
    match, otherwise none. `findCompanyByPhone` gets the same exactly-one rule.
  - `extractCallerPhones(email)` returns candidates in order of trust. A valid number on
    the «Кто звонил:» line is the **only** candidate: a telephony mail also carries
    «Номер линии» (our own line) and the call time, which must never be matched. Without
    it: the subject, then the body (plausible Russian `7[3489]…` or an explicit `+`
    number). Candidates never span a line break. `emailHandling.js` tries them in turn
    until one matches — landlines now count, and an INN-like number early in a signature
    no longer hides the real one. (Ruling during implementation, 2026-09-30.)
  - Messenger identities store `toCanonicalPhone(sender.phone)` — foreign numbers are
    kept now, not dropped — and link through the same lookup.
- **Search:** in `controllers/user.js` and `controllers/conversation.js` candidates, a
  phone-like query (digits, spaces, `+()-.`, ≥ 3 digits) becomes one digits term
  matched against `phone` (with the `8→7` variant); in mixed queries a term with ≥ 2
  digits matches `phone` by its digits.
- **Server-composed texts:** `notifications.js` ×4 and `rules.js` `identityName` use
  `formatPhone`.
- **Channel login step** (`controllers/channel.js` :183-191) sends the gateway
  `+<digits>` from `parsePhoneInput`.
- **Unchanged:** `hideStaffContacts` (strips by key name), MCP `maskText`, outbound
  messaging (addressed by chat id).

### tg-service

`src/bot/phone.ts`: `formatPhone` (a copy of the rule, same test vectors), used in
`render.ts` :172. The bot stores no phones and receives canonical digits from
`getAllOpenedTg`.

### Frontend

- **`src/util/phone.ts`** (new, `node --test` like the other helpers):
  `parsePhoneInput`, `toCanonicalPhone`, `formatPhone`, `phoneHref`, `isValidPhone`,
  `phoneWireValue` (canonical → `+…`), `phoneMatches(query, phones)`.
- **`app/PhoneInput` rewritten** (the only phone input anywhere):
  - `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`, placeholder
    `+7 (___) ___-__-__`, `tabular-nums`.
  - No `+` typed → Russian: a leading `8` or `7` is the country/trunk digit, anything
    else is the national number (`9` → `+7 (9`). `+` followed by `7` → the Russian mask;
    `+` followed by anything else → international, `+<digits>` up to 15, no grouping.
    `00…`/`810…` switch to international.
  - Paste is parsed as a whole by `parsePhoneInput`: `8 914 555 01 42` →
    `+7 (914) 555-01-42`, `375 29 123 45 67` → `+375291234567` (12+ digits without a
    plus can only be international). Typed key by key without `+`, the same digits
    stay Russian and stop at 11 — foreign numbers are typed starting with `+`.
  - The caret stays after the same number of digits when the text is reformatted.
  - The initial value is formatted (today it is not); an invalid legacy value is shown
    as is.
  - It submits `+<digits>` (or `""`) through a hidden input named `name` for FormData
    forms, and through `onValueChange` for controlled ones (`setValue` is renamed).
  - Errors, on blur and on submit, through `Field`'s `error`: «Номер неполный: нужно 11
    цифр» (`+7`), «Номер слишком короткий» (other countries, < 8 digits), «Укажите номер
    с кодом города» (legacy values without it).
- **All 8 inputs** switch to `PhoneInput`: Company form, Profile, UserForm (+ NewUser
  prefill), SubdivisionFormDialog (add/update send the same shape), Supplier FormFields
  (+ inline create), Globals (support phone), TelegramChannelDialog (login step).
- **All display sites** listed in the inventory render `formatPhone`, links use
  `phoneHref`, and phone text is `tabular-nums`. Copy buttons copy **what is shown**.
  A number that cannot be dialled (invalid legacy value) is shown as text, without a
  link or a call button. Company phones are unique after normalization, so they stay
  React keys.
  - `tel:` is added to the supplier card and MySupport.
  - «Диалоги» stay copy-only (a P1b decision).
  - The ContactBlock dedupe compares canonical digits, so a user's phone that is also
    this chat's WhatsApp number is shown once.
- **Messenger helpers:** `counterpartHandle` and `channelHint` (and the inline copy in
  `TelegramChannelDialog`) show `formatPhone`.
- **Client-side list search** (companies, tickets, suppliers, employees) adds
  `phoneMatches`: `914 555`, `+7 (914)`, `8 914` all find `79145550142`.

### Migration `backend/scripts/normalizePhones.js`

- Registered as `{ id: "2026-09-30-normalizePhones", script: "normalizePhones.js",
  apply: true }` in `scripts/migrate.js`. Runs while the app is stopped (`deploy.sh`:
  backup → pending migrations → start).
- A pure `migratePhoneValue(raw)` (unit-tested) returns `{ value, status }` where the
  status is `unchanged | normalized | emptied | invalid | split`:
  - Everything stored today is raw, so the value goes through `parsePhoneInput`.
  - Two numbers in one string → the first one, flagged `split`.
  - Words (`телефон`) and a bare `+7` → `""`.
  - Values that stay invalid (no area code, incomplete) keep their digits, flagged
    `invalid`.
- Paths: every stored path in the inventory. `companies.phones` is also de-duplicated
  and loses empty elements. Array copies are written by position
  (`responsibles.3.phone`) with `bulkWrite`, 1 000 operations per batch, native driver.
- Dry run by default: counts per path and status, plus the `_id`s and shapes (never the
  numbers) of `invalid` and `split` values. `--apply` writes. A second run changes
  nothing for `+7` numbers. A repeated raw parse could only misread a foreign number
  of 10 digits or starting with `8`, and the audit found no foreign numbers at all. As
  a guard, the dry run lists every value whose result does not start with `7`: on the
  prod copy that list must be empty — if it is not, review it before `--apply`.
- After deploy: fix the listed `invalid` values by hand (on the prod copy: 2
  subdivisions without an area code, 2 incomplete user numbers, legacy ticket copies —
  the latter can stay).

### Docs

- `docs/ux-ui-guide.md`: a «Телефоны» rule (display format, `tel:`, copy what is shown,
  `tabular-nums`, input only through `app/PhoneInput`, search by digits); fix the
  `PhoneInput` row (:221). `docs/ux-ui-changelog.md`: entry.
- `docs/phone-numbers.md` (new, implementation notes): canonical form, the three
  functions and their three copies (backend, frontend, bot), wire format, setters,
  caller-ID rules.
- `docs/messaging.md` :42-53 (identity phone = canonical digits, equality, exactly
  one), `docs/ai-implementation.md` :589-598 (caller ID),
  `specs/2026-09-24-omnichannel-dialogs-design.md` :151 and the P1a plan's `phoneOf`:
  the gateway may send any format, the backend canonicalizes.

## Visible behaviour changes

- Every phone reads the same everywhere; foreign numbers show as `+<digits>`.
- Forms refuse incomplete numbers and numbers without an area code.
- Caller ID starts recognising landline callers. A number shared by several active
  users no longer picks an arbitrary one — the ticket goes to the default applicant.
- Messenger contacts with foreign numbers keep their phone.
- The users list and the «Это он» search find numbers by digits; fragments with
  brackets or dashes (`(914)`, `555-01`) match through their digits.
- Unknown contacts in «Диалоги» are titled `+7 (914) 207-33-18` instead of
  `+79142073318`. Stored author names in history stay as they were.

## Testing

- **Backend:**
  - New: `services/phone.test.js` (a table of raw → canonical → display cases shared with
    the other two copies), the lookup rules (exactly one; service, telephony and banned
    accounts ignored), `extractCallerPhones` (marker, subject, body, landline, INN-like
    decoy), `migratePhoneValue`.
  - A Mongoose round-trip test that the setter runs on `new`, `$set`,
    `findOneAndUpdate`, array elements and query filters (including a scalar filter on
    `companies.phones`).
  - Updated: `identity.test.js` uses the real parser, not its fake;
    `rules.test.js` :158 and `present.test.js` :84 expect the formatted title;
    `channelAlert.test.js` :57/:72 fixtures; `validations/company.test.js`.
- **Frontend:** `util/phone.test.js` (same table plus `phoneMatches` and the as-you-type
  parser with caret positions); `conversation-format.test.js` :196 and
  `channel-state.test.js` :103 expect formatted output. `pnpm typecheck` and build —
  green apart from the three known errors.
- **tg-service:** `phone.test.ts`, render case.
- **Migration:** dry run on the dev copy (numbers match the audit), `--apply`, second
  run reports zero changes.

## Rollout

One `./deploy.sh`: backend, frontend and tg-service images. The migration runs with the
app stopped, then the new code starts on canonical data. Afterwards: the manual-fix
list, and one look at a user card, the company card and a bot ticket card in both
themes (UI verification stays with the owner).

## Risks

- A write that bypasses Mongoose would skip the setter. None exist for phone paths
  today apart from migrations; new ones must call the parser.
- A 10-digit or `8…` foreign number typed without `+` is read as Russian. The field shows
  `+7 (…` immediately, before saving.
- Three copies of the format rule (backend, frontend, bot) can drift. Mitigated by the
  shared test table, the same way the work-status catalogue lives in three copies.

## Out of scope (flagged)

- Extensions («доб. 123») — not supported today, none stored.
- `controllers/company.js` update without `phones` in the body wipes them.
- The `/bot` open-tickets payload is mounted before `hideStaffContacts` and carries staff
  phones in `responsibles[]` snapshots — a separate security check.
- MySupport shows the client's own first company phone as «Общая линия поддержки» when no
  support phone is set.
- Dropping phone copies from snapshots, and removing the legacy `ticket.applicant` block
  — they are only normalized here.
- Grouping foreign numbers by country (libphonenumber) — shown as `+<digits>`.
