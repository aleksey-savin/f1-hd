# W2 — De-F1lab and White-Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh instance carries nothing of F1lab, and a customer sets their own portal name, icon, accent colour and e-mail signature; F1lab's instance keeps today's look as configured data.

**Architecture:** Install-level facts (mail mode, subject prefix, Sentry DSN, ticket counter) come from env and are read once at start through small pure modules. Brand facts live in `Preferences.brand`, are resolved by one backend helper (`services/brand.js`) and reach the frontend through the three existing prefs endpoints; the frontend applies the accent as CSS variables on `<html>`.

**Tech Stack:** Node 22/24, Express 5, Mongoose; React + Vite + Tailwind v4; tg-service (grammY, TypeScript); `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-11-w2-white-label-design.md` (approved 2026-10-11).
**Mockup (approved):** https://claude.ai/artifact/3JHa7RoTLDcR8FPUovYAhm — source `w2-brand-mockup.html`, copied into the SDD workspace. Visible UI must repeat it, not paraphrase it.

## Global Constraints

- **No `git commit`, `git push`, `git add`, `git stash`.** The owner commits. Skip every "commit" step.
- pnpm only. Do not install or upgrade packages.
- Tests: `node:test`. Run **only the test files of touched code** (`cd backend && node --test path/to/file.test.js`); never the full backend suite. Frontend helpers: `node --test` with `.js` in imports. Run child processes under `ulimit -c 0`.
- Backend lint is broken: use `node --check <file>`. Frontend: `pnpm -C frontend build` must pass; typecheck has one known error (`FormWrapper.tsx`) and must gain none.
- Code comments and UI copy in Russian, gender-neutral, concise. «№» only for tickets. Words: «Новый X», «шаблон».
- UI primitives come from `frontend/src/components/app` (SettingRow, SubLabel, HealthRow, Input, Button…); no hand-rolled equivalents. No `text-[Npx]`.
- No new string «F1Lab», «F1-HD», «f1lab.ru» anywhere except the allow-list of Task 10.
- Do not reproduce real addresses, hosts, DSNs or names in reports; say "the hard-coded DSN".
- Defaults, verbatim from the spec: product name `HelpDesk`; accent `#00bc8c`; subject prefix `HD`; `MAIL_MODE` unset = `off`; ticket counter fallback `1`; name ≤ 40 chars; signature ≤ 300 chars plain text; accent `#rrggbb`; text on accent is white unless white contrast < 2.2:1, then `#1d2227`; accent-text reaches 4.5:1 on `#ffffff` (light) and `#1d2024` (dark).

## Review Focus

1. **A production install updated without `MAIL_MODE`** — mail must not silently stop: `deploy.sh` writes `MAIL_MODE=live` when `.env` has `NODE_ENV=production`-style existing install and no `MAIL_MODE`; test in Task 1 covers the mode parser, the deploy step is checked by reading.
2. **A reply carrying the old prefix after the prefix changed** (`[F1-HD-51713]` on an instance now using `HD`) must still address ticket 51713 when the old prefix is in `TICKET_SUBJECT_PREFIXES_ACCEPTED` — Task 2 test.
3. **Empty brand on an old document** (`preferences.brand` undefined) must render defaults everywhere, not `undefined` — Task 3 test of `resolveBrand(null)` and `resolveBrand({})`.
4. **Hostile brand input**: product name or signature with `<script>` / HTML must come out escaped in e-mail HTML and manifest JSON — Task 3/4 tests.
5. **Accent extremes** (`#ffffff`, `#000000`, `#ffff00`) must yield readable tokens in both themes, never an endless loop — Task 3 test.

---

## File map

| File | Role |
|---|---|
| `backend/utils/mailGuard.js` | mail mode (`live`/`sandbox`/`off`), recipient and subject guard |
| `backend/services/emailReplyStripper.js` | subject prefix from env, accepted old prefixes |
| `backend/services/brand.js` (new) | `resolveBrand`, `validateBrandInput`, `mailSignatureHtml` |
| `backend/services/brandColor.js` (new) | contrast maths, `accentTokens` |
| `backend/controllers/brand.js` + route (new) | public `/api/brand/icon`, `/api/brand/manifest.webmanifest` |
| `backend/scripts/seedBrand.js` (new) | migration for existing instances |
| `frontend/src/util/brand-color.js` (new) | same maths as backend (kept in sync by shared test vectors) |
| `frontend/src/util/brand.js` (new) | `applyAccent`, `pageTitle` |
| `frontend/src/components/app/BrandMark.tsx`, `BrandGlyph.tsx` (new) | wordmark and default icon |

---

### Task 1: Mail mode instead of the NODE_ENV sink (H1, D4)

