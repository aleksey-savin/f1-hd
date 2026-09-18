// node --test validations/mcpKey.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const mcpKeyValidation = require("./mcpKey");

// Ключи ИИ-агентов в настройках: название обязательно и обрезается —
// контроллер сверяет дубликаты уже по обрезанному значению.

const run = async (chains, body) => {
  const req = { body, params: {}, query: {}, headers: {}, cookies: {} };
  for (const chain of chains) await chain.run(req);
  return { req, errors: validationResult(req).array().map((error) => error.path) };
};

test("create: a name passes and arrives trimmed", async () => {
  const { req, errors } = await run(mcpKeyValidation.create, {
    name: "  OpenClaw  ",
  });

  assert.deepEqual(errors, []);
  assert.equal(req.body.name, "OpenClaw");
});

test("create: missing, blank, non-string and over-long names are refused", async () => {
  for (const body of [
    {},
    { name: "   " },
    { name: 42 },
    { name: ["OpenClaw"] },
    { name: "я".repeat(101) },
  ]) {
    const { errors } = await run(mcpKeyValidation.create, body);
    assert.deepEqual(errors, ["name"], JSON.stringify(body));
  }
});

test("create: a 100-character name is still accepted", async () => {
  const { errors } = await run(mcpKeyValidation.create, { name: "я".repeat(100) });

  assert.deepEqual(errors, []);
});

test("remove: only a valid ObjectId passes", async () => {
  assert.deepEqual(
    (await run(mcpKeyValidation.remove, { _id: "66aa00000000000000000001" })).errors,
    [],
  );
  for (const body of [{}, { _id: "nope" }, { _id: { $ne: null } }]) {
    const { errors } = await run(mcpKeyValidation.remove, body);
    assert.deepEqual(errors, ["_id"], JSON.stringify(body));
  }
});

test("create: scopes are optional but must be known when given", async () => {
  assert.deepEqual((await run(mcpKeyValidation.create, { name: "OpenClaw", scopes: ["knowledge", "tickets"] })).errors, []);
  assert.deepEqual((await run(mcpKeyValidation.create, { name: "OpenClaw" })).errors, []);
  assert.deepEqual((await run(mcpKeyValidation.create, { name: "OpenClaw", scopes: [] })).errors, ["scopes"]);
  assert.deepEqual((await run(mcpKeyValidation.create, { name: "OpenClaw", scopes: ["admin"] })).errors, ["scopes"]);
});

test("update: id and at least one known scope are required", async () => {
  assert.deepEqual((await run(mcpKeyValidation.update, { _id: "66aa00000000000000000001", scopes: ["tickets"] })).errors, []);
  assert.deepEqual((await run(mcpKeyValidation.update, { _id: "nope", scopes: ["tickets"] })).errors, ["_id"]);
  assert.deepEqual((await run(mcpKeyValidation.update, { _id: "66aa00000000000000000001" })).errors, ["scopes"]);
});
