# W5a Auth and Session Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Move browser authentication to signed cookies while preserving valid client sessions and Telegram links, with a one-time staff-only session cutover.

**Architecture:** Keep better-auth storage, signing secret and cookie identity unchanged. Remove bearer transport, forward cookie headers, and retain non-secret per-session compatibility markers for old bundles. Keep machine identity separate, with browser Origin checks before parsing and independent login throttling.

**Tech Stack:** Node 24/CommonJS + ESM better-auth 1.6.26, Express 5, MongoDB/Mongoose, React/Vite/TypeScript, grammY; node:test and pnpm.

**Spec:** `docs/superpowers/specs/2026-11-07-w5a-auth-session-compatibility-design.md` (owner approved 2026-11-07).

## Global Constraints

- Read AGENTS.md and relevant project docs before changing code; compare analogous implementations. Spec controls scope.
- No commits, staging, stash or push. Work in the isolated W5a checkout, preserving the mirrored unrelated MCP/Proxmox changes. Do not modify production or existing dev containers/volumes.
- Preserve BETTER_AUTH_SECRET, cookie names/prefix/attributes, existing client sessions, user IDs, passwords/TOTP, Telegram bindings, channel identities and integration credentials.
- Staff is exactly isEndUser === false. Client roles and null/missing audience remain client-scoped. Revoke staff-owned and staff-impersonation sessions only at the recorded one-time cutover.
- No usable session token in response JSON/headers or newly persisted localStorage. Dedicated API/MCP credentials keep their separate transport.
- Old tabs continue with existing cookies. Do not clear shared compatibility keys, add auth-migration reloads, or ignore intentional logout. Existing outage recovery and natural expiry remain.
- Keep public auth allow-list closed; limits remain anonymous/auth 100 KB, default 10 MB, editor 50 MB.
- No new UI or visible copy without approved light/dark desktop/mobile mockups. Preserve existing components and the error-page cat. No new mandatory MFA policy in W5a.
- pnpm only; no dependency upgrades needed. Tests on host are focused, with ulimit -c 0. Full backend suite only in check.sh container. Do not expose secrets in reports.

## Review Focus

1. Old bearer header plus a valid cookie, including stale headers, rollback and two simultaneously open bundles (Tasks 1, 2, 6).
2. Client targets of staff impersonation versus those clients' independent sessions; retry after fresh staff login (Task 3).
3. Raw plugin TOTP responses, refresh and logout headers; setup codes must remain legitimate one-time outputs (Task 1).
4. Browser login/CSRF exceptions must not become a cookie-to-machine bypass; streamed auth bodies and service multipart requests (Task 4).
5. Same-NAT clients, spoofed forwarding headers, unknown accounts and existing bot links during a cutover (Tasks 5, 6).

## Execution order

Tasks 1–5 receive task-scoped reviews; disjoint work ran concurrently behind explicit shared-file barriers recorded in the SDD ledger. Task 6 integrates verification and documentation. The owner approved the spec and continuing the established subagent workflow; do not request another routine plan approval. Record rulings in the plan's SDD ledger.

### Task 1: Cookie-only backend and response contract

**Files:** Modify `backend/auth/instance.mjs`, `backend/auth/bootstrap.js`, `backend/controllers/auth.js`, `backend/controllers/me.js`, `backend/controllers/impersonation.js`, `backend/middleware/attachSession.js`. Create `backend/services/browserSession.js`, its test, `backend/auth/browserSession.integration.test.js`, controller/session wiring tests as needed.

**Interfaces:** Produce `sessionMarker(sessionId): string`, `forwardSessionCookies(headers, res): void`, `browserSessionPayload({ sessionId, expiresAt, userId }): { token, expiryDate, userId }` in browserSession.js. Marker is `cookie.<sessionId>`; it is public session identity, never a credential. Reject empty IDs. It must fail old bearer HMAC verification. Forward multiple Set-Cookie entries by append without losing prior response cookies; do not forward set-auth-token. Refresh reads use returnHeaders/asResponse supported by installed better-auth, one request identity.

- [x] Write RED tests with real installed better-auth and memory adapter: cookie survives removal of bearer and stale Authorization; bearer alone/raw DB token fails; marker survives old backend rollback without overriding cookie; markers differ between sessions.
- [x] Run focused tests and observe missing behavior, then remove bearer import/plugin, implement helpers and wire custom response paths and raw plugin response sanitization. Preserve reset tokens, TOTP setup/backup codes and callbacks. Cover nested session/user token leakage explicitly, not only top-level login.
- [x] Test real cookie rotation and clearing headers through attachSession/logout, including existing cookies on the response, denied users and impersonation caps. Preserve valid old session values/IDs. Do not change cookie attributes or adapter schema.
- [x] Run `node --test auth/bootstrap.test.js auth/browserSession.integration.test.js services/browserSession.test.js` plus touched wiring tests from backend, with core dumps disabled. Record exact commands/results; self-review and report changed files.

### Task 2: Frontend identity, storage and caches

