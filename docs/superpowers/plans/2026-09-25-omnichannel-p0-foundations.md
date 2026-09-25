# Omnichannel «Диалоги» — P0 Backend Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the «Диалоги» UI (P1) and the messenger gateway (P1–P4) will stand on: data model, one ingest path for channel events, mirroring into tickets, the outbound queue, the gateway API, the staff API, permissions, the module switch, live updates and notifications — backend only, verified by unit tests and a dev smoke run.

**Architecture:** New models (`Channel`, `ChannelIdentity`, `Conversation`, `Message`, `ChannelJob`, `ConversationRead`). Pure rules (`services/messaging/rules.js`, `events.js`, `visibility.js`, `present.js`, the pure halves of `identity.js` and `jobs.js`) carry every decision and are unit-tested; thin model services (`ingest`, `mirror`, `bindings`, `outbound`, `origin`, `notify`) execute them and are verified by `scripts/smokeMessaging.js` against the dev database. The gateway talks to `/api/gateway/*` (shared secret, mounted before `attachSession`, like `/bot`); staff talk to `/api/conversations*`, `/api/identities*`, `/api/channels*` behind the module switch and `conversation.*` permissions.

**Tech Stack:** Node 24 CommonJS, Express 5, Mongoose 9, MongoDB 8 standalone (no transactions), `node:test`, multer + `services/storage.js` (S3 or local), in-process pulse bus.

