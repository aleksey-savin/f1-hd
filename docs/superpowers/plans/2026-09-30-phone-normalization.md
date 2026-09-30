# Phone Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every phone number in MongoDB is stored as canonical digits with the country code (`79145550142`), and every screen, e-mail and bot message shows it in one readable format (`+7 (914) 555-01-42`).

**Architecture:** One rule, three copies: `backend/services/phone.js` (parse raw input, canonicalize, validate, format for server texts, search digits), `frontend/src/util/phone.ts` (the same plus the as-you-type field logic) and `tg-service/src/bot/phone.ts` (format only), pinned together by one shared test table. The backend enforces the stored form with a Mongoose setter on every phone path (Mongoose 9 applies setters to writes **and** query filters), sanitizes API input with express-validator, and converts existing data with one idempotent migration. Matching (caller ID, messenger linking) becomes equality on the canonical number with an exactly-one rule.

**Tech Stack:** Node 24 + Express 5 + Mongoose 9.9 + express-validator 7, `node:test`; React 19 + React Router 7 + Tailwind v4 + shadcn primitives + zustand; tg-service on grammy (TypeScript, native type stripping).

**Spec:** `docs/superpowers/specs/2026-09-30-phone-normalization-design.md`. Mockup (source of truth for every pixel, variant A): https://claude.ai/artifact/QgYZ4UgVxpLc5wzj5Zrsk4

## Global Constraints

- **Never `git commit` or `git push`.** The owner batches commits by hand. Every task ends with a checkpoint, not a commit.
- Package manager: **pnpm** only. Backend tests: `cd backend && pnpm test` (the glob covers `services/`, `validations/`, `middleware/`, `routes/`, `helpers/`, `auth/` — **not** `utils/` or `models/`, which is why new backend modules live in `services/`). Backend eslint is broken locally — check backend JS with `node --check <file>`.
- Frontend gates: `cd frontend && pnpm lint && pnpm build`; `pnpm typecheck` has 3 known baseline errors (FormWrapper, ApprovalReport) — only new errors count. Frontend helper tests: `node --test src/<path>.test.js`; a test imports a TS helper with the `.ts` extension (`from "./phone.ts"`), app code imports it as `@/util/phone`.
- tg-service gates: `cd tg-service && pnpm test && pnpm typecheck`.
- Docker commands (dev stack `hd-*-1`, `docker compose run --rm backend …` from the repo root) and `pnpm add/remove` need the Bash sandbox disabled.
- **Canonical form:** digits only, country code included, `""` = no phone. Valid = `7` + 10 digits, or 8–15 digits starting with `1-6`, `8` or `9`.
- **Display (variant A):** `+7 (914) 555-01-42`; other countries `+375291234567` (no grouping); an invalid stored value is shown as stored, without a link or a call button.
- **Wire format:** the web client sends `+<digits>`; the API returns canonical digits. API sanitizers always run the raw parser.
- **Field messages, verbatim:** «Номер неполный: нужно 11 цифр», «Номер слишком короткий», «Укажите номер с кодом города». Placeholder `+7 (___) ___-__-__`. API 400 message: «Проверьте номер телефона: нужен полный номер с кодом страны и города».
- Code comments in Russian, matching the surrounding files; module docs (`docs/phone-numbers.md`) in English; UI decisions go to `docs/ux-ui-changelog.md`.
- UI copy is Russian and matches the mockup; typography only by the guide's roles (no `text-[Npx]`).

## Review Focus

- **A browser tab opened before the deploy** submits `8 914 555 01 42`, `89145550142` or the old mask → stored as `79145550142`, never as a new junk shape. Pinned: Task 3 «a phone from the web or from an old tab is stored as digits».
- **An office line shared by several client users rings in** → the ticket is not pinned to whichever user Mongo returns first; it goes to the default applicant (the company may still match). Pinned: Task 4 «a number shared by two people matches nobody»; Task 16 Step 4 runs the real lookup on a shared number of the dev copy.
- **A record whose stored number has no area code** (2 subdivisions on the prod copy) → the card shows the digits without a call link; the form opens with «Укажите номер с кодом города» already visible and refuses to save until the number is fixed or cleared. Pinned: Task 9 «stored values open in the field as they will be sent back» and «links only for numbers that can be dialled».
- **A number pasted from an e-mail, a website or a messenger** (`Тел.: +7 914 …`, `8 (914) …`, `375 29 123 45 67`) → the field shows `+7 (914) 555-01-42` / `+375291234567`, not a truncated or mis-coded mask. Pinned: Task 9 «paste takes the whole number, in any common shape».
- **Searching by a number typed differently than it is shown** (`8 914`, `+7 (914) 555`, `555-01-42`) → the person, company or ticket is found. Pinned: Task 5 (server search) and Task 9 «search finds a number however it was typed» (list search).

---

## File Structure

Backend (new):
- `backend/services/phone.js` (+ `.test.js`) — the rule: `digitsOf`, `parsePhoneInput`, `toCanonicalPhone`, `isValidPhone`, `formatPhone`, `phoneSearchDigits`. No imports.
- `backend/services/phoneSetters.test.js` — the setter on every model path, without a database.
- `backend/validations/phone.js` (+ `.test.js`) — `phoneBody(path)`, `phoneListBody(path)`, `PHONE_MESSAGE`.
- `backend/services/callerIdentityService.test.js` — extraction and the exactly-one rule.
- `backend/services/personSearch.js` (+ `.test.js`) — `$and` clauses for people search with digits for the phone.
- `backend/services/phoneMigration.js` (+ `.test.js`) — pure planner of the data migration.
- `backend/scripts/normalizePhones.js` — the migration script (dry run / `--apply`).

Backend (modified): `models/user.js`, `models/company.js`, `models/subdivision.js`, `models/inventory/supplier.js`, `models/routineTask.js`, `models/ticket.js`, `models/preferences.js`, `models/channel.js`, `models/channelIdentity.js`; `validations/company.js`, `validations/inventory/supplier.js`, `validations/preferences.js`; `routes/internal/user.js`; `controllers/user.js`, `controllers/conversation.js`, `controllers/channel.js`; `services/callerIdentityService.js`, `services/messaging/identity.js` (+ test), `services/messaging/rules.js` (+ test), `services/messaging/present.test.js`, `services/messaging/channelAlert.test.js`; `middleware/emailHandling.js`, `middleware/notifications.js`; `scripts/migrate.js`; `package.json` + `pnpm-lock.yaml` (drop `phone`).

tg-service (new): `src/bot/phone.ts` (+ `phone.test.ts`); modified: `src/bot/render.ts`.

Frontend (new): `src/util/phone.ts` (+ `phone.test.js`), `src/components/app/PhoneLink.tsx`.

Frontend (modified): `components/app/PhoneInput.tsx` (rewrite); inputs — `Company/Form.jsx`, `User/AccountSettings/Profile.jsx`, `User/UserForm.jsx`, `Company/View/SubdivisionFormDialog.jsx`, `Supplier/FormFields.jsx`, `ClientDevice/InlineCreateDialog.jsx`, `Preferences/Globals.jsx`, `Preferences/SectionForm.jsx`, `Preferences/TelegramChannelDialog.tsx`; display — `User/View.jsx`, `User/Item.jsx`, `User/ContactCard.jsx`, `Company/View.jsx`, `Company/ContactSheet.jsx`, `Company/View/EmployeesSection.jsx`, `Company/View/ResponsiblesSection.jsx`, `Company/View/SubdivisionPreviewSheet.jsx`, `Ticket/View/Sections.jsx`, `Dashboard/MySupport.jsx`, `Supplier/Item.jsx`, `Supplier/View.jsx`, `Auth/AuthShell.tsx`, `layout/Footer.jsx`, `Conversation/ContactBlock.tsx`; helpers — `util/conversation-format.js` (+ test), `util/channel-state.js` (+ test); list search — `store/lists/companies.js`, `store/lists/tickets.js`, `store/lists/suppliers.js`.

Docs: `docs/phone-numbers.md` (new), `docs/ux-ui-guide.md`, `docs/ux-ui-changelog.md`, `docs/messaging.md`, `docs/ai-implementation.md`, `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md`, `docs/superpowers/plans/2026-09-25-omnichannel-p1a-telegram-gateway.md`.

**Order matters on dev:** equality lookups (Task 4) and search by digits (Task 5) only find canonical data, so the dev copy is migrated in Task 7. On prod, `deploy.sh` runs the migration with the app stopped, before the new code starts.

---

### Task 1: The phone rule on the backend

**Files:**
- Create: `backend/services/phone.js`
- Test: `backend/services/phone.test.js`

**Interfaces:**
- Produces: `digitsOf(value) → string`; `parsePhoneInput(raw) → string` (raw human input → canonical, `""` for no number); `toCanonicalPhone(value) → value` (digits-only kept as is, anything else parsed; `null`/`undefined` pass through); `isValidPhone(digits) → boolean` (`""` is not valid — callers allow empty themselves); `formatPhone(value) → string`; `phoneSearchDigits(query) → string[]`.

- [ ] **Step 1: Write the failing test**

`backend/services/phone.test.js`:

```js
// node --test services/phone.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePhoneInput,
  toCanonicalPhone,
  isValidPhone,
  formatPhone,
  phoneSearchDigits,
} = require("./phone");

// Общая таблица с frontend/src/util/phone.test.js и tg-service/src/bot/phone.test.ts:
// [как набрали или лежало в базе, канон, показ]
const CASES = [
  ["+7 (914) 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+79145550142", "79145550142", "+7 (914) 555-01-42"],
  ["8 914 555 01 42", "79145550142", "+7 (914) 555-01-42"],
  ["89145550142", "79145550142", "+7 (914) 555-01-42"],
  ["9145550142", "79145550142", "+7 (914) 555-01-42"],
  ["+ 7 914 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+7 (423) 222-29-99", "74232222999", "+7 (423) 222-29-99"],
  ["8-800-555-35-35", "78005553535", "+7 (800) 555-35-35"],
  ["+7 701 234 56 78", "77012345678", "+7 (701) 234-56-78"],
  ["+375 29 123-45-67", "375291234567", "+375291234567"],
  ["00 49 30 901820", "4930901820", "+4930901820"],
  ["8 10 375 29 123 45 67", "375291234567", "+375291234567"],
  ["+7", "", ""],
  ["8", "", ""],
  ["телефон", "", ""],
  ["", "", ""],
  ["222-29-99", "2222999", "2222999"],
  ["+7 (914) 555-01-4", "7914555014", "7914555014"],
];

test("raw input becomes canonical digits and reads back in one format", () => {
  for (const [raw, canonical, shown] of CASES) {
    assert.equal(parsePhoneInput(raw), canonical, `parse ${raw}`);
    assert.equal(formatPhone(canonical), shown, `format ${canonical}`);
  }
});

test("stored digits are never reinterpreted", () => {
  // Одни цифры — уже канон: немецкий номер не превращается в российский
  assert.equal(toCanonicalPhone("4930901820"), "4930901820");
  assert.equal(toCanonicalPhone("79145550142"), "79145550142");
  assert.equal(toCanonicalPhone(" 79145550142 "), "79145550142");
  assert.equal(toCanonicalPhone("+7 (914) 555-01-42"), "79145550142");
  assert.equal(toCanonicalPhone("+4930901820"), "4930901820");
  assert.equal(toCanonicalPhone(""), "");
  assert.equal(toCanonicalPhone(null), null);
  assert.equal(toCanonicalPhone(undefined), undefined);
});

test("valid means +7 with 10 digits, or 8–15 digits of another country", () => {
  for (const value of ["79145550142", "375291234567", "4930901820", "12025550143"]) {
    assert.equal(isValidPhone(value), true, value);
  }
  for (const value of ["", "7", "7914555014", "791455501420", "2222999", "0123456789"]) {
    assert.equal(isValidPhone(value), false, value);
  }
});

test("formatting tolerates legacy text and empty values", () => {
  assert.equal(formatPhone("+7 914 555-01-42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone(null), "");
  assert.equal(formatPhone(undefined), "");
});

test("a query that looks like a number is searched by its digits", () => {
  assert.deepEqual(phoneSearchDigits("+7 (914) 555"), ["7914555"]);
  assert.deepEqual(phoneSearchDigits("8 914 555 01 42"), ["89145550142", "79145550142"]);
  assert.deepEqual(phoneSearchDigits("555-01-42"), ["5550142"]);
  assert.deepEqual(phoneSearchDigits("914"), ["914"]);
  assert.deepEqual(phoneSearchDigits("91"), []);
  assert.deepEqual(phoneSearchDigits("Соколова"), []);
  assert.deepEqual(phoneSearchDigits("Соколова 914"), []);
  assert.deepEqual(phoneSearchDigits(""), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test services/phone.test.js`
Expected: FAIL — `Cannot find module './phone'`.

- [ ] **Step 3: Write the implementation**

`backend/services/phone.js`:

```js
/**
 * Телефон в базе — только цифры с кодом страны: «79145550142», «375291234567»
 * (E.164 без плюса). Здесь всё, что превращает ввод человека в эту форму и
 * обратно — в «+7 (914) 555-01-42». Копии правила: frontend/src/util/phone.ts
 * (поле ввода, показ, поиск) и tg-service/src/bot/phone.ts (карточка бота);
 * таблица примеров в тестах у всех трёх общая. Устройство: docs/phone-numbers.md.
 */

const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * Сырой ввод человека → канон. Без «+» номер считается российским: ведущая 8 —
 * выход на межгород, ровно 10 цифр — номер без кода страны. «+», «00» и «810»
 * значат, что код страны уже набран. «+7» без номера (след старой маски) и слова
 * вместо цифр дают пустую строку.
 */
const parsePhoneInput = (raw) => {
  const text = String(raw ?? "").trim();
  let digits = digitsOf(text);
  if (!digits) return "";
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  } else if (!international && digits.startsWith("810") && digits.length > 11) {
    digits = digits.slice(3);
    international = true;
  }
  if (!international) {
    if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
  }
  return digits === "7" || digits === "8" ? "" : digits;
};

/**
 * Значение для записи (сеттер Mongoose на всех полях телефона): одни цифры —
 * уже канон и остаются как есть, иначе немецкий «4930901820» при копировании
 * в снимок стал бы «74930901820»; всё с разделителями или плюсом — сырой ввод,
 * его разбирает parsePhoneInput. null и undefined не трогаем.
 */
const toCanonicalPhone = (value) => {
  if (value == null) return value;
  const text = String(value).trim();
  return /^\d*$/.test(text) ? text : parsePhoneInput(text);
};

/** Годный канон: +7 — ровно 11 цифр; другие страны — 8–15, код страны не с 0. */
const isValidPhone = (value) => {
  const digits = String(value ?? "");
  if (digits.startsWith("7")) return /^7\d{10}$/.test(digits);
  return /^[1-9]\d{7,14}$/.test(digits);
};

/**
 * Показ в текстах сервера (письма, заголовки «Диалогов»): «+7 (914) 555-01-42»,
 * другие страны — «+375291234567», негодное — как лежит.
 */
const formatPhone = (value) => {
  const digits = toCanonicalPhone(value ?? "");
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return isValidPhone(digits) ? `+${digits}` : digits;
};

/**
 * Запрос, похожий на номер целиком («+7 (914) 555», «8 914 555 01 42»,
 * «555-01-42»), → цифры для поиска подстрокой по канону; с ведущей 8 без плюса
 * — ещё и вариант с 7. Не номер или меньше трёх цифр — пустой список.
 */
const phoneSearchDigits = (query) => {
  const text = String(query ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(text)) return [];
  const digits = digitsOf(text);
  if (digits.length < 3) return [];
  const variants = [digits];
  if (!text.startsWith("+") && digits[0] === "8") variants.push(`7${digits.slice(1)}`);
  return variants;
};

module.exports = {
  digitsOf,
  parsePhoneInput,
  toCanonicalPhone,
  isValidPhone,
  formatPhone,
  phoneSearchDigits,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test services/phone.test.js && pnpm test`
Expected: PASS (5 new tests; the rest of the suite unchanged).

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 2: Setters on every stored phone path