**Files:**
- Modify: `backend/utils/mailGuard.js`, `backend/models/notification.js` (guardDocument), `backend/services/mail/send.js` (~L65-95), `backend/services/mail/check.js` (`sendTestEmail`), `backend/services/mail/outbox.js` (failure for `off`), `backend/controllers/preferences.js` (expose `mailMode` in the settings GET that feeds `prefs.notify`), tg-service guard (find with `grep -rn "production" tg-service/src/config.ts tg-service/src`), `deploy.sh` (`ensure_env`), `.env.example`, `compose.yml`/`compose.dev.yml` only if they whitelist env (they use `env_file`, so likely nothing).
- Create: `backend/utils/mailGuard.test.js`

**Interfaces — Produces:**
```js
// backend/utils/mailGuard.js
/** @returns {"live"|"sandbox"|"off"} — читает env при каждом вызове (тестируемо) */
mailMode()
/** Бросает Error с понятным текстом: неизвестное значение MAIL_MODE или sandbox без MAIL_SANDBOX_RECIPIENT */
assertMailConfig()
/** live → email; sandbox → MAIL_SANDBOX_RECIPIENT; off → null */
guardRecipient(email, context = {})
/** live/off → subject; sandbox → `[SANDBOX → ${intended || "?"}] ${subject}` */
guardSubject(subject, intendedEmail)
/** { mode, sandboxRecipient } для интерфейса настроек */
describeMailMode()
```
`DEV_RECIPIENT` and `isProduction` exports are removed; `DEV_MAIL_RECIPIENT` is no longer read.

- [ ] **Step 1: failing tests** in `backend/utils/mailGuard.test.js` (set/restore `process.env` per test; stub nothing else):
  - unset `MAIL_MODE` → `mailMode() === "off"`, `guardRecipient("a@b.c") === null`;
  - `MAIL_MODE=live` with `NODE_ENV` unset and with `NODE_ENV=development` → recipient unchanged, subject unchanged;
  - `MAIL_MODE=sandbox`, `MAIL_SANDBOX_RECIPIENT=x@example.com` → recipient `x@example.com`, subject starts `[SANDBOX → a@b.c]`; recipient equal to the sandbox address passes through unchanged;
  - `MAIL_MODE=sandbox` without recipient → `assertMailConfig()` throws, message names `MAIL_SANDBOX_RECIPIENT`;
  - `MAIL_MODE=LIVE ` (case/space) → `live`; `MAIL_MODE=prod` → `assertMailConfig()` throws and `mailMode()` returns `off` (fail closed);
  - `NODE_ENV=production` with unset `MAIL_MODE` → still `off`.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3: implement.** Call `assertMailConfig()` at backend start next to the other start-up checks (find where `mailGuard` is first required / `app.js`); a throw must stop the process with the message. Keep the start-up log line, now stating the mode.
- [ ] **Step 4: callers.**
  - `models/notification.js`: in `sandbox` keep today's redirect + `intendedEmail`; in `off` and `live` leave the document untouched.
  - `services/mail/send.js`: `off` → return `{ success: false, failure: { state: "Отправка почты выключена на сервере", hint: "Включается в настройках сервера: MAIL_MODE=live." } }` before any SMTP work; sandbox as today with the new subject tag. Follow the existing `failure` shape used for the unreadable-secret case so the outbox marks the letter failed and does not retry it.
  - `services/mail/check.js` `sendTestEmail`: `off` → the same failure object as a check result (`ok: false, state, hint`), no SMTP connection.
- [ ] **Step 5: settings API.** Add `mailMode: describeMailMode()` to the response that the «Уведомления» section reads (same handler that returns `notify`); it is not written back (ignore on POST).
- [ ] **Step 6: tg-service.** Its non-production chat guard gets the same switch: `MAIL_MODE`-independent env `TELEGRAM_MODE` is **not** introduced — reuse the existing behaviour but drop any built-in chat id/person default; if a default id exists, make it env-only and refuse to start in redirect mode without it. Report what you found.
- [ ] **Step 7: deploy and docs.** In `deploy.sh` `ensure_env`: when `.env` already existed before this run and has no `MAIL_MODE`, `env_set MAIL_MODE live` and print one line saying so; a newly created `.env` gets `MAIL_MODE=off` with a comment. In `.env.example` replace the `DEV_MAIL_RECIPIENT` block with `MAIL_MODE` (three values explained) and `MAIL_SANDBOX_RECIPIENT`. Update `docs/deployment.md` where mail redirect is described.
- [ ] **Step 8:** run `node --test backend/utils/mailGuard.test.js` plus existing tests of touched files (`services/mail/*.test.js` that import send/check/outbox, `models/notification*.test.js` if any). All green; `node --check` on touched files.

---

### Task 2: Subject prefix from env (D3)

**Files:** Modify `backend/services/emailReplyStripper.js`, `backend/services/emailReplyStripper.test.js`, `.env.example`; check `services/mail/outbox.js`, `middleware/emailHandling.js`, `middleware/notifications.js` compile unchanged.

