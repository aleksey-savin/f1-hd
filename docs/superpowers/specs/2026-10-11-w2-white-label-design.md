# W2 — De-F1lab and white-label: design

**Status:** draft for the owner's review, 2026-10-11.
**Source:** findings H1–H8 of `2026-09-30-productization-audit.md` §2.1, re-verified against the
current tree on 2026-10-11 (line references in the audit are stale; the facts below are current).
**Out of scope:** H9 (policy constants → W10), i18n (W12), CIS settings (W7), release bundle (W3).

## Goal

A fresh instance carries nothing of F1lab — no mailbox, error tracker, brand, staff e-mails or
ticket counter — and a customer can set their own name, look and e-mail signature. F1lab's own
instance keeps working exactly as today, as one configured brand among others.

## Decisions

### D1. Two names, not one

Today there are five unrelated literals («F1Lab Helpdesk», «HelpDesk», «HD», «F1 HD», `[F1-HD-N]`)
and one setting, `contacts.title`, which is the organisation's name.

- **Organisation name** stays `Preferences.contacts.title` («Название организации»).
- **Product name** is new: `Preferences.brand.productName`, default `HelpDesk`. It replaces every
  «F1Lab Helpdesk» / «F1 HD» / «HelpDesk» literal: page title, footer, wordmark fallback, navbar
  `aria-label`, auth e-mail subjects («…в портал {productName}»), TOTP issuer fallback.
- In running prose the abbreviation «HD» (about 80 strings, mostly Mikrotik and MCP) is replaced by
  neutral wording («система», "the helpdesk"), not by interpolation: fewer moving parts, and the
  sentences read naturally under any brand.
- Technical identifiers stay: RouterOS group/certificate names `hd-mgmt` / `hd-api` (renaming would
  break routers already configured), package names, the MCP server id.

### D2. Brand settings (`Preferences.brand`)

| Field | Default | Used in |
|---|---|---|
| `productName` | `HelpDesk` | see D1 |
| `mailSignature` | empty → «С уважением,<br>{contacts.title}»; if that is empty too, no signature | all 9 e-mail signatures (one shared helper replaces the 8 inline copies) |
| `accent` | `#00bc8c` | UI accent, approval e-mail template, PDF export kicker |
| `icon` | none → the product's neutral icon | favicon, apple-touch icon, web manifest |

- `contacts.logo` keeps its role (navbar and login wordmark).
- `brand` is public like `contacts`: it is returned by `/api/preferences-auth`,
  `/api/preferences-initial` and `/api/me` prefs, and written through the existing settings save.
  Validation: name ≤ 40 chars, signature ≤ 300 chars plain text, accent `#rrggbb`.
