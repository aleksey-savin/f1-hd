// node --test middleware/appMountOrder.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Порядок слоёв в app.js держит три защиты W1: список открытых ручек
 * better-auth (authPathAllowList), лимиты тела по классу маршрута
 * (bodyParsers) и отказ ключам-операторам (rejectOperatorKeys). Сам app.js в
 * тестах не загружается — он поднимает базу и сервер, — поэтому порядок
 * проверяется по исходнику: удалённая или переставленная строка роняет тест.
 */

const lines = fs
  .readFileSync(path.join(__dirname, "..", "app.js"), "utf8")
  .split("\n");

/**
 * Номер единственной строки, которая начинается с этого текста; ноль строк или
 * две — провал. Закомментированная `//` строка не считается.
 */
const lineOf = (text) => {
  const found = lines.flatMap((line, index) =>
    line.trimStart().startsWith(text) ? [index + 1] : [],
  );
  assert.equal(found.length, 1, `«${text}» в app.js: строк ${found.length}, нужна одна`);
  return found[0];
};

const AUTH = 'app.all("/api/auth/*splat", authPathAllowList, authRequestHandler);';
const PARSERS = 'require("./middleware/bodyParsers").mountBodyParsers(app);';
const CORS = 'app.use(require("./middleware/cors"));';
const GUARD = "app.use(OPERATOR_GUARD_PATHS, rejectOperatorKeys);";

test("better-auth, behind its allow-list, comes before the body parsers", () => {
  assert.ok(lineOf(AUTH) < lineOf(PARSERS));
});

test("no parser is mounted beside the route-class limits", () => {
  // По всему тексту, а не построчно: вызов, перенесённый на несколько строк,
  // тоже ловится
  const direct = lines
    .join("\n")
    .match(/^[ \t]*app\.use\(\s*express\.(json|urlencoded)\(/gm);
  assert.equal(direct, null);
});

test("the operator guard follows the parsers and cors", () => {
  const guard = lineOf(GUARD);
  assert.ok(lineOf(PARSERS) < guard);
  assert.ok(lineOf(CORS) < guard);
});

test("every /api route but better-auth is mounted after the guard", () => {
  const guard = lineOf(GUARD);
  const auth = lineOf(AUTH);
  const early = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) =>
      /^\s*app\.(use|get|post|put|patch|delete|all)\(\s*["'`]\/api/.test(line),
    )
    .filter(({ number }) => number !== auth && number < guard);
  assert.deepEqual(early, []);
  assert.ok(lineOf('app.use("/api", internal);') > guard);
  assert.ok(lineOf('app.use("/api", external);') > guard);
});