**Spec:** `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` (mockup rev. 2: https://claude.ai/artifact/FN258HRxCzAUV7JV36HEem)

## Global Constraints

- **No commits, no staging** — the owner commits by hand. Each task ends with a checkpoint (tests green), not a commit.
- pnpm only; no new dependencies in P0.
- Backend tests: `cd backend && NODE_ENV=production pnpm test` (root-owned `backend/logs` breaks the logger otherwise); one file: `cd backend && NODE_ENV=production node --test <file>`. Syntax check for untested files: `node --check <file>` (backend eslint is broken).
- Unit-tested modules must not `require` models, `utils/logger` or `middleware/errorHandling` at module top — inject dependencies or require lazily inside functions.
- Code comments in Russian (repo convention); `docs/messaging.md` in English, no UI.
- Networks: `telegram | whatsapp | max | site`. Gateway networks: `telegram | whatsapp`. Conversation kinds: `direct | group | form`.
- Message directions: `in | out | system`. Origins: `client | staff | hd | device | form | system`. Statuses: `received | queued | sent | delivered | read | failed`.
- Ticket sources for networks: `telegram → "Telegram"`, `whatsapp → "WhatsApp"`, `max → "MAX"`, `site → "Сайт"`.
- Permissions: `conversation.read` «Видеть диалоги», `conversation.reply` «Отвечать в диалогах», `conversation.manage` «Вести диалоги» — all `audience: "staff"`. Channel settings reuse `settings.manage`.
- Module switch: `Preferences.modules.messaging.isActive` (default `false`). Notification category: `conversationMessage` (in-app only in v1).
- Pulse topic: `conversations` (staff only — NOT in `CLIENT_TOPICS`).
- Gateway secret: env `MSG_GATEWAY_TOKEN`, header `X-Gateway-Token`; empty env = every gateway request is refused.
- Identity links only by hard evidence (Telegram id = `User.telegramBot.chatId`, phone via `findApplicantByPhone`, manual). Never by name or username.
- Client-visible payloads carry names only: the Comment `channel` block has no phone, username or external id of a person.
- Every Comment creator `$push`/`$addToSet`es its `_id` into `ticket.comments` (the UI reads only that array).
- Deleting data in scripts: count first, then delete by an explicit `_id` list; never a blind `deleteMany`.
- Out of scope in P0: any frontend code, the gateway service itself, MAX webhooks, the site-form endpoint (their adapters come in P1–P5; P0 only prepares the contract).

## Review Focus

1. **The same event delivered twice** (gateway retries after a timeout) must produce one `Message` and at most one mirrored `Comment` — pinned by the smoke run (Task 13, step "replay") and by the unique index + `effects` flags (Task 9).
2. **Our own sent message echoed back before the ack** must not become a second «с телефона» message — pinned by `confirmOwnMessage` via `jobId` (Task 9) and the smoke step "echo before ack".
3. **A client writes after the bound ticket was closed** — nothing is written into the closed ticket; the conversation gets the «по заявке №X?» decision — pinned by `decideAttach` tests (Task 5) and the smoke step "after close".
4. **An older failed job in a conversation** must hold back newer jobs of the same conversation (message order) — pinned by `pickHeads` tests (Task 8).
5. **A client session reading a ticket** must not see a staff member's contacts or a person's messenger handle in the mirrored comment — pinned by the `commentChannel` test (Task 6).

---

## File Structure

**Backend — create**
- `backend/models/channel.js`, `channelIdentity.js`, `conversation.js`, `message.js`, `channelJob.js`, `conversationRead.js` — the six models.
- `backend/types/messaging.ts` — TS interfaces of the six models.
- `backend/services/messaging/rules.js` (+ test) — constants and pure rules.
- `backend/services/messaging/events.js` (+ test) — normalized event validation.
- `backend/services/messaging/visibility.js` (+ test) — who sees which conversation; queue filters.
- `backend/services/messaging/present.js` (+ test) — API rows and the Comment `channel` block.
- `backend/services/messaging/identity.js` (+ test) — sender → identity → user.
- `backend/services/messaging/jobs.js` (+ test) — outbox/commands queue.
- `backend/services/messaging/conversationStore.js` — sequence numbers and system lines.
- `backend/services/messaging/mirror.js` — message → ticket comment.
- `backend/services/messaging/bindings.js` — bind/unbind, end on close, restore on reopen.
- `backend/services/messaging/notify.js` — «ждёт ответа» in-app notice.
- `backend/services/messaging/ingest.js` — one entry for all channel events.
- `backend/services/messaging/outbound.js` — replies from HD (inbox and ticket).
- `backend/services/messaging/origin.js` — ticket created from a conversation; delivery routes.
- `backend/middleware/isGateway.js` (+ test), `backend/routes/gateway.js`, `backend/controllers/gateway.js`.
- `backend/routes/internal/conversation.js`, `backend/controllers/conversation.js`, `backend/controllers/channel.js`.
- `backend/scripts/grantConversations.js`, `backend/scripts/initMessaging.js`, `backend/scripts/smokeMessaging.js`.
- `docs/messaging.md`.

**Backend — modify**
- `backend/auth/access.js`, `backend/auth/access.test.js`, `backend/services/actionMigration.js` (+ test), `backend/scripts/migrate.js`, `backend/scripts/roles.catalogue.json`.
- `backend/middleware/modules.js`, `backend/middleware/permissions.js`.
- `backend/models/preferences.js`, `backend/controllers/preferences.js`, `backend/types/preferences.ts`, `backend/models/user.js`, `backend/types/user.ts`.
- `backend/services/notificationCategories.js` (+ test), `backend/services/inAppNotifications.js` (+ test), `backend/middleware/notifications.js`.
- `backend/models/comment.js`, `backend/types/comment.ts`, `backend/models/ticket.js`, `backend/types/ticket.ts`.
- `backend/services/pulse.js`, `backend/services/pulseTopics.js`.
- `backend/services/storage.js` (+ test).
- `backend/routes/index.js`, `backend/app.js`, `backend/controllers/ticket.js`, `backend/controllers/comment.js`.
- `sync-dev-db.sh`, `.env.example`.

---

### Task 1: Permissions `conversation.*` and their one-time grant

**Files:**
- Modify: `backend/auth/access.js` (new group after the `tickets` group, ~line 102)
- Modify: `backend/auth/access.test.js:19-44`
- Modify: `backend/services/actionMigration.js`, `backend/services/actionMigration.test.js`
- Create: `backend/scripts/grantConversations.js`
- Modify: `backend/scripts/migrate.js` (append entry), `backend/scripts/roles.catalogue.json`

**Interfaces:**
- Produces: actions `conversation.read`, `conversation.reply`, `conversation.manage`; `conversationGrants({ key, audience, actions }) → string[]` in `services/actionMigration.js`; migration id `2026-09-25-grantConversations`.

- [ ] **Step 1: Write the failing tests**

In `backend/auth/access.test.js` replace the first test's counts and the label regex, and add an audience check:

```js
test("dictionary has 17 groups and 59 actions in the agreed order", () => {
  assert.equal(GROUPS.length, 17);
  assert.equal(ALL_ACTIONS.length, 59);
  assert.deepEqual(ALL_ACTIONS.slice(0, 8), [
    "ticket.readCompanies",
    "ticket.readAll",
    "ticket.perform",
    "ticket.join",
    "ticket.manage",
    "ticket.delete",
    "ticket.createForOthers",
    "ticket.closeWithoutWork",
  ]);
  // «Диалоги» — сразу за заявками: это та же работа с клиентом
  assert.equal(GROUPS[1].key, "conversations");
  assert.deepEqual(
    GROUPS[1].actions.map((action) => action.id),
    ["conversation.read", "conversation.reply", "conversation.manage"],
  );
  assert.equal(ALL_ACTIONS.at(-1), "settings.manage");
  // «ИИ» — предпоследняя группа: настройки замыкают словарь
  assert.equal(GROUPS.at(-2).key, "ai");
  assert.deepEqual(
    GROUPS.at(-2).actions.map((action) => action.id),
    ["ai.use"],
  );
});
```

In the test "every action has an audience; clientHint only on both" add `Отвечать` to the verb list of the regex:

```js
      assert.match(action.label, /^(Видеть|Изменять|Брать|Вести|Удалять|Заводить|Закрывать|Записывать|Согласовывать|Управлять|Входить|Модерировать|Запускать|Присоединяться|Пользоваться|Отвечать) /, action.id);
```

In "audiences of the spec's special cases" add:

```js
  // Переписка с клиентом — инструмент сотрудника
  assert.equal(audienceOfAction("conversation.read"), "staff");
  assert.equal(audienceOfAction("conversation.reply"), "staff");
  assert.equal(audienceOfAction("conversation.manage"), "staff");
```

In `backend/services/actionMigration.test.js` add `conversationGrants` to the import list and append:

```js
test("conversation grants follow ticket work, never outside performers or clients", () => {
  const role = (key, actions, audience = "staff") => ({ key, audience, actions });

  // Администратор ведёт заявки — получает все три и остаётся полным доступом
  assert.deepEqual(
    conversationGrants(role("admin", ["ticket.perform", "ticket.manage"])),
    ["conversation.read", "conversation.reply", "conversation.manage"],
  );
  // Первая и вторая линия берут заявки — читают и отвечают
  assert.deepEqual(conversationGrants(role("it-first-line", ["ticket.perform"])), [
    "conversation.read",
    "conversation.reply",
  ]);
  // Сторонний исполнитель — нет, как и с ai.use
  assert.deepEqual(conversationGrants(role("contractor-no-works", ["ticket.perform"])), []);
  // Модератор базы знаний заявок не берёт — переписки нет
  assert.deepEqual(conversationGrants(role("kb-moderator", ["knowledge.moderate"])), []);
  // Клиентской роли действия сотрудника не выдаются
  assert.deepEqual(conversationGrants(role("client-admin", ["ticket.perform"], "client")), []);
  // Повторный прогон ничего не добавляет
  assert.deepEqual(
    conversationGrants(role("it-first-line", ["ticket.perform", "conversation.read", "conversation.reply"])),
    [],
  );
});

test("conversation grants are not derived on every migration run", () => {
  assert.ok(!DERIVED.some((rule) => rule.add.some((id) => id.startsWith("conversation."))));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && NODE_ENV=production node --test auth/access.test.js services/actionMigration.test.js`
Expected: FAIL — `16 !== 17`, and `conversationGrants is not a function`.

- [ ] **Step 3: Add the group to the dictionary**

In `backend/auth/access.js`, insert right after the closing `},` of the group with `key: "tickets"`:

```js
  {
    // Переписка с клиентами из мессенджеров и формы сайта — раздел «Диалоги».
    // Видимость повторяет ярусы заявок (services/messaging/visibility.js);
    // неопознанных собеседников видят все, кто видит диалоги: их разбирают.
    key: "conversations",
    label: "Диалоги",
    actions: [
      {
        id: "conversation.read",
        label: "Видеть диалоги",
        audience: "staff",
        hint: "Раздел «Диалоги»: переписка с клиентами в Telegram, WhatsApp, MAX и с формы сайта — своих компаний или всех, как у заявок.",
      },
      {
        id: "conversation.reply",
        label: "Отвечать в диалогах",
        audience: "staff",
        hint: "Писать клиенту из «Диалогов» и отвечать из заявки через мессенджер.",
      },
      {
        id: "conversation.manage",
        label: "Вести диалоги",
        audience: "staff",
        hint: "Назначать ответственного, привязывать диалог к заявке, связывать собеседника с пользователем, скрывать диалоги.",
      },
    ],
  },
```

- [ ] **Step 4: Add the grant rule**

In `backend/services/actionMigration.js`, after `receivesAiUse`:

```js
// Разовая раздача прав «Диалогов» (2026-09-25). Не в DERIVED — по той же
// причине, что и ai.use: правило сработало бы на каждом будущем прогоне и
// вернуло бы право роли, с которой владелец его снял.
const CONVERSATION_ACTIONS = ["conversation.read", "conversation.reply", "conversation.manage"];

/** Какие действия «Диалогов» роль получает при раздаче; [] — никаких. */
const conversationGrants = ({ key, audience, actions = [] }) => {
  if (audience === "client" || OUTSIDE_PERFORMER_ROLES.includes(key)) return [];
  const grants = [];
  if (actions.includes("ticket.perform") || actions.includes("ticket.manage")) {
    grants.push("conversation.read", "conversation.reply");
  }
  if (actions.includes("ticket.manage")) grants.push("conversation.manage");
  return grants.filter((id) => !actions.includes(id));
};
```

and export `CONVERSATION_ACTIONS` and `conversationGrants` from `module.exports`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test auth/access.test.js services/actionMigration.test.js`
Expected: PASS.

- [ ] **Step 6: Write the grant script**

Create `backend/scripts/grantConversations.js` (same shape as `grantAiUse.js`, several actions per role):

```js
// Разовая раздача прав «Диалогов» (`conversation.*`) живым ролям, 2026-09-25.
//
// Кто что получает — `conversationGrants` (services/actionMigration.js):
// берущие заявки — читать и отвечать, ведущие заявки — ещё и вести; сторонний
// исполнитель и клиентские роли — ничего.
//
// ТОЛЬКО ДОПИСЫВАЕТ: наборы ролей, правленные из интерфейса, не трогаем. Без
// раздачи роль администратора отстала бы от словаря, перестала считаться полным
// доступом (`isFullAccess`), и зеркало `isAdmin` погасло бы у всех
// администраторов при первой же правке ролей.
//
// Идемпотентен. Запуск внутри контейнера бэкенда:
//   node scripts/grantConversations.js            # показать
//   node scripts/grantConversations.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { refreshMirrorFor } = require("@/services/roles");
const { conversationGrants, flattenStatements } = require("@/services/actionMigration");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — раздавать некому");

  const rows = await db.collection("organizationRole").find({ organizationId: orgId }).toArray();

  const changes = [];
  for (const row of rows) {
    let stored = {};
    try {
      stored = JSON.parse(row.permission || "{}");
    } catch {
      console.log(`  ${row.role}: permission не разбирается, пропуск`);
      continue;
    }
    const grants = conversationGrants({
      key: row.role,
      audience: row.audience,
      actions: flattenStatements(stored),
    });
    console.log(`  ${grants.length ? "+" : " "} ${row.role} «${row.title || row.role}»${grants.length ? `: ${grants.join(", ")}` : ""}`);
    if (!grants.length) continue;
    const next = { ...stored };
    for (const id of grants) {
      const [resource, action] = id.split(".");
      next[resource] = [...new Set([...(next[resource] || []), action])];
    }
    changes.push({ row, permission: JSON.stringify(next) });
  }

  if (!apply) {
    console.log(
      changes.length
        ? `\nПоказ без записи: права получат роли, отмеченные «+» (${changes.length}). Повторите с --apply.`
        : "\nМенять нечего.",
    );
    await mongoose.disconnect();
    return;
  }

  for (const { row, permission } of changes) {
    await db
      .collection("organizationRole")
      .updateOne({ _id: row._id }, { $set: { permission, updatedAt: new Date() } });
  }
  invalidateRoles();
  for (const { row } of changes) {
    await refreshMirrorFor(orgId, row.role);
  }

  console.log(`\nРолей дополнено: ${changes.length}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 7: Register the migration and update the role catalogue**

In `backend/scripts/migrate.js` append to `MIGRATIONS` (after `2026-09-21-grantAiUse`, never reorder):

```js
  { id: "2026-09-25-grantConversations", script: "grantConversations.js", apply: true },
```

Update `backend/scripts/roles.catalogue.json` by the same rule (run from `backend/`):

```bash
node -e '
const fs = require("fs");
const { conversationGrants } = require("./services/actionMigration");
const file = "scripts/roles.catalogue.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const role of data.roles) {
  const grants = conversationGrants({ key: role.key, audience: role.audience, actions: role.actions || [] });
  if (grants.length) role.actions = [...role.actions, ...grants];
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' && git diff --stat scripts/roles.catalogue.json
```

Expected diff: `admin` +3, `it-first-line` +2, `it-second-line` +2; nothing else. If `git diff` shows reformatting of untouched lines, restore the file and add the actions by hand instead (the catalogue is data dumped by `dumpRoleCatalogue.js`; only the new action strings may change).

- [ ] **Step 8: Apply on dev and check full access**

Run (dev stack up):
```bash
docker compose exec backend node scripts/grantConversations.js
docker compose exec backend node scripts/grantConversations.js --apply
docker compose exec backend node scripts/migrate.js mark 2026-09-25-grantConversations
```
Expected: the dry run lists `+ admin … conversation.read, conversation.reply, conversation.manage`; after `--apply`, `node scripts/dumpEffectivePermissions.js` (if present) or `/api/me` of an admin shows the three actions, and admins keep `isAdmin`.

- [ ] **Step 9: Checkpoint**

Run: `cd backend && NODE_ENV=production pnpm test` — all green. No commit.

---

### Task 2: Module switch, notification category, settings fields

**Files:**
- Modify: `backend/models/preferences.js` (`modules`, `notify.personal`), `backend/types/preferences.ts`
- Modify: `backend/controllers/preferences.js:413-426`
- Modify: `backend/models/user.js` (`notify.inApp`), `backend/types/user.ts`
- Modify: `backend/middleware/modules.js`, `backend/middleware/permissions.js`
- Modify: `backend/services/notificationCategories.js`, `backend/services/notificationCategories.test.js`
- Create: `backend/scripts/initMessaging.js`; modify `backend/scripts/migrate.js`

**Interfaces:**
- Produces: `messagingModuleIsActive` (middleware), `canReadConversations`, `canReplyConversations`, `canManageConversations` (gates from `middleware/permissions.js`), category `"conversationMessage"`.

- [ ] **Step 1: Write the failing test**

In `backend/services/notificationCategories.test.js` append:

```js
test("conversation messages are a category of their own", () => {
  const { CATEGORIES, parseCategories } = require("./notificationCategories");
  assert.ok(CATEGORIES.includes("conversationMessage"));
  assert.deepEqual(parseCategories("conversationMessage"), ["conversationMessage"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_ENV=production node --test services/notificationCategories.test.js`
Expected: FAIL — `false == true`.

- [ ] **Step 3: Add the category and the fields**

`backend/services/notificationCategories.js` — append to `CATEGORIES` after `"reportDecision"`:

```js
  // Новое сообщение в «Диалогах», которое ждёт ответа (services/messaging/notify.js).
  // Только канал «в приложении»: письмо и бот о сообщении из мессенджера — шум.
  "conversationMessage",
```

`backend/models/preferences.js` — in `notify.personal` after `reportDecision`:

```js
      // «Диалоги»: сообщение клиента, которое ждёт ответа. Включено сразу —
      // модуль сам выключен по умолчанию (modules.messaging)
      conversationMessage: { type: Boolean, default: true },
```

and in `modules` after `mikrotik`:

```js
    // «Диалоги»: переписка из Telegram, WhatsApp, MAX и формы сайта в HD
    messaging: { isActive: { type: Boolean, default: false } },
```

`backend/models/user.js` — in `notify.inApp` after `reportDecision`:

```js
        conversationMessage: { type: Boolean, default: true },
```

(`byTelegram`/`byEmail` get no field: the category has no such channels in v1.)

`backend/controllers/preferences.js` — in the `has("modules")` block, add to the rebuilt object after `mikrotik`:

```js
        messaging: { isActive: !!modules.messaging?.isActive },
```

`backend/types/preferences.ts` — next to the existing `reportDecision` flag of the personal-notifications interface add `conversationMessage?: boolean;`, and next to the existing `mikrotik` module add `messaging?: { isActive?: boolean };`. `backend/types/user.ts` — in the in-app notify map next to `reportDecision` add `conversationMessage?: boolean;`. (Find the exact spots with `grep -n "reportDecision\|mikrotik" backend/types/preferences.ts backend/types/user.ts`.)

- [ ] **Step 4: Add the module gate and the permission gates**

`backend/middleware/modules.js` — after `knowledgeBaseModuleIsActive`:

```js
module.exports.messagingModuleIsActive = moduleGate(
  "modules.messaging.isActive",
  'Модуль "Диалоги" отключен.',
);
```

`backend/middleware/permissions.js` — after `canManageSettings`:

```js
// --- «Диалоги» -------------------------------------------------------------

module.exports.canReadConversations = requirePermission(
  { conversation: ["read"] },
  PAGE,
);
module.exports.canReplyConversations = requirePermission(
  { conversation: ["reply"] },
  "Недостаточно прав, чтобы отвечать в диалогах",
);
module.exports.canManageConversations = requirePermission(
  { conversation: ["manage"] },
  "Недостаточно прав, чтобы вести диалоги",
);
```

Check that the module re-export block at the end of `permissions.js` (the one that re-exports `./modules`) also re-exports `messagingModuleIsActive`; if it lists names explicitly, add it there.

- [ ] **Step 5: Settings default for existing installs**

Create `backend/scripts/initMessaging.js`:

```js
// «Диалоги», 2026-09-25: категория уведомлений включена у существующих установок.
// Mongoose подставляет default только при чтении документа моделью, а
// колокольчик читает настройки через lean() — без записи поля категория
// оставалась бы выключенной. Модуль при этом не трогаем: он включается руками.
//
// Идемпотентен:
//   node scripts/initMessaging.js           # показать
//   node scripts/initMessaging.js --apply   # записать
require("module-alias/register");
const mongoose = require("mongoose");

const run = async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const preferences = mongoose.connection.db.collection("preferences");
  const filter = { "notify.personal.conversationMessage": { $exists: false } };
  const count = await preferences.countDocuments(filter);
  console.log(`Настроек без категории «Диалоги»: ${count}`);
  if (apply && count) {
    await preferences.updateMany(filter, { $set: { "notify.personal.conversationMessage": true } });
    console.log("Категория включена.");
  }
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Append to `MIGRATIONS` in `backend/scripts/migrate.js`:

```js
  { id: "2026-09-25-initMessaging", script: "initMessaging.js", apply: true },
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && NODE_ENV=production node --test services/notificationCategories.test.js && node --check middleware/modules.js middleware/permissions.js controllers/preferences.js`
Expected: PASS, no syntax errors.

- [ ] **Step 7: Checkpoint**

Run: `cd backend && NODE_ENV=production pnpm test` — all green; `cd backend && pnpm typecheck` — no new errors against the previous baseline.

---

### Task 3: Server-side storage helpers `putObject` and `copyObject`

**Files:**
- Modify: `backend/services/storage.js`
- Test: `backend/services/storage.test.js`

**Interfaces:**
- Produces: `putObject(buffer, { originalName, mimetype, prefix = "msg" }) → Promise<{ name, originalName, mimetype, size }>`; `copyObject(name, { prefix = "cp" }) → Promise<string>` (the new name); `newObjectName(prefix, originalName, mimetype) → string` (used by the gateway upload in Task 11). Names are flat keys usable in `/uploads/:name`, `getObjectBuffer`, `deleteObject`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/services/storage.test.js`:

```js
test("without S3 putObject writes a new file under uploads/ and returns its name", async () => {
  const saved = await storage.putObject(Buffer.from("фото"), {
    originalName: "IMG 2291.jpg",
    mimetype: "image/jpeg",
  });
  try {
    assert.match(saved.name, /^msg-[0-9a-f-]{36}\.jpg$/);
    assert.equal(saved.originalName, "IMG 2291.jpg");
    assert.equal(saved.mimetype, "image/jpeg");
    assert.equal(saved.size, Buffer.byteLength("фото"));
    assert.equal((await storage.getObjectBuffer(saved.name)).toString(), "фото");
  } finally {
    await storage.deleteObject(saved.name);
  }
});

test("copyObject gives an independent copy: deleting one keeps the other", async () => {
  const saved = await storage.putObject(Buffer.from("акт"), {
    originalName: "акт.pdf",
    mimetype: "application/pdf",
  });
  const copy = await storage.copyObject(saved.name);
  try {
    assert.notEqual(copy, saved.name);
    assert.match(copy, /^cp-[0-9a-f-]{36}\.pdf$/);
    await storage.deleteObject(saved.name);
    assert.equal((await storage.getObjectBuffer(copy)).toString(), "акт");
  } finally {
    await storage.deleteObject(saved.name);
    await storage.deleteObject(copy);
  }
});

test("a name with path separators never escapes uploads/", async () => {
  const saved = await storage.putObject(Buffer.from("x"), {
    originalName: "../../etc/passwd",
    mimetype: "text/plain",
  });
  try {
    assert.equal(path.basename(saved.name), saved.name);
  } finally {
    await storage.deleteObject(saved.name);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/storage.test.js`
Expected: FAIL — `storage.putObject is not a function`.

- [ ] **Step 3: Implement**

In `backend/services/storage.js` add `CopyObjectCommand` to the `@aws-sdk/client-s3` import and `const crypto = require("crypto");` at the top, then before `module.exports`:

```js
// --- Файлы, которые сервер сохраняет сам (вложения из мессенджеров) ---------
// Мультер кладёт только то, что пришло формой; вложения сообщений приезжают
// буфером от шлюза и копируются в заявку. Имя плоское и серверное — как у
// загрузок формы, поэтому `/uploads/:name`, getObjectBuffer и deleteObject
// работают с ним без изменений.

const extensionOf = (originalName, mimetype) => {
  const fromName = path.extname(path.basename(String(originalName || ""))).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const fromMime = String(mimetype || "").split("/")[1] || "";
  return /^[a-z0-9]{1,8}$/.test(fromMime) ? `.${fromMime}` : "";
};

const newObjectName = (prefix, originalName, mimetype) =>
  `${prefix}-${crypto.randomUUID()}${extensionOf(originalName, mimetype)}`;

const putObject = async (buffer, { originalName = "", mimetype = "application/octet-stream", prefix = "msg" } = {}) => {
  const name = newObjectName(prefix, originalName, mimetype);
  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({ Bucket: bucket, Key: name, Body: buffer, ContentType: mimetype, ...sseUploadOptions }),
    );
  } else {
    await fs.promises.writeFile(localPath(name), buffer);
  }
  return { name, originalName: path.basename(String(originalName || name)), mimetype, size: buffer.length };
};

// Копия — не ссылка: удаление вложения из заявки удаляет его файл
// (controllers/ticket.js, removeAttachment), и общий ключ оставил бы сообщение
// без файла.
const copyObject = async (name, { prefix = "cp" } = {}) => {
  const copy = newObjectName(prefix, name, "");
  if (objectExistsLocally(name)) {
    await fs.promises.copyFile(localPath(name), localPath(copy));
    return copy;
  }
  if (!s3Client) throw new Error(`Файл "${name}" не найден`);
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURIComponent(path.basename(name))}`,
      Key: copy,
      ...sseUploadOptions,
    }),
  );
  return copy;
};
```

Add `putObject`, `copyObject` and `newObjectName` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/storage.test.js`
Expected: PASS (all old and new tests).

- [ ] **Step 5: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green.

---

### Task 4: Models, types, pulse topic and the Comment/Ticket fields

**Files:**
- Create: `backend/models/channel.js`, `channelIdentity.js`, `conversation.js`, `message.js`, `channelJob.js`, `conversationRead.js`, `backend/types/messaging.ts`
- Modify: `backend/models/comment.js`, `backend/types/comment.ts`, `backend/models/ticket.js:245-258`, `backend/types/ticket.ts:19-25`
- Modify: `backend/services/pulse.js:22`, `backend/services/pulseTopics.js`
- Test: `backend/services/pulse.test.js` (append)

**Interfaces:**
- Produces: models `Channel`, `ChannelIdentity`, `Conversation`, `Message`, `ChannelJob`, `ConversationRead` (collections `channels`, `channelidentities`, `conversations`, `messages`, `channeljobs`, `conversationreads`); pulse topic `"conversations"`; `Comment.channel` block and `Comment.notifications.skipApplicant`; ticket sources `"WhatsApp"`, `"MAX"`, `"Сайт"`.

- [ ] **Step 1: Write the failing test**

Append to `backend/services/pulse.test.js`:

```js
test("conversations is a topic and starts at zero", () => {
  const { createBus, TOPICS } = require("./pulse");
  assert.ok(TOPICS.includes("conversations"));
  const bus = createBus();
  assert.equal(bus.topics().conversations, 0);
  bus.bump({ topics: ["conversations"] });
  assert.equal(bus.topics().conversations, bus.rev());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_ENV=production node --test services/pulse.test.js`
Expected: FAIL.

- [ ] **Step 3: Pulse topic and specs**

`backend/services/pulse.js` line 22:

```js
const TOPICS = ["tickets", "presence", "team", "mikrotik", "approval", "knowledge", "conversations"];
```

(`controllers/pulse.js` keeps `CLIENT_TOPICS = ["tickets", "approval"]` — clients never see the new topic.)

`backend/services/pulseTopics.js` — Comment status updates must not wake every ticket list; replace the `Comment` line and add three specs:

```js
// Статус доставки ответа в мессенджер (Comment.channel.status) меняется на
// каждом подтверждении шлюза. Списки заявок от этого перечитываться не должны —
// карточку открытой заявки двигает точечный bus.bump({ ticketIds }) в
// services/messaging/jobs.js.
const commentNoise = (path, value, op) =>
  notificationNoise(path, value, op) ||
  path === "channel.status" ||
  path === "channel.statusAt" ||
  path === "channel.error";
```

```js
  Comment: { topics: ["tickets"], ticket: "ticketId", noise: commentNoise },
  Conversation: { topics: ["conversations"], noise: isBookkeeping },
  Message: { topics: ["conversations"], noise: isBookkeeping },
  ChannelIdentity: { topics: ["conversations"], noise: isBookkeeping },
```

(`Channel`, `ChannelJob`, `ConversationRead` get no plugin: heartbeats and leases would bump every few seconds; reads are personal.)

- [ ] **Step 4: Create the models**

`backend/models/channel.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Подключённый канал «Диалогов»: корпоративный аккаунт Telegram или WhatsApp
 * (сессию держит шлюз msg-gateway), бот MAX или форма сайта.
 *
 * Секреты — шифртексты secretBox (services/crypto/secretBox.js); наружу их
 * расшифрованными получает только шлюз (controllers/gateway.js). Сессии
 * мессенджеров здесь НЕ хранятся: они живут в томе шлюза, иначе копия базы на
 * деве (sync-dev-db.sh) унесла бы живую сессию прода.
 */
const channelSchema = new Schema(
  {
    type: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    state: {
      type: String,
      enum: [
        "disconnected",
        "connecting",
        "awaitingQr",
        "awaitingCode",
        "awaitingPassword",
        "connected",
        "loggedOut",
        "banned",
        "error",
      ],
      default: "disconnected",
    },
    stateReason: { type: String, default: "" },
    account: {
      externalId: { type: String, default: "" },
      displayName: { type: String, default: "" },
      username: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    // Вход по QR: шлюз присылает код, страница настроек его показывает
    login: {
      qr: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
    gatewaySeenAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    settings: {
      proxyUrl: { type: String, default: "" },
      historyDays: { type: Number, default: 14, min: 0, max: 90 },
      importGroups: { type: Boolean, default: true },
      markReadOnOpen: { type: Boolean, default: true },
      signReplies: { type: Boolean, default: true },
      maxMediaMb: { type: Number, default: 50, min: 1, max: 200 },
      ignoredChatIds: { type: [String], default: [] },
      site: {
        formKey: { type: String, default: undefined },
        allowedOrigins: { type: [String], default: [] },
        consentText: { type: String, default: "" },
      },
    },
    secrets: {
      tgApiId: { type: String, default: "" },
      tgApiHash: { type: String, default: "" },
      proxyPassword: { type: String, default: "" },
      maxToken: { type: String, default: "" },
      maxWebhookSecret: { type: String, default: "" },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

channelSchema.index({ type: 1, isActive: 1 });
channelSchema.index({ "settings.site.formKey": 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Channel", channelSchema);
```

`backend/models/channelIdentity.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Собеседник в одной сети: Telegram-id, телефон WhatsApp, user_id MAX, почта
 * или телефон с формы сайта. Связь с пользователем HD — только по твёрдому
 * основанию (services/messaging/identity.js), поэтому у пользователя своих
 * полей мессенджеров нет: страж staffContacts видит их полный список.
 */
const channelIdentitySchema = new Schema(
  {
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    externalId: { type: String, required: true },
    // Другие идентификаторы того же человека в сети (WhatsApp: телефон ↔ LID)
    aliases: { type: [String], default: [] },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    displayName: { type: String, default: "" },
    username: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    isBot: { type: Boolean, default: false },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    linkMethod: {
      type: String,
      enum: ["tgBot", "phone", "pairing", "manual", "email", null],
      default: null,
    },
    isStaff: { type: Boolean, default: false },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
  },
  { timestamps: true },
);

channelIdentitySchema.index({ network: 1, externalId: 1 }, { unique: true });
channelIdentitySchema.index({ network: 1, aliases: 1 });
channelIdentitySchema.index({ userId: 1 });
channelIdentitySchema.index({ phone: 1 }, { sparse: true });

channelIdentitySchema.plugin(require("../services/pulsePlugin"), { model: "ChannelIdentity" });

module.exports = mongoose.model("ChannelIdentity", channelIdentitySchema);
```

`backend/models/conversation.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Диалог «Диалогов»: один чат в одном канале — личный, группа компании или
 * заявка с формы сайта. Сводка (lastMessage, awaitingSince) пишется только
 * «если новее» (services/messaging/ingest.js): события приходят с опозданием и
 * повторами.
 */
const conversationSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    // Тип канала копией — для фильтра и значка без чтения канала
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    kind: { type: String, enum: ["direct", "group", "form"], required: true },
    externalChatId: { type: String, required: true },
    externalAliases: { type: [String], default: [] },
    title: { type: String, default: "" },
    counterpartIdentityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity", default: null },
    participants: [
      {
        _id: false,
        identityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity" },
        isStaff: { type: Boolean, default: false },
      },
    ],
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    // Личный чат, привязанный к заявке: пока привязка жива, переписка идёт в неё
    binding: {
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
      ticketNum: { type: Number, default: null },
      boundAt: { type: Date, default: null },
      boundBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      endedAt: { type: Date, default: null },
      endReason: { type: String, enum: ["closed", "deleted", "manual", null], default: null },
    },
    // Клиент написал после закрытия привязанной заявки: «по заявке №X?»
    decision: {
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
      ticketNum: { type: Number, default: null },
      at: { type: Date, default: null },
    },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    awaitingSince: { type: Date, default: null },
    handled: {
      at: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      how: { type: String, default: null },
    },
    lastMessage: {
      at: { type: Date, default: null },
      direction: { type: String, default: null },
      origin: { type: String, default: null },
      preview: { type: String, default: "" },
      authorName: { type: String, default: "" },
    },
    lastSeq: { type: Number, default: 0 },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ channelId: 1, externalChatId: 1 }, { unique: true });
conversationSchema.index({ hidden: 1, awaitingSince: 1 });
conversationSchema.index({ hidden: 1, "lastMessage.at": -1 });
conversationSchema.index({ companyId: 1, "lastMessage.at": -1 });
conversationSchema.index({ assigneeId: 1, "lastMessage.at": -1 });
conversationSchema.index({ "binding.ticketId": 1 });
conversationSchema.index({ counterpartIdentityId: 1 });
conversationSchema.index({ "participants.identityId": 1 });

conversationSchema.plugin(require("../services/pulsePlugin"), { model: "Conversation" });

module.exports = mongoose.model("Conversation", conversationSchema);
```

`backend/models/message.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const attachmentSchema = new Schema(
  {
    name: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimetype: { type: String, default: "" },
    size: { type: Number, default: 0 },
    durationSec: { type: Number, default: null },
    // skipped — больше лимита или из истории: шлюз скачает по клику (fetchMedia)
    status: { type: String, enum: ["ready", "pending", "skipped", "failed"], default: "ready" },
    externalRef: { type: String, default: "" },
  },
  { _id: false },
);

/**
 * Сообщение диалога — входящее, исходящее или системная строка («Создана
 * заявка №…»). Повтор события от шлюза узнаётся уникальным индексом по
 * внешнему id; шаги приёма, уже сделанные для сообщения, записаны в `effects`
 * — транзакций у нас нет (MongoDB standalone), и повтор доделывает только
 * недоделанное.
 */
const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    externalChatId: { type: String, required: true },
    externalId: { type: String, default: undefined },
    // Длинный текст шлюз режет на части — у каждой свой id
    externalIds: { type: [String], default: undefined },
    seq: { type: Number, required: true },
    direction: { type: String, enum: ["in", "out", "system"], required: true },
    origin: {
      type: String,
      enum: ["client", "staff", "hd", "device", "form", "system"],
      required: true,
    },
    kind: {
      type: String,
      enum: ["text", "photo", "voice", "audio", "video", "document", "sticker", "location", "contact", "form", "other", "event"],
      default: "text",
    },
    identityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity", default: null },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: "" },
    text: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    form: {
      fields: { type: [{ _id: false, label: String, value: String }], default: undefined },
    },
    replyToExternalId: { type: String, default: null },
    replyToId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    sentAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["received", "queued", "sent", "delivered", "read", "failed"],
      default: "received",
    },
    error: { type: String, default: "" },
    jobId: { type: Schema.Types.ObjectId, ref: "ChannelJob", default: null },
    editedAt: { type: Date, default: null },
    revisions: { type: [{ _id: false, text: String, at: Date }], default: undefined },
    deletedAt: { type: Date, default: null },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    ticketNum: { type: Number, default: null },
    attachMode: {
      type: String,
      enum: ["bound", "reply", "manual", "origin", "deliver", null],
      default: null,
    },
    suggestTicketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    commentId: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    imported: { type: Boolean, default: false },
    // Системная строка ленты: что произошло и кто это сделал (имя — копией)
    event: {
      // ticketCreated | bound | unbound | bindingEnded | bindingRestored |
      // handled | assigned | attached
      kind: { type: String, default: undefined },
      ticketNum: { type: Number, default: undefined },
      byUserId: { type: Schema.Types.ObjectId, ref: "User", default: undefined },
      byName: { type: String, default: undefined },
      // Кого назначили / сколько сообщений добавили — для подписи строки
      targetName: { type: String, default: undefined },
      count: { type: Number, default: undefined },
    },
    effects: {
      conversation: { type: Boolean, default: false },
      attach: { type: Boolean, default: false },
      notify: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

messageSchema.index(
  { channelId: 1, externalChatId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string" } } },
);
messageSchema.index(
  { commentId: 1 },
  { unique: true, partialFilterExpression: { commentId: { $type: "objectId" } } },
);
messageSchema.index({ conversationId: 1, sentAt: 1, seq: 1 });
messageSchema.index({ conversationId: 1, updatedAt: 1 });
messageSchema.index({ ticketId: 1 });
messageSchema.index({ jobId: 1 }, { sparse: true });
messageSchema.index({ channelId: 1, externalId: 1 });

messageSchema.plugin(require("../services/pulsePlugin"), { model: "Message" });

module.exports = mongoose.model("Message", messageSchema);
```

`backend/models/channelJob.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Очередь шлюза: отправка сообщений и команды (вход, выход, прочитано,
 * загрузка истории и медиа, проверка прокси). Выдача — арендой, как очередь
 * telegram-уведомлений (controllers/bot.js): findOneAndUpdate атомарен, одно
 * задание дважды не уходит. Порядок в диалоге держит services/messaging/jobs.js.
 */
const channelJobSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    type: {
      type: String,
      enum: ["send", "markRead", "fetchMedia", "login", "logout", "loadHistory", "testProxy"],
      required: true,
    },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
    messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    state: { type: String, enum: ["pending", "done", "failed", "cancelled"], default: "pending" },
    notBefore: { type: Date, default: () => new Date() },
    leaseId: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

channelJobSchema.index({ state: 1, network: 1, notBefore: 1, createdAt: 1 });
channelJobSchema.index({ conversationId: 1, state: 1, createdAt: 1 });
// Завершённые задания живут 30 дней — для разбора сбоев хватает
channelJobSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { finishedAt: { $type: "date" } } },
);

module.exports = mongoose.model("ChannelJob", channelJobSchema);
```

`backend/models/conversationRead.js`:

```js
const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/** Водяной знак «когда человек последний раз открывал диалог» — как TicketRead. */
const conversationReadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    seenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

conversationReadSchema.index({ userId: 1, conversationId: 1 }, { unique: true });
conversationReadSchema.index({ conversationId: 1 });

module.exports = mongoose.model("ConversationRead", conversationReadSchema);
```

`backend/types/messaging.ts`:

```ts
import type { Types } from "mongoose";

export type Network = "telegram" | "whatsapp" | "max" | "site";
export type ChannelState =
  | "disconnected"
  | "connecting"
  | "awaitingQr"
  | "awaitingCode"
  | "awaitingPassword"
  | "connected"
  | "loggedOut"
  | "banned"
  | "error";
export type ConversationKind = "direct" | "group" | "form";
export type MessageDirection = "in" | "out" | "system";
export type MessageOrigin = "client" | "staff" | "hd" | "device" | "form" | "system";
export type MessageStatus = "received" | "queued" | "sent" | "delivered" | "read" | "failed";
export type MessageKind =
  | "text" | "photo" | "voice" | "audio" | "video" | "document"
  | "sticker" | "location" | "contact" | "form" | "other" | "event";
export type AttachMode = "bound" | "reply" | "manual" | "origin" | "deliver" | null;
export type JobType = "send" | "markRead" | "fetchMedia" | "login" | "logout" | "loadHistory" | "testProxy";

export interface IChannel {
  type: Network;
  name: string;
  isActive: boolean;
  state: ChannelState;
  stateReason: string;
  account: { externalId: string; displayName: string; username: string; phone: string };
  login: { qr: string | null; expiresAt: Date | null };
  gatewaySeenAt: Date | null;
  lastMessageAt: Date | null;
  settings: {
    proxyUrl: string;
    historyDays: number;
    importGroups: boolean;
    markReadOnOpen: boolean;
    signReplies: boolean;
    maxMediaMb: number;
    ignoredChatIds: string[];
    site: { formKey?: string; allowedOrigins: string[]; consentText: string };
  };
  secrets: { tgApiId: string; tgApiHash: string; proxyPassword: string; maxToken: string; maxWebhookSecret: string };
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelIdentity {
  network: Network;
  externalId: string;
  aliases: string[];
  firstName: string;
  lastName: string;
  displayName: string;
  username: string;
  phone: string;
  email: string;
  isBot: boolean;
  userId: Types.ObjectId | null;
  linkMethod: "tgBot" | "phone" | "pairing" | "manual" | "email" | null;
  isStaff: boolean;
  companyId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversation {
  channelId: Types.ObjectId;
  network: Network;
  kind: ConversationKind;
  externalChatId: string;
  externalAliases: string[];
  title: string;
  counterpartIdentityId: Types.ObjectId | null;
  participants: { identityId: Types.ObjectId; isStaff: boolean }[];
  companyId: Types.ObjectId | null;
  binding: {
    ticketId: Types.ObjectId | null;
    ticketNum: number | null;
    boundAt: Date | null;
    boundBy: Types.ObjectId | null;
    endedAt: Date | null;
    endReason: "closed" | "deleted" | "manual" | null;
  };
  decision: { ticketId: Types.ObjectId | null; ticketNum: number | null; at: Date | null };
  assigneeId: Types.ObjectId | null;
  awaitingSince: Date | null;
  handled: { at: Date | null; by: Types.ObjectId | null; how: string | null };
  lastMessage: { at: Date | null; direction: MessageDirection | null; origin: MessageOrigin | null; preview: string; authorName: string };
  lastSeq: number;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageAttachment {
  name: string;
  originalName: string;
  mimetype: string;
  size: number;
  durationSec: number | null;
  status: "ready" | "pending" | "skipped" | "failed";
  externalRef: string;
}

export interface IMessage {
  conversationId: Types.ObjectId;
  channelId: Types.ObjectId;
  externalChatId: string;
  externalId?: string;
  externalIds?: string[];
  seq: number;
  direction: MessageDirection;
  origin: MessageOrigin;
  kind: MessageKind;
  identityId: Types.ObjectId | null;
  authorUserId: Types.ObjectId | null;
  authorName: string;
  text: string;
  attachments: IMessageAttachment[];
  form?: { fields?: { label: string; value: string }[] };
  replyToExternalId: string | null;
  replyToId: Types.ObjectId | null;
  sentAt: Date;
  status: MessageStatus;
  error: string;
  jobId: Types.ObjectId | null;
  editedAt: Date | null;
  revisions?: { text: string; at: Date }[];
  deletedAt: Date | null;
  ticketId: Types.ObjectId | null;
  ticketNum: number | null;
  attachMode: AttachMode;
  suggestTicketId: Types.ObjectId | null;
  commentId: Types.ObjectId | null;
  imported: boolean;
  event?: { kind?: string; ticketNum?: number; byUserId?: Types.ObjectId; byName?: string; targetName?: string; count?: number };
  effects: { conversation: boolean; attach: boolean; notify: boolean };
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannelJob {
  channelId: Types.ObjectId;
  network: Network;
  type: JobType;
  conversationId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  state: "pending" | "done" | "failed" | "cancelled";
  notBefore: Date;
  leaseId: string | null;
  leaseUntil: Date | null;
  attempts: number;
  lastError: string;
  payload: Record<string, unknown>;
  result: unknown;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversationRead {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId;
  seenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 5: Comment and Ticket fields**

`backend/models/comment.js` — in `notifications` add `skipApplicant`, and add the `channel` block after `attachments`:

```js
    notifications: {
      lastAction: String,
      pending: Boolean,
      // Ответ ушёл клиенту мессенджером (services/messaging): заявителю тот же
      // текст уведомлением не дублируем — ни письмом, ни ботом, ни в приложении
      skipApplicant: Boolean,
    },
```

```js
    // Сообщение «Диалогов», которое стало этим комментарием, или ответ из
    // заявки, ушедший мессенджером. Только имена — ни телефона, ни ника: блок
    // видит и клиент в своей заявке.
    channel: {
      network: { type: String, default: undefined },
      conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: undefined },
      messageId: { type: Schema.Types.ObjectId, ref: "Message", default: undefined },
      direction: { type: String, enum: ["in", "out", undefined], default: undefined },
      authorName: { type: String, default: undefined },
      status: { type: String, default: undefined },
      statusAt: { type: Date, default: undefined },
      error: { type: String, default: undefined },
      editedAt: { type: Date, default: undefined },
      deletedAt: { type: Date, default: undefined },
    },
```

Make `bumpTicketActivity` forward-only (a mirrored comment carries the messenger time and may be older than the ticket's last activity) — change its filter:

```js
    await mongoose.model("Ticket").updateOne(
      {
        _id: doc.ticketId,
        // Только вперёд: зеркало сообщения из мессенджера несёт время
        // мессенджера и может оказаться старше последнего движения заявки
        $or: [{ "activity.at": { $lte: doc.createdAt || new Date() } }, { "activity.at": null }],
      },
      {
        $set: {
          activity: { at: doc.createdAt || new Date(), by: doc.createdBy },
        },
      },
    );
```

and add the index `commentSchema.index({ "channel.messageId": 1 }, { sparse: true });` next to the existing index.

`backend/models/ticket.js` — extend the `source` enum:

```js
      enum: [
        "Портал",
        "Почта",
        "Облачная телефония",
        "Telegram",
        "WhatsApp",
        "MAX",
        "Сайт",
        "Регламентное задание",
        "Мониторинг устройств",
        "Другое",
      ],
```

`backend/types/ticket.ts` — `TicketSource`:

```ts
export type TicketSource =
  | "Портал"
  | "Почта"
  | "Облачная телефония"
  | "Telegram"
  | "WhatsApp"
  | "MAX"
  | "Сайт"
  | "Регламентное задание"
  | "Мониторинг устройств"
  | "Другое";
```

(«Мониторинг устройств» was missing from the type.) `backend/types/comment.ts`:

```ts
import type { Types } from "mongoose";
import type { IAttachment } from "./_shared";

export interface ICommentChannel {
  network?: "telegram" | "whatsapp" | "max" | "site";
  conversationId?: Types.ObjectId;
  messageId?: Types.ObjectId;
  direction?: "in" | "out";
  authorName?: string;
  status?: string;
  statusAt?: Date;
  error?: string;
  editedAt?: Date;
  deletedAt?: Date;
}

export interface IComment {
  content: string;
  quotedText?: string;
  attachments?: IAttachment[];
  /** @deprecated legacy ticket number, removed after 1.8.9 */
  ticket?: number;
  ticketId: Types.ObjectId;
  notifications?: { lastAction?: string; pending?: boolean; skipApplicant?: boolean };
  channel?: ICommentChannel;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 6: Run the tests and syntax checks**

Run: `cd backend && NODE_ENV=production node --test services/pulse.test.js services/pulsePlugin.test.js && for f in models/channel.js models/channelIdentity.js models/conversation.js models/message.js models/channelJob.js models/conversationRead.js models/comment.js models/ticket.js; do node --check $f; done`
Expected: PASS, no output from `node --check`.

- [ ] **Step 7: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green; `cd backend && pnpm typecheck` no new errors.

---

### Task 5: Pure rules and event validation

**Files:**
- Create: `backend/services/messaging/rules.js`, `backend/services/messaging/rules.test.js`
- Create: `backend/services/messaging/events.js`, `backend/services/messaging/events.test.js`

**Interfaces:**
- Produces from `rules.js`: `NETWORKS`, `GATEWAY_NETWORKS`, `NETWORK_LABEL`, `TICKET_SOURCE`, `MESSAGE_KINDS`, `DECISION_WINDOW_MS`, `MAX_ATTEMPTS`, `nextAwaiting(conversation, message) → { awaitingSince: Date|null } | null`, `decideAttach({ conversation, message, boundTicket, replyToTicket }) → { mode, ticketId, ticketNum, endBinding?, decision?, suggestTicketId? }`, `advanceStatus(current, next) → string`, `commentContent(message) → string`, `previewOf(message) → string`, `identityName(identity) → string`, `backoffMs(attempts) → number`, `signReply(text, { firstName, organization }) → string`.
- Produces from `events.js`: `validateEvent(raw) → { ok: true, event } | { ok: false, error: string }`; `EVENT_TYPES`.

- [ ] **Step 1: Write the failing tests**

`backend/services/messaging/rules.test.js`:

```js
// node --test services/messaging/rules.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  nextAwaiting,
  decideAttach,
  advanceStatus,
  commentContent,
  previewOf,
  identityName,
  backoffMs,
  signReply,
  DECISION_WINDOW_MS,
} = require("./rules");

const at = (hhmm) => new Date(`2026-09-24T${hhmm}:00.000Z`);

test("a client message starts waiting only when nobody is waiting yet", () => {
  const client = { direction: "in", origin: "client", sentAt: at("10:30") };
  assert.deepEqual(nextAwaiting({ awaitingSince: null }, client), { awaitingSince: at("10:30") });
  // ждём с первого неотвеченного, а не с последнего
  assert.equal(nextAwaiting({ awaitingSince: at("10:00") }, client), null);
});

test("any newer answer clears waiting; a late older one does not", () => {
  const conv = { awaitingSince: at("10:30") };
  for (const origin of ["hd", "device"]) {
    assert.deepEqual(nextAwaiting(conv, { direction: "out", origin, sentAt: at("10:40") }), { awaitingSince: null });
  }
  // сотрудник ответил в группе со своего аккаунта
  assert.deepEqual(nextAwaiting(conv, { direction: "in", origin: "staff", sentAt: at("10:40") }), { awaitingSince: null });
  // ответ, посланный раньше вопроса, но доехавший позже, вопрос не закрывает
  assert.equal(nextAwaiting(conv, { direction: "out", origin: "device", sentAt: at("10:20") }), null);
});

test("history and system lines never touch waiting", () => {
  assert.equal(nextAwaiting({ awaitingSince: null }, { direction: "in", origin: "client", sentAt: at("10:30"), imported: true }), null);
  assert.equal(nextAwaiting({ awaitingSince: at("10:00") }, { direction: "system", origin: "system", sentAt: at("10:30") }), null);
});

const direct = (binding = {}, extra = {}) => ({ kind: "direct", binding: { ticketId: null, endedAt: null, ...binding }, decision: { ticketId: null }, ...extra });
const ticket = (num, isClosed = false) => ({ _id: `t${num}`, num, isClosed });
const clientMsg = (hhmm = "10:30", extra = {}) => ({ direction: "in", origin: "client", sentAt: at(hhmm), ...extra });

test("a bound direct chat feeds its open ticket, both ways except HD-sent", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: ticket(56812) }), {
    mode: "bound",
    ticketId: "t56812",
    ticketNum: 56812,
  });
  // ответ с телефона тоже попадает в заявку
  assert.equal(decideAttach({ conversation: conv, message: { direction: "out", origin: "device", sentAt: at("10:40") }, boundTicket: ticket(56812) }).mode, "bound");
  // ответ из HD в заявку кладёт отправка, не приём
  assert.equal(decideAttach({ conversation: conv, message: { direction: "out", origin: "hd", sentAt: at("10:40") }, boundTicket: ticket(56812) }).mode, null);
});

test("a bound ticket that is closed ends the binding and asks the client's question", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: ticket(56812, true) }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    endBinding: "closed",
    decision: { ticketId: "t56812", ticketNum: 56812 },
  });
  // удалённая заявка: привязка кончается, спрашивать не о чем
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: null }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    endBinding: "deleted",
  });
});

test("after a closure the next client message asks once, within the window", () => {
  const endedAt = at("09:00");
  const conv = direct({ ticketId: "t56812", ticketNum: 56812, endedAt, endReason: "closed" });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg("10:30") }).decision, { ticketId: "t56812", ticketNum: 56812 });
  // вопрос уже задан — второй раз не задаём
  const asked = { ...conv, decision: { ticketId: "t56812" } };
  assert.equal(decideAttach({ conversation: asked, message: clientMsg("10:31") }).decision, undefined);
  // после окна — обычное непривязанное сообщение
  const late = clientMsg("10:30", { sentAt: new Date(endedAt.getTime() + DECISION_WINDOW_MS + 1000) });
  assert.equal(decideAttach({ conversation: conv, message: late }).decision, undefined);
  // отвязали руками — не спрашиваем
  const manual = direct({ ticketId: "t56812", ticketNum: 56812, endedAt, endReason: "manual" });
  assert.equal(decideAttach({ conversation: manual, message: clientMsg() }).decision, undefined);
});

test("groups attach only a quote-reply to an open ticket's message", () => {
  const group = { kind: "group", binding: {}, decision: {} };
  assert.deepEqual(decideAttach({ conversation: group, message: clientMsg(), replyToTicket: ticket(56801) }), {
    mode: "reply",
    ticketId: "t56801",
    ticketNum: 56801,
  });
  assert.deepEqual(decideAttach({ conversation: group, message: clientMsg(), replyToTicket: ticket(56801, true) }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    suggestTicketId: "t56801",
  });
  assert.equal(decideAttach({ conversation: group, message: clientMsg() }).mode, null);
});

test("history is never attached", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.equal(decideAttach({ conversation: conv, message: clientMsg("10:30", { imported: true }), boundTicket: ticket(56812) }).mode, null);
});

test("delivery status only moves forward; failed only before delivery", () => {
  assert.equal(advanceStatus("queued", "sent"), "sent");
  assert.equal(advanceStatus("read", "delivered"), "read");
  assert.equal(advanceStatus("sent", "failed"), "failed");
  assert.equal(advanceStatus("delivered", "failed"), "delivered");
  // повтор после сбоя удался
  assert.equal(advanceStatus("failed", "sent"), "sent");
  assert.equal(advanceStatus("sent", "bogus"), "sent");
});

test("a message without text becomes a readable comment", () => {
  assert.equal(commentContent({ kind: "text", text: "  Оранжевый мигает  " }), "Оранжевый мигает");
  assert.equal(commentContent({ kind: "photo", text: "", attachments: [{}] }), "Фото");
  assert.equal(commentContent({ kind: "voice", attachments: [{ durationSec: 14 }] }), "Голосовое 0:14");
  assert.equal(commentContent({ kind: "voice", attachments: [{ durationSec: 75 }] }), "Голосовое 1:15");
  assert.equal(commentContent({ kind: "document", attachments: [{ originalName: "акт.pdf" }] }), "Файл «акт.pdf»");
  assert.equal(
    commentContent({ kind: "form", form: { fields: [{ label: "Имя", value: "Елена" }, { label: "Сообщение", value: "Нужна поддержка" }] } }),
    "Имя: Елена\nСообщение: Нужна поддержка",
  );
  assert.equal(commentContent({ kind: "sticker" }), "Стикер");
  assert.equal(commentContent({}), "Сообщение");
});

test("preview is one line of at most 140 characters", () => {
  assert.equal(previewOf({ text: "a\n\nb   c" }), "a b c");
  assert.equal(previewOf({ text: "x".repeat(300) }).length, 140);
});

test("an identity is named by its name, then @username, then phone", () => {
  assert.equal(identityName({ firstName: "Марина", lastName: "Соколова" }), "Марина Соколова");
  assert.equal(identityName({ displayName: "Андрей", phone: "+79142073318" }), "Андрей");
  assert.equal(identityName({ username: "kostya_it" }), "@kostya_it");
  assert.equal(identityName({ phone: "+79142073318", externalId: "x" }), "+79142073318");
  assert.equal(identityName(null), "");
});

test("backoff grows 30 s → 30 min", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [30_000, 120_000, 480_000, 1_800_000, 1_800_000, 1_800_000]);
});

test("a signature is the first name and the organisation — never contacts", () => {
  assert.equal(signReply("Будем в 14:00.", { firstName: "Игорь", organization: "F1Lab" }), "Будем в 14:00.\n\n— Игорь, F1Lab");
  assert.equal(signReply("Будем.", { firstName: "Игорь", organization: "" }), "Будем.\n\n— Игорь");
  assert.equal(signReply("Будем.", { firstName: "", organization: "F1Lab" }), "Будем.\n\n— F1Lab");
  assert.equal(signReply("Будем.", {}), "Будем.");
});
```

`backend/services/messaging/events.test.js`:

```js
// node --test services/messaging/events.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateEvent } = require("./events");

const CHANNEL = "66f2a1b2c3d4e5f6a7b8c9d0";
const message = (overrides = {}) => ({
  type: "message",
  channelId: CHANNEL,
  chat: { id: "123456", kind: "direct", peer: { id: "123456", name: "Марина Соколова", username: "m_sokolova" } },
  message: {
    id: "9001",
    direction: "in",
    sender: { id: "123456", name: "Марина Соколова", username: "m_sokolova" },
    kind: "text",
    text: "Доброе утро!",
    sentAt: "2026-09-24T09:58:00.000Z",
  },
  ...overrides,
});

test("a well-formed message passes and gets defaults", () => {
  const result = validateEvent(message());
  assert.equal(result.ok, true);
  assert.equal(result.event.message.imported, false);
  assert.equal(result.event.message.sentAt instanceof Date, true);
  assert.deepEqual(result.event.message.attachments, []);
});

test("required fields are required", () => {
  assert.equal(validateEvent({ ...message(), channelId: "nope" }).ok, false);
  assert.equal(validateEvent({ ...message(), type: "message.weird" }).ok, false);
  assert.equal(validateEvent(message({ chat: { id: "", kind: "direct" } })).ok, false);
  assert.equal(validateEvent(message({ chat: { id: "1", kind: "channel" } })).ok, false);
  const noId = message();
  delete noId.message.id;
  assert.equal(validateEvent(noId).ok, false);
  const badDate = message();
  badDate.message.sentAt = "yesterday";
  assert.equal(validateEvent(badDate).ok, false);
});

test("an inbound message needs a sender, an outbound one does not", () => {
  const inbound = message();
  delete inbound.message.sender;
  assert.equal(validateEvent(inbound).ok, false);
  const outbound = message();
  outbound.message.direction = "out";
  outbound.message.origin = "device";
  delete outbound.message.sender;
  assert.equal(validateEvent(outbound).ok, true);
});

test("origin hd needs the job id; unknown origins are refused", () => {
  const own = message();
  own.message.direction = "out";
  own.message.origin = "hd";
  assert.equal(validateEvent(own).ok, false);
  own.message.jobId = "66f2a1b2c3d4e5f6a7b8c9d1";
  assert.equal(validateEvent(own).ok, true);
  const weird = message();
  weird.message.origin = "martian";
  assert.equal(validateEvent(weird).ok, false);
});

test("limits: text 20 000, 20 attachments, 100 deleted ids", () => {
  const long = message();
  long.message.text = "x".repeat(20_001);
  assert.equal(validateEvent(long).ok, false);
  const many = message();
  many.message.attachments = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}` }));
  assert.equal(validateEvent(many).ok, false);
  const deleted = { type: "message.deleted", channelId: CHANNEL, messageIds: Array.from({ length: 101 }, (_, i) => String(i)) };
  assert.equal(validateEvent(deleted).ok, false);
});

test("edits, deletions, statuses, chats and channel states", () => {
  assert.equal(
    validateEvent({ type: "message.edited", channelId: CHANNEL, chat: { id: "1" }, message: { id: "9", text: "исправил", editedAt: "2026-09-24T10:00:00Z" } }).ok,
    true,
  );
  // в личных чатах Telegram удаление приходит без чата — это нормально
  assert.equal(validateEvent({ type: "message.deleted", channelId: CHANNEL, messageIds: ["9", "10"] }).ok, true);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, jobId: "66f2a1b2c3d4e5f6a7b8c9d1", status: "delivered" }).ok, true);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, status: "delivered" }).ok, false);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, chat: { id: "1" }, messageIds: ["9"], status: "lost" }).ok, false);
  assert.equal(validateEvent({ type: "chat", channelId: CHANNEL, chat: { id: "-100", kind: "group", title: "ТД Восток × F1Lab" } }).ok, true);
  assert.equal(validateEvent({ type: "channel.state", channelId: CHANNEL, state: "connected", account: { displayName: "F1Lab Поддержка" } }).ok, true);
  assert.equal(validateEvent({ type: "channel.state", channelId: CHANNEL, state: "sleepy" }).ok, false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/messaging/rules.test.js services/messaging/events.test.js`
Expected: FAIL — `Cannot find module './rules'`.

- [ ] **Step 3: Implement `rules.js`**

```js
/**
 * Правила «Диалогов» без базы: кто ждёт ответа, куда прикрепить сообщение,
 * куда двигать статус доставки, чем назвать сообщение без текста. Всё чистое —
 * тесты рядом (rules.test.js). Спека: docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md.
 */

const NETWORKS = ["telegram", "whatsapp", "max", "site"];
// Сети, чьи сессии держит шлюз msg-gateway; MAX и форма живут в бэкенде
const GATEWAY_NETWORKS = ["telegram", "whatsapp"];
const NETWORK_LABEL = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX", site: "Форма с сайта" };
// Источник заявки (models/ticket.js) по сети диалога
const TICKET_SOURCE = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX", site: "Сайт" };
const MESSAGE_KINDS = ["text", "photo", "voice", "audio", "video", "document", "sticker", "location", "contact", "form", "other"];
// Сколько после закрытия заявки новое сообщение клиента ещё спрашивает «о ней?»
const DECISION_WINDOW_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 2 * 60_000, 8 * 60_000, 30 * 60_000, 30 * 60_000];

const time = (value) => new Date(value).getTime();

/**
 * «Ждёт ответа» после сообщения: `{ awaitingSince }` для записи или null —
 * ничего не менять. История и системные строки очередь не трогают. Клиент
 * ставит отметку, только если её нет (ждём с первого неотвеченного). Любой наш
 * ответ — из HD, с телефона, сотрудником в группе — новее отметки её снимает;
 * опоздавший старый — нет.
 */
const nextAwaiting = (conversation, message) => {
  if (message.imported || message.direction === "system") return null;
  const since = conversation.awaitingSince ? time(conversation.awaitingSince) : null;
  const at = time(message.sentAt);
  if (message.direction === "in" && message.origin === "client") {
    return since === null ? { awaitingSince: new Date(at) } : null;
  }
  if (since !== null && at >= since) return { awaitingSince: null };
  return null;
};

const NONE = Object.freeze({ mode: null, ticketId: null, ticketNum: null });

/**
 * Куда сообщение попадает в заявке.
 *   direct — живая привязка к открытой заявке: «bound». Заявку закрыли или
 *     удалили в обход хука — привязка кончается здесь же, и сообщение клиента о
 *     закрытой заявке задаёт вопрос (decision). Привязка кончилась закрытием
 *     раньше — первое сообщение клиента в окне тоже спрашивает, один раз.
 *   group — ответ цитатой на сообщение открытой заявки: «reply»; закрытой —
 *     только подсказка.
 *   form — никогда.
 * История и отправленное из HD сюда не попадают: второе кладёт в заявку отправка.
 */
const decideAttach = ({ conversation, message, boundTicket = null, replyToTicket = null }) => {
  if (message.imported || message.origin === "hd" || message.direction === "system") return { ...NONE };
  const fromClient = message.direction === "in" && message.origin === "client";

  if (conversation.kind === "direct") {
    const binding = conversation.binding || {};
    if (!binding.ticketId) return { ...NONE };
    if (!binding.endedAt) {
      if (boundTicket && !boundTicket.isClosed) {
        return { mode: "bound", ticketId: boundTicket._id, ticketNum: boundTicket.num };
      }
      if (!boundTicket) return { ...NONE, endBinding: "deleted" };
      const ended = { ...NONE, endBinding: "closed" };
      return fromClient ? { ...ended, decision: { ticketId: boundTicket._id, ticketNum: boundTicket.num } } : ended;
    }
    const recent =
      binding.endReason === "closed" && time(message.sentAt) - time(binding.endedAt) <= DECISION_WINDOW_MS;
    if (fromClient && recent && !conversation.decision?.ticketId) {
      return { ...NONE, decision: { ticketId: binding.ticketId, ticketNum: binding.ticketNum } };
    }
    return { ...NONE };
  }

  if (conversation.kind === "group" && replyToTicket) {
    if (!replyToTicket.isClosed) {
      return { mode: "reply", ticketId: replyToTicket._id, ticketNum: replyToTicket.num };
    }
    return { ...NONE, suggestTicketId: replyToTicket._id };
  }
  return { ...NONE };
};

const STATUS_RANK = { received: 0, queued: 1, sent: 2, delivered: 3, read: 4 };

/** Статус доставки только растёт; «failed» — из очереди или отправки, не после доставки. */
const advanceStatus = (current, next) => {
  if (next === "failed") return current === "queued" || current === "sent" ? "failed" : current;
  if (!(next in STATUS_RANK)) return current;
  if (current === "failed") return STATUS_RANK[next] >= STATUS_RANK.sent ? next : current;
  return STATUS_RANK[next] > (STATUS_RANK[current] ?? 0) ? next : current;
};

const KIND_LABEL = {
  photo: "Фото",
  voice: "Голосовое",
  audio: "Аудио",
  video: "Видео",
  document: "Файл",
  sticker: "Стикер",
  location: "Геопозиция",
  contact: "Контакт",
  other: "Сообщение",
};

const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/**
 * Текст комментария-зеркала. У сообщения без текста — подпись вложения:
 * content у Comment обязателен, а пустая запись в хронике читалась бы как сбой.
 */
const commentContent = (message) => {
  const text = String(message.text || "").trim();
  if (text) return text;
  if (message.kind === "form") {
    return (message.form?.fields || []).map((field) => `${field.label}: ${field.value}`).join("\n") || "Форма с сайта";
  }
  const label = KIND_LABEL[message.kind] || KIND_LABEL.other;
  const first = (message.attachments || [])[0];
  if (message.kind === "voice" && first?.durationSec) return `${label} ${duration(first.durationSec)}`;
  if (message.kind === "document" && first?.originalName) return `${label} «${first.originalName}»`;
  return label;
};

/** Строка списка: одна строка текста, не длиннее 140 знаков. */
const previewOf = (message) => commentContent(message).replace(/\s+/g, " ").trim().slice(0, 140);

/** Как назвать собеседника, пока он не связан с пользователем. */
const identityName = (identity) => {
  if (!identity) return "";
  const full = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  return (
    identity.displayName ||
    full ||
    (identity.username ? `@${identity.username}` : "") ||
    identity.phone ||
    identity.externalId ||
    ""
  );
};

/** Пауза перед повтором задания после `attempts` неудач: 30 с → 30 мин. */
const backoffMs = (attempts) =>
  BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

/**
 * Подпись к ответу клиенту: имя сотрудника и организация — и ничего больше
 * (правило «клиенту — никаких личных контактов сотрудников»).
 */
const signReply = (text, { firstName = "", organization = "" } = {}) => {
  const who = [firstName, organization].filter(Boolean).join(", ");
  return who ? `${text}\n\n— ${who}` : text;
};

module.exports = {
  NETWORKS,
  GATEWAY_NETWORKS,
  NETWORK_LABEL,
  TICKET_SOURCE,
  MESSAGE_KINDS,
  DECISION_WINDOW_MS,
  MAX_ATTEMPTS,
  nextAwaiting,
  decideAttach,
  advanceStatus,
  commentContent,
  previewOf,
  identityName,
  backoffMs,
  signReply,
};
```

- [ ] **Step 4: Implement `events.js`**

```js
/**
 * Нормализованное событие канала — единый вход приёма
 * (services/messaging/ingest.js) для шлюза, вебхука MAX и формы сайта. Здесь
 * только проверка формы того, что пришло извне, до всякой записи. Формат —
 * docs/messaging.md, «Events».
 */
const { MESSAGE_KINDS } = require("./rules");

const EVENT_TYPES = ["message", "message.edited", "message.deleted", "message.status", "chat", "channel.state"];
const CHAT_KINDS = ["direct", "group", "form"];
const STATUSES = ["sent", "delivered", "read", "failed"];
const CHANNEL_STATES = [
  "disconnected",
  "connecting",
  "awaitingQr",
  "awaitingCode",
  "awaitingPassword",
  "connected",
  "loggedOut",
  "banned",
  "error",
];
const MAX_TEXT = 20_000;
const MAX_ATTACHMENTS = 20;
const MAX_IDS = 100;

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isId = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
const isObjectId = (value) => typeof value === "string" && OBJECT_ID.test(value);
const str = (value, max = 500) => (typeof value === "string" ? value.slice(0, max) : "");
const date = (value) => {
  if (value === undefined || value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

class Invalid extends Error {}
const need = (condition, message) => {
  if (!condition) throw new Invalid(message);
};

const person = (raw, what) => {
  need(raw && typeof raw === "object" && isId(String(raw.id ?? "")), `${what}: нужен id`);
  return {
    id: String(raw.id),
    name: str(raw.name, 200),
    firstName: str(raw.firstName, 100),
    lastName: str(raw.lastName, 100),
    username: str(raw.username, 100),
    phone: str(raw.phone, 40),
    email: str(raw.email, 200),
    isBot: raw.isBot === true,
  };
};

const chatOf = (raw, { kindRequired = true } = {}) => {
  need(raw && typeof raw === "object" && isId(String(raw.id ?? "")), "chat.id обязателен");
  if (kindRequired || raw.kind !== undefined) need(CHAT_KINDS.includes(raw.kind), "chat.kind: direct | group | form");
  return {
    id: String(raw.id),
    kind: raw.kind,
    title: str(raw.title, 300),
    peer: raw.peer ? person(raw.peer, "chat.peer") : null,
    participants: Array.isArray(raw.participants) ? raw.participants.slice(0, 500).map((p) => person(p, "участник")) : null,
    migratedToChatId: raw.migratedToChatId ? String(raw.migratedToChatId) : null,
  };
};

const attachmentOf = (raw) => {
  need(raw && typeof raw === "object", "вложение — объект");
  const status = raw.status || "ready";
  need(["ready", "skipped", "failed"].includes(status), "вложение: status ready | skipped | failed");
  if (status === "ready") need(isId(raw.name), "вложение: нужен name (загруженный файл)");
  return {
    name: str(raw.name, 200),
    originalName: str(raw.originalName, 300),
    mimetype: str(raw.mimetype, 120),
    size: Number.isFinite(raw.size) ? raw.size : 0,
    durationSec: Number.isFinite(raw.durationSec) ? raw.durationSec : null,
    status,
    externalRef: str(raw.externalRef, 500),
  };
};

const messageOf = (raw) => {
  need(raw && typeof raw === "object", "message обязателен");
  need(isId(String(raw.id ?? "")), "message.id обязателен");
  need(["in", "out"].includes(raw.direction), "message.direction: in | out");
  const sentAt = date(raw.sentAt);
  need(sentAt instanceof Date, "message.sentAt — дата");
  const kind = raw.kind ?? "text";
  need(MESSAGE_KINDS.includes(kind), `message.kind: ${MESSAGE_KINDS.join(" | ")}`);
  need(raw.text === undefined || (typeof raw.text === "string" && raw.text.length <= MAX_TEXT), `message.text — строка до ${MAX_TEXT}`);
  const attachments = raw.attachments ?? [];
  need(Array.isArray(attachments) && attachments.length <= MAX_ATTACHMENTS, `не больше ${MAX_ATTACHMENTS} вложений`);

  let origin = raw.origin;
  if (raw.direction === "in") {
    need(origin === undefined || origin === "form", "у входящего origin задаёт сервер");
    need(raw.sender, "у входящего нужен sender");
  } else {
    origin = origin ?? "device";
    need(["device", "hd"].includes(origin), "исходящее: origin device | hd");
    if (origin === "hd") need(isObjectId(raw.jobId), "эхо своего сообщения — с jobId задания");
  }

  return {
    id: String(raw.id),
    direction: raw.direction,
    origin: origin ?? null,
    jobId: raw.jobId && isObjectId(raw.jobId) ? raw.jobId : null,
    sender: raw.sender ? person(raw.sender, "sender") : null,
    kind,
    text: raw.text ?? "",
    attachments: attachments.map(attachmentOf),
    replyToId: raw.replyToId ? String(raw.replyToId) : null,
    sentAt,
    imported: raw.imported === true,
    form: raw.form && Array.isArray(raw.form.fields)
      ? { fields: raw.form.fields.slice(0, 30).map((f) => ({ label: str(f?.label, 100), value: str(f?.value, 5000) })) }
      : null,
  };
};

const idsOf = (raw) => {
  need(Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_IDS, `messageIds: от 1 до ${MAX_IDS}`);
  need(raw.every((id) => isId(String(id))), "messageIds — строки");
  return raw.map(String);
};

const validateEvent = (raw) => {
  try {
    need(raw && typeof raw === "object", "событие — объект");
    need(EVENT_TYPES.includes(raw.type), `type: ${EVENT_TYPES.join(" | ")}`);
    need(isObjectId(raw.channelId), "channelId — id канала");
    const base = { type: raw.type, channelId: raw.channelId, at: date(raw.at) || new Date() };

    switch (raw.type) {
      case "message":
        return { ok: true, event: { ...base, chat: chatOf(raw.chat), message: messageOf(raw.message) } };
      case "message.edited": {
        need(raw.message && isId(String(raw.message.id ?? "")), "message.id обязателен");
        need(typeof raw.message.text === "string" && raw.message.text.length <= MAX_TEXT, "message.text — строка");
        const editedAt = date(raw.message.editedAt) || base.at;
        need(editedAt instanceof Date, "message.editedAt — дата");
        return {
          ok: true,
          event: { ...base, chat: chatOf(raw.chat, { kindRequired: false }), message: { id: String(raw.message.id), text: raw.message.text, editedAt } },
        };
      }
      case "message.deleted":
        return {
          ok: true,
          event: { ...base, chat: raw.chat ? chatOf(raw.chat, { kindRequired: false }) : null, messageIds: idsOf(raw.messageIds) },
        };
      case "message.status": {
        need(STATUSES.includes(raw.status), `status: ${STATUSES.join(" | ")}`);
        const byJob = isObjectId(raw.jobId);
        need(byJob || (raw.chat && raw.messageIds), "нужен jobId или chat + messageIds");
        return {
          ok: true,
          event: {
            ...base,
            status: raw.status,
            error: str(raw.error, 500),
            jobId: byJob ? raw.jobId : null,
            chat: byJob ? null : chatOf(raw.chat, { kindRequired: false }),
            messageIds: byJob ? null : idsOf(raw.messageIds),
          },
        };
      }
      case "chat":
        return { ok: true, event: { ...base, chat: chatOf(raw.chat, { kindRequired: false }) } };
      case "channel.state": {
        need(CHANNEL_STATES.includes(raw.state), `state: ${CHANNEL_STATES.join(" | ")}`);
        return {
          ok: true,
          event: {
            ...base,
            state: raw.state,
            reason: str(raw.reason, 500),
            account: raw.account && typeof raw.account === "object"
              ? {
                  externalId: str(String(raw.account.externalId ?? ""), 100),
                  displayName: str(raw.account.displayName, 200),
                  username: str(raw.account.username, 100),
                  phone: str(raw.account.phone, 40),
                }
              : null,
            login: raw.login && typeof raw.login === "object"
              ? { qr: str(raw.login.qr, 2000) || null, expiresAt: date(raw.login.expiresAt) || null }
              : null,
          },
        };
      }
      default:
        return { ok: false, error: "неизвестный тип" };
    }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
};

module.exports = { validateEvent, EVENT_TYPES, CHANNEL_STATES };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/messaging/rules.test.js services/messaging/events.test.js`
Expected: PASS. If a hand-derived expectation disagrees with the implementation, fix the code unless the expectation contradicts the spec — then report it.

- [ ] **Step 6: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green (the `services/**` glob picks the new tests up).

---

### Task 6: Visibility, queues and presenters

**Files:**
- Create: `backend/services/messaging/visibility.js`, `backend/services/messaging/visibility.test.js`
- Create: `backend/services/messaging/present.js`, `backend/services/messaging/present.test.js`

**Interfaces:**
- Consumes: `ticketTier(auth)`, `scopeCompanyIds(auth)` from `services/ticketScope.js`; `NETWORK_LABEL`, `identityName`, `previewOf` from `rules.js`.
- Produces from `visibility.js`: `QUEUES`, `visibilityFilter(auth) → object`, `queueFilter(queue, auth) → object | null`, `listFilter(queue, auth, extra = {}) → object | null`, `canSeeConversation(conversation, auth) → boolean`.
- Produces from `present.js`: `userName(user) → string`, `publicName(identity) → string`, `mirrorAuthorName({ identity, message, channel, network }) → string`, `commentChannel(fields, now = new Date()) → object`, `conversationRow(conversation, ctx) → object`, `messageRow(message, ctx) → object`. `ctx` = `{ identities: Map, users: Map, companies: Map, unread: Map, replies: Map }` keyed by string ids (any may be missing).

- [ ] **Step 1: Write the failing tests**

`backend/services/messaging/visibility.test.js`:

```js
// node --test services/messaging/visibility.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { visibilityFilter, queueFilter, listFilter, canSeeConversation } = require("./visibility");

const ME = "64f100000000000000000001";
const C1 = "64f200000000000000000001";
const C2 = "64f200000000000000000002";
const plain = (value) => JSON.parse(JSON.stringify(value));

// Заглушка req.auth с тем, что читает services/ticketScope.js
const auth = (tier, companies = [C1]) => ({
  userId: ME,
  isAdmin: tier === "all",
  isEndUser: false,
  can: (request) => tier === "companies" && Boolean(request.ticket?.includes("readCompanies")),
  legacy: { responsibleForCompanies: companies.map((id) => ({ id })) },
});

test("all-tier staff see every conversation", () => {
  assert.deepEqual(visibilityFilter(auth("all")), {});
  assert.equal(canSeeConversation({ companyId: C2 }, auth("all")), true);
});

test("company-tier staff see their companies, unidentified chats and assigned ones", () => {
  assert.deepEqual(plain(visibilityFilter(auth("companies"))), {
    $or: [{ companyId: null }, { assigneeId: ME }, { companyId: { $in: [C1] } }],
  });
  const a = auth("companies");
  assert.equal(canSeeConversation({ companyId: C1 }, a), true);
  assert.equal(canSeeConversation({ companyId: null }, a), true);
  assert.equal(canSeeConversation({ companyId: C2 }, a), false);
  assert.equal(canSeeConversation({ companyId: C2, assigneeId: ME }, a), true);
});

test("own-tier staff see unidentified and assigned chats only", () => {
  assert.deepEqual(plain(visibilityFilter(auth("own"))), { $or: [{ companyId: null }, { assigneeId: ME }] });
  assert.equal(canSeeConversation({ companyId: C1 }, auth("own")), false);
});

test("queues", () => {
  const a = auth("companies");
  assert.deepEqual(plain(queueFilter("awaiting", a)), { hidden: { $ne: true }, awaitingSince: { $ne: null } });
  assert.deepEqual(plain(queueFilter("mine", a)), {
    hidden: { $ne: true },
    $or: [{ assigneeId: ME }, { assigneeId: null, companyId: { $in: [C1] } }],
  });
  assert.deepEqual(plain(queueFilter("unbound", a)), {
    hidden: { $ne: true },
    $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }],
  });
  assert.deepEqual(queueFilter("all", a), { hidden: { $ne: true } });
  assert.deepEqual(queueFilter("hidden", a), { hidden: true });
  assert.equal(queueFilter("everything", a), null);
});

test("list filter joins visibility, queue and extra with $and", () => {
  const filter = plain(listFilter("awaiting", auth("own"), { network: "telegram" }));
  assert.equal(filter.$and.length, 3);
  assert.deepEqual(filter.$and[2], { network: "telegram" });
  // у администратора видимость пустая — в $and её нет
  assert.equal(plain(listFilter("all", auth("all"))).$and.length, 1);
  assert.equal(listFilter("nope", auth("all")), null);
});
```

`backend/services/messaging/present.test.js`:

```js
// node --test services/messaging/present.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow } = require("./present");

test("the comment channel block carries names only", () => {
  const block = commentChannel(
    {
      network: "whatsapp",
      conversationId: "c1",
      messageId: "m1",
      direction: "in",
      authorName: "Андрей · WhatsApp",
      status: undefined,
      // лишнее отбрасывается, даже если его передали по ошибке
      phone: "+79142073318",
      username: "andrey",
      externalId: "79142073318@s.whatsapp.net",
    },
    new Date("2026-09-24T10:00:00Z"),
  );
  assert.deepEqual(Object.keys(block).sort(), ["authorName", "conversationId", "direction", "messageId", "network"]);
  assert.equal(JSON.stringify(block).includes("7914"), false);
});

test("a person without a real name is «Собеседник», never a phone or @nick", () => {
  assert.equal(publicName({ firstName: "Андрей" }), "Андрей");
  assert.equal(publicName({ displayName: "Марина Соколова", phone: "+79145550142" }), "Марина Соколова");
  assert.equal(publicName({ phone: "+79142073318", username: "kostya_it" }), "Собеседник");
  assert.equal(publicName(null), "Собеседник");
});

test("mirror author names", () => {
  const channel = { name: "Telegram — корпоративный", account: { displayName: "F1Lab Поддержка" } };
  // связанный пользователь — имя берёт интерфейс из автора комментария
  assert.equal(mirrorAuthorName({ identity: { userId: "u1", firstName: "Марина" }, message: { direction: "in", origin: "client" }, channel, network: "telegram" }), "");
  assert.equal(
    mirrorAuthorName({ identity: { displayName: "Андрей", phone: "+7914" }, message: { direction: "in", origin: "client" }, channel, network: "whatsapp" }),
    "Андрей · WhatsApp",
  );
  assert.equal(mirrorAuthorName({ identity: null, message: { direction: "out", origin: "device" }, channel, network: "telegram" }), "F1Lab Поддержка · с телефона");
});

const ids = { conv: "64f300000000000000000001", ident: "64f400000000000000000001", user: "64f100000000000000000001", company: "64f200000000000000000001", ticket: "64f500000000000000000001" };

test("a direct conversation row is named by the linked user", () => {
  const row = conversationRow(
    {
      _id: ids.conv,
      kind: "direct",
      network: "telegram",
      title: "",
      counterpartIdentityId: ids.ident,
      companyId: ids.company,
      binding: { ticketId: ids.ticket, ticketNum: 56812, endedAt: null },
      decision: { ticketId: null },
      lastMessage: { at: new Date("2026-09-24T10:42:00Z"), direction: "in", origin: "client", preview: "Оранжевый мигает", authorName: "Соколова Марина" },
      awaitingSince: new Date("2026-09-24T10:42:00Z"),
      hidden: false,
    },
    {
      identities: new Map([[ids.ident, { _id: ids.ident, userId: ids.user, username: "m_sokolova" }]]),
      users: new Map([[ids.user, { _id: ids.user, lastName: "Соколова", firstName: "Марина" }]]),
      companies: new Map([[ids.company, { _id: ids.company, alias: "ТД Восток" }]]),
      unread: new Map([[ids.conv, 250]]),
    },
  );
  assert.equal(row.title, "Соколова Марина");
  assert.equal(row.unknown, false);
  assert.deepEqual(row.company, { id: ids.company, alias: "ТД Восток" });
  assert.deepEqual(row.ticket, { id: ids.ticket, num: 56812 });
  assert.equal(row.unread, 99);
  assert.equal(row.decision, null);
});

test("an unknown direct contact is named by the identity and flagged", () => {
  const row = conversationRow(
    { _id: ids.conv, kind: "direct", network: "whatsapp", title: "", counterpartIdentityId: ids.ident, binding: {}, decision: {}, lastMessage: {} },
    { identities: new Map([[ids.ident, { _id: ids.ident, phone: "+79142073318" }]]) },
  );
  assert.equal(row.title, "+79142073318");
  assert.equal(row.unknown, true);
  assert.equal(row.ticket, null);
  assert.equal(row.lastMessage, null);
});

test("an ended binding is not a ticket of the row", () => {
  const row = conversationRow({ _id: ids.conv, kind: "direct", network: "telegram", binding: { ticketId: ids.ticket, ticketNum: 1, endedAt: new Date() }, decision: { ticketId: ids.ticket, ticketNum: 1 }, lastMessage: {} }, {});
  assert.equal(row.ticket, null);
  assert.deepEqual(row.decision, { ticketId: ids.ticket, ticketNum: 1 });
});

test("message rows: author, reply and system event", () => {
  const ctx = {
    identities: new Map([[ids.ident, { _id: ids.ident, displayName: "Андрей" }]]),
    users: new Map([[ids.user, { _id: ids.user, lastName: "Лебедев", firstName: "Игорь" }]]),
    replies: new Map([["r1", { _id: "r1", text: "Очередь очистил", authorName: "", authorUserId: ids.user }]]),
  };
  const inbound = messageRow({ _id: "m1", seq: 3, direction: "in", origin: "client", kind: "text", text: "Бумагу вынимали", identityId: ids.ident, replyToId: "r1", sentAt: new Date(), attachments: [], status: "received" }, ctx);
  assert.equal(inbound.author.name, "Андрей");
  assert.equal(inbound.author.isStaff, false);
  assert.deepEqual(inbound.replyTo, { id: "r1", authorName: "Лебедев Игорь", text: "Очередь очистил" });

  const outbound = messageRow({ _id: "m2", seq: 4, direction: "out", origin: "hd", kind: "text", text: "Будем в 14:00", authorUserId: ids.user, sentAt: new Date(), attachments: [], status: "read" }, ctx);
  assert.equal(outbound.author.name, "Лебедев Игорь");
  assert.equal(outbound.author.isStaff, true);

  const system = messageRow({ _id: "m3", seq: 5, direction: "system", origin: "system", kind: "event", text: "", sentAt: new Date(), attachments: [], event: { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь" } }, ctx);
  assert.deepEqual(system.event, { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь", targetName: "", count: null });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/messaging/visibility.test.js services/messaging/present.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `visibility.js`**

```js
const mongoose = require("mongoose");

const { ticketTier, scopeCompanyIds } = require("@/services/ticketScope");

/**
 * Кто какие диалоги видит — ярусы как у заявок (services/ticketScope.js): все,
 * своих компаний, свои. Неопознанных собеседников (компания не известна) видят
 * все, кто видит диалоги: их кто-то должен разобрать. Назначенный диалог виден
 * назначенному всегда. Чисто относительно базы — тесты рядом.
 */

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const visibilityFilter = (auth) => {
  const tier = ticketTier(auth);
  if (tier === "all") return {};
  const or = [{ companyId: null }, { assigneeId: oid(auth.userId) }];
  if (tier === "companies") {
    const ids = scopeCompanyIds(auth);
    if (ids.length) or.push({ companyId: { $in: ids.map(oid) } });
  }
  return { $or: or };
};

const QUEUES = ["awaiting", "mine", "unbound", "all", "hidden"];

/** Фильтр очереди «Диалогов»; null — такой очереди нет. */
const queueFilter = (queue, auth) => {
  const shown = { hidden: { $ne: true } };
  switch (queue) {
    case "awaiting":
      return { ...shown, awaitingSince: { $ne: null } };
    case "mine":
      return {
        ...shown,
        $or: [
          { assigneeId: oid(auth.userId) },
          { assigneeId: null, companyId: { $in: scopeCompanyIds(auth).map(oid) } },
        ],
      };
    case "unbound":
      return { ...shown, $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }] };
    case "all":
      return shown;
    case "hidden":
      return { hidden: true };
    default:
      return null;
  }
};

/** Видимость, очередь и доп. условия — через $and: у каждого может быть свой $or. */
const listFilter = (queue, auth, extra = {}) => {
  const queuePart = queueFilter(queue, auth);
  if (!queuePart) return null;
  const parts = [visibilityFilter(auth), queuePart, extra].filter((part) => Object.keys(part).length);
  return { $and: parts };
};

/** Виден ли человеку этот диалог — то же правило в памяти, для карточки. */
const canSeeConversation = (conversation, auth) => {
  const tier = ticketTier(auth);
  if (tier === "all" || !conversation.companyId) return true;
  if (conversation.assigneeId && String(conversation.assigneeId) === String(auth.userId)) return true;
  return tier === "companies" && scopeCompanyIds(auth).includes(String(conversation.companyId));
};

module.exports = { QUEUES, visibilityFilter, queueFilter, listFilter, canSeeConversation };
```

- [ ] **Step 4: Implement `present.js`**

```js
/**
 * Что «Диалоги» отдают наружу: строки списка и ленты (сотрудникам) и блок
 * `channel` комментария-зеркала, который видит и клиент в своей заявке — в нём
 * только имена. Чисто — тесты рядом.
 */
const { NETWORK_LABEL, identityName, previewOf } = require("./rules");

const idOf = (value) => (value ? String(value._id ?? value) : null);
const userName = (user) => (user ? `${user.lastName || ""} ${user.firstName || ""}`.trim() : "");

/** Имя для клиентских глаз: настоящее имя или «Собеседник» — не телефон и не ник. */
const publicName = (identity) => {
  if (!identity) return "Собеседник";
  const full = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  return identity.displayName || full || "Собеседник";
};

/**
 * Подпись автора комментария-зеркала. Связанный пользователь подписи не требует —
 * его имя интерфейс берёт из автора комментария. Ответ с корпоративного
 * телефона подписан аккаунтом, неизвестный собеседник — именем и сетью.
 */
const mirrorAuthorName = ({ identity, message, channel, network }) => {
  if (message.direction === "out") {
    return `${channel?.account?.displayName || channel?.name || "Корпоративный аккаунт"} · с телефона`;
  }
  if (identity?.userId) return "";
  return `${publicName(identity)} · ${NETWORK_LABEL[network] || network}`;
};

/** Блок `channel` комментария — поимённо, лишнее не проходит. */
const commentChannel = ({ network, conversationId, messageId, direction, authorName, status }, now = new Date()) => {
  const block = { network, conversationId, messageId, direction };
  if (authorName) block.authorName = String(authorName).slice(0, 200);
  if (status) {
    block.status = status;
    block.statusAt = now;
  }
  for (const key of Object.keys(block)) if (block[key] === undefined || block[key] === null) delete block[key];
  return block;
};

const get = (map, id) => (map && id ? map.get(String(id)) : undefined);

const conversationRow = (conversation, ctx = {}) => {
  const counterpart = get(ctx.identities, conversation.counterpartIdentityId);
  const user = counterpart?.userId ? get(ctx.users, counterpart.userId) : undefined;
  const company = get(ctx.companies, conversation.companyId);
  const assignee = get(ctx.users, conversation.assigneeId);
  const binding = conversation.binding || {};
  const last = conversation.lastMessage || {};
  const title =
    conversation.kind === "direct"
      ? userName(user) || identityName(counterpart) || conversation.title || ""
      : conversation.title || NETWORK_LABEL[conversation.network] || "";
  return {
    id: idOf(conversation),
    kind: conversation.kind,
    network: conversation.network,
    title,
    unknown: conversation.kind !== "group" && !user,
    company: company ? { id: idOf(company), alias: company.alias } : null,
    lastMessage: last.at
      ? { at: last.at, direction: last.direction, origin: last.origin, preview: last.preview || "", authorName: last.authorName || "" }
      : null,
    awaitingSince: conversation.awaitingSince || null,
    unread: Math.min(get(ctx.unread, idOf(conversation)) || 0, 99),
    ticket: binding.ticketId && !binding.endedAt ? { id: idOf(binding.ticketId), num: binding.ticketNum } : null,
    decision: conversation.decision?.ticketId
      ? { ticketId: idOf(conversation.decision.ticketId), ticketNum: conversation.decision.ticketNum }
      : null,
    assignee: assignee ? { id: idOf(assignee), name: userName(assignee) } : null,
    hidden: Boolean(conversation.hidden),
  };
};

const STAFF_ORIGINS = new Set(["hd", "device", "staff"]);

const messageRow = (message, ctx = {}) => {
  const identity = get(ctx.identities, message.identityId);
  const author = get(ctx.users, message.authorUserId) || (identity?.userId ? get(ctx.users, identity.userId) : undefined);
  const reply = get(ctx.replies, message.replyToId);
  const replyAuthor = reply ? get(ctx.users, reply.authorUserId) || get(ctx.identities, reply.identityId) : undefined;
  return {
    id: idOf(message),
    seq: message.seq,
    direction: message.direction,
    origin: message.origin,
    kind: message.kind,
    text: message.text || "",
    form: message.form?.fields ? message.form : null,
    sentAt: message.sentAt,
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
    author: {
      name: userName(author) || message.authorName || identityName(identity),
      userId: idOf(author),
      isStaff: STAFF_ORIGINS.has(message.origin) || Boolean(identity?.isStaff),
    },
    attachments: (message.attachments || []).map(({ name, originalName, mimetype, size, durationSec, status }) => ({
      name,
      originalName,
      mimetype,
      size,
      durationSec: durationSec ?? null,
      status,
    })),
    replyTo: reply
      ? {
          id: idOf(reply),
          authorName: userName(replyAuthor) || reply.authorName || identityName(replyAuthor),
          text: previewOf(reply),
        }
      : null,
    status: message.status,
    error: message.error || "",
    ticket: message.ticketId ? { id: idOf(message.ticketId), num: message.ticketNum } : null,
    attachMode: message.attachMode || null,
    suggestTicketId: idOf(message.suggestTicketId),
    event:
      message.direction === "system"
        ? {
            kind: message.event?.kind || "",
            ticketNum: message.event?.ticketNum ?? null,
            byName: message.event?.byName || "",
            targetName: message.event?.targetName || "",
            count: message.event?.count ?? null,
          }
        : null,
  };
};

module.exports = { userName, publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/messaging/visibility.test.js services/messaging/present.test.js`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green.

---

### Task 7: Identity resolution

**Files:**
- Create: `backend/services/messaging/identity.js`, `backend/services/messaging/identity.test.js`

**Interfaces:**
- Consumes: `normalizeRuPhone`, `findApplicantByPhone` from `services/callerIdentityService.js` (`findApplicantByPhone(raw) → { applicant, company } | null`); `models/channelIdentity`, `models/user` — only inside `modelDeps()`.
- Produces: `resolveIdentity(network, sender, deps) → Promise<identity (lean)>`, `identityPatch(existing, sender, link, normalizePhone) → object`, `linkCandidate(network, sender, deps) → Promise<{ user, method } | null>`, `modelDeps() → deps`. `deps = { findIdentity(network, externalId), upsertIdentity(network, externalId, set), findUserByTelegramId(id), findUserByPhone(phone), normalizePhone(raw) }`.

- [ ] **Step 1: Write the failing tests**

`backend/services/messaging/identity.test.js`:

```js
// node --test services/messaging/identity.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { resolveIdentity, identityPatch } = require("./identity");

const CLIENT = { _id: "u-client", isEndUser: true, company: { _id: "c-vostok" } };
const STAFF = { _id: "u-staff", isEndUser: false, company: { _id: "c-f1lab" } };
const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 11 ? `+7${digits.slice(1)}` : null;
};

const fakeDeps = ({ byTelegram = {}, byPhone = {}, existing = null } = {}) => {
  const store = new Map();
  if (existing) store.set(`${existing.network}:${existing.externalId}`, existing);
  const calls = { telegram: [], phone: [] };
  return {
    calls,
    store,
    deps: {
      findIdentity: async (network, externalId) => store.get(`${network}:${externalId}`) || null,
      upsertIdentity: async (network, externalId, set) => {
        const key = `${network}:${externalId}`;
        const next = { network, externalId, ...(store.get(key) || {}), ...set };
        store.set(key, next);
        return next;
      },
      findUserByTelegramId: async (id) => {
        calls.telegram.push(id);
        return byTelegram[id] || null;
      },
      findUserByPhone: async (phone) => {
        calls.phone.push(phone);
        return byPhone[phone] || null;
      },
      normalizePhone,
    },
  };
};

test("a Telegram sender who linked the HD bot is recognised", async () => {
  const { deps } = fakeDeps({ byTelegram: { 123456: CLIENT } });
  const identity = await resolveIdentity("telegram", { id: "123456", name: "Марина Соколова", username: "@m_sokolova" }, deps);
  assert.equal(identity.userId, "u-client");
  assert.equal(identity.linkMethod, "tgBot");
  assert.equal(identity.companyId, "c-vostok");
  assert.equal(identity.isStaff, false);
  assert.equal(identity.username, "m_sokolova");
});

test("a staff member's own account is marked as staff", async () => {
  const { deps } = fakeDeps({ byTelegram: { 777: STAFF } });
  const identity = await resolveIdentity("telegram", { id: "777", name: "Игорь" }, deps);
  assert.equal(identity.isStaff, true);
});

test("a WhatsApp phone that belongs to a user links by phone", async () => {
  const { deps, calls } = fakeDeps({ byPhone: { "+79145550142": CLIENT } });
  const identity = await resolveIdentity("whatsapp", { id: "79145550142@s.whatsapp.net", phone: "8 914 555-01-42" }, deps);
  assert.equal(identity.userId, "u-client");
  assert.equal(identity.linkMethod, "phone");
  assert.equal(identity.phone, "+79145550142");
  // Telegram-привязка у WhatsApp не проверяется
  assert.deepEqual(calls.telegram, []);
});

test("a name alone links nobody", async () => {
  const { deps } = fakeDeps();
  const identity = await resolveIdentity("whatsapp", { id: "79142073318@s.whatsapp.net", name: "Андрей" }, deps);
  assert.equal(identity.userId, undefined);
  assert.equal(identity.displayName, "Андрей");
});

test("an existing link is never overwritten by automation", async () => {
  const existing = { network: "telegram", externalId: "123456", userId: "u-manual", linkMethod: "manual" };
  const { deps, calls } = fakeDeps({ byTelegram: { 123456: CLIENT }, existing });
  const identity = await resolveIdentity("telegram", { id: "123456", name: "Марина" }, deps);
  assert.equal(identity.userId, "u-manual");
  assert.equal(identity.linkMethod, "manual");
  // связанного не ищем заново
  assert.deepEqual(calls.telegram, []);
});

test("the patch keeps only what the sender brought", () => {
  assert.deepEqual(identityPatch(null, { id: "1", email: "E.Kravtsova@SevPort.ru" }, null, normalizePhone), { email: "e.kravtsova@sevport.ru" });
  assert.deepEqual(identityPatch(null, { id: "1" }, null, normalizePhone), {});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/messaging/identity.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`backend/services/messaging/identity.js`:

```js
/**
 * Собеседник канала → личность (ChannelIdentity) и, при твёрдом основании,
 * пользователь HD. Основания: Telegram-id совпал с привязкой бота HD
 * (`User.telegramBot.chatId`), телефон нашёлся у пользователя
 * (`findApplicantByPhone`), код привязки MAX (P3) или ручное «Это он». По имени
 * и нику — никогда: «Андрей» из WhatsApp не повод считать его Андреем из
 * Примавто.
 *
 * deps подменяются в тестах; в бою — modelDeps().
 */

const linkCandidate = async (network, sender, deps) => {
  if (network === "telegram") {
    const user = await deps.findUserByTelegramId(String(sender.id));
    if (user) return { user, method: "tgBot" };
  }
  const phone = deps.normalizePhone(sender.phone || "");
  if (phone) {
    const user = await deps.findUserByPhone(phone);
    if (user) return { user, method: "phone" };
  }
  return null;
};

/** Поля записи: то, что принёс собеседник, и связь — если её ещё нет. */
const identityPatch = (existing, sender, link, normalizePhone) => {
  const set = {};
  if (sender.firstName) set.firstName = sender.firstName;
  if (sender.lastName) set.lastName = sender.lastName;
  if (sender.name) set.displayName = sender.name;
  if (sender.username) set.username = String(sender.username).replace(/^@/, "");
  const phone = normalizePhone(sender.phone || "");
  if (phone) set.phone = phone;
  if (sender.email) set.email = String(sender.email).toLowerCase();
  if (sender.isBot) set.isBot = true;
  // Ручное «Это он» сильнее автоматики: связанную личность не перепривязываем
  if (!existing?.userId && link) {
    set.userId = link.user._id;
    set.linkMethod = link.method;
    set.isStaff = link.user.isEndUser === false;
    set.companyId = link.user.company?._id || null;
  }
  return set;
};

const resolveIdentity = async (network, sender, deps) => {
  const existing = await deps.findIdentity(network, String(sender.id));
  const link = existing?.userId ? null : await linkCandidate(network, sender, deps);
  return deps.upsertIdentity(network, String(sender.id), identityPatch(existing, sender, link, deps.normalizePhone));
};

const USER_FIELDS = "_id company isEndUser isServiceAccount";

const modelDeps = () => {
  const ChannelIdentity = require("@/models/channelIdentity");
  const User = require("@/models/user");
  const { normalizeRuPhone, findApplicantByPhone } = require("@/services/callerIdentityService");
  return {
    findIdentity: (network, externalId) => ChannelIdentity.findOne({ network, externalId }).lean(),
    upsertIdentity: (network, externalId, set) =>
      ChannelIdentity.findOneAndUpdate(
        { network, externalId },
        { $setOnInsert: { network, externalId }, ...(Object.keys(set).length ? { $set: set } : {}) },
        { upsert: true, new: true },
      ).lean(),
    findUserByTelegramId: (id) =>
      User.findOne({ "telegramBot.chatId": String(id), isServiceAccount: { $ne: true } }).select(USER_FIELDS).lean(),
    findUserByPhone: async (phone) => {
      const found = await findApplicantByPhone(phone);
      const user = found?.applicant;
      return user && !user.isServiceAccount
        ? { _id: user._id, company: user.company, isEndUser: user.isEndUser }
        : null;
    },
    normalizePhone: normalizeRuPhone,
  };
};

module.exports = { resolveIdentity, identityPatch, linkCandidate, modelDeps };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/messaging/identity.test.js`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green.

---

### Task 8: The gateway job queue

**Files:**
- Create: `backend/services/messaging/jobs.js`, `backend/services/messaging/jobs.test.js`

**Interfaces:**
- Consumes: `MAX_ATTEMPTS`, `backoffMs`, `advanceStatus` (`rules.js`); models `ChannelJob`, `Message`, `Comment` (lazily).
- Produces: `LEASE_MS`, `pickHeads(candidates, headIds, limit) → job[]`, `applyAck(job, result, now) → patch`, `enqueueJob(fields) → Promise<job>`, `leaseJobs({ networks, limit, now }) → Promise<{ leaseId, leaseUntil, jobs }>`, `ackJobs(leaseId, results, { now }) → Promise<{ applied, ignored }>`, `waitForJob(networks, ms) → Promise<void>`. Ack result shape: `{ id, ok, retryable?, retryAfterMs?, error?, result? }`; for `send`: `result = { externalId, externalIds? }`; for `fetchMedia`: `result = { attachments: [...] }`.

- [ ] **Step 1: Write the failing tests**

`backend/services/messaging/jobs.test.js`:

```js
// node --test services/messaging/jobs.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pickHeads, applyAck } = require("./jobs");

const NOW = Date.parse("2026-09-24T10:00:00Z");

test("only the head of each conversation's queue is handed out", () => {
  const candidates = [
    { _id: "j1", conversationId: "c1" },
    { _id: "j2", conversationId: "c1" },
    { _id: "j3", conversationId: null }, // вход, выход — без диалога
    { _id: "j4", conversationId: "c2" },
  ];
  // j0 — более старое задание c1 ждёт повтора: j1 и j2 не головы
  assert.deepEqual(pickHeads(candidates, ["j0", "j4"], 10).map((job) => job._id), ["j3", "j4"]);
  assert.deepEqual(pickHeads(candidates, ["j1", "j4"], 10).map((job) => job._id), ["j1", "j3", "j4"]);
  assert.deepEqual(pickHeads(candidates, ["j1", "j4"], 2).map((job) => job._id), ["j1", "j3"]);
});

test("a successful ack finishes the job", () => {
  const patch = applyAck({ attempts: 0 }, { ok: true }, NOW);
  assert.equal(patch.state, "done");
  assert.equal(patch.attempts, 1);
  assert.equal(patch.finishedAt.getTime(), NOW);
});

test("a retryable failure backs off; the fifth one gives up", () => {
  const first = applyAck({ attempts: 0 }, { ok: false, error: "timeout" }, NOW);
  assert.equal(first.state, "pending");
  assert.equal(first.attempts, 1);
  assert.equal(first.notBefore.getTime(), NOW + 30_000);
  const last = applyAck({ attempts: 4 }, { ok: false, error: "timeout" }, NOW);
  assert.equal(last.state, "failed");
  assert.equal(last.attempts, 5);
});

test("a permanent failure gives up at once", () => {
  const patch = applyAck({ attempts: 0 }, { ok: false, retryable: false, error: "USER_IS_BLOCKED" }, NOW);
  assert.equal(patch.state, "failed");
  assert.equal(patch.lastError, "USER_IS_BLOCKED");
});

test("FLOOD_WAIT is a pause, not an attempt", () => {
  const patch = applyAck({ attempts: 2 }, { ok: false, retryAfterMs: 45_000, error: "FLOOD_WAIT_45" }, NOW);
  assert.equal(patch.state, "pending");
  assert.equal(patch.attempts, 2);
  assert.equal(patch.notBefore.getTime(), NOW + 45_000);
  // безумная пауза режется до 6 часов
  const capped = applyAck({ attempts: 0 }, { ok: false, retryAfterMs: 10 * 24 * 3600_000 }, NOW);
  assert.equal(capped.notBefore.getTime(), NOW + 6 * 3600_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/messaging/jobs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`backend/services/messaging/jobs.js`:

```js
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { MAX_ATTEMPTS, backoffMs, advanceStatus } = require("./rules");

/**
 * Очередь шлюза: отправка сообщений и команды. Выдача — арендой (как очередь
 * telegram-уведомлений, controllers/bot.js): findOneAndUpdate атомарен, одно
 * задание дважды не уходит, транзакций не нужно. Порядок в диалоге: выдаётся
 * только голова очереди диалога — более новое сообщение не обгонит старое,
 * которое ждёт повтора.
 */

const LEASE_MS = 2 * 60 * 1000;
const MAX_PAUSE_MS = 6 * 3600 * 1000;

// Долгий опрос шлюза просыпается, как только появилось задание
const signal = new EventEmitter();
signal.setMaxListeners(100);

/** Голова очереди каждого диалога + задания без диалога. Чисто. */
const pickHeads = (candidates, headIds, limit) => {
  const heads = new Set(headIds.map(String));
  return candidates.filter((job) => !job.conversationId || heads.has(String(job._id))).slice(0, limit);
};

/** Поля задания после ответа шлюза. Чисто. */
const applyAck = (job, result, now = Date.now()) => {
  const lastError = String(result?.error || "").slice(0, 500);
  if (result?.ok) return { state: "done", attempts: job.attempts + 1, lastError: "", finishedAt: new Date(now) };
  // FLOOD_WAIT и прочие «подождите»: пауза, а не попытка
  if (Number.isFinite(result?.retryAfterMs) && result.retryAfterMs > 0) {
    return {
      state: "pending",
      attempts: job.attempts,
      lastError,
      notBefore: new Date(now + Math.min(result.retryAfterMs, MAX_PAUSE_MS)),
    };
  }
  const attempts = job.attempts + 1;
  if (result?.retryable === false || attempts >= MAX_ATTEMPTS) {
    return { state: "failed", attempts, lastError, finishedAt: new Date(now) };
  }
  return { state: "pending", attempts, lastError, notBefore: new Date(now + backoffMs(attempts)) };
};

const enqueueJob = async (fields) => {
  const ChannelJob = require("@/models/channelJob");
  const job = await ChannelJob.create(fields);
  signal.emit("job", job.network);
  return job;
};

const leaseJobs = async ({ networks, limit = 10, now = new Date() }) => {
  const mongoose = require("mongoose");
  const ChannelJob = require("@/models/channelJob");
  const free = { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] };
  const candidates = await ChannelJob.find({ state: "pending", network: { $in: networks }, notBefore: { $lte: now }, ...free })
    .sort({ createdAt: 1 })
    .limit(limit * 5)
    .lean();
  const conversationIds = [...new Set(candidates.map((job) => job.conversationId).filter(Boolean).map(String))];
  const heads = conversationIds.length
    ? await ChannelJob.aggregate([
        {
          $match: {
            state: "pending",
            conversationId: { $in: conversationIds.map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        { $sort: { createdAt: 1 } },
        { $group: { _id: "$conversationId", jobId: { $first: "$_id" } } },
      ])
    : [];

  const leaseId = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const jobs = [];
  for (const job of pickHeads(candidates, heads.map((row) => row.jobId), limit)) {
    const taken = await ChannelJob.findOneAndUpdate(
      { _id: job._id, state: "pending", ...free },
      { $set: { leaseId, leaseUntil } },
      { new: true },
    ).lean();
    if (taken) jobs.push(taken);
  }
  return { leaseId, leaseUntil, jobs };
};

/** Долгий опрос: ждать задание для своих сетей не дольше ms. */
const waitForJob = (networks, ms) =>
  new Promise((resolve) => {
    const onJob = (network) => {
      if (!networks.includes(network)) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal.off("job", onJob);
    };
    signal.on("job", onJob);
  });

/** Итог отправки — в сообщение и в комментарий, если ответ ушёл из заявки. */
const applySendOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  const { bus } = require("@/services/pulse");
  const message = await Message.findById(job.messageId);
  if (!message) return;
  if (job.state === "done") {
    message.status = advanceStatus(message.status, "sent");
    message.error = "";
    if (result?.result?.externalId && !message.externalId) message.externalId = String(result.result.externalId);
    if (Array.isArray(result?.result?.externalIds)) message.externalIds = result.result.externalIds.map(String);
  } else if (job.state === "failed") {
    message.status = advanceStatus(message.status, "failed");
    message.error = job.lastError || "Не отправлено";
  } else {
    message.error = job.lastError || "";
  }
  try {
    await message.save();
  } catch (error) {
    // Эхо с тем же внешним id успело прийти раньше подтверждения без jobId —
    // статус сохраняем, id оставляем эху (шлюз обязан метить эхо jobId)
    if (error?.code !== 11000) throw error;
    message.externalId = undefined;
    await message.save();
  }
  if (message.commentId) {
    await Comment.updateOne(
      { _id: message.commentId },
      { $set: { "channel.status": message.status, "channel.statusAt": new Date(), "channel.error": message.error || undefined } },
    );
  }
  bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
};

const applyMediaOutcome = async (job, result) => {
  const Message = require("@/models/message");
  const list = result?.result?.attachments;
  if (job.state !== "done" || !Array.isArray(list)) return;
  await Message.updateOne(
    { _id: job.messageId },
    {
      $set: {
        attachments: list.slice(0, 20).map((a) => ({
          name: String(a.name || ""),
          originalName: String(a.originalName || ""),
          mimetype: String(a.mimetype || ""),
          size: Number(a.size) || 0,
          durationSec: Number.isFinite(a.durationSec) ? a.durationSec : null,
          status: ["ready", "skipped", "failed"].includes(a.status) ? a.status : "ready",
          externalRef: String(a.externalRef || ""),
        })),
      },
    },
  );
};

const ackJobs = async (leaseId, results, { now = Date.now() } = {}) => {
  const ChannelJob = require("@/models/channelJob");
  let applied = 0;
  let ignored = 0;
  for (const result of results) {
    // Каждый элемент сам по себе: негодный id не должен унести подтверждения соседей
    let job = null;
    try {
      job = await ChannelJob.findOne({ _id: result?.id, leaseId });
    } catch {
      job = null;
    }
    if (!job) {
      ignored += 1;
      continue;
    }
    Object.assign(job, applyAck(job, result, now), { leaseId: null, leaseUntil: null, result: result.result ?? null });
    // Код и пароль входа не храним ни минуты дольше нужного
    if (job.type === "login") job.payload = { ...job.payload, value: null };
    await job.save();
    if (job.type === "send" && job.messageId) await applySendOutcome(job, result);
    if (job.type === "fetchMedia" && job.messageId) await applyMediaOutcome(job, result);
    applied += 1;
  }
  return { applied, ignored };
};

module.exports = { LEASE_MS, pickHeads, applyAck, enqueueJob, leaseJobs, ackJobs, waitForJob };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && NODE_ENV=production node --test services/messaging/jobs.test.js`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`cd backend && NODE_ENV=production pnpm test` green.

---

### Task 9: Ingest pipeline, mirroring into tickets, bindings, notices

**Files:**
- Create: `backend/services/messaging/conversationStore.js`, `mirror.js`, `bindings.js`, `notify.js`, `ingest.js`
- Modify: `backend/models/ticket.js` (two hooks next to `touchActivity`)
- Modify: `backend/middleware/notifications.js:1724-1843` (applicant branches), `backend/services/inAppNotifications.js` (`buildCommentItems`), `backend/services/inAppNotifications.test.js`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  - `conversationStore.js`: `nextSeq(conversationId) → Promise<number>`, `addSystemLine(conversation, { kind, ticketNum?, by?, targetName?, count? }) → Promise<message>`, `userTalksHere(conversation, userId) → Promise<boolean>`, `displayNameFor(identity) → Promise<string>`.
  - `mirror.js`: `mirrorToTicket({ message, ticket, conversation, identity, channel, prefs, skipApplicant }) → Promise<commentId>`.
  - `bindings.js`: `bindConversation({ conversation, ticket, by, attachPending = true, eventKind = "bound" })`, `unbindConversation({ conversation, by })`, `endBindingsForTicket(ticketId, reason)`, `restoreBindingsAfterReopen(ticketId)`, `attachMessages({ conversation, messages, ticket, mode, by })`.
  - `notify.js`: `notifyWaiting({ conversation, message, title }) → Promise<number>`.
  - `ingest.js`: `ingestEvent(event) → Promise<{ ok: boolean, retryable?: boolean, error?: string, ignored?: boolean }>`.

- [ ] **Step 1: Write the failing test (notification side)**

Append to `backend/services/inAppNotifications.test.js`:

```js
test("a reply delivered by messenger does not notify the applicant in the app", () => {
  const applicant = user("a1");
  const responsible = user("r1");
  const author = user("x1");
  const usersById = usersOf(applicant, responsible, author);
  const t = ticket({ responsibles: [{ _id: "r1" }] });
  const base = { _id: "cm1", content: "Будем в 14:00", createdBy: "x1" };

  const plain = buildCommentItems({ comment: { ...base, notifications: {} }, ticket: t, usersById, prefs });
  assert.deepEqual(plain.items.map((item) => String(item.userId)).sort(), ["a1", "r1"]);

  const delivered = buildCommentItems({ comment: { ...base, notifications: { skipApplicant: true } }, ticket: t, usersById, prefs });
  assert.deepEqual(delivered.items.map((item) => String(item.userId)), ["r1"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_ENV=production node --test services/inAppNotifications.test.js`
Expected: FAIL — the applicant is still in the second list.

- [ ] **Step 3: Skip the applicant for messenger-delivered comments**

`backend/services/inAppNotifications.js`, in `buildCommentItems`, replace the `recipients` declaration:

```js
  // Ответ ушёл заявителю мессенджером (services/messaging): в приложении тот же
  // текст ему не дублируем — ответственным уведомление остаётся
  const skipApplicant = comment.notifications?.skipApplicant === true;
  const recipients = [
    skipApplicant ? null : usersById.get(idOf(ticket.applicantId)),
    ...(ticket.responsibles || []).map((r) => usersById.get(idOf(r))),
  ].filter(Boolean);
```

`backend/middleware/notifications.js`, right after `const applicant = await User.findById(ticket.applicantId);` in `createCommentNotifications`:

```js
    // Ответ ушёл клиенту мессенджером (services/messaging): заявителю тот же
    // текст ни ботом, ни письмом не дублируем
    const skipApplicant = comment.notifications?.skipApplicant === true;
```

and in both applicant branches (Telegram at ~1740, e-mail at ~1834) prefix the condition with `!skipApplicant &&`:

```js
          if (
            !skipApplicant &&
            String(applicant?._id) !== authorId &&
            notifyTg(applicant, "ticketNewComment")
          ) {
```

(keep the rest of each condition exactly as it is; the e-mail branch uses `notifyEmail(applicant, "ticketNewComment")`).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && NODE_ENV=production node --test services/inAppNotifications.test.js && node --check middleware/notifications.js`
Expected: PASS.

- [ ] **Step 5: `conversationStore.js`**

```js
/**
 * Мелкие общие операции диалога: номер в ленте, системная строка, «говорит ли
 * здесь этот человек», имя собеседника.
 */
const { identityName } = require("./rules");
const { userName } = require("./present");

/** Следующий номер сообщения в диалоге — порядок при равном времени. */
const nextSeq = async (conversationId) => {
  const Conversation = require("@/models/conversation");
  const doc = await Conversation.findOneAndUpdate(
    { _id: conversationId },
    { $inc: { lastSeq: 1 } },
    { new: true, projection: { lastSeq: 1 } },
  ).lean();
  return doc.lastSeq;
};

/** Системная строка ленты («Создана заявка №…», «Ответ не нужен · …»). */
const addSystemLine = async (conversation, { kind, ticketNum, by, targetName, count }) => {
  const Message = require("@/models/message");
  const seq = await nextSeq(conversation._id);
  return Message.create({
    conversationId: conversation._id,
    channelId: conversation.channelId,
    externalChatId: conversation.externalChatId,
    seq,
    direction: "system",
    origin: "system",
    kind: "event",
    sentAt: new Date(),
    status: "received",
    effects: { conversation: true, attach: true, notify: true },
    event: {
      kind,
      ticketNum: ticketNum ?? undefined,
      byUserId: by?._id ?? undefined,
      byName: by ? userName(by) : undefined,
      targetName: targetName || undefined,
      count: count ?? undefined,
    },
  });
};

/** Участвует ли пользователь в диалоге (собеседник или участник группы). */
const userTalksHere = async (conversation, userId) => {
  if (!userId) return false;
  const ChannelIdentity = require("@/models/channelIdentity");
  const ids = [conversation.counterpartIdentityId, ...(conversation.participants || []).map((p) => p.identityId)].filter(Boolean);
  if (!ids.length) return false;
  return Boolean(await ChannelIdentity.exists({ _id: { $in: ids }, userId }));
};

/** «Фамилия Имя» связанного пользователя или имя из мессенджера. */
const displayNameFor = async (identity) => {
  if (!identity) return "";
  if (identity.userId) {
    const User = require("@/models/user");
    const user = await User.findById(identity.userId).select("firstName lastName").lean();
    if (user) return userName(user);
  }
  return identityName(identity);
};

module.exports = { nextSeq, addSystemLine, userTalksHere, displayNameFor };
```

- [ ] **Step 6: `mirror.js`**

```js
/**
 * Сообщение → комментарий заявки. Идемпотентно по `channel.messageId`: повтор
 * доставки не плодит комментариев. `_id` уходит в `ticket.comments` — иначе
 * интерфейс его не увидит. Время — время мессенджера, автор — связанный
 * пользователь или служебная учётка по умолчанию с подписью в `channel.authorName`.
 * Вложения — копиями: удаление вложения из заявки удаляет файл.
 */
const { commentContent } = require("./rules");
const { commentChannel, mirrorAuthorName } = require("./present");

const mirrorToTicket = async ({ message, ticket, conversation, identity, channel, prefs, skipApplicant = false }) => {
  const Comment = require("@/models/comment");
  const Message = require("@/models/message");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");

  const existing = await Comment.findOne({ "channel.messageId": message._id }).select("_id").lean();
  if (existing) {
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: existing._id } });
    await Message.updateOne({ _id: message._id }, { $set: { commentId: existing._id } });
    return existing._id;
  }

  const authorId = identity?.userId || prefs?.defaultApplicant?._id;
  if (!authorId) throw new Error("Не задана служебная учётка по умолчанию (Настройки → Сбор заявок)");

  const attachments = [];
  for (const attachment of message.attachments || []) {
    if (attachment.status !== "ready" || !attachment.name) continue;
    try {
      attachments.push({
        name: await storage.copyObject(attachment.name),
        originalName: attachment.originalName,
        mimetype: attachment.mimetype,
      });
    } catch (error) {
      require("@/utils/logger").log("warn", "Вложение сообщения не скопировано в заявку", {
        module: "messaging",
        messageId: String(message._id),
        error: error.message,
      });
    }
  }

  const comment = await Comment.create({
    content: commentContent(message),
    ticketId: ticket._id,
    attachments,
    notifications: { lastAction: "new comment", pending: true, skipApplicant },
    channel: commentChannel({
      network: conversation.network,
      conversationId: conversation._id,
      messageId: message._id,
      direction: message.direction === "in" ? "in" : "out",
      authorName: mirrorAuthorName({ identity, message, channel, network: conversation.network }),
      status: message.direction === "out" ? message.status : undefined,
    }),
    createdBy: authorId,
    updatedBy: authorId,
    createdAt: message.sentAt,
  });
  await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: comment._id } });
  await Message.updateOne({ _id: message._id }, { $set: { commentId: comment._id } });
  return comment._id;
};

module.exports = { mirrorToTicket };
```

- [ ] **Step 7: `bindings.js`**

```js
/**
 * Привязка личного чата к заявке: пока она жива, переписка идёт в заявку в обе
 * стороны. Закрытие заявки привязку заканчивает; возврат в работу возвращает
 * её там, где клиент уже написал после закрытия (вопрос «по заявке №X?»).
 */
const { bus } = require("@/services/pulse");
const { addSystemLine, userTalksHere } = require("./conversationStore");
const { mirrorToTicket } = require("./mirror");

const loadPrefs = () => require("@/models/preferences").findOne({}).select("defaultApplicant").lean();

/** Сообщения — в заявку (зеркалами), по порядку. Уже прикреплённые пропускаются. */
const attachMessages = async ({ conversation, messages, ticket, mode }) => {
  const Message = require("@/models/message");
  const ChannelIdentity = require("@/models/channelIdentity");
  const Channel = require("@/models/channel");
  const prefs = await loadPrefs();
  const channel = await Channel.findById(conversation.channelId).lean();
  const skipApplicant = await userTalksHere(conversation, ticket.applicantId);
  let count = 0;
  for (const message of messages) {
    const claimed = await Message.findOneAndUpdate(
      { _id: message._id, ticketId: null },
      { $set: { ticketId: ticket._id, ticketNum: ticket.num, attachMode: mode } },
      { new: true },
    ).lean();
    if (!claimed) continue;
    const identity = claimed.identityId ? await ChannelIdentity.findById(claimed.identityId).lean() : null;
    await mirrorToTicket({ message: claimed, ticket, conversation, identity, channel, prefs, skipApplicant });
    count += 1;
  }
  return count;
};

const bindConversation = async ({ conversation, ticket, by, attachPending = true, eventKind = "bound" }) => {
  const Conversation = require("@/models/conversation");
  const Message = require("@/models/message");
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        binding: {
          ticketId: ticket._id,
          ticketNum: ticket.num,
          boundAt: new Date(),
          boundBy: by?._id || null,
          endedAt: null,
          endReason: null,
        },
        decision: { ticketId: null, ticketNum: null, at: null },
      },
    },
  );
  await addSystemLine(conversation, { kind: eventKind, ticketNum: ticket.num, by });
  // Неотвеченное клиента — тоже в заявку: ради него и привязывают
  if (attachPending && conversation.awaitingSince) {
    const pending = await Message.find({
      conversationId: conversation._id,
      ticketId: null,
      direction: { $in: ["in", "out"] },
      origin: { $ne: "hd" },
      imported: { $ne: true },
      sentAt: { $gte: conversation.awaitingSince },
    })
      .sort({ sentAt: 1, seq: 1 })
      .lean();
    await attachMessages({ conversation, messages: pending, ticket, mode: "bound" });
  }
  bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
};

const unbindConversation = async ({ conversation, by }) => {
  const Conversation = require("@/models/conversation");
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, "binding.ticketId": { $ne: null }, "binding.endedAt": null },
    { $set: { "binding.endedAt": new Date(), "binding.endReason": "manual" } },
  ).lean();
  if (!updated) return false;
  await addSystemLine(conversation, { kind: "unbound", ticketNum: updated.binding.ticketNum, by });
  bus.bump({ topics: ["conversations"] });
  return true;
};

const endBindingsForTicket = async (ticketId, reason) => {
  const Conversation = require("@/models/conversation");
  const bound = await Conversation.find({ "binding.ticketId": ticketId, "binding.endedAt": null }).lean();
  for (const conversation of bound) {
    const ended = await Conversation.updateOne(
      { _id: conversation._id, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": reason } },
    );
    if (ended.modifiedCount) {
      await addSystemLine(conversation, { kind: "bindingEnded", ticketNum: conversation.binding.ticketNum });
    }
  }
  if (bound.length) bus.bump({ topics: ["conversations"] });
};

const restoreBindingsAfterReopen = async (ticketId) => {
  const Conversation = require("@/models/conversation");
  const Message = require("@/models/message");
  const { Ticket } = require("@/models/ticket");
  const ticket = await Ticket.findById(ticketId).select("_id num applicantId isClosed").lean();
  if (!ticket || ticket.isClosed) return;
  const waiting = await Conversation.find({
    "binding.ticketId": ticketId,
    "binding.endReason": "closed",
    "decision.ticketId": ticketId,
  }).lean();
  for (const conversation of waiting) {
    const since = conversation.binding.endedAt;
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          "binding.endedAt": null,
          "binding.endReason": null,
          decision: { ticketId: null, ticketNum: null, at: null },
        },
      },
    );
    await addSystemLine(conversation, { kind: "bindingRestored", ticketNum: ticket.num });
    const after = await Message.find({
      conversationId: conversation._id,
      ticketId: null,
      direction: { $in: ["in", "out"] },
      origin: { $ne: "hd" },
      imported: { $ne: true },
      sentAt: { $gte: since },
    })
      .sort({ sentAt: 1, seq: 1 })
      .lean();
    await attachMessages({ conversation, messages: after, ticket, mode: "bound" });
  }
  if (waiting.length) bus.bump({ topics: ["conversations"], ticketIds: [ticketId] });
};

module.exports = { attachMessages, bindConversation, unbindConversation, endBindingsForTicket, restoreBindingsAfterReopen };
```

- [ ] **Step 8: `notify.js`**

```js
/**
 * Колокольчик о сообщении, которое ждёт ответа и не попало в заявку (у
 * привязанного чата будит уведомление о комментарии). Кому: назначенному;
 * нет его — ответственным за компанию; нет компании — тем, кто ведёт диалоги.
 */
const { previewOf } = require("./rules");

const USER_FIELDS = "_id firstName lastName notify isServiceAccount banned isEndUser";

const recipientsFor = async (conversation) => {
  const User = require("@/models/user");
  if (conversation.assigneeId) {
    return User.find({ _id: conversation.assigneeId }).select(USER_FIELDS).lean();
  }
  if (conversation.companyId) {
    const Company = require("@/models/company");
    const company = await Company.findById(conversation.companyId).select("responsibles").lean();
    // В карточке компании ответственный хранится ссылкой в поле `id`
    const ids = (company?.responsibles || []).map((r) => r.id || r._id).filter(Boolean);
    if (ids.length) {
      return User.find({ _id: { $in: ids }, isEndUser: false }).select(USER_FIELDS).lean();
    }
  }
  const { permissionFilter } = require("@/services/permissions");
  return User.find(await permissionFilter("conversation.manage")).select(USER_FIELDS).lean();
};

const notifyWaiting = async ({ conversation, message, title }) => {
  const { pushInApp } = require("@/services/inAppNotifications");
  return pushInApp({
    recipients: await recipientsFor(conversation),
    category: "conversationMessage",
    kind: "message",
    title,
    text: previewOf(message),
    link: `/conversations/${conversation._id}`,
  });
};

module.exports = { notifyWaiting, recipientsFor };
```

- [ ] **Step 9: `ingest.js`**

```js
/**
 * Единый вход событий каналов: шлюз (Telegram, WhatsApp), вебхук MAX, форма
 * сайта. Событие уже проверено (events.js). Каждый шаг повторяем: повтор
 * доставки находит сообщение по уникальному индексу и доделывает только шаги
 * без отметки в `effects` — транзакций у standalone-MongoDB нет.
 */
const rules = require("./rules");
const { resolveIdentity, modelDeps } = require("./identity");
const { nextSeq, addSystemLine, userTalksHere, displayNameFor } = require("./conversationStore");
const { mirrorToTicket } = require("./mirror");
const { notifyWaiting } = require("./notify");

let identityDeps = null;
const deps = () => (identityDeps ||= modelDeps());

const m = () => ({
  Channel: require("@/models/channel"),
  Conversation: require("@/models/conversation"),
  Message: require("@/models/message"),
  ChannelIdentity: require("@/models/channelIdentity"),
  Comment: require("@/models/comment"),
  Preferences: require("@/models/preferences"),
  Ticket: require("@/models/ticket").Ticket,
});

const bump = (ticketIds = []) => require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds });

const deviceName = (channel) => `${channel.account?.displayName || channel.name} · с телефона`;

const markEffect = (messageId, effect) =>
  m().Message.updateOne({ _id: messageId }, { $set: { [`effects.${effect}`]: true } });

const upsertConversation = async (channel, chat, counterpart) => {
  const { Conversation } = m();
  const filter = { channelId: channel._id, externalChatId: chat.id };
  const set = {};
  if (chat.title) set.title = chat.title;
  if (chat.kind === "direct" && counterpart) set.counterpartIdentityId = counterpart._id;
  const update = {
    $setOnInsert: { channelId: channel._id, network: channel.type, kind: chat.kind, externalChatId: chat.id },
    ...(Object.keys(set).length ? { $set: set } : {}),
  };
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(filter, update, { upsert: true, new: true }).lean();
  } catch (error) {
    // Два события нового чата разом: второй upsert упирается в уникальный индекс
    if (error?.code !== 11000) throw error;
    conversation = await Conversation.findOneAndUpdate(filter, { ...(Object.keys(set).length ? { $set: set } : {}) }, { new: true }).lean();
  }
  if (!conversation.companyId && counterpart?.companyId) {
    conversation =
      (await Conversation.findOneAndUpdate(
        { _id: conversation._id, companyId: null },
        { $set: { companyId: counterpart.companyId } },
        { new: true },
      ).lean()) || conversation;
  }
  return conversation;
};

const addParticipant = async (conversation, identity) => {
  if (conversation.kind !== "group" || !identity) return;
  await m().Conversation.updateOne(
    { _id: conversation._id, "participants.identityId": { $ne: identity._id } },
    { $push: { participants: { identityId: identity._id, isStaff: Boolean(identity.isStaff) } } },
  );
};

const insertMessage = async ({ channel, conversation, event, identity }) => {
  const { Message } = m();
  const msg = event.message;
  const key = { channelId: channel._id, externalChatId: event.chat.id, externalId: msg.id };
  const existing = await Message.findOne(key).lean();
  if (existing) return existing;
  const origin = msg.direction === "in" ? (msg.origin === "form" ? "form" : identity?.isStaff ? "staff" : "client") : "device";
  const replyTo = msg.replyToId
    ? await Message.findOne({ channelId: channel._id, externalChatId: event.chat.id, externalId: msg.replyToId }).select("_id").lean()
    : null;
  try {
    const created = await Message.create({
      ...key,
      conversationId: conversation._id,
      seq: await nextSeq(conversation._id),
      direction: msg.direction,
      origin,
      kind: msg.kind,
      identityId: identity?._id || null,
      authorName: origin === "device" ? deviceName(channel) : "",
      text: msg.text,
      attachments: msg.attachments,
      form: msg.form || undefined,
      replyToExternalId: msg.replyToId,
      replyToId: replyTo?._id || null,
      sentAt: msg.sentAt,
      status: msg.direction === "out" ? "sent" : "received",
      imported: msg.imported,
    });
    return created.toObject();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Message.findOne(key).lean();
  }
};

const applyConversationEffects = async (conversation, message, identity) => {
  const { Conversation, Channel } = m();
  const authorName = message.direction === "in" ? await displayNameFor(identity) : message.authorName;
  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: message.sentAt } }] },
    {
      $set: {
        lastMessage: {
          at: message.sentAt,
          direction: message.direction,
          origin: message.origin,
          preview: rules.previewOf(message),
          authorName,
        },
      },
    },
  );
  const next = rules.nextAwaiting(conversation, message);
  if (next?.awaitingSince) {
    await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: null },
      { $set: { awaitingSince: next.awaitingSince, handled: { at: null, by: null, how: null } } },
    );
  } else if (next) {
    await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: { $lte: message.sentAt } },
      { $set: { awaitingSince: null } },
    );
  }
  await Channel.updateOne(
    { _id: conversation.channelId, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: message.sentAt } }] },
    { $set: { lastMessageAt: message.sentAt } },
  );
};

const ticketOfReply = async (replyToId) => {
  const { Message, Ticket } = m();
  const replied = await Message.findById(replyToId).select("ticketId").lean();
  return replied?.ticketId ? Ticket.findById(replied.ticketId).select("_id num isClosed applicantId").lean() : null;
};

const applyAttach = async ({ channel, conversation, message, identity }) => {
  const { Conversation, Message, Ticket, Preferences } = m();
  const fresh = await Conversation.findById(conversation._id).lean();
  const binding = fresh.binding || {};
  const boundTicket =
    binding.ticketId && !binding.endedAt
      ? await Ticket.findById(binding.ticketId).select("_id num isClosed applicantId").lean()
      : null;
  const replyToTicket = fresh.kind === "group" && message.replyToId ? await ticketOfReply(message.replyToId) : null;
  const verdict = rules.decideAttach({ conversation: fresh, message, boundTicket, replyToTicket });

  if (verdict.endBinding) {
    const ended = await Conversation.updateOne(
      { _id: fresh._id, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": verdict.endBinding } },
    );
    if (ended.modifiedCount) await addSystemLine(fresh, { kind: "bindingEnded", ticketNum: binding.ticketNum });
  }
  if (verdict.decision) {
    await Conversation.updateOne({ _id: fresh._id }, { $set: { decision: { ...verdict.decision, at: new Date() } } });
  }
  if (verdict.suggestTicketId) {
    await Message.updateOne({ _id: message._id }, { $set: { suggestTicketId: verdict.suggestTicketId } });
  }
  if (!verdict.mode) return;

  const claimed = await Message.findOneAndUpdate(
    { _id: message._id, ticketId: null },
    { $set: { ticketId: verdict.ticketId, ticketNum: verdict.ticketNum, attachMode: verdict.mode } },
    { new: true },
  ).lean();
  const target = claimed || (await Message.findById(message._id).lean());
  const ticket = await Ticket.findById(verdict.ticketId).select("_id num applicantId").lean();
  const prefs = await Preferences.findOne({}).select("defaultApplicant").lean();
  await mirrorToTicket({
    message: target,
    ticket,
    conversation: fresh,
    identity,
    channel,
    prefs,
    skipApplicant: await userTalksHere(fresh, ticket.applicantId),
  });
};

const applyNotify = async ({ conversation, message, identity }) => {
  const { Conversation, Message } = m();
  if (!["client", "form"].includes(message.origin)) return;
  const fresh = await Conversation.findById(conversation._id).lean();
  const startedWait =
    fresh.awaitingSince && new Date(fresh.awaitingSince).getTime() === new Date(message.sentAt).getTime();
  const current = await Message.findById(message._id).select("ticketId").lean();
  if (!startedWait || current?.ticketId || fresh.hidden) return;
  const name = await displayNameFor(identity);
  const title =
    fresh.kind === "group"
      ? `Новое сообщение в группе «${fresh.title || rules.NETWORK_LABEL[fresh.network]}»`
      : `Новое сообщение${name ? ` от ${name}` : ""}`;
  await notifyWaiting({ conversation: fresh, message, title });
};

/** Эхо нашей отправки (шлюз пометил его jobId): дополняем своё сообщение. */
const confirmOwn = async (own, msg) => {
  const { Message, Comment } = m();
  const set = { status: rules.advanceStatus(own.status, "sent") };
  if (!own.externalId) set.externalId = msg.id;
  try {
    await Message.updateOne({ _id: own._id }, { $set: set });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await Message.updateOne({ _id: own._id }, { $set: { status: set.status } });
  }
  if (own.commentId) {
    await Comment.updateOne({ _id: own.commentId }, { $set: { "channel.status": set.status, "channel.statusAt": new Date() } });
  }
  bump(own.ticketId ? [own.ticketId] : []);
};

const ingestMessage = async (event) => {
  const { Channel, Message } = m();
  const channel = await Channel.findById(event.channelId).lean();
  if (!channel || !channel.isActive) return { ok: false, retryable: false, error: "канал отключён или не найден" };
  const msg = event.message;

  if (msg.jobId) {
    const own = await Message.findOne({ jobId: msg.jobId }).lean();
    if (own) {
      await confirmOwn(own, msg);
      return { ok: true };
    }
  }
  if ((channel.settings?.ignoredChatIds || []).includes(event.chat.id)) return { ok: true, ignored: true };

  const identity = msg.sender ? await resolveIdentity(channel.type, msg.sender, deps()) : null;
  let counterpart = null;
  if (event.chat.kind === "direct") {
    if (event.chat.peer) {
      counterpart =
        msg.sender && event.chat.peer.id === msg.sender.id
          ? identity
          : await resolveIdentity(channel.type, event.chat.peer, deps());
    } else if (msg.direction === "in") {
      counterpart = identity;
    }
  }
  const conversation = await upsertConversation(channel, event.chat, counterpart);
  await addParticipant(conversation, identity);

  const message = await insertMessage({ channel, conversation, event, identity });
  const effects = message.effects || {};
  if (!effects.conversation) {
    await applyConversationEffects(conversation, message, identity);
    await markEffect(message._id, "conversation");
  }
  if (!effects.attach) {
    await applyAttach({ channel, conversation, message, identity });
    await markEffect(message._id, "attach");
  }
  if (!effects.notify) {
    await applyNotify({ conversation, message, identity });
    await markEffect(message._id, "notify");
  }
  bump();
  return { ok: true };
};

const ingestEdit = async (event) => {
  const { Message, Comment } = m();
  const message = await Message.findOne({
    channelId: event.channelId,
    externalChatId: event.chat.id,
    externalId: event.message.id,
  });
  if (!message) return { ok: true, ignored: true };
  if (message.text === event.message.text) return { ok: true };
  message.revisions = [...(message.revisions || []), { text: message.text, at: event.message.editedAt }];
  message.text = event.message.text;
  message.editedAt = event.message.editedAt;
  await message.save();
  if (message.commentId) {
    await Comment.updateOne(
      { _id: message.commentId },
      { $set: { content: rules.commentContent(message), "channel.editedAt": event.message.editedAt } },
    );
  }
  bump(message.ticketId ? [message.ticketId] : []);
  return { ok: true };
};

const ingestDelete = async (event) => {
  const { Message, Comment } = m();
  const filter = { channelId: event.channelId, externalId: { $in: event.messageIds }, deletedAt: null };
  if (event.chat) filter.externalChatId = event.chat.id;
  const messages = await Message.find(filter).select("_id commentId ticketId").lean();
  if (!messages.length) return { ok: true, ignored: true };
  const now = new Date();
  await Message.updateMany({ _id: { $in: messages.map((x) => x._id) } }, { $set: { deletedAt: now } });
  const commentIds = messages.map((x) => x.commentId).filter(Boolean);
  // Текст остаётся: удаление в мессенджере — пометка, а не стирание из заявки
  if (commentIds.length) await Comment.updateMany({ _id: { $in: commentIds } }, { $set: { "channel.deletedAt": now } });
  bump(messages.map((x) => x.ticketId).filter(Boolean));
  return { ok: true };
};

const ingestStatus = async (event) => {
  const { Message, Comment } = m();
  const filter = event.jobId
    ? { jobId: event.jobId }
    : { channelId: event.channelId, externalChatId: event.chat.id, externalId: { $in: event.messageIds } };
  const messages = await Message.find(filter);
  for (const message of messages) {
    const next = rules.advanceStatus(message.status, event.status);
    if (next === message.status) continue;
    message.status = next;
    if (next === "failed") message.error = event.error || "Не доставлено";
    await message.save();
    if (message.commentId) {
      await Comment.updateOne(
        { _id: message.commentId },
        { $set: { "channel.status": next, "channel.statusAt": new Date(), "channel.error": message.error || undefined } },
      );
    }
  }
  bump(messages.map((x) => x.ticketId).filter(Boolean));
  return { ok: true };
};

const ingestChat = async (event) => {
  const { Channel, Conversation } = m();
  const channel = await Channel.findById(event.channelId).lean();
  if (!channel) return { ok: false, retryable: false, error: "канал не найден" };
  const conversation = await Conversation.findOne({ channelId: channel._id, externalChatId: event.chat.id }).lean();
  if (!conversation) return { ok: true, ignored: true };
  const set = {};
  if (event.chat.title) set.title = event.chat.title;
  if (event.chat.migratedToChatId) {
    set.externalChatId = event.chat.migratedToChatId;
  }
  if (Object.keys(set).length) {
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: set, ...(set.externalChatId ? { $addToSet: { externalAliases: conversation.externalChatId } } : {}) },
    );
  }
  for (const participant of (event.chat.participants || []).slice(0, 200)) {
    const identity = await resolveIdentity(channel.type, participant, deps());
    await addParticipant(conversation, identity);
  }
  bump();
  return { ok: true };
};

const ingestChannelState = async (event) => {
  const { Channel } = m();
  const set = { state: event.state, stateReason: event.reason || "", gatewaySeenAt: new Date() };
  if (event.account) set.account = event.account;
  set.login = event.login || { qr: null, expiresAt: null };
  const result = await Channel.updateOne({ _id: event.channelId }, { $set: set });
  return result.matchedCount ? { ok: true } : { ok: false, retryable: false, error: "канал не найден" };
};

const ingestEvent = async (event) => {
  switch (event.type) {
    case "message":
      return ingestMessage(event);
    case "message.edited":
      return ingestEdit(event);
    case "message.deleted":
      return ingestDelete(event);
    case "message.status":
      return ingestStatus(event);
    case "chat":
      return ingestChat(event);
    case "channel.state":
      return ingestChannelState(event);
    default:
      return { ok: false, retryable: false, error: "неизвестный тип события" };
  }
};

module.exports = { ingestEvent };
```

- [ ] **Step 10: Ticket hooks**

In `backend/models/ticket.js`, after the `touchActivity` hook:

```js
// «Диалоги»: закрытие заявки заканчивает привязки чатов к ней, возврат в работу
// восстанавливает их там, где клиент уже написал после закрытия
// (services/messaging/bindings.js). Сбой здесь заявку не ломает.
ticketSchema.pre("save", function rememberClosingChange() {
  if (!this.isNew && this.isModified("isClosed")) {
    this.$locals.closingChange = this.isClosed ? "closed" : "reopened";
  }
});
ticketSchema.post("save", function syncConversationBindings(doc) {
  const change = doc.$locals?.closingChange;
  if (!change) return;
  const bindings = require("@/services/messaging/bindings");
  const run =
    change === "closed"
      ? bindings.endBindingsForTicket(doc._id, "closed")
      : bindings.restoreBindingsAfterReopen(doc._id);
  run.catch((error) =>
    console.warn("привязки диалогов не обновлены:", error?.message || error),
  );
});
```

- [ ] **Step 11: Syntax checks and the full suite**

Run: `cd backend && for f in services/messaging/conversationStore.js services/messaging/mirror.js services/messaging/bindings.js services/messaging/notify.js services/messaging/ingest.js models/ticket.js; do node --check $f; done && NODE_ENV=production pnpm test`
Expected: no syntax errors; all tests green. (Behaviour against a real database is verified by the smoke run in Task 13.)

- [ ] **Step 12: Checkpoint**

No commit.

---

### Task 10: Replies from HD, ticket from a conversation, delivery routes

**Files:**
- Create: `backend/services/messaging/outbound.js`, `backend/services/messaging/origin.js`, `backend/services/messaging/outbound.test.js`
- Modify: `backend/controllers/comment.js` (`exports.add`), `backend/controllers/ticket.js` (`exports.add`, lines 802–1045)

**Interfaces:**
- Consumes: Tasks 3–9 (`enqueueJob`, `bindConversation`, `addSystemLine`, `userTalksHere`, `canSeeConversation`, `commentChannel`, `userName`, `publicName`, rules).
- Produces:
  - `outbound.js`: `attachmentsOf(files) → attachment[]`, `kindOf(text, attachments) → string`, `sendFromInbox({ conversationId, text, files, auth }) → Promise<message>`, `validateDeliverRoute({ ticket, conversationId, auth }) → Promise<{ conversation, channel, skipApplicant }>`, `deliverComment({ comment, ticket, route, author }) → Promise<message>`, `retryMessage({ messageId, auth }) → Promise<message>`, `repairOutbound() → Promise<void>`.
  - `origin.js`: `parseIds(raw) → string[]`, `prepareOrigin({ auth, conversationId, messageIds }) → Promise<origin>`, `applyOrigin({ ticket, origin, by })`, `ticketDraft({ auth, conversationId, messageIds }) → Promise<{ description, applicantId, companyId, source, attachments }>`, `deliveryRoutes(ticket) → Promise<{ routes: route[], defaultRoute: string }>`; `route = { conversationId, network, kind, title, available, reason, boundHere }`; `defaultRoute` is a conversation id or `"notify"` («Почта и бот HD — как сейчас»).
  - `POST /api/comments/add` accepts `deliverVia=<conversationId>`; `POST /api/tickets/add` accepts `originConversationId` and `originMessageIds` (JSON array or comma list).

- [ ] **Step 1: Write the failing tests**

`backend/services/messaging/outbound.test.js`:

```js
// node --test services/messaging/outbound.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { attachmentsOf, kindOf } = require("./outbound");
const { parseIds } = require("./origin");

test("form files become ready message attachments", () => {
  assert.deepEqual(
    attachmentsOf([{ key: "file-1.pdf", originalname: "акт.pdf", mimetype: "application/pdf", size: 1200 }]),
    [{ name: "file-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 1200, status: "ready" }],
  );
  assert.deepEqual(attachmentsOf(undefined), []);
});

test("a message without text is named by its first file", () => {
  assert.equal(kindOf("Привет", [{ mimetype: "image/png" }]), "text");
  assert.equal(kindOf("", [{ mimetype: "image/png" }]), "photo");
  assert.equal(kindOf("", [{ mimetype: "audio/ogg" }]), "audio");
  assert.equal(kindOf("", [{ mimetype: "video/mp4" }]), "video");
  assert.equal(kindOf("", [{ mimetype: "application/pdf" }]), "document");
  assert.equal(kindOf("", []), "text");
});

test("origin message ids come as JSON or a comma list, invalid ids dropped", () => {
  const a = "64f600000000000000000001";
  const b = "64f600000000000000000002";
  assert.deepEqual(parseIds(JSON.stringify([a, b])), [a, b]);
  assert.deepEqual(parseIds(`${a},nope,${b}`), [a, b]);
  assert.deepEqual(parseIds([a]), [a]);
  assert.deepEqual(parseIds(undefined), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && NODE_ENV=production node --test services/messaging/outbound.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `outbound.js`**

```js
/**
 * Ответы из HD: из «Диалогов» (sendFromInbox) и из хроники заявки
 * (deliverComment). Порядок записи: комментарий (если ответ попадает в заявку)
 * → сообщение (уникальный commentId) → задание шлюзу. Сбой между шагами чинит
 * repairOutbound (крон раз в минуту, app.js).
 */
const rules = require("./rules");
const { commentChannel, userName } = require("./present");
const { nextSeq, userTalksHere } = require("./conversationStore");
const { enqueueJob } = require("./jobs");
const { bindConversation } = require("./bindings");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

const attachmentsOf = (files = []) =>
  (files || []).map((file) => ({
    name: file.key,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size || 0,
    status: "ready",
  }));

const kindOf = (text, attachments) => {
  if (text || !attachments.length) return "text";
  const type = attachments[0].mimetype || "";
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "document";
};

const channelFor = async (conversation) => {
  const Channel = require("@/models/channel");
  const channel = await Channel.findById(conversation.channelId).lean();
  if (!channel || !channel.isActive) throw fail("Канал отключён — ответить через него нельзя", 409);
  if (channel.type === "site") throw fail("Ответ на форму сайта появится вместе с почтовым ответом", 409);
  return channel;
};

const openBoundTicket = async (conversation) => {
  const binding = conversation.binding || {};
  if (conversation.kind !== "direct" || !binding.ticketId || binding.endedAt) return null;
  const { Ticket } = require("@/models/ticket");
  const ticket = await Ticket.findById(binding.ticketId).select("_id num applicantId isClosed").lean();
  return ticket && !ticket.isClosed ? ticket : null;
};

const sendPayload = (conversation, text, attachments) => ({
  chatId: conversation.externalChatId,
  kind: conversation.kind,
  text,
  attachments: attachments.map(({ name, originalName, mimetype, size }) => ({ name, originalName, mimetype, size })),
});

/** Сообщение, задание шлюзу, сводка диалога и снятие «ждёт ответа». */
const queueOutbound = async ({ conversation, channel, text, attachments, author, ticket, comment, prefs }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const { bus } = require("@/services/pulse");
  const now = new Date();
  const kind = kindOf(text, attachments);
  const message = await Message.create({
    conversationId: conversation._id,
    channelId: channel._id,
    externalChatId: conversation.externalChatId,
    seq: await nextSeq(conversation._id),
    direction: "out",
    origin: "hd",
    kind,
    authorUserId: author._id,
    authorName: userName(author),
    text,
    attachments,
    sentAt: now,
    status: "queued",
    ticketId: ticket?._id || null,
    ticketNum: ticket?.num ?? null,
    attachMode: ticket ? "deliver" : null,
    commentId: comment?._id || null,
    effects: { conversation: true, attach: true, notify: true },
  });
  const signed = channel.settings?.signReplies
    ? rules.signReply(text, { firstName: author.firstName, organization: prefs?.contacts?.title || "" })
    : text;
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: sendPayload(conversation, signed, attachments),
  });
  await Message.updateOne({ _id: message._id }, { $set: { jobId: job._id } });
  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: now } }] },
    {
      $set: {
        lastMessage: { at: now, direction: "out", origin: "hd", preview: rules.previewOf({ text, kind, attachments }), authorName: userName(author) },
      },
    },
  );
  // Ответили — диалог больше не ждёт
  await Conversation.updateOne({ _id: conversation._id, awaitingSince: { $ne: null } }, { $set: { awaitingSince: null } });
  bus.bump({ topics: ["conversations"], ticketIds: ticket ? [ticket._id] : [] });
  return { ...message.toObject(), jobId: job._id };
};

const markQueued = (commentId, messageId) =>
  require("@/models/comment").updateOne(
    { _id: commentId },
    { $set: { "channel.messageId": messageId, "channel.status": "queued", "channel.statusAt": new Date() } },
  );

const sendFromInbox = async ({ conversationId, text, files = [], auth }) => {
  const Conversation = require("@/models/conversation");
  const Comment = require("@/models/comment");
  const User = require("@/models/user");
  const Preferences = require("@/models/preferences");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");
  const { markSeen } = require("@/services/ticketSeen");
  const { canSeeConversation } = require("./visibility");

  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  const body = String(text || "").trim();
  const attachments = attachmentsOf(files);
  if (!body && !attachments.length) throw fail("Пустое сообщение", 400);
  if (body.length > 20_000) throw fail("Сообщение длиннее 20 000 знаков", 400);
  const channel = await channelFor(conversation);
  const author = await User.findById(auth.userId).select("_id firstName lastName").lean();
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  const ticket = await openBoundTicket(conversation);

  let comment = null;
  if (ticket) {
    const copies = [];
    for (const attachment of attachments) {
      copies.push({ name: await storage.copyObject(attachment.name), originalName: attachment.originalName, mimetype: attachment.mimetype });
    }
    comment = await Comment.create({
      content: body || rules.commentContent({ kind: kindOf(body, attachments), attachments }),
      ticketId: ticket._id,
      attachments: copies,
      notifications: { lastAction: "new comment", pending: true, skipApplicant: await userTalksHere(conversation, ticket.applicantId) },
      channel: commentChannel({ network: conversation.network, conversationId: conversation._id, direction: "out", status: "preparing" }),
      createdBy: author._id,
      updatedBy: author._id,
    });
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: comment._id } });
    await markSeen(author._id, [ticket._id]).catch(() => {});
  }
  const message = await queueOutbound({ conversation, channel, text: body, attachments, author, ticket, comment, prefs });
  if (comment) await markQueued(comment._id, message._id);
  return message;
};

