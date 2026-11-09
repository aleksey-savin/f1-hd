require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");
const { fixture, cookieFrom, PASSWORD, secretFromURI, ORIGIN } = require("../auth/__tests__/browserSession.fixture.cjs");
const { isDeniedAccount } = require("../services/accountDenial");
const { SESSION_MAX_MS } = require("../services/impersonation");

// Only application persistence/permission/mail dependencies are replaced.
// Every auth call below goes through production createAuth + installed adapter.
let current;
const query = () => { const value = Promise.resolve(current.user); value.select = () => value; value.lean = () => value; return value; };
const stub = (path, exports) => {
  const id = require.resolve(path);
  const module = new Module(id);
  Object.assign(module, { filename: id, loaded: true, exports });
  require.cache[id] = module;
};
stub("@/models/user", { findOne: query, findById: query });
stub("@/models/preferences", { findOne: async () => null });
stub("@/auth/bootstrap", { getAuth: () => current.auth, getFromNodeHeaders: () => (headers) => new Headers(headers) });
stub("@/services/authPassword", { verifyUserPassword: async () => true });
stub("@/services/telegramActor", {});
stub("@/services/authContext", { isDeniedAccount, buildAuthContext: async (user, session) => ({ user, session, userId: user._id, statements: {}, grantStatements: {}, can: () => false }) });
stub("@/services/authSessions", { revokeById: async (_userId, id) => {
  const row = current.data.authSessions.find((s) => s.id === id);
  if (row) await current.ctx.internalAdapter.deleteSession(row.token);
} });
stub("@/services/passwordPolicy", {});
stub("@/services/telegramPairing", {});
stub("@/services/impersonation", { SESSION_MAX_MS, CODE_TTL_MS: 600000, claim: async () => current.claim });
const authController = require("./auth");
const me = require("./me");
const impersonation = require("./impersonation");
const attachSession = require("../middleware/attachSession");

async function harness(t) {
  current = await fixture();
  current.user = { ...current.user, _id: current.user.id, firstName: "Client", isEndUser: true, save: async () => {} };
  const app = express();
  app.use((_req, res, next) => { res.cookie("existing", "keep"); next(); });
  const { toNodeHandler } = await import("../auth/instance.mjs");
  const { authPathAllowList } = require("../middleware/authPathAllowList");
  app.all("/api/auth/{*path}", authPathAllowList, toNodeHandler(current.auth));
  app.use(express.json());
  app.post("/login", authController.login);
  app.post("/code", authController.verifyLoginCode);
  app.post("/factor", authController.verifyTwoFactor);
  app.post("/claim", impersonation.claim);
  app.use(attachSession);
  app.get("/identity", (req, res) => res.status(req.auth ? 200 : 401).json({ userId: req.auth?.userId || null }));
  app.post("/logout", me.logout);
  app.get("/me", me.getMe);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = (path, body, cookie, authorization) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? "POST" : "GET", headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ...current, send };
}

const assertCookie = (response, pattern) => {
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((s) => s.startsWith("existing=keep")), JSON.stringify(cookies));
  assert.ok(cookies.some((s) => pattern.test(s)), JSON.stringify(cookies));
};

test("HTTP password/code/TOTP responses use session markers and append cookies", async (t) => {
  const { auth, ctx, user, mails, send } = await harness(t);
  const password = await send("/login", { email: user.email, password: PASSWORD });
  assert.equal(password.status, 200);
  const body = await password.json();
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(password) }) });
  assert.equal(body.token, `cookie.${session.session.id}`);
  assert.equal(new Date(body.expiryDate).getTime(), session.session.expiresAt.getTime());
  assertCookie(password, /^hd.session_token=/);
  assert.equal(password.headers.get("set-auth-token"), null);
  await auth.api.sendVerificationOTP({ body: { email: user.email, type: "sign-in" } });
  const byCode = await send("/code", { email: user.email, otp: mails.pop().otp });
  assert.equal(byCode.status, 200);
  assert.match((await byCode.json()).token, /^cookie\./);
  assertCookie(byCode, /^hd.session_token=/);
  const enable = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie: cookieFrom(byCode) }) });
  const code = (await auth.api.generateTOTP({ body: { secret: secretFromURI(enable.totpURI) } })).code;
  await auth.api.verifyTOTP({ body: { code }, headers: new Headers({ cookie: cookieFrom(byCode) }) });
  const challenge = await send("/login", { email: user.email, password: PASSWORD });
  assert.equal((await challenge.json()).twoFactorRequired, true);
  const factor = await send("/factor", { code: enable.backupCodes[0], backup: true }, cookieFrom(challenge));
  assert.equal(factor.status, 200);
  assert.match((await factor.json()).token, /^cookie\./);
  assertCookie(factor, /^hd.session_token=/);
  await ctx.internalAdapter.updateUser(user.id, { twoFactorEnabled: false });
});

