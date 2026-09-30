# HD productization audit

Date: 2026-09-30 · Status: findings for review · Scope: backend, frontend, tg-service and
the deploy tooling at `8798dfe` plus the working tree of that day (line numbers may drift:
other sessions were editing `controllers/user.js`, `routes/internal/user.js` and some models).

> Contains unfixed vulnerabilities with exploitation detail. Keep it out of anything that
> ships to customers and out of any shared copy of the repository until the "Now" items
> are closed.

## Context

- **Goal:** sell HD as a product. Every customer gets its own isolated instance (container
  or VM) on its own subdomain. Target market: the CIS.
- **What that model changes.** Tenant isolation is done by infrastructure, so no
  `tenantId` is needed in the data model. Isolation *inside* an instance still matters: an
  MSP customer's own client companies log in, exactly as F1lab's clients do today.
  Cross-customer risk moves to the infrastructure: shared hosts, a shared parent domain,
  shared S3, and the vendor network reachable by SSRF. Running a fleet becomes the main cost.
- **Method:** seven parallel read-only audits:
  - authentication and sessions;
  - authorization and isolation;
  - untrusted input and outbound calls;
  - infrastructure, secrets, crypto and dependencies;
  - hardcoded and market assumptions;
  - operations and the fleet;
  - product, legal and compliance.

  `pnpm audit` was run. Nothing was executed against the app or production. Every Critical
  and High finding was re-checked by hand, and those are marked **✔**. The rest were traced
  by the auditors with file:line evidence but not re-checked.
- **Severity:**
  - *Critical:* an anonymous or client-role user reaches other companies' data or takes
    over accounts.
  - *High:* a role is exceeded; a secret or PII leaks; a flaw hits every customer install;
    or there is a legal blocker.
  - *Medium:* a hardening or significant product gap.
  - *Low:* polish.
- **Priority:**
  - **Now:** exploitable or harmful in F1lab's own install today.
  - **P0:** before the first external customer.
  - **P1:** before selling broadly.
  - **P2:** later or market expansion.

## Summary

The architecture fits the product. One instance per customer matches how the code is built,
and the foundations are better than typical for an internal tool (§4):

- the permission dictionary, which a coverage script verifies;
- consistent ticket scoping;
- AES-GCM secrets at rest;
- a strict CSP;
- non-root images;
- no secrets in git history apart from S14.

HD is **not sellable yet**, for three reasons:

1. **Security holes, several exploitable today:**
   - a client-admin can read other companies' devices (S1);
   - approval responses hand out other signers' tokens (S2);
   - anyone can post comments into any ticket by forging an e-mail (S3);
   - a magic link skips both password and TOTP (S4);
   - company API keys are not scoped to their company (S5);
   - users change their own e-mail without verification (S6);
   - one e-mail can freeze the backend (S12).
2. **F1lab is wired into what customers see and where their data goes:**
   - a non-production run mails *everything*, login links included, to the owner (H1);
   - the frontend reports to F1lab's Sentry (H2);
   - e-mails, the title bar and AI prompts say "F1Lab" (H3, H4);
   - the role seed carries F1lab staff and client e-mails (H5).
3. **There is no product shell.** It lacks releases and a licence (O1, O2), provisioning (O10),
   safe keys, migrations and backups (O4–O6), job safety (O7), an audit trail (L4, L5), and
   CIS basics: currency, phone, calendar (C1–C3).

73 consolidated findings (many group several sub-findings): 1 Critical, 32 High, 32 Medium,
8 Low.

### Do this week (independent of productization)

1. **Change the port-knock sequence** of the router named in
   `backend/scripts/mikrotikUpgradeProbe.js` (S14). Check who can read the GitHub repository.
2. **Close the "Now" security items:** S1–S6, S10–S12, S15 (multer), plus the job
   double-send O7 and the key carry-over in deploy.sh (O6).
3. **Fix the phone-normalization spec before implementing it** (C2). It reads every number
   without "+" as Russian.
4. **Confirm on production, read-only:**
   - whether any live role gives `user.manage`, `user.manageAccess` or `user.impersonate` to
     non-admins (makes S7 exploitable today);
   - whether plaintext legacy API keys remain (S9, S10);
   - the id types in better-auth `member` rows (S8).

---

## 1. Security

### 1.1 Exploitable today

**S1 ✔ Client-admin reads other companies' devices and device tickets.** Critical · Now
- **Where:**
  - `backend/controllers/inventory/clientDevice.js:1153-1178` (`getAttachable` takes
    `companyId` from the query);
  - `:856-859` (`getTickets` by device id, no scope);
  - routes `routes/internal/inventory/clientDevice.js:14,20`;
  - prefix gate `routes/inventoryMount.js:65` is `device.read`, which the `client-admin`
    role holds.
- **Impact:** `GET /api/client-devices/attachable?companyId=<other>` returns another
  company's devices, populated with their users' names and e-mails, serials, IPs and prices.
  The ids then open `/client-devices/:id/tickets`. Company ids leak via service plans (S18).
  Related: `/my-workplace` "nearby" devices are not filtered by company
  (`controllers/inventory/location.js:1283-1299`).
- **Fix:** reuse `getAll`'s company scope in both handlers, and AND `getTickets` with the
  device-company check plus `ticketListFilter`. Effort S.

**S2 ✔ Approval API responses carry other signers' tokens.** High · Now
- **Where:**
  - `models/finances/servicePlanReport.js:177-190`: `accessTokens[].token` in plaintext,
    with no toJSON transform;
  - `controllers/finances/approval.js:438,457,476,530` return the raw report;
  - `services/reportApproval.js:153,773-786` issue next-wave and final tokens before the
    response.
- **Impact:**
  - a client subdivision manager (`client-admin` holds `approval.decide`) receives sibling
    and final-approver tokens, and `POST /api/external/approval/<token>/decision` then signs
    as them;
  - `approval.manage` staff can forge customer consent.
- **Fix:** respond with a card DTO; hash the tokens. Effort S.

**S3 ✔ Inbound e-mail: forged sender, replies injected into any ticket.** High · Now
- **Where:**
  - `middleware/emailHandling.js:649-736`: the sender is resolved from the `From` header
    only, with no SPF/DKIM/DMARC or Authentication-Results check;
  - `:728-782`: a reply becomes a comment on `Ticket.findOne({num})` with no participant or
    company check, attributed to the spoofed user or the default applicant;
  - `services/emailReplyStripper.js:23`: `/-([^\]-]+)\]/` is not anchored to the prefix.
- **Impact:**
  - anyone can post into any ticket (numbers are sequential) as any client or staff member;
  - the helpdesk then mails that text to the participants from the customer's own domain, a
    ready-made phishing channel;
  - unrelated mail is misfiled: any subject containing `-<number>]` goes into that ticket
    if the number exists. "Invoice [PO-50123]" becomes a comment on ticket 50123, and on a
    fresh install that counts from 1, almost any number hits.
- **Fix:**
  - anchor the match to the configured prefix;
  - accept replies only from ticket participants or the ticket's company domains, and
    quarantine the rest;
  - honour Authentication-Results from the MX.

  Effort M.

**S4 ✔ Magic-link sign-in bypasses both the password and TOTP for every account.** High · Now
- **Where:**
  - `auth/instance.mjs:385-396`: the `magicLink` plugin is public, with no `disabledPaths`;
  - `:107-108`: the TOTP challenge is only attached to `/sign-in/email-otp`;
  - `auth/hooks.js:144-181`: `sessionRefusal` has no rule for 2FA-enrolled or staff users;
  - `:200-234`: a link is sent to any existing address.