/** Проверка «Ответить через» до записи комментария. */
const validateDeliverRoute = async ({ ticket, conversationId, auth }) => {
  const Conversation = require("@/models/conversation");
  const { canSeeConversation } = require("./visibility");
  const { deliveryRoutes } = require("./origin");
  if (!auth.can({ conversation: ["reply"] })) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  const { routes } = await deliveryRoutes(ticket);
  const route = routes.find((item) => item.conversationId === String(conversation._id));
  if (!route) throw fail("Этот диалог не связан с заявкой", 409);
  if (!route.available) throw fail(`Ответить через этот диалог нельзя: ${route.reason}`, 409);
  const channel = await channelFor(conversation);
  return { conversation, channel, skipApplicant: await userTalksHere(conversation, ticket.applicantId) };
};

/** Комментарий из хроники заявки уходит клиенту мессенджером. */
const deliverComment = async ({ comment, ticket, route, author }) => {
  const Preferences = require("@/models/preferences");
  const storage = require("@/services/storage");
  const { conversation, channel } = route;
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  const binding = conversation.binding || {};
  if (conversation.kind === "direct" && (!binding.ticketId || binding.endedAt)) {
    await bindConversation({ conversation, ticket, by: author, attachPending: true });
  }
  const attachments = [];
  for (const attachment of comment.attachments || []) {
    attachments.push({
      name: await storage.copyObject(attachment.name),
      originalName: attachment.originalName || "",
      mimetype: attachment.mimetype || "",
      size: 0,
      status: "ready",
    });
  }
  const message = await queueOutbound({ conversation, channel, text: comment.content, attachments, author, ticket, comment, prefs });
  await markQueued(comment._id, message._id);
  return message;
};