test("attachSession forwards actual renewal with one read and logout clears cookie", async (t) => {
  const { auth, ctx, login, send } = await harness(t);
  const loginResponse = await login();
  const cookie = cookieFrom(loginResponse);
  const original = await auth.api.getSession({ headers: new Headers({ cookie }) });
  await ctx.internalAdapter.updateSession(original.session.token, { expiresAt: new Date(Date.now() + 600000), updatedAt: new Date(Date.now() - 2 * 86400000) });
  let reads = 0;
  const getSession = auth.api.getSession;
  t.mock.method(auth.api, "getSession", async (options) => { reads++; return getSession(options); });
  const renewed = await send("/identity", null, cookie, "Bearer stale-token");
  assert.equal(renewed.status, 200);
  assert.equal(reads, 1);
  assertCookie(renewed, /^hd.session_token=.*Max-Age=/);
  const after = await getSession({ headers: new Headers({ cookie: cookieFrom(renewed) }) });
  assert.equal(after.session.id, original.session.id);
  assert.equal(after.session.token, original.session.token);
  assert.ok(after.session.expiresAt > original.session.expiresAt);
  const logout = await send("/logout", {}, cookieFrom(renewed));
  assert.equal(logout.status, 200);
  assertCookie(logout, /^hd.session_token=;.*Max-Age=0/);
  assert.equal(await getSession({ headers: new Headers({ cookie }) }), null);
});

test("attachSession forwards actual expiry clearing and keeps denied users/capped impersonation anonymous", async (t) => {
  const { auth, ctx, login, send } = await harness(t);
  const expiredCookie = cookieFrom(await login());
  const expired = await auth.api.getSession({ headers: new Headers({ cookie: expiredCookie }) });
  await ctx.internalAdapter.updateSession(expired.session.token, { expiresAt: new Date(Date.now() - 1000) });
  const cleared = await send("/identity", null, expiredCookie);
  assert.equal(cleared.status, 401);
  assertCookie(cleared, /^hd.session_token=;.*Max-Age=0/);
  const cookie = cookieFrom(await login());
  for (const flags of [{ banned: true }, { company: { isActive: false } }, { isServiceAccount: true }]) {
    Object.assign(current.user, flags);
    assert.equal((await send("/identity", null, cookie)).status, 401);
    Object.assign(current.user, { banned: false, company: { isActive: true }, isServiceAccount: false });
  }
  const identity = await auth.api.getSession({ headers: new Headers({ cookie }) });
  await ctx.adapter.update({ model: "session", where: [{ field: "id", value: identity.session.id }], update: { impersonatedBy: "staff-id", createdAt: new Date(Date.now() - SESSION_MAX_MS - 10000) } });
  assert.equal((await send("/identity", null, cookie)).status, 401);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
});

test("impersonation claim returns marker and remaining creation-time cap, preserving cookies", async (t) => {
  const { auth, ctx, user, send } = await harness(t);
  const startedAt = new Date(Date.now() - 600000);
  const session = await ctx.internalAdapter.createSession(user.id, false, { impersonatedBy: "staff-id", createdAt: startedAt });
  await ctx.adapter.update({ model: "session", where: [{ field: "id", value: session.id }], update: { createdAt: startedAt } });
  current.claim = { targetId: user.id, sessionToken: session.token };
  const response = await send("/claim", { code: "one-time" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token, `cookie.${session.id}`);
  assert.equal(new Date(body.expiryDate).getTime(), startedAt.getTime() + SESSION_MAX_MS);
  assertCookie(response, /^hd.session_token=/);
  const cookieLine = response.headers.getSetCookie().find((s) => s.startsWith("hd.session_token="));
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookieLine)[1]);
  assert.ok(maxAge <= 3000 && maxAge > 2990, String(maxAge));
  assert.equal((await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(response) }) }))?.session.id, session.id);
});