**Interfaces — Produces** (names unchanged for existing consumers):
```js
TICKET_SUBJECT_PREFIX            // строка из env TICKET_SUBJECT_PREFIX, по умолчанию "HD"
ticketSubjectTag(num)            // `[${PREFIX}-${num}]`
ticketNumFromSubject(subject)    // принимает PREFIX и все из TICKET_SUBJECT_PREFIXES_ACCEPTED
buildSubjectTagging({ prefix, accepted })  // чистая фабрика → { prefix, tag, numFromSubject }; бросает на неверном значении
```
Validation: each prefix matches `/^[A-Za-z0-9-]{2,12}$/`; invalid → throw `Error("TICKET_SUBJECT_PREFIX: допустимы латиница, цифры и дефис, 2–12 знаков")` at module load.

- [ ] **Step 1: tests** (use `buildSubjectTagging` so env is not touched):
  - default `{prefix:"HD"}`: `tag(7) === "[HD-7]"`, `numFromSubject("Re: [HD-7] x") === 7`;
  - `{prefix:"HD", accepted:["F1-HD"]}`: `"[F1-HD-51713] тема"` → 51713; `"[JIRA-5] x"` → null;
  - several tags → the first accepted one wins (keep the existing rule and its existing test);
  - `"[HD-1e3]"`, `"[HD--5]"`, `"[HD- 5]"` → null;
  - a prefix that is a suffix of another (`HD` vs `F1-HD`): `"[F1-HD-9]"` with only `HD` accepted → null (the regexp must anchor on `[`);
  - invalid prefixes `""`, `"A"`, `"A B"`, `"x".repeat(13)`, `"A]"` → throw.
  - Update existing assertions that hard-code `F1-HD` to build with `{prefix:"F1-HD"}` or to the default.
- [ ] **Step 2–4:** fail, implement, pass. Module-level exports are `buildSubjectTagging({ prefix: process.env.TICKET_SUBJECT_PREFIX || "HD", accepted: (process.env.TICKET_SUBJECT_PREFIXES_ACCEPTED || "").split(",").map(s => s.trim()).filter(Boolean) })`.
- [ ] **Step 5:** `.env.example`: document both variables. Rewrite the file's comments that say `F1-HD` to a neutral `[HD-51713]`. Grep `backend` and `tg-service` for the literal `F1-HD`: any test expecting it switches to `ticketSubjectTag(n)`.
- [ ] **Step 6:** run this test file and `middleware/emailHandling*.test.js`, `services/mail/outbox*.test.js`.

---

### Task 3: Brand model, helpers and public endpoints (D1, D2)

**Files:**
- Create: `backend/services/brand.js`, `backend/services/brand.test.js`, `backend/services/brandColor.js`, `backend/services/brandColor.test.js`, `backend/controllers/brand.js`, `backend/routes/brand.js` (mounted public, beside the route that serves `preferences-auth`), `backend/assets/brand-icon.png` (neutral default, see Step 5), `backend/scripts/seedBrand.js`
- Modify: `backend/models/preferences.js` (after `contacts`), `backend/controllers/preferences.js` (`getAuth`, `getInitial`, save, icon upload/delete beside logo), `backend/controllers/me.js` (prefs), `backend/middleware/imageUpload.js` (`uploadBrandIcon`: field `brandIcon`, 1 MB, PNG only), internal preferences routes, `backend/types/preferences.ts`, `backend/scripts/migrate.js` (append to the END of `MIGRATIONS`), `backend/auth/config.js` (TOTP fallback → `"HelpDesk"`).

**Interfaces — Produces:**
```js
// services/brandColor.js
contrast(hexA, hexB)            // число ≥ 1
accentTokens(accentHex)         // { primary, primaryForeground, accentTextLight, accentTextDark }
isHexColor(value)               // /^#[0-9a-f]{6}$/i

// services/brand.js
DEFAULT_BRAND = { productName: "HelpDesk", mailSignature: "", accent: "#00bc8c", icon: "" }
resolveBrand(preferences)       // → { productName, mailSignature, accent, icon } со всеми умолчаниями; null/undefined безопасны
validateBrandInput(body)        // → { value } | { error: "текст для человека" }; обрезает пробелы; пустое имя → умолчание
mailSignatureHtml(preferences)  // → "<p>…</p>" или "" (экранировано, переводы строк → <br />)
escapeHtml(value)
```
Model: `brand: { productName: {type:String, default:""}, mailSignature: {type:String, default:""}, accent: {type:String, default:""}, icon: {type:String, default:""} }` — empty means "default"; the API always returns the resolved object.