const retryMessage = async ({ messageId, auth }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const ChannelJob = require("@/models/channelJob");
  const Comment = require("@/models/comment");
  const { bus } = require("@/services/pulse");
  const { canSeeConversation } = require("./visibility");
  const message = await Message.findById(messageId);
  if (!message || message.direction !== "out" || message.origin !== "hd") throw fail("Сообщение не найдено", 404);
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Сообщение не найдено", 404);
  if (message.status !== "failed") throw fail("Повторять нечего: сообщение не в ошибке", 409);
  const channel = await channelFor(conversation);
  const previous = message.jobId ? await ChannelJob.findById(message.jobId).lean() : null;
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: previous?.payload || sendPayload(conversation, message.text, message.attachments || []),
  });
  // Повтор — единственный путь назад из «failed»: статус ставим прямо
  message.jobId = job._id;
  message.status = "queued";
  message.error = "";
  await message.save();
  if (message.commentId) {
    await Comment.updateOne({ _id: message.commentId }, { $set: { "channel.status": "queued", "channel.statusAt": new Date(), "channel.error": undefined } });
  }
  bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
  return message.toObject();
};

/** Крон: ответы, застрявшие между комментарием, сообщением и заданием. */
const repairOutbound = async () => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  const Conversation = require("@/models/conversation");
  const Channel = require("@/models/channel");
  const cutoff = new Date(Date.now() - 60 * 1000);

  const orphans = await Message.find({ direction: "out", origin: "hd", status: "queued", jobId: null, createdAt: { $lte: cutoff } }).limit(50);
  for (const message of orphans) {
    const conversation = await Conversation.findById(message.conversationId).lean();
    const channel = conversation ? await Channel.findById(conversation.channelId).lean() : null;
    if (!channel?.isActive) {
      message.status = "failed";
      message.error = "Канал отключён";
      await message.save();
      continue;
    }
    const job = await enqueueJob({
      channelId: channel._id,
      network: channel.type,
      type: "send",
      conversationId: conversation._id,
      messageId: message._id,
      payload: sendPayload(conversation, message.text, message.attachments || []),
    });
    message.jobId = job._id;
    await message.save();
  }

  const stuck = await Comment.find({ "channel.status": "preparing", createdAt: { $lte: cutoff } }).select("_id").limit(50).lean();
  for (const comment of stuck) {
    const message = await Message.findOne({ commentId: comment._id }).select("_id status").lean();
    await Comment.updateOne(
      { _id: comment._id },
      {
        $set: message
          ? { "channel.messageId": message._id, "channel.status": message.status }
          : { "channel.status": "failed", "channel.error": "Не отправлено: сбой при постановке в очередь" },
      },
    );
  }
};

