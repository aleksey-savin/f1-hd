// node --test middleware/bodyParsers.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  ANONYMOUS_BODY_PATHS,
  BODY_LIMITS,
  EDITOR_BODY_PATHS,
  mountBodyParsers,
} = require("./bodyParsers");

/**
 * Лимиты тела по классу маршрута: анонимные ручки — 100 КБ, редакторы с
 * картинками — 50 МБ, остальное — 10 МБ. Парсеры путей стоят до общего, и
 * общий не перечитывает уже разобранное тело.
 */

const KB = 1024;
const MB = 1024 * KB;

let server;
let base;

before(async () => {
  const app = express();
  mountBodyParsers(app);
  // Эхо: сколько символов тела дошло до маршрута разобранным
  app.use((req, res) => {
    res.status(200).json({ chars: JSON.stringify(req.body ?? null).length });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ type: error.type || null });
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const json = (bytes) => JSON.stringify({ blob: "x".repeat(bytes) });
const form = (bytes) => `blob=${"x".repeat(bytes)}`;

const post = async (path, body, type = "application/json") => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });
  return { status: response.status, body: await response.json() };
};

test("limits are the ones the spec fixes", () => {
  assert.deepEqual({ ...BODY_LIMITS }, {
    anonymous: "100kb",
    editor: "50mb",
    default: "10mb",
  });
  assert.deepEqual([...ANONYMOUS_BODY_PATHS], [
    "/api/login",
    "/api/login-code",
    "/api/password",
    "/api/impersonate/claim",
    "/api/external/approval",
  ]);
  assert.equal(EDITOR_BODY_PATHS.length, 6);
});

test("anonymous endpoints: 100 KB, JSON and forms alike", async () => {
  for (const path of [
    "/api/login",
    "/api/login/two-factor",
    "/api/login-code",
    "/api/login-code/verify",
    "/api/login-code/password",
    "/api/password/check",
    "/api/impersonate/claim",
    "/api/external/approval/some-token/decision",
  ]) {
    assert.equal((await post(path, json(50 * KB))).status, 200, path);
    const refused = await post(path, json(200 * KB));
    assert.equal(refused.status, 413, path);
    assert.equal(refused.body.type, "entity.too.large", path);
    assert.equal(
      (await post(path, form(200 * KB), "application/x-www-form-urlencoded")).status,
      413,
      `${path} (form)`,
    );
  }
});

test("everything else: 10 MB", async () => {
  for (const path of [
    "/api/tickets/process",
    "/api/external/ticket/create",
    "/api/preferences",
    "/api/ticket-templates/66aa00000000000000000001/checklist",
  ]) {
    const accepted = await post(path, json(5 * MB));
    assert.equal(accepted.status, 200, path);
    assert.ok(accepted.body.chars > 5 * MB, path);
    assert.equal((await post(path, json(11 * MB))).status, 413, path);
  }
  assert.equal(
    (await post("/api/tickets/process", form(11 * MB), "application/x-www-form-urlencoded")).status,
    413,
  );
});

test("editor saves keep 50 MB, and the global parser does not re-read them", async () => {
  for (const path of [
    "/api/knowledge-notes/add",
    "/api/knowledge-notes/update/66aa00000000000000000001",
    "/api/ticket-templates/add",
    "/api/ticket-templates/update/66aa00000000000000000001",
    "/api/routine-tasks/add",
    "/api/routine-tasks/update/66aa00000000000000000001",
  ]) {
    const accepted = await post(path, json(20 * MB));
    assert.equal(accepted.status, 200, path);
    assert.ok(accepted.body.chars > 20 * MB, path);
  }
  assert.equal(
    (await post("/api/knowledge-notes/add", json(51 * MB))).status,
    413,
  );
});
