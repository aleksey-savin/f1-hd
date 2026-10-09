// node --test helpers/redactUrl.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { redactUrl } = require("./redactUrl");
const logger = require("../utils/logger");
const { performanceMonitor } = require("../middleware/performance");

const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdo";

test("redactUrl отрезает query и маскирует токен согласования", () => {
  assert.equal(redactUrl("/api/tickets/51713?search=принтер"), "/api/tickets/51713");
  assert.equal(
    redactUrl("/api/auth/magic-link/verify?token=abc&callbackURL=%2F"),
    "/api/auth/magic-link/verify",
  );
  assert.equal(redactUrl(`/api/external/approval/${TOKEN}`), "/api/external/approval/***");
  assert.equal(
    redactUrl(`/api/external/approval/${TOKEN}/decision?x=1`),
    "/api/external/approval/***/decision",
  );
});

test("redactUrl не трогает остальное", () => {
  assert.equal(redactUrl("/api/approval/64f200000000000000000001"), "/api/approval/64f200000000000000000001");
  assert.equal(redactUrl("/api/external/approval"), "/api/external/approval");
  assert.equal(redactUrl("/health"), "/health");
  assert.equal(redactUrl(""), "");
  assert.equal(redactUrl(undefined), undefined);
});

test("журнал запроса пишет endpoint без query и токена", (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => entries.push(meta));
  const req = {
    originalUrl: `/api/external/approval/${TOKEN}/decision?comment=x`,
    method: "POST",
  };

  logger.addNoAuthContext(req).log("error", "сбой");

  assert.equal(entries[0].endpoint, "/api/external/approval/***/decision");
});

test("журнал запроса с авторизацией — тоже", async (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => entries.push(meta));
  const req = { originalUrl: "/api/users?email=user@example.ru", method: "GET" };

  (await logger.addContext(req)).log("info", "запрос");

  assert.equal(entries[0].endpoint, "/api/users");
});

test("медленный запрос пишется без query и токена", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const warnings = [];
  t.mock.method(logger, "warn", (message, meta) => warnings.push({ message, meta }));
  const req = {
    method: "GET",
    url: `/approval/${TOKEN}?x=1`,
    originalUrl: `/api/external/approval/${TOKEN}?x=1`,
    get: () => "test-agent",
    ip: "127.0.0.1",
  };
  const res = { statusCode: 200, headersSent: false, setHeader: () => {}, end: () => {} };

  performanceMonitor(req, res, () => {});
  t.mock.timers.tick(1500);
  res.end();

  assert.equal(warnings.length, 1);
  assert.equal(
    warnings[0].message,
    "Slow request detected: GET /api/external/approval/*** - 1500ms",
  );
  assert.equal(warnings[0].meta.url, "/api/external/approval/***");
});

test("redactUrl: Express ищет маршрут без учёта регистра, и маска тоже", () => {
  assert.equal(redactUrl(`/api/EXTERNAL/approval/${TOKEN}`), "/api/EXTERNAL/approval/***");
  assert.equal(redactUrl(`/api/external/APPROVAL/${TOKEN}/decision`), "/api/external/APPROVAL/***/decision");
});

test("журнал каждого запроса в development — без query и токена", (t) => {
  // В development performanceMonitor пишет строку про каждый запрос, не только
  // про медленные. NODE_ENV читается в момент ответа, так что хватает выставить
  // его на время теста
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  t.after(() => {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  });
  t.mock.timers.enable({ apis: ["Date"] });
  const infos = [];
  t.mock.method(logger, "info", (message) => infos.push(message));
  const req = {
    method: "POST",
    originalUrl: `/api/external/approval/${TOKEN}/decision?comment=secret-comment`,
    get: () => "test-agent",
    ip: "127.0.0.1",
  };
  const res = { statusCode: 200, headersSent: false, setHeader: () => {}, end: () => {} };

  performanceMonitor(req, res, () => {});
  t.mock.timers.tick(40);
  res.end();

  assert.deepEqual(infos, ["POST /api/external/approval/***/decision - 40ms - 200"]);
});