- **Impact:**
  - access to a mailbox means an admin session, even when TOTP is enrolled;
  - the endpoint also lets anyone send unauthenticated "Вход в портал" mail to arbitrary
    addresses.
- **Fix:** disable `/sign-in/magic-link` over HTTP (invitations already use the server-side
  API), or refuse such sessions for staff and 2FA users. Effort S.

**S5 ✔ Company API keys are not scoped to their company, and they accept Mongo operators.** High · Now
- **Where:**
  - `controllers/external/ticket.js:40-51`: global `User.findById` / `findOne({email})`;
  - `:79-100`: the ticket's company is taken from the applicant;
  - `:137-142`: `responsibles` come from the body;
  - `:178-194`: the response echoes the applicant's e-mail;
  - `controllers/log/companyLog.js:27-36,61-67`;
  - `app.js:120` sets `strictQuery:false`, and `sanitizeFilter` is not set, so JSON bodies
    accept `{"$regex":…}`.
- **Impact:** the key sits on client workstations in AD logon scripts. Anyone holding it can:
  - file tickets as any user of any company;
  - make themselves responsible;
  - resolve any e-mail or id to a name, e-mail and company, staff included, which bypasses
    `hideStaffContacts`.
- **Fix:**
  - scope lookups to `req.company._id`, and coerce values to strings;
  - ignore body `responsibles` and strip PII from the response;
  - `mongoose.set("sanitizeFilter", true)`;
  - give keys limits and an expiry.

  Effort S.

**S6 ✔ Users change their own e-mail with no verification, no re-authentication and no session revocation.** High · Now
- **Where:** `controllers/user.js:1828` (`user.email = email ? email : user.email`);
  `routes/internal/user.js:100-106` (`isAuth` only).
- **Impact:**
  - a stolen session becomes a permanent takeover (change the e-mail, then use the magic
    link);
  - with `identifyApplicant` on, a client can adopt an address at another company and read
    that company's intake (`emailHandling.js:653-671,715-718`).
- **Fix:** a verified change-email flow with a password check; revoke sessions and notify the
  old address. Effort M.

**S10 Ticket card returns the raw Company document.** Medium (High if plaintext keys remain) · Now
- **Where:** `controllers/ticket.js:546,640,670` return `company.toJSON()`. By contrast,
  `company.getOne` strips keys (`controllers/company.js:144-146`).
- **Impact:** anyone who can open a ticket, a plain `client` included, receives API key hashes,
  or plaintext legacy keys, which lead straight to S5.
- **Fix:** project only the fields the card needs. Effort S.

**S11 ✔ Secrets end up in logs.** High · Now
- **Where:**
  - `controllers/user.js:692-696`: create-user logs the full body, including the password and
    the PRO32 key;
  - `services/bootstrapSeed.js:145-150` with `deploy.sh:267-268`: the generated admin password
    is in the container logs, and no change is forced;
  - `middleware/errorHandling.js:72-81,93-105`: every error property is logged, including the
    Telegram pairing code;
  - `controllers/external/ticket.js:198-203`: whole bodies are logged on error;
  - token-bearing URLs (approval, reset) appear in the nginx access logs.
- **Fix:**
  - drop the body dumps;
  - print the bootstrap password only in the deploy output, and force a change on first login;
  - allow-list which error fields get logged, and redact query strings.

  Effort S.

**S12 ✔ One e-mail or one request can freeze the whole instance.** High · Now
- **Where:**
  - `helpers/htmlToPlainText.js:12`: `/<[^>]+>/g` is quadratic. Measured: 40 KB of `<` takes
    2.1 s, and a 1 MB body takes minutes. The same pattern is in
    `helpers/markdownToPlainText.js:98` and `tg-service/src/bot/text.ts:23`.
  - Mail goes through mailparser 3.7.2, whose nodemailer 6.9.16 address parser and linkify-it
    5.0.0 have DoS advisories.
  - multer `1.4.5-lts.2` has DoS CVEs (2025-47935/47944/48997/7338) reachable by any logged-in
    user.
  - `app.js:117-118`: 50 MB JSON/urlencoded bodies are parsed before authentication on every
    `/api` path, and nginx allows 100M.
- **Impact:** a single process runs the web API and every job (O8), so one message stalls the
  tenant, and a retry stalls it again.
- **Fix:**
  - bounded regexes or a tokenizer, with input caps;
  - multer 2.x and mailparser ≥ 3.9.3;
  - parse mail in a worker with a timeout;
  - a global body limit of ≤ 256 KB with per-route overrides.

  Effort M.

**S14 ✔ Access details of a real router are committed.** High · Now
- **Where:** `backend/scripts/mikrotikUpgradeProbe.js:6` (since `c762cfe`) and
  `docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md:324`. They hold the public
  IP, the API-SSL port, the service user and the port-knock sequence. The script ships in the
  backend image because `.dockerignore` keeps `scripts/`. The history also contains the
  vendor's management egress IP (removed in `1b56b78`).
- **Fix:**
  - rotate the knock sequence;
  - replace these values with placeholders;
  - exclude dev scripts from images;
  - never ship this history.

  Effort S.

**S15 Vulnerable and abandoned dependencies on untrusted-input paths.** High · Now/P0
- **pnpm audit:** backend 23 high / 32 moderate; frontend 18 high / 40 moderate; tg-service
  clean.
- **On untrusted paths:**
  - multer 1.x (S12);
  - `xlsx 0.18.5` parses ticket attachments for the AI guide (`services/attachmentExtractor.js:63`;
    prototype pollution; npm has no fix);
  - `@toast-ui/editor 3.2.2` bundles DOMPurify 2.x (KB viewer);
  - `nodemailer 7.0.2` (misdelivery advisory);
  - `express 5.1.0` (body-parser/qs).
- **Unmaintained:** imap-simple/imap, routeros-node 0.1.0.
- **Stale lockfile:** the `security` npm script audits a stale `backend/package-lock.json`.
- **Fix:** upgrade, replace xlsx (SheetJS ≥ 0.20.2 from its CDN, or drop it), and run
  osv-scanner in CI. Effort M.

### 1.2 Latent: opens when customers delegate rights or when instances are vendor-hosted

**S7 ✔ The delegable rights are escalation paths.** High · P0

In the stock catalogue only `admin` holds these rights. The dictionary is built so that
customers can delegate them.
- **(a) `user.impersonate` leads to admin.**
  - `/api/auth/admin/impersonate-user` is publicly routed (`app.js:114`).
  - `adminRoles: []` (`auth/instance.mjs:352-366`) disables the plugin's check against
    admin targets (`better-auth/.../admin/routes.mjs:577-592`).
  - HD's `isAdmin` check exists only on its own route (`controllers/impersonation.js:54`).
  - `users.role` is computed from statements that are not stripped by audience
    (`services/roles.js:88-98,847,868`). A client-audience role carrying the right would
    therefore let a client become admin.
- **(b) `user.manage` can rewrite an admin's e-mail, ban admins or demote them.**
  `update` (`controllers/user.js:980-1084`) lacks the `mayTouchAccount` call that every other
  account handler has. Leaving out `banned` silently un-bans the user.
- **(c) Impersonation and `user.manageAccess` are not bounded by the target's rights.** The
  one-hour cap is enforced only in `attachSession` (`middleware/attachSession.js:47-53`).