**Files:**
- Modify: `backend/models/user.js` (field `phone`, ~:31), `backend/models/company.js` (`phones` ~:32, `users[].phone` ~:62, `responsibles[].phone` ~:83, `clientsSideResponsibles[].phone` ~:98), `backend/models/subdivision.js` (~:14), `backend/models/inventory/supplier.js` (~:19), `backend/models/routineTask.js` (~:61), `backend/models/ticket.js` (`applicant.phone` ~:180, `responsibles[].phone` ~:271), `backend/models/preferences.js` (`contacts.tel` ~:156), `backend/models/channel.js` (`account.phone` ~:39), `backend/models/channelIdentity.js` (~:21)
- Test: `backend/services/phoneSetters.test.js`

**Interfaces:**
- Consumes: `toCanonicalPhone` from Task 1.
- Produces: every write and every query filter on these paths holds canonical digits (later tasks query with `{ phone: canonical }` and `{ phones: canonical }`).

- [ ] **Step 1: Write the failing test**

`backend/services/phoneSetters.test.js`:

```js
// node --test services/phoneSetters.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Настоящие модели, без базы: документы собираются в памяти, запросы только
// приводятся к схеме (cast) — ровно то, что Mongoose делает перед отправкой
const User = require("@/models/user");
const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");
const Supplier = require("@/models/inventory/supplier");
const RoutineTask = require("@/models/routineTask");
const { Ticket } = require("@/models/ticket");
const Preferences = require("@/models/preferences");
const Channel = require("@/models/channel");
const ChannelIdentity = require("@/models/channelIdentity");

const RAW = "+7 (914) 555-01-42";
const CANON = "79145550142";

test("every stored phone path keeps canonical digits", () => {
  assert.equal(new User({ phone: RAW }).phone, CANON);
  assert.equal(new Subdivision({ phone: RAW }).phone, CANON);
  assert.equal(new Supplier({ phone: RAW }).phone, CANON);
  assert.equal(new Preferences({ contacts: { tel: RAW } }).contacts.tel, CANON);
  assert.equal(new Channel({ account: { phone: RAW } }).account.phone, CANON);
  assert.equal(new ChannelIdentity({ phone: RAW }).phone, CANON);

  const company = new Company({
    phones: [RAW, "8 (423) 222-29-99"],
    users: [{ phone: RAW }],
    responsibles: [{ phone: RAW }],
    clientsSideResponsibles: [{ phone: RAW }],
  });
  assert.deepEqual([...company.phones], [CANON, "74232222999"]);
  assert.equal(company.users[0].phone, CANON);
  assert.equal(company.responsibles[0].phone, CANON);
  assert.equal(company.clientsSideResponsibles[0].phone, CANON);

  const ticket = new Ticket({ applicant: { phone: RAW }, responsibles: [{ phone: RAW }] });
  assert.equal(ticket.applicant.phone, CANON);
  assert.equal(ticket.responsibles[0].phone, CANON);
  assert.equal(new RoutineTask({ responsibles: [{ phone: RAW }] }).responsibles[0].phone, CANON);
});

test("a pushed company phone is normalized too", () => {
  const company = new Company({ phones: [] });
  company.phones.push(RAW);
  assert.deepEqual([...company.phones], [CANON]);
});

test("stored digits are copied as they are", () => {
  // Немецкий номер в снимке не должен стать «74930901820»
  assert.equal(new Ticket({ responsibles: [{ phone: "4930901820" }] }).responsibles[0].phone, "4930901820");
});

test("query filters are normalized, regular expressions pass through", () => {
  const byPhone = User.find({ phone: RAW });
  byPhone.cast(User);
  assert.deepEqual(byPhone.getFilter(), { phone: CANON });

  const byCompanyPhone = Company.find({ phones: RAW });
  byCompanyPhone.cast(Company);
  assert.deepEqual(byCompanyPhone.getFilter(), { phones: CANON });

  const byPattern = User.find({ phone: /914/ });
  byPattern.cast(User);
  assert.ok(byPattern.getFilter().phone instanceof RegExp);
});

test("updates are normalized before they reach the database", () => {
  // _castUpdate — шаг Mongoose перед отправкой обновления; зовём его напрямую,
  // потому что базы в тесте нет
  const update = User.findOneAndUpdate({}, { $set: { phone: RAW } });
  assert.deepEqual(update._castUpdate(update._update), { $set: { phone: CANON } });

  const account = Channel.updateOne({}, { $set: { account: { phone: RAW } } });
  assert.equal(account._castUpdate(account._update).$set.account.phone, CANON);

  const identity = ChannelIdentity.findOneAndUpdate({}, { $set: { phone: RAW } });
  assert.equal(identity._castUpdate(identity._update).$set.phone, CANON);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test services/phoneSetters.test.js`
Expected: FAIL — e.g. `'+7 (914) 555-01-42' !== '79145550142'`.

- [ ] **Step 3: Add the setter to each model**

Each model requires the rule next to its other requires, then puts `set: toCanonicalPhone` on the path.

`backend/models/user.js` — after `const { WORK_STATUS_CODES } = require("../utils/workStatuses");`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

and the field:

```js
    phone: {
      type: String,
      default: "",
      // Только цифры с кодом страны (services/phone.js): сеттер приводит и
      // записи, и значения в фильтрах запросов
      set: toCanonicalPhone,
    },
```

`backend/models/company.js` — after `const workSchedule = require("./workSchedule");`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

the list:

```js
    // Телефоны — цифрами с кодом страны (services/phone.js), как и в снимках
    // людей ниже
    phones: [
      {
        type: String,
        required: false,
        set: toCanonicalPhone,
      },
    ],
```

and in each of the three snapshot arrays (`users`, `responsibles`, `clientsSideResponsibles`) replace `        phone: String,` with:

```js
        phone: { type: String, set: toCanonicalPhone },
```

`backend/models/subdivision.js` — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

```js
    phone: {
      type: String,
      required: false,
      set: toCanonicalPhone,
    },
```

`backend/models/inventory/supplier.js` — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require("../../services/phone");
```

```js
    phone: { type: String, trim: true, set: toCanonicalPhone },
```

`backend/models/routineTask.js` (4-space indent, single quotes) — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require('../services/phone');
```

and in `responsibles`:

```js
                phone: { type: String, set: toCanonicalPhone },
```

`backend/models/ticket.js` — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

in the legacy `applicant` block replace `      phone: String,` with `      phone: { type: String, set: toCanonicalPhone },` and in `responsibles` replace `        phone: String,` with `        phone: { type: String, set: toCanonicalPhone },`.

`backend/models/preferences.js` — after `const { DEFAULT_OVERTIME_SCHEDULE } = require("../utils/overtimeDefaults");`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

```js
    tel: { type: String, default: "", set: toCanonicalPhone },
```

`backend/models/channel.js` — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

```js
      phone: { type: String, default: "", set: toCanonicalPhone },
```

`backend/models/channelIdentity.js` — after `const Schema = mongoose.Schema;`:

```js
const { toCanonicalPhone } = require("../services/phone");
```

```js
    phone: { type: String, default: "", set: toCanonicalPhone },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && for f in models/user.js models/company.js models/subdivision.js models/inventory/supplier.js models/routineTask.js models/ticket.js models/preferences.js models/channel.js models/channelIdentity.js; do node --check $f || exit 1; done && node --test services/phoneSetters.test.js && pnpm test`
Expected: PASS. Then `grep -n "phone: String" models/company.js models/ticket.js models/routineTask.js` prints nothing. A line «Failed to initialize counter: … buffering timed out» after the results is expected: the Ticket model reaches for its counter on load and there is no database in unit tests (the run just waits ~10 s longer).

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 3: API validation of phone input

**Files:**
- Create: `backend/validations/phone.js`
- Test: `backend/validations/phone.test.js`
- Modify: `backend/validations/company.js` (remove `isPhoneList` ~:18-23; `phones` in `add` ~:36-39 and `update` ~:78-81; `phone` in `addSubdivision` ~:129-133; add to `updateSubdivision` ~:144-152), `backend/validations/inventory/supplier.js`, `backend/validations/preferences.js` (~:35), `backend/routes/internal/user.js` (~:80-97), `backend/controllers/user.js` (~:1829), `backend/controllers/channel.js` (`login`, ~:183-191)

**Interfaces:**
- Consumes: `parsePhoneInput`, `isValidPhone` (Task 1).
- Produces: `phoneBody(path)`, `phoneListBody(path)` — express-validator chains that leave canonical digits in `req.body`; `PHONE_MESSAGE`.

- [ ] **Step 1: Write the failing test**

`backend/validations/phone.test.js`:

```js
// node --test validations/phone.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const { phoneBody, phoneListBody, PHONE_MESSAGE } = require("./phone");

const run = async (chain, body) => {
  const req = { body, params: {}, query: {}, headers: {}, cookies: {} };
  await chain.run(req);
  return { body: req.body, errors: validationResult(req).array().map((error) => error.msg) };
};

test("a phone from the web or from an old tab is stored as digits", async () => {
  for (const sent of ["+79145550142", "+7 (914) 555-01-42", "8 914 555 01 42", "89145550142"]) {
    const { body, errors } = await run(phoneBody("phone"), { phone: sent });
    assert.deepEqual(errors, [], sent);
    assert.equal(body.phone, "79145550142", sent);
  }
});

test("an empty phone clears the field, a missing one is left alone", async () => {
  assert.equal((await run(phoneBody("phone"), { phone: "" })).body.phone, "");
  assert.equal((await run(phoneBody("phone"), { phone: "+7" })).body.phone, "");
  assert.equal("phone" in (await run(phoneBody("phone"), {})).body, false);
});

test("incomplete numbers and numbers without an area code are refused", async () => {
  for (const sent of ["+7 (914) 555-0", "222-29-99", "+37529", "тел 12"]) {
    assert.deepEqual((await run(phoneBody("phone"), { phone: sent })).errors, [PHONE_MESSAGE], sent);
  }
});

test("nested paths work (settings contacts)", async () => {
  const { body, errors } = await run(phoneBody("contacts.tel"), { contacts: { tel: "+7 (423) 200-00-00" } });
  assert.deepEqual(errors, []);
  assert.equal(body.contacts.tel, "74232000000");
});

test("company phones: normalized, emptied rows and repeats dropped", async () => {
  const { body, errors } = await run(phoneListBody("phones"), {
    phones: ["+7 (423) 222-29-99", "", "+7", "8 423 222 29 99", "+375 29 123-45-67"],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.phones, ["74232222999", "375291234567"]);
});

test("company phones: the legacy single string still works, a bad item is refused", async () => {
  assert.deepEqual((await run(phoneListBody("phones"), { phones: "+7 (423) 222-29-99" })).body.phones, ["74232222999"]);
  assert.deepEqual((await run(phoneListBody("phones"), { phones: ["+7 (423) 222-29-99", 42] })).errors, [PHONE_MESSAGE]);
  assert.deepEqual((await run(phoneListBody("phones"), { phones: ["+7 (423) 222-2"] })).errors, [PHONE_MESSAGE]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test validations/phone.test.js`
Expected: FAIL — `Cannot find module './phone'`.

- [ ] **Step 3: Write the validators**

`backend/validations/phone.js`:

```js
const { body } = require("express-validator");

const { parsePhoneInput, isValidPhone } = require("../services/phone");

// Телефоны на входе API: что бы ни прислали (веб шлёт «+цифры», старая вкладка
// после деплоя — маску или «8…»), в req.body остаются цифры с кодом страны
// (services/phone.js). Пустая строка — «телефона нет», это не ошибка.
const PHONE_MESSAGE =
  "Проверьте номер телефона: нужен полный номер с кодом страны и города";

const phoneBody = (path) =>
  body(path)
    .optional({ values: "null" })
    .customSanitizer((value) => parsePhoneInput(value))
    .custom((value) => value === "" || isValidPhone(value))
    .withMessage(PHONE_MESSAGE);

// Телефоны компании: массив (tw-форма) или одна строка (легаси); пустые строки
// и повторы выпадают, нестроковый элемент — ошибка
const phoneListBody = (path) =>
  body(path)
    .optional({ values: "null" })
    .customSanitizer((value) => {
      const list = Array.isArray(value) ? value : [value];
      const parsed = list.map((item) => (typeof item === "string" ? parsePhoneInput(item) : item));
      return [...new Set(parsed.filter((item) => item !== ""))];
    })
    .custom((list) => list.every((item) => typeof item === "string" && isValidPhone(item)))
    .withMessage(PHONE_MESSAGE);

module.exports = { phoneBody, phoneListBody, PHONE_MESSAGE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test validations/phone.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the validators into the routes that accept phones**

`backend/validations/company.js`: add `const { phoneBody, phoneListBody } = require("./phone");` next to the other requires; delete the `isPhoneList` block (comment + function); in `exports.add` and `exports.update` replace

```js
  body("phones")
    .optional()
    .custom(isPhoneList)
    .withMessage("Phones must be a string or an array of strings"),
```

with `  phoneListBody("phones"),`; in `exports.addSubdivision` replace the `body("phone")…withMessage("Subdivision phone must be string")` chain with `  phoneBody("phone"),`; in `exports.updateSubdivision` add `  phoneBody("phone"),` after the `name` rule.

`backend/validations/inventory/supplier.js`: add `const { phoneBody } = require("../phone");` and put `  phoneBody("phone"),` after the `email` rule.

`backend/validations/preferences.js`: add `const { phoneBody } = require("./phone");` and put `  phoneBody("contacts.tel"),` right after `  body("contacts").optional().isObject(),`.

`backend/routes/internal/user.js`: add `const { phoneBody } = require("@/validations/phone");` after the `teamValidation` require; insert `  phoneBody("phone"),` before `  runValidation,` in `/users/add` and `/users/update/:id`; replace the update-account line with:

```js
router.post(
  "/users/update-account",
  isAuth,
  phoneBody("phone"),
  runValidation,
  userController.updateMyAccount,
);
```

`backend/controllers/user.js` (`updateMyAccount`, ~:1829) — the account page must be able to clear the phone:

```js
    // Пустая строка — «телефона нет»; не прислали — не трогаем
    user.phone = phone !== undefined ? phone : user.phone;
```

`backend/controllers/channel.js` — add `const { parsePhoneInput, isValidPhone } = require("@/services/phone");` next to the other service requires (keep the file's require style), and replace `exports.login`:

```js
exports.login = command("login", (req) => {
  const step = req.body?.step;
  if (!["start", "phone", "code", "password"].includes(step)) {
    return new AppError("step: start | phone | code | password", 400);
  }
  let raw = typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (step !== "start" && !raw) return new AppError("Нужно значение для шага входа", 400);
  // Шлюзу номер уходит в E.164 с плюсом, как бы его ни набрали
  if (step === "phone") {
    const digits = parsePhoneInput(raw);
    if (!isValidPhone(digits)) return new AppError("Проверьте номер телефона", 400);
    raw = `+${digits}`;
  }
  return { step, value: raw ? encryptSecret(raw) : null };
});
```

- [ ] **Step 6: Run everything**

Run: `cd backend && for f in validations/company.js validations/inventory/supplier.js validations/preferences.js routes/internal/user.js controllers/user.js controllers/channel.js; do node --check $f || exit 1; done && pnpm test`
Expected: PASS, including the existing `validations/company.test.js` (its masked fixtures are now sanitized, the `42` item still fails with a `phones:` error).

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 4: Caller ID and messenger linking by the canonical number

**Files:**
- Modify: `backend/services/callerIdentityService.js` (lines 1-94 and the exports), `backend/middleware/emailHandling.js` (imports ~:22-28, ~:641, ~:660-665, ~:691-693), `backend/services/messaging/identity.js` (~:54-95), `backend/services/messaging/identity.test.js`, `backend/package.json` + `backend/pnpm-lock.yaml`
- Test: `backend/services/callerIdentityService.test.js`

**Interfaces:**
- Consumes: `parsePhoneInput`, `isValidPhone`, `toCanonicalPhone` (Task 1); canonical data and filters (Task 2).
- Produces (from `callerIdentityService`): `extractCallerPhones(email) → string[]`, `findUsersByPhone(phone) → Promise<lean user[]>` (at most 2; fields `_id company isEndUser isServiceAccount banned banExpires`), `onlyOne(list) → item | null`, `findApplicantByPhone(phone) → Promise<{ applicant, company } | null>`, `findCompanyByPhone(phone) → Promise<Company | null>`, `findByAnyPhone(phones, lookup) → Promise<found | null>`; `buildKnownCaller`, `isCloudTelephonySender` unchanged. Removed: `normalizeRuPhone`, `extractCallerPhone`.

- [ ] **Step 1: Write the failing test**

`backend/services/callerIdentityService.test.js`:

```js
// node --test services/callerIdentityService.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { extractCallerPhones, onlyOne } = require("./callerIdentityService");

