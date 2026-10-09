// node --test middleware/authPathAllowList.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const express = require("express");

const {
  authPathAllowList,
  AUTH_HTTP_ROUTES,
  AUTH_BODY_LIMIT_BYTES,
} = require("./authPathAllowList");

/**
 * Снаружи до better-auth доходят только пять ручек, которыми пользуются фронт
 * и письма, и только с телом до 100 КБ по заявленной длине. Всё остальное под
 * /api/auth — 404 (или 413) в обычной форме ответа приложения, и сам
 * обработчик better-auth такого запроса не видит.
 */

const NOT_FOUND = {
  error: true,
  status: 404,
  code: "ERR_404",
  message: "Endpoint not found",
};

const TOO_LARGE = {
  error: true,
  status: 413,
  code: "ERR_413",
  message: "request entity too large",
};

const harness = () => {
  const reached = [];
  const app = express();
  // Как в app.js: список в том же маршруте, прямо перед обработчиком
  // better-auth. Заглушка читает тело сама, сырым потоком, — как better-auth.
  app.all("/api/auth/*splat", authPathAllowList, (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      reached.push(`${req.method} ${req.originalUrl}`);
      res.json({
        reached: true,
        body: Buffer.concat(chunks).toString("utf8"),
        contentLength: req.headers["content-length"] ?? null,
      });
    });
  });
  // Всё, что не поймал маршрут, — не better-auth: своя метка, а не HTML
  // finalhandler, чтобы тест читал ответ одинаково
  app.use((req, res) => res.status(404).json({ fallthrough: true }));
  return { app, reached };
};

const request = async (app, path, init) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      init,
    );
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.close();
  }
};

const call = (app, method, path, body) =>
  request(app, path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

/** Тело как есть: длина в байтах равна длине ASCII-строки. */
const postText = (app, path, text) =>
  request(app, path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: text,
  });

/** Потоковое тело: fetch шлёт его chunked, без Content-Length. */
const postStream = (app, path, text) =>
  request(app, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    duplex: "half",
  });

test("the list is exactly the five routes the app uses", () => {
  assert.deepEqual([...AUTH_HTTP_ROUTES].sort(), [
    "GET /api/auth/magic-link/verify",
    "POST /api/auth/reset-password",
    "POST /api/auth/two-factor/disable",
    "POST /api/auth/two-factor/enable",
    "POST /api/auth/two-factor/verify-totp",
  ]);
});

test("allowed routes reach better-auth with the raw body untouched", async () => {
  const { app, reached } = harness();

  for (const path of [
    "/api/auth/two-factor/enable",
    "/api/auth/two-factor/verify-totp",
    "/api/auth/two-factor/disable",
    "/api/auth/reset-password",
  ]) {
    const response = await call(app, "POST", path, { password: "секрет" });
    assert.equal(response.status, 200, path);
    assert.deepEqual(JSON.parse(response.body.body), { password: "секрет" });
  }

  // Ссылка из письма — со строкой запроса
  const verify = await call(
    app,
    "GET",
    "/api/auth/magic-link/verify?token=abc&callbackURL=%2F",
  );
  assert.equal(verify.status, 200);
  assert.equal(reached.length, 5);
  assert.equal(
    reached.at(-1),
    "GET /api/auth/magic-link/verify?token=abc&callbackURL=%2F",
  );
});