- **Accent → tokens.** One colour drives `--primary`, `--ring`, `--accent-text` and `--bubble-out` in
  both themes. `--accent-text` is derived for contrast (darkened on light, lightened on dark) by a
  small pure function with tests; `--success` and `--chart-1` stop sharing the brand hex and keep
  the teal. No colour is refused: text on the accent is white unless white falls below 2.2:1
  against it (today's teal is 2.45:1 and stays white), then it turns dark; a colour close to the
  error red gets a warning under the field.
- **Wordmark.** With no logo uploaded, the navbar and login show the icon followed by the product
  name in the text colour (today's two-tone «Help**Desk**» cannot be kept for an arbitrary name).
  An uploaded logo replaces both, as now.
- **Tab title** is «{page} · {productName}».
- **Icon and manifest.** `index.html` gets a neutral static title and links to
  `/api/brand/icon` and `/api/brand/manifest.webmanifest`, both public and cacheable, served by the
  backend from settings (fallback: the bundled neutral icon). `document.title` gets the product
  name at runtime through one helper; the four «F1 HD | …» titles lose the prefix.
- The unused `logo.png`, `apple-touch-icon-152x152.png`, `error-emoji_old.png` and the static
  `manifest.json` are deleted. The error-screen mascot of unknown licence is replaced by a neutral
  illustration (mockup).

### D3. Ticket subject prefix — set at install, not in settings

- `TICKET_SUBJECT_PREFIX` (env, default `HD`) — the prefix for new mail.
- `TICKET_SUBJECT_PREFIXES_ACCEPTED` (env, comma-separated, optional) — extra prefixes still
  recognised in replies, so a change does not orphan threads.
- Read once at start; `ticketSubjectTag` / `ticketNumFromSubject` stay synchronous. Allowed
  characters `[A-Za-z0-9-]`, 2–12 chars; an invalid value stops the start with a clear message.
- Why not a setting: it is parsed on every inbound mail, changing it mid-life breaks reply
  threading, and nobody needs to change it after install.
- F1lab's instance sets `TICKET_SUBJECT_PREFIX=F1-HD` (deploy note).

### D4. Mail mode instead of the NODE_ENV sink (H1)

- `MAIL_MODE` = `live` | `sandbox` | `off`. **Unset means `off`**: mail is not sent, each letter is
  logged once and marked as not sent with the reason. No built-in address anywhere.
- `sandbox` requires `MAIL_SANDBOX_RECIPIENT`; without it the backend refuses to start. Behaviour
  is today's redirect (recipient replaced, subject prefixed, intended address kept).
- `NODE_ENV` no longer matters for mail.
- The mail status rows in «Настройки» show «Отправка выключена на сервере (MAIL_MODE)» / «Песочница:
  вся почта уходит на …» so an operator sees the mode; the test button reports it honestly.
- **Deploy safety:** `deploy.sh` writes `MAIL_MODE=live` into `.env` on an existing production
  install that has none (one time, announced in its output). `.env.example` documents all three.
- The owner's dev machine sets `MAIL_MODE=sandbox` + its own address.
- tg-service's `chatGuard` (same idea for Telegram) gets the same treatment in the same task, so
  the two channels cannot drift.

### D5. Error tracking (H2)

- The hard-coded DSN and `sendDefaultPii` are removed.
- `SENTRY_DSN` (env, empty by default) is returned in the public config; the frontend initialises
  Sentry only when it is non-empty, with PII off.
- nginx's CSP `connect-src` gets the DSN's origin through the existing env templating; empty →
  unchanged `'self'`.

### D6. AI prompts (H4)

`callSummary` and `transcription` take the support organisation's name from `contacts.title`
through their context; with an empty title the naming sentence is omitted. The F1-specific
misrecognition examples go away; the duplicated word in the transcription prompt is fixed.

### D7. Role catalogue (H5)

- The shipped `roles.catalogue.json` becomes a curated product catalogue: no `members`, no
  `matches`, no `_note`. Roles: `client`, `client-admin`, `client-manager`, `admin`,
  `it-first-line`, `it-second-line`, `kb-moderator`, and the contractor role under a neutral key.
  `klient-ofis-menedzher` (an F1lab role with an auto-transliterated key) is not shipped.
- `dumpRoleCatalogue.js` stops writing members; F1lab's own dump lives outside the repo.
- Existing instances are not touched: the catalogue is read only at first launch. The plan must
  confirm that `syncRoleCatalogue` on F1lab's database neither deletes nor renames its extra roles.

### D8. Ticket counter (H6)

The fallback becomes 1. `TICKET_COUNTER_STARTING_NUMBER` stays as the install option. F1lab's
counter document already exists, so nothing changes there.

### D9. Repo and image hygiene (H7)

- Scrub real names, addresses, phones, hostnames and client names from tests, fixtures, comments
  and demo seeds (list in the plan; about 45 files, all mechanical), using `example.com`-style data.
- `sync-dev-db.sh`, internal deployment notes and one-off scripts with F1lab data are excluded from
  the image (`.dockerignore`) and marked internal; moving them out of the repo is W3.
- Repository URLs and author fields in `package.json` become neutral.

## UI (mockup first)

Visible changes, each shown in a mockup (both themes, desktop and mobile) and built only after
the owner's «ок»:

1. **«Настройки → Основные»:** a new sub-group «Бренд» under «Организация» — product name,
   e-mail signature, accent colour (swatches + hex, live preview, warnings), icon upload; «Лого
   компании» moves into the group. The stale placeholder «Служба техподдержки «F1»» goes.

Mockup: https://claude.ai/artifact/3JHa7RoTLDcR8FPUovYAhm
2. **Where the brand shows:** login screen, navbar wordmark fallback, footer, browser tab.
3. **Mail status rows** with the two new server-mode states (D4).
4. **Error screen** with the neutral illustration instead of the mascot.
5. **An auth e-mail and a ticket notification** with the configurable name and signature.

## Compatibility for F1lab's instance

Set once at deploy: `MAIL_MODE=live` (written by `deploy.sh`), `TICKET_SUBJECT_PREFIX=F1-HD`,
`SENTRY_DSN` if wanted. A migration fills `brand.productName` = «F1Lab Helpdesk» and
`brand.mailSignature` = «С уважением,<br>Команда F1Lab» where `brand` is absent **and** the
instance already has users — so its mail and titles read exactly as today; fresh installs get the
product defaults.

## Testing

Unit tests for: mail mode (three modes, missing recipient, no NODE_ENV dependence); prefix parsing
with accepted old prefixes and invalid values; the signature helper; accent → token derivation and
contrast refusal; prompts with and without a name; the catalogue (no personal data: a test fails on
any `@` in the file); brand endpoints (icon, manifest, public config). A repository test fails on
the strings «F1Lab», «F1-HD», «f1lab.ru» outside an allow-list of internal files.

## Open points for the owner

1. Product default name «HelpDesk» — fine, or another name?
2. D4: is "unset means mail off" acceptable, given `deploy.sh` sets `live` on your production?
3. D7: which F1lab roles besides `klient-ofis-menedzher` are yours only?
4. The neutral contractor role's title: keep «Сторонний исполнитель: без указания работ»?
