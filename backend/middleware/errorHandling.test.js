// node --test middleware/errorHandling.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { inspect } = require("node:util");
const express = require("express");

const logger = require("../utils/logger");
const { AppError, errorResponse } = require("./errorHandling");
const { mountBodyParsers } = require("./bodyParsers");

const fakeRes = () => ({
  headersSent: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const captureLog = (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) =>
    entries.push({ level, message, meta }),
  );
  return entries;
};

/**
 * Всё, что ушло бы в журнал: аргументы `logger.log` (в него сходятся
 * `addNoAuthContext(...).log` и `logDirect`) отдельно от `console.error` —
 * последнего прибежища обработчика.
 */
const captureOutput = (t) => {
  const output = { logged: [], consoleErrors: [] };
  t.mock.method(logger, "log", (...args) => output.logged.push(args));
  t.mock.method(console, "error", (...args) => output.consoleErrors.push(args));
  return output;
};

/**
 * Вложенное содержимое строкой — вместе со stack и свойствами самих ошибок.
 * JSON.stringify для проверки «нигде нет пароля» не годится: message и stack
 * у Error неперечислимые, и ошибка, брошенная в журнал целиком, выглядела бы `{}`.
 */
const dump = (value) =>
  inspect(value, { depth: null, maxStringLength: null, maxArrayLength: null });

test("исходная ошибка попадает в журнал только полями из белого списка", (t) => {
  const entries = captureLog(t);
  const original = Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    keyValue: { email: "user@example.ru" },
    config: { headers: { Authorization: "Bearer secret-token" } },
  });
  const res = fakeRes();

  errorResponse(
    new AppError("Failed to create user", 500, true, original),
    { originalUrl: "/api/users", method: "POST", ip: "127.0.0.1" },
    res,
  );

  assert.equal(res.statusCode, 500);
  const [entry] = entries;
  assert.deepEqual(Object.keys(entry.meta.originalError).sort(), [
    "code",
    "message",
    "name",
    "stack",
  ]);
  assert.equal(entry.meta.originalError.code, 11000);
  assert.doesNotMatch(JSON.stringify(entry.meta), /user@example\.ru|secret-token/);
});

test("сырое тело из ошибки разбора JSON в журнал не попадает", (t) => {
  const entries = captureLog(t);
  // Так выглядит ошибка body-parser: тело запроса лежит в её свойстве `body`
  const parseError = Object.assign(new SyntaxError("Unexpected end of JSON input"), {
    status: 400,
    statusCode: 400,
    expose: true,
    type: "entity.parse.failed",
    body: '{"email":"user@example.ru","password":"hunter2"',
  });

  errorResponse(parseError, { originalUrl: "/api/login", method: "POST" }, fakeRes());

  const [entry] = entries;
  assert.deepEqual(entry.meta.originalError, {
    name: "SyntaxError",
    message: "Request body is not valid JSON",
    statusCode: 400,
  });
  assert.doesNotMatch(JSON.stringify(entry.meta), /hunter2/);
});

test("маршрут в журнале — без query и токена согласования", (t) => {
  const entries = captureLog(t);

  errorResponse(
    new AppError("Ссылка устарела", 410),
    {
      originalUrl: "/api/external/approval/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi/decision?x=1",
      method: "POST",
    },
    fakeRes(),
  );

  const [entry] = entries;
  assert.equal(entry.meta.route, "/api/external/approval/***/decision");
  assert.equal(entry.meta.endpoint, "/api/external/approval/***/decision");
});

test("окно из тела в тексте ошибки разбора JSON в журнал не попадает", (t) => {
  const entries = captureLog(t);
  // Настоящий текст V8 для `{"email":"user@example.ru","password":hunter2}`
  const parseError = Object.assign(
    new SyntaxError(`Unexpected token 'h', ..."password":hunter2}" is not valid JSON`),
    { status: 400, statusCode: 400, expose: true, type: "entity.parse.failed" },
  );
  const res = fakeRes();

  errorResponse(parseError, { originalUrl: "/api/login", method: "POST" }, res);

  assert.equal(res.statusCode, 400);
  assert.doesNotMatch(JSON.stringify(entries[0]), /hunter2/);
});