// Вход по ссылке по HTTP закрыт (итоговый разбор W1, I-1). Ручка публична, и на
// каждый вызов с адресом известного клиента система сама шлёт ему письмо «Вход в
// портал» со своего ящика поддержки — настоящее на вид. Учётка не нужна, а тормоз
// один, лимит better-auth в 5 в минуту на IP, и он дырявый: присланный клиентом
// X-Forwarded-For nginx дополняет своим значением, по двум значениям IP не
// определяется, и такие запросы идут в общее ведро — ещё 5 в минуту. Около десяти
// писем в минуту с одного адреса: так можно завалить клиентов и выжечь суточную
// квоту SMTP, а тогда встают коды, сбросы и все уведомления по заявкам.
// Настоящая дорога с экрана входа — /api/login-code (3 в час на адрес). Ссылки
// выписывает только сервер: приглашение зовёт auth.api.signInMagicLink внутри
// процесса (services/invitation.js), мимо HTTP-роутера и этого списка; фронт и
// бот ручку не зовут. Ссылка из письма по-прежнему открывается: GET verify в списке.
test("the public magic-link sign-in is closed, the link from the e-mail still opens", async () => {
  const { app, reached } = harness();

  for (const [method, path] of [
    ["POST", "/api/auth/sign-in/magic-link"],
    ["POST", "/api/auth/sign-in/magic-link?callbackURL=%2F"],
    ["GET", "/api/auth/sign-in/magic-link"],
  ]) {
    const response = await call(
      app,
      method,
      path,
      method === "POST" ? { email: "client@example.ru" } : undefined,
    );
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.deepEqual(response.body, NOT_FOUND, `${method} ${path}`);
  }
  assert.deepEqual(reached, [], "запрос дошёл до better-auth");

  const verify = await call(
    app,
    "GET",
    "/api/auth/magic-link/verify?token=abc&callbackURL=%2F",
  );
  assert.equal(verify.status, 200);
  assert.deepEqual(reached, [
    "GET /api/auth/magic-link/verify?token=abc&callbackURL=%2F",
  ]);
});

test("everything else under /api/auth is a 404 in the app's shape", async () => {
  const { app, reached } = harness();

  for (const [method, path] of [
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/sign-out"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/change-email"],
    ["POST", "/api/auth/request-password-reset"],
    ["GET", "/api/auth/reset-password/some-token"],
    ["POST", "/api/auth/admin/set-user-password"],
    ["POST", "/api/auth/admin/create-user"],
    ["POST", "/api/auth/admin/impersonate-user"],
    ["GET", "/api/auth/admin/list-users"],
    ["POST", "/api/auth/organization/create-role"],
    ["POST", "/api/auth/organization/update-member-role"],
    ["POST", "/api/auth/email-otp/send-verification-otp"],
    ["POST", "/api/auth/email-otp/reset-password"],
    ["POST", "/api/auth/sign-in/email-otp"],
    ["POST", "/api/auth/two-factor/get-totp-uri"],
    ["POST", "/api/auth/two-factor/generate-backup-codes"],
    ["POST", "/api/auth/two-factor/verify-backup-code"],
    ["GET", "/api/auth/ok"],
  ]) {
    const response = await call(app, method, path, method === "GET" ? undefined : {});
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.deepEqual(response.body, NOT_FOUND, `${method} ${path}`);
  }
  assert.deepEqual(reached, []);
});

test("an allowed path with another method or spelling is refused too", async () => {
  const { app, reached } = harness();

  for (const [method, path] of [
    ["GET", "/api/auth/two-factor/enable"],
    ["PUT", "/api/auth/reset-password"],
    ["POST", "/api/auth/magic-link/verify?token=abc"],
    ["OPTIONS", "/api/auth/two-factor/enable"],
    ["POST", "/api/auth/two-factor/enable/"],
    ["POST", "/api/auth/Two-Factor/Enable"],
    ["POST", "/api/auth/two-factor%2Fenable"],
    ["POST", "/api/auth//two-factor/enable"],
  ]) {
    const response = await call(app, method, path);
    assert.equal(response.status, 404, `${method} ${path}`);
  }

  // HEAD — без тела, только статус
  const head = await call(app, "HEAD", "/api/auth/magic-link/verify?token=abc");
  assert.equal(head.status, 404);
  assert.deepEqual(reached, []);
});

test("the body limit is 100 KB", () => {
  assert.equal(AUTH_BODY_LIMIT_BYTES, 102400);
});

test("a declared body over 100 KB is a 413 and never reaches better-auth", async () => {
  const { app, reached } = harness();
  const huge = { newPassword: "x".repeat(200 * 1024), token: "t" };

  const response = await call(app, "POST", "/api/auth/reset-password", huge);
  assert.equal(response.status, 413);
  assert.deepEqual(response.body, TOO_LARGE);

  // Чужой путь с тем же телом — по-прежнему 404: сначала список, потом размер
  const foreign = await call(app, "POST", "/api/auth/sign-in/email", huge);
  assert.equal(foreign.status, 404);
  assert.deepEqual(reached, []);
});

