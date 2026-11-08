# W5a — Browser authentication with client-session continuity

Date: 2026-11-07 · Status: implemented and independently reviewed in an isolated worktree; release gates conditional. Owner approval: 2026-11-07

W5 source: `2026-09-30-productization-audit.md`, especially S9, S16, S20,
S22–S23. This is the first delivery within W5, not a claim that all W5
findings have been closed. The owner approved implementation on 2026-11-07.

## Owner requirements

- A deployment must not invalidate ordinary clients' valid browser sessions.
  The usual client has an already-open browser tab and uses the Telegram bot.
- Existing Telegram account links must survive without pairing again.
- Staff may be logged out as part of W5. This permits a targeted browser-session
  cutover; it does not authorize resetting passwords, TOTP enrollment, bot links,
  channel identities, or messenger sessions.
- Existing permission restrictions, bans, explicit logout, and normal session
  expiry remain effective. Continuity does not extend expired or revoked access.
- UI changes require the established mockup workflow, including light/dark and
  desktop/mobile, and the owner's approval before implementation.

## Project evidence

The design was checked against the current working tree, including pending
MCP/Proxmox changes. Those unrelated changes are not part of this delivery.

Read first: `AGENTS.md`, the productization audit, the better-auth migration
design, `docs/deployment.md`, `docs/messaging.md`, `docs/live-updates.md`, and
the session, second-factor, pre-authentication and error sections of
`docs/ux-ui-guide.md`. Compare the implementations below when planning tasks;
the original audit and migration design contain superseded findings.

| Observed contract | Implementation |
|---|---|
| Production and standard development use same-origin API requests; the browser already sends session cookies. | `frontend/Dockerfile`, `compose.dev.yml`, `frontend/src/lib/api.ts` |
| Session cookies and exposed bearer values refer to the same server session. The installed better-auth version is 1.6.26. | `backend/controllers/auth.js`, `backend/auth/instance.mjs`, installed bearer plugin |
| The bearer plugin can replace a valid cookie with the token in Authorization. Without that plugin, the library uses the cookie. | installed `better-auth/dist/plugins/bearer/index.mjs` |
| New root authentication already reads `/api/me`, but Root/Pulse and a logout timer still depend on localStorage. | `frontend/src/util/auth.js`, `frontend/src/layout/Root.jsx`, `frontend/src/pages/Auth/session.ts` |
| Session lookup currently drops response cookies; application logout also drops the library's cookie-clearing response. | `backend/middleware/attachSession.js`, `backend/controllers/me.js` |
| Staff audience is exactly `isEndUser === false`; null/missing values are treated as clients by the canonical auth context. | `backend/auth/access.js`, `backend/services/authContext.js` |
| Impersonation records have the target as session owner and a separate `impersonatedBy`; a client target is not the staff actor. | `backend/services/impersonation.js`, `backend/controllers/impersonation.js`, installed admin plugin |
| Bot identity is durable `users.telegramBot`; it does not require an authSessions row. | `backend/services/telegramActor.js`, `backend/routes/bot.js`, `tg-service/src/api/client.ts` |
| Bot/gateway/MCP routes deliberately precede browser session attachment. | `backend/routes/index.js` |
| Updating the profile with a truthy telegramBot object is an explicit unlink operation today. Do not echo it accidentally in an unrelated save. | `backend/controllers/user.js` |

These are local source observations. No production inspection or real deployment
rehearsal has been performed for W5.

## D1. Preserve the existing browser identity

Remove the session `bearer()` plugin. Browser authentication uses the signed
httpOnly cookie and the existing server session. The old Authorization header
is ignored as a browser-session credential, including when an old tab still
sends it alongside a valid cookie. Dedicated MCP/API-key transports retain
their own explicit authentication; their bearer values are not browser sessions.

Preserve `BETTER_AUTH_SECRET`, current cookie names/prefix, host/path and Secure
behavior, user IDs, existing client session IDs/tokens, and the current expiry
policy. Cookie session caching remains disabled so revocations still take effect.
Do not rewrite `authSessions.token` into a hash: the installed adapter performs
an exact lookup using it. Do not rotate the signing secret to log staff out;
that also breaks client cookies and existing encrypted TOTP material.

The current cookie already has no configured cross-subdomain Domain attribute.
A move to `__Host-` naming is deliberately excluded from this first release.
If pursued later, it requires a separately tested migration accepting old valid
client cookies; a renamed cookie alone is not a migration.

No general raw/signed bearer fallback is planned for the documented same-origin
installation. Before cutover, exercise the old application build against the
candidate backend. Evidence of a supported bearer-only client is a design
exception to resolve before release, not a reason to restore unrestricted raw
database-token authentication.

