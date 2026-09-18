# MCP Ticket Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organisation's staff AI agent search, read, compare and count HD tickets over the existing MCP endpoint, with contact data excluded by field and masked in text.

**Architecture:** MCP keys get permissions (`knowledge`, `tickets`). Per request the MCP handler loads a context (modules, organisation timezone, system accounts) and registers only the tools the key and the modules allow. The ticket tools are pure modules with injected data access (`ticketSource.js`). Every returned text goes through one masking function (`maskText`: secrets → e-mails → phones). Similarity is word-stem ranking in memory over candidate sets narrowed by indexed filters.

**Tech Stack:** Node 24 CommonJS, Express 5, Mongoose 9, `@modelcontextprotocol/server` 2.0 (`fromJsonSchema`), `node:test` + `sift` (dev), dayjs tz; frontend React 19 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-17-mcp-tickets-design.md`

## Global Constraints

- Permissions are `"knowledge"` and `"tickets"`; a stored key without permissions reads as `["knowledge"]`.
- No per-key allowlists: a key with `tickets` reads every ticket; the agent narrows each request itself.
- Masks: phone → `[телефон]`, e-mail → `[e-mail]`, credential → `[секрет скрыт]`; IP addresses are NOT masked.
- Open = `isClosed: false`, closed = `isClosed: true`; `isArchived` is ignored; `state` is a label only.
- Works only while `modules.timeTracking.isActive`; devices only while `modules.inventory.isActive`; knowledge tools only while `modules.knowledgeBase.isActive`; a key left with no tools gets `403`.
- Never select: ticket `htmlDescription`, `realSender`, `attachments`, legacy `applicant`, `responsibles.email`, `responsibles.phone`, AI fields (`aiGuide`, `aiTerms`, `aiSpeech`, `aiCategory`, `aiTitle`), `notifications`; users' `email`, `phone`, photos, `telegramBot`, `workStatus`, `finances`, `subdivision`; companies' `phones`, `address`, `linkToMap`, `location`, `emailDomains`, `apiKeys`, `servicePlans`, `users`, `responsibles`, `clientsSideResponsibles`; devices' `ipAddress`, `macAddress`, `hostname`, `installedSoftware`, `price`, `currentValue`, `purchaseDocument`, `supplierId`, `notes`, `comment`, `photos`, `locationId`; works' `finances`, `withinPlan`.
- Limits: `search_tickets.limit` 1–50 (default 10), `page` ≥ 1; `find_similar_tickets.limit` 1–30 (default 10); description cap 20 000 chars; comment cap 4 000 chars; "how it was solved" cap 600 chars; closing comment counts as a solution only when ≥ 100 chars; stats: top 50 groups + «остальные» (month groups are never folded); candidates for ranking: at most 20 000 newest tickets.
- Dates in arguments: `YYYY-MM-DD`, organisation timezone, both ends inclusive, by creation date. Instants in output: full ISO (`toISOString()`).
- Ticket link: `${ADDRESS}/tickets/<num>` with trailing slashes of `ADDRESS` trimmed.
- People: «Фамилия Имя», position, marker `client` / `staff` / `system`; the unidentified e-mail sender (`Preferences.defaultApplicant`) is `unidentified e-mail sender (system)`.
- Workflow: **no commits** — the owner commits explicitly when asked (each task ends with a checkpoint, not a commit). pnpm only; `pnpm add` needs the sandbox disabled. Backend tests: `cd backend && NODE_ENV=production pnpm test` (root-owned `backend/logs` breaks the logger otherwise); single file: `node --test <file>`. Unit-tested modules must not `require` `utils/logger`, `middleware/errorHandling` or models (except `services/knowledgeBaseContext`, already loaded by existing tests) — inject dependencies. Code comments in Russian (repo convention); module docs in `docs/` in English without UI. **No frontend code before the owner approves the mockup (Task 12).**
- Out of scope: the `GET /api/tickets/:num` company-document leak (separate fix).

---

## File Structure

**Backend — create**
- `backend/services/mcp/maskText.js` — `maskText(value)`: secrets → e-mails → phones.
- `backend/services/mcp/text.js` — shared text helpers (moved from `knowledgeTools.js`) + `ticketPlainText(ticket)`.
- `backend/services/mcp/ticketQuery.js` — `resolveByName`, `buildTicketFilter`, `rankTickets`, `rankSimilar`.
- `backend/services/mcp/ticketStats.js` — `aggregateTicketStats`.
- `backend/services/mcp/ticketFormat.js` — directory maps, people/company labels, row, detail and stats rendering.
- `backend/services/mcp/ticketTools.js` — `createTicketTools({ source, baseUrl, log })` → `{ search, getTicket, findSimilar, stats }`.
- `backend/services/mcp/ticketSource.js` — MongoDB access for the ticket tools (verified live).
- Tests next to each: `*.test.js`; `backend/services/secretsScanner.test.js`.

**Backend — modify**
- `backend/services/secretsScanner.js` — shared value collector, `redactSecrets(text)`.
- `backend/services/mcp/knowledgeTools.js` — import moved helpers.
- `backend/services/mcp/keys.js` (+ test) — `MCP_SCOPES`, `normalizeScopes`, rows with `scopes`.
- `backend/models/mcpKey.js`, `backend/types/mcpKey.ts` — `scopes`.
- `backend/middleware/requireMcpKey.js` (+ test) — `req.mcpKey.scopes`.
- `backend/validations/mcpKey.js` (+ test), `backend/controllers/mcpKey.js`, `backend/routes/internal/preferences.js` — scopes on create, `update`.
- `backend/services/mcp/server.js` — context, tool families, ticket tools, instructions, 403.
- `backend/routes/mcpRouter.js`, `backend/routes/mcp.js`, `backend/routes/mcp.test.js` — module gate moves into the handler.
- `backend/models/comment.js` — `{ ticketId: 1, createdAt: 1 }` index.

**Docs**
- Create `docs/mcp.md`; modify `docs/knowledge-base.md`, `docs/deployment.md`, `docs/superpowers/specs/2026-09-17-mcp-tickets-design.md` (status).

**Frontend (after mockup approval)**
- Modify `frontend/src/types/mcpKey.ts`, `frontend/src/util/mcp-keys.ts` (+ test), `frontend/src/components/Preferences/McpKeys.jsx`, `frontend/src/components/Preferences/Integrations.jsx`, `frontend/src/components/Preferences/KnowledgeBase.jsx`, `docs/ux-ui-guide.md`, `docs/ux-ui-changelog.md`.

---

### Task 1: `redactSecrets` in the secrets scanner

**Files:**
- Modify: `backend/services/secretsScanner.js:104-235`
- Test: `backend/services/secretsScanner.test.js` (new)

**Interfaces:**
- Produces: `redactSecrets(text: string): { text: string, count: number }` — replaces every detected credential with `[секрет скрыт]`; `scanText(text, location, ignoredHashes)` output unchanged.

- [ ] **Step 1: Write the tests** — the first test pins the current `scanText` output (literals captured on 2026-09-17), the rest describe redaction.

```js
// node --test services/secretsScanner.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { scanText, redactSecrets } = require("./secretsScanner");

// Сырой секрет наружу не отдаётся: scanText маскирует находки для модератора,
// redactSecrets заменяет значения в тексте для ИИ-агента. Первый тест фиксирует
// вывод scanText до выноса правил в общий сборщик — скан базы знаний не должен
// измениться ни на одну находку.

const findings = (text) => scanText(text).map((f) => [f.category, f.maskedSnippet]);

test("scanText: findings are unchanged by the shared collector", () => {
  assert.deepEqual(findings("password = R00tP@ss123"), [["generic-api-key", "R00t•••s123"]]);
  assert.deepEqual(findings("Пароль от роутера R00tP@$$-pass"), [["password-near-keyword", "R00t•••••pass"]]);
  assert.deepEqual(findings("| admin | Kap2022# |"), [["password-like", "K•••••••"]]);
  assert.deepEqual(findings("ключ AKIAJ7Q2W4E6R8T0Y2U4 в конфиге"), [["aws-access-key", "AKIA••••••••••••Y2U4"]]);
  assert.deepEqual(findings("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12"), [["github-token", "ghp_••••••••••••ij12"]]);
  assert.deepEqual(findings("changeme123 и test@example.com"), []);
  assert.deepEqual(findings("Не печатает принтер HP LaserJet 1020 в кабинете 305"), []);
});

test("scanText: a moderator's «не секрет» mark still drops the finding", () => {
  const [finding] = scanText("password = R00tP@ss123");
  assert.deepEqual(scanText("password = R00tP@ss123", "content", [finding.hash]), []);
});