test("a body up to the limit passes, one byte more does not", async () => {
  const { app, reached } = harness();

  const atLimit = await postText(
    app,
    "/api/auth/reset-password",
    "x".repeat(AUTH_BODY_LIMIT_BYTES),
  );
  assert.equal(atLimit.status, 200);
  assert.equal(atLimit.body.body.length, AUTH_BODY_LIMIT_BYTES);

  const over = await postText(
    app,
    "/api/auth/reset-password",
    "x".repeat(AUTH_BODY_LIMIT_BYTES + 1),
  );
  assert.equal(over.status, 413);
  assert.deepEqual(over.body, TOO_LARGE);
  assert.equal(reached.length, 1);
});

test("a small body and a body without Content-Length pass to the next handler", async () => {
  const { app, reached } = harness();

  const small = await call(app, "POST", "/api/auth/reset-password", {
    newPassword: "x",
    token: "t",
  });
  assert.equal(small.status, 200);
  assert.deepEqual(JSON.parse(small.body.body), { newPassword: "x", token: "t" });

  const chunked = await postStream(
    app,
    "/api/auth/two-factor/enable",
    '{"password":"x"}',
  );
  assert.equal(chunked.status, 200);
  assert.equal(chunked.body.contentLength, null);
  assert.equal(chunked.body.body, '{"password":"x"}');
  assert.equal(reached.length, 2);
});

/**
 * Список сверяет путь запроса, но better-call, роутер better-auth, путь из
 * запроса не берёт: он собирает URL заново из `X-Forwarded-Proto`, `:authority`
 * или `Host` и `req.url` и роутит по pathname этого URL. `?`, `#`, `/` или `\`
 * в заголовках съедают настоящий путь — и закрытая ручка открывается при
 * разрешённом пути в запросе. Поэтому тесты ниже ставят список перед
 * НАСТОЯЩИМ toNodeHandler из better-auth/node; заглушка вместо `auth.handler`
 * отвечает тем, что увидел бы роутер.
 */

const BAD_REQUEST = {
  error: true,
  status: 400,
  code: "ERR_400",
  message: "bad request",
};

/** Как в instance.mjs, но с заглушкой: better-auth — ESM, грузим через import(). */
const realHandlerHarness = async () => {
  const { toNodeHandler } = await import("better-auth/node");
  const seen = [];
  const app = express();
  app.all(
    "/api/auth/*splat",
    authPathAllowList,
    toNodeHandler({
      handler: async (request) => {
        const url = new URL(request.url);
        seen.push({
          pathname: url.pathname,
          search: url.search,
          protocol: url.protocol,
          forwardedProto: request.headers.get("x-forwarded-proto"),
        });
        return new Response(url.pathname);
      },
    }),
  );
  app.use((req, res) => res.status(404).json({ fallthrough: true }));
  return { app, seen };
};

/** Сервер на время `run`; порт нужен тем, кто пишет `Host: localhost:PORT`. */
const withServer = async (app, run) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await run(server.address().port);
  } finally {
    server.close();
  }
};

/** Запрос по сырому сокету: fetch не даёт выставить `Host` как угодно. */
const rawRequest = (port, lines) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write([...lines, "Connection: close", "", ""].join("\r\n")),
    );
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => {
      const [head, ...rest] = data.split("\r\n\r\n");
      resolve({
        status: Number(head.split(" ")[1]),
        body: rest.join("\r\n\r\n"),
      });
    });
    socket.on("error", reject);
  });

const ENABLE = "POST /api/auth/two-factor/enable HTTP/1.1";

