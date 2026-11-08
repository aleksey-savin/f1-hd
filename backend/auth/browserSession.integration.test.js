const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, cookieFrom, PASSWORD, secretFromURI, ORIGIN } = require("./__tests__/browserSession.fixture.cjs");

test("production config keeps the existing signed cookie despite stale Authorization", async () => {
  const { auth, login } = await fixture();
  const signedIn = await login();
  const cookie = cookieFrom(signedIn);
  const original = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.ok(original?.session.id);
  for (const authorization of ["Bearer stale-token", `Bearer ${original.session.token}`, "Bearer cookie.unknown"]) {
    const found = await auth.api.getSession({ headers: new Headers({ cookie, authorization }) });
    assert.equal(found?.session.id, original.session.id, authorization);
    assert.equal(found?.session.token, original.session.token);
  }
  for (const token of [original.session.token, decodeURIComponent(cookie.split("=")[1]), `cookie.${original.session.id}`]) {
    assert.equal(await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }), null);
  }
  assert.equal(signedIn.headers.get("set-auth-token"), null);
});

test("production login supplies distinct compatibility markers; installed old bearer cannot override a cookie with them", async () => {
  const { auth, login } = await fixture();
  const first = await login();
  const body = await first.json();
  const second = await login();
  const other = await second.json();
  assert.match(body.browserSession?.token || "", /^cookie\./);
  assert.notEqual(body.browserSession.token, other.browserSession.token);
  const cookie = cookieFrom(first);
  const identity = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(body.browserSession.token, `cookie.${identity.session.id}`);
  assert.equal(new Date(body.browserSession.expiryDate).getTime(), identity.session.expiresAt.getTime());
  const { betterAuth } = await import("better-auth");
  const { bearer } = await import("better-auth/plugins");
  const rollback = betterAuth({ ...auth.options, plugins: [...auth.options.plugins, bearer()] });
  const found = await rollback.api.getSession({ headers: new Headers({ cookie, authorization: `Bearer ${body.browserSession.token}` }) });
  assert.equal(found?.session.id, identity.session.id);
  assert.equal(await rollback.api.getSession({ headers: new Headers({ authorization: `Bearer ${body.browserSession.token}` }) }), null);
  // Proves this control actually has the preceding raw bearer contract.
  assert.equal((await rollback.api.getSession({ headers: new Headers({ authorization: `Bearer ${identity.session.token}` }) }))?.session.id, identity.session.id);
  const oldLogin = await rollback.api.signInEmail({ body: { email: identity.user.email, password: PASSWORD }, asResponse: true });
  const oldCookie = cookieFrom(oldLogin);
  const oldIdentity = await rollback.api.getSession({ headers: new Headers({ cookie: oldCookie }) });
  const continued = await auth.api.getSession({ headers: new Headers({ cookie: oldCookie, authorization: `Bearer ${oldLogin.headers.get("set-auth-token")}` }) });
  assert.equal(continued.session.id, oldIdentity.session.id);
  assert.equal(continued.session.token, oldIdentity.session.token);
});

test("real raw TOTP setup, rotation and challenge never expose session credentials", async () => {
  const { auth, login, request } = await fixture();
  let cookie = cookieFrom(await login());
  const setup = await request("/two-factor/enable", { password: PASSWORD }, cookie);
  assert.equal(setup.status, 200);
  const material = await setup.json();
  assert.ok(material.totpURI);
  assert.equal(material.backupCodes.length, 10);
  const secret = secretFromURI(material.totpURI);
  const code = (await auth.api.generateTOTP({ body: { secret } })).code;
  const verified = await request("/two-factor/verify-totp", { code }, cookie);
  assert.equal(verified.status, 200);
  cookie = cookieFrom(verified) || cookie;
  const identity = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.ok(identity);
  const verifiedBody = await verified.json();
  assert.notEqual(verifiedBody.token, identity.session.token);
  assert.equal(verifiedBody.token, `cookie.${identity.session.id}`);
  assert.equal(verified.headers.get("set-auth-token"), null);
  const challenge = await login();
  const body = await challenge.json();
  assert.equal(body.twoFactorRedirect, true);
  assert.equal(body.browserSession, undefined);
  assert.equal(body.token, undefined);
  const finish = await request("/two-factor/verify-backup-code", { code: material.backupCodes[0] }, cookieFrom(challenge));
  assert.equal(finish.status, 200);
  const finishBody = await finish.json();
  const finalSession = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(finish) }) });
  assert.equal(finishBody.token, `cookie.${finalSession.session.id}`);
  const disabled = await request("/two-factor/disable", { password: PASSWORD }, cookieFrom(finish));
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  const afterDisable = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(disabled) }) });
  assert.equal(disabledBody.status, true);
  assert.equal(disabledBody.token, `cookie.${afterDisable.session.id}`);
  assert.ok(!JSON.stringify(disabledBody).includes(afterDisable.session.token));
});

test("email-code challenge, magic callback and reset flows retain their contracts", async () => {
  const { auth, ctx, user, mails, request } = await fixture();
  await auth.api.sendVerificationOTP({ body: { email: user.email, type: "sign-in" } });
  const response = await auth.api.signInEmailOTP({ body: { email: user.email, otp: mails.pop().otp }, headers: new Headers(), asResponse: true });
  assert.ok((await response.json()).browserSession?.token);
  await ctx.internalAdapter.updateUser(user.id, { twoFactorEnabled: true });
  await auth.api.sendVerificationOTP({ body: { email: user.email, type: "sign-in" } });
  const challenge = await auth.api.signInEmailOTP({ body: { email: user.email, otp: mails.pop().otp }, headers: new Headers(), asResponse: true });
  const body = await challenge.json();
  assert.equal(body.twoFactorRedirect, true);
  assert.equal(body.browserSession, undefined);
  await ctx.internalAdapter.updateUser(user.id, { twoFactorEnabled: false });
  await auth.api.signInMagicLink({ body: { email: user.email, callbackURL: "/welcome" }, headers: new Headers() });
  const link = new URL(mails.pop().url);
  const callback = await request(link.pathname.replace("/api/auth", "") + link.search);
  assert.equal(callback.status, 302);
  assert.equal(new URL(callback.headers.get("location"), ORIGIN).pathname, "/welcome");
  assert.match(cookieFrom(callback), /hd.session_token=/);
  assert.equal(callback.headers.get("set-auth-token"), null);
  await ctx.internalAdapter.createVerificationValue({ identifier: "reset-password:reset-for-test", value: user.id, expiresAt: new Date(Date.now() + 60000) });
  const reset = await request("/reset-password", { token: "reset-for-test", newPassword: "new-password-456" });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).status, true);
});


test("internal impersonation still receives a credential, while HTTP session/user payloads are filtered", async () => {
  const { auth, ctx, login, request, user } = await fixture();
  await ctx.internalAdapter.updateUser(user.id, { role: "impersonator" });
  const target = await ctx.internalAdapter.createUser({ name: "Target", email: "target@example.test", role: "user" });
  const result = await auth.api.impersonateUser({ body: { userId: target.id }, headers: new Headers({ cookie: cookieFrom(await login()) }) });
  assert.ok(result.session.token);
  assert.equal((await ctx.internalAdapter.findSession(result.session.token)).user.id, target.id);
  const issued = await auth.api.setImpersonationCookie({ body: { token: result.session.token }, asResponse: true });
  const response = await request("/get-session", null, cookieFrom(issued));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session.id, result.session.id);
  assert.equal(body.session.token, undefined);
  assert.equal(body.user.id, target.id);
  assert.ok(!JSON.stringify(body).includes(result.session.token));
});