test("ошибка разбора JSON без запроса пишется тем же фиксированным текстом", (t) => {
  const entries = captureLog(t);
  const parseError = Object.assign(
    new SyntaxError(`Unexpected token 'h', ..."password":hunter2}" is not valid JSON`),
    { status: 400, statusCode: 400, expose: true, type: "entity.parse.failed" },
  );

  // Без req обработчик пишет через logger.logDirect — другая ветка того же вывода
  errorResponse(parseError, undefined, fakeRes());

  assert.equal(entries[0].message, "Request body is not valid JSON");
  assert.doesNotMatch(JSON.stringify(entries), /hunter2/);
});

// Пароль во всех трёх телах — `hunter2`. Текст ошибки разбора вписывает в себя
// кусок тела: V8 — окно вокруг первого неверного символа (или тело целиком, если
// оно короткое), body-parser в strict-режиме собирает такой текст сам.
const MALFORMED_LOGIN_BODIES = [
  // значение без кавычек: V8 цитирует окно вокруг «h»
  '{"email":"user@example.ru","password":hunter2}',
  // не объект и не массив: «strict violation» body-parser
  '"hunter2"',
  // форма под видом JSON
  "password=hunter2xyz",
];

test("битый JSON на входе: пароль не попадает ни в один аргумент журнала, клиент получает прежний 400", async (t) => {
  const { logged, consoleErrors } = captureOutput(t);
  // Настоящие парсеры из app.js и настоящий обработчик ошибок — без заглушек
  const app = express();
  mountBodyParsers(app);
  app.post("/api/login", (req, res) => res.json({ ok: true }));
  app.use(errorResponse);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const body of MALFORMED_LOGIN_BODIES) {
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const answer = await response.json();
    // Ответ клиенту прежний: 400 и текст самого разбора — это его же тело, а не
    // фиксированная строка журнала
    assert.equal(response.status, 400, body);
    assert.equal(answer.code, "ERR_400", body);
    assert.match(answer.message, /^Unexpected token/, body);
  }

  // Каждая ошибка записана ровно раз и мимо console.error
  assert.equal(logged.length, MALFORMED_LOGIN_BODIES.length);
  assert.deepEqual(consoleErrors, []);
  assert.doesNotMatch(dump({ logged, consoleErrors }), /hunter2/);
});

test("обычная ошибка попадает в журнал с сообщением и stack, как раньше", (t) => {
  const entries = captureLog(t);

  errorResponse(
    new AppError("Заявка не найдена", 404),
    { originalUrl: "/api/tickets/51713", method: "GET" },
    fakeRes(),
  );

  const [entry] = entries;
  assert.equal(entry.message, "Заявка не найдена");
  assert.match(entry.meta.stack, /Заявка не найдена/);
});

test("сломался сам журнал: в console.error — сбой журнала и поля исходной ошибки из белого списка", (t) => {
  t.mock.method(logger, "log", () => {
    throw new Error("transport down");
  });
  const consoleCalls = [];
  t.mock.method(console, "error", (...args) => consoleCalls.push(args));
  const original = Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    keyValue: { email: "user@example.ru" },
    config: { headers: { Authorization: "Bearer secret-token" } },
  });
  const res = fakeRes();

  errorResponse(original, { originalUrl: "/api/users", method: "POST" }, res);

  // Клиент всё равно получает ответ
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Internal server error occurred");
  assert.equal(consoleCalls.length, 2);
  assert.equal(consoleCalls[0][0], "Error in error handling middleware:");
  assert.equal(consoleCalls[0][1].message, "transport down");
  assert.equal(consoleCalls[1][0], "Original error:");
  assert.deepEqual(consoleCalls[1][1], {
    name: "Error",
    message: "E11000 duplicate key error",
    code: 11000,
    stack: original.stack,
  });
  assert.doesNotMatch(dump(consoleCalls), /user@example\.ru|secret-token/);
});