test("headers better-call builds its URL from cannot steer it to a closed route", async () => {
  const { app, seen } = await realHandlerHarness();

  await withServer(app, async (port) => {
    for (const [name, lines] of [
      [
        "Host carrying another path and a query",
        [ENABLE, "Host: x/api/auth/admin/create-user?", "Content-Length: 0"],
      ],
      [
        "Host with backslashes and a query",
        [ENABLE, "Host: x\\api\\auth\\sign-in\\email?", "Content-Length: 0"],
      ],
      [
        "Host with a fragment",
        [ENABLE, "Host: x/api/auth/sign-up/email#", "Content-Length: 0"],
      ],
      [
        "X-Forwarded-Proto carrying a whole URL",
        [
          ENABLE,
          "Host: hd.local",
          "X-Forwarded-Proto: http://x/api/auth/organization/update-member-role?",
          "Content-Length: 0",
        ],
      ],
      [
        "magic-link verify with a hostile Host",
        [
          "GET /api/auth/magic-link/verify?token=a HTTP/1.1",
          "Host: x/api/auth/admin/list-users?",
        ],
      ],
      // Не путь, но и не хост со схемой: отказ по тому же правилу
      [
        "no Host at all (HTTP/1.0)",
        ["POST /api/auth/two-factor/enable HTTP/1.0", "Content-Length: 0"],
      ],
      [
        "a scheme other than http and https",
        [ENABLE, "Host: hd.local", "X-Forwarded-Proto: ftp", "Content-Length: 0"],
      ],
      [
        "an empty X-Forwarded-Proto",
        [ENABLE, "Host: hd.local", "X-Forwarded-Proto:", "Content-Length: 0"],
      ],
    ]) {
      const response = await rawRequest(port, lines);
      assert.equal(response.status, 400, name);
      assert.deepEqual(JSON.parse(response.body), BAD_REQUEST, name);
    }
  });

  assert.deepEqual(seen, []);
});

test("ordinary Host values reach better-auth, which routes on the allowed path", async () => {
  const { app, seen } = await realHandlerHarness();

  await withServer(app, async (port) => {
    // Что шлёт nginx (`Host $host`, без порта) и что бывает напрямую
    for (const host of [
      `localhost:${port}`,
      "hd.example.com",
      "10.0.50.70:8080",
      "[::1]:8080",
    ]) {
      const response = await rawRequest(port, [
        ENABLE,
        `Host: ${host}`,
        "Content-Length: 0",
      ]);
      assert.equal(response.status, 200, host);
    }

    // Ссылка из письма: путь и строка запроса доходят как есть
    const verify = await rawRequest(port, [
      "GET /api/auth/magic-link/verify?token=abc&callbackURL=%2F HTTP/1.1",
      `Host: localhost:${port}`,
    ]);
    assert.equal(verify.status, 200);
  });

  assert.deepEqual(
    seen.map(({ pathname }) => pathname),
    [
      ...Array(4).fill("/api/auth/two-factor/enable"),
      "/api/auth/magic-link/verify",
    ],
  );
  assert.equal(seen.at(-1).search, "?token=abc&callbackURL=%2F");
});

test("X-Forwarded-Proto reaches better-call as one lower-case scheme", async () => {
  const { app, seen } = await realHandlerHarness();

  await withServer(app, async (port) => {
    // `https, http` — цепочка прокси; без разбора better-call собрал бы из неё
    // URL `https, http://…`, который не разбирается
    for (const proto of ["https, http", "HTTPS", "http", "https,http"]) {
      const response = await rawRequest(port, [
        ENABLE,
        `Host: localhost:${port}`,
        `X-Forwarded-Proto: ${proto}`,
        "Content-Length: 0",
      ]);
      assert.equal(response.status, 200, proto);
    }
  });

  assert.deepEqual(
    seen.map(({ forwardedProto }) => forwardedProto),
    ["https", "https", "http", "https"],
  );
  assert.deepEqual(
    seen.map(({ protocol }) => protocol),
    ["https:", "https:", "http:", "https:"],
  );
  assert.ok(
    seen.every(({ pathname }) => pathname === "/api/auth/two-factor/enable"),
  );
});

test("the HTTP/2 :authority pseudo-header is checked like Host", () => {
  // Node по HTTP/1.1 такой заголовок не принимает (400 от самого парсера): он
  // бывает только за http2-совместимым сервером, поэтому зовём список напрямую.
  const run = (headers) => {
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    let passed = false;
    authPathAllowList(
      { method: "POST", originalUrl: "/api/auth/two-factor/enable", headers },
      res,
      () => {
        passed = true;
      },
    );
    return { res, passed };
  };

  const hostile = run({
    host: "hd.local",
    ":authority": "x/api/auth/admin/create-user?",
  });
  assert.equal(hostile.passed, false);
  assert.equal(hostile.res.statusCode, 400);
  assert.deepEqual(hostile.res.body, BAD_REQUEST);

  assert.equal(
    run({ host: "hd.local", ":authority": "hd.example.com:8443" }).passed,
    true,
  );
});
