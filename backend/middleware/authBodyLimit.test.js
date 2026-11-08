const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const express = require("express");
const { authBodyLimit, getAuthBodyRequest } = require("./authBodyLimit");
const { authPathAllowList } = require("./authPathAllowList");
const { browserOrigin } = require("./browserOrigin");

const ORIGIN = "https://portal.example.test";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const harness = async (t, options = {}, auth) => {
  const { toNodeHandler } = await import("../auth/instance.mjs");
  const requests = [];
  let dispatched = 0;
  const handler = toNodeHandler(auth || { handler: async (request) => {
    dispatched++;
    const body = Buffer.from(await request.arrayBuffer());
    return Response.json({ bytes: body.length, digest: digest(body), url: request.url, cookie: request.headers.get("cookie") }, { headers: { "set-cookie": "session=renewed; HttpOnly" } });
  } });
  const app = express();
  app.use((req, res, next) => { requests.push(req); res.append("set-cookie", "upstream=retained; HttpOnly"); next(); });
  app.all("/api/auth/*splat", authPathAllowList, browserOrigin({ publicUrl: ORIGIN, allowedOrigins: ["http://localhost:3100"] }), authBodyLimit(options), (req, res, next) => Promise.resolve(handler(getAuthBodyRequest(req, res), res)).catch(next));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, requests, dispatched: () => dispatched };
};