// Запрос без повторного использования соединения: после ответа финальный обработчик
// Express рвёт сокет, и keep-alive у fetch на следующем запросе поймал бы обрыв
const send = (base, method, path, body) =>
  new Promise((resolve, reject) => {
    const request = http.request(
      `${base}${path}`,
      {
        method,
        agent: false,
        headers:
          body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode, text }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });

test("сломался сам журнал на битом входе: пароля нет ни в журнале, ни в stderr финального обработчика, ни в ответе", async (t) => {
  // Журнал бросает → errorResponse уходит в catch, отвечает запасным 500 и зовёт
  // next(error): финальный обработчик Express печатает err.stack в console.error
  const logged = [];
  const consoleErrors = [];
  t.mock.method(logger, "log", (...args) => {
    logged.push(args);
    throw new Error("transport down");
  });
  t.mock.method(console, "error", (...args) => consoleErrors.push(args));
  const app = express();
  // Финальный обработчик молчит только при env=test; тест не должен от этого зависеть
  app.set("env", "development");
  mountBodyParsers(app);
  app.post("/api/login", (req, res) => res.json({ ok: true }));
  app.get("/boom", (req, res, next) => next(new Error("boom-original")));
  app.use(errorResponse);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const answers = [];
  for (const body of MALFORMED_LOGIN_BODIES) {
    answers.push(await send(base, "POST", "/api/login", body));
  }
  // Контроль стенда: обычную ошибку при том же сбое журнала финальный обработчик
  // печатает как есть, а значит, его stderr здесь виден — и отсутствие пароля в нём
  // что-то доказывает
  await send(base, "GET", "/boom");
  // onerror у финального обработчика отложен до setImmediate
  await new Promise((resolve) => setImmediate(resolve));

  // Клиент получает прежний запасной ответ
  for (const answer of answers) {
    assert.equal(answer.status, 500);
    assert.equal(JSON.parse(answer.text).message, "Internal server error occurred");
  }
  assert.ok(
    consoleErrors.some(
      ([first]) => typeof first === "string" && first.startsWith("Error: boom-original"),
    ),
    "контроль: финальный обработчик должен напечатать stack обычной ошибки",
  );
  assert.doesNotMatch(dump({ logged, consoleErrors, answers }), /hunter2/);
});

test("брошенное не-объект попадает в журнал как { message }", (t) => {
  const entries = captureLog(t);

  for (const thrown of ["boom", 42]) {
    errorResponse(thrown, { originalUrl: "/api/x", method: "GET" }, fakeRes());
  }

  assert.deepEqual(
    entries.map((entry) => entry.meta.originalError),
    [{ message: "boom" }, { message: "42" }],
  );
});

test("брошенный null не роняет обработчик: последнее прибежище пишет { message }", (t) => {
  t.mock.method(logger, "log", () => {});
  const consoleCalls = [];
  t.mock.method(console, "error", (...args) => consoleCalls.push(args));
  const res = fakeRes();

  errorResponse(null, { originalUrl: "/api/x", method: "GET" }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(consoleCalls[1], ["Original error:", { message: "null" }]);
});

test("форма сверх лимита параметров: пароль из `body` ошибки в журнал не попадает", async (t) => {
  // body-parser кладёт сырое тело в свойство `body` не только у ошибок JSON: оно есть и у
  // «too many parameters» (413), и у «input exceeded the depth» — белый список его не пропускает
  const { logged, consoleErrors } = captureOutput(t);
  const app = express();
  mountBodyParsers(app);
  app.post("/api/login", (req, res) => res.json({ ok: true }));
  app.use(errorResponse);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `password=hunter2${"&x=1".repeat(1001)}`,
  });

  assert.equal(response.status, 413);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(dump({ logged, consoleErrors }), /hunter2/);
});

test("ошибка разбора при уже отправленных заголовках: дальше уходит чистая копия", (t) => {
  // Ответ уже ушёл, поэтому errorResponse доходит до next(...) — туда, где финальный обработчик
  // Express печатает stack. Копия: фиксированный текст, прежний код, без исходной ошибки внутри
  t.mock.method(logger, "log", () => {});
  const parseError = Object.assign(
    new SyntaxError(`Unexpected token 'h', ..."password":hunter2}" is not valid JSON`),
    { status: 400, statusCode: 400, expose: true, type: "entity.parse.failed", body: '{"password":hunter2}' },
  );
  const res = {
    headersSent: true,
    status() {
      throw new Error("ответ уже отправлен");
    },
  };
  const forwarded = [];

  errorResponse(parseError, { originalUrl: "/api/login", method: "POST" }, res, (arg) => forwarded.push(arg));

  assert.equal(forwarded.length, 1);
  const [copy] = forwarded;
  assert.ok(copy instanceof AppError);
  assert.equal(copy.statusCode, 400);
  assert.equal(copy.message, "Request body is not valid JSON");
  assert.equal(copy.originalError, null);
  assert.doesNotMatch(inspect(copy, { depth: null }), /hunter2/);
});
