# W1 Security Hot-fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the productization audit's "Now" security holes (S1–S8, S10–S12, S14, plus the multer/mailparser/xlsx part of S15, the 422 part of O6, and O7) in one batch. Nothing user-visible changes except the three decisions the owner approved.

**Architecture:** Every decision lives in a small pure or dependency-injected module (under `services/`, `auth/`, `helpers/`, `middleware/`), with `node:test` tests written first. Controllers, `app.js` and `emailHandling.js` get only thin wiring. All work happens in a separate git worktree and is never committed. The final task brings the result into main's working tree for the owner to review and commit.

**Tech Stack:**
- Node 24, CommonJS plus `.ts` via type stripping;
- Express 5, Mongoose, better-auth 1.6.26, mailparser/imap-simple, `node:test`;
- React + Tailwind/shadcn (one form field);
- tg-service in TypeScript (grammY).

**Spec:** `docs/superpowers/specs/2026-09-30-security-hotfixes-w1-design.md`. The IDs S*/O*/C* refer to `docs/superpowers/specs/2026-09-30-productization-audit.md`.

## Global Constraints

**Git and workspace:**
- **Never `git commit` or `git push`.** The owner commits by hand. Every task ends by leaving its files uncommitted and listing them.
- Work only inside the worktree from Task 0. Main's working tree is touched once, in Task Z.

**Tooling:**
- pnpm only. `pnpm install` / `pnpm add` need network access, so run them with the sandbox disabled.
- Backend tests use `node:test` with `require("module-alias/register")` for `@/…` aliases. Run with `cd backend && pnpm test`, or one file with `node --test <file>`.
- tg-service tests: `cd tg-service && pnpm test`.

**Code and copy:**
- Code comments are in Russian, matching the surrounding code; user-visible text is Russian. Copy these texts verbatim from the spec:
  - «Email меняет администратор»
  - «Email вашей учётной записи изменён на {new}. Если это сделали не вы — обратитесь к администратору.» (subject «Email учётной записи изменён»)
  - «Письмо пришло ответом на заявку №N, но …» (three variants: «отправитель в ней не участвует», «не прошло проверку отправителя», «такой заявки нет»)
  - «автоответ от {address} не принят: …»
  - «Сохранённое значение «{название}» не читается — введите его заново»

**Exact values:**

| What | Value |
|---|---|
| Default JSON/urlencoded body limit | `10mb` |
| KB-note, ticket-template and routine-task add/update | `50mb` |
| Anonymous endpoints | `100kb` |
| multer `fieldSize` | 10 MB |
| `/api/auth/*` `Content-Length` | 100 KB (102400 bytes) → 413 |
| Text helpers truncate input at | 256 KB |
| exceljs skips documents over | 10 MB |
| Shutdown drain | 50 s |
| compose `stop_grace_period` | `60s` |

**Rules:**
- The only accepted subject tag is `[F1-HD-<digits>]`, built from the one exported `TICKET_SUBJECT_PREFIX`.
- better-auth over HTTP allows exactly:
  - POST `/api/auth/two-factor/enable`
  - POST `/api/auth/two-factor/verify-totp`
  - POST `/api/auth/two-factor/disable`
  - POST `/api/auth/reset-password`
  - POST `/api/auth/sign-in/magic-link`
  - GET `/api/auth/magic-link/verify`
- A magic link goes only to active client accounts (`isEndUser === true`, not banned, company active, no 2FA, not a service account).

**Scope limits:**
- **UI:** the only visible change is the Profile e-mail field (mockup variant A, https://claude.ai/artifact/21qn8anCtoAViL6MQPo8bv). The user form also shows a 403 message in its existing inline alert; the owner approved this on 2026-10-01 (see Task A5).
- **Deploy:** `deploy.sh` is not changed.
- **Frontend checks:** `pnpm build` must pass. `pnpm typecheck` may show only the 3 errors already present on main (FormWrapper, ApprovalReport).

## Review Focus

These are inputs and conditions no single task's main tests are built around. Each has a pinning test in the owning task, listed in brackets.

1. **Mail servers that add no `Authentication-Results`** (many self-hosted MX). The verdict is `none`, and replies from participants must still become comments, never new tickets. [C2: `routeReply` with `authVerdict: "none"` for each participant kind]
2. **A client replying from an address HD doesn't know** (a private mailbox, an alias). The reply becomes a new ticket whose first line names #N, so staff can connect it. The owner's user-visible rule depends on that line being present and correct. [C2/C3: rerouted description starts with the «…№N…» line]
3. **Re-saving a user card without changing e-mail or ban.** It must still work for a `user.manage` holder who lacks `user.manageAccess` and the ban right. Otherwise every edit by a delegated manager breaks. [A4: `planAccountUpdate` with an unchanged e-mail (different case or spaces) and an unchanged `banned`]
4. **Server-side magic links for new client invitations** (`services/invitation.js` → `auth.api.signInMagicLink`). They go through the same send hook and must keep working, while a public request for a staff address sends nothing. [A2: `mayReceiveMagicLink` true for an active client without 2FA, false for staff and for 2FA users]
5. **Large legitimate payloads after the limits drop from 50 MB:**
   - a KB note with pasted screenshots as base64 JSON (~20 MB) must be accepted;
   - a ticket whose multipart text field is ~8 MB must be accepted;
   - the same 20 MB JSON to an ordinary route gets 413.

   [B5: route-specific limits; D2: `fieldSize` constant = 10 MB]

## Execution order

Task 0 → A1–A6 → B1–B6 → C1–C6 → D1–D7 → Task Z. Several tasks edit the same files:
- `backend/app.js`: A1 (better-auth mount), B5 (body parsers), B6 (after `cors`), D3 (crons, shutdown, process handlers).
- `backend/controllers/user.js`: A5 (`update`, `sessions`), A6 (`updateMyAccount`), D5 (`add`).

Always locate edits by the quoted anchor text, not by line number. Line numbers are from `b3b20cf` and shift as earlier tasks land.

**Sections were validated separately.** Each section's edits were replayed onto a clean copy of `b3b20cf` with the full suite green, but the four sections were not replayed together. The shared files are listed above; their anchors were chosen not to overlap. If an anchor is not found exactly once:
- re-locate it by the surrounding code;
- keep the other task's change;
- note the adjustment in the task's hand-off.

Never re-apply a whole-region replacement over another task's edits. Task D3's `app.js` splice checks a hash of its region first, so it refuses rather than overwrites.

---

### Task 0: Worktree, dependencies, test glob, baseline

**Files:**
- Modify: `backend/package.json` (`scripts.test`)

**Interfaces:**
- Produces: the worktree at `/home/aleksey/projects/worktrees/hd/w1-security` (detached HEAD at main's current HEAD, `b3b20cf` at planning time). `pnpm test` also runs `controllers/**/*.test.js`.

- [ ] **Step 1: Create the worktree (no branch)**

Use superpowers:using-git-worktrees. The owner keeps no feature branches, so detach:

```bash
cd /home/aleksey/projects/hd
git status --short            # expected: empty (or only other sessions' files; leave them alone)
git worktree add --detach /home/aleksey/projects/worktrees/hd/w1-security HEAD
git -C /home/aleksey/projects/worktrees/hd/w1-security log --oneline -1
# expected: the same commit as main's HEAD (b3b20cf "normalized phone numbers" at planning time)
```

If main has moved past `b3b20cf`, keep the newer HEAD. Every edit below is located by its anchor text; re-read each anchor before editing.

- [ ] **Step 2: Install dependencies inside the worktree (sandbox disabled)**

Task D2 changes backend dependencies. Symlinking main's `node_modules` would therefore write into main, so install for real:

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security/backend && pnpm install --frozen-lockfile
cd /home/aleksey/projects/worktrees/hd/w1-security/tg-service && pnpm install --frozen-lockfile
cd /home/aleksey/projects/worktrees/hd/w1-security/frontend && pnpm install --frozen-lockfile
```

Expected: each ends with `Done in …`, and the lockfiles are unchanged (`git status --short` shows nothing).

- [ ] **Step 3: Add controller tests to the backend test glob**

In `backend/package.json`, replace:

```json
    "test": "node --test \"auth/**/*.test.js\" \"services/**/*.test.js\" \"validations/**/*.test.js\" \"helpers/**/*.test.js\" \"middleware/**/*.test.js\" \"routes/**/*.test.js\"",
```

with:

```json
    "test": "node --test \"auth/**/*.test.js\" \"services/**/*.test.js\" \"validations/**/*.test.js\" \"helpers/**/*.test.js\" \"middleware/**/*.test.js\" \"routes/**/*.test.js\" \"controllers/**/*.test.js\"",
```

- [ ] **Step 4: Record the baseline**

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security/backend && pnpm test 2>&1 | tail -8
cd /home/aleksey/projects/worktrees/hd/w1-security/tg-service && pnpm test 2>&1 | tail -8
cd /home/aleksey/projects/worktrees/hd/w1-security/frontend && pnpm typecheck 2>&1 | tail -15 ; pnpm build 2>&1 | tail -5
```

Expected:
- **backend:** `# fail 0`. Write down the `# pass` count (≈703 at planning time). If 3 EACCES failures come from a `logs/` directory owned by another user, re-run with `NODE_ENV=production pnpm test`; that's environment, not code.
- **tg-service:** `# fail 0`.
- **frontend typecheck:** exactly the 3 known errors (FormWrapper, ApprovalReport).
- **frontend build:** completes.

Keep these numbers; Task Z compares against them.

- [ ] **Step 5: Leave uncommitted**

Changed: `backend/package.json`.

## Section A — Auth and accounts

Covers spec §1 "better-auth HTTP surface" (S4, S7a, S8) and §2 "Account management" (S6, S7b, the tri-state `isEndUser`, KB `categories` self-widening), decisions D2 and D4.

**Where commands run.** All commands are run from the W1 worktree root (`backend/…`, `frontend/…`). Backend tests use `node:test`; each new test file is also picked up by `cd backend && pnpm test` (the `controllers/**/*.test.js` glob comes from Task 0).

**Order.** A1, A2, A3, A4 and A6 are independent of each other. A5 needs A4 (it requires `services/accountUpdatePolicy.js`). Run A3 before A5 if possible: A5 calls `refreshMirrorForUsers`, which only becomes audience-aware in A3 (it exists at HEAD, so A5 works either way).

**Shared files other sections also touch:**
- `backend/app.js`: A1 adds one `require` after line 22 and changes the better-auth mount at lines 109–114. Body-limit work (§6) must keep `/api/auth/*splat` above `express.json()` and leave that `app.all(...)` line alone.
- `backend/controllers/user.js`: A5 changes the imports (lines 48–62), adds a helper after line 132, and edits `update` (975–1172) and `sessions` (1301–1311). A6 changes one import (after line 56) and `updateMyAccount` (1780–1829). §8 (logs) edits `add` (687–691). All of these regions are separate.
- `backend/scripts/migrate.js`: A3 appends one `MIGRATIONS` entry after `normalizePhones`. Any later W1 migration goes after it, because the list is append-only.

**Spec points settled against the code (details are in each task):**
- The route is `POST /api/users/update/:id`, not `PUT /users/:id`.
- The ban endpoint's right is `user.manage` (`canManageUsers` on `/users/toggle-active/:id`) plus `mayTouchAccount`.
- A ban set through the form now does what the ban endpoint does: sessions are revoked on ban, and reason and expiry are cleared on un-ban.
- `banned` must be a boolean when present, the same rule as `isEndUser`.
- An e-mail change is validated (not empty, `validator` `isEmail`) and checked for duplicates (409, the same as `add`).
- A flip of the account type without `roles` in the body recomputes the role mirror.
- The magic-link send rule also excludes service accounts.
- The migration only touches users that have a membership row.

---

### Task A1: Allow-list and body limit for the better-auth HTTP routes

**Files:**
- Create: `backend/middleware/authPathAllowList.js`
- Modify: `backend/app.js` (anchor: `require("./auth/bootstrap")`, line 22; the better-auth mount `app.all("/api/auth/*splat", authRequestHandler)`, lines 109–114)
- Test: `backend/middleware/authPathAllowList.test.js`

**Interfaces:**
- Consumes: `authRequestHandler` (`backend/auth/bootstrap.js`), unchanged. The app's 404 body shape comes from the fallback in `backend/app.js` (`{ error: true, status: 404, code: "ERR_404", message: "Endpoint not found" }`).
- Produces, all exported from `backend/middleware/authPathAllowList.js`:
  - `authPathAllowList(req, res, next)`, an Express middleware;
  - `AUTH_HTTP_ROUTES`, a `Set<string>` of `"METHOD /path"`;
  - `AUTH_BODY_LIMIT_BYTES` (`102400`).

  Behaviour:
  - a route outside the list gets 404;
  - an allowed route whose `Content-Length` header is over the limit gets 413 `{ error: true, status: 413, code: "ERR_413", message: "request entity too large" }`. That is the same shape as the 404, with body-parser's text.
  - A request without `Content-Length` (chunked) passes.
  - The list is checked before the size, so an oversized request to a closed path is still a 404.
  - This is needed because better-auth reads `/api/auth/*` bodies itself, so the `express.json()` limits never apply there.

- [ ] **Step 1: Write the failing test.** Create `backend/middleware/authPathAllowList.test.js`:

```js
// node --test middleware/authPathAllowList.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  authPathAllowList,
  AUTH_HTTP_ROUTES,
  AUTH_BODY_LIMIT_BYTES,
} = require("./authPathAllowList");

/**
 * Снаружи до better-auth доходят только шесть ручек, которыми пользуются фронт
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

test("the list is exactly the six routes the app uses", () => {
  assert.deepEqual([...AUTH_HTTP_ROUTES].sort(), [
    "GET /api/auth/magic-link/verify",
    "POST /api/auth/reset-password",
    "POST /api/auth/sign-in/magic-link",
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
    "/api/auth/sign-in/magic-link",
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
  assert.equal(reached.length, 6);
  assert.equal(
    reached.at(-1),
    "GET /api/auth/magic-link/verify?token=abc&callbackURL=%2F",
  );
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
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test middleware/authPathAllowList.test.js`
  - Expected: `not ok 1 - …/authPathAllowList.test.js` with `Error: Cannot find module './authPathAllowList'`, and `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/middleware/authPathAllowList.js`:

```js
/**
 * Какие ручки better-auth открыты по HTTP.
 *
 * better-auth монтирует под `/api/auth/*` всё, что умеют его плагины: вход
 * паролем мимо `/api/login` с его лимитером и правилами, `/admin/*` (смена
 * чужого пароля, заведение пользователя нативным драйвером мимо наших форм),
 * `/organization/*` (правка ролей мимо порогов services/roles.js),
 * `/email-otp/*`, регистрацию. Приложению из этого нужны шесть ручек: четыре
 * зовёт фронт, одну — ссылки из писем, и вход по ссылке для клиентов (D4 спеки
 * W1). Всё остальное вызывается только на сервере через `auth.api.*` (обёртки
 * входа, приглашения, подмена, коды из писем) — такие вызовы идут мимо
 * HTTP-роутера, и этот список их не касается.
 *
 * Список разрешённого, а не `disabledPaths` better-auth: тот сравнивает пути
 * точно, и каждая новая ручка очередного плагина открывалась бы сама.
 *
 * Отказ — в обычной форме ответа приложения, и отвечаем здесь же, а не через
 * `next(AppError)`: общий обработчик после ответа зовёт `next(error)`, и
 * finalhandler рвёт соединение (см. middleware/requireMcpKey.js). Путь берём из
 * `originalUrl` без строки запроса: он не зависит от того, куда смонтирован
 * маршрут. Тело не читаем — его читает better-auth, сырым.
 *
 * Стоит в app.js в том же маршруте, прямо перед обработчиком better-auth.
 */
const AUTH_HTTP_ROUTES = new Set([
  // components/User/TwoFactorSetup.jsx
  "POST /api/auth/two-factor/enable",
  "POST /api/auth/two-factor/verify-totp",
  // components/User/TwoFactorRow.jsx
  "POST /api/auth/two-factor/disable",
  // pages/Auth/NewPassword.tsx
  "POST /api/auth/reset-password",
  // Вход по ссылке из письма — только клиентам (auth/magicLinkPolicy.js)
  "POST /api/auth/sign-in/magic-link",
  "GET /api/auth/magic-link/verify",
]);

/**
 * Предел тела запроса к better-auth, байт.
 *
 * Тело `/api/auth/*` better-auth читает сам, сырым потоком, и лимиты
 * `express.json()` в app.js сюда не доходят: они стоят ниже по цепочке. Самое
 * большое законное тело этих ручек — новый пароль с токеном, сотни байт; 100 КБ
 * взяты с большим запасом. Сверяется заявленная длина (`Content-Length`), её
 * шлют и браузеры, и наш фронт. Запрос без неё (chunked) проходит: считать
 * поток здесь значило бы читать тело раньше better-auth.
 */
const AUTH_BODY_LIMIT_BYTES = 100 * 1024;

const reject = (res, status, message) =>
  res.status(status).json({
    error: true,
    status,
    code: `ERR_${status}`,
    message,
  });

const authPathAllowList = (req, res, next) => {
  const path = req.originalUrl.split("?")[0];
  if (!AUTH_HTTP_ROUTES.has(`${req.method} ${path}`)) {
    return reject(res, 404, "Endpoint not found");
  }
  // Нет заголовка — Number() даёт NaN, и сравнение запрос пропускает. Текст —
  // как у body-parser за express.json(): превышение выглядит одинаково.
  if (Number(req.headers["content-length"]) > AUTH_BODY_LIMIT_BYTES) {
    return reject(res, 413, "request entity too large");
  }
  return next();
};

module.exports = { authPathAllowList, AUTH_HTTP_ROUTES, AUTH_BODY_LIMIT_BYTES };
```

3b. In `backend/app.js`, replace (line 22):

```js
const { initAuth, authRequestHandler } = require("./auth/bootstrap");
```

with:

```js
const { initAuth, authRequestHandler } = require("./auth/bootstrap");
const { authPathAllowList } = require("./middleware/authPathAllowList");
```

3c. In `backend/app.js`, replace (lines 109–114):

```js
// better-auth ЧИТАЕТ СЫРОЕ ТЕЛО — регистрируется строго ДО express.json(),
// иначе тот его съест и запросы к /api/auth/* будут висеть до таймаута без
// внятной ошибки. Проверка после правок: POST на /api/auth/sign-in/email с
// заведомо неверным паролем должен отвечать 401 быстрее секунды.
// Express 5 требует именованный splat: "*" больше не валидный шаблон.
app.all("/api/auth/*splat", authRequestHandler);
```

with:

```js
// better-auth ЧИТАЕТ СЫРОЕ ТЕЛО — регистрируется строго ДО express.json(),
// иначе тот его съест и запросы к /api/auth/* будут висеть до таймаута без
// внятной ошибки. Проверка после правок: POST на /api/auth/reset-password с
// телом `{}` должен отвечать 400 быстрее секунды.
// Express 5 требует именованный splat: "*" больше не валидный шаблон.
//
// Снаружи открыты только ручки из списка (middleware/authPathAllowList.js):
// остальное — `/admin/*`, `/organization/*`, вход паролем мимо `/api/login` —
// отвечает 404. Серверные вызовы `auth.api.*` через роутер не идут.
app.all("/api/auth/*splat", authPathAllowList, authRequestHandler);
```

(The old check in the comment, `POST /sign-in/email → 401`, becomes a 404 with this change. That is why the comment now names a route that stays open.)

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test middleware/authPathAllowList.test.js`: 8 tests, `# pass 8`, `# fail 0`. That includes a 200 KB body to `POST /api/auth/reset-password` → 413, exactly 102400 bytes → passes, one byte more → 413, and a small body and a chunked body reaching the next handler.
  - `cd backend && node --check app.js`: no output, exit 0.
  - `cd backend && pnpm test`: `# fail 0`.
  - Optional owner check, with the dev stack running:
    - `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/auth/sign-in/email -H 'Content-Type: application/json' -d '{}'` prints `404`.
    - The same command against `/api/auth/reset-password` prints `400`.

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/middleware/authPathAllowList.js` (new), `backend/middleware/authPathAllowList.test.js` (new), `backend/app.js`.

---

### Task A2: Magic link only for clients without a second factor

**Files:**
- Create: `backend/auth/magicLinkPolicy.js`
- Modify: `backend/auth/hooks.js`:
  - the `require("./config")` line (line 4);
  - `sessionRefusal`: JSDoc `@returns` through the company check, lines 142–156;
  - `sendMagicLink`: the lookup, lines 200–203.
- Modify: `backend/auth/instance.mjs`:
  - `databaseHooks.session.create.before`, lines 272–276;
  - the `magicLink(...)` plugin comment, lines 377–379.
- Test: `backend/auth/magicLinkPolicy.test.js`

**Interfaces:**
- Consumes:
  - `isBanned(user)` from `backend/services/authBan.js`;
  - better-auth 1.6.26 calls `databaseHooks.session.create.before(session, ctx)` with the endpoint context. `ctx.path === "/magic-link/verify"` for magic-link sessions, and `ctx` is `null` outside an endpoint (see `node_modules/better-auth/dist/db/with-hooks.mjs:7-15` and `api/dispatch.mjs:191-200`).
- Produces:
  - `backend/auth/magicLinkPolicy.js`:
    - `MAGIC_LINK_VERIFY_PATH` (`"/magic-link/verify"`);
    - `mayReceiveMagicLink(user) → boolean`;
    - `refuseMagicLinkSession({ path, user }) → string | null`.
  - `hooks.sessionRefusal(userId, path = null) → Promise<string|null>`, which gains an optional second parameter.

- [ ] **Step 1: Write the failing test.** Create `backend/auth/magicLinkPolicy.test.js`:

```js
// node --test auth/magicLinkPolicy.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAGIC_LINK_VERIFY_PATH,
  mayReceiveMagicLink,
  refuseMagicLinkSession,
} = require("./magicLinkPolicy");

/**
 * Вход по ссылке из письма остаётся только клиентам без второго фактора
 * (D4 спеки W1): отправка молчит для всех остальных, а сеанс по ссылке
 * сотруднику и владельцу TOTP не выписывается.
 */

const client = (overrides = {}) => ({
  isEndUser: true,
  isServiceAccount: false,
  banned: false,
  twoFactorEnabled: false,
  company: { isActive: true },
  ...overrides,
});

const MINUTE = 60 * 1000;

test("an active client without a second factor gets the link", () => {
  assert.equal(mayReceiveMagicLink(client()), true);
  // Нет денормализованного статуса компании — активна (фильтры `$ne: false`)
  assert.equal(mayReceiveMagicLink(client({ company: undefined })), true);
  // Отключение со сроком после срока не действует (services/authBan)
  assert.equal(
    mayReceiveMagicLink(
      client({ banned: true, banExpires: new Date(Date.now() - MINUTE) }),
    ),
    true,
  );
});

test("nobody else gets one", () => {
  const refused = {
    "unknown address": null,
    staff: client({ isEndUser: false }),
    "no account type": client({ isEndUser: undefined }),
    "account type as a string": client({ isEndUser: "true" }),
    "service account": client({ isServiceAccount: true }),
    banned: client({ banned: true }),
    "banned until later": client({
      banned: true,
      banExpires: new Date(Date.now() + MINUTE),
    }),
    "company switched off": client({ company: { isActive: false } }),
    "second factor on": client({ twoFactorEnabled: true }),
  };
  for (const [label, user] of Object.entries(refused)) {
    assert.equal(mayReceiveMagicLink(user), false, label);
  }
});

test("a link session is refused to staff and to second-factor accounts", () => {
  assert.equal(MAGIC_LINK_VERIFY_PATH, "/magic-link/verify");

  for (const user of [
    { isEndUser: false, twoFactorEnabled: false },
    { isEndUser: true, twoFactorEnabled: true },
    { isEndUser: false, twoFactorEnabled: true },
  ]) {
    assert.match(
      refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user }),
      /Ссылка из письма/,
      JSON.stringify(user),
    );
  }
});

test("a client without a second factor signs in by the link", () => {
  assert.equal(
    refuseMagicLinkSession({
      path: MAGIC_LINK_VERIFY_PATH,
      user: { isEndUser: true, twoFactorEnabled: false },
    }),
    null,
  );
  // Тип не записан — не сотрудник (accountAudienceOf); ссылку такой учётной
  // записи и не отправят
  assert.equal(
    refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user: {} }),
    null,
  );
  // Учётной записи нет — отказывает sessionRefusal своим текстом
  assert.equal(
    refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user: null }),
    null,
  );
});

test("other ways in are not this rule's business", () => {
  const staff = { isEndUser: false, twoFactorEnabled: true };
  for (const path of [
    "/sign-in/email",
    "/sign-in/email-otp",
    "/admin/impersonate-user",
    null,
    undefined,
  ]) {
    assert.equal(refuseMagicLinkSession({ path, user: staff }), null, String(path));
  }
});
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test auth/magicLinkPolicy.test.js`
  - Expected: `not ok 1 - …/magicLinkPolicy.test.js` with `Error: Cannot find module './magicLinkPolicy'`, and `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/auth/magicLinkPolicy.js`:

```js
const { isBanned } = require("@/services/authBan");

/**
 * Вход по ссылке из письма — кому он положен (решение D4 спеки W1).
 *
 * Ссылка — вход без пароля и без второго фактора: доступ к почте равен доступу
 * к учётной записи. Клиенту это та же цена, что у восстановления пароля, ради
 * него ссылка и заведена (services/invitation.js). Сотруднику и тому, кто
 * включил второй фактор, ссылка означала бы вход мимо пароля и TOTP.
 *
 * Правило стоит в двух местах, и нужны оба:
 *   • отправка (`hooks.sendMagicLink`): ручка `/api/auth/sign-in/magic-link`
 *     публична, а плагин шлёт по любому известному адресу. Не положено —
 *     письма нет, а ответ ручки тот же: адреса она не различает;
 *   • вход (`hooks.sessionRefusal` из `databaseHooks.session.create.before`):
 *     ссылки, выписанные до этого правила, и любые, что появятся мимо отправки.
 */

/** Путь ручки входа по ссылке — `ctx.path` в хуке создания сеанса. */
const MAGIC_LINK_VERIFY_PATH = "/magic-link/verify";

const LINK_REFUSED =
  "Ссылка из письма для этой учётной записи не действует. Войдите на странице входа.";

/**
 * Можно ли выслать ссылку. Клиент — только ЯВНЫЙ (`isEndUser === true`):
 * учётная запись без записанного типа ссылку не получает. Служебной входить
 * нечем и незачем — как в приглашении.
 *
 * @param {object|null} user — lean-документ: isEndUser, isServiceAccount,
 *   banned, banExpires, twoFactorEnabled, company.isActive
 * @returns {boolean}
 */
const mayReceiveMagicLink = (user) =>
  Boolean(user) &&
  user.isEndUser === true &&
  !user.isServiceAccount &&
  !isBanned(user) &&
  user.company?.isActive !== false &&
  !user.twoFactorEnabled;

/**
 * Отказ в сеансе, который выписывает ручка входа по ссылке. Остальные способы
 * входа (пароль, код из письма, подмена, серверные вызовы вне ручки) — не его
 * дело: их правила в `sessionRefusal` и в плагинах.
 *
 * @param {{ path?: string|null, user?: object|null }} params — путь ручки
 *   (`ctx.path`) и lean-документ с isEndUser и twoFactorEnabled
 * @returns {string|null} текст отказа или null
 */
const refuseMagicLinkSession = ({ path, user }) => {
  if (path !== MAGIC_LINK_VERIFY_PATH || !user) return null;
  return user.isEndUser === false || user.twoFactorEnabled ? LINK_REFUSED : null;
};

module.exports = {
  MAGIC_LINK_VERIFY_PATH,
  mayReceiveMagicLink,
  refuseMagicLinkSession,
};
```

3b. In `backend/auth/hooks.js`, replace (line 4):

```js
const config = require("./config");
```

with:

```js
const config = require("./config");
const {
  mayReceiveMagicLink,
  refuseMagicLinkSession,
} = require("./magicLinkPolicy");
```

3c. In `backend/auth/hooks.js` (`sessionRefusal`), replace:

```js
 * @returns {Promise<string|null>} текст отказа или null, если пускать можно
 */
const sessionRefusal = async (userId) => {
  const User = require("@/models/user");
  const user = await User.findById(userId)
    .select("isServiceAccount isAdmin twoFactorEnabled company.isActive")
    .lean();

  if (!user) return "Учётная запись не найдена";
  if (user.isServiceAccount) {
    return "Служебная учётная запись входит не паролем";
  }
  if (user.company?.isActive === false) {
    return "Учётная запись отключена. Обратитесь к администратору.";
  }
```

with:

```js
 * @param {string} userId
 * @param {string|null} [path] — путь ручки better-auth, которая выписывает
 *   сеанс (`ctx.path` хука); null — вызов вне ручки
 * @returns {Promise<string|null>} текст отказа или null, если пускать можно
 */
const sessionRefusal = async (userId, path = null) => {
  const User = require("@/models/user");
  const user = await User.findById(userId)
    .select(
      "isServiceAccount isAdmin isEndUser twoFactorEnabled company.isActive",
    )
    .lean();

  if (!user) return "Учётная запись не найдена";
  if (user.isServiceAccount) {
    return "Служебная учётная запись входит не паролем";
  }
  if (user.company?.isActive === false) {
    return "Учётная запись отключена. Обратитесь к администратору.";
  }

  // Вход по ссылке из письма — только клиенту без второго фактора. Ссылки,
  // выписанные до этого правила или мимо отправки, сотруднику сеанса не дают.
  const linkRefusal = refuseMagicLinkSession({ path, user });
  if (linkRefusal) return linkRefusal;
```

3d. In `backend/auth/hooks.js` (`sendMagicLink`), replace:

```js
const sendMagicLink = async ({ email, url }) => {
  const User = require("@/models/user");
  const user = await User.findOne({ email }).select("firstName lastLogin").lean();
  const first = user ? await isFirstAccess(user._id) : false;
```

with:

```js
const sendMagicLink = async ({ email, url }) => {
  const User = require("@/models/user");
  const user = await User.findOne({ email })
    .select(
      "firstName lastLogin isEndUser isServiceAccount banned banExpires twoFactorEnabled company.isActive",
    )
    .lean();

  /**
   * КОМУ ССЫЛКА ПОЛОЖЕНА, решает не плагин: ручка
   * `/api/auth/sign-in/magic-link` публична, а он шлёт по любому известному
   * адресу. Только клиенту без второго фактора (auth/magicLinkPolicy.js);
   * остальным письма нет, а ответ ручки тот же — адреса она не различает.
   * Разница во времени ответа (письмо уходит сразу) — та же принятая цена,
   * что у `/api/login-code`.
   */
  if (!mayReceiveMagicLink(user)) {
    if (user) {
      logger.log(
        "warn",
        "Ссылка для входа не отправлена: учётной записи она не положена",
        { userId: String(user._id) },
      );
    }
    return;
  }

  const first = await isFirstAccess(user._id);
```

The rest of `sendMagicLink` (both `send(...)` branches) stays as it is. `greet(user || {})` is harmless now that `user` is always set.

3e. In `backend/auth/instance.mjs` (`databaseHooks.session.create`), replace:

```js
           * (`context/helpers.mjs` кладёт их в массив).
           */
          before: async (session) => {
            const refusal = await hooks.sessionRefusal(session.userId);
            if (refusal) {
```

with:

```js
           * (`context/helpers.mjs` кладёт их в массив).
           *
           * `ctx` — контекст ручки, которая выписывает сеанс: better-auth 1.6
           * передаёт его вторым аргументом (вне ручки — null), так же его
           * читает плагин `admin`. По `ctx.path` `sessionRefusal` узнаёт вход
           * по ссылке из письма (auth/magicLinkPolicy.js).
           */
          before: async (session, ctx) => {
            const refusal = await hooks.sessionRefusal(
              session.userId,
              ctx?.path ?? null,
            );
            if (refusal) {
```

3f. In `backend/auth/instance.mjs` (the comment above `magicLink({`), replace:

```js
      // ИТ-отдел. Ссылка для входа — ТОЛЬКО в приглашении клиенту
      // (`services/invitation.js`; плагин сам никого не проверяет и шлёт по
      // любому адресу). Смысл: клиентская учётка рождается из письма в
```

with:

```js
      // ИТ-отдел. Ссылка для входа — ТОЛЬКО клиенту без второго фактора: в
      // приглашении (`services/invitation.js`) и ручкой `/sign-in/magic-link`.
      // Плагин сам никого не проверяет и шлёт по любому адресу — правило держат
      // `hooks.sendMagicLink` и `hooks.sessionRefusal` (auth/magicLinkPolicy.js).
      // Смысл: клиентская учётка рождается из письма в
```

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test auth/magicLinkPolicy.test.js`: `# pass 5`, `# fail 0`.
  - `cd backend && node --check auth/hooks.js && node --check auth/magicLinkPolicy.js && node --check auth/instance.mjs`: no output, exit 0.
  - `cd backend && pnpm test`: `# fail 0`.
  - Optional owner check on the dev stack. Invite a new client with "Пригласить письмом": the letter still arrives, redirected to the owner's mailbox outside prod. Then open an old magic link issued to a staff account: the response is a 403 with «Ссылка из письма для этой учётной записи не действует…».

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/auth/magicLinkPolicy.js` (new), `backend/auth/magicLinkPolicy.test.js` (new), `backend/auth/hooks.js`, `backend/auth/instance.mjs`.

---

### Task A3: Plugin role from audience-stripped statements, plus the migration

**Files:**
- Modify: `backend/services/roles.js`:
  - the `@/auth/access` import, lines 4–12;
  - the `refreshMirrorForUsers` loop, lines 483–510;
  - the `assign` users update, lines 843–848;
  - `pluginRole`, lines 857–869;
  - `module.exports`, line 911.
- Create: `backend/scripts/recomputePluginRoles.js`
- Modify: `backend/scripts/migrate.js` (anchor: `MIGRATIONS`, lines 40–46)
- Test: `backend/services/roles.test.js` (extend the import at lines 13–20 and append two tests)

**Interfaces:**
- Consumes:
  - `stripStatementsForAudience(statements, audience)`, `accountAudienceOf(user)` and `isFullAccess(statements)` from `backend/auth/access.js`;
  - `organizationId()` and `listRoles()` from `backend/services/permissions.js`.
- Produces, from `backend/services/roles.js`:
  - `pluginRole(statements, audience) → "user" | "impersonator"`. The second parameter is new; with it missing the result is `"user"`.
  - `mirrorOf(keys: string[], catalogue: Map<string, object>, account) → { isAdmin: boolean, role: "user"|"impersonator" }`, newly exported.
  - The migration id `2026-09-30-recomputePluginRoles`.

- [ ] **Step 1: Write the failing test.**

1a. In `backend/services/roles.test.js`, replace the import:

```js
const {
  lastKeeperLoss,
  losesLastFullAccess,
  staffSideOf,
  assertRoleFitsAccount,
  lockedActionChanges,
  losesLastFullAccessHolder,
} = require("./roles");
```

with:

```js
const {
  lastKeeperLoss,
  losesLastFullAccess,
  staffSideOf,
  assertRoleFitsAccount,
  lockedActionChanges,
  losesLastFullAccessHolder,
  pluginRole,
  mirrorOf,
} = require("./roles");
```

1b. Append at the end of `backend/services/roles.test.js`. `staffAccessStatements` is already imported at the top of the file.

```js

test("the plugin role follows the account audience: a client is never an impersonator", () => {
  const impersonate = { user: ["read", "impersonate"] };

  assert.equal(pluginRole(impersonate, "staff"), "impersonator");
  // «Входить под пользователем» у клиента не действует — и роль плагина тоже
  assert.equal(pluginRole(impersonate, "client"), "user");
  assert.equal(pluginRole({ user: ["read"] }, "staff"), "user");
  // Адресат не передан — закрыто: остаются только действия `both`
  assert.equal(pluginRole(impersonate, undefined), "user");
  assert.equal(pluginRole(null, "staff"), "user");
});

test("the mirror gives admin and impersonator to staff only", () => {
  const catalogue = new Map([
    ["admin", staffAccessStatements()],
    ["support", { ticket: ["perform"], user: ["impersonate"] }],
    ["client", { ticket: ["readCompanies"] }],
  ]);
  const staff = { isEndUser: false };
  const client = { isEndUser: true };

  assert.deepEqual(mirrorOf(["admin"], catalogue, staff), {
    isAdmin: true,
    role: "impersonator",
  });
  // Роль полного доступа на клиентской учётной записи не даёт ни того ни другого
  assert.deepEqual(mirrorOf(["admin"], catalogue, client), {
    isAdmin: false,
    role: "user",
  });
  assert.deepEqual(mirrorOf(["support"], catalogue, staff), {
    isAdmin: false,
    role: "impersonator",
  });
  assert.deepEqual(mirrorOf(["support", "client"], catalogue, client), {
    isAdmin: false,
    role: "user",
  });
  // Тип не записан — это клиент, как и везде (accountAudienceOf)
  assert.deepEqual(mirrorOf(["support"], catalogue, {}), {
    isAdmin: false,
    role: "user",
  });
  // Роли нет в каталоге (удалена) или ролей нет вовсе — ничего не даёт
  assert.deepEqual(mirrorOf(["gone"], catalogue, staff), {
    isAdmin: false,
    role: "user",
  });
  assert.deepEqual(mirrorOf([], catalogue, staff), {
    isAdmin: false,
    role: "user",
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test services/roles.test.js`
  - Expected: `# pass 10`, `# fail 2`:
    - `not ok 11 - the plugin role follows the account audience…` with `expected: 'user'` and `actual: 'impersonator'`;
    - `not ok 12 - the mirror gives admin and impersonator to staff only` with `TypeError` (`mirrorOf is not a function`).

- [ ] **Step 3: Implement.**

3a. In `backend/services/roles.js`, replace the import tail:

```js
  isFullAccess,
  audienceOfAction,
  accountAudienceOf,
} = require("@/auth/access");
```

with:

```js
  isFullAccess,
  audienceOfAction,
  accountAudienceOf,
  stripStatementsForAudience,
} = require("@/auth/access");
```

3b. In `backend/services/roles.js` (`refreshMirrorForUsers`), replace the loop:

```js
  for (const row of rows) {
    const keys = String(row.role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const statements = {};
    for (const key of keys) {
      for (const [resource, actions] of Object.entries(catalogue.get(key) || {})) {
        statements[resource] = [
          ...new Set([...(statements[resource] || []), ...actions]),
        ];
      }
    }

    // Зеркало — только у СОТРУДНИКА: `isAdmin` читают около сотни мест как
    // «этому можно всё», а клиентская учётная запись правами сотрудника не
    // действует вовсе (действия чужого адресата вырезаются). Клиент с ролью
    // полного доступа получал через зеркало заявки всех компаний.
    const shouldBeAdmin =
      accountAudienceOf(accounts.get(String(row.userId))) === "staff" &&
      keys.some((key) => isFullAccess(catalogue.get(key) || {}));

    await mongoose.connection.db.collection("users").updateOne(
      { _id: new mongoose.Types.ObjectId(String(row.userId)) },
      { $set: { isAdmin: shouldBeAdmin, role: pluginRole(statements) } },
    );
  }
```

with:

```js
  for (const row of rows) {
    const keys = String(row.role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    // Формула зеркала — одна на пересчёт и миграцию: `mirrorOf`
    const { isAdmin, role } = mirrorOf(
      keys,
      catalogue,
      accounts.get(String(row.userId)),
    );

    await mongoose.connection.db.collection("users").updateOne(
      { _id: new mongoose.Types.ObjectId(String(row.userId)) },
      { $set: { isAdmin, role } },
    );
  }
```

3c. In `backend/services/roles.js` (`assign`), replace:

```js
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { $set: { isAdmin: shouldBeAdmin, role: pluginRole(statements) } },
    );
```

with:

```js
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      {
        $set: {
          isAdmin: shouldBeAdmin,
          role: pluginRole(statements, accountAudienceOf(account)),
        },
      },
    );
```

3d. In `backend/services/roles.js`, replace the end of the `pluginRole` JSDoc and the function:

```js
 * Отсюда `impersonator` вместо `admin`: штатная роль плагина открыла бы заодно
 * смену чужих паролей и заведение пользователей мимо наших правил.
 */
const pluginRole = (statements) =>
  statements?.user?.includes("impersonate") ? "impersonator" : "user";
```

with:

```js
 * Отсюда `impersonator` вместо `admin`: штатная роль плагина открыла бы заодно
 * смену чужих паролей и заведение пользователей мимо наших правил.
 *
 * Считается по набору, УСЕЧЁННОМУ по адресату учётной записи, — тем же
 * `stripStatementsForAudience`, что и её права (services/permissions.js). Без
 * усечения клиентская учётная запись с ролью, где оказалось «Входить под
 * пользователем», получала `impersonator`: наше право у неё не действует, а
 * роль плагина действовала бы. Адресат не передан — остаются только действия
 * `both`, и роль выходит «user».
 *
 * @param {object} statements — объединённый набор ролей человека
 * @param {"staff"|"client"} audience — `accountAudienceOf(user)`
 * @returns {"user"|"impersonator"}
 */
const pluginRole = (statements, audience) =>
  stripStatementsForAudience(statements, audience).user?.includes("impersonate")
    ? "impersonator"
    : "user";

/**
 * Зеркало ролей в документе пользователя: `isAdmin` и роль плагина.
 *
 * Одна формула для `refreshMirrorForUsers` и миграции
 * `scripts/recomputePluginRoles.js`, которая сверяет по ней до записи
 * (`assign` считает то же по объектам каталога).
 *
 * `isAdmin` — только у СОТРУДНИКА: его читают около сотни мест как «этому
 * можно всё», а клиентская учётная запись правами сотрудника не действует
 * вовсе (действия чужого адресата вырезаются). Клиент с ролью полного доступа
 * получал через зеркало заявки всех компаний.
 *
 * @param {string[]} keys — роли человека (`member.role`)
 * @param {Map<string, object>} catalogue — ключ роли → её statements
 * @param {object|undefined} account — документ пользователя, нужен `isEndUser`
 * @returns {{ isAdmin: boolean, role: "user"|"impersonator" }}
 */
const mirrorOf = (keys, catalogue, account) => {
  const statements = {};
  for (const key of keys) {
    for (const [resource, actions] of Object.entries(catalogue.get(key) || {})) {
      statements[resource] = [
        ...new Set([...(statements[resource] || []), ...actions]),
      ];
    }
  }
  const audience = accountAudienceOf(account);
  return {
    isAdmin:
      audience === "staff" &&
      keys.some((key) => isFullAccess(catalogue.get(key) || {})),
    role: pluginRole(statements, audience),
  };
};
```

3e. In `backend/services/roles.js` (`module.exports`), replace:

```js
  gaps,
  pluginRole,
  rolesOfMember,
```

with:

```js
  gaps,
  pluginRole,
  mirrorOf,
  rolesOfMember,
```

3f. Create `backend/scripts/recomputePluginRoles.js`. It follows the structure of `grantConversations.js`: a dry run by default and `--apply` to write.

```js
// Разовый пересчёт зеркала ролей в `users` — роли плагина (`role`) и
// `isAdmin`, 2026-09-30 (спека
// docs/superpowers/specs/2026-09-30-security-hotfixes-w1-design.md, §1).
//
// Роль плагина теперь считается по набору прав, усечённому по адресату учётной
// записи (services/roles.js#pluginRole): клиентская учётная запись не бывает
// `impersonator`, какие бы роли у неё ни были. Сохранённые значения посчитаны
// по-старому. Скрипт пересчитывает зеркало всем, у кого есть членство в
// организации, той же функцией, что и правка ролей из интерфейса
// (`refreshMirrorForUsers`); показ сверяет по ней же (`mirrorOf`).
//
// В выводе — только _id, адресат и было → станет: ни адресов, ни имён.
// Учётные записи без членства не трогаются: ролей у них нет, и приложение их
// зеркало не ведёт; строка с их числом — для сведения.
//
// Идемпотентен: после записи расхождений нет, второй прогон ничего не меняет.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/recomputePluginRoles.js            # показать
//   node scripts/recomputePluginRoles.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { accountAudienceOf } = require("@/auth/access");
const { organizationId, listRoles } = require("@/services/permissions");
const { mirrorOf, refreshMirrorForUsers } = require("@/services/roles");

const roleKeys = (value) =>
  String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — пересчитывать нечего");

  const catalogue = new Map(
    (await listRoles()).map((role) => [role.key, role.statements]),
  );
  const rows = await db
    .collection("member")
    .find({ organizationId: orgId }, { projection: { userId: 1, role: 1 } })
    .toArray();

  const ids = rows
    .map((row) => String(row.userId || ""))
    .filter((id) => mongoose.isValidObjectId(id));
  const accounts = new Map(
    (
      await db
        .collection("users")
        .find(
          { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
          { projection: { isEndUser: 1, isAdmin: 1, role: 1 } },
        )
        .toArray()
    ).map((user) => [String(user._id), user]),
  );

  const changed = [];
  let orphans = 0;
  for (const row of rows) {
    const account = accounts.get(String(row.userId || ""));
    // Членство без учётной записи (или с битым userId) зеркала не имеет
    if (!account) {
      orphans += 1;
      continue;
    }
    const next = mirrorOf(roleKeys(row.role), catalogue, account);
    const isAdmin = Boolean(account.isAdmin);
    if (account.role === next.role && isAdmin === next.isAdmin) continue;

    changed.push(String(account._id));
    console.log(
      `  ${account._id} (${accountAudienceOf(account)}): role ${account.role ?? "—"} → ${next.role}, isAdmin ${isAdmin} → ${next.isAdmin}`,
    );
  }

  const withoutMembership = await db.collection("users").countDocuments({
    _id: { $nin: ids.map((id) => new mongoose.Types.ObjectId(id)) },
  });
  console.log(
    `\nЧленств: ${rows.length}, из них без учётной записи: ${orphans}. ` +
      `Учётных записей без членства (не трогаются): ${withoutMembership}. ` +
      `Расхождений: ${changed.length}.`,
  );

  if (!apply) {
    console.log(
      changed.length
        ? "Показ без записи. Повторите с --apply."
        : "Менять нечего.",
    );
    await mongoose.disconnect();
    return;
  }

  if (changed.length) {
    await refreshMirrorForUsers(orgId, changed);
  }
  console.log(`Пересчитано учётных записей: ${changed.length}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

3g. In `backend/scripts/migrate.js` (`MIGRATIONS`), replace:

```js
  // Телефоны — только цифрами с кодом страны; см. normalizePhones.js
  { id: "2026-09-30-normalizePhones", script: "normalizePhones.js", apply: true },
];
```

with:

```js
  // Телефоны — только цифрами с кодом страны; см. normalizePhones.js
  { id: "2026-09-30-normalizePhones", script: "normalizePhones.js", apply: true },
  // Роль плагина по адресату учётной записи (W1 §1); см. recomputePluginRoles.js
  { id: "2026-09-30-recomputePluginRoles", script: "recomputePluginRoles.js", apply: true },
];
```

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test services/roles.test.js`: `# pass 12`, `# fail 0`.
  - `cd backend && node --check services/roles.js && node --check scripts/recomputePluginRoles.js && node --check scripts/migrate.js`: no output, exit 0.
  - `cd backend && pnpm test`: `# fail 0`.
  - Optional owner check, needing docker and the dev stack (the local DB is a prod copy): `docker compose run --rm backend node scripts/recomputePluginRoles.js`. This is a dry run and writes nothing. It lists every account whose mirror would change; expected lines are client accounts with `role impersonator → user`. Do not run `--apply` by hand: `./deploy.sh` applies the migration through `migrate up`.

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/services/roles.js`, `backend/services/roles.test.js`, `backend/scripts/recomputePluginRoles.js` (new), `backend/scripts/migrate.js`.

---

### Task A4: Account-update policy as a pure module

**Files:**
- Create: `backend/services/accountUpdatePolicy.js`
- Test: `backend/services/accountUpdatePolicy.test.js`

**Interfaces:**
- Consumes:
  - `accountAudienceOf(user)` from `backend/auth/access.js`;
  - `escapeHtml(value)` from `backend/services/telegramMessage.js`, the pure helper `middleware/notifications.js` already uses for e-mail;
  - `validator/lib/isEmail`, a backend dependency.
- Produces, from `backend/services/accountUpdatePolicy.js`:
  - `planAccountUpdate({ target, body, mayManageAccess: boolean, mayBan: boolean })`, which returns:
    - `refusal: { status: 400|403, message: string } | null`;
    - `emailChange: { from: string, to: string } | null`, both lower-cased and trimmed;
    - `banned: boolean | undefined`, where `undefined` means leave the flag alone;
    - `isEndUser: boolean | undefined`, where `undefined` means leave the field alone;
    - `audienceChanged: boolean`.
  - `emailChangedNotice({ from, to })`, which returns the `Notification` fields `{ instrument: "email", to: { email: from }, title, text }`.
  - `ACCOUNT_UPDATE_MESSAGES`, the refusal texts.

- [ ] **Step 1: Write the failing test.** Create `backend/services/accountUpdatePolicy.test.js`:

```js
// node --test services/accountUpdatePolicy.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  planAccountUpdate,
  emailChangedNotice,
  ACCOUNT_UPDATE_MESSAGES,
} = require("./accountUpdatePolicy");

/**
 * Правка карточки человека: email, отключение и тип учётной записи — это
 * доступ. Проверяется решение без базы; запись, погашение сеансов и письмо
 * делает контроллер (controllers/user.js#update).
 */

const TARGET = { email: "ivanov@f1lab.ru", banned: false, isEndUser: true };

const plan = (
  body,
  { target = TARGET, mayManageAccess = true, mayBan = true } = {},
) => planAccountUpdate({ target, body, mayManageAccess, mayBan });

test("fields that are not sent are left alone", () => {
  assert.deepEqual(plan({}), {
    refusal: null,
    emailChange: null,
    banned: undefined,
    isEndUser: undefined,
    audienceChanged: false,
  });
  // Пропущенный флаг больше не включает отключённую учётку
  assert.equal(plan({}, { target: { ...TARGET, banned: true } }).banned, undefined);
});

test("the same address in another case or with spaces is not a change", () => {
  const result = plan({ email: "  Ivanov@F1LAB.ru " }, { mayManageAccess: false });

  assert.equal(result.refusal, null);
  assert.equal(result.emailChange, null);
});

test("changing the e-mail needs user.manageAccess", () => {
  const refused = plan({ email: "petrov@f1lab.ru" }, { mayManageAccess: false });
  assert.deepEqual(refused.refusal, {
    status: 403,
    message: ACCOUNT_UPDATE_MESSAGES.emailRight,
  });
  assert.equal(refused.emailChange, null);

  const allowed = plan({ email: " Petrov@F1lab.ru" });
  assert.equal(allowed.refusal, null);
  assert.deepEqual(allowed.emailChange, {
    from: "ivanov@f1lab.ru",
    to: "petrov@f1lab.ru",
  });
});

test("a malformed e-mail is a 400 whatever the rights", () => {
  for (const email of [
    "",
    "   ",
    "petrov@f1lab",
    "not an address",
    null,
    42,
    { $ne: "" },
    ["petrov@f1lab.ru"],
  ]) {
    const result = plan({ email });
    assert.equal(result.refusal?.status, 400, JSON.stringify(email));
    assert.equal(result.emailChange, null);
  }
  assert.equal(plan({ email: "" }).refusal.message, ACCOUNT_UPDATE_MESSAGES.emailEmpty);
});

test("the ban flag changes only on a different value", () => {
  assert.equal(plan({ banned: false }).banned, undefined);
  assert.equal(
    plan({ banned: true }, { target: { ...TARGET, banned: true } }).banned,
    undefined,
  );
  assert.equal(plan({ banned: true }).banned, true);
  assert.equal(
    plan({ banned: false }, { target: { ...TARGET, banned: true } }).banned,
    false,
  );
  // Поля нет в документе — «работает»: присланное false изменением не считается
  assert.equal(
    plan({ banned: false }, { target: { email: TARGET.email } }).banned,
    undefined,
  );
});

test("a ban change needs the ban right; an unchanged flag does not", () => {
  assert.deepEqual(plan({ banned: true }, { mayBan: false }).refusal, {
    status: 403,
    message: ACCOUNT_UPDATE_MESSAGES.banRight,
  });
  assert.equal(plan({ banned: false }, { mayBan: false }).refusal, null);
});

test("the ban flag and the account type must be booleans", () => {
  for (const value of ["true", "false", 1, 0, null, {}]) {
    assert.equal(
      plan({ banned: value }).refusal?.status,
      400,
      `banned=${JSON.stringify(value)}`,
    );
    assert.equal(
      plan({ isEndUser: value }).refusal?.status,
      400,
      `isEndUser=${JSON.stringify(value)}`,
    );
  }
});

test("isEndUser is applied as sent and reports an audience flip", () => {
  const flipped = plan({ isEndUser: false });
  assert.equal(flipped.isEndUser, false);
  assert.equal(flipped.audienceChanged, true);

  const same = plan({ isEndUser: true });
  assert.equal(same.isEndUser, true);
  assert.equal(same.audienceChanged, false);

  // Тип не записан — это клиент (accountAudienceOf)
  const untyped = { email: TARGET.email };
  assert.equal(plan({ isEndUser: true }, { target: untyped }).audienceChanged, false);
  assert.equal(plan({ isEndUser: false }, { target: untyped }).audienceChanged, true);
});

test("form errors come before permission errors", () => {
  const result = plan(
    { isEndUser: "yes", email: "petrov@f1lab.ru", banned: true },
    { mayManageAccess: false, mayBan: false },
  );
  assert.deepEqual(result.refusal, {
    status: 400,
    message: ACCOUNT_UPDATE_MESSAGES.isEndUser,
  });
});

test("the notice goes to the old address, the new one escaped", () => {
  assert.deepEqual(
    emailChangedNotice({ from: "ivanov@f1lab.ru", to: "petrov@f1lab.ru" }),
    {
      instrument: "email",
      to: { email: "ivanov@f1lab.ru" },
      title: "Email учётной записи изменён",
      text: "<p>Email вашей учётной записи изменён на petrov@f1lab.ru. Если это сделали не вы — обратитесь к администратору.</p>",
    },
  );
  // Кавычки в локальной части адреса допустимы — и `<` в них тоже
  assert.match(
    emailChangedNotice({ from: "a@f1lab.ru", to: '"<b>"@f1lab.ru' }).text,
    /"&lt;b&gt;"@f1lab\.ru/,
  );
});
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test services/accountUpdatePolicy.test.js`
  - Expected: `not ok 1 - …/accountUpdatePolicy.test.js` with `Error: Cannot find module './accountUpdatePolicy'`, and `# fail 1`.

- [ ] **Step 3: Implement.** Create `backend/services/accountUpdatePolicy.js`:

```js
const isEmail = require("validator/lib/isEmail");

const { accountAudienceOf } = require("@/auth/access");
const { escapeHtml } = require("@/services/telegramMessage");

/**
 * Правка карточки человека (`POST /api/users/update/:id`) — что она делает с
 * ДОСТУПОМ его учётной записи. Решение отдельно от контроллера: контроллер
 * читает базу и пишет документ, а правила проверяются без базы.
 *
 * Три поля карточки на деле не анкета, а доступ:
 *   • email — по нему входят (пароль, код, ссылка). Сменить его — перевести
 *     вход на другой ящик, поэтому смена требует `user.manageAccess`, гасит
 *     сеансы и уведомляет прежний адрес (последнее делает контроллер);
 *   • banned — отключение. Меняется только ПРИСЛАННЫМ ДРУГИМ значением и
 *     правом ручки отключения: пропущенное поле раньше молча включало учётку
 *     (`Boolean(undefined)`);
 *   • isEndUser — тип учётной записи. Только булево: пропуск раньше стирал
 *     поле, и учётка оказывалась ни сотрудником, ни клиентом.
 *
 * Проверки формы идут раньше проверок права: кривое тело — 400 при любых
 * правах.
 */

const MESSAGES = {
  isEndUser: "Тип учётной записи передан неверно",
  banned: "Признак отключения передан неверно",
  emailInvalid: "Неверный email",
  emailEmpty: "Укажите email",
  emailRight: "Недостаточно прав, чтобы менять email: по нему входят в портал",
  banRight: "Недостаточно прав, чтобы отключать и включать учётную запись",
};

const refuse = (status, message) => ({
  refusal: { status, message },
  emailChange: null,
  banned: undefined,
  isEndUser: undefined,
  audienceChanged: false,
});

/**
 * @param {object} params
 * @param {object} params.target — документ пользователя до правки
 * @param {object} params.body — тело запроса
 * @param {boolean} params.mayManageAccess — `req.auth.can({ user: ["manageAccess"] })`
 * @param {boolean} params.mayBan — право ручки отключения (`user.manage`)
 * @returns {{
 *   refusal: {status: number, message: string} | null,
 *   emailChange: {from: string, to: string} | null,
 *   banned: boolean | undefined,
 *   isEndUser: boolean | undefined,
 *   audienceChanged: boolean,
 * }} `undefined` у поля — не трогать
 */
const planAccountUpdate = ({ target, body, mayManageAccess, mayBan }) => {
  const { email, banned, isEndUser } = body || {};

  if (isEndUser !== undefined && typeof isEndUser !== "boolean") {
    return refuse(400, MESSAGES.isEndUser);
  }
  if (banned !== undefined && typeof banned !== "boolean") {
    return refuse(400, MESSAGES.banned);
  }

  let emailChange = null;
  if (email !== undefined) {
    if (typeof email !== "string") return refuse(400, MESSAGES.emailInvalid);
    const next = email.trim().toLowerCase();
    const current = String(target.email || "").trim().toLowerCase();
    if (next !== current) {
      if (!next) return refuse(400, MESSAGES.emailEmpty);
      if (!isEmail(next)) return refuse(400, MESSAGES.emailInvalid);
      emailChange = { from: current, to: next };
    }
  }

  // Поля `banned` в документе может не быть — это «работает»
  const bannedChanges =
    banned !== undefined && banned !== Boolean(target.banned);

  if (emailChange && !mayManageAccess) return refuse(403, MESSAGES.emailRight);
  if (bannedChanges && !mayBan) return refuse(403, MESSAGES.banRight);

  return {
    refusal: null,
    emailChange,
    banned: bannedChanges ? banned : undefined,
    isEndUser,
    // Адресат, а не сырое поле: учётка без записанного типа — клиент
    // (accountAudienceOf), и «клиент» для неё сменой не считается
    audienceChanged:
      isEndUser !== undefined &&
      accountAudienceOf(target) !== accountAudienceOf({ isEndUser }),
  };
};

/**
 * Письмо на ПРЕЖНИЙ адрес о смене email — документ `Notification` (очередь
 * services/mail/outbox, вне прода получатель подменяется моделью). На
 * прежний: новый мог вписать тот, кто учётную запись и уводит, а владелец
 * узнаёт об этом из своего ящика.
 */
const emailChangedNotice = ({ from, to }) => ({
  instrument: "email",
  to: { email: from },
  title: "Email учётной записи изменён",
  text: `<p>Email вашей учётной записи изменён на ${escapeHtml(to)}. Если это сделали не вы — обратитесь к администратору.</p>`,
});

module.exports = {
  planAccountUpdate,
  emailChangedNotice,
  ACCOUNT_UPDATE_MESSAGES: MESSAGES,
};
```

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test services/accountUpdatePolicy.test.js`: `# pass 10`, `# fail 0`.
  - `cd backend && pnpm test`: `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/services/accountUpdatePolicy.js` (new), `backend/services/accountUpdatePolicy.test.js` (new).

---

### Task A5: Wire the policy into `update`, guard `sessions`

**Files:**
- Modify: `backend/controllers/user.js`:
  - imports, lines 48–62;
  - a new helper after `ADMIN_ACCOUNT_ONLY`, lines 131–132;
  - `exports.update`, lines 975–1172;
  - `exports.sessions`, lines 1301–1311.
- Modify: `frontend/src/pages/User/Update.jsx` (anchor: `action`, lines 59–61)
- Test: `backend/controllers/user.access.test.js` (new, with stubbed req/res and model statics, no database)

**Interfaces:**
- Consumes:
  - `planAccountUpdate`, `emailChangedNotice` (Task A4);
  - `mayTouchAccount(req, target)` and `ADMIN_ACCOUNT_ONLY`, both existing in `controllers/user.js`;
  - `revokeAllForUser(userId)` from `services/authSessions.js`, already imported;
  - `refreshMirrorForUsers(orgId, userIds)` from `services/roles.js` (audience-aware after A3);
  - `organizationId()` from `services/permissions.js`;
  - the `Notification` model.
- Produces behaviour only:
  - `POST /api/users/update/:id` answers 404, 403 (`mayTouchAccount`, e-mail right, ban right), 400 (bad `isEndUser`, `banned` or `email`) or 409 (duplicate e-mail), all before any write. On an e-mail change it revokes all the target's sessions and queues the notice to the old address. On a ban it revokes sessions. On an un-ban it clears `banReason` and `banExpires`. An omitted `banned` or `isEndUser` is left alone. A flip of the account type without `roles` in the body recomputes the role mirror.
  - `GET /api/users/:id/sessions` answers 403 for an administrator's account unless the caller is an administrator.

- [ ] **Step 1: Write the failing test.** Create `backend/controllers/user.access.test.js`:

```js
// node --test controllers/user.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const User = require("@/models/user");
const Company = require("@/models/company");
const controller = require("./user");

/**
 * Карточка человека и список его сеансов — это доступ, и отказы обязаны
 * срабатывать ДО любых записей. Модели подменены заглушками, базы нет: всё,
 * что дальше отказа, сюда дойти не должно — чтение компаний сразу валит тест.
 */

const originals = {
  findById: User.findById,
  exists: User.exists,
  companyFindById: Company.findById,
};

afterEach(() => {
  User.findById = originals.findById;
  User.exists = originals.exists;
  Company.findById = originals.companyFindById;
});

const ADMIN = {
  _id: "66aa00000000000000000001",
  email: "admin@f1lab.ru",
  isAdmin: true,
  isEndUser: false,
  banned: false,
};
const PERSON = {
  _id: "66aa00000000000000000002",
  email: "ivanov@f1lab.ru",
  isAdmin: false,
  isEndUser: true,
  banned: false,
};

/** Вызывающий: `can` по списку действий «ресурс.действие». */
const actor = ({ isAdmin = false, actions = [] } = {}) => ({
  isAdmin,
  user: { _id: "66aa00000000000000000009" },
  can: (request) =>
    Object.entries(request).every(([resource, list]) =>
      list.every((action) => actions.includes(`${resource}.${action}`)),
    ),
});

const call = async (handler, { params, body = {}, auth }) => {
  let failure = null;
  let sent = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent = { status: this.statusCode, payload };
      return this;
    },
  };
  await handler({ params, body, auth }, res, (error) => {
    failure = error;
  });
  return { failure, sent };
};

const forbidCompanyReads = () => {
  Company.findById = () => {
    throw new Error("отказ опоздал: дошло до чтения компаний");
  };
};

test("update: a missing account is a 404", async () => {
  User.findById = async () => null;
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 404);
});

test("update: an administrator's card is edited only by an administrator", async () => {
  User.findById = async () => ({ ...ADMIN });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: ADMIN._id },
    body: { phone: "79145550142" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 403);
  assert.equal(
    failure.message,
    "Доступом администратора управляет только администратор",
  );
});

test("update: an e-mail change without user.manageAccess stops before any write", async () => {
  User.findById = async () => ({ ...PERSON });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { email: "petrov@f1lab.ru" },
    auth: actor({ actions: ["user.manage"] }),
  });

  assert.equal(failure?.statusCode, 403);
  assert.match(failure.message, /email/);
});

test("update: a non-boolean account type is a 400 before any write", async () => {
  User.findById = async () => ({ ...PERSON });
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { isEndUser: "false" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 400);
});

test("update: an address taken by another account is a 409", async () => {
  User.findById = async () => ({ ...PERSON });
  let asked = null;
  User.exists = async (filter) => {
    asked = filter;
    return { _id: "66aa00000000000000000003" };
  };
  forbidCompanyReads();

  const { failure } = await call(controller.update, {
    params: { id: PERSON._id },
    body: { email: "Petrov@F1lab.ru" },
    auth: actor({ actions: ["user.manage", "user.manageAccess"] }),
  });

  assert.equal(failure?.statusCode, 409);
  assert.deepEqual(asked, {
    email: "petrov@f1lab.ru",
    _id: { $ne: PERSON._id },
  });
});

test("sessions: an administrator's devices are listed only to an administrator", async () => {
  User.findById = () => ({ select: async () => ({ ...ADMIN }) });

  const { failure, sent } = await call(controller.sessions, {
    params: { id: ADMIN._id },
    auth: actor({ actions: ["user.manageAccess"] }),
  });

  assert.equal(sent, null);
  assert.equal(failure?.statusCode, 403);
});
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test controllers/user.access.test.js`
  - Expected: `# pass 0`, `# fail 6`. Every test reports `actual: 500` against its expected 404/403/400/409/403. At HEAD, `update` dereferences `user.company._id` and hits the database before any check, and `sessions` goes straight to `listForUser`. Requiring the controller loads the logger, so dev log files may appear under `backend/logs/`, which is gitignored.

- [ ] **Step 3: Implement.**

3a. In `backend/controllers/user.js`, replace:

```js
const CompanyLog = require("../models/companyLog");
const {
  permissionFilter,
  effectivePermissions,
  rolesOfUser,
  usersWithRoles,
} = require("@/services/permissions");
```

with:

```js
const CompanyLog = require("../models/companyLog");
const Notification = require("../models/notification");
const {
  permissionFilter,
  effectivePermissions,
  rolesOfUser,
  usersWithRoles,
  organizationId,
} = require("@/services/permissions");
```

3b. In `backend/controllers/user.js`, replace:

```js
const {
  ensureMember,
  removeMembership,
  assign: assignRoles,
  namedRoles,
} = require("@/services/roles");
```

with:

```js
const {
  ensureMember,
  removeMembership,
  assign: assignRoles,
  namedRoles,
  refreshMirrorForUsers,
} = require("@/services/roles");
const {
  planAccountUpdate,
  emailChangedNotice,
} = require("@/services/accountUpdatePolicy");
```

3c. In `backend/controllers/user.js`, replace:

```js
const ADMIN_ACCOUNT_ONLY =
  "Доступом администратора управляет только администратор";
```

with:

```js
const ADMIN_ACCOUNT_ONLY =
  "Доступом администратора управляет только администратор";

/**
 * Смена email — событие доступа: запись в журнал и письмо на прежний адрес
 * (services/accountUpdatePolicy.js#emailChangedNotice).
 *
 * Сбой очереди ответ не ломает: учётная запись уже сохранена и сеансы
 * погашены, и «не удалось» на экране было бы неправдой. Потеря письма видна в
 * журнале.
 */
const noticeEmailChanged = async (req, user, change) => {
  logger.warn("Email учётной записи изменён", {
    module: "user",
    targetId: String(user._id),
    byId: String(req.auth.user._id),
  });
  try {
    await Notification.create(emailChangedNotice(change));
  } catch (error) {
    logger.log("error", "Письмо о смене email не поставлено в очередь", {
      module: "user",
      targetId: String(user._id),
      error: error.message,
    });
  }
};
```

3d. In `backend/controllers/user.js` (`exports.update`), replace:

```js
exports.update = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    const prevCompany = await Company.findById(user.company._id);
```

with:

```js
exports.update = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    // Карточка администратора — тоже его доступ: здесь правятся email,
    // отключение и тип учётной записи. Правило то же, что у отключения,
    // смены пароля и сеансов.
    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    // Email, отключение и тип учётной записи — доступ, и решение о них
    // принимается до любых записей (services/accountUpdatePolicy.js)
    const accountPlan = planAccountUpdate({
      target: user,
      body: req.body,
      mayManageAccess: req.auth.can({ user: ["manageAccess"] }),
      // Право ручки отключения (`POST /users/toggle-active/:id` —
      // canManageUsers); mayTouchAccount проверен выше, как и там
      mayBan: req.auth.can({ user: ["manage"] }),
    });
    if (accountPlan.refusal) {
      return next(
        new AppError(accountPlan.refusal.message, accountPlan.refusal.status),
      );
    }
    if (
      accountPlan.emailChange &&
      (await User.exists({
        email: accountPlan.emailChange.to,
        _id: { $ne: user._id },
      }))
    ) {
      return next(
        new AppError(
          `Пользователь с адресом ${accountPlan.emailChange.to} уже существует`,
          409,
        ),
      );
    }

    const prevCompany = await Company.findById(user.company._id);
```

3e. In `backend/controllers/user.js` (`exports.update`, body destructuring), replace:

```js
    const {
      email,
      phone,
      firstName,
      lastName,
      position,
      banned,
      isEndUser,
      isServiceAccount,
```

with:

```js
    // email, banned и isEndUser разобраны выше, в accountPlan
    const {
      phone,
      firstName,
      lastName,
      position,
      isServiceAccount,
```

3f. In `backend/controllers/user.js` (`exports.update`, assignments), replace:

```js
    user.email = email?.toLowerCase();
    user.phone = phone;
    user.firstName = firstName || "";
    user.lastName = lastName || "";
    user.position = position;
    user.categories = categoriesList.filter(Boolean);
    user.company = newCompany;
    // `role` не трогаем: это роль плагина better-auth, её ведёт assignRoles
    user.banned = Boolean(banned);
```

with:

```js
    // Email — только сменой, которую пропустил accountPlan
    if (accountPlan.emailChange) {
      user.email = accountPlan.emailChange.to;
    }
    user.phone = phone;
    user.firstName = firstName || "";
    user.lastName = lastName || "";
    user.position = position;
    user.categories = categoriesList.filter(Boolean);
    user.company = newCompany;
    // `role` не трогаем: это роль плагина better-auth, её ведёт assignRoles
    // Отключение — только присланным ДРУГИМ значением: пропущенное поле больше
    // не включает учётку молча. Включение снимает причину и срок, как ручка
    // отключения (toggleActive); сеансы при отключении гасятся после save().
    if (accountPlan.banned !== undefined) {
      user.banned = accountPlan.banned;
      if (!accountPlan.banned) {
        user.banReason = undefined;
        user.banExpires = undefined;
      }
    }
```

3g. In `backend/controllers/user.js` (`exports.update`), replace:

```js
    // «нельзя выдать больше, чем есть у самого».
    user.isEndUser = isEndUser;
    user.isServiceAccount = isServiceAccount;
```

with:

```js
    // «нельзя выдать больше, чем есть у самого».
    // Тип учётной записи — только присланным булевым: пропуск больше не стирает
    // поле, и учётка не остаётся ни сотрудником, ни клиентом.
    if (accountPlan.isEndUser !== undefined) {
      user.isEndUser = accountPlan.isEndUser;
    }
    user.isServiceAccount = isServiceAccount;
```

3h. In `backend/controllers/user.js` (`exports.update`, after the save), replace:

```js
    await user.save();

    // ПОСЛЕ save(): назначение зеркалит `isAdmin` прямо в базу, и сохранение
    // документа поверх вернуло бы прежнее значение.
    await ensureMember(user._id);
    if (Array.isArray(roles)) {
      // `canGrant`, а не `can` — см. комментарий в `add`.
      await assignRoles(user._id, roles, req.auth.canGrant);
    }
```

with:

```js
    await user.save();

    // Отключение и смена email гасят сеансы сразу после записи, как ручка
    // отключения: иначе человек работал бы до истечения токена, а после смены
    // адреса — под прежним входом. До назначения ролей: отказ там (409, 403)
    // не должен оставить сохранённую смену без последствий.
    if (accountPlan.banned === true || accountPlan.emailChange) {
      await revokeAllForUser(user._id);
    }
    if (accountPlan.emailChange) {
      await noticeEmailChanged(req, user, accountPlan.emailChange);
    }

    // ПОСЛЕ save(): назначение зеркалит `isAdmin` прямо в базу, и сохранение
    // документа поверх вернуло бы прежнее значение.
    await ensureMember(user._id);
    if (Array.isArray(roles)) {
      // `canGrant`, а не `can` — см. комментарий в `add`.
      await assignRoles(user._id, roles, req.auth.canGrant);
    } else if (accountPlan.audienceChanged) {
      // Роли не прислали, а тип учётной записи сменился: зеркало (`isAdmin` и
      // роль плагина) считается по адресату, и без пересчёта клиентская
      // учётная запись осталась бы `impersonator`
      await refreshMirrorForUsers(await organizationId(), [user._id]);
    }
```

3i. In `backend/controllers/user.js` (`exports.sessions`), replace:

```js
exports.sessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("_id");
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    res.status(200).json({ sessions: await listForUser(user._id) });
```

with:

```js
exports.sessions = async (req, res, next) => {
  try {
    // Признак администратора — ради того же правила, что у отзыва сеансов:
    // устройства и адреса администратора — тоже его доступ
    const user = await User.findById(req.params.id).select(
      "_id isAdmin isEndUser",
    );
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }
    res.status(200).json({ sessions: await listForUser(user._id) });
```

3j. In `frontend/src/pages/User/Update.jsx` (`action`), replace:

```js
  // 409 — почта занята, 400 — отказ проверки (например, пустой набор ролей).
  // Оба — ошибки формы: показываем сообщение в ней, а не страницу ошибки.
  if (response.status === 409 || response.status === 400) {
```

with:

```js
  // 409 — почта занята, 400 — отказ проверки (например, пустой набор ролей),
  // 403 — правка доступа без права на него (email, отключение, карточка
  // администратора). Всё это ошибки формы: сообщение в ней, а не страница
  // ошибки.
  if ([400, 403, 409].includes(response.status)) {
```

The rest of that branch is unchanged. It returns `{ error: true, message }`, and `UserForm` already renders `fetcher.data.message` in its `AlertMessage` (around line 1441). The sessions 403 needs no frontend change: `User/SessionList.jsx` already shows `ApiError.message`.

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test controllers/user.access.test.js`: `# pass 6`, `# fail 0`.
  - `cd backend && node --test services/accountUpdatePolicy.test.js`: `# pass 10`.
  - `cd backend && node --check controllers/user.js`: no output, exit 0.
  - `cd backend && pnpm test`: `# fail 0`. This includes `controllers/user.access.test.js` once Task 0's glob is in.
  - `cd frontend && ./node_modules/.bin/eslint src/pages/User/Update.jsx`: exit 0, no output.
  - `cd frontend && pnpm build`: the build completes.
  - Optional owner check on the dev stack:
    - As an account with `user.manage` but without `user.manageAccess`, change someone's e-mail in the user form. The form shows «Недостаточно прав, чтобы менять email: по нему входят в портал».
    - As an administrator, change it. The person's sessions disappear from «Сеансы», and a letter «Email учётной записи изменён» is queued to the old address (redirected to the owner outside prod).

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/controllers/user.js`, `backend/controllers/user.access.test.js` (new), `frontend/src/pages/User/Update.jsx`.

---

### Task A6: Self-service account: e-mail and categories locked (D2, mockup variant A)

**Files:**
- Create: `backend/services/selfAccountFields.js`
- Modify: `backend/controllers/user.js`:
  - the import after `require("@/services/authBan")`, line 56;
  - `exports.updateMyAccount`, destructuring at lines 1780–1794 and assignments at lines 1823–1829.
- Modify: `frontend/src/components/User/AccountSettings/Profile.jsx`:
  - the state, line 23;
  - `blockedReason` and `useDraftSection`, lines 36–52;
  - the Email `Field`, lines 105–113.
- Test: `backend/services/selfAccountFields.test.js`

**Interfaces:**
- Consumes: nothing from other tasks. This task is independent of A4 and A5.
- Produces, from `backend/services/selfAccountFields.js`:
  - `SELF_EDITABLE_FIELDS: string[]`;
  - `pickSelfEditableFields(body) → object`, holding only the object's own allowed keys.

- [ ] **Step 1: Write the failing test.** Create `backend/services/selfAccountFields.test.js`:

```js
// node --test services/selfAccountFields.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pickSelfEditableFields } = require("./selfAccountFields");

/**
 * «Мой аккаунт» правит профиль, а не доступ: свой email и свои разделы базы
 * знаний человек больше не меняет (спека W1, §2).
 */

const PROFILE = {
  firstName: "Мария",
  lastName: "Иванова",
  phone: "79145550142",
  position: "Инженер поддержки",
  notify: { byEmail: { ticketUpdate: false } },
  telegramBot: { chatId: "", isActive: false },
  timezone: "Asia/Vladivostok",
  fontScale: 125,
  plainCanvas: true,
};

test("own profile fields pass as sent", () => {
  assert.deepEqual(pickSelfEditableFields(PROFILE), PROFILE);
});

test("e-mail and knowledge-base categories are dropped", () => {
  const picked = pickSelfEditableFields({
    ...PROFILE,
    email: "someone-else@example.com",
    categories: ["66aa00000000000000000001"],
  });

  assert.equal(Object.hasOwn(picked, "email"), false);
  assert.equal(Object.hasOwn(picked, "categories"), false);
  assert.deepEqual(picked, PROFILE);
});

test("access fields never pass", () => {
  assert.deepEqual(
    pickSelfEditableFields({
      id: "66aa00000000000000000002",
      banned: false,
      isEndUser: false,
      isAdmin: true,
      isServiceAccount: false,
      role: "impersonator",
      roles: ["admin"],
      company: "66aa00000000000000000003",
      password: "x",
    }),
    {},
  );
});

test("a field that was not sent stays absent; empty values pass", () => {
  assert.deepEqual(pickSelfEditableFields({}), {});
  assert.deepEqual(pickSelfEditableFields(undefined), {});
  // Пустой телефон — «телефона нет», null пояса — «как у организации»
  assert.deepEqual(pickSelfEditableFields({ phone: "", timezone: null }), {
    phone: "",
    timezone: null,
  });
});

test("inherited keys are not picked", () => {
  const body = Object.create({ email: "x@example.com", firstName: "Чужое" });
  assert.deepEqual(pickSelfEditableFields(body), {});
});
```

- [ ] **Step 2: Run it to verify it fails.**
  - Command: `cd backend && node --test services/selfAccountFields.test.js`
  - Expected: `not ok 1 - …/selfAccountFields.test.js` with `Error: Cannot find module './selfAccountFields'`, and `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/services/selfAccountFields.js`:

```js
/**
 * Что человек правит в СВОЕЙ учётной записи — «Мой аккаунт»,
 * `POST /api/users/update-account`. Всё прочее из тела отбрасывается.
 *
 * Здесь нет email и categories (спека W1, §2). Email — это вход: его меняет
 * администратор в карточке человека, где смена гасит сеансы и уведомляет
 * прежний адрес (services/accountUpdatePolicy.js). Categories — разделы базы
 * знаний, которые человеку открыты: расширять их самому значит выдавать себе
 * доступ. Роли, тип учётной записи и отключение сюда не попадали и раньше.
 */
const SELF_EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "position",
  "notify",
  // Только отвязка: привязку ставит обмен кода (services/telegramActor)
  "telegramBot",
  "timezone",
  "fontScale",
  "plainCanvas",
];

/**
 * Разрешённые поля тела — только собственные ключи объекта. Непришедшее поле
 * остаётся непришедшим: для ручки это «не трогать».
 *
 * @param {object|undefined} body — тело запроса
 * @returns {object}
 */
const pickSelfEditableFields = (body) =>
  Object.fromEntries(
    SELF_EDITABLE_FIELDS.filter((key) => Object.hasOwn(body || {}, key)).map(
      (key) => [key, body[key]],
    ),
  );

module.exports = { SELF_EDITABLE_FIELDS, pickSelfEditableFields };
```

3b. In `backend/controllers/user.js`, replace (line 56):

```js
const { isBanned } = require("@/services/authBan");
```

with:

```js
const { isBanned } = require("@/services/authBan");
const { pickSelfEditableFields } = require("@/services/selfAccountFields");
```

3c. In `backend/controllers/user.js` (`exports.updateMyAccount`), replace:

```js
exports.updateMyAccount = async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      categories,
      notify,
      telegramBot,
      timezone,
      fontScale,
      plainCanvas,
    } = req.body;
```

with:

```js
exports.updateMyAccount = async (req, res, next) => {
  try {
    // Только поля своего профиля: email и categories отсюда не принимаются —
    // это вход и доступ, их меняет администратор (services/selfAccountFields.js)
    const {
      firstName,
      lastName,
      phone,
      position,
      notify,
      telegramBot,
      timezone,
      fontScale,
      plainCanvas,
    } = pickSelfEditableFields(req.body);
```

3d. In `backend/controllers/user.js` (`exports.updateMyAccount`), replace:

```js
    user.email = email ? email : user.email;
    // Пустая строка — «телефона нет»; не прислали — не трогаем
    user.phone = phone !== undefined ? phone : user.phone;
    user.firstName = firstName ? firstName : user.firstName;
    user.lastName = lastName ? lastName : user.lastName;
    user.position = position ? position : user.position;
    user.categories = categories ? categories : user.categories;
```

with:

```js
    // Пустая строка — «телефона нет»; не прислали — не трогаем
    user.phone = phone !== undefined ? phone : user.phone;
    user.firstName = firstName ? firstName : user.firstName;
    user.lastName = lastName ? lastName : user.lastName;
    user.position = position ? position : user.position;
```

The response keeps returning `email` and `categories` as read-only data.

3e. In `frontend/src/components/User/AccountSettings/Profile.jsx`, replace:

```jsx
  const [lastName, setLastName] = useState(user.lastName || "");
  const [email, setEmail] = useState(user.email || "");
  const [phoneNumber, setPhoneNumber] = useState(phoneWireValue(user.phone));
```

with:

```jsx
  const [lastName, setLastName] = useState(user.lastName || "");
  const [phoneNumber, setPhoneNumber] = useState(phoneWireValue(user.phone));
```

3f. In `Profile.jsx`, replace:

```jsx
  const blockedReason =
    blank(firstName) || blank(lastName) || blank(email)
      ? "Имя, фамилия и email не могут быть пустыми"
      : phoneInputError(phoneNumber)
        ? "Проверьте номер телефона"
        : null;

  useDraftSection(
    () => ({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phoneNumber || "",
      position: position.trim(),
    }),
    blockedReason,
  );
```

with:

```jsx
  const blockedReason =
    blank(firstName) || blank(lastName)
      ? "Имя и фамилия не могут быть пустыми"
      : phoneInputError(phoneNumber)
        ? "Проверьте номер телефона"
        : null;

  // Email в черновик не входит: его меняет администратор, и сервер из «Моего
  // аккаунта» его не примет
  useDraftSection(
    () => ({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phoneNumber || "",
      position: position.trim(),
    }),
    blockedReason,
  );
```

3g. In `Profile.jsx`, replace the Email field (same grid slot). The result is mockup variant A:
- a read-only `Input` with the muted fill and a transparent border;
- `dark:bg-muted` overrides the Input's `dark:bg-input/30`, and `tailwind-merge` in `cn` drops `border-input`, `bg-transparent` and `dark:bg-input/30`;
- text stays in the foreground colour and can be selected;
- no `required` asterisk, and the hint comes from `Field`.

`bg-muted` comes from `--color-muted` in `src/styles/tailwind.css` (`--muted` is `#f2f4f5` light and `#23262b` dark, as in the mockup). `border-transparent` is already used across the app.

Replace:

```jsx
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            value={email}
            aria-invalid={blank(email)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
```

with:

```jsx
        {/* Email — это вход, его меняет администратор в карточке человека
            (там смена гасит сеансы и уведомляет прежний адрес). Здесь поле
            только читается: заливка вместо рамки в обеих темах, текст
            контрастный и выделяется (макет, вариант A). */}
        <Field label="Email" htmlFor="email" hint="Email меняет администратор">
          <Input
            id="email"
            type="email"
            value={user.email || ""}
            readOnly
            className="cursor-default border-transparent bg-muted dark:bg-muted"
          />
        </Field>
```

- [ ] **Step 4: Run tests to verify they pass.**
  - `cd backend && node --test services/selfAccountFields.test.js`: `# pass 5`, `# fail 0`.
  - `cd backend && node --check controllers/user.js`: no output, exit 0.
  - `cd backend && pnpm test`: `# fail 0`.
  - `cd frontend && ./node_modules/.bin/eslint src/components/User/AccountSettings/Profile.jsx`: exit 0, no output.
  - `cd frontend && pnpm build`: the build completes.
  - `cd frontend && pnpm typecheck`: only the 3 known errors (1 in `src/components/app/FormWrapper.tsx`, 2 in `src/pages/Finances/ApprovalReport.tsx`), nothing new.
  - Owner checks "Мой аккаунт → Профиль" by hand, in both themes, on desktop and mobile:
    - Email sits in the same slot, muted fill, no asterisk, hint «Email меняет администратор»;
    - the text can be selected but not edited;
    - editing only other fields still lights up the DraftBar, and Email never does.

- [ ] **Step 5: Leave uncommitted.** Changed files: `backend/services/selfAccountFields.js` (new), `backend/services/selfAccountFields.test.js` (new), `backend/controllers/user.js`, `frontend/src/components/User/AccountSettings/Profile.jsx`.

---

**Known edge, accepted and not changed:** `services/invitation.js` decides "link or password" with `isEndUser !== false && !twoFactorEnabled`. A client created already banned, or inside a switched-off company, with "Пригласить письмом" now gets no link: `sendMagicLink` refuses it silently. `invitedAt` is still set. Before this change the letter went out but its link could not open a session, so nothing usable is lost.

## Section B — Data exposure, API keys, request limits

Covers spec §3 "Data exposure" (S1, S2, S10), §4 "Company API keys" (S5 and the operator-key
guard) and the body-limit rows of §6 (decisions D3 and D5). Base `b3b20cf`; the work happens in
the W1 worktree (D7). Paths are relative to the worktree root, and every command runs from
`backend/`. **Nothing is committed or pushed at any step.**

Facts checked against HEAD before planning:

- `req.auth` is built by `services/authContext.js` `buildAuthContext`. It has:
  - `isEndUser`, already normalised (`user.isEndUser !== false`);
  - `user`, the Mongoose document, where the company id is `user.company._id`;
  - `legacy`, a plain copy whose `isEndUser` is the raw tri-state field;
  - `can()`.

  New code reads `req.auth.isEndUser`, never `legacy.isEndUser`.
- **Body parsing.** Express is 5.1.0 with body-parser 2.2.0. A parser skips a request whose
  stream was already read (`isFinished(req)` in `body-parser/lib/types/json.js`; `req._body` is
  not used any more). So path-specific parsers mounted before the global one are the only ones
  that read those bodies.
- **Error handling.** `errorResponse` (`middleware/errorHandling.js`) answers
  `{ error: true, status, code: "ERR_<status>", message }`. It then calls `next(error)`, and
  finalhandler destroys the socket. A new middleware that refuses a request therefore writes that
  same JSON itself, as `middleware/requireMcpKey.js` does.
- **Anonymous routes that exist today.** Nothing else matches `/api/password*`.

  | Method | Path | Defined in |
  |---|---|---|
  | POST | `/api/login`, `/api/login/two-factor` | `routes/internal/auth.js` |
  | POST | `/api/login-code`, `/api/login-code/verify`, `/api/login-code/password` | `routes/internal/auth.js` |
  | POST | `/api/impersonate/claim` | `routes/internal/auth.js` |
  | POST | `/api/password/check` | `routes/internal/me.js` |
  | GET | `/api/external/approval/:token` | `routes/external/approval.js` |
  | POST | `/api/external/approval/:token/decision` | `routes/external/approval.js` |
- **Editor saves whose JSON embeds base64 images.** Toast UI pastes images as `data:` URLs
  (`UI/MarkdownEditor.jsx`). All of these are JSON `POST`s:

  | Editor | Paths | Frontend caller |
  |---|---|---|
  | KB notes | `/api/knowledge-notes/add`, `/api/knowledge-notes/update/:id` | `components/KnowledgeBase/NoteView.jsx:184-185` |
  | Ticket templates | `/api/ticket-templates/add`, `/api/ticket-templates/update/:id` | `pages/TicketTemplate/Add.jsx`, `Update.jsx` |
  | Routine tasks | `/api/routine-tasks/add`, `/api/routine-tasks/update/:id` | `pages/RoutineTask/Add.jsx`, `Update.jsx` |

  The checklist, moderation and sync routes under the same prefixes carry no images, so they get
  the default limit.
- **Ticket card.** `GET /api/tickets/:num` is consumed only by `pages/Ticket/View.jsx` (loader,
  line 848). The spec lists the fields the card reads. One more is read:
  `components/Company/company-links.js` uses `company.locationSettings.{latitude,longitude}` as
  a coordinate fallback for the taxi action. The Company model says nothing writes that field
  any more, so the DTO keeps only those two numbers.
- Baseline: `pnpm test` at `b3b20cf` runs 708 tests with 0 failures.

---

### Task B1: Inventory scoping — device tickets, attachable components, user tech

**Files:**
- Create: `backend/services/deviceScope.js`
- Modify: `backend/controllers/inventory/clientDevice.js`:
  - imports: after line 20, `const { mikrotikEnabled } = …`;
  - `getOne`: the visibility check, lines 798-810;
  - `getTickets`: lines 856-859;
  - `getAttachable`: line 1155.
- Modify: `backend/controllers/inventory/location.js`:
  - the `deviceScopeMatch` definition with its JSDoc, lines 43-52;
  - `getUserTech`: the device queries, lines 1278-1299.
- Test: `backend/services/deviceScope.test.js`

**Interfaces:**
- Consumes:
  - `ticketListFilter(auth)` from `services/ticketScope.js`. It returns a Mongo filter
    fragment, `{}` on the `all` tier.
  - `companyScope(req)`, local to `controllers/inventory/location.js`. It returns `null` for
    staff, otherwise a `string[]` of allowed company ids (empty for a client without a company).
  - `req.auth.isEndUser` and `req.auth.user.company._id`.
- Produces (`services/deviceScope.js`):
  - `deviceViewer(auth) → { isEndUser: boolean, companyId: ObjectId|null }`
  - `deviceVisibleTo(viewer, device) → boolean`
  - `attachableCompanyId(viewer, requested) → string|null`
  - `deviceTicketsFilter(deviceId, ticketScope) → { $and: [{ relatedClientDeviceId }, ticketScope] }`
  - `deviceScopeMatch(scope) → {} | { companyId: { $in: scope } }`: moved from `location.js`,
    with the same semantics.
  - `userTechQueries({ userId, workplaceId, parentId, scope }) → { own, parent|null }`

- [ ] **Step 1: Write the failing test.** Create `backend/services/deviceScope.test.js`:

```js
// node --test services/deviceScope.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sift = require("sift").default;

const {
  attachableCompanyId,
  deviceScopeMatch,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
  userTechQueries,
} = require("./deviceScope");

/**
 * Видимость техники: клиент заперт в своей компании на карточке устройства,
 * на её заявках, в подборе комплектующих и в технике пользователя. Сотрудник
 * не ограничен. Условия проверяются тем же сопоставлением, что у Mongo (sift).
 */

const OWN = "66aa00000000000000000001";
const FOREIGN = "66aa00000000000000000002";

const client = { isEndUser: true, companyId: OWN };
const staff = { isEndUser: false, companyId: null };

test("viewer comes from req.auth: normalised isEndUser and the company id", () => {
  const companyId = new mongoose.Types.ObjectId(OWN);
  assert.deepEqual(
    deviceViewer({ isEndUser: true, user: { company: { _id: companyId } } }),
    { isEndUser: true, companyId },
  );
  assert.deepEqual(deviceViewer({ isEndUser: false, user: {} }), {
    isEndUser: false,
    companyId: null,
  });
  assert.deepEqual(deviceViewer(undefined), {
    isEndUser: false,
    companyId: null,
  });
});

test("device card: a client sees only own-company devices, staff sees all", () => {
  const populated = { companyId: { _id: new mongoose.Types.ObjectId(OWN), alias: "Своя" } };
  const raw = { companyId: new mongoose.Types.ObjectId(OWN) };
  const foreign = { companyId: new mongoose.Types.ObjectId(FOREIGN) };
  const orphan = { companyId: null };

  assert.equal(deviceVisibleTo(client, populated), true);
  assert.equal(deviceVisibleTo(client, raw), true);
  assert.equal(deviceVisibleTo(client, foreign), false);
  assert.equal(deviceVisibleTo(client, orphan), false);
  assert.equal(deviceVisibleTo(staff, foreign), true);
  assert.equal(deviceVisibleTo(staff, orphan), true);
});

test("device card: a client without a company sees nothing, not company-less devices", () => {
  const homeless = { isEndUser: true, companyId: null };
  assert.equal(deviceVisibleTo(homeless, { companyId: null }), false);
  assert.equal(deviceVisibleTo(homeless, {}), false);
});

test("attachable: a client may ask only for their own company", () => {
  assert.equal(attachableCompanyId(client, OWN), OWN);
  assert.equal(attachableCompanyId(client, ` ${OWN.toUpperCase()} `), OWN);
  assert.equal(attachableCompanyId(client, FOREIGN), null);
  assert.equal(
    attachableCompanyId({ isEndUser: true, companyId: null }, OWN),
    null,
  );
});

test("attachable: staff may ask for any company, but only a single real id", () => {
  assert.equal(attachableCompanyId(staff, FOREIGN), FOREIGN);
  for (const bad of [undefined, "", "abc", [OWN, FOREIGN], { $ne: null }, 42]) {
    assert.equal(attachableCompanyId(staff, bad), null);
    assert.equal(attachableCompanyId(client, bad), null);
  }
});

test("device tickets: the device condition is ANDed with the ticket scope", () => {
  const deviceId = new mongoose.Types.ObjectId();
  const scope = { $or: [{ applicantId: "u1" }, { createdBy: "u1" }] };

  assert.deepEqual(deviceTicketsFilter(deviceId, scope), {
    $and: [{ relatedClientDeviceId: deviceId }, scope],
  });
  assert.deepEqual(deviceTicketsFilter(deviceId, {}), {
    $and: [{ relatedClientDeviceId: deviceId }, {}],
  });

  const tickets = [
    { num: 1, relatedClientDeviceId: "d1", applicantId: "u1" },
    { num: 2, relatedClientDeviceId: "d1", applicantId: "u2" },
    { num: 3, relatedClientDeviceId: "d2", applicantId: "u1" },
  ];
  const nums = (filter) => tickets.filter(sift(filter)).map((t) => t.num);
  assert.deepEqual(nums(deviceTicketsFilter("d1", scope)), [1]);
  assert.deepEqual(nums(deviceTicketsFilter("d1", {})), [1, 2]);
});

test("device scope match: null scope is unrestricted, a list restricts", () => {
  assert.deepEqual(deviceScopeMatch(null), {});
  assert.deepEqual(deviceScopeMatch([OWN]), { companyId: { $in: [OWN] } });
  assert.deepEqual(deviceScopeMatch([]), { companyId: { $in: [] } });
});

test("user tech: both queries carry the company scope", () => {
  const devices = [
    { id: "personal", userId: "u1", locationId: "elsewhere", companyId: OWN },
    { id: "desk", userId: null, locationId: "wp", companyId: OWN },
    { id: "foreign-desk", userId: null, locationId: "wp", companyId: FOREIGN },
    { id: "room", userId: null, locationId: "room", companyId: OWN },
    { id: "foreign-room", userId: null, locationId: "room", companyId: FOREIGN },
    { id: "part", userId: "u1", locationId: "wp", companyId: OWN, parentDeviceId: "desk" },
    { id: "deleted", userId: "u1", locationId: "wp", companyId: OWN, deletedAt: new Date() },
  ];
  const ids = (filter) => devices.filter(sift(filter)).map((d) => d.id);

  const scoped = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: [OWN],
  });
  assert.deepEqual(ids(scoped.own), ["personal", "desk"]);
  assert.deepEqual(ids(scoped.parent), ["room"]);

  const unscoped = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: null,
  });
  assert.deepEqual(ids(unscoped.own), ["personal", "desk", "foreign-desk"]);
  assert.deepEqual(ids(unscoped.parent), ["room", "foreign-room"]);

  // Клиент без компании: companyScope отдаёт [] — не видно ничего
  const homeless = userTechQueries({
    userId: "u1",
    workplaceId: "wp",
    parentId: "room",
    scope: [],
  });
  assert.deepEqual(ids(homeless.own), []);
  assert.deepEqual(ids(homeless.parent), []);
});

test("user tech: no workplace means personal devices only and no parent query", () => {
  const queries = userTechQueries({ userId: "u1", scope: [OWN] });
  assert.deepEqual(queries.own, {
    deletedAt: null,
    parentDeviceId: null,
    companyId: { $in: [OWN] },
    $or: [{ userId: "u1" }],
  });
  assert.equal(queries.parent, null);
});
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test services/deviceScope.test.js
```

Expected: `Error: Cannot find module './deviceScope'`, `not ok 1 - services/deviceScope.test.js`,
`# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/services/deviceScope.js`:

```js
/**
 * Видимость техники — одно правило на карточку устройства, её заявки, подбор
 * комплектующих и технику пользователя (спека W1, §3).
 *
 * Модуль чистый: условия собираются здесь, запросы делают контроллеры
 * (controllers/inventory/clientDevice.js, controllers/inventory/location.js).
 */

const HEX_OBJECT_ID = /^[a-f0-9]{24}$/i;

// Идентификатор из populate'нутого документа, вложенного объекта или сырого
// ObjectId — сравниваем строками.
const idOf = (value) => String(value?._id ?? value ?? "");

/**
 * Кто смотрит. `isEndUser` берётся из `req.auth`, где он уже приведён
 * (`user.isEndUser !== false`, services/authContext), а не из документа.
 */
const deviceViewer = (auth) => ({
  isEndUser: Boolean(auth?.isEndUser),
  companyId: auth?.user?.company?._id ?? null,
});

/**
 * Карточка устройства и всё, что к ней приложено: клиент видит технику только
 * своей компании, клиент без компании — ничего (как `scopeMatch` у списка).
 */
const deviceVisibleTo = (viewer, device) => {
  if (!viewer?.isEndUser) return true;
  const own = idOf(viewer.companyId);
  return Boolean(own) && idOf(device?.companyId) === own;
};

/**
 * Компания для подбора комплектующих (`getAttachable`). Клиенту — только своя:
 * чужая, кривая или повторённая в query (массив) даёт `null`, и ответ пустой.
 * Сотруднику — любая, но одна и настоящая.
 */
const attachableCompanyId = (viewer, requested) => {
  const id =
    typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!HEX_OBJECT_ID.test(id)) return null;
  if (viewer?.isEndUser && id !== idOf(viewer.companyId).toLowerCase()) {
    return null;
  }
  return id;
};

/**
 * Заявки устройства в пределах видимости заявок автора запроса
 * (`ticketListFilter`, services/ticketScope): ярус «свои» у сотрудника через
 * устройство тоже не видит чужих заявок.
 */
const deviceTicketsFilter = (deviceId, ticketScope) => ({
  $and: [{ relatedClientDeviceId: deviceId }, ticketScope || {}],
});

/**
 * Скоуп в терминах ТЕХНИКИ: у устройства компания лежит в `companyId`.
 * `scope` — список id компаний из `companyScope` (controllers/inventory/
 * location.js), `null` — сотрудник, без ограничений.
 *
 * Нужен отдельно от расположения, потому что «расположение своей компании» ещё
 * не значит «вся техника в нём своя»: публичное расположение (`isPublic`) может
 * держать устройства чужой компании, и клиенту в списке видны были бы их модель
 * и инвентарный номер.
 */
const deviceScopeMatch = (scope) =>
  scope ? { companyId: { $in: scope } } : {};

/**
 * Техника пользователя (`getUserTech`): личная и рабочего места, и — уровнем
 * выше — техника родителя РМ. Обе выборки заперты скоупом компании.
 */
const userTechQueries = ({
  userId,
  workplaceId = null,
  parentId = null,
  scope = null,
}) => {
  const base = {
    deletedAt: null,
    parentDeviceId: null,
    ...deviceScopeMatch(scope),
  };
  return {
    own: {
      ...base,
      $or: [{ userId }, ...(workplaceId ? [{ locationId: workplaceId }] : [])],
    },
    parent: parentId ? { ...base, locationId: parentId } : null,
  };
};

module.exports = {
  attachableCompanyId,
  deviceScopeMatch,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
  userTechQueries,
};
```

3b. `backend/controllers/inventory/clientDevice.js`, the imports.

Find (occurs exactly once):

```js
const { mikrotikEnabled } = require("../../services/mikrotik/enabled");
```

Replace with:

```js
const { mikrotikEnabled } = require("../../services/mikrotik/enabled");
const { ticketListFilter } = require("../../services/ticketScope");
const {
  attachableCompanyId,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
} = require("../../services/deviceScope");
```

3c. The same file, `getOne`: use the shared rule. The rule is now stricter for a client without a
company: before, `"" === ""` let that client open devices that had no company too.

Find (occurs exactly once):

```js
    // Тот же скоуп, что у списка: клиент заперт в своей компании. В выборке
    // список это делал (`scopeMatch`), а карточка — нет, и чужое устройство
    // открывалось прямой ссылкой.
    const { isEndUser, user } = req.auth;
    if (
      isEndUser &&
      String(device.companyId?._id ?? device.companyId ?? "") !==
        String(user.company?._id ?? "")
    ) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }
```

Replace with:

```js
    // Тот же скоуп, что у списка: клиент заперт в своей компании. В выборке
    // список это делал (`scopeMatch`), а карточка — нет, и чужое устройство
    // открывалось прямой ссылкой. Правило общее с заявками устройства
    // (`getTickets`) — services/deviceScope.
    if (!deviceVisibleTo(deviceViewer(req.auth), device)) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }
```

3d. The same file, `getTickets`: check the device with the card's scope, then AND the ticket
query with `ticketListFilter`. A malformed id still ends in a 404, because `errorResponse` maps
the `_id` CastError to 404.

Find (occurs exactly once):

```js
exports.getTickets = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const query = { relatedClientDeviceId: req.params.id };
```

Replace with:

```js
exports.getTickets = async (req, res, next) => {
  try {
    // Сначала само устройство — тем же скоупом, что карточка (getOne): по
    // чужому id клиент получает 404, а не историю простоев чужой компании
    const device = await ClientDevice.findById(req.params.id)
      .select("companyId")
      .lean();
    if (!device || !deviceVisibleTo(deviceViewer(req.auth), device)) {
      return next(
        new AppError(`Device with id ${req.params.id} not found`, 404),
      );
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    // Заявки — в пределах видимости заявок автора запроса: ярус «свои» у
    // сотрудника через устройство тоже не видит чужих заявок
    const query = deviceTicketsFilter(device._id, ticketListFilter(req.auth));
```

3e. The same file, `getAttachable`: a client may ask only for their own company. The rest of the
handler stays as it is, including `if (!companyId) return res.status(200).json([]);` and
`const query = { deletedAt: null, parentDeviceId: null, companyId };`.

Find (occurs exactly once):

```js
    const companyId = clean(req.query.companyId);
    const excludeId = clean(req.query.excludeId);
    const hostTypeId = clean(req.query.hostTypeId);
```

Replace with:

```js
    // Клиенту — только своя компания: чужая в query, кривой или повторённый
    // параметр отвечают пустым списком (services/deviceScope)
    const companyId = attachableCompanyId(
      deviceViewer(req.auth),
      req.query.companyId,
    );
    const excludeId = clean(req.query.excludeId);
    const hostTypeId = clean(req.query.hostTypeId);
```

3f. `backend/controllers/inventory/location.js`: replace the local `deviceScopeMatch` with the
shared one. It is used unchanged at lines 104, 122, 307, 355 and 1164.

Find (occurs exactly once):

```js
/**
 * Скоуп в терминах ТЕХНИКИ: у устройства компания лежит в `companyId`.
 *
 * Нужен отдельно от расположения, потому что «расположение своей компании» ещё
 * не значит «вся техника в нём своя»: публичное расположение (`isPublic`) может
 * держать устройства чужой компании, и клиенту в списке видны были бы их модель
 * и инвентарный номер.
 */
const deviceScopeMatch = (scope) =>
  scope ? { companyId: { $in: scope } } : {};
```

Replace with:

```js
// Скоуп в терминах ТЕХНИКИ (`deviceScopeMatch`) и выборки техники
// пользователя — чистые построители в services/deviceScope.js, там же тест.
const {
  deviceScopeMatch,
  userTechQueries,
} = require("../../services/deviceScope");
```

3g. The same file, `getUserTech`: both device queries carry the scope. `scope` is the
`const scope = companyScope(req);` already computed at line 1269. The code after
`const mikroMap = …` stays as it is.

Find (occurs exactly once):

```js
    const deviceFilter = { deletedAt: null, parentDeviceId: null };
    const workplaces = await Location.getUserWorkplaces(userId);
    const workplace = workplaces[0] || null;
    const parent = workplace?.parent || null;

    const ownRaw = await ClientDevice.find({
      ...deviceFilter,
      $or: [
        { userId },
        ...(workplace ? [{ locationId: workplace._id }] : []),
      ],
    }).populate(ENV_DEVICE_POPULATE);

    const ownIds = new Set(ownRaw.map((d) => String(d._id)));
    const parentRaw = parent
      ? (
          await ClientDevice.find({
            ...deviceFilter,
            locationId: parent._id,
          }).populate(ENV_DEVICE_POPULATE)
        ).filter((d) => !ownIds.has(String(d._id)))
      : [];
```

Replace with:

```js
    const workplaces = await Location.getUserWorkplaces(userId);
    const workplace = workplaces[0] || null;
    const parent = workplace?.parent || null;

    // Обе выборки — в скоупе компании: на рабочем месте и в помещении может
    // стоять техника чужой компании (публичное расположение), и клиенту её
    // модель и инвентарный номер не показываются (services/deviceScope)
    const queries = userTechQueries({
      userId,
      workplaceId: workplace?._id ?? null,
      parentId: parent?._id ?? null,
      scope,
    });

    const ownRaw = await ClientDevice.find(queries.own).populate(
      ENV_DEVICE_POPULATE,
    );

    const ownIds = new Set(ownRaw.map((d) => String(d._id)));
    const parentRaw = queries.parent
      ? (
          await ClientDevice.find(queries.parent).populate(ENV_DEVICE_POPULATE)
        ).filter((d) => !ownIds.has(String(d._id)))
      : [];
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test services/deviceScope.test.js
cd backend && node --check controllers/inventory/clientDevice.js && node --check controllers/inventory/location.js
cd backend && pnpm test
```

Expected:
- the first command prints `# tests 9`, `# pass 9`, `# fail 0`;
- `node --check` prints nothing and exits with 0;
- `pnpm test` ends with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/services/deviceScope.js` (new)
  - `backend/services/deviceScope.test.js` (new)
  - `backend/controllers/inventory/clientDevice.js`
  - `backend/controllers/inventory/location.js`

  Behaviour notes for the owner:
  - A client account without a company gets a 404 on company-less devices. Its «Моё рабочее
    место» list is empty.
  - A device with no `companyId` that is assigned personally to a client no longer shows in that
    client's workplace list.
  - Optional, read-only, before rollout:
    `db.clientdevices.countDocuments({ deletedAt: null, companyId: null, userId: { $ne: null } })`.

---

### Task B2: Approval actions respond `{ ok: true, id }`

**Files:**
- Create: `backend/services/approvalActionResult.js`
- Modify: `backend/controllers/finances/approval.js`:
  - the import, after line 39 (`const { resolveTimezone } = …`);
  - `create`, line 438;
  - `resubmit`, line 457;
  - `stageAction`, line 476; it covers `invoice`, `payment` and `archive`;
  - `decision`, line 530.
- Test: `backend/services/approvalActionResult.test.js`

**Interfaces:**
- Consumes: the `ServicePlanReport` document that the controllers already hold, or the one
  `createReport` returns.
- Produces: `approvalActionResult(report) → { ok: true, id: string }`.
- Frontend: no change. The action helpers read only `payload?.message` on error and re-fetch on
  success:
  - `pages/Finances/ApprovalReport.tsx` `post()`, lines 90-113;
  - `pages/Finances/Approval.tsx` `submit`, lines 104-132.

- [ ] **Step 1: Write the failing test.** Create `backend/services/approvalActionResult.test.js`:

```js
// node --test services/approvalActionResult.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { approvalActionResult } = require("./approvalActionResult");

/**
 * Действия с отчётом согласования отвечают `{ ok, id }`: документ отчёта несёт
 * персональные токены согласующих, и нажавший кнопку не должен их получить.
 */

// Модель-зонд: достаточно формы документа, к базе тест не подключается
const ReportProbe = mongoose.model(
  "ApprovalActionResultProbe",
  new mongoose.Schema({
    status: String,
    accessTokens: [{ token: String, userId: mongoose.Schema.Types.ObjectId }],
  }),
);

test("a report document becomes { ok, id } and nothing else", () => {
  const report = new ReportProbe({
    status: "pendingApproval",
    accessTokens: [
      { token: "sibling-branch-token", userId: new mongoose.Types.ObjectId() },
      { token: "final-approver-token", userId: new mongoose.Types.ObjectId() },
    ],
  });

  const result = approvalActionResult(report);

  assert.deepEqual(result, { ok: true, id: String(report._id) });
  assert.deepEqual(Object.keys(result), ["ok", "id"]);
});

test("no access token survives serialisation of the response", () => {
  const report = new ReportProbe({
    accessTokens: [{ token: "sibling-branch-token" }],
  });

  const wire = JSON.stringify(approvalActionResult(report));

  assert.doesNotMatch(wire, /token/i);
  assert.equal(JSON.parse(wire).id, String(report._id));
});

test("a plain object with an ObjectId works the same way", () => {
  const _id = new mongoose.Types.ObjectId();
  assert.deepEqual(approvalActionResult({ _id, accessTokens: [] }), {
    ok: true,
    id: String(_id),
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test services/approvalActionResult.test.js
```

Expected: `Error: Cannot find module './approvalActionResult'`, `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/services/approvalActionResult.js`:

```js
/**
 * Ответ на действие с отчётом «Согласования работ»: сформировать, отправить
 * повторно, счёт, оплата, архив, решение (controllers/finances/approval.js).
 *
 * ТОЛЬКО ПРИЗНАК И ID. Документ отчёта несёт `accessTokens[].token` —
 * персональные ссылки согласующих из писем (controllers/external/approval.js):
 * руководитель подразделения, получив отчёт целиком, подписал бы по чужой
 * ссылке за соседний филиал и за финального согласующего. Интерфейс после
 * действия всё равно перечитывает карточку, а при ошибке читает только
 * `message`.
 */
const approvalActionResult = (report) => ({
  ok: true,
  id: String(report._id),
});

module.exports = { approvalActionResult };
```

3b. `backend/controllers/finances/approval.js`, the import.

Find (occurs exactly once):

```js
const { resolveTimezone } = require("@/utils/datetime");
```

Replace with:

```js
const { resolveTimezone } = require("@/utils/datetime");
const { approvalActionResult } = require("@/services/approvalActionResult");
```

3c. `create`:

Find (occurs exactly once):

```js
    res.status(201).json({ report });
```

Replace with:

```js
    res.status(201).json(approvalActionResult(report));
```

3d. `resubmit`:

Find (occurs exactly once):

```js
    await resubmit({ report, workIds: req.body.workIds, authedUser });
    res.status(200).json({ report });
```

Replace with:

```js
    await resubmit({ report, workIds: req.body.workIds, authedUser });
    res.status(200).json(approvalActionResult(report));
```

3e. `stageAction` (`invoice`, `payment`, `archive`):

Find (occurs exactly once):

```js
    await run({ report, body: req.body, authedUser });
    res.status(200).json({ report });
```

Replace with:

```js
    await run({ report, body: req.body, authedUser });
    res.status(200).json(approvalActionResult(report));
```

3f. `decision`:

Find (occurs exactly once):

```js
      subdivisionId,
    });

    res.status(200).json({ report });
```

Replace with:

```js
      subdivisionId,
    });

    res.status(200).json(approvalActionResult(report));
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test services/approvalActionResult.test.js
cd backend && node --check controllers/finances/approval.js && ! grep -n "json({ report })" controllers/finances/approval.js
cd backend && pnpm test
```

Expected:
- the first command prints `# tests 3`, `# pass 3`, `# fail 0`;
- the second prints nothing and exits with 0: no raw report is returned any more;
- `pnpm test` ends with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/services/approvalActionResult.js` (new)
  - `backend/services/approvalActionResult.test.js` (new)
  - `backend/controllers/finances/approval.js`

---

### Task B3: The ticket card's company DTO

**Files:**
- Create: `backend/services/ticketCardCompany.js`
- Modify: `backend/controllers/ticket.js`:
  - the import, after line 88 (`const { canEditChecklist } = …`);
  - the `getOne` response, line 670, `company: companyObj || {},`.
- Test: `backend/services/ticketCardCompany.test.js`

**Interfaces:**
- Consumes:
  - `companyObj`, the plain `company.toJSON()` with `addresses`, built at lines 640-656. Its
    earlier consumers, `resolveClientTimezone`, `listCompanyAddresses` and
    `resolveClientAddress` (lines 629-656), keep getting the full object.
  - `req.auth.can({ company: ["readLogs"] })`: the same right as `canReadCompanyLogs` in
    `middleware/permissions.js:379`.
- Produces: `ticketCardCompany(company, { canReadLogs }) → object`:
  - it keeps `_id`, `alias`, `workSchedule`, `addresses`, `address`, `linkToMap` and
    `location`, each when present;
  - it keeps `locationSettings`, reduced to `{ latitude, longitude }`;
  - with `canReadLogs` it adds `employees: [{ _id, firstName, lastName }]`;
  - it returns `{}` when there is no company.

- [ ] **Step 1: Write the failing test.** Create `backend/services/ticketCardCompany.test.js`:

```js
// node --test services/ticketCardCompany.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ticketCardCompany } = require("./ticketCardCompany");

/**
 * Компания в карточке заявки: только поля, которые читает интерфейс. Ключи,
 * контакты, услуги и домены не уходят никому; люди компании — только с правом
 * видеть журнал входов AD, и только имя.
 */

// Как после `company.toJSON()` + `addresses` в controllers/ticket.js getOne
const fullCompany = () => ({
  _id: "66aa00000000000000000001",
  alias: "Ромашка",
  fullTitle: "ООО «Ромашка»",
  isActive: true,
  emailDomains: ["romashka.ru"],
  phones: ["74950000000"],
  address: "Москва, Тверская, 1",
  linkToMap: "https://yandex.ru/maps/?pt=37.6,55.7",
  location: { lat: 55.7, lon: 37.6 },
  locationSettings: {
    allowTracking: true,
    latitude: 55.7,
    longitude: 37.6,
    title: "Офис",
    radius: 100,
  },
  workSchedule: { mode: "weekly", days: [] },
  timezone: "Europe/Moscow",
  users: [{ id: "u1", fullName: "Иванов", email: "i@romashka.ru", phone: "7900" }],
  responsibles: [{ id: "s1", email: "staff@f1lab.ru", phone: "7911" }],
  clientsSideResponsibles: [{ id: "u1", email: "i@romashka.ru" }],
  servicePlans: [{ _id: "p1", approver: { _id: "u1" } }],
  apiKeys: [{ key: "hd_plaintext_legacy", keyHash: "abc", name: "AD" }],
  employees: [
    {
      _id: "u1",
      firstName: "Иван",
      lastName: "Иванов",
      email: "i@romashka.ru",
      phone: "79000000000",
      position: "Бухгалтер",
      banned: false,
    },
  ],
  addresses: [
    { key: "москва тверская 1", name: null, address: "Москва, Тверская, 1", source: "company" },
  ],
  createdBy: "s1",
  updatedBy: "s1",
});

test("without company.readLogs: exactly the card fields", () => {
  const dto = ticketCardCompany(fullCompany(), { canReadLogs: false });

  assert.deepEqual(Object.keys(dto).sort(), [
    "_id",
    "address",
    "addresses",
    "alias",
    "linkToMap",
    "location",
    "locationSettings",
    "workSchedule",
  ]);
  assert.deepEqual(dto.locationSettings, { latitude: 55.7, longitude: 37.6 });
  assert.equal(dto.addresses.length, 1);
});

test("with company.readLogs: employees carry only id and name", () => {
  const dto = ticketCardCompany(fullCompany(), { canReadLogs: true });

  assert.deepEqual(dto.employees, [
    { _id: "u1", firstName: "Иван", lastName: "Иванов" },
  ]);
});

test("keys, contacts and plans never leave, whatever the right", () => {
  for (const canReadLogs of [false, true]) {
    const wire = JSON.stringify(ticketCardCompany(fullCompany(), { canReadLogs }));
    for (const secret of [
      "hd_plaintext_legacy",
      "apiKeys",
      "i@romashka.ru",
      "staff@f1lab.ru",
      "servicePlans",
      "emailDomains",
      "79000000000",
      "fullTitle",
    ]) {
      assert.ok(!wire.includes(secret), `${secret} leaked (canReadLogs=${canReadLogs})`);
    }
  }
});

test("missing fields stay missing, no company gives an empty object", () => {
  assert.deepEqual(ticketCardCompany({ _id: "c1", alias: "Без адреса" }), {
    _id: "c1",
    alias: "Без адреса",
  });
  assert.deepEqual(ticketCardCompany(null), {});
  assert.deepEqual(ticketCardCompany(undefined, { canReadLogs: true }), {});
});

test("unpopulated or empty employee lists do not break the card", () => {
  assert.deepEqual(
    ticketCardCompany({ _id: "c1", employees: [null] }, { canReadLogs: true }).employees,
    [],
  );
  assert.deepEqual(
    ticketCardCompany({ _id: "c1" }, { canReadLogs: true }).employees,
    [],
  );
});
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test services/ticketCardCompany.test.js
```

Expected: `Error: Cannot find module './ticketCardCompany'`, `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/services/ticketCardCompany.js`:

```js
/**
 * Компания в ответе карточки заявки (`GET /tickets/:num`, controllers/ticket.js
 * `getOne`) — только то, что читают карточка и её секции: pages/Ticket/View.jsx,
 * components/Ticket/View/Sections.jsx, Company/company-links.js (такси),
 * CompanyLogs/Offcanvas.jsx (журнал входов AD).
 *
 * Раньше уходил весь документ (`company.toJSON()`): API-ключи (отпечатки, а у
 * старых ключей — сами значения), снимки контактов людей, услуги и домены — любому,
 * кто открыл заявку, включая клиента. Поля, которого нет в этом списке, карточка
 * не получает.
 */
const CARD_FIELDS = [
  "_id",
  "alias",
  "workSchedule",
  "addresses",
  "address",
  "linkToMap",
  "location",
];

/**
 * @param {object|null} company плоская компания (`toJSON()`) с посчитанными
 *   `addresses` (services/clientAddress)
 * @param {{ canReadLogs?: boolean }} options `canReadLogs` — право
 *   `company.readLogs`: только ему нужны люди компании
 */
const ticketCardCompany = (company, { canReadLogs = false } = {}) => {
  if (!company) return {};

  const dto = {};
  for (const field of CARD_FIELDS) {
    if (company[field] !== undefined) dto[field] = company[field];
  }

  // Старые координаты: такси берёт их, когда точки `location` нет
  // (Company/company-links.js). Остальное из `locationSettings` карточке не нужно
  const { latitude, longitude } = company.locationSettings ?? {};
  if (latitude !== undefined || longitude !== undefined) {
    dto.locationSettings = { latitude, longitude };
  }

  // Люди компании — только тому, кто связывает учётку AD с человеком в журнале
  // входов, и только имя: ни почты, ни телефона карточке не нужно
  if (canReadLogs) {
    dto.employees = (company.employees || [])
      .filter(Boolean)
      .map(({ _id, firstName, lastName }) => ({ _id, firstName, lastName }));
  }

  return dto;
};

module.exports = { ticketCardCompany };
```

3b. `backend/controllers/ticket.js`, the import.

Find (occurs exactly once):

```js
const { canEditChecklist } = require("@/services/ticketAccess");
```

Replace with:

```js
const { canEditChecklist } = require("@/services/ticketAccess");
const { ticketCardCompany } = require("@/services/ticketCardCompany");
```

3c. The same file, the `getOne` response (unique line 670). The `Company.findById(…)` query and
its `employees` populate at lines 546-550 stay as they are; the DTO trims the result.

Find (occurs exactly once):

```js
      company: companyObj || {},
```

Replace with:

```js
      // Только поля, которые читает карточка; люди компании — лишь тем, кто
      // видит журнал входов AD (services/ticketCardCompany)
      company: ticketCardCompany(companyObj, {
        canReadLogs: req.auth.can({ company: ["readLogs"] }),
      }),
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test services/ticketCardCompany.test.js
cd backend && node --check controllers/ticket.js
cd backend && pnpm test
```

Expected: `# tests 5`, `# pass 5`, `# fail 0`. `node --check` prints nothing. `pnpm test` ends
with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/services/ticketCardCompany.js` (new)
  - `backend/services/ticketCardCompany.test.js` (new)
  - `backend/controllers/ticket.js`

---

### Task B4: Company API keys act only within their own company

**Files:**
- Create: `backend/services/externalApi.js`
- Modify: `backend/controllers/external/ticket.js`. Replace the whole file, 219 lines: nearly
  every block changes.
- Modify: `backend/controllers/log/companyLog.js`. Replace the whole file, 74 lines.
- Test: `backend/services/externalApi.test.js`

**Interfaces:**
- Consumes:
  - `req.company = { _id, alias, fullTitle, apiKey }`, set by `middleware/isAuthApiKey.js`.
    That middleware only matches active companies, so the key's company is active.
  - `Preferences.defaultApplicant._id` and `Preferences.deadline` (hours).
  - `TicketCategory.exists`, `User.findOne` and `User.findById`.
- Produces (`services/externalApi.js`):
  - `asString(value) → string`: strings and numbers are trimmed, anything else becomes `""`;
  - `apiApplicantFilters({ companyId, userId, userEmail }) → object[]`;
  - `resolveApiApplicant({ companyId, userId, userEmail }, { findUser }) → Promise<user|null>`;
  - `resolveApiCategoryId(categoryId, { categoryExists }) → Promise<string|null>`;
  - `externalTicketDoc({ body, applicant, company, categoryId, attachments, deadlineHours, now }) → object`;
  - `externalTicketResponse({ ticket, applicant, company }) → object`;
  - `companyLogUserFilters({ companyId, activeDirectoryObjectGUID, email }) → object[]`;
  - `resolveCompanyLogUser({ companyId, activeDirectoryObjectGUID, email }, { findUser }) → Promise<user|null>`;
  - `companyLogLinkedUser(user) → { id, firstName, lastName } | null`.

Behaviour, per D3:
- **Applicant lookup:**
  - it tries `{ _id, "company._id" }` first, then
    `{ email: lower, "company._id", banned: { $ne: true } }`;
  - it falls through to the e-mail when the id finds nobody;
  - a non-string value never becomes a filter.
- **Fallback:** when nobody is found, the ticket goes from the default applicant. The ticket is
  **always in the key's company**, including in that fallback; previously it took the default
  applicant's company.
- **Ignored and validated fields:** body `responsibles` and `deadline` are ignored, so the
  deadline is always `now + Preferences.deadline` hours. `categoryId` is kept only as the id of
  an existing category.
- **Response:** it no longer contains the applicant's e-mail.
- **Error log:** it no longer contains `req.body`.
- **Company log:** the user is looked up by GUID, then by e-mail, inside `req.company` only.
  `data.linkedUser` is `{ id, firstName, lastName }`, without the e-mail.
- **Routes:** `routes/external/user.js` does not change. Multipart bodies of
  `/ticket/create` are parsed by multer inside the route, so the Task B6 guard never sees them.
  There, the string coercion above keeps operator objects out of every filter.

- [ ] **Step 1: Write the failing test.** Create `backend/services/externalApi.test.js`:

```js
// node --test services/externalApi.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const {
  apiApplicantFilters,
  asString,
  companyLogLinkedUser,
  companyLogUserFilters,
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
  resolveCompanyLogUser,
} = require("./externalApi");

/**
 * Ключ компании действует только в своей компании: люди ищутся в ней одной,
 * значения из тела — строками, ответственных и срок тело не задаёт, в ответах
 * нет почты. «База» — массив, фильтры сопоставляются по правилам Mongo (sift).
 */

const KEY_COMPANY = "66aa000000000000000000c1";
const OTHER_COMPANY = "66aa000000000000000000c2";

const users = [
  { _id: "66aa000000000000000000a1", email: "anna@romashka.ru", firstName: "Анна", lastName: "Петрова", company: { _id: KEY_COMPANY }, activeDirectoryObjectGUID: "guid-anna" },
  { _id: "66aa000000000000000000a2", email: "gone@romashka.ru", firstName: "Олег", lastName: "Уволен", company: { _id: KEY_COMPANY }, banned: true },
  { _id: "66aa000000000000000000b1", email: "boss@other.ru", firstName: "Борис", lastName: "Чужой", company: { _id: OTHER_COMPANY }, activeDirectoryObjectGUID: "guid-boss" },
  { _id: "66aa000000000000000000f1", email: "admin@f1lab.ru", firstName: "Админ", lastName: "Наш", company: { _id: "66aa000000000000000000f0" }, isEndUser: false },
];

const fakeFinder = () => {
  const seen = [];
  const findUser = async (filter) => {
    seen.push(filter);
    return users.find(sift(filter)) || null;
  };
  return { findUser, seen };
};

test("values from the body are strings; objects and arrays are dropped", () => {
  assert.equal(asString("  a@b.c "), "a@b.c");
  assert.equal(asString(42), "42");
  for (const value of [{ $ne: null }, ["a@b.c"], null, undefined, true]) {
    assert.equal(asString(value), "");
  }
});

test("applicant filters are always scoped to the key's company", () => {
  const filters = apiApplicantFilters({
    companyId: KEY_COMPANY,
    userId: "66aa000000000000000000a1",
    userEmail: " Anna@Romashka.RU ",
  });

  assert.deepEqual(filters, [
    { _id: "66aa000000000000000000a1", "company._id": KEY_COMPANY },
    { email: "anna@romashka.ru", "company._id": KEY_COMPANY, banned: { $ne: true } },
  ]);
  assert.deepEqual(apiApplicantFilters({ companyId: null, userEmail: "anna@romashka.ru" }), []);
});

test("operator objects and junk ids never become filters", () => {
  assert.deepEqual(
    apiApplicantFilters({
      companyId: KEY_COMPANY,
      userId: { $ne: null },
      userEmail: { $regex: ".*" },
    }),
    [],
  );
  assert.deepEqual(
    apiApplicantFilters({ companyId: KEY_COMPANY, userId: "not-an-id" }),
    [],
  );
});

test("an applicant is found by id or e-mail inside the key's company", async () => {
  const byId = fakeFinder();
  assert.equal(
    (await resolveApiApplicant({ companyId: KEY_COMPANY, userId: "66aa000000000000000000a1" }, byId)).firstName,
    "Анна",
  );

  const byEmail = fakeFinder();
  assert.equal(
    (await resolveApiApplicant({ companyId: KEY_COMPANY, userEmail: "ANNA@romashka.ru" }, byEmail)).firstName,
    "Анна",
  );

  // Устаревший id, верная почта — находит по почте
  const fallthrough = fakeFinder();
  const found = await resolveApiApplicant(
    { companyId: KEY_COMPANY, userId: "66aa0000000000000000dead", userEmail: "anna@romashka.ru" },
    fallthrough,
  );
  assert.equal(found.firstName, "Анна");
  assert.equal(fallthrough.seen.length, 2);
});

test("people of other companies and staff are never resolved", async () => {
  for (const request of [
    { userId: "66aa000000000000000000b1" },
    { userEmail: "boss@other.ru" },
    { userId: "66aa000000000000000000f1" },
    { userEmail: "admin@f1lab.ru" },
    { userEmail: "gone@romashka.ru" },
    { userEmail: { $ne: null } },
  ]) {
    const finder = fakeFinder();
    assert.equal(
      await resolveApiApplicant({ companyId: KEY_COMPANY, ...request }, finder),
      null,
      JSON.stringify(request),
    );
    for (const filter of finder.seen) {
      assert.equal(filter["company._id"], KEY_COMPANY);
    }
  }
});

test("category: only an existing category by a real id", async () => {
  const known = "66aa000000000000000000e1";
  const categoryExists = async (id) => (id === known ? { _id: id } : null);

  assert.equal(await resolveApiCategoryId(known, { categoryExists }), known);
  assert.equal(await resolveApiCategoryId("66aa000000000000000000e2", { categoryExists }), null);
  for (const bad of ["", "x", { $ne: null }, [known], undefined]) {
    assert.equal(await resolveApiCategoryId(bad, { categoryExists }), null);
  }
});

test("ticket fields: key company, no responsibles, deadline from settings", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const doc = externalTicketDoc({
    body: {
      title: "Не печатает принтер",
      description: "",
      responsibles: ["66aa000000000000000000f1"],
      deadline: "2020-01-01",
      customFields: [{ name: "Кабинет", value: "12" }, { value: "без имени" }],
      source: "Сайт",
    },
    applicant: { _id: "66aa000000000000000000a1", company: { _id: OTHER_COMPANY } },
    company: { _id: KEY_COMPANY, alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
    categoryId: null,
    attachments: [],
    deadlineHours: 24,
    now,
  });

  assert.deepEqual(doc.responsibles, []);
  assert.equal(doc.deadline.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.deepEqual(doc.company, { _id: KEY_COMPANY, alias: "Ромашка" });
  assert.equal(doc.categoryId, null);
  assert.deepEqual(doc.customFields, [{ name: "Кабинет", value: "12" }]);
  assert.equal(doc.source, "Сайт");
  assert.equal(doc.applicantId, "66aa000000000000000000a1");
  assert.equal(doc.createdBy, "66aa000000000000000000a1");
});

test("ticket response carries no e-mail", () => {
  const response = externalTicketResponse({
    ticket: { _id: "t1", num: 51713, title: "t", description: "", state: "Новая", createdAt: new Date(), deadline: new Date() },
    applicant: users[0],
    company: { _id: KEY_COMPANY, alias: "Ромашка" },
  });

  assert.deepEqual(response.ticket.applicant, {
    _id: "66aa000000000000000000a1",
    firstName: "Анна",
    lastName: "Петрова",
  });
  assert.doesNotMatch(JSON.stringify(response), /@/);
});

test("company log: user by GUID, then e-mail, only inside the key's company", async () => {
  assert.deepEqual(
    companyLogUserFilters({ companyId: KEY_COMPANY, activeDirectoryObjectGUID: " guid-anna ", email: "Anna@Romashka.ru" }),
    [
      { activeDirectoryObjectGUID: "guid-anna", "company._id": KEY_COMPANY },
      { email: "anna@romashka.ru", "company._id": KEY_COMPANY },
    ],
  );

  const own = await resolveCompanyLogUser(
    { companyId: KEY_COMPANY, activeDirectoryObjectGUID: "guid-anna" },
    fakeFinder(),
  );
  assert.equal(own.firstName, "Анна");

  const byEmail = await resolveCompanyLogUser(
    { companyId: KEY_COMPANY, activeDirectoryObjectGUID: "unknown-guid", email: "anna@romashka.ru" },
    fakeFinder(),
  );
  assert.equal(byEmail.firstName, "Анна");

  for (const request of [
    { activeDirectoryObjectGUID: "guid-boss" },
    { activeDirectoryObjectGUID: "x", email: "boss@other.ru" },
    { activeDirectoryObjectGUID: { $ne: null } },
  ]) {
    assert.equal(
      await resolveCompanyLogUser({ companyId: KEY_COMPANY, ...request }, fakeFinder()),
      null,
      JSON.stringify(request),
    );
  }
});

test("company log response: linked user without e-mail", () => {
  assert.deepEqual(companyLogLinkedUser(users[0]), {
    id: "66aa000000000000000000a1",
    firstName: "Анна",
    lastName: "Петрова",
  });
  assert.equal(companyLogLinkedUser(null), null);
});
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test services/externalApi.test.js
```

Expected: `Error: Cannot find module './externalApi'`, `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/services/externalApi.js`:

```js
/**
 * Внешний API по ключу компании (routes/external/user.js): заявки и журнал
 * входов AD. КЛЮЧ ДЕЙСТВУЕТ ТОЛЬКО В СВОЕЙ КОМПАНИИ (спека W1, D3).
 *
 * Ключ лежит на рабочих станциях клиента в сценариях входа AD, поэтому тело
 * запроса — чужой ввод:
 *   - люди ищутся только внутри компании ключа, а значения из тела берутся
 *     строками — объект вида `{"$ne": null}` в фильтр не попадает;
 *   - заявка ложится в компанию ключа, ответственных и срок интеграция не
 *     задаёт;
 *   - категория — только настоящая;
 *   - в ответах нет адресов почты.
 *
 * Модуль чистый: поиск в базе приходит аргументами из контроллеров
 * (controllers/external/ticket.js, controllers/log/companyLog.js).
 */

const HEX_OBJECT_ID = /^[a-f0-9]{24}$/i;
const HOUR_MS = 60 * 60 * 1000;

/** Значение из тела строкой. Не строка и не число — пустая строка. */
const asString = (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

/** Первый найденный по фильтрам в порядке очереди — или null. */
const firstMatch = async (filters, findUser) => {
  for (const filter of filters) {
    const user = await findUser(filter);
    if (user) return user;
  }
  return null;
};

/**
 * Где искать заявителя: по id, затем по почте — оба раза только в компании
 * ключа. Отключённых по почте не ищем, как и прежде.
 */
const apiApplicantFilters = ({ companyId, userId, userEmail }) => {
  if (!companyId) return [];
  const id = asString(userId);
  const email = asString(userEmail).toLowerCase();
  return [
    ...(HEX_OBJECT_ID.test(id) ? [{ _id: id, "company._id": companyId }] : []),
    ...(email
      ? [{ email, "company._id": companyId, banned: { $ne: true } }]
      : []),
  ];
};

/** Заявитель из тела или null — тогда заявка уходит от пользователя по умолчанию. */
const resolveApiApplicant = ({ companyId, userId, userEmail }, { findUser }) =>
  firstMatch(apiApplicantFilters({ companyId, userId, userEmail }), findUser);

/** Категория — только настоящий id существующей категории, иначе null. */
const resolveApiCategoryId = async (categoryId, { categoryExists }) => {
  const id = asString(categoryId);
  if (!HEX_OBJECT_ID.test(id)) return null;
  return (await categoryExists(id)) ? id : null;
};

const validCustomFields = (customFields) =>
  customFields
    ? (Array.isArray(customFields) ? customFields : [customFields]).filter(
        (field) => field && field.name,
      )
    : [];

/**
 * Поля новой заявки. Компания — всегда компания ключа: заявитель найден в ней
 * же, а пользователь по умолчанию своей компании заявке не навязывает.
 * `responsibles` и `deadline` из тела не читаются (D3): ответственных
 * назначает диспетчер, срок — настройки.
 */
const externalTicketDoc = ({
  body,
  applicant,
  company,
  categoryId,
  attachments,
  deadlineHours,
  now,
}) => ({
  title: body.title,
  description: body.description || "",
  customFields: validCustomFields(body.customFields),
  attachments,
  isClosed: false,
  categoryId: categoryId || null,
  applicantId: applicant._id,
  company: { _id: company._id, alias: company.alias },
  responsibles: [],
  deadline: new Date(now.getTime() + deadlineHours * HOUR_MS),
  state: "Новая",
  source: body.source || "Другое",
  createdBy: applicant._id,
  updatedBy: applicant._id,
  notifications: {
    lastAction: "new ticket",
    pending: true,
  },
});

/** Ответ на создание заявки: без почты заявителя. */
const externalTicketResponse = ({ ticket, applicant, company }) => ({
  success: true,
  message: "Заявка успешно создана",
  ticket: {
    _id: ticket._id,
    num: ticket.num,
    title: ticket.title,
    description: ticket.description,
    state: ticket.state,
    createdAt: ticket.createdAt,
    deadline: ticket.deadline,
    applicant: {
      _id: applicant._id,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
    },
    company: { _id: company._id, alias: company.alias },
  },
});

/** Человек записи журнала входов: по GUID, затем по почте — в компании ключа. */
const companyLogUserFilters = ({ companyId, activeDirectoryObjectGUID, email }) => {
  if (!companyId) return [];
  const guid = asString(activeDirectoryObjectGUID);
  const mail = asString(email).toLowerCase();
  return [
    ...(guid ? [{ activeDirectoryObjectGUID: guid, "company._id": companyId }] : []),
    ...(mail ? [{ email: mail, "company._id": companyId }] : []),
  ];
};

const resolveCompanyLogUser = (
  { companyId, activeDirectoryObjectGUID, email },
  { findUser },
) =>
  firstMatch(
    companyLogUserFilters({ companyId, activeDirectoryObjectGUID, email }),
    findUser,
  );

/** Связанный человек в ответе журнала: id и имя, без почты. */
const companyLogLinkedUser = (user) =>
  user
    ? { id: user._id, firstName: user.firstName, lastName: user.lastName }
    : null;

module.exports = {
  apiApplicantFilters,
  asString,
  companyLogLinkedUser,
  companyLogUserFilters,
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
  resolveCompanyLogUser,
};
```

3b. Replace the **entire contents** of `backend/controllers/external/ticket.js`. The
`Company` import goes because it is no longer used. If a logs task (spec §8, S11) has already
removed `body: req.body` from this file's error log, the result is the same.

```js
const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");
const storage = require("../../services/storage");

const Preferences = require("../../models/preferences");
const { Ticket } = require("../../models/ticket");
const User = require("../../models/user");
const TicketCategory = require("../../models/ticketCategory");
const TicketLog = require("../../models/ticketLog");
const {
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
} = require("../../services/externalApi");

/**
 * Заявка по API-ключу компании. Ключ действует только в своей компании
 * (спека W1, D3; правила — services/externalApi): заявитель ищется среди её
 * людей, заявка ложится в неё же, ответственных и срок тело не задаёт.
 */
exports.createTicket = async (req, res, next) => {
  try {
    const { company } = req; // Компания ключа — из middleware isAuthApiKey
    const { title, userId, userEmail, categoryId } = req.body;

    // Валидация обязательных полей
    if (!title) {
      return next(new AppError("Заголовок заявки обязателен", 400));
    }

    // Получаем настройки системы
    const prefs = await Preferences.findOne({});
    if (!prefs) {
      return next(new AppError("Настройки системы не найдены", 500));
    }

    // Заявитель — только из компании ключа: по id, затем по почте. Не нашёлся
    // (или он из другой компании) — заявка от пользователя по умолчанию, но
    // всё равно в компании ключа
    let applicant = await resolveApiApplicant(
      { companyId: company._id, userId, userEmail },
      { findUser: (filter) => User.findOne(filter) },
    );

    if (!applicant) {
      if (!prefs.defaultApplicant || !prefs.defaultApplicant._id) {
        return next(
          new AppError(
            "Пользователь не найден и не настроен пользователь по умолчанию",
            400,
          ),
        );
      }

      applicant = await User.findById(prefs.defaultApplicant._id);
      if (!applicant) {
        return next(
          new AppError(
            "Пользователь по умолчанию не найден в базе данных",
            500,
          ),
        );
      }
    }

    // Обработка вложений если есть
    const attachments = (req.files || []).map((file) => ({
      mimetype: file.mimetype,
      name: file.key,
    }));

    const ticket = new Ticket(
      externalTicketDoc({
        body: req.body,
        applicant,
        company,
        categoryId: await resolveApiCategoryId(categoryId, {
          categoryExists: (id) => TicketCategory.exists({ _id: id }),
        }),
        attachments,
        deadlineHours: prefs.deadline,
        now: new Date(),
      }),
    );

    await ticket.save();

    // Добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
      },
      severity: "info",
      event: "создана новая заявка через внешний API",
    });
    await logEntry.save();

    logger.log("info", `Создана заявка через внешний API: ${ticket.num}`, {
      ticketId: ticket._id,
      ticketNum: ticket.num,
      companyId: company._id,
      companyAlias: company.alias,
      applicantId: applicant._id,
      applicantEmail: applicant.email,
    });

    res
      .status(201)
      .json(externalTicketResponse({ ticket, applicant, company }));
  } catch (error) {
    // Тело запроса в журнал не пишется: в нём текст обращения и адреса людей
    logger.log("error", "Ошибка при создании заявки через внешний API", {
      error: error.message,
      stack: error.stack,
      companyId: req.company?._id,
    });

    // Удаляем загруженные файлы в случае ошибки
    if (req.files) {
      for (let file of req.files) {
        storage.deleteObject(file.key).catch((unlinkError) =>
          logger.log("error", "Ошибка при удалении файла", {
            error: unlinkError.message,
            key: file.key,
          }),
        );
      }
    }

    next(new AppError("Ошибка при создании заявки", 500, true, error));
  }
};
```

3c. Replace the **entire contents** of `backend/controllers/log/companyLog.js`:

```js
const User = require("@/models/user");
const CompanyLog = require("@/models/companyLog");
const { AppError } = require("@/middleware/errorHandling");
const {
  asString,
  companyLogLinkedUser,
  resolveCompanyLogUser,
} = require("@/services/externalApi");

/**
 * Вход в домен от AD-агента клиента (ключ компании). Человек связывается
 * только внутри компании ключа (services/externalApi): чужой GUID или адрес
 * не связывается и в ответе не называется.
 */
exports.addUserActivity = async (req, res, next) => {
  try {
    const { company } = req;
    const { firstName, lastName, email, action = "userLogin" } = req.body;
    // Строками: объект из тела ни в фильтр, ни в запись не попадает
    const activeDirectoryObjectGUID = asString(
      req.body.activeDirectoryObjectGUID,
    );
    const activeDirectoryLogin = asString(req.body.activeDirectoryLogin);
    const computerName = asString(req.body.computerName);

    if (!activeDirectoryObjectGUID || !activeDirectoryLogin) {
      return next(
        new AppError(
          "Отсутствуют обязательные поля: activeDirectoryObjectGUID, activeDirectoryLogin",
          400,
        ),
      );
    }

    // Сначала по GUID, потом по почте — оба раза в компании ключа
    const linkedUser = await resolveCompanyLogUser(
      { companyId: company._id, activeDirectoryObjectGUID, email },
      {
        findUser: (filter) =>
          User.findOne(filter).select("firstName lastName"),
      },
    );

    // Создаем запись лога
    const logEntry = new CompanyLog({
      companyId: company._id,
      userId: linkedUser ? linkedUser._id : null,
      activeDirectoryObjectGUID,
      activeDirectoryLogin,
      firstName: firstName ? String(firstName).trim() : undefined,
      lastName: lastName ? String(lastName).trim() : undefined,
      computerName: computerName || undefined,
      action,
    });

    await logEntry.save();

    res.status(201).json({
      success: true,
      message: "Лог активности пользователя записан",
      data: {
        id: logEntry._id,
        action: logEntry.action,
        user: {
          activeDirectoryLogin: logEntry.activeDirectoryLogin,
        },
        linkedUser: companyLogLinkedUser(linkedUser),
      },
    });
  } catch (error) {
    next(new AppError("Ошибка записи лога активности", 500, true, error));
  }
};
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test services/externalApi.test.js
cd backend && node --check controllers/external/ticket.js && node --check controllers/log/companyLog.js
cd backend && ! grep -nE "responsibles: responsibles|new Date\(deadline\)|email: applicant\.email|email: linkedUser\.email" controllers/external/ticket.js controllers/log/companyLog.js
cd backend && ! grep -A6 'logger.log("error"' controllers/external/ticket.js | grep -n "req.body"
cd backend && pnpm test
```

Expected:
- the first command prints `# tests 10`, `# pass 10`, `# fail 0`;
- `node --check` prints nothing;
- both `grep` checks find nothing and exit with 0. The second one looks only at the error-log
  calls, because the new `externalTicketDoc({ body: req.body, … })` call legitimately contains
  `body: req.body`;
- `pnpm test` ends with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/services/externalApi.js` (new)
  - `backend/services/externalApi.test.js` (new)
  - `backend/controllers/external/ticket.js`
  - `backend/controllers/log/companyLog.js`

---

### Task B5: Body limits by route class

**Files:**
- Create: `backend/middleware/bodyParsers.js`
- Modify: `backend/app.js`, lines 116-118: the `// Body parsing with size limits` comment and
  the two `app.use(express.… "50mb")` lines, which sit right after
  `app.all("/api/auth/*splat", authRequestHandler);` at line 114.
- Test: `backend/middleware/bodyParsers.test.js`

**Interfaces:**
- Consumes: `express.json` and `express.urlencoded` (body-parser 2.2.0).
- Produces (`middleware/bodyParsers.js`):
  - `BODY_LIMITS`: `{ anonymous: "100kb", editor: "50mb", default: "10mb" }`;
  - `ANONYMOUS_BODY_PATHS`: `/api/login`, `/api/login-code`, `/api/password`,
    `/api/impersonate/claim`, `/api/external/approval`. These are prefixes. `/api/login` also
    covers `/login/two-factor`; Express path matching doesn't let it catch `/login-code`.
  - `EDITOR_BODY_PATHS`: the six add and update paths listed in the facts above;
  - `mountBodyParsers(app)`: the anonymous parsers first, then the editor ones, then the global
    10 MB pair.
- Does not touch `middleware/fileUpload.js`: multer `fieldSize` belongs to another section.

- [ ] **Step 1: Write the failing test.** Create `backend/middleware/bodyParsers.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test middleware/bodyParsers.test.js
```

Expected: `Error: Cannot find module './bodyParsers'`, `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/middleware/bodyParsers.js`:

```js
const express = require("express");

/**
 * Разбор тела запроса — с лимитом по классу маршрута (спека W1, D5).
 *
 * Раньше JSON и формы до 50 МБ принимались на ЛЮБОМ пути, включая ручки без
 * сеанса: тело разбирается до авторизации, и анонимный запрос на вход держал
 * память и процессор под пятьдесят мегабайт. Теперь:
 *   - ручки без сеанса (вход, код из письма, проверка пароля, обмен кода
 *     подмены, согласование по ссылке) — 100 КБ;
 *   - сохранение из редакторов, в чьём JSON едут картинки (заметка базы
 *     знаний, шаблон заявки, регламент: Toast UI вставляет картинку
 *     data:-ссылкой) — 50 МБ, как было;
 *   - всё остальное — 10 МБ. Файлы идут multipart'ом через multer, у него
 *     свои лимиты (middleware/fileUpload.js).
 *
 * ПОРЯДОК ВАЖЕН. body-parser не читает тело второй раз: поток уже вычитан
 * (`isFinished(req)`), и следующий парсер запрос пропускает. Поэтому парсеры
 * конкретных путей стоят ДО общего, и общий их тела не трогает. А всё вместе —
 * ПОСЛЕ better-auth (app.js): тот читает сырое тело сам.
 */

const BODY_LIMITS = Object.freeze({
  anonymous: "100kb",
  editor: "50mb",
  default: "10mb",
});

/**
 * Ручки без сеанса. Это префиксы: `/api/login` накрывает и
 * `/api/login/two-factor` (но не `/api/login-code`), `/api/login-code` —
 * `/verify` и `/password`, `/api/password` — `/check`.
 */
const ANONYMOUS_BODY_PATHS = Object.freeze([
  "/api/login",
  "/api/login-code",
  "/api/password",
  "/api/impersonate/claim",
  "/api/external/approval",
]);

/** Сохранение из редакторов с картинками внутри текста. */
const EDITOR_BODY_PATHS = Object.freeze([
  "/api/knowledge-notes/add",
  "/api/knowledge-notes/update/:id",
  "/api/ticket-templates/add",
  "/api/ticket-templates/update/:id",
  "/api/routine-tasks/add",
  "/api/routine-tasks/update/:id",
]);

const parsers = (limit) => [
  express.json({ limit }),
  express.urlencoded({ extended: true, limit }),
];

/** Вешает парсеры на приложение — в том месте цепочки, где вызван. */
const mountBodyParsers = (app) => {
  app.use(ANONYMOUS_BODY_PATHS, ...parsers(BODY_LIMITS.anonymous));
  app.use(EDITOR_BODY_PATHS, ...parsers(BODY_LIMITS.editor));
  app.use(...parsers(BODY_LIMITS.default));
};

module.exports = {
  ANONYMOUS_BODY_PATHS,
  BODY_LIMITS,
  EDITOR_BODY_PATHS,
  mountBodyParsers,
};
```

3b. `backend/app.js`. Mount the parsers in the same place, after better-auth and before
everything else. The `require` is inline, as with `./middleware/cors`, so the top of the file
isn't touched; other sections add their own imports there.

Find (occurs exactly once):

```js
// Body parsing with size limits
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
```

Replace with:

```js
// Разбор тела — с лимитом по классу маршрута: анонимные ручки 100 КБ,
// редакторы с картинками 50 МБ, остальное 10 МБ (middleware/bodyParsers.js).
// Строго ПОСЛЕ better-auth выше: тот читает сырое тело сам.
require("./middleware/bodyParsers").mountBodyParsers(app);
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test middleware/bodyParsers.test.js
cd backend && node --check app.js && ! grep -n 'limit: "50mb"' app.js
cd backend && pnpm test
```

Expected:
- the first command prints `# tests 4`, `# pass 4`, `# fail 0`; it takes about 3-4 s, because
  it posts bodies of several megabytes;
- the second prints nothing and exits with 0;
- `pnpm test` ends with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/middleware/bodyParsers.js` (new)
  - `backend/middleware/bodyParsers.test.js` (new)
  - `backend/app.js`

---

### Task B6: `rejectOperatorKeys` on the anonymous endpoints and the external API

**Files:**
- Create: `backend/middleware/rejectOperatorKeys.js`
- Modify: `backend/app.js`: add the guard right after line 179,
  `app.use(require("./middleware/cors"));`, and before `app.use("/api", internal);`.
- Test: `backend/middleware/rejectOperatorKeys.test.js`

**Interfaces:**
- Consumes: a parsed `req.body`. Line 179 comes after the parsers, both before and after
  Task B5, so this task doesn't depend on B5's edit. Placing the guard after `cors` lets its
  400 carry the CORS headers in dev.
- Produces (`middleware/rejectOperatorKeys.js`):
  - `OPERATOR_GUARD_PATHS`: `/api/external`, `/api/login`, `/api/login-code`, `/api/password`,
    `/api/impersonate/claim`;
  - `findOperatorKey(body) → string|null`: an iterative walk, so deep nesting can't overflow the
    stack;
  - `rejectOperatorKeys(req, res, next)`: answers 400
    `{ error: true, status: 400, code: "ERR_400", message }`.
- Values are not inspected: a password `$ecret` and an address `a.b@c.d` pass. The guard is not
  global yet; that waits for W5.

- [ ] **Step 1: Write the failing test.** Create `backend/middleware/rejectOperatorKeys.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails.**

```bash
cd backend && node --test middleware/rejectOperatorKeys.test.js
```

Expected: `Error: Cannot find module './rejectOperatorKeys'`, `# fail 1`.

- [ ] **Step 3: Implement.**

3a. Create `backend/middleware/rejectOperatorKeys.js`:

```js
/**
 * Ключи-операторы Mongo в теле запроса — сразу 400 (спека W1, §4).
 *
 * `{"email": {"$ne": null}}` вместо адреса превращает поиск «пользователь с
 * этим адресом» в «любой пользователь»; ключ с точкой (`"company._id"`) —
 * тот же приём через путь к вложенному полю. Легальному телу ни то ни другое
 * не нужно: имена полей у нас без `$` и без точек. Значения не проверяются —
 * пароль `$ecret` и адрес `a.b@c.d` проходят.
 *
 * Где стоит — OPERATOR_GUARD_PATHS (app.js, после разбора тела): внешний API
 * и ручки без сеанса, где тело пишет кто угодно. Глобально — в W5, после
 * ревизии остальных маршрутов. Multipart разбирает multer уже в маршруте, туда
 * этот слой не достаёт: внешняя заявка приводит значения к строкам сама
 * (services/externalApi).
 *
 * Отказ отвечается здесь же, формой общего обработчика, а не через
 * `next(AppError)`: тот после ответа зовёт `next(error)`, и finalhandler рвёт
 * соединение (см. middleware/requireMcpKey.js).
 *
 * Обход — стеком, не рекурсией: вложенность тела ограничена только размером,
 * и рекурсия по ста килобайтам скобок упёрлась бы в стек.
 */

const OPERATOR_GUARD_PATHS = Object.freeze([
  "/api/external",
  "/api/login",
  "/api/login-code",
  "/api/password",
  "/api/impersonate/claim",
]);

const isOperatorKey = (key) => key.startsWith("$") || key.includes(".");

/** Первый ключ-оператор на любой глубине или null. */
const findOperatorKey = (body) => {
  const stack = [body];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (isOperatorKey(key)) return key;
      stack.push(value[key]);
    }
  }
  return null;
};

const rejectOperatorKeys = (req, res, next) => {
  const key = findOperatorKey(req.body);
  if (key === null) return next();
  return res.status(400).json({
    error: true,
    status: 400,
    code: "ERR_400",
    message: `Недопустимое имя поля «${key.slice(0, 64)}»: ключи с «$» и «.» не принимаются`,
  });
};

module.exports = { OPERATOR_GUARD_PATHS, findOperatorKey, rejectOperatorKeys };
```

3b. `backend/app.js`:

Find (occurs exactly once):

```js
app.use(require("./middleware/cors"));
```

Replace with:

```js
app.use(require("./middleware/cors"));

// Ключи-операторы Mongo (`$…`, с точкой) в теле внешнего API и ручек без
// сеанса — сразу 400 (middleware/rejectOperatorKeys.js). Стоит после разбора
// тела; глобально — после ревизии остальных маршрутов (W5).
const {
  OPERATOR_GUARD_PATHS,
  rejectOperatorKeys,
} = require("./middleware/rejectOperatorKeys");
app.use(OPERATOR_GUARD_PATHS, rejectOperatorKeys);
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
cd backend && node --test middleware/rejectOperatorKeys.test.js
cd backend && node --check app.js
cd backend && pnpm test
```

Expected: `# tests 7`, `# pass 7`, `# fail 0`. `node --check` prints nothing. `pnpm test` ends
with `# fail 0`.

- [ ] **Step 5: Leave uncommitted.** Changed files:
  - `backend/middleware/rejectOperatorKeys.js` (new)
  - `backend/middleware/rejectOperatorKeys.test.js` (new)
  - `backend/app.js`

---

### Section B notes

**`backend/app.js` touch points.** Section B edits only these two spots. It does not touch the
top-of-file imports, the better-auth mount (lines 109-114, where another section puts its
allow-list), or the cron and shutdown code from line 197 on.

| Task | Where | Change |
|---|---|---|
| B5 | Lines 116-118 | The three body-parsing lines become one inline `mountBodyParsers(app)` call |
| B6 | After line 179 (`cors`) | An inline `require` plus `app.use(OPERATOR_GUARD_PATHS, rejectOperatorKeys)` |

**Coordination:**
- **External ticket error log.** Spec §8 (S11) also lists removing `body: req.body` from the
  external ticket error log. Task B4 does it as part of replacing the whole file, so the logs
  task should skip that file.
- **`fieldSize`.** Multer `fieldSize` (D5) is not in this section.

**Rollout notes (spec, "Behaviour changes"):**
- **Integrations.** They can't set `responsibles` or `deadline`. An unknown or foreign
  applicant becomes the default applicant, in the key's company. An invalid `categoryId` is
  dropped.
- **API responses.** The ticket response has no applicant e-mail, and `linkedUser` has no e-mail.
- **Approval actions** return `{ ok, id }`.
- **Refusals.** An oversized body gets 413 (100 KB anonymous, 50 MB editor saves, 10 MB
  elsewhere). Operator keys on the guarded paths get 400.

**Resolved ambiguities:**
- **Ticket company in the API fallback.** It is always the key's company. The code today takes
  the default applicant's company, and the spec's "the key's company plus the default applicant"
  settles it.
- **Applicant lookup with both `userId` and `userEmail`.** Both are scoped. The id is tried
  first; if it finds nobody, the e-mail is tried. Today the e-mail is ignored whenever a
  `userId` is sent.
- **`locationSettings` in the card DTO.** It is added as `{ latitude, longitude }`, because the
  taxi helper reads it. The spec's list missed it.
- **Company-log response.** `linkedUser` drops `email`: the audit's "strip PII from the
  response", applied the same way as for tickets.
- **Scope of `getUserTech`.** The whole "own" query is ANDed, the personal branch included, as
  the spec's "both device queries" says. See the owner note in Task B1.
- **Editor 50 MB limit.** It applies to the six add and update paths, not to the whole prefixes.
- **Multipart and the guard.** Multipart bodies aren't checked by `rejectOperatorKeys`: multer
  runs inside the route, and a rejection after multer would orphan the uploads. They are
  covered by the Task B4 coercion instead.

**Not covered, flagged for the owner.** better-auth reads `/api/auth/*` bodies itself.
`toNodeHandler` (better-call 1.3.7, `adapters/node/request.mjs`) passes no `bodySizeLimit`, so
anonymous `reset-password` and `sign-in/magic-link` bodies are unbounded. D5 didn't list them.
A candidate for Section A or W5.

## Section C — Inbound e-mail

Implements spec §5 (S3 and the related defects: display-name spoofing, silently dropped mail
for a missing ticket number, List-* detection that never fires, no Message-ID dedup). The
coordinator's decisions of 2026-09-30 are included.

- **D1.** A reply that doesn't come from someone on the ticket, or fails the sender check,
  becomes a normal new ticket whose description starts with one line naming #N and the reason.
- **Robot mail** (auto-reply, bounce, list) that isn't let in never creates a ticket. It leaves
  one log line on #N with the sender's address only; when #N doesn't exist, only the server
  log.
- **A failed sender check** (DMARC) never identifies an applicant: such a new ticket comes from
  the default applicant. Company identification by domain is unchanged.
- **`realSender`** is built from the parsed `From`, so the shown address is always the real one.

**Shape of the change.** Every per-message decision becomes a pure function under
`backend/services/` with its own `node:test` file; `backend/middleware/emailHandling.js` only
wires them in (Task C6 shows every edit exactly).

| Task | What | Files |
|---|---|---|
| C1 | One subject prefix, strict tag parser, 14 producers use it | `services/emailReplyStripper.js`, `middleware/notifications.js` |
| C2 | `parseAuthResults`, `routeReply`, reroute note, robot log line, `planReply` | new `services/mail/replyRouting.js` |
| C3 | Sender address and `realSender`, company-domain filter, applicant gate, envelope, repeat lookup | new `services/mail/inbound.js` |
| C4 | List-* detection reads mailparser's folded `list` key | `services/machineMail.js` |
| C5 | `emailMessageId` + sparse index on `Ticket` and `Comment` | `models/ticket.js`, `models/comment.js` |
| C6 | Wiring in the IMAP handler (+ the new-ticket log name fix), UX guide + changelog | `middleware/emailHandling.js`, `docs/ux-ui-guide.md`, `docs/ux-ui-changelog.md` |

Order: C1–C5 are independent of each other except that C5's test imports C2; C6 needs all of
them. All paths below are relative to the repo root; commands run from `backend/`.

Expected results quote the runner's summary lines: `pass N` / `fail N` print as `ℹ pass N` in
a terminal and as `# pass N` when piped (TAP). A test file that fails to load counts as one
failed test.

**Decisions taken while planning (spec-compatible, listed for review):**

- **Company domain match** uses an anchored, escaped, case-insensitive regex
  (`^client\.ru$`/i) instead of normalising `Company.emailDomains`:
  - there is no data migration;
  - the company collection is small, and `emailDomains` has no index, so the old exact `$in`
    was a collection scan too.

  An empty domain yields `{ emailDomains: { $in: [] } }`, which matches nothing.
- **`routeReply` keeps the spec's signature** (`"comment" | "newTicket"`). The reason line comes
  from `rerouteNote`, which checks in the same order: no ticket → sender check failed → not a
  participant. When both "fail" and "not a participant" hold, the note names the failed check.
- **`planReply`** wraps `routeReply` and returns one of four actions:
  - `comment`;
  - `autoReplyLog` — today's rule: a participant's robot replying to a *closed* ticket leaves a
    log line only;
  - `logOnly` — robot mail (`fromMachine`) that `routeReply` sends to `newTicket`: a bounce such
    as `Undeliverable: [F1-HD-N] …`, or an out-of-office from a forwarding address. It creates
    no ticket. The TicketLog event on #N carries only the sender address:
    «автоответ от {address} не принят: отправитель не участвует в заявке» or «… не принят: не
    прошёл проверку отправителя». With no #N, `note` is `null` and only the server log line
    remains;
  - `newTicket` — with the reroute note.
- **Applicant gate.** `mayIdentifyApplicant({ identifyApplicant, authVerdict })` is false for
  `authVerdict === "fail"`, on every new-ticket path (plain intake and rerouted replies). Both
  the address and the phone lookup are skipped, and the ticket stays with the default applicant.
  A forged mail therefore can't open a ticket in a client's name and have notifications mailed
  to that client. The company block (domain, then phone) is untouched.
- **Only `fail` has an effect.** A forged `pass` behaves exactly like `none`, both for routing
  and for the applicant gate, so trusting the topmost `Authentication-Results` can't be abused. The parser splits on `;` and reads the result at
  the start of each part, deliberately without quote/comment parsing, so an unbalanced `"` or
  `(` in sender-controlled text (`smtp.mailfrom`) can't swallow a following `dmarc=fail`.
  Residual risk, per spec: a domain without DMARC whose `From` is forged gets `none`, and the
  participant check alone decides.
- **Dedup** runs once per message before anything is created and checks both collections, so it
  also covers two copies in the same IMAP batch. When the earlier copy became a comment, the
  duplicate branch also runs `$addToSet` of that comment into its ticket's `comments`. This is
  a no-op normally; it repairs the one failure mode that dedup would otherwise make permanent
  (comment saved, `$push` lost → invisible in the card).
- **The note is an HTML paragraph** (`<p>…</p>` then the mail text): `Ticket.description` is an
  HTML string (the card renders it with `dangerouslySetInnerHTML`; Telegram goes through
  `htmlToPlainLines`, which turns `</p>` into a line break). `htmlDescription` stays the
  untouched original ("Оригинал письма").
- **Staff** means `isEndUser === false` exactly; a legacy account without the flag counts as a
  client. A legacy ticket without `applicantId` falls back to `applicant._id`, as the model's own
  `touchApplicantActivity` hook does. Banned users are not treated specially (the spec doesn't
  ask for it, and today's reply path doesn't either).
- **`realSender`** comes from `senderLine(mail)`: `"Name <address>"` when there is a name, else
  the bare address.
  - A display name containing `@` is dropped, so the first address-like substring (what the
    frontend `util/mail-sender.js#parseMailSender` shows) is always the parsed address.
  - For the same reason the existing closed-ticket auto-reply log line now uses the address
    instead of the raw `From` text.
  - The raw text (`email.from`) survives only in the server log context.

---

### Task C1: One subject prefix, a strict tag parser, and all 14 producers on it

Today `ticketNumFromSubject` matches any `-<anything>]` (`/-([^\]-]+)\]/`), so `"[JIRA-123] build"`
→ 123, `"Счёт [PO-50123]"` → 50123, `"[F1-HD-0x1F]"` → 31 and `"[ABC-1e3]"` → 1000. The prefix
`F1-HD` is hard-coded in 14 subjects in `middleware/notifications.js`.

**Files:**
- Modify: `backend/services/emailReplyStripper.js` (anchor: the `TICKET_SUBJECT_RE` doc comment,
  regex and `ticketNumFromSubject`, lines 13–35; `module.exports`, line 114)
- Modify: `backend/middleware/notifications.js` (anchor: the import block, line 18; the 14
  `title:` template literals at lines 489, 536, 651, 744, 853, 994, 1056, 1246, 1293, 1459,
  1506, 1627, 1855, 1896)
- Test: `backend/services/emailReplyStripper.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces (from `backend/services/emailReplyStripper.js`):
  - `TICKET_SUBJECT_PREFIX` — `"F1-HD"`, the single source of the prefix (W2 turns it into a
    setting);
  - `ticketSubjectTag(num: number): string` — `"[F1-HD-<num>]"`;
  - `ticketNumFromSubject(subject: string): number | null` — the same name as today, now strict:
    only `[F1-HD-<digits>]`, first tag wins, and it must be a safe integer.
  - `services/mail/outbox.js#textBody` keeps importing `ticketNumFromSubject`; its reply
    marker now follows the strict parser, which is still true for all 14 ticket subjects.

- [ ] **Step 1: Write the failing test**

Create `backend/services/emailReplyStripper.test.js`:

```js
// node --test services/emailReplyStripper.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TICKET_SUBJECT_PREFIX,
  ticketSubjectTag,
  ticketNumFromSubject,
} = require("./emailReplyStripper");

test("the tag is built from the one prefix and parses back", () => {
  assert.equal(TICKET_SUBJECT_PREFIX, "F1-HD");
  assert.equal(ticketSubjectTag(51713), "[F1-HD-51713]");
  assert.equal(
    ticketNumFromSubject(
      `${ticketSubjectTag(51713)} Новый комментарий к Заявке 51713`,
    ),
    51713,
  );
});

test("replies and forwards keep the ticket number", () => {
  assert.equal(ticketNumFromSubject("Re: [F1-HD-45926] x"), 45926);
  assert.equal(
    ticketNumFromSubject("RE: Fwd: [F1-HD-57056] Не удаётся сформировать отчёт"),
    57056,
  );
  assert.equal(ticketNumFromSubject("[F1-HD-45926]"), 45926);
});

test("the first tag wins", () => {
  // Новая заявка из не принятого ответа хранит его тему — старая метка
  // стоит в уведомлениях после её собственной
  assert.equal(
    ticketNumFromSubject(
      "[F1-HD-60001] Заявка 60001 принята в работу. Re: [F1-HD-45926] x",
    ),
    60001,
  );
});

test("foreign tags and malformed numbers address no ticket", () => {
  for (const subject of [
    // прежний разбор брал любое «-<что угодно>]»: 123, 50123, 1000, 31
    "[JIRA-123] build",
    "Счёт [PO-50123]",
    "[ABC-1e3]",
    "[F1-HD-0x1F]",
    "[F1-HD-1e3]",
    "[F1-HD-]",
    "[F1-HD- 12]",
    "[F1-HD-12 ]",
    "[F1-HD-12a]",
    "[F1-HD--12]",
    "[f1-hd-12]",
    "F1-HD-12",
    "[XF1-HD-12]",
    "[F1-HD-99999999999999999999]",
    "",
    null,
    undefined,
  ]) {
    assert.equal(ticketNumFromSubject(subject), null, String(subject));
  }
});

test("ticket notifications take their tag from ticketSubjectTag", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../middleware/notifications.js"),
    "utf8",
  );
  // Префикс станет настройкой (W2): зашитая в тему метка отстала бы от разбора
  assert.equal(source.includes("F1-HD"), false);
  assert.match(source, /ticketSubjectTag\(ticket\.num\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/emailReplyStripper.test.js`

Expected: 3 of 5 tests fail:
- "the tag is built…": `undefined !== 'F1-HD'`;
- "foreign tags…": `123 !== null` for `[JIRA-123] build`;
- "ticket notifications…": `true !== false`.

- [ ] **Step 3: Implement**

3a. In `backend/services/emailReplyStripper.js` replace this block (lines 13–35):

```js
/**
 * Тема письма, адресующего заявку: `[F1-HD-51713] Новый комментарий…`. По этому
 * номеру входящий разборщик (middleware/emailHandling) кладёт ответ
 * комментарием в заявку — а не заводит новую.
 *
 * Разбор темы живёт здесь, рядом с маркером, по той же причине, по которой
 * маркер импортируется отправщиком, а не пишется рядом: отправщик ставит
 * служебную строку «пишите ответ выше» ровно тем письмам, ответ на которые
 * действительно вернётся в заявку. Проверка вместо договорённости.
 */
const TICKET_SUBJECT_RE = /-([^\]-]+)\]/;

/**
 * Номер заявки из темы письма; null — тема заявку не адресует.
 * @param {string} subject
 * @returns {number|null}
 */
const ticketNumFromSubject = (subject) => {
  const match = TICKET_SUBJECT_RE.exec(subject || "");
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isNaN(num) ? null : num;
};
```

with:

```js
/**
 * Тема письма, адресующего заявку: `[F1-HD-51713] Новый комментарий…`. По этому
 * номеру входящий разборщик (middleware/emailHandling) узнаёт ответ в заявку;
 * станет ли он комментарием, решает services/mail/replyRouting.
 *
 * Префикс один на всё приложение: метку ставят все уведомления по заявкам
 * (middleware/notifications, через ticketSubjectTag), и только её принимает
 * разбор. Чужие метки — `[JIRA-123] build`, «Счёт [PO-50123]» — заявку не
 * адресуют: прежний разбор брал любое «-<что угодно>]», и такое письмо
 * ложилось комментарием в заявку с тем же номером. Префикс станет настройкой
 * (W2), поэтому в выражение он попадает экранированным.
 *
 * Разбор темы живёт здесь, рядом с маркером, по той же причине, по которой
 * маркер импортируется отправщиком, а не пишется рядом: отправщик ставит
 * служебную строку «пишите ответ выше» ровно тем письмам, ответ на которые
 * действительно вернётся в заявку. Проверка вместо договорённости.
 */
const TICKET_SUBJECT_PREFIX = "F1-HD";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Только `[F1-HD-<цифры>]`: без знака, пробелов, 0x и экспоненты
const TICKET_SUBJECT_RE = new RegExp(
  `\\[${escapeRegExp(TICKET_SUBJECT_PREFIX)}-(\\d+)\\]`,
);

/**
 * Метка заявки для темы уведомления: `[F1-HD-51713]`.
 * @param {number} num номер заявки
 * @returns {string}
 */
const ticketSubjectTag = (num) => `[${TICKET_SUBJECT_PREFIX}-${num}]`;

/**
 * Номер заявки из темы письма; null — тема заявку не адресует. Меток
 * несколько — решает первая: новая заявка из не принятого ответа хранит его
 * тему, и её собственная метка в уведомлениях стоит раньше.
 * @param {string} subject
 * @returns {number|null}
 */
const ticketNumFromSubject = (subject) => {
  const match = TICKET_SUBJECT_RE.exec(subject || "");
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isSafeInteger(num) ? num : null;
};
```

3b. In the same file replace the last line (line 114):

```js
module.exports = { stripQuotedReply, REPLY_MARKER, ticketNumFromSubject };
```

with:

```js
module.exports = {
  stripQuotedReply,
  REPLY_MARKER,
  TICKET_SUBJECT_PREFIX,
  ticketSubjectTag,
  ticketNumFromSubject,
};
```

3c. In `backend/middleware/notifications.js` replace (line 18):

```js
const { formatPhone } = require("../services/phone");
```

with:

```js
const { formatPhone } = require("../services/phone");
const { ticketSubjectTag } = require("../services/emailReplyStripper");
```

3d. In `backend/middleware/notifications.js` replace **all 14** occurrences (Edit with
`replace_all: true`) of

```text
[F1-HD-${ticket.num}]
```

with

```text
${ticketSubjectTag(ticket.num)}
```

For example, line 489 `` title: `[F1-HD-${ticket.num}] Создана новая Заявка`, `` becomes
`` title: `${ticketSubjectTag(ticket.num)} Создана новая Заявка`, ``. Every occurrence is inside
a template literal and uses the variable `ticket`, so the replacement is mechanical.

- [ ] **Step 4: Run tests to verify they pass**

Run:
- `cd backend && node --test services/emailReplyStripper.test.js`
- `grep -c 'ticketSubjectTag(ticket.num)' middleware/notifications.js`
- `node --check middleware/notifications.js`

Expected:
- the test file: `pass 5`, `fail 0`;
- the grep: `14`;
- `node --check`: no output.

- [ ] **Step 5: Leave uncommitted**

Changed:
- `backend/services/emailReplyStripper.js`
- `backend/middleware/notifications.js`

New:
- `backend/services/emailReplyStripper.test.js`

No commit.

---

### Task C2: Reply routing — sender check, participant check, the note

**Files:**
- Create: `backend/services/mail/replyRouting.js`
- Test: `backend/services/mail/replyRouting.test.js` (new)

**Interfaces:**
- Consumes: nothing (pure). The test uses `mongoose.Types.ObjectId` only to build ids.
- Produces (from `backend/services/mail/replyRouting.js`):
  - `parseAuthResults(value: string | string[] | undefined): "pass" | "fail" | "none"`;
  - `isTicketParticipant(ticket, user): boolean`;
  - `routeReply({ ticket, sender, authVerdict }): "comment" | "newTicket"`;
  - `rerouteNote({ ticketNum, ticket, authVerdict }): string`;
  - `withRerouteNote(description: string | undefined, note: string | null): string | undefined`;
  - `rejectedAutoReplyEvent({ fromAddress, authVerdict }): string` — the TicketLog event for a
    robot that wasn't let in;
  - `planReply({ ticketNum, ticket, sender, authVerdict, fromMachine, fromAddress })`:
    `{ action: "comment" | "autoReplyLog" | "logOnly" | "newTicket", note: string | null }`.
    For `newTicket`, `note` is the description's first line. For `logOnly`, it is the TicketLog
    event on #N, or `null` when #N doesn't exist.

- [ ] **Step 1: Write the failing test**

Create `backend/services/mail/replyRouting.test.js`:

```js
// node --test services/mail/replyRouting.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");

const {
  parseAuthResults,
  isTicketParticipant,
  routeReply,
  rerouteNote,
  withRerouteNote,
  rejectedAutoReplyEvent,
  planReply,
} = require("./replyRouting");
const { classify } = require("../ticketEvents");

// Заголовок так, как его отдаёт mailparser: свёрнутые строки уже склеены
const MX = "mx.f1lab.ru";

test("auth: a DMARC failure fails whatever else passed", () => {
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom=evil.com; dkim=pass header.d=evil.com; dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=client.ru`,
    ),
    "fail",
  );
});

test("auth: an SPF failure fails unless DKIM passed", () => {
  assert.equal(
    parseAuthResults(`${MX}; spf=fail smtp.mailfrom=client.ru; dkim=none`),
    "fail",
  );
  assert.equal(
    parseAuthResults(
      `${MX}; spf=fail smtp.mailfrom=client.ru; dkim=pass header.d=client.ru`,
    ),
    "pass",
  );
});

test("auth: DMARC or DKIM pass is a pass, SPF alone is not", () => {
  assert.equal(parseAuthResults(`${MX}; dmarc=pass header.from=client.ru`), "pass");
  assert.equal(parseAuthResults(`${MX}; dkim=pass header.d=client.ru`), "pass");
  assert.equal(parseAuthResults(`${MX}; spf=pass smtp.mailfrom=client.ru`), "none");
});

test("auth: soft and neutral results decide nothing", () => {
  for (const header of [
    `${MX}; spf=softfail smtp.mailfrom=client.ru; dkim=none; dmarc=none`,
    `${MX}; spf=neutral smtp.mailfrom=client.ru`,
    `${MX}; spf=temperror; dkim=permerror`,
    `${MX}; dmarc=bestguesspass header.from=client.ru`,
  ]) {
    assert.equal(parseAuthResults(header), "none", header);
  }
});

test("auth: a missing or unparseable header is none", () => {
  for (const value of [undefined, null, "", "garbage", `${MX}; none`, 42, {}, []]) {
    assert.equal(parseAuthResults(value), "none", String(value));
  }
});

test("auth: only the topmost header counts", () => {
  // Верхний ставит наш сервер; нижние приехали вместе с письмом
  assert.equal(
    parseAuthResults([
      `${MX}; dmarc=fail header.from=client.ru`,
      "evil.com; dmarc=pass",
    ]),
    "fail",
  );
  assert.equal(
    parseAuthResults([
      `${MX}; dmarc=pass header.from=client.ru`,
      "evil.com; dmarc=fail",
    ]),
    "pass",
  );
});

test("auth: case, method versions and comments", () => {
  assert.equal(
    parseAuthResults(`${MX}; SPF=Fail smtp.mailfrom=client.ru; DKIM=None`),
    "fail",
  );
  assert.equal(parseAuthResults(`${MX}; dkim/1=pass header.d=client.ru`), "pass");
  assert.equal(
    parseAuthResults(`${MX}; (проверено) dmarc=fail header.from=client.ru`),
    "fail",
  );
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass (${MX}: domain of a@client.ru designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@client.ru; dkim=pass header.i=@client.ru; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=client.ru`,
    ),
    "fail",
  );
});

test("auth: sender-controlled text cannot hide a DMARC failure", () => {
  // Незакрытые кавычка и скобка в адресе конверта не глотают следующую часть
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom="x(y"@evil.com; dmarc=fail header.from=client.ru`,
    ),
    "fail",
  );
  // «;» в адресе даёт лишнюю часть — разве что ложный pass, fail она не прячет
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom=x;dmarc=pass@evil.com; dmarc=fail header.from=client.ru`,
    ),
    "fail",
  );
});

const CLIENT_CO = "c-client";
const TICKET = {
  num: 45926,
  isClosed: false,
  applicantId: "u-applicant",
  responsibles: [{ _id: "u-resp", firstName: "Ольга" }],
  company: { _id: CLIENT_CO, alias: "Клиент" },
};
// Клиент чужой компании, если не сказано иное
const user = (id, fields = {}) => ({
  _id: id,
  isEndUser: true,
  company: { _id: "c-other" },
  ...fields,
});
const APPLICANT = user("u-applicant");
const OUTSIDER = user("u-outsider");

test("participants: applicant, responsible, company member, staff", () => {
  assert.equal(isTicketParticipant(TICKET, APPLICANT), true);
  assert.equal(isTicketParticipant(TICKET, user("u-resp")), true);
  assert.equal(
    isTicketParticipant(TICKET, user("u-colleague", { company: { _id: CLIENT_CO } })),
    true,
  );
  assert.equal(
    isTicketParticipant(
      TICKET,
      user("u-staff", { isEndUser: false, company: { _id: "c-f1lab" } }),
    ),
    true,
  );
});

test("participants: an outsider is not one", () => {
  assert.equal(isTicketParticipant(TICKET, OUTSIDER), false);
  // Сотрудник — только явный isEndUser: false; учётка без признака — клиент
  assert.equal(
    isTicketParticipant(TICKET, user("u-legacy", { isEndUser: undefined })),
    false,
  );
  assert.equal(isTicketParticipant(TICKET, null), false);
  assert.equal(isTicketParticipant(TICKET, { isEndUser: false }), false);
  assert.equal(isTicketParticipant(null, APPLICANT), false);
});

test("participants: a missing company matches nobody", () => {
  assert.equal(
    isTicketParticipant({ ...TICKET, company: {} }, user("u-x", { company: {} })),
    false,
  );
  assert.equal(
    isTicketParticipant(
      { ...TICKET, company: undefined },
      user("u-x", { company: undefined }),
    ),
    false,
  );
});

test("participants: a legacy ticket keeps its applicant in the snapshot", () => {
  const legacy = { ...TICKET, applicantId: undefined, applicant: { _id: "u-old" } };
  assert.equal(isTicketParticipant(legacy, user("u-old")), true);
});

test("participants: ObjectIds compare by value", () => {
  const id = (hex) => new Types.ObjectId(hex);
  const ticket = {
    applicantId: id("64b000000000000000000001"),
    responsibles: [{ _id: id("64b000000000000000000002") }],
    company: { _id: id("64b0000000000000000000c1") },
  };
  const client = (hex, companyHex) => ({
    _id: id(hex),
    isEndUser: true,
    company: { _id: id(companyHex) },
  });
  assert.equal(
    isTicketParticipant(ticket, client("64b000000000000000000001", "64b0000000000000000000c2")),
    true,
  );
  assert.equal(
    isTicketParticipant(ticket, client("64b000000000000000000002", "64b0000000000000000000c2")),
    true,
  );
  assert.equal(
    isTicketParticipant(ticket, client("64b000000000000000000003", "64b0000000000000000000c1")),
    true,
  );
  assert.equal(
    isTicketParticipant(ticket, client("64b000000000000000000004", "64b0000000000000000000c2")),
    false,
  );
});

test("route: a participant's reply is a comment unless the sender check failed", () => {
  assert.equal(
    routeReply({ ticket: TICKET, sender: APPLICANT, authVerdict: "none" }),
    "comment",
  );
  assert.equal(
    routeReply({ ticket: TICKET, sender: APPLICANT, authVerdict: "pass" }),
    "comment",
  );
  assert.equal(
    routeReply({ ticket: TICKET, sender: APPLICANT, authVerdict: "fail" }),
    "newTicket",
  );
});

test("route: outsiders, unknown senders and missing tickets get a new ticket", () => {
  assert.equal(
    routeReply({ ticket: TICKET, sender: OUTSIDER, authVerdict: "pass" }),
    "newTicket",
  );
  assert.equal(
    routeReply({ ticket: TICKET, sender: null, authVerdict: "none" }),
    "newTicket",
  );
  assert.equal(
    routeReply({ ticket: null, sender: APPLICANT, authVerdict: "pass" }),
    "newTicket",
  );
});

test("note: names the ticket and the reason", () => {
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: null, authVerdict: "fail" }),
    "Письмо пришло ответом на заявку №45926, но такой заявки нет",
  );
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: TICKET, authVerdict: "fail" }),
    "Письмо пришло ответом на заявку №45926, но не прошло проверку отправителя",
  );
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: TICKET, authVerdict: "none" }),
    "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
  );
});

test("description: the note is its own paragraph above the mail text", () => {
  const note =
    "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует";
  assert.equal(
    withRerouteNote("Добрый день!\nПринтер снова не печатает", note),
    `<p>${note}</p>\nДобрый день!\nПринтер снова не печатает`,
  );
  assert.equal(withRerouteNote("", note), `<p>${note}</p>`);
  assert.equal(withRerouteNote(undefined, note), `<p>${note}</p>`);
});

test("description: without a note it stays as it came", () => {
  assert.equal(withRerouteNote("Текст", null), "Текст");
  assert.equal(withRerouteNote(undefined, null), undefined);
});

test("plan: a participant's reply is a comment; a robot's reply to a closed ticket is only logged", () => {
  const plan = (ticket, fromMachine) =>
    planReply({
      ticketNum: 45926,
      ticket,
      sender: APPLICANT,
      authVerdict: "none",
      fromMachine,
    });
  const closed = { ...TICKET, isClosed: true };
  assert.deepEqual(plan(TICKET, false), { action: "comment", note: null });
  // Открытой заявке всё равно, робот ли ответил (services/machineMail)
  assert.deepEqual(plan(TICKET, true), { action: "comment", note: null });
  assert.deepEqual(plan(closed, false), { action: "comment", note: null });
  assert.deepEqual(plan(closed, true), { action: "autoReplyLog", note: null });
});

test("plan: anything else is a new ticket carrying the note", () => {
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: OUTSIDER,
      authVerdict: "none",
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
    },
  );
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: APPLICANT,
      authVerdict: "fail",
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но не прошло проверку отправителя",
    },
  );
  assert.deepEqual(
    planReply({
      ticketNum: 99999,
      ticket: null,
      sender: null,
      authVerdict: "none",
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №99999, но такой заявки нет",
    },
  );
});

test("plan: a robot that isn't let in opens no ticket, only a log line on #N", () => {
  // Отбойник на уведомление, автоответ с пересылки: заявка на каждое письмо
  // была бы мусором
  const robot = (fields) =>
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: OUTSIDER,
      authVerdict: "none",
      fromMachine: true,
      fromAddress: "mailer-daemon@mx.other.ru",
      ...fields,
    });
  const outsiderLine = {
    action: "logOnly",
    note: "автоответ от mailer-daemon@mx.other.ru не принят: отправитель не участвует в заявке",
  };
  assert.deepEqual(robot({}), outsiderLine);
  assert.deepEqual(robot({ ticket: { ...TICKET, isClosed: true } }), outsiderLine);
  assert.deepEqual(robot({ sender: null }), outsiderLine);
  assert.deepEqual(
    robot({ sender: APPLICANT, authVerdict: "fail", fromAddress: "ivan@client.ru" }),
    {
      action: "logOnly",
      note: "автоответ от ivan@client.ru не принят: не прошёл проверку отправителя",
    },
  );
  // Заявки нет — ни заявки, ни строки в её логе: остаётся журнал сервера
  assert.deepEqual(robot({ ticket: null }), { action: "logOnly", note: null });
});

test("robot log line: the address only; an unknown sender is named as such", () => {
  assert.equal(
    rejectedAutoReplyEvent({ fromAddress: "", authVerdict: "none" }),
    "автоответ от неизвестного отправителя не принят: отправитель не участвует в заявке",
  );
  assert.equal(
    rejectedAutoReplyEvent({ fromAddress: "x@evil.com", authVerdict: "fail" }),
    "автоответ от x@evil.com не принят: не прошёл проверку отправителя",
  );
  // В хронике это «прочее» с текстом, а не чужой вид события
  // (services/ticketEvents)
  for (const authVerdict of ["none", "fail"]) {
    assert.equal(
      classify(rejectedAutoReplyEvent({ fromAddress: "x@evil.com", authVerdict })),
      "other",
    );
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mail/replyRouting.test.js`

Expected: the file fails to load with `Error: Cannot find module './replyRouting'`, and the
run reports `fail 1`.

- [ ] **Step 3: Implement**

Create `backend/services/mail/replyRouting.js`:

```js
/**
 * Ответ письмом в заявку: комментарий в неё или новая заявка.
 *
 * Метка `[F1-HD-N]` в теме (services/emailReplyStripper) говорит лишь, на что
 * ответили. Кто ответил, решают адрес отправителя и проверка подлинности,
 * которую провёл принимающий сервер. Прежде любое письмо с меткой ложилось
 * комментарием в №N: номера идут подряд, и кто угодно писал в чужую заявку от
 * имени клиента или сотрудника, а система рассылала этот текст её участникам
 * со своего адреса.
 *
 * Не принятый ответ человека не теряется: он заводится обычной новой заявкой,
 * первая строка описания называет №N и причину. В №N при этом не пишется
 * ничего и её участникам ничего не уходит. Не принятый робот (автоответ,
 * отбойник, рассылка) заявкой не становится вовсе: в логе №N остаётся одна
 * строка с его адресом.
 */

// Результат проверки в начале части заголовка: «dkim=pass header.d=…»;
// у метода бывает версия — «dkim/1=pass»
const RESULT_RE = /^([a-z0-9_.-]+)(?:\/\d+)?\s*=\s*([a-z0-9_-]+)/i;
// Комментарий в самом начале части: «(…) dmarc=fail»
const LEADING_COMMENT_RE = /^\([^()]*\)\s*/;

/**
 * Вердикт проверки отправителя по заголовку Authentication-Results
 * (RFC 8601):
 *
 *   fail — `dmarc=fail`, или `spf=fail` без `dkim=pass`;
 *   pass — `dmarc=pass` или `dkim=pass`;
 *   none — всё остальное: заголовка нет, он не разбирается, результаты
 *          мягкие (softfail, neutral, none).
 *
 * Верим только ПЕРВОМУ, верхнему заголовку — его ставит наш принимающий
 * сервер; всё, что ниже, приехало вместе с письмом. Подделка ничего не даёт:
 * «pass» маршрутизирует так же, как «none», решает только «fail», и то лишь
 * против письма.
 *
 * Разбор нарочно простой: части по «;», результат — в начале части. Кавычки
 * и скобки внутри частей не разбираются: там лежат данные отправителя
 * (smtp.mailfrom, «domain of …»), и незакрытая кавычка или скобка не должна
 * проглотить следующий за ней «dmarc=fail». Лишняя часть из чужой «;» может
 * разве что изобразить «dkim=pass» — а его отправитель и так получает,
 * подписав письмо своим доменом.
 *
 * Чего проверка не ловит: подделку From у домена без DMARC — там решает одна
 * проверка участника (routeReply).
 *
 * @param {string|string[]|undefined} value `mail.headers.get("authentication-results")`:
 *   строка, при нескольких заголовках — массив сверху вниз
 * @returns {"pass"|"fail"|"none"}
 */
const parseAuthResults = (value) => {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") return "none";

  const results = new Set();
  for (const part of header.split(";")) {
    const match = RESULT_RE.exec(part.trim().replace(LEADING_COMMENT_RE, ""));
    if (match) results.add(`${match[1]}=${match[2]}`.toLowerCase());
  }

  if (results.has("dmarc=fail")) return "fail";
  if (results.has("spf=fail") && !results.has("dkim=pass")) return "fail";
  if (results.has("dmarc=pass") || results.has("dkim=pass")) return "pass";
  return "none";
};

// Id строкой из всего, что его несёт: строка, ObjectId, снимок `{ _id }`,
// документ. У ObjectId Mongoose `_id` — он сам.
const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  const id = value._id && value._id !== value ? value._id : value;
  if (typeof id === "string") return id;
  return typeof id.toHexString === "function" ? id.toHexString() : "";
};

/**
 * Участник заявки: заявитель, ответственный, человек из компании заявки или
 * сотрудник. Сотрудник — только явный `isEndUser: false`: учётка без
 * признака считается клиентской.
 * @param {object|null} ticket заявка (документ или снимок)
 * @param {object|null} user пользователь
 * @returns {boolean}
 */
const isTicketParticipant = (ticket, user) => {
  const userId = idOf(user);
  if (!ticket || !userId) return false;
  if (user.isEndUser === false) return true;

  // Старые заявки (до applicantId) держат заявителя только в снимке applicant
  const applicantId = idOf(ticket.applicantId) || idOf(ticket.applicant);
  if (applicantId === userId) return true;

  if ((ticket.responsibles || []).some((item) => idOf(item) === userId)) {
    return true;
  }

  const companyId = idOf(ticket.company);
  return companyId !== "" && idOf(user.company) === companyId;
};

/**
 * Куда ответ в заявку: комментарием в неё — только от участника и если
 * письмо не провалило проверку отправителя; иначе — новая заявка.
 * @param {object} args
 * @param {object|null} args.ticket заявка №N из темы; null — такой нет
 * @param {object|null} args.sender пользователь с адресом отправителя; null — не опознан
 * @param {"pass"|"fail"|"none"} args.authVerdict parseAuthResults
 * @returns {"comment"|"newTicket"}
 */
const routeReply = ({ ticket, sender, authVerdict }) =>
  ticket && authVerdict !== "fail" && isTicketParticipant(ticket, sender)
    ? "comment"
    : "newTicket";

/**
 * Первая строка описания заявки, в которую ушёл не принятый ответ: какую
 * заявку он называл и почему не стал в ней комментарием. Причины — в порядке
 * проверки: нет заявки → не прошла проверка отправителя → не участник.
 * @param {object} args
 * @param {number} args.ticketNum номер из темы
 * @param {object|null} args.ticket заявка с этим номером; null — такой нет
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @returns {string}
 */
const rerouteNote = ({ ticketNum, ticket, authVerdict }) => {
  const head = `Письмо пришло ответом на заявку №${ticketNum}, но`;
  if (!ticket) return `${head} такой заявки нет`;
  if (authVerdict === "fail") return `${head} не прошло проверку отправителя`;
  return `${head} отправитель в ней не участвует`;
};

/**
 * Описание новой заявки с пометкой. Описание — HTML-строка (карточка выводит
 * его разметкой, Telegram — через htmlToPlainLines), поэтому пометка идёт
 * отдельным абзацем, под ней — текст письма как пришёл. Без пометки описание
 * не меняется.
 * @param {string|undefined} description текст письма
 * @param {string|null} note rerouteNote; null — пометки нет
 * @returns {string|undefined}
 */
const withRerouteNote = (description, note) => {
  if (!note) return description;
  return description ? `<p>${note}</p>\n${description}` : `<p>${note}</p>`;
};

/**
 * Строка в лог заявки об автоответе, которого в неё не пустили: только адрес
 * отправителя, без текста письма. Причина — в том же порядке, что у
 * rerouteNote: не прошла проверка отправителя → не участник.
 * @param {object} args
 * @param {string} args.fromAddress адрес отправителя; "" — его нет
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @returns {string}
 */
const rejectedAutoReplyEvent = ({ fromAddress, authVerdict }) => {
  const head = `автоответ от ${fromAddress || "неизвестного отправителя"} не принят:`;
  return authVerdict === "fail"
    ? `${head} не прошёл проверку отправителя`
    : `${head} отправитель не участвует в заявке`;
};

/**
 * Что сделать с ответом в №ticketNum:
 *   comment      — комментарий в заявку;
 *   autoReplyLog — только запись в лог: автоответ участника в ЗАКРЫТУЮ
 *                  заявку её не поднимает (services/machineMail);
 *   logOnly      — робот, которого в заявку не пустили: заявкой он не
 *                  становится, note — строка в лог №N (null — такой заявки
 *                  нет, остаётся журнал сервера);
 *   newTicket    — новая заявка, note — первая строка её описания.
 * @param {object} args
 * @param {number} args.ticketNum
 * @param {object|null} args.ticket
 * @param {object|null} args.sender
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @param {boolean} args.fromMachine isMachineMail
 * @param {string} [args.fromAddress] адрес отправителя — для строки лога
 * @returns {{ action: "comment"|"autoReplyLog"|"logOnly"|"newTicket", note: string|null }}
 */
const planReply = ({
  ticketNum,
  ticket,
  sender,
  authVerdict,
  fromMachine,
  fromAddress,
}) => {
  if (routeReply({ ticket, sender, authVerdict }) === "newTicket") {
    // Робот новой заявки не открывает: отбойник на уведомление или автоответ
    // с пересылки заводили бы по заявке на каждое письмо
    if (fromMachine) {
      return {
        action: "logOnly",
        note: ticket ? rejectedAutoReplyEvent({ fromAddress, authVerdict }) : null,
      };
    }
    return {
      action: "newTicket",
      note: rerouteNote({ ticketNum, ticket, authVerdict }),
    };
  }
  if (ticket.isClosed && fromMachine) {
    return { action: "autoReplyLog", note: null };
  }
  return { action: "comment", note: null };
};

module.exports = {
  parseAuthResults,
  isTicketParticipant,
  routeReply,
  rerouteNote,
  withRerouteNote,
  rejectedAutoReplyEvent,
  planReply,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test services/mail/replyRouting.test.js`

Expected: `pass 22`, `fail 0`.

- [ ] **Step 5: Leave uncommitted**

New:
- `backend/services/mail/replyRouting.js`
- `backend/services/mail/replyRouting.test.js`

No commit.

---

### Task C3: Sender address, company-domain filter, envelope and repeat lookup

Today the handler carries only `mail.from.text` and takes the first address-looking substring
of it, so `From: "boss@client.ru" <x@evil.com>` resolves to boss@client.ru. The company domain
is cut from the same text and matched case-sensitively. The same text is stored as
`Ticket.realSender`, where the frontend again shows the first address-looking substring.

**Files:**
- Create: `backend/services/mail/inbound.js`
- Test: `backend/services/mail/inbound.test.js` (new)

**Interfaces:**
- Consumes: the `mailparser.simpleParser` result shape, verified against mailparser 3.7.2
  (the tests parse real messages, so a mailparser upgrade in another section is re-checked
  by them):
  - `mail.from.value[0].address` (case preserved);
  - `mail.messageId` (`"<…>"`, the last one if repeated);
  - `mail.headers.get("authentication-results")` (a string, or an array top-down when
    repeated; folded lines are already joined).
- Produces (from `backend/services/mail/inbound.js`):
  - `senderAddress(mail): string` — lower-cased, `""` when there is no address;
  - `senderLine(mail): string` — the `realSender` value: `"Name <address>"` or the bare
    address. A name with `@` is dropped; with no address it is `""`;
  - `senderDomain(address: string): string`;
  - `companyDomainFilter(domain: string): object` — spread into `MongoCompany.findOne`;
  - `mayIdentifyApplicant({ identifyApplicant, authVerdict }): boolean` — `false` when the
    setting is off or the sender check failed;
  - `inboundEnvelope(mail): { fromAddress: string, realSender: string, messageId: string | undefined, authResults: string }`;
  - `findImportedMessage(messageId, { Ticket, Comment }): Promise<null | { ticketId, commentId? }>`.

- [ ] **Step 1: Write the failing test**

Create `backend/services/mail/inbound.test.js`:

```js
// node --test services/mail/inbound.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");

const {
  senderAddress,
  senderLine,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  inboundEnvelope,
  findImportedMessage,
} = require("./inbound");

// Письмо так, как его забирает IMAP: заголовки, пустая строка, тело
const parse = (...headers) =>
  simpleParser(`${headers.join("\r\n")}\r\n\r\nТекст письма\r\n`);

// Как адрес из realSender достаёт фронт: первое похожее на адрес в строке
// (frontend/src/util/mail-sender.js, ADDRESS_RE)
const FRONTEND_ADDRESS_RE = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/;

test("the sender is the From address, never its display name", async () => {
  assert.equal(
    senderAddress(await parse('From: "boss@client.ru" <Attacker@Evil.COM>')),
    "attacker@evil.com",
  );
  // Имя закодировано и само похоже на отправителя: «Иван <boss@client.ru>»
  const encodedName = Buffer.from("Иван <boss@client.ru>").toString("base64");
  assert.equal(
    senderAddress(await parse(`From: =?UTF-8?B?${encodedName}?= <a@evil.com>`)),
    "a@evil.com",
  );
  assert.equal(
    senderAddress(await parse("From: Ivan <IVAN@Corp.RU>, second@x.ru")),
    "ivan@corp.ru",
  );
  assert.equal(senderAddress(await parse("From: ivan@corp.ru")), "ivan@corp.ru");
});

test("no usable From means no sender", async () => {
  for (const from of [
    "From: <>",
    "From: undisclosed-recipients:;",
    "From: not an address",
    "Subject: no sender at all",
  ]) {
    assert.equal(senderAddress(await parse(from)), "", from);
  }
  assert.equal(senderAddress(undefined), "");
});

test("realSender: «Name <address>» from the parsed From, and the address wins", async () => {
  const cases = [
    ['From: "Иван Петров" <IVAN@Corp.RU>', "Иван Петров <ivan@corp.ru>"],
    ["From: ivan@corp.ru", "ivan@corp.ru"],
    [
      "From: MAILER-DAEMON@mx.example.com (Mail Delivery System)",
      "Mail Delivery System <mailer-daemon@mx.example.com>",
    ],
    // Имя с адресом внутри отбрасывается: фронт показал бы его вместо
    // настоящего
    ['From: "boss@client.ru" <x@evil.com>', "x@evil.com"],
    [
      `From: =?UTF-8?B?${Buffer.from("Иван <boss@client.ru>").toString("base64")}?= <a@evil.com>`,
      "a@evil.com",
    ],
  ];
  for (const [from, expected] of cases) {
    const mail = await parse(from);
    assert.equal(senderLine(mail), expected, from);
    assert.equal(
      senderLine(mail).match(FRONTEND_ADDRESS_RE)[0].toLowerCase(),
      senderAddress(mail),
      from,
    );
  }
  // Адреса нет — показывать нечего
  assert.equal(senderLine(await parse("From: <>")), "");
  assert.equal(senderLine(undefined), "");
});

test("the applicant is identified only when allowed and the sender check didn't fail", () => {
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "none" }), true);
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "pass" }), true);
  // Подделка не должна открыть заявку от имени клиента и слать ему уведомления
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "fail" }), false);
  assert.equal(mayIdentifyApplicant({ identifyApplicant: false, authVerdict: "pass" }), false);
  assert.equal(
    mayIdentifyApplicant({ identifyApplicant: undefined, authVerdict: "none" }),
    false,
  );
});

test("the domain is what follows the last @", () => {
  assert.equal(senderDomain("ivan@corp.ru"), "corp.ru");
  assert.equal(senderDomain("IVAN@Corp.RU"), "corp.ru");
  assert.equal(senderDomain("user@"), "");
  assert.equal(senderDomain(""), "");
  assert.equal(senderDomain(undefined), "");
});

test("company domains match whole and case-insensitively", () => {
  const { emailDomains } = companyDomainFilter("client.ru");
  for (const stored of ["client.ru", "Client.RU", "CLIENT.RU"]) {
    assert.equal(emailDomains.test(stored), true, stored);
  }
  for (const stored of ["sub.client.ru", "client.ru.evil.com", "clientXru", "client.rus"]) {
    assert.equal(emailDomains.test(stored), false, stored);
  }
});

test("a domain is taken literally, and an empty one matches nothing", () => {
  assert.equal(companyDomainFilter("a+b.ru").emailDomains.test("a+b.ru"), true);
  assert.equal(companyDomainFilter("a+b.ru").emailDomains.test("aab.ru"), false);
  assert.deepEqual(companyDomainFilter(""), { emailDomains: { $in: [] } });
});

test("the envelope: sender, Message-ID and the topmost Authentication-Results", async () => {
  const mail = await parse(
    "Authentication-Results: mx.f1lab.ru;",
    "\tspf=pass smtp.mailfrom=evil.com;",
    "\tdmarc=fail (p=REJECT) header.from=client.ru",
    "Authentication-Results: evil.com; dmarc=pass header.from=client.ru",
    'From: "boss@client.ru" <Attacker@Evil.COM>',
    "Subject: Re: [F1-HD-45926] x",
    "Message-ID: <abc.123@evil.com>",
  );
  assert.deepEqual(inboundEnvelope(mail), {
    fromAddress: "attacker@evil.com",
    realSender: "attacker@evil.com",
    messageId: "<abc.123@evil.com>",
    authResults:
      "mx.f1lab.ru; spf=pass smtp.mailfrom=evil.com; dmarc=fail (p=REJECT) header.from=client.ru",
  });
});

test("the envelope: a single header, and neither Message-ID nor results", async () => {
  assert.deepEqual(
    inboundEnvelope(
      await parse(
        "Authentication-Results: mx.f1lab.ru; dkim=pass header.d=client.ru",
        "From: ivan@client.ru",
        "Subject: x",
      ),
    ),
    {
      fromAddress: "ivan@client.ru",
      realSender: "ivan@client.ru",
      messageId: undefined,
      authResults: "mx.f1lab.ru; dkim=pass header.d=client.ru",
    },
  );
  assert.deepEqual(
    inboundEnvelope(await parse('From: "Иван" <ivan@client.ru>', "Subject: x")),
    {
      fromAddress: "ivan@client.ru",
      realSender: "Иван <ivan@client.ru>",
      messageId: undefined,
      authResults: "",
    },
  );
});

// Модели с тем, что читает поиск повтора; calls — какие запросы ушли
const fakeModels = ({ tickets = {}, comments = {} } = {}) => {
  const calls = [];
  return {
    calls,
    Ticket: {
      exists: async (filter) => {
        calls.push(["Ticket.exists", filter]);
        return tickets[filter.emailMessageId] || null;
      },
    },
    Comment: {
      findOne: (filter, projection) => ({
        lean: async () => {
          calls.push(["Comment.findOne", filter, projection]);
          return comments[filter.emailMessageId] || null;
        },
      }),
    },
  };
};

test("repeats: without a Message-ID nothing is a repeat and nothing is queried", async () => {
  const models = fakeModels();
  assert.equal(await findImportedMessage(undefined, models), null);
  assert.equal(await findImportedMessage("", models), null);
  assert.deepEqual(models.calls, []);
});

test("repeats: an e-mail that became a ticket", async () => {
  const models = fakeModels({ tickets: { "<a@x>": { _id: "t-1" } } });
  assert.deepEqual(await findImportedMessage("<a@x>", models), { ticketId: "t-1" });
  assert.deepEqual(models.calls, [["Ticket.exists", { emailMessageId: "<a@x>" }]]);
});

test("repeats: an e-mail that became a comment names the comment and its ticket", async () => {
  const models = fakeModels({
    comments: { "<b@x>": { _id: "c-1", ticketId: "t-2" } },
  });
  assert.deepEqual(await findImportedMessage("<b@x>", models), {
    ticketId: "t-2",
    commentId: "c-1",
  });
  assert.deepEqual(models.calls, [
    ["Ticket.exists", { emailMessageId: "<b@x>" }],
    ["Comment.findOne", { emailMessageId: "<b@x>" }, { _id: 1, ticketId: 1 }],
  ]);
});

test("repeats: an e-mail seen for the first time", async () => {
  assert.equal(await findImportedMessage("<new@x>", fakeModels()), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mail/inbound.test.js`

Expected: the file fails to load with `Error: Cannot find module './inbound'`, and the run
reports `fail 1`.

- [ ] **Step 3: Implement**

Create `backend/services/mail/inbound.js`:

```js
/**
 * Входящее письмо: что разборщик (middleware/emailHandling) берёт из
 * заголовков помимо темы и тела, и как по этому ищет.
 *
 * Отправитель — только адрес из From (`mail.from.value[0].address`), никогда
 * не текст заголовка: в тексте стоит отображаемое имя, а его пишет кто
 * угодно. Прежде «"boss@client.ru" <x@evil.com>» опознавался как
 * boss@client.ru — первое похожее на адрес в строке.
 */

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Адрес отправителя в нижнем регистре; "" — адреса нет (пустой From, группа
 * «undisclosed-recipients:;», текст без «@»). Отправителей несколько —
 * первый.
 * @param {object} mail результат mailparser.simpleParser
 * @returns {string}
 */
const senderAddress = (mail) => {
  const address = String(mail?.from?.value?.[0]?.address || "")
    .trim()
    .toLowerCase();
  return address.includes("@") ? address : "";
};

/**
 * Отправитель для показа (Ticket.realSender): «Имя <адрес>» или голый адрес.
 * Собирается из разобранного From, а не из его текста. Фронт
 * (util/mail-sender.js#parseMailSender) берёт первое похожее на адрес в
 * строке — поэтому имя с «@» внутри отбрасывается: «"boss@client.ru"
 * <x@evil.com>» показался бы как boss@client.ru. Адреса нет — "".
 * @param {object} mail результат mailparser.simpleParser
 * @returns {string}
 */
const senderLine = (mail) => {
  const address = senderAddress(mail);
  if (!address) return "";
  const name = String(mail.from.value[0].name || "")
    .replace(/\s+/g, " ")
    .trim();
  return name && !name.includes("@") ? `${name} <${address}>` : address;
};

/**
 * Домен адреса — всё после последней «@», в нижнем регистре; "" — его нет.
 * @param {string} address
 * @returns {string}
 */
const senderDomain = (address) => {
  const value = String(address || "");
  const at = value.lastIndexOf("@");
  return at === -1 ? "" : value.slice(at + 1).trim().toLowerCase();
};

/**
 * Условие на Company.emailDomains: домен целиком и без учёта регистра.
 * Домены в карточке компании хранятся как их ввели («Client.RU»), и точное
 * `$in` промахивалось. Выражение, а не нормализация данных: не нужна
 * миграция, компаний сотни, индекса по полю нет. Пустой домен не совпадает
 * ни с чем.
 * @param {string} domain
 * @returns {object} часть фильтра для MongoCompany.findOne
 */
const companyDomainFilter = (domain) =>
  domain
    ? { emailDomains: new RegExp(`^${escapeRegExp(domain)}$`, "i") }
    : { emailDomains: { $in: [] } };

/**
 * Опознавать ли заявителя новой заявки по письму (по адресу и по номеру
 * телефона): только когда это включено в настройках и письмо не провалило
 * проверку отправителя. Иначе подделка открыла бы заявку от имени клиента, и
 * уведомления о ней ушли бы ему. Такая заявка — от инициатора по умолчанию;
 * компания по домену опознаётся как обычно.
 * @param {object} args
 * @param {boolean} args.identifyApplicant Preferences.identifyApplicant
 * @param {"pass"|"fail"|"none"} args.authVerdict services/mail/replyRouting#parseAuthResults
 * @returns {boolean}
 */
const mayIdentifyApplicant = ({ identifyApplicant, authVerdict }) =>
  Boolean(identifyApplicant) && authVerdict !== "fail";

/**
 * Что из заголовков едет дальше вместе с письмом:
 *   fromAddress — адрес отправителя (senderAddress);
 *   realSender  — он же для показа, с именем (senderLine);
 *   messageId   — Message-ID для распознавания повторов; undefined — его нет;
 *   authResults — ПЕРВЫЙ заголовок Authentication-Results: его ставит наш
 *                 принимающий сервер (разбор — services/mail/replyRouting);
 *                 "" — заголовка нет.
 * @param {object} mail результат mailparser.simpleParser
 * @returns {{ fromAddress: string, realSender: string, messageId: string|undefined, authResults: string }}
 */
const inboundEnvelope = (mail) => {
  const authResults = mail?.headers?.get?.("authentication-results");
  const topmost = Array.isArray(authResults) ? authResults[0] : authResults;
  const messageId =
    typeof mail?.messageId === "string" ? mail.messageId.trim() : "";
  return {
    fromAddress: senderAddress(mail),
    realSender: senderLine(mail),
    // Пустая строка попала бы в разреженный индекс и совпала с любой другой
    messageId: messageId || undefined,
    authResults: typeof topmost === "string" ? topmost : "",
  };
};

/**
 * Письмо с этим Message-ID уже заведено — заявкой или комментарием. Повтор
 * бывает, когда пометка \Seen не дошла до сервера после обработки, или одно
 * письмо легло в ящик дважды (копия и пересылка на тот же ящик). Без
 * Message-ID повтор не узнать — такое письмо обрабатывается как новое.
 *
 * @param {string|undefined} messageId
 * @param {{ Ticket: object, Comment: object }} models модели (в тестах — заглушки)
 * @returns {Promise<null|{ ticketId: *, commentId?: * }>} commentId — повтор
 *   стал комментарием
 */
const findImportedMessage = async (messageId, { Ticket, Comment }) => {
  if (!messageId) return null;

  const ticket = await Ticket.exists({ emailMessageId: messageId });
  if (ticket) return { ticketId: ticket._id };

  const comment = await Comment.findOne(
    { emailMessageId: messageId },
    { _id: 1, ticketId: 1 },
  ).lean();
  return comment ? { ticketId: comment.ticketId, commentId: comment._id } : null;
};

module.exports = {
  senderAddress,
  senderLine,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  inboundEnvelope,
  findImportedMessage,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test services/mail/inbound.test.js`

Expected: `pass 13`, `fail 0`.

- [ ] **Step 5: Leave uncommitted**

New:
- `backend/services/mail/inbound.js`
- `backend/services/mail/inbound.test.js`

No commit.

---

### Task C4: Mailing-list detection reads mailparser's folded `list` key

`isMachineMail` checks `headers.get("list-id")` / `"list-unsubscribe"`, but mailparser folds every
`List-*` header into one `list` key (`node_modules/mailparser/lib/mail-parser.js` ~379–383,
normalised at ~426–435): `List-Id: Новости <news.example.com>` becomes
`list = { id: { name, id } }`, and `List-Unsubscribe` becomes `list.unsubscribe`. The check has
never fired on real mail; the existing test passes only because it builds a synthetic `Map`
that mailparser never produces. Behaviour for open tickets doesn't change: `fromMachine` only
matters for replies to closed tickets (`planReply` → `autoReplyLog`).

**Files:**
- Modify: `backend/services/machineMail.js` (anchor: `const has = …`, line 45;
  `isMachineMail`, line 64)
- Test: `backend/services/machineMail.test.js` (anchor: the imports, lines 1–4; the test
  "письмо из списка рассылки", lines 49–55)

**Interfaces:**
- Consumes: the mailparser `list` header shape above.
- Produces: `isMachineMail(mail)` is also `true` for mail with `List-Id` or `List-Unsubscribe`.
  The signature is unchanged. There is a new internal `isMailingList(headers)`, not exported.

- [ ] **Step 1: Write the failing test**

In `backend/services/machineMail.test.js` replace the imports (lines 1–4):

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { isMachineMail } = require("./machineMail");
```

with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");

const { isMachineMail } = require("./machineMail");
```

and replace the list test (lines 49–55):

```js
test("письмо из списка рассылки", () => {
  assert.equal(isMachineMail(mail({ "list-id": "<news.example.com>" })), true);
  assert.equal(
    isMachineMail(mail({ "list-unsubscribe": "<mailto:off@example.com>" })),
    true,
  );
});
```

with:

```js
test("письмо из списка рассылки — в том виде, в каком его отдаёт mailparser", async () => {
  // mailparser складывает List-* в один ключ `list`: отдельных «list-id» и
  // «list-unsubscribe» в разобранном письме не бывает
  const listId = await simpleParser(
    "From: news@example.com\r\nList-Id: Новости <news.example.com>\r\nSubject: x\r\n\r\nтекст\r\n",
  );
  assert.equal(isMachineMail(listId), true);
  const unsubscribe = await simpleParser(
    "From: news@example.com\r\nList-Unsubscribe: <mailto:off@example.com>, <https://example.com/off>\r\nSubject: x\r\n\r\nтекст\r\n",
  );
  assert.equal(isMachineMail(unsubscribe), true);
  assert.equal(isMachineMail(mail({ list: { id: { id: "news.example.com" } } })), true);
  assert.equal(
    isMachineMail(mail({ list: { unsubscribe: { mail: "off@example.com" } } })),
    true,
  );
});

test("прочие List-* и живой ответ роботом не делают", async () => {
  assert.equal(isMachineMail(mail({ list: { help: { mail: "help@example.com" } } })), false);
  const human = await simpleParser(
    "From: olga@clinic.ru\r\nSubject: Re: [F1-HD-57056] x\r\n\r\nСпасибо\r\n",
  );
  assert.equal(isMachineMail(human), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/machineMail.test.js`

Expected: `tests 9`, `fail 1`. The failing test is "письмо из списка рассылки — в том
виде…", with `actual: false, expected: true` on the first `isMachineMail(listId)`.

- [ ] **Step 3: Implement**

In `backend/services/machineMail.js` replace (line 45):

```js
const has = (headers, name) => headerText(headers, name) !== "";
```

with:

```js
const has = (headers, name) => headerText(headers, name) !== "";

/**
 * Письмо из списка рассылки. mailparser складывает все `List-*` в один ключ
 * `list`: `List-Id` → `list.id`, `List-Unsubscribe` → `list.unsubscribe`
 * (значения — объекты). Ключей `list-id` / `list-unsubscribe` в разобранном
 * письме не бывает — прежняя проверка по ним не срабатывала ни разу. Прочие
 * `List-*` (Help, Post, Archive) признаком не считаем: список — в шапке модуля.
 */
const isMailingList = (headers) => {
  const list = headers.get("list");
  return Boolean(
    list && typeof list === "object" && (list.id || list.unsubscribe),
  );
};
```

and replace (line 64):

```js
  if (has(headers, "list-id") || has(headers, "list-unsubscribe")) return true;
```

with:

```js
  if (isMailingList(headers)) return true;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test services/machineMail.test.js`

Expected: `pass 9`, `fail 0`.

- [ ] **Step 5: Leave uncommitted**

Changed:
- `backend/services/machineMail.js`
- `backend/services/machineMail.test.js`

No commit.

---

### Task C5: `emailMessageId` on tickets and comments

**Files:**
- Modify: `backend/models/ticket.js` (anchor: `realSender` field, lines 157–161; index block,
  line 538)
- Modify: `backend/models/comment.js` (anchor: `source` field, lines 19–23; index block,
  line 114)
- Test: `backend/services/mail/inboundModels.test.js` (new; loads the real models without a
  database, like `services/phoneSetters.test.js`. Requiring `models/ticket.js` runs
  `initCounter()`, so the file takes ~10 s and prints
  `Failed to initialize counter: … buffering timed out` — the same as `phoneSetters.test.js`,
  and harmless.)

**Interfaces:**
- Consumes: `isTicketParticipant` from Task C2 (the test checks it against real Mongoose
  documents: ObjectId `_id` getters, unset nested paths returning `{}`, the legacy
  `applicant` snapshot).
- Produces:
  - `Ticket.emailMessageId: String`, optional, index `{ emailMessageId: 1 }, { sparse: true }`;
  - `Comment.emailMessageId: String`, with the same index.
  - Mongoose `autoIndex` (on; `app.js` passes no options to `connect`) builds both indexes
    at the first start. The field is absent on existing documents, so the sparse indexes stay
    small.

- [ ] **Step 1: Write the failing test**

Create `backend/services/mail/inboundModels.test.js`:

```js
// node --test services/mail/inboundModels.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");

// Настоящие модели, без базы: документы собираются в памяти (как
// services/phoneSetters.test.js)
const { Ticket } = require("@/models/ticket");
const Comment = require("@/models/comment");
const User = require("@/models/user");
const { isTicketParticipant } = require("./replyRouting");

const hasSparseMessageIdIndex = (model) =>
  model.schema
    .indexes()
    .some(
      ([fields, options]) =>
        Object.keys(fields).join() === "emailMessageId" &&
        options.sparse === true,
    );

test("tickets and comments keep their e-mail's Message-ID under a sparse index", () => {
  for (const model of [Ticket, Comment]) {
    assert.equal(
      model.schema.path("emailMessageId")?.instance,
      "String",
      model.modelName,
    );
    assert.equal(hasSparseMessageIdIndex(model), true, model.modelName);
  }
  assert.equal(new Comment({ emailMessageId: "<a@x>" }).emailMessageId, "<a@x>");
});

test("a document not made from e-mail has no Message-ID at all", () => {
  // Пустое значение попало бы в разреженный индекс и совпало с любым другим
  assert.equal(Object.hasOwn(new Ticket({}).toObject(), "emailMessageId"), false);
  assert.equal(
    Object.hasOwn(
      new Comment({ emailMessageId: undefined }).toObject(),
      "emailMessageId",
    ),
    false,
  );
});

test("reply routing reads real Mongoose documents", () => {
  const company = { _id: new Types.ObjectId(), alias: "Клиент" };
  const applicant = new User({ email: "ivan@client.ru", isEndUser: true, company });
  const colleague = new User({ email: "olga@client.ru", isEndUser: true, company });
  const outsider = new User({
    email: "x@other.ru",
    isEndUser: true,
    company: { _id: new Types.ObjectId() },
  });
  const loner = new User({ email: "y@other.ru", isEndUser: true });
  const ticket = new Ticket({ applicantId: applicant._id, company });

  assert.equal(isTicketParticipant(ticket, applicant), true);
  assert.equal(isTicketParticipant(ticket, colleague), true);
  assert.equal(isTicketParticipant(ticket, outsider), false);
  // Незаполненные вложенные пути Mongoose отдаёт пустым объектом — это не
  // «совпадение пустых компаний»
  assert.equal(isTicketParticipant(new Ticket({}), loner), false);
  // Старая заявка: заявитель только в снимке applicant
  assert.equal(
    isTicketParticipant(new Ticket({ applicant: { _id: outsider._id } }), outsider),
    true,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mail/inboundModels.test.js`

Expected:
- "tickets and comments keep…" fails with `undefined !== 'String'` (message `Ticket`);
- the other 2 pass;
- after ~10 s, the harmless `Failed to initialize counter` line.

- [ ] **Step 3: Implement**

In `backend/models/ticket.js` replace (lines 157–161):

```js
    realSender: {
      type: String,
      required: false,
    },
    applicantId: {
```

with:

```js
    realSender: {
      type: String,
      required: false,
    },
    // Message-ID письма, из которого заведена заявка: повтор того же письма
    // (пометка \Seen не дошла до сервера, копия в ящике) второй заявкой не
    // становится (middleware/emailHandling, services/mail/inbound). У заявок
    // не из почты поля нет вовсе — разреженный индекс их не держит.
    emailMessageId: {
      type: String,
    },
    applicantId: {
```

and replace (line 538):

```js
ticketSchema.index({ "applicant._id": 1, createdAt: -1 }); // For latest-ticket-per-applicant (legacy embedded applicant)
```

with:

```js
ticketSchema.index({ "applicant._id": 1, createdAt: -1 }); // For latest-ticket-per-applicant (legacy embedded applicant)
// Повтор письма по Message-ID (services/mail/inbound#findImportedMessage)
ticketSchema.index({ emailMessageId: 1 }, { sparse: true });
```

In `backend/models/comment.js` replace (lines 19–23):

```js
    source: {
      type: String,
      enum: ["email"],
      default: undefined,
    },
```

with:

```js
    source: {
      type: String,
      enum: ["email"],
      default: undefined,
    },
    // Message-ID письма, ставшего этим комментарием: повтор того же письма
    // второй раз не заводится (middleware/emailHandling,
    // services/mail/inbound). У остальных комментариев поля нет.
    emailMessageId: {
      type: String,
    },
```

and replace (line 114):

```js
commentSchema.index({ ticketId: 1, createdAt: 1 });
```

with:

```js
commentSchema.index({ ticketId: 1, createdAt: 1 });
// Повтор письма по Message-ID (services/mail/inbound#findImportedMessage)
commentSchema.index({ emailMessageId: 1 }, { sparse: true });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test services/mail/inboundModels.test.js`

Expected: `pass 3`, `fail 0`, plus the same harmless counter line.

- [ ] **Step 5: Leave uncommitted**

Changed:
- `backend/models/ticket.js`
- `backend/models/comment.js`

New:
- `backend/services/mail/inboundModels.test.js`

No commit.

---

### Task C6: Wire it into the IMAP handler, and describe it in the UX guide

`backend/middleware/emailHandling.js` has no DB-free seam, so its test is a guard. It pins these
invariants in the source:
- no identity or `realSender` from the `From` text;
- the applicant gate;
- replies go through `planReply`, including the robot `logOnly` action;
- both creations stamp the Message-ID.

It also checks that the module loads with the new imports. The behaviour itself is covered by
C2–C5.

The optional TicketLog fix is included: the new-ticket log entry reads `ticket.applicant.firstName`,
but new tickets never set the legacy `applicant` snapshot (Mongoose returns `{}`), so the entry
has no name today. It now uses the resolved `applicant`.

**Files:**
- Modify: `backend/middleware/emailHandling.js`. Anchors, current line numbers:
  - imports, lines 33–36;
  - `emailArray.push` after `simpleParser`, lines 575–586;
  - the top of the per-email `try`, lines 610–613;
  - the `source` comment and call, lines 651–653;
  - the `identifyCompany` block, lines 657–676;
  - the `emailAddress` extraction, lines 681–689;
  - the applicant condition, line 691;
  - the reply branch, lines 732–744, 759, 768, 784–788 and 817–826;
  - the new-ticket constructor, lines 829–834 and 845–846;
  - its TicketLog, lines 899–904.
- Modify: `docs/ux-ui-guide.md`, in «Хроника: переписка и события одной лентой»:
  - a new bullet above line 1380;
  - the bullet at lines 1389–1396.
- Modify: `docs/ux-ui-guide.md`, in «Письмо-уведомление тоже интерфейс»: the bullet at lines
  2270–2274.
- Modify: `docs/ux-ui-changelog.md` — a new entry above line 13.
- Test: `backend/middleware/emailHandling.test.js` (new)

**Interfaces:**
- Consumes:
  - C1 `ticketNumFromSubject` (strict);
  - C2 `parseAuthResults`, `planReply`, `withRerouteNote`;
  - C3 `inboundEnvelope`, `senderDomain`, `companyDomainFilter`, `mayIdentifyApplicant`,
    `findImportedMessage`;
  - C4 `isMachineMail`;
  - C5 `emailMessageId`.
- Produces:
  - the per-message `email` object gains `fromAddress`, `realSender`, `messageId` and
    `authResults`;
  - `from` (the raw text) stays only for the server-log context.

- [ ] **Step 1: Write the failing test**

Create `backend/middleware/emailHandling.test.js`:

```js
// node --test middleware/emailHandling.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Обработчик держит IMAP и базу, чистого шва у него нет: решения проверены в
// services/mail/*.test.js, здесь — что проводка на месте и старый путь
// опознания по тексту From не вернулся
const source = fs.readFileSync(path.join(__dirname, "emailHandling.js"), "utf8");

test("the sender is never read from the From text with its display name", () => {
  // Прежде адрес искали выражением по тексту From, а домен компании —
  // отрезая всё до «@»: «"boss@client.ru" <x@evil.com>» становился boss
  assert.doesNotMatch(source, /email\.from\.(match|replace)\(/);
  assert.doesNotMatch(source, /isCloudTelephonySender\(email\.from\)/);
  // Показ отправителя и строки лога заявки — тоже из разобранного адреса
  assert.doesNotMatch(source, /realSender: email\.from\b/);
  assert.doesNotMatch(source, /\$\{email\.from\}/);
});

test("mail that failed the sender check identifies no applicant", () => {
  assert.match(source, /mayIdentifyApplicant\(\{/);
  assert.doesNotMatch(source, /if \(prefs\.identifyApplicant\) \{/);
});

test("replies go through planReply, repeats through findImportedMessage", () => {
  assert.match(source, /planReply\(\{/);
  assert.match(source, /reply\.action === "logOnly"/);
  assert.match(source, /findImportedMessage\(email\.messageId/);
  assert.match(source, /withRerouteNote\(email\.description, reply\.note\)/);
  // Оба создания помнят Message-ID — иначе повтор не узнать
  assert.equal(source.match(/emailMessageId: email\.messageId/g)?.length, 2);
});

test("the module loads with the new services wired in", () => {
  const { handleNewEmails } = require("./emailHandling");
  assert.equal(typeof handleNewEmails, "function");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test middleware/emailHandling.test.js`

Expected: `tests 4`, `fail 3`.
- "the sender is never read…" fails: the input matches `/email\.from\.(match|replace)\(/`;
- "mail that failed the sender check…" fails: the input doesn't match
  `/mayIdentifyApplicant\(\{/`;
- "replies go through…" fails: the input doesn't match `/planReply\(\{/`;
- "the module loads…" passes;
- after ~10 s, the harmless `Failed to initialize counter` line.

- [ ] **Step 3: Implement**

3a–3n edit `backend/middleware/emailHandling.js`; line numbers are those of `b3b20cf`.

3a. Imports. Replace (lines 33–36):

```js
const {
  stripQuotedReply,
  ticketNumFromSubject,
} = require("../services/emailReplyStripper");
```

with:

```js
const {
  stripQuotedReply,
  ticketNumFromSubject,
} = require("../services/emailReplyStripper");
const {
  inboundEnvelope,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  findImportedMessage,
} = require("../services/mail/inbound");
const {
  parseAuthResults,
  planReply,
  withRerouteNote,
} = require("../services/mail/replyRouting");
```

3b. Carry the envelope. Replace (lines 575–586):

```js
        const mail = await simpleParser(idHeader + all.body);
        emailArray.push({
          uid: message.attributes.uid,
          from: mail.from?.text,
          name: mail.subject,
          description: mail.text,
          htmlDescription: mail.html,
          attachments: attachmentNames,
          // Заголовки дальше не едут, поэтому признак считаем здесь
          // (services/machineMail)
          fromMachine: isMachineMail(mail),
        });
```

with:

```js
        const mail = await simpleParser(idHeader + all.body);
        emailArray.push({
          uid: message.attributes.uid,
          // Текст From вместе с отображаемым именем — только для журнала
          // сервера; опознание — по fromAddress, показ — по realSender
          from: mail.from?.text,
          name: mail.subject,
          description: mail.text,
          htmlDescription: mail.html,
          attachments: attachmentNames,
          // Заголовки дальше не едут, поэтому признаки считаем здесь
          // (services/machineMail, services/mail/inbound): fromMachine,
          // fromAddress, realSender, messageId, authResults
          fromMachine: isMachineMail(mail),
          ...inboundEnvelope(mail),
        });
```

3c. Skip repeats before anything is created. Replace (lines 610–613):

```js
      try {
        const defaultApplicant = await MongoUser.findById(
          prefs.defaultApplicant._id,
        );
```

with:

```js
      try {
        // Письмо уже заведено (пометка \Seen не дошла до сервера, копия легла
        // в ящик дважды): второй заявки или комментария не будет — только
        // пометка прочитанным (services/mail/inbound)
        const imported = await findImportedMessage(email.messageId, {
          Ticket,
          Comment,
        });
        if (imported) {
          // Комментарий мог сохраниться без записи в массив заявки (сбой между
          // двумя записями) — тогда карточка его не видит. $addToSet повтором
          // не удвоит
          if (imported.commentId) {
            await Ticket.updateOne(
              { _id: imported.ticketId },
              { $addToSet: { comments: imported.commentId } },
            );
          }
          await connection.addFlags(email.uid, "\\Seen");
          failedMessageAttempts.delete(email.uid);
          logger.log("info", "Skipped an already imported e-mail", {
            ...emailProcessingContext,
            messageIdHeader: email.messageId,
          });
          continue;
        }

        const defaultApplicant = await MongoUser.findById(
          prefs.defaultApplicant._id,
        );
```

3d. Telephony source by address. Replace (lines 651–653):

```js
        // Поэтому источник фиксируется по email.from один раз при создании и не
        // меняется при последующей смене заявителя.
        const source = (await isCloudTelephonySender(email.from))
```

with:

```js
        // Поэтому источник фиксируется по адресу отправителя один раз при
        // создании и не меняется при последующей смене заявителя.
        const source = (await isCloudTelephonySender(email.fromAddress))
```

3e. Company by the address's domain, case-insensitively. Replace (lines 657–676):

```js
        if (prefs.identifyCompany) {
          const emailDomain = email.from.replace(/.*@/, "").replace(">", "");

          // Отключённые компании не опознаются (isActive: $ne false) —
          // письмо/звонок падает на defaultCompany как неопознанное.
          // Сам defaultCompany выше намеренно без фильтра: машинный фолбэк
          // должен жить всегда (его отключение закрыто 409-гардом в UI).
          if (prefs.checkPhoneNumber && callerPhones.length) {
            company =
              (await MongoCompany.findOne({
                emailDomains: { $in: [emailDomain] },
                isActive: { $ne: false },
              })) || (await findByAnyPhone(callerPhones, findCompanyByPhone));
            if (company && isIncomingCall) ticketTitle = "Входящий звонок";
          } else {
            company = await MongoCompany.findOne({
              emailDomains: { $in: [emailDomain] },
              isActive: { $ne: false },
            });
          }
```

with:

```js
        if (prefs.identifyCompany) {
          // Домен — из самого адреса отправителя и без учёта регистра
          // (services/mail/inbound): «"x@client.ru" <y@evil.com>» — это
          // evil.com, а «Client.RU» в карточке компании совпадает с client.ru
          const domainFilter = companyDomainFilter(
            senderDomain(email.fromAddress),
          );

          // Отключённые компании не опознаются (isActive: $ne false) —
          // письмо/звонок падает на defaultCompany как неопознанное.
          // Сам defaultCompany выше намеренно без фильтра: машинный фолбэк
          // должен жить всегда (его отключение закрыто 409-гардом в UI).
          if (prefs.checkPhoneNumber && callerPhones.length) {
            company =
              (await MongoCompany.findOne({
                ...domainFilter,
                isActive: { $ne: false },
              })) || (await findByAnyPhone(callerPhones, findCompanyByPhone));
            if (company && isIncomingCall) ticketTitle = "Входящий звонок";
          } else {
            company = await MongoCompany.findOne({
              ...domainFilter,
              isActive: { $ne: false },
            });
          }
```

3f. Applicant address and the sender-check verdict. Replace (lines 681–689):

```js
        // определяем пользователя по email и телефону, если опция включена в глобальных настройках
        let emailAddress = email.from.match(
          /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
        );

        // иногда emailAddress возвращается как список
        if (Array.isArray(emailAddress)) {
          emailAddress = emailAddress[0];
        }
```

with:

```js
        // определяем пользователя по email и телефону, если опция включена в
        // глобальных настройках. Адрес — только fromAddress: первое похожее на
        // адрес в тексте From — это отображаемое имя, а его пишет кто угодно
        // («"boss@client.ru" <x@evil.com>» опознавался как boss)
        const emailAddress = email.fromAddress;
        // Вердикт проверки отправителя принимающим сервером
        // (services/mail/replyRouting): от него зависят и опознание заявителя
        // ниже, и судьба ответа в заявку
        const authVerdict = parseAuthResults(email.authResults);
```

`emailAddress` keeps its name, so the two applicant lookups below (`email: emailAddress`, lines
~701 and ~720) stay as they are. `""` matches no user.

3g. The applicant gate. Replace (line 691):

```js
        if (prefs.identifyApplicant) {
```

with:

```js
        // Письмо, провалившее проверку отправителя, заявителя не опознаёт — ни
        // по адресу, ни по телефону (services/mail/inbound#mayIdentifyApplicant):
        // подделка не откроет заявку от имени клиента и не пришлёт ему
        // уведомлений. Заявка остаётся за инициатором по умолчанию, компания
        // выше опознана как обычно
        if (
          mayIdentifyApplicant({
            identifyApplicant: prefs.identifyApplicant,
            authVerdict,
          })
        ) {
```

The body of this block (lines 692–726) is unchanged.

3h. Route the reply. Replace (lines 732–744):

```js
        const ticketNum = ticketNumFromSubject(ticketTitle);

        if (ticketNum !== null) {
          // Ответ на существующую заявку: отправителя ищем БЕЗ фильтра
          // активности компании — атрибуция комментария в старой заявке
          // не «выдача» и не опознание компании
          const sender = await MongoUser.findOne({
            email: emailAddress,
          });

          const ticket = await Ticket.findOne({ num: ticketNum });

          if (ticket && ticket.isClosed && email.fromMachine) {
```

with:

```js
        const ticketNum = ticketNumFromSubject(ticketTitle);

        // Метка заявки в теме — ответ в №ticketNum. Комментарием он станет,
        // только если его прислал участник заявки и письмо не провалило
        // проверку отправителя (services/mail/replyRouting). Иначе ответ
        // человека — обычная новая заявка, первая строка описания называет
        // №ticketNum и причину; в №ticketNum при этом не пишется ничего и её
        // участникам ничего не уходит. Непринятый робот заявкой не
        // становится — только строкой в логе №ticketNum. Письмо без метки —
        // новая заявка без пометки.
        let reply = { action: "newTicket", note: null };

        if (ticketNum !== null) {
          // Ответ на существующую заявку: отправителя ищем БЕЗ фильтра
          // активности компании — атрибуция комментария в старой заявке
          // не «выдача» и не опознание компании
          const sender = emailAddress
            ? await MongoUser.findOne({ email: emailAddress })
            : null;

          const ticket = await Ticket.findOne({ num: ticketNum });

          reply = planReply({
            ticketNum,
            ticket,
            sender,
            authVerdict,
            fromMachine: email.fromMachine,
            fromAddress: email.fromAddress,
          });

          if (reply.action === "autoReplyLog") {
```

The block comment and the rest of the closed-ticket auto-reply branch that follow (lines
745–767) stay unchanged, apart from 3i.

3i. The auto-reply log line names the address, not the display text. Replace (line 759):

```js
              event: `автоответ от ${email.from} в закрытую заявку — комментарий не создан`,
```

with:

```js
              event: `автоответ от ${email.fromAddress} в закрытую заявку — комментарий не создан`,
```

3j. A robot that isn't let in leaves only a log line. Replace (line 768):

```js
          } else if (ticket) {
```

with:

```js
          } else if (reply.action === "logOnly") {
            // Робот, которого в заявку не пустили (не участник или не прошёл
            // проверку отправителя), заявкой не становится: в логе №ticketNum —
            // одна строка с адресом, без текста письма. Заявки нет — след
            // только в журнале сервера
            if (ticket) {
              const logEntry = new TicketLog({
                ticket: ticketNum,
                ticketId: ticket._id,
                severity: "info",
                event: reply.note,
              });
              await logEntry.save();
            }

            logger.log("info", `Dropped an auto-reply to ticket ${ticketNum}`, {
              ...emailProcessingContext,
              fromAddress: email.fromAddress,
              note: reply.note,
            });
          } else if (reply.action === "comment") {
```

3k. Stamp the comment. Replace (lines 784–788):

```js
              createdBy: sender?._id || prefs.defaultApplicant?._id,
              updatedBy: sender?._id || prefs.defaultApplicant?._id,
            });

            await comment.save();
```

with:

```js
              createdBy: sender?._id || prefs.defaultApplicant?._id,
              updatedBy: sender?._id || prefs.defaultApplicant?._id,
              // Повтор того же письма узнаётся по нему (findImportedMessage)
              emailMessageId: email.messageId,
            });

            await comment.save();
```

3l. A missing ticket no longer drops a human's mail; the new-ticket branch becomes the
`newTicket` action. Replace (lines 817–826):

```js
            logger.log("info", `Added comment to ticket ${ticketNum}`, context);
          } else {
            logger.log(
              "error",
              `Can't add comment to non-existing ticket`,
              context,
            );
          }
        } else {
          const aiFeatures = resolveAiFeatures(prefs?.ai);
```

with:

```js
            logger.log("info", `Added comment to ticket ${ticketNum}`, context);
          }
        }

        if (reply.action === "newTicket") {
          if (reply.note) {
            logger.log(
              "warn",
              `Reply to ticket ${ticketNum} is filed as a new ticket`,
              {
                ...emailProcessingContext,
                fromAddress: email.fromAddress,
                authResults: email.authResults,
                note: reply.note,
              },
            );
          }

          const aiFeatures = resolveAiFeatures(prefs?.ai);
```

The rest of the former `else` body keeps its indentation. It closes with the same `}` at line
911, which now closes `if (reply.action === "newTicket")`.

3m. Stamp the ticket, prepend the note, show the real sender. Replace (lines 829–834):

```js
          const ticket = new Ticket({
            title: ticketTitle || "",
            description: email.description,
            htmlDescription: email.htmlDescription,
            isClosed: false,
            realSender: email.from,
```

with:

```js
          const ticket = new Ticket({
            title: ticketTitle || "",
            // Не принятый в заявку ответ несёт первой строкой, почему он здесь
            description: withRerouteNote(email.description, reply.note),
            htmlDescription: email.htmlDescription,
            isClosed: false,
            // Из разобранного From: показанный адрес — настоящий, а не из
            // отображаемого имени (services/mail/inbound#senderLine)
            realSender: email.realSender,
```

and replace (lines 845–846):

```js
            source: source,
            attachments: email.attachments,
```

with:

```js
            source: source,
            attachments: email.attachments,
            // Повтор того же письма узнаётся по нему (findImportedMessage)
            emailMessageId: email.messageId,
```

3n. Name the applicant in the new-ticket log. Replace (lines 899–904):

```js
          const logEntry = new TicketLog({
            ticketId: ticket._id,
            user: {
              firstName: ticket.applicant.firstName,
              lastName: ticket.applicant.lastName,
            },
```

with:

```js
          const logEntry = new TicketLog({
            ticketId: ticket._id,
            // Снимок ticket.applicant новым заявкам не пишется (legacy) — имя
            // берём у опознанного заявителя
            user: {
              firstName: applicant?.firstName,
              lastName: applicant?.lastName,
            },
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
- `cd backend && node --check middleware/emailHandling.js`
- `cd backend && node --test middleware/emailHandling.test.js`
- `cd backend && pnpm test`

Expected:
- `node --check`: no output;
- the guard: `pass 4`, `fail 0`;
- `pnpm test`: `fail 0`, including every test file from C1–C6.

Sanity grep: `grep -n "email\.from\b" middleware/emailHandling.js` prints exactly one line,
`emailFrom: email.from,` in the server-log context. That is the only remaining use of the raw
`From` text.

No end-to-end run: the owner checks mail intake by hand (static checks only).

- [ ] **Step 5: Update the UX guide (target behaviour) and its changelog**

The guide describes the target system only, one formulation per rule; history goes to the
changelog.

5a. `docs/ux-ui-guide.md`, section «Хроника: переписка и события одной лентой». Add a bullet
above this one. Replace (line 1380):

```md
- **Ответ письмом в закрытую заявку её НЕ открывает — он поднимает решение.**
```

with:

```md
- **Ответ письмом входит в заявку только от её участника.** Комментарием
  становится ответ заявителя, ответственного, человека из компании заявки или
  сотрудника — если письмо не провалило проверку отправителя (DMARC, SPF, DKIM
  по заголовку `Authentication-Results` принимающего сервера). Ответ со
  стороны — обычная новая заявка: первая строка её описания называет исходную
  заявку и причину («Письмо пришло ответом на заявку №N, но отправитель в ней
  не участвует», «…но не прошло проверку отправителя», «…но такой заявки
  нет»); в исходную заявку не пишется ничего, и её участникам ничего не
  уходит. Письмо, не прошедшее проверку, заявителя не опознаёт — такая заявка
  от инициатора по умолчанию. Номера заявок идут подряд: без этого правила
  любой писал бы в чужую заявку от имени клиента (`services/mail/replyRouting`).
- **Ответ письмом в закрытую заявку её НЕ открывает — он поднимает решение.**
```

5b. Same section. Replace the robot bullet (lines 1389–1396):

```md
- **Робота в этот сигнал не пускаем.** Автоответчик, список рассылки и отбойник
  о недоставке в закрытой заявке комментарием не становятся вовсе — только
  записью в лог (`services/machineMail`, отбор по заголовкам `Auto-Submitted`,
  `X-Autoreply`, `Precedence`, `List-Id`, пустой `Return-Path`). Иначе первая же
  заявка «настроить автоответ на почту» закрывается и тут же дёргает человека
  собственным автоответом, ради которого её и заводили. Ошибаться этот отбор
  может только в безопасную сторону: пропустить робота, но никогда не записать
  человека в роботы.
```

with:

```md
- **Робота в этот сигнал не пускаем.** Автоответчик, список рассылки и отбойник
  о недоставке в закрытой заявке комментарием не становятся вовсе — только
  записью в лог (`services/machineMail`, отбор по заголовкам `Auto-Submitted`,
  `X-Autoreply`, `Precedence`, `List-Id`, `List-Unsubscribe`, пустой
  `Return-Path`). Иначе первая же заявка «настроить автоответ на почту»
  закрывается и тут же дёргает человека собственным автоответом, ради которого
  её и заводили. Робот, которого в заявку не пустили (не участник или не прошёл
  проверку отправителя), не открывает и новую: в логе заявки остаётся строка с
  одним адресом («автоответ от … не принят: …»), а если такой заявки нет — след
  только в журнале сервера. Ошибаться этот отбор может только в безопасную
  сторону: пропустить робота, но никогда не записать человека в роботы.
```

5c. Same file, section «Письмо-уведомление тоже интерфейс». Replace (lines 2270–2274):

```md
- **Служебное — только там, где работает.** Маркер «пишите ответ выше» стоит
  ровно в тех письмах, ответ на которые вернётся в систему: тема называет
  заявку (`[F1-HD-51713]`), и ответ станет комментарием — по маркеру отрезается
  цитата. В коде подтверждения, письме об отсутствии, отчёте на согласование
  отвечать некуда, и строка обещает переписку, которой не будет.
```

with:

```md
- **Служебное — только там, где работает.** Маркер «пишите ответ выше» стоит
  ровно в тех письмах, ответ на которые вернётся в систему: тема называет
  заявку (`[F1-HD-51713]`), и ответ её участника станет комментарием — по
  маркеру отрезается цитата. В коде подтверждения, письме об отсутствии,
  отчёте на согласование отвечать некуда, и строка обещает переписку, которой
  не будет.
```

5d. `docs/ux-ui-changelog.md`: a new entry at the top of the list (reverse chronology).
Replace (line 13):

```md
- **2026-09-30** — **Телефоны: в базе цифры, на экране один вид.** Макет
```

with:

```md
- **2026-09-30** — **Ответ письмом — только от участника заявки**: остальное
  заводится новой заявкой со ссылкой на №N, робот — строкой в её логе. См.
  «Хроника: переписка и события одной лентой».

- **2026-09-30** — **Телефоны: в базе цифры, на экране один вид.** Макет
```

If another W1 section has already put its entry above «Телефоны…», the anchor still matches.
Entries from the same day may go in either order.

Check:
- `grep -c "Ответ письмом входит в заявку только от её участника" docs/ux-ui-guide.md` → `1`;
- `grep -c "List-Unsubscribe" docs/ux-ui-guide.md` → at least `1`;
- `grep -c "Ответ письмом — только от участника заявки" docs/ux-ui-changelog.md` → `1`.

- [ ] **Step 6: Leave uncommitted**

Changed:
- `backend/middleware/emailHandling.js`
- `docs/ux-ui-guide.md`
- `docs/ux-ui-changelog.md`

New:
- `backend/middleware/emailHandling.test.js`

No commit.

---

### Notes for other sections and for rollout

- **New exports others may rely on:**
  - `TICKET_SUBJECT_PREFIX` and `ticketSubjectTag(num)` from `services/emailReplyStripper.js`,
    the one place for the tag. W2 turns the prefix into a setting; any new ticket e-mail must
    use `ticketSubjectTag`.
  - `services/mail/replyRouting.js` (`parseAuthResults`, `planReply`, …) and
    `services/mail/inbound.js` (`senderAddress`, `senderLine`, `mayIdentifyApplicant`, …),
    both new.
- **`services/mail/outbox.js`** is not edited here, but `textBody` now puts the reply marker
  only on `[F1-HD-<digits>]` subjects, which is still true for all 14 ticket subjects. If the
  jobs section (outbox lease) edits `outbox.js`, it should keep the `ticketNumFromSubject`
  import.
- **mailparser upgrade (§6 dependencies):** `services/mail/inbound.test.js` and
  `services/machineMail.test.js` parse real messages with `simpleParser`. Re-run them after the
  bump: they break if `from.value`, `messageId`, the `authentication-results` array, or the
  folded `list` key change shape.
- **`isEndUser` boolean (§2):** `isTicketParticipant` treats only `isEndUser === false` as
  staff, which is consistent with making the field strictly boolean.
- **`middleware/notifications.js`:** C1 adds one import after line 18 and rewrites 14
  subject literals. Merge with any other section that edits that file (for example the
  e-mail-change notice, if it lands there).
- **`docs/ux-ui-changelog.md`:** C6 inserts its entry above the first entry of the list. Other
  sections adding a UX changelog entry (for example the read-only e-mail in «Мой аккаунт») use
  the same spot; keep both.
- **Rollout:**
  - two sparse indexes are built by `autoIndex` at the first start;
  - no data migration;
  - a human's reply from an outsider, or one that fails DMARC, now shows up as a new ticket
    whose description starts with «Письмо пришло ответом на заявку №N, но …»;
  - a robot's reply that isn't let in shows up only as a log line on #N;
  - mail that fails DMARC no longer opens a ticket in the name of the address it claims.

### Operator notes

- The organisation's own sending domain should publish DMARC with `p=quarantine` or
  `p=reject`. Otherwise a forged «staff» reply gets `none` and meets only the participant check.

## Section D — Availability, jobs, logs, secrets

**Spec coverage.** §6 "Availability" without the Express body limits (another section owns them):
linear-time text helpers (S12 and the cubic markdown regex) and the backend dependency upgrades
(S15 part), including the multer `fieldSize` of 10 MB from D5. §7 "Background jobs" (O7). §8
"Logs, secrets, keys" (S11, S14, the O6 part). D6 (deploy.sh keeps no `MIKROTIK_ENC_KEY`
carry-over) needs no task.

**Conventions for this section.**
- Paths are relative to the root of the W1 worktree (D7). Backend commands run in `backend/`,
  tg-service commands in `tg-service/`.
- Nothing is committed or pushed. Each task ends by listing the files it leaves changed.
- The code below contains no backslash-u escape sequences, and it must stay that way: the
  Write/Edit tools turn such an escape into the raw character, and a raw U+2028 inside a regex
  literal is a SyntaxError. Where a pattern must stop at line terminators, it uses `.` instead,
  which excludes all four JavaScript line terminators.
- Backend `pnpm test` globs `auth`, `services`, `validations`, `helpers`, `middleware` and
  `routes`. Task D6 adds `controllers`.
- **How the code below was checked.** A script parsed this section and applied every
  instruction to a fresh export of `b3b20cf`: 61 actions (creates, edits, the app.js splice and
  the `sed` steps). The results:
  - With the D2 dependency versions, the backend passed 765 of 765 tests: 708 existing plus 57
    new. The `pnpm test` script included the `controllers` glob added in D6.
  - tg-service passed 14 of 14, and `tsc` was clean.
  - app.js was smoke-run without Mongo: 18 jobs, and SIGTERM led to exit 0.
  - `docker compose config` accepted compose.yml.
  - Every new test was also run against the unchanged code, and it fails as its Step 2 says.

**Regions of `backend/app.js` touched here (Task D3 only):**
- the `.catch` of the `mongoose.connect(...)` chain, lines 216–218;
- everything from `// check email for new tickets` (line 220) to the end of the file (line 694).

Nothing above line 216 changes, so the better-auth mount and the body parsers (~109–120) stay
free for the other sections. **For the other sections:** the local `guardedCron` function goes
away. Any new cron must be registered with `jobs.register(...)`, which has the same arguments.

The tasks are independent and can run in any order. Only D2 needs the network (`pnpm add`, with
the sandbox off).

---

### Task D1: Linear-time text helpers (backend and tg-service)

**Files:**
- Create: `backend/helpers/textScan.js`
- Create: `backend/helpers/textScan.test.js`
- Create: `backend/helpers/markdownToPlainText.test.js`
- Modify: `backend/helpers/htmlToPlainText.js` — whole file (72 lines; both exports keep their signatures)
- Modify: `backend/helpers/markdownToPlainText.js` — whole file (37 lines)
- Modify: `tg-service/src/bot/text.ts` — whole file (50 lines; `plainText` keeps its signature)
- Test: `backend/helpers/htmlToPlainText.test.js` (append), `tg-service/src/bot/text.test.ts` (import line on line 5, plus an appended block)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `backend/helpers/textScan.js` exports:
    - `MAX_INPUT_LENGTH` (= 262144 characters);
    - `clampInput(text: string): string`;
    - `stripTags(text: string, replacement: string): string`;
    - `stripBlocks(text: string, names: string[], replacement: string): string`.
  - These keep their signatures: `htmlToPlainText(html = "")`, `htmlToPlainLines(html = "",
    limit = 0)`, `markdownToPlainText(markdown = "")` and the tg-service `plainText(html:
    unknown, limit = 0)`. tg-service `text.ts` also exports `MAX_INPUT_LENGTH`.
  - Callers need no change: `deriveTicketTitle.js`, `ticketQuestionnaire.js`,
    `inAppNotifications.js`, `middleware/notifications.js`, `services/mcp/text.js`,
    `knowledgeNote.js`, `ticketAiTerms.js` and `tg-service/src/bot/render.ts`.

**Design decisions (checked against the code):**
- **Output stays identical.** The spec's `/<[^<>]*>/g` would change the output for text like
  `a < b < c > d` or `<>`, which Markdown notes do contain. So `stripTags` reproduces the old
  `/<[^>]+>/g` exactly, in one pass: the nearest `>` is found once and reused. `stripBlocks` does
  the same for the `<style>`/`<script>` regexes with an `exec`/`lastIndex` loop. A differential
  fuzz of 500 000 random inputs against the old regexes found no mismatch in `stripTags`,
  `stripBlocks` or the three public helpers.
- **The markdown helper had more super-linear regexes than the table rule.** At 20 KB each:
  - the table rule `^\s*\|?[\s:|-]+\|?\s*$` is cubic: 2 000 spaces plus `x` took 4.5 s;
  - list markers `^\s*([-*+]|\d+\.)\s+` are quadratic on blank lines, because `\s*` crosses
    them: 336 ms;
  - images and links `!?\[…\]\([^)]*\)` are quadratic on `![](`×N or `[](`×N: 128 ms;
  - tags are quadratic on `<`×N: 268 ms.

  The fixes, in the same order:
  - a per-line check, `.replace(/.+/g, …)` plus `/^[\s:|-]+$/`;
  - `^(?:(?=.)\s)*` (whitespace inside the line);
  - `unwrapLinks`, an exact one-pass emulation with cached `]` and `)` positions;
  - `stripTags`.

  Their output is the same, apart from whitespace that the final `\s+` → `" "` collapses anyway.
- **Pasted images are cut out first.** Toast UI puts a pasted screenshot inline as a base64
  data URI, both into ticket HTML and into KB Markdown (`services/mcp/knowledgeTools.js` says as
  much). `clampInput` removes those payloads before the 256 K cut: one screenshot at the top
  would otherwise push all of the text past the cut, leaving an empty derived title, an empty
  Telegram card and KB search text with the words missing. For every input the old code
  handled, the payload sits inside a tag or a link that is removed whole, so the output doesn't
  change.
- **Speed.** Measured on 1 MB of crafted input (`<`, `<style`, `<script`, spaces plus `x`,
  newlines, `![](`, `~~~`, U+2028 runs): the worst case took 39 ms, against the spec's target of
  100 ms. The tests allow 500 ms, so a loaded machine doesn't flake them. The old code took
  seconds to hours on the same inputs, so 500 ms still tells linear from super-linear.

- [ ] **Step 1: Write the failing tests**

Create `backend/helpers/textScan.test.js`:

````js
// node --test helpers/textScan.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_INPUT_LENGTH,
  clampInput,
  stripTags,
  stripBlocks,
} = require("./textScan");

// Прежние регулярки — эталон поведения. На коротких входах они быстрые, и
// новый разбор обязан совпадать с ними символ в символ.
const legacyTags = (text, replacement) => text.replace(/<[^>]+>/g, replacement);
const legacyStyle = (text) => text.replace(/<style[\s\S]*?<\/style>/gi, " ");
const legacyBlocks = (text) =>
  text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");

const TRICKY = [
  "",
  "без тегов",
  "<p>Первый</p><p>Второй</p>",
  '<a href="x">ссылка</a> и <b>жирный</b>',
  "a <> b",
  "<<>",
  "a < b < c > d",
  "<a <b>текст</b>",
  "хвост <незакрытый",
  "><>",
  "<br/><br />",
  "<p>1</p>\n<p>2</p>",
];

test("stripTags совпадает с /<[^>]+>/g, включая кривые случаи", () => {
  for (const sample of TRICKY) {
    assert.equal(stripTags(sample, " "), legacyTags(sample, " "), sample);
    assert.equal(stripTags(sample, ""), legacyTags(sample, ""), sample);
  }
});

const BLOCKS = [
  "<style>p{color:red}</style>текст",
  "<STYLE type='x'>a</Style>текст<script>alert(1)</SCRIPT>ещё",
  "<style>без закрытия <script>x</script> после",
  "<script>a</script><style>b</style><script>c",
  "<style>a</script>b</style>",
  "<stylesheet>не блок</stylesheet> и <style>блок</style>",
  "<style>1</style><style>2</style>",
  "текст без блоков",
];

test("stripBlocks совпадает с прежними регулярками style/script", () => {
  for (const sample of BLOCKS) {
    assert.equal(stripBlocks(sample, ["style"], " "), legacyStyle(sample), sample);
    assert.equal(
      stripBlocks(sample, ["style", "script"], " "),
      legacyBlocks(sample),
      sample,
    );
  }
});

test("clampInput вырезает base64-вставки и обрезает вход до предела", () => {
  const image = `data:image/png;base64,${"A".repeat(300 * 1024)}`;
  assert.equal(clampInput(`<img src="${image}">текст`), '<img src="">текст');
  assert.equal(clampInput("x".repeat(MAX_INPUT_LENGTH + 10)).length, MAX_INPUT_LENGTH);
  assert.equal(clampInput("короткий"), "короткий");
});

// Спека требует < 100 мс на мегабайт. Порог в тесте — 500 мс, чтобы загруженная
// машина не давала ложных падений: прежний код на тех же входах думал секунды
// и часы, так что граница всё равно отделяет линейное от квадратичного.
const LINEAR_BOUND_MS = 500;
const MB = 1024 * 1024;

const elapsed = (fn) => {
  const started = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

test("мегабайт враждебного ввода разбирается за линейное время", () => {
  const inputs = {
    "<×N": "<".repeat(MB),
    "<style×N": "<style".repeat(MB / 8),
    "<script×N": "<script".repeat(MB / 8),
    "<a ×N": "<a ".repeat(MB / 4),
  };
  for (const [label, input] of Object.entries(inputs)) {
    const ms = elapsed(() => {
      stripTags(input, " ");
      stripBlocks(input, ["style", "script"], " ");
      stripBlocks(input, ["style"], " ");
    });
    assert.ok(ms < LINEAR_BOUND_MS, `${label}: ${ms.toFixed(1)} мс`);
  }
});
````

Create `backend/helpers/markdownToPlainText.test.js`:

````js
// node --test helpers/markdownToPlainText.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { markdownToPlainText } = require("./markdownToPlainText");
const { MAX_INPUT_LENGTH } = require("./textScan");

// Прежняя реализация — эталон: на обычных заметках новый разбор обязан
// совпадать с ней символ в символ.
const legacyMarkdownToPlainText = (markdown) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|\*|__|_|~~)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SAMPLES = [
  "# Заголовок\n\nТекст **жирный** и _курсив_, ~~зачёркнутый~~.",
  "## Сервер\n\n| Имя | Адрес |\n|---|:---:|\n| srv-dc01 | контроллер |\n\n---\n\nПосле таблицы",
  "- первый\n- второй\n  * вложенный\n1. нумерованный\n\n\n+ плюс",
  "> цитата\n>> вложенная\nобычная строка",
  "Код `npm ci` и блок:\n```bash\nrm -rf /\n```\nи ~~~\nещё\n~~~ конец",
  "[ссылка](https://example.ru/a_(b)) и ![скриншот](data:image/png;base64,iVBORw0KGgo=)",
  "[![значок](img.png)](https://example.ru) и [пустая]()",
  "Стрелки <- назад и -> вперёд, a < b < c > d, <b>тег</b>",
  "Строка с отступом\n    - не список ли?\n\t- с табом",
  "Пусто\n\n\n\n\nПосле пустых строк",
  "Кириллица и символ 𝔸 вне BMP в конце",
];

test("совпадает с прежним разбором на обычных заметках", () => {
  for (const sample of SAMPLES) {
    assert.equal(markdownToPlainText(sample), legacyMarkdownToPlainText(sample), sample);
  }
});

test("пустое и не-строка — пустая строка", () => {
  assert.equal(markdownToPlainText(""), "");
  assert.equal(markdownToPlainText(null), "");
  assert.equal(markdownToPlainText(42), "");
});

test("скриншот в начале заметки не съедает предел входа", () => {
  const note = `![схема](data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)})\n\nПароль от роутера у администратора`;
  assert.equal(markdownToPlainText(note), "схема Пароль от роутера у администратора");
});

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на «пробелы + x» в
// 3000 знаков 14 секунд (кубически), на остальных входах — квадратично.
test("мегабайт враждебного ввода разбирается за линейное время", () => {
  const MB = 1024 * 1024;
  const inputs = {
    "пробелы+x": `${" ".repeat(MB)}x`,
    "переводы строк": "\n".repeat(MB),
    "перевод+пробел": `${"\n ".repeat(MB / 2)}x`,
    "![](×N": "![](".repeat(MB / 4),
    "[](×N": "[](".repeat(MB / 3),
    "![×N": `${"![".repeat(MB / 2)}]x`,
    "<×N": "<".repeat(MB),
    "~~~×N": `${"~~~".repeat(MB / 3)}x`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    const started = process.hrtime.bigint();
    markdownToPlainText(input);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 500, `${label}: ${ms.toFixed(1)} мс`);
  }
});
````

Append to the end of `backend/helpers/htmlToPlainText.test.js`, after one blank line. The eight existing tests stay as they are:

````js
// ── Линейный разбор (helpers/textScan) ─────────────────────────────────────

const { MAX_INPUT_LENGTH } = require("./textScan");

// Прежние реализации — эталон: на обычных описаниях новый разбор обязан
// совпадать с ними символ в символ.
const legacyPlainText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const legacyPlainLines = (html) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

const SAMPLES = [
  "<p>Первый</p><p>Второй</p>",
  "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
  "<p>Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt; &quot;да&quot; &#39;нет&#39;</p>",
  "<style>p{color:red}</style><p>После стиля</p><script>alert(1)</script>хвост",
  "<STYLE>a</STYLE>Текст<br/>строка<br >ещё",
  "<div><span>(</span>Единая база</div><h2>Заголовок</h2><blockquote>цитата</blockquote>",
  "a < b < c > d и <>",
  "<p>Незакрытый <b тег",
  "Без разметки,\n  с переводом\t\tстроки",
  "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>",
  '<p><a href="https://example.ru/?a=1&amp;b=2">ссылка</a></p>',
];

test("htmlToPlainText/htmlToPlainLines совпадают с прежним разбором", () => {
  for (const sample of SAMPLES) {
    assert.equal(htmlToPlainText(sample), legacyPlainText(sample), sample);
    assert.equal(htmlToPlainLines(sample), legacyPlainLines(sample), sample);
  }
});

test("скриншот в начале описания не съедает предел входа", () => {
  const html = `<p><img src="data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)}"></p><p>Не печатает принтер</p>`;
  assert.equal(htmlToPlainText(html), "Не печатает принтер");
  assert.equal(htmlToPlainLines(html), "Не печатает принтер");
});

test("вход длиннее предела обрезается до него", () => {
  const huge = "слово ".repeat(MAX_INPUT_LENGTH / 3);
  assert.ok(htmlToPlainText(huge).length <= MAX_INPUT_LENGTH);
  assert.ok(htmlToPlainLines(huge).length <= MAX_INPUT_LENGTH);
});

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на этих входах от
// секунд до десятков минут, так что граница всё равно отделяет линейное от
// квадратичного.
test("мегабайт враждебного ввода разбирается за линейное время", () => {
  const MB = 1024 * 1024;
  const inputs = {
    "<×N": "<".repeat(MB),
    "<style×N": "<style".repeat(MB / 8),
    "<script×N": "<script".repeat(MB / 8),
    "пробелы+x": `${" ".repeat(MB)}x`,
    "<br+пробелы": `<br${" ".repeat(MB)}`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    const started = process.hrtime.bigint();
    htmlToPlainText(input);
    htmlToPlainLines(input, 1000);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 500, `${label}: ${ms.toFixed(1)} мс`);
  }
});
````

In `tg-service/src/bot/text.test.ts`, replace line 5

````ts
import { plainText } from "./text.ts";
````

with

````ts
import { MAX_INPUT_LENGTH, plainText } from "./text.ts";
````

and append to the end of the file, after one blank line:

````ts
// ── Линейный разбор ────────────────────────────────────────────────────────

// Прежняя реализация — эталон: на обычных описаниях новый разбор обязан
// совпадать с ней символ в символ.
const legacyPlainText = (html: unknown, limit = 0): string => {
  const text = String(html ?? "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!limit || text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

const SAMPLES = [
  "<p>Первый</p><p>Второй</p>",
  "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
  '<div class="x">Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</div>',
  "<ul><li>Первый</li><li>Второй</li></ul>",
  "<style>p{color:red}</style><p>После стиля</p><script>alert(1)</script>",
  "<STYLE>a</STYLE>Текст<br/>строка<br >ещё",
  "a < b < c > d",
  "<p>Незакрытый <b тег",
  "Без разметки,\n  с переводом\t\tстроки",
  "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>",
  `<p>${"слово ".repeat(40)}</p>`,
];

test("совпадает с прежней реализацией на обычных описаниях", () => {
  for (const sample of SAMPLES) {
    assert.equal(plainText(sample), legacyPlainText(sample), sample);
    assert.equal(plainText(sample, 40), legacyPlainText(sample, 40), sample);
  }
});

test("скриншот в начале описания не съедает предел входа", () => {
  const html = `<p><img src="data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)}"></p><p>Не печатает принтер</p>`;
  assert.equal(plainText(html), "Не печатает принтер");
});

test("вход длиннее предела обрезается", () => {
  assert.ok(plainText("x".repeat(MAX_INPUT_LENGTH * 2)).length <= MAX_INPUT_LENGTH);
});

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на этих входах секунды
// и минуты, так что граница всё равно отделяет линейное от квадратичного.
test("мегабайт враждебного ввода разбирается за линейное время", () => {
  const MB = 1024 * 1024;
  const inputs: Record<string, string> = {
    "<×N": "<".repeat(MB),
    "<style×N": "<style".repeat(MB / 8),
    "<script×N": "<script".repeat(MB / 8),
    "пробелы+x": `${" ".repeat(MB)}x`,
    "<br+пробелы": `<br${" ".repeat(MB)}`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    const started = performance.now();
    plainText(input, 600);
    const ms = performance.now() - started;
    assert.ok(ms < 500, `${label}: ${ms.toFixed(1)} мс`);
  }
});
````

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && node --test helpers/textScan.test.js helpers/htmlToPlainText.test.js helpers/markdownToPlainText.test.js`
Expected: all three files fail at load with `Error: Cannot find module './textScan'`.

Run: `cd tg-service && node --test src/bot/text.test.ts`
Expected: `SyntaxError: The requested module './text.ts' does not provide an export named 'MAX_INPUT_LENGTH'`.

- [ ] **Step 3: Implement**

Create `backend/helpers/textScan.js`:

````js
/**
 * Разбор текста за линейное время — общие части htmlToPlainText,
 * htmlToPlainLines и markdownToPlainText.
 *
 * Прежние регулярки пересканировали хвост строки от каждого кандидата:
 * `<[^>]+>` на «<» ×40 000 думала секунды, `<style[\s\S]*?<\/style>` без
 * закрывающего тега — квадратично. Текст приходит из писем и с портала, то есть
 * от кого угодно, и разбирается в кронах уведомлений. Здесь те же правила, но
 * каждый символ просматривается константное число раз, а результат совпадает с
 * прежними регулярками символ в символ.
 *
 * Близнец в tg-service — `src/bot/text.ts`: своей копии бэкенда у сервиса нет.
 */

/**
 * Предел входа. Помощники кормят темы, превью, уведомления и контекст ИИ —
 * дальше четверти мегабайта никто из них не читает.
 */
const MAX_INPUT_LENGTH = 256 * 1024;

// Вставленная картинка — data:-URL прямо в тексте (Toast UI так кладёт
// скриншоты и в HTML описания, и в Markdown заметки): сотни килобайт base64,
// которые в результат не попадают никогда — тег или ссылка снимаются целиком.
// Вырезаем их ДО обрезки: иначе один скриншот в начале съел бы весь предел, и
// тема заявки вышла бы пустой. Классы без «:» — прогон от одного «data:» не
// заходит в следующий, поэтому линейно.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

/** Вход, приведённый к пределу: без base64-вставок и не длиннее MAX_INPUT_LENGTH. */
const clampInput = (text) => {
  const compact = text.replace(DATA_URI, "");
  return compact.length > MAX_INPUT_LENGTH
    ? compact.slice(0, MAX_INPUT_LENGTH)
    : compact;
};

/**
 * То же, что `text.replace(/<[^>]+>/g, replacement)`, за один проход: ближайшая
 * «>» ищется один раз, а не заново от каждого «<».
 */
const stripTags = (text, replacement) => {
  let out = "";
  let from = 0;
  let open = text.indexOf("<");

  while (open !== -1) {
    const close = text.indexOf(">", open + 1);
    // Закрывающих дальше нет — значит, и тегов больше нет
    if (close === -1) break;

    // «<>» тегом не считался: [^>]+ требует хотя бы один символ
    if (close === open + 1) {
      open = text.indexOf("<", close);
      continue;
    }

    out += text.slice(from, open) + replacement;
    from = close + 1;
    open = text.indexOf("<", from);
  }

  return out + text.slice(from);
};

/**
 * То же, что `replace(/<(style|script)[\s\S]*?<\/\1>/gi, replacement)` (для
 * одного имени — `/<style[\s\S]*?<\/style>/gi`), но без пересканирования: если
 * у открывающего тега нет закрывающего, дальше его нет и у всех следующих
 * тегов с тем же именем — повторно не ищем.
 *
 * @param {string} text
 * @param {string[]} names имена блоков в нижнем регистре
 * @param {string} replacement
 */
const stripBlocks = (text, names, replacement) => {
  const open = new RegExp(`<(${names.join("|")})`, "gi");
  const closers = new Map(
    names.map((name) => [name, new RegExp(`</${name}>`, "gi")]),
  );
  const exhausted = new Set();
  let out = "";
  let from = 0;
  let match;

  while ((match = open.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    if (exhausted.has(name)) continue;

    const closer = closers.get(name);
    closer.lastIndex = open.lastIndex;
    const end = closer.exec(text);
    if (!end) {
      exhausted.add(name);
      if (exhausted.size === names.length) break;
      continue;
    }

    out += text.slice(from, match.index) + replacement;
    from = closer.lastIndex;
    open.lastIndex = from;
  }

  return out + text.slice(from);
};

module.exports = { MAX_INPUT_LENGTH, clampInput, stripTags, stripBlocks };
````

Replace the whole of `backend/helpers/htmlToPlainText.js`. Check first:
`sha256sum backend/helpers/htmlToPlainText.js` must print
`68cad1b7110d16d424fb3cec4e6588e1921c688d31c9a5ba66f9fdda12a6207d`, which is the file at
`b3b20cf`. Any other value means someone changed the file, so merge by hand instead of
overwriting. The new content:

````js
const { clampInput, stripTags, stripBlocks } = require("./textScan");

// Снимает HTML-теги и базовые entity, оставляя текст для глобального поиска.
// Всё вместе одной строкой: поиску переводы строк не нужны, а лишние пробелы
// мешают. Где строки важны (Telegram) — `htmlToPlainLines` ниже.
//
// Теги и блоки <style>/<script> снимаются за линейное время (helpers/textScan):
// прежние регулярки на «<» ×40 000 думали секунды, а описание заявки приходит
// из письма от кого угодно.
module.exports.htmlToPlainText = (html = "") => {
  if (!html || typeof html !== "string") {
    return "";
  }

  const withoutBlocks = stripBlocks(
    stripBlocks(clampInput(html), ["style"], " "),
    ["script"],
    " ",
  );

  return stripTags(withoutBlocks, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * То же, но с сохранением строк: блочные теги и `<br>` становятся переводами
 * строк. Нужно там, где текст читают человеческими глазами, а разметку
 * переслать нельзя, — в Telegram: он понимает горстку тегов, а `<p>` роняет
 * всю отправку ошибкой разбора. Без переводов строк собранное из ответов
 * описание («ФИО: …», «Пропуск: …») склеилось бы в одну строку.
 *
 * Близнец `plainText` в tg-service (`src/bot/text.ts`): у сервиса своей копии
 * бэкенда нет, а карточку заявки он рисует сам.
 *
 * @param {string} html разметка описания или комментария
 * @param {number} [limit] предел длины; 0 — не обрезать
 * @returns {string}
 */
module.exports.htmlToPlainLines = (html = "", limit = 0) => {
  if (!html || typeof html !== "string") {
    return "";
  }

  const withBreaks = stripBlocks(clampInput(html), ["style", "script"], " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");

  const text = stripTags(withBreaks, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Амперсанд — последним, иначе «&amp;lt;» развернулся бы в тег
    .replace(/&amp;/gi, "&")
    // Сначала схлопываем пробелы: следующая замена ищет их по обе стороны
    // перевода строки, и на длинной серии пробелов без него была бы квадратичной
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!limit || text.length <= limit) {
    return text;
  }

  // Многоточие входит в лимит, а не прибавляется к нему (как у deriveTicketTitle)
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
};
````

Replace the whole of `backend/helpers/markdownToPlainText.js`. Check first:
`sha256sum backend/helpers/markdownToPlainText.js` must print
`431b6b0aa5b44501e9b00382f713de900d1368f13b38d4ac809765de9c08946d`. The new content:

````js
const { clampInput, stripTags } = require("./textScan");

/**
 * «[текст](адрес)» → «текст»; с маркером «![» — картинка. То же, что
 * `replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")`, но ближайшие «]» и «)» ищутся
 * один раз: регулярка от каждого «[» сканировала хвост до конца, и «[](» ×N
 * без единой «)» разбиралась квадратично.
 *
 * @param {string} text
 * @param {"![" | "["} marker
 */
const unwrapLinks = (text, marker) => {
  let out = "";
  let from = 0;
  let bracket = -1; // ближайшая «]» правее текущего кандидата
  let paren = -1; // ближайшая «)» правее «](»
  let at = text.indexOf(marker);

  while (at !== -1) {
    const label = at + marker.length;
    if (bracket < label) bracket = text.indexOf("]", label);
    // «]» дальше нет — ссылок тоже
    if (bracket === -1) break;

    if (text[bracket + 1] !== "(") {
      at = text.indexOf(marker, at + 1);
      continue;
    }

    if (paren < bracket + 2) paren = text.indexOf(")", bracket + 2);
    // «)» дальше нет — ни эта, ни следующие ссылки не закрываются
    if (paren === -1) break;

    out += text.slice(from, at) + text.slice(label, bracket);
    from = paren + 1;
    at = text.indexOf(marker, from);
  }

  return out + text.slice(from);
};

// Разделитель таблицы или горизонтальная линия: строка только из пробелов, «|»,
// «:» и «-». Проверяется построчно одним классом символов — прежняя
// `^\s*\|?[\s:|-]+\|?\s*$` делила пробелы между тремя квантификаторами и на
// «пробелы + x» работала кубически (3000 пробелов — 14 секунд).
const TABLE_RULE = /^[\s:|-]+$/;

// Снимает базовый Markdown-синтаксис, оставляя чистый текст для глобального
// поиска (plainText). Лёгкий стриппер без внешних зависимостей; каждый шаг —
// за линейное время (см. helpers/textScan).
module.exports.markdownToPlainText = (markdown = "") => {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }

  const withoutCode = clampInput(markdown)
    // блоки кода ```...``` и ~~~...~~~
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    // инлайн-код `...`
    .replace(/`([^`]*)`/g, "$1");

  // изображения ![alt](url) -> alt, затем ссылки [text](url) -> text
  const withoutLinks = unwrapLinks(unwrapLinks(withoutCode, "!["), "[");

  const text = withoutLinks
    // заголовки в начале строки (#, ##, ...)
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // цитаты >
    .replace(/^\s{0,3}>\s?/gm, "")
    // маркеры списков (-, *, +, 1.) в начале строки. Отступ — пробелы своей
    // строки: прежний `^\s*` захватывал и переводы строк, и серия пустых строк
    // разбиралась квадратично; результат тот же — лишние пробелы схлопнутся
    .replace(/^(?:(?=.)\s)*([-*+]|\d+\.)\s+/gm, "")
    // разделители таблиц и горизонтальные линии
    .replace(/.+/g, (line) =>
      TABLE_RULE.test(line) ? " " : line,
    )
    // вертикальные палки таблиц -> пробел
    .replace(/\|/g, " ")
    // эмфазис/зачёркивание ** * __ _ ~~
    .replace(/(\*\*|\*|__|_|~~)/g, "");

  // HTML-теги, если вдруг есть; затем схлопываем пробелы
  return stripTags(text, " ").replace(/\s+/g, " ").trim();
};
````

Replace the whole of `tg-service/src/bot/text.ts`. Check first:
`sha256sum tg-service/src/bot/text.ts` must print
`5c9206f73f4e3733d5b2f225a35ba034c47171481911c7964afa88f4731da4cf`. The new content:

````ts
/**
 * Текстовые преобразования без Telegram и без конфигурации — отдельным
 * модулем, чтобы их можно было проверять тестом: `render.ts` тянет `config`,
 * а тот при запуске требует токен бота.
 */

/**
 * Предел входа. Карточка заявки в Telegram — 4096 знаков на всё, дальше
 * четверти мегабайта описание читать незачем.
 */
export const MAX_INPUT_LENGTH = 256 * 1024;

// Вставленная картинка — data:-URL прямо в описании: сотни килобайт base64,
// которые в текст не попадают никогда. Вырезаем до обрезки, иначе скриншот в
// начале съел бы весь предел, и карточка вышла бы пустой.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

const clampInput = (text: string): string => {
  const compact = text.replace(DATA_URI, "");
  return compact.length > MAX_INPUT_LENGTH
    ? compact.slice(0, MAX_INPUT_LENGTH)
    : compact;
};

/**
 * То же, что `text.replace(/<[^>]+>/g, replacement)`, за один проход: ближайшая
 * «>» ищется один раз, а не заново от каждого «<». Регулярка на «<» ×40 000
 * думала секунды — описание приходит из письма от кого угодно.
 */
const stripTags = (text: string, replacement: string): string => {
  let out = "";
  let from = 0;
  let open = text.indexOf("<");

  while (open !== -1) {
    const close = text.indexOf(">", open + 1);
    if (close === -1) break;

    // «<>» тегом не считался: [^>]+ требует хотя бы один символ
    if (close === open + 1) {
      open = text.indexOf("<", close);
      continue;
    }

    out += text.slice(from, open) + replacement;
    from = close + 1;
    open = text.indexOf("<", from);
  }

  return out + text.slice(from);
};

/**
 * То же, что `replace(/<(style|script)[\s\S]*?<\/\1>/gi, replacement)`, но без
 * пересканирования: у тега без закрывающего его нет и у всех следующих.
 */
const stripBlocks = (
  text: string,
  names: string[],
  replacement: string,
): string => {
  const open = new RegExp(`<(${names.join("|")})`, "gi");
  const closers = new Map(
    names.map((name) => [name, new RegExp(`</${name}>`, "gi")] as const),
  );
  const exhausted = new Set<string>();
  let out = "";
  let from = 0;
  let match: RegExpExecArray | null;

  while ((match = open.exec(text)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const closer = closers.get(name);
    if (!closer || exhausted.has(name)) continue;

    closer.lastIndex = open.lastIndex;
    const end = closer.exec(text);
    if (!end) {
      exhausted.add(name);
      if (exhausted.size === names.length) break;
      continue;
    }

    out += text.slice(from, match.index) + replacement;
    from = closer.lastIndex;
    open.lastIndex = from;
  }

  return out + text.slice(from);
};

/**
 * HTML описания и комментариев → простой текст.
 *
 * Telegram понимает лишь горстку тегов (`b`, `i`, `a`, `code`…), а `<p>` и
 * `<div>` роняют ВСЮ отправку ошибкой разбора, поэтому разметку снимаем, а не
 * пересылаем. Блочные теги превращаются в переводы строк: без этого собранное
 * из ответов описание («ФИО: …», «Пропуск: …») склеилось бы в одну строку.
 *
 * Обрезаем по границе слова: длинное описание бывает на тридцать тысяч знаков
 * (логи бэкапа), а в сообщении всего 4096 на всю карточку.
 *
 * Близнец `htmlToPlainLines` бэкенда (helpers/htmlToPlainText.js +
 * helpers/textScan.js): тот же разбор за линейное время.
 *
 * @param html разметка описания или комментария
 * @param limit предельная длина результата; 0 — не обрезать
 */
export const plainText = (html: unknown, limit = 0): string => {
  const withBreaks = stripBlocks(
    clampInput(String(html ?? "")),
    ["style", "script"],
    " ",
  )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");

  const text = stripTags(withBreaks, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Амперсанд — последним, иначе «&amp;lt;» развернулся бы в тег
    .replace(/&amp;/gi, "&")
    // Сначала схлопываем пробелы: следующая замена ищет их по обе стороны
    // перевода строки и на длинной серии пробелов была бы квадратичной
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!limit || text.length <= limit) return text;

  // Многоточие входит в лимит, а не прибавляется к нему (как у темы заявки
  // на бэкенде)
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test helpers/textScan.test.js helpers/htmlToPlainText.test.js helpers/markdownToPlainText.test.js`
Expected: `# tests 20`, `# pass 20`, `# fail 0` (8 existing tests and 12 new ones).

Run: `cd tg-service && node --test src/bot/text.test.ts && pnpm typecheck`
Expected: `# tests 12`, `# pass 12`, then `tsc --noEmit` exits 0 with no output.

Run: `cd backend && pnpm test`
Expected: no failures. The callers' tests (`services/inAppNotifications.test.js`,
`services/mcp/text.test.js`, `services/ticketQuestionnaire.test.js`,
`services/mcp/knowledgeTools.test.js`) pass unchanged.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/helpers/textScan.js` (new)
- `backend/helpers/textScan.test.js` (new)
- `backend/helpers/markdownToPlainText.test.js` (new)
- `backend/helpers/htmlToPlainText.js`
- `backend/helpers/htmlToPlainText.test.js`
- `backend/helpers/markdownToPlainText.js`
- `tg-service/src/bot/text.ts`
- `tg-service/src/bot/text.test.ts`

---

### Task D2: Dependency upgrades — multer 2 with a 10 MB `fieldSize`, mailparser, nodemailer, and exceljs replacing xlsx

**Files:**
- Modify (through pnpm): `backend/package.json` (dependencies block, lines 46, 52, 55 and 64), `backend/pnpm-lock.yaml`
- Modify: `backend/middleware/fileUpload.js` (in `const fileUpload = multer({ limits: … })`, line 151)
- Modify: `backend/services/attachmentExtractor.js` (lines 1, 10, 47, 63–69, 112–113, 136)
- Create: `backend/middleware/fileUpload.test.js`
- Create: `backend/services/attachmentExtractor.test.js`
- Create: `backend/services/mail/mailLibraries.test.js`

**Interfaces:**
- Consumes: `storage.getObjectBuffer(name)` from `backend/services/storage.js`, the same as
  today.
- Produces:
  - `backend/services/attachmentExtractor.js` exports `collectAttachments`,
    `extractAttachments`, `extractDocumentText(buffer, mimetype): Promise<string|null>` and
    `MAX_DOC_BYTES` (= 10485760). The last two are new, for the test.
  - `fileUpload.limits` is `{ fileSize: 104857600, files: 10, fieldSize: 10485760 }`.
  - The frontend `xlsx` is not touched: it stays until W5.

**What was checked:**
- **multer 2.4.0**, read from the package:
  - The API is the same: `multer(options)`, `.single/.array/.fields/.none/.any`,
    `diskStorage`, `MulterError`, and the storage-engine contract (`_handleFile`,
    `_removeFile`). So `multer-s3` 3.0.1 and `services/storage.js` (`diskStorageWithKey`) keep
    working.
  - New: every `limits` value must be a non-negative integer or `Infinity`, or the
    constructor throws a TypeError. All of ours are integers:
    - `middleware/fileUpload.js`;
    - `middleware/imageUpload.js`: 15 MB, 5 MB and 2 MB;
    - `routes/gateway.js`: 200 MB.
  - Also new: the error codes `LIMIT_FIELD_NESTING`, `LIMIT_FIELD_ARRAY_INDEX`,
    `INVALID_FIELD_NAME` and `STREAM_DESTROYED`, and WHATWG decoding of `%0A`/`%0D`/`%22` in
    names.
  - `defParamCharset` stays `'latin1'` by default, so the latin1 → UTF-8 conversion in
    `controllers/gateway.js:98` stays right. `req.body` was already a null-prototype object in
    1.4.5-lts.2.
  - The only code change is `fieldSize`.
- **mailparser 3.9.32** has no breaking entries in its changelog since 3.7.2. It depends on
  nodemailer 10.0.13, whose address parser is patched. A crafted `From:` header made of 20 000
  `[x]` takes 2.3 s on 3.7.2 and 21 ms on 3.9.32. The fields we read are the same:
  `from.value`, `subject`, `messageId`, `text`, and `headers.get("list")`, which the
  inbound-mail section relies on.
- **nodemailer 7.0.2 → 10.x** (owner decision, see the box below) fixes, among others, two things in the address parser: a quoted local part
  used to be split into a different recipient (GHSA-mm7p-fcc7-pg87), and deeply nested groups
  used to overflow the stack (CVE-2025-14874). The test below pins both.
- **exceljs 4.4.0.** Reading an `.xlsx` is `new ExcelJS.Workbook(); await
  workbook.xlsx.load(buffer)`. `cell.text` isn't used, because it renders a Date with
  `Date.toString()`; `cellText` builds the CSV value itself.

> **Owner decision (2026-10-01): nodemailer 10.x** (`nodemailer@^10.0.13` in Step 3c). Background: the spec first said "the latest 7.x", and
> that would be 7.0.13. A `pnpm audit` on 2026-09-30 still reports 13 advisories against
> 7.0.13, three of them high. None of the fixes is backported to 7.x:
> - GHSA-p6gq-j5cr-w38f, the message-level `raw` option: fixed in 9.0.1;
> - GHSA-2x7j-588g-ccc2, a quadratic address list: fixed in 9.1.0;
> - GHSA-v53p-9fqp-m79j, a quadratic free-text fallback: fixed in 10.0.6.
>
> **Our exposure.** The sending path passes only our own `from/to/subject/text/html`, with no
> `raw` and no attachments by URL, so what's exposed is the address parser on recipient
> strings. Inbound mail is already covered by mailparser 3.9.32.
>
> **Breaking changes from 7 to 10.** None of them touches our code:
> - 8.0 renamed the error code `NoAuth` to `ENOAUTH`. `services/mail/transport.js` checks only
>   `EAUTH`, `ENOTFOUND`, `EDNS`, `ECONNREFUSED` and `EENVELOPE`.
> - 9.0 validates TLS when it fetches remote content. We fetch none.
> - 10.0 needs Node ≥ 20 (the images run Node 24), and its CJS build keeps
>   `require("nodemailer")` and `require("nodemailer/lib/addressparser")` working.
>
> The tests of this task were run on both 7.0.13 and 10.0.13 and pass on both. If the owner
> picks 10.x, use `nodemailer@^10.0.13` in Step 3c. Nothing else in this task changes.
>
> **exceljs.** After this task, `pnpm audit --prod` still shows one moderate advisory: `uuid`
> below 11.1.1, pulled in by exceljs. It concerns v3/v5/v6 called with a caller-supplied buffer,
> which exceljs doesn't do.

- [ ] **Step 1: Write the failing tests**

Create `backend/middleware/fileUpload.test.js`:

````js
// node --test middleware/fileUpload.test.js
//
// Описание заявки и текст комментария приходят multipart-полями вместе с
// вложениями: предел поля multer — это предел текста заявки (D5: 10 МБ).
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "S3_ENDPOINT"]) {
  delete process.env[name];
}

const fileUpload = require("./fileUpload");

const MB = 1024 * 1024;

const serve = async (t) => {
  const app = express();
  app.post("/tickets", fileUpload.array("files"), (req, res) =>
    res.json({ length: req.body.description.length }),
  );
  app.use((error, req, res, next) => res.status(400).json({ code: error.code }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/tickets`;
};

const postDescription = (url, description) => {
  const form = new FormData();
  form.append("description", description);
  return fetch(url, { method: "POST", body: form });
};

test("описание в 9 МБ проходит multipart", async (t) => {
  const url = await serve(t);

  const response = await postDescription(url, "а".repeat(9 * MB / 2));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { length: 9 * MB / 2 });
});

test("поле больше 10 МБ отвергается кодом LIMIT_FIELD_VALUE", async (t) => {
  const url = await serve(t);

  const response = await postDescription(url, "a".repeat(10 * MB + 1));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "LIMIT_FIELD_VALUE" });
});

test("пределы вложений прежние: 100 МБ на файл, 10 файлов", () => {
  assert.deepEqual(fileUpload.limits, {
    fileSize: 100 * MB,
    files: 10,
    fieldSize: 10 * MB,
  });
});
````

Create `backend/services/attachmentExtractor.test.js`:

````js
// node --test services/attachmentExtractor.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const storage = require("@/services/storage");
const {
  extractAttachments,
  extractDocumentText,
  MAX_DOC_BYTES,
} = require("./attachmentExtractor");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Книга собирается тем же exceljs — живой файл клиента в тест не кладём
const workbookBuffer = async () => {
  const workbook = new ExcelJS.Workbook();
  const servers = workbook.addWorksheet("Серверы");
  servers.addRow(["Имя", "Роль", "Заметка"]);
  servers.addRow(["srv-dc01", "контроллер домена", 'Касса, зал "2"']);
  servers.addRow([]);
  servers.addRow(["Итого", { formula: "1+1", result: 2 }, new Date(Date.UTC(2026, 11, 1))]);
  servers.getCell("A6").value = "Объединённая";
  servers.mergeCells("A6:B6");
  servers.getCell("A7").value = { richText: [{ text: "жирный " }, { text: "хвост" }] };
  servers.getCell("B7").value = { text: "ссылка", hyperlink: "https://example.ru" };
  workbook.addWorksheet("Пусто");
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

test("xlsx: лист — заголовком «# имя», непустые строки — CSV", async () => {
  const text = await extractDocumentText(await workbookBuffer(), XLSX_MIME);

  assert.equal(
    text,
    [
      "# Серверы",
      "Имя,Роль,Заметка",
      'srv-dc01,контроллер домена,"Касса, зал ""2"""',
      "Итого,2,2026-12-01",
      "Объединённая,",
      "жирный хвост,ссылка",
      "",
      "# Пусто",
      "",
    ].join("\n"),
  );
});

test("документ больше 10 МБ пропускается не читая", async (t) => {
  t.mock.method(storage, "getObjectBuffer", async () =>
    Buffer.alloc(MAX_DOC_BYTES + 1, "a"),
  );

  const result = await extractAttachments([
    { name: "huge.txt", originalName: "Лог.txt", mimetype: "text/plain" },
  ]);

  assert.deepEqual(result, { images: [], documents: [] });
});

test("документ в пределах 10 МБ читается как прежде", async (t) => {
  t.mock.method(storage, "getObjectBuffer", async () =>
    Buffer.from("Не печатает принтер в бухгалтерии", "utf8"),
  );

  const result = await extractAttachments([
    { name: "note.txt", originalName: "Заметка.txt", mimetype: "text/plain" },
  ]);

  assert.deepEqual(result.documents, [
    { name: "Заметка.txt", text: "Не печатает принтер в бухгалтерии" },
  ]);
});
````

Create `backend/services/mail/mailLibraries.test.js`:

````js
// node --test services/mail/mailLibraries.test.js
//
// Почтовые библиотеки — версии без известных дыр разбора адресов (S15).
// Тесты держат именно те места, которые чинили обновления: откат версии в
// lockfile снова их уронит.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const addressparser = require("nodemailer/lib/addressparser");

test("nodemailer: кавычки в локальной части не подменяют адрес получателя", () => {
  // До 7.0.7 разбиралось как victim@evil.example — письмо ушло бы не туда.
  // Кавычки 7.x снимает, 10.x оставляет; важен домен
  const [parsed] = addressparser('"victim@evil.example x"@internal.example');
  assert.match(parsed.address, /@internal\.example$/);
});

test("nodemailer: глубоко вложенные группы не роняют процесс", () => {
  // До 7.0.11 — RangeError: Maximum call stack size exceeded
  assert.doesNotThrow(() => addressparser(`${"g:".repeat(5000)}a@b.example`));
});

test("mailparser: заголовок From из мусора разбирается за линейное время", async () => {
  // mailparser 3.7.2 (addressparser из nodemailer 6.9.16) думал над этим
  // около 2 секунд; порог 500 мс — с запасом на загруженную машину
  const raw = `From: ${"[x]".repeat(20000)}\r\nTo: support@example.ru\r\nSubject: test\r\n\r\nbody\r\n`;
  const started = process.hrtime.bigint();
  await simpleParser(raw);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `${ms.toFixed(0)} мс`);
});

test("mailparser: обычное письмо разбирается в те же поля", async () => {
  const mail = await simpleParser(
    [
      "From: =?UTF-8?B?0JjQstCw0L0g0J/QtdGC0YDQvtCy?= <Ivan@Example.RU>",
      "To: support@example.ru",
      "Subject: =?UTF-8?B?0J3QtSDQv9C10YfQsNGC0LDQtdGC?=",
      "List-Id: <list.example.ru>",
      "Message-ID: <m1@example.ru>",
      "",
      "текст",
      "",
    ].join("\r\n"),
  );

  assert.deepEqual(mail.from.value, [{ address: "Ivan@Example.RU", name: "Иван Петров" }]);
  assert.equal(mail.subject, "Не печатает");
  assert.equal(mail.messageId, "<m1@example.ru>");
  assert.equal(mail.text, "текст\n");
  assert.deepEqual(mail.headers.get("list"), { id: { name: "list.example.ru" } });
});

test("nodemailer: письмо собирается тем же вызовом, что в services/mail/send.js", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });

  const info = await transport.sendMail({
    from: '"Служба поддержки" <hd@example.ru>',
    to: "user@example.ru",
    subject: "Заявка №51713",
    text: "",
    html: "<p>Готово</p>",
  });

  assert.deepEqual(info.envelope, { from: "hd@example.ru", to: ["user@example.ru"] });
  // Собранное письмо читается обратно тем же разборщиком, что и входящие
  const parsed = await simpleParser(info.message);
  assert.deepEqual(parsed.from.value, [{ address: "hd@example.ru", name: "Служба поддержки" }]);
  assert.equal(parsed.subject, "Заявка №51713");
  assert.equal(parsed.html, "<p>Готово</p>");
});
````

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && node --test middleware/fileUpload.test.js services/attachmentExtractor.test.js services/mail/mailLibraries.test.js`
Expected: 6 failures, 3 passes.
- `services/attachmentExtractor.test.js` fails at load with `Error: Cannot find module 'exceljs'`.
- «описание в 9 МБ проходит multipart» fails with `expected: 200` and `actual: 400`, because
  multer answers `LIMIT_FIELD_VALUE` at 2 MB.
- «пределы вложений прежние» fails: `fieldSize` is 2097152.
- These three mailLibraries tests fail:
  - the quoted local part: 7.0.2 returns `victim@evil.example`;
  - nested groups: `RangeError: Maximum call stack size exceeded`;
  - the crafted `From:`: about 2 300 ms against the 500 ms limit.
- These three pass, because they pin behaviour that must not change:
  - «поле больше 10 МБ…»;
  - «mailparser: обычное письмо…»;
  - «nodemailer: письмо собирается…».

- [ ] **Step 3: Implement**

3a. **Protect the main checkout.** A fresh worktree sometimes gets `backend/node_modules` as
a symlink into the main checkout, and `pnpm add` through that link would rewrite the main
checkout's packages. Run: `test -L backend/node_modules && rm backend/node_modules`. This
removes only the link, and `pnpm add` in 3c then builds a real `node_modules`. Leave
`tg-service/node_modules` alone: this task doesn't install anything there.

3b. **Look up the current versions.** The npm cache under `~` is read-only in the sandbox, so
point it at `$TMPDIR`:

```bash
cd backend
export npm_config_cache="$TMPDIR/npm-cache"
pnpm view multer version                # 2.4.0 on 2026-09-30
pnpm view mailparser version            # 3.9.32
pnpm view "nodemailer@^10" version | tail -n 1   # last line = latest 10.x (10.0.13 at planning time)
pnpm view exceljs version               # 4.4.0
```

3c. **Install.** Run this with the sandbox disabled: the pnpm store lives in `~/.local/share/pnpm`.
If 3b printed newer versions, use those:

```bash
cd backend
pnpm add multer@^2.4.0 mailparser@^3.9.32 nodemailer@^10.0.13 exceljs@^4.4.0
pnpm remove xlsx
```

Afterwards, `backend/package.json` has `"multer": "^2.4.0"`, `"mailparser": "^3.9.32"`,
`"nodemailer": "^10.0.13"` and `"exceljs": "^4.4.0"`, no `xlsx`, and an updated
`backend/pnpm-lock.yaml`. Leave `backend/package-lock.json` as it is. It is tracked, but it's a
stale npm lockfile, last touched in 6713dad and still listing `xlsx`. Nothing reads it: the
images install from `pnpm-lock.yaml`. Deleting it is the owner's call.

3d. **The multer field limit:**

Edit 1 — `backend/middleware/fileUpload.js`, current line 151. Replace:

````js
    fieldSize: 2 * 1024 * 1024, // 2MB для текстовых полей
````

with:

````js
    // Текстовые поля: описание заявки и комментарий приходят multipart вместе
    // с вложениями, поэтому предел поля — это предел их текста (как у JSON)
    fieldSize: 10 * 1024 * 1024,
````

3e. **`backend/services/attachmentExtractor.js`**, six edits:

Edit 1 — `backend/services/attachmentExtractor.js`, current line 1. Replace:

````js
const XLSX = require("xlsx");
````

with:

````js
const ExcelJS = require("exceljs");
````

Edit 2 — `backend/services/attachmentExtractor.js`, current line 10. Replace:

````js
const MAX_DOC_TEXT = 8000; // chars of extracted text kept per document
````

with:

````js
const MAX_DOC_TEXT = 8000; // chars of extracted text kept per document
// Documents larger than this are skipped unread: parsing cost grows with the
// file, and an .xlsx is a zip that inflates far beyond its size on disk.
const MAX_DOC_BYTES = 10 * 1024 * 1024;
````

Edit 3 — `backend/services/attachmentExtractor.js`, current line 47. Replace:

````js
const extractDocumentText = async (buffer, mimetype) => {
````

with:

````js
// Cell text for a CSV row: a formula gives its result, a date its ISO day
// (plus time when there is one), a merged range only its top-left cell.
const cellText = (cell) => {
  if (cell.type === ExcelJS.ValueType.Merge) return "";
  const raw = cell.value;
  const value =
    raw !== null && typeof raw === "object" && "result" in raw ? raw.result : raw;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z")
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (typeof value === "object") {
    const rich = (node) => (node?.richText || []).map((part) => part.text).join("");
    if (value.richText) return rich(value);
    // Hyperlink: the visible text, sometimes itself rich text
    if (value.text !== undefined) {
      return typeof value.text === "object" ? rich(value.text) : String(value.text);
    }
    if (value.error !== undefined) return String(value.error);
    return "";
  }
  return String(value);
};

const csvField = (text) =>
  /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

// Every sheet as "# <name>" and its non-empty rows as CSV lines — the shape the
// AI guide got from SheetJS before (sheet_to_csv per sheet).
const xlsxToText = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets
    .map((sheet) => {
      const rows = [];
      sheet.eachRow((row) => {
        const cells = [];
        for (let col = 1; col <= row.cellCount; col += 1) {
          cells.push(csvField(cellText(row.getCell(col))));
        }
        rows.push(cells.join(","));
      });
      return `# ${sheet.name}\n${rows.join("\n")}`;
    })
    .join("\n\n");
};

const extractDocumentText = async (buffer, mimetype) => {
````

Edit 4 — `backend/services/attachmentExtractor.js`, current lines 63–69. Replace:

````js
  if (mimetype === XLSX_MIME) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map(
      (sheet) =>
        `# ${sheet}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheet])}`,
    ).join("\n\n");
  }
````

with:

````js
  if (mimetype === XLSX_MIME) {
    return xlsxToText(buffer);
  }
````

Edit 5 — `backend/services/attachmentExtractor.js`, current lines 112–113. Replace:

````js
      const buffer = await storage.getObjectBuffer(att.name);
      const text = await extractDocumentText(buffer, att.mimetype);
````

with:

````js
      const buffer = await storage.getObjectBuffer(att.name);
      if (buffer.length > MAX_DOC_BYTES) {
        logger.log("warn", "AI guide: skipping oversized document", {
          name: att.name,
          bytes: buffer.length,
        });
        continue;
      }
      const text = await extractDocumentText(buffer, att.mimetype);
````

Edit 6 — `backend/services/attachmentExtractor.js`, current line 136. Replace:

````js
module.exports = { collectAttachments, extractAttachments };
````

with:

````js
module.exports = {
  collectAttachments,
  extractAttachments,
  extractDocumentText,
  MAX_DOC_BYTES,
};
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test middleware/fileUpload.test.js services/attachmentExtractor.test.js services/mail/mailLibraries.test.js`
Expected: `# tests 11`, `# pass 11`, `# fail 0`.

Run: `cd backend && pnpm test`
Expected: no failures.

Run: `grep -rn "xlsx" backend/package.json; grep -rn 'require("xlsx")' backend --include='*.js' --exclude-dir=node_modules`
Expected: no output.

Run (network, npm cache as in 3b): `cd backend && pnpm audit --prod`
Expected: no advisories for multer, mailparser, linkify-it, xlsx or nodemailer (10.x). Only
`uuid` through exceljs remains.


- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/package.json`
- `backend/pnpm-lock.yaml`
- `backend/middleware/fileUpload.js`
- `backend/services/attachmentExtractor.js`
- `backend/middleware/fileUpload.test.js` (new)
- `backend/services/attachmentExtractor.test.js` (new)
- `backend/services/mail/mailLibraries.test.js` (new)

The images must be rebuilt after deploy, because the lockfile changed.

---

### Task D3: Cron registry (no overlap, stopAll, drain), graceful shutdown, process handlers, `stop_grace_period`

**Files:**
- Create: `backend/services/jobs/guardedCron.js`
- Create: `backend/services/jobs/guardedCron.test.js`
- Modify: `backend/app.js`:
  - (a) the `.catch` of `mongoose.connect(...)`, lines 216–218;
  - (b) lines 220–694, from `// check email for new tickets` to the end of the file. These are
    replaced. They hold the IMAP poller with its own lock (220–255), the notification cron
    (257–303), the local `guardedCron` (317–367) and its 9 call sites, the secrets-scan cron
    (442–464), `registerMaintenanceCrons` with 6 hand-rolled locks (492–661), and `shutdown`
    (676–694).
- Modify: `compose.yml` (the backend service, after `init: true` on line 55)
- Modify: `docs/mikrotik-management.md` (lines 450–453), `docs/messaging.md` (line 245)

**Interfaces:**
- Consumes:
  - `cron.schedule(expression, fn, options)` and `cron.getTasks()` from node-cron 3.0.3.
    `getTasks()` returns the global `Map` of every task, including the routine tasks that
    `middleware/taskManager.js` registers.
  - `mongoose.connection.readyState` and `logger.log(level, message, meta)`.
- Produces:
  - `backend/services/jobs/guardedCron.js` exports `createCronRegistry({ schedule, log,
    isDbReady })`. It returns `{ register, stopAll, drain }`:
    - `register(name, expression, run, timeoutMs, { quietSkip = false, timezone } = {})`,
      where `timeoutMs` of 0 means no watchdog;
    - `stopAll()`;
    - `drain(timeoutMs): Promise<string[]>`, which resolves to the names still running.
  - `backend/app.js` gets the module-level `jobs`. Every job in app.js is registered through
    it, keeping its old name, expression and timeout.

**Behaviour, relative to today:**
- **The lock is held until `run()` settles.** A watchdog that fires only logs `<name> watchdog
  timeout: still running after N ms, next runs wait for it`. So runs never overlap, which is
  the spec's rule. The flip side: a run that never settles stops its own cron until the next
  restart. Every job with network I/O already has its own timeouts: IMAP `socketTimeout` 30 s,
  SMTP 15 + 10 + 30 s, and Mikrotik `POLL_DEADLINE_MS`, SSH `opTimeoutMs` and
  `AbortSignal.timeout`.
- **All 18 app.js crons go through the registry.** That includes the IMAP poller, which gets
  the same watchdog treatment, the 10-second notification cron, the hourly secrets scan and
  the 6 nightly jobs, which keep their business-timezone option. This is what lets shutdown
  wait for them.
  - **Every job now gets the DB gate.** A tick while Mongo is down is skipped silently; the IMAP
    poller had no gate at all.
  - **The level of "skipped, still running" messages.** It stays `warn` by default. Jobs that
    used to skip silently, or at `debug`, now log at `debug` (`quietSkip`).
  - **A failed run is logged as `<name> run failed` with `{ error }`.**
- **SIGTERM/SIGINT.** Shutdown runs in this order:
  1. It arms a hard exit at 58 s.
  2. `jobs.stopAll()` runs, and every node-cron task is stopped, routine tasks included.
  3. It waits up to 50 s for the registry's in-flight runs. A routine run (one ticket) isn't
     waited for.
  4. It logs whatever is still running, then does `server.close` and `mongoose.disconnect`,
     then `exit(0)`.

  `compose.yml` gives Docker 60 s before it sends SIGKILL.
- **`unhandledRejection` is logged, and the process keeps running.** `uncaughtException` is
  logged, `exitCode` is set to 1, and the process exits after 500 ms, so the log line gets
  written first; Docker restarts it.
- **The startup `.catch` no longer `throw`s.** With `unhandledRejection` now only logged, a
  failed `mongoose.connect`/`initAuth` would otherwise leave a live process with no database. It
  now logs and exits with 1.

- [ ] **Step 1: Write the failing test**

Create `backend/services/jobs/guardedCron.test.js`:

````js
// node --test services/jobs/guardedCron.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createCronRegistry } = require("./guardedCron");

// Расписание-заглушка: помнит задания, тики крутит тест
const fakeSchedule = () => {
  const tasks = [];
  const schedule = (expression, tick, options) => {
    const task = {
      expression,
      tick,
      options,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tasks.push(task);
    return task;
  };
  return { schedule, tasks };
};

// Прогон, который закончится, когда скажет тест
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = ({ dbReady = () => true } = {}) => {
  const { schedule, tasks } = fakeSchedule();
  const logs = [];
  const registry = createCronRegistry({
    schedule,
    log: (level, message, meta) => logs.push({ level, message, meta }),
    isDbReady: dbReady,
  });
  return { registry, tasks, logs };
};

// Дать отработать .catch/.finally цепочки прогона
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("сторож пишет ошибку, но замок держится, пока прогон не закончится", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { registry, tasks, logs } = setup();
  const runs = [];
  registry.register(
    "mail outbox",
    "*/20 * * * * *",
    () => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    },
    110000,
  );
  const [task] = tasks;

  task.tick();
  t.mock.timers.tick(110000);
  assert.ok(
    logs.some((l) => l.level === "error" && /mail outbox watchdog timeout/.test(l.message)),
    "сторож не сработал",
  );

  // Прежний guardedCron здесь отпускал замок, и второй прогон шёл поверх первого
  task.tick();
  assert.equal(runs.length, 1, "второй прогон запущен поверх зависшего");
  assert.ok(
    logs.some((l) => l.level === "warn" && l.message === "Skipping mail outbox: previous run is still active"),
  );

  runs[0].resolve();
  await settle();
  task.tick();
  assert.equal(runs.length, 2, "после завершения прогона замок не снят");
});

test("упавший прогон пишется в журнал и снимает замок", async () => {
  const { registry, tasks, logs } = setup();
  let calls = 0;
  registry.register(
    "work status auto-switch",
    "*/5 * * * *",
    () => {
      calls += 1;
      if (calls === 1) throw new Error("синхронно");
      return Promise.reject(new Error("асинхронно"));
    },
    120000,
  );
  const [task] = tasks;

  task.tick();
  await settle();
  task.tick();
  await settle();

  assert.equal(calls, 2);
  assert.deepEqual(
    logs.filter((l) => l.level === "error").map((l) => l.meta.error),
    ["синхронно", "асинхронно"],
  );
  assert.equal(logs[0].message, "work status auto-switch run failed");
});

test("без базы тик пропускается молча", () => {
  let ready = false;
  const { registry, tasks, logs } = setup({ dbReady: () => ready });
  let calls = 0;
  registry.register("expired bans lift", "* * * * *", () => {
    calls += 1;
  }, 10000);

  tasks[0].tick();
  assert.equal(calls, 0);
  assert.deepEqual(logs, []);

  ready = true;
  tasks[0].tick();
  assert.equal(calls, 1);
});

test("quietSkip пишет пропуск на уровне debug", async () => {
  const { registry, tasks, logs } = setup();
  const run = deferred();
  registry.register(
    "Mikrotik upgrade worker",
    "*/20 * * * * *",
    () => run.promise,
    15 * 60 * 1000,
    { quietSkip: true },
  );

  tasks[0].tick();
  tasks[0].tick();
  assert.deepEqual(logs.map((l) => l.level), ["debug"]);

  // Прогон закрываем: иначе настоящий 15-минутный сторож держал бы тест
  run.resolve();
  await settle();
});

test("пояс расписания уходит в node-cron, без пояса — без опций", () => {
  const { registry, tasks } = setup();
  registry.register("logs cleanup", "0 2 * * *", () => {}, 0, {
    timezone: "Asia/Vladivostok",
  });
  registry.register("mail outbox", "*/20 * * * * *", () => {}, 110000);

  assert.deepEqual(tasks[0].options, { timezone: "Asia/Vladivostok" });
  assert.equal(tasks[1].options, undefined);
});

test("stopAll гасит расписания, запоздавший тик ничего не запускает", () => {
  const { registry, tasks } = setup();
  let calls = 0;
  registry.register("a", "* * * * *", () => {
    calls += 1;
  }, 1000);
  registry.register("b", "* * * * *", () => {
    calls += 1;
  }, 1000);

  registry.stopAll();
  tasks[0].tick();

  assert.deepEqual(tasks.map((task) => task.stopped), [true, true]);
  assert.equal(calls, 0);
});

test("drain ждёт идущие прогоны и возвращается сразу, как они кончились", async () => {
  const { registry, tasks } = setup();
  const run = deferred();
  registry.register("email intake", "*/20 * * * * *", () => run.promise, 180000);
  tasks[0].tick();

  const draining = registry.drain(50000);
  run.resolve();
  assert.deepEqual(await draining, []);
});

test("drain не ждёт дольше срока и называет незаконченные", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { registry, tasks } = setup();
  const quick = deferred();
  const stuck = deferred();
  registry.register("mail outbox", "*/20 * * * * *", () => quick.promise, 110000);
  registry.register("Mikrotik scheduler", "*/5 * * * *", () => stuck.promise, 270000);
  tasks[0].tick();
  tasks[1].tick();

  const draining = registry.drain(50000);
  quick.resolve();
  await settle();
  t.mock.timers.tick(50000);

  assert.deepEqual(await draining, ["Mikrotik scheduler"]);
});

test("drain без идущих прогонов возвращается сразу", async () => {
  const { registry } = setup();
  assert.deepEqual(await registry.drain(50000), []);
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/jobs/guardedCron.test.js`
Expected: FAIL, with `Error: Cannot find module './guardedCron'`.

- [ ] **Step 3: Implement**

3a. Create `backend/services/jobs/guardedCron.js`:

````js
/**
 * Крон-задания бэкенда: замок «не больше одного прогона», сторож долгого
 * прогона и мягкая остановка.
 *
 * Раньше сторож снимал замок по таймауту: `Promise.race([run(), watchdog])`
 * отпускал `inFlight`, а зависший прогон продолжал работать, и следующий тик
 * запускал второй поверх первого — очередь писем, например, разбиралась двумя
 * прогонами сразу. Теперь сторож только пишет ошибку в журнал, а замок
 * держится, пока прогон действительно не закончится.
 *
 * Остановка: `stopAll` гасит расписания (новых прогонов не будет), `drain`
 * ждёт идущие — не дольше заданного срока — и называет те, что не успели.
 *
 * Расписание, журнал и готовность базы приходят параметрами: тест подставляет
 * свои и крутит тики руками.
 *
 * @param {object} deps
 * @param {(expression: string, tick: () => void, options?: object) => { stop: () => void }} deps.schedule
 *   `cron.schedule` из node-cron
 * @param {(level: string, message: string, meta?: object) => void} deps.log
 * @param {() => boolean} deps.isDbReady прогоны без базы не запускаются
 */
const createCronRegistry = ({ schedule, log, isDbReady }) => {
  const tasks = [];
  // Идущие прогоны: промис → имя задания
  const inFlight = new Map();
  let stopped = false;

  // run() может и бросить синхронно, и вернуть не-промис
  const invoke = (run) => {
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  /**
   * @param {string} name имя в журнале
   * @param {string} expression выражение node-cron
   * @param {() => unknown} run тело задания
   * @param {number} timeoutMs через сколько прогон считается зависшим; 0 — без сторожа
   * @param {{ quietSkip?: boolean, timezone?: string }} [options]
   *   quietSkip — пропуск тика из-за идущего прогона пишется на уровне debug
   *   (задание, которое штатно переживает свой интервал); timezone — пояс
   *   расписания для node-cron
   */
  const register = (
    name,
    expression,
    run,
    timeoutMs,
    { quietSkip = false, timezone } = {},
  ) => {
    let current = null;

    const tick = () => {
      if (stopped) return;
      if (current) {
        log(
          quietSkip ? "debug" : "warn",
          `Skipping ${name}: previous run is still active`,
        );
        return;
      }
      if (!isDbReady()) return;

      const watchdog =
        timeoutMs > 0
          ? setTimeout(() => {
              log(
                "error",
                `${name} watchdog timeout: still running after ${timeoutMs} ms, next runs wait for it`,
              );
            }, timeoutMs)
          : null;

      const settled = invoke(run)
        .catch((error) => {
          log("error", `${name} run failed`, { error: error?.message });
        })
        .finally(() => {
          if (watchdog) clearTimeout(watchdog);
          inFlight.delete(settled);
          current = null;
        });

      current = settled;
      inFlight.set(settled, name);
    };

    tasks.push(schedule(expression, tick, timezone ? { timezone } : undefined));
  };

  /** Погасить все расписания; тик, пришедший после, ничего не запустит. */
  const stopAll = () => {
    stopped = true;
    for (const task of tasks) task.stop();
  };

  /**
   * Дождаться идущих прогонов, но не дольше `timeoutMs`.
   *
   * @returns {Promise<string[]>} имена заданий, которые к сроку не закончились
   */
  const drain = async (timeoutMs) => {
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.all(inFlight.keys()), deadline]);
    clearTimeout(timer);
    return [...inFlight.values()];
  };

  return { register, stopAll, drain };
};

module.exports = { createCronRegistry };
````

3b. The startup `.catch` in `backend/app.js`:

Edit 1 — `backend/app.js`, current lines 216–218. Replace:

````js
  .catch((error) => {
    throw new AppError("Failed to start server", 500, true, error);
  });
````

with:

````js
  .catch((error) => {
    // Без базы и better-auth серверу делать нечего: пишем в журнал и выходим с
    // 1 — Docker перезапустит. Раньше здесь был throw, и процесс ронял
    // необработанный отказ; теперь unhandledRejection только записывается
    // (конец файла), и процесс остался бы жить без базы. winston пишет в
    // stdout не синхронно — даём строке уйти в журнал до выхода.
    logger.log("error", "Failed to start server", {
      error: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500).unref();
  });
````

3c. **Replace the tail of `backend/app.js`.** The replacement runs from the line
`// check email for new tickets` to the end of the file, which is 475 lines at `b3b20cf`.

First check that nobody else has changed the tail:

```bash
cd backend
sed -n '/^\/\/ check email for new tickets$/,$p' app.js | sha256sum
# must print 0b42b3d5842369acf16ef88783eb13d4db7a9310bff7f77ebdee4be9b5d22f7e
```

Any other hash means the tail changed after `b3b20cf`. In that case, stop and carry those
changes into the new text below by hand. A new cron, for example, becomes a `jobs.register(…)`
call. Otherwise, write the new tail to `$TMPDIR/app.tail.js` exactly as follows:

````js
// Все крон-задания — через один реестр (services/jobs/guardedCron.js): замок
// «не больше одного прогона» держится, пока прогон действительно не
// закончится (сторож только пишет ошибку), без базы тик пропускается, а при
// остановке реестр гасит расписания и ждёт идущие прогоны (см. shutdown ниже).
const { createCronRegistry } = require("./services/jobs/guardedCron");

const jobs = createCronRegistry({
  schedule: cron.schedule,
  log: (...args) => logger.log(...args),
  isDbReady: () => mongoose.connection.readyState === 1,
});

// check email for new tickets
// Запас: нормальный прогон занимает секунды. Сторож только кричит в журнал —
// замок держится, пока handleNewEmails не закончится: второй разбор ящика
// поверх зависшего завёл бы заявки из одних и тех же писем дважды. Реальные
// зависания IMAP закрывает socketTimeout (30с) задолго до этого.
const EMAIL_RUN_TIMEOUT_MS = 180000;
jobs.register(
  "email intake",
  "*/20 * * * * *",
  () => handleNewEmails(),
  EMAIL_RUN_TIMEOUT_MS,
);

// create notifications
// Гейта по почте/Telegram больше нет: канал «в приложении» есть всегда, а свои
// рубильники почта и Telegram проверяют внутри заданий. Каждое задание — в
// своём try: сбой одного не отменяет остальные.
const notificationJobs = [
  ["ticket notifications", createTicketNotifications],
  ["comment notifications", createCommentNotifications],
  ["scheduled work notifications", createScheduledWorkNotifications],
];
jobs.register(
  "notification creation",
  "*/10 * * * * *",
  async () => {
    for (const [jobName, createNotifications] of notificationJobs) {
      try {
        await createNotifications();
      } catch (error) {
        logger.log("error", `Failed to create ${jobName}`, {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  },
  0,
  { quietSkip: true },
);

// The three Mikrotik crons used to share `*/5 * * * *` and therefore fired in the
// same second. That was a correctness bug, not just contention: the alert cron read
// `status` while the health-check was still polling, so it ticketed devices by a
// five-minute-old snapshot. They are now staggered — health-check at :00, the config
// exporter at :02 (its SSH /export no longer loads a weak device's CPU during the
// health-check's TLS handshake), alerts at :04, giving the health-check four minutes
// of head start. Beware: node-cron reads `2-59/5` as "every 5th minute from zero
// within 2..59", i.e. 5,10,…,55 — an offset must be an explicit minute list.
const EVERY_5_MIN = "*/5 * * * *";
const EVERY_5_MIN_AT_2 = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const EVERY_5_MIN_AT_4 = "4,9,14,19,24,29,34,39,44,49,54,59 * * * *";

// Автостатусы присутствия по графику — каждые 5 минут. Таймзона крона здесь
// НЕ нужна: у каждого сотрудника свой пояс, и «сейчас в смене?» считается
// внутри прогона по графику, заданному в поясе организации.
jobs.register(
  "work status auto-switch",
  EVERY_5_MIN,
  () => runWorkStatusAuto(),
  120000,
);

/**
 * Отправка почтовых уведомлений. Переехало из telegram-bot вместе с самой
 * почтой: очередь всегда лежала здесь, а разбирал её бот — только потому, что
 * там крутился крон. Ценой была удалённая машина с почтовым паролем и ключом
 * его расшифровки.
 *
 * Каждые 20 секунд, как и было. Реестр не даёт прогонам наслаиваться, а каждое
 * письмо ещё и берётся в аренду (services/mail/outbox.js) — одно письмо не уйдёт
 * дважды, даже если прогон оборвётся посреди пачки.
 */
jobs.register("mail outbox", "*/20 * * * * *", sendPendingEmails, 110000);

// Refresh connectivity status of monitored Mikrotik devices every 5 minutes.
jobs.register(
  "Mikrotik health-check",
  EVERY_5_MIN,
  runMikrotikHealthCheck,
  240000,
);

// Run due Mikrotik config-export schedules (an export may hold SSH for up to 60s).
jobs.register(
  "Mikrotik scheduler",
  EVERY_5_MIN_AT_2,
  runMikrotikScheduler,
  270000,
);

// Raise a ticket for Mikrotik devices offline past the configured threshold
// (Preferences.mikrotik.offlineTicket.thresholdMinutes, 15 min by default). Each
// candidate is re-polled first, so a device that has since recovered is never
// ticketed. 240s: one re-poll batch can take ~72s worst case (deadline + retry),
// and tunneled («через устройство») re-polls add an SSH handshake per attempt —
// the old 120s bound was already brushable at two batches.
jobs.register(
  "Mikrotik offline-alert",
  EVERY_5_MIN_AT_4,
  runMikrotikOfflineAlerts,
  240000,
);

// Firmware upgrade batches: one step of the current device per tick
// (docs/mikrotik-management.md, «Firmware upgrades»). A step may hold a package
// download for up to 10 minutes; the in-flight lock keeps ticks from stacking,
// and those skips are expected — hence quietSkip.
jobs.register(
  "Mikrotik upgrade worker",
  "*/20 * * * * *",
  () => runUpgradeTick(),
  15 * 60 * 1000,
  { quietSkip: true },
);

// Кэш релизов RouterOS + CVE из NVD + авто-заявка «уязвимая прошивка». Суточного
// прогона достаточно (релизы выходят реже раза в неделю, лимит NVD — 5 req/30s);
// UTC, как и остальные задания без пояса; минута 23 — вне решётки */5 микротик-кронов.
jobs.register(
  "Mikrotik firmware refresh",
  "23 3 * * *",
  runMikrotikFirmwareRefresh,
  120000,
);

// Knowledge base: scan notes for exposed secrets every hour
jobs.register(
  "Knowledge base secrets scan",
  "0 * * * *",
  () => runSecretsScan(),
  0,
  { quietSkip: true },
);

// Отключения с вышедшим сроком — снимаем раз в минуту. Гейты доступа считают
// срок сами (`isBanned`), а этот прогон приводит в порядок ДОКУМЕНТ: списки,
// рассылка и табло фильтруют по `banned` и про срок не знают. Плагин `admin`
// снял бы флаг при входе, но до его хука наши гейты не доходят, а клиенты
// входят редко — письма при этом идут им постоянно (см. services/authBan).
jobs.register(
  "expired bans lift",
  "* * * * *",
  async () => {
    const lifted = await liftExpiredBans();
    if (lifted) {
      logger.log("info", `Expired bans lifted: ${lifted}`);
    }
  },
  10000,
);

// «Диалоги»: ответы, застрявшие между комментарием, сообщением и заданием
// шлюзу (services/messaging/outbound.js#repairOutbound)
jobs.register(
  "messagingRepair",
  "* * * * *",
  () => require("@/services/messaging/outbound").repairOutbound(),
  50 * 1000,
);

// Ночные обслуживающие задания — по настенным часам БИЗНЕС-таймзоны: без
// опции node-cron исполнял бы «2:00»/«3:00» по UTC контейнера, т.е. днём для
// восточных поясов. Таймзона читается из настроек один раз при старте
// (Preferences.findOne буферизуется mongoose до подключения к БД); смена зоны
// в настройках подхватится после рестарта — как у задач checkRoutineTasks.
const registerMaintenanceCrons = async () => {
  let timezone = DEFAULT_TIMEZONE;
  try {
    const prefs = await Preferences.findOne({});
    if (prefs?.timezone) {
      timezone = prefs.timezone;
    }
  } catch (error) {
    logger.log("error", "Failed to read timezone for maintenance crons", {
      error: error.message,
    });
  }

  const nightly = { timezone, quietSkip: true };

  // Cleanup old company logs every day at 2:00 AM
  jobs.register(
    "company logs cleanup",
    "0 2 * * *",
    () => scheduleLogsCleanup(),
    0,
    nightly,
  );

  // Статусы присутствия: ночной сброс, кроме долгих (отпуск/болею) — daily 2:30
  jobs.register(
    "work status nightly reset",
    "30 2 * * *",
    () => runWorkStatusReset(),
    0,
    nightly,
  );

  // Knowledge base: revert approvals whose approval period has expired (daily 3:00)
  jobs.register(
    "knowledge approval expiry",
    "0 3 * * *",
    () => runKnowledgeApprovalExpiry(),
    0,
    nightly,
  );

  // Согласование отчётов: напоминание за сутки до срока и автоподпись после
  // него (daily 4:15 — после ночных пересчётов, до начала рабочего дня)
  jobs.register(
    "report auto-approval",
    "15 4 * * *",
    () => runReportAutoApproval(),
    0,
    nightly,
  );

  // Knowledge base: parse service-renewal tables daily (3:30)
  jobs.register(
    "knowledge base service-expiry scan",
    "30 3 * * *",
    () => runServiceExpiryScan(),
    0,
    nightly,
  );

  // Производственный календарь: догрузить текущий и следующий год (3:45).
  // Следующий год публикуется осенью — до этого его 404 штатный и в lastError
  // не пишется (см. syncCalendar).
  jobs.register(
    "production calendar sync",
    "45 3 * * *",
    () => syncProductionCalendar(),
    0,
    nightly,
  );
};

registerMaintenanceCrons();

// Initialize monitoring first
setTimeout(() => {
  checkRoutineTasks();
}, 1000);

// Первый деплой / долгий простой: не ждать суточного крона, если кэш релизов/CVE
// пуст или старше суток (свежий кэш — no-op).
setTimeout(() => {
  runMikrotikFirmwareRefreshIfStale();
}, 30000);

// Мягкая остановка. `docker stop` шлёт SIGTERM и ждёт stop_grace_period (60 с,
// compose.yml), потом SIGKILL. Порядок: расписания гасятся — новых прогонов нет;
// идущие дорабатывают до 50 с (письмо, взятое в аренду, должно уйти, а заявка
// из письма — дописаться); затем закрываем HTTP-сервер и Mongo — и выходим
// ЯВНО: таймеры иначе держат процесс живым до SIGKILL. Будильник на выход
// ставится первым и срабатывает до SIGKILL, чтобы зависший прогон или запрос
// не превратил остановку в убийство.
const SHUTDOWN_DRAIN_MS = 50 * 1000;
const SHUTDOWN_HARD_EXIT_MS = 58 * 1000;

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.log("info", `${signal} received, shutting down`);
  setTimeout(() => process.exit(1), SHUTDOWN_HARD_EXIT_MS).unref();

  jobs.stopAll();
  // Регламенты (middleware/taskManager.js) живут в node-cron напрямую, мимо
  // реестра: гасим и их. Их прогон — одна заявка, его не ждём.
  for (const task of cron.getTasks().values()) {
    task.stop();
  }

  const pending = await jobs.drain(SHUTDOWN_DRAIN_MS);
  if (pending.length) {
    logger.log("warn", "Shutdown: jobs still running after the drain window", {
      pending,
    });
  }

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  } catch (error) {
    logger.log("warn", "Shutdown: failed to close cleanly", {
      error: error.message,
    });
  }
  process.exit(0);
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

// Промис без обработчика — ошибка в коде, но не повод ронять процесс: на нём
// кроны и запросы остальных пользователей. Пишем в журнал и живём дальше.
process.on("unhandledRejection", (reason) => {
  logger.log("error", "Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Синхронное исключение мимо всех try — состояние процесса неизвестно. Пишем в
// журнал и выходим с 1: Docker (restart: unless-stopped) поднимет чистый процесс.
process.on("uncaughtException", (error) => {
  logger.log("error", "Uncaught exception, exiting", {
    error: error?.message,
    stack: error?.stack,
  });
  // winston пишет в stdout не синхронно — даём строке уйти в журнал до выхода
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500).unref();
});
````

Then splice it in:

```bash
cd backend
n=$(grep -n '^// check email for new tickets$' app.js | cut -d: -f1)
test "$(echo "$n" | wc -l)" = 1 && test -n "$n"
head -n $((n - 1)) app.js > "$TMPDIR/app.js.new"
cat "$TMPDIR/app.tail.js" >> "$TMPDIR/app.js.new"
cp "$TMPDIR/app.js.new" app.js
node --check app.js
```

After this, `grep -n "guardedCron(\|isHandlingEmails\|cron.schedule(" app.js` prints nothing.
Only `createCronRegistry`, `jobs.register` and `cron.getTasks` remain.

3d. `compose.yml`:

Edit 1 — `compose.yml`, current lines 54–56. Replace:

````yaml
    restart: unless-stopped
    init: true
    # The whole .env is the backend's configuration (see .env.example); the
````

with:

````yaml
    restart: unless-stopped
    init: true
    # SIGTERM makes the backend stop its crons, give running jobs up to 50 s to
    # finish and exit by itself by 58 s (backend/app.js, `shutdown`). Docker's
    # default 10 s would SIGKILL a mail batch or an e-mail intake run halfway.
    stop_grace_period: 60s
    # The whole .env is the backend's configuration (see .env.example); the
````

3e. **The module docs.** They describe the old semantics, where the watchdog released the
lock:

Edit 1 — `docs/mikrotik-management.md`, current lines 450–453. Replace:

````markdown
`status` while the health-check was still polling. They are staggered by
`guardedCron(name, expr, fn, timeoutMs)`, which pairs an in-flight lock with a
**watchdog** (a hung run used to hold the lock forever — health-check dead,
alerts still ticketing off a frozen `offline`).
````

with:

````markdown
`status` while the health-check was still polling. They are staggered, and each
is registered through the job registry (`services/jobs/guardedCron.js`,
`jobs.register(name, expr, fn, timeoutMs)`): an in-flight lock held until the
run settles — runs never overlap — and a **watchdog** that logs an error when a
run outlives `timeoutMs`. The watchdog cannot cancel a run, so a run that never
settles would stop its cron until restart; the Mikrotik jobs bound their own I/O
(`POLL_DEADLINE_MS`, SSH `opTimeoutMs`, `AbortSignal.timeout`).
````

Edit 2 — `docs/messaging.md`, current line 245. Replace:

````markdown
to the other `guardedCron` registrations; 50 s watchdog) →
````

with:

````markdown
to the other `jobs.register` registrations; 50 s watchdog) →
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test services/jobs/guardedCron.test.js`
Expected: `# tests 9`, `# pass 9`, `# fail 0` (about 0.2 s).

**Wiring smoke test.** It runs without Mongo in about 13 s and is not added to the repository.
Write this file to `$TMPDIR/app-smoke.js`:

````js
// Одноразовая проверка проводки app.js без базы: node "$TMPDIR/app-smoke.js" "$PWD"
// (из каталога backend). В репозиторий не кладётся.
const path = require("path");
const dir = process.argv[2];
process.chdir(dir);
require(path.join(dir, "node_modules/module-alias/register"));
const cron = require(path.join(dir, "node_modules/node-cron"));
const mongoose = require(path.join(dir, "node_modules/mongoose"));

const registered = [];
const tasks = new Map();
let stops = 0;
cron.schedule = (expression, tick, options) => {
  const task = { stop: () => { stops += 1; } };
  registered.push({ expression, options, tick });
  tasks.set(String(tasks.size), task);
  return task;
};
cron.getTasks = () => tasks;
mongoose.connect = () => new Promise(() => {});
mongoose.disconnect = async () => console.log("mongoose.disconnect called");
process.exit = (code) => {
  console.log(`process.exit(${code}) registered=${registered.length} stops=${stops}`);
  process.kill(process.pid, "SIGKILL");
};

require(path.join(dir, "app.js"));
console.log(
  `handlers: unhandledRejection=${process.listenerCount("unhandledRejection")} uncaughtException=${process.listenerCount("uncaughtException")}`,
);

// Ночные задания регистрируются после Preferences.findOne — без базы он
// отваливается по таймауту буфера mongoose (10 с), и берётся пояс по умолчанию
setTimeout(() => {
  for (const { expression, options } of registered) {
    console.log(expression, options ? JSON.stringify(options) : "");
  }
  registered.forEach(({ tick }) => tick()); // без базы тики молча пропускаются
  process.emit("SIGTERM");
}, 12500);
````

Run: `cd backend && NODE_ENV=production node "$TMPDIR/app-smoke.js" "$PWD" 2>&1 | grep -v '^{"level"'`

Expected, among the buffering-timeout noise from mongoose:
- `handlers: unhandledRejection=1 uncaughtException=1`;
- 18 expression lines in all:
  - twelve without options: `*/20 * * * * *`, `*/10 * * * * *`, `*/5 * * * *`,
    `*/20 * * * * *`, `*/5 * * * *`, the `:02` and `:04` minute lists, `*/20 * * * * *`,
    `23 3 * * *`, `0 * * * *`, `* * * * *`, `* * * * *`;
  - six nightly ones, `0 2`, `30 2`, `0 3`, `15 4`, `30 3` and `45 3`, each with
    `{"timezone":"Europe/Moscow"}` (the default zone, since Preferences can't be read without
    Mongo);
- `mongoose.disconnect called`;
- `process.exit(0) registered=18 stops=36`. The count is 36 because the registry stops its 18
  tasks and then `cron.getTasks()` stops the same 18 again.

**Checking compose.yml.** The worktree has no `.env`, so parse a copy:

```bash
mkdir -p "$TMPDIR/cc" && cp compose.yml "$TMPDIR/cc/" && touch "$TMPDIR/cc/.env"
docker compose -f "$TMPDIR/cc/compose.yml" --env-file /dev/null config 2>/dev/null | grep -n "stop_grace_period"
```

Expected: `stop_grace_period: 1m0s` for the backend, next to mongodb's existing `2m0s`.

Run: `cd backend && pnpm test`
Expected: no failures.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/services/jobs/guardedCron.js` (new)
- `backend/services/jobs/guardedCron.test.js` (new)
- `backend/app.js`
- `compose.yml`
- `docs/mikrotik-management.md`
- `docs/messaging.md`

The deploy note: `compose.yml` gains `stop_grace_period`.

---

### Task D4: Mail outbox — lease claim and ack

**Files:**
- Modify: `backend/services/mail/outbox.js`:
  - the imports, lines 1 and 13;
  - `okToSend`, lines 55–62, which becomes the lease queue;
  - `deliver`, lines 80–131, which becomes `attempt` and `recordOutcome`;
  - `sendNow`, lines 139–140 and 161–167;
  - `sendPendingEmails`, lines 169–233.
- Test: `backend/services/mail/outbox.test.js` (new)

**Interfaces:**
- Consumes:
  - from the `Notification` model, the lease fields `leaseUntil` and `leaseId` and the index
    `{instrument, sent, failed, leaseUntil}`, all of which already exist;
  - `NOTIFY_MAX_ATTEMPTS` and `NOTIFY_RETRY_INTERVAL_MINUTES` from `utils/retryPolicy.js`;
  - `sendMail(creds, to, subject, text, html)` from `services/mail/send.js`. It is now called
    through the module object, so the test can replace it.
- Produces:
  - `createMailQueue({ model = Notification, now = () => new Date() } = {})` returns:
    - `claim(leaseId): Promise<Notification|null>`;
    - `ack(notification, leaseId, fields): Promise<boolean>`;
    - `drop(notification, leaseId)`.
  - `sendPendingEmails({ queue, send } = {})`. The cron calls it with no arguments: Task D3
    registers `jobs.register("mail outbox", "*/20 * * * * *", sendPendingEmails, 110000)`,
    and today's `guardedCron` call does the same until then.
  - `sendNow(notification)` keeps its contract for `auth/hooks.js`: it takes an unsaved
    document, saves it once with the outcome, and returns `{success, failure?}`.
  - `LEASE_MS` (= 120000) is exported for the test.

**Behaviour:**
- **Claiming.** Each letter is claimed with one atomic `findOneAndUpdate`, the same pattern as
  `controllers/bot.js` `outboxPull`. The filter takes a letter only when all of these hold:
  - it is unsent and not failed;
  - `attemptsCounter` is below the maximum;
  - its lease is null or has expired;
  - the old `okToSend` spacing is met: `attemptsCounter: 0`, or `updatedAt` is more than 15
    minutes ago.

  `timestamps: false` keeps the claim from touching `updatedAt`, so the spacing is still
  counted from the last attempt. The oldest letter comes first.
- **Acknowledging.** The outcome is written with `updateOne({ _id, leaseId })`, which clears
  the lease. The delete paths use `deleteOne({ _id, leaseId })`: a deleted ticket, or a
  service account.
- **Order of writes.** The `failed` mark for a letter with no address is an ack too. Channel
  health (`recordOk`/`recordError`) and the ticket log are written after the ack, in their own
  `try`, so their failure can't leave a sent letter "unsent".
- **A run that throws in the middle of a letter keeps that letter's lease.** The letter comes
  back after `LEASE_MS` (2 minutes), not on the next tick.
- **The one remaining double send** would be a process kill between the SMTP acceptance and the
  ack: that single letter goes out again once its lease expires.
- **A side benefit.** Retries that aren't due yet no longer fill the 100-letter batch. The old
  `find().limit(100)` could starve newer letters that way.

- [ ] **Step 1: Write the failing test**

Create `backend/services/mail/outbox.test.js`:

````js
// node --test services/mail/outbox.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит десять
// секунд в ожидании подключения
mongoose.set("bufferCommands", false);

const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const { Ticket } = require("@/models/ticket");
const User = require("@/models/user");
const mailSend = require("@/services/mail/send");
const {
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_RETRY_INTERVAL_MINUTES,
} = require("@/utils/retryPolicy");
const {
  createMailQueue,
  sendPendingEmails,
  sendNow,
  LEASE_MS,
} = require("./outbox");

const NOW = new Date("2026-09-30T10:00:00Z");

// ── Запросы к Mongo ─────────────────────────────────────────────────────────

test("claim: одно атомарное findOneAndUpdate — аренда, попытки, пауза, самое старое", async () => {
  const calls = [];
  const model = {
    findOneAndUpdate: async (...args) => {
      calls.push(args);
      return null;
    },
  };
  const queue = createMailQueue({ model, now: () => NOW });

  assert.equal(await queue.claim("lease-1"), null);
  const [[filter, update, options]] = calls;
  assert.deepEqual(filter, {
    instrument: "email",
    sent: false,
    failed: false,
    attemptsCounter: { $lt: NOTIFY_MAX_ATTEMPTS },
    $and: [
      { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: NOW } }] },
      {
        $or: [
          { attemptsCounter: 0 },
          {
            updatedAt: {
              $lt: new Date(NOW.getTime() - NOTIFY_RETRY_INTERVAL_MINUTES * 60000),
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(update, {
    $set: { leaseUntil: new Date(NOW.getTime() + LEASE_MS), leaseId: "lease-1" },
  });
  assert.deepEqual(options, {
    sort: { createdAt: 1 },
    returnDocument: "after",
    timestamps: false,
  });
});

test("ack и drop действуют только по своей аренде", async () => {
  const calls = [];
  const model = {
    updateOne: async (...args) => {
      calls.push(["updateOne", ...args]);
      return { matchedCount: 0 };
    },
    deleteOne: async (...args) => {
      calls.push(["deleteOne", ...args]);
      return { deletedCount: 1 };
    },
  };
  const queue = createMailQueue({ model, now: () => NOW });

  assert.equal(
    await queue.ack({ _id: "n1" }, "lease-1", { sent: true, attemptsCounter: 1 }),
    false,
  );
  await queue.drop({ _id: "n2" }, "lease-1");

  assert.deepEqual(calls, [
    [
      "updateOne",
      { _id: "n1", leaseId: "lease-1" },
      { $set: { sent: true, attemptsCounter: 1, leaseUntil: null, leaseId: null } },
    ],
    ["deleteOne", { _id: "n2", leaseId: "lease-1" }],
  ]);
});

// ── Разбор пачки ────────────────────────────────────────────────────────────

// Очередь в памяти с правилами аренды Mongo-запроса. Захват синхронный, то есть
// атомарный — как findOneAndUpdate.
const memoryQueue = (docs, clock) => {
  const acks = [];
  const drops = [];
  const owned = (notification, leaseId) =>
    docs.find((doc) => doc._id === notification._id && doc.leaseId === leaseId);

  return {
    acks,
    drops,
    claim: async (leaseId) => {
      const now = clock();
      const doc = docs.find(
        (item) =>
          !item.sent &&
          !item.failed &&
          !item.dropped &&
          (!item.leaseUntil || item.leaseUntil <= now),
      );
      if (!doc) return null;
      doc.leaseUntil = new Date(now.getTime() + LEASE_MS);
      doc.leaseId = leaseId;
      return { ...doc };
    },
    ack: async (notification, leaseId, fields) => {
      const doc = owned(notification, leaseId);
      if (!doc) return false;
      Object.assign(doc, fields, { leaseUntil: null, leaseId: null });
      acks.push({ id: doc._id, fields });
      return true;
    },
    drop: async (notification, leaseId) => {
      const doc = owned(notification, leaseId);
      if (doc) doc.dropped = true;
      drops.push(notification._id);
    },
  };
};

const letter = (id, extra = {}) => ({
  _id: id,
  instrument: "email",
  to: { email: `${id}@example.ru` },
  title: "Уведомление",
  text: "<p>Текст</p>",
  attemptsCounter: 0,
  sent: false,
  failed: false,
  ...extra,
});

const delivered = (notification) => ({
  message: { success: true },
  exhausted: false,
  fields: { attemptsCounter: notification.attemptsCounter + 1, sent: true },
});

// Модели вокруг очереди: почта включена, заявки живы, учётки обычные, строка
// состояния канала пишется в никуда
const stubModels = (t, { mailOn = true, deletedTickets = [], serviceEmails = [] } = {}) => {
  t.mock.method(Preferences, "findOne", async () => ({
    notify: { byEmail: { isActive: mailOn } },
  }));
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  t.mock.method(Ticket, "findById", (id) => ({
    select: async () => (deletedTickets.includes(id) ? null : { _id: id }),
  }));
  t.mock.method(User, "findOne", (filter) => ({
    select: async () =>
      serviceEmails.includes(filter.email) ? { isServiceAccount: true } : null,
  }));
};

test("два наложившихся прогона не отправляют одно письмо дважды", async (t) => {
  stubModels(t);
  const queue = memoryQueue([letter("n1"), letter("n2"), letter("n3")], () => NOW);
  const sent = [];
  const send = async (notification) => {
    sent.push(notification._id);
    // SMTP «думает» — второй прогон успевает войти в очередь
    await new Promise((resolve) => setImmediate(resolve));
    return delivered(notification);
  };

  await Promise.all([
    sendPendingEmails({ queue, send }),
    sendPendingEmails({ queue, send }),
  ]);

  assert.deepEqual([...sent].sort(), ["n1", "n2", "n3"]);
  assert.deepEqual(
    queue.acks.map((ack) => ack.id).sort(),
    ["n1", "n2", "n3"],
  );
});

test("сбой посреди письма: не уходит повторно, пока держится аренда", async (t) => {
  stubModels(t);
  let now = NOW;
  const queue = memoryQueue([letter("n1"), letter("n2")], () => now);
  const sent = [];
  let crashed = false;
  const send = async (notification) => {
    if (notification._id === "n1" && !crashed) {
      crashed = true;
      throw new Error("обрыв посреди отправки");
    }
    sent.push(notification._id);
    return delivered(notification);
  };

  await sendPendingEmails({ queue, send });
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, ["n2"], "n1 взят повторно до конца аренды");

  now = new Date(NOW.getTime() + LEASE_MS);
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, ["n2", "n1"]);
});

test("удалённая заявка и служебная учётка снимаются, письмо без адреса — failed", async (t) => {
  stubModels(t, { deletedTickets: ["t-gone"], serviceEmails: ["robot@example.ru"] });
  const queue = memoryQueue(
    [
      letter("n1", { ticketId: "t-gone" }),
      letter("n2", { to: {} }),
      letter("n3", { to: { email: "robot@example.ru" } }),
      letter("n4", { ticketId: "t-live" }),
    ],
    () => NOW,
  );
  const sent = [];
  const send = async (notification) => {
    sent.push(notification._id);
    return delivered(notification);
  };

  await sendPendingEmails({ queue, send });

  assert.deepEqual(queue.drops, ["n1", "n3"]);
  assert.deepEqual(queue.acks, [
    { id: "n2", fields: { failed: true } },
    { id: "n4", fields: { attemptsCounter: 1, sent: true } },
  ]);
  assert.deepEqual(sent, ["n4"]);
});

test("почта выключена — очередь не трогается", async (t) => {
  stubModels(t, { mailOn: false });
  let claims = 0;
  const queue = {
    claim: async () => {
      claims += 1;
      return null;
    },
  };

  await sendPendingEmails({ queue });
  assert.equal(claims, 0);
});

test("sendNow: не ушло — документ сохраняется один раз, с попыткой и failed", async (t) => {
  t.mock.method(Preferences, "findOne", async () => ({
    notify: { byEmail: { isActive: true } },
  }));
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  t.mock.method(mailSend, "sendMail", async () => ({
    success: false,
    failure: { state: "Сервер не отвечает", hint: "" },
  }));
  const notification = new Notification({
    instrument: "email",
    to: { email: "user@example.ru" },
    title: "Код для входа",
    text: "<p>1234</p>",
  });
  const saves = [];
  t.mock.method(notification, "save", async function save() {
    saves.push(this.toObject());
    return this;
  });

  const result = await sendNow(notification);

  assert.equal(result.success, false);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].attemptsCounter, 1);
  assert.equal(saves[0].failed, true);
  assert.equal(saves[0].sent, false);
});
````

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test services/mail/outbox.test.js`
Expected: `# fail 7` within about a second.
- The first error is `TypeError: createMailQueue is not a function`.
- The batch tests fail because the current `sendPendingEmails` ignores the injected queue and
  calls `Notification.find`. With `bufferCommands` off, that throws at once instead of hanging.
- The `sendNow` test fails because the current code saves twice and calls the destructured
  `sendMail`.

- [ ] **Step 3: Implement** (`backend/services/mail/outbox.js`, seven edits)

Edit 1 — `backend/services/mail/outbox.js`, current line 1. Replace:

````js
const Notification = require("@/models/notification");
````

with:

````js
const crypto = require("crypto");

const Notification = require("@/models/notification");
````

Edit 2 — `backend/services/mail/outbox.js`, current line 13. Replace:

````js
const { sendMail } = require("@/services/mail/send");
````

with:

````js
// Объектом модуля, а не деструктуризацией: тест подменяет sendMail
const mailSend = require("@/services/mail/send");
````

Edit 3 — `backend/services/mail/outbox.js`, current lines 55–62. Replace:

````js
/** Пора ли пробовать: попытки не исчерпаны и пауза между ними выдержана. */
const okToSend = (notification) =>
  NOTIFY_MAX_ATTEMPTS > notification.attemptsCounter &&
  (notification.attemptsCounter === 0 ||
    new Date(
      notification.updatedAt.getTime() + NOTIFY_RETRY_INTERVAL_MINUTES * 60000,
    ) < new Date());

````

with:

````js
/**
 * Аренда письма. Очередь — обычная коллекция, и «взять на отправку» обязано
 * быть атомарным: иначе два прогона — наложившиеся или перезапущенный посреди
 * пачки — отправят одно письмо дважды. Приём тот же, что у telegram-очереди
 * (controllers/bot.js, outboxPull/outboxAck): письмо берётся
 * `findOneAndUpdate` с leaseUntil/leaseId, исход пишется только по
 * `{_id, leaseId}`. Истёкшая аренда снова свободна — так очередь переживает
 * падение прогона.
 *
 * Срок: SMTP-обмен ограничен таймаутами транспорта (15 + 10 + 30 с,
 * services/mail/transport.js) — двух минут хватает с запасом.
 */
const LEASE_MS = 2 * 60 * 1000;

/** Сколько писем разбирает один прогон — как прежний limit(100). */
const BATCH_LIMIT = 100;

/**
 * Что можно брать: не отправлено, попытки не исчерпаны, пауза после прошлой
 * попытки выдержана (первая — сразу, повтор — не раньше
 * NOTIFY_RETRY_INTERVAL_MINUTES от updatedAt, как в прежнем okToSend), аренды
 * нет или она истекла. Отсутствие поля аренды значит «свободно».
 */
const claimableFilter = (now) => ({
  instrument: "email",
  sent: false,
  failed: false,
  attemptsCounter: { $lt: NOTIFY_MAX_ATTEMPTS },
  $and: [
    { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
    {
      $or: [
        { attemptsCounter: 0 },
        {
          updatedAt: {
            $lt: new Date(
              now.getTime() - NOTIFY_RETRY_INTERVAL_MINUTES * 60000,
            ),
          },
        },
      ],
    },
  ],
});

/**
 * Хранилище очереди. Модель и часы — параметры: тест проверяет запросы без
 * базы, а разбор пачки получает очередь в памяти.
 */
const createMailQueue = ({ model = Notification, now = () => new Date() } = {}) => ({
  /** Взять следующее письмо в аренду; null — брать нечего. */
  claim: (leaseId) => {
    const at = now();
    return model.findOneAndUpdate(
      claimableFilter(at),
      { $set: { leaseUntil: new Date(at.getTime() + LEASE_MS), leaseId } },
      // timestamps: false — updatedAt остаётся временем прошлой попытки: от
      // него считается пауза перед повтором
      { sort: { createdAt: 1 }, returnDocument: "after", timestamps: false },
    );
  },

  /**
   * Записать исход и снять аренду — только если она всё ещё наша.
   *
   * @returns {Promise<boolean>} false — аренда истекла и письмо уже переиграно
   */
  ack: async (notification, leaseId, fields) => {
    const result = await model.updateOne(
      { _id: notification._id, leaseId },
      { $set: { ...fields, leaseUntil: null, leaseId: null } },
    );
    return result.matchedCount === 1;
  },

  /** Удалить письмо, которое слать больше некому или не о чем, — по аренде. */
  drop: (notification, leaseId) =>
    model.deleteOne({ _id: notification._id, leaseId }),
});

const mailQueue = createMailQueue();

````

Edit 4 — `backend/services/mail/outbox.js`, current lines 80–131. Replace:

````js
const deliver = async (notification, channel) => {
  const label = recipientLabel(notification);

  const message = await sendMail(
    channel,
    notification.to.email,
    notification.title,
    "",
    /**
     * Письмо со своей вёрсткой (html) — документ с кнопкой, на него не
     * отвечают. ВНИМАНИЕ: если html появится у уведомлений по заявкам, маркер
     * придётся возвращать и сюда.
     */
    notification.html || textBody(notification),
  );

  // Состояние канала для строки в настройках: реальная отправка — самый честный
  // источник, куда точнее кнопки проверки.
  if (message?.success) {
    await recordOk(SMTP, { message: true });
  } else if (message?.failure) {
    await recordError(SMTP, message.failure);
  }

  notification.attemptsCounter += 1;

  if (message?.success) {
    notification.sent = true;
    await notification.save();
    await addTicketLog(
      notification.ticketId,
      `отправлено email-уведомление пользователю ${label}`,
      "info",
    );
    return message;
  }

  const exhausted = notification.attemptsCounter >= NOTIFY_MAX_ATTEMPTS;
  if (exhausted) {
    notification.failed = true;
  }
  await notification.save();

  await addTicketLog(
    notification.ticketId,
    exhausted
      ? `email-уведомление пользователю ${label} не было отправлено`
      : `при отправке email-уведомления пользователю ${label} произошла ошибка`,
    "danger",
  );
  return message;
};
````

with:

````js
/**
 * Одна попытка отправки: письмо уходит, исход возвращается полями для записи.
 * Документ не сохраняется — это дело вызывающего: очередь пишет исход по
 * аренде, sendNow вставляет документ уже с исходом.
 */
const attempt = async (notification, channel) => {
  const message = await mailSend.sendMail(
    channel,
    notification.to.email,
    notification.title,
    "",
    /**
     * Письмо со своей вёрсткой (html) — документ с кнопкой, на него не
     * отвечают. ВНИМАНИЕ: если html появится у уведомлений по заявкам, маркер
     * придётся возвращать и сюда.
     */
    notification.html || textBody(notification),
  );

  const attemptsCounter = notification.attemptsCounter + 1;
  const sent = Boolean(message?.success);
  const exhausted = !sent && attemptsCounter >= NOTIFY_MAX_ATTEMPTS;
  return {
    message,
    exhausted,
    fields: { attemptsCounter, sent, ...(exhausted ? { failed: true } : {}) },
  };
};

/**
 * Состояние канала и хроника заявки — ПОСЛЕ записи исхода и без права его
 * сорвать: письмо, которое ушло, не должно остаться «неотправленным» из-за
 * сбоя строки состояния.
 */
const recordOutcome = async (notification, { message, exhausted }) => {
  // Состояние канала для строки в настройках: реальная отправка — самый честный
  // источник, куда точнее кнопки проверки.
  try {
    if (message?.success) {
      await recordOk(SMTP, { message: true });
    } else if (message?.failure) {
      await recordError(SMTP, message.failure);
    }
  } catch (error) {
    logger.log("warn", "Не удалось записать состояние почтового канала", {
      module: "mailOutbox",
      error: error.message,
    });
  }

  const label = recipientLabel(notification);
  if (message?.success) {
    await addTicketLog(
      notification.ticketId,
      `отправлено email-уведомление пользователю ${label}`,
      "info",
    );
    return;
  }
  await addTicketLog(
    notification.ticketId,
    exhausted
      ? `email-уведомление пользователю ${label} не было отправлено`
      : `при отправке email-уведомления пользователю ${label} произошла ошибка`,
    "danger",
  );
};
````

Edit 5 — `backend/services/mail/outbox.js`, current lines 139–140. Replace:

````js
 * Принимает НЕСОХРАНЁННЫЙ документ и сохраняет его сам, уже с исходом (это
 * делает `deliver`). Сохранять заранее нельзя: между записью и концом
````

with:

````js
 * Принимает НЕСОХРАНЁННЫЙ документ и сохраняет его сам, уже с исходом, одной
 * записью. Сохранять заранее нельзя: между записью и концом
````

Edit 6 — `backend/services/mail/outbox.js`, current lines 161–167. Replace:

````js
  const message = await deliver(notification, prefs.notify.byEmail);
  if (!message?.success) {
    notification.failed = true;
    await notification.save();
  }
  return message || { success: false };
};
````

with:

````js
  const outcome = await attempt(notification, prefs.notify.byEmail);
  notification.set(outcome.fields);
  if (!outcome.message?.success) {
    notification.failed = true;
  }
  await notification.save();
  await recordOutcome(notification, outcome);
  return outcome.message || { success: false };
};
````

Edit 7 — `backend/services/mail/outbox.js`, current lines 169–233. Replace:

````js
exports.sendPendingEmails = async () => {
  const pending = await Notification.find({
    instrument: "email",
    sent: false,
    failed: false,
  }).limit(100);

  if (pending.length === 0) return;

  const prefs = await Preferences.findOne({});
  if (!prefs?.notify?.byEmail?.isActive) return;

  for (const notification of pending) {
    /**
     * Каждое письмо разбирается САМО ПО СЕБЕ.
     *
     * В прежней версии здесь стоял `return` вместо `continue`: одна заявка,
     * удалённая после постановки в очередь, обрывала разбор всей пачки, и
     * остальные письма ждали следующего тика. При череде таких документов
     * очередь двигалась по одному письму за двадцать секунд.
     */
    try {
      // Заявка удалена — уведомление о ней бессмысленно.
      if (notification.ticketId) {
        const ticket = await Ticket.findById(notification.ticketId).select("_id");
        if (!ticket) {
          await Notification.deleteOne({ _id: notification._id });
          continue;
        }
      }

      if (!notification.to?.email) {
        notification.failed = true;
        await notification.save();
        continue;
      }

      /**
       * Служебным учёткам не пишем. А вот ОТСУТСТВИЕ пользователя больше не
       * повод удалять письмо: прежний код удалял всё, чей адрес не нашёлся в
       * `users`, — то есть тихо выбрасывал переписку с внешними адресатами,
       * которые пишут в поддержку почтой и учётки не имеют.
       */
      const account = await User.findOne({ email: notification.to.email }).select(
        "isServiceAccount",
      );
      if (account?.isServiceAccount) {
        await Notification.deleteOne({ _id: notification._id });
        continue;
      }

      if (!okToSend(notification)) {
        continue;
      }

      await deliver(notification, prefs.notify.byEmail);
    } catch (error) {
      logger.log("error", "Не удалось отправить письмо из очереди", {
        module: "mailOutbox",
        notificationId: String(notification._id),
        error: error.message,
      });
    }
  }
};
````

with:

````js
/**
 * Разбор очереди: письма берутся в аренду по одному, пока есть что брать (не
 * больше BATCH_LIMIT за прогон).
 *
 * Очередь и отправка — параметры ради теста; крон зовёт без аргументов.
 *
 * @param {{ queue?: ReturnType<typeof createMailQueue>, send?: typeof attempt }} [deps]
 */
exports.sendPendingEmails = async ({ queue = mailQueue, send = attempt } = {}) => {
  const prefs = await Preferences.findOne({});
  if (!prefs?.notify?.byEmail?.isActive) return;

  // Свой ключ аренды у каждого прогона: подтверждение чужого не примется
  const leaseId = crypto.randomUUID();

  for (let taken = 0; taken < BATCH_LIMIT; taken += 1) {
    const notification = await queue.claim(leaseId);
    if (!notification) break;

    /**
     * Каждое письмо разбирается САМО ПО СЕБЕ.
     *
     * В прежней версии здесь стоял `return` вместо `continue`: одна заявка,
     * удалённая после постановки в очередь, обрывала разбор всей пачки, и
     * остальные письма ждали следующего тика. При череде таких документов
     * очередь двигалась по одному письму за двадцать секунд.
     *
     * Сбой посреди письма оставляет его в аренде: оно вернётся в очередь,
     * когда аренда истечёт, а не следующим тиком — прогон, упавший между
     * SMTP и подтверждением, не отправит его второй раз сразу же.
     */
    try {
      // Заявка удалена — уведомление о ней бессмысленно.
      if (notification.ticketId) {
        const ticket = await Ticket.findById(notification.ticketId).select("_id");
        if (!ticket) {
          await queue.drop(notification, leaseId);
          continue;
        }
      }

      if (!notification.to?.email) {
        await queue.ack(notification, leaseId, { failed: true });
        continue;
      }

      /**
       * Служебным учёткам не пишем. А вот ОТСУТСТВИЕ пользователя больше не
       * повод удалять письмо: прежний код удалял всё, чей адрес не нашёлся в
       * `users`, — то есть тихо выбрасывал переписку с внешними адресатами,
       * которые пишут в поддержку почтой и учётки не имеют.
       */
      const account = await User.findOne({ email: notification.to.email }).select(
        "isServiceAccount",
      );
      if (account?.isServiceAccount) {
        await queue.drop(notification, leaseId);
        continue;
      }

      const outcome = await send(notification, prefs.notify.byEmail);
      if (!(await queue.ack(notification, leaseId, outcome.fields))) {
        logger.log("warn", "Аренда письма истекла до подтверждения — исход не записан", {
          module: "mailOutbox",
          notificationId: String(notification._id),
        });
      }
      await recordOutcome(notification, outcome);
    } catch (error) {
      logger.log("error", "Не удалось отправить письмо из очереди", {
        module: "mailOutbox",
        notificationId: String(notification._id),
        error: error.message,
      });
    }
  }
};

exports.createMailQueue = createMailQueue;
exports.LEASE_MS = LEASE_MS;
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test services/mail/outbox.test.js`
Expected: `# tests 7`, `# pass 7`, `# fail 0`.

Run: `grep -n "okToSend\|deliver(" backend/services/mail/outbox.js`
Expected: no output.

Run: `cd backend && pnpm test`
Expected: no failures.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/services/mail/outbox.js`
- `backend/services/mail/outbox.test.js` (new)

---

### Task D5: Logs — no body dump, an allow-list of error fields, redacted URLs

**Files:**
- Create: `backend/helpers/redactUrl.js`
- Create: `backend/helpers/redactUrl.test.js`
- Create: `backend/middleware/errorHandling.test.js`
- Modify: `backend/utils/logger.js` (line 3; `endpoint` in `addContext` on line 97 and in `addNoAuthContext` on line 120)
- Modify: `backend/middleware/performance.js` (`performanceMonitor`, lines 1–10, 24 and 36)
- Modify: `backend/middleware/errorHandling.js`:
  - the header, lines 1–3;
  - the `originalError` block, lines 63–83;
  - `route`, line 96;
  - the last-resort `console.error`, line 132.
- Modify: `backend/controllers/user.js`, `exports.add`, lines 687–692 (the `console.log`
  call and the blank line after it). Nothing else in `user.js` changes; the account-management
  section edits `update` and `updateMyAccount`.

Not touched: `controllers/external/ticket.js`, whose `req.body` log belongs to the
external-API section.

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `redactUrl(url?: string): string | undefined` in `backend/helpers/redactUrl.js`. It drops
    everything from the first `?`, and it replaces the segment after `/external/approval/`
    with `***`. A non-string comes back unchanged.
  - `errorResponse` logs `originalError` as `{ name?, message?, code?, statusCode?, stack? }`.
    A thrown non-object becomes `{ message: String(value) }`.

**Why an allow-list:**
- **Parse errors carry the raw body.** Before this, a body-parser `SyntaxError` put the raw
  request body into the log through `for (key in originalError)`. On `/api/login`, that body
  holds the password.
- **Mongo carries the key value.** A duplicate-key error logged `keyValue`, which holds an
  e-mail.
- **HTTP clients carry the config.** Their errors logged `config`, headers included.

**What `redactUrl` covers:**
- `utils/logger.js`: `endpoint` in both context loggers;
- `middleware/errorHandling.js`: `route`;
- `middleware/performance.js`: the slow-request log and the development request log. Both now
  use the redacted `req.originalUrl`; before, they used `req.url`, which is shortened inside
  routers.

`middleware/requireMcpKey.js` also logs `req.originalUrl`, but the spec doesn't list it and
the MCP key travels in a header. It stays as it is.

- [ ] **Step 1: Write the failing tests**

Create `backend/helpers/redactUrl.test.js`:

````js
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
````

Create `backend/middleware/errorHandling.test.js`:

````js
// node --test middleware/errorHandling.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../utils/logger");
const { AppError, errorResponse } = require("./errorHandling");

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
    message: "Unexpected end of JSON input",
    statusCode: 400,
    stack: parseError.stack,
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
````

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && node --test helpers/redactUrl.test.js middleware/errorHandling.test.js`
Expected: `# fail 4`.
- `helpers/redactUrl.test.js` fails at load with `Error: Cannot find module './redactUrl'`.
- All three errorHandling tests fail:
  - the logged `originalError` still has `keyValue` and `config`;
  - the parse error still logs `body`, `type` and `expose`;
  - `route` and `endpoint` keep the query and the token.

- [ ] **Step 3: Implement**

Create `backend/helpers/redactUrl.js`:

````js
/**
 * Адрес запроса для журнала: без строки запроса и без токена в пути.
 *
 * В query бывает что угодно, включая токены входа
 * (`/api/auth/magic-link/verify?token=…`), а в пути
 * `/api/external/approval/:token` сам токен и есть авторизация: ссылка из
 * письма открывает отчёт без входа. Журнал читают те, кому эти ссылки не
 * адресованы.
 */
const APPROVAL_TOKEN = /(\/external\/approval\/)[^/]+/;

/**
 * @param {string} [url] `req.originalUrl`
 * @returns {string|undefined} путь без query, токен согласования — `***`
 */
const redactUrl = (url) => {
  if (typeof url !== "string") return url;
  const queryAt = url.indexOf("?");
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  return path.replace(APPROVAL_TOKEN, "$1***");
};

module.exports = { redactUrl };
````

`backend/utils/logger.js`:

Edit 1 — `backend/utils/logger.js`, current line 3. Replace:

````js
const DailyRotateFile = require("winston-daily-rotate-file");
````

with:

````js
const DailyRotateFile = require("winston-daily-rotate-file");

const { redactUrl } = require("../helpers/redactUrl");
````

Edit 2 — `backend/utils/logger.js`, current lines 97 and 120. This text occurs 2 times; replace every occurrence (Edit tool: `replace_all: true`). Replace:

````js
        endpoint: req?.originalUrl,
````

with:

````js
        // Без query и токена согласования (helpers/redactUrl)
        endpoint: redactUrl(req?.originalUrl),
````

`backend/middleware/performance.js`:

Edit 1 — `backend/middleware/performance.js`, current lines 1–10. Replace:

````js
const logger = require("../utils/logger");

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const start = Date.now();

  // Track request details
  const requestInfo = {
    method: req.method,
    url: req.url,
````

with:

````js
const logger = require("../utils/logger");
const { redactUrl } = require("../helpers/redactUrl");

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  // В журнал — без query и токена согласования (helpers/redactUrl)
  const url = redactUrl(req.originalUrl);

  // Track request details
  const requestInfo = {
    method: req.method,
    url,
````

Edit 2 — `backend/middleware/performance.js`, current line 24. Replace:

````js
        `Slow request detected: ${req.method} ${req.url} - ${duration}ms`,
````

with:

````js
        `Slow request detected: ${req.method} ${url} - ${duration}ms`,
````

Edit 3 — `backend/middleware/performance.js`, current line 36. Replace:

````js
        `${req.method} ${req.url} - ${duration}ms - ${res.statusCode}`,
````

with:

````js
        `${req.method} ${url} - ${duration}ms - ${res.statusCode}`,
````

`backend/middleware/errorHandling.js`:

Edit 1 — `backend/middleware/errorHandling.js`, current lines 1–3. Replace:

````js
const logger = require("../utils/logger");

class AppError extends Error {
````

with:

````js
const logger = require("../utils/logger");
const { redactUrl } = require("../helpers/redactUrl");

/**
 * Поля исходной ошибки, которые попадают в журнал. Белый список, а не «всё
 * перечислимое»: у ошибок драйверов и библиотек в собственных свойствах лежит
 * что угодно — сырое тело запроса у ошибки разбора JSON (с паролем входа),
 * значение ключа у дубликата в Mongo, заголовки и конфиг у HTTP-клиентов.
 */
const LOGGED_ERROR_FIELDS = ["name", "message", "code", "statusCode", "stack"];

const pickErrorFields = (error) => {
  if (error === null || typeof error !== "object") {
    return { message: String(error) };
  }
  const picked = {};
  for (const field of LOGGED_ERROR_FIELDS) {
    if (error[field] !== undefined) picked[field] = error[field];
  }
  return picked;
};

class AppError extends Error {
````

Edit 2 — `backend/middleware/errorHandling.js`, current lines 63–83. Replace:

````js
    // Include original error details if they exist
    if (standardError.originalError) {
      logData.originalError = {
        message: standardError.originalError.message,
        stack: standardError.originalError.stack,
        name: standardError.originalError.name,
      };

      // Include all enumerable properties from the original error
      for (const key in standardError.originalError) {
        if (
          Object.prototype.hasOwnProperty.call(
            standardError.originalError,
            key,
          ) &&
          !logData.originalError[key]
        ) {
          logData.originalError[key] = standardError.originalError[key];
        }
      }
    }
````

with:

````js
    // Исходная ошибка — только поля из белого списка (LOGGED_ERROR_FIELDS)
    if (standardError.originalError) {
      logData.originalError = pickErrorFields(standardError.originalError);
    }
````

Edit 3 — `backend/middleware/errorHandling.js`, current line 96. Replace:

````js
        route: req.originalUrl,
````

with:

````js
        route: redactUrl(req.originalUrl),
````

Edit 4 — `backend/middleware/errorHandling.js`, current line 132. Replace:

````js
    console.error("Original error:", error);
````

with:

````js
    console.error("Original error:", pickErrorFields(error));
````

**`backend/controllers/user.js`, `exports.add`.** Delete the `console.log(…)` call that opens
the handler. It is currently lines 687–691: the call whose message reads «Создание нового
пользователя. Данные запроса:», with the payload `{ body: req.body, userId: req.userId,
headers: … }`. Delete the blank line after it as well. The message starts with an emoji, so a
line-addressed command is safer than retyping it:

```bash
cd backend
sed -i '/Создание нового пользователя. Данные запроса:/,/^$/d' controllers/user.js
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test helpers/redactUrl.test.js middleware/errorHandling.test.js`
Expected: `# tests 8`, `# pass 8`, `# fail 0`.

Run: `cd backend && grep -n "body: req.body" controllers/user.js; sed -n '/^exports.add = async/,+2p' controllers/user.js; node --check controllers/user.js`
Expected:
- the `grep` prints nothing;
- `sed` prints three lines: `exports.add = async (req, res, next) => {`, `  try {` and
  `    const {`;
- `node --check` prints nothing.

Run: `cd backend && pnpm test`
Expected: no failures.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/helpers/redactUrl.js` (new)
- `backend/helpers/redactUrl.test.js` (new)
- `backend/middleware/errorHandling.test.js` (new)
- `backend/utils/logger.js`
- `backend/middleware/performance.js`
- `backend/middleware/errorHandling.js`
- `backend/controllers/user.js`

---

### Task D6: An undecryptable secret returns 422 instead of 500

**Files:**
- Modify: `backend/helpers/preferencesSecrets.js` (from `readStoredSecret`, lines 90–102, to the end of the file)
- Modify: `backend/services/speechToTextService.js` (`resolveSpeechConfig`, lines 126–147)
- Modify: `backend/services/aiService.js` (`resolveProviderConfig`, line 331; it passes the path, which makes the runtime log say which key failed)
- Modify: `backend/controllers/preferences.js`:
  - the import, lines 14–18;
  - `findMailInvariant`, lines 63–65 and 86–88;
  - `findAiInvariant`, lines 104–106, 121–122 and 131–132;
  - the `catch` of `exports.update`, lines 524–527.
- Modify: `backend/package.json` (the `test` script, line 13: add the `controllers` glob)
- Create: `backend/helpers/preferencesSecrets.test.js`
- Create: `backend/controllers/preferences.test.js`

**Interfaces:**
- Consumes: `decryptSecret` and `isEncrypted` from `backend/services/crypto/secretBox.js`,
  which is unchanged.
- Produces, from `backend/helpers/preferencesSecrets.js`:
  - `SecretUnreadableError`:
    - `name` is `"SecretUnreadableError"`;
    - `path` is the setting path from `SECRET_PATHS`;
    - `cause` is the decrypt error;
    - `message` reads `Stored secret <path> cannot be decrypted: <cause>`.
  - `readStoredSecret(stored, path?)`. `path` is optional, so existing callers keep working.
  - `isSecretReadable(stored, path): boolean`.
  - `createLenientSecretReader()`. It returns `{ read(stored, path): string, unreadable:
    string[] }`, and it returns `""` for an unreadable secret.
  - `unreadableSecretMessage(path)`, which reads «Сохранённое значение «{название}» не
    читается — введите его заново».
  - `SECRET_LABELS`: the path → label pairs for all 10 `SECRET_PATHS`.
- Also produced:
  - `resolveSpeechConfig(ai, readSecret = readStoredSecret)` in
    `services/speechToTextService.js`. It now passes `ai.speechToText[.yandex|.local].apiKey`,
    or `ai.<provider>.apiKey` when the credentials are shared.

**Where the path comes from.**
- `readStoredSecret` takes it as its second argument.
- The invariants pass the literal path they check: `"mailbox.password"`,
  `"notify.byEmail.pass"` and `` `ai.${provider}.apiKey` ``.
- `resolveSpeechConfig` works out the path of the key it actually reads.

**The rule: "unreadable" counts as "not set", but only where the invariant needs the secret.**
- **The mailbox password and the SMTP password** (when `authMethod` isn't `none`), and **the
  chat provider's key**, except for `local`, whose key is optional, so an unreadable one there
  counts as empty.
- **The speech key** is read through the lenient reader. If the resolved key comes out empty
  because it couldn't be read, the answer names that path.
- **Secrets the active configuration doesn't use never block a save.** An optional secret can't
  be cleared through the form either, since an empty field means "keep".
- **A safety net.** `update`'s `catch` also turns any stray `SecretUnreadableError` into the same
  422.
- **The runtime users keep failing and logging as they do now.** Sending mail goes through
  `transport.readSecret`, which is unchanged. The AI calls, `checkAi`, `checkSpeechToText` and
  the model list now throw the typed error instead of the raw one.

- [ ] **Step 1: Write the failing tests** (and make `pnpm test` pick up controller tests)

Create `backend/helpers/preferencesSecrets.test.js`:

````js
// node --test helpers/preferencesSecrets.test.js
require("module-alias/register");
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { encryptSecret } = require("../services/crypto/secretBox");
const {
  SECRET_PATHS,
  SECRET_LABELS,
  SecretUnreadableError,
  readStoredSecret,
  isSecretReadable,
  createLenientSecretReader,
  unreadableSecretMessage,
} = require("./preferencesSecrets");

// Шифртекст нашего формата, но под другим ключом — как после потери APP_ENC_KEY
const foreignCiphertext = (plaintext) => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

test("пустое, открытый текст и свой шифртекст читаются как прежде", () => {
  assert.equal(readStoredSecret("", "mailbox.password"), "");
  assert.equal(readStoredSecret(undefined), "");
  assert.equal(readStoredSecret("plain-old", "mailbox.password"), "plain-old");
  assert.equal(readStoredSecret(encryptSecret("s3cret"), "mailbox.password"), "s3cret");
});

test("шифртекст под чужим ключом или битый — SecretUnreadableError с путём", () => {
  assert.throws(
    () => readStoredSecret(foreignCiphertext("s3cret"), "notify.byEmail.pass"),
    (error) => {
      assert.ok(error instanceof SecretUnreadableError);
      assert.equal(error.path, "notify.byEmail.pass");
      assert.match(error.message, /notify\.byEmail\.pass cannot be decrypted/);
      return true;
    },
  );
  assert.throws(
    () => readStoredSecret("v1:broken", "ai.openai.apiKey"),
    SecretUnreadableError,
  );
});

test("ответ 422 называет поле так, как оно подписано в настройках", () => {
  assert.equal(
    unreadableSecretMessage("mailbox.password"),
    "Сохранённое значение «Пароль почтового ящика» не читается — введите его заново",
  );
  for (const path of SECRET_PATHS) {
    assert.ok(SECRET_LABELS[path], `нет подписи для ${path}`);
  }
});

test("для инвариантов нечитаемый секрет — незаданный", () => {
  assert.equal(isSecretReadable(encryptSecret("x"), "ai.openai.apiKey"), true);
  assert.equal(isSecretReadable(foreignCiphertext("x"), "ai.openai.apiKey"), false);

  const secrets = createLenientSecretReader();
  assert.equal(secrets.read(foreignCiphertext("x"), "ai.speechToText.apiKey"), "");
  assert.equal(secrets.read("plain", "ai.speechToText.yandex.apiKey"), "plain");
  assert.deepEqual(secrets.unreadable, ["ai.speechToText.apiKey"]);
});
````

Create `backend/controllers/preferences.test.js`:

````js
// node --test controllers/preferences.test.js
require("module-alias/register");
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит десять
// секунд в ожидании подключения
mongoose.set("bufferCommands", false);

const Preferences = require("../models/preferences");
const { encryptSecret } = require("../services/crypto/secretBox");
const { update } = require("./preferences");

// Шифртекст нашего формата, но под другим ключом — как после потери APP_ENC_KEY
const foreignCiphertext = (plaintext) => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

// Документ настроек «из базы»; сохранение подменено и считается
const storedPreferences = (t, fields) => {
  const doc = new Preferences(fields);
  const saves = [];
  t.mock.method(doc, "save", async () => {
    saves.push(doc.toObject());
    return doc;
  });
  t.mock.method(Preferences, "findOne", async () => doc);
  return saves;
};

const callUpdate = async (body) => {
  let passed;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await update({ body, auth: { user: { _id: "u1" } } }, res, (error) => {
    passed = error;
  });
  return { res, error: passed };
};

const activeMailbox = (password) => ({
  isActive: true,
  address: "support@example.ru",
  host: "imap.example.ru",
  port: 993,
  password,
});

const defaultApplicant = {
  _id: new mongoose.Types.ObjectId(),
  firstName: "Служба",
  lastName: "Поддержки",
};

test("пароль ящика под чужим ключом — 422 с названием поля, без сохранения", async (t) => {
  const saves = storedPreferences(t, {
    mailbox: activeMailbox(foreignCiphertext("imap-pass")),
    defaultApplicant,
  });

  const { error } = await callUpdate({ timezone: "Asia/Vladivostok" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «Пароль почтового ящика» не читается — введите его заново",
  );
  assert.equal(saves.length, 0);
});

test("пароль, введённый заново, снимает блокировку", async (t) => {
  const saves = storedPreferences(t, {
    mailbox: activeMailbox(foreignCiphertext("old-pass")),
    defaultApplicant,
  });

  const { res, error } = await callUpdate({ mailbox: { password: "новый пароль" } });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});

test("пароль SMTP под чужим ключом — 422", async (t) => {
  storedPreferences(t, {
    notify: {
      byEmail: {
        isActive: true,
        host: "smtp.example.ru",
        port: 465,
        sendFromEmail: "hd@example.ru",
        user: "hd",
        pass: foreignCiphertext("smtp-pass"),
      },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «Пароль SMTP» не читается — введите его заново",
  );
});

test("ключ распознавания речи под чужим ключом — 422 вместо прежних 500", async (t) => {
  storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "openai",
      openai: { apiKey: encryptSecret("sk-chat"), model: "gpt-4o" },
      speechToText: {
        isActive: true,
        provider: "openai",
        apiKey: foreignCiphertext("sk-speech"),
      },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «API-ключ OpenAI для распознавания речи» не читается — введите его заново",
  );
});

test("ключ чат-провайдера под чужим ключом — 422 с его названием", async (t) => {
  storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "anthropic",
      anthropic: { apiKey: foreignCiphertext("sk-ant"), model: "claude-opus-4-8" },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «API-ключ Anthropic» не читается — введите его заново",
  );
});

test("необязательный ключ локальной модели сохранению не мешает", async (t) => {
  const saves = storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "local",
      local: {
        baseUrl: "http://ollama.example.ru:11434",
        apiKey: foreignCiphertext("proxy-key"),
        model: "llama3",
      },
    },
  });

  const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});
````

Add the controllers glob to `backend/package.json`. Check first with
`grep -c 'controllers/\*\*/\*.test.js' backend/package.json`. If it prints `1`, another section
has already added it, so skip this edit. If it prints `0`:

Edit 1 — `backend/package.json`, current line 13. Replace:

````json
\"routes/**/*.test.js\"",
````

with:

````json
\"routes/**/*.test.js\" \"controllers/**/*.test.js\"",
````

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && node --test helpers/preferencesSecrets.test.js controllers/preferences.test.js`
Expected: `# tests 10`, `# pass 3`, `# fail 7`.
- The helper tests fail: the current module has no `SecretUnreadableError`, `isSecretReadable`
  and so on, and a foreign ciphertext throws a plain `Error`.
- The mailbox, SMTP and Anthropic cases fail with `Cannot read properties of undefined
  (reading 'statusCode')`, because the current code saves and answers 200.
- The speech case fails with `expected: 422` and `actual: 500`. That is the O6 lockout.
- «пароль, введённый заново…», «необязательный ключ локальной модели…» and «пустое, открытый
  текст…» already pass.

- [ ] **Step 3: Implement**

`backend/helpers/preferencesSecrets.js`:

Edit 1 — `backend/helpers/preferencesSecrets.js`, current lines 90–102. Replace:

````js
// Читает секрет для использования (сравнение/отправка), понимая оба вида хранения.
const readStoredSecret = (stored) => {
  if (!stored) return "";
  return isEncrypted(stored) ? decryptSecret(stored) : stored;
};

module.exports = {
  SECRET_PATHS,
  maskSecrets,
  resolveSecret,
  keepStoredSecrets,
  readStoredSecret,
};
````

with:

````js
// Как поля называются на экране настроек — для ответа «введите заново».
const SECRET_LABELS = {
  "mailbox.password": "Пароль почтового ящика",
  "notify.byEmail.pass": "Пароль SMTP",
  "ai.openai.apiKey": "API-ключ OpenAI",
  "ai.anthropic.apiKey": "API-ключ Anthropic",
  "ai.deepseek.apiKey": "API-ключ DeepSeek",
  "ai.yandexai.apiKey": "API-ключ Yandex AI Studio",
  "ai.local.apiKey": "API-ключ локальной модели",
  "ai.speechToText.apiKey": "API-ключ OpenAI для распознавания речи",
  "ai.speechToText.yandex.apiKey": "API-ключ Yandex SpeechKit",
  "ai.speechToText.local.apiKey": "API-ключ сервера распознавания",
};

/**
 * Сохранённый секрет не расшифровывается: шифртекст под другим ключом
 * (APP_ENC_KEY сменился или потерян) либо испорчен. Отдельный тип — чтобы
 * сохранение настроек отвечало 422 «введите заново», а не 500, после которого
 * настройки не сохранить вовсе.
 */
class SecretUnreadableError extends Error {
  /**
   * @param {string} [path] путь секрета из SECRET_PATHS
   * @param {Error} [cause] исходная ошибка расшифровки
   */
  constructor(path, cause) {
    super(
      `Stored secret ${path || "(unknown path)"} cannot be decrypted: ${cause?.message || "unknown error"}`,
    );
    this.name = "SecretUnreadableError";
    this.path = path;
    this.cause = cause;
  }
}

/** Текст ответа 422: называет поле, которое нужно ввести заново. */
const unreadableSecretMessage = (path) =>
  `Сохранённое значение «${SECRET_LABELS[path] || path}» не читается — введите его заново`;

// Читает секрет для использования (сравнение/отправка), понимая оба вида хранения.
// path — путь секрета в настройках (SECRET_PATHS): его назовёт
// SecretUnreadableError, если шифртекст не расшифруется.
const readStoredSecret = (stored, path) => {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored;
  try {
    return decryptSecret(stored);
  } catch (error) {
    throw new SecretUnreadableError(path, error);
  }
};

/**
 * Читается ли сохранённый секрет — для инвариантов настроек: нечитаемый для
 * них то же, что незаданный.
 */
const isSecretReadable = (stored, path) => {
  try {
    readStoredSecret(stored, path);
    return true;
  } catch (error) {
    if (error instanceof SecretUnreadableError) return false;
    throw error;
  }
};

/**
 * Читатель секретов для инвариантов: нечитаемый секрет — пустая строка, а его
 * путь запоминается, чтобы ответ назвал именно это поле.
 */
const createLenientSecretReader = () => {
  const unreadable = [];
  const read = (stored, path) => {
    try {
      return readStoredSecret(stored, path);
    } catch (error) {
      if (!(error instanceof SecretUnreadableError)) throw error;
      unreadable.push(path);
      return "";
    }
  };
  return { read, unreadable };
};

module.exports = {
  SECRET_PATHS,
  SECRET_LABELS,
  SecretUnreadableError,
  maskSecrets,
  resolveSecret,
  keepStoredSecrets,
  readStoredSecret,
  isSecretReadable,
  createLenientSecretReader,
  unreadableSecretMessage,
};
````

`backend/services/speechToTextService.js`:

Edit 1 — `backend/services/speechToTextService.js`, current lines 126–147. Replace:

````js
 * @param {object} ai группа настроек ИИ (уже слитая с черновиком формы)
 * @returns {{ provider: string, apiKey: string, folderId: string, baseUrl: string, model: string, shared: boolean }}
 */
const resolveSpeechConfig = (ai) => {
  const speechToText = ai?.speechToText || {};
  const provider = speechToText.provider || "openai";
  const own =
    provider === "yandex"
      ? speechToText.yandex || {}
      : provider === "local"
        ? speechToText.local || {}
        : speechToText;

  const shared =
    !!speechToText.useProviderCredentials &&
    exports.canShareCredentials(ai?.provider, provider);
  const source = shared ? ai[ai.provider] || {} : own;

  return {
    provider,
    // В базе ключ лежит шифртекстом secretBox — наружу уходит расшифрованный
    apiKey: readStoredSecret(source.apiKey),
````

with:

````js
 * @param {object} ai группа настроек ИИ (уже слитая с черновиком формы)
 * @param {(stored: string, path: string) => string} [readSecret] чтение
 *   шифртекста; инварианты настроек передают «мягкое», которое не бросает
 * @returns {{ provider: string, apiKey: string, folderId: string, baseUrl: string, model: string, shared: boolean }}
 */
const resolveSpeechConfig = (ai, readSecret = readStoredSecret) => {
  const speechToText = ai?.speechToText || {};
  const provider = speechToText.provider || "openai";
  const ownPath =
    provider === "yandex"
      ? "ai.speechToText.yandex"
      : provider === "local"
        ? "ai.speechToText.local"
        : "ai.speechToText";
  const own =
    provider === "yandex"
      ? speechToText.yandex || {}
      : provider === "local"
        ? speechToText.local || {}
        : speechToText;

  const shared =
    !!speechToText.useProviderCredentials &&
    exports.canShareCredentials(ai?.provider, provider);
  const source = shared ? ai[ai.provider] || {} : own;
  const sourcePath = shared ? `ai.${ai.provider}` : ownPath;

  return {
    provider,
    // В базе ключ лежит шифртекстом secretBox — наружу уходит расшифрованный
    apiKey: readSecret(source.apiKey, `${sourcePath}.apiKey`),
````

`backend/services/aiService.js`:

Edit 1 — `backend/services/aiService.js`, current line 331. Replace:

````js
    apiKey: readStoredSecret(providerConfig?.apiKey),
````

with:

````js
    apiKey: readStoredSecret(
      providerConfig?.apiKey,
      provider ? `ai.${provider}.apiKey` : undefined,
    ),
````

`backend/controllers/preferences.js`:

Edit 1 — `backend/controllers/preferences.js`, current lines 14–18. Replace:

````js
const {
  maskSecrets,
  keepStoredSecrets,
  readStoredSecret,
} = require("../helpers/preferencesSecrets");
````

with:

````js
const {
  maskSecrets,
  keepStoredSecrets,
  readStoredSecret,
  SecretUnreadableError,
  isSecretReadable,
  createLenientSecretReader,
  unreadableSecretMessage,
} = require("../helpers/preferencesSecrets");
````

Edit 2 — `backend/controllers/preferences.js`, current lines 63–65. Replace:

````js
    if (!mailbox.password) {
      return "Укажите пароль почтового ящика";
    }
````

with:

````js
    if (!mailbox.password) {
      return "Укажите пароль почтового ящика";
    }
    // Шифртекст под другим ключом для инварианта — всё равно что пароля нет
    if (!isSecretReadable(mailbox.password, "mailbox.password")) {
      return unreadableSecretMessage("mailbox.password");
    }
````

Edit 3 — `backend/controllers/preferences.js`, current lines 86–88. Replace:

````js
      if (!smtp.pass) {
        return "Укажите пароль SMTP или выключите авторизацию";
      }
````

with:

````js
      if (!smtp.pass) {
        return "Укажите пароль SMTP или выключите авторизацию";
      }
      if (!isSecretReadable(smtp.pass, "notify.byEmail.pass")) {
        return unreadableSecretMessage("notify.byEmail.pass");
      }
````

Edit 4 — `backend/controllers/preferences.js`, current lines 104–106. Replace:

````js
  if (!config.apiKey && needsApiKey(provider)) {
    return "Укажите API-ключ поставщика ИИ — без него ответов не будет";
  }
````

with:

````js
  if (!config.apiKey && needsApiKey(provider)) {
    return "Укажите API-ключ поставщика ИИ — без него ответов не будет";
  }
  // Ключ локальной модели необязателен: нечитаемый там — то же, что пустой
  if (
    needsApiKey(provider) &&
    !isSecretReadable(config.apiKey, `ai.${provider}.apiKey`)
  ) {
    return unreadableSecretMessage(`ai.${provider}.apiKey`);
  }
````

Edit 5 — `backend/controllers/preferences.js`, current lines 121–122. Replace:

````js
  if (ai.speechToText?.isActive) {
    const speech = resolveSpeechConfig(ai);
````

with:

````js
  if (ai.speechToText?.isActive) {
    // Нечитаемый ключ распознавания — незаданный; ответ назовёт именно его
    const secrets = createLenientSecretReader();
    const speech = resolveSpeechConfig(ai, secrets.read);
````

Edit 6 — `backend/controllers/preferences.js`, current lines 131–132. Replace:

````js
    } else if (!speech.apiKey) {
      return speech.provider === "yandex"
````

with:

````js
    } else if (!speech.apiKey) {
      if (secrets.unreadable.length) {
        return unreadableSecretMessage(secrets.unreadable[0]);
      }
      return speech.provider === "yandex"
````

Edit 7 — `backend/controllers/preferences.js`, current lines 524–527. Replace:

````js
  } catch (error) {
    next(new AppError(`Failed to update preferences`, 500, true, error));
  }
};
````

with:

````js
  } catch (error) {
    // Инварианты нечитаемые секреты уже называют; это — страховка на случай,
    // если шифртекст расшифровывается где-то ещё по дороге к save
    if (error instanceof SecretUnreadableError) {
      return next(new AppError(unreadableSecretMessage(error.path), 422, true));
    }
    next(new AppError(`Failed to update preferences`, 500, true, error));
  }
};
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test helpers/preferencesSecrets.test.js controllers/preferences.test.js`
Expected: `# tests 10`, `# pass 10`, `# fail 0`.

Run: `cd backend && pnpm test`
Expected: no failures. `controllers/preferences.test.js` now runs as part of the suite.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/helpers/preferencesSecrets.js`
- `backend/services/speechToTextService.js`
- `backend/services/aiService.js`
- `backend/controllers/preferences.js`
- `backend/package.json`
- `backend/helpers/preferencesSecrets.test.js` (new)
- `backend/controllers/preferences.test.js` (new)

---

### Task D7: S14 — scrub the router details and keep the probe out of the image

**Files:**
- Modify: `backend/scripts/mikrotikUpgradeProbe.js` (line 6, the usage comment)
- Modify: `docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md` (line 324, the usage comment in the code listing; line 396, the command in "Step 5: Owner gate")
- Modify: `backend/.dockerignore` (append after `.DS_Store`, the last line)
- Modify: `docs/mikrotik-management.md` (the **Probe** bullet, lines 788–789)

**Interfaces:** none. These are a comment, documentation and a build-context rule. No code
imports the probe: `grep -rn mikrotikUpgradeProbe backend --include='*.js'` finds only the file
itself, so `scripts/migrate.js` and everything else it needs stay in the image.

**Where the values are.** The real host, API user and port-knock sequence sit on the three
lines named above. They are not repeated here. The edits are pattern-based, so neither the
plan nor the commands contain them. Line 396 already has `…` for the host and the knock, but
it still carries the real API user.

**Left with the owner (spec):** rotating the knock sequence, and what to do about git history.

- [ ] **Step 1: Write the failing check**

S14 has no unit to test, so the check is a command with a defined count:

```bash
sed -n 6p backend/scripts/mikrotikUpgradeProbe.js | grep -cE -- '([0-9]{1,3}\.){3}[0-9]{1,3}|--knock [0-9]|--user [a-z]'
sed -n '324p;396p' docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md | grep -cE -- '([0-9]{1,3}\.){3}[0-9]{1,3}|--knock [0-9]|--user [a-z]'
grep -cx 'scripts/mikrotikUpgradeProbe.js' backend/.dockerignore
```

- [ ] **Step 2: Run it to verify it fails**

Expected now: `1`, `2`, `0`, one number per line. The first two must reach 0 and the last must
reach 1.

- [ ] **Step 3: Implement**

Replace the values with placeholders. The sed patterns match the argument shape, not the
values:

```bash
sed -i '6s|--host [^ ]* --port 8729 --user [^ ]* --knock [^ ]*|--host <router-host> --port 8729 --user <api-user> --knock <port1,port2,port3>|' backend/scripts/mikrotikUpgradeProbe.js
sed -i -e '324s|--host [^ ]* --port 8729 --user [^ ]* --knock [^ ]*|--host <router-host> --port 8729 --user <api-user> --knock <port1,port2,port3>|' \
       -e '396s|--host [^ ]* --user [^ ]* --knock [^`]*`|--host <router-host> --user <api-user> --knock <port1,port2,port3>`|' \
       docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md
```

After this:
- Line 6 of the probe reads
  `//     --host <router-host> --port 8729 --user <api-user> --knock <port1,port2,port3> [--ssh-port 22]`.
- Line 324 of the plan reads
  `//     --host <router-host> --port 8729 --user <api-user> --knock <port1,port2,port3>`.
- On line 396, the command ends with
  `… node scripts/mikrotikUpgradeProbe.js --host <router-host> --user <api-user> --knock <port1,port2,port3>`.
  followed by a closing backtick and `. Record in this plan, …`.

Exclude the probe from the image:

Edit 1 — `backend/.dockerignore`, current line 23. Replace:

````
.DS_Store
````

with:

````
.DS_Store
# Live-device probe with direct connection parameters: a developer tool run from
# a checkout or the dev container, never part of the product image
scripts/mikrotikUpgradeProbe.js
````

Say so in the module doc:

Edit 1 — `docs/mikrotik-management.md`, current lines 788–789. Replace:

````markdown
- **Probe**: `scripts/mikrotikUpgradeProbe.js` runs the read-only commands
  against one device with direct parameters.
````

with:

````markdown
- **Probe**: `scripts/mikrotikUpgradeProbe.js` runs the read-only commands
  against one device with direct parameters. It is excluded from the
  production image (`backend/.dockerignore`); run it from a checkout or the dev
  container.
````

- [ ] **Step 4: Run the check to verify it passes**

Re-run the three commands from Step 1. Expected: `0`, `0`, `1`.

Run: `git diff --numstat -- backend/scripts/mikrotikUpgradeProbe.js docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md`
Expected: `1	1` for the probe and `2	2` for the plan. Only the scrubbed lines changed.

Run: `git grep -nE -- '--knock [0-9]+,[0-9]+'; node --check backend/scripts/mikrotikUpgradeProbe.js`
Expected: no output from either.

An optional image check needs the Docker daemon, so the sandbox must be off. `cd backend &&
printf 'FROM scratch\nCOPY . /ctx\n' | docker buildx build -f - --output type=local,dest="$TMPDIR/ctx" .`,
then `test ! -e "$TMPDIR/ctx/ctx/scripts/mikrotikUpgradeProbe.js" && test -e "$TMPDIR/ctx/ctx/scripts/migrate.js"`.

- [ ] **Step 5: Leave uncommitted**

Changed files:
- `backend/scripts/mikrotikUpgradeProbe.js`
- `docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md`
- `backend/.dockerignore`
- `docs/mikrotik-management.md`

Rotating the knock sequence and cleaning git history are left to the owner.

---

### Task Z: Full verification and hand-over to main (no commit)

**Files:**
- No new code. This task produces a patch, main's working tree gets the changes, and the owner gets a hand-over report.

**Interfaces:**
- Consumes: everything from Tasks 0–D7.
- Produces: the W1 changes, uncommitted, in `/home/aleksey/projects/hd`.

- [ ] **Step 1: Run every suite in the worktree**

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security/backend && pnpm test 2>&1 | tail -8
cd /home/aleksey/projects/worktrees/hd/w1-security/tg-service && pnpm test 2>&1 | tail -8
cd /home/aleksey/projects/worktrees/hd/w1-security/frontend && pnpm typecheck 2>&1 | tail -15 ; pnpm build 2>&1 | tail -5
```

Expected:
- **backend:** `# fail 0`, with `# pass` equal to Task 0's baseline plus the new tests.
- **tg-service:** `# fail 0`.
- **typecheck:** exactly the 3 errors recorded in Task 0.
- **build:** completes.

If anything fails, fix it inside the task that owns the code before going on.

- [ ] **Step 2: Static checks for the things tests can't see**

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security
# no request-body dumps left
grep -n "body: req.body" backend/controllers/user.js backend/controllers/external/ticket.js ; echo "exit=$?"   # expected: exit=1 (no matches)
# every subject tag goes through the helper
grep -n '\[F1-HD-\${' backend/middleware/notifications.js ; echo "exit=$?"                                   # expected: exit=1
# dependency swap landed
grep -nE '"(xlsx|multer|mailparser|nodemailer|exceljs)"' backend/package.json                                 # expected: no xlsx; multer ^2.x; mailparser >=3.9.3; exceljs present
# the router details are gone
grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}' backend/scripts/mikrotikUpgradeProbe.js docs/superpowers/plans/2026-09-29-mikrotik-firmware-upgrade.md | grep -v -E '127\.0\.0\.1|0\.0\.0\.0' ; echo "exit=$?"   # expected: exit=1
# every changed backend JS file parses
git status --short | awk '{print $2}' | grep -E '^backend/.*\.(js|mjs)$' | xargs -r -n1 node --check
```

Expected: the greps behave as noted, and `node --check` prints nothing.

- [ ] **Step 3: Review the change set once**

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security
git status --short
git diff --stat
```

The listed files should be exactly the union of the "Leave uncommitted" lists of Tasks 0–D7. Nothing outside `backend/`, `tg-service/`, `frontend/src/components/User/AccountSettings/Profile.jsx`, `frontend/src/pages/User/Update.jsx`, `compose.yml` and `docs/` should appear.

- [ ] **Step 4: Build the patch (staging happens only in the worktree's own index)**

```bash
cd /home/aleksey/projects/worktrees/hd/w1-security
git add -A
git diff --cached --binary HEAD > "$TMPDIR/w1-security.patch"
git reset -q            # un-stage again in the worktree
wc -l "$TMPDIR/w1-security.patch"
```

- [ ] **Step 5: Apply to main's working tree without touching its index**

```bash
cd /home/aleksey/projects/hd
git status --short                       # note anything already there (other sessions' work): don't touch it
git apply --check "$TMPDIR/w1-security.patch" && git apply "$TMPDIR/w1-security.patch"
git status --short
```

If `git apply --check` fails, **stop**. Don't use `--3way` (it writes to main's index) and don't force anything. Report the conflicting files to the owner and wait. Otherwise, main now has the W1 changes unstaged.

- [ ] **Step 6: Prepare dependencies in main (sandbox disabled)**

```bash
cd /home/aleksey/projects/hd/backend && pnpm install --frozen-lockfile
cd /home/aleksey/projects/hd/backend && pnpm test 2>&1 | tail -6
```

Expected: install succeeds from the new lockfile, and the tests pass in main too.

- [ ] **Step 7: Hand-over report to the owner (in chat, not a file)**

Include:
1. **Changed files**, grouped by section (A auth and accounts, B exposure/API/limits, C inbound e-mail, D availability/jobs/logs), with test counts before and after.
2. **Behaviour changes worth announcing:**
   - e-mail replies from non-participants, or that fail the sender check, become new tickets; robot replies of that kind are only logged on #N;
   - own e-mail is read-only;
   - API keys act only within their company and can't set responsibles or deadline;
   - magic-link sign-in works for active clients without 2FA only;
   - approval actions answer `{ok, id}`;
   - the default request limit is 10 MB.
3. **The owner's manual checks** on the dev stack. The owner checks the UI; no browser automation.
   - «Мой аккаунт → Профиль»: e-mail read-only, matching mockup A in both themes on desktop and mobile. Saving other fields works.
   - As admin, change a user's e-mail: that user's sessions end, and the old address gets «Email учётной записи изменён», redirected to the owner outside production.
   - As a `user.manage` holder without `user.manageAccess`, change someone's e-mail: the user form shows the 403 message inline. **Confirm this inline message is OK, or ask for a mockup.**
   - These flows still work: password login, login by e-mail code, 2FA enable/verify/disable, password reset link, a client invitation link, impersonation (dialog → link).
   - Approvals (create, resubmit, stage action, decision) refresh as before.
   - The ticket card company block (addresses, taxi button, work schedule, AD log for readers) is unchanged.
   - The device card "attach component" dialog lists the same devices as before.
   - Mail:
     - a reply from the applicant → a comment on #N;
     - a reply from an unknown address → a new ticket whose first line is «Письмо пришло ответом на заявку №N, но отправитель в ней не участвует»;
     - a subject with `[PO-123]` → normal new-ticket intake;
     - the same message delivered twice → one ticket.
   - A KB note with several pasted screenshots saves.
4. **Deploy notes:**
   - the lockfile changed (images rebuild);
   - one migration, `2026-09-30-recomputePluginRoles`, runs via `./deploy.sh`;
   - `compose.yml` gains `stop_grace_period: 60s` for the backend.
5. **Operator notes:**
   - rotate the router port-knock sequence (S14) and decide what to do about git history;
   - the owner's mail domain should publish DMARC `p=quarantine` or `p=reject`, so forged staff replies fail the sender check.
6. **The worktree** `/home/aleksey/projects/worktrees/hd/w1-security` stays until the owner confirms. Then remove it with `git worktree remove /home/aleksey/projects/worktrees/hd/w1-security`.