**Files:** Modify `frontend/src/pages/Auth/session.ts`, `pages/Auth/Layout.tsx`, `util/auth.js`, `lib/api.ts`, `layout/Root.jsx`, `store/form-data.ts`, and remaining frontend browser-session Authorization producers. Create focused pure helper tests (`frontend/src/util/browser-session.js` and test) and frontend regression tests using the existing Node test style.

**Interfaces:** Consume Task 1 marker/metadata. `/api/me` already returns sessionId; new code treats returned server user/session as authority. Compatibility helper stores marker under existing token key, preserves legacy expiryDate/userId metadata for old tabs, never extends the old timer artificially, and is not an auth gate. Cache isolation uses confirmed user/session identity, with invalidation at identity changes/logout.

- [x] Write RED cases: cookie-authenticated new shell/Pulse works without storage token, stale local expiry does not POST logout, 401 clears state but 403/429/5xx/network do not, legacy second-tab keys remain present with nonsecret per-session value.
- [x] Remove browser bearer headers from every producer, preserving required Content-Type and machine/API key transports if any. Replace local token-driven gates for Root, auth redirects, navbar/footer and sensitive actions with confirmed user identity. Preserve timezone/preferences and existing old-bundle metadata.
- [x] Cover two-account cache isolation, old storeSession consuming the marker response and old header producers after marker replacement. Eliminate timeout-driven logout rather than adding a new timer.
- [x] Run relevant node tests, frontend typecheck and build. No structural/UI/copy changes; if one becomes necessary, stop that UI portion for a mockup while continuing independent work. Report exact static scan of remaining session credentials.

### Task 3: Durable staff cutover and binding preservation

**Files:** Create `backend/services/staffSessionCutover.js` and test, `backend/scripts/cutoverStaffSessions.js` and test. Modify `backend/scripts/migrate.js`; add `backend/services/telegramContinuity.test.js` using real resolver with injected/stubbed persistence boundaries.

**Interfaces:** Produce `planStaffSessionCutover({ users, sessions, codes }): { sessionIds, codeIds, counts }` as a pure selector and `runStaffSessionCutover({ db, apply, now }): Promise<summary>`. Durable snapshot lives in `authCutovers` with fixed `_id: '2026-11-07-w5a'`; persist IDs and capture timestamp before any delete, using insert-once. Read existing snapshot on retry. Dry run performs no write and reports only counts. Use Mongo native IDs consistently and match string/ObjectId relationships. Script --apply invokes runner; migrate ID `2026-11-07-cutoverStaffSessions` added last.

- [x] RED selection fixtures include staff-owned, staff->client impersonation, independent client sessions, client-admin/manager, null/missing isEndUser and both id types. Assert exact selected IDs and no customer collateral.
- [x] RED interrupted/retry fixtures assert a durable snapshot precedes deletes and subsequent staff sessions survive rerun; dry run writes nothing. Delete only snapshot session/code IDs, never collections/users. Support adminId in impersonation codes.
- [x] Implement selector/runner/script/ledger registration. Keep passwords/TOTP, telegramBot, pairing codes, channels/channelidentities and all external service credentials untouched. Do not run migration against dev/prod database.
- [x] Exercise existing Telegram link with missing linkedAt, ban/unban behavior, browser-session deletion and ordinary profile/notification partial saves. Explicit unlink remains distinct. Run focused cutover/script/Telegram tests and report counts/coverage, no secrets.

### Task 4: Browser Origin policy and bounded raw auth bodies

**Files:** Create `backend/middleware/browserOrigin.js` and test, `backend/middleware/authBodyLimit.js` and test. Modify `backend/app.js`, `backend/auth/bootstrap.js` and authPathAllowList tests as required. Consult `routes/index.js` to inventory machine paths; preserve its pending unrelated additions.

**Interfaces:** Produce `browserOrigin({ publicUrl, allowedOrigins }): ExpressMiddleware`, mounted before auth handler/body parsers. Unsafe browser routes require exact allowed Origin, else exact-origin Referer fallback; reject null/malformed/sibling origins with 403 without clearing sessions. Narrow machine-route classification covers bot/gateway/MCP/external company API and legacy authenticated /tg endpoints; those still require their own credentials and never borrow browser identity. Produce `authBodyLimit({ limitBytes = 102400, timeoutMs = 10000 }): middleware` for allowed raw auth requests, buffering at most limit and replaying an intact stream for toNodeHandler or passing a bounded Web Request to auth.handler through a documented bridge. Do not patch IncomingMessage internals without integration tests.

- [x] Write RED request-level tests: JSON and multipart same-origin mutations, sibling/no-evidence rejection, spoofed machine header no bypass, legitimate service credentials without Origin. Allowed magic-link GET callback remains reachable; disallowed auth paths stay 404.
- [x] Add raw HTTP chunked tests at limit and one byte over, multibyte byte accounting, aborted/slow body cleanup, bounded timeout, CL rejection and successful delivery of untouched body to actual toNodeHandler. Over-limit gets 413, not hang/connection-only failure.
- [x] Implement before-body Origin wiring and bounded raw-body adapter; preserve normal 10/50 MB contracts, no global parser/operator-key cleanup. Do not break old same-origin fetches or /bot multipart.
- [x] Run focused middleware/bootstrap tests and report exact path-classification matrix.