const start = (port, headers = {}) => {
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request({ hostname: "127.0.0.1", port, path: "/api/auth/reset-password?source=old", method: "POST", headers: { origin: ORIGIN, cookie: "session=old", "x-forwarded-for": "127.0.0.1", "x-hd-auth-client-ip": "127.0.0.1", "content-type": "application/octet-stream", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
  return { req, response };
};

test("actual application toNodeHandler gets untouched chunked bytes at 100KB and existing cookies", async (t) => {
  const { port, dispatched } = await harness(t);
  const body = Buffer.alloc(102400, 97);
  const { req, response } = start(port);
  req.write(body.subarray(0, 701));
  req.write(body.subarray(701, 50000));
  req.end(body.subarray(50000));
  const received = await response;
  assert.equal(received.status, 200);
  assert.equal(received.body.bytes, 102400);
  assert.equal(received.body.digest, digest(body));
  assert.match(received.body.url, /\/api\/auth\/reset-password\?source=old$/);
  assert.equal(received.body.cookie, "session=old");
  assert.deepEqual(received.headers["set-cookie"], ["upstream=retained; HttpOnly", "session=renewed; HttpOnly"]);
  assert.equal(dispatched(), 1);
});

test("one chunked byte over default cap returns 413 before auth, even without end", { timeout: 3000 }, async (t) => {
  const { port, dispatched } = await harness(t);
  const { req, response } = start(port);
  t.after(() => req.destroy());
  req.write(Buffer.alloc(102400));
  req.write(Buffer.from([1]));
  const received = await response;
  assert.equal(received.status, 413);
  assert.equal(received.body.code, "ERR_413");
  assert.equal(dispatched(), 0);
});

test("byte counting handles split UTF-8 and rejects multibyte bytes beyond cap", async (t) => {
  const { port } = await harness(t, { limitBytes: 6 });
  const bytes = Buffer.from("я🙂");
  const good = start(port);
  good.req.write(bytes.subarray(0, 1));
  good.req.end(bytes.subarray(1));
  const accepted = await good.response;
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.digest, digest(bytes));
  const bad = start(port);
  bad.req.end(Buffer.from("я🙂!"));
  assert.equal((await bad.response).status, 413);
});

test("Content-Length is rejected before waiting for its body", { timeout: 3000 }, async (t) => {
  const { port, dispatched } = await harness(t, { limitBytes: 8 });
  const { req, response } = start(port, { "content-length": "9" });
  t.after(() => req.destroy());
  req.flushHeaders();
  assert.equal((await response).status, 413);
  assert.equal(dispatched(), 0);
});

test("bounded deadline returns 408 and cleans up an unfinished body", { timeout: 3000 }, async (t) => {
  const { port, requests, dispatched } = await harness(t, { timeoutMs: 40 });
  const { req, response } = start(port);
  t.after(() => req.destroy());
  req.write("partial");
  const received = await response;
  assert.equal(received.status, 408);
  assert.equal(received.headers.connection, "close");
  assert.equal(dispatched(), 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[0].listenerCount("data"), 0);
  assert.equal(requests[0].listenerCount("aborted"), 0);
});

test("a drip-fed body cannot extend the total deadline", { timeout: 3000 }, async (t) => {
  const { port, dispatched } = await harness(t, { timeoutMs: 70 });
  const { req, response } = start(port);
  req.write("a");
  const drip = setInterval(() => req.write("b"), 10);
  t.after(() => { clearInterval(drip); req.destroy(); });
  assert.equal((await response).status, 408);
  clearInterval(drip);
  assert.equal(dispatched(), 0);
});

test("client abort discards pending bytes/listeners; a later request still succeeds", { timeout: 3000 }, async (t) => {
  const { port, requests, dispatched } = await harness(t, { timeoutMs: 60 });
  const bad = start(port);
  bad.response.catch(() => {});
  bad.req.write("incomplete");
  while (!requests.length) await new Promise((resolve) => setImmediate(resolve));
  const closed = new Promise((resolve) => requests[0].once("close", resolve));
  bad.req.destroy();
  await closed;
  assert.equal(requests[0].listenerCount("data"), 0);
  assert.equal(requests[0].listenerCount("aborted"), 0);
  assert.equal(dispatched(), 0);
  const good = start(port, { "content-length": "2" });
  good.req.end("{}");
  assert.equal((await good.response).status, 200);
  assert.equal(dispatched(), 1);
});

test("production cookie auth survives bounded HTTP TOTP mutation and invitation GET", async (t) => {
  const { fixture, cookieFrom, PASSWORD, ORIGIN: clientOrigin } = require("../auth/__tests__/browserSession.fixture.cjs");
  const current = await fixture();
  const clientHeaders = { "x-forwarded-for": "127.0.0.1", "x-hd-auth-client-ip": "127.0.0.1" };
  const cookie = cookieFrom(await current.auth.api.signInEmail({ body: { email: current.user.email, password: PASSWORD }, headers: new Headers(clientHeaders), asResponse: true }));
  const { port } = await harness(t, {}, current.auth);
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/auth/two-factor/enable`, {
    method: "POST", headers: { ...clientHeaders, origin: clientOrigin, cookie, authorization: "Bearer old-tab-stale", "content-type": "application/json" },
    body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(JSON.stringify({ password: PASSWORD }))); controller.close(); } }), duplex: "half",
  });
  assert.equal(response.status, 200);
  const material = await response.json();
  assert.ok(material.totpURI);
  assert.equal(material.backupCodes.length, 10);
  assert.ok(response.headers.getSetCookie().some((s) => s.startsWith("upstream=retained")));
  assert.equal(response.headers.get("set-auth-token"), null);
  const rejected = await fetch(`${base}/api/auth/two-factor/disable`, { method: "POST", headers: { origin: "http://sibling.localhost:3100", cookie, "content-type": "application/json" }, body: "invalid JSON" });
  assert.equal(rejected.status, 403);
  assert.ok(!rejected.headers.getSetCookie().some((s) => s.startsWith("hd.")));
  assert.ok(await current.auth.api.getSession({ headers: new Headers({ ...clientHeaders, cookie }) }));

  await current.auth.api.signInMagicLink({ body: { email: current.user.email, callbackURL: "/" }, headers: new Headers({ ...clientHeaders, origin: clientOrigin }) });
  const link = new URL(current.mails.at(-1).url);
  const verified = await fetch(`${base}${link.pathname}${link.search}`, { redirect: "manual", headers: clientHeaders });
  assert.equal(verified.status, 302);
  assert.ok(cookieFrom(verified).includes("hd.session_token="));
  assert.ok(await current.auth.api.getSession({ headers: new Headers({ ...clientHeaders, cookie: cookieFrom(verified) }) }));
});

test("real bootstrap dispatch consumes bounded raw body through its preserved Task1 wrapper", async (t) => {
  require("module-alias/register");
  const mongoose = require("mongoose");
  const config = require("../auth/config");
  const bootstrap = require("../auth/bootstrap");
  const seen = [];
  const hooksId = require.resolve("../auth/hooks");
  const originalHooks = require.cache[hooksId];
  require.cache[hooksId] = { id: hooksId, filename: hooksId, loaded: true, exports: { checkPasswordBreach: async () => ({ breached: false }) } };
  t.after(() => {
    if (originalHooks) require.cache[hooksId] = originalHooks;
    else delete require.cache[hooksId];
  });
  t.mock.property(config, "baseURL", ORIGIN);
  t.mock.property(config, "secret", "bootstrap-test-only-at-least-32-characters");
  // Only Mongo persistence is synthetic. No connect(), DB or external service.
  const originalDb = Object.getOwnPropertyDescriptor(mongoose.connection, "db");
  mongoose.connection.db = { collection: (name) => ({
    findOne: async (query) => { seen.push({ name, query }); return null; },
    aggregate: (pipeline) => { seen.push({ name, pipeline }); return { toArray: async () => [] }; },
  }) };
  t.after(() => {
    if (originalDb) Object.defineProperty(mongoose.connection, "db", originalDb);
    else delete mongoose.connection.db;
  });
  const originalReady = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  Object.defineProperty(mongoose.connection, "readyState", { configurable: true, value: 1 });
  t.after(() => {
    if (originalReady) Object.defineProperty(mongoose.connection, "readyState", originalReady);
    else delete mongoose.connection.readyState;
  });
  t.mock.method(mongoose.connection, "getClient", () => ({}));
  await bootstrap.initAuth();
  const app = express();
  app.all("/api/auth/*splat", authPathAllowList, browserOrigin({ publicUrl: ORIGIN }), authBodyLimit(), bootstrap.authRequestHandler);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { req, response } = start(server.address().port, { "content-type": "application/json" });
  req.write('{"newPassword":"strong-test-password",');
  req.end('"token":"synthetic-unused-token"}');
  const received = await response;
  assert.equal(received.status, 400);
  assert.equal(received.body.code, "INVALID_TOKEN");
  assert.ok(seen.some((entry) => entry.name === "authVerifications" && JSON.stringify(entry).includes("reset-password:synthetic-unused-token")), JSON.stringify(seen));
});