module.exports = { attachmentsOf, kindOf, sendFromInbox, validateDeliverRoute, deliverComment, retryMessage, repairOutbound };
```

- [ ] **Step 4: Implement `origin.js`**

```js
/**
 * Заявка из диалога («Создать заявку» — существующая форма заявки,
 * заполненная из выбранных сообщений) и маршруты ответа из заявки
 * («Ответить через»).
 */
const mongoose = require("mongoose");

const rules = require("./rules");
const { publicName, userName } = require("./present");
const { addSystemLine } = require("./conversationStore");
const { bindConversation } = require("./bindings");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

const parseIds = (raw) => {
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw.split(",");
    }
  }
  return (Array.isArray(list) ? list : [])
    .map((id) => String(id).trim())
    .filter((id) => mongoose.isValidObjectId(id))
    .slice(0, 200);
};

const loadVisibleConversation = async (conversationId, auth) => {
  const Conversation = require("@/models/conversation");
  const { canSeeConversation } = require("./visibility");
  if (!mongoose.isValidObjectId(conversationId)) throw fail("Диалог не найден", 404);
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  return conversation;
};

/** До создания заявки: диалог виден, сообщения из него и ни в какой заявке. */
const prepareOrigin = async ({ auth, conversationId, messageIds }) => {
  const Message = require("@/models/message");
  const ChannelIdentity = require("@/models/channelIdentity");
  if (!auth.can({ conversation: ["read"] })) throw fail("Недостаточно прав для диалогов", 403);
  const conversation = await loadVisibleConversation(conversationId, auth);
  const ids = parseIds(messageIds);
  const messages = ids.length
    ? await Message.find({ _id: { $in: ids }, conversationId: conversation._id, direction: { $ne: "system" } }).sort({ sentAt: 1, seq: 1 }).lean()
    : [];
  if (messages.length !== ids.length) throw fail("Сообщения не из этого диалога", 400);
  const taken = messages.find((message) => message.ticketId);
  if (taken) throw fail(`Сообщение уже в заявке №${taken.ticketNum}`, 409);
  const counterpartId =
    conversation.counterpartIdentityId ||
    messages.find((message) => message.direction === "in" && message.identityId)?.identityId ||
    null;
  const counterpart = counterpartId ? await ChannelIdentity.findById(counterpartId).lean() : null;
  return {
    conversation,
    messages,
    counterpart,
    applicantId: counterpart?.userId || null,
    // Как у почты: не опознан — заявка на служебной учётке, имя — в realSender
    realSender:
      counterpart && !counterpart.userId ? `${publicName(counterpart)} · ${rules.NETWORK_LABEL[conversation.network]}` : null,
    source: rules.TICKET_SOURCE[conversation.network],
    companyId: conversation.companyId || counterpart?.companyId || null,
  };
};