## D2. Remove frontend dependence on exposed credentials

The new frontend uses successful server identity for the authenticated shell,
Pulse, presence and redirect decisions. Remove the localStorage expiry logout
timer and all browser-session Authorization construction, including legacy
direct fetch calls. A token missing from localStorage must not disable a live
cookie-authenticated application.

New application code does not persist or expose a usable session credential.
Neither login JSON nor `set-auth-token` returns one. Keep the harmless response
metadata required by an old loaded login bundle (`expiryDate`, `userId`). For
the old storeSession contract, temporarily return a non-secret, per-session
`token` marker; it must never authenticate any endpoint. Its identity must vary
between sessions: the old form-data cache uses that value as an isolation key.
It must also fail signed-bearer verification in the preceding backend version,
rather than being interpreted as an unsigned token that replaces a good cookie
on rollback. Test the exact marker with both installed backend contracts.
Remove that compatibility field only after the supported old-bundle window has
ended.

Inventory every cookie-issuing HTTP response, including custom login/code/TOTP
controllers, impersonation claim, magic-link callback and allowed raw plugin
routes. Removing bearer does not itself remove session-token fields generated
by a plugin. Filter those fields at the application boundary while preserving
required cookie headers and intentional TOTP setup/backup-code responses.

Do not eagerly delete legacy localStorage keys from a second tab: an old tab
uses their presence to render authenticated features. After server identity is
known, replace the readable credential value with the non-secret per-session
marker while preserving expiryDate/userId and key presence for old bundles.
New code uses server identity, not that marker, and keys/clears caches on the
current identity/session. Explicit logout continues clearing the shared session
state and drafts. Test account switching in both new and old loaded bundles.

A 401 means the server no longer accepts the session. Network failures, 5xx,
rate limits and CSRF refusals must not be converted into logout or clear a
valid client session.

### Already-open tab boundary

An old loaded bundle has already armed its existing local logout timer. A new
deployment cannot cancel that timer in-place, and the timer's logout request is
indistinguishable from an intentional logout. W5 does not ignore logout requests
to work around this or add a blanket tab reload for the auth migration.

The continuity promise is: deploying W5 does not revoke the client's valid
session or require a fresh login; old requests continue with the same cookie.
The old bundle can still log out at its pre-existing local expiry. A normal
page refresh loads the fixed bundle without requiring login while the server
session remains valid. New code must not add such a local expiry or blanket
refresh policy.

The existing 503/network recovery screen can already reload a tab after service
returns (`components/Error/use-availability-probe.js`, documented in the UI
guide). This delivery preserves that recovery behavior: a recovery reload must
reuse the valid client session rather than require login. No zero-downtime or
new guarantee about unsaved in-memory form state is implied. Preserve the
existing draft-persistence behavior; do not clear drafts during the migration.

## D3. Forward cookie renewal and clearing correctly

Session identification forwards all Set-Cookie response headers produced by
better-auth, preserving separate header entries and their attributes. Otherwise
the database's sliding expiry can outlive the browser's cookie. Apply the same
rule to login, code verification, impersonation claim and explicit logout.

Do not copy `set-auth-token` or token-bearing JSON while forwarding cookies.
Do not perform a second session read merely to recover headers. Maintain one
request identity and the existing denied-account and impersonation-time checks.

## D4. Staff-only, one-time cutover

The migration runs with application writers stopped, using the normal deploy
migration lifecycle. It records a durable cutover snapshot before deleting any
session, then deletes only the recorded IDs. Retry resumes that same snapshot;
it must not log out staff who authenticated after the completed cutover.

The target set is the union of:

1. Sessions owned by users whose `isEndUser` is exactly false.
2. Impersonation sessions whose `impersonatedBy` refers to such a staff user,
   including sessions targeting a client.

Handle string/ObjectId forms used by the adapter. Do not classify by role name,
isAdmin, company membership or the number of permissions. Preserve every
independent client-audience session, including client-manager/client-admin
roles and historical null/missing account-type fields.

Retire unclaimed impersonation codes belonging to the affected staff actors,
so an old code cannot restore a cutover session. Do not reset account passwords,
two-factor records, client verification/invitation codes, Telegram pairing
state, or integration credentials. Logs contain counts, not credentials.

Provide a dry run reporting staff session, impersonation and preserved-client
counts before the delete step. A mismatch in the target classification blocks
the migration. The migration journal must make the once-only behavior explicit.

## D5. Telegram and messenger isolation

