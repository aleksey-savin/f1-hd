# Phone numbers

Every phone number is stored as **canonical digits**: the country code included, no
`+`, brackets, dashes or spaces (`79145550142`, `375291234567`); `""` means no phone.
Valid = `7` + 10 digits, or 8–15 digits starting with `1-6`, `8` or `9`. What people
see is formatted on the way out: `+7 (914) 555-01-42`, other countries
`+375291234567`, an invalid legacy value as stored.

## One rule, three copies

| Copy | Used for |
| --- | --- |
| `backend/services/phone.js` | `parsePhoneInput` (raw → canonical), `toCanonicalPhone` (Mongoose setter), `isValidPhone`, `formatPhone` (texts the server composes: client e-mails, «Диалоги» titles), `phoneSearchDigits`, `phoneDigitsPattern` (the «Диалоги» list search) |
| `frontend/src/util/phone.ts` | the same rule plus display (`formatPhone`, `phoneHref`), the input field logic and list search (`phoneMatches`) |
| `tg-service/src/bot/phone.ts` | `formatPhone` for the ticket card |

The three test files share one table of raw → canonical → display cases; a change
to the rule changes all three.

## Raw input vs stored digits

`parsePhoneInput` reads raw input: without `+` a number is Russian — a leading `8`
is the trunk prefix only in exactly 11 digits, exactly 10 digits get `7`; `+` and
`00` always mean the country code is already there, `810` only in a number longer
than 11 digits.
`toCanonicalPhone` treats a digits-only value as already canonical and never
reinterprets it — otherwise a German `4930901820` copied into a snapshot would
become `74930901820`. Hence:

- every schema path holding a phone has `set: toCanonicalPhone`; Mongoose 9 applies
  setters to writes **and** to query filter values (RegExp filters bypass them);
- API input always goes through the raw parser (`validations/phone.js`:
  `phoneBody`, `phoneListBody`, 400 on an invalid number); the web client sends
  E.164 with the plus (`+79145550142`), so the parse is unambiguous, and whatever an
  old tab sends is cleaned up too;
- messenger phones arrive from the gateway in international form and are stored with
  `toCanonicalPhone`.

## Lookups

Equality on the canonical number. An unparseable filter value casts to `""` and
would match every record without a phone, so every lookup checks `isValidPhone`
first. `services/callerIdentityService.js`:
`findUsersByPhone` (skips service and telephony accounts, banned users and users of a
deactivated company — users without a company still match; at most two),
`findApplicantByPhone` and `findCompanyByPhone` match only when the number leads to
exactly one record, and `findCompanyByPhone` skips deactivated companies.
`extractCallerPhones` reads the caller from an e-mail. HTML entities for a
non-breaking space (`&nbsp;`, `&#160;`, `&#xa0;`) are decoded to spaces before the
label search; no other entity is. When the «Кто звонил:» label is
present, the number that follows it (a line break may sit between them) is the only
candidate, and a withheld caller ID gives none — a telephony mail also carries
«Номер линии» (our own line) and the call time, which must never be matched. Without
the label: the subject, then the body (plausible Russian `7[3489]…` or dialled with
`+`); in that search candidates never span a line break, and `emailHandling` tries
them in turn. Our own support line (`Preferences.contacts.tel`, passed as
`ownPhones`) is never a caller candidate: it drops out of the subject and body
search, and at the label it means there is no caller. Messenger identities link
through the same `findUsersByPhone`.

People search (`services/personSearch.js`) matches the phone by the digits of the
query; a query that looks like a whole number is one phone term. The «Диалоги» list
search (`controllers/conversation.js`) also matches such a query by its digits
across separators (`phoneDigitsPattern`) in conversation titles and last-message
author names, which hold both `+7 (914) 207-33-18` and older `+79142073318`.

## Migration

`scripts/normalizePhones.js` (`2026-09-30-normalizePhones` in `scripts/migrate.js`)
rewrites every stored path, snapshots included, through
`services/phoneMigration.js`: raw values parsed, `+7`/words emptied, two numbers in
one string (split on `,` or `;`) reduced to the first (listed as `split`), the old
mask's `+8 (…)` read as `+7` (listed as `plus8`), invalid values kept as digits and
listed for a manual fix. Snapshot arrays are read whole and every write is a
compare-and-set on the values that were read: a document changed in between is not
written, the run reports it and exits 1, so `migrate.js` does not record the entry.
Numbers of other countries are written as given and listed as `foreign` for review.
For the known forms a second full run changes nothing (ten digits starting with 7
are taken as an incomplete `+7` number, not re-prefixed). A foreign number the run
has written is not one of them: any second `--apply` run, after a failure or not,
re-reads one of 10 digits, or of 11 digits with a leading 8, as Russian
(`4930901820` → `74930901820`), and a dry-run shows it only in the `normalized`
count, no longer as `foreign`. What keeps the entry from running twice is the
`migrate.js` ledger: the entry is recorded only after exit 0, and a recorded entry
never runs again (a manual `--apply` bypasses it). Before re-running a failed run,
check the `foreign` list the failed run printed. Numbers and names never appear in
its output — only ids, paths and shapes.