test("/me returns the existing public session identity and capped impersonation expiry", async (t) => {
  const { auth, ctx, login, send, user } = await harness(t);
  const cookie = cookieFrom(await login());
  const original = await auth.api.getSession({ headers: new Headers({ cookie }) });
  const normal = await send("/me", null, cookie);
  assert.equal(normal.status, 200);
  const normalBody = await normal.json();
  assert.equal(normalBody.token, `cookie.${original.session.id}`);
  assert.equal(normalBody.userId, user.id);
  assert.equal(normalBody.sessionId, original.session.id);
  assert.equal(new Date(normalBody.expiryDate).getTime(), original.session.expiresAt.getTime());
  assert.ok(!JSON.stringify(normalBody).includes(original.session.token));
  const startedAt = new Date(Date.now() - 600000);
  await ctx.adapter.update({ model: "session", where: [{ field: "id", value: original.session.id }], update: { impersonatedBy: "staff-id", createdAt: startedAt } });
  const capped = await send("/me", null, cookie);
  assert.equal(capped.status, 200);
  const body = await capped.json();
  assert.equal(new Date(body.expiryDate).getTime(), startedAt.getTime() + SESSION_MAX_MS);
  assert.equal(body.expiryDate, body.impersonation.until);
});

test("/me restores only the current audience's dashboard layout across requests", async (t) => {
  const { login, send } = await harness(t);
  const client = { customOrder: true, widgets: [{ id: "workplace", zone: "main", visible: false }] };
  const staff = { customOrder: true, widgets: [{ id: "report", zone: "top", visible: true }] };
  current.user.dashboardLayout = { client, staff };
  const cookie = cookieFrom(await login());
  const first = await (await send("/me", null, cookie)).json();
  assert.deepEqual(first.user.dashboardLayout, client);
  current.user.isEndUser = false;
  const second = await (await send("/me", null, cookie)).json();
  assert.deepEqual(second.user.dashboardLayout, staff);
  current.user.dashboardLayout = undefined;
  const defaults = await (await send("/me", null, cookie)).json();
  assert.equal(defaults.user.dashboardLayout, null);
});

test("claim refuses expired and ordinary sessions without issuing a session cookie", async (t) => {
  const { ctx, user, send } = await harness(t);
  for (const overrides of [{}, { impersonatedBy: "staff-id" }]) {
    const session = await ctx.internalAdapter.createSession(user.id, false, overrides);
    await ctx.adapter.update({ model: "session", where: [{ field: "id", value: session.id }], update: { createdAt: new Date(Date.now() - SESSION_MAX_MS - 1000) } });
    current.claim = { targetId: user.id, sessionToken: session.token };
    const response = await send("/claim", { code: "one-time" });
    assert.equal(response.status, 500);
    assert.ok(!response.headers.getSetCookie().some((s) => s.startsWith("hd.session_token=")));
  }
});


test("raw allowed TOTP HTTP responses append rotated cookies after existing middleware cookies", async (t) => {
  const { auth, login, send } = await harness(t);
  const cookie = cookieFrom(await login());
  const setup = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie }) });
  const code = (await auth.api.generateTOTP({ body: { secret: secretFromURI(setup.totpURI) } })).code;
  const response = await send("/api/auth/two-factor/verify-totp", { code }, cookie);
  assert.equal(response.status, 200);
  assertCookie(response, /^hd.session_token=/);
  const body = await response.json();
  const identity = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(response) }) });
  assert.equal(body.token, `cookie.${identity.session.id}`);
  assert.equal(response.headers.get("set-auth-token"), null);
});
