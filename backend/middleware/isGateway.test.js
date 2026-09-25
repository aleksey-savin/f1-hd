// node --test middleware/isGateway.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createIsGateway } = require("./isGateway");

const serve = async (middleware) => {
  const app = express();
  app.get("/ping", middleware, (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test("the gateway secret is required, in the header only", async () => {
  const { base, close } = await serve(createIsGateway({ getToken: () => "s3cret-token", log: () => {} }));
  try {
    assert.equal((await fetch(`${base}/ping`)).status, 401);
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "wrong" } })).status, 401);
    assert.equal((await fetch(`${base}/ping?token=s3cret-token`)).status, 401);
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "s3cret-token" } })).status, 200);
  } finally {
    await close();
  }
});

test("an empty secret closes the gateway API", async () => {
  const logs = [];
  const { base, close } = await serve(createIsGateway({ getToken: () => "", log: (level) => logs.push(level) }));
  try {
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "" } })).status, 401);
    assert.deepEqual(logs, ["error"]);
  } finally {
    await close();
  }
});
