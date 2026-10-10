# Mikrotik: изменения конфигурации по запросу ИИ-агента — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** агент через MCP предлагает набор изменений RouterOS; HD проводит запрос через подтверждение заявителя и утверждение ответственного (Telegram, портал, почта, колокольчик, главная), снимает бэкап, применяет в safe mode и отдаёт конфиг WireGuard, не показав приватный ключ агенту.

**Architecture:** чистое ядро без сети и БД (`changeRules`, `changeRender`, `changeSteps`, `safeModeConsole`, `wireguardConfig`) + тонкие слои вокруг: сервис предложений (сверка с роутером), воркер применения (очередь, бэкап, исполнитель), уведомления, HTTP/бот/MCP. Исполнитель за одним интерфейсом `applyCommands`; реализацию выбирает проверка из задачи 1.

**Tech Stack:** Node (CommonJS), Express, Mongoose, `node:test`, ssh2 (уже есть), `@modelcontextprotocol/server` v2, grammy (tg-service, TypeScript), React + Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-10-10-mikrotik-agent-changes-design.md`
**Макет (утверждён 10.10):** https://claude.ai/artifact/QeCVcHfUBNxJDUUTDMUuFj

## Global Constraints

- Git ведёт владелец: ни `commit`, ни `push`. Шаги «Commit» в задачах отсутствуют намеренно; итог задачи — запись в ledger.
- Только `pnpm`. Тесты — `node --test <файл>` по затронутым файлам; полный `pnpm test` бэкенда не запускать.
- Новые файлы бэкенда — `.js` в стиле соседних (`services/mikrotik/*`), комментарии по-русски; модули ядра не требуют `utils/logger` (логгер приходит аргументом — на хосте он падает с EACCES).
- Секреты не попадают агенту и в логи: приватный ключ и PSK WireGuard существуют только зашифрованными (`encryptSecret`) и в скачиваемом `.conf`.
- Агент на роутер не пишет: у MCP есть только «предложить», «статус», «список».
- Тексты интерфейса — дословно из макета. Статусы: «Ждёт заявителя», «Ждёт ответственного», «Применяется», «Применён», «Откачен», «Не применён», «Отклонён», «Истёк». Кнопки: «Подтвердить» (заявитель), «Утвердить» (ответственный), «Отклонить», «Да, применить», «Назад».
- Право: `mikrotik.approveChanges`, название «Утверждать запросы ИИ-агентов по устройствам Mikrotik», пояснение «Запрос меняет конфигурацию устройства: после утверждения команды выполняются на роутере клиента.»
- Доступ ключа: `mikrotikChanges`, подпись «Изменения Mikrotik».
- Пределы: до 30 команд в запросе; до 5 незавершённых запросов на устройство; 20 предложений в час на ключ; решение — 24 часа; напоминание за 2 часа; ключи WireGuard стираются через 24 часа после применения.
- Колокольчик и блок на главной работают всегда, независимо от настроек категории.
- Telegram — только обычный текст (`plainText`), без HTML.
- Документация модулей — на английском и без описания интерфейса; видимые изменения — в `docs/ux-ui-changelog.md`.
- Запись на роутеры в ходе работ — только `F1-VLD-GW01` и только то, что описано в задачах 1 и 15.

## Review Focus

1. **Значение с пробелом, кавычкой, `$`, `;`, `[`** в параметре или `where` — должно дойти до роутера одним значением, а не второй командой. Тест: задача 3.
2. **Команда прошла проверку пути, но несёт запретное поле** (`on-up` в `/ppp profile`, `password` в `/interface pppoe-client`) — отказ. Тест: задача 2.
3. **Нажатие кнопки не тем человеком или вторым разом** (двойной тап, чужой Telegram, запрос уже решён/истёк) — запрос не меняется, применение не запускается дважды. Тест: задачи 4 и 10.
4. **Конфигурация изменилась между предложением и применением** (строка `where` исчезла, стало две, значение «было» другое) — «Не применён», без единой команды. Тест: задача 8.
5. **Вывод консоли с ошибкой, не входящей в список известных** — непустой ответ на команду без `add`-идентификатора считается сбоем, а не успехом. Тест: задача 7.

---

### Task 1: Проверка safe mode на живом роутере

Единственная задача, результат которой меняет остальные. Пишет на `F1-VLD-GW01` один комментарий и убирает его.

**Files:**
- Create: `backend/scripts/spikeSafeMode.js`
- Create: `backend/services/mikrotik/sshShell.js`

**Interfaces:**
- Produces: `openShell(conn, { cols = 200, rows = 50 }) → Promise<{ write(text), read({ until: RegExp, timeoutMs }) → Promise<string>, close() }>`; `shellLogin(user) → string` (логин с суффиксом консоли, отключающим цвета и автоопределение терминала: `${user}+ct200w`).

- [ ] **Step 1: `sshShell.js`.** `conn.shell({ term: "dumb", cols, rows }, cb)`; накопитель вывода; `read` ждёт совпадения `until` в накопителе, возвращает текст до конца совпадения и сдвигает накопитель; по таймауту — `Error("shell read timeout")`. `close()` — `stream.destroy()` без `quit` (обрыв, а не выход).

- [ ] **Step 2: Скрипт.** Аргументы: `<recordId> [--apply]`. Без `--apply` только печатает, что сделает. Берёт запись, `resolveJumpContext`, `buildSshParams(record)` с логином `shellLogin(...)`, открывает сессию через `openSshSession`. Сценарий, каждый шаг печатает сырой вывод через `JSON.stringify` (видны управляющие символы):
  1. дождаться приглашения `/\] > $/`;
  2. послать `\x18`; напечатать ответ (ожидается `[Safe Mode taken]`, приглашение с `<SAFE>`);
  3. `/ip firewall address-list add list=hd-probe address=192.0.2.1 comment=hd-safe-mode-probe\r` (список `hd-probe` ни в одном правиле не используется, на трафик запись не влияет); напечатать ответ;
  4. намеренная ошибка: `/ip firewall address-list add list=hd-probe address=not-an-ip\r`; напечатать ответ (образец текста ошибки);
  5. `close()` (обрыв); через 5 с новой exec-сессией `/ip firewall address-list print count-only where list=hd-probe` — ожидается `0` (откат);
  6. повтор шагов 1–3, затем `\x18` (выход, ожидается `[Safe Mode released]`), `quit`; проверка count — `1`;
  7. уборка: `/ip firewall address-list remove [find where list=hd-probe]`; проверка count — `0`.
  Итоговая строка: `SAFE MODE: rollback=<ok|FAILED> keep=<ok|FAILED>`.

- [ ] **Step 3: Проверка синтаксиса.** Run: `node --check scripts/spikeSafeMode.js && node --check services/mikrotik/sshShell.js`. Expected: без вывода.

- [ ] **Step 4: Стоп — прогон владельцем.** Владелец выкатывает и запускает в контейнере: `docker exec hd-backend-1 node scripts/spikeSafeMode.js 6a66de4a6d8dc471ed89e914 --apply`, присылает вывод целиком.

- [ ] **Step 5: Решение в ledger.** `rollback=ok keep=ok` → `Ruling: executor A (safe mode)`; сырой вывод сохранить в `backend/services/mikrotik/__fixtures__/safeMode/*.txt` (вход, выход, ошибка, успешный add) — это данные для задачи 7. Иначе → `Ruling: executor B (API)`, задача 7 сокращается до API-исполнителя, тексты «роутер откатит сам» в задачах 9 и 13 заменяются на «применённое останется, резервная копия снята» и это отдельно показывается владельцу.

---

### Task 2: Правила приёма — `changeRules.js`

**Files:**
- Create: `backend/services/mikrotik/changeRules.js`
- Test: `backend/services/mikrotik/changeRules.test.js`

**Interfaces:**
- Consumes: `isSecretField(section, name)`, `isScriptField(name)` из `configRedact.js`.
- Produces:
  - `validateProposal(input) → { ok: true, commands: Command[], risk: "normal" | "high", placeholders: string[] } | { ok: false, errors: string[] }`
  - `Command = { path, action, where: object | null, params: object, risk: "normal" | "high", riskReason: string | null }` (`path` нормализован: один пробел, без хвостового `/`)
  - `PLACEHOLDERS = { publicKey: "{{wireguard.public-key}}", presharedKey: "{{wireguard.preshared-key}}" }`
  - `MAX_COMMANDS = 30`, `ACTIONS = ["add","set","remove","enable","disable"]`, `DENIED_PATHS`, `RISKY`.

- [ ] **Step 1: Падающий тест.**

```js
// node --test services/mikrotik/changeRules.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProposal, PLACEHOLDERS } = require("./changeRules");

const add = (path, params) => ({ path, action: "add", params });
const errors = (commands) => validateProposal({ commands }).errors || [];

test("a WireGuard peer with a generated key is accepted", () => {
  const result = validateProposal({
    commands: [add("/interface wireguard peers", { interface: "wg1", "allowed-address": "10.0.55.20/32", "public-key": PLACEHOLDERS.publicKey, comment: "i_petrov" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.risk, "normal");
  assert.deepEqual(result.placeholders, [PLACEHOLDERS.publicKey]);
});

test("denied menus are refused by path prefix, however the path is spelled", () => {
  for (const path of ["/user", "/user group", "/system script", "/system  reboot", "system/reset-configuration", "/file", "/tool fetch", "/ip service", "/ppp secret", "/certificate", "/container", "/snmp community", "/radius", "/import", "/ip ssh"]) {
    assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
  }
  assert.equal(validateProposal({ commands: [add("/ip firewall address-list", { list: "a", address: "10.0.0.1" })] }).ok, true);
});

test("script fields and literal secrets are refused in any menu", () => {
  assert.match(errors([add("/ppp profile", { name: "p", "on-up": ":log info x" })])[0], /script/);
  assert.match(errors([add("/interface pppoe-client", { name: "isp", password: "Hunter2" })])[0], /secret/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "preshared-key": "abc=" })])[0], /secret/);
  assert.equal(validateProposal({ commands: [add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.publicKey, "preshared-key": PLACEHOLDERS.presharedKey })] }).ok, true);
});

test("a placeholder is allowed only in the field it belongs to", () => {
  assert.match(errors([add("/ip firewall address-list", { list: "a", address: "10.0.0.1", comment: PLACEHOLDERS.publicKey })])[0], /placeholder/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "public-key": "{{anything.else}}" })])[0], /placeholder/);
});

test("shape: action, where, names, values, count", () => {
  assert.match(errors([{ path: "/ip address", action: "print", params: {} }])[0], /action/);
  assert.match(errors([{ path: "/ip address", action: "set", params: { disabled: "yes" } }])[0], /where/);
  assert.match(errors([{ path: "/ip address", action: "add", where: { a: "b" }, params: { address: "10.0.0.1/24" } }])[0], /where/);
  assert.match(errors([add("/ip address", { "bad name": "x" })])[0], /field name/);
  assert.match(errors([add("/ip address", { address: "10.0.0.1/24\n/user add" })])[0], /value/);
  assert.match(errors([add("/ip address", { address: "x".repeat(501) })])[0], /value/);
  assert.match(errors([{ path: "/ip address", action: "remove", where: { address: "10.0.0.1/24" }, params: { comment: "x" } }])[0], /params/);
  assert.match(errors([])[0], /at least one/);
  assert.match(errors(Array.from({ length: 31 }, () => add("/ip dns static", { name: "a", address: "10.0.0.1" })))[0], /30/);
});

test("risk: commands that can cut the device off are flagged, not refused", () => {
  const risky = [
    add("/ip address", { address: "10.0.0.1/24", interface: "ether1" }),
    add("/ip route", { "dst-address": "0.0.0.0/0", gateway: "10.0.0.254" }),
    add("/ip firewall filter", { chain: "input", action: "drop" }),
    { path: "/interface", action: "disable", where: { name: "ether1" } },
    add("/ip firewall nat", { chain: "dstnat", action: "dst-nat" }),
  ];
  for (const command of risky) {
    const result = validateProposal({ commands: [command] });
    assert.equal(result.ok, true, command.path);
    assert.equal(result.risk, "high", command.path);
    assert.ok(result.commands[0].riskReason);
  }
  assert.equal(validateProposal({ commands: [add("/ip firewall filter", { chain: "forward", action: "accept" })] }).risk, "normal");
  assert.equal(validateProposal({ commands: [add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.publicKey })] }).risk, "normal");
});
```

- [ ] **Step 2: Run** `node --test services/mikrotik/changeRules.test.js`. Expected: FAIL, `Cannot find module './changeRules'`.

- [ ] **Step 3: Реализация.** Нормализация пути: `"/" + path.replace(/\//g, " ").trim().split(/\s+/).join(" ")`. `DENIED_PATHS` — список из спецификации; совпадение: путь равен элементу или начинается с `элемент + " "`. Порядок проверок команды: действие → путь → `where` (обязателен для всего, кроме `add`; запрещён для `add`; объект строк, 1–5 пар) → `params` (для `remove`/`enable`/`disable` должен быть пуст; для `add`/`set` — 1–40 пар) → имена полей `/^[a-z0-9][a-z0-9.-]*$/` → значения (строка, без `[\x00-\x1f\x7f]`, длина ≤ 500) → `isScriptField` → подстановки (значение вида `{{…}}` допустимо только `publicKey` в поле `public-key` и `presharedKey` в поле `preshared-key`) → `isSecretField` без подстановки — отказ. Риск: таблица `RISKY` — `{ prefix, when?: (command) => boolean, reason }`; для `/ip firewall filter` и `/ip firewall raw` — `params.chain === "input"`; для `/interface` (ровно) — действия `set`/`remove`/`disable`; остальные префиксы из спецификации — всегда. Ошибки на английском (их читает агент), с номером команды: `command 2: /user is not allowed`.

- [ ] **Step 4: Run** тот же тест. Expected: PASS, 6/6.

---

### Task 3: Сборка строк RouterOS — `changeRender.js`

**Files:**
- Create: `backend/services/mikrotik/changeRender.js`
- Test: `backend/services/mikrotik/changeRender.test.js`

**Interfaces:**
- Consumes: `Command`, `PLACEHOLDERS` (задача 2).
- Produces:
  - `quoteValue(value) → string` — значение для консоли RouterOS;
  - `renderCommand(command, { values = {} } = {}) → string` — исполняемая строка; `values` — `{ [placeholder]: настоящее значение }`;
  - `displayCommand(command) → string` — для человека: подстановка показана как `‹создаст HD›`;
  - `diffRows(command, before) → [{ field, from, to }]` — «было → станет» для `set`.

- [ ] **Step 1: Падающий тест.**

```js
// node --test services/mikrotik/changeRender.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteValue, renderCommand, displayCommand, diffRows } = require("./changeRender");

test("plain values stay bare, anything else is quoted and escaped", () => {
  assert.equal(quoteValue("10.0.55.20/32"), "10.0.55.20/32");
  assert.equal(quoteValue("i_petrov"), "i_petrov");
  assert.equal(quoteValue(""), '""');
  assert.equal(quoteValue("Ivan Petrov"), '"Ivan Petrov"');
  assert.equal(quoteValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteValue("a\\b"), '"a\\\\b"');
  assert.equal(quoteValue("$x"), '"\\$x"');
  assert.equal(quoteValue("a;b"), '"a;b"');
  assert.equal(quoteValue("[find]"), '"[find]"');
  assert.equal(quoteValue("what?"), '"what\\?"');
  assert.equal(quoteValue("kQ3v+a/b="), '"kQ3v+a/b="');
});

test("add, set and remove render as one RouterOS line", () => {
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "add", where: null, params: { list: "vpn-users", address: "10.0.55.20", comment: "Ivan Petrov" } }),
    '/ip firewall address-list add list=vpn-users address=10.0.55.20 comment="Ivan Petrov"',
  );
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "set", where: { list: "under_rsv", address: "10.0.20.116" }, params: { disabled: "yes" } }),
    "/ip firewall address-list set [find where list=under_rsv address=10.0.20.116] disabled=yes",
  );
  assert.equal(
    renderCommand({ path: "/interface wireguard peers", action: "remove", where: { comment: "old; /user add" }, params: {} }),
    '/interface wireguard peers remove [find where comment="old; /user add"]',
  );
});

test("placeholders: real value when executing, a marker when shown to a person", () => {
  const command = { path: "/interface wireguard peers", action: "add", where: null, params: { interface: "wg1", "public-key": "{{wireguard.public-key}}" } };
  assert.equal(renderCommand(command, { values: { "{{wireguard.public-key}}": "kQ3v+a/b=" } }), '/interface wireguard peers add interface=wg1 public-key="kQ3v+a/b="');
  assert.throws(() => renderCommand(command), /placeholder/);
  assert.equal(displayCommand(command), "/interface wireguard peers add interface=wg1 public-key=‹создаст HD›");
});

test("diffRows lists only the fields a set changes", () => {
  const command = { path: "/ip firewall address-list", action: "set", where: { address: "10.0.20.116" }, params: { disabled: "yes", comment: "savin" } };
  assert.deepEqual(diffRows(command, { address: "10.0.20.116", disabled: "false", comment: "savin" }), [{ field: "disabled", from: "false", to: "yes" }]);
  assert.deepEqual(diffRows({ ...command, action: "remove" }, {}), []);
});
```

- [ ] **Step 2: Run.** Expected: FAIL, модуль не найден.
- [ ] **Step 3: Реализация.** Голое значение — только `/^[A-Za-z0-9_.:\/,@-]+$/` (без `=`, `+`, пробела). В кавычках экранируются `\`, `"`, `$`, `?`. `renderCommand` бросает `Error("unresolved placeholder …")`, если после подстановки остался `{{…}}`. `diffRows`: значения роутера `true`/`false` считаются равными `yes`/`no`.
- [ ] **Step 4: Run.** Expected: PASS, 4/4.

---

### Task 4: Шаги утверждения и статусы — `changeSteps.js`

**Files:**
- Create: `backend/services/mikrotik/changeSteps.js`
- Test: `backend/services/mikrotik/changeSteps.test.js`

**Interfaces:**
- Produces:
  - `STATUS = { awaitingRequester, awaitingResponsible, queued, applying, applied, rolledBack, notApplied, rejected, expired, cancelled }` (значения — строки `awaiting_requester`, `awaiting_responsible`, `queued`, `applying`, `applied`, `rolled_back`, `not_applied`, `rejected`, `expired`, `cancelled`); `STATUS_LABELS` (русские подписи из Global Constraints; `queued` показывается как «Применяется»; `cancelled` — «Отозван»);
  - `planSteps({ requesterId, responsibleId, requesterCanApprove, responsibleCanApprove }) → { ok: true, steps: [{ role: "requester" | "responsible", user }] } | { ok: false, reason }`;
  - `currentStep(change) → { role, user } | null`;
  - `decide(change, { userId, decision: "approve" | "reject", channel, comment, canApprove, now }) → { ok: true, patch } | { ok: false, code: "not_yours" | "closed" | "expired" | "no_right" }` — `patch` = `{ status, step: { index, decision, channel, comment, decidedAt } }`;
  - `isOpen(status) → boolean`; `isFinal(status) → boolean`.

- [ ] **Step 1: Падающий тест.**

```js
// node --test services/mikrotik/changeSteps.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { STATUS, planSteps, currentStep, decide } = require("./changeSteps");

const Q = "u-requester";
const R = "u-responsible";

test("steps follow the responsible/requester table", () => {
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: R, requesterCanApprove: false, responsibleCanApprove: true }).steps.map((s) => s.role), ["requester", "responsible"]);
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: Q, requesterCanApprove: true, responsibleCanApprove: true }).steps.map((s) => s.role), ["responsible"]);
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: null, requesterCanApprove: true }).steps.map((s) => s.role), ["requester"]);
  assert.equal(planSteps({ requesterId: Q, responsibleId: null, requesterCanApprove: false }).ok, false);
  assert.equal(planSteps({ requesterId: Q, responsibleId: R, requesterCanApprove: true, responsibleCanApprove: false }).ok, false);
});

const change = (over = {}) => ({
  status: STATUS.awaitingRequester,
  expiresAt: new Date(2_000),
  steps: [{ role: "requester", user: Q, decision: null }, { role: "responsible", user: R, decision: null }],
  ...over,
});
const at = new Date(1_000);

test("the requester confirms without the right, then the responsible approves with it", () => {
  const first = decide(change(), { userId: Q, decision: "approve", channel: "telegram", canApprove: false, now: at });
  assert.equal(first.ok, true);
  assert.equal(first.patch.status, STATUS.awaitingResponsible);
  const second = change({ status: STATUS.awaitingResponsible, steps: [{ role: "requester", user: Q, decision: "approve" }, { role: "responsible", user: R, decision: null }] });
  assert.equal(decide(second, { userId: R, decision: "approve", channel: "portal", canApprove: false, now: at }).code, "no_right");
  assert.equal(decide(second, { userId: R, decision: "approve", channel: "portal", canApprove: true, now: at }).patch.status, STATUS.queued);
});

test("a sole requester step needs the right", () => {
  const solo = change({ steps: [{ role: "requester", user: Q, decision: null }] });
  assert.equal(decide(solo, { userId: Q, decision: "approve", channel: "portal", canApprove: false, now: at }).code, "no_right");
  assert.equal(decide(solo, { userId: Q, decision: "approve", channel: "portal", canApprove: true, now: at }).patch.status, STATUS.queued);
});

test("someone else, a second tap, a closed or expired request change nothing", () => {
  assert.equal(decide(change(), { userId: R, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "not_yours");
  assert.equal(decide(change({ status: STATUS.queued }), { userId: R, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "closed");
  assert.equal(decide(change({ status: STATUS.rejected }), { userId: Q, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "closed");
  assert.equal(decide(change(), { userId: Q, decision: "approve", channel: "telegram", canApprove: true, now: new Date(3_000) }).code, "expired");
});

test("either person rejects on their own step and that is final", () => {
  assert.equal(decide(change(), { userId: Q, decision: "reject", channel: "telegram", canApprove: false, now: at }).patch.status, STATUS.rejected);
  assert.equal(currentStep(change()).user, Q);
  assert.equal(currentStep(change({ status: STATUS.applied })), null);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Реализация.** Чистые функции; сравнение идентификаторов через `String()`. Отклонение права не требует. «Шаг требует права» = роль `responsible` или единственный шаг.
- [ ] **Step 4: Run.** Expected: PASS, 5/5.

---

### Task 5: Данные, право, доступ ключа, категория

**Files:**
- Create: `backend/models/mikrotikChange.js`
- Create: `backend/scripts/grantApproveChanges.js`
- Modify: `backend/models/mikrotik.js` (поле `responsibleId: { type: ObjectId, ref: "User" }`)
- Modify: `backend/models/mikrotikArtifact.js` (`trigger` += `"pre-change"`)
- Modify: `backend/auth/access.js` (`GROUPS`, после `mikrotik.upgradeFirmware`)
- Modify: `backend/middleware/permissions.js` (`canApproveMikrotikChanges`)
- Modify: `backend/services/roles.js` (`needsApproveChangesGrant` по образцу `needsUpgradeFirmwareGrant`)
- Modify: `backend/scripts/migrate.js` (запись `2026-10-10-grantApproveChanges` перед `recomputePluginRoles`), `backend/scripts/roles.catalogue.json`
- Modify: `backend/services/mcp/keys.js`, `backend/models/mcpKey.js`, `backend/types/mcpKey.ts` (`mikrotikChanges`)
- Modify: `backend/services/notificationCategories.js` (`mikrotikChange`), `backend/models/inAppNotification.js` (`EXTRA_KINDS` += `mikrotikChangeStep`, `mikrotikChangeResult`), `backend/models/preferences.js` и `backend/models/user.js` (ключ категории в `notify.*`, как у `reportApproval`)
- Test: `backend/services/roles.test.js` (если есть тест `needsUpgradeFirmwareGrant` — рядом), `backend/services/mcp/keys.test.js`, `backend/validations/mcpKey.test.js`

**Interfaces:**
- Produces: модель `MikrotikChange`:

```js
{
  number: Number,            // сквозной, unique
  mikrotik: ObjectId,        // ref Mikrotik, index
  title: String, reason: String,
  requestedBy: ObjectId,     // User
  requestedVia: { keyId: ObjectId, keyName: String },
  responsible: ObjectId,     // User | null, снимок
  commands: [{ path, action, where: Mixed, params: Mixed, text: String, risk: String, riskReason: String,
               before: Mixed, result: { state: "pending"|"done"|"failed"|"rolled_back"|"skipped", error: String, at: Date } }],
  risk: String, status: String /* STATUS */, expiresAt: Date, remindedAt: Date,
  steps: [{ role, user: ObjectId, decision: "approve"|"reject"|null, channel: String, comment: String, decidedAt: Date }],
  backupArtifact: ObjectId, executor: "safe-mode"|"api", failure: String,
  wireguard: { publicKey: String, privateKey: String /* encryptSecret */, presharedKey: String /* encryptSecret */,
               client: { interface, address, allowedIps: [String], dns: [String], endpoint: String },
               serverPublicKey: String, endpoint: String, keysExpireAt: Date },
  telegram: [{ user: ObjectId, chatId: String, messageId: Number }],  // чтобы убрать кнопки после решения
  timeline: [{ at: Date, kind: String, user: ObjectId, text: String }],
}
```

  индексы: `{ mikrotik: 1, createdAt: -1 }`, `{ status: 1, expiresAt: 1 }`, `{ "steps.user": 1, status: 1 }`; `privateKey`/`presharedKey` — `select: false`. Номер — через существующий счётчик проекта (найти, как нумеруются заявки; если счётчик привязан к заявкам — отдельная коллекция-счётчик `counters` с `findOneAndUpdate({ _id: "mikrotikChange" }, { $inc: { seq: 1 } }, { upsert: true, new: true })`).
- Produces: `MCP_SCOPES` содержит `"mikrotikChanges"`; gate `canApproveMikrotikChanges`.

- [ ] **Step 1: Тесты ключа.** В `keys.test.js` и `validations/mcpKey.test.js` — `mikrotikChanges` принимается в `scopes`; `normalizeScopes(["mikrotikChanges","x"])` → `["mikrotikChanges"]`. Run → FAIL.
- [ ] **Step 2:** правки `keys.js`, `mcpKey.js`, `mcpKey.ts`. Run → PASS.
- [ ] **Step 3: Тест раздачи.** `needsApproveChangesGrant(statements)` истинно только для набора, которому до полного доступа не хватает ровно `mikrotik.approveChanges`. Run → FAIL → реализация → PASS.
- [ ] **Step 4:** словарь (`id: "mikrotik.approveChanges"`, `label`, `audience: "staff"`, `hint` — из Global Constraints), gate, скрипт раздачи (копия `grantUpgradeFirmware.js` с заменой действия и `needs…`), запись в `migrate.js`, каталог ролей.
- [ ] **Step 5:** модель, поля, enum-ы, категория. Run: `node --check` по каждому изменённому файлу и `node --test services/notificationCategories.test.js` (если есть). Expected: чисто.

---

### Task 6: Предложение — `changeProposals.js`

**Files:**
- Create: `backend/services/mikrotik/changeProposals.js`
- Test: `backend/services/mikrotik/changeProposals.test.js`

**Interfaces:**
- Consumes: `validateProposal`, `displayCommand`, `planSteps`, `STATUS`, `redactRow(path, row)` (`liveState.js`).
- Produces: `createProposals({ store, readRows, now }) → { propose(input, caller) → { ok: true, change } | { ok: false, error } }`, где
  - `store = { findDevice(nameOrId), findUserByTelegram(id), canApprove(userId), countOpen(deviceId), countRecentByKey(keyId, sinceDate), nextNumber(), create(doc) }` — единственное место с моделями (реализация в том же файле, экспорт `mongoStore`);
  - `readRows(deviceId, path) → Promise<object[]>` — API-чтение раздела (`/interface/wireguard/peers/print`), через `runOnDevice` из `services/mcp/mikrotikSource.js`;
  - `caller = { keyId, keyName }`.
  - Выбор строки по `where`: точное равенство всех пар; `true/false` ≡ `yes/no`.

- [ ] **Step 1: Падающий тест** (фальшивые `store` и `readRows`):
  - успех: один `add`, заявитель найден, ответственный задан → `change.status === "awaiting_requester"`, `change.commands[0].text` — строка из `displayCommand`, `expiresAt = now + 24 ч`, `timeline[0].kind === "proposed"`;
  - `requester` не найден → `error` содержит `no employee with this Telegram id`;
  - нет ответственного и у заявителя нет права → `error` содержит `no responsible person`;
  - `set` с `where`, который находит 0 строк → `matches no row`; 2 строки → `matches 2 rows`;
  - `set` находит строку → `commands[0].before` равен строке после `redactRow` (поле `preshared-key` скрыто);
  - `add` в `/interface wireguard peers` с `comment`, уже существующим там же → допускается (комментарий не уникален); `add` в `/ip firewall address-list` с той же парой `list`+`address` → `already exists`;
  - 5 открытых запросов на устройстве → `too many open requests`; 20 за час у ключа → `too many proposals`;
  - `wireguardClient` без подстановки `public-key` в командах → `wireguardClient needs a peer with {{wireguard.public-key}}`;
  - `title`/`reason` длиннее 200/1000 — отказ; оба проходят `maskText`.
  Run → FAIL.
- [ ] **Step 2: Реализация.** Порядок: форма → `validateProposal` → устройство → заявитель → `planSteps` → пределы → `readRows` по каждому затронутому разделу (один раз на раздел) → `before`/уникальность → `create`. Уникальность `add` проверяется только по таблице известных ключей: `{ "/ip firewall address-list": ["list","address"], "/ip dns static": ["name","address"], "/ip dhcp-server lease": ["address"], "/interface wireguard peers": ["public-key"] }`; для прочих разделов не проверяется (роутер откажет сам).
- [ ] **Step 3: Run.** Expected: PASS.

---

### Task 7: Исполнитель

**Files:**
- Create: `backend/services/mikrotik/safeModeConsole.js` (+ `.test.js`)
- Create: `backend/services/mikrotik/changeExecutor.js` (+ `.test.js`)
- Uses: `backend/services/mikrotik/__fixtures__/safeMode/*.txt` (задача 1)

**Interfaces:**
- Consumes: `openShell`, `shellLogin` (задача 1); `renderCommand` (задача 3).
- Produces:
  - `safeModeConsole`: `PROMPT` (RegExp конца приглашения), `isSafePrompt(text) → boolean`, `parseEnter(text) → "taken" | "busy" | "unknown"`, `parseReply(text, sentLine) → { ok: true } | { ok: false, error }` — ответ на команду: эхо строки и приглашение отбрасываются; остаток пуст либо это идентификатор новой строки (`*1A`) → успех; любой другой остаток → сбой с этим текстом (Review Focus 5);
  - `createExecutor({ openSession, probe, log }) → { applyCommands(record, lines: string[]) → Promise<{ results: [{ state, error }], rolledBack: boolean, reachable: boolean, executor: "safe-mode" }> }`; `openSession(record) → shell`, `probe(record) → Promise<boolean>` (отдельная API-сессия `/system/identity/print`);
  - запасной: `createApiExecutor({ run })` с тем же результатом и `executor: "api"`, `rolledBack: false`.

- [ ] **Step 1: Тест разбора на записанных ответах** (`__fixtures__`): вход в режим → `taken`; приглашение «Hijacking Safe Mode» → `busy`; ответ на успешный `add` → `ok`; ответ с ошибкой из шага 4 задачи 1 → `{ ok: false, error }` с текстом роутера; неизвестный непустой ответ `"some new warning"` → сбой. Run → FAIL → реализация → PASS.
- [ ] **Step 2: Тест исполнителя на фальшивой оболочке** (скрипт ответов):
  - все команды прошли, `probe → true` → послан второй `\x18`, `results` все `done`, `rolledBack: false`;
  - вторая из трёх упала → оболочка закрыта без второго `\x18`, `results = [rolled_back, failed, skipped]`, `rolledBack: true`;
  - все прошли, `probe → false` → закрыта без `\x18`, все `rolled_back`, `reachable: false`;
  - режим занят → на вопрос отправлено `d`, ни одной команды, `results` все `skipped`, ошибка `safe mode is held by another session`;
  - чтение ответа по таймауту → закрыта без `\x18`, `rolledBack: true`.
  Run → FAIL → реализация → PASS.
- [ ] **Step 3:** после обрыва исполнитель ждёт 5 с и вызывает `probe` — результат в `reachable`. Таймауты: команда 15 с, вся сессия 120 с.

---

### Task 8: Применение — `wireguardConfig.js` и `changeWorker.js`

**Files:**
- Create: `backend/services/mikrotik/wireguardConfig.js` (+ `.test.js`)
- Create: `backend/services/mikrotik/changeWorker.js` (+ `.test.js`)
- Modify: `backend/app.js` (крон рядом с `runUpgradeTick`, каждые 15 с; ещё один — раз в 5 минут для истечения, напоминаний и стирания ключей)

**Interfaces:**
- Consumes: всё из задач 2–7; `createArtifact(record, { trigger: "pre-change", userId })`; `isUpgrading`; `encryptSecret`/`decryptSecret`.
- Produces:
  - `generateKeyPair() → { privateKey, publicKey }` (base64, X25519 через `crypto.generateKeyPairSync("x25519")`, экспорт JWK `d`/`x` → base64url → base64); `generatePresharedKey() → string` (32 случайных байта, base64);
  - `buildClientConfig({ privateKey, address, dns, serverPublicKey, presharedKey, endpoint, allowedIps }) → string`;
  - `createChangeWorker({ store, executor, backup, readRows, notify, now, log }) → { tick(), sweep() }`.

- [ ] **Step 1: Тест `wireguardConfig`.** Ключи: 44 символа base64, оканчиваются на `=`, два вызова дают разные; публичный ключ выводится из приватного (`crypto.createPublicKey`). Конфиг:

```
[Interface]
PrivateKey = <priv>
Address = 10.0.55.20/32
DNS = 10.0.20.1

[Peer]
PublicKey = <server>
PresharedKey = <psk>
AllowedIPs = 10.0.20.0/24
Endpoint = 82.162.57.14:13456
PersistentKeepalive = 25
```

  без `dns` строки `DNS` нет; без PSK строки `PresharedKey` нет. Run → FAIL → реализация → PASS.

- [ ] **Step 2: Тест воркера** (всё фальшивое):
  - `tick` берёт самый старый `queued`, атомарно переводит в `applying` (второй одновременный `tick` его не берёт);
  - устройство обновляется или у него уже есть `applying` → запрос остаётся `queued`;
  - повторная сверка: строка `where` исчезла / стало две / поле из `before`, которое меняет команда, уже другое → `not_applied`, `failure` с причиной, исполнитель не вызван, бэкап не снят (Review Focus 4);
  - бэкап бросил → `not_applied`, исполнитель не вызван;
  - успех → `applied`, `backupArtifact` записан, `commands[].result.state === "done"`, в `timeline` «Снята резервная копия» и «Применено N команд, устройство отвечает», `notify.result` вызван;
  - с `wireguardClient`: исполнителю ушла строка с настоящим публичным ключом; в записи `wireguard.privateKey` зашифрован, `keysExpireAt = now + 24 ч`; в `commands[].text` и `timeline` ключа нет;
  - исполнитель вернул `rolledBack: true` → `rolled_back`, ключи стёрты сразу;
  - `sweep`: открытый запрос с `expiresAt < now` → `expired` + уведомление; за 2 часа до истечения и без `remindedAt` → напоминание текущему шагу, `remindedAt` проставлен; `keysExpireAt < now` → `privateKey`/`presharedKey` обнулены.
  Run → FAIL.
- [ ] **Step 3: Реализация.** Серверный публичный ключ и порт читаются `readRows(deviceId, "/interface wireguard")` по имени интерфейса; `endpoint` = `client.endpoint` или `record.credentials.host + ":" + listen-port`. Любое необработанное исключение в `tick` после перехода в `applying` → `not_applied` с текстом «внутренняя ошибка», чтобы запрос не завис.
- [ ] **Step 4: Run.** Expected: PASS. Затем крон в `app.js`, `node --check app.js`.

---

### Task 9: Уведомления — `changeNotifications.js`

**Files:**
- Create: `backend/services/mikrotik/changeNotifications.js` (+ `.test.js`)
- Modify: `backend/services/inAppNotifications.js` (параметр `force` у `pushInApp`: пропускает `inAppAllowed`)

**Interfaces:**
- Produces:
  - `stepMessage(change, { deviceName, companyName, requesterName, agentName }) → { text, fits: boolean }` — текст из макета; `fits` ложно, если длина > 3500 символов;
  - `stepKeyboard(change, fits) → reply_markup` — `fits`: `[[Утвердить|Подтвердить → mc:a:<id>, Отклонить → mc:r:<id>],[Открыть в HD → url]]`; иначе только ссылка;
  - `resultMessage(change, ctx) → string`;
  - `createChangeNotifier({ users, queue, pushInApp, baseUrl }) → { step(change), decided(change), result(change), expired(change), reminder(change) }`.

- [ ] **Step 1: Тест текстов.** Сообщение шага содержит номер, устройство и компанию, название, «Просит: …», все команды с номерами, для `set` — строку «было: …», риск, срок; для высокого риска — строку «Может оборвать связь с устройством» перед командами. 30 длинных команд → `fits === false`, клавиатура без `mc:`. Подпись первой кнопки: шаг `requester` без права — «Подтвердить», иначе «Утвердить». В текстах нет HTML и нет значения подстановки. Run → FAIL → реализация → PASS.
- [ ] **Step 2: Тест адресатов** по таблице «Уведомления» спецификации (шесть событий). Колокольчик вызывается с `force: true` всегда; Telegram и почта — через существующие проверки `prefs.notify` и `user.notify` (образец — `reportApprovalNotifications.queue`). Письмо шага — только текст и ссылка `/devices/mikrotik/changes/<id>`. Run → FAIL → реализация → PASS.
- [ ] **Step 3: `pushInApp({ force })`.** Тест в существующем `inAppNotifications.test.js`: с `force` запись создаётся при выключенной категории. Run → FAIL → правка → PASS.

---

### Task 10: HTTP-ручки

**Files:**
- Create: `backend/controllers/inventory/mikrotikChange.js`
- Create: `backend/services/mikrotik/changeView.js` (+ `.test.js`)
- Modify: `backend/routes/internal/inventory/mikrotik.js`
- Modify: `backend/services/pulseTopics.js` (модель `MikrotikChange` → тема `mikrotikChanges`, `user` — нет; плюс явный `bump({ userIds })` участникам)
- Modify: `backend/controllers/inventory/mikrotik.js` (приём и выдача `responsibleId`; список кандидатов — `permissionHolders` по `mikrotik.approveChanges`)

**Interfaces:**
- Produces (все под сессией):
  - `GET /mikrotik-devices/records/:recordId/changes` — список;
  - `GET /mikrotik-changes/:id` — запрос;
  - `POST /mikrotik-changes/:id/decision` `{ decision, comment }`;
  - `POST /mikrotik-changes/:id/cancel` (заявитель, пока запрос открыт);
  - `GET /mikrotik-changes/:id/wireguard.conf` — `text/plain`, `Content-Disposition: attachment`; строка в `timeline`;
  - `GET /mikrotik-changes/awaiting-me` — для главной;
  - `changeView.toView(change, viewer) → object` — что отдаётся: `viewer = { userId, canApprove, canManageConfigs }`. Участник или носитель одного из прав видит всё, кроме ключей; иной с `mikrotik.read` — `number`, `title`, `status`, даты, без `commands`, `reason`, `timeline`. Поле `my = { step: boolean, action: "confirm" | "approve" | null, canCancel, canDownload }`.

- [ ] **Step 1: Тест `changeView`**: три вида смотрящего; `my.action` для заявителя без права на первом шаге — `confirm`, для ответственного — `approve`; `canDownload` только у участника при `applied` и живых ключах; в выдаче нет `privateKey`/`presharedKey` ни при каком смотрящем. Run → FAIL → реализация → PASS.
- [ ] **Step 2: Контроллер.** `decision` → `decide(...)` из задачи 4 → атомарное `findOneAndUpdate({ _id, status: <прежний> }, …)`; `matchedCount === 0` → 409 «Запрос уже решён» (Review Focus 3). Коды: `not_yours` → 403, `closed` → 409, `expired` → 410, `no_right` → 403. После записи — `notifier.decided` / `notifier.step` следующему.
- [ ] **Step 3: Тест контроллера** заглушками `req`/`res` (образец — `routes/mcp.test.js`): двойной вызов `decision` — второй получает 409 и не вызывает уведомления; скачивание конфигурации чужим — 403; после `keysExpireAt` — 410.
- [ ] **Step 4:** маршруты, pulse, `responsibleId` в форме записи (валидация: у выбранного есть право). `node --check` затронутых файлов.

---

### Task 11: Бот

**Files:**
- Modify: `backend/routes/bot.js`, `backend/controllers/bot.js` (`POST /api/bot/mikrotik-changes/:id/decision` с `attachTelegramActor`; тот же сервис решения, `channel: "telegram"`)
- Modify: `backend/controllers/bot.js#outboxAck` или `outbox` — сохранить `messageId` доставленного сообщения шага в `change.telegram[]` (посмотреть, возвращает ли tg-service `message_id` в `DeliveryOutcome`; если нет — добавить поле)
- Modify: `tg-service/src/api/backend.ts` (`decideMikrotikChange(actor, id, decision)`), `tg-service/src/bot/index.ts` (префикс `mc:`), `tg-service/src/workers/outbox.ts` (вернуть `message_id`)

**Interfaces:**
- Callback data: `mc:a:<id>` (утвердить → показать «Вы уверены?»), `mc:y:<id>` (да, применить), `mc:b:<id>` (назад), `mc:r:<id>` (отклонить). Идентификатор — 24 hex, строка ≤ 64 байт.
- Ответ бэкенда: `{ ok, text }` — `text` заменяет сообщение после решения («Вы утвердили запрос № 14. HD снимет резервную копию и применит команды.»).

- [ ] **Step 1: tg-service.** `mc:a:` — только в личном чате; `editMessageText` на текст подтверждения из макета («Применить N команд на роутере? …») с клавиатурой `[[Да, применить → mc:y, Назад → mc:b]]`; исходный текст бот берёт у бэкенда (`GET /api/bot/mikrotik-changes/:id/message` → `{ text, keyboard, confirmText }`), а не хранит. `mc:b:` — вернуть исходное. `mc:y:` и `mc:r:` — вызвать бэкенд; ответить `answerCallbackQuery` один раз: при отказе — `show_alert` с текстом причины («Это решение не за вами», «Запрос уже решён», «Запрос истёк»); при успехе — заменить сообщение на `text` без кнопок.
- [ ] **Step 2: Бэкенд.** Ручки `message` и `decision`. После решения с портала кнопки в Telegram убираются: `notifier.decided` ставит в outbox «правку» сообщений из `change.telegram[]` — посмотреть, умеет ли outbox редактирование (табло статусов это делает); если нет — отправляется новое сообщение-итог, а старое обезвреживается проверкой статуса при нажатии.
- [ ] **Step 3: Проверка.** `pnpm --dir tg-service exec tsc --noEmit`; `node --check` бэкенда. Expected: чисто.

---

### Task 12: Инструменты MCP

**Files:**
- Create: `backend/services/mcp/mikrotikChangeTools.js` (+ `.test.js`)
- Modify: `backend/services/mcp/server.js`, `backend/routes/mcp.js`, `backend/routes/mcp.test.js`

**Interfaces:**
- Consumes: `createProposals(...).propose`, `STATUS_LABELS`, `errorResult`/`textResult`, `deviceLink`.
- Produces: `createMikrotikChangeTools({ proposals, store, baseUrl, log }) → { propose, get, list }`; семья `mikrotikChanges` = scope `mikrotikChanges` И `modules.mikrotik`.

- [ ] **Step 1: Тест инструментов.** `propose` → текст с «Request № 14», статусом, «waiting for: Алексей Савин», ссылкой `/devices/mikrotik/changes/<id>`, строкой «Nothing is applied until people approve it in HD.»; отказ — `isError` с причинами по одной на строку. `get` → статус, шаги с именами и временем, результат по командам, для `applied` с конфигурацией — «WireGuard configuration: <ссылка> (sign-in required, available until …)»; в выводе нет ключей. `list` — по устройству и статусу, до 20 строк. Каждый вызов логируется с `keyId`, `keyName`, устройством, числом команд. Run → FAIL → реализация → PASS.
- [ ] **Step 2: Регистрация.** Схемы: `commands` — массив 1–30 объектов `{ path, action (enum), where?, params? }` с `additionalProperties: false`; `requester` — integer; `title` 1–200; `reason` 1–1000; `wireguardClient` — по спецификации. Аннотации `propose`: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }`. В `INSTRUCTIONS.mikrotik` строка «Access is read-only…» заменяется условной; новый блок `INSTRUCTIONS.mikrotikChanges` — из спецификации («Инструменты MCP»).
- [ ] **Step 3: `routes/mcp.test.js`.** Семья видна только при scope + модуле; ключ с одним `mikrotik` не видит `propose_mikrotik_change`. Run → PASS.

---

### Task 13: Интерфейс (по макету)

Вёрстка повторяет макет; тексты — дословно. Сначала проверить каталог `components/app` (Panel, PropRow, ConfirmDialog, QrCode, AnchorRail, HealthRow) — новое писать только там, где готового нет.

**Files:**
- Create: `frontend/src/pages/Mikrotik/Change.jsx`, `frontend/src/components/Mikrotik/ChangesSection.jsx`, `ChangeCommands.jsx`, `ChangeSteps.jsx`, `ChangeTimeline.jsx`, `ChangeWireguard.jsx`, `frontend/src/components/Dashboard/AgentChanges.jsx`
- Create: `frontend/src/util/mikrotik-changes.ts` (+ `.test.js`) — подписи и тона статусов, подпись кнопки шага, «осталось N ч»
- Create: `frontend/src/store/mikrotik-changes.ts`
- Modify: `frontend/src/App.jsx` (маршрут `/devices/mikrotik/changes/:id`), `pages/Mikrotik/Record.jsx` (пункт рейла «Изменения» после «Конфигурации»), `components/Mikrotik/DeviceForm.jsx` («Ответственный»), `pages/Dashboard.jsx` (блок первым в левой колонке, прямым ребёнком — раскладка на CSS-селекторах), `components/Notifications/*` (виды `mikrotikChangeStep`, `mikrotikChangeResult`), `components/Preferences/McpKeys.jsx` + `util/mcp-keys.ts` + `types/mcpKey.ts` (флажок), настройки уведомлений (категория «Запросы ИИ-агентов по Mikrotik»)

- [ ] **Step 1: Тест `mikrotik-changes.ts`** — статус → подпись и тон; `my.action` → «Подтвердить»/«Утвердить»; остаток срока («до завтра, 12:38», «осталось 3 ч»). Run → FAIL → реализация → PASS.
- [ ] **Step 2: Страница запроса.** Крошки (`view-page-breadcrumbs`), герой, две колонки на десктопе (команды, «Зачем» | «Утверждение», «Сведения», «Хроника»), на телефоне одна колонка в том же порядке. Блок «Конфигурация для сотрудника» — первым при `my.canDownload`. Команды — тёмный блок как `FixCommand`. Диалог «Применить N команд на <устройство>?» через `app/ConfirmDialog`. Отклонение — диалог с необязательным комментарием. Живое обновление — `useLiveTopic("mikrotikChanges")`, без своего интервала.
- [ ] **Step 3: Раздел устройства, главная, колокольчик, три настройки.**
- [ ] **Step 4: Проверки.** `pnpm --dir frontend lint`; `pnpm --dir frontend typecheck` (допустима только известная ошибка FormWrapper); `node --test src/util/mikrotik-changes.test.js src/util/mcp-keys.test.js`.

---

### Task 14: Документация

**Files:**
- Create: `docs/mikrotik-changes.md` (английский, без интерфейса: модель, статусы, правила приёма, исполнитель, безопасность, пределы, известные ограничения, таблица тестов)
- Modify: `docs/mcp.md` (семья `mikrotikChanges`, три инструмента), `docs/mikrotik-management.md` (ссылка, политика `write` у учётной записи), `docs/notifications.md` (категория, правило «колокольчик всегда»), `docs/deployment.md` (миграция раздачи права), `docs/ux-ui-changelog.md`

- [ ] **Step 1:** написать; проверить, что названия функций и путей в доках совпадают с кодом (`grep`).

---

### Task 15: Проверка на проде (владелец + агент)

- [ ] Выкат; миграция `grantApproveChanges` прошла, роль администратора осталась полной.
- [ ] `F1-VLD-GW01`: назначить ответственного; ключу агента — «Изменения Mikrotik».
- [ ] Предложить пир WireGuard (как в спецификации) → подтверждение заявителя в Telegram → утверждение ответственного на портале → «Применён»; пир есть на роутере; `.conf` скачивается и подключается; приватного ключа нет ни в ответах MCP, ни в логах бэкенда (`docker logs hd-backend-1 | grep <первые 8 символов ключа>` → пусто).
- [ ] Отклонение на первом шаге; на втором; истечение (временно `expiresAt` через минуту — правкой в БД владельцем).
- [ ] Сбой: запрос из двух команд, вторая — дубль записи address-list → «Откачен», первая команда на роутере отсутствует.
- [ ] Запретное: `/user add …`, литеральный `preshared-key`, `on-up` → отказ агенту с причиной.
- [ ] Чужой Telegram нажимает кнопку пересланного сообщения → «Это решение не за вами».
- [ ] Уборка: удалить тестовый пир запросом через агента.

## Порядок и зависимости

1 → (2, 3, 4 независимы) → 5 → 6 → 7 (нужны записи из 1) → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15. Задачу 1 можно выкатить отдельно и ждать прогона, выполняя 2–6.
