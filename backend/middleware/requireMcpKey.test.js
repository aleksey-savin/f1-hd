// node --test middleware/requireMcpKey.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");

const { createRequireMcpKey } = require("./requireMcpKey");

/**
 * Ключ ИИ-агента к MCP: `Authorization: Bearer hd_mcp_…`, в базе — отпечаток.
 *
 * Отказ отвечается здесь же, JSON-ом с вызовом `WWW-Authenticate` (клиенты MCP
 * по нему понимают, что дело в ключе), а не через `next(AppError)`: общий
 * обработчик после ответа зовёт `next(error)`, и finalhandler рвёт сокет.
 */

const KEY = `hd_mcp_${"ab12".repeat(16)}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

const harness = ({ key = null, lookupError = null, touchError = null } = {}) => {
  const calls = { lookups: [], touches: [], logs: [] };
  const requireMcpKey = createRequireMcpKey({
    findKeyByHash: async (hash) => {
      calls.lookups.push(hash);
      if (lookupError) throw lookupError;
      return key;
    },
    touchKey: async (id) => {
      calls.touches.push(String(id));
      if (touchError) throw touchError;
    },
    log: (level, message, meta) => calls.logs.push({ level, message, meta }),
    now: () => NOW,
  });

  const app = express();
  app.post("/mcp", requireMcpKey, (req, res) => res.json({ mcpKey: req.mcpKey }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => res.status(500).json({ failed: error.message }));
  return { app, calls };
};

const post = async (app, { headers = {}, path = "/mcp" } = {}) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: "POST",
      headers,
    });
    return {
      status: response.status,
      challenge: response.headers.get("www-authenticate"),
      body: await response.json(),
    };
  } finally {
    server.close();
  }
};

const bearer = (value) => ({ Authorization: `Bearer ${value}` });

test("no key: 401 with a Bearer challenge and no database lookup", async () => {
  const { app, calls } = harness();

  const response = await post(app);

  assert.equal(response.status, 401);
  assert.match(response.challenge, /^Bearer /);
  assert.equal(response.body.error, true);
  assert.deepEqual(calls.lookups, []);
});

test("malformed or foreign keys never reach the database", async () => {
  const { app, calls } = harness();
  const companyKey = `hd_${"ab12".repeat(16)}`;

  for (const value of ["hd_mcp_short", companyKey, `${KEY}x`, KEY.toUpperCase()]) {
    assert.equal((await post(app, { headers: bearer(value) })).status, 401);
  }
  assert.equal(
    (await post(app, { headers: { "X-API-Key": KEY } })).status,
    401,
  );
  assert.equal((await post(app, { path: `/mcp?key=${KEY}` })).status, 401);
  assert.deepEqual(calls.lookups, []);
});

test("unknown key: looked up by its sha256 and refused", async () => {
  const { app, calls } = harness({ key: null });

  const response = await post(app, { headers: bearer(KEY) });

  assert.equal(response.status, 401);
  assert.deepEqual(calls.lookups, [sha256(KEY)]);
});

test("known key: passes and exposes only its id and name", async () => {
  const key = {
    _id: "66aa00000000000000000001",
    name: "OpenClaw",
    lastUsedAt: new Date(NOW - 5 * 60 * 1000),
  };
  const { app } = harness({ key });

  const response = await post(app, { headers: bearer(KEY) });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.mcpKey, {
    _id: "66aa00000000000000000001",
    name: "OpenClaw",
  });
});

test("last use is recorded when missing or older than an hour, not more often", async () => {
  const cases = [
    { lastUsedAt: null, touched: true },
    { lastUsedAt: new Date(NOW - 10 * 60 * 1000), touched: false },
    { lastUsedAt: new Date(NOW - 2 * HOUR), touched: true },
  ];

  for (const { lastUsedAt, touched } of cases) {
    const { app, calls } = harness({
      key: { _id: "66aa00000000000000000002", name: "k", lastUsedAt },
    });
    await post(app, { headers: bearer(KEY) });
    assert.deepEqual(
      calls.touches,
      touched ? ["66aa00000000000000000002"] : [],
      `lastUsedAt=${lastUsedAt}`,
    );
  }
});

test("a failing last-use write does not fail the request", async () => {
  const { app } = harness({
    key: { _id: "66aa00000000000000000003", name: "k", lastUsedAt: null },
    touchError: new Error("write conflict"),
  });

  assert.equal((await post(app, { headers: bearer(KEY) })).status, 200);
});

test("a lookup failure goes to the error handler, not to a 401", async () => {
  const { app } = harness({ lookupError: new Error("mongo down") });

  const response = await post(app, { headers: bearer(KEY) });

  assert.equal(response.status, 500);
  assert.equal(response.body.failed, "mongo down");
});

test("refusals are logged as warnings without the key value", async () => {
  const { app, calls } = harness({ key: null });

  await post(app, { headers: bearer(KEY) });
  await post(app, { headers: bearer("hd_mcp_short") });

  assert.equal(calls.logs.length, 2);
  assert.ok(calls.logs.every((entry) => entry.level === "warn"));
  assert.ok(!JSON.stringify(calls.logs).includes("ab12ab12"));
});