- **Fix:**
  - block `/api/auth/admin/*` over HTTP (see S8);
  - compute the plugin role from audience-stripped statements;
  - call `mayTouchAccount` in `update`;
  - require the target's rights to be a subset of the actor's;
  - cap `expiresAt` itself.

  Effort S–M.

**S8 The whole better-auth plugin surface is public.** Medium (latent Critical) · P0
- **Where:** no `disabledPaths` anywhere.
- **The organization plugin:** `/organization/list-members` returns every member's name and
  e-mail to any member, and every user is a member (`services/roles.js:698-705`). It is inert
  only because member ids are stored as strings (`services/bootstrapSeed.js:59-62`). A
  "cleanup" to ObjectId would dump the whole directory to clients. Role keys `owner` and
  `admin` inherit the plugin's powers.
- **Raw sign-in:** `/sign-in/email` bypasses HD's login limiter (S20).
- **Fix:** an allow-list of the auth paths the SPA actually uses, and reserved role keys.
  Effort S.

**S9 ✔ Session credentials can be used straight from the DB, and are exposed to JavaScript.** High · P0
- **Where and impact:**
  - `bearer()` runs without `requireSignature` (`auth/instance.mjs:287`), so any reader of
    the DB, a backup or a dev copy can act as any logged-in user, admins included, for up to
    14 days.
  - The session token is returned in the body and the `set-auth-token` header
    (`controllers/auth.js:20-31,170`) and kept in `localStorage`
    (`frontend/src/pages/Auth/session.ts:60-61`), so any XSS or malicious dependency steals a
    sliding 14-day credential.
  - Reset tokens are stored raw for 24 h.
  - Approval tokens are stored raw.
  - Legacy plaintext is still accepted or stored: `companies.apiKeys.key`
    (`isAuthApiKey.js:54,64`; the erase script is manual) and `users.notifications.password`.
- **Fix:**
  - finish the move to cookies and drop `bearer()` and the token fields;
  - `verification.storeIdentifier:"hashed"`;
  - hash approval tokens;
  - a migration that unsets the legacy fields.

  Effort M.

**S13 ✔ SSRF by a customer's admin and through prompt injection.** High (vendor-hosted) / Medium (self-hosted) · P0
- **Where:**
  - `services/aiService.js:202-238`: the "local model" base URL accepts any http(s) host, and
    the model list echoes the response (`controllers/preferences.js:915-935`); speech-to-text
    is the same (`speechToTextService.js:187,810`);
  - `services/ticketAiTerms.js:92-128`: URLs the model emits are fetched with
    `redirect:"follow"` and no private-range block. Ticket text is attacker-controlled, so
    prompt injection selects the target.
  - `controllers/preferences.js:538-560,600-607,743-800`: the "check" endpoints send the
    *stored* IMAP/SMTP password or AI key to a host taken from the request.
  - The Mikrotik host guard runs only at save (`services/mikrotik/artifacts.js:35-76`), with a
    DNS-rebinding window, and jump targets allow RFC 1918 addresses.
- **Impact:** from a vendor-hosted VM this reaches cloud metadata (169.254.169.254), the
  Docker host and neighbouring customers.
- **Fix:** one shared outbound guard: resolve, pin, reject private, link-local and metadata
  addresses, and re-check on every redirect hop. `services/mapLink.js` is already the model to
  follow. Effort M.

**S16 Cross-subdomain CSRF.** Medium; High if customer subdomains share a parent domain · P0
- **Where:** `SameSite=Lax` (`auth/instance.mjs:250`); no Origin check on `/api/*`
  (`middleware/cors.js`); a global urlencoded parser (`app.js:118`).
- **Impact:** sibling subdomains are same-site, so a form on a neighbouring tenant can POST to
  `update-account`, which leads into S6.
- **Fix:** reject unsafe methods whose `Origin` is not `APP_PUBLIC_URL`; drop the urlencoded
  parser; use `__Host-` cookies. Effort S.

**S17 ✔ `/uploads/:name` is an unauthenticated bearer URL, publicly cached for a year.** Medium · P0
- **Where:** `app.js:126-177`; `Cache-Control: public, max-age=31536000, immutable` at `:153`;
  `nginx.conf:42-49`.
- **Impact:** ex-employees, banned users and forwarded mail keep access forever. If customers
  share an S3 bucket, one instance can presign another's objects (`services/storage.js:130-139`).
- **Fix:** authorize through the owning entity or use short-lived signed URLs; send
  `private, no-store`; one bucket or prefix plus credentials per customer. Effort M.

### 1.3 Other authorization gaps

**S18 Medium, P0/P1:**
- Service plans sent to clients reveal other customers' names and ids and hidden prices
  (`controllers/finances/servicePlan.js:33-66`, `approval.js:242`, `external/approval.js:36`).
- The works archive ignores ticket scope for staff on the "own" tier (`controllers/work.js:539-580`).
- Knowledge base:
  - staff can widen their own visibility through `categories` in `update-account`
    (`user.js:1834`, `helpers/knowledgeNoteVisibility.js:75-99`);
  - clients see internal, unapproved and flagged notes tagged with their company
    (`knowledgeNoteVisibility.js:64-72`);
  - `knowledge.manage` can hard-delete notes it cannot see (`controllers/knowledgeNote.js:376-386`).
- MCP keys are global, never expire, and can be minted by `settings.manage` holders without
  `ticket.readAll` (`routes/mcp.js:43`, `services/mcp/ticketSource.js:52-58`,
  `controllers/mcpKey.js:56`).
- The Telegram shared secret can act as any linked user, and the legacy routes take the actor
  from the query (`services/telegramActor.js:82-116`, `routes/internal/ticket.js:106-110`,
  `user.js:73-77`, `auth.js:253`).
- `isEndUser` is tri-state: `null` keeps client rights but gets staff-wide data
  (`controllers/user.js:824,1083` vs truthiness in `work.js:580`, `company.js:33,69`,
  `formData.js:12`).
- Responsibles are unchecked on update and process (`assertResponsiblesMayPerform` is called
  only at `ticket.js:930`), so another company's client can be made a responsible and gain
  access.

**S19 Low, P1:**
- `ticket.add` accepts client-supplied `state`, `source`, `deadline` and `customFields`
  (`ticket.js:1009-1013`).
- `/form-data/companies` is open to any staff member (`formData.js:12-16`).
- Approval tokens outlive the signer's authority (`external/approval.js:45-54`).
- Users can approve their own absences (`absence.js:226-262`).
- Clients can share templates across companies (`ticketTemplate.js:204-230`).
- Pulse leaks `ticketRev` (`pulse.js:48-52`); `X-Pulse-Cursor` is sent on anonymous responses.

### 1.4 Hardening