### Task 5: Proxy identity and login abuse limits

**Files:** Create `backend/services/authRatePolicy.js` and test; modify `backend/routes/internal/auth.js`, `backend/auth/config.js`, `backend/auth/instance.mjs`, `backend/services/authPassword.js`, `backend/controllers/auth.js`; add focused password/controller/rate tests. Change frontend nginx config or app trust setup only if needed to implement the documented proxy model, preserving existing deployment topology.

**Interfaces:** Produce pure key/counter helpers plus `createAuthRatePolicy({ now, ...limits })` with explicit clock injection and bounded/expiring state. Keep existing pair limits (10 failed password/code attempts per 15 min), reset/code issuance 3 per hour per normalized account and broad IP budget 50 per hour where already deployed. Add a bounded account cooldown of 1 second doubling to 30 seconds maximum on failed credential checks, never an indefinite account ban; success resets it. Pair throttles remain independent of valid sessions. For better-auth requests forwarded by the app, derive rate-limit IP from trusted Express req.ip, not arbitrary X-Forwarded-For, and constrain direct raw-plugin paths equivalently. Validate TRUST_PROXY_HOPS as nonnegative integer; document variable path/proxy trust limits.

- [x] RED tests: independent clients behind documented proxy chain; forged forwarding does not select another IP; account normalization/IPv6 stable keys; missing email does not throw; NAT users with separate accounts/challenges don't share an accidental global library bucket.
- [x] RED unknown-user password path performs a dummy verification using the installed password verifier and cached dummy hash, returns same credential failure, does not create sessions or log passwords. Real account/ban/TOTP behavior remains.
- [x] Implement counters and wiring, preserving existing response copy/status contracts where possible. No new mandatory 2FA policy or public auth route. If visible text must change, use mockup gate; otherwise keep current text.
- [x] Run focused policy/controller/proxy tests, include cooldown expiry/reset and cache bound tests, then report source of the effective client IP and all limited routes.

### Task 6: Cross-version rehearsal, whole-change review and docs

**Files:** Create `backend/auth/w5aContinuity.integration.test.js`, a focused frontend browser rehearsal script/test using available browser tooling, and amend `docs/deployment.md`, the auth migration doc and approved spec status. Update this plan's ledger with results and rulings. Do not claim closure of remaining W5 findings.

- [x] Use real old-format sessions from the installed library and a local fixture DB/adapter with the candidate backend. Execute client reads, writes, multipart and Pulse before/after cutover; assert staff/impersonation rejection while client sessions survive. Exercise renewal/time boundary and rollback with compatibility markers. Test actual old frontend contract, not merely pure selectors.
- [x] Run a browser against an isolated candidate fixture server, not the owner's running dev backend. Preserve cookies/localStorage across backend switch; exercise old tab, new tab, login response, cache identity and logout. Preserve existing recovery reload behavior. No production credentials or browser profile copies.
- [x] Exercise old linked Telegram client creating a ticket with photo+caption and receiving same-chat notification via local fake Telegram transport; record that a real Telegram API delivery was not tested if no isolated bot is available. Test existing link with no linkedAt and service-token/actor isolation.
- [x] Run changed focused tests, backend lint/typecheck, frontend typecheck/build/tests and tg-service relevant tests. Then run the full check.sh container gate once; no full backend suite on host. Existing unrelated failures are documented and compared with baseline, not silently fixed.
- [x] Document dry run, staff-only cutover, unchanged secrets/cookies, client old-tab boundary, bot checks and rollback (revoked staff sessions are not restored). Review whole W5a diff against the mirrored baseline; address important findings, then report results and explicit limits. Leave work uncommitted in worktree; transfer to main only upon owner instruction or existing authorization that explicitly covers it.

## Execution result — 2026-11-07

Implementation and independent reviews are complete in the isolated W5a worktree; nothing is staged or committed, and main application code is unchanged. Sol/high handled backend security and substantive reviews; Sol/medium handled the fixed-contract frontend work; Luna/medium handled mechanical corrections; Astra/high performed final integration and Task6 review, with its sole evidence finding closed on scoped re-review.

The corrected real-Mongo/old-and-new-browser/fake-Telegram rehearsal passed 8/8 entries, including positive and withheld-cookie renewal controls across the old browser deadline. Frontend container checks passed 515 tests, lint, types and build; bot passed 49 tests, types and audit. The four original-baseline failures were fixed in the authorized follow-up on 2026-11-07. The subsequent Node24 backend gate passed lint/typecheck and 3279 tests with zero failures and one opt-in skip. The overall release gate remains non-green because backend/frontend dependency audits still report advisories. Their exact logs, applicability qualifications and cleanup verification are retained in the local SDD verification record. This completion does not authorize deployment or claim closure of all W5 findings.
