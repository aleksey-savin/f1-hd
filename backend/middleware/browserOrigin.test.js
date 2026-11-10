const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const multer = require("multer");
const { browserOrigin } = require("./browserOrigin");
const { authPathAllowList } = require("./authPathAllowList");
const { createIsGateway } = require("./isGateway");

const ORIGIN = "https://portal.example.test";

test('Wazzup bypasses browser identity only on the exact credential-protected webhook route', () => {
  const middleware = browserOrigin({ publicUrl: ORIGIN });
  const req = { method: 'POST', originalUrl: '/api/wazzup/webhook?token=own-secret', headers: { cookie: 'session=browser' } };
  let next = false;
  middleware(req, {}, () => { next = true; });
  assert.equal(next, true);
  assert.equal(req.headers.cookie, undefined);
  let status;
  middleware({ method: 'POST', originalUrl: '/api/wazzup/settings', headers: {} }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('other routes require browser origin'));
  assert.equal(status, 403);
});
const harness = async (t) => {
  const app = express();
  app.all("/api/auth/*splat", authPathAllowList);
  app.use(browserOrigin({ publicUrl: `${ORIGIN}/`, allowedOrigins: ["http://localhost:3100"] }));
  app.use(express.json());
  app.use(multer().any());
  app.use("/api/gateway", createIsGateway({ getToken: () => "service-secret", log() {} }));
  app.post("/api/bot/tickets", (req, res) => res.json({ files: req.files?.length, cookie: req.headers.cookie ?? null }));
  app.all("/api/bot/tickets/*splat", (req, res) => res.sendStatus(404));
  app.use((req, res) => res.json({ body: req.body, files: req.files?.length, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(400).json({ error: err.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
};

test("same-origin old cookie clients retain JSON and multipart mutations", async (t) => {
  const call = await harness(t);
  const json = await call("/api/tickets/process", { method: "POST", headers: { origin: ORIGIN, cookie: "session=old", "content-type": "application/json" }, body: '{"value":"unchanged"}' });
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { body: { value: "unchanged" }, cookie: "session=old", authorization: null });
  const form = new FormData();
  form.append("avatar", new Blob(["image"]), "avatar.png");
  const multipart = await call("/api/users/update/one", { method: "POST", headers: { referer: `${ORIGIN}/users/one`, cookie: "session=old" }, body: form });
  assert.equal(multipart.status, 200);
  assert.equal((await multipart.json()).files, 1);
  assert.equal((await call("/api/login", { method: "POST", headers: { origin: "http://localhost:3100" } })).status, 200);
});

test("Origin is exact, authoritative, and checked before JSON or multipart parsing", async (t) => {
  const call = await harness(t);
  for (const origin of [undefined, "null", "https://sibling.example.test", `${ORIGIN}.evil.test`, `${ORIGIN}/`, `${ORIGIN}/path`, `https://user@portal.example.test`, `${ORIGIN}, ${ORIGIN}`, "garbage"]) {
    for (const type of ["application/json", "multipart/form-data"]) {
      const response = await call("/api/login", { method: "POST", headers: { ...(origin === undefined ? {} : { origin }), ...(origin === undefined ? {} : { referer: `${ORIGIN}/login` }), cookie: "session=old", authorization: "Bearer spoof", "x-tg-token": "spoof", "x-api-key": "spoof", "x-gateway-token": "spoof", "content-type": type }, body: "malformed" });
      assert.equal(response.status, 403, `${origin} ${type}`);
      assert.equal(response.headers.get("set-cookie"), null);
    }
  }
  for (const referer of ["https://sibling.example.test/page", "null", `https://user@portal.example.test/page`]) {
    assert.equal((await call("/api/logout", { method: "POST", headers: { referer } })).status, 403);
  }
});

test("only isolated machine namespaces and inventoried credential routes bypass Origin", async (t) => {
  const call = await harness(t);
  for (const path of ["/api/bot/identity", "/api/gateway/events", "/api/mcp", "/api/external/log/user-activity", "/api/external/ticket/create", "/api/tg/auth", "/api/tg/set-work-status"]) {
    const response = await call(path, { method: "POST", headers: { cookie: "session=browser", "x-gateway-token": "service-secret", authorization: "Bearer machine-key" } });
    assert.equal(response.status, 200, path);
    const body = await response.json();
    assert.equal(body.cookie, null, path);
    assert.equal(body.authorization, "Bearer machine-key", path);
  }
  const denied = await call("/api/gateway/events", { method: "POST", headers: { cookie: "session=browser" } });
  assert.equal(denied.status, 401, "Origin exemption must not authenticate a service");
  for (const path of ["/api/bot-fake", "/api/gateway-fake", "/api/mcp-fake", "/api/tg/tickets/add", "/api/tg/unknown", "/api/external/approval/token/decision", "/api/external/users/update", "/api/tickets/process"]) {
    assert.equal((await call(path, { method: "POST", headers: { "x-tg-token": "spoof" } })).status, 403, path);
  }
});

test("bot-ticket multipart uses the active route and unknown ticket paths return 404", async (t) => {
  const call = await harness(t);
  const form = new FormData();
  form.append("attachments", new Blob(["telegram image"]), "image.png");
  const response = await call("/api/bot/tickets", { method: "POST", headers: { "x-tg-token": "service-secret", cookie: "session=browser" }, body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.files, 1);
  assert.equal(body.cookie, null);
  assert.equal((await call("/api/bot/tickets/add", { method: "POST", headers: { "x-tg-token": "service-secret", cookie: "session=browser" } })).status, 404);
  assert.equal((await call("/api/bot/tickets/unknown", { method: "POST", headers: { "x-tg-token": "service-secret" } })).status, 404);
});

test("navigation and magic GET remain reachable; forbidden raw auth paths remain 404", async (t) => {
  const call = await harness(t);
  assert.equal((await call("/api/auth/magic-link/verify?token=link")).status, 200);
  const legacy = await call("/api/tg/tickets/all-opened", { headers: { cookie: "session=browser" } });
  assert.equal((await legacy.json()).cookie, null);
  assert.equal((await call("/api/tickets", { headers: { cookie: "session=old" } })).status, 200);
  for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-in/magic-link", "/api/auth/admin/create-user"]) {
    assert.equal((await call(path, { method: "POST", body: "bad json", headers: { "content-type": "application/json" } })).status, 404);
  }
  assert.equal((await call("/api/auth/two-factor/enable", { method: "POST", body: "bad json", headers: { "content-type": "application/json" } })).status, 403);
});

test("Origin exemptions still enforce real Telegram, MCP and company credential gates", async (t) => {
  const loggerId = require.resolve("../utils/logger");
  const originalLogger = require.cache[loggerId];
  require.cache[loggerId] = { id: loggerId, filename: loggerId, loaded: true, exports: { addNoAuthContext: () => ({ log() {} }) } };
  const originalToken = process.env.TG_API_TOKEN;
  process.env.TG_API_TOKEN = "test-telegram-service-key";
  t.after(() => {
    if (originalLogger) require.cache[loggerId] = originalLogger;
    else delete require.cache[loggerId];
    if (originalToken === undefined) delete process.env.TG_API_TOKEN;
    else process.env.TG_API_TOKEN = originalToken;
  });
  const isTelegramBot = require("./isTelegramBot");
  const isAuthApiKey = require("./isAuthApiKey");
  const { createRequireMcpKey } = require("./requireMcpKey");
  const { hashApiKey } = require("../utils/apiKeyGenerator");
  const Company = require("../models/company");
  const companyKey = `hd_${"a".repeat(64)}`;
  const mcpKey = `hd_mcp_${"b".repeat(64)}`;
  t.mock.method(Company, "findOne", async (query) => query.apiKeys.$elemMatch.$or[0].keyHash === hashApiKey(companyKey)
    ? { _id: "synthetic-company", alias: "test", fullTitle: "test", apiKeys: [{ _id: "synthetic-key", keyHash: hashApiKey(companyKey), isActive: true, lastUsedAt: new Date() }] }
    : null);
  const app = express();
  app.use(browserOrigin({ publicUrl: ORIGIN }));
  app.use(express.json());
  const echo = (req, res) => res.json({ cookie: req.headers.cookie ?? null, company: req.company?._id, mcp: req.mcpKey?._id });
  app.post(["/api/bot/identity", "/api/tg/auth", "/api/tg/set-work-status"], isTelegramBot, echo);
  app.post("/api/mcp", createRequireMcpKey({ findKeyByHash: async (hash) => hash === hashApiKey(mcpKey) ? { _id: "synthetic-mcp", lastUsedAt: new Date(), scopes: [] } : null, touchKey: async () => assert.fail("unexpected persistence"), log() {} }), echo);
  app.post(["/api/external/log/user-activity", "/api/external/ticket/create"], isAuthApiKey, echo);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ status: err.statusCode }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const [path, credentials, identity] of [
    ["/api/bot/identity", { "x-tg-token": process.env.TG_API_TOKEN }, {}],
    ["/api/tg/auth", { "x-tg-token": process.env.TG_API_TOKEN }, {}],
    ["/api/tg/set-work-status", { "x-tg-token": process.env.TG_API_TOKEN }, {}],
    ["/api/mcp", { authorization: `Bearer ${mcpKey}` }, { mcp: "synthetic-mcp" }],
    ["/api/external/log/user-activity", { "x-api-key": companyKey }, { company: "synthetic-company" }],
    ["/api/external/ticket/create", { authorization: `ApiKey ${companyKey}` }, { company: "synthetic-company" }],
  ]) {
    const call = (headers) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { cookie: "session=browser", ...headers } });
    assert.equal((await call({})).status, 401, path);
    assert.equal((await call({ authorization: "Bearer browser-session", "x-tg-token": "spoof", "x-api-key": "spoof" })).status, 401, path);
    const accepted = await call(credentials);
    assert.equal(accepted.status, 200, path);
    assert.deepEqual(await accepted.json(), { cookie: null, ...identity }, path);
  }
});