| ID | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| S20 | M | Login throttling is bypassable. HD's limiter guards only `/api/login*`, while `/api/auth/sign-in/email` gets 3 per 10 s per IP. Behind a TLS proxy, better-auth sees a multi-valued X-Forwarded-For and puts every client in one bucket, so reset, 2FA and magic links become a tenant-wide lockout. No per-account backoff. | `routes/internal/auth.js:57-104`; `nginx.conf:38`; `@better-auth/core/utils/ip.mjs:188` | `advanced.ipAddress.trustedProxies`, per-account backoff, S8 allow-list |
| S21 | M | The default install is `http://<ip>:8080` on all interfaces, so the cookie is not Secure. HSTS is set nowhere (`app.js:97` assumes nginx sets it). | `deploy.sh:110-111`; `nginx.conf:66-72` | https-only installer, HSTS |
| S22 | M | The 2FA policy is off by default, applies only to `isAdmin` and only when a session is created. There is no step-up auth for key minting, role grants or impersonation. | `models/preferences.js:260-265`; `hooks.js:169-181` | permission-based policy, on for new tenants |
| S23 | L | Revocation gaps: deactivating a company doesn't revoke sessions (`revokeAllForCompany` is never called); keys don't expire; a Telegram binding survives a password reset. | `services/authSessions.js:134-145` | revoke on deactivate; key expiry |
| S24 | M | DOMPurify's default config keeps `<style>`, `<form>` and `<input>`, and the CSP allows `img-src https:`. E-mail HTML can therefore exfiltrate DOM attributes from staff sessions via CSS. | `Ticket/View/Sections.jsx:205,221,313` | `FORBID_TAGS`; tighten `img-src` |
| S25 | M | CSV/XLSX exports allow formula injection, and CSV quoting is broken. | `Report/export.ts:43-64`; `ReportExportMenu.tsx:167-205` | prefix `= + - @`; a CSV library |
| S26 | M | The app connects to MongoDB as root, with server-side JS on; the docs suggest LAN exposure. | `compose.yml:32-33`; `docs/deployment.md:127-139` | a `readWrite` app user; `--noscripting` |
| S27 | M | Supply chain and containers: `curl get.docker.com \| sh` as root; tags instead of digests; code writable by the runtime user; no `cap_drop`, `no-new-privileges` or `read_only`; `/api/bot` and `/api/gateway` reachable from the internet; the whole `.env` goes to the backend. | `deploy.sh:39`; Dockerfiles; `routes/index.js:101,108` | pin digests; harden compose; deny those paths at nginx |
| S28 | L | Driver messages reach clients (e.g. E11000 with key values); `next(error)` runs after the response; `/api/app-version` needs no login. | `middleware/errorHandling.js:46-54,145-147` | generic 5xx with a request id |
| S29 | L | Crypto nits: the GCM tag length isn't pinned; client strings starting with `v1:` are stored verbatim; no AAD; artifacts fall back to plaintext; the download code is an unsalted sha256 of 6 digits. | `services/crypto/secretBox.js:75,85`; `helpers/preferencesSecrets.js:72` | as listed |
| S30 | L | Accounts can be enumerated by timing, and `X-Response-Time` is exposed. | `controllers/auth.js:89-92`; `middleware/performance.js:43` | dummy hash; drop the header |

---

## 2. Hardcoded: F1lab and Russia

### 2.1 F1lab identity and data flows

**H1 ✔ Outside `NODE_ENV=production`, every e-mail goes to the owner's personal mailbox.** High · P0
- **Where:** `backend/utils/mailGuard.js:23`: `DEV_MAIL_RECIPIENT || "<owner>@f1lab.ru"`. It
  applies when a notification is saved (`models/notification.js:88-109`), at send
  (`services/mail/send.js:54-69`) and to the settings test mail (`services/mail/check.js:105`).
- **When it switches on:** the prod image is safe (`backend/Dockerfile:26`). Any other way of
  running the backend redirects all mail to F1lab:
  - `node app.js` or pm2/k8s without the variable;
  - `pnpm start`;
  - a staging VM;
  - a `NODE_ENV=` line in `.env` (`env_file` overrides the image ENV).
- **Impact:**
  - the customer's users receive nothing, yet the test button says "sent";
  - F1lab receives their data *and working login links, reset links and OTP codes*.
- **Fix:** no default address; an explicit sandbox flag that requires one; otherwise drop and
  log. Don't tie it to `NODE_ENV`. Effort S.

**H2 ✔ F1lab's Sentry DSN, with `sendDefaultPii: true`, is in every build.** High · P0
- **Where:** `frontend/src/main.jsx:12-17`.
- **Impact:**
  - the bundled CSP (`connect-src 'self'`) blocks it today, so in practice there is **no
    working error tracking at all**;
  - serving the build through any other web server sends customers' errors, IPs and URLs to
    F1lab's project in the EU, a cross-border transfer.
- **Fix:** a per-instance DSN, empty by default, with PII off. Effort S.

**H3 ✔ The F1Lab brand is in everything customers' users see.** High · P0
- **Auth e-mails:** `auth/hooks.js:39,108,111,122,208,211,224,267,283`, i.e. the signature
  «Команда F1Lab» and subjects like «портал F1Lab Helpdesk».
- **Notifications:** 14 subjects `[F1-HD-${num}]` and 8 signatures in
  `middleware/notifications.js` (e.g. `:488`, `:505`).
- **Web shell:**
  - `frontend/index.html:23` (title);
  - `public/manifest.json:2-3`;
  - `layout/Footer.jsx:80`;
  - the favicon and app icons are the F1 logo;
  - page titles «F1 HD | …»;
  - admin placeholders «Служба техподдержки «F1»» and «ООО «Ф1 Лаб»».
- **What exists today:** the only white-label setting is `Preferences.contacts {title, tel,
  email, address, logo}` (`models/preferences.js:151-162`), and the logo replaces only the
  navbar and login wordmark.
- **Fix:** Preferences for product name, subject prefix (anchored, see S3), signature, icons
  and manifest served from settings, and a brand colour. Effort M.

**H4 ✔ AI prompts rename the customer's service desk to F1Lab.** High · P0
- **Where:** `backend/prompts/callSummary.js:11,28` (`SUPPORT_COMPANY = "F1Lab"`, «всегда
  исправляй на «F1Lab»») and `prompts/transcription.js:9`.
- **Impact:** summaries written into customers' tickets carry the wrong company. This
  corrupts their data, not just the look.
- **Fix:** use `contacts.title`, and omit the sentence when it is empty. Effort S.

**H5 ✔ The role seed was dumped from F1lab production.** High · P0
- **Where:** `backend/scripts/roles.catalogue.json:156-160,192-196,211-212,254-255,268-269`.
- **What it contains:** 12 F1lab staff e-mails, 2 F1lab client e-mails, and F1lab-specific
  roles such as `klient-ofis-menedzher` and «Сторонний исполнитель: без указания работ».
- **How it spreads:** it seeds every new instance (`services/bootstrapSeed.js:30-53`) and ships
  in the image. `scripts/dumpRoleCatalogue.js:101` regenerates it from the dev DB, which is a
  prod copy.
- **Fix:** a curated product catalogue without `members` or `matches`; keep F1lab's dump
  private. Effort S.

**H6 Ticket numbers continue F1lab's counter (45926).** Medium · P0
- **Where:** `models/ticket.js:12`.
- **Fix:** default to 1, or ask in the installer. Effort S.

**H7 F1lab infrastructure, people and clients are in the repo and the image.** Medium · P0 (for distribution)
- `sync-dev-db.sh:31-32` (prod and jump host, SSH user) and `docs/deployment.md:133` (LAN IP).
- `backend/package.json:23-30` (repository URLs).
- `scripts/seedDemoConversations.js:207,298` (F1lab contacts).
- Client names in comments, tests and docs: `Report/SignatureRoute.tsx:18`,
  `validations/company.test.js:13`, `docs/ux-ui-guide.md:2226`.