/** После сохранения заявки: сообщения — в неё, личный чат — привязать, файлы — копиями. */
const applyOrigin = async ({ ticket, origin, by }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const ChannelIdentity = require("@/models/channelIdentity");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");
  const { bus } = require("@/services/pulse");
  const { conversation, messages, counterpart } = origin;

  if (messages.length) {
    await Message.updateMany(
      { _id: { $in: messages.map((message) => message._id) }, ticketId: null },
      { $set: { ticketId: ticket._id, ticketNum: ticket.num, attachMode: "origin" } },
    );
    const copies = [];
    for (const message of messages) {
      for (const attachment of message.attachments || []) {
        if (attachment.status !== "ready" || !attachment.name) continue;
        try {
          copies.push({
            mimetype: attachment.mimetype,
            mimeType: attachment.mimetype,
            name: await storage.copyObject(attachment.name),
            originalName: attachment.originalName,
            size: attachment.size,
          });
        } catch {
          // файла уже нет — заявка важнее вложения
        }
      }
    }
    if (copies.length) await Ticket.updateOne({ _id: ticket._id }, { $push: { attachments: { $each: copies } } });
  }

  if (conversation.kind === "direct") {
    // Выбранные сообщения уже в описании — привязываем без повторного вложения
    await bindConversation({ conversation, ticket, by, attachPending: false, eventKind: "ticketCreated" });
  } else {
    await addSystemLine(conversation, { kind: "ticketCreated", ticketNum: ticket.num, by });
  }

  const companyId = ticket.company?._id;
  if (companyId) {
    await Conversation.updateOne({ _id: conversation._id, companyId: null }, { $set: { companyId } });
    if (counterpart && !counterpart.companyId) {
      await ChannelIdentity.updateOne({ _id: counterpart._id, companyId: null }, { $set: { companyId } });
    }
  }
  if (conversation.decision?.ticketId) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { decision: { ticketId: null, ticketNum: null, at: null } } });
  }
  bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
};

/** Черновик формы заявки из выбранных сообщений. */
const ticketDraft = async ({ auth, conversationId, messageIds }) => {
  const Preferences = require("@/models/preferences");
  const User = require("@/models/user");
  const ChannelIdentity = require("@/models/channelIdentity");
  const origin = await prepareOrigin({ auth, conversationId, messageIds });
  const prefs = await Preferences.findOne({}).select("timezone").lean();
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: prefs?.timezone || "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  const identities = new Map(
    (await ChannelIdentity.find({ _id: { $in: origin.messages.map((m) => m.identityId).filter(Boolean) } }).lean()).map((i) => [String(i._id), i]),
  );
  const users = new Map(
    (await User.find({ _id: { $in: [...identities.values()].map((i) => i.userId).filter(Boolean) } }).select("firstName lastName").lean()).map((u) => [String(u._id), u]),
  );
  const lines = origin.messages.map((message) => {
    const identity = identities.get(String(message.identityId));
    const who =
      message.direction === "out"
        ? message.authorName || "Мы"
        : userName(users.get(String(identity?.userId))) || publicName(identity);
    return `${who}, ${time.format(message.sentAt)}: ${rules.commentContent(message)}`;
  });
  return {
    description: lines.join("\n"),
    applicantId: origin.applicantId ? String(origin.applicantId) : null,
    companyId: origin.companyId ? String(origin.companyId) : null,
    source: origin.source,
    attachments: origin.messages.reduce((n, m) => n + (m.attachments || []).filter((a) => a.status === "ready").length, 0),
  };
};

/**
 * Маршруты «Ответить через» для заявки: диалоги заявителя (личные и группы,
 * где он участник) и диалог, привязанный к этой заявке. Занятый другой открытой
 * заявкой — недоступен. По умолчанию: привязанный к этой заявке → канал
 * последнего сообщения клиента в заявке → «как сейчас» (уведомление).
 */
const deliveryRoutes = async (ticket) => {
  const Conversation = require("@/models/conversation");
  const ChannelIdentity = require("@/models/channelIdentity");
  const Channel = require("@/models/channel");
  const Comment = require("@/models/comment");
  const { Ticket } = require("@/models/ticket");

  const identities = ticket.applicantId ? await ChannelIdentity.find({ userId: ticket.applicantId }).select("_id").lean() : [];
  const ids = identities.map((identity) => identity._id);
  const or = [{ "binding.ticketId": ticket._id }];
  if (ids.length) or.push({ counterpartIdentityId: { $in: ids } }, { "participants.identityId": { $in: ids } });
  const conversations = await Conversation.find({ $or: or, hidden: { $ne: true } }).sort({ "lastMessage.at": -1 }).limit(20).lean();

  const channels = new Map(
    (await Channel.find({ _id: { $in: conversations.map((c) => c.channelId) } }).select("type isActive").lean()).map((c) => [String(c._id), c]),
  );
  const elsewhere = conversations
    .filter((c) => c.binding?.ticketId && !c.binding.endedAt && String(c.binding.ticketId) !== String(ticket._id))
    .map((c) => c.binding.ticketId);
  const openElsewhere = new Set(
    (elsewhere.length ? await Ticket.find({ _id: { $in: elsewhere }, isClosed: false }).select("_id").lean() : []).map((t) => String(t._id)),
  );

  const routes = conversations.map((conversation) => {
    const channel = channels.get(String(conversation.channelId));
    const bound = conversation.binding?.ticketId && !conversation.binding.endedAt ? String(conversation.binding.ticketId) : null;
    const reason = !channel?.isActive
      ? "канал отключён"
      : channel.type === "site"
        ? "ответ на форму сайта — позже"
        : bound && bound !== String(ticket._id) && openElsewhere.has(bound)
          ? `занят заявкой №${conversation.binding.ticketNum}`
          : null;
    return {
      conversationId: String(conversation._id),
      network: conversation.network,
      kind: conversation.kind,
      title: conversation.title || "",
      available: !reason,
      reason,
      boundHere: bound === String(ticket._id),
    };
  });

  let defaultRoute = routes.find((route) => route.boundHere && route.available)?.conversationId || null;
  if (!defaultRoute) {
    const last = await Comment.findOne({ ticketId: ticket._id, "channel.direction": "in" })
      .sort({ createdAt: -1 })
      .select("channel.conversationId")
      .lean();
    const id = last?.channel?.conversationId ? String(last.channel.conversationId) : null;
    if (id && routes.some((route) => route.conversationId === id && route.available)) defaultRoute = id;
  }
  return { routes, defaultRoute: defaultRoute || "notify" };
};

module.exports = { parseIds, prepareOrigin, applyOrigin, ticketDraft, deliveryRoutes };
```

- [ ] **Step 5: Run the unit tests**

Run: `cd backend && NODE_ENV=production node --test services/messaging/outbound.test.js`
Expected: PASS.

- [ ] **Step 6: «Ответить через» in the comment controller**

In `backend/controllers/comment.js` add at the top:

```js
const { validateDeliverRoute, deliverComment } = require("../services/messaging/outbound");
const { commentChannel } = require("../services/messaging/present");
```

After `const [ticket] = await assertTicketsAccessible(req.auth, [ticketId]);`:

```js
    // «Ответить через» мессенджер (services/messaging): маршрут проверяем ДО
    // записи комментария — отказ по занятому диалогу не должен оставлять в
    // заявке ответ, который клиенту не ушёл
    const route = req.body.deliverVia
      ? await validateDeliverRoute({ ticket, conversationId: req.body.deliverVia, auth: req.auth })
      : null;
```

In `new Comment({...})` extend `notifications` and add `channel`:

```js
      notifications: {
        lastAction: "new comment",
        // Всегда: канал «в приложении» есть даже при выключенных почте и
        // Telegram, свои гейты у каналов свои (middleware/notifications)
        pending: true,
        ...(route ? { skipApplicant: route.skipApplicant } : {}),
      },
      ...(route
        ? {
            channel: commentChannel({
              network: route.conversation.network,
              conversationId: route.conversation._id,
              direction: "out",
              status: "preparing",
            }),
          }
        : {}),
```

After the TicketLog save and before `res.status(201)`:

```js
    if (route) {
      await deliverComment({
        comment,
        ticket,
        route,
        author: { _id: authData.userId, firstName: authData.firstName, lastName: authData.lastName },
      }).catch(async (error) => {
        logFailure("Failed to deliver comment via messenger", { ticketId: ticket._id })(error);
        await Comment.updateOne(
          { _id: comment._id },
          { $set: { "channel.status": "failed", "channel.error": "Не отправлено: сбой при постановке в очередь" } },
        ).catch(() => {});
      });
    }
```

- [ ] **Step 7: Ticket from a conversation in the ticket controller**

In `backend/controllers/ticket.js` add near the other service requires:

```js
const { prepareOrigin, applyOrigin } = require("@/services/messaging/origin");
```

(if the file uses relative paths for services, use `../services/messaging/origin`.)

In `exports.add`, right after the `applicant` block (ends with `applicant = String(chosen._id);\n    }`, ~line 831):

```js
    // Заявка из диалога («Диалоги» → «Создать заявку»): проверяем до создания,
    // а сообщения, привязку и файлы разносим после (services/messaging/origin.js)
    const conversationOrigin = req.body.originConversationId
      ? await prepareOrigin({
          auth: req.auth,
          conversationId: req.body.originConversationId,
          messageIds: req.body.originMessageIds,
        })
      : null;
    if (conversationOrigin && !req.body.applicantId) {
      // Собеседник не связан с пользователем — как у почты: служебная учётка
      // по умолчанию, а имя собеседника уходит в realSender
      applicant = String(conversationOrigin.applicantId || prefs.defaultApplicant?._id || userId);
    }
```

In the `new Ticket({...})` object replace `source: req.body.source,` with:

```js
      source: conversationOrigin ? conversationOrigin.source : req.body.source,
      ...(conversationOrigin?.realSender && !conversationOrigin.applicantId && !req.body.applicantId
        ? { realSender: conversationOrigin.realSender }
        : {}),
```

After `await markSeen(userId, [ticket._id]);`:

```js
    if (conversationOrigin) {
      await applyOrigin({
        ticket,
        origin: conversationOrigin,
        by: { _id: userId, firstName: req.auth.legacy.firstName, lastName: req.auth.legacy.lastName },
      }).catch((error) =>
        logger.log("error", "Заявка создана, но разнести диалог в неё не удалось", {
          ticketId: ticket._id.toString(),
          error: error.message,
        }),
      );
    }
