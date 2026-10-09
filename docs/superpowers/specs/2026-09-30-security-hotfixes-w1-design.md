# W1 security hot-fixes: design

Status: design approved by the owner on 2026-09-30 (answers under Decisions); spec awaiting
review.
Source: `docs/superpowers/specs/2026-09-30-productization-audit.md` (IDs S*, O*, C* refer to it).
Base: `main` at `b3b20cf`.

## Goal

Close the holes that are exploitable in today's install, together with the cheap latent
escalation paths, before any other productization work. Users see only three changes:

1. An e-mail reply that doesn't come from someone on the ticket, or fails the sender check,
   becomes a new ticket.
2. People can no longer change their own e-mail in "Мой аккаунт".
3. A company API key acts only within its own company.

## Decisions (owner, 2026-09-30)

| # | Question | Decision |
|---|---|---|
| D1 | Replies from outsiders, or replies that fail the sender check | Handled by normal intake as a **new ticket** that references #N |
| D2 | Self-service e-mail change | **Locked.** Mockup variant A: read-only field, hint «Email меняет администратор» (https://claude.ai/artifact/21qn8anCtoAViL6MQPo8bv) |
| D3 | Company API keys | **Scoped strictly** to the key's company; body `responsibles`/`deadline` are ignored |
| D4 | Magic-link sign-in | **Stays for client accounts** without 2FA; closed for staff and for 2FA users |
| D5 | Request size | Default JSON/urlencoded **10 MB**; the three editor routes keep 50 MB; anonymous endpoints get a small limit; multer `fieldSize` **10 MB** |
| D6 | `MIKROTIK_ENC_KEY` carry-over in deploy.sh | **Not needed**: every install already uses `APP_ENC_KEY`. deploy.sh is not changed in W1 |
| D7 | Where the work happens | A **separate git worktree** based on `b3b20cf`. Nothing is committed; the result is brought into main's working tree at the end |

## Scope

- **Security items in scope:** S1, S2, S3, S4, S5, S6, S7, S8, S10, S11, S12, S14.
- **Parts of larger items:**
  - S15: multer, mailparser/nodemailer, and backend spreadsheet parsing;
  - O6: an undecryptable secret returns 422 instead of 500;
  - O7: jobs.
- **Small related defects found while designing:**
  - sender spoofing through the display name;
  - mail silently dropped when its ticket number doesn't exist;
  - List-* auto-reply detection that never fires;
  - a cubic markdown regex;
  - the tri-state `isEndUser`;
  - self-widening of KB `categories`;
  - the missing Message-ID dedup.

**Out of scope (later workstreams):**
- S9: dropping `bearer()` and the localStorage token; hashing reset and approval tokens.
- S13: the SSRF guard.
- S16: Origin/CSRF protection.
- S17: authorizing `/uploads`.
- S18/S19, apart from the bits above.
- S20–S30.
- The bootstrap password in logs (W4, because deploy.sh reads it).
- The legacy plaintext API key fallback (it needs `eraseApiKeyValues` on production first).
- C2, which stays with the phone work.

## Design

### 1. better-auth HTTP surface (S4, S7a, S8)

**Allow-list.** Add an Express middleware in `backend/app.js` in front of the better-auth handler
(`app.all("/api/auth/*", …)`). Only these requests pass:

| Method | Path | Used by |
|---|---|---|
| POST | `/api/auth/two-factor/enable` | `User/TwoFactorSetup.jsx` |
| POST | `/api/auth/two-factor/verify-totp` | `User/TwoFactorSetup.jsx` |
| POST | `/api/auth/two-factor/disable` | `User/TwoFactorRow.jsx` |
| POST | `/api/auth/reset-password` | `pages/Auth/NewPassword.tsx` |
| POST | `/api/auth/sign-in/magic-link` | client magic-link sign-in (D4) |
| GET | `/api/auth/magic-link/verify` | links in invitation e-mails |

- **Everything else returns 404** with the app's usual JSON error shape. That includes
  `/admin/*`, `/organization/*`, `/sign-in/email`, `/sign-up/*` and `/email-otp/*`.
- **Body size:** better-auth reads these bodies itself, outside the Express parsers. An
  allowed request whose `Content-Length` is over 100 KB gets 413.
- **Server-side calls are unaffected.** `auth.api.*` calls (login wrappers, invitations,
  impersonation, e-mail codes) don't go through the router. `disabledPaths` is not used: it
  matches exact paths only.

**Magic link, sending.** `sendMagicLink` in `backend/auth/hooks.js` sends a link only when all
of these hold: the account exists, `isEndUser === true`, it isn't banned, its company is
active, and `twoFactorEnabled` is false. Otherwise it sends nothing and returns the same
response, so there's no enumeration.

**Magic link, opening.** `databaseHooks.session.create.before(session, ctx)` in
`backend/auth/instance.mjs` refuses the session when `ctx?.path === "/magic-link/verify"` and
the user is staff (`isEndUser === false`) or has `twoFactorEnabled`. better-auth 1.6.26 passes
the endpoint context with `path` to this hook. The existing `sessionRefusal` rules stay.

**Plugin role.** `backend/services/roles.js` computes the better-auth plugin role from
audience-stripped statements (`stripStatementsForAudience`, `auth/access.js`), both in `assign`
and in `refreshMirrorForUsers`. A client account can then never become `impersonator`.
- A migration entry appended to `MIGRATIONS` in `scripts/migrate.js` recomputes the mirror for
  every user. It is idempotent.

### 2. Account management (S6, S7b, related)

**`exports.update`** (`backend/controllers/user.js`, route `PUT /users/:id`, `canManageUsers`):
- It starts with `mayTouchAccount(req, target)`, the same check `toggleActive`,
  `changePassword` and the other account handlers use. The `sessions` handler gets it too.
- **E-mail change** (a body value that differs from the stored one):
  - requires `user.manageAccess`, otherwise 403;
  - on change, all of the target's sessions are revoked (`services/authSessions`);
  - a notice goes to the old address, as a `Notification` e-mail (gender-neutral, short):
    «Email вашей учётной записи изменён на {new}. Если это сделали не вы — обратитесь к
    администратору.»
- **Ban flag:** `banned` changes only when the body carries a value that differs from the stored
  one. Such a change requires the same rights as the ban endpoint. An omitted or unchanged
  value leaves the flag alone, so the silent un-ban goes away.
- **`isEndUser`** must be a boolean, otherwise 400.

**`exports.updateMyAccount`** (`POST /users/update-account`) ignores `email` and `categories` in
the body. Categories stay admin-managed, which closes KB self-widening.

**Frontend** (`components/User/AccountSettings/Profile.jsx`), per mockup variant A:
- **The field:** `<Input readOnly>` with the muted fill and no border, in both themes (dark must
  override `dark:bg-input/30`). No `required` asterisk, and the hint «Email меняет
  администратор» via the `Field` `hint` prop.
- **The draft:** `email` leaves the draft payload and the `blockedReason` check, so the
  DraftBar never lights up for it.

### 3. Data exposure (S1, S2, S10)

**`controllers/inventory/clientDevice.js`:**
- **`getAttachable`:** for end users, `companyId` must equal their own company, otherwise it
  returns `[]`. Staff are unchanged.
- **`getTickets`:** the device is checked with the same company scope as `getOne`, otherwise
  404. The ticket query is ANDed with `ticketListFilter`, which also covers staff on the "own"
  tier.

**`controllers/inventory/location.js` `getUserTech`:** both device queries (own devices, parent
location) are ANDed with `deviceScopeMatch(scope)`.

**`controllers/finances/approval.js`:** `create`, `resubmit`, `stageAction` and `decision` respond
with `{ ok: true, id }`. The frontend already re-fetches after each action and reads only
`message` on error.

**`controllers/ticket.js` ticket card:** the company DTO carries only what `pages/Ticket/View.jsx`
and its sections read:
- `_id`, `alias`, `workSchedule`;
- `addresses`, `address`, `linkToMap`, `location`;
- `employees` (`_id`, `firstName`, `lastName`), only for viewers with `company.readLogs`.

### 4. Company API keys (S5)

**`controllers/external/ticket.js`:**
- **Applicant lookup:** `userId` and `userEmail` are coerced to strings. The applicant is looked
  up only inside the key's company:
  - `{ _id, "company._id": req.company._id }`, or
  - `{ email: lower(userEmail), "company._id": req.company._id, banned: {$ne:true} }`.

  When nothing is found, the existing fallback applies (the key's company plus the default
  applicant).
- **Ignored and validated fields:** body `responsibles` and `deadline` are ignored. `categoryId`
  is used only when it is a valid ObjectId of an existing category.
- **Response:** no applicant e-mail.
- **Error log:** no longer logs `req.body`.

**`controllers/log/companyLog.js`:** the user is looked up (by GUID, then by e-mail) only inside
`req.company`. The response returns no data about users from other companies.

**Operator-key guard:** a new middleware `rejectOperatorKeys` answers 400 when a JSON body
contains, at any depth, a key that starts with `$` or contains `.`. It is mounted on:
- `/api/external`
- `/api/login*`
- `/api/login-code*`
- `/api/password*`
- `/api/impersonate/claim`

Global mounting waits for W5, after a sweep of the other routes.

### 5. Inbound e-mail (S3 and related)

**Parsing** (`middleware/emailHandling.js`, the object built after `simpleParser`) additionally
carries:
- `fromAddress = mail.from.value[0].address`, lower-cased;
- `messageId`;
- `authResults`, the **first** `Authentication-Results` header, i.e. the one added by our
  receiving server.

**Sender resolution:** the user and the company domain come from `fromAddress` only, never from
`from.text` with its display name. The domain match against `Company.emailDomains` becomes
case-insensitive.

**Subject tag:** `ticketNumFromSubject` (`services/emailReplyStripper.js`) accepts only
`[F1-HD-<digits>]`.
- The prefix lives in one exported constant.
- The 14 producers in `middleware/notifications.js` use that same constant.
- W2 turns it into a setting.

**Reply decision:** a pure function `routeReply({ ticket, sender, authVerdict })` returns
`comment` or `newTicket`. It returns `comment` only when all of these hold:
- the ticket exists;
- the sender resolves to a user who is:
  - the applicant (`ticket.applicantId`);
  - a responsible (`ticket.responsibles[]._id`);
  - a member of the ticket's company (`user.company._id` equals `ticket.company._id`); or
  - staff (`isEndUser === false`);
- `authVerdict !== "fail"`.

**Sender check:** `authVerdict` is parsed from `authResults`.

| Result | When |
|---|---|
| `fail` | `dmarc=fail`, or `spf=fail` with no `dkim=pass` |
| `pass` | `dmarc=pass`, or `dkim=pass` |
| `none` | the header is missing or unparseable (the participant check alone decides) |

**New-ticket route:** the mail goes down the normal new-ticket branch.
- The description starts with one line naming the reason and #N: «Письмо пришло ответом на
  заявку №N, но отправитель в ней не участвует» or «… не прошло проверку отправителя».
- Nothing is written to #N, and nothing is mailed to #N's participants.
- A missing ticket takes the same route; today that mail is silently dropped.

**Robot mail** (`fromMachine`) that would be rerouted doesn't create a ticket. It leaves only
a content-free TicketLog entry on #N, the same way closed-ticket auto-replies are handled
today:
- «автоответ от {address} не принят: отправитель не участвует в заявке», or «… не прошёл
  проверку отправителя».
- When #N doesn't exist, the mail is only logged.

**Sender check on new tickets:** when `authVerdict === "fail"`, the new-ticket path (normal
intake and rerouted replies) doesn't identify the applicant from the From address; the
default applicant is used instead. A forged mail therefore can't open a ticket in a client's
name and have notifications mailed to that client.

**`realSender`** is stored from `mail.from.value[0]` (`Name <address>`, or the bare address),
so the UI shows the real address and never an address hidden in the display name.

**UX guide:** `docs/ux-ui-guide.md` describes the new reply behaviour as the target, and
`docs/ux-ui-changelog.md` gets a one-line entry.

**Dedup:**
- `Ticket` and `Comment` get an optional `emailMessageId` field with a sparse index.
- Before creating either, the handler checks it. A duplicate is only marked `\Seen`.

**Auto-reply detection:** `services/machineMail.js` reads List-* headers the way mailparser
exposes them, folded under the `list` key. Behaviour for open tickets doesn't change.

### 6. Availability (S12, S15 part, D5)

**Text helpers:** `helpers/htmlToPlainText.js` (both functions),
`helpers/markdownToPlainText.js` and `tg-service/src/bot/text.ts` become linear-time.
- Tag stripping via `/<[^<>]*>/g` plus an `indexOf` loop for `<style>`/`<script>` blocks.
- The markdown table-separator check becomes a per-line scan without nested quantifiers.
- Input is truncated to 256 KB before processing. These helpers feed titles, previews,
  notifications and AI context, none of which need more.
- Acceptance: 1 MB of crafted input (`<`×N, `<style`×N, spaces plus `x`) completes in under
  100 ms.

**Dependencies** (backend):
- `multer` 1.4.5-lts.2 → 2.x;
- `mailparser` → ≥ 3.9.3 (brings a fixed nodemailer and linkify-it);
- `nodemailer` → 10.x (owner decision 2026-10-01: 7.x keeps 13 advisories, 3 high; the 8–10 breaking changes don't touch our code);
- `xlsx` → `exceljs`, which reads `.xlsx` only, the one spreadsheet format
  `services/attachmentExtractor.js` handles. Output stays as `# Sheet` headers plus CSV-like
  rows. A document larger than 10 MB is skipped.

The frontend `xlsx` is export-only and stays until W5. `pnpm install` runs outside the sandbox.

**Body limits** (`backend/app.js`; body-parser skips a body that is already parsed, so
path-specific parsers are mounted before the global one):

| Where | Limit |
|---|---|
| Anonymous: `/api/login*`, `/api/login-code*`, `/api/password*`, `/api/impersonate/claim`, `/api/external/approval` | 100 KB |
| Editor routes whose content embeds images: KB notes, ticket templates, routine tasks | 50 MB, as today |
| Everything else | **10 MB** |
| multer `fieldSize` (ticket and comment text are multipart) | 2 MB → **10 MB** |

### 7. Background jobs (O7)

- **`guardedCron`** (`app.js`): the watchdog logs an error but keeps `inFlight` until `run()`
  actually settles. The IMAP poller's own lock (`app.js` ~221-255) gets the same treatment.
  Runs never overlap.
- **Mail outbox** (`services/mail/outbox.js`): each notification is claimed with
  `findOneAndUpdate` on the existing `leaseUntil`/`leaseId` fields, the same pattern as the
  Telegram queue in `controllers/bot.js`. It is then sent, and acknowledged by `{_id, leaseId}`.
  A crashed or overlapping run never sends the same notification twice.
- **Shutdown:**
  - SIGTERM stops every cron task (references kept at registration);
  - it waits up to 50 s for in-flight runs;
  - then it closes the server and Mongo;
  - `compose.yml` backend gets `stop_grace_period: 60s`.
- **Process-level handlers:**
  - `unhandledRejection` is logged, and the process keeps running;
  - `uncaughtException` is logged, then the process exits with 1 and Docker restarts it.

### 8. Logs, secrets, keys (S11, S14, O6 part)

**Logs:**
- Remove the `req.body` dump in user creation (`controllers/user.js` `add`) and in the external
  ticket error log.
- `middleware/errorHandling.js` logs an allow-list of error fields (`name`, `message`, `code`,
  `statusCode`, `stack`) instead of every enumerable property.
- Logged URLs (`errorHandling.js`, `utils/logger.js`, `middleware/performance.js`) lose their
  query string, and token-shaped segments of `/api/external/approval/:token` are masked.

**Router details (S14):** the host, user and knock sequence in
`backend/scripts/mikrotikUpgradeProbe.js:6` and in
`docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md:324,396` become placeholders.
`backend/.dockerignore` excludes that probe script. Rotating the knock sequence, and what to do
with git history, stay with the owner.

**Undecryptable secrets (O6 part):**
- `helpers/preferencesSecrets.js` `readStoredSecret` throws a typed `SecretUnreadableError(path)`
  when decryption fails.
- The settings invariants in `controllers/preferences.js` (`findAiInvariant` →
  `resolveSpeechConfig`, and the mail invariant) treat such a secret as not set.
- `POST /api/preferences` answers **422** naming the setting: «Сохранённое значение «{название}»
  не читается — введите его заново». This replaces the 500 lockout.
- Other runtime users of the secret (sending mail, AI calls) keep failing and logging as now.

## Tests

- **Backend.** `node:test` tests are written before the code for each unit:
  - the allow-list;
  - the magic-link send and verify rules;
  - plugin role audience;
  - the `update`/`updateMyAccount` rules;
  - device and location scoping;
  - the approval and ticket-card DTOs;
  - external API scoping and `rejectOperatorKeys`;
  - `routeReply`, the auth-results parser, subject parsing and Message-ID dedup;
  - linear-time helpers (with timing bounds);
  - the outbox claim and ack;
  - `guardedCron` lock behaviour (fake timers);
  - `SecretUnreadableError` → 422.

  Controllers are exercised with stubbed req/res, following the existing test style.
- **tg-service.** A test for `text.ts`.
- **Frontend.** `pnpm build` passes, and typecheck shows no new errors beyond the known 3. The
  owner checks the Profile screen by hand. No end-to-end runs.

## Rollout notes

**Behaviour changes worth announcing:**
- E-mail replies from outsiders become new tickets.
- Own e-mail is read-only.
- API keys act only within their company, and integrations can no longer set responsibles or
  deadline.
- Magic-link sign-in works for clients only.
- Approval actions return `{ok, id}`.

**Deploy:**
- the lockfile changes, so the images rebuild;
- one data migration (the plugin role mirror);
- `compose.yml` gains `stop_grace_period`.

## Amendments during implementation (2026-10-01 … 2026-10-02)

Execution: subagent-driven, in the worktree `.claude/worktrees/w1-security` (base `b3b20cf`), no commits. Every task
had a task review; most had fix rounds; a final whole-branch review closed the branch. The full record — every ruling
with its reason and cost — is the SDD ledger `.superpowers/sdd/2026-09-30-security-hotfixes-w1/progress.md` (git-ignored).

### Spec-level changes (behaviour differs from the text above)

- **Auth allow-list:** `POST /api/auth/sign-in/magic-link` is NOT exposed (the table above listed it). It let anyone make
  the helpdesk mail any known client and burn the SMTP quota; nothing in the app calls it. Magic links are issued only by
  server code (invitations); the GET verify link stays.
- **Reply routing (C2; owner decision 2026-10-03):** ANY sender is a participant only when the ticket is visible to it
  in the UI (`canAccessTicket(ticket, buildAuthContext(sender))`, computed in the mail handler) — staff and clients
  alike; a plain client no longer replies into a colleague's ticket (the spec allowed any member of the ticket's
  company). Banned, deactivated-company and service accounts are never participants (`services/accountDenial.js`, shared
  with `authBan`/`authContext`). The robot log line carries only a plain ASCII address ≤ 254 characters and an explicit
  event kind `delivery`.
- **Phone identification (owner decision 2026-10-03):** phone numbers from the mail text identify the applicant and
  the company only for mail from a cloud-telephony account (`isCloudTelephonySender(fromAddress)`) whose sender check
  did not fail; in ordinary mail a number identifies nobody. Approval links leaked before W1 are left as they are.
- **Sender address (C3):** the sender is the single mailbox written in clear text in the single `From` header line
  (≤ 4096 characters); encoded-word, quoted, multi-mailbox and duplicate-`From` shapes give an unknown sender (default
  applicant; the raw `From` is logged, bounded). The display line is empty when a reader of the stored string would see
  another domain. `Message-ID: <>` is no id. Length bounds on name/address/domain/Message-ID.
- **Robots (C4):** mail with `List-Id` / `List-Unsubscribe` is a robot even if a person wrote it through a group.
- **Message-ID (C5):** `emailMessageId` is `select: false`.
- **Body limits / operator guard (B5/B6):** a source-order test pins the mount order in `app.js`.
- **External API (B4):** unchanged from the spec; the integrations must be told (see the hand-over).
- **Text helpers (D1):** beyond the spec, every super-linear regex found on untrusted text in the backend was made linear
  (AI guide/terms/category preprocessing, MCP text/masking/knowledge tools, the KB service-expiry scanner); markdown list
  indentation is `[ \t]*`; MCP ticket text is capped at 256 KB; KB search and the secrets scan see the first 256 KB of a
  note's plain text.
- **Attachments (D2):** exceljs replaced xlsx as planned, but hostile workbooks/documents still crashed or froze the
  backend inside exceljs/mammoth, so parsing runs in a child process (`services/documentTextChild.js`): 256 MB heap flag,
  15 s, SIGKILL, max 2 concurrent, `ulimit -c 0 -t 60`, `oom_score_adj 1000`, killed with the parent; in-process fast
  paths: a 16 MiB declared-inflation cap, ≤ 2000 zip entries, `ignoreNodes` (dataValidations, mergeCells, cols), a
  bounded row/cell walk; ≤ 10 documents per AI guide.
- **Cron registry (D3):** jobs also wait for better-auth (`isAuthReady`); a bad timezone falls back to the default for
  the nightly jobs; a second signal during the drain is ignored; the startup `.catch` handles non-`Error` rejections.
- **Outbox (D4):** lease 5 minutes; ack retried (3 attempts); delivery is at-least-once; `dnsTimeout` 2 s.
- **Logs (D5):** body-parser parse errors are logged with a fixed message and no stack (V8 puts a window of the raw body,
  passwords included, into both); `redactUrl` is case-insensitive and covers `app.js` and `requireMcpKey`.
- **Secrets (D6):** the mail runtime (IMAP, SMTP, `sendNow`, outbox) handles `SecretUnreadableError` too: one clear
  health status, no socket, outbox letters marked failed at once (not re-sent after re-entry); the mail check buttons
  show the reason; a missing `APP_ENC_KEY` is a server error, not «введите заново».
- **Added tasks:** A7 (no staff permission may lose its last active holder — owner requirement 2026-10-01) and B3b (two
  more raw-Company responses leaking API key hashes).
- **Deploy:** TWO data migrations, not one — `2026-10-01-grantUpgradeFirmware`, then `2026-09-30-recomputePluginRoles`,
  placed right after `normalizePhones` and before `2026-10-01-snapshotReports`.
- **Merge into main (2026-10-03):** main had moved to `f7b29fc`; three files were merged by hand (`migrate.js`, the UX
  changelog, the approval controller's imports). The new approval `rollback` handler returned the whole report with the
  approvers' tokens — it now answers `{ ok, id }` like the other pipeline actions (`{ dissolved: true }` unchanged), with
  access tests for `remind` and `rollback`.

### Pre-flight rulings (plan text)

F1–F11 (Task Z's grep targets, the D3 `AppError` import, `git status --untracked-files=all`, C2's 4-case route test,
D1's 500 ms bound, the documented deviations in A2/A3/A5/B3/C6, the stale "unbounded /api/auth bodies" note, the inline
403 approved, local helper duplication accepted) — see the ledger.

### Parked for W5

Dependency overrides for exceljs's transitive advisories; a streaming or worker extractor with a real memory cap; the
`app.js` wiring tests (readiness, shutdown); per-sender dedup; attachments saved before dedup; stuck-cron health; log
hygiene (whole `Error` objects, `AppError.metadata`, e-mail PII); `secretsScanner` recursion at 6 MB; the frontend
sender display regex; multer `fields`/`parts` caps; Cyrillic upload names.