`accentTokens` algorithm (identical in Task 8's frontend copy): `primaryForeground = contrast(accent,"#ffffff") < 2.2 ? "#1d2227" : "#ffffff"`; `accentTextLight`: convert to HSL, lower L by 0.01 until contrast with `#ffffff` ≥ 4.5 (max 100 steps); `accentTextDark`: raise L until contrast with `#1d2024` ≥ 4.5.

- [ ] **Step 1: tests.**
  - `brandColor`: `accentTokens("#00bc8c").primaryForeground === "#ffffff"`; for each of `#00bc8c #2f7fd6 #ffffff #000000 #ffff00 #d6336c`: `contrast(accentTextLight,"#ffffff") >= 4.5`, `contrast(accentTextDark,"#1d2024") >= 4.5`, all outputs match `isHexColor`; `accentTokens("#ffff00").primaryForeground === "#1d2227"`; `isHexColor` rejects `"#fff"`, `"00bc8c"`, `"#00bc8g"`, `null`.
  - `brand`: `resolveBrand(null)`, `resolveBrand({})`, `resolveBrand({brand:{productName:"  "}})` → defaults; set values pass through;
  - `validateBrandInput`: name of 41 chars → error; signature of 301 → error; accent `"red"` → error; `{}` → value with empties; name is trimmed;
  - `mailSignatureHtml`: explicit signature `"С уважением,\nКоманда"` → `<p>С уважением,<br />Команда</p>`; empty signature + `contacts.title = "ООО «Ромашка»"` → `<p>С уважением,<br />ООО «Ромашка»</p>`; both empty → `""`; `"<script>x</script>"` → contains `&lt;script&gt;`, no `<script`.
- [ ] **Step 2–3:** fail, implement, pass.
- [ ] **Step 4: API.** `getAuth`, `getInitial`, `me` prefs add `brand: resolveBrand(preferences)`; `getAuth` also adds `sentryDsn: process.env.SENTRY_DSN || ""` (used by Task 7). Save: `if (has("brand"))` → `validateBrandInput`; error → 400 with its text; store `productName`, `mailSignature`, `accent`, keep `icon` (managed like logo). Icon: `POST /api/preferences/brand-icon`, `POST /api/preferences/delete-brand-icon`, same permission and storage calls as the logo handlers; response `{ icon, message }` with messages «Значок обновлён» / «Значок удалён».
- [ ] **Step 5: public brand endpoints** (no auth, `Cache-Control: public, max-age=300`):
  - `GET /api/brand/icon` → the uploaded PNG, else `backend/assets/brand-icon.png`. Generate the default once with a throwaway node script using only `zlib` (192×192 PNG: rounded square `#00bc8c`, white open ring, as the mockup's glyph) and commit the binary to the tree; do not add an image library.
  - `GET /api/brand/manifest.webmanifest` → `application/manifest+json`, body built with `JSON.stringify` from `{ name, short_name: name.slice(0,12), start_url: "/", display: "standalone", theme_color: accent, background_color: "#ffffff", icons: [{ src: "/api/brand/icon", sizes: "192x192", type: "image/png" }] }`.
  - Test the controller with stubbed `req`/`res` and a stubbed `Preferences.findOne`: defaults without a document; a name containing `"` and `<` round-trips through `JSON.parse`.
- [ ] **Step 6: migration `seedBrand.js`** (pattern of neighbours: dry-run by default, `--apply` writes): if the singleton `preferences` document has no `brand.productName` **and** the `users` collection is non-empty, set `brand.productName` and `brand.mailSignature` to the two legacy values taken from `process.env.LEGACY_BRAND_NAME` / `LEGACY_BRAND_SIGNATURE`; when those are unset the script writes nothing and says so. (The legacy strings themselves must not live in the repo; the owner's deploy note in Task 11 gives the values to export.) Append `{ id: "2026-10-11-seedBrand", script: "seedBrand.js", apply: true }` to the end of `MIGRATIONS`.
- [ ] **Step 7:** run the three new test files and `controllers/preferences*.test.js`, `controllers/me*.test.js` if present.

---

### Task 4: E-mail texts, signature and colours (H3)

**Files:** Modify `backend/auth/hooks.js` (subjects ~L112,126,246,262,306,322; bodies ~L115,249; `SIGNATURE` L43), `backend/middleware/notifications.js` (8 inline «С уважением…Команда F1Lab» blocks — find with `grep -n "Команда F1Lab"`), `backend/services/mail/approvalEmailTemplate.js` (`C.primary`, `C.accent`), any other hit of `grep -rn "F1Lab" backend --include=*.js -l` that is e-mail or user-visible text; tests beside each.

**Interfaces — Consumes:** `resolveBrand`, `mailSignatureHtml`, `escapeHtml` (Task 3), `accentTokens` (Task 3).

- [ ] **Step 1: tests.** For `auth/hooks.js` extract a pure builder if none exists (`buildAccessEmails({ brand, orgTitle, user, url })` returning `{ title, body }` per letter) and test: default brand → subject «Вам открыт доступ в портал HelpDesk»; brand name «Север» → subject carries it; empty org title → body says «в портале поддержки —» without a dangling name; no `F1Lab` in any output. For `approvalEmailTemplate`: rendering with accent `#2f7fd6` contains `#2f7fd6` and its `accentTextLight`, and no `#00bc8c`.
- [ ] **Step 2–3:** implement. `send()` in hooks loads `Preferences.findOne({}).lean()` once per letter and appends `mailSignatureHtml(preferences)`. In `notifications.js` every inline signature paragraph becomes `${signature}` where `signature = mailSignatureHtml(prefs)` computed from the `prefs` already loaded in that function (load it if a function has none). Do not change any other wording in these letters. The approval template takes `accent` as a parameter from its caller (which resolves the brand) with the default tokens as fallback.
- [ ] **Step 4:** run the touched test files; `grep -rn "F1Lab" backend/auth backend/middleware backend/services/mail` returns nothing.

---

### Task 5: AI prompts take the organisation name (H4, D6)

**Files:** Modify `backend/prompts/callSummary.js`, `backend/prompts/transcription.js` (becomes a function `({ supportCompany }) => string`), `backend/services/speechToTextService.js` (L~167 already loads Preferences; pass `supportCompany: preferences?.contacts?.title || ""` into `summarizeDialog` context and the transcription prompt at ~L386). Create `backend/prompts/prompts.test.js`.

- [ ] **Step 1: tests.** `callSummary({segments:[], context:{supportCompany:"Ромашка"}})`: system contains «Ромашка», `JSON.parse(user).known.supportCompany === "Ромашка"`; with no `supportCompany`: system has no sentence starting «Наша компания», no `«»`, `known.supportCompany === ""`; neither output contains `F1Lab`, «Фатима», «эф один лаб». `transcription({supportCompany:"Ромашка"})` contains «техподдержки Ромашка» once and not «поддержки поддержки»; with empty → «службы техподдержки.» and no double space.
- [ ] **Step 2–3:** implement. The correction instruction becomes generic: «Если распознавание исказило название, всегда исправляй на «${name}».»
- [ ] **Step 4:** run the test and `node --check` the service; update every call site (`grep -rn "prompts/transcription\|prompts/callSummary" backend`).

---

### Task 6: Role catalogue and ticket counter (H5, H6)

**Files:** Modify `backend/scripts/roles.catalogue.json`, `backend/scripts/dumpRoleCatalogue.js`, `backend/models/ticket.js` L8, `.env.example` (L~79 comment «default 1»); Create `backend/scripts/roles.catalogue.test.js`. Read `backend/scripts/syncRoleCatalogue.js`, `services/bootstrapSeed.js`, and every test that imports the catalogue (`grep -rln "roles.catalogue" backend`).

- [ ] **Step 1: tests** `roles.catalogue.test.js`: the raw file text contains no `@`; no role has `members`, `matches` or `_note`; keys are exactly `client, client-admin, client-manager, admin, it-first-line, it-second-line, kb-moderator, contractor-no-works`; exactly one role satisfies `isFullAccess(actionsToStatements(role.actions))`; every action exists in the permission dictionary (use the dictionary export `syncRoleCatalogue`/`auth/access` already validates against).
- [ ] **Step 2:** edit the JSON: delete the `klient-ofis-menedzher` role and all `members`/`matches`/`_note` keys; keep the top-level `_` comment only if it holds no installation data (rewrite it to one neutral line). `dumpRoleCatalogue.js` stops emitting `members`/`matches`.
- [ ] **Step 3: verify the existing-instance claim** by reading `syncCatalogue`: on a database that has a role missing from the file, does it delete or rename it? Report the exact lines. If it deletes, STOP and report — do not change sync behaviour in this task.
- [ ] **Step 4:** fix tests that relied on removed fields or the removed role.
- [ ] **Step 5:** `models/ticket.js`: `const STARTING_NUMBER = Number(process.env.TICKET_COUNTER_STARTING_NUMBER) || 1;` — check how it is consumed first (counter seed) and keep the type it expects.
- [ ] **Step 6:** run the new test, `services/roles.test.js`, `services/permissionHolders.test.js`, `controllers/user.access.test.js`, `controllers/company.access.test.js`.

---

### Task 7: Error tracking from configuration (H2, D5)

**Files:** Modify `frontend/src/main.jsx` (L12-17), `frontend/nginx.conf` → served as a template, `frontend/Dockerfile` (prod stage), `compose.yml` (frontend service env `SENTRY_CSP_ORIGIN`), `deploy.sh` (derive `SENTRY_CSP_ORIGIN` from `SENTRY_DSN` when set), `.env.example`.

- [ ] **Step 1:** `main.jsx`: remove the hard-coded DSN and `sendDefaultPii`. After the app mounts, fetch `/api/preferences-auth` (reuse the app's existing fetch of it if one is reachable here; otherwise a guarded `fetch` with try/catch and `response.ok`), and when `sentryDsn` is non-empty call `Sentry.init({ dsn, sendDefaultPii: false })`. No DSN → Sentry is never initialised. The `vite:preloadError` handler stays as is.
- [ ] **Step 2:** nginx: the official unprivileged image runs `envsubst` over `/etc/nginx/templates/*.template` into `/etc/nginx/conf.d/` and substitutes only variables that are **defined in the environment**, so `$uri` and friends survive. Copy the file as `/etc/nginx/templates/default.conf.template`, change `connect-src 'self'` to `connect-src 'self' ${SENTRY_CSP_ORIGIN}`, set `ENV SENTRY_CSP_ORIGIN=""` in the Dockerfile so the variable is always defined. Confirm by reading the image's `20-envsubst-on-templates.sh` behaviour in its documentation comments if the image is available locally (`docker run --rm nginxinc/nginx-unprivileged:1.28-alpine cat /docker-entrypoint.d/20-envsubst-on-templates.sh` — needs the sandbox off; if it cannot run, say so in the report instead of guessing).
- [ ] **Step 3:** `deploy.sh`: when `SENTRY_DSN` is set, export `SENTRY_CSP_ORIGIN` as its `scheme://host` (strip credentials and path with shell parameter expansion). `.env.example`: document `SENTRY_DSN` (empty = off).
- [ ] **Step 4:** `pnpm -C frontend build` passes; `grep -rn "sentry.io" frontend/src` returns nothing.

---

### Task 8: Frontend brand runtime — name, icon, accent everywhere (H8)

**Files:**
- Create: `frontend/src/util/brand-color.js` + `brand-color.test.js`, `frontend/src/util/brand.js` + `brand.test.js`, `frontend/src/components/app/BrandGlyph.tsx`
- Modify: `frontend/src/store/prefs.js` (state + `set`), `frontend/src/pages/Auth/prefs.ts` (`AuthPrefs.brand`, fallback), `frontend/src/components/app/BrandMark.tsx`, `frontend/src/layout/Navbar.jsx` (~L60-70), `frontend/src/components/Auth/AuthShell.tsx` (L144), `frontend/src/layout/Footer.jsx` (~L86), `frontend/src/layout/Root.jsx` (apply brand after prefs load) and the auth layout that loads `preferences-auth`, `frontend/src/hooks/use-doc-title.js`, the four pages with «F1 HD | …», `frontend/index.html`, `frontend/src/components/Report/export-pdf.ts` (~L114), `frontend/src/styles/tailwind.css` (`--success`, `--chart-1` stay literal teal — no change needed unless they reference `--primary`); delete `frontend/public/{logo.png,apple-touch-icon-152x152.png,error-emoji_old.png,manifest.json}` only after grepping that nothing references them.

**Interfaces — Consumes:** `brand: { productName, mailSignature, accent, icon }` from the three prefs endpoints (Task 3).
**Produces:**
```js
// util/brand-color.js — тот же алгоритм и те же тест-векторы, что backend/services/brandColor.js
contrast(hexA, hexB); accentTokens(accentHex); isHexColor(value)
// util/brand.js
applyAccent(accentHex, root = document.documentElement)  // ставит --primary, --primary-foreground, --ring, --accent-text, --bubble-out для обеих тем
pageTitle(page, productName)   // "Заявки · HelpDesk"; пустая страница → productName
accentWarnings(accentHex)      // { darkText: boolean, nearError: boolean }
```
`applyAccent` must serve both themes without re-running on theme switch: inject one `<style id="brand-accent">` with `:root{…light…} .dark{…dark…}` (`--accent-text` differs per theme; `--bubble-out` = accent at 13% / 17% alpha as today). With the default accent it injects nothing, so today's CSS stays the source of truth.
`nearError`: HSL saturation > 0.5 and hue ≤ 12 or ≥ 345.

- [ ] **Step 1: tests** (`node --test`, pure parts only): copy the Task 3 colour vectors; `pageTitle("Заявки","Север") === "Заявки · Север"`, `pageTitle("", "Север") === "Север"`; `accentWarnings("#ffff00").darkText`, `accentWarnings("#d63c3c").nearError`, `accentWarnings("#00bc8c")` both false; a function `accentCss(accentHex)` (the string `applyAccent` injects) contains `--primary:#2f7fd6` for that accent and returns `""` for `#00bc8c`.
- [ ] **Step 2–3:** implement helpers.
- [ ] **Step 4: wire.**
  - Store keeps `brand` with the default object; `set` copies `data.brand || default`.
  - `BrandGlyph`: inline SVG exactly as the mockup's `glyph()` (rounded square `var(--primary)`, open ring `var(--primary-foreground)`); when `brand.icon` is set, an `<img src="/api/brand/icon">` of the same box instead (size via inline style — see the note about the global `<img>` autoscale in `BrandMark.tsx`).
  - `BrandMark`: props gain `name`; without a logo it renders glyph + name in `text-foreground` (gap `gap-2`, sizes as now, name truncates with `truncate min-w-0`). The two-tone `Help<span>Desk</span>` goes. Logo behaviour unchanged.
  - Navbar `aria-label={`${productName} — на главную`}`; Footer `© {year} {productName}`.
  - `useDocTitle`: sets `document.title = pageTitle(title, productName)` reading the store; convert the four «F1 HD | …» pages to it (titles: «Мой аккаунт», note title, «База знаний», «Новая заметка») and every other direct `document.title =` assignment found by grep.
  - `index.html`: `<title>HelpDesk</title>`, `<link rel="icon" href="/api/brand/icon">`, `<link rel="apple-touch-icon" href="/api/brand/icon">`, `<link rel="manifest" href="/api/brand/manifest.webmanifest">`; drop the two legacy `theme-color` metas. Check `frontend/nginx.conf` proxies `/api/` for these (it does for all `/api`).
  - `export-pdf.ts`: the hard-coded teal becomes the brand accent passed by its caller from the store (default unchanged).
- [ ] **Step 5:** run the two test files; `pnpm -C frontend build`; typecheck error count unchanged (one, `FormWrapper.tsx`); `grep -rn "F1 HD\|F1Lab" frontend/src frontend/index.html` returns nothing.

---

### Task 9: Settings UI «Бренд», mail-mode rows, error screen (mockup scenes 1, 4, 5)

**Files:** Modify `frontend/src/components/Preferences/Globals.jsx`, `frontend/src/components/Preferences/Notifications.jsx` (+ `channel-health.js` and its test if one exists), `frontend/src/components/Error/ErrorScreen.jsx`, `frontend/src/index.css` (the `err-cat-settle` rule → keep the animation name or rename consistently); delete `frontend/public/error-emoji.png` after grepping. Read the mockup source first.

**Interfaces — Consumes:** `brand` in `prefs` (Task 3), `prefs.mailMode = { mode, sandboxRecipient }` (Task 1), `applyAccent`, `accentWarnings`, `isHexColor` (Task 8), `BrandGlyph` (Task 8).

- [ ] **Step 1: «Бренд» sub-group** in `Globals.jsx`, after the «Адрес» row and before «Оператор заказа такси», exactly in the mockup's order and copy:
  - `SubLabel` «Бренд»;
  - «Название портала» — hint «Вкладка браузера, экран входа, подвал и темы писем о доступе.», `Input` `maxLength={40}` `placeholder="HelpDesk"`, `w-72 max-md:w-full`;
  - «Лого компании» — the existing row moved here without its `divider`; hint becomes «Заменяет название в навбаре и на экране входа. PNG, JPG или GIF до 2 МБ.»;
  - «Значок» — hint «Вкладка браузера и ярлык на телефоне. Квадратный PNG от 192 px, до 1 МБ.», a 40 px preview (`BrandGlyph` or the uploaded icon), buttons «Загрузить»/«Заменить»/«Удалить» with the logo's exact behaviour (immediate save, toast, `refresh()`), client checks: PNG only, ≤ 1 МБ;
  - «Цвет акцента» — hint «Кнопки, ссылки, переключатели и письма согласования.»; seven swatch buttons `#00bc8c #2f7fd6 #5a55d6 #8a4fd3 #d6336c #e8662c #3b4754` (`aria-pressed`, `aria-label`), a hex `Input` (`w-28`, `maxLength={7}`); beneath: a preview row (primary `Button size="sm"` «Сохранить» as a non-submitting sample, a link sample, an on `Switch`); conditional lines «Цвет светлый — текст на кнопках станет тёмным.», «Близко к цвету ошибок: кнопки и ошибки будут похожи.» (`text-warning-text`), «Цвет записывается как #rrggbb.» (invalid → `blockedReason`). Changing the colour calls `applyAccent` at once so the whole page previews it; cancelling the draft must restore the saved accent (hook into the section's reset the same way other live previews do, or re-apply `prefs.brand.accent` on unmount and on draft reset);
  - «Подпись в письмах» — hint «Завершает каждое письмо. Пусто — «С уважением» и название организации.», `Textarea` 2 rows, `maxLength={300}`, placeholder = the default it will produce.
  - `buildPayload` adds `brand: { productName, accent, mailSignature }`. The placeholder of «Название организации» becomes «ООО «Ваша компания»».
- [ ] **Step 2: mail mode rows** in `Notifications.jsx`: when `prefs.mailMode.mode === "sandbox"` the e-mail `HealthRow` is `state="warning"`, title `Песочница: вся почта уходит на ${sandboxRecipient}`, hint «Режим задан на сервере. Настоящие адресаты писем не получают.», «Проверить» stays; when `"off"`: `state="idle"`, title «Отправка почты выключена на сервере», hint «Письма не уходят, уведомления помечаются неотправленными. Включается в настройках сервера.», no action button. `live` → today's logic untouched. Put the decision in a pure function in `channel-health.js` (`describeMailMode(mailMode)` → row props or `null`) with a `node --test` test for the three modes.
- [ ] **Step 3: error screen:** replace the cat crop with an inline SVG ring (`viewBox 0 0 100 100`, `circle r=36`, `stroke="var(--primary)"`, `stroke-width=15`, `stroke-dasharray="186 40"`, round caps, rotated −62°) sized `0.8em` in the code and `h-28 md:h-32` solo; keep the settle animation class on it. Update the component comment.
- [ ] **Step 4:** tests from Step 2; `pnpm -C frontend build`; typecheck count unchanged. Do not run a browser.
- [ ] **Step 5: docs:** add the «Бренд» group, the wordmark rule and the error ring to `docs/ux-ui-guide.md` (target state only) and one entry to `docs/ux-ui-changelog.md`.

---

### Task 10: «HD» in prose, repository hygiene, guard test (D1, H7, D9)

**Files:** about 45, found by grep; Create `backend/scripts/repoBrand.test.js`.

- [ ] **Step 1: guard test** `repoBrand.test.js`: walk the repo's tracked text files (`git ls-files` via `child_process`, skip binaries, lockfiles, `docs/superpowers/**`, `.superpowers/**`, `docs/ux-ui-changelog.md`, and an explicit allow-list array at the top of the test) and fail on `/F1Lab|F1-HD|f1lab\.ru/i`, printing `file:line`. Run it; it fails with the current list — that list is this task's worklist.
- [ ] **Step 2: user-visible «HD»** (`grep -rnE "\bHD\b" backend frontend/src tg-service/src --include=*.js --include=*.jsx --include=*.ts --include=*.tsx` — Mikrotik UI and notifications, MCP tool descriptions, `tg-service/src/bot/mikrotikChange.ts`): reword to neutral prose («система», «портал», "the helpdesk") so each sentence still reads naturally; do not interpolate the product name. **Keep** technical identifiers: RouterOS names `hd-mgmt`, `hd-api` (`Mikrotik/SetupHelp.jsx`, `DeviceForm.jsx`, `services/mikrotik/upgradeErrors.js`), the MCP server id `hd-helpdesk`, package names, env names (`HD_MIKROTIK_DIRECT`), container names.
- [ ] **Step 3: scrub** real people, e-mails, phones, hostnames and client company names from tests, fixtures, comments and demo seeds (`scripts/seedDemoConversations.js`, `scripts/restoreFullAccess.js`, `models/user.js` comment, `services/staffContacts.test.js`, quote-header comment in `emailReplyStripper.js`, others the guard and `grep -rnE "@[a-z0-9-]+\.(ru|com)" backend --include=*.js | grep -v example` reveal). Replace with `example.com`, «Иван Петров», «ООО «Ромашка»», `+7 495 000-00-00`. A test's meaning must survive: change both the fixture and its expectation.
- [ ] **Step 4:** `backend/package.json` and other `package.json` files: neutral `repository`/`author`/`homepage`. `.dockerignore`: exclude `scripts/seedDemoConversations.js`, `scripts/restoreFullAccess.js` and other installation-specific one-offs from the image **only if nothing in `migrate.js` or the app requires them** (grep first). `sync-dev-db.sh` and internal notes in `docs/deployment.md`: add them to the guard's allow-list with a comment «internal, leaves the repo in W3» and put a header line «Internal F1lab tooling — not part of the product» at the top of `sync-dev-db.sh`.
- [ ] **Step 5:** the guard test passes; re-run the test files of every test you edited.

---

### Task 11: Deploy notes, audit marks, whole-branch check

**Files:** `docs/deployment.md`, `docs/superpowers/specs/2026-09-30-productization-audit.md` (mark H1–H8 closed with one line each), `.env.example` (final read-through).

- [ ] **Step 1:** `docs/deployment.md`: a section "Updating an existing install to W2" — `MAIL_MODE=live` (written by `deploy.sh`), `TICKET_SUBJECT_PREFIX` and `TICKET_SUBJECT_PREFIXES_ACCEPTED`, `LEGACY_BRAND_NAME`/`LEGACY_BRAND_SIGNATURE` exported for the one `seedBrand` run, optional `SENTRY_DSN`; and "Dev machine": `MAIL_MODE=sandbox` + `MAIL_SANDBOX_RECIPIENT`.
- [ ] **Step 2:** run every test file created or edited in Tasks 1–10 in one command, `pnpm -C frontend build`, frontend typecheck, `cd tg-service && pnpm test` (16 tests), `node --check` on every touched backend file.
- [ ] **Step 3:** report: files changed, tests run with counts, anything deferred.