- A real support line in `services/staffContacts.test.js:41-44`.
- **Fix:** keep dev tooling and internal docs private, scrub the fixtures, and ship images
  instead of the repo (O1). Effort S.

**H8 The product name and look are fixed.** Low · P1
- The «HelpDesk» wordmark (`components/app/BrandMark.tsx:50`) and «HD» in about 56 strings
  across 23 files.
- RouterOS snippets named `hd-mgmt` and `hd-api` (`Mikrotik/SetupHelp.jsx:72-83`).
- The F1 teal `#00bc8c` (`styles/tailwind.css:33`, `mail/approvalEmailTemplate.js:24-35`).
- A mascot image of unknown licence (`public/error-emoji.png`).

**H9 Policy constants live in code.** Low · P2
- Magic link 30 min, login code 15 min, session 14 days (`auth/instance.mjs:391`,
  `auth/config.js:38,48`).
- In-app notifications kept 90 days.
- Rate limits.
- Default package 12 h × 1000 (`ServicePlan/Form.jsx:108`).

### 2.2 CIS market assumptions

**C1 ✔ Currency is RUB only.** High · P0 for the first non-Russian customer
- **Where:**
  - `frontend/src/util/format-string.js:1-6` (`currency: "RUB"`);
  - «₽» in 15 frontend files (reports, exports, service plans, user form);
  - `backend/services/reportApprovalNotifications.js:61,246,360` (client approval mail).
- **Fix:** `Preferences.currency` (ISO 4217) and one money formatter per side. Effort M.

**C2 Phone numbers are +7-only, and the pending 30.09 spec stays Russia-first.** High · Now (fix the spec)
- **Today:**
  - `components/app/PhoneInput.tsx:8-30,59` forces a Russian mask and truncates +375, +998,
    +996, +994 and +992 numbers;
  - caller ID calls `phone(…, {country:"RU"})` (`services/callerIdentityService.js:14-26`),
    which rejects Kazakh +7 7xx numbers;
  - caller ID also depends on one telephony provider's Russian field labels.
- **The spec** (`docs/superpowers/specs/2026-09-30-phone-normalization-design.md:149,201,231,361`):
  - any number without "+" is read as Russian, so Belarus «8 029…», Kyrgyzstan «0555…» and
    Azerbaijan «050…» become wrong +7 numbers, and Uzbekistan «90 123 45 67» becomes +90
    (Turkey);
  - the caller-ID body scan accepts only `7[3489]…`;
  - libphonenumber is out of scope.
- **Fix:** an org default country plus `libphonenumber-js` in all three copies. Effort M.

**C3 The production calendar defaults to Russia; five CIS countries are unsupported.** High (KG/AM/AZ/TJ/MD), Medium (KZ/BY/UZ) · P0 for the pilot's country
- **Where:**
  - `models/preferences.js:222-229`: on by default with `country:"ru"`;
  - `validations/preferences.js:83-86`: only ru, by, kz and uz are allowed;
  - the sources are xmlcalendar.ru and isdayoff.ru (`services/productionCalendar/fetch.js:153,159`);
  - the only bundled snapshot is `ru-2026`;
  - the pre-holiday day is shortened by a fixed −60 min (`services/workCalendar.js:281-282`).
- **Impact:** a new non-Russian tenant silently runs on Russian holidays. That affects norm
  hours, overtime and holiday pay, approval deadlines and stale-ticket thresholds.
- **Fix:** set the country at provisioning; keep the calendar off when the country is
  unsupported; add yearly calendars (bundled or uploaded). Effort M.

**C4 Timezone defaults to Moscow; jobs keep the old zone until a restart.** Medium · P0 (provisioning)
- **Already configurable:** the zone is IANA per org, person, company and subdivision.
- **Moscow default:** `models/preferences.js:27`, `utils/datetime.js:8`, `format-date.js:13`
  and others. The installer and bootstrap never ask.
- **Jobs:** nightly jobs and routine tasks bind the org timezone when they are registered
  (`app.js:497-509`, `middleware/taskManager.js:17-25`), and saving a new zone doesn't
  re-register them.
- **Texts:** rate-limit messages print «МСК +N» (`routes/internal/auth.js:19-55`).
- **Fix:** ask at provisioning; re-register jobs on save; use neutral «UTC+5» offsets. Effort S.

**C5 Supplier tax IDs are validated as Russian ИНН/КПП.** Medium · P1
- **Where:** `validations/inventory/supplier.js:19-29`.
- **Impact:** it rejects Belarus УНП, Uzbek and Kyrgyz ИНН and Armenian IDs.
- **Fix:** a generic tax ID with per-country validation. Effort S.

**C6 Russia-bound integrations.** Medium · P1/P2
- **PRO32 Connect** is hard-wired to its API host (`controllers/pro32Connect.js:24` and 4 call
  sites in `ticket.js`), with no provider abstraction.
- **Yandex AI and SpeechKit** are fixed to the Russian-region endpoints (`services/aiService.js:16-17`,
  `speechToTextService.js:26-35`).
- **Language:** speech-to-text always sends `ru`, and the prompts require Russian output.
- **AI availability:** OpenAI and Anthropic are unavailable from Russia and Belarus, where only
  DeepSeek, Yandex or "local" work. There is no GigaChat.
- **Taxi:** the operator list is .ru only.

**C7 No i18n layer.** Medium · P2 (but stop adding Russian-valued enums now)
- **Infrastructure:** none. There is no library, no catalogues and no locale model, and
  `<html lang="ru">` is fixed.
- **Strings:**
  - 544 of 700 frontend files contain Cyrillic literals, about 3.8k strings;
  - about 1.6k backend literals: 5 e-mail composers, Telegram, in-app texts, 6 AI prompts, and
    errors in two languages without codes.
- **Data:** Russian labels are stored as enum values: ticket state, priority and source
  (`models/ticket.js:112-123,196-206,246-261`), with 99 state literals in logic, including
  tg-service.
- **Formatting and parsing:** `toLocale*("ru")` everywhere, 9 hand-rolled plural helpers,
  Russian reply markers in mail parsing.
- **Assessment:** a Russian UI is fine for most CIS buyers. A second language is about 8–12
  person-weeks.

**C8 Presence and absence catalogues live in code.** Medium · P2
- **Where:** 2 copies each (`utils/workStatuses.js`, `utils/absenceTypes.js` and their frontend
  twins).
- **What's in them:** Russian timesheet codes.
- **Impact:** customers can't add or rename types.

**C9 The MSP model is hard-wired beyond the module switches.** Medium · P1
- **Already switchable:** finances, time tracking, inventory, KB, Mikrotik, messaging and AI
  (`middleware/modules.js:32-55`).
- **Fixed:**
  - every ticket needs a company;
  - staff contacts are always hidden from clients (`middleware/hideStaffContacts.js:12-35`),
    while an internal-IT customer wants its engineers reachable;
  - exports are titled «Отчёт по оказанным услугам».
- **Fix:** an "internal IT" preset with a staff-contacts switch. Effort M.

---

## 3. Acceptable internally, not as a product

### 3.1 Distribution and releases

**O1 Install means `git clone` and a build on the host.** High · P0
- **What ships:** every host gets the full source, the full history, `docs/superpowers`
  (2.1 MB of internal plans) and the tests.
- **Versioning:** the version has been 2.0.1 since `8d9aaae` (2026-08-05, 79 commits ago), with
  no tags. `/health` reports `1.0.0` (`routes/public/health.js:29`), so the frontend's
  "new version" banner can never fire.