Preserve the bot account, existing service credentials, `users.telegramBot`
fields, `channels`, `channelidentities`, messenger gateway session storage and
tg-service persistent state. Old valid links lacking linkedAt remain valid.
Do not run dev-copy masking or any blanket credential cleanup during deploy.

Browser-session revocation has no side effects on bot identity, including staff
bot links. Bot/gateway requests continue through dedicated credential checks and
actor resolution, without browser cookies, browser CSRF tokens or Origin.
Do not attach browser identity to these routes or accept user-supplied account
IDs as a substitute for the saved Telegram mapping.

Explicit unlink remains an intentional user action. Ordinary profile,
notification or session saves must not send an unlink payload. Test their
partial-update behavior while changing auth-related frontend code.

Ban/company deactivation continues denying bot actions without destroying the
binding. Unban/activation restores eligible use through that same binding.
Password reset and browser logout do not silently unlink Telegram in this work.

## D6. Browser request boundary

Add an Origin/CSRF policy for unsafe browser requests across both application
auth routes and the permitted better-auth HTTP routes. It runs before their
body is processed. Compare normalized exact origins against APP_PUBLIC_URL and
explicit development origins; a sibling subdomain is not automatically trusted.
CORS alone is not this protection.

For cookie-authenticated unsafe requests, require an allowed Origin; if Origin
is absent, use an exact same-origin Referer fallback, otherwise refuse without
mutation. Fetch Metadata can strengthen the check but is not the only evidence.
Apply equivalent anti-login-CSRF handling to browser login/code/password flows.
Retain supported invitation/magic-link GET callbacks and intentional navigation.

Machine-authenticated bot/gateway/MCP/company-API routes are separately
classified. A missing Origin does not authenticate them: their dedicated
credentials and object permissions are still mandatory. A browser cookie or
arbitrary Authorization header must not turn a browser route into a machine
exception. Inventory legacy /tg routes before removing them or narrowing their
transport; do not break the active /bot client contract.

Keep the W1 allow-list closed and preserve default 10 MB, editor 50 MB and
anonymous 100 KB limits. Add a bounded-body check for permitted better-auth
requests lacking Content-Length, without hanging or consuming a body the
handler cannot subsequently read. Global urlencoded-parser removal and global
operator-key rejection wait for the remaining-route inventory in later W5 work.

## D7. Login throttling and timing

Use one documented proxy/IP trust model for Express and better-auth, verified
against the supported deployment chain. Untrusted forwarded headers cannot
select a different rate-limit identity. Keep bot/gateway operational limits
separate from browser login limits.

Cover password login, mail code issuance/verification, reset and second-factor
attempts with bounded IP and normalized-account limits. Avoid an account-wide
lockout that an unauthenticated attacker can maintain indefinitely. Unknown
accounts perform comparable password-hash verification and receive the same
generic credential error. Do not claim this makes all response timing identical.

Do not add a public registration/login plugin route to achieve throttling.
Existing staff TOTP enrollment and backup codes remain usable. W5a does not
silently enable a new mandatory 2FA policy or change client login methods.

## Delivery and rollback

Build one candidate containing the compatible backend and the new frontend;
support old frontend requests during the backend switch. Complete targeted
tests and an old-build/new-backend rehearsal before applying to main. No
commits or production changes by the agent.

Runtime rollback uses the preceding application images and unchanged cookie
identity. Staff sessions deleted at cutover remain revoked: rollback does not
resurrect them or restore an entire database over live customer activity.
Existing client sessions and bot links remain intact in either version.

No new screen, enrollment policy or settings controls are introduced here.
Any visible change discovered during implementation first gets approved
mockups in both themes and viewport sizes. Preserve the existing login, account
and error components, action names and the error-page cat.

## Acceptance criteria

1. Create real old-format sessions using the old application/library contract,
   not fabricated fixture tokens. An already-open ordinary client tab can read
   tickets, create a ticket, comment, upload and receive Pulse updates across
   backend replacement without signing in or an auth-migration reload. Exercise
   the existing outage-recovery reload separately: it must also retain login.
   Repeat for
   client-manager/client-admin and missing/null isEndUser.
2. Cookie + valid, stale or absent Authorization succeeds for that same client;
   bearer alone, including a raw DB session token, does not authenticate browser
   routes. MCP and company API-key authentication remain independent.
3. The new frontend works without localStorage auth fields. An old loaded login
   bundle accepts the temporary response without receiving a real credential;
   no allowed session-issuing plugin route exposes one either.
   A second tab does not disable the original tab by clearing its legacy keys.
   Per-session markers preserve old cache isolation and do not override valid
   cookies if the previous backend version is restored.