```

- [ ] **Step 8: Syntax checks and the suite**

Run: `cd backend && node --check services/messaging/outbound.js services/messaging/origin.js controllers/comment.js controllers/ticket.js && NODE_ENV=production pnpm test`
Expected: no syntax errors, all green.

- [ ] **Step 9: Checkpoint**

No commit.

---

### Task 11: Gateway API (`/api/gateway/*`)

**Files:**
- Create: `backend/middleware/isGateway.js`, `backend/middleware/isGateway.test.js`, `backend/routes/gateway.js`, `backend/controllers/gateway.js`
- Modify: `backend/routes/index.js` (mount before `attachSession`), `.env.example`

**Interfaces:**
- Consumes: `validateEvent`, `ingestEvent`, `leaseJobs`, `ackJobs`, `waitForJob`, `GATEWAY_NETWORKS`, `storage.uploadStorage`, `storage.newObjectName`, `storage.getObjectBuffer`, `decryptSecret`.
- Produces (contract for the gateway; documented in `docs/messaging.md`):
  - `GET /api/gateway/channels?types=telegram,whatsapp` → `{ channels: [{ id, type, name, state, account, settings: { proxyUrl, historyDays, importGroups, markReadOnOpen, maxMediaMb, ignoredChatIds }, secrets: { tgApiId, tgApiHash, proxyPassword } }] }` (secrets decrypted).
  - `POST /api/gateway/events` `{ events: [≤50] }` → `{ results: [{ ok, retryable?, error?, ignored? }] }` (one per event, same order).
  - `POST /api/gateway/media` multipart `file` (+ optional `originalName`) → `201 { name, originalName, mimetype, size }`.
  - `GET /api/gateway/media/:name` → the bytes.
  - `GET /api/gateway/jobs?types=&wait=0..25` → `{ leaseId, leaseExpiresAt, jobs: [{ id, type, channelId, conversationId, messageId, attempt, payload }] }`.
  - `POST /api/gateway/jobs/ack` `{ leaseId, results: [{ id, ok, retryable?, retryAfterMs?, error?, result? }] }` → `{ applied, ignored }`.
  - `POST /api/gateway/heartbeat` `{ channels: [{ id }] }` → `{ ok: true }`.
  - Header `X-Gateway-Token: $MSG_GATEWAY_TOKEN` on every call; otherwise `401`.

- [ ] **Step 1: Write the failing test**

`backend/middleware/isGateway.test.js`:

```js
// node --test middleware/isGateway.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createIsGateway } = require("./isGateway");

const serve = async (middleware) => {
  const app = express();
  app.get("/ping", middleware, (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test("the gateway secret is required, in the header only", async () => {
  const { base, close } = await serve(createIsGateway({ getToken: () => "s3cret-token", log: () => {} }));
  try {
    assert.equal((await fetch(`${base}/ping`)).status, 401);
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "wrong" } })).status, 401);
    assert.equal((await fetch(`${base}/ping?token=s3cret-token`)).status, 401);
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "s3cret-token" } })).status, 200);
  } finally {
    await close();
  }
});

test("an empty secret closes the gateway API", async () => {
  const logs = [];
  const { base, close } = await serve(createIsGateway({ getToken: () => "", log: (level) => logs.push(level) }));
  try {
    assert.equal((await fetch(`${base}/ping`, { headers: { "X-Gateway-Token": "" } })).status, 401);
    assert.deepEqual(logs, ["error"]);
  } finally {
    await close();
  }
});
```

(If the Bash sandbox forbids listening on 127.0.0.1, rerun the test with the sandbox disabled — the test only talks to itself.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && NODE_ENV=production node --test middleware/isGateway.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware**

`backend/middleware/isGateway.js`:

```js
const crypto = require("crypto");

/**
 * Общий секрет бэкенда и шлюза мессенджеров (msg-gateway). Только заголовок:
 * строка запроса оседает в журналах nginx и winston (та же причина, что у
 * isTelegramBot). Пустой секрет — отказ, а не «пускать всех».
 */
const HEADER = "x-gateway-token";

const tokensMatch = (expected, received) => {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const defaultLog = (level, message) => {
  try {
    require("../utils/logger").log(level, message, { module: "gateway" });
  } catch {
    // журнал не должен ронять запрос
  }
};

const deny = (res) => res.status(401).json({ error: true, status: 401, message: "Некорректный токен" });

const createIsGateway = ({ getToken = () => process.env.MSG_GATEWAY_TOKEN, log = defaultLog } = {}) =>
  (req, res, next) => {
    const expected = getToken();
    if (!expected) {
      log("error", "MSG_GATEWAY_TOKEN не задан — шлюз мессенджеров не пускаем");
      return deny(res);
    }
    const received = req.get(HEADER);
    if (!received || !tokensMatch(expected, received)) {
      log("warn", "Некорректный токен шлюза мессенджеров");
      return deny(res);
    }
    next();
  };

module.exports = createIsGateway();
module.exports.createIsGateway = createIsGateway;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && NODE_ENV=production node --test middleware/isGateway.test.js`
Expected: PASS.

- [ ] **Step 5: Routes and controller**

`backend/routes/gateway.js`:

```js
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const isGateway = require("@/middleware/isGateway");
const gateway = require("@/controllers/gateway");
const storage = require("@/services/storage");

/**
 * Всё, что можно шлюзу мессенджеров. СПИСОК ЗАКРЫТЫЙ, как у телеграм-сервиса
 * (routes/bot.js): утёкший секрет открывает приём событий и очередь отправки,
 * но не остальной API. Контракт — docs/messaging.md.
 */
const router = express.Router();

// Щедро: шлюз ходит долгими опросами очереди и шлёт события пачками;
// потолок — на случай зацикленного отправителя
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => "msg-gateway",
});

// Медиа мессенджеров — любого типа (стикеры, голосовые): MIME не фильтруем,
// шлюз — доверенная сторона. Потолок — максимум настройки канала (200 МБ)
const upload = multer({
  storage: storage.uploadStorage({
    key: (req, file, cb) => cb(null, storage.newObjectName("msg", file.originalname, file.mimetype)),
    contentType: (req, file, cb) => cb(null, file.mimetype || "application/octet-stream"),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

router.use(isGateway, limiter);

router.get("/channels", gateway.channels);
router.post("/events", gateway.events);
router.post("/media", upload.single("file"), gateway.mediaUploaded);
router.get("/media/:name", gateway.media);
router.get("/jobs", gateway.jobs);
router.post("/jobs/ack", gateway.ack);
router.post("/heartbeat", gateway.heartbeat);

module.exports = router;
```

`backend/controllers/gateway.js`:

```js
const mongoose = require("mongoose");
const mime = require("mime-types");

const Channel = require("@/models/channel");
const { AppError } = require("@/middleware/errorHandling");
const { decryptSecret } = require("@/services/crypto/secretBox");
const storage = require("@/services/storage");
const logger = require("@/utils/logger");
const { validateEvent } = require("@/services/messaging/events");
const { ingestEvent } = require("@/services/messaging/ingest");
const { leaseJobs, ackJobs, waitForJob } = require("@/services/messaging/jobs");
const { GATEWAY_NETWORKS } = require("@/services/messaging/rules");

/** Ручки шлюза мессенджеров; список — routes/gateway.js, контракт — docs/messaging.md. */

const MAX_EVENTS = 50;
const MAX_WAIT_S = 25;

const open = (value) => {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return "";
  }
};

const networksOf = (raw) => {
  const asked = String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
  return (asked.length ? asked : GATEWAY_NETWORKS).filter((network) => GATEWAY_NETWORKS.includes(network));
};

exports.channels = async (req, res, next) => {
  try {
    const channels = await Channel.find({ type: { $in: networksOf(req.query.types) }, isActive: true }).lean();
    res.status(200).json({
      channels: channels.map((channel) => ({
        id: String(channel._id),
        type: channel.type,
        name: channel.name,
        state: channel.state,
        account: channel.account || {},
        settings: {
          proxyUrl: channel.settings?.proxyUrl || "",
          historyDays: channel.settings?.historyDays ?? 14,
          importGroups: channel.settings?.importGroups !== false,
          markReadOnOpen: channel.settings?.markReadOnOpen !== false,
          maxMediaMb: channel.settings?.maxMediaMb ?? 50,
          ignoredChatIds: channel.settings?.ignoredChatIds || [],
        },
        secrets: {
          tgApiId: open(channel.secrets?.tgApiId),
          tgApiHash: open(channel.secrets?.tgApiHash),
          proxyPassword: open(channel.secrets?.proxyPassword),
        },
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось отдать каналы", 500, true, error));
  }
};

exports.events = async (req, res, next) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) {
      return next(new AppError(`Ожидается events: от 1 до ${MAX_EVENTS}`, 400));
    }
    const results = [];
    for (const raw of events) {
      const checked = validateEvent(raw);
      if (!checked.ok) {
        results.push({ ok: false, retryable: false, error: checked.error });
        continue;
      }
      try {
        results.push(await ingestEvent(checked.event));
      } catch (error) {
        logger.log("error", "Событие канала не принято", {
          module: "messaging",
          type: raw?.type,
          channelId: String(raw?.channelId || ""),
          error: error.message,
        });
        results.push({ ok: false, retryable: true, error: "сбой приёма, повторите" });
      }
    }
    res.status(200).json({ results });
  } catch (error) {
    next(new AppError("Не удалось принять события", 500, true, error));
  }
};

exports.mediaUploaded = (req, res, next) => {
  if (!req.file) return next(new AppError("Ожидается файл в поле file", 400));
  // multer отдаёт имя файла в latin1 — кириллица без перекодировки ломается
  const originalName = String(
    req.body?.originalName || Buffer.from(req.file.originalname || "", "latin1").toString("utf8"),
  ).slice(0, 300);
  res.status(201).json({ name: req.file.key, originalName, mimetype: req.file.mimetype, size: req.file.size });
};

exports.media = async (req, res, next) => {
  try {
    const buffer = await storage.getObjectBuffer(req.params.name);
    res.type(mime.lookup(req.params.name) || "application/octet-stream").send(buffer);
  } catch (error) {
    next(new AppError("Файл не найден", 404, true, error));
  }
};

const openPayload = (job) =>
  job.type === "login" && job.payload?.value ? { ...job.payload, value: open(job.payload.value) } : job.payload || {};

exports.jobs = async (req, res, next) => {
  try {
    const networks = networksOf(req.query.types);
    const waitMs = Math.min(Math.max(Number(req.query.wait) || 0, 0), MAX_WAIT_S) * 1000;
    let batch = await leaseJobs({ networks });
    if (!batch.jobs.length && waitMs) {
      await waitForJob(networks, waitMs);
      batch = await leaseJobs({ networks });
    }
    res.status(200).json({
      leaseId: batch.leaseId,
      leaseExpiresAt: batch.leaseUntil,
      jobs: batch.jobs.map((job) => ({
        id: String(job._id),
        type: job.type,
        channelId: String(job.channelId),
        conversationId: job.conversationId ? String(job.conversationId) : null,
        messageId: job.messageId ? String(job.messageId) : null,
        attempt: job.attempts,
        payload: openPayload(job),
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось выдать задания", 500, true, error));
  }
};

exports.ack = async (req, res, next) => {
  try {
    const { leaseId, results } = req.body || {};
    if (!leaseId || !Array.isArray(results) || results.length > 50) {
      return next(new AppError("Ожидаются leaseId и results", 400));
    }
    res.status(200).json(await ackJobs(String(leaseId), results));
  } catch (error) {
    next(new AppError("Не удалось принять подтверждение", 500, true, error));
  }
};

exports.heartbeat = async (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.channels) ? req.body.channels.slice(0, 50) : [])
      .map((item) => item?.id)
      .filter((id) => mongoose.isValidObjectId(id));
    if (ids.length) await Channel.updateMany({ _id: { $in: ids } }, { $set: { gatewaySeenAt: new Date() } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(new AppError("Не удалось принять heartbeat", 500, true, error));
  }
};
```

- [ ] **Step 6: Mount before `attachSession` and document the secret**

`backend/routes/index.js` — next to `const mcpRoutes = require("./mcp");`:

```js
// Шлюз мессенджеров «Диалогов»: закрытый список ручек за общим секретом
// (см. routes/gateway.js)
const gatewayRoutes = require("./gateway");
```

and right after `internalRoutes.use("/mcp", mcpRoutes);`:

```js
/**
 * Шлюз мессенджеров (msg-gateway) — тоже ДО `attachSession`: у него общий
 * секрет, а не сеанс сотрудника, и чужая cookie не должна приклеить к его
 * запросу вторую личность. Роутер отвечает на всё под `/gateway` сам.
 */
internalRoutes.use("/gateway", gatewayRoutes);
```

`.env.example` — after the `TG_API_TOKEN=` block:

```
# Shared secret between the backend and msg-gateway (Telegram and WhatsApp
# sessions of «Диалоги»). Empty = the gateway API refuses every request.
MSG_GATEWAY_TOKEN=
```

- [ ] **Step 7: Syntax checks and the suite**

Run: `cd backend && node --check routes/gateway.js controllers/gateway.js routes/index.js && NODE_ENV=production pnpm test`
Expected: no errors, all green.

- [ ] **Step 8: Checkpoint**

No commit.

---

### Task 12: Staff API (`/api/conversations`, `/api/identities`, `/api/channels`)

**Files:**
- Create: `backend/routes/internal/conversation.js`, `backend/controllers/conversation.js`, `backend/controllers/channel.js`
- Modify: `backend/routes/index.js` (mount after `ticketRoutes`)

**Interfaces:**
- Consumes: gates from Task 2, services from Tasks 5–10.
- Produces (contract for the P1 UI):
  - `GET /api/conversations?queue=awaiting|mine|unbound|all|hidden&network=&company=&q=&before=&limit=` → `{ items: ConversationRow[], counts: { awaiting, mine, unbound, all }, nextBefore }`.
  - `GET /api/conversations/:id` → `{ conversation: ConversationRow, channel, counterpart, participants, contact, otherChannels, ticket, openTickets }`.
  - `GET /api/conversations/:id/messages?before=<ISO>&beforeSeq=<n>&limit=` | `?changedSince=<ISO>` → `{ items: MessageRow[] (oldest first), serverTime }`.
  - `GET /api/conversations/:id/ticket-draft?messages=<id,id>` → `{ description, applicantId, companyId, source, attachments }`.
  - `POST /api/conversations/:id/seen`, `POST /api/conversations/:id/messages` (multipart `text`, `attachments[]`), `POST /api/conversations/:id/handled`, `POST /api/messages/:id/retry`.
  - `POST /api/conversations/:id/assign {userId|null}`, `bind {ticketNum}`, `unbind`, `attach {messageIds, ticketNum}`, `decision {action:"none"}`, `hide {hidden}`, `PATCH /api/conversations/:id {companyId|null}`.
  - `POST /api/identities/:id/link {userId}`, `POST /api/identities/:id/unlink`.
  - `GET /api/tickets/:num/delivery-routes` → `{ routes, defaultRoute, applicantName }`.
  - `GET|POST /api/channels`, `PATCH|DELETE /api/channels/:id`, `POST /api/channels/:id/login {step, value?}`, `logout`, `test`, `history {days}` → `202 { jobId }`, `GET /api/channels/:id/jobs/:jobId` → `{ job }`.

- [ ] **Step 1: Check the paths are free**

Run: `cd backend && grep -rn '"/channels\|"/conversations\|"/identities\|"/messages' routes/ | grep -v gateway`
Expected: no existing routes on these prefixes (if one exists, stop and report).

- [ ] **Step 2: Routes**

`backend/routes/internal/conversation.js`:

```js
const express = require("express");

const conversation = require("@/controllers/conversation");
const channel = require("@/controllers/channel");
const fileUpload = require("@/middleware/fileUpload");
const { messagingModuleIsActive } = require("@/middleware/modules");
const {
  canReadConversations,
  canReplyConversations,
  canManageConversations,
  canManageSettings,
  requireTicketAccess,
} = require("@/middleware/permissions");

/**
 * «Диалоги» для сотрудников. Каждый маршрут — со своими гейтами: общий
 * `router.use` на префикс протёк бы в соседние роутеры (см. routes/inventoryMount.js).
 * Сначала личность (401), потом модуль (403).
 */
const router = express.Router();

const read = [...canReadConversations, messagingModuleIsActive];
const reply = [...canReplyConversations, messagingModuleIsActive];
const manage = [...canManageConversations, messagingModuleIsActive];
const settings = [...canManageSettings, messagingModuleIsActive];

router.get("/conversations", ...read, conversation.list);
router.get("/conversations/:id", ...read, conversation.get);
router.get("/conversations/:id/messages", ...read, conversation.messages);
router.get("/conversations/:id/ticket-draft", ...read, conversation.ticketDraft);
router.post("/conversations/:id/seen", ...read, conversation.seen);

router.post("/conversations/:id/messages", ...reply, fileUpload.array("attachments"), conversation.send);
router.post("/conversations/:id/handled", ...reply, conversation.handled);
router.post("/messages/:id/retry", ...reply, conversation.retry);

router.post("/conversations/:id/assign", ...manage, conversation.assign);
router.post("/conversations/:id/bind", ...manage, conversation.bind);
router.post("/conversations/:id/unbind", ...manage, conversation.unbind);
router.post("/conversations/:id/attach", ...manage, conversation.attach);
router.post("/conversations/:id/decision", ...manage, conversation.decision);
router.post("/conversations/:id/hide", ...manage, conversation.hide);
router.patch("/conversations/:id", ...manage, conversation.update);
router.post("/identities/:id/link", ...manage, conversation.linkIdentity);
router.post("/identities/:id/unlink", ...manage, conversation.unlinkIdentity);

router.get(
  "/tickets/:num/delivery-routes",
  ...read,
  ...requireTicketAccess((req) => ({ num: req.params.num })),
  conversation.deliveryRoutes,
);

router.get("/channels", ...settings, channel.list);
router.post("/channels", ...settings, channel.create);
router.patch("/channels/:id", ...settings, channel.update);
router.delete("/channels/:id", ...settings, channel.remove);
router.post("/channels/:id/login", ...settings, channel.login);
router.post("/channels/:id/logout", ...settings, channel.logout);
router.post("/channels/:id/test", ...settings, channel.test);
router.post("/channels/:id/history", ...settings, channel.history);
router.get("/channels/:id/jobs/:jobId", ...settings, channel.job);

module.exports = router;
```

(`requireTicketAccess(locate)` returns `[requireAuth, handler]` and puts the ticket into `req.ticket` — hence the spread.)

- [ ] **Step 3: Conversation controller**

`backend/controllers/conversation.js`:

```js
const mongoose = require("mongoose");

const Conversation = require("@/models/conversation");
const Message = require("@/models/message");
const ChannelIdentity = require("@/models/channelIdentity");
const ConversationRead = require("@/models/conversationRead");
const Channel = require("@/models/channel");
const User = require("@/models/user");
const Company = require("@/models/company");
const { Ticket } = require("@/models/ticket");
const { AppError } = require("@/middleware/errorHandling");
const { canAccessTicket } = require("@/services/ticketAccess");
const { bus } = require("@/services/pulse");
const storage = require("@/services/storage");
const { QUEUES, listFilter, canSeeConversation } = require("@/services/messaging/visibility");
const { conversationRow, messageRow, userName } = require("@/services/messaging/present");
const { NETWORKS, GATEWAY_NETWORKS, identityName } = require("@/services/messaging/rules");
const { addSystemLine } = require("@/services/messaging/conversationStore");
const { bindConversation, unbindConversation, attachMessages } = require("@/services/messaging/bindings");
const { sendFromInbox, retryMessage } = require("@/services/messaging/outbound");
const { ticketDraft, deliveryRoutes } = require("@/services/messaging/origin");
const { enqueueJob } = require("@/services/messaging/jobs");

/** «Диалоги» для сотрудников. Маршруты — routes/internal/conversation.js. */

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (id) => mongoose.isValidObjectId(id);
const idOf = (value) => (value ? String(value._id ?? value) : null);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wrap = (error, fallback) =>
  error instanceof AppError ? error : new AppError(fallback, 500, true, error);
const byId = (list) => new Map(list.map((item) => [String(item._id), item]));
const me = (req) => User.findById(req.auth.userId).select("firstName lastName").lean();

/** Диалог по :id с проверкой видимости; чужой — 404, даже фактом не выдаём. */
const loadVisible = async (req) => {
  if (!isId(req.params.id)) throw new AppError("Диалог не найден", 404);
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation || !canSeeConversation(conversation, req.auth)) throw new AppError("Диалог не найден", 404);
  return conversation;
};

const loadOpenTicket = async (req, num) => {
  const ticketNum = Number(num);
  if (!Number.isInteger(ticketNum)) throw new AppError("Укажите номер заявки", 400);
  const ticket = await Ticket.findOne({ num: ticketNum })
    .select("_id num isClosed applicantId responsibles createdBy company applicant")
    .lean();
  if (!ticket || !canAccessTicket(ticket, req.auth)) throw new AppError("Заявка не найдена", 404);
  if (ticket.isClosed) throw new AppError("Заявка закрыта — сначала верните её в работу", 409);
  return ticket;
};

/** Справочники строк списка: собеседники, люди, компании, непрочитанное. */
const rowContext = async (items, userId) => {
  const identities = byId(
    await ChannelIdentity.find({ _id: { $in: items.map((c) => c.counterpartIdentityId).filter(Boolean) } }).lean(),
  );
  const userIds = [...[...identities.values()].map((i) => i.userId), ...items.map((c) => c.assigneeId)].filter(Boolean);
  const users = byId(await User.find({ _id: { $in: userIds } }).select("firstName lastName").lean());
  const companies = byId(await Company.find({ _id: { $in: items.map((c) => c.companyId).filter(Boolean) } }).select("alias").lean());
  const reads = new Map(
    (await ConversationRead.find({ userId, conversationId: { $in: items.map((c) => c._id) } }).lean()).map((r) => [
      String(r.conversationId),
      r.seenAt,
    ]),
  );
  const unread = new Map();
  for (const conversation of items) {
    const count = await Message.countDocuments(
      {
        conversationId: conversation._id,
        direction: "in",
        imported: { $ne: true },
        sentAt: { $gt: reads.get(String(conversation._id)) || new Date(0) },
      },
      { limit: 100 },
    );
    if (count) unread.set(String(conversation._id), count);
  }
  return { identities, users, companies, unread };
};

const queueCounts = async (auth) => {
  const counts = {};
  for (const queue of ["awaiting", "mine", "unbound", "all"]) {
    counts[queue] = await Conversation.countDocuments(listFilter(queue, auth));
  }
  return counts;
};

exports.list = async (req, res, next) => {
  try {
    const queue = String(req.query.queue || "all");
    if (!QUEUES.includes(queue)) return next(new AppError("Неизвестная очередь", 400));
    const extra = {};
    if (NETWORKS.includes(req.query.network)) extra.network = req.query.network;
    if (isId(req.query.company)) extra.companyId = oid(req.query.company);
    const q = String(req.query.q || "").trim().slice(0, 100);
    if (q) {
      const pattern = new RegExp(escapeRegExp(q), "i");
      extra.$or = [{ title: pattern }, { "lastMessage.preview": pattern }, { "lastMessage.authorName": pattern }];
    }
    const filter = listFilter(queue, req.auth, extra);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.$and.push({ "lastMessage.at": { $lt: before } });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const page = await Conversation.find(filter).sort({ "lastMessage.at": -1, _id: -1 }).limit(limit + 1).lean();
    const items = page.slice(0, limit);
    const ctx = await rowContext(items, req.auth.userId);
    res.status(200).json({
      items: items.map((conversation) => conversationRow(conversation, ctx)),
      counts: await queueCounts(req.auth),
      nextBefore: page.length > limit ? items.at(-1)?.lastMessage?.at || null : null,
    });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить диалоги"));
  }
};

/** Другие каналы того же человека — «Написать» в карточке контакта. */
const otherChannelsOf = async (userId, exceptId) => {
  const identities = await ChannelIdentity.find({ userId }).select("_id network username phone").lean();
  const conversations = await Conversation.find({
    counterpartIdentityId: { $in: identities.map((i) => i._id) },
    _id: { $ne: exceptId },
  })
    .select("_id counterpartIdentityId")
    .lean();
  return identities.map((identity) => ({
    network: identity.network,
    handle: identity.username ? `@${identity.username}` : identity.phone || "",
    conversationId: idOf(conversations.find((c) => String(c.counterpartIdentityId) === String(identity._id))),
  }));
};

exports.get = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const ctx = await rowContext([conversation], req.auth.userId);
    const channel = await Channel.findById(conversation.channelId).select("type name state isActive").lean();
    const participantIds = [conversation.counterpartIdentityId, ...(conversation.participants || []).map((p) => p.identityId)].filter(Boolean);
    const identities = await ChannelIdentity.find({ _id: { $in: participantIds } }).lean();
    const people = byId(
      await User.find({ _id: { $in: identities.map((i) => i.userId).filter(Boolean) } })
        .select("firstName lastName position phone email company isEndUser")
        .lean(),
    );
    const person = (identity) => ({
      identityId: String(identity._id),
      name: userName(people.get(String(identity.userId))) || identityName(identity),
      username: identity.username || "",
      phone: identity.phone || "",
      userId: idOf(identity.userId),
      linkMethod: identity.linkMethod || null,
      isStaff: Boolean(identity.isStaff),
    });
    const counterpart = identities.find((i) => String(i._id) === String(conversation.counterpartIdentityId)) || null;
    const contactUser = counterpart?.userId ? people.get(String(counterpart.userId)) : null;
    const binding = conversation.binding || {};
    const ticket =
      binding.ticketId && !binding.endedAt
        ? await Ticket.findById(binding.ticketId).select("num title state deadline responsibles").lean()
        : null;
    const openTickets = conversation.companyId
      ? await Ticket.find({ "company._id": conversation.companyId, isClosed: false })
          .sort({ createdAt: -1 })
          .limit(6)
          .select("num title state deadline")
          .lean()
      : [];
    res.status(200).json({
      conversation: conversationRow(conversation, ctx),
      channel: channel ? { id: String(channel._id), type: channel.type, name: channel.name, state: channel.state, isActive: channel.isActive } : null,
      counterpart: counterpart ? person(counterpart) : null,
      participants: conversation.kind === "group" ? identities.map(person) : [],
      contact: contactUser
        ? {
            id: String(contactUser._id),
            name: userName(contactUser),
            position: contactUser.position || "",
            company: contactUser.company?.alias || "",
            phone: contactUser.phone || "",
            email: contactUser.email || "",
          }
        : null,
      otherChannels: contactUser ? await otherChannelsOf(contactUser._id, conversation._id) : [],
      ticket: ticket
        ? {
            id: String(ticket._id),
            num: ticket.num,
            title: ticket.title,
            state: ticket.state,
            deadline: ticket.deadline,
            responsibles: (ticket.responsibles || []).map((r) => userName(r)),
          }
        : null,
      openTickets: openTickets
        .filter((t) => !ticket || String(t._id) !== String(ticket._id))
        .slice(0, 5)
        .map((t) => ({ id: String(t._id), num: t.num, title: t.title, state: t.state, deadline: t.deadline })),
    });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить диалог"));
  }
};

exports.messages = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const filter = { conversationId: conversation._id };
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    let newestFirst = true;
    if (req.query.changedSince) {
      const since = new Date(req.query.changedSince);
      if (Number.isNaN(since.getTime())) return next(new AppError("changedSince — дата", 400));
      filter.updatedAt = { $gt: since };
      newestFirst = false;
    } else if (req.query.before) {
      const before = new Date(req.query.before);
      const seq = Number(req.query.beforeSeq);
      if (Number.isNaN(before.getTime()) || !Number.isFinite(seq)) return next(new AppError("before и beforeSeq обязательны вместе", 400));
      filter.$or = [{ sentAt: { $lt: before } }, { sentAt: before, seq: { $lt: seq } }];
    }
    const sort = newestFirst ? { sentAt: -1, seq: -1 } : { sentAt: 1, seq: 1 };
    let rows = await Message.find(filter).sort(sort).limit(limit).lean();
    if (newestFirst) rows = rows.reverse();
    const identities = byId(await ChannelIdentity.find({ _id: { $in: rows.map((m) => m.identityId).filter(Boolean) } }).lean());
    const replies = byId(await Message.find({ _id: { $in: rows.map((m) => m.replyToId).filter(Boolean) } }).lean());
    const users = byId(
      await User.find({
        _id: {
          $in: [
            ...rows.map((m) => m.authorUserId),
            ...[...identities.values()].map((i) => i.userId),
            ...[...replies.values()].map((r) => r.authorUserId),
          ].filter(Boolean),
        },
      })
        .select("firstName lastName")
        .lean(),
    );
    res.status(200).json({ items: rows.map((m) => messageRow(m, { identities, users, replies })), serverTime: new Date() });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить сообщения"));
  }
};

exports.ticketDraft = async (req, res, next) => {
  try {
    res.status(200).json(
      await ticketDraft({ auth: req.auth, conversationId: req.params.id, messageIds: String(req.query.messages || "") }),
    );
  } catch (error) {
    next(wrap(error, "Не удалось собрать заявку из диалога"));
  }
};

exports.seen = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const previous = await ConversationRead.findOneAndUpdate(
      { userId: req.auth.userId, conversationId: conversation._id },
      { $set: { seenAt: new Date() } },
      { upsert: true, new: false },
    ).lean();
    // «Прочитано» у клиента — только если с прошлого открытия пришло новое
    const channel = await Channel.findById(conversation.channelId).select("type isActive settings").lean();
    if (channel?.isActive && GATEWAY_NETWORKS.includes(channel.type) && channel.settings?.markReadOnOpen !== false) {
      const latest = await Message.findOne({
        conversationId: conversation._id,
        direction: "in",
        externalId: { $type: "string" },
        ...(previous?.seenAt ? { createdAt: { $gt: previous.seenAt } } : {}),
      })
        .sort({ sentAt: -1 })
        .select("externalId")
        .lean();
      if (latest) {
        await enqueueJob({
          channelId: channel._id,
          network: channel.type,
          type: "markRead",
          conversationId: conversation._id,
          payload: { chatId: conversation.externalChatId, upToExternalId: latest.externalId },
        });
      }
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отметить прочитанным"));
  }
};

exports.send = async (req, res, next) => {
  try {
    await loadVisible(req);
    const message = await sendFromInbox({
      conversationId: req.params.id,
      text: req.body?.text,
      files: req.files || [],
      auth: req.auth,
    });
    res.status(201).json({ message: messageRow(message, {}) });
  } catch (error) {
    // Отказ до создания сообщения — файлы формы никому не нужны
    if (error instanceof AppError && error.statusCode < 500) {
      for (const file of req.files || []) storage.deleteObject(file.key).catch(() => {});
    }
    next(wrap(error, "Не удалось отправить сообщение"));
  }
};

exports.handled = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const result = await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: { $ne: null } },
      { $set: { awaitingSince: null, handled: { at: new Date(), by: req.auth.userId, how: "noReply" } } },
    );
    if (result.modifiedCount) await addSystemLine(conversation, { kind: "handled", by: await me(req) });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отметить диалог"));
  }
};