- **Builds drift:** base images float and are re-pulled on every deploy; `mongo:8.0` is never
  pulled again. Every host needs npm and Docker Hub access.
- **No changelog.**
- **Fix:** CI builds versioned images with the version and commit baked in, pushes them to a
  registry, and compose references them by digest. Customers get compose plus a `.env`
  template only. Publish release notes. Effort M–L.

**O2 ✔ No licence.** High · P0
- **Where:** `"license": "ISC"` in `backend/` and `tg-service/package.json`; no LICENSE or EULA.
- **Impact:** self-hosted buyers would receive the source under an open-source label.
- **Fix:** `UNLICENSED`, a proprietary LICENSE and EULA, and images (O1). Effort S.

**O12 Quality gates can't protect a fleet release.** Medium · P0
- There is no CI at all.
- Lint and typecheck: backend eslint is broken; frontend typecheck is red; backend `tsc`
  checks only models and types.
- Tests: 64 backend test files (~8k lines) against ~77k lines of code. Nothing covers the
  controllers (23k lines), `notifications.js`, `emailHandling`, the outbox, `migrate.js` or
  `deploy.sh`. The frontend has no `test` script.
- Tooling hygiene: husky hooks are gitignored; the backend has two lockfiles;
  `frontend/build.err` is tracked.
- Six files are over 1,500 lines (`controllers/ticket.js` 2,965; `middleware/notifications.js`
  2,346; …).
- **Fix:** a CI pipeline (lint, typecheck, tests, build, image, audit, a migration dry-run on a
  prod-shaped dump) as the only path to a release. Effort M.

### 3.2 Instance lifecycle: provisioning, keys, migrations, backups

**O3 ✔ Every stack has the same identity.** High if stacks share hosts; moot for strictly one VM per customer · P0 (decision)
- **Where:** `compose.yml:13` (`name: hd`); the external volumes `hd_data`, `hd_uploads` and
  `hd_mongodb_config`; the fixed-name volumes `hd_storage` and `hd_tg_service_data`; the
  `hd-*:prev` rollback tags, host ports 8080/27017, and the host-wide prune in `deploy.sh`.
- **Resources:** no memory or CPU limits, and each mongod sizes its cache from host RAM.
- **Secrets:** `MSG_GATEWAY_TOKEN` is not generated per instance.
- **Impact:** a second customer's `./deploy.sh` recreates the first customer's containers and
  shares their uploads, Mikrotik artifacts and backups.
- **Fix:** derive the project, volume, tag and port names from an instance id; add limits;
  pin the WiredTiger cache. Effort M.

**O4 ✔ Pruned migrations are not enforced.** High · P0
- **Where:** `backend/scripts/migrate.js:150-160` refuses only an *empty* ledger, and commit
  `3b85eee` removed 27 entries.
- **Impact:** an instance that skips releases silently misses the deleted scripts. The backend
  doesn't refuse to start with pending migrations. There is no down path.
- **Also:** the README still points to the deleted `scripts/mongo-upgrade.sh`.
- **Fix:** a floor id ("upgrade through release X first") and a boot refusal while migrations
  are pending. Effort S.

**O5 ✔ Backups are not disaster recovery.** High · P0
- **Where they live:** `deploy.sh:180-199` writes to `backups/` inside the checkout, on the
  same disk, with no umask (so mode 0644, while `.env` gets 600), unencrypted.
- **Retention:** five are kept, and each rerun after a failed migration rotates out the clean
  pre-migration dump.
- **Not covered:**
  - `.env` and `APP_ENC_KEY` are excluded, and without the key every stored secret and every
    Mikrotik backup is lost;
  - S3 is not covered;
  - `hd_storage` is not external, so `docker compose down -v` deletes the Mikrotik backups.
- **No schedule, no PITR:** Mongo is standalone (the dump runs during writes), and
  `mongodb:27017` is hardcoded in 14 files.
- **Other issues:**
  - the root password appears on command lines;
  - `restore` runs `--drop` without asking and puts the manifest's `DB=` unescaped into `sh -c`.
- **Fix:** scheduled, encrypted, off-host backups; key escrow; S3 coverage; a pinned
  pre-migration copy; restore drills; a `MONGODB_URI` option plus a single-node replica set.
  Effort M.

**O6 The encryption-key lifecycle (the 29.09 incident).** High · Now/P0
- **Where:**
  - `deploy.sh:107` generates `APP_ENC_KEY` instead of carrying over `MIKROTIK_ENC_KEY`;
  - there is no key check at boot (`routes/public/health.js:82` only checks that the variable
    is set);
  - there are no key ids and no re-encryption tool, since `v1` is a format tag;
  - an undecryptable secret makes *every* settings save return 500
    (`controllers/preferences.js:122,496,525`), a lockout;
  - the gateway silently receives empty secrets.
- **Fix:**
  - carry the old key over;
  - an encrypted canary checked at boot;
  - key ids plus a re-encryption script;
  - an undecryptable secret becomes "unset" with a 422.

  Effort M.

**O10 Bringing up a tenant is manual.** Medium · P0/P1
- About 10 manual steps per tenant: host and DNS; clone; deploy; TLS proxy and a re-run; bot
  token; S3; then UI-only settings.
- The seed runs only when there are no users, and is neither transactional nor resumable
  (`services/bootstrapSeed.js:92-151`).
- A non-interactive deploy writes `http://<ip>:8080` and `admin@example.com`.
- There is no settings import or export.
- msg-gateway is neither in the repo nor in compose.
- **Fix:** a provisioning manifest or CLI; a resumable seed; a forced first-login password
  change. Effort M.

**O11 Every update is a visible outage.** Medium · P1
- About 40–60 s of 502s per deploy: in-place recreate, a 30 s health-check interval, and nginx
  resolving the backend once (`nginx.conf:34`).

### 3.3 Background jobs, scale, data growth

**O7 ✔ Jobs double-fire and lose work.** High · Now
- **Watchdog:** `app.js:325-367`. `guardedCron` races the job's promise against a watchdog; on
  timeout it releases the lock while the run keeps going.
- **Outbox:** it has no lease (`services/mail/outbox.js:169-224`), so a batch longer than 110 s
  sends mail twice.
- **Shutdown:** it doesn't drain jobs (`app.js:676-694`, exit ≤ 10 s). Mail that was sent but
  not yet marked is sent again.