test("the «Кто звонил» line goes first, then the subject, then the body", () => {
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил: +7 914 555-01-42\nС кем говорил: Иванов",
    }),
    ["79145550142", "74232222999"],
  );
});

test("landlines are recognised now, not only mobiles", () => {
  assert.deepEqual(extractCallerPhones({ name: "Звонок +7 (812) 123-45-67" }), ["78121234567"]);
  assert.deepEqual(extractCallerPhones({ description: "тел. 8 (423) 222-29-99" }), ["74232222999"]);
});

test("an INN in a signature does not hide the real number", () => {
  assert.deepEqual(
    extractCallerPhones({ description: "ООО «Восток», ИНН 7701234567\nтел. 8 (914) 555-01-42" }),
    ["79145550142"],
  );
});

test("a foreign number counts only when dialled with a plus", () => {
  assert.deepEqual(extractCallerPhones({ description: "WhatsApp +375 29 123-45-67" }), ["375291234567"]);
  assert.deepEqual(extractCallerPhones({ description: "заказ 375291234567" }), []);
});

test("the same number twice is listed once; no numbers — empty list", () => {
  assert.deepEqual(
    extractCallerPhones({ name: "+7 914 555-01-42", description: "Кто звонил: 8 (914) 555-01-42" }),
    ["79145550142"],
  );
  assert.deepEqual(extractCallerPhones({ name: "Не печатает принтер" }), []);
});