test("redactSecrets: detected values are replaced, the rest of the text stays", () => {
  assert.deepEqual(redactSecrets("password = R00tP@ss123"), { text: "password = [секрет скрыт]", count: 1 });
  assert.deepEqual(redactSecrets("Пароль от роутера R00tP@$$-pass"), { text: "Пароль от роутера [секрет скрыт]", count: 1 });
  assert.deepEqual(redactSecrets("| admin | Kap2022# |"), { text: "| admin | [секрет скрыт] |", count: 1 });
  assert.deepEqual(redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12"), { text: "token: [секрет скрыт]", count: 1 });
});

test("redactSecrets: every occurrence of a value is replaced", () => {
  assert.deepEqual(redactSecrets("пароль: Kap2022# (повторю: Kap2022#)"), {
    text: "пароль: [секрет скрыт] (повторю: [секрет скрыт])",
    count: 2,
  });
});

test("redactSecrets: a longer secret containing a shorter one is replaced whole", () => {
  const text = `пароль Abc123!x ${"и ещё немного текста ".repeat(3)}потом Abc123!x-long9`;

  const { text: redacted } = redactSecrets(text);

  assert.ok(!redacted.includes("long9"), redacted);
  assert.ok(!redacted.includes("Abc123!x"), redacted);
});

test("redactSecrets: text without secrets and empty input", () => {
  assert.deepEqual(redactSecrets("Не печатает принтер HP LaserJet 1020"), {
    text: "Не печатает принтер HP LaserJet 1020",
    count: 0,
  });
  assert.deepEqual(redactSecrets(undefined), { text: "", count: 0 });
});
```

- [ ] **Step 2: Run and confirm the first two tests PASS and the `redactSecrets` tests FAIL**

Run: `cd backend && node --test services/secretsScanner.test.js`
Expected: 2 pass, 4 fail with `TypeError: redactSecrets is not a function`.

- [ ] **Step 3: Refactor `scanText` onto a collector and add `redactSecrets`** — replace everything from the comment `// Сканирует одну строку.` (line 104) through the end of `scanText` (line 219) with the block below, and replace the `module.exports` line.

```js
// Все значения, которые правила считают секретами, — сырьём, без игнор-листа.
// Наружу модуля не уходит: scanText превращает их в замаскированные находки,
// redactSecrets заменяет в тексте. Правила одни на оба пути.
const collectSecretValues = (text) => {
  if (!text || typeof text !== "string") {
    return [];
  }

  const values = []; // [{ category, value }]
  const seen = new Set(); // дедуп по значению (между правилами)

  const push = (category, rawValue) => {
    const value = String(rawValue).trim();
    if (value.length < 6 || isPlaceholder(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    values.push({ category, value });
  };

  // 1) Правила с известными форматами секретов
  for (const rule of PATTERN_RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      push(rule.id, match[1] !== undefined ? match[1] : match[0]);
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  // 2) Пароль-подобные значения рядом с ключевыми словами (RU/EN) — даже без «:»/«=».
  PROXIMITY_KEYWORDS.lastIndex = 0;
  let km;
  while ((km = PROXIMITY_KEYWORDS.exec(text)) !== null) {
    const start = Math.max(0, km.index - 30);
    const end = Math.min(text.length, km.index + km[0].length + 40);
    const windowText = text.slice(start, end);

    PASSWORDLIKE_TOKEN.lastIndex = 0;
    let pm;
    while ((pm = PASSWORDLIKE_TOKEN.exec(windowText)) !== null) {
      // Срезаем ведущую/замыкающую пунктуацию — иначе ловим «…ABCDEF.» с точкой.
      const token = pm[0].replace(
        /^[^A-Za-z0-9@#$%^&*!?+=]+|[^A-Za-z0-9@#$%^&*!?+=]+$/g,
        "",
      );
      if (looksLikePassword(token)) {
        push("password-near-keyword", token);
      }
    }

    if (km.index === PROXIMITY_KEYWORDS.lastIndex) {
      PROXIMITY_KEYWORDS.lastIndex++;
    }
  }

  // 3) «Сложные» токены (буква + цифра + сильный спецсимвол) в любом месте текста.
  COMPLEX_TOKEN.lastIndex = 0;
  let complexMatch;
  while ((complexMatch = COMPLEX_TOKEN.exec(text)) !== null) {
    const token = complexMatch[0].replace(
      /^[^A-Za-z0-9@#$%^&*!?+=]+|[^A-Za-z0-9@#$%^&*!?+=]+$/g,
      "",
    );
    if (
      looksLikeComplexSecret(token) &&
      !token.includes("/") && // пути/URL — не пароли
      !looksLikeEmail(token) &&
      !looksLikeUrl(token)
    ) {
      push("password-like", token);
    }
  }

  // 4) Высокоэнтропийные одиночные токены, не пойманные правилами выше.
  const tokenRegex = /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(text)) !== null) {
    const token = tokenMatch[0];
    if (seen.has(token)) {
      continue;
    }
    if (
      /[A-Za-z]/.test(token) &&
      /\d/.test(token) &&
      !isPlaceholder(token) &&
      shannonEntropy(token) >= 4.0
    ) {
      push("high-entropy-token", token);
    }
  }

  return values;
};

// Сканирует одну строку. location — где найдено ("title" | "content").
// ignoredHashes — хэши значений, помеченных модератором как «не секрет».
const scanText = (text, location = "content", ignoredHashes = []) => {
  const ignored = new Set((ignoredHashes || []).map(String));
  return collectSecretValues(text)
    .map(({ category, value }) => ({
      category,
      location,
      maskedSnippet: maskSecret(value),
      hash: hashValue(value),
    }))
    .filter((finding) => !ignored.has(finding.hash));
};

const REDACTED = "[секрет скрыт]";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Заменяет найденные секреты в тексте — для выдачи ИИ-агенту (MCP). Длинные
// значения первыми: короткий пароль внутри длинного токена не должен оставить
// хвост токена на виду.
const redactSecrets = (text) => {
  if (!text || typeof text !== "string") {
    return { text: "", count: 0 };
  }
  const values = collectSecretValues(text)
    .map(({ value }) => value)
    .sort((a, b) => b.length - a.length);
  if (!values.length) {
    return { text, count: 0 };
  }
  let count = 0;
  const pattern = new RegExp(values.map(escapeRegExp).join("|"), "g");
  const redacted = text.replace(pattern, () => {
    count += 1;
    return REDACTED;
  });
  return { text: redacted, count };
};
```

```js
module.exports = { scanText, scanNote, shannonEntropy, maskSecret, hashValue, redactSecrets };
```

- [ ] **Step 4: Run the tests** — Run: `cd backend && node --test services/secretsScanner.test.js` — Expected: 6 pass.
- [ ] **Step 5: Mutation check** — temporarily remove `.sort((a, b) => b.length - a.length)` and confirm the "longer secret" test fails; restore.
- [ ] **Step 6: Checkpoint** — `cd backend && NODE_ENV=production pnpm test` all green. Do not commit.

---

### Task 2: `maskText` — phones, e-mails, secrets

**Files:**
- Create: `backend/services/mcp/maskText.js`
- Test: `backend/services/mcp/maskText.test.js`

**Interfaces:**
- Consumes: `redactSecrets(text)` (Task 1).
- Produces: `maskText(value: unknown): string` — `""` for null/undefined; secrets → `[секрет скрыт]`, e-mails → `[e-mail]`, phones → `[телефон]`.

- [ ] **Step 1: Write the table test**

```js
// node --test services/mcp/maskText.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { maskText } = require("./maskText");

// Что считается телефоном — зафиксировано таблицей: маскируем контакты в
// подписях и «Кто звонил», но не даты, время, IP, версии, номера заявок,
// серийники, суммы и ИНН.

const MASKED = [
  ["+7 999 123-45-67", "[телефон]"],
  ["8 (423) 222-29-99", "[телефон]"],
  ["89991234567", "[телефон]"],
  ["+7(423)2222999", "[телефон]"],
  ["(423) 222-29-99", "[телефон]"],
  ["9991234567", "[телефон]"],
  ["тел. 222-29-99", "тел. [телефон]"],
  ["+375 29 123-45-67", "[телефон]"],
  ["Звоните: 8-999-123-45-67, 8-999-765-43-21", "Звоните: [телефон], [телефон]"],
  ["Кто звонил: +7 924 555 12 34", "Кто звонил: [телефон]"],
  ["заявка от 2026-09-17 89991234567", "заявка от 2026-09-17 [телефон]"],
  ["пишите ivan.petrov@corp.example.ru", "пишите [e-mail]"],
  ["пароль: Kap2022#", "пароль: [секрет скрыт]"],
  // Добавлено после финального ревью (2026-09-18): исходная таблица не
  // содержала телефона в конце предложения и в скобках, и первая версия
  // PHONE_CANDIDATE их не маскировала (6% телефонов в реальных текстах).
  ["Мой номер 89991234567.", "Мой номер [телефон]."],
  ["Звоните 8 999 123-45-67.", "Звоните [телефон]."],
  ["+7 999 123 45 67.", "[телефон]."],
  ["моб. 8(999)1234567.", "моб. [телефон]."],
  ["Тел.+79991234567", "Тел.[телефон]"],
  ["(+79991234567)", "([телефон])"],
  ["12 8 9 9 9 1 2 3 4 5 6 7", "12 [телефон]"],
];

const UNCHANGED = [
  "IP 192.168.10.5, шлюз 10.0.0.1",
  "17.09.2026 10:00",
  "2026-09-17",
  "заявка № 51702",
  "SN VNB3K12345, S/N 1234567890",
  "RouterOS 7.15.3",
  "стоимость 1 500 000 руб",
  "ИНН 7701234567",
  "MAC 00-1A-2B-3C-4D-5E",
  "порт 8080, VLAN 100",
  "с 09:00-18:00",
  "годы 2024 2025 2026",
  "карта 4276 1234 5678 9012",
  "S/N89991234567",
  "артикул AB89991234567",
  // Защитные случаи ослабленных границ (те же правки финального ревью)
  "192.168.1.100",
  "10.0.50.70",
  "RouterOS 7.21.5 (long-term)",
  "17.09.2026",
  "s/n HCX089YGYCX",
  "1.9991234567",
  "заявка (51702)",
  "инв. (000123456789)",
];

test("contacts and secrets are masked", () => {
  for (const [input, expected] of MASKED) {
    assert.equal(maskText(input), expected, input);
  }
});

test("technical numbers stay as written", () => {
  for (const input of UNCHANGED) {
    assert.equal(maskText(input), input, input);
  }
});

test("empty values become an empty string", () => {
  assert.equal(maskText(null), "");
  assert.equal(maskText(undefined), "");
  assert.equal(maskText(51702), "51702");
});
```

- [ ] **Step 2: Run to confirm it fails** — Run: `cd backend && node --test services/mcp/maskText.test.js` — Expected: FAIL, `Cannot find module './maskText'`.
- [ ] **Step 3: Implement**

```js
const { redactSecrets } = require("../secretsScanner");

/**
 * Маска контактов и секретов в текстах, которые MCP отдаёт ИИ-агенту (заявки,
 * комментарии, ответы анкеты, описания работ). Порядок важен: сначала секреты
 * (правила сканера видят «пароль: …» целиком), потом e-mail, потом телефоны.
 * IP-адреса не трогаем — они нужны для технического разбора (решение владельца).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Кандидат в телефон: цифры, пробелы, скобки, дефисы. Точки и двоеточия не
// входят — так в кандидат не попадают IP, даты, время и версии; рядом с буквой
// или точкой кандидат не начинается и не кончается (серийники, «S/N12…»).
const PHONE_CANDIDATE = /(?<![\w.+(])\+?\(?\d[\d\s()-]{5,}\d(?![\w.])/g;

const isPhone = (piece) => {
  const digits = piece.replace(/\D/g, "");
  if (piece.startsWith("+")) return digits.length >= 11 && digits.length <= 13;
  if (digits.length === 11) return /^[78]/.test(digits);
  if (digits.length === 10) return /^9/.test(digits) || /^\(\d{3,5}\)/.test(piece);
  if (digits.length === 7) return /^\d{3}-\d{2}-\d{2}$/.test(piece);
  return false;
};

// Кандидат может склеить через пробел соседние числа («2026-09-17 8999…»):
// ищем внутри него самые длинные подряд идущие группы, которые телефон.
const maskCandidate = (candidate) => {
  if (isPhone(candidate)) return "[телефон]";
  const tokens = candidate.split(/(\s+)/); // чётные — группы, нечётные — пробелы
  const groups = tokens.filter((_, index) => index % 2 === 0);
  const joined = (from, to) =>
    tokens.slice(from * 2, to * 2 + 1).join("");
  const out = [];
  let i = 0;
  while (i < groups.length) {
    let matched = -1;
    for (let j = groups.length - 1; j >= i; j -= 1) {
      if (isPhone(joined(i, j))) {
        matched = j;
        break;
      }
    }
    if (matched >= 0) {
      out.push("[телефон]");
      i = matched + 1;
    } else {
      out.push(groups[i]);
      i += 1;
    }
    if (i < groups.length) out.push(tokens[i * 2 - 1]);
  }
  return out.join("");
};

const maskText = (value) => {
  if (value == null) return "";
  const { text } = redactSecrets(String(value));
  return text.replace(EMAIL, "[e-mail]").replace(PHONE_CANDIDATE, maskCandidate);
};

module.exports = { maskText };
```

- [ ] **Step 4: Run** — Expected: 3 pass. If a table row fails, fix `isPhone`/`PHONE_CANDIDATE`, never the table (the table is the spec's contract).
- [ ] **Step 5: Mutation check** — drop the `(?<![\w.+(])` look-behind → the "SN … S/N 1234567890" row must fail; restore.
- [ ] **Step 6: Checkpoint** — backend tests green. Do not commit.

---

### Task 3: Shared MCP text helpers and ticket plain text

**Files:**
- Create: `backend/services/mcp/text.js`
- Modify: `backend/services/mcp/knowledgeTools.js` (remove moved helpers, import them)
- Test: `backend/services/mcp/text.test.js`

**Interfaces:**
- Produces: `normalize(value): string`, `buildSnippet(text, needles): string`, `iso(value): string` ("—" for empty), `DATA_URI: RegExp`, `ticketPlainText(ticket: { description?, source? }): string`.

- [ ] **Step 1: Write the test**

```js
// node --test services/mcp/text.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ticketPlainText, buildSnippet, iso } = require("./text");

// Описание заявки бывает трёх видов: HTML из редактора портала, текст письма с
// цитатой прошлой переписки, текст с data:-вставками. Агенту — чистый текст.

test("HTML from the portal editor becomes lines", () => {
  const ticket = {
    source: "Портал",
    description: "<p>Не печатает</p><p>принтер&nbsp;HP в <strong>305</strong></p><p><br></p>",
  };

  assert.equal(ticketPlainText(ticket), "Не печатает\nпринтер HP в 305");
});

test("an e-mail ticket loses the quoted previous correspondence", () => {
  const ticket = {
    source: "Почта",
    description:
      "Добрый день, не работает VPN.\n\nС уважением, Иван\n\nчт, 17 сент. 2026 г. в 10:00, Поддержка F1 <help@f1lab.ru>:\n> Заявка принята",
  };

  assert.equal(ticketPlainText(ticket), "Добрый день, не работает VPN.\n\nС уважением, Иван");
});

test("base64 data is dropped and empty descriptions are empty", () => {
  assert.equal(
    ticketPlainText({ source: "Другое", description: "скрин data:image/png;base64,iVBORw0KGgo= тут" }),
    "скрин [данные] тут",
  );
  assert.equal(ticketPlainText({ source: "Портал" }), "");
});

test("snippet and instants keep their previous behaviour", () => {
  assert.equal(iso(null), "—");
  assert.equal(iso(new Date("2026-09-17T10:00:00.000Z")), "2026-09-17T10:00:00.000Z");
  assert.match(buildSnippet(`${"а ".repeat(200)}VPN настроен`, ["vpn"]), /VPN настроен$/);
});
```

- [ ] **Step 2: Run to confirm it fails** — `node --test services/mcp/text.test.js` → `Cannot find module './text'`.
- [ ] **Step 3: Create `text.js`** — the helpers below move out of `knowledgeTools.js` unchanged (only the comments generalised), plus the new `ticketPlainText`:

```js
const { htmlToPlainLines } = require("../../helpers/htmlToPlainText");
const { stripQuotedReply } = require("../emailReplyStripper");

// Общие текстовые помощники MCP-инструментов (база знаний и заявки).

const SNIPPET_BEFORE = 100;
const SNIPPET_AFTER = 200;

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е");

// Кусок текста вокруг первого совпадения — чтобы агент видел, чем запись
// подошла, не открывая её.
const buildSnippet = (text, needles) => {
  const source = String(text || "");
  const haystack = normalize(source);
  const positions = needles
    .map((needle) => haystack.indexOf(needle))
    .filter((index) => index >= 0);
  const at = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(source.length, at + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
};

// base64-вставки (картинки из редактора, файлы в письмах) — агенту от них
// только расход контекста.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

// Момент — полным ISO: агент сам переведёт в пояс собеседника, а обрезка до
// даты сдвигает день (docs/datetime-conventions.md).
const iso = (value) => (value ? new Date(value).toISOString() : "—");

const HTML_TAG = /<\/?[a-z][a-z0-9]*[^>]*>/i;

/**
 * Текст заявки для агента и для поиска: HTML редактора — в строки, у писем
 * срезана цитата прошлой переписки (подпись остаётся — её контакты закроет
 * maskText), base64-вставки убраны. htmlDescription (сырое письмо) не читается.
 */
const ticketPlainText = (ticket) => {
  const raw = String(ticket?.description || "");
  let text = HTML_TAG.test(raw) ? htmlToPlainLines(raw) : raw.replace(/\r\n/g, "\n");
  if (ticket?.source === "Почта") {
    text = stripQuotedReply(text).content;
  }
  return text.replace(DATA_URI, "[данные]").trim();
};

module.exports = { normalize, buildSnippet, iso, DATA_URI, ticketPlainText };
```

In `knowledgeTools.js` delete `SNIPPET_BEFORE`, `SNIPPET_AFTER`, `normalize`, `buildSnippet`, `DATA_URI` and `iso` (keep `DATA_IMAGE`, `prepareContent` and everything else) and add at the top:

```js
const { normalize, buildSnippet, iso, DATA_URI } = require("./text");
```

- [ ] **Step 4: Run** — `node --test services/mcp/text.test.js services/mcp/knowledgeTools.test.js` → all pass (knowledge tools unchanged).
- [ ] **Step 5: Checkpoint** — backend tests green. Do not commit.

---

### Task 4: Ticket query helpers — names, filter, ranking

**Files:**
- Create: `backend/services/mcp/ticketQuery.js`
- Test: `backend/services/mcp/ticketQuery.test.js`

**Interfaces:**
- Consumes: `toStems`, `scoreNote` (`services/knowledgeBaseContext.js`); `normalize`, `ticketPlainText` (Task 3).
- Produces:
  - `resolveByName(items, name, { label, exact })` → matching items (exact matches win when present); `label(item): string`, `exact(item): string[]`.
  - `buildTicketFilter({ status, companyIds, userIds, categoryIds, from, to, timezone })` → Mongo filter object.
  - `rankTickets(tickets, query)` → `{ hits: [{ ticket, text, score }], needles: string[] }` (newest first on equal score).
  - `rankSimilar(source, candidates)` → same shape; ties: same category, then latest `finishedAt`, then latest `createdAt`.

- [ ] **Step 1: Write the test**

```js
// node --test services/mcp/ticketQuery.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const {
  resolveByName,
  buildTicketFilter,
  rankTickets,
  rankSimilar,
} = require("./ticketQuery");

const companies = [
  { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
  { _id: "c2", alias: "Ромб", fullTitle: "АО «Ромб-Строй»" },
  { _id: "c3", alias: "Альфа", fullTitle: "ООО «Альфа»" },
];
const companyName = { label: (c) => `${c.alias} ${c.fullTitle}`, exact: (c) => [c.alias, c.fullTitle] };

test("names: substring match, exact match wins, no match is empty", () => {
  assert.deepEqual(resolveByName(companies, "ром", companyName).map((c) => c._id), ["c1", "c2"]);
  assert.deepEqual(resolveByName(companies, "ромашка", companyName).map((c) => c._id), ["c1"]);
  assert.deepEqual(resolveByName(companies, "  АЛЬФА ", companyName).map((c) => c._id), ["c3"]);
  assert.deepEqual(resolveByName(companies, "бета", companyName), []);
});

test("filter: status, ids and inclusive days in the organisation timezone", () => {
  const tz = "Asia/Vladivostok"; // UTC+10
  const tickets = [
    { id: 1, isClosed: false, company: { _id: "c1" }, applicantId: "u1", categoryId: "k1", createdAt: new Date("2026-08-31T13:59:00Z") }, // 31.08 23:59
    { id: 2, isClosed: true, company: { _id: "c1" }, applicantId: "u1", categoryId: "k1", createdAt: new Date("2026-08-31T14:00:00Z") }, // 01.09 00:00
    { id: 3, isClosed: true, company: { _id: "c1" }, applicantId: "u2", categoryId: "k1", createdAt: new Date("2026-09-30T13:59:00Z") }, // 30.09 23:59
    { id: 4, isClosed: true, company: { _id: "c2" }, applicantId: "u1", categoryId: "k2", createdAt: new Date("2026-09-30T14:00:00Z") }, // 01.10 00:00
  ];
  const ids = (filter) => tickets.filter(sift(filter)).map((t) => t.id);

  assert.deepEqual(ids(buildTicketFilter({ status: "any", from: "2026-09-01", to: "2026-09-30", timezone: tz })), [2, 3]);
  assert.deepEqual(ids(buildTicketFilter({ status: "open", timezone: tz })), [1]);
  assert.deepEqual(ids(buildTicketFilter({ status: "closed", companyIds: ["c1"], timezone: tz })), [2, 3]);
  assert.deepEqual(ids(buildTicketFilter({ status: "any", userIds: ["u1"], categoryIds: ["k1"], timezone: tz })), [1, 2]);
});

const ticket = (num, title, description, extra = {}) => ({
  _id: `t${num}`, num, title, description, source: "Портал", createdAt: new Date(`2026-09-${String(num).padStart(2, "0")}T00:00:00Z`), ...extra,
});

test("ranking: title beats body, unrelated tickets are left out, ties are newest first", () => {
  const tickets = [
    ticket(1, "Заправка картриджей", "<p>Картридж принтера меняем</p>"),
    ticket(2, "Отпуск", "<p>Заявление</p>"),
    ticket(3, "Принтер HP не печатает", "<p>LaserJet</p>"),
    ticket(4, "Принтер Canon", "<p>замятие</p>"),
  ];

  const { hits } = rankTickets(tickets, "принтер");

  assert.deepEqual(hits.map((h) => h.ticket.num), [4, 3, 1]);
});

test("ranking: an IP address is found by substring", () => {
  const tickets = [ticket(1, "Сервер печати", "<p>адрес 192.168.10.5</p>"), ticket(2, "Шлюз", "<p>10.0.0.1</p>")];

  assert.deepEqual(rankTickets(tickets, "192.168.10.5").hits.map((h) => h.ticket.num), [1]);
});

test("similar: shared words rank, the same category wins a tie", () => {
  const source = ticket(9, "Не работает VPN в филиале", "<p>клиент OpenVPN не подключается</p>", { categoryId: "net" });
  const candidates = [
    ticket(1, "VPN не подключается", "<p>OpenVPN</p>", { categoryId: "other", finishedAt: new Date("2026-09-10") }),
    ticket(2, "VPN не подключается", "<p>OpenVPN</p>", { categoryId: "net", finishedAt: new Date("2026-09-01") }),
    ticket(3, "Замена мыши", "<p>сломалась</p>", { categoryId: "net" }),
  ];

  assert.deepEqual(rankSimilar(source, candidates).hits.map((h) => h.ticket.num), [2, 1]);
});
```

- [ ] **Step 2: Run to confirm it fails** — `node --test services/mcp/ticketQuery.test.js` → `Cannot find module './ticketQuery'`.
- [ ] **Step 3: Implement**

```js
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { toStems, scoreNote } = require("@/services/knowledgeBaseContext");
const { normalize, ticketPlainText } = require("./text");

dayjs.extend(utc);
dayjs.extend(timezone);

// Сколько слов запроса ищем подстрокой, когда основ нет (IP, номера).
const MAX_FALLBACK_TERMS = 8;

/**
 * Имя → записи справочника (компании, люди, категории). Каждое слово запроса
 * должно встретиться в подписи; точное совпадение с одной из exact-подписей
 * побеждает остальные («Ромашка» не спорит с «Ромашка-Строй»).
 */
const resolveByName = (items, name, { label, exact }) => {
  const query = normalize(name).trim().replace(/\s+/g, " ");
  const words = query.split(" ").filter(Boolean);
  if (!words.length) return [];
  const matches = items.filter((item) => {
    const text = normalize(label(item));
    return words.every((word) => text.includes(word));
  });
  const exactMatches = matches.filter((item) =>
    exact(item).some((value) => normalize(value).trim() === query),
  );
  return exactMatches.length ? exactMatches : matches;
};

/**
 * Фильтр заявок для Mongo. Дни — в поясе организации, обе границы включительно,
 * по дате создания (docs/datetime-conventions.md: границы периода — dayjs.tz).
 * Открытость — только isClosed: isArchived мёртв, state бывает рассинхронен.
 */
const buildTicketFilter = ({ status = "any", companyIds, userIds, categoryIds, from, to, timezone: tz }) => {
  const filter = {};
  if (status === "open") filter.isClosed = false;
  if (status === "closed") filter.isClosed = true;
  if (companyIds) filter["company._id"] = { $in: companyIds };
  if (userIds) filter.applicantId = { $in: userIds };
  if (categoryIds) filter.categoryId = { $in: categoryIds };
  const createdAt = {};
  if (from) createdAt.$gte = dayjs.tz(from, tz).startOf("day").toDate();
  if (to) createdAt.$lt = dayjs.tz(to, tz).add(1, "day").startOf("day").toDate();
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  return filter;
};

const newestFirst = (a, b) => new Date(b.ticket.createdAt) - new Date(a.ticket.createdAt);

/** Поиск по словам: основы как у базы знаний (заголовок 3, текст 1), иначе подстрока. */
const rankTickets = (tickets, query) => {
  const withText = tickets.map((ticket) => ({ ticket, text: ticketPlainText(ticket) }));
  const stems = toStems(query);
  const byStems = stems.size
    ? withText
        .map((entry) => ({ ...entry, score: scoreNote({ title: entry.ticket.title, plainText: entry.text }, stems) }))
        .filter((entry) => entry.score > 0)
    : [];
  if (byStems.length) {
    return { hits: byStems.sort((a, b) => b.score - a.score || newestFirst(a, b)), needles: [...stems] };
  }
  const terms = normalize(query).split(/\s+/).filter(Boolean).slice(0, MAX_FALLBACK_TERMS);
  const bySubstring = withText
    .filter((entry) => {
      const haystack = normalize(`${entry.ticket.title} ${entry.text}`);
      return terms.length && terms.every((term) => haystack.includes(term));
    })
    .map((entry) => ({ ...entry, score: 1 }));
  return { hits: bySubstring.sort(newestFirst), needles: terms };
};

/** Похожие: основы заголовка и текста исходной заявки против кандидатов. */
const rankSimilar = (source, candidates) => {
  const stems = toStems(`${source.title || ""} ${ticketPlainText(source)}`);
  if (!stems.size) return { hits: [], needles: [] };
  const sourceCategory = source.categoryId ? String(source.categoryId) : null;
  const sameCategory = (ticket) =>
    sourceCategory && String(ticket.categoryId || "") === sourceCategory ? 1 : 0;
  const hits = candidates
    .map((ticket) => {
      const text = ticketPlainText(ticket);
      return { ticket, text, score: scoreNote({ title: ticket.title, plainText: text }, stems) };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        sameCategory(b.ticket) - sameCategory(a.ticket) ||
        new Date(b.ticket.finishedAt || 0) - new Date(a.ticket.finishedAt || 0) ||
        newestFirst(a, b),
    );
  return { hits, needles: [...stems] };
};

module.exports = { resolveByName, buildTicketFilter, rankTickets, rankSimilar };
```

- [ ] **Step 4: Run** — Expected: 6 pass.
- [ ] **Step 5: Mutation check** — change `add(1, "day")` to nothing (`dayjs.tz(to, tz).startOf("day")`) → the date test must fail; restore.
- [ ] **Step 6: Checkpoint** — backend tests green. Do not commit.

---

### Task 5: Ticket statistics aggregation

**Files:**
- Create: `backend/services/mcp/ticketStats.js`
- Test: `backend/services/mcp/ticketStats.test.js`

**Interfaces:**
- Consumes: `dayKey(date, timeZone)` (`backend/utils/datetime.js`).
- Produces: `aggregateTicketStats(rows, { groupBy, timezone, labelOf })` → `{ total, open, closed, groups: [{ key, label, tickets, open, closed, medianHours: number|null, share: number }] }`. `groupBy` ∈ `category | month | company | applicant | source`; `labelOf(groupBy, key)` returns a display name. Months sort ascending and are never folded; other groups sort by `tickets` desc, top 50 + one `{ key: "__rest", label: "остальные" }` group.

- [ ] **Step 1: Write the test**

```js
// node --test services/mcp/ticketStats.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { aggregateTicketStats } = require("./ticketStats");

const row = (over) => ({
  categoryId: "k1", company: { _id: "c1" }, applicantId: "u1", source: "Почта",
  isClosed: true, createdAt: new Date("2026-09-01T00:00:00Z"), finishedAt: new Date("2026-09-01T02:00:00Z"),
  ...over,
});
const labelOf = (groupBy, key) => `${groupBy}:${key}`;

test("groups count open and closed tickets and the median time to close", () => {
  const rows = [
    row({ categoryId: "k1", finishedAt: new Date("2026-09-01T01:00:00Z") }), // 1 ч
    row({ categoryId: "k1", finishedAt: new Date("2026-09-01T03:00:00Z") }), // 3 ч
    row({ categoryId: "k1", isClosed: false, finishedAt: null }),
    row({ categoryId: "k2", finishedAt: new Date("2026-09-01T10:00:00Z") }), // 10 ч
  ];

  const stats = aggregateTicketStats(rows, { groupBy: "category", timezone: "UTC", labelOf });

  assert.deepEqual([stats.total, stats.open, stats.closed], [4, 1, 3]);
  assert.deepEqual(stats.groups.map((g) => [g.label, g.tickets, g.open, g.closed, g.medianHours, g.share]), [
    ["category:k1", 3, 1, 2, 2, 75],
    ["category:k2", 1, 0, 1, 10, 25],
  ]);
});

test("months follow the organisation timezone and stay chronological", () => {
  const rows = [
    row({ createdAt: new Date("2026-09-30T14:00:00Z") }), // 01.10 во Владивостоке
    row({ createdAt: new Date("2026-08-31T14:00:00Z") }), // 01.09
    row({ createdAt: new Date("2026-08-31T13:00:00Z") }), // 31.08
  ];

  const stats = aggregateTicketStats(rows, { groupBy: "month", timezone: "Asia/Vladivostok", labelOf: (g, key) => key });

  assert.deepEqual(stats.groups.map((g) => [g.label, g.tickets]), [["2026-08", 1], ["2026-09", 1], ["2026-10", 1]]);
});

test("more than 50 groups fold into «остальные»; a group without closed tickets has no median", () => {
  const rows = Array.from({ length: 52 }, (_, i) => row({ applicantId: `u${i}`, isClosed: false, finishedAt: null }));

  const stats = aggregateTicketStats(rows, { groupBy: "applicant", timezone: "UTC", labelOf });

  assert.equal(stats.groups.length, 51);
  assert.deepEqual(stats.groups.at(-1), { key: "__rest", label: "остальные", tickets: 2, open: 2, closed: 0, medianHours: null, share: 3.8 });
  assert.equal(stats.groups[0].medianHours, null);
});
```

- [ ] **Step 2: Run to confirm it fails** — `node --test services/mcp/ticketStats.test.js` → module not found.
- [ ] **Step 3: Implement**

```js
const { dayKey } = require("../../utils/datetime");

// Сводка по заявкам для ИИ-агента: считаем в коде по тонкой проекции, без
// $median (он есть только в MongoDB 7+, а переезд прода на 8 ещё идёт).
const TOP_GROUPS = 50;

const KEY_OF = {
  category: (row) => String(row.categoryId || ""),
  month: (row, tz) => dayKey(row.createdAt, tz).slice(0, 7),
  company: (row) => String(row.company?._id || ""),
  applicant: (row) => String(row.applicantId || ""),
  source: (row) => row.source || "",
};

const round1 = (value) => Math.round(value * 10) / 10;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

const aggregateTicketStats = (rows, { groupBy, timezone, labelOf }) => {
  const keyOf = KEY_OF[groupBy];
  const groups = new Map();
  let open = 0;
  let closed = 0;

  for (const row of rows) {
    const key = keyOf(row, timezone);
    const group = groups.get(key) || { key, tickets: 0, open: 0, closed: 0, hours: [] };
    group.tickets += 1;
    if (row.isClosed) {
      group.closed += 1;
      closed += 1;
      if (row.finishedAt) {
        group.hours.push((new Date(row.finishedAt) - new Date(row.createdAt)) / 3_600_000);
      }
    } else {
      group.open += 1;
      open += 1;
    }
    groups.set(key, group);
  }

  const total = rows.length;
  const share = (tickets) => (total ? round1((tickets / total) * 100) : 0);
  const finish = (group, label) => ({
    key: group.key,
    label,
    tickets: group.tickets,
    open: group.open,
    closed: group.closed,
    medianHours: median(group.hours),
    share: share(group.tickets),
  });

  let list = [...groups.values()];
  if (groupBy === "month") {
    list.sort((a, b) => a.key.localeCompare(b.key));
    return { total, open, closed, groups: list.map((g) => finish(g, labelOf(groupBy, g.key))) };
  }

  list.sort((a, b) => b.tickets - a.tickets || a.key.localeCompare(b.key));
  const top = list.slice(0, TOP_GROUPS).map((g) => finish(g, labelOf(groupBy, g.key)));
  const rest = list.slice(TOP_GROUPS);
  if (rest.length) {
    const merged = rest.reduce(
      (acc, g) => ({ ...acc, tickets: acc.tickets + g.tickets, open: acc.open + g.open, closed: acc.closed + g.closed, hours: acc.hours.concat(g.hours) }),
      { key: "__rest", tickets: 0, open: 0, closed: 0, hours: [] },
    );
    top.push(finish(merged, "остальные"));
  }
  return { total, open, closed, groups: top };
};

module.exports = { aggregateTicketStats };
```

- [ ] **Step 4: Run** — Expected: 3 pass.
- [ ] **Step 5: Checkpoint** — backend tests green. Do not commit.

---

### Task 6: Ticket formatting (labels, rows, detail, stats) with the contact-leak guard

**Files:**
- Create: `backend/services/mcp/ticketFormat.js`
- Test: `backend/services/mcp/ticketFormat.test.js`

**Interfaces:**
- Consumes: `maskText` (Task 2); `iso`, `buildSnippet`, `ticketPlainText` (Task 3); `formatAnswer(field)` (`services/ticketQuestionnaire.js`).
- Produces:
  - `buildDirectory({ companies, users, categories })` → `{ companies: Map<id,{alias,fullTitle}>, users: Map<id,user>, categories: Map<id,title> }`.
  - `isSystemUser(id, directory, systemAccounts)` → boolean; `systemAccounts = { unidentifiedId: string|null, robotIds: string[] }`.
  - `personLabel(id, { directory, systemAccounts })`, `companyLabel(company, directory)`, `categoryLabel(id, directory)`, `ticketLink(baseUrl, num)`.
  - `formatTicketRow(entry, index, ctx)` — `entry = { ticket, text, needles?, solved? }`; `ctx = { directory, systemAccounts, baseUrl }`.
  - `formatTicketDetail(detail, ctx)` — `detail = { ticket, routineTaskTitle, comments, works|null, devices|null }`.
  - `formatStats(stats, { groupBy, summary })`.

- [ ] **Step 1: Write the test** (the leak test feeds contacts into every excluded field and into free text)

```js
// node --test services/mcp/ticketFormat.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDirectory,
  personLabel,
  formatTicketRow,
  formatTicketDetail,
  formatStats,
} = require("./ticketFormat");

const directory = buildDirectory({
  companies: [{ _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" }],
  categories: [{ _id: "k1", title: "Оргтехника" }],
  users: [
    { _id: "u1", firstName: "Мария", lastName: "Иванова", position: "бухгалтер", isEndUser: true },
    { _id: "u2", firstName: "Пётр", lastName: "Петров", position: "инженер", isEndUser: false },
    { _id: "u3", firstName: "Мониторинг", lastName: "Сети", isEndUser: false, isServiceAccount: true },
    { _id: "u4", firstName: "Неопознанный", lastName: "Отправитель", isEndUser: false },
  ],
});
const systemAccounts = { unidentifiedId: "u4", robotIds: [] };
const ctx = { directory, systemAccounts, baseUrl: "https://hd.example.ru/" };

test("people are labelled as client, staff or system", () => {
  assert.equal(personLabel("u1", ctx), "Иванова Мария, бухгалтер (client)");
  assert.equal(personLabel("u2", ctx), "Петров Пётр, инженер (staff)");
  assert.equal(personLabel("u3", ctx), "Сети Мониторинг (system)");
  assert.equal(personLabel("u4", ctx), "unidentified e-mail sender (system)");
  assert.equal(personLabel(null, ctx), "—");
});

const leakyTicket = () => ({
  _id: "t1",
  num: 51702,
  title: "Не печатает принтер, звонить 8 999 123-45-67",
  description: "<p>Мой телефон +7 924 555 12 34, почта maria@romashka.ru, пароль: Kap2022#</p>",
  htmlDescription: "<p>Кто звонил: +7 924 000-11-22</p>",
  realSender: "Мария <maria.private@mail.ru>",
  source: "Портал",
  state: "Закрыта",
  isClosed: true,
  categoryId: "k1",
  company: { _id: "c1", alias: "Ромашка" },
  applicantId: "u1",
  applicant: { email: "legacy@romashka.ru", phone: "+7 900 111-22-33" },
  responsibles: [{ _id: "u2", firstName: "Пётр", lastName: "Петров", email: "petrov@f1lab.ru", phone: "+7 900 444-55-66" }],
  attachments: [{ name: "file-key-7f3a.pdf", originalName: "паспорт.pdf", speechToText: { text: "звоните 8 900 777-88-99" } }],
  customFields: [{ name: "Контакт", type: "text", value: "тел. 222-29-99" }],
  checklist: [{ description: "Позвонить на 89991112233", checked: true }],
  closingComment: "Заменили картридж",
  createdAt: new Date("2026-09-01T03:12:00.000Z"),
  processedAt: new Date("2026-09-01T03:20:00.000Z"),
  finishedAt: new Date("2026-09-01T05:40:00.000Z"),
});

const LEAKS = [
  "8 999 123-45-67", "+7 924 555 12 34", "maria@romashka.ru", "Kap2022#", "+7 924 000-11-22",
  "maria.private@mail.ru", "legacy@romashka.ru", "+7 900 111-22-33", "petrov@f1lab.ru", "+7 900 444-55-66",
  "file-key-7f3a", "паспорт.pdf", "8 900 777-88-99", "222-29-99", "89991112233", "ivan@corp.ru", "10.5.5.5-secret",
];

test("detail: no contact, secret or file key from any field reaches the text", () => {
  const detail = {
    ticket: leakyTicket(),
    routineTaskTitle: null,
    comments: [{ content: "С уважением, Иван, ivan@corp.ru", createdBy: "u1", createdAt: new Date("2026-09-01T04:00:00Z") }],
    works: [{ description: "Звонил на 8 999 123-45-67", visitRequired: true, startedAt: new Date("2026-09-01T04:00:00Z"), finishedAt: new Date("2026-09-01T05:30:00Z"), durationMs: 5_400_000, finishedBy: { _id: "u2", firstName: "Пётр", lastName: "Петров" } }],
    devices: [{ deviceModelId: { name: "LaserJet 1020", vendorId: { name: "HP" }, deviceTypeId: { name: "Принтер" } }, inventoryNumber: "PR-0042", serialNumber: "VNB3K12345", status: "deployed", operatingSystem: null, ipAddress: "10.5.5.5-secret" }],
  };

  const text = formatTicketDetail(detail, ctx);

  for (const leak of LEAKS) {
    assert.ok(!text.includes(leak), `leaked: ${leak}`);
  }
  assert.match(text, /\[телефон\]/);
  assert.match(text, /\[e-mail\]/);
  assert.match(text, /\[секрет скрыт\]/);
  assert.match(text, /https:\/\/hd\.example\.ru\/tickets\/51702/);
  assert.match(text, /Иванова Мария, бухгалтер \(client\)/);
  assert.match(text, /HP LaserJet 1020/);
  assert.match(text, /90 min, on-site/);
});

test("detail: sections of switched-off modules are left out", () => {
  const text = formatTicketDetail({ ticket: leakyTicket(), routineTaskTitle: null, comments: [], works: null, devices: null }, ctx);

  assert.doesNotMatch(text, /## Works/);
  assert.doesNotMatch(text, /## Devices/);
});

test("row: masked title and snippet, link, labels", () => {
  const entry = { ticket: leakyTicket(), text: "Мой телефон +7 924 555 12 34 не печатает принтер", needles: ["принт"] };

  const row = formatTicketRow(entry, 1, ctx);

  assert.match(row, /^1\. #51702 · Не печатает принтер, звонить \[телефон\]/);
  assert.match(row, /company: Ромашка/);
  assert.match(row, /snippet: .*\[телефон\]/);
  assert.ok(!row.includes("555 12 34"));
});

test("stats: a table with names and an empty median dash", () => {
  const text = formatStats(
    { total: 3, open: 1, closed: 2, groups: [{ key: "k1", label: "Оргтехника", tickets: 3, open: 1, closed: 2, medianHours: 2, share: 100 }] },
    { groupBy: "category", summary: "company: Ромашка" },
  );

  assert.match(text, /Tickets: 3 \(open 1, closed 2\), grouped by category \(company: Ромашка\)/);
  assert.match(text, /\| Оргтехника \| 3 \| 1 \| 2 \| 2 \| 100% \|/);
});
```

- [ ] **Step 2: Run to confirm it fails** — module not found.
- [ ] **Step 3: Implement**

```js
const { formatAnswer } = require("../ticketQuestionnaire");
const { maskText } = require("./maskText");
const { iso, buildSnippet, ticketPlainText } = require("./text");

/**
 * Текст заявок для ИИ-агента. Сюда попадает только разрешённое (spec
 * 2026-09-17-mcp-tickets-design.md): поля перечислены явно, каждый свободный
 * текст — через maskText. Даже если источник принёс лишнее (htmlDescription,
 * контакты ответственных, вложения, IP техники), в вывод оно не попадает.
 */

const MAX_DESCRIPTION = 20_000;
const MAX_COMMENT = 4_000;
const MAX_SOLVED = 600;

const clip = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n[…truncated: ${text.length - max} more characters — open the link]`;

const safe = (value, max) => clip(maskText(value), max);

const byId = (items, pick) => new Map(items.map((item) => [String(item._id), pick(item)]));

const buildDirectory = ({ companies, users, categories }) => ({
  companies: byId(companies, (c) => ({ alias: c.alias, fullTitle: c.fullTitle })),
  users: byId(users, (u) => u),
  categories: byId(categories, (c) => c.title),
});

const nameOf = (user) => [user?.lastName, user?.firstName].filter(Boolean).join(" ") || "—";

const isSystemUser = (id, directory, systemAccounts) => {
  const key = String(id || "");
  const user = directory.users.get(key);
  return (
    key === String(systemAccounts.unidentifiedId || "") ||
    systemAccounts.robotIds.includes(key) ||
    Boolean(user?.isServiceAccount || user?.isCloudTelephony)
  );
};

const personLabel = (id, { directory, systemAccounts }) => {
  if (!id) return "—";
  const key = String(id);
  if (key === String(systemAccounts.unidentifiedId || "")) return "unidentified e-mail sender (system)";
  const user = directory.users.get(key);
  if (!user) return "unknown person";
  if (isSystemUser(key, directory, systemAccounts)) return `${nameOf(user)} (system)`;
  const position = user.position ? `, ${user.position}` : "";
  return `${nameOf(user)}${position} (${user.isEndUser === false ? "staff" : "client"})`;
};

const companyLabel = (company, directory) =>
  directory.companies.get(String(company?._id || ""))?.alias || company?.alias || "—";

const categoryLabel = (id, directory) => directory.categories.get(String(id || "")) || "—";

const ticketLink = (baseUrl, num) => `${String(baseUrl || "").replace(/\/+$/, "")}/tickets/${num}`;

const statusLabel = (ticket) => `${ticket.isClosed ? "closed" : "open"} (${ticket.state || "—"})`;

const formatTicketRow = (entry, index, ctx) => {
  const { ticket } = entry;
  const lines = [
    `${index}. #${ticket.num} · ${maskText(ticket.title)}`,
    `status: ${statusLabel(ticket)}; company: ${companyLabel(ticket.company, ctx.directory)}; applicant: ${personLabel(ticket.applicantId, ctx)}; category: ${categoryLabel(ticket.categoryId, ctx.directory)}`,
    `created: ${iso(ticket.createdAt)}; closed: ${ticket.isClosed ? iso(ticket.finishedAt) : "—"}`,
    `link: ${ticketLink(ctx.baseUrl, ticket.num)}`,
  ];
  if (entry.text != null) {
    lines.push(`snippet: ${maskText(buildSnippet(entry.text, entry.needles || [])) || "—"}`);
  }
  if (entry.solved) {
    if (entry.solved.closing) lines.push(`solved: ${safe(entry.solved.closing, MAX_SOLVED)}`);
    if (entry.solved.works) lines.push(`works: ${safe(entry.solved.works, MAX_SOLVED)}`);
  }
  return lines.join("\n   ");
};

const indent = (text) => text.replace(/\n/g, "\n  ");

const formatTicketDetail = (detail, ctx) => {
  const { ticket } = detail;
  const directory = ctx.directory;
  const company = directory.companies.get(String(ticket.company?._id || ""));
  const out = [
    `# #${ticket.num} · ${maskText(ticket.title)}`,
    `status: ${statusLabel(ticket)}; source: ${ticket.source || "—"}; category: ${categoryLabel(ticket.categoryId, directory)}`,
    `company: ${companyLabel(ticket.company, directory)}${company?.fullTitle ? ` (${company.fullTitle})` : ""}`,
    `applicant: ${personLabel(ticket.applicantId, ctx)}`,
    `responsibles: ${(ticket.responsibles || []).map((r) => nameOf(r)).join(", ") || "—"}`,
  ];
  if (detail.routineTaskTitle) out.push(`routine task: ${maskText(detail.routineTaskTitle)}`);
  out.push(
    `created: ${iso(ticket.createdAt)}; processed: ${iso(ticket.processedAt)}; started: ${iso(ticket.startedAt)}; closed: ${ticket.isClosed ? iso(ticket.finishedAt) : "—"}; deadline: ${iso(ticket.deadline)}`,
    `link: ${ticketLink(ctx.baseUrl, ticket.num)}`,
    "",
    "## Description",
    safe(ticketPlainText(ticket), MAX_DESCRIPTION) || "(empty)",
  );

  const answers = (ticket.customFields || [])
    .map((field) => ({ name: field.name, answer: formatAnswer(field) }))
    .filter((item) => item.answer);
  if (answers.length) {
    out.push("", "## Questionnaire", ...answers.map((item) => `- ${maskText(item.name)}: ${maskText(item.answer)}`));
  }

  const checklist = ticket.checklist || [];
  if (checklist.length) {
    out.push("", "## Checklist", ...checklist.map((item) => `- [${item.checked ? "x" : " "}] ${maskText(item.description)}`));
  }

  out.push("", `## Comments (${detail.comments.length})`);
  for (const comment of detail.comments) {
    out.push(`- ${iso(comment.createdAt)} · ${personLabel(comment.createdBy, ctx)}: ${indent(safe(comment.content, MAX_COMMENT))}`);
  }

  if (detail.works) {
    out.push("", `## Works (${detail.works.length})`);
    for (const work of detail.works) {
      const performer = nameOf(work.finishedBy?._id ? work.finishedBy : work.executor);
      const minutes = Math.round((work.durationMs || 0) / 60_000);
      out.push(
        `- ${iso(work.startedAt)} → ${iso(work.finishedAt)} (${minutes} min, ${work.visitRequired ? "on-site" : "remote"}) · ${performer}: ${indent(safe(work.description, MAX_COMMENT))}`,
      );
    }
  }

  if (detail.devices) {
    out.push("", `## Devices (${detail.devices.length})`);
    for (const device of detail.devices) {
      const model = device.deviceModelId;
      const type = model?.deviceTypeId?.name || device.deviceTypeId?.name || "device";
      const name = [model?.vendorId?.name, model?.name].filter(Boolean).join(" ") || "—";
      out.push(
        `- ${type} · ${name} · inv. ${device.inventoryNumber || "—"} · s/n ${device.serialNumber || "—"} · ${device.status || "—"} · OS: ${device.operatingSystem || "—"}`,
      );
    }
  }

  return out.join("\n");
};

const formatStats = (stats, { groupBy, summary }) => {
  const header = `Tickets: ${stats.total} (open ${stats.open}, closed ${stats.closed}), grouped by ${groupBy}${summary ? ` (${summary})` : ""}.`;
  if (!stats.total) return `${header}\nNo tickets match.`;
  const rows = stats.groups.map(
    (g) => `| ${g.label} | ${g.tickets} | ${g.open} | ${g.closed} | ${g.medianHours ?? "—"} | ${g.share}% |`,
  );
  return [header, "", `| ${groupBy} | tickets | open | closed | median hours to close | share |`, "|---|---|---|---|---|---|", ...rows].join("\n");
};

module.exports = {
  buildDirectory,
  isSystemUser,
  personLabel,
  companyLabel,
  categoryLabel,
  ticketLink,
  formatTicketRow,
  formatTicketDetail,
  formatStats,
};
```

- [ ] **Step 4: Run** — Expected: 5 pass.
- [ ] **Step 5: Mutation check** — replace `safe(comment.content, MAX_COMMENT)` with `comment.content` → the leak test must fail (`ivan@corp.ru`); restore.
- [ ] **Step 6: Checkpoint** — backend tests green. Do not commit.

---

### Task 7: Ticket tools over an injected source

**Files:**
- Create: `backend/services/mcp/ticketTools.js`
- Test: `backend/services/mcp/ticketTools.test.js`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces: `createTicketTools({ source, baseUrl, log })` → `{ search(args, caller, context), getTicket(args, caller, context), findSimilar(args, caller, context), stats(args, caller, context) }`, each returning a `CallToolResult` (`{ content: [{ type: "text", text }], isError? }`).
- `source` contract (Task 9 implements it with Mongo):
  - `loadDirectory(): Promise<{ companies, users, categories }>`
  - `findTickets(filter, { sort, skip, limit }): Promise<ticket[]>` — search projection (no `htmlDescription`)
  - `countTickets(filter): Promise<number>`
  - `loadTicketDetail(num, { works: boolean, devices: boolean, applicantIsSystem: (id) => boolean }): Promise<detail|null>`
  - `loadWorkDescriptions(ticketIds): Promise<Map<string, string[]>>`
  - `loadStatsRows(filter): Promise<row[]>`
- `context = { timezone, modules: { timeTracking, inventory }, systemAccounts: { unidentifiedId, robotIds } }`, `caller = { keyId, keyName }`.

- [ ] **Step 1: Write the test** — a fake source filters fixtures with `sift`, so the tools' Mongo filters are exercised for real.

```js
// node --test services/mcp/ticketTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const { createTicketTools } = require("./ticketTools");

const companies = [
  { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
  { _id: "c2", alias: "Ромб", fullTitle: "АО «Ромб»" },
];
const users = [
  { _id: "u1", firstName: "Мария", lastName: "Иванова", position: "бухгалтер", isEndUser: true, company: { _id: "c1" } },
  { _id: "u2", firstName: "Иван", lastName: "Иванов", position: "директор", isEndUser: true, company: { _id: "c2" } },
];
const categories = [{ _id: "k1", title: "Оргтехника" }, { _id: "k2", title: "Сеть" }];

const t = (num, over) => ({
  _id: `t${num}`, num, title: `Заявка ${num}`, description: "", source: "Портал", state: "Закрыта", isClosed: true,
  categoryId: "k1", company: { _id: "c1", alias: "Ромашка" }, applicantId: "u1",
  createdAt: new Date(`2026-09-${String(num % 28 + 1).padStart(2, "0")}T03:00:00Z`),
  finishedAt: new Date(`2026-09-${String(num % 28 + 1).padStart(2, "0")}T06:00:00Z`),
  closingComment: "", ...over,
});

const tickets = [
  t(1, { title: "Не печатает принтер HP", description: "<p>замятие бумаги</p>", closingComment: "Почистили ролики подачи бумаги, заменили тормозную площадку, напечатали тестовую страницу — работает стабильно." }),
  t(2, { title: "Принтер HP снова не печатает", description: "<p>опять замятие</p>" }),
  t(3, { title: "VPN не подключается", categoryId: "k2", isClosed: false, state: "В работе", finishedAt: null }),
  t(4, { title: "Принтер Canon", company: { _id: "c2", alias: "Ромб" }, applicantId: "u2" }),
];

const fakeSource = () => ({
  loadDirectory: async () => ({ companies, users, categories }),
  findTickets: async (filter, { sort = { createdAt: -1 }, skip = 0, limit = 1000 } = {}) => {
    const [[field, order]] = Object.entries(sort);
    return tickets
      .filter(sift(filter))
      .sort((a, b) => (new Date(a[field]) - new Date(b[field])) * order)
      .slice(skip, skip + limit);
  },
  countTickets: async (filter) => tickets.filter(sift(filter)).length,
  loadTicketDetail: async (num, { works, devices }) => {
    const ticket = tickets.find((item) => item.num === num);
    if (!ticket) return null;
    return {
      ticket,
      routineTaskTitle: null,
      comments: [{ content: "Проверьте, пожалуйста", createdBy: "u1", createdAt: ticket.createdAt }],
      works: works ? [{ description: "Почистил ролики", visitRequired: true, startedAt: ticket.createdAt, finishedAt: ticket.finishedAt, durationMs: 3 * 3_600_000, finishedBy: { _id: "x", firstName: "Пётр", lastName: "Петров" } }] : null,
      devices: devices ? [] : null,
    };
  },
  loadWorkDescriptions: async (ids) => new Map(ids.map((id) => [String(id), ["Почистил ролики"]])),
  loadStatsRows: async (filter) => tickets.filter(sift(filter)),
});

const context = { timezone: "Asia/Vladivostok", modules: { timeTracking: true, inventory: false }, systemAccounts: { unidentifiedId: null, robotIds: [] } };
const caller = { keyId: "k", keyName: "OpenClaw" };

const setup = () => {
  const logs = [];
  const tools = createTicketTools({ source: fakeSource(), baseUrl: "https://hd.example.ru", log: (level, message, meta) => logs.push(meta) });
  return { tools, logs };
};

const text = (result) => result.content.map((part) => part.text).join("\n");
const nums = (result) => [...text(result).matchAll(/tickets\/(\d+)/g)].map((m) => Number(m[1]));

test("search: words rank inside the chosen company and status", async () => {
  const { tools } = setup();

  const result = await tools.search({ query: "принтер", company: "Ромашка", status: "closed" }, caller, context);

  assert.ok(!result.isError);
  assert.deepEqual(nums(result), [2, 1]);
  assert.match(text(result), /Found 2 tickets/);
});

test("search: without words — newest first, with the total", async () => {
  const { tools } = setup();

  const result = await tools.search({ status: "any", limit: 2 }, caller, context);

  assert.match(text(result), /Found 4 tickets/);
  assert.equal(nums(result).length, 2);
});

test("search: an ambiguous company name is a tool error listing the options", async () => {
  const { tools } = setup();

  const result = await tools.search({ company: "Ром" }, caller, context);

  assert.equal(result.isError, true);
  assert.match(text(result), /Ромашка/);
  assert.match(text(result), /Ромб/);
});

test("search: a ticket number finds that ticket", async () => {
  const { tools } = setup();

  assert.deepEqual(nums(await tools.search({ query: "3" }, caller, context)), [3]);
});

test("get_ticket: works follow the time-tracking module", async () => {
  const { tools } = setup();

  const withWorks = text(await tools.getTicket({ num: 1 }, caller, context));
  const withoutWorks = text(await tools.getTicket({ num: 1 }, caller, { ...context, modules: { timeTracking: false, inventory: false } }));

  assert.match(withWorks, /## Works \(1\)/);
  assert.doesNotMatch(withoutWorks, /## Works/);
  assert.equal((await tools.getTicket({ num: 999 }, caller, context)).isError, true);
});

test("find_similar_tickets: same company, closed by default, with how it was solved", async () => {
  const { tools } = setup();

  const result = await tools.findSimilar({ num: 2 }, caller, context);

  assert.deepEqual(nums(result).slice(1), [1]); // первая ссылка — на исходную заявку в заголовке
  assert.match(text(result), /solved: Почистили ролики подачи бумаги/);
  assert.match(text(result), /works: Почистил ролики/);
});

test("ticket_stats: grouped by category with names", async () => {
  const { tools } = setup();

  const result = await tools.stats({ groupBy: "category" }, caller, context);

  assert.match(text(result), /Tickets: 4 \(open 1, closed 3\)/);
  assert.match(text(result), /\| Оргтехника \| 3 \|/);
  assert.match(text(result), /\| Сеть \| 1 \|/);
});

test("every call writes one log line naming the key and the tool", async () => {
  const { tools, logs } = setup();

  await tools.search({ query: "vpn" }, caller, context);
  await tools.stats({}, caller, context);

  assert.deepEqual(logs.map((meta) => [meta.mcpKeyName, meta.tool]), [["OpenClaw", "search_tickets"], ["OpenClaw", "ticket_stats"]]);
});
```

- [ ] **Step 2: Run to confirm it fails** — module not found.
- [ ] **Step 3: Implement**

```js
const { resolveByName, buildTicketFilter, rankTickets, rankSimilar } = require("./ticketQuery");
const { aggregateTicketStats } = require("./ticketStats");
const {
  buildDirectory,
  isSystemUser,
  personLabel,
  formatTicketRow,
  formatTicketDetail,
  formatStats,
  ticketLink,
} = require("./ticketFormat");
const { maskText } = require("./maskText");

/**
 * Инструменты заявок для ИИ-агента (spec 2026-09-17-mcp-tickets-design.md).
 * Доступ к данным приходит аргументом (ticketSource.js), поэтому модуль
 * проверяется на заготовках без базы.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SIMILAR_DEFAULT = 10;
const SIMILAR_MAX = 30;
const MAX_CANDIDATES = 20_000;
const MEANINGFUL_CLOSING = 100;

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });
const clampInt = (value, min, max, fallback) =>
  Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;

const NAME_RULES = {
  company: { list: "companies", label: (c) => `${c.alias} ${c.fullTitle || ""}`, exact: (c) => [c.alias, c.fullTitle].filter(Boolean), show: (c) => c.alias },
  user: {
    list: "users",
    label: (u) => `${u.lastName || ""} ${u.firstName || ""}`,
    exact: (u) => [`${u.lastName} ${u.firstName}`, `${u.firstName} ${u.lastName}`],
    show: (u, dir) => `${u.lastName} ${u.firstName}${u.company?._id ? ` (${dir.companies.get(String(u.company._id))?.alias || "—"})` : ""}`,
  },
  category: { list: "categories", label: (k) => k.title, exact: (k) => [k.title], show: (k) => k.title },
};

// Имена из аргументов → id. Ноль или несколько совпадений — ошибка инструмента
// с подсказкой: агент уточняет имя, а не получает чужие заявки.
const resolveNames = (raw, dir, args) => {
  const ids = {};
  const labels = [];
  for (const kind of ["company", "user", "category"]) {
    const name = typeof args[kind] === "string" ? args[kind].trim() : "";
    if (!name) continue;
    const rule = NAME_RULES[kind];
    const matches = resolveByName(raw[rule.list], name, rule);
    if (!matches.length) return { error: `No ${kind} matches "${name}". Check the name or omit the filter.` };
    if (matches.length > 1) {
      const options = matches.slice(0, 10).map((item) => rule.show(item, dir)).join("; ");
      return { error: `Several ${kind === "category" ? "categories" : `${kind === "company" ? "companies" : "people"}`} match "${name}": ${options}. Repeat with a more specific name.` };
    }
    ids[`${kind}Ids`] = [matches[0]._id];
    labels.push(`${kind}: ${rule.show(matches[0], dir)}`);
  }
  return { ids, labels };
};

const periodLabel = (from, to) => (from || to ? `created ${from || "…"}…${to || "…"}` : null);

const createTicketTools = ({ source, baseUrl, log }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  const loadDirectoryContext = async (context) => {
    const raw = await source.loadDirectory();
    const directory = buildDirectory(raw);
    return { raw, directory, ctx: { directory, systemAccounts: context.systemAccounts, baseUrl } };
  };

  return {
    search: async (args = {}, caller, context) => {
      const started = Date.now();
      const { raw, directory, ctx } = await loadDirectoryContext(context);
      const names = resolveNames(raw, directory, args);
      if (names.error) {
        logCall(caller, "search_tickets", { error: "name" }, started);
        return errorResult(names.error);
      }
      const status = ["open", "closed", "any"].includes(args.status) ? args.status : "any";
      const limit = clampInt(args.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
      const page = clampInt(args.page, 1, 1000, 1);
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
      const filter = buildTicketFilter({ status, ...names.ids, from: args.from, to: args.to, timezone: context.timezone });

      let total;
      let entries;
      if (/^\d+$/.test(query)) {
        const rows = await source.findTickets({ ...filter, num: Number(query) }, { limit: 1 });
        total = rows.length;
        entries = rows.map((ticket) => ({ ticket, text: null }));
      } else if (query) {
        const candidates = await source.findTickets(filter, { sort: { createdAt: -1 }, limit: MAX_CANDIDATES });
        const { hits, needles } = rankTickets(candidates, query);
        total = hits.length;
        entries = hits.slice((page - 1) * limit, page * limit).map((hit) => ({ ...hit, needles }));
      } else {
        total = await source.countTickets(filter);
        const rows = await source.findTickets(filter, { sort: { createdAt: -1 }, skip: (page - 1) * limit, limit });
        entries = rows.map((ticket) => ({ ticket, text: null }));
      }

      const summary = [`status: ${status}`, ...names.labels, periodLabel(args.from, args.to), query && `query: "${maskText(query)}"`]
        .filter(Boolean)
        .join("; ");
      logCall(caller, "search_tickets", { query: query.slice(0, 100), filters: summary, results: total }, started);

      if (!total) return textResult(`No tickets match (${summary}). Try other words, a wider period or fewer filters.`);
      const first = (page - 1) * limit + 1;
      const last = first + entries.length - 1;
      const header = `Found ${total} tickets (${summary}); showing ${first}–${last}, ${query && !/^\d+$/.test(query) ? "best match first" : "newest first"}.`;
      return textResult([header, ...entries.map((entry, i) => formatTicketRow(entry, first + i, ctx))].join("\n\n"));
    },

    getTicket: async (args = {}, caller, context) => {
      const started = Date.now();
      const num = Number(args.num);
      const { directory, ctx } = await loadDirectoryContext(context);
      const detail = Number.isInteger(num) && num > 0
        ? await source.loadTicketDetail(num, {
            works: Boolean(context.modules.timeTracking),
            devices: Boolean(context.modules.inventory),
            applicantIsSystem: (id) => isSystemUser(id, directory, context.systemAccounts),
          })
        : null;
      logCall(caller, "get_ticket", { num, found: Boolean(detail) }, started);
      if (!detail) return errorResult(`Ticket #${args.num} not found. Use a number from search_tickets.`);
      return textResult(formatTicketDetail(detail, ctx));
    },

    findSimilar: async (args = {}, caller, context) => {
      const started = Date.now();
      const num = Number(args.num);
      const { ctx } = await loadDirectoryContext(context);
      const [origin] = Number.isInteger(num) && num > 0 ? await source.findTickets({ num }, { limit: 1 }) : [];
      if (!origin) {
        logCall(caller, "find_similar_tickets", { num, found: false }, started);
        return errorResult(`Ticket #${args.num} not found. Use a number from search_tickets.`);
      }
      const status = args.status === "any" ? "any" : "closed";
      const sameCompany = args.scope !== "all" && origin.company?._id;
      const limit = clampInt(args.limit, 1, SIMILAR_MAX, SIMILAR_DEFAULT);
      const filter = {
        ...buildTicketFilter({ status, companyIds: sameCompany ? [origin.company._id] : undefined, timezone: context.timezone }),
        _id: { $ne: origin._id },
      };
      const candidates = await source.findTickets(filter, { sort: { createdAt: -1 }, limit: MAX_CANDIDATES });
      const { hits, needles } = rankSimilar(origin, candidates);
      const top = hits.slice(0, limit);
      const works = top.length ? await source.loadWorkDescriptions(top.map((hit) => hit.ticket._id)) : new Map();

      const scopeLabel = sameCompany ? `same company: ${ctx.directory.companies.get(String(origin.company._id))?.alias || origin.company.alias}` : "all companies";
      logCall(caller, "find_similar_tickets", { num, scope: scopeLabel, results: hits.length }, started);

      const header = `Similar to #${origin.num} «${maskText(origin.title)}» (${ticketLink(baseUrl, origin.num)}; ${scopeLabel}; ${status === "closed" ? "closed tickets" : "any status"}): found ${hits.length}${top.length ? `; showing ${top.length}, best match first` : ""}.`;
      if (!top.length) return textResult(`${header}\nNo similar tickets. Try scope "all" or search_tickets with other words.`);
      const rows = top.map((hit, i) => {
        const closing = String(hit.ticket.closingComment || "").trim();
        const solved = {
          closing: closing.length >= MEANINGFUL_CLOSING ? closing : null,
          works: (works.get(String(hit.ticket._id)) || []).filter(Boolean).join(" / ") || null,
        };
        return formatTicketRow({ ...hit, needles, solved }, i + 1, ctx);
      });
      return textResult([header, ...rows].join("\n\n"));
    },

    stats: async (args = {}, caller, context) => {
      const started = Date.now();
      const { raw, directory } = await loadDirectoryContext(context);
      const names = resolveNames(raw, directory, args);
      if (names.error) {
        logCall(caller, "ticket_stats", { error: "name" }, started);
        return errorResult(names.error);
      }
      const groupBy = ["category", "month", "company", "applicant", "source"].includes(args.groupBy) ? args.groupBy : "category";
      const status = ["open", "closed", "any"].includes(args.status) ? args.status : "any";
      const filter = buildTicketFilter({ status, ...names.ids, from: args.from, to: args.to, timezone: context.timezone });
      const rows = await source.loadStatsRows(filter);
      const labelOf = (kind, key) => {
        if (kind === "category") return directory.categories.get(key) || "без категории";
        if (kind === "company") return directory.companies.get(key)?.alias || "без компании";
        if (kind === "applicant") return personLabel(key, { directory, systemAccounts: context.systemAccounts });
        return key || "—";
      };
      const stats = aggregateTicketStats(rows, { groupBy, timezone: context.timezone, labelOf });
      const summary = [`status: ${status}`, ...names.labels, periodLabel(args.from, args.to)].filter(Boolean).join("; ");
      logCall(caller, "ticket_stats", { groupBy, filters: summary, results: stats.total }, started);
      return textResult(formatStats(stats, { groupBy, summary }));
    },
  };
};

module.exports = { createTicketTools };
```

- [ ] **Step 4: Run** — Expected: 8 pass. Fix the implementation, not the expectations, unless an expectation contradicts the spec.
- [ ] **Step 5: Mutation check** — in `findSimilar` remove `_id: { $ne: origin._id }` → the similar test must fail (the source ticket would list itself); restore.
- [ ] **Step 6: Checkpoint** — backend tests green. Do not commit.

---

### Task 8: Key permissions on the backend

**Files:**
- Modify: `backend/services/mcp/keys.js`, `backend/services/mcp/keys.test.js`
- Modify: `backend/models/mcpKey.js`, `backend/types/mcpKey.ts`
- Modify: `backend/middleware/requireMcpKey.js`, `backend/middleware/requireMcpKey.test.js`
- Modify: `backend/validations/mcpKey.js`, `backend/validations/mcpKey.test.js`
- Modify: `backend/controllers/mcpKey.js`, `backend/routes/internal/preferences.js`

**Interfaces:**
- Produces: `MCP_SCOPES = ["knowledge", "tickets"]`; `normalizeScopes(scopes: unknown): string[]` (known values in `MCP_SCOPES` order, empty → `["knowledge"]`); `toKeyRow(key)` adds `scopes`; `req.mcpKey = { _id, name, scopes }`; `POST /api/preferences/mcp-keys` accepts `scopes`; `POST /api/preferences/mcp-keys/update { _id, scopes }` → `200 { message, key }` / `404`.

- [ ] **Step 1: Tests first** — append to `services/mcp/keys.test.js`:

```js
const { normalizeScopes } = require("./keys");

test("scopes: known values in a fixed order, a key without scopes reads knowledge-only", () => {
  assert.deepEqual(normalizeScopes(["tickets", "knowledge", "tickets"]), ["knowledge", "tickets"]);
  assert.deepEqual(normalizeScopes(["tickets", "admin"]), ["tickets"]);
  assert.deepEqual(normalizeScopes(undefined), ["knowledge"]);
  assert.deepEqual(normalizeScopes([]), ["knowledge"]);
});
```

and change the expected object in `row: exposes name, tail, dates and author — never the hash` to include `scopes: ["knowledge"]` (the fixture has no `scopes`).

In `middleware/requireMcpKey.test.js` change the expected `mcpKey` in `known key: passes and exposes only its id and name` to `{ _id: "66aa00000000000000000001", name: "OpenClaw", scopes: ["knowledge"] }` and add:

```js
test("known key: its permissions are passed on", async () => {
  const { app } = harness({ key: { _id: "66aa00000000000000000010", name: "k", lastUsedAt: new Date(NOW), scopes: ["tickets"] } });

  const response = await post(app, { headers: bearer(KEY) });

  assert.deepEqual(response.body.mcpKey.scopes, ["tickets"]);
});
```

Append to `validations/mcpKey.test.js`:

```js
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
```

- [ ] **Step 2: Run to confirm they fail** — `node --test services/mcp/keys.test.js middleware/requireMcpKey.test.js validations/mcpKey.test.js`.
- [ ] **Step 3: Implement**

`services/mcp/keys.js` — add and export:

```js
// Доступы ключа: к базе знаний и к заявкам. Ключи, выданные до появления
// доступов, в базе без поля — они читают только базу знаний, как и раньше.
const MCP_SCOPES = Object.freeze(["knowledge", "tickets"]);

const normalizeScopes = (scopes) => {
  const given = Array.isArray(scopes) ? scopes : [];
  const known = MCP_SCOPES.filter((scope) => given.includes(scope));
  return known.length ? known : ["knowledge"];
};
```

and in `toKeyRow` add `scopes: normalizeScopes(key.scopes),` after `keyTail`. Export `MCP_SCOPES`, `normalizeScopes`.

`models/mcpKey.js` — add to the schema:

```js
    // Доступы (services/mcp/keys.js#MCP_SCOPES); у старых ключей поля нет.
    scopes: {
      type: [{ type: String, enum: ["knowledge", "tickets"] }],
      default: ["knowledge"],
    },
```

`types/mcpKey.ts` — add `scopes: ("knowledge" | "tickets")[];`.

`middleware/requireMcpKey.js` — `const { normalizeScopes } = require("../services/mcp/keys");` and set `req.mcpKey = { _id: key._id, name: key.name, scopes: normalizeScopes(key.scopes) };`.

`validations/mcpKey.js`:

```js
const { MCP_SCOPES } = require("../services/mcp/keys");

const scopesRule = (chain) =>
  chain
    .isArray({ min: 1 })
    .withMessage("Отметьте, к чему у ключа доступ")
    .bail()
    .custom((scopes) => scopes.every((scope) => MCP_SCOPES.includes(scope)))
    .withMessage("Неизвестный доступ ключа");
```

— append `scopesRule(body("scopes").optional())` to `exports.create`, and add:

```js
exports.update = [
  body("_id").isMongoId().withMessage("Некорректный идентификатор ключа"),
  scopesRule(body("scopes")),
];
```

`controllers/mcpKey.js` — import `normalizeScopes`; in `create` pass `scopes: normalizeScopes(req.body.scopes)` to `McpKey.create`; add:

```js
exports.update = async (req, res, next) => {
  try {
    const scopes = normalizeScopes(req.body.scopes);
    const key = await McpKey.findByIdAndUpdate(req.body._id, { $set: { scopes } }, { new: true })
      .populate(AUTHOR)
      .lean();
    if (!key) {
      return res.status(404).json({ error: true, status: 404, message: "Ключ не найден" });
    }

    (await logger.addContext(req)).log("info", "MCP: изменён доступ ключа", {
      mcpKeyId: String(key._id),
      mcpKeyName: key.name,
      scopes,
    });

    res.status(200).json({ message: "Доступ ключа изменён", key: toKeyRow(key) });
  } catch (error) {
    next(new AppError("Failed to update MCP key", 500, true, error));
  }
};
```

`routes/internal/preferences.js` — next to the other key routes:

```js
router.post(
  "/preferences/mcp-keys/update",
  isAuth,
  canManageSettings,
  mcpKeyValidation.update,
  checkValidationResult,
  mcpKeyController.update,
);
```

- [ ] **Step 4: Run** — the three files pass; `node scripts/checkPermissionCoverage.js` still green.
- [ ] **Step 5: Checkpoint** — backend tests green. Do not commit.

---

### Task 9: MCP server, route wiring, ticket source

**Files:**
- Modify: `backend/services/mcp/server.js`
- Modify: `backend/routes/mcpRouter.js`, `backend/routes/mcp.js`, `backend/routes/mcp.test.js`
- Create: `backend/services/mcp/ticketSource.js`
- Modify: `backend/models/comment.js`

**Interfaces:**
- Consumes: `createTicketTools` (Task 7), `normalizeScopes` (Task 8), `createKnowledgeTools` (existing).
- Produces: `createMcpRequestHandler({ tools: { knowledge, tickets }, loadContext, onError })`; `buildMcpRouter({ requireKey, handle, rateLimitMax })` (no `moduleGate`); `SERVER_INFO.name = "hd-helpdesk"`.
- `loadContext(): Promise<{ modules: { knowledgeBase, timeTracking, inventory }, timezone, systemAccounts: { unidentifiedId, robotIds } }>`.

- [ ] **Step 1: Rewrite `routes/mcp.test.js` setup and add family tests** — replace `buildApp` and the module-off test; keep the other existing tests unchanged except the server name (`hd-helpdesk`).

```js
const { createTicketTools } = require("@/services/mcp/ticketTools");

const MODULES_ON = { knowledgeBase: true, timeTracking: true, inventory: true };

const TICKETS = [
  {
    _id: "t1", num: 51702, title: "Не печатает принтер", description: "<p>звоните 8 999 123-45-67</p>", source: "Портал",
    state: "Закрыта", isClosed: true, categoryId: null, company: { _id: "c1", alias: "Ромашка" }, applicantId: null,
    createdAt: new Date("2026-09-01T03:00:00Z"), finishedAt: new Date("2026-09-01T05:00:00Z"), closingComment: "",
  },
];

const ticketSource = {
  loadDirectory: async () => ({ companies: [{ _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" }], users: [], categories: [] }),
  findTickets: async (filter) => TICKETS.filter(sift(filter)),
  countTickets: async (filter) => TICKETS.filter(sift(filter)).length,
  loadTicketDetail: async (num) => {
    const ticket = TICKETS.find((item) => item.num === num);
    return ticket ? { ticket, routineTaskTitle: null, comments: [], works: [], devices: [] } : null;
  },
  loadWorkDescriptions: async () => new Map(),
  loadStatsRows: async (filter) => TICKETS.filter(sift(filter)),
};

const buildApp = ({ scopes = ["knowledge"], modules = MODULES_ON, rateLimitMax = 100, logs = [] } = {}) => {
  const log = (level, message, meta) => logs.push(meta);
  const knowledge = createKnowledgeTools({
    findCandidates: async () => NOTES,
    findNoteById: async (id) => NOTES.find((item) => String(item._id) === id) || null,
    baseUrl: "https://hd.example.ru",
    log,
  });
  const tickets = createTicketTools({ source: ticketSource, baseUrl: "https://hd.example.ru", log });

  const router = buildMcpRouter({
    requireKey: createRequireMcpKey({
      findKeyByHash: async (hash) =>
        hash === sha256(KEY)
          ? { _id: "66aa000000000000000000aa", name: "OpenClaw", lastUsedAt: new Date(), scopes }
          : null,
      touchKey: async () => {},
      log: () => {},
    }),
    handle: createMcpRequestHandler({
      tools: { knowledge, tickets },
      loadContext: async () => ({ modules, timezone: "Asia/Vladivostok", systemAccounts: { unidentifiedId: null, robotIds: [] } }),
      onError: () => {},
    }),
    rateLimitMax,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/mcp", router);
  app.use((req, res) => res.status(200).json({ fellThrough: true }));
  return app;
};
```

Add `const sift = require("sift").default;` at the top. In the existing test «POST without a key gets 401 before anything else runs» replace `buildApp({ moduleOn: false })` with `buildApp({ modules: { ...MODULES_ON, knowledgeBase: false } })`; in «a 2025-11-25 client initializes…» expect `serverInfo.name` `"hd-helpdesk"`. Replace the module-off test with:

```js
test("a knowledge-only key with the knowledge base module off gets 403", async () => {
  await withServer(buildApp({ modules: { ...MODULES_ON, knowledgeBase: false } }), async (base) => {
    const { status } = await rpc(base, "initialize", INITIALIZE);
    assert.equal(status, 403);
  });
});

test("tools follow the key's permissions and the modules", async () => {
  const names = async (options) =>
    withServer(buildApp(options), async (base) =>
      (await rpc(base, "tools/list", {})).message.result.tools.map((tool) => tool.name).sort(),
    );

  assert.deepEqual(await names({ scopes: ["knowledge"] }), ["get_knowledge_note", "search_knowledge_base"]);
  assert.deepEqual(await names({ scopes: ["tickets"] }), ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"]);
  assert.deepEqual(
    await names({ scopes: ["knowledge", "tickets"], modules: { ...MODULES_ON, knowledgeBase: false } }),
    ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"],
  );
});

test("a ticket read over MCP masks the phone and links to HD", async () => {
  await withServer(buildApp({ scopes: ["tickets"] }), async (base) => {
    const message = await callTool(base, "get_ticket", { num: 51702 });

    assert.match(toolText(message), /\[телефон\]/);
    assert.doesNotMatch(toolText(message), /123-45-67/);
    assert.match(toolText(message), /https:\/\/hd\.example\.ru\/tickets\/51702/);
  });
});
```

- [ ] **Step 2: Run to confirm failures** — `node --test routes/mcp.test.js` (constructor signatures and tool families are missing).
- [ ] **Step 3: Implement `server.js`** — keep the existing knowledge-base schemas and `READ_ONLY`; rename `SERVER_INFO.name` to `"hd-helpdesk"`; replace `INSTRUCTIONS`, `buildKnowledgeServer` and `createMcpRequestHandler` with:

```js
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const NAME = (description) => ({ type: "string", minLength: 1, maxLength: 200, description });
const STATUS = (values, description) => ({ type: "string", enum: values, description });

const TICKET_SCHEMAS = {
  search: fromJsonSchema({
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 300, description: "Words from the title or description, a host name, an IP or a ticket number." },
      status: STATUS(["open", "closed", "any"], "open, closed (archive) or any (default)."),
      company: NAME("Company name (alias or full title)."),
      user: NAME("Applicant name, e.g. «Иванова Мария»."),
      category: NAME("Ticket category title."),
      from: { ...DATE, description: "Created on or after this day (YYYY-MM-DD)." },
      to: { ...DATE, description: "Created on or before this day (YYYY-MM-DD)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Tickets per page (default 10)." },
      page: { type: "integer", minimum: 1, maximum: 1000, description: "Page number (default 1)." },
    },
    additionalProperties: false,
  }),
  get: fromJsonSchema({
    type: "object",
    properties: { num: { type: "integer", minimum: 1, description: "Ticket number, e.g. 51702." } },
    required: ["num"],
    additionalProperties: false,
  }),
  similar: fromJsonSchema({
    type: "object",
    properties: {
      num: { type: "integer", minimum: 1, description: "Ticket number to compare with." },
      scope: STATUS(["same_company", "all"], "same_company (default) or all companies."),
      status: STATUS(["closed", "any"], "closed (default, solved tickets) or any."),
      limit: { type: "integer", minimum: 1, maximum: 30, description: "How many similar tickets (default 10)." },
    },
    required: ["num"],
    additionalProperties: false,
  }),
  stats: fromJsonSchema({
    type: "object",
    properties: {
      groupBy: STATUS(["category", "month", "company", "applicant", "source"], "Grouping (default category)."),
      status: STATUS(["open", "closed", "any"], "open, closed or any (default)."),
      company: NAME("Company name."),
      user: NAME("Applicant name."),
      category: NAME("Ticket category title."),
      from: { ...DATE, description: "Created on or after this day (YYYY-MM-DD)." },
      to: { ...DATE, description: "Created on or before this day (YYYY-MM-DD)." },
    },
    additionalProperties: false,
  }),
};

const INSTRUCTIONS = {
  common: [
    "Read-only access to the organisation's IT helpdesk (HD).",
    "Texts are mostly in Russian: search with Russian keywords plus product, company or host names.",
    "Always give the user the link of every note or ticket you rely on.",
  ],
  knowledge: [
    "Knowledge base: search_knowledge_base, then get_knowledge_note with an id from the results. Only moderator-approved notes without detected credentials are available.",
  ],
  tickets: [
    "Tickets: search_tickets filters by status, company, user, category and dates; get_ticket reads one ticket with comments, works and devices; find_similar_tickets compares a ticket with others (same company and closed by default) and shows how they were solved; ticket_stats counts tickets by category, month, company, applicant or source.",
    "Phone numbers, e-mail addresses and credentials in ticket texts are masked as [телефон], [e-mail], [секрет скрыт]; never guess them — send the ticket link.",
  ],
};

// Семьи инструментов: доступ ключа И включённый модуль (у заявок модуля нет).
const toolFamilies = ({ scopes, modules }) => ({
  knowledge: scopes.includes("knowledge") && Boolean(modules.knowledgeBase),
  tickets: scopes.includes("tickets"),
});

const buildHdServer = ({ tools, caller, context }) => {
  const families = toolFamilies(context);
  const instructions = [
    ...INSTRUCTIONS.common,
    ...(families.knowledge ? INSTRUCTIONS.knowledge : []),
    ...(families.tickets ? INSTRUCTIONS.tickets : []),
  ].join("\n");
  const server = new McpServer(SERVER_INFO, { instructions });

  if (families.knowledge) {
    server.registerTool(
      "search_knowledge_base",
      {
        title: "Search the knowledge base",
        description: "Find approved knowledge base notes by keywords. For each note returns id, title, type, companies, categories, approval time, a link and a matching snippet, best match first.",
        inputSchema: SEARCH_SCHEMA,
        annotations: READ_ONLY,
      },
      (args) => tools.knowledge.search(args, caller),
    );
    server.registerTool(
      "get_knowledge_note",
      {
        title: "Read a knowledge base note",
        description: "Read one approved knowledge base note in full (Markdown) by an id from search_knowledge_base.",
        inputSchema: GET_SCHEMA,
        annotations: READ_ONLY,
      },
      (args) => tools.knowledge.getNote(args, caller),
    );
  }

  if (families.tickets) {
    const register = (name, title, description, inputSchema, run) =>
      server.registerTool(name, { title, description, inputSchema, annotations: READ_ONLY }, (args) => run(args, caller, context));
    register("search_tickets", "Search tickets", "Find tickets by words, number, status (open/closed), company, user, category and creation dates. Returns the total and, per ticket, status, company, applicant, category, dates, a masked snippet and a link.", TICKET_SCHEMAS.search, tools.tickets.search);
    register("get_ticket", "Read a ticket", "Read one ticket by number: header, description, questionnaire answers, checklist, all comments, works and related devices. Contacts and credentials are masked.", TICKET_SCHEMAS.get, tools.tickets.getTicket);
    register("find_similar_tickets", "Find similar tickets", "Find tickets similar to a given one (same company and closed by default), best match first, each with how it was solved.", TICKET_SCHEMAS.similar, tools.tickets.findSimilar);
    register("ticket_stats", "Ticket statistics", "Count tickets grouped by category, month, company, applicant or source, with open/closed counts, median hours to close and share.", TICKET_SCHEMAS.stats, tools.tickets.stats);
  }

  return server;
};

/**
 * Express-обработчик MCP. Контекст запроса (модули, пояс организации,
 * системные учётки) читается один раз и едет к инструментам через authInfo:
 * req.auth в этом приложении — личность сотрудника, адаптер SDK её не трогает.
 */
const createMcpRequestHandler = ({ tools, loadContext, onError }) => {
  const mcp = createMcpHandler(
    (ctx) => buildHdServer({ tools, caller: ctx.authInfo?.extra?.caller, context: ctx.authInfo?.extra?.context }),
    { maxSubscriptions: 0, onerror: onError },
  );

  return async (req, res, next) => {
    try {
      const context = { ...(await loadContext()), scopes: req.mcpKey.scopes };
      const families = toolFamilies(context);
      if (!families.knowledge && !families.tickets) {
        return res.status(403).json({
          error: true,
          status: 403,
          message: 'Ключу нечего читать: модуль "База знаний" отключен, а доступа к заявкам у ключа нет.',
        });
      }
      const keyId = String(req.mcpKey._id);
      const authInfo = {
        token: "",
        clientId: keyId,
        scopes: context.scopes,
        extra: { caller: { keyId, keyName: req.mcpKey.name }, context },
      };
      const serve = toNodeHandler(
        { fetch: (request, options) => mcp.fetch(request, { ...options, authInfo }) },
        { onerror: onError },
      );
      await serve(req, res, req.body);
    } catch (error) {
      if (res.headersSent) onError(error);
      else next(error);
    }
  };
};

module.exports = { createMcpRequestHandler, SERVER_INFO };
```

`routes/mcpRouter.js` — drop `moduleGate` from the parameters, the docs comment and `router.post("/", requireKey, limiter, handle);`.

`services/mcp/ticketSource.js`:

```js
const Ticket = require("@/models/ticket");
const Comment = require("@/models/comment");
const Work = require("@/models/work");
const User = require("@/models/user");
const Company = require("@/models/company");
const TicketCategory = require("@/models/ticketCategory");
const ClientDevice = require("@/models/inventory/clientDevice");
require("@/models/inventory/deviceModel");
require("@/models/inventory/vendor");
require("@/models/inventory/deviceType");
require("@/models/routineTask");
const { workDurationMs } = require("@/services/workSummary");

/**
 * Чтение заявок для MCP-инструментов (ticketTools.js). Поля — только
 * разрешённые спекой; htmlDescription (≈51 КБ сырого письма) не читается никогда.
 */

const SEARCH_FIELDS = "num title description source state isClosed categoryId company applicantId createdAt finishedAt closingComment";
const DETAIL_FIELDS = `${SEARCH_FIELDS} processedAt startedAt deadline routineTask relatedClientDeviceId comments responsibles._id responsibles.firstName responsibles.lastName customFields.name customFields.type customFields.value checklist.description checklist.checked`;
const STATS_FIELDS = "categoryId company._id applicantId source createdAt finishedAt isClosed";
const WORK_FIELDS = "description visitRequired startedAt finishedAt finishedBy._id finishedBy.firstName finishedBy.lastName executor._id executor.firstName executor.lastName";
const DEVICE_FIELDS = "deviceModelId deviceTypeId serialNumber inventoryNumber status operatingSystem";
const DEVICE_POPULATE = [
  { path: "deviceModelId", select: "name vendorId deviceTypeId", populate: [{ path: "vendorId", select: "name" }, { path: "deviceTypeId", select: "name" }] },
  { path: "deviceTypeId", select: "name" },
];

exports.loadDirectory = async () => {
  const [companies, users, categories] = await Promise.all([
    Company.find({}).select("alias fullTitle").lean(),
    User.find({}).select("firstName lastName position isEndUser isServiceAccount isCloudTelephony company._id").lean(),
    TicketCategory.find({}).select("title").lean(),
  ]);
  return { companies, users, categories };
};

exports.findTickets = (filter, { sort = { createdAt: -1 }, skip = 0, limit = 50 } = {}) =>
  Ticket.find(filter).select(SEARCH_FIELDS).sort(sort).skip(skip).limit(limit).lean();

exports.countTickets = (filter) => Ticket.countDocuments(filter);

exports.loadTicketDetail = async (num, { works, devices, applicantIsSystem }) => {
  const ticket = await Ticket.findOne({ num }).select(DETAIL_FIELDS).populate({ path: "routineTask", select: "title" }).lean();
  if (!ticket) return null;

  // Комментарии — и по ticketId, и по массиву заявки: письма до 2026-07-08 в
  // массив не попадали, но ticketId у них есть.
  const commentsQuery = Comment.find({ $or: [{ ticketId: ticket._id }, { _id: { $in: ticket.comments || [] } }] })
    .select("content createdBy createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const worksQuery = works
    ? Work.find({ tickets: ticket._id }).select(WORK_FIELDS).sort({ startedAt: 1 }).lean()
    : null;

  const deviceOr = [];
  if (devices && ticket.relatedClientDeviceId) deviceOr.push({ _id: ticket.relatedClientDeviceId });
  if (devices && ticket.applicantId && !applicantIsSystem(ticket.applicantId)) {
    deviceOr.push({ userId: ticket.applicantId, parentDeviceId: null });
  }
  const devicesQuery = devices
    ? deviceOr.length
      ? ClientDevice.find({ deletedAt: null, $or: deviceOr }).select(DEVICE_FIELDS).populate(DEVICE_POPULATE).lean()
      : Promise.resolve([])
    : null;

  const [comments, workDocs, deviceDocs] = await Promise.all([commentsQuery, worksQuery, devicesQuery]);
  return {
    ticket,
    routineTaskTitle: ticket.routineTask?.title || null,
    comments: comments.map((comment) => ({ ...comment, createdBy: comment.createdBy ? String(comment.createdBy) : null })),
    works: workDocs ? workDocs.map((work) => ({ ...work, durationMs: workDurationMs(work) })) : null,
    devices: deviceDocs,
  };
};

exports.loadWorkDescriptions = async (ticketIds) => {
  const works = await Work.find({ tickets: { $in: ticketIds } }).select("description tickets").lean();
  const byTicket = new Map();
  for (const work of works) {
    for (const id of work.tickets || []) {
      const key = String(id);
      if (!byTicket.has(key)) byTicket.set(key, []);
      if (work.description) byTicket.get(key).push(work.description);
    }
  }
  return byTicket;
};

exports.loadStatsRows = (filter) => Ticket.find(filter).select(STATS_FIELDS).lean();
```

`routes/mcp.js` — replace the module import and the router construction:

```js
const Preferences = require("@/models/preferences");
const { resolveTimezone } = require("@/utils/datetime");
const ticketSource = require("@/services/mcp/ticketSource");
const { createTicketTools } = require("@/services/mcp/ticketTools");

// Контекст запроса: модули, пояс организации и системные учётки — одно чтение
// настроек на запрос, инструменты базу настроек не трогают.
const loadContext = async () => {
  const prefs = await Preferences.findOne({})
    .select("modules timezone defaultApplicant._id mikrotik.applicant._id")
    .lean();
  return {
    modules: {
      knowledgeBase: Boolean(prefs?.modules?.knowledgeBase?.isActive),
      timeTracking: Boolean(prefs?.modules?.timeTracking?.isActive),
      inventory: Boolean(prefs?.modules?.inventory?.isActive),
    },
    timezone: resolveTimezone(prefs),
    systemAccounts: {
      unidentifiedId: prefs?.defaultApplicant?._id ? String(prefs.defaultApplicant._id) : null,
      robotIds: prefs?.mikrotik?.applicant?._id ? [String(prefs.mikrotik.applicant._id)] : [],
    },
  };
};

module.exports = buildMcpRouter({
  requireKey: createRequireMcpKey({
    findKeyByHash: (keyHash) => McpKey.findOne({ keyHash }).select("name lastUsedAt scopes").lean(),
    touchKey: (_id) => McpKey.updateOne({ _id }, { $set: { lastUsedAt: new Date() } }),
    log,
  }),
  handle: createMcpRequestHandler({
    tools: {
      knowledge: createKnowledgeTools({ ...knowledgeSource, baseUrl: process.env.ADDRESS, log }),
      tickets: createTicketTools({ source: ticketSource, baseUrl: process.env.ADDRESS, log }),
    },
    loadContext,
    onError: (error) => log("warn", "MCP: запрос отклонён", { error: error.message }),
  }),
});
```

(remove the `knowledgeBaseModuleIsActive` import). In `models/comment.js`, before `module.exports`, add:

```js
// Комментарии заявки для MCP (services/mcp/ticketSource.js) ищутся по ticketId:
// письма до 2026-07-08 не попали в массив заявки.
commentSchema.index({ ticketId: 1, createdAt: 1 });
```

- [ ] **Step 4: Run** — `node --test routes/mcp.test.js` → all pass; then `NODE_ENV=production pnpm test` → all green; `node --check` on `routes/mcp.js` and `services/mcp/ticketSource.js`; `NODE_ENV=production node -e 'require("module-alias/register"); require("./routes/index"); console.log("ok")'` loads.
- [ ] **Step 5: Checkpoint** — Do not commit.

---

### Task 10: Backend documentation

**Files:**
- Create: `docs/mcp.md`
- Modify: `docs/knowledge-base.md`, `docs/deployment.md`, `docs/superpowers/specs/2026-09-17-mcp-tickets-design.md`

- [ ] **Step 1: Write `docs/mcp.md`** (English, no UI; header `_Last updated: …; a snapshot, not a spec — verify against the code._`) with sections:
  1. **Overview** — purpose, audience, the two specs.
  2. **Request path** — mount before `attachSession`, `mcpRouter` (key → limiter → handler), `requireMcpKey` (format, sha256, hourly `lastUsedAt`, `req.mcpKey.scopes`), `loadContext` (modules, timezone, system accounts), tool families and the `403`, SDK v2 stateless legacy path (short SSE per POST, `maxSubscriptions: 0`), identity through `authInfo.extra`.
  3. **Keys and permissions** — `mcpkeys` fields including `scopes`, `normalizeScopes`, API table (list / create with `scopes` / update / delete), audit log lines.
  4. **Knowledge base tools** — move the tool, scope and ranking text from `knowledge-base.md` «Agent access (MCP)» here verbatim.
  5. **Ticket tools** — the four tools with arguments and outputs, open/closed mapping, name resolution, ranking and candidate cap, similarity and "how it was solved", stats (grouping, median, top 50, months in the organisation timezone), comments by `ticketId` + array (index), module-dependent sections.
  6. **Data protection** — the never-selected field list (Global Constraints), `maskText` order and rules, IP addresses kept, known limits (spec).
  7. **Tests and manual check** — test files, curl recipe (`initialize`, `tools/list`, `tools/call search_tickets`).
- [ ] **Step 2:** In `docs/knowledge-base.md` replace the «Agent access (MCP)» body with a 5-line pointer to `docs/mcp.md` (keep the scope rule sentence: approved, no leak flag, moderator-cleared flags served); keep the `McpKey` data-model pointer (now naming `scopes`).
- [ ] **Step 3:** In `docs/deployment.md` «AI agents (MCP)» mention that a key gets «База знаний» and/or «Заявки» and that contacts in tickets are masked; link `docs/mcp.md`.
- [ ] **Step 4:** In the spec set `Status:` to "backend implemented <date>; UI waits for the mockup".
- [ ] **Step 5: Checkpoint** — Do not commit.

---

### Task 11: Live verification of the backend on the dev stack

- [ ] **Step 1: Reload** — nodemon reloads the dev backend on save; confirm with `docker compose logs --tail=20 backend` (no crash) and `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/api/mcp` → `401`.
- [ ] **Step 2: Index** — `docker compose exec -T mongodb sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin hd-dev --eval "printjson(db.comments.getIndexes().map(i => i.key))"'` → contains `{ ticketId: 1, createdAt: 1 }`.
- [ ] **Step 3: Temporary key with both permissions** — `SP` is the session scratchpad directory; the value never goes to the terminal:

```bash
docker compose exec -T -e NODE_ENV=production backend node -e '
require("module-alias/register");
const mongoose = require("mongoose");
const McpKey = require("@/models/mcpKey");
const { issueMcpKey } = require("@/services/mcp/keys");
(async () => {
  await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
  const { value, keyHash, keyTail } = issueMcpKey();
  const key = await McpKey.create({ name: "claude-dev-verify", keyHash, keyTail, scopes: ["knowledge", "tickets"] });
  console.log(JSON.stringify({ id: String(key._id), value }));
  await mongoose.disconnect();
})();
' 2>/dev/null | tail -1 > "$SP/devkey.json"
```
- [ ] **Step 4: Real SDK client, timings and leak scan** — find the largest company and a closed ticket with works first:

```bash
docker compose exec -T mongodb sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin hd-dev --eval "
const top = db.tickets.aggregate([{ \$group: { _id: \"\$company.alias\", n: { \$sum: 1 } } }, { \$sort: { n: -1 } }, { \$limit: 1 }]).toArray()[0];
const w = db.works.findOne({ description: { \$ne: \"\" } }, { tickets: 1 });
const t = db.tickets.findOne({ _id: w.tickets[0] }, { num: 1 });
print(JSON.stringify({ company: top._id, tickets: top.n, ticketWithWorks: t.num }));
"'
```

Then, in the scratchpad client folder with `@modelcontextprotocol/sdk@1.30.0` installed (`pnpm add @modelcontextprotocol/sdk@1.30.0`, sandbox off), save as `tickets-check.mjs` and run `node tickets-check.mjs "$SP/devkey.json" "<company>" <ticketWithWorks>`:

```js
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [keyFile, company, num] = process.argv.slice(2);
const { value } = JSON.parse(readFileSync(keyFile, "utf8"));
const client = new Client({ name: "openclaw-like", version: "2026.9.4" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:8080/api/mcp"), { requestInit: { headers: { Authorization: `Bearer ${value}` } } }));

const PHONE = /\+?\d[\d\s()-]{9,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const call = async (name, args) => {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((part) => part.text).join("\n");
  const leaks = [...(text.match(PHONE) || []), ...(text.match(EMAIL) || [])];
  console.log(`${name} ${JSON.stringify(args)} → ${Date.now() - started} ms, ${text.length} chars, isError=${Boolean(result.isError)}, suspicious=${JSON.stringify(leaks.slice(0, 10))}`);
  console.log("   " + text.split("\n").slice(0, 3).join(" ⏎ ").slice(0, 300));
};

console.log("tools:", (await client.listTools()).tools.map((tool) => tool.name).join(", "));
await call("search_tickets", { query: "принтер", status: "closed", limit: 5 });
await call("search_tickets", { company, status: "closed", limit: 20 });
await call("search_tickets", { query: "не работает", limit: 50 });
await call("get_ticket", { num: Number(num) });
await call("find_similar_tickets", { num: Number(num) });
await call("find_similar_tickets", { num: Number(num), scope: "all", status: "any", limit: 30 });
await call("ticket_stats", { groupBy: "month", from: "2026-01-01" });
await call("ticket_stats", { groupBy: "category", company });
await client.close();
```

Expected: 6 tools; every call under ~2 s; `suspicious` lists only serial-like numbers — inspect each hit; a real phone or e-mail is a masking bug (add the case to `maskText.test.js`, fix, re-run).
- [ ] **Step 5: `htmlDescription` stays out** — pick a telephony ticket (`db.tickets.findOne({ source: "Облачная телефония" }, { num: 1 })`), call `get_ticket` for it and confirm the output has no «Кто звонил».
- [ ] **Step 6: Permission behaviour** — `McpKey.updateOne({ _id }, { $set: { scopes: ["tickets"] } })` → `tools/list` shows 4 ticket tools; knowledge-only + module off is covered by tests.
- [ ] **Step 7: Clean up** — delete the key by `_id` (never `deleteMany`), confirm the next call is `401`, remove the scratchpad key file.
- [ ] **Step 8: Checkpoint** — report timings and the leak-scan result to the owner. Do not commit.

---

### Task 12: Settings mockup (approval gate)

- [ ] **Step 1:** Load the `artifact-design` skill; republish or extend the approved mockup «Доступ ИИ-агентов к базе знаний» (`https://claude.ai/artifact/P3fyY3xqRSMDHem2165Xqe`, source in the first MCP session's scratchpad `kb-agent-keys.html`; if unavailable, rebuild from the same tokens) as «Доступ ИИ-агентов», desktop + phone, light + dark, showing:
  - placement **A «Интеграции»** (proposed: tickets are not the knowledge base, the section is always visible) vs **B** a separate section «ИИ-агенты»;
  - «Создать ключ» dialog with checkboxes «База знаний» (hint: проверенные заметки без найденных секретов) and «Заявки» (hint: заявки с комментариями, работами и техникой; телефоны, почта и пароли скрыты), «Создать» disabled until one is checked;
  - key rows with permission labels and an «Изменить доступ» action + its dialog;
  - the status row (scan warning only when some key has «База знаний»).
- [ ] **Step 2: STOP** — send the link and wait for the owner's explicit approval. No frontend code before it.

---

### Task 13: Frontend — permissions in the keys UI (after approval)

**Files:**
- Modify: `frontend/src/types/mcpKey.ts`, `frontend/src/util/mcp-keys.ts`, `frontend/src/util/mcp-keys.test.js`
- Modify: `frontend/src/components/Preferences/McpKeys.jsx`
- Modify: `frontend/src/components/Preferences/Integrations.jsx` (placement A; for B follow the approved mockup), `frontend/src/components/Preferences/KnowledgeBase.jsx`
- Modify: `docs/ux-ui-guide.md`, `docs/ux-ui-changelog.md`

**Interfaces:**
- Produces: `McpScope = "knowledge" | "tickets"`; `MCP_SCOPE_LABELS`; `agentKeysStatus({ keys, scanForSecrets })` warns about scanning only when there are no keys or some key has `knowledge`.

- [ ] **Step 1: Tests** — in `frontend/src/util/mcp-keys.test.js` give the `key()` fixture a `scopes` parameter (default `["knowledge"]`) and add:

```js
test("tickets-only keys do not need the secrets scanning warning", () => {
  const status = agentKeysStatus({
    keys: [{ ...key("Аналитик", "2026-09-17T09:00:00.000Z"), scopes: ["tickets"] }],
    scanForSecrets: false,
  });

  assert.equal(status.state, "ok");
});
```

- [ ] **Step 2: Run to confirm it fails** — `cd frontend && node --test src/util/mcp-keys.test.js`.
- [ ] **Step 3: Implement util and types**

`types/mcpKey.ts`: `export type McpScope = "knowledge" | "tickets";` and `scopes: McpScope[];` in `McpKeyRow`.

`util/mcp-keys.ts`:

```ts
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  knowledge: "База знаний",
  tickets: "Заявки",
};
```

and in `agentKeysStatus` change the first condition to
`if (!scanForSecrets && (!keys.length || keys.some((key) => key.scopes.includes("knowledge"))))`, with the hint «Агенты с доступом к базе знаний получают все проверенные заметки: пароли и ключи в них никто не ищет. Поиск включается в разделе «База знаний».».

- [ ] **Step 4: Component** — in `McpKeys.jsx` (pixel-follow the approved mockup; the code below fixes behaviour and API):

Imports: add `import { Checkbox } from "@/components/ui/checkbox";`, `RiShieldKeyholeLine` to the `react-icons/ri` import, and `MCP_SCOPE_LABELS` to the `@/util/mcp-keys` import.

Above `McpKeys`, add the shared checkbox group:

```jsx
const SCOPE_HINTS = {
  knowledge: "Проверенные заметки без найденных секретов.",
  tickets: "Заявки с комментариями, работами и техникой; телефоны, почта и пароли скрыты.",
};

// Доступы ключа — одни и те же флажки в «Создать ключ» и «Изменить доступ».
const ScopeChecks = ({ idPrefix, value, onChange }) => (
  <div className="flex flex-col gap-3">
    {Object.entries(MCP_SCOPE_LABELS).map(([scope, label]) => (
      <label key={scope} htmlFor={`${idPrefix}-${scope}`} className="flex cursor-pointer items-start gap-2.5">
        <Checkbox
          id={`${idPrefix}-${scope}`}
          checked={value.includes(scope)}
          onCheckedChange={(checked) =>
            onChange(checked ? [...value, scope] : value.filter((item) => item !== scope))
          }
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block text-sm text-muted-foreground">{SCOPE_HINTS[scope]}</span>
        </span>
      </label>
    ))}
  </div>
);
```

Create flow — new state `const [scopes, setScopes] = useState([]);`, reset it in `openCreate` (`setScopes([])`), send it: `body: { name, scopes }`, render `<Field label="Доступ" required><ScopeChecks idPrefix="mcp-key-create" value={scopes} onChange={setScopes} /></Field>` after the name field, and disable «Создать» with `disabled={creating || !name.trim() || !scopes.length}`.

Change-access flow:

```jsx
const [scopeTarget, setScopeTarget] = useState(null); // { key, scopes }
const [savingScopes, setSavingScopes] = useState(false);

const saveScopes = async () => {
  setSavingScopes(true);
  try {
    const result = await api("/api/preferences/mcp-keys/update", {
      method: "POST",
      body: { _id: scopeTarget.key._id, scopes: scopeTarget.scopes },
    });
    setData((current) => ({
      ...current,
      keys: current.keys.map((key) => (key._id === result.key._id ? result.key : key)),
    }));
    setScopeTarget(null);
    showToast("success", result.message);
  } catch (error) {
    showToast("danger", error.message || "Не удалось изменить доступ");
  } finally {
    setSavingScopes(false);
  }
};
```

In each key row, after the tail chip:

```jsx
<span className="text-xs text-muted-foreground max-md:order-3">
  {key.scopes.map((scope) => MCP_SCOPE_LABELS[scope]).join(" · ")}
</span>
```

and before the delete button:

```jsx
<Button
  variant="ghost"
  size="icon-xs"
  onClick={() => setScopeTarget({ key, scopes: key.scopes })}
  title="Изменить доступ"
  aria-label={`Изменить доступ ключа ${key.name}`}
  className="max-md:order-2"
>
  <RiShieldKeyholeLine />
</Button>
```

and next to the delete `ConfirmDialog`:

```jsx
<Dialog open={Boolean(scopeTarget)} onOpenChange={(open) => !open && !savingScopes && setScopeTarget(null)}>
  <DialogContent className="max-w-md" aria-describedby={undefined}>
    <DialogHeader>
      <DialogTitle>Доступ ключа «{scopeTarget?.key.name}»</DialogTitle>
    </DialogHeader>
    {scopeTarget && (
      <ScopeChecks
        idPrefix="mcp-key-scopes"
        value={scopeTarget.scopes}
        onChange={(next) => setScopeTarget((current) => ({ ...current, scopes: next }))}
      />
    )}
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={() => setScopeTarget(null)} disabled={savingScopes}>
        Отмена
      </Button>
      <Button type="button" onClick={saveScopes} disabled={savingScopes || !scopeTarget?.scopes.length}>
        {savingScopes ? "Сохранение…" : "Сохранить"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Intro hint of «Ключи для ИИ-агентов»: «Агент подключается по MCP и читает то, к чему у ключа есть доступ. Создание, изменение и удаление ключа действуют сразу, без «Сохранить».».
- [ ] **Step 5: Move the block** — remove `<McpKeys …/>` and its import from `KnowledgeBase.jsx`; in `Integrations.jsx` render after the PRO32 list: `<McpKeys scanForSecrets={Boolean(prefs.knowledgeBase?.scanForSecrets)} />` (placement B: follow the approved mockup instead).
- [ ] **Step 6: Checks** — `cd frontend && node --test src/util/mcp-keys.test.js && pnpm exec eslint --max-warnings=0 <changed files> && pnpm typecheck` (baseline: the 3 known errors in `FormWrapper.tsx` / `ApprovalReport.tsx` only) `&& pnpm exec vite build --outDir <scratchpad>/vite-build --emptyOutDir`.
- [ ] **Step 7: UI docs** — `docs/ux-ui-changelog.md` entry for the date (mockup name, placement, rejected variant); `docs/ux-ui-guide.md` only if the mockup introduced a new rule.
- [ ] **Step 8: Checkpoint** — hand the UI to the owner for a live check. Do not commit.

---

### Task 14: Final verification and report

- [ ] **Step 1:** `cd backend && NODE_ENV=production pnpm test` — all green; `node scripts/checkPermissionCoverage.js` — green.
- [ ] **Step 2:** Update the project memory note for this feature (status, decisions, gotchas).
- [ ] **Step 3:** Report to the owner: what is done, test and live results (timings, leak scan), what remains (owner's UI check, OpenClaw permission update for the existing key via «Изменить доступ»). Commit only when the owner asks.