- **IMAP:** mail is re-imported with no Message-ID dedup.
- **Crashes:** an unhandled rejection in the 02:00 cleanup kills the process.
- **Fix:** claim notifications atomically (reuse the Telegram path's `leaseUntil`); hold the
  lock until the run settles; dedup by Message-ID; drain on SIGTERM; add process-level
  handlers. Effort M.

**O8 Everything runs in one web process.** High (HA and scale-out) · P1
- **Where:** `app.js:226-674`. The process runs IMAP every 20 s, the notification builder every
  10 s, the outbox, the upgrade worker, Mikrotik polling, nightly jobs and routine-task crons.
  Locks, the pulse bus, rate limiters and registries all live in memory.
- **Impact:** any second process doubles e-mails, tickets and router-upgrade steps: scale-out,
  blue/green, a DR standby, or a test host pointed at the same DB. Routine tickets missed
  during downtime are never caught up.
- **Fix:** a worker role with Mongo leases; a stateless web tier. Effort L. Not needed while
  each customer is one small VM with no HA promise.

**O13 Performance and growth.** Medium · P1
- The comment `notifications.pending` query runs every 10 s with no supporting index.
- `/tickets/all-opened` is unpaginated and carries full comments.
- Mikrotik health-check concurrency is 5 against a 240 s watchdog.
- There is no `syncIndexes`, so index sets drift between instances.
- `notifications` (full bodies), `ticketlogs` and outages grow forever.
- The companyLog 90-day cleanup filters on `timeStamp` while the schema has `createdAt`, so AD
  logon history is kept forever (`middleware/cleanupLogs.js:20,34`).
- Ticket delete leaves comments, files, logs and notifications behind.

### 3.4 Observability

**O9 The fleet can't be observed.** Medium · P1
- **Health checks:** the Docker check is a Mongo ping, and the env-checking `/health/ready` is
  unused. `https://<tenant>/health` returns the SPA with 200 even when the backend is down.
- **Metrics and status:** no metrics, no per-job heartbeats, no status endpoint for a fleet
  poller.
- **Errors and logs:** no working error tracking (H2); handled errors are logged twice as raw
  stacks (`errorHandling.js:144-147`); no instance id in logs.
- **Fix:** a token-protected status endpoint (version, commit, migrations, job heartbeats,
  channel and key health) and per-instance error tracking. Effort M.

### 3.5 Privacy, compliance, legal

**L1 ✔ «Диалоги» rely on unofficial clients.** High · P0 (decision)
- **Where:** `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md:26-28,49-52,135-136`.
  Telegram uses a GramJS MTProto *user* session; WhatsApp uses Baileys, an unofficial client
  the spec itself calls a ban risk.
- **Impact:**
  - it is a sold feature carrying ToS and ban exposure for customers' business numbers;
  - the user session sees every chat on the account, and the ignore list is opt-out.
- **Fix:** the WhatsApp Cloud API and the Telegram Bot API (including Business connected
  bots) for the product; keep the user-session adapters out of what is sold, or make them an
  explicit at-your-own-risk option. Effort L.

**L2 No erasure or anonymisation; deletes leave PII behind.** High · P1
- User delete writes the person's e-mail into the workplace notes (`controllers/user.js:1497,1512`).
- Company delete runs a raw `User.deleteOne` per employee. It leaves auth accounts, sessions
  and 2FA rows, and orphans tickets, which causes the known 500 (`company.js:560-568`).
- Ticket delete keeps comments, files, logs and notifications (`ticket.js:2064`).
- **Fix:** an anonymise-in-place service, cascading off-boarding, and a record of each
  erasure. Effort L.

**L3 Copying production to dev and test hosts, unmasked, is documented practice.** High for a SaaS operator · P0
- **Where:** `sync-dev-db.sh:24,52,396-398,471-476`; `docs/deployment.md:141-154`.
- **What it copies:** every collection except preferences and channels, including sessions and
  reset tokens (see S9).
- **How:** the prod root password is read with `docker inspect` and passed on remote command
  lines. The dev compose publishes Mongo, the backend and Vite on all interfaces.
- **Fix:** take it out of the product repo. For vendor use, sync only an anonymised copy that
  drops auth collections and tokens and masks PII. Effort M.

**L4 Impersonation leaves no durable trace.** High · P0
- **Where:** `controllers/impersonation.js:28-90`; `services/impersonation.js:36-50`.
- **Impact:**
  - the only marker is `impersonatedBy` on the session, which is gone after an hour;
  - comments and approvals made while impersonating are recorded as the client's own actions;
  - nobody is notified.
- **Fix:** a persistent audit record; a stamp on the writes made in that session; a notice to
  the target. Effort M.

**L5 No security audit log.** Medium · P1
- Nothing records logins (success or failure), role changes, bans, deletes, settings or secret
  changes, key issuance or exports. The only trace is `lastLogin` (`controllers/auth.js:161`).
- **Fix:** an append-only audit collection with an admin view and a retention setting.
  Effort M.

**L6 Privacy controls.** Medium · P1
- There is no privacy notice, terms or consent in the UI; the only consent text is the
  site-widget `consentText`.
- There are no retention settings, and the outbox keeps full e-mail bodies forever.
- The AI context includes secret-flagged KB notes (`services/knowledgeBaseContext.js:222`),
  although the MCP path excludes them (`services/mcp/knowledgeSource.js:23`).
- Once AI is on, every feature defaults to on and new tickets go to the provider automatically.
- The HIBP password check is always on and not disclosed.

**L7 Data residency (152-ФЗ; KZ, UZ and BY localisation rules).** Medium · P0 (offer design)

One instance per customer makes in-country hosting possible. Make the hosting region part of
the offer, and disclose or allow switching off each outbound flow per instance:

| Flow | Data | Default | Switch |
|---|---|---|---|
| LLM (OpenAI, Anthropic, DeepSeek, Yandex, local) | ticket text (sent automatically on create), comments, applicant, company, KB notes, images, document text | off | `ai.isActive`, per feature, right `ai.use` |
| Speech-to-text (OpenAI, Yandex, local) | call recordings (automatic for telephony mail) | off | `ai.speechToText.isActive` |
| Telegram Bot API | ticket title, company, applicant, comment text; presence board | off | `TG_TOKEN`, `notify.byTelegram`, `statusBoard` |
| «Диалоги» gateway | conversations, media, phone numbers | off | `modules.messaging` |
| SMTP/IMAP; S3 | mail; attachments | off; local volume | settings; `S3_*` |
| Production calendar (xmlcalendar.ru, isdayoff.ru) | country, year | **on** | `productionCalendar.isActive` |
| HIBP | 5 hex characters of the password's SHA-1 | **on** | none |
| Map short links (Yandex, 2GIS) | the link | on company save | none |
| PRO32 | client's full name; API key in the query string | per-engineer key | `getScreen.isActive` (the create route ignores it) |
| NVD, MikroTik upgrade server | CPE / version | off | `modules.mikrotik` |
| Browser → F1lab Sentry | errors, PII | in the build (blocked by CSP) | none (H2) |

### 3.6 Product completeness

**L8 No customer-facing documentation.** Medium · P0/P1
- `docs/` holds developer notes in mixed RU/EN.
- Missing: an admin guide, a user guide, an API reference for `/api/external` and MCP,
  release notes, a support contact and a status page.

**L9 No data portability.** Medium · P2
- There is no import from other helpdesks and no per-company or per-person export; only a
  full mongodump.

**L10 No commercial hooks.** Medium · P1 (depends on pricing)
- There is no licence, plan, seat, trial or metering.
- The module and AI switches are editable by the customer's admin
  (`middleware/modules.js:15-81`), so they can't enforce a plan.
- **Fix:** plan gating from vendor-controlled env or a signed licence, read by the same gates.
  Effort M.

**L11 First run is bare.** Medium · P1
- The seed works, but settings start empty: no categories, no templates, every module off.
- Inventory reference data comes only from CLI seeds.
- There is no first-login onboarding, and the seeded admin must change the password
  (see S11, O10).

**L12 Polish.** Low · P1
- 144 English technical `AppError` messages, plus a raw `error.message` fallback, show up in
  about 40 toasts.
- Legacy mail templates insert `ticket.title` and `comment.content` unescaped
  (`notifications.js:1858,1899`).
- `robots.txt` allows indexing.
- `Permissions-Policy geolocation=()` breaks the "taxi from my location" feature.
- Tracked clutter: `.claude/plans`, `build.err`, an unused font, an unused `xlsx` in the
  frontend.
- The NVD "not endorsed" notice is missing.

---

## 4. What is already solid

- **Guard coverage:** 368 route handlers.

  | Guard | Handlers |
  |---|---|
  | Permission gate | 268 |
  | `isNotClient` | 21 |
  | Scoped in the controller | 39 |
  | Own credential (bot, gateway, MCP, API key) | 26 |
  | Public by design | 14 |

  `checkPermissionCoverage.js` confirms all 60 actions are checked and all 64 gates are
  mounted, and `inventoryMount` refuses to start on an ungated route.
- **Tickets:** list, card, archive and bulk actions all use `ticketListFilter`/`ticketInScope`,
  and the gate and the controller re-read with the same filter. Comments go through
  `requireTicketAccess`.
- **Roles:** changes go through `assertNotEscalating`/`canGrant`, with audience enforced on
  assign and the last admin protected.
- **Mass assignment:** no `req.body` spreading, and strict schemas.
- **Query injection:** the Express 5 "simple" query parser neutralises `?x[$ne]`; only JSON
  bodies remain (S5). Search regexes are escaped and capped, and sorts are allow-listed.
- **Secrets at rest:**
  - AES-256-GCM with a random IV;
  - envelope encryption for Mikrotik artifacts;
  - company and MCP keys are sha256 of 256-bit values;
  - magic-link and e-mail codes are hashed; TOTP is encrypted;
  - secrets are masked in API responses.
- **Service secrets:** compared in constant time; an empty token means deny.
- **Sessions:**
  - the cookie is httpOnly with a `__Secure-` prefix, and there is no cookie cache, so
    revocation is instant;
  - passwords use scrypt, with the bcrypt legacy verified by prefix;
  - e-mail links are built from `APP_PUBLIC_URL`, never the Host header;
  - reset revokes sessions, and a ban revokes sessions and is also checked on every request.
- **Short-lived codes:** the impersonation and Telegram pairing codes are 256-bit, hashed,
  short-lived and single-use.
- **Frontend and images:**
  - a CSP without inline scripts, `frame-ancestors 'none'`, nosniff, and a sandbox CSP on
    uploads;
  - no source maps;
  - non-root images and a sound `.dockerignore`;
  - `.env` is chmod 600;
  - no secrets in git history, patterns scanned, apart from S14.
- **Outbound safety:**
  - Telegram output is escaped, and nodemailer strips CR/LF;
  - `mapLink` has an exemplary SSRF guard;
  - RouterOS uses the array-argument API, and there is no `child_process` or `eval` on request
    paths.
- **Defaults:** AI, modules, Telegram and «Диалоги» are off by default. There is no phone-home.
  Every direct dependency is permissively licensed (no GPL, AGPL or SSPL).
- **tg-service:** validates env at start, leases its jobs, keeps a delivery ledger, and has a
  real `/health`.
- **Time:** timezones are IANA at every level, crons run in the org zone, and storage is UTC.
  The calendar already supports ru, by, kz and uz.

## 5. Roadmap

Each workstream becomes its own spec, then plan, then implementation.

| Gate | Workstream | Findings | Size |
|---|---|---|---|
| **0 · Now** | **W1 Security hot-fixes** — S1–S6 and S10–S12 in code; rotate the credentials from S14; multer and mailparser upgrades; the S7/S8 path allow-list (cheap now); O6 key carry-over and 422; O7 leases, drain and dedup; the C2 spec correction | S1–S8, S10–S12, S14, S15 (part), O6, O7, C2 | mostly S, a few M |
| **1 · First customer (pilot, vendor-hosted)** | **W2 De-F1lab and white-label** — no mail sink, opt-in Sentry, brand settings, AI company name, neutral roles, counter default | H1–H8 | M |
| | **W3 Release engineering** — CI, versioned images in a registry, release notes, a customer bundle without source, licence/EULA, repo hygiene | O1, O2, O12, H7, L3 | M–L |
| | **W4 Instance lifecycle** — a provisioning CLI (instance id, country, timezone, currency, https, proxy mode, forced password change), key canary and rotation, migration floor, backups/DR, resource limits, a least-privilege Mongo user | O3–O6, O10, S21, S26, C4 | L |
| | **W5 Auth and hosted-security hardening** — cookies only (drop bearer), hashed tokens, the SSRF guard, Origin/CSRF, authorized uploads, the remaining authorization gaps, rate limiting behind the proxy, the 2FA policy | S9, S13, S16–S20, S22–S25, S27–S30 | M–L |
| | **W6 Privacy minimum** — impersonation audit and notice, a security audit log, privacy/terms links, AI data-flow disclosure, a residency statement | L4–L7 | M |
| | **W7 CIS minimum for the pilot's country** — currency, phone country, calendar country and bundling, tax id | C1–C3, C5 | M |
| **2 · Sell broadly** | **W8 Fleet operations** — status endpoint, per-instance error tracking, alerts, zero-downtime updates, config export/import | O9, O11 | M |
| | **W9 Jobs and data growth** — worker role with leases, catch-up, indexes, retention/TTL, cascading delete | O8, O13 | L |
| | **W10 Product completeness** — onboarding, an internal-IT preset, customer docs and API reference, commercial hooks, erasure and export | L2, L8–L12, C9, H9 | L |
| | **W11 «Диалоги» on official APIs** | L1 | L |
| **3 · Beyond a Russian UI** | **W12 i18n** — locale model, catalogues, enum codes, formatters, per-locale templates and prompts | C6–C8 | L (8–12 weeks) |

**Order:**
1. W1 immediately.
2. W2 and W3 in parallel; both are mostly mechanical.
3. W4 and W5 before any customer data enters a vendor-hosted VM.
4. W6 and W7 scoped to the pilot.
5. Gate 2 as demand grows.

W9 is only needed once there is a promise of HA or scale-out. Starting now, don't add new
Russian-valued enums or new F1lab strings; that keeps W2 and W12 from growing.

## 6. Decisions needed from the owner

1. **Hosting topology:** strictly one VM per customer, or several customers' stacks per host?
   Several per host makes O3 a blocker and raises S13 and S26.
2. **Domain model:** do customer subdomains sit under one vendor domain? If so, they are
   same-site: S16 becomes High, and cookie scope needs care.
3. **Self-hosted sales:** yes, later or never? This decides how much source protection and
   licence enforcement W3 and L10 need.
4. **Who operates the instances:** if F1lab does, it acts as data processor. That needs a
   support and impersonation policy, and production copies to dev stop (L3).
5. **«Диалоги»:** sell with unofficial clients as an explicit at-your-own-risk option, or wait
   for the official APIs?
6. **First country after Russia:** this sets the scope of W7 and the hosting region.
7. **Pricing unit** (per agent seat, per module or flat): this shapes L10.

## 7. Not covered / to confirm

- **Not verified at runtime:** nothing was executed. The following need checking on
  production:
  - roles that grant `user.manage`, `user.manageAccess` or `user.impersonate` to non-admins;
  - plaintext legacy API keys;
  - better-auth `member` id types;
  - whether `identifyApplicant` is on;
  - backup file permissions;
  - the X-Forwarded-For shape at the external proxy;
  - whether the S14 router details are live;
  - whether Sentry receives anything.
- **Not in this repo:** msg-gateway and the MAX adapter.
- **Out of scope:** a penetration test, a load test, the external TLS proxy configuration, and
  the legal texts (EULA, DPA, privacy policy).