test("a number shared by two people matches nobody", () => {
  assert.equal(onlyOne([]), null);
  assert.deepEqual(onlyOne([{ _id: "a" }]), { _id: "a" });
  assert.equal(onlyOne([{ _id: "a" }, { _id: "b" }]), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test services/callerIdentityService.test.js`
Expected: FAIL — `extractCallerPhones is not a function`.

- [ ] **Step 3: Rewrite the phone part of `callerIdentityService.js`**

Replace everything from line 1 through the end of `findCompanyByPhone` (keep `extractEmail`, `escapeRegExp`, `isCloudTelephonySender`, `extractOperatorName`, `buildKnownCaller` as they are) with:

```js
const MongoUser = require("@/models/user");
const MongoCompany = require("@/models/company");
const { isBanned } = require("@/services/authBan");
const { parsePhoneInput, isValidPhone } = require("@/services/phone");

// Любая последовательность, похожая на номер телефона.
const PHONE_IN_TEXT = /\+?\d[\d\s()-]{4,}\d/g;
// Строка вида "Кто звонил: +7 999 123-45-67" из тела письма телефонии.
const KTO_ZVONIL = /кто звонил\s*:?\s*(\+?\d[\d\s()-]{4,}\d)/i;
// Похожий на настоящий российский номер: коды 3xx, 4xx, 8xx, 9xx. Отсекает ИНН,
// счета и прочие десятизначные числа, которыми полна подпись письма.
const PLAUSIBLE_RU = /^7[3489]\d{9}$/;

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");

// Все номера письма по порядку доверия: строка «Кто звонил:» (любой полный
// номер), тема, тело. В теме и теле — только правдоподобный российский или
// набранный с «+»: иначе первым «номером» стал бы ИНН из подписи. Повторы
// выпадают. Номера — цифрами с кодом страны, как в базе (services/phone.js).
const extractCallerPhones = ({ name, description, htmlDescription } = {}) => {
  const bodyText = `${description || ""}\n${stripHtml(htmlDescription)}`;
  const phones = [];
  const add = (digits) => {
    if (!phones.includes(digits)) phones.push(digits);
  };

  const marked = bodyText.match(KTO_ZVONIL);
  if (marked) {
    const digits = parsePhoneInput(marked[1]);
    if (isValidPhone(digits)) add(digits);
  }

  for (const text of [name, bodyText]) {
    if (!text) continue;
    for (const candidate of String(text).match(PHONE_IN_TEXT) || []) {
      const digits = parsePhoneInput(candidate);
      const dialedWithPlus = candidate.trim().startsWith("+");
      if (PLAUSIBLE_RU.test(digits) || (dialedWithPlus && isValidPhone(digits))) {
        add(digits);
      }
    }
  }

  return phones;
};

// Кого можно узнать по номеру: живой человек (не служебная учётка и не аккаунт
// телефонии) из действующей компании; отключённых отсекает isBanned — у
// отключения бывает срок, сырому banned верить нельзя. Двоих достаточно, чтобы
// понять «номер не одного человека». Им же пользуется связывание собеседников
// «Диалогов» (services/messaging/identity.js).
const USER_FIELDS = "_id company isEndUser isServiceAccount banned banExpires";

const findUsersByPhone = async (phone) => {
  if (!phone) return [];
  const candidates = await MongoUser.find({
    phone,
    isServiceAccount: { $ne: true },
    isCloudTelephony: { $ne: true },
    "company.isActive": { $ne: false },
  })
    .select(USER_FIELDS)
    .limit(5)
    .lean();
  return candidates.filter((user) => !isBanned(user)).slice(0, 2);
};

// Совпадение — только единственное: номер на двоих (общая линия офиса, муж и
// жена) не основание выбрать кого-то одного.
const onlyOne = (list) => (list.length === 1 ? list[0] : null);

// Заявитель по номеру и его компания (они связаны через user.company).
const findApplicantByPhone = async (phone) => {
  const match = onlyOne(await findUsersByPhone(phone));
  if (!match) return null;
  const applicant = await MongoUser.findById(match._id);
  if (!applicant) return null;
  const company = applicant.company?._id
    ? await MongoCompany.findById(applicant.company._id)
    : null;
  return { applicant, company };
};

// Компания по одному из её номеров; отключённые не опознаются.
const findCompanyByPhone = async (phone) => {
  if (!phone) return null;
  return onlyOne(
    await MongoCompany.find({ phones: phone, isActive: { $ne: false } }).limit(2),
  );
};

// Первый из номеров письма, который к кому-то привёл.
const findByAnyPhone = async (phones, lookup) => {
  for (const phone of phones) {
    const found = await lookup(phone);
    if (found) return found;
  }
  return null;
};
```

and the exports:

```js
module.exports = {
  extractCallerPhones,
  findUsersByPhone,
  onlyOne,
  findApplicantByPhone,
  findCompanyByPhone,
  findByAnyPhone,
  buildKnownCaller,
  isCloudTelephonySender,
};
```

- [ ] **Step 4: Use every extracted number in the mail pipeline**

`backend/middleware/emailHandling.js` — the import block:

```js
const {
  extractCallerPhones,
  findApplicantByPhone,
  findCompanyByPhone,
  findByAnyPhone,
  buildKnownCaller,
  isCloudTelephonySender,
} = require("../services/callerIdentityService");
```

~:640-641:

```js
        // Номера звонящего: «Кто звонил:», тема, тело — по порядку доверия
        const callerPhones = extractCallerPhones(email);
```

the company branch (~:660-665):

```js
          if (prefs.checkPhoneNumber && callerPhones.length) {
            company =
              (await MongoCompany.findOne({
                emailDomains: { $in: [emailDomain] },
                isActive: { $ne: false },
              })) || (await findByAnyPhone(callerPhones, findCompanyByPhone));
```

the applicant branch (~:691-693):

```js
          if (prefs.checkPhoneNumber && callerPhones.length) {
            // По номеру находим клиента и привязанную к нему компанию
            const identity = await findByAnyPhone(callerPhones, findApplicantByPhone);
```

Run `grep -n "phoneNumber" middleware/emailHandling.js` — expected: nothing.

- [ ] **Step 5: Link messenger identities through the same lookup**

`backend/services/messaging/identity.js` — delete the local `buildPhoneSuffixRegex` (the comment above it and the function) and replace `modelDeps` with:

```js
const modelDeps = () => {
  const ChannelIdentity = require("@/models/channelIdentity");
  const User = require("@/models/user");
  const { findUsersByPhone } = require("@/services/callerIdentityService");
  const { toCanonicalPhone } = require("@/services/phone");
  return {
    findIdentity: (network, externalId) => ChannelIdentity.findOne({ network, externalId }).lean(),
    upsertIdentity: (network, externalId, set) =>
      ChannelIdentity.findOneAndUpdate(
        { network, externalId },
        { $setOnInsert: { network, externalId }, ...(Object.keys(set).length ? { $set: set } : {}) },
        { upsert: true, returnDocument: "after" },
      ).lean(),
    findUserByTelegramId: (id) =>
      User.findOne({ "telegramBot.chatId": String(id), isServiceAccount: { $ne: true } }).select(USER_FIELDS).lean(),
    // Та же выборка, что у опознания звонков (services/callerIdentityService):
    // живой человек из действующей компании, не больше двух кандидатов —
    // linkCandidate связывает, только если он один
    findUsersByPhone,
    // Номер из мессенджера — канон цифрами; Telegram и WhatsApp присылают его
    // без плюса, и повторный разбор испортил бы номер другой страны
    normalizePhone: toCanonicalPhone,
  };
};
```

In the file's header comment, the reference `(`findUsersByPhone`; …)` stays true — no edit needed.

`backend/services/messaging/identity.test.js` — use the real rule instead of the fake:

```js
const { toCanonicalPhone: normalizePhone } = require("../phone");
```

(delete the old `const normalizePhone = (raw) => { … };`), change both `byPhone: { "+79145550142": … }` keys to `"79145550142"` and both `assert.equal(identity.phone, "+79145550142");` to `assert.equal(identity.phone, "79145550142");`, and add:

```js
test("a foreign WhatsApp number is kept, a Telegram number loses its plus", async () => {
  const { deps } = fakeDeps();
  const foreign = await resolveIdentity("whatsapp", { id: "375291234567@s.whatsapp.net", phone: "375291234567" }, deps);
  assert.equal(foreign.phone, "375291234567");
  const telegram = await resolveIdentity("telegram", { id: "555", phone: "+79991234567" }, deps);
  assert.equal(telegram.phone, "79991234567");
});
```

- [ ] **Step 6: Drop the `phone` package**

Run (sandbox disabled — pnpm writes its store): `cd backend && pnpm remove phone`
Then: `grep -rn "normalizeRuPhone\|buildPhoneSuffixRegex\|extractCallerPhone(\|require(\"phone\")" --include='*.js' . | grep -v node_modules` — expected: nothing.

- [ ] **Step 7: Run everything**

Run: `cd backend && node --check services/callerIdentityService.js && node --check middleware/emailHandling.js && node --check services/messaging/identity.js && node --test services/callerIdentityService.test.js services/messaging/identity.test.js && pnpm test`
Expected: PASS.

- [ ] **Step 8: Checkpoint (no commit)**

---

### Task 5: Server search finds a number by its digits

**Files:**
- Create: `backend/services/personSearch.js`
- Test: `backend/services/personSearch.test.js`
- Modify: `backend/controllers/user.js` (delete `escapeRegex` ~:220; search block ~:355-363; require after `financeTracking` ~:74), `backend/controllers/conversation.js` (`candidates` ~:552-566; require after ~:24)

**Interfaces:**
- Consumes: `phoneSearchDigits` (Task 1).
- Produces: `personSearchClauses(query, fields, maxTerms) → object[]` — clauses for `$and`; `[]` for an empty query.

- [ ] **Step 1: Write the failing test**

`backend/services/personSearch.test.js`:

```js
// node --test services/personSearch.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { personSearchClauses } = require("./personSearch");

const FIELDS = ["firstName", "lastName", "email", "phone"];
// «поле:регулярка» каждого условия внутри $or
const sources = (clause) =>
  clause.$or.map((condition) => {
    const [field, pattern] = Object.entries(condition)[0];
    return `${field}:${pattern.source}`;
  });

test("a query that looks like a number searches the phone by digits, once", () => {
  const clauses = personSearchClauses("+7 (914) 555", FIELDS, 6);
  assert.equal(clauses.length, 1);
  assert.deepEqual(sources(clauses[0]), ["phone:7914555"]);
});

test("a leading 8 also tries 7", () => {
  assert.deepEqual(sources(personSearchClauses("8 914 555 01 42", FIELDS, 6)[0]), [
    "phone:89145550142",
    "phone:79145550142",
  ]);
});

test("words go to text fields, their digits to the phone", () => {
  const clauses = personSearchClauses("Соколова 555-01", FIELDS, 6);
  assert.equal(clauses.length, 2);
  assert.deepEqual(sources(clauses[0]), ["firstName:Соколова", "lastName:Соколова", "email:Соколова"]);
  assert.deepEqual(sources(clauses[1]), ["firstName:555-01", "lastName:555-01", "email:555-01", "phone:55501"]);
});

test("the number of words is capped; an empty query gives no conditions", () => {
  assert.equal(personSearchClauses("a b c d e f g h", FIELDS, 6).length, 6);
  assert.deepEqual(personSearchClauses("   ", FIELDS, 6), []);
});

test("without a phone field a number is plain text", () => {
  assert.deepEqual(sources(personSearchClauses("914", ["firstName"], 4)[0]), ["firstName:914"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test services/personSearch.test.js`
Expected: FAIL — `Cannot find module './personSearch'`.

- [ ] **Step 3: Write the implementation**

`backend/services/personSearch.js`:

```js
const { phoneSearchDigits } = require("./phone");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Условия поиска людей для `$and`: каждое слово запроса должно найтись хоть в
 * одном поле. Телефон хранится цифрами (services/phone.js), поэтому с ним
 * сравниваются цифры слова, а запрос, похожий на номер целиком («+7 (914) 555»,
 * «8 914 555 01 42»), ищется по телефону одним куском — иначе «+7» и «(914)»
 * стали бы отдельными словами. Слова экранируются и режутся по длине и числу:
 * «.*» в запросе не должно превращаться в скан.
 */
const personSearchClauses = (query, fields, maxTerms) => {
  const text = String(query ?? "").trim();
  if (!text) return [];

  const searchesPhone = fields.includes("phone");
  const phoneVariants = searchesPhone ? phoneSearchDigits(text.slice(0, 64)) : [];
  if (phoneVariants.length) {
    return [{ $or: phoneVariants.map((digits) => ({ phone: new RegExp(digits) })) }];
  }

  const textFields = fields.filter((field) => field !== "phone");
  return text
    .split(/\s+/)
    .slice(0, maxTerms)
    .map((term) => {
      const pattern = new RegExp(escapeRegex(term.slice(0, 64)), "i");
      const digits = term.replace(/\D/g, "");
      return {
        $or: [
          ...textFields.map((field) => ({ [field]: pattern })),
          ...(searchesPhone && digits.length >= 2 ? [{ phone: new RegExp(digits) }] : []),
        ],
      };
    });
};

module.exports = { personSearchClauses };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test services/personSearch.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Use it in the address book and in «Это он»**

`backend/controllers/user.js`: add after the `financeTracking` require (~:74):

```js
const { personSearchClauses } = require("@/services/personSearch");
```

delete the now unused line `const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");` (~:220, keep the comment block above it), and replace the search block (~:355-363):

```js
    // 8) Поиск: каждое слово должно встретиться хотя бы в одном поле, номер —
    // по цифрам (services/personSearch.js)
    if (typeof q.search === "string" && q.search.trim()) {
      and.push(...personSearchClauses(q.search, USER_SEARCH_FIELDS, 6));
    }
```

`backend/controllers/conversation.js`: add after the `enqueueJob` require (~:24):

```js
const { personSearchClauses } = require("@/services/personSearch");
```

and in `exports.candidates` replace the `terms`/`and` lines with:

```js
    const and = personSearchClauses(req.query.q, CANDIDATE_SEARCH_FIELDS, 4);
    if (!and.length) return res.status(200).json({ items: [] });
```

In the JSDoc above `exports.candidates`, change «каждое слово запроса должно найтись хоть в одном поле» to «каждое слово запроса должно найтись хоть в одном поле, номер — по цифрам». Leave `escapeRegExp` in `conversation.js`: the conversation list search (~:118) still uses it.

- [ ] **Step 6: Run everything**

Run: `cd backend && node --check controllers/user.js && node --check controllers/conversation.js && grep -n "escapeRegex" controllers/user.js; pnpm test`
Expected: `grep` prints nothing; tests PASS.

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 6: Texts the server composes, and the Telegram login step

**Files:**
- Modify: `backend/middleware/notifications.js` (require ~:17; `${prefs.contacts.tel}` at ~:500, ~:755, ~:1257, ~:1470), `backend/services/messaging/rules.js` (`identityName` ~:135-146)
- Test: `backend/services/messaging/rules.test.js` (~:154-160), `backend/services/messaging/present.test.js` (~:79-88), `backend/services/messaging/channelAlert.test.js` (~:54-75)

**Interfaces:**
- Consumes: `formatPhone` (Task 1).
- Produces: `identityName(identity)` returns a formatted phone as its phone fallback (`+7 (914) 207-33-18`), so conversation titles, stored `lastMessage.authorName` and the bell title «Новое сообщение от …» read like the web.

- [ ] **Step 1: Update the tests to canonical fixtures and formatted expectations**

`backend/services/messaging/rules.test.js` — the naming test becomes:

```js
test("an identity is named by its name, then @username, then phone", () => {
  assert.equal(identityName({ firstName: "Марина", lastName: "Соколова" }), "Марина Соколова");
  assert.equal(identityName({ displayName: "Андрей", phone: "79142073318" }), "Андрей");
  assert.equal(identityName({ username: "kostya_it" }), "@kostya_it");
  assert.equal(identityName({ phone: "79142073318", externalId: "x" }), "+7 (914) 207-33-18");
  assert.equal(identityName({ phone: "375291234567" }), "+375291234567");
  assert.equal(identityName(null), "");
});
```

`backend/services/messaging/present.test.js` — in «an unknown direct contact is named by the identity and flagged»:

```js
    { identities: new Map([[ids.ident, { _id: ids.ident, phone: "79142073318" }]]) },
  );
  assert.equal(row.title, "+7 (914) 207-33-18");
```

`backend/services/messaging/channelAlert.test.js` — the fixture stores canonical digits now:

```js
    account: { displayName: "F1Lab Поддержка", phone: "74232000000", username: "f1lab_support" },
```

and next to `assert.equal(rows.includes("200-00-00"), false);` add:

```js
  assert.equal(rows.includes("4232000000"), false);
```

- [ ] **Step 2: Run the tests to verify the naming ones fail**

Run: `cd backend && node --test services/messaging/rules.test.js services/messaging/present.test.js services/messaging/channelAlert.test.js`
Expected: FAIL in rules and present — `'79142073318' !== '+7 (914) 207-33-18'`; channelAlert PASS.

- [ ] **Step 3: Format the phone fallback**

`backend/services/messaging/rules.js` — after the header comment, before `const NETWORKS`:

```js
const { formatPhone } = require("../phone");
```

and in `identityName` replace the line `    identity.phone ||` with:

```js
    // Телефон хранится цифрами — в заголовок идёт в человеческом виде
    formatPhone(identity.phone) ||
```

- [ ] **Step 4: Format the support line in client e-mails**

`backend/middleware/notifications.js` — after `const { htmlToPlainLines } = require("../helpers/htmlToPlainText");`:

```js
const { formatPhone } = require("../services/phone");
```

and replace all four `${prefs.contacts.tel}` with `${formatPhone(prefs.contacts.tel)}`.

Run: `grep -c 'formatPhone(prefs.contacts.tel)' middleware/notifications.js` — expected `4`; `grep -c '\${prefs.contacts.tel}' middleware/notifications.js` — expected `0`.

- [ ] **Step 5: Run everything**

Run: `cd backend && node --check middleware/notifications.js && node --check services/messaging/rules.js && pnpm test`
Expected: PASS.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 7: Migrate the stored data

**Files:**
- Create: `backend/services/phoneMigration.js`, `backend/scripts/normalizePhones.js`
- Test: `backend/services/phoneMigration.test.js`
- Modify: `backend/scripts/migrate.js` (the `MIGRATIONS` array ~:40-44)

**Interfaces:**
- Consumes: `parsePhoneInput`, `isValidPhone` (Task 1).
- Produces: `PHONE_PATHS` (collection specs: `scalar`, `arrays` {arrayPath: field}, `lists`); `migratePhoneValue(raw) → { value, status }` with status `unchanged | normalized | emptied | invalid | split`; `planDocument(spec, doc) → { set, findings: [{ path, status, shape }] }` (extra status `foreign` for a result that does not start with 7); `projectionFor(spec) → object`. Migration id `2026-09-30-normalizePhones`.

- [ ] **Step 1: Write the failing test**

`backend/services/phoneMigration.test.js`:

```js
// node --test services/phoneMigration.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { PHONE_PATHS, migratePhoneValue, planDocument, projectionFor } = require("./phoneMigration");

const specOf = (collection) => PHONE_PATHS.find((item) => item.collection === collection);

test("each stored shape gets its status", () => {
  const cases = [
    ["+7 (914) 555-01-42", "79145550142", "normalized"],
    ["+79145550142", "79145550142", "normalized"],
    ["89999999999", "79999999999", "normalized"],
    ["+7 (4232) 22‒22‒22", "74232222222", "normalized"],
    ["79145550142", "79145550142", "unchanged"],
    ["", "", "unchanged"],
    ["+7", "", "emptied"],
    ["телефон", "", "emptied"],
    // фигурные тире, без кода города — как в двух подразделениях копии прода
    ["222‒29‒99", "2222999", "invalid"],
    ["+7 (914) 555-01-4", "7914555014", "invalid"],
    ["+79991234567, +79991234568", "79991234567", "split"],
  ];
  for (const [raw, value, status] of cases) {
    assert.deepEqual(migratePhoneValue(raw), { value, status }, raw);
  }
  assert.deepEqual(migratePhoneValue(undefined), { value: undefined, status: "unchanged" });
});

test("a company: phones de-duplicated, snapshots written by position", () => {
  const plan = planDocument(specOf("companies"), {
    _id: "c1",
    phones: ["+7 (423) 222-29-99", "+7", "8 423 222 29 99", "74232222998"],
    users: [],
    responsibles: [{ phone: "+7 (914) 555-01-42" }, { phone: "" }, {}],
    clientsSideResponsibles: [{ phone: "79140000000" }],
  });
  assert.deepEqual(plan.set, {
    "responsibles.0.phone": "79145550142",
    phones: ["74232222999", "74232222998"],
  });
  assert.deepEqual(
    plan.findings.map((item) => `${item.path} ${item.status}`),
    ["responsibles.0.phone normalized", "phones.0 normalized", "phones.1 emptied", "phones.2 normalized"],
  );
  // В находках нет номеров — только форма значения
  assert.equal(plan.findings[0].shape, "+9 (999) 999-99-99");
});

test("a number of another country is listed for review", () => {
  const plan = planDocument(specOf("users"), { _id: "u1", phone: "+375 29 123-45-67" });
  assert.deepEqual(plan.set, { phone: "375291234567" });
  assert.deepEqual(plan.findings.map((item) => item.status), ["normalized", "foreign"]);
});

test("a second run changes nothing", () => {
  const spec = specOf("tickets");
  const first = planDocument(spec, {
    applicant: { phone: "8 (914) 555-01-42" },
    responsibles: [{ phone: "+7 (423) 222-29-99" }],
  });
  const migrated = {
    applicant: { phone: first.set["applicant.phone"] },
    responsibles: [{ phone: first.set["responsibles.0.phone"] }],
  };
  assert.deepEqual(planDocument(spec, migrated).set, {});
});

test("only phone paths are read", () => {
  assert.deepEqual(projectionFor(specOf("companies")), {
    "users.phone": 1,
    "responsibles.phone": 1,
    "clientsSideResponsibles.phone": 1,
    phones: 1,
  });
  assert.deepEqual(projectionFor(specOf("preferences")), { "contacts.tel": 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test services/phoneMigration.test.js`
Expected: FAIL — `Cannot find module './phoneMigration'`.

- [ ] **Step 3: Write the planner**

`backend/services/phoneMigration.js`:

```js
/**
 * Приведение сохранённых телефонов к канону (scripts/normalizePhones.js): какие
 * поля обойти и что сделать с каждым значением. Чистые функции — тесты рядом.
 * Номера наружу не выходят: в находках только путь, статус и форма значения
 * («+9 (999) 999-99-99»).
 */
const { parsePhoneInput, isValidPhone } = require("./phone");

// Все хранимые телефоны: поля-строки, поля в массивах снимков людей и список
// номеров компании. Коллекции — по именам моделей Mongoose.
const PHONE_PATHS = [
  { collection: "users", scalar: ["phone"] },
  {
    collection: "companies",
    arrays: { users: "phone", responsibles: "phone", clientsSideResponsibles: "phone" },
    lists: ["phones"],
  },
  { collection: "subdivisions", scalar: ["phone"] },
  { collection: "suppliers", scalar: ["phone"] },
  { collection: "preferences", scalar: ["contacts.tel"] },
  { collection: "tickets", scalar: ["applicant.phone"], arrays: { responsibles: "phone" } },
  { collection: "routinetasks", arrays: { responsibles: "phone" } },
  { collection: "channels", scalar: ["account.phone"] },
  { collection: "channelidentities", scalar: ["phone"] },
];

/**
 * Одно хранимое значение → { value, status }. Всё, что лежит сейчас, — сырой
 * ввод (маска, «8…», «+7» без номера, слово «телефон»), поэтому разбор полный.
 * Два номера одной строкой — первый ("split"); негодное (без кода города,
 * неполное) остаётся цифрами ("invalid") — его правят руками.
 */
const migratePhoneValue = (raw) => {
  if (raw == null) return { value: raw, status: "unchanged" };
  const text = String(raw);
  const parts = text.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  const value = parsePhoneInput(parts[0] ?? "");
  if (parts.length > 1) return { value, status: "split" };
  if (!value) return { value: "", status: text === "" ? "unchanged" : "emptied" };
  if (!isValidPhone(value)) return { value, status: "invalid" };
  return { value, status: value === text ? "unchanged" : "normalized" };
};

const getPath = (doc, path) =>
  path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), doc);

const shapeOf = (value) => String(value).replace(/\d/g, "9");

/** Что записать в документ ($set по точным путям) и что о нём рассказать. */
const planDocument = (spec, doc) => {
  const set = {};
  const findings = [];
  const note = (path, raw, { value, status }) => {
    if (status !== "unchanged") findings.push({ path, status, shape: shapeOf(raw) });
    // Номер другой страны — в список на просмотр: повторный прогон прочёл бы
    // такой номер из 10 цифр или с ведущей 8 как российский
    if (value && !value.startsWith("7")) findings.push({ path, status: "foreign", shape: shapeOf(raw) });
  };
  const visit = (path, raw) => {
    if (raw == null) return;
    const result = migratePhoneValue(raw);
    note(path, raw, result);
    if (result.value !== raw) set[path] = result.value;
  };

  for (const path of spec.scalar || []) visit(path, getPath(doc, path));
  for (const [arrayPath, field] of Object.entries(spec.arrays || {})) {
    (getPath(doc, arrayPath) || []).forEach((item, index) =>
      visit(`${arrayPath}.${index}.${field}`, item?.[field]),
    );
  }
  for (const path of spec.lists || []) {
    const list = getPath(doc, path);
    if (!Array.isArray(list)) continue;
    const next = [];
    list.forEach((raw, index) => {
      const result = migratePhoneValue(raw);
      note(`${path}.${index}`, raw, result);
      if (result.value && !next.includes(result.value)) next.push(result.value);
    });
    const same = next.length === list.length && next.every((value, index) => value === list[index]);
    if (!same) set[path] = next;
  }

  return { set, findings };
};

/** Проекция чтения: только поля телефонов (у снимков — с позициями в массиве). */
const projectionFor = (spec) =>
  Object.fromEntries([
    ...(spec.scalar || []).map((path) => [path, 1]),
    ...Object.entries(spec.arrays || {}).map(([arrayPath, field]) => [`${arrayPath}.${field}`, 1]),
    ...(spec.lists || []).map((path) => [path, 1]),
  ]);

module.exports = { PHONE_PATHS, migratePhoneValue, planDocument, projectionFor };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test services/phoneMigration.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the script and register it**

`backend/scripts/normalizePhones.js`:

```js
// Разовое приведение сохранённых телефонов к канону «только цифры с кодом
// страны», 2026-09-30 (спека docs/superpowers/specs/2026-09-30-phone-normalization-design.md).
//
// Обходит все поля телефонов, включая снимки людей в компаниях, заявках и
// регламентах (services/phoneMigration.js). Номера в отчёт не попадают — только
// _id, путь и форма значения («+9 (999) 999-99-99»). Запускать при остановленном
// приложении: deploy.sh так и делает, когда есть ожидающие миграции.
//
// Для +7 идемпотентен: повторный прогон ничего не меняет. Номер другой страны из
// 10 цифр или с ведущей 8 повторный прогон прочёл бы как российский — такие
// значения отчёт перечисляет как «foreign» (в копии прода 2026-09-30 их нет).
//
// Запуск внутри контейнера бэкенда:
//   node scripts/normalizePhones.js            # показать
//   node scripts/normalizePhones.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { PHONE_PATHS, planDocument, projectionFor } = require("@/services/phoneMigration");

const BATCH = 1000;
// Что перечислять поимённо: это правят руками или проверяют глазами
const LISTED = new Set(["invalid", "split", "foreign"]);

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const totals = new Map();
  const listed = [];
  let documents = 0;

  for (const spec of PHONE_PATHS) {
    const collection = db.collection(spec.collection);
    let ops = [];
    const flush = async () => {
      if (apply && ops.length) await collection.bulkWrite(ops, { ordered: false });
      ops = [];
    };

    for await (const doc of collection.find({}, { projection: projectionFor(spec) })) {
      const { set, findings } = planDocument(spec, doc);
      for (const finding of findings) {
        // «responsibles.3.phone» → «responsibles[].phone»: итог по полю, не по позиции
        const field = finding.path.replace(/\.\d+(?=\.|$)/g, "[]");
        const key = `${spec.collection}.${field} ${finding.status}`;
        totals.set(key, (totals.get(key) || 0) + 1);
        if (LISTED.has(finding.status)) {
          listed.push(`  ${finding.status.padEnd(7)} ${spec.collection} ${doc._id} ${finding.path} «${finding.shape}»`);
        }
      }
      if (Object.keys(set).length) {
        documents += 1;
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
        if (ops.length >= BATCH) await flush();
      }
    }
    await flush();
  }

  console.log("Поле и что с ним будет:");
  for (const [key, count] of [...totals].sort()) {
    console.log(`  ${String(count).padStart(6)}  ${key}`);
  }
  if (listed.length) {
    console.log("\nПоимённо (invalid — править руками, split — взят первый номер, foreign — проверить):");
    for (const line of listed) console.log(line);
  }
  console.log(
    apply
      ? `\nЗаписано документов: ${documents}.`
      : `\nПоказ без записи: изменятся документы — ${documents}. Повторите с --apply.`,
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`backend/scripts/migrate.js` — append to `MIGRATIONS` (never reorder):

```js
  // Телефоны — только цифрами с кодом страны; см. normalizePhones.js
  { id: "2026-09-30-normalizePhones", script: "normalizePhones.js", apply: true },
```

Run: `cd backend && node --check scripts/normalizePhones.js && node --check scripts/migrate.js && pnpm test`
Expected: PASS.

- [ ] **Step 6: Dry run on the dev copy**

Run from the repo root (sandbox disabled): `docker compose run --rm backend node scripts/normalizePhones.js`
Expected, against the 2026-09-30 audit of the dev copy (synced from prod 2026-09-03):
- `users.phone`: ≈ 651 normalized, 7 emptied, 2 invalid.
- `companies.phones[]`: 24 normalized, 9 emptied.
- `subdivisions.phone`: 2 invalid, «999‒99‒99».
- Legacy copies of `tickets.applicant.phone`: about 240 emptied (`телефон`, bare `+7`), 5 split, about 5 invalid.
- **No `foreign` lines.**

If a `foreign` line appears, stop and report it to the owner before Step 7.

- [ ] **Step 7: Apply through the runner and prove idempotency**

Run (repo root, sandbox disabled):
`docker compose run --rm backend node scripts/migrate.js up` — expected: runs `normalizePhones.js --apply`, prints «Записано документов: N», records `2026-09-30-normalizePhones`.
Then `docker compose run --rm backend node scripts/normalizePhones.js` — expected: «изменятся документы — 0» (only the invalid/split lists remain, since they stay as digits).
Then `docker compose run --rm backend node scripts/migrate.js status` — expected: `✓ 2026-09-30-normalizePhones`.

- [ ] **Step 8: Checkpoint (no commit)** — report the invalid list (ids and shapes) to the owner: these are fixed by hand after the prod deploy.

---

### Task 8: The Telegram bot shows phones in the same format

**Files:**
- Create: `tg-service/src/bot/phone.ts`
- Test: `tg-service/src/bot/phone.test.ts`
- Modify: `tg-service/src/bot/render.ts` (imports ~:1-3; ~:172)

**Interfaces:**
- Produces: `formatPhone(value: string | null | undefined): string`.

- [ ] **Step 1: Write the failing test**

`tg-service/src/bot/phone.test.ts`:

```ts
// node --test src/bot/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPhone } from "./phone.ts";

// Общая таблица с backend/services/phone.test.js и frontend/src/util/phone.test.js:
// [как набрали или лежало в базе, канон, показ]
const CASES: [string, string, string][] = [
  ["+7 (914) 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+79145550142", "79145550142", "+7 (914) 555-01-42"],
  ["8 914 555 01 42", "79145550142", "+7 (914) 555-01-42"],
  ["89145550142", "79145550142", "+7 (914) 555-01-42"],
  ["9145550142", "79145550142", "+7 (914) 555-01-42"],
  ["+ 7 914 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+7 (423) 222-29-99", "74232222999", "+7 (423) 222-29-99"],
  ["8-800-555-35-35", "78005553535", "+7 (800) 555-35-35"],
  ["+7 701 234 56 78", "77012345678", "+7 (701) 234-56-78"],
  ["+375 29 123-45-67", "375291234567", "+375291234567"],
  ["00 49 30 901820", "4930901820", "+4930901820"],
  ["8 10 375 29 123 45 67", "375291234567", "+375291234567"],
  ["+7", "", ""],
  ["8", "", ""],
  ["телефон", "", ""],
  ["", "", ""],
  ["222-29-99", "2222999", "2222999"],
  ["+7 (914) 555-01-4", "7914555014", "7914555014"],
];

test("the bot shows a stored number the way the web does", () => {
  for (const [, canonical, shown] of CASES) {
    assert.equal(formatPhone(canonical), shown, canonical);
  }
});

test("a legacy value with a mask still reads right; nothing gives empty", () => {
  assert.equal(formatPhone("+7 (914) 555-01-42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone("8 914 555 01 42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone(undefined), "");
  assert.equal(formatPhone(null), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tg-service && node --test src/bot/phone.test.ts`
Expected: FAIL — `Cannot find module …/phone.ts`.

- [ ] **Step 3: Write the formatter**

`tg-service/src/bot/phone.ts`:

```ts
/**
 * Телефон приходит из бэкенда каноном — цифрами с кодом страны
 * («79145550142»). Показ — по правилу бэкенда (backend/services/phone.js) и веба
 * (frontend/src/util/phone.ts), таблица примеров в тестах общая:
 * «+7 (914) 555-01-42», номер другой страны — «+375291234567», негодный — как
 * лежит.
 */

const digitsOf = (value: string): string => value.replace(/\D/g, "");

// Разбор сырого текста — на случай значения со старой маской; из бэкенда
// приходит уже канон
const parsePhoneInput = (raw: string): string => {
  const text = raw.trim();
  let digits = digitsOf(text);
  if (!digits) return "";
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  } else if (!international && digits.startsWith("810") && digits.length > 11) {
    digits = digits.slice(3);
    international = true;
  }
  if (!international) {
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
  }
  return digits === "7" || digits === "8" ? "" : digits;
};

const isValidPhone = (digits: string): boolean =>
  digits.startsWith("7") ? /^7\d{10}$/.test(digits) : /^[1-9]\d{7,14}$/.test(digits);

export const formatPhone = (value: string | null | undefined): string => {
  const text = String(value ?? "").trim();
  const digits = /^\d*$/.test(text) ? text : parsePhoneInput(text);
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return isValidPhone(digits) ? `+${digits}` : digits;
};
```

- [ ] **Step 4: Use it on the ticket card**

`tg-service/src/bot/render.ts` — after `import { plainText } from "./text.ts";`:

```ts
import { formatPhone } from "./phone.ts";
```

and ~:172:

```ts
      if (applicant.phone) lines.push(`Телефон: ${escapeHtml(formatPhone(applicant.phone))}`);
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd tg-service && pnpm test && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Checkpoint (no commit)** — the tg-service image must be rebuilt in the same deploy as the backend.

---

### Task 9: The phone rule on the frontend

**Files:**
- Create: `frontend/src/util/phone.ts`
- Test: `frontend/src/util/phone.test.js`

**Interfaces:**
- Produces (all from `@/util/phone`; tests import `./phone.ts`):
  - `digitsOf(value: unknown): string`, `parsePhoneInput(raw: unknown): string`, `toCanonicalPhone(value: unknown): string` (`""` for null/undefined), `isValidPhone(digits: string): boolean`.
  - `formatPhone(value: unknown): string`, `phoneHref(value: unknown): string | undefined`.
  - `type PhoneTyped = { text: string; wire: string }`, `type PhoneEdit = PhoneTyped & { caret: number }`.
  - `typePhoneInput(raw: string): PhoneTyped`, `pastePhoneInput(pasted: string): PhoneTyped`, `editPhoneInput(previous: string, raw: string, caret: number, inputType?: string): PhoneEdit`, `caretAfterDigits(text: string, count: number): number`.
  - `phoneInputText(value: unknown): string`, `phoneWireValue(value: unknown): string`, `phoneInputError(wire: string): string | null`.
  - `phoneSearchDigits(query: string): string[]`, `phoneMatches(query: string, phones: unknown[]): boolean`.

- [ ] **Step 1: Write the failing test**

`frontend/src/util/phone.test.js`:

```js
// node --test src/util/phone.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  editPhoneInput,
  formatPhone,
  parsePhoneInput,
  pastePhoneInput,
  phoneHref,
  phoneInputError,
  phoneInputText,
  phoneMatches,
  phoneWireValue,
  toCanonicalPhone,
  typePhoneInput,
} from "./phone.ts";

// Общая таблица с backend/services/phone.test.js и tg-service/src/bot/phone.test.ts:
// [как набрали или лежало в базе, канон, показ]
const CASES = [
  ["+7 (914) 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+79145550142", "79145550142", "+7 (914) 555-01-42"],
  ["8 914 555 01 42", "79145550142", "+7 (914) 555-01-42"],
  ["89145550142", "79145550142", "+7 (914) 555-01-42"],
  ["9145550142", "79145550142", "+7 (914) 555-01-42"],
  ["+ 7 914 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+7 (423) 222-29-99", "74232222999", "+7 (423) 222-29-99"],
  ["8-800-555-35-35", "78005553535", "+7 (800) 555-35-35"],
  ["+7 701 234 56 78", "77012345678", "+7 (701) 234-56-78"],
  ["+375 29 123-45-67", "375291234567", "+375291234567"],
  ["00 49 30 901820", "4930901820", "+4930901820"],
  ["8 10 375 29 123 45 67", "375291234567", "+375291234567"],
  ["+7", "", ""],
  ["8", "", ""],
  ["телефон", "", ""],
  ["", "", ""],
  ["222-29-99", "2222999", "2222999"],
  ["+7 (914) 555-01-4", "7914555014", "7914555014"],
];

test("one format with the backend and the bot", () => {
  for (const [raw, canonical, shown] of CASES) {
    assert.equal(parsePhoneInput(raw), canonical, `parse ${raw}`);
    assert.equal(formatPhone(canonical), shown, `format ${canonical}`);
  }
  assert.equal(toCanonicalPhone("4930901820"), "4930901820");
  assert.equal(toCanonicalPhone(undefined), "");
});

test("links only for numbers that can be dialled", () => {
  assert.equal(phoneHref("79145550142"), "tel:+79145550142");
  assert.equal(phoneHref("375291234567"), "tel:+375291234567");
  assert.equal(phoneHref("2222999"), undefined);
  assert.equal(phoneHref(""), undefined);
});

test("typing without a plus is Russian, with a plus — as dialled", () => {
  assert.deepEqual(typePhoneInput("9"), { text: "+7 (9", wire: "+79" });
  assert.deepEqual(typePhoneInput("8"), { text: "+7", wire: "" });
  assert.deepEqual(typePhoneInput("+7 (914) 55"), { text: "+7 (914) 55", wire: "+791455" });
  assert.deepEqual(typePhoneInput("+7 (914) 555-01-420"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(typePhoneInput("+375291234567"), { text: "+375291234567", wire: "+375291234567" });
  assert.deepEqual(typePhoneInput("+"), { text: "+", wire: "" });
  assert.deepEqual(typePhoneInput(""), { text: "", wire: "" });
});

test("paste takes the whole number, in any common shape", () => {
  assert.deepEqual(pastePhoneInput("8 (914) 555-01-42"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(pastePhoneInput("Тел.: +7 914 555-01-42"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(pastePhoneInput("375 29 123 45 67"), { text: "+375291234567", wire: "+375291234567" });
  assert.deepEqual(pastePhoneInput("222-29-99"), { text: "2222999", wire: "2222999" });
  assert.deepEqual(pastePhoneInput("телефон"), { text: "", wire: "" });
});

test("the caret stays after the same digit", () => {
  // Первая цифра в пустое поле: перед ней встала 7
  assert.deepEqual(editPhoneInput("", "9", 1), { text: "+7 (9", wire: "+79", caret: 5 });
  // Цифра, дописанная в середину
  assert.deepEqual(editPhoneInput("+7 (914) 555", "+7 (9140) 555", 8), {
    text: "+7 (914) 055-5",
    wire: "+79140555",
    caret: 10,
  });
  // Стёрли «)» — стирается цифра перед ней
  assert.deepEqual(editPhoneInput("+7 (914) 5", "+7 (914 5", 7, "deleteContentBackward"), {
    text: "+7 (915",
    wire: "+7915",
    caret: 6,
  });
});

test("errors: incomplete, too short, no area code", () => {
  assert.equal(phoneInputError(""), null);
  assert.equal(phoneInputError("+79145550142"), null);
  assert.equal(phoneInputError("+7914555014"), "Номер неполный: нужно 11 цифр");
  assert.equal(phoneInputError("+37529"), "Номер слишком короткий");
  assert.equal(phoneInputError("+375291234567"), null);
  assert.equal(phoneInputError("2222999"), "Укажите номер с кодом города");
});

test("stored values open in the field as they will be sent back", () => {
  assert.equal(phoneInputText("79145550142"), "+7 (914) 555-01-42");
  assert.equal(phoneWireValue("79145550142"), "+79145550142");
  assert.equal(phoneInputText("4930901820"), "+4930901820");
  assert.equal(phoneWireValue("4930901820"), "+4930901820");
  // Из старых данных, без кода города: как лежит — и сразу с ошибкой
  assert.equal(phoneInputText("2222999"), "2222999");
  assert.equal(phoneWireValue("2222999"), "2222999");
  // Значение формы («+цифры») открывается так же
  assert.equal(phoneInputText("+79145550142"), "+7 (914) 555-01-42");
  assert.equal(phoneWireValue(""), "");
  assert.equal(phoneWireValue("+7"), "");
});

test("search finds a number however it was typed", () => {
  const phones = ["79145550142", "74232222999"];
  assert.equal(phoneMatches("914 555", phones), true);
  assert.equal(phoneMatches("+7 (914)", phones), true);
  assert.equal(phoneMatches("8 914", phones), true);
  assert.equal(phoneMatches("222-29-99", phones), true);
  assert.equal(phoneMatches("Соколова", phones), false);
  assert.equal(phoneMatches("91", phones), false);
  assert.equal(phoneMatches("914", [undefined, ""]), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node --test src/util/phone.test.js`
Expected: FAIL — `Cannot find module …/src/util/phone.ts`.

- [ ] **Step 3: Write the implementation**

`frontend/src/util/phone.ts`:

```ts
/**
 * Телефоны на экране и в поле ввода. В базе телефон — только цифры с кодом
 * страны («79145550142», «375291234567»); здесь — показ («+7 (914) 555-01-42»),
 * ссылка «позвонить», разбор набранного и вставленного, поиск по цифрам.
 * Копии правила: backend/services/phone.js (запись, письма) и
 * tg-service/src/bot/phone.ts (бот); таблица примеров в тестах у всех трёх
 * общая. Тесты рядом: `node --test src/util/phone.test.js`.
 */

export const digitsOf = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

/** Сырой ввод → цифры с кодом страны; правило то же, что у бэкенда. */
export const parsePhoneInput = (raw: unknown): string => {
  const text = String(raw ?? "").trim();
  let digits = digitsOf(text);
  if (!digits) return "";
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  } else if (!international && digits.startsWith("810") && digits.length > 11) {
    digits = digits.slice(3);
    international = true;
  }
  if (!international) {
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
  }
  return digits === "7" || digits === "8" ? "" : digits;
};

/** Значение из базы (одни цифры) — как есть; с разделителями — разбором. */
export const toCanonicalPhone = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return /^\d*$/.test(text) ? text : parsePhoneInput(text);
};

/** Годный номер: +7 и 10 цифр или 8–15 цифр другой страны. */
export const isValidPhone = (digits: string): boolean =>
  digits.startsWith("7") ? /^7\d{10}$/.test(digits) : /^[1-9]\d{7,14}$/.test(digits);

// «+7 (914) 555-01-42» по мере набора: digits начинаются с 7, их от 1 до 11
const maskRu = (digits: string): string => {
  const rest = digits.slice(1);
  if (!rest) return "+7";
  let text = `+7 (${rest.slice(0, 3)}`;
  if (rest.length > 3) text += `) ${rest.slice(3, 6)}`;
  if (rest.length > 6) text += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) text += `-${rest.slice(8, 10)}`;
  return text;
};

/** Показ: «+7 (914) 555-01-42», другая страна — «+375291234567», негодное — как есть. */
export const formatPhone = (value: unknown): string => {
  const digits = toCanonicalPhone(value);
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) return maskRu(digits);
  return isValidPhone(digits) ? `+${digits}` : digits;
};

/** Ссылка «позвонить»; у номера, который не набрать, её нет. */
export const phoneHref = (value: unknown): string | undefined => {
  const digits = toCanonicalPhone(value);
  return digits && isValidPhone(digits) ? `tel:+${digits}` : undefined;
};

export type PhoneTyped = { text: string; wire: string };
export type PhoneEdit = PhoneTyped & { caret: number };

/**
 * Поле по мере набора: текст в поле и значение формы («+цифры»). Без плюса номер
 * российский — 8 и 7 впереди значат межгород и код страны, любая другая цифра —
 * начало номера без кода; после «+» — как набрали, до 15 цифр.
 */
export const typePhoneInput = (raw: string): PhoneTyped => {
  const international = raw.trimStart().startsWith("+");
  let digits = digitsOf(raw);
  if (!international) {
    if (!digits) return { text: "", wire: "" };
    digits = digits.startsWith("7") || digits.startsWith("8") ? `7${digits.slice(1)}` : `7${digits}`;
  }
  if (!digits) return { text: "+", wire: "" };
  if (digits.startsWith("7")) {
    digits = digits.slice(0, 11);
    // Один код страны — ещё не номер: форма получает пусто
    return { text: maskRu(digits), wire: digits.length > 1 ? `+${digits}` : "" };
  }
  digits = digits.slice(0, 15);
  return { text: `+${digits}`, wire: `+${digits}` };
};

/**
 * Вставка разбирается целиком, как у бэкенда: 12+ цифр без плюса — номер другой
 * страны. Номер без кода остаётся цифрами без плюса — поле скажет «Укажите
 * номер с кодом города».
 */
export const pastePhoneInput = (pasted: string): PhoneTyped => {
  const digits = parsePhoneInput(pasted);
  if (!digits) return { text: "", wire: "" };
  if (isValidPhone(digits) || pasted.trim().startsWith("+")) {
    return typePhoneInput(`+${digits}`);
  }
  return { text: digits, wire: digits };
};

/** Позиция в тексте сразу после count-й цифры. */
export const caretAfterDigits = (text: string, count: number): number => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/\d/.test(text.charAt(index))) continue;
    seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
};

/**
 * Правка в поле: новый текст, значение формы и место каретки — после той же
 * цифры, что до переформатирования. Стёрли разделитель («)», «-», пробел) —
 * цифр столько же, поэтому стирается цифра перед кареткой, как ждёт человек.
 */
export const editPhoneInput = (
  previous: string,
  raw: string,
  caret: number,
  inputType = "",
): PhoneEdit => {
  let source = raw;
  let digitsBefore = digitsOf(raw.slice(0, caret)).length;
  if (
    inputType === "deleteContentBackward" &&
    digitsOf(raw) === digitsOf(previous) &&
    digitsBefore > 0
  ) {
    const digits = digitsOf(raw);
    const plus = raw.trimStart().startsWith("+") ? "+" : "";
    source = `${plus}${digits.slice(0, digitsBefore - 1)}${digits.slice(digitsBefore)}`;
    digitsBefore -= 1;
  }
  const next = typePhoneInput(source);
  // Без плюса перед номером встаёт 7 — каретка сдвигается на эту цифру
  const first = digitsOf(source).charAt(0);
  if (!source.trimStart().startsWith("+") && first && first !== "7" && first !== "8") {
    digitsBefore += 1;
  }
  return { ...next, caret: caretAfterDigits(next.text, digitsBefore) };
};

/** Текст поля для значения из базы или формы: канон, «+цифры» или старые цифры. */
export const phoneInputText = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("+")) return typePhoneInput(text).text;
  const digits = toCanonicalPhone(text);
  // Негодное из старых данных (без кода города) показываем как лежит
  return isValidPhone(digits) ? typePhoneInput(`+${digits}`).text : digits;
};

/** Значение формы для того же: «+цифры»; старые цифры без кода — как лежат. */
export const phoneWireValue = (value: unknown): string => {
  const text = phoneInputText(value);
  if (!text.startsWith("+")) return text;
  const digits = digitsOf(text);
  return digits.length > 1 ? `+${digits}` : "";
};

/** Ошибка под полем для значения формы; пустое — не ошибка. */
export const phoneInputError = (wire: string): string | null => {
  if (!wire) return null;
  if (!wire.startsWith("+")) return "Укажите номер с кодом города";
  const digits = digitsOf(wire);
  if (digits.startsWith("7")) {
    return digits.length === 11 ? null : "Номер неполный: нужно 11 цифр";
  }
  return digits.length >= 8 ? null : "Номер слишком короткий";
};

/**
 * Похож ли запрос на номер (цифры, пробелы, «+()-.», хотя бы три цифры) и какие
 * цифры искать: с ведущей 8 без плюса — ещё и вариант с 7.
 */
export const phoneSearchDigits = (query: string): string[] => {
  const text = String(query ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(text)) return [];
  const digits = digitsOf(text);
  if (digits.length < 3) return [];
  const variants = [digits];
  if (!text.startsWith("+") && digits.startsWith("8")) variants.push(`7${digits.slice(1)}`);
  return variants;
};

/** Нашёлся ли номер из запроса среди телефонов записи (по цифрам, подстрокой). */
export const phoneMatches = (query: string, phones: unknown[]): boolean => {
  const variants = phoneSearchDigits(query);
  if (!variants.length) return false;
  return phones.some((phone) => {
    const digits = toCanonicalPhone(phone);
    return Boolean(digits) && variants.some((variant) => digits.includes(variant));
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node --test src/util/phone.test.js && pnpm lint`
Expected: PASS (8 tests); lint clean.

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 10: The phone field, and the two forms that already use it

**Files:**
- Modify (rewrite): `frontend/src/components/app/PhoneInput.tsx`
- Modify: `frontend/src/components/Company/Form.jsx` (imports ~:14; `phones` state ~:102-113; `stepValid`/`stepError` ~:171-181; `handleSubmit` ~:208-222; payload ~:229; rows ~:371-393), `frontend/src/components/User/AccountSettings/Profile.jsx` (imports ~:5; state ~:23; `blockedReason` ~:32-36; field ~:110-116)

**Interfaces:**
- Consumes: `editPhoneInput`, `pastePhoneInput`, `phoneInputError`, `phoneInputText`, `phoneWireValue`, types `PhoneTyped`, `PhoneEdit` (Task 9).
- Produces: `<PhoneInput id name value onValueChange showErrors disabled autoFocus className />` — `value` accepts canonical digits, a `+…` form value or legacy digits; `onValueChange(value)` and the hidden `name` field carry `+<digits>` (or `""`, or legacy digits without a plus while they are invalid). **`setValue` is gone** (renamed to `onValueChange`).

The logic is in `util/phone.ts` and tested there; the component is wiring, verified by lint, typecheck, build and the owner's check of the mockup states («Поле телефона: состояния»).

- [ ] **Step 1: Rewrite the component**

`frontend/src/components/app/PhoneInput.tsx`:

```tsx
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  editPhoneInput,
  pastePhoneInput,
  phoneInputError,
  phoneInputText,
  phoneWireValue,
  type PhoneEdit,
  type PhoneTyped,
} from "@/util/phone";

// Единственное поле телефона в приложении (макет «Единый формат телефонов»).
// Показывает номер маской «+7 (914) 555-01-42»; после «+» и не 7 — номер другой
// страны, «+375291234567». Отдаёт «+цифры»: скрытым полем `name` — формам на
// FormData, через onValueChange — формам на состоянии; бэкенд хранит цифры без
// плюса (services/phone.js). Ошибка — строкой под полем: после ухода с поля, по
// попытке отправки (showErrors или нативная проверка формы) и сразу — у
// негодного номера из старых данных.
const PhoneInput = ({
  id = "phone",
  name,
  value = "",
  onValueChange,
  showErrors = false,
  disabled = false,
  autoFocus = false,
  className,
}: {
  id?: string;
  /** Имя скрытого поля с «+цифрами» — для форм на FormData. */
  name?: string;
  /** Канон из базы, «+цифры» из состояния формы или старые цифры. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Показать ошибку, не дожидаясь ухода с поля: форма пробовала отправиться. */
  showErrors?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Ширина и прочее для самого поля (`w-72` в настройках). */
  className?: string;
}) => {
  const [text, setText] = useState(() => phoneInputText(value));
  const [wire, setWire] = useState(() => phoneWireValue(value));
  // Негодный номер из старых данных виден сразу: иначе форма молча не уйдёт
  const [touched, setTouched] = useState(() =>
    Boolean(phoneInputError(phoneWireValue(value))),
  );
  // Каждая правка перерисовывает поле, даже если текст не изменился (набрали
  // букву): иначе React вернёт прежнее значение и каретка уедет в конец
  const [, setEdits] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);

  const error = phoneInputError(wire);
  const visibleError = error && (touched || showErrors) ? error : null;

  // Нативная проверка: форма на FormData не отправится с негодным номером
  useEffect(() => {
    inputRef.current?.setCustomValidity(error ?? "");
  }, [error]);

  // Каретка — после той же цифры, что до переформатирования
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caretRef.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

  const apply = (next: PhoneTyped | PhoneEdit) => {
    caretRef.current = "caret" in next ? next.caret : next.text.length;
    setText(next.text);
    setEdits((count) => count + 1);
    if (next.wire !== wire) {
      setWire(next.wire);
      onValueChange?.(next.wire);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
    apply(
      editPhoneInput(text, input.value, input.selectionStart ?? input.value.length, inputType),
    );
  };

  // Вставка заменяет номер целиком и разбирается, как у бэкенда
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    apply(pastePhoneInput(event.clipboardData.getData("text")));
  };

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={text}
        onChange={handleChange}
        onPaste={handlePaste}
        onBlur={() => setTouched(true)}
        onInvalid={(event) => {
          // Своя строка под полем вместо всплывашки браузера
          event.preventDefault();
          setTouched(true);
        }}
        placeholder="+7 (___) ___-__-__"
        aria-invalid={visibleError ? true : undefined}
        aria-describedby={visibleError ? `${id}-error` : undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        className={cn("tabular-nums", className)}
      />
      {name && <input type="hidden" name={name} value={wire} />}
      {visibleError && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 mb-0 text-sm text-destructive">
          {visibleError}
        </p>
      )}
    </>
  );
};

export default PhoneInput;
```

- [ ] **Step 2: Company form — rows hold the form value, the contacts step checks them**

`frontend/src/components/Company/Form.jsx` — add after the `PhoneInput` import:

```js
import { phoneInputError, phoneWireValue } from "@/util/phone";
```

the `phones` state:

```js
  // Телефоны — динамический список; строкам нужны стабильные ключи, иначе
  // PhoneInput (внутренний стейт маски) «переезжает» при удалении из середины.
  // В строке — значение формы, «+цифры» (util/phone)
  const phoneSeq = useRef(0);
  const nextPhoneKey = () => `phone-${phoneSeq.current++}`;
  const [phones, setPhones] = useState(() => {
    const existing = (company?.phones || []).filter(Boolean);
    const rows = (existing.length ? existing : [""]).map((value) => ({
      key: nextPhoneKey(),
      value: phoneWireValue(value),
    }));
    return rows;
  });
```

`stepValid` and `stepError`:

```js
  // Обязательные поля — на первом шаге; на втором — только годные телефоны
  const stepValid = (index) => {
    if (index === 0) {
      return (
        form.alias.trim() !== "" &&
        form.fullTitle.trim() !== "" &&
        responsibles.length > 0
      );
    }
    if (index === 1) return phones.every((row) => !phoneInputError(row.value));
    return true;
  };

  const stepError = (index) => {
    if (stepValid(index)) return null;
    // Что не так с номером, уже написано под строкой — здесь не повторяем
    return index === 0
      ? "Заполните наименования и выберите хотя бы одного ответственного"
      : "Проверьте телефоны — подсказка под строкой";
  };
```

the start of `handleSubmit`:

```js
  const handleSubmit = () => {
    const badStep = [0, 1].find((index) => !stepValid(index));
    if (badStep !== undefined) {
      setAttempted(true);
      // Показать человеку незаполненное поле. В мастере это переключение шага,
      // в правке — прокрутка к секции: шагов там нет, и `setStep` молчал бы,
      // а форма выглядела бы сломанной — нажал «Сохранить», не случилось ничего
      if (isEdit) {
        scrollToSection(scroller, sectionAnchorId(SECTION_KEYS[badStep]));
      } else {
        setStep(badStep);
      }
      return;
    }
```

(`SECTION_KEYS` is `["basic", "contacts", "schedule"]`, so index 1 is the contacts section.) In the payload: `phones: phones.map((row) => row.value).filter(Boolean),`. The row input:

```jsx
                    <PhoneInput
                      id={row.key}
                      value={row.value}
                      onValueChange={(value) => setPhone(row.key, value)}
                      showErrors={attempted}
                    />
```

(no `name` — the form submits JSON).

- [ ] **Step 3: «Мой аккаунт» — the draft holds the form value and waits for a valid number**

`frontend/src/components/User/AccountSettings/Profile.jsx` — add after the `PhoneInput` import:

```js
import { phoneInputError, phoneWireValue } from "@/util/phone";
```

```js
  const [phoneNumber, setPhoneNumber] = useState(phoneWireValue(user.phone));
```

```js
  // Пустое обязательное поле бэкенд молча пропустит, оставив прежнее значение,
  // — поэтому причину называем на месте и гасим сохранение до исправления.
  // Что не так с телефоном, написано под полем; здесь — только что он мешает.
  const blank = (value) => !value.trim();
  const blockedReason =
    blank(firstName) || blank(lastName) || blank(email)
      ? "Имя, фамилия и email не могут быть пустыми"
      : phoneInputError(phoneNumber)
        ? "Проверьте номер телефона"
        : null;
```

```jsx
        <Field label="Телефон" htmlFor="phone">
          <PhoneInput id="phone" value={phoneNumber} onValueChange={setPhoneNumber} />
        </Field>
```

- [ ] **Step 4: Run the gates**

Run: `cd frontend && grep -rn "setValue=" src --include='*.jsx' --include='*.tsx' | grep -i phone; pnpm lint && pnpm typecheck; pnpm build`
Expected: `grep` prints nothing; lint clean; typecheck shows only the 3 baseline errors; build succeeds.

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 11: Every other phone input goes through the same field

**Files:**
- Modify: `frontend/src/components/User/UserForm.jsx` (imports ~:5-7; `form` init ~:196; `stepError("person")` ~:371-387; field ~:719-726), `frontend/src/components/Company/View/SubdivisionFormDialog.jsx` (imports ~:11-12; field ~:96-98), `frontend/src/components/Supplier/FormFields.jsx` (imports ~:3-6; `values` init ~:25-31; field ~:59-67), `frontend/src/components/ClientDevice/InlineCreateDialog.jsx` (supplier `validate` ~:68-71), `frontend/src/components/Preferences/Globals.jsx` (imports; `tel` state ~:29; `SectionForm` ~:87-91; the «Телефон» row ~:128-136), `frontend/src/components/Preferences/SectionForm.jsx`, `frontend/src/components/Preferences/TelegramChannelDialog.tsx` (imports; login form ~:512-535)

**Interfaces:**
- Consumes: `PhoneInput` (Task 10); `phoneInputError`, `phoneWireValue` (Task 9).
- Produces: `SectionForm` accepts `blockedReason` (passed to `useDraftSection`). `pages/Conversation/NewUser.tsx` needs no change: its canonical `counterpart.phone` goes through `phoneWireValue` in `UserForm`.

- [ ] **Step 1: User form**

`frontend/src/components/User/UserForm.jsx` — imports:

```js
import PhoneInput from "@/components/app/PhoneInput";
import { phoneInputError, phoneWireValue } from "@/util/phone";
```

`form` init: `phone: phoneWireValue(user?.phone),`. In `stepError`, inside `if (key === "person")`, right after `if (!form.email.trim()) return "Укажите email";`:

```js
      // Что не так с номером, написано под полем — сюда не дублируем
      if (!isService && phoneInputError(form.phone))
        return "Проверьте номер телефона — см. подсказку под полем";
```

The field:

```jsx
        {!isService && (
          <Field label="Телефон" htmlFor="u-phone">
            <PhoneInput
              id="u-phone"
              value={form.phone}
              onValueChange={(value) => setField("phone", value)}
              showErrors={attempted}
            />
          </Field>
        )}
```

- [ ] **Step 2: Subdivision dialog (FormData)**

`frontend/src/components/Company/View/SubdivisionFormDialog.jsx` — import `import PhoneInput from "@/components/app/PhoneInput";` and replace the phone field:

```jsx
            <Field label="Телефон" htmlFor="subdivision-phone">
              <PhoneInput id="subdivision-phone" name="phone" value={node?.phone || ""} />
            </Field>
```

The hidden `phone` carries `+<digits>`; `pages/Company/View.jsx` add/update actions forward it unchanged. An invalid number blocks the dialog's submit through the browser's constraint validation (`setCustomValidity`), and the error shows under the field instead of a browser bubble.

- [ ] **Step 3: Supplier fields (page FormData and inline JSON)**

`frontend/src/components/Supplier/FormFields.jsx` — imports:

```js
import PhoneInput from "@/components/app/PhoneInput";
import { phoneWireValue } from "@/util/phone";
```

the state:

```js
  const [values, setValues] = useState(() => {
    const initial = {
      ...EMPTY,
      ...Object.fromEntries(
        Object.keys(EMPTY).map((key) => [key, supplier?.[key] ?? EMPTY[key]]),
      ),
    };
    // Телефон в форме — «+цифры», как его отдаёт поле (util/phone)
    return { ...initial, phone: phoneWireValue(initial.phone) };
  });
```

the field:

```jsx
        <Field label="Телефон" htmlFor="supplier-phone">
          <PhoneInput
            id="supplier-phone"
            name="phone"
            value={values.phone}
            onValueChange={(phone) => {
              const next = { ...values, phone };
              setValues(next);
              onChange?.(next);
            }}
          />
        </Field>
```

`frontend/src/components/ClientDevice/InlineCreateDialog.jsx` — import `import { phoneInputError } from "@/util/phone";` and the supplier kind's `validate`:

```js
    validate: (state) => {
      if (!state.name || state.name.trim().length < 2) {
        return "Название должно содержать минимум 2 символа";
      }
      return phoneInputError(state.phone || "") ? "Проверьте номер телефона" : null;
    },
```

- [ ] **Step 4: Settings → Основные (support phone)**

`frontend/src/components/Preferences/SectionForm.jsx`:

```jsx
const SectionForm = ({ buildPayload, blockedReason = null, children }) => {
  useDraftSection(buildPayload, blockedReason);

  return <>{children}</>;
};
```

`frontend/src/components/Preferences/Globals.jsx` — imports:

```js
import PhoneInput from "@/components/app/PhoneInput";
import { phoneInputError, phoneWireValue } from "../../util/phone";
```

`const [tel, setTel] = useState(phoneWireValue(prefs.contacts?.tel));`; the section:

```jsx
    <SectionForm
      buildPayload={() => ({
        timezone,
        contacts: { title: orgTitle, tel, email, address },
        taxi: { operator: taxiOperator },
      })}
      blockedReason={phoneInputError(tel) ? "Проверьте номер телефона" : null}
    >
```

and the row control:

```jsx
      <SettingRow title="Телефон" htmlFor="prefs-contact-tel" className="py-3">
        <PhoneInput
          id="prefs-contact-tel"
          value={tel}
          onValueChange={setTel}
          className="w-72 max-md:w-full"
        />
      </SettingRow>
```

(`SettingRow` stacks its control in a block, so the error line falls under the input.)

- [ ] **Step 5: Telegram channel login step**

`frontend/src/components/Preferences/TelegramChannelDialog.tsx` — imports:

```ts
import PhoneInput from "@/components/app/PhoneInput";
import { phoneInputError } from "@/util/phone";
```

the code-login form:

```tsx
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (phone && !phoneInputError(phone)) void loginStep("phone", phone);
          }}
        >
          <Field label="Номер телефона" htmlFor="tg-login-phone">
            {/* Ключ по каналу: другой канал — поле с нуля, как и прежде */}
            <PhoneInput
              key={channelId ?? "none"}
              id="tg-login-phone"
              value={phone}
              onValueChange={setPhone}
              disabled={pendingFor("phone")}
            />
          </Field>
```

and the submit button's `disabled`:

```tsx
            disabled={
              busy || !phone || Boolean(phoneInputError(phone)) || !keysReady || pendingFor("phone")
            }
```

The backend turns the value into `+<digits>` for the gateway (Task 3).

- [ ] **Step 6: Run the gates**

Run: `cd frontend && grep -rn 'placeholder="+7' src; pnpm lint && pnpm typecheck; pnpm build`
Expected: the only placeholder hit is in `components/app/PhoneInput.tsx`; lint clean; typecheck — 3 baseline errors only; build succeeds.

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 12: Every screen shows the same number the same way

**Files:**
- Create: `frontend/src/components/app/PhoneLink.tsx`
- Modify: `frontend/src/components/User/View.jsx` (~:471-486), `frontend/src/components/User/Item.jsx` (~:143-153), `frontend/src/components/User/ContactCard.jsx` (~:147-160), `frontend/src/components/Company/View.jsx` (~:301-319), `frontend/src/components/Company/ContactSheet.jsx` (~:255-277), `frontend/src/components/Company/View/EmployeesSection.jsx` (~:211-219), `frontend/src/components/Company/View/ResponsiblesSection.jsx` (~:77-86), `frontend/src/components/Company/View/SubdivisionPreviewSheet.jsx` (~:155-164), `frontend/src/components/Ticket/View/Sections.jsx` (~:556-568), `frontend/src/components/Dashboard/MySupport.jsx` (~:75-89), `frontend/src/components/Supplier/Item.jsx` (~:26), `frontend/src/components/Supplier/View.jsx` (~:179-185), `frontend/src/components/Auth/AuthShell.tsx` (~:173-180), `frontend/src/layout/Footer.jsx` (~:31-39)

**Interfaces:**
- Consumes: `formatPhone`, `phoneHref` (Task 9).
- Produces: `<PhoneLink value className />` — formatted `tabular-nums` text, a `tel:` link when the number can be dialled, plain text otherwise, nothing for an empty value.

Rules applied everywhere (spec «Frontend»): text via `formatPhone`, links via `phoneHref`, a call icon or button only when `phoneHref` exists, «Скопировать» copies `formatPhone(...)`. React keys of company phones stay the phone (unique after normalization).

- [ ] **Step 1: Create `PhoneLink`**

`frontend/src/components/app/PhoneLink.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { formatPhone, phoneHref } from "@/util/phone";

// Телефон текстом: «+7 (914) 555-01-42» ссылкой «позвонить», цифры табличные.
// Номер, который не набрать (старые данные без кода города), — просто текст.
// Цвет и подчёркивание ссылки задаёт место (className).
const PhoneLink = ({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) => {
  const text = formatPhone(value);
  if (!text) return null;
  const href = phoneHref(value);
  return href ? (
    <a href={href} className={cn("tabular-nums", className)}>
      {text}
    </a>
  ) : (
    <span className="tabular-nums">{text}</span>
  );
};

export default PhoneLink;
```

- [ ] **Step 2: People — user card, list row, contact card, company employees and responsibles, ticket applicant**

`User/View.jsx` — imports `import PhoneLink from "@/components/app/PhoneLink";` and `import { formatPhone } from "@/util/phone";`; the phone row:

```jsx
            <PropRow
              icon={<RiPhoneLine size={17} />}
              label="Телефон"
              copy={phone ? { value: formatPhone(phone), label: "Телефон" } : undefined}
            >
              {phone ? (
                <PhoneLink
                  value={phone}
                  className="text-accent-text no-underline hover:underline"
                />
              ) : (
                <span className="font-normal text-faint">—</span>
              )}
            </PropRow>
```

`User/Item.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`; the call link:

```jsx
          {phoneHref(phone) && (
            <a
              className={cn(contactClass, "hover:text-primary")}
              href={phoneHref(phone)}
              title={`Позвонить · ${formatPhone(phone)}`}
              aria-label={`Позвонить ${fullName}`}
              onClick={stop}
            >
              <RiPhoneLine size={18} />
            </a>
          )}
```

`User/ContactCard.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`; the channel:

```jsx
        {phone && (
          <Channel
            compact={compact}
            icon={<RiPhoneLine size={iconSize} />}
            label="Позвонить"
            value={formatPhone(phone)}
            href={phoneHref(phone)}
            copy={{
              value: formatPhone(phone),
              label: "Телефон",
              aria: "Скопировать телефон",
            }}
          />
        )}
```

(`Channel` already renders a `<span>` instead of a link when `href` is missing.)

`Company/View/EmployeesSection.jsx` and `Company/View/ResponsiblesSection.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`; the call icon (`user` in employees, `person` in responsibles):

```jsx
                        {phoneHref(user.phone) && (
                          <a
                            href={phoneHref(user.phone)}
                            title={formatPhone(user.phone)}
                            aria-label={`Позвонить — ${user.lastName} ${user.firstName}`}
                            className={iconLinkClass}
                          >
                            <RiPhoneLine size={16} />
                          </a>
                        )}
```

```jsx
        {phoneHref(person.phone) && (
          <a
            href={phoneHref(person.phone)}
            title={formatPhone(person.phone)}
            aria-label={`Позвонить — ${name}`}
            className={iconLinkClass}
          >
            <RiPhoneLine size={16} />
          </a>
        )}
```

`Ticket/View/Sections.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`; the applicant call button:

```jsx
                {!isEndUser && phoneHref(applicant?.phone) && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-xs"
                    title={`Позвонить: ${formatPhone(applicant.phone)}`}
                    aria-label="Позвонить инициатору"
                  >
                    <a href={phoneHref(applicant.phone)}>
                      <RiPhoneLine />
                    </a>
                  </Button>
                )}
```

- [ ] **Step 3: Company, subdivision, supplier**

`Company/View.jsx` — import `import PhoneLink from "@/components/app/PhoneLink";`; the «Телефоны» row:

```jsx
              <PropRow icon={<RiPhoneLine size={17} />} label="Телефоны">
                {company.phones?.length ? (
                  <span className="tabular-nums">
                    {company.phones.map((phone, index) => (
                      <span key={phone}>
                        {index > 0 && <span className="text-faint"> · </span>}
                        <PhoneLink
                          value={phone}
                          className="text-accent-text no-underline hover:underline"
                        />
                      </span>
                    ))}
                  </span>
                ) : (
                  dash
                )}
              </PropRow>
```

`Company/ContactSheet.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`; in `filledPhones.map`: `<a href={phoneHref(phone)} className={channelLinkClass}>`, the value `{formatPhone(phone)}`, and the copy button `onClick={() => copyToClipboard(formatPhone(phone), "Телефон")}`.

`Company/View/SubdivisionPreviewSheet.jsx` — import `import PhoneLink from "@/components/app/PhoneLink";`:

```jsx
                <Info label="Телефон">
                  {node.phone ? (
                    <PhoneLink
                      value={node.phone}
                      className="text-accent-text no-underline hover:underline"
                    />
                  ) : null}
                </Info>
```

`Supplier/Item.jsx` — import `import { formatPhone } from "@/util/phone";`; `const contacts = [formatPhone(phone), email, website].filter(Boolean).join(" · ");`

`Supplier/View.jsx` — imports `import PhoneLink from "@/components/app/PhoneLink";` and `import { formatPhone } from "@/util/phone";`; the phone contact (the supplier card gets a `tel:` link, as in the mockup):

```jsx
    supplier.phone && {
      icon: <RiPhoneLine size={17} />,
      label: "Телефон",
      value: (
        <PhoneLink
          value={supplier.phone}
          className="text-accent-text no-underline hover:underline"
        />
      ),
      copy: { value: formatPhone(supplier.phone), label: "Телефон" },
    },
```

- [ ] **Step 4: The support line — dashboard, login screen, footer**

`Dashboard/MySupport.jsx` — import `import PhoneLink from "@/components/app/PhoneLink";`; the row keeps its two-line structure, the phone becomes a link:

```jsx
                <span className="block truncate text-sm font-semibold">
                  {supportPhone ? (
                    <PhoneLink
                      value={supportPhone}
                      className="text-accent-text no-underline hover:underline"
                    />
                  ) : (
                    supportEmail
                  )}
                </span>
```

`Auth/AuthShell.tsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`:

```tsx
                {contacts.tel && (
                  <Contact
                    label="Телефон"
                    value={formatPhone(contacts.tel)}
                    href={phoneHref(contacts.tel)}
                    icon={<RiPhoneLine size={16} />}
                  />
                )}
```

`layout/Footer.jsx` — import `import { formatPhone, phoneHref } from "@/util/phone";`:

```jsx
    contacts?.tel && (
      <a
        key="tel"
        href={phoneHref(contacts.tel)}
        className="text-muted-foreground no-underline tabular-nums hover:text-foreground"
      >
        {formatPhone(contacts.tel)}
      </a>
    ),
```

- [ ] **Step 5: Run the gates and sweep for raw phones**

Run: `cd frontend && grep -rnE 'tel:\$\{|tel:`' src --include='*.jsx' --include='*.tsx' --include='*.js' --include='*.ts'; pnpm lint && pnpm typecheck; pnpm build`
Expected: `grep` prints nothing (every `tel:` comes from `phoneHref`); lint clean; typecheck — 3 baseline errors; build succeeds.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 13: «Диалоги» — handles, the channel line and the contact block

**Files:**
- Modify: `frontend/src/util/conversation-format.js` (import; `counterpartHandle` ~:296-298; new `handleLabel`), `frontend/src/util/channel-state.js` (import; `channelHint` ~:196-202), `frontend/src/components/Conversation/ContactBlock.tsx` (imports ~:6; `handles` ~:27; other channels ~:67-82; phone row ~:92-100), `frontend/src/components/Preferences/TelegramChannelDialog.tsx` (~:415)
- Test: `frontend/src/util/conversation-format.test.js` (~:195-197), `frontend/src/util/channel-state.test.js` (~:27, ~:103)

**Interfaces:**
- Consumes: `formatPhone`, `toCanonicalPhone` (Task 9).
- Produces: `counterpartHandle(person)` → `@username` or a formatted phone; `handleLabel(handle)` → `@username` as is, a phone formatted, `""` for nothing.

- [ ] **Step 1: Update the tests**

`frontend/src/util/conversation-format.test.js` — add `handleLabel` to the import list and, in «подписи по сети…», replace the phone line and add:

```js
  assert.equal(counterpartHandle({ username: "", phone: "79145550142" }), "+7 (914) 555-01-42");
  assert.equal(handleLabel("@m_sokolova"), "@m_sokolova");
  assert.equal(handleLabel("79145550142"), "+7 (914) 555-01-42");
  assert.equal(handleLabel(""), "");
```

`frontend/src/util/channel-state.test.js` — the fixture stores canonical digits:

```js
  account: { displayName: "F1Lab Поддержка", phone: "74232000000" },
```

(the expectation `"F1Lab Поддержка · +7 (423) 200-00-00"` stays).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && node --test src/util/conversation-format.test.js src/util/channel-state.test.js`
Expected: FAIL — `handleLabel` is not exported; `channelHint` returns `… · 74232000000`.

- [ ] **Step 3: Format in the helpers**

`frontend/src/util/conversation-format.js` — after `import { plural } from "./plural.js";`:

```js
import { formatPhone } from "./phone.ts";
```

```js
/** Ник или телефон собеседника — вторая строка в шапке и строке канала. */
export const counterpartHandle = (person) =>
  person?.username ? `@${person.username}` : formatPhone(person?.phone);

/** Ручка канала из карточки собеседника («@ник» или телефон цифрами) — для показа. */
export const handleLabel = (handle) =>
  !handle || handle.startsWith("@") ? handle || "" : formatPhone(handle);
```

`frontend/src/util/channel-state.js` — after `import { plural } from "./plural.js";`:

```js
import { formatPhone } from "./phone.ts";
```

and in `channelHint`:

```js
  const handle =
    formatPhone(account.phone) || (account.username ? `@${account.username}` : "");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && node --test src/util/conversation-format.test.js src/util/channel-state.test.js`
Expected: PASS.

- [ ] **Step 5: Contact block and the Telegram account line**

`frontend/src/components/Conversation/ContactBlock.tsx` — imports:

```ts
import { counterpartHandle, handleLabel, networkLabel } from "@/util/conversation-format";
import { formatPhone, toCanonicalPhone } from "@/util/phone";
```

replace `const handles = new Set(otherChannels.map((item) => item.handle));` with:

```ts
  // Телефон, уже показанный номером мессенджера (этот диалог или другой), второй
  // строкой не повторяется: сравниваем цифры, а не написание
  const shownPhones = new Set(
    [counterpart ? counterpartHandle(counterpart) : "", ...otherChannels.map((item) => item.handle)]
      .map((handle) => (!handle || handle.startsWith("@") ? "" : toCanonicalPhone(handle)))
      .filter(Boolean),
  );
```

in the other-channels rows: `value={handleLabel(item.handle) || "—"}`; the phone row:

```tsx
        {contact.phone && !shownPhones.has(toCanonicalPhone(contact.phone)) && (
          <ContactChannelRow
            channel="phone"
            label="Телефон"
            value={formatPhone(contact.phone)}
            big={big}
            action={
              <CopyAction value={formatPhone(contact.phone)} label="Телефон" what="телефон" />
            }
          />
        )}
```

(«Диалоги» stay copy-only, no `tel:` — the P1b decision.) Update the component's JSDoc sentence «Телефон, уже показанный как номер мессенджера, второй строкой не повторяется» to «…как номер мессенджера (этот диалог или другой), второй строкой не повторяется».

`frontend/src/components/Preferences/TelegramChannelDialog.tsx` — add `formatPhone` to the `@/util/phone` import from Task 11 and:

```tsx
          <div className="truncate text-sm text-muted-foreground">
            {formatPhone(account.phone) || (account.username ? `@${account.username}` : "")}
          </div>
```

- [ ] **Step 6: Run the gates**

Run: `cd frontend && node --test src/util/*.test.js && pnpm lint && pnpm typecheck; pnpm build`
Expected: all helper tests PASS; lint clean; typecheck — 3 baseline errors; build succeeds.

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 14: List search finds a number however it was typed

**Files:**
- Modify: `frontend/src/store/lists/companies.js` (`searchItems` ~:47-70), `frontend/src/store/lists/tickets.js` (`matchesSearch` ~:50-73), `frontend/src/store/lists/suppliers.js` (`supplierFilter` ~:37-44), `frontend/src/components/Company/View/EmployeesSection.jsx` (`filtered` ~:79-92)

**Interfaces:**
- Consumes: `phoneMatches` (Task 9; its behaviour is pinned by «search finds a number however it was typed»).

- [ ] **Step 1: Companies**

`store/lists/companies.js` — import `import { phoneMatches } from "@/util/phone";` and in `searchItems` replace the final `return queryTerms.every(…)` with:

```js
    // Номер — по цифрам, как бы его ни набрали: «8 914», «+7 (914) 555»
    const phones = [
      ...(item.phones ?? []),
      ...(item.responsibles ?? []).map((responsible) => responsible?.phone),
    ];
    return (
      phoneMatches(query, phones) ||
      queryTerms.every((term) =>
        fieldsToSearch.some(
          (field) => field && String(field).toLowerCase().includes(term),
        ),
      )
    );
```

- [ ] **Step 2: Tickets**

`store/lists/tickets.js` — import `import { phoneMatches } from "@/util/phone";` and at the top of `matchesSearch`, after `if (!term) return true;`:

```js
  // Номер — по цифрам, как бы его ни набрали
  const phones = [
    ticket.applicant?.phone,
    ...(ticket.responsibles ?? []).map((user) => user?.phone),
  ];
  if (phoneMatches(term, phones)) return true;
```

- [ ] **Step 3: Suppliers**

`store/lists/suppliers.js` — import `import { phoneMatches } from "@/util/phone";` and the search filter:

```js
      .filter((item) =>
        term
          ? phoneMatches(term, [item.phone]) ||
            [item.name, item.phone, item.email, item.inn, item.website]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(term)
          : true,
      )
```

- [ ] **Step 4: Company employees**

`Company/View/EmployeesSection.jsx` — add `phoneMatches` to the `@/util/phone` import from Task 12 and:

```js
    if (query) {
      list = list.filter(
        (user) =>
          phoneMatches(query, [user.phone]) ||
          [
            `${user.lastName} ${user.firstName}`,
            user.position,
            user.email,
            user.phone,
            user.subdivision?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
      );
    }
```

- [ ] **Step 5: Run the gates**

Run: `cd frontend && node --test src/util/phone.test.js && pnpm lint && pnpm build`
Expected: PASS; lint clean; build succeeds.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 15: Documentation

**Files:**
- Create: `docs/phone-numbers.md`
- Modify: `docs/ux-ui-guide.md` (TOC ~:45; catalog row ~:221; new section after «Даты и время на экране», before «## Правка на месте»), `docs/ux-ui-changelog.md` (new top entry), `docs/messaging.md` (~:42-53), `docs/ai-implementation.md` (~:589-598), `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` (~:151), `docs/superpowers/plans/2026-09-25-omnichannel-p1a-telegram-gateway.md` (after `phoneOf`, ~:2936)

- [ ] **Step 1: Write `docs/phone-numbers.md`**

```markdown
# Phone numbers

Every phone number is stored as **canonical digits**: the country code included, no
`+`, brackets, dashes or spaces (`79145550142`, `375291234567`); `""` means no phone.
Valid = `7` + 10 digits, or 8–15 digits starting with `1-6`, `8` or `9`. What people
see is formatted on the way out: `+7 (914) 555-01-42`, other countries
`+375291234567`, an invalid legacy value as stored.

## One rule, three copies

| Copy | Used for |
| --- | --- |
| `backend/services/phone.js` | `parsePhoneInput` (raw → canonical), `toCanonicalPhone` (Mongoose setter), `isValidPhone`, `formatPhone` (texts the server composes: client e-mails, «Диалоги» titles), `phoneSearchDigits` |
| `frontend/src/util/phone.ts` | the same rule plus display (`formatPhone`, `phoneHref`), the input field logic and list search (`phoneMatches`) |
| `tg-service/src/bot/phone.ts` | `formatPhone` for the ticket card |

The three test files share one table of raw → canonical → display cases; a change
to the rule changes all three.

## Raw input vs stored digits

`parsePhoneInput` reads raw input: without `+` a number is Russian — a leading `8`
is the trunk prefix, exactly 10 digits get `7`; `+`, `00` and `810` mean the country
code is already there. `toCanonicalPhone` treats a digits-only value as already
canonical and never reinterprets it — otherwise a German `4930901820` copied into a
snapshot would become `74930901820`. Hence:

- every schema path holding a phone has `set: toCanonicalPhone`; Mongoose 9 applies
  setters to writes **and** to query filter values (RegExp filters bypass them);
- API input always goes through the raw parser (`validations/phone.js`:
  `phoneBody`, `phoneListBody`, 400 on an invalid number); the web client sends
  E.164 with the plus (`+79145550142`), so the parse is unambiguous, and whatever an
  old tab sends is cleaned up too;
- messenger phones arrive from the gateway in international form and are stored with
  `toCanonicalPhone`.

## Lookups

Equality on the canonical number. `services/callerIdentityService.js`:
`findUsersByPhone` (not a service or telephony account, active company, not banned,
at most two), `findApplicantByPhone` and `findCompanyByPhone` match only when the
number leads to exactly one record. `extractCallerPhones` reads the caller from an
e-mail: when the «Кто звонил:» label is present, the number on that line is the only
candidate, and a withheld caller ID gives none — a telephony mail also carries
«Номер линии» (our own line) and the call time, which must never be matched. Without
the label: the subject, then the body (plausible Russian `7[3489]…` or dialled with
`+`); candidates never span a line break, and `emailHandling` tries them in turn.
Messenger identities link through the same `findUsersByPhone`.

People search (`services/personSearch.js`) matches the phone by the digits of the
query; a query that looks like a whole number is one phone term.

## Migration

`scripts/normalizePhones.js` (`2026-09-30-normalizePhones` in `scripts/migrate.js`)
rewrote every stored path, snapshots included, through
`services/phoneMigration.js`: raw values parsed, `+7`/words emptied, two numbers in
one string reduced to the first, the old mask's `+8 (…)` read as `+7` (listed as
`plus8`), invalid values kept as digits and listed for a manual fix. Snapshot arrays
are read whole and every write is a compare-and-set on the values that were read: a
document changed in between is not written, the run reports it and exits 1, so
`migrate.js` does not record the entry. A second full run changes nothing (ten digits
starting with 7 are taken as an incomplete `+7` number, not re-prefixed); after a
partial failure, a foreign number of 10 digits or with a leading 8 that was already
written could be re-read as Russian, so dry-run first. Numbers of other countries are
written as given and listed for review. Numbers and names never appear in its output
— only ids, paths and shapes.
```

- [ ] **Step 2: The UX guide**

`docs/ux-ui-guide.md`:
- In «Оглавление», after `- [Даты и время на экране](#даты-и-время-на-экране)` add `- [Телефоны на экране](#телефоны-на-экране)`.
- Replace the `PhoneInput` catalog row and add `PhoneLink` under it:

```markdown
| `PhoneInput` | Единственное поле телефона: маска «+7 (___) ___-__-__», после «+» и не 7 — номер другой страны; вставка разбирается целиком; ошибка строкой под полем; отдаёт «+цифры» скрытым полем `name` или через `onValueChange` — см. «Телефоны на экране» |
| `PhoneLink` | Телефон текстом: «+7 (914) 555-01-42» ссылкой `tel:`, цифры табличные; номер, который не набрать, — просто текст — см. «Телефоны на экране» |
```

- Insert before `## Правка на месте (Obsidian-режим)`:

```markdown
## Телефоны на экране

Телефон в базе — только цифры с кодом страны (`79145550142`); вид на экране
собирают хелперы `util/phone.ts`, своих масок и `tel:${…}` в компонентах нет.
Устройство — `docs/phone-numbers.md`.

| Номер | Как выглядит |
| --- | --- |
| российский (+7, 11 цифр) | `+7 (914) 555-01-42` |
| другой страны | `+375291234567` — без группировки |
| негодный (старые данные без кода города, неполный) | как лежит — `2222999`, без ссылки и кнопки звонка |

- Показ — `formatPhone`, ссылка — `phoneHref` (`tel:+79145550142`), в тексте —
  `app/PhoneLink`; цифры табличные (`tabular-nums`). «Скопировать» кладёт в буфер
  то, что на экране.
- Ввод — только `app/PhoneInput`. Ошибки строкой под полем: «Номер неполный: нужно
  11 цифр», «Номер слишком короткий», «Укажите номер с кодом города»; номер без
  кода города не сохраняется.
- Поиск находит номер по цифрам, как бы его ни набрали: `phoneMatches` в списках,
  `services/personSearch` на сервере.
- В «Диалогах» телефоны только копируются, без `tel:`.
- Тексты сервера (письма клиентам, карточка бота, заголовки неизвестных
  собеседников) — в том же виде: их собирают бэкенд и бот по той же таблице.
```

- [ ] **Step 3: The changelog**

`docs/ux-ui-changelog.md` — the first entry after `---`:

```markdown
- **2026-09-30** — **Телефоны: в базе цифры, на экране один вид.** Макет
  «Единый формат телефонов» согласован владельцем: вид A `+7 (914) 555-01-42`
  (B `+7 914 555-01-42` отвергнут). Было: в базе — как набрали (`+7 (…) …`,
  `+7…`, `8…`, голое `+7`), на экране — сырая строка, маска стояла у двух полей
  из восьми, `tel:` уходил со скобками и пробелами. Стало: одно поле
  `app/PhoneInput` во всех формах (другая страна — после «+», вставка
  разбирается целиком, номер без кода города не сохраняется), показ через
  `formatPhone` и `app/PhoneLink`, «Скопировать» копирует то, что видно; у
  карточки поставщика и строки поддержки на главной клиента появился `tel:`.
  См. «Телефоны на экране».
```

- [ ] **Step 4: Module docs and the omnichannel spec/plan**

`docs/messaging.md` — in the `channelidentities` bullet, replace «or phone ↔ **exactly one** user found by `findUsersByPhone` (same matching as `findApplicantByPhone`/`services/callerIdentityService.js`, plus banned/service filtering)» with «or phone ↔ **exactly one** user found by `findUsersByPhone` (`services/callerIdentityService.js`, shared with telephony: equality on the canonical number, no service or telephony accounts, no banned users, active companies only)», and after «Never by name or username.» add «`phone` holds canonical digits with the country code whatever format the gateway sends (`docs/phone-numbers.md`).»

`docs/ai-implementation.md` — in the telephony-title paragraph above «### Caller identification» (~:562), `extractCallerPhone` → `extractCallerPhones`; then replace the paragraph under «### Caller identification» up to «replaces the old fragile `email.name.split(" ")[4]` extraction.» with:

```markdown
For telephony emails the applicant + company are resolved **by phone number only**
(the service is imported by `emailHandling.js`): `extractCallerPhones` reads the
caller's number as canonical digits (`services/phone.js`). When the explicit
`Кто звонил:` label is present, the number on that line is the only candidate and a
withheld caller ID gives none — the same mail carries `Номер линии` (our own line) and
the call time, which must never be matched. Without the label: the subject, then the
body (a plausible Russian `7[3489]…` number or one dialled with `+`, so an INN in a
signature is skipped); candidates never span a line break.
`findApplicantByPhone`/`findCompanyByPhone` match by equality
on `user.phone` / `company.phones` and only when the number leads to exactly one
record (a shared office line matches nobody); `emailHandling` tries the numbers in
turn. A user match yields the user *and their linked company*. Gated by the existing
`identifyApplicant`/`identifyCompany`/`checkPhoneNumber` prefs; this replaces the old
fragile `email.name.split(" ")[4]` extraction. See `docs/phone-numbers.md`.
```

`docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` ~:151: «phone (E.164)» → «phone (canonical digits — E.164 without «+», `docs/phone-numbers.md`)».

`docs/superpowers/plans/2026-09-25-omnichannel-p1a-telegram-gateway.md` — right after the `phoneOf` code block add:

```markdown
> 2026-09-30: the backend canonicalizes every incoming phone itself
> (`docs/phone-numbers.md`); `phoneOf` may send Telegram's digits as they are.
```

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 16: Final verification

**Files:** none new.

- [ ] **Step 1: Leftovers of the old formats**

Run from the repo root:
`grep -rn "normalizeRuPhone\|buildPhoneSuffixRegex\|extractCallerPhone(\|formatPhoneNumber\|require(\"phone\")" backend frontend/src tg-service/src --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: nothing.

- [ ] **Step 2: All suites**

Run: `cd backend && pnpm test && pnpm typecheck` · `cd frontend && node --test src/util/*.test.js src/components/app/*.test.js && pnpm lint && pnpm typecheck; pnpm build` · `cd tg-service && pnpm test && pnpm typecheck`
Expected: backend and tg-service green; frontend green except the 3 baseline typecheck errors.

- [ ] **Step 3: The dev data is canonical**

Run (repo root, sandbox disabled): `docker compose run --rm backend node scripts/normalizePhones.js`
Expected: «изменятся документы — 0».

- [ ] **Step 4: Caller ID on real data — a unique number matches, a shared one does not**

Run (sandbox disabled):

```bash
docker exec -e NODE_PATH=/app/node_modules -w /app hd-backend-1 node -e '
require("module-alias/register");
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
  const User = require("@/models/user");
  const { findApplicantByPhone } = require("@/services/callerIdentityService");
  const eligible = { phone: /^7\d{10}$/, isServiceAccount: { $ne: true }, isCloudTelephony: { $ne: true }, banned: { $ne: true }, "company.isActive": { $ne: false } };
  const groups = await User.aggregate([{ $match: eligible }, { $group: { _id: "$phone", n: { $sum: 1 } } }]);
  const shared = groups.find((group) => group.n > 1);
  const unique = groups.find((group) => group.n === 1);
  console.log("shared number →", shared ? String(await findApplicantByPhone(shared._id)) : "none in this copy");
  const match = unique && (await findApplicantByPhone(unique._id));
  console.log("unique number →", match ? "matched one user" : "NOT matched");
  await mongoose.disconnect();
})();'
```

Expected: `shared number → null`, `unique number → matched one user`. Numbers are never printed.

- [ ] **Step 5: Hand-off for the UI check**

Report to the owner (no commit): the changed files (`git status --short`), the invalid-number list from Task 7, and the screens to check against the mockup in both themes, desktop and phone:
- User card, list row (hover), applicant popup and contact sheet.
- Company card, company contact sheet, subdivision sheet, supplier card and row.
- «Мой аккаунт», the user form, the company form (a wrong number in the contacts step), the subdivision dialog, the supplier form, Settings → Основные, the Telegram channel login.
- «Диалоги» contact block and list, the channel line.
- The login screen, the footer, the client dashboard support line.
- A bot ticket card and a client e-mail.

Remind the owner of the prod rollout (spec «Rollout»): one `./deploy.sh` rebuilds backend, frontend and tg-service; the migration runs with the app stopped; afterwards fix the listed invalid values by hand.

- [ ] **Step 6: Checkpoint (no commit)**

---

## After execution (2026-09-30)

Executed task by task with a review after each; whole-branch review «with fixes» →
one fix round (caller ID: `&nbsp;` in the «Кто звонил» label and our own support line
never a candidate; «Диалоги» list search by digits across separators; doc accuracy;
array-update setter tests; `PhoneInput` autofill only in the own profile) → re-review
clean. Suites: backend 708/708, frontend helpers 246/246, tg-service 10/10; frontend
lint/typecheck at their baselines; dev dry run «изменятся документы — 0»; caller-ID
smoke on the dev copy (shared number → no match, unique → one user). Nothing committed.

Parked follow-ups (none blocks the deploy):

- A migrated incomplete `+7` value (`7914555014`, two live users) opens as bare digits
  with «Укажите номер с кодом города»; «Номер неполный» would be the precise message.
- A legacy invalid phone blocks unrelated edits of that form until fixed — fix the four
  listed live records by hand right after the deploy.
- Caller ID: a same-line extension or time after the «Кто звонил» number makes it
  invalid (no candidate); `extractOperatorName`'s stop-list still spells «кто звонил»
  with a plain space; `phoneDigitsPattern("")` would match everything (unreachable now).
- The bot card prints «Телефон: » for a digit-free legacy value (pre-migration only).
- `ContactBlock`'s phone dedupe is inline and untested (a pure `handleDigits` helper
  with `node:test` rows would pin it); `rules.test` lost its `+7…` stored-value row.
- A mixed list query with separators inside a term («Иванов (914)») does not match
  digits; only a whole-number query does.
- Selection-range deletions and clipboard edge cases of `PhoneInput` — the owner's
  hands-on check; ContactCard keeps the tap highlight on a non-dialable number,
  ContactSheet does not.
- Prettier drift predates this work in `User/View.jsx`, `Ticket/View/Sections.jsx`,
  `Supplier/View.jsx`, `layout/Footer.jsx`, `util/phone.ts` and its test.
- Open owner decision: default country for CIS clients + libphonenumber-js
  (productization audit C2); this plan is RU-first by the owner's approval.
