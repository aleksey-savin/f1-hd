// node --test middleware/rejectOperatorKeys.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  OPERATOR_GUARD_PATHS,
  findOperatorKey,
  rejectOperatorKeys,
} = require("./rejectOperatorKeys");

/**
 * Ключи-операторы Mongo (`$…` или с точкой) в теле анонимных ручек и внешнего
 * API — 400 формой общего обработчика. Значения не проверяются; остальные
 * маршруты пока не охраняются (глобально — W5).
 */

test("finds operator keys at any depth, in objects and arrays", () => {
  assert.equal(findOperatorKey({ email: { $ne: null } }), "$ne");
  assert.equal(findOperatorKey({ a: [{ b: [{ $where: "1" }] }] }), "$where");
  assert.equal(findOperatorKey({ "company._id": "x" }), "company._id");
  assert.equal(findOperatorKey([{ ok: 1 }, { "a.b": 2 }]), "a.b");
});

test("clean bodies and non-objects pass", () => {
  for (const body of [
    undefined,
    null,
    "text",
    42,
    {},
    [],
    { email: "a.b@c.d", password: "$ecret", nested: { list: ["$x", "y.z"] } },
  ]) {
    assert.equal(findOperatorKey(body), null, JSON.stringify(body));
  }
});

test("deep nesting is walked without recursion", () => {
  let deep = { $gt: "" };
  for (let depth = 0; depth < 100000; depth += 1) deep = [deep];
  assert.equal(findOperatorKey({ value: deep }), "$gt");

  let clean = "leaf";
  for (let depth = 0; depth < 100000; depth += 1) clean = { next: clean };
  assert.equal(findOperatorKey(clean), null);
});

test("guarded paths are the anonymous endpoints and the external API", () => {
  assert.deepEqual([...OPERATOR_GUARD_PATHS], [
    "/api/external",
    "/api/login",
    "/api/login-code",
    "/api/password",
    "/api/impersonate/claim",
  ]);
});

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(OPERATOR_GUARD_PATHS, rejectOperatorKeys);
  app.use((req, res) => res.status(200).json({ passed: true }));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = async (path, body, type = "application/json") => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: type === "application/json" ? JSON.stringify(body) : body,
  });
  return { status: response.status, body: await response.json() };
};

test("guarded endpoints answer 400 in the usual error shape", async () => {
  const cases = [
    ["/api/login", { email: { $ne: null }, password: "x" }],
    ["/api/login/two-factor", { code: { $gt: "" } }],
    ["/api/login-code/verify", { email: "a@b.c", code: "1", "company._id": "x" }],
    ["/api/password/check", { password: { $regex: ".*" } }],
    ["/api/impersonate/claim", { code: { $exists: true } }],
    ["/api/external/ticket/create", { title: "t", customFields: [{ name: "n", value: { $gt: "" } }] }],
    ["/api/external/log/user-activity", { activeDirectoryObjectGUID: { $ne: null } }],
    ["/api/external/approval/tok/decision", { approve: true, comment: { $ne: 1 } }],
  ];
  for (const [path, body] of cases) {
    const response = await post(path, body);
    assert.equal(response.status, 400, path);
    assert.equal(response.body.error, true, path);
    assert.equal(response.body.status, 400, path);
    assert.equal(response.body.code, "ERR_400", path);
    assert.match(response.body.message, /Недопустимое имя поля/, path);
  }
});

test("urlencoded operator keys are caught too", async () => {
  const response = await post(
    "/api/impersonate/claim",
    "code[$ne]=1",
    "application/x-www-form-urlencoded",
  );
  assert.equal(response.status, 400);
});

test("clean bodies pass; unguarded routes are not touched yet", async () => {
  assert.equal(
    (await post("/api/login", { email: "a.b@c.d", password: "$ecret" })).status,
    200,
  );
  assert.equal(
    (await post("/api/external/ticket/create", { title: "t", userEmail: "a@b.c" })).status,
    200,
  );
  assert.equal((await post("/api/tickets/add", { $where: "1" })).status, 200);
});

test("the reflected key is truncated in the message", async () => {
  const response = await post("/api/login", { ["$" + "x".repeat(5000)]: 1 });
  assert.equal(response.status, 400);
  assert.ok(response.body.message.length < 200, String(response.body.message.length));
});

test("only a leading $ marks an operator key", () => {
  assert.equal(findOperatorKey({ price$: 1, a$b: 2 }), null);
});

test("a wide body is walked in linear time", () => {
  const started = Date.now();
  assert.equal(findOperatorKey({ list: new Array(300_000).fill(0) }), null);
  assert.ok(Date.now() - started < 2000, "walk took too long");
});