4. Advance time through session renewal and the browser-cookie expiry boundary:
   renewed cookies reach the browser. Explicit logout revokes the session and
   clears its cookies; banned, revoked and expired sessions stay refused.
5. All snapshotted staff sessions, staff-to-client impersonations and affected
   unclaimed impersonation codes fail after cutover. Independent client sessions
   survive; a migration retry does not revoke newly issued staff sessions.
6. A previously linked ordinary client sends a photo with a caption through the
   same bot after deployment, creates a correctly owned ticket and receives a
   notification in the same chat without pairing. Repeat with an old link
   lacking linkedAt. Staff browser logout leaves staff bot identity intact.
7. Ordinary profile/notification saves preserve the bot link. Explicit unlink,
   denied accounts and ambiguous duplicate mappings keep their intended rules.
   No channel logout jobs or identity wipes are produced by the cutover.
8. Same-origin browser mutations succeed; sibling/untrusted origins and missing
   browser-origin evidence fail before mutation. Separate service-authenticated
   multipart bot/gateway requests still work without cookies or Origin.
9. No public better-auth allow-list expansion; over-limit chunked auth bodies
   return 413 within a bounded time. Existing body-size contracts remain intact.
10. Clients behind the configured proxy chain do not share an accidental global
    login bucket. Account and IP abuse is limited; normal active client sessions
    are not revoked by login failures, rate limits, CSRF errors or outages.

Run only focused host tests with core dumps disabled. The full backend suite
belongs in the existing check.sh container gate, never on the desktop host.
Synthetic tests are necessary but do not replace the old-build browser/bot
rehearsal. Record what was exercised and any external service not available.

## Implementation evidence — 2026-11-07

Task-scoped reviews and final Astra/high review passed after their reproduced findings were corrected. The final synthetic rehearsal used real MongoDB 8 sessions, compiled baseline/candidate frontends in isolated Chromium, and the actual old bot through a fake Telegram transport. All 8 test entries passed. It covers staff-only cutover/retry, preserved client sessions and legacy bot links, old/new tabs, reads/writes/multipart/Pulse, recovery, rollback, explicit logout, and both positive and withheld-renewal controls across the original browser-cookie deadline.

This is not a deployed-stack or real Telegram delivery claim. It does not boot nginx or establish production old-asset retention. The existing old-bundle expiry timer remains the approved boundary.

Follow-up on 2026-11-07 fixed the four reproduced baseline failures: explicit masking rules for new models (including removal of Proxmox credentials and disabling copied operations), the missing Proxmox actions in the shipped administrator catalogue, and deterministic expiry time in the WireGuard test. The full Node24 backend run now has 3279 passing tests, zero failures and one opt-in skip; lint and typecheck pass. The full release gate is still not green because unchanged backend/frontend dependencies produce audit advisories. W5a's stale static middleware-order assertions were repaired and checked separately. Frontend 515 tests, lint, types and build and bot 49 tests, types and audit passed; final cache regression 21/21 and typecheck passed. No dependency audit exception, version change, secret rotation, staging, commit, production update or transfer of implementation into main was made. Follow the deployment runbook and resolve or explicitly assess the remaining gate failures before release.

## Remaining W5 deliveries

The following need their own concrete task plans after the session boundary is
settled. They are not silently omitted from the audit and not implemented by
approving W5a alone:

- Entity-authorized attachment serving, including local/S3 storage, approved
  public brand images and existing messaging/media consumers.
- Outbound connection policy with DNS pinning and redirect validation; distinct
  policies for untrusted AI links versus intentional local AI/mail/router/Proxmox
  integrations. Preserve deploy-operator-authorized private targets.
- Remaining object authorization and DTOs: service-plan/report disclosure,
  staff ticket scope in work archives, responsible assignment, consistent account
  audience and MCP scope-delegation ceilings, client template sharing and own
  absence approval. Respect current uncommitted MCP/Proxmox additions.
- HTML sanitization/CSP, confirmed CSV escaping/formula issues, generic unexpected
  server errors with request IDs, and removal of public timing headers.
- Permission-based 2FA/step-up with enrollment recovery and approved UI mockups;
  compatible verification-token/legacy-secret cleanup, additive integration-key
  expiry and version-compatible crypto hardening.
- Container/runtime least privilege and public ingress restrictions compatible
  with messaging services. Base-image digest pinning remains part of W3b.

The owner's previous deferral of approval-link changes still applies: no
approval-token hashing/invalidation or signer-authority changes in W5a.
The documented knowledge-base publication policy is not silently rewritten.
An audit item with an explicit deferred component must be marked partial, not
closed in full.