exports.retry = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next(new AppError("Сообщение не найдено", 404));
    const message = await retryMessage({ messageId: req.params.id, auth: req.auth });
    res.status(200).json({ message: messageRow(message, {}) });
  } catch (error) {
    next(wrap(error, "Не удалось повторить отправку"));
  }
};

exports.assign = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const userId = req.body?.userId ?? null;
    let assignee = null;
    if (userId !== null) {
      if (!isId(userId)) return next(new AppError("Некорректный пользователь", 400));
      assignee = await User.findOne({ _id: userId, isEndUser: false, isServiceAccount: { $ne: true }, banned: { $ne: true } })
        .select("firstName lastName")
        .lean();
      if (!assignee) return next(new AppError("Назначить можно только сотрудника", 400));
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { assigneeId: assignee?._id || null } });
    await addSystemLine(conversation, { kind: "assigned", by: await me(req), targetName: assignee ? userName(assignee) : "" });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось назначить ответственного"));
  }
};

exports.bind = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    if (conversation.kind !== "direct") {
      return next(new AppError("Групповой чат к заявке не привязывается — добавьте в заявку нужные сообщения", 409));
    }
    const ticket = await loadOpenTicket(req, req.body?.ticketNum);
    const binding = conversation.binding || {};
    if (binding.ticketId && !binding.endedAt && String(binding.ticketId) !== String(ticket._id)) {
      const current = await Ticket.findById(binding.ticketId).select("isClosed").lean();
      if (current && !current.isClosed) return next(new AppError(`Диалог уже привязан к заявке №${binding.ticketNum}`, 409));
    }
    await bindConversation({ conversation, ticket, by: await me(req) });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось привязать диалог"));
  }
};

exports.unbind = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    res.status(200).json({ ok: await unbindConversation({ conversation, by: await me(req) }) });
  } catch (error) {
    next(wrap(error, "Не удалось отвязать диалог"));
  }
};

exports.attach = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const ticket = await loadOpenTicket(req, req.body?.ticketNum);
    const ids = (Array.isArray(req.body?.messageIds) ? req.body.messageIds : []).filter(isId).slice(0, 200);
    if (!ids.length) return next(new AppError("Выберите сообщения", 400));
    const messages = await Message.find({ _id: { $in: ids }, conversationId: conversation._id, direction: { $ne: "system" } })
      .sort({ sentAt: 1, seq: 1 })
      .lean();
    const count = await attachMessages({ conversation, messages, ticket, mode: "manual" });
    if (count) await addSystemLine(conversation, { kind: "attached", ticketNum: ticket.num, by: await me(req), count });
    bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
    res.status(200).json({ attached: count });
  } catch (error) {
    next(wrap(error, "Не удалось добавить сообщения в заявку"));
  }
};

exports.decision = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    // «Вернуть в работу» — действие заявки (хук возврата сам восстановит
    // привязку), «Новая заявка» — форма заявки; здесь только «Без заявки»
    if (req.body?.action !== "none") return next(new AppError("Ожидается action: none", 400));
    await Conversation.updateOne({ _id: conversation._id }, { $set: { decision: { ticketId: null, ticketNum: null, at: null } } });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось ответить на вопрос о заявке"));
  }
};

exports.hide = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    await Conversation.updateOne({ _id: conversation._id }, { $set: { hidden: req.body?.hidden !== false } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось скрыть диалог"));
  }
};

exports.update = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    if (!Object.hasOwn(req.body || {}, "companyId")) return next(new AppError("Нечего менять", 400));
    let companyId = null;
    if (req.body.companyId !== null) {
      if (!isId(req.body.companyId) || !(await Company.exists({ _id: req.body.companyId }))) {
        return next(new AppError("Компания не найдена", 400));
      }
      companyId = oid(req.body.companyId);
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { companyId } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось изменить диалог"));
  }
};

/** Собеседник, чьи диалоги человеку видны; иначе 404. */
const loadVisibleIdentity = async (req) => {
  if (!isId(req.params.id)) throw new AppError("Собеседник не найден", 404);
  const identity = await ChannelIdentity.findById(req.params.id).lean();
  if (!identity) throw new AppError("Собеседник не найден", 404);
  const conversations = await Conversation.find({
    $or: [{ counterpartIdentityId: identity._id }, { "participants.identityId": identity._id }],
  }).lean();
  if (!conversations.some((c) => canSeeConversation(c, req.auth))) throw new AppError("Собеседник не найден", 404);
  return identity;
};

exports.linkIdentity = async (req, res, next) => {
  try {
    const identity = await loadVisibleIdentity(req);
    if (!isId(req.body?.userId)) return next(new AppError("Укажите пользователя", 400));
    const user = await User.findOne({ _id: req.body.userId, isServiceAccount: { $ne: true } }).select("_id company isEndUser").lean();
    if (!user) return next(new AppError("Пользователь не найден", 404));
    await ChannelIdentity.updateOne(
      { _id: identity._id },
      { $set: { userId: user._id, linkMethod: "manual", isStaff: user.isEndUser === false, companyId: user.company?._id || null } },
    );
    if (user.company?._id) {
      await Conversation.updateMany({ counterpartIdentityId: identity._id, companyId: null }, { $set: { companyId: user.company._id } });
    }
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось связать собеседника"));
  }
};

exports.unlinkIdentity = async (req, res, next) => {
  try {
    const identity = await loadVisibleIdentity(req);
    await ChannelIdentity.updateOne({ _id: identity._id }, { $set: { userId: null, linkMethod: null, isStaff: false } });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отвязать собеседника"));
  }
};

exports.deliveryRoutes = async (req, res, next) => {
  try {
    const result = await deliveryRoutes(req.ticket);
    const applicant = req.ticket.applicantId
      ? await User.findById(req.ticket.applicantId).select("firstName lastName").lean()
      : null;
    res.status(200).json({ ...result, applicantName: userName(applicant) });
  } catch (error) {
    next(wrap(error, "Не удалось подобрать каналы ответа"));
  }
};
```

- [ ] **Step 4: Channel controller**

`backend/controllers/channel.js`:

```js
const crypto = require("crypto");
const mongoose = require("mongoose");

const Channel = require("@/models/channel");
const Conversation = require("@/models/conversation");
const ChannelJob = require("@/models/channelJob");
const { AppError } = require("@/middleware/errorHandling");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { enqueueJob } = require("@/services/messaging/jobs");
const { NETWORKS, GATEWAY_NETWORKS } = require("@/services/messaging/rules");

/**
 * Каналы «Диалогов» в настройках. Секреты принимаются и шифруются, но наружу
 * уходят только признаком «задан»; расшифрованными их видит лишь шлюз.
 * Команды шлюзу (вход, выход, прокси, история) — задания очереди.
 */

const SECRET_KEYS = ["tgApiId", "tgApiHash", "proxyPassword", "maxToken", "maxWebhookSecret"];
const wrap = (error, fallback) => (error instanceof AppError ? error : new AppError(fallback, 500, true, error));
const plain = (value) => (value?.toObject ? value.toObject() : value || {});

const publicChannel = (channel) => ({
  id: String(channel._id),
  type: channel.type,
  name: channel.name,
  isActive: channel.isActive,
  state: channel.state,
  stateReason: channel.stateReason || "",
  account: channel.account || {},
  login: channel.login || { qr: null, expiresAt: null },
  gatewaySeenAt: channel.gatewaySeenAt || null,
  lastMessageAt: channel.lastMessageAt || null,
  settings: channel.settings || {},
  secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(channel.secrets?.[key])])),
});

const cleanSettings = (raw = {}, current = {}) => {
  const next = { ...current };
  if (typeof raw.proxyUrl === "string") next.proxyUrl = raw.proxyUrl.trim().slice(0, 500);
  if (raw.historyDays !== undefined) next.historyDays = Math.min(Math.max(Number(raw.historyDays) || 0, 0), 90);
  for (const flag of ["importGroups", "markReadOnOpen", "signReplies"]) {
    if (typeof raw[flag] === "boolean") next[flag] = raw[flag];
  }
  if (raw.maxMediaMb !== undefined) next.maxMediaMb = Math.min(Math.max(Number(raw.maxMediaMb) || 50, 1), 200);
  if (Array.isArray(raw.ignoredChatIds)) next.ignoredChatIds = raw.ignoredChatIds.map(String).slice(0, 500);
  if (raw.site && typeof raw.site === "object") {
    next.site = { ...(current.site || {}) };
    if (Array.isArray(raw.site.allowedOrigins)) {
      next.site.allowedOrigins = raw.site.allowedOrigins
        .map((origin) => String(origin).trim())
        .filter((origin) => /^https?:\/\/[^/\s]+$/.test(origin))
        .slice(0, 20);
    }
    if (typeof raw.site.consentText === "string") next.site.consentText = raw.site.consentText.slice(0, 2000);
  }
  return next;
};

// Пустое значение секрета — «не менять» (как у почтовых каналов)
const sealSecrets = (raw = {}, current = {}) => {
  const next = { ...current };
  for (const key of SECRET_KEYS) {
    if (typeof raw[key] === "string" && raw[key].trim()) next[key] = encryptSecret(raw[key].trim());
  }
  return next;
};

const loadChannel = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Канал не найден", 404);
  const channel = await Channel.findById(req.params.id);
  if (!channel) throw new AppError("Канал не найден", 404);
  return channel;
};

exports.list = async (req, res, next) => {
  try {
    const channels = await Channel.find({}).sort({ createdAt: 1 }).lean();
    res.status(200).json({ channels: channels.map(publicChannel) });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить каналы"));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { type, name } = req.body || {};
    if (!NETWORKS.includes(type)) return next(new AppError("Тип канала: telegram, whatsapp, max или site", 400));
    if (!String(name || "").trim()) return next(new AppError("Назовите канал", 400));
    const settings = cleanSettings(req.body.settings, {});
    if (type === "site") {
      settings.site = { ...(settings.site || {}), formKey: crypto.randomBytes(24).toString("base64url") };
    }
    const channel = await Channel.create({
      type,
      name: String(name).trim().slice(0, 100),
      settings,
      secrets: sealSecrets(req.body.secrets, {}),
      createdBy: req.auth.userId,
    });
    res.status(201).json({ channel: publicChannel(channel.toObject()) });
  } catch (error) {
    next(wrap(error, "Не удалось создать канал"));
  }
};

exports.update = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    const body = req.body || {};
    if (typeof body.name === "string" && body.name.trim()) channel.name = body.name.trim().slice(0, 100);
    if (typeof body.isActive === "boolean") channel.isActive = body.isActive;
    if (body.settings) channel.settings = cleanSettings(body.settings, plain(channel.settings));
    if (body.secrets) channel.secrets = sealSecrets(body.secrets, plain(channel.secrets));
    await channel.save();
    res.status(200).json({ channel: publicChannel(channel.toObject()) });
  } catch (error) {
    next(wrap(error, "Не удалось сохранить канал"));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (await Conversation.exists({ channelId: channel._id })) {
      return next(new AppError("У канала есть диалоги — отключите его вместо удаления", 409));
    }
    await ChannelJob.updateMany({ channelId: channel._id, state: "pending" }, { $set: { state: "cancelled", finishedAt: new Date() } });
    await Channel.deleteOne({ _id: channel._id });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось удалить канал"));
  }
};

/** Команда шлюзу — задание очереди; результат читается через GET …/jobs/:jobId. */
const command = (type, build = () => ({})) => async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (!GATEWAY_NETWORKS.includes(channel.type)) {
      return next(new AppError("Эта команда — для каналов шлюза (Telegram, WhatsApp)", 409));
    }
    const payload = build(req);
    if (payload instanceof AppError) return next(payload);
    const job = await enqueueJob({ channelId: channel._id, network: channel.type, type, payload });
    if (type === "login" && payload.step === "start") {
      await Channel.updateOne({ _id: channel._id }, { $set: { state: "connecting", stateReason: "" } });
    }
    res.status(202).json({ jobId: String(job._id) });
  } catch (error) {
    next(wrap(error, "Не удалось передать команду шлюзу"));
  }
};

exports.login = command("login", (req) => {
  const step = req.body?.step;
  if (!["start", "phone", "code", "password"].includes(step)) {
    return new AppError("step: start | phone | code | password", 400);
  }
  const raw = typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (step !== "start" && !raw) return new AppError("Нужно значение для шага входа", 400);
  return { step, value: raw ? encryptSecret(raw) : null };
});
exports.logout = command("logout");
exports.test = command("testProxy");
exports.history = command("loadHistory", (req) => ({
  days: Math.min(Math.max(Number(req.body?.days) || 14, 1), 90),
}));

exports.job = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (!mongoose.isValidObjectId(req.params.jobId)) return next(new AppError("Задание не найдено", 404));
    const job = await ChannelJob.findOne({ _id: req.params.jobId, channelId: channel._id })
      .select("type state lastError result finishedAt")
      .lean();
    if (!job) return next(new AppError("Задание не найдено", 404));
    res.status(200).json({
      job: { id: String(job._id), type: job.type, state: job.state, error: job.lastError || "", result: job.result ?? null, finishedAt: job.finishedAt },
    });
  } catch (error) {
    next(wrap(error, "Не удалось прочитать задание"));
  }
};
```

- [ ] **Step 5: Mount**

`backend/routes/index.js`: `const conversationRoutes = require("./internal/conversation");` next to the other internal requires, and `internalRoutes.use("/", conversationRoutes);` right after `internalRoutes.use("/", ticketRoutes);`.

- [ ] **Step 6: Syntax checks, coverage and the suite**

Run: `cd backend && node --check routes/internal/conversation.js controllers/conversation.js controllers/channel.js routes/index.js && node scripts/checkPermissionCoverage.js && NODE_ENV=production pnpm test`
Expected: no syntax errors; coverage reports every action asked and every gate export mounted (`conversation.read|reply|manage` via the new router); tests green.

- [ ] **Step 7: Checkpoint**

No commit.

---

### Task 13: Repair cron, dev-copy safety, smoke run, docs

**Files:**
- Modify: `backend/app.js` (next to the other `guardedCron` calls), `sync-dev-db.sh`
- Create: `backend/scripts/smokeMessaging.js`, `docs/messaging.md`
- Modify: `docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md` (status line)

**Interfaces:**
- Consumes: everything above.
- Produces: cron `messagingRepair` (every minute); `scripts/smokeMessaging.js` (dev only, NOT in `migrate.js`); `docs/messaging.md`.

- [ ] **Step 1: Repair cron**

In `backend/app.js`, next to the other `guardedCron(...)` registrations:

```js
// «Диалоги»: ответы, застрявшие между комментарием, сообщением и заданием
// шлюзу (services/messaging/outbound.js#repairOutbound)
guardedCron(
  "messagingRepair",
  "* * * * *",
  () => require("@/services/messaging/outbound").repairOutbound(),
  50 * 1000,
);
```

- [ ] **Step 2: The dev copy never takes prod channels or the prod outbox**

In `sync-dev-db.sh` replace the single exclusion with a list and pass one flag per collection in both dump modes. The declaration:

```bash
# Never synced: dev settings stay as they are; prod channels (bot tokens, the
# MAX webhook secret) and the prod outbox would make the dev backend and gateway
# act as production — take over the MAX webhook, send queued prod messages.
EXCLUDE_COLLECTIONS=(preferences channels channeljobs)
EXCLUDE_FLAGS=()
for collection in "${EXCLUDE_COLLECTIONS[@]}"; do EXCLUDE_FLAGS+=("--excludeCollection=$collection"); done
```

Tunnel mode: replace `--excludeCollection="$EXCLUDE_COLLECTION" \` with `"${EXCLUDE_FLAGS[@]}" \`. Remote mode (string sent over ssh): replace `--excludeCollection=$EXCLUDE_COLLECTION \` with `$(printf -- '--excludeCollection=%s ' "${EXCLUDE_COLLECTIONS[@]}") \`. Replace every other `$EXCLUDE_COLLECTION` in messages with `${EXCLUDE_COLLECTIONS[*]}` (run `grep -n EXCLUDE_COLLECTION sync-dev-db.sh` — no singular name may remain). Confirm the restore step drops only collections present in the archive (`mongorestore --drop` does exactly that), so dev `channels`/`channeljobs` survive a sync. Check syntax: `bash -n sync-dev-db.sh`. Never run the script in this task (it reads production).

- [ ] **Step 3: Smoke script**

`backend/scripts/smokeMessaging.js`:

```js
// Прогон «Диалогов» P0 на базе дева: события шлюза → сообщения, зеркала в
// заявку, ответ из HD, очередь и эхо, закрытие заявки. Всё созданное удаляется
// по списку _id (считаем → удаляем), чужие данные не трогаются. НЕ миграция.
//
// Запуск внутри контейнера бэкенда:  node scripts/smokeMessaging.js
require("module-alias/register");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const Channel = require("@/models/channel");
  const Conversation = require("@/models/conversation");
  const Message = require("@/models/message");
  const ChannelIdentity = require("@/models/channelIdentity");
  const ChannelJob = require("@/models/channelJob");
  const Comment = require("@/models/comment");
  const Preferences = require("@/models/preferences");
  const User = require("@/models/user");
  const { Ticket } = require("@/models/ticket");
  const { validateEvent } = require("@/services/messaging/events");
  const { ingestEvent } = require("@/services/messaging/ingest");
  const { bindConversation } = require("@/services/messaging/bindings");
  const { sendFromInbox } = require("@/services/messaging/outbound");
  const { leaseJobs, ackJobs } = require("@/services/messaging/jobs");

  const created = { channels: [], tickets: [] };
  const step = (name) => console.log(`• ${name}`);
  const ingest = async (raw) => {
    const checked = validateEvent(raw);
    assert.equal(checked.ok, true, checked.error);
    const result = await ingestEvent(checked.event);
    assert.equal(result.ok, true, result.error);
    return result;
  };

  const prefs = await Preferences.findOne({}).lean();
  const serviceId = prefs?.defaultApplicant?._id;
  if (!serviceId) throw new Error("Нет служебной учётки по умолчанию (Настройки → Сбор заявок)");
  const service = await User.findById(serviceId).lean();
  const staff = await User.findOne({ isEndUser: false, isServiceAccount: { $ne: true } }).select("_id firstName lastName").lean();

  try {
    const channel = await Channel.create({ type: "telegram", name: "[SMOKE] Telegram", state: "connected", account: { displayName: "SMOKE Поддержка" } });
    created.channels.push(channel._id);
    const chatId = `smoke-${Date.now()}`;
    const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const inbound = (id, text, minutes) => ({
      type: "message",
      channelId: String(channel._id),
      chat: { id: chatId, kind: "direct", title: "SMOKE Собеседник", peer: { id: chatId, name: "SMOKE Собеседник" } },
      message: { id, direction: "in", sender: { id: chatId, name: "SMOKE Собеседник" }, kind: "text", text, sentAt: at(minutes) },
    });

    step("replay: одно событие дважды → одно сообщение, диалог ждёт ответа");
    await ingest(inbound("1", "Принтер не печатает", -10));
    await ingest(inbound("1", "Принтер не печатает", -10));
    const conversation = await Conversation.findOne({ channelId: channel._id, externalChatId: chatId }).lean();
    assert.equal(await Message.countDocuments({ conversationId: conversation._id, direction: "in" }), 1);
    assert.ok(conversation.awaitingSince);

    step("binding: привязка кладёт неотвеченное в заявку");
    const ticket = await Ticket.create({
      title: "[SMOKE] Диалоги",
      description: "smoke",
      applicantId: service._id,
      company: { _id: service.company._id, alias: service.company.alias },
      source: "Telegram",
      state: "В работе",
      createdBy: service._id,
      updatedBy: service._id,
      notifications: { lastAction: "new ticket", pending: false },
    });
    created.tickets.push(ticket._id);
    await bindConversation({ conversation, ticket, by: staff });
    const first = await Message.findOne({ conversationId: conversation._id, externalId: "1" }).lean();
    assert.equal(String(first.ticketId), String(ticket._id));
    assert.ok(first.commentId, "первое сообщение стало комментарием");

    step("bound: новое сообщение клиента — сразу комментарий, id в ticket.comments");
    await ingest(inbound("2", "Горит оранжевый", -5));
    const second = await Message.findOne({ conversationId: conversation._id, externalId: "2" }).lean();
    assert.ok(second.commentId);
    const withComments = await Ticket.findById(ticket._id).select("comments").lean();
    assert.ok(withComments.comments.map(String).includes(String(second.commentId)));

    step("outbound: ответ из «Диалогов» → комментарий, сообщение, задание; ожидание снято");
    const auth = { userId: String(staff._id), isAdmin: true, isEndUser: false, can: () => true, legacy: { responsibleForCompanies: [] } };
    const sent = await sendFromInbox({ conversationId: conversation._id, text: "Сейчас посмотрим", files: [], auth });
    assert.equal(sent.status, "queued");
    assert.ok(sent.commentId);
    assert.equal((await Conversation.findById(conversation._id).lean()).awaitingSince, null);

    step("echo before ack: эхо с jobId не плодит второе исходящее");
    const batch = await leaseJobs({ networks: ["telegram"] });
    const job = batch.jobs.find((item) => String(item.messageId) === String(sent._id));
    assert.ok(job, "задание выдано");
    await ingest({
      type: "message",
      channelId: String(channel._id),
      chat: { id: chatId, kind: "direct" },
      message: { id: "3", direction: "out", origin: "hd", jobId: String(job._id), kind: "text", text: "Сейчас посмотрим", sentAt: at(0) },
    });
    await ackJobs(batch.leaseId, [{ id: String(job._id), ok: true, result: { externalId: "3" } }]);
    assert.equal(await Message.countDocuments({ conversationId: conversation._id, direction: "out" }), 1);
    const delivered = await Message.findById(sent._id).lean();
    assert.equal(delivered.status, "sent");
    assert.equal((await Comment.findById(delivered.commentId).lean()).channel.status, "sent");

    step("after close: закрытие заканчивает привязку, новое сообщение спрашивает «о ней?»");
    const doc = await Ticket.findById(ticket._id);
    doc.isClosed = true;
    doc.state = "Закрыта";
    await doc.save();
    await new Promise((resolve) => setTimeout(resolve, 500)); // хук закрытия работает после сохранения
    await ingest(inbound("4", "Снова не печатает", 1));
    const after = await Conversation.findById(conversation._id).lean();
    assert.ok(after.binding.endedAt, "привязка закончилась");
    assert.equal(String(after.decision.ticketId), String(ticket._id));
    const fourth = await Message.findOne({ conversationId: conversation._id, externalId: "4" }).lean();
    assert.equal(fourth.ticketId, null, "в закрытую заявку не пишем");

    console.log("\nPASS");
  } finally {
    const conversations = await Conversation.find({ channelId: { $in: created.channels } }).select("_id counterpartIdentityId participants").lean();
    const conversationIds = conversations.map((c) => c._id);
    const messages = await Message.find({ conversationId: { $in: conversationIds } }).select("_id").lean();
    const comments = await Comment.find({ ticketId: { $in: created.tickets } }).select("_id").lean();
    const jobs = await ChannelJob.find({ channelId: { $in: created.channels } }).select("_id").lean();
    const identities = await ChannelIdentity.find({
      _id: { $in: conversations.flatMap((c) => [c.counterpartIdentityId, ...(c.participants || []).map((p) => p.identityId)]).filter(Boolean) },
      externalId: /^smoke-/,
    }).select("_id").lean();
    // Следы прогона вне «Диалогов»: водяной знак заявки у отправителя и
    // колокольчик «новое сообщение» у тех, кто ведёт диалоги
    const TicketRead = require("@/models/ticketRead");
    const InAppNotification = require("@/models/inAppNotification");
    const reads = await TicketRead.find({ ticketId: { $in: created.tickets } }).select("_id").lean();
    const notices = await InAppNotification.find({
      link: { $in: conversationIds.map((id) => `/conversations/${id}`) },
    }).select("_id").lean();
    console.log(
      `Уборка: каналов ${created.channels.length}, диалогов ${conversationIds.length}, сообщений ${messages.length}, ` +
        `комментариев ${comments.length}, заданий ${jobs.length}, собеседников ${identities.length}, заявок ${created.tickets.length}, ` +
        `отметок прочтения ${reads.length}, уведомлений ${notices.length}`,
    );
    await TicketRead.deleteMany({ _id: { $in: reads.map((r) => r._id) } });
    await InAppNotification.deleteMany({ _id: { $in: notices.map((n) => n._id) } });
    await Comment.deleteMany({ _id: { $in: comments.map((c) => c._id) } });
    await Message.deleteMany({ _id: { $in: messages.map((m) => m._id) } });
    await ChannelJob.deleteMany({ _id: { $in: jobs.map((j) => j._id) } });
    await Conversation.deleteMany({ _id: { $in: conversationIds } });
    await ChannelIdentity.deleteMany({ _id: { $in: identities.map((i) => i._id) } });
    await Ticket.deleteMany({ _id: { $in: created.tickets } });
    await Channel.deleteMany({ _id: { $in: created.channels } });
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
```

(If `Ticket.create` rejects a missing required field, add the field with a neutral value — e.g. `deadline: new Date(Date.now() + 3600_000)` — and note it in the report.)

- [ ] **Step 4: Module documentation**

Create `docs/messaging.md` (English, no UI) with these sections:

1. **Overview** — what «Диалоги» are; the backend owns state; adapters (msg-gateway for Telegram/WhatsApp, backend MAX adapter and site form in later phases) all emit the same events. Link the spec.
2. **Collections** — one paragraph per model (`channels`, `channelidentities`, `conversations`, `messages`, `channeljobs`, `conversationreads`) with the unique indexes and why (`{channelId, externalChatId, externalId}` dedup; `commentId` one-to-one).
3. **Events** — the table of event types with their fields exactly as `services/messaging/events.js` validates them (copy the limits: text 20 000, 20 attachments, 100 ids, 50 events per batch), the meaning of `origin` (`device` = sent from the corporate phone, `hd` + `jobId` = echo of our own send), `chat.peer` for direct chats, `imported` for history.
4. **Ingest invariants** — replay via `effects`; only-if-newer summary; awaiting rules (`nextAwaiting`); attach rules (`decideAttach`, 30-day decision window); mirrored comments: messenger time, `$addToSet` into `ticket.comments`, `skipApplicant`, names-only `channel` block, attachments copied.
5. **Jobs** — types and payloads (`send {chatId, kind, text, attachments[]}`, `markRead {chatId, upToExternalId}`, `fetchMedia`, `login {step, value}`, `logout`, `loadHistory {days}`, `testProxy`), leasing (2 min, head-of-conversation ordering), ack shape and outcomes (backoff 30 s → 30 min × 5, `retryAfterMs` = pause), the repair cron.
6. **Gateway API** — the seven endpoints from Task 11 with request/response shapes and the `X-Gateway-Token` header; media upload/download.
7. **Staff API** — the list from Task 12 (one line each) and the permission/module gates.
8. **Operations** — `MSG_GATEWAY_TOKEN`; migrations `2026-09-25-grantConversations`, `2026-09-25-initMessaging`; `sync-dev-db.sh` excludes `channels`, `channeljobs`; `node scripts/smokeMessaging.js` on dev; the pulse topic `conversations` is staff-only.

Update the spec's status line to: `Status: design and mockup approved 2026-09-24; P0 backend implemented 2026-09-25 (not committed).`

- [ ] **Step 5: Full verification**

Run, in order:

```bash
cd backend && NODE_ENV=production pnpm test
cd backend && node scripts/checkPermissionCoverage.js
cd backend && pnpm typecheck        # no new errors against the baseline
bash -n ../sync-dev-db.sh
docker compose restart backend && docker compose logs --since 1m backend | tail -40   # boots without errors
docker compose exec backend node scripts/migrate.js status               # the two new entries listed
docker compose exec backend node scripts/initMessaging.js --apply
docker compose exec backend node scripts/migrate.js mark 2026-09-25-initMessaging
docker compose exec backend node scripts/smokeMessaging.js               # ends with PASS and a cleanup line
docker compose exec backend node -e 'fetch("http://localhost:" + (process.env.PORT || 8000) + "/api/gateway/channels").then((r) => console.log(r.status))'   # 401
```

Expected: tests green; coverage clean; typecheck at baseline; the backend boots; the smoke prints every `•` step, `PASS` and the cleanup counts; the gateway answers 401 without the token. If the port differs, read it from `backend/app.js`.

- [ ] **Step 6: Final checkpoint**

Report the list of changed and created files. No commit — the owner commits.

