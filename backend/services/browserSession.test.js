const { test } = require("node:test");
const assert = require("node:assert/strict");

test("markers are public per-session identities, with no empty IDs", () => {
  const { sessionMarker, browserSessionPayload } = require("./browserSession");
  assert.equal(sessionMarker("session-1"), "cookie.session-1");
  assert.notEqual(sessionMarker("session-1"), sessionMarker("session-2"));
  for (const id of [null, undefined, "", " "]) assert.throws(() => sessionMarker(id));
  const expiresAt = new Date("2030-01-01");
  assert.deepEqual(browserSessionPayload({ sessionId: "s", expiresAt, userId: "u" }), {
    token: "cookie.s", expiryDate: expiresAt, userId: "u",
  });
});

test("cookie forwarding appends each cookie and never exposes bearer headers", () => {
  const { forwardSessionCookies } = require("./browserSession");
  const headers = new Headers({ "set-auth-token": "credential" });
  headers.append("set-cookie", "first=1; Expires=Thu, 01 Jan 2037 00:00:00 GMT; HttpOnly");
  headers.append("set-cookie", "second=2; Path=/; SameSite=Lax");
  const values = { "Set-Cookie": ["existing=ok"] };
  const res = { getHeader: (name) => values[name], setHeader: (name, value) => { values[name] = value; } };
  forwardSessionCookies(headers, res);
  assert.deepEqual(values, { "Set-Cookie": ["existing=ok", ...headers.getSetCookie()] });
});

test("HTTP filtering covers nested session/user tokens and keeps setup/reset data", async () => {
  const { browserSessionResponse } = require("./browserSession");
  const headers = new Headers({ "content-type": "application/json", "set-auth-token": "signed-secret", "access-control-expose-headers": "x-other, set-auth-token" });
  headers.append("set-cookie", "one=1; HttpOnly");
  headers.append("set-cookie", "two=2; HttpOnly");
  const response = await browserSessionResponse(Response.json({
    token: "raw-secret", browserSession: { token: "cookie.s", expiryDate: "2030-01-01", userId: "u" },
    session: { id: "s", token: "nested-secret", user: { id: "u", token: "user-secret" } },
    user: { id: "u", token: "user-secret", sessions: [{ id: "s", token: "array-secret" }] },
    backupCodes: ["keep-backup"], totpURI: "keep-totp",
  }, { headers }));
  const body = await response.json();
  assert.equal(body.token, "cookie.s");
  assert.doesNotMatch(JSON.stringify(body), /raw-secret|nested-secret|user-secret|array-secret/);
  assert.deepEqual(body.backupCodes, ["keep-backup"]);
  assert.equal(body.totpURI, "keep-totp");
  assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
  assert.equal(response.headers.get("set-auth-token"), null);
  assert.equal(response.headers.get("access-control-expose-headers"), "x-other");
  const reset = await browserSessionResponse(Response.json({ token: "keep-reset", status: true }));
  assert.equal((await reset.json()).token, "keep-reset");
  const redirect = await browserSessionResponse(new Response(null, { status: 302, headers: { location: "/after-login", "set-cookie": "session=ok" } }));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/after-login");
});


test("empty JSON callback redirects preserve location and cookies", async () => {
  const { browserSessionResponse } = require("./browserSession");
  const response = await browserSessionResponse(new Response(null, {
    status: 302, headers: { "content-type": "application/json", location: "/welcome", "set-cookie": "hd.session_token=signed; HttpOnly" },
  }));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/welcome");
  assert.equal(await response.text(), "");
});
