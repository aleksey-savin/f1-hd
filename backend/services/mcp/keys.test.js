// node --test services/mcp/keys.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");

const { issueMcpKey, toKeyRow } = require("./keys");
const { createRequireMcpKey } = require("../../middleware/requireMcpKey");

/**
 * Выдача ключа в настройках и его приём на `/api/mcp` — одна пара:
 * значение уходит администратору один раз, в базу — отпечаток и хвост.
 */

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("issue: a fresh hd_mcp_ key with its sha256 and last four characters", () => {
  const first = issueMcpKey();
  const second = issueMcpKey();

  assert.match(first.value, /^hd_mcp_[a-f0-9]{64}$/);
  assert.equal(first.keyHash, sha256(first.value));
  assert.equal(first.keyTail, first.value.slice(-4));
  assert.notEqual(first.value, second.value);
});

test("issue: the issued value is accepted by the MCP key check", async () => {
  const issued = issueMcpKey();
  const stored = { _id: "66aa00000000000000000007", name: "OpenClaw", lastUsedAt: null, keyHash: issued.keyHash };

  const app = express();
  app.post(
    "/mcp",
    createRequireMcpKey({
      findKeyByHash: async (hash) => (hash === stored.keyHash ? stored : null),
      touchKey: async () => {},
      log: () => {},
    }),
    (req, res) => res.json({ name: req.mcpKey.name }),
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${issued.value}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: "OpenClaw" });
  } finally {
    server.close();
  }
});

test("row: exposes name, tail, dates and author — never the hash", () => {
  const row = toKeyRow({
    _id: "66aa00000000000000000008",
    name: "OpenClaw",
    keyHash: "a".repeat(64),
    keyTail: "9f3c",
    createdBy: {
      _id: "62d0bdbf5a3314d41cc43eb1",
      firstName: "Алексей",
      lastName: "Савин",
      email: "someone@example.ru",
    },
    lastUsedAt: new Date("2026-09-17T10:00:00.000Z"),
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    updatedAt: new Date("2026-09-17T10:00:00.000Z"),
  });

  assert.deepEqual(row, {
    _id: "66aa00000000000000000008",
    name: "OpenClaw",
    keyTail: "9f3c",
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    lastUsedAt: new Date("2026-09-17T10:00:00.000Z"),
    createdBy: {
      _id: "62d0bdbf5a3314d41cc43eb1",
      firstName: "Алексей",
      lastName: "Савин",
    },
  });
});

test("row: a key whose author was deleted shows no author", () => {
  const row = toKeyRow({
    _id: "66aa00000000000000000009",
    name: "Старый",
    keyTail: "0001",
    createdBy: null,
    lastUsedAt: null,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
  });

  assert.equal(row.createdBy, null);
  assert.equal(row.lastUsedAt, null);
});
