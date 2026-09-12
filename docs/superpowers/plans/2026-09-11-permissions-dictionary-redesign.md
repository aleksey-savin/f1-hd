# Permissions Dictionary Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy-shaped permissions dictionary with the agreed one (verb + entity labels, `read`/`manage` per entity, audience tags, no hidden meanings), enforce it on every route, migrate roles, and give the role form an audience-filtered matrix.

**Architecture:** The dictionary in `backend/auth/access.js` is the single source: actions carry `audience` (`staff` | `client` | `both`) and per-audience hints, and travel to the client through `/api/me`. `services/permissions.js` resolves roles once per request and strips actions of the other audience for the account type. Scope (which records a right covers) lives in small pure services (`services/ticketScope.js`) shared by every controller; route gates in `middleware/permissions.js` are named exactly after dictionary actions. The role form filters its matrix by the role's audience. Roles are migrated by a mapping module shared by the seed (`roles.catalogue.json`), the legacy flag mapping and a one-shot DB rewrite script.

**Tech Stack:** Node 22 CommonJS backend (Express 5, Mongoose, better-auth access control), React 19 + react-router frontend (Vite, Tailwind 4, shadcn primitives), `node --test` for unit tests, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-11-permissions-dictionary-redesign-design.md` — read it first; every label, audience and rule below is copied from it. Approved role-form mockup: https://claude.ai/code/artifact/dddd9e4e-aeca-4ebf-a584-2cc8a170c14c

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. `pnpm add` needs the sandbox off (`dangerouslyDisableSandbox: true`); this plan adds no dependencies.
- **No git commits.** The owner commits in batches on explicit request. Every task ends with a checkpoint that lists changed files; never run `git add`/`git commit`/`git push`.
- **Backend verification:** `cd backend && pnpm test` (runs `node --test` over `services/**`, `validations/**`, `helpers/**`, plus `auth/**` after Task 1) and `node --check <file>` for every touched backend file. Backend eslint is broken; do not try to fix it.
- **Frontend verification:** `cd frontend && pnpm build && pnpm typecheck; pnpm lint`. Typecheck has a known baseline of 3 errors (FormWrapper, ApprovalReport); lint baseline is green. Compare against the baseline, do not introduce new errors. Never add `eslint-disable react-hooks/*` comments (the plugin is not installed; the comment itself fails lint).
- **Unit tests use `node --test`**, no framework. Backend tests are CommonJS and start with `require("module-alias/register")`. Frontend tests are ESM and import with an explicit extension (`./ticket-actions.js`, `./sections.ts`). Only `.js`/`.ts` files without JSX are testable this way; keep pure logic out of `.jsx`.
- **Dictionary rules (spec):** ids are `resource.action`; labels are verb + entity, copied verbatim from the spec tables; `read` opens the section, `manage` creates/edits/deletes; a drop-down inside another form needs no right; own records need no right; every ticket mutation checks the relation to the ticket; `settings` is one right.
- **Account type:** `user.isEndUser === false` is staff; `true` or `undefined` is a client. Disabled users are `banned: true`; filter with `{ banned: { $ne: true } }`.
- **UI strings are Russian** and follow the wording canon in `docs/ux-ui-guide.md` («Словарь действий»): «шаблон», never «заготовка»; «Новый X», never «Добавить». The users section is «Пользователи» everywhere, never «Люди».
- **UI changes are limited to what the spec and the approved mockup describe.** No restyling of anything else; permission-driven visibility only.
- **Scripts against the dev database** run inside the backend container: `docker exec hd-backend-1 node scripts/<name>.js` (dry run) and `... --apply`. Docker access needs `dangerouslyDisableSandbox: true`. Dev = prod copy; prod itself is not touched by this plan (better-auth is not live there yet).
- **Old gate names are removed, not re-exported.** `canAdministrateTickets`, `canUpdateTickets`, `canReadWorksReport`, `canOpenApproval`, `canReadSettings`, `canManageMailSettings`, `canManageIntegrations`, `canManageSecuritySettings` disappear in Task 18; until then they stay so intermediate states still boot.

---

## File Structure

**Backend — dictionary and resolution**
- Modify `backend/auth/access.js` — new `GROUPS` (54 actions, audience, hints), `audienceOfAction`, `accountAudienceOf`, `stripStatementsForAudience`, guard.
- Create `backend/auth/access.test.js` — catalogue soundness and audience helpers.
- Modify `backend/package.json` — test glob includes `auth/**/*.test.js`.
- Modify `backend/services/permissions.js` — audience stripping, `grantStatements`, audience-aware `permissionFilter`.
- Modify `backend/services/authContext.js` — `canGrant`, `grantStatements` on `req.auth`.
- Modify `backend/controllers/me.js` — `grantStatements`, moderator flag via right.
- Create `backend/services/actionMigration.js` (+ `.test.js`) — old → new action map, derived rights.
- Create `backend/scripts/migrateActions.js` — rewrites `organizationRole.permission`, strips staff rights from client roles, grants `kb-moderator` to the settings list.
- Modify `backend/scripts/legacyPermissions.js`, `backend/scripts/roles.catalogue.json`.
- Modify `backend/middleware/permissions.js` — gates named after actions.

**Backend — scope and controllers**
- Create `backend/services/ticketScope.js` (+ `.test.js`) — tiers own / companies / all.
- Modify `backend/services/ticketAccess.js` (+ create `.test.js`) — `canAccessTicket` via scope, `canEditChecklist`.
- Modify `backend/routes/internal/*.js`, `backend/routes/index.js`, controllers listed per task.

**Frontend**
- Modify `frontend/src/store/authed-user.ts` — types with audience, `useCanGrant`.
- Create `frontend/src/components/Role/audience.js` (+ `.test.js`) — pure helpers for the role form.
- Modify `frontend/src/components/User/PermissionModules.jsx`, `frontend/src/components/Role/Form.jsx`.
- Create `frontend/src/components/Ticket/ticket-actions.test.js`.
- Modify ticket views, menu, routes, sections, settings page — per task.

**Docs**
- Modify `docs/ux-ui-guide.md` («Роли и права»), `docs/ux-ui-changelog.md`.

---

### Task 1: The dictionary — groups, audience, hints, helpers

**Files:**
- Modify: `backend/auth/access.js` (replace `GROUPS`, add helpers, extend guard and exports)
- Modify: `backend/package.json` (`scripts.test`)
- Create: `backend/auth/access.test.js`

**Interfaces:**
- Produces: `GROUPS[].actions[]` entries `{ id, label, audience, hint?, clientHint? }`; `audienceOfAction(id) → "staff"|"client"|"both"`; `accountAudienceOf(user) → "staff"|"client"`; `stripStatementsForAudience(statements, accountAudience) → statements`; existing exports unchanged (`STATEMENT`, `ACTION_LABELS`, `ALL_ACTIONS`, `isKnownAction`, `isFullAccess`, `fullAccessStatements`, `actionsToStatements`, `statementsToActions`).

- [ ] **Step 1: Add the test glob**

In `backend/package.json` change the `test` script to:

```json
"test": "node --test \"auth/**/*.test.js\" \"services/**/*.test.js\" \"validations/**/*.test.js\" \"helpers/**/*.test.js\""
```

- [ ] **Step 2: Write the failing test**

Create `backend/auth/access.test.js`:

```js
// node --test auth/access.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  GROUPS,
  ALL_ACTIONS,
  audienceOfAction,
  accountAudienceOf,
  stripStatementsForAudience,
  isFullAccess,
  fullAccessStatements,
} = require("./access");

test("dictionary has 15 groups and 54 actions in the agreed order", () => {
  assert.equal(GROUPS.length, 15);
  assert.equal(ALL_ACTIONS.length, 54);
  assert.deepEqual(ALL_ACTIONS.slice(0, 7), [
    "ticket.readCompanies",
    "ticket.readAll",
    "ticket.perform",
    "ticket.manage",
    "ticket.delete",
    "ticket.createForOthers",
    "ticket.closeWithoutWork",
  ]);
  assert.equal(ALL_ACTIONS.at(-1), "settings.manage");
});

test("every action has an audience; clientHint only on both", () => {
  for (const group of GROUPS) {
    for (const action of group.actions) {
      assert.ok(["staff", "client", "both"].includes(action.audience), action.id);
      if (action.clientHint) assert.equal(action.audience, "both", action.id);
      assert.match(action.label, /^(Видеть|Изменять|Брать|Вести|Удалять|Заводить|Закрывать|Записывать|Согласовывать|Управлять|Входить|Модерировать|Запускать) /, action.id);
    }
  }
});

test("audiences of the spec's special cases", () => {
  assert.equal(audienceOfAction("ticket.perform"), "staff");
  assert.equal(audienceOfAction("ticket.readCompanies"), "both");
  assert.equal(audienceOfAction("approval.decide"), "client");
  assert.equal(audienceOfAction("work.readCost"), "both");
  assert.equal(audienceOfAction("settings.manage"), "staff");
  assert.equal(audienceOfAction("nope.nothing"), "staff");
});

test("account audience: isEndUser false is staff, anything else is client", () => {
  assert.equal(accountAudienceOf({ isEndUser: false }), "staff");
  assert.equal(accountAudienceOf({ isEndUser: true }), "client");
  assert.equal(accountAudienceOf({}), "client");
});

test("stripping keeps both-actions and drops the other audience", () => {
  const statements = {
    ticket: ["readCompanies", "perform", "createForOthers"],
    approval: ["read", "decide", "manage"],
    settings: ["manage"],
  };
  assert.deepEqual(stripStatementsForAudience(statements, "client"), {
    ticket: ["readCompanies", "createForOthers"],
    approval: ["read", "decide"],
  });
  assert.deepEqual(stripStatementsForAudience(statements, "staff"), {
    ticket: ["readCompanies", "perform", "createForOthers"],
    approval: ["read", "manage"],
    settings: ["manage"],
  });
});

test("full access is judged before stripping", () => {
  const full = fullAccessStatements();
  assert.equal(isFullAccess(full), true);
  assert.equal(isFullAccess(stripStatementsForAudience(full, "staff")), false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --test auth/access.test.js`
Expected: FAIL — `audienceOfAction is not a function`, group count mismatch.

- [ ] **Step 4: Replace `GROUPS` in `backend/auth/access.js`**

Replace the whole `const GROUPS = [ … ];` block with:

```js
const GROUPS = [
  {
    key: "tickets",
    label: "Заявки",
    actions: [
      {
        id: "ticket.readCompanies",
        label: "Видеть заявки своих компаний",
        audience: "both",
        hint: "Все заявки компаний, за которые он отвечает (список ответственных в карточке компании), включая новые без исполнителя.",
        clientHint: "Все заявки его компании.",
      },
      {
        id: "ticket.readAll",
        label: "Видеть все заявки",
        audience: "staff",
        hint: "Все заявки всех компаний.",
      },
      {
        id: "ticket.perform",
        label: "Брать заявки в работу",
        audience: "staff",
        hint: "Принять, присоединиться, запросить помощь, изменить срок, отказаться, закрыть, вернуть в работу; отмечать пункты чек-листа и составлять его на своей заявке, если она не из регламента; инструменты ИИ. Попадает в списки исполнителей.",
      },
      {
        id: "ticket.manage",
        label: "Вести заявки",
        audience: "staff",
        hint: "Обработать новую, назначить и снять любых ответственных, изменить тему, категорию, описание, ответы, компанию и инициатора, вложения заявки, чек-лист любой заявки. Получает уведомления менеджера.",
      },
      {
        id: "ticket.delete",
        label: "Удалять заявки",
        audience: "staff",
        hint: "Удалять доступные заявки, по одной и списком.",
      },
      {
        id: "ticket.createForOthers",
        label: "Заводить заявки за других",
        audience: "both",
        hint: "Любой инициатор любой компании и ответственные.",
        clientHint: "Инициатор — коллега его компании. Компания всегда своя, ответственных он не указывает.",
      },
      {
        id: "ticket.closeWithoutWork",
        label: "Закрывать без записи о работе",
        audience: "staff",
        hint: "Обычно заявка закрывается вместе с записью о выполненной работе.",
      },
    ],
  },
  {
    key: "ticketCatalogs",
    label: "Справочники заявок",
    actions: [
      {
        id: "ticketCategory.read",
        label: "Видеть категории заявок",
        audience: "staff",
        hint: "Раздел «Категории». Выбор категории в форме заявки права не требует.",
      },
      { id: "ticketCategory.manage", label: "Изменять категории заявок", audience: "staff" },
      {
        id: "ticketTemplate.read",
        label: "Видеть все шаблоны заявок",
        audience: "staff",
        hint: "Чужие шаблоны в разделе и в форме заявки. Свои шаблоны каждый видит и правит без права, включая клиента.",
      },
      {
        id: "ticketTemplate.manage",
        label: "Изменять все шаблоны заявок",
        audience: "staff",
        hint: "Менять и удалять чужие шаблоны.",
      },
      { id: "checklistTemplate.read", label: "Видеть шаблоны чек-листов", audience: "staff" },
      { id: "checklistTemplate.manage", label: "Изменять шаблоны чек-листов", audience: "staff" },
    ],
  },
  {
    key: "routineTasks",
    label: "Регламенты",
    actions: [
      {
        id: "routineTask.read",
        label: "Видеть регламенты",
        audience: "staff",
        hint: "Раздел, карточка регламента и ссылка из регламентной заявки.",
      },
      {
        id: "routineTask.manage",
        label: "Изменять регламенты",
        audience: "staff",
        hint: "Заводить, менять, останавливать, удалять; синхронизация из шаблона заявки.",
      },
    ],
  },
  {
    key: "work",
    label: "Работы",
    actions: [
      {
        id: "work.read",
        label: "Видеть работы",
        audience: "both",
        hint: "Работы в заявках, сегмент «Работы» архива, требование работ при закрытии.",
        clientHint: "Работы его компании в архиве. Работы на своей заявке он видит и без права.",
      },
      {
        id: "work.log",
        label: "Записывать работы",
        audience: "staff",
        hint: "Заводить, планировать, править и удалять свои работы — заведённые, запланированные или отмеченные им.",
      },
      {
        id: "work.manage",
        label: "Изменять все работы",
        audience: "staff",
        hint: "Чужие работы.",
      },
      {
        id: "work.readCost",
        label: "Видеть стоимость работ",
        audience: "both",
        hint: "Суммы по тарифу и доплаты вне графика в работах и в предпросмотре.",
        clientHint: "Суммы по тарифу и доплаты вне графика по работам его компании.",
      },
    ],
  },
  {
    key: "reports",
    label: "Отчёты",
    actions: [
      {
        id: "report.companies",
        label: "Видеть отчёт «Компании»",
        audience: "both",
        hint: "Страница и данные; объём даёт роль в компании.",
        clientHint: "По своей компании: ответственное лицо видит отчёт целиком, руководитель подразделения — своё подразделение.",
      },
      {
        id: "report.employees",
        label: "Видеть отчёт «Сотрудники»",
        audience: "staff",
        hint: "Сводка по сотрудникам и отчёт другого сотрудника. Больше ничего.",
      },
      {
        id: "report.own",
        label: "Видеть свой отчёт",
        audience: "staff",
        hint: "Личный отчёт и блок переработок на главной.",
      },
    ],
  },
  {
    key: "approval",
    label: "Согласование работ",
    actions: [
      {
        id: "approval.read",
        label: "Видеть согласование работ",
        audience: "both",
        hint: "Конвейер и карточки отчётов.",
        clientHint: "Отчёты, которые ждут его подписи или подписаны им.",
      },
      {
        id: "approval.decide",
        label: "Согласовывать отчёты",
        audience: "client",
        hint: "Подписывать со стороны клиента. Чью подпись ждёт отчёт, решает роль в компании.",
      },
      {
        id: "approval.manage",
        label: "Вести согласование",
        audience: "staff",
        hint: "Собрать отчёт, выставить счёт, отметить оплату, отправить в архив.",
      },
    ],
  },
  {
    key: "servicePlans",
    label: "Услуги и тарифы",
    actions: [
      {
        id: "servicePlan.read",
        label: "Видеть услуги и тарифы",
        audience: "both",
        hint: "Раздел и услуги на карточке компании.",
        clientHint: "Услуги своей компании.",
      },
      {
        id: "servicePlan.manage",
        label: "Изменять услуги и тарифы",
        audience: "staff",
        hint: "Заводить, менять, удалять; привязка к компаниям.",
      },
    ],
  },
  {
    key: "companies",
    label: "Компании",
    actions: [
      {
        id: "company.read",
        label: "Видеть компании",
        audience: "both",
        hint: "Все компании.",
        clientHint: "Карточка своей компании.",
      },
      {
        id: "company.manage",
        label: "Изменять компании",
        audience: "staff",
        hint: "Компании, подразделения, ответственные, связь с Active Directory, API-ключи.",
      },
      {
        id: "company.readLogs",
        label: "Видеть журнал входов AD",
        audience: "staff",
        hint: "Кто, когда и с какого компьютера входил у клиента. Персональные данные его сотрудников.",
      },
    ],
  },
  {
    key: "users",
    label: "Пользователи",
    actions: [
      {
        id: "user.read",
        label: "Видеть пользователей",
        audience: "both",
        hint: "Все пользователи.",
        clientHint: "Коллеги своей компании.",
      },
      {
        id: "user.manage",
        label: "Изменять пользователей",
        audience: "staff",
        hint: "Заводить, менять, отключать, удалять; причина и срок отключения.",
      },
      {
        id: "user.manageFinances",
        label: "Изменять оклады и ставки",
        audience: "staff",
        hint: "Секция финансов в карточке и форме сотрудника. Свои оклад и ставку каждый видит сам.",
      },
      {
        id: "user.manageAccess",
        label: "Управлять доступом и ролями",
        audience: "staff",
        hint: "Пароли, сеансы, второй фактор и назначение ролей.",
      },
      {
        id: "user.impersonate",
        label: "Входить под пользователем",
        audience: "staff",
        hint: "Открыть портал глазами человека — ссылкой в другой браузер. Под администратором войти нельзя.",
      },
    ],
  },
  {
    key: "roles",
    label: "Роли",
    actions: [
      {
        id: "role.read",
        label: "Видеть роли",
        audience: "staff",
        hint: "Каталог ролей и выбор роли в форме пользователя.",
      },
      { id: "role.manage", label: "Изменять роли", audience: "staff" },
    ],
  },
  {
    key: "schedule",
    label: "Графики и отсутствия",
    actions: [
      {
        id: "schedule.read",
        label: "Видеть графики и отсутствия",
        audience: "staff",
        hint: "Календарь команды, чужие графики и отсутствия. Свой график и свои отсутствия видны без права.",
      },
      {
        id: "schedule.manage",
        label: "Изменять графики и отсутствия",
        audience: "staff",
        hint: "Графики и отсутствия других сотрудников, удаление; ручная установка любого статуса присутствия.",
      },
      { id: "schedule.approve", label: "Согласовывать отсутствия", audience: "staff" },
    ],
  },
  {
    key: "knowledge",
    label: "База знаний",
    actions: [
      {
        id: "knowledge.read",
        label: "Видеть базу знаний",
        audience: "both",
        hint: "Раздел и заметки по их видимости.",
        clientHint: "Заметки своей компании.",
      },
      {
        id: "knowledge.manage",
        label: "Изменять базу знаний",
        audience: "staff",
        hint: "Заводить, править и удалять заметки.",
      },
      {
        id: "knowledge.moderate",
        label: "Модерировать базу знаний",
        audience: "staff",
        hint: "Одобрять заметки, решать об удалении и архиве, сводка модерации и её уведомления.",
      },
    ],
  },
  {
    key: "inventory",
    label: "Оборудование",
    actions: [
      {
        id: "device.read",
        label: "Видеть технику и расположения",
        audience: "both",
        hint: "Реестр, карточки, план расположений.",
        clientHint: "Техника и расположения своей компании.",
      },
      { id: "device.manage", label: "Изменять технику и расположения", audience: "staff" },
      {
        id: "inventoryCatalog.read",
        label: "Видеть справочники техники",
        audience: "staff",
        hint: "Типы, модели, вендоры, атрибуты и конфигурации устройств. Выбор в форме устройства права не требует.",
      },
      { id: "inventoryCatalog.manage", label: "Изменять справочники техники", audience: "staff" },
      { id: "supplier.read", label: "Видеть поставщиков", audience: "staff" },
      { id: "supplier.manage", label: "Изменять поставщиков", audience: "staff" },
      {
        id: "mikrotik.read",
        label: "Видеть устройства Mikrotik",
        audience: "staff",
        hint: "Раздел мониторинга: записи, адреса, состояние, отчёт «Сети».",
      },
      { id: "mikrotik.manage", label: "Изменять устройства Mikrotik", audience: "staff" },
      {
        id: "mikrotik.manageConfigs",
        label: "Изменять конфигурации Mikrotik",
        audience: "staff",
        hint: "Резервные копии, выгрузки и расписания.",
      },
    ],
  },
  {
    key: "remoteSupport",
    label: "Удалённая помощь",
    actions: [
      {
        id: "remoteSupport.use",
        label: "Запускать сеанс удалённой помощи",
        audience: "staff",
        hint: "PRO32 Connect: приглашение на подключение к экрану заявителя.",
      },
    ],
  },
  {
    key: "settings",
    label: "Настройки",
    actions: [
      {
        id: "settings.manage",
        label: "Изменять настройки",
        audience: "staff",
        hint: "Страница настроек целиком: реквизиты, заявки, почта и уведомления, интеграции и ключи, политики входа, модули, календарь, база знаний.",
      },
    ],
  },
];
```

Also rewrite the header comment's naming rules paragraph to add one bullet after «Ширину видимости…»:

```
 * • У действия есть адресат (`audience`): `staff`, `client` или `both`. Форма
 *   роли показывает только строки адресата роли, а сервер вырезает действия
 *   чужого адресата при разрешении прав аккаунта (services/permissions.js).
 *   У `both` может быть вторая подсказка `clientHint` — для клиентской роли.
```

- [ ] **Step 5: Add the helpers and extend the guard**

After `ALL_ACTIONS` add:

```js
const AUDIENCES = ["staff", "client", "both"];

/** Адресат действия: `staff` по умолчанию, `client`, `both`. */
const ACTION_AUDIENCE = Object.fromEntries(
  GROUPS.flatMap((group) =>
    group.actions.map((action) => [action.id, action.audience || "staff"]),
  ),
);

const audienceOfAction = (id) => ACTION_AUDIENCE[id] || "staff";

/** Тип аккаунта на языке адресатов: сотрудник — `staff`, всё остальное — `client`. */
const accountAudienceOf = (user) =>
  user?.isEndUser === false ? "staff" : "client";

/**
 * Вырезает из набора действия чужого адресата. Роль может дать клиенту
 * «Брать заявки в работу» — у клиентского аккаунта это право не действует.
 * Порядок важен: полноту доступа (`isFullAccess`) считают ДО вырезания.
 */
const stripStatementsForAudience = (statements, accountAudience) => {
  const kept = {};
  for (const [resource, actions] of Object.entries(statements || {})) {
    const allowed = (actions || []).filter((action) => {
      const audience = audienceOfAction(`${resource}.${action}`);
      return audience === "both" || audience === accountAudience;
    });
    if (allowed.length) kept[resource] = allowed;
  }
  return kept;
};
```

In `assertCatalogueIsSound`, inside the `for (const action of group.actions || [])` loop, add:

```js
      if (!AUDIENCES.includes(action.audience || "staff")) {
        problems.push(`адресат не из списка: ${action.id}`);
      }
      if (action.clientHint && action.audience !== "both") {
        problems.push(`clientHint только у адресата both: ${action.id}`);
      }
```

Extend `module.exports` with `AUDIENCES, audienceOfAction, accountAudienceOf, stripStatementsForAudience`.

- [ ] **Step 6: Run the tests**

Run: `cd backend && node --test auth/access.test.js && pnpm test`
Expected: all PASS. (`pnpm test` must still pass — `mergeStatements` and others only read `STATEMENT`.)

- [ ] **Step 7: Checkpoint**

`node --check backend/auth/access.js`. Report changed files. Do not commit.

---

### Task 2: Resolution — strip by audience, grant set, audience-aware `permissionFilter`

**Files:**
- Modify: `backend/services/permissions.js` (`effectivePermissions`, `permissionFilter`)
- Modify: `backend/services/authContext.js` (`buildAuthContext`)
- Modify: `backend/controllers/me.js` (`getMe`)
- Modify: `backend/controllers/role.js` (`create`, `update`, `assign` pass `req.auth.canGrant`)

**Interfaces:**
- Consumes: `accountAudienceOf`, `stripStatementsForAudience` from Task 1.
- Produces: `effectivePermissions(user) → { statements, grantStatements }` where `statements` is stripped for the account and `grantStatements` is the unstripped union of the person's roles (what they may hand out); `req.auth.canGrant(request)`; `req.auth.grantStatements`; `/api/me` field `grantStatements`.

- [ ] **Step 1: Rewrite `effectivePermissions`**

```js
const {
  STATEMENT,
  isKnownAction,
  fullAccessStatements,
  accountAudienceOf,
  stripStatementsForAudience,
  audienceOfAction,
} = require("@/auth/access");

/**
 * @returns {Promise<{statements: object, grantStatements: object}>}
 *   `statements` — что человеку МОЖНО (уже без действий чужого адресата),
 *   `grantStatements` — что он вправе ВЫДАТЬ роли (полный набор его ролей:
 *   администратор-сотрудник выдаёт клиентской роли «Согласовывать отчёты»,
 *   хотя сам этим правом не действует).
 */
const effectivePermissions = async (user) => {
  const audience = accountAudienceOf(user);

  if (user?.isAdmin) {
    const full = fullAccessStatements();
    return {
      statements: stripStatementsForAudience(full, audience),
      grantStatements: full,
    };
  }

  const grantStatements = {};
  const roles = await rolesOfUser(user._id);
  if (roles.length) {
    const catalogue = await loadRoles();
    for (const role of roles) {
      mergeStatements(grantStatements, catalogue[role]);
    }
  }

  return {
    statements: stripStatementsForAudience(grantStatements, audience),
    grantStatements,
  };
};
```

- [ ] **Step 2: Make `permissionFilter` audience-aware**

In `permissionFilter`, after `const conditions = [{ isAdmin: true }];` add the account-type condition so a client whose role carries a staff right never lands in a staff picker:

```js
  const audience = audienceOfAction(actionId);
  const accountMatch =
    audience === "staff"
      ? { isEndUser: false }
      : audience === "client"
        ? { isEndUser: { $ne: false } }
        : null;
```

and change the return to:

```js
  const byRoles = { $or: conditions };
  return accountMatch ? { $and: [byRoles, accountMatch] } : byRoles;
```

- [ ] **Step 3: Expose the grant set on `req.auth`**

In `backend/services/authContext.js#buildAuthContext` replace `const { statements } = await effectivePermissions(user);` with `const { statements, grantStatements } = await effectivePermissions(user);` and add to the returned object, right after `can:`:

```js
    grantStatements,
    /** Что этот человек вправе выдать роли — до вырезания по типу аккаунта. */
    canGrant: authorizeFor(grantStatements),
```

- [ ] **Step 4: Send the grant set to the client and use it in the role controller**

In `backend/controllers/me.js#getMe` destructure `const { user, statements, grantStatements, session } = req.auth;` and add `grantStatements,` to the JSON right after `statements,`.

In `backend/controllers/role.js` replace every `req.auth.can,` argument in `create`, `update` and `assign` with `req.auth.canGrant,`.

- [ ] **Step 5: Verify**

Run: `cd backend && pnpm test && node --check services/permissions.js && node --check services/authContext.js && node --check controllers/me.js && node --check controllers/role.js`
Expected: PASS / no syntax errors.

- [ ] **Step 6: Checkpoint** — report files; no commit.

---

### Task 3: Migration map, legacy mapping, role catalogue, DB rewrite script

**Files:**
- Create: `backend/services/actionMigration.js`, `backend/services/actionMigration.test.js`
- Create: `backend/scripts/migrateActions.js`
- Modify: `backend/scripts/legacyPermissions.js` (`LEGACY_TO_ACTIONS`, `legacyToActions`)
- Modify: `backend/scripts/roles.catalogue.json`

**Interfaces:**
- Produces: `migrateActions(oldActionIds) → newActionIds` (dictionary order, deduped, unknown dropped), `flattenStatements(statements) → ["resource.action"]`.

- [ ] **Step 1: Write the failing test**

Create `backend/services/actionMigration.test.js`:

```js
// node --test services/actionMigration.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { migrateActions, flattenStatements } = require("./actionMigration");

test("renames and merges by the spec's map", () => {
  assert.deepEqual(
    migrateActions([
      "ticket.readCompany",
      "ticket.administrate",
      "ticket.update",
      "report.works",
      "settings.read",
      "settings.manageMail",
      "work.manageAll",
    ]),
    ["ticket.readCompanies", "ticket.manage", "work.read", "work.manage", "settings.manage"],
  );
});

test("read/manage splits and approval.read derive from manage rights", () => {
  assert.deepEqual(migrateActions(["routineTask.manage", "approval.manage"]), [
    "routineTask.read",
    "routineTask.manage",
    "approval.read",
    "approval.manage",
  ]);
  assert.deepEqual(migrateActions(["approval.decide"]), ["approval.read", "approval.decide"]);
});

test("cost and finances derive from the old combinations", () => {
  assert.deepEqual(migrateActions(["servicePlan.read", "report.employees"]), [
    "work.readCost",
    "report.employees",
    "servicePlan.read",
    "user.manageFinances",
  ]);
  assert.deepEqual(migrateActions(["servicePlan.read"]), ["servicePlan.read"]);
});

test("idempotent and drops unknown ids", () => {
  const once = migrateActions(["ticket.perform", "foo.bar", "ticket.readCompany"]);
  assert.deepEqual(once, ["ticket.readCompanies", "ticket.perform"]);
  assert.deepEqual(migrateActions(once), once);
});

test("flattenStatements", () => {
  assert.deepEqual(flattenStatements({ ticket: ["perform", "delete"], role: ["read"] }), [
    "ticket.perform",
    "ticket.delete",
    "role.read",
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test services/actionMigration.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `backend/services/actionMigration.js`**

```js
const { ALL_ACTIONS } = require("@/auth/access");

/**
 * Карта переезда словаря 2026-09-11 (спека
 * docs/superpowers/specs/2026-09-11-permissions-dictionary-redesign-design.md,
 * раздел «Карта переезда»). Старый id → новые id. Действия, которых в карте нет,
 * остаются как есть, если они существуют в новом словаре, и отбрасываются иначе.
 */
const RENAMES = {
  "ticket.readCompany": ["ticket.readCompanies"],
  "ticket.administrate": ["ticket.manage"],
  "ticket.update": ["ticket.manage"],
  "ticketCategory.manage": ["ticketCategory.read", "ticketCategory.manage"],
  "ticketTemplate.manage": ["ticketTemplate.read", "ticketTemplate.manage"],
  "checklistTemplate.manage": ["checklistTemplate.read", "checklistTemplate.manage"],
  "routineTask.manage": ["routineTask.read", "routineTask.manage"],
  "report.works": ["work.read"],
  "work.manageAll": ["work.manage"],
  "approval.decide": ["approval.read", "approval.decide"],
  "approval.manage": ["approval.read", "approval.manage"],
  "settings.read": ["settings.manage"],
  "settings.manageMail": ["settings.manage"],
  "settings.manageIntegrations": ["settings.manage"],
  "settings.manageSecurity": ["settings.manage"],
};

/** Права, которые раньше были СОЧЕТАНИЕМ других. Условие — по исходному набору. */
const DERIVED = [
  { when: ["servicePlan.read", "report.employees"], add: ["work.readCost"] },
  { when: ["report.employees"], add: ["user.manageFinances"] },
];

const migrateActions = (oldActions = []) => {
  const source = [...new Set(oldActions.map(String))];
  const next = new Set();
  for (const id of source) {
    for (const mapped of RENAMES[id] || [id]) next.add(mapped);
  }
  for (const rule of DERIVED) {
    if (rule.when.every((id) => source.includes(id))) {
      rule.add.forEach((id) => next.add(id));
    }
  }
  // Порядок словаря; всё неизвестное отпадает само
  return ALL_ACTIONS.filter((id) => next.has(id));
};

const flattenStatements = (statements = {}) =>
  Object.entries(statements).flatMap(([resource, actions]) =>
    (actions || []).map((action) => `${resource}.${action}`),
  );

module.exports = { RENAMES, DERIVED, migrateActions, flattenStatements };
```

- [ ] **Step 4: Run the test** — `node --test services/actionMigration.test.js` — Expected: PASS.

- [ ] **Step 5: Update the legacy mapping**

In `backend/scripts/legacyPermissions.js` replace the changed entries of `LEGACY_TO_ACTIONS`:

```js
  canAdministrateTickets: ["ticket.manage", "checklistTemplate.read", "checklistTemplate.manage"],
  canSeeAllCompanyTickets: ["ticket.readCompanies"],
  canEditTickets: ["ticket.manage"],
  canManageTicketCategories: ["ticketCategory.read", "ticketCategory.manage"],
  canManageRoutineTasks: ["routineTask.read", "routineTask.manage"],
  canManageTicketTemplates: ["ticketTemplate.read", "ticketTemplate.manage"],
  canSeeWorksReport: ["work.read"],
  canSeeGlobalFinancialReport: ["report.employees", "user.manageFinances"],
  canConfirmReportActions: ["approval.read", "approval.manage"],
  canApproveWorkReports: ["approval.read", "approval.decide"],
```

(all other entries stay). Replace `legacyToActions` with:

```js
/** Плоский набор доролевых галочек → действия нового словаря. */
const legacyToActions = (permissions = {}) => {
  const keys = PERMISSION_KEYS.filter((key) => permissions?.[key]);
  const actions = new Set(keys.flatMap((key) => LEGACY_TO_ACTIONS[key] || []));
  // Стоимость работ раньше была сочетанием двух прав
  if (keys.includes("canUseFinancesModule") && keys.includes("canSeeGlobalFinancialReport")) {
    actions.add("work.readCost");
  }
  return [...actions];
};
```

Update the comment above `LEGACY_TO_ACTIONS` that lists actions absent from the flat set: it now reads «(настройки, удалённая помощь, правка чужих работ, заявка от чужого имени, модерация базы знаний)».

- [ ] **Step 6: Rewrite `backend/scripts/roles.catalogue.json`**

Keep the `_` header array as is. Replace the `roles` array with:

```json
  "roles": [
    {
      "key": "client",
      "title": "Клиент",
      "audience": "client",
      "description": "Заявки только свои",
      "actions": [],
      "matches": [
        [],
        ["canAvoidWorks"],
        ["canUseTimeTrackingModule", "canSeeWorksReport"]
      ],
      "_note": [
        "Одинокий canAvoidWorks — ошибка раздачи, а не роль: он стоял у клиента",
        "(главный бухгалтер), который заявок не выполняет вовсе. Поглощаем",
        "подписью, право не даём.",
        "canUseTimeTrackingModule + canSeeWorksReport без заявок компании — подпись",
        "прежней роли «Учёт работ», снятой при пересборке каталога: единственная",
        "носительница — клиент, отключена и ни разу не входила. Решение 2026-09-03:",
        "обычный клиент; понадобится отчёт — роль «Клиент: руководитель» из UI."
      ]
    },
    {
      "key": "client-admin",
      "title": "Клиент: администратор",
      "audience": "client",
      "description": "Видит заявки всех сотрудников своей компании, заводит заявки за коллег, согласовывает отчёты",
      "actions": [
        "ticket.readCompanies",
        "ticket.createForOthers",
        "work.read",
        "report.companies",
        "approval.read",
        "approval.decide",
        "servicePlan.read",
        "company.read",
        "user.read",
        "device.read"
      ],
      "matches": [["canSeeAllCompanyTickets"]]
    },
    {
      "key": "client-manager",
      "title": "Клиент: руководитель",
      "audience": "client",
      "description": "Заявки компании плюс работы в архиве",
      "actions": ["ticket.readCompanies", "work.read"],
      "matches": [["canSeeAllCompanyTickets", "canUseTimeTrackingModule", "canSeeWorksReport"]]
    },
    {
      "key": "admin",
      "title": "Администратор",
      "audience": "staff",
      "description": "Полный доступ ко всему порталу. Набор ОБЯЗАН содержать весь словарь: по признаку «роль отдаёт всё» зеркалится user.isAdmin (auth/access.js#isFullAccess), и роль без одного действия гасила бы зеркало",
      "actions": [
        "ticket.readCompanies", "ticket.readAll", "ticket.perform", "ticket.manage", "ticket.delete", "ticket.createForOthers", "ticket.closeWithoutWork",
        "ticketCategory.read", "ticketCategory.manage", "ticketTemplate.read", "ticketTemplate.manage", "checklistTemplate.read", "checklistTemplate.manage",
        "routineTask.read", "routineTask.manage",
        "work.read", "work.log", "work.manage", "work.readCost",
        "report.companies", "report.employees", "report.own",
        "approval.read", "approval.decide", "approval.manage",
        "servicePlan.read", "servicePlan.manage",
        "company.read", "company.manage", "company.readLogs",
        "user.read", "user.manage", "user.manageFinances", "user.manageAccess", "user.impersonate",
        "role.read", "role.manage",
        "schedule.read", "schedule.manage", "schedule.approve",
        "knowledge.read", "knowledge.manage", "knowledge.moderate",
        "device.read", "device.manage", "inventoryCatalog.read", "inventoryCatalog.manage", "supplier.read", "supplier.manage", "mikrotik.read", "mikrotik.manage", "mikrotik.manageConfigs",
        "remoteSupport.use",
        "settings.manage"
      ],
      "members": ["a.savin@f1lab.ru", "a.shvetsov@f1lab.ru", "s.odzyal@f1lab.ru", "y.em@f1lab.ru"]
    },
    {
      "key": "it-first-line",
      "title": "ИТ-Специалист: первая линия",
      "audience": "staff",
      "description": "Заявки, учёт времени, техника клиентов",
      "actions": [
        "ticket.perform", "ticket.createForOthers",
        "work.read", "work.log", "report.own",
        "company.read", "company.readLogs", "user.read", "schedule.read",
        "knowledge.read", "knowledge.manage",
        "device.read", "device.manage", "inventoryCatalog.read", "inventoryCatalog.manage", "supplier.read", "mikrotik.read",
        "remoteSupport.use"
      ],
      "members": ["i.chernov@f1lab.ru", "m.guryanov@f1lab.ru", "t.zhuravskaya@f1lab.ru", "v.yushin@f1lab.ru"]
    },
    {
      "key": "contractor-no-works",
      "title": "Сторонний исполнитель: без указания работ",
      "audience": "staff",
      "description": "Инженер, которому можно закрыть заявку без записи о работе",
      "actions": ["ticket.perform", "ticket.closeWithoutWork", "company.read", "user.read"],
      "members": ["crm@anlex.ru", "kirpichev@dvregion.ru"]
    },
    {
      "key": "it-second-line",
      "title": "ИТ-Специалист: вторая линия",
      "audience": "staff",
      "description": "Инженер плюс все заявки, база знаний, регламенты и конфигурации Mikrotik",
      "actions": [
        "ticket.readAll", "ticket.perform", "ticket.createForOthers",
        "ticketTemplate.read", "ticketTemplate.manage", "checklistTemplate.read", "checklistTemplate.manage",
        "routineTask.read", "routineTask.manage",
        "work.read", "work.log", "report.own",
        "company.read", "company.readLogs", "user.read", "schedule.read",
        "knowledge.read", "knowledge.manage",
        "device.read", "device.manage", "inventoryCatalog.read", "inventoryCatalog.manage", "supplier.read", "mikrotik.read", "mikrotik.manage", "mikrotik.manageConfigs",
        "remoteSupport.use"
      ],
      "members": ["a.echin@f1lab.ru", "i.karpachev@f1lab.ru"]
    },
    {
      "key": "kb-moderator",
      "title": "Модератор базы знаний",
      "audience": "staff",
      "description": "Одобряет заметки и разбирает очереди модерации базы знаний",
      "actions": ["knowledge.read", "knowledge.moderate"],
      "members": [],
      "_note": [
        "members заполнить из вывода scripts/migrateActions.js: он печатает почты",
        "людей из прежнего списка модераторов в настройках (preferences.knowledgeBase.moderators)."
      ]
    }
  ]
```

Reformat the arrays one id per line to match the file's existing style (run `node -e 'const f=require("./scripts/roles.catalogue.json");require("fs").writeFileSync("scripts/roles.catalogue.json", JSON.stringify(f,null,2)+"\n")'` from `backend/`).

- [ ] **Step 7: Write `backend/scripts/migrateActions.js`**

```js
// Переезд действий словаря (спека 2026-09-11) в живых ролях:
//   • переписывает `organizationRole.permission` по карте
//     services/actionMigration.js — идемпотентно;
//   • у клиентских ролей снимает действия адресата staff;
//   • носителям прежнего списка модераторов базы знаний
//     (preferences.knowledgeBase.moderators) дописывает роль `kb-moderator`,
//     если она уже есть в каталоге (syncRoleCatalogue.js --apply идёт ПЕРВЫМ).
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateActions.js            # показать
//   node scripts/migrateActions.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { organizationId, invalidateRoles } = require("@/services/permissions");
const { migrateActions, flattenStatements } = require("@/services/actionMigration");
const { actionsToStatements, stripStatementsForAudience } = require("@/auth/access");

const KB_ROLE = "kb-moderator";

const splitRoles = (value) =>
  String(value || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) throw new Error("Организации нет — переезжать нечему");

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
    const before = flattenStatements(stored);
    let statements = actionsToStatements(migrateActions(before));
    if (row.audience === "client") {
      statements = stripStatementsForAudience(statements, "client");
    }
    const after = flattenStatements(statements);
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    if (!added.length && !removed.length) continue;
    changes.push({ row, permission: JSON.stringify(statements) });
    console.log(`  ${row.role} «${row.title}»: +${added.join(", ") || "—"} | −${removed.join(", ") || "—"}`);
  }

  // Модераторы базы знаний из настроек → роль kb-moderator
  const prefs = await db.collection("preferences").findOne({}, { projection: { "knowledgeBase.moderators": 1 } });
  const moderatorIds = (prefs?.knowledgeBase?.moderators || [])
    .map((entry) => (entry?._id ? String(entry._id) : null))
    .filter(Boolean);
  const kbRoleExists = rows.some((row) => row.role === KB_ROLE);
  const memberships = [];
  if (moderatorIds.length) {
    const users = await db
      .collection("users")
      .find({ _id: { $in: moderatorIds.map((id) => new mongoose.Types.ObjectId(id)) } }, { projection: { email: 1 } })
      .toArray();
    console.log(`\nМодераторы из настроек (${users.length}): ${users.map((user) => user.email).join(", ")}`);
    if (!kbRoleExists) {
      console.log(`Роли ${KB_ROLE} в каталоге нет — сначала node scripts/syncRoleCatalogue.js --apply`);
    } else {
      const members = await db
        .collection("member")
        .find({ organizationId: orgId, userId: { $in: moderatorIds } }, { projection: { userId: 1, role: 1 } })
        .toArray();
      for (const member of members) {
        const roles = splitRoles(member.role);
        if (roles.includes(KB_ROLE)) continue;
        memberships.push({ _id: member._id, role: [...roles, KB_ROLE].join(",") });
      }
      console.log(`Членств к дописи: ${memberships.length}`);
    }
  }

  if (!apply) {
    console.log(changes.length || memberships.length ? "\nПоказ без записи. Повторите с --apply." : "\nМенять нечего.");
    await mongoose.disconnect();
    return;
  }

  for (const { row, permission } of changes) {
    await db.collection("organizationRole").updateOne({ _id: row._id }, { $set: { permission, updatedAt: new Date() } });
  }
  for (const { _id, role } of memberships) {
    await db.collection("member").updateOne({ _id }, { $set: { role } });
  }
  invalidateRoles();
  console.log(`\nРолей переписано: ${changes.length}. Членств дописано: ${memberships.length}.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 8: Static checks**

Run: `cd backend && pnpm test && node --check scripts/migrateActions.js && node --check scripts/legacyPermissions.js && node -e 'JSON.parse(require("fs").readFileSync("scripts/roles.catalogue.json","utf8")); console.log("json ok")'`
Expected: PASS, `json ok`.

- [ ] **Step 9: Run against the dev database (sandbox off)**

The dev backend runs with nodemon and picks up Tasks 1–3 automatically. Then:

```bash
docker exec hd-backend-1 node scripts/syncRoleCatalogue.js          # dry run: 8 roles, kb-moderator new
docker exec hd-backend-1 node scripts/syncRoleCatalogue.js --apply
docker exec hd-backend-1 node scripts/migrateActions.js             # dry run: client-manager −work.log, moderators listed
docker exec hd-backend-1 node scripts/migrateActions.js --apply
docker exec hd-backend-1 node scripts/dumpRoleCatalogue.js          # dry run: must show no action diffs
```

Copy the moderator e-mails printed by `migrateActions.js` into `kb-moderator.members` in `roles.catalogue.json`. If `dumpRoleCatalogue.js` shows differences other than `members` of `kb-moderator`, stop and report them.

- [ ] **Step 10: Checkpoint** — report files and the script output summary; no commit.

---

### Task 4: Gates named after the dictionary

**Files:**
- Modify: `backend/middleware/permissions.js` (the «Гейты словаря» section)

**Interfaces:**
- Produces new exports: `canManageTickets`, `canReadTicketCategories`, `canReadTicketTemplates`, `canReadChecklistTemplates`, `canReadRoutineTasks`, `canManageWorks`, `canReadApproval`, `canModerateKnowledge`. Existing exports keep working until Task 18 removes the eight legacy names.

- [ ] **Step 1: Add the gates**

In the `// --- заявки ---` block add after `canPerformTickets`:

```js
module.exports.canManageTickets = requirePermission(
  { ticket: ["manage"] },
  "У пользователя отсутствует разрешение вести заявки",
);
```

In `// --- заготовки заявок ---` (rename the comment to `// --- справочники заявок и регламенты ---`) add:

```js
module.exports.canReadTicketCategories = requirePermission({ ticketCategory: ["read"] }, PAGE);
module.exports.canReadTicketTemplates = requirePermission({ ticketTemplate: ["read"] }, PAGE);
module.exports.canReadChecklistTemplates = requirePermission({ checklistTemplate: ["read"] }, PAGE);
module.exports.canReadRoutineTasks = requirePermission({ routineTask: ["read"] }, PAGE);
```

In `// --- работы и отчёты ---` add:

```js
module.exports.canManageWorks = requirePermission(
  { work: ["manage"] },
  "Недостаточно прав для правки чужих работ",
);
```

In `// --- согласование работ ---` add:

```js
module.exports.canReadApproval = requirePermission({ approval: ["read"] }, PAGE);
```

In `// --- графики и база знаний ---` add:

```js
module.exports.canModerateKnowledge = requirePermission(
  { knowledge: ["moderate"] },
  "Недостаточно прав для модерации базы знаний",
);
```

- [ ] **Step 2: Verify** — `node --check backend/middleware/permissions.js`; `cd backend && pnpm test`.

- [ ] **Step 3: Checkpoint** — report; no commit.

---

### Task 5: Ticket scope service and per-ticket access

**Files:**
- Create: `backend/services/ticketScope.js`, `backend/services/ticketScope.test.js`
- Modify: `backend/services/ticketAccess.js` (`canAccessTicket`, add `canEditChecklist`, `isResponsible`)
- Create: `backend/services/ticketAccess.test.js`

**Interfaces:**
- Produces: `ticketTier(auth) → "all"|"companies"|"own"`, `scopeCompanyIds(auth) → string[]`, `ticketListFilter(auth) → MongoFilter`, `ticketInScope(ticket, auth) → boolean`; `canAccessTicket(ticket, auth)`, `isResponsible(ticket, userId)`, `canEditChecklist(ticket, auth)`.
- `auth` shape (from `buildAuthContext`): `{ userId, user, legacy, can, isAdmin, isEndUser }`. `legacy` is the plain user object (`toObject()`), read `responsibleForCompanies[].id` there — on a Mongoose document the virtual `id` shadows the stored field.

- [ ] **Step 1: Write the failing tests**

Create `backend/services/ticketScope.test.js`:

```js
// node --test services/ticketScope.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { ticketTier, scopeCompanyIds, ticketListFilter, ticketInScope } = require("./ticketScope");

const oid = () => new mongoose.Types.ObjectId();

// Минимальный `can` в духе словаря: действия внутри ресурса — И, connector OR — ИЛИ
const canOf = (statements) => (request) =>
  Object.entries(request).every(([resource, wanted]) => {
    const granted = statements[resource] || [];
    const actions = Array.isArray(wanted) ? wanted : wanted.actions;
    const connector = Array.isArray(wanted) ? "AND" : wanted.connector || "AND";
    return connector === "OR"
      ? actions.some((a) => granted.includes(a))
      : actions.every((a) => granted.includes(a));
  });

const me = oid();
const myCompany = oid();
const c1 = oid();
const c2 = oid();

const authOf = ({ statements = {}, isEndUser = false, isAdmin = false, responsible = [] } = {}) => ({
  userId: String(me),
  isAdmin,
  isEndUser,
  can: canOf(statements),
  legacy: {
    _id: me,
    isEndUser,
    company: { _id: myCompany, alias: "Моя" },
    responsibleForCompanies: responsible.map((id) => ({ id, alias: "x" })),
  },
});

test("tiers", () => {
  assert.equal(ticketTier(authOf({ isAdmin: true })), "all");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["readAll"] } })), "all");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["readCompanies"] } })), "companies");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["perform"] } })), "own");
});

test("scope companies: staff — responsible ones, client — own", () => {
  assert.deepEqual(scopeCompanyIds(authOf({ responsible: [c1, c2] })), [String(c1), String(c2)]);
  assert.deepEqual(scopeCompanyIds(authOf({ isEndUser: true, responsible: [c1] })), [String(myCompany)]);
});

test("list filter per tier", () => {
  assert.deepEqual(ticketListFilter(authOf({ statements: { ticket: ["readAll"] } })), {});

  const own = ticketListFilter(authOf({}));
  assert.deepEqual(Object.keys(own), ["$or"]);
  assert.equal(own.$or.length, 3);

  const companies = ticketListFilter(authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c1] }));
  assert.equal(companies.$or.length, 4);
  assert.deepEqual(companies.$or[0], { "company._id": { $in: [c1] } });
});

test("ticketInScope mirrors the filter", () => {
  const ticket = { company: { _id: c1 }, responsibles: [], createdBy: oid(), applicantId: oid() };
  assert.equal(ticketInScope(ticket, authOf({})), false);
  assert.equal(ticketInScope(ticket, authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c1] })), true);
  assert.equal(ticketInScope(ticket, authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c2] })), false);
  assert.equal(ticketInScope({ ...ticket, responsibles: [{ _id: me }] }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, createdBy: me }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, applicantId: me }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, company: { _id: myCompany } }, authOf({ isEndUser: true, statements: { ticket: ["readCompanies"] } })), true);
  assert.equal(ticketInScope(ticket, authOf({ isAdmin: true })), true);
});
```

Create `backend/services/ticketAccess.test.js`:

```js
// node --test services/ticketAccess.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { canEditChecklist, isResponsible } = require("./ticketAccess");

const me = new mongoose.Types.ObjectId();
const canOf = (granted) => (request) =>
  Object.entries(request).every(([resource, actions]) =>
    (Array.isArray(actions) ? actions : actions.actions).every((a) => (granted[resource] || []).includes(a)),
  );
const auth = (granted, extra = {}) => ({ userId: String(me), isAdmin: false, can: canOf(granted), ...extra });

test("isResponsible compares ids as strings", () => {
  assert.equal(isResponsible({ responsibles: [{ _id: me }] }, String(me)), true);
  assert.equal(isResponsible({ responsibles: [] }, String(me)), false);
});

test("manage edits any checklist, routine ones included", () => {
  const routine = { responsibles: [], routineTask: new mongoose.Types.ObjectId() };
  assert.equal(canEditChecklist(routine, auth({ ticket: ["manage"] })), true);
  assert.equal(canEditChecklist(routine, auth({}, { isAdmin: true })), true);
});

test("perform edits the checklist only on own, non-routine tickets", () => {
  const mine = { responsibles: [{ _id: me }], routineTask: null };
  assert.equal(canEditChecklist(mine, auth({ ticket: ["perform"] })), true);
  assert.equal(canEditChecklist({ ...mine, routineTask: new mongoose.Types.ObjectId() }, auth({ ticket: ["perform"] })), false);
  assert.equal(canEditChecklist({ responsibles: [], routineTask: null }, auth({ ticket: ["perform"] })), false);
  assert.equal(canEditChecklist(mine, auth({})), false);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd backend && node --test services/ticketScope.test.js services/ticketAccess.test.js` — Expected: FAIL (module / export missing).

- [ ] **Step 3: Implement `backend/services/ticketScope.js`**

```js
const mongoose = require("mongoose");

/**
 * Скоуп заявок — три яруса (спека 2026-09-11, «Заявки»):
 *   own       — инициатор, автор или ответственный;
 *   companies — плюс все заявки компаний скоупа: сотруднику — где он в
 *               ответственных компании (`responsibleForCompanies`), клиенту —
 *               своей компании;
 *   all       — всё (`ticket.readAll` или администратор).
 * Одна функция на список и на карточку: раньше правило жило в четырёх
 * контроллерах и в мидлвари и расходилось.
 */

const idOf = (value) => (value ? String(value._id ?? value.id ?? value) : null);

/** Плоский пользователь: на документе Mongoose виртуальный `id` затеняет поле `id` подсхемы. */
const plainUser = (auth) =>
  auth.legacy ?? (auth.user?.toObject ? auth.user.toObject() : auth.user) ?? {};

const ticketTier = (auth) => {
  if (auth.isAdmin || auth.can({ ticket: ["readAll"] })) return "all";
  if (auth.can({ ticket: ["readCompanies"] })) return "companies";
  return "own";
};

const scopeCompanyIds = (auth) => {
  const user = plainUser(auth);
  if (auth.isEndUser) return [idOf(user.company?._id)].filter(Boolean);
  return [
    ...new Set(
      (user.responsibleForCompanies || [])
        .map((company) => idOf(company?.id ?? company?._id))
        .filter(Boolean),
    ),
  ];
};

const ownConditions = (auth) => {
  const userId = new mongoose.Types.ObjectId(String(auth.userId));
  return [{ "responsibles._id": userId }, { createdBy: userId }, { applicantId: userId }];
};

/** Фрагмент фильтра Mongo для `Ticket.find`; `{}` — без ограничений. */
const ticketListFilter = (auth) => {
  const tier = ticketTier(auth);
  if (tier === "all") return {};
  if (tier === "companies") {
    const ids = scopeCompanyIds(auth).map((id) => new mongoose.Types.ObjectId(id));
    return { $or: [{ "company._id": { $in: ids } }, ...ownConditions(auth)] };
  }
  return { $or: ownConditions(auth) };
};

/** То же правило для уже загруженной заявки (карточка, комментарии, работы). */
const ticketInScope = (ticket, auth) => {
  if (!ticket || !auth) return false;
  const tier = ticketTier(auth);
  if (tier === "all") return true;

  const userId = String(auth.userId);
  const isOwn =
    (ticket.responsibles || []).some((resp) => idOf(resp) === userId) ||
    idOf(ticket.createdBy) === userId ||
    idOf(ticket.applicantId) === userId ||
    idOf(ticket.applicant?._id) === userId;
  if (isOwn) return true;

  return tier === "companies" && scopeCompanyIds(auth).includes(idOf(ticket.company?._id));
};

module.exports = { ticketTier, scopeCompanyIds, ticketListFilter, ticketInScope };
```

- [ ] **Step 4: Rewire `backend/services/ticketAccess.js`**

Replace the `canAccessTicket` function (from `const canAccessTicket = (ticket, auth) => {` through its closing `};`) with:

```js
const { ticketInScope } = require("@/services/ticketScope");

const isResponsible = (ticket, userId) =>
  (ticket?.responsibles || []).some((resp) => String(resp?._id ?? resp) === String(userId));

/** Правило одно на список и карточку — `services/ticketScope`. */
const canAccessTicket = (ticket, auth) => {
  if (!ticket || !auth?.userId) return false;
  return Boolean(auth.isAdmin) || ticketInScope(ticket, auth);
};

/**
 * Состав чек-листа (не отметки): «Вести заявки» — на любой заявке, исполнитель
 * с «Брать в работу» — на своей, если заявка не из регламента: регламентный
 * чек-лист принадлежит регламенту, а не заявке.
 */
const canEditChecklist = (ticket, auth) => {
  if (!ticket || !auth) return false;
  if (auth.isAdmin || auth.can({ ticket: ["manage"] })) return true;
  return (
    auth.can({ ticket: ["perform"] }) &&
    isResponsible(ticket, auth.userId) &&
    !ticket.routineTask
  );
};
```

Put the `require` at the top of the file with the other requires. Update the doc comment above (the list of admissions now reads «ответственный ИЛИ автор ИЛИ заявитель ИЛИ компания из скоупа (`ticketScope`)»). Extend `module.exports` to `{ canAccessTicket, canEditChecklist, isResponsible, loadAccessibleTicket, assertTicketsAccessible }`.

- [ ] **Step 5: Run the tests** — `cd backend && pnpm test` — Expected: PASS.

- [ ] **Step 6: Checkpoint** — report; no commit.

---

### Task 6: Ticket routes and controller — gates, scope, checklist, attachments, creation for others

**Files:**
- Modify: `backend/routes/internal/ticket.js`
- Modify: `backend/controllers/ticket.js` (`getAllOpened`, `getUsersTickets`, `getClosed`, `getFormData`, `add`, `updateChecklist`, `getAllOpenedTg`)
- Modify: `backend/middleware/notifications.js:946` (managers)

**Interfaces:**
- Consumes: `canManageTickets` (Task 4), `requireTicketAccess`, `ticketListFilter`, `canEditChecklist` (Task 5).

- [ ] **Step 1: Route gates**

Rewrite the imports and the mutation routes in `backend/routes/internal/ticket.js`:

```js
const {
  allowedToViewTicket,
  requireTicketAccess,
  requireTicketsAccess,
  canDeleteTickets,
  canPerformTickets,
  canManageTickets,
  canManageKnowledge,
  canReadKnowledge,
  knowledgeBaseModuleIsActive,
} = require("@/middleware/permissions");

const byBodyId = requireTicketAccess((req) => ({ id: req.body._id }));
const byNum = requireTicketAccess((req) => ({ num: req.params.ticketNum }));
const byBodyIds = requireTicketsAccess((req) => req.body.ids);
```

Then the routes (replace the existing declarations one by one; GET routes stay as they are):

```js
router.post("/tickets/add", isAuth, fileUpload.array("attachments"), ticketController.add);
// Вложения самой заявки — содержание заявки: только «Вести заявки».
// Исполнитель и клиент прикладывают файлы через комментарии.
router.post("/tickets/:ticketNum/add-attachments", isAuth, canManageTickets, byNum, fileUpload.array("attachments"), ticketController.addAttachments);
router.post("/tickets/:ticketNum/remove-attachment", isAuth, canManageTickets, byNum, ticketController.removeAttachment);
router.post("/tickets/update", isAuth, canManageTickets, byBodyId, fileUpload.array("attachments"), ticketController.update);
router.post("/tickets/process", isAuth, canManageTickets, byBodyId, ticketController.process);
router.post("/tickets/take-to-work", isAuth, canPerformTickets, byBodyId, ticketController.takeToWork);
router.post("/tickets/request-help", isAuth, canPerformTickets, byBodyId, ticketController.requestHelp);
router.post("/tickets/join-responsibles", isAuth, canPerformTickets, byBodyId, ticketController.joinResponsibles);
router.post("/tickets/update-deadline", isAuth, canPerformTickets, byBodyId, ticketController.updateDeadline);
router.post("/tickets/reject", isAuth, canPerformTickets, byBodyId, ticketController.reject);
router.post("/tickets/close", isAuth, canPerformTickets, byBodyId, ticketController.close);
router.post("/tickets/back-to-work", isAuth, canPerformTickets, byBodyId, ticketController.backToWork);
router.post("/tickets/ai-guide/generate", isAuth, canPerformTickets, byBodyId, ticketController.regenerateAiGuide);
router.post("/tickets/ai-terms/analyze", isAuth, canPerformTickets, byBodyId, ticketController.analyzeAiTerms);
router.post("/tickets/ai-terms/reference", isAuth, canPerformTickets, byBodyId, ticketController.getAiTermReference);
router.post("/tickets/ai-terms/save-note", isAuth, canPerformTickets, byBodyId, knowledgeBaseModuleIsActive, canReadKnowledge, canManageKnowledge, ticketController.saveAiTermNote);
router.post("/tickets/ai-feedback", isAuth, canPerformTickets, byBodyId, ticketController.addAiFeedback);
router.post("/tickets/:ticketNum/attachments/speech-to-text", isAuth, canPerformTickets, byNum, ticketController.transcribeAttachment);
router.post("/tickets/delete/:id", isAuth, canDeleteTickets, requireTicketAccess((req) => ({ id: req.params.id })), ticketController.delete);
router.post("/tickets/delete-multiple", isAuth, canDeleteTickets, byBodyIds, ticketController.deleteMultiple);
router.post("/tickets/take-to-work-multiple", isAuth, canPerformTickets, byBodyIds, ticketController.takeToWorkMultiple);
router.post("/tickets/close-multiple", isAuth, canPerformTickets, byBodyIds, ticketController.closeMultiple);
// Состав чек-листа: право решает контроллер (canEditChecklist) — оно зависит
// от отношения к заявке и от того, регламентная ли она
router.post("/tickets/:ticketNum/update-checklist", isAuth, byNum, ticketController.updateChecklist);
router.post("/tickets/:ticketNum/update-checklist-item", isAuth, canPerformTickets, byNum, ticketController.updateChecklistItem);
```

Before wiring `byBodyId` on the AI routes, open each of `regenerateAiGuide`, `analyzeAiTerms`, `getAiTermReference`, `addAiFeedback` in the controller and confirm the body key is `_id`; if a handler reads `ticketId` or `ticketNum` instead, build its locator accordingly (`requireTicketAccess((req) => ({ id: req.body.ticketId }))` / `({ num: req.body.ticketNum })`). Same check for `requestHelp`, `joinResponsibles`, `updateDeadline`, `reject`, `close` (they read `req.body._id` today — verify).

- [ ] **Step 2: List scope in the controller**

In `backend/controllers/ticket.js` add near the other requires: `const { ticketListFilter } = require("@/services/ticketScope");`.

`getAllOpened`: change `Ticket.find({ isClosed: false })` to `Ticket.find({ isClosed: false, ...ticketListFilter(req.auth) })`; delete the whole `let filteredTickets = []; if (…administrate/readAll…) … else { … }` block and replace every later `filteredTickets` with `allTickets`. Remove the now-unused `company`/`userId` destructuring if nothing else reads them.

`getUsersTickets`: replace the `if (req.auth.can({ ticket: { actions: ["administrate", "readAll"], connector: "OR" } })) {…} else {…}` block with:

```js
    tickets = await Ticket.find({
      $and: [{ "applicant._id": req.params.id }, ticketListFilter(req.auth)],
    }).sort({ lastName: 1 });
```

`getClosed`: replace the scope block (the `if (req.auth.can({… administrate/readAll …})) {} else if (readCompany) {…} else { and.push({ $or: […] }) }`) with:

```js
    // Скоуп прав — те же три яруса, что у списка открытых (services/ticketScope)
    const scope = ticketListFilter(req.auth);
    if (scope.$or) and.push(scope);
```

`getAllOpenedTg`: the actor is `actor`; change `Ticket.find({ isClosed: false })` to `Ticket.find({ isClosed: false, ...ticketListFilter(actor) })`, delete the `if (actor.can(…)) … else if … else { tickets = await Ticket.find(…) }` block and use `allTickets` where `tickets` was used.

- [ ] **Step 3: Checklist rule**

In `updateChecklist`, right after the `if (!ticket) { … 404 }` guard add:

```js
    if (!canEditChecklist(ticket, req.auth)) {
      return next(new AppError("Чек-лист этой заявки вам менять нельзя", 403));
    }
```

and add `canEditChecklist` to the `require("@/services/ticketAccess")` import at the top of the controller (the file already imports from it — check with `grep -n ticketAccess backend/controllers/ticket.js`; if not, add `const { canEditChecklist } = require("@/services/ticketAccess");`).

- [ ] **Step 4: Creation for others**

In `add`, replace the block from `const onBehalfOfOthers = …` through the `await assertResponsiblesMayPerform(responsibles);` line (the `ticketCompany` and `responsibles` assignments live a few lines lower — move them here) with:

```js
    /**
     * Заявку за другого заводит только тот, кому это разрешено. Сотрудник —
     * за любого инициатора любой компании и с ответственными; клиент — только
     * за коллегу своей компании: компания всегда его, ответственных он не
     * указывает. Раньше клиент с этим правом мог прислать чужую компанию телом
     * запроса.
     */
    const isClient = req.auth.isEndUser;
    const onBehalfOfOthers = req.auth.can({ ticket: ["createForOthers"] });

    let applicant = userId;
    if (onBehalfOfOthers && req.body.applicantId && String(req.body.applicantId) !== String(userId)) {
      const chosen = await User.findById(req.body.applicantId)
        .select("_id company isServiceAccount banned")
        .lean();
      if (!chosen || chosen.isServiceAccount) {
        throw new AppError("Инициатор не найден", 404);
      }
      if (isClient && String(chosen.company?._id) !== String(company?._id)) {
        throw new AppError("Инициатором может быть только сотрудник вашей компании", 403);
      }
      applicant = String(chosen._id);
    }

    const ticketCompany =
      !isClient && onBehalfOfOthers && req.body.company
        ? JSON.parse(req.body.company)
        : userCompany;

    const responsibles =
      !isClient && onBehalfOfOthers ? JSON.parse(req.body.responsibles || "[]") : [];
    await assertResponsiblesMayPerform(responsibles);
```

Delete the original `const ticketCompany = onBehalfOfOthers && req.body.company ? … : userCompany;` and `const responsibles = onBehalfOfOthers ? … : [];` / `await assertResponsiblesMayPerform(responsibles);` lines lower down so each is defined once. `User` is already required in this controller (used by `assertResponsiblesMayPerform`).

In `getFormData`, in the `if (authedUser.isEndUser)` branch, replace `req.auth.can({ ticket: ["readCompany"] })` with `req.auth.can({ ticket: ["createForOthers"] })` (the applicants list for a client exists to pick a colleague).

- [ ] **Step 5: Managers' notifications**

In `backend/middleware/notifications.js:946` replace `permissionFilter("ticket.administrate")` with `permissionFilter("ticket.manage")`.

- [ ] **Step 6: Verify**

Run: `cd backend && node --check routes/internal/ticket.js && node --check controllers/ticket.js && node --check middleware/notifications.js && pnpm test`. Then a smoke request against dev with a session cookie is optional; at minimum start the container logs (`docker logs --tail 50 hd-backend-1`) and confirm the app booted without a thrown error.

- [ ] **Step 7: Checkpoint** — report; no commit.

---

### Task 7: The `administrate` side effects move to their own rights

**Files:**
- Modify: `backend/controllers/user.js` (`getAll` ~L228, `getScopeCompanies` ~L487)
- Modify: `backend/controllers/company.js` (`getAll` ~L61-70, `getOne` after the 404 guard)
- Modify: `backend/controllers/ticketCategory.js` (`getAll`)
- Modify: `backend/controllers/formData.js` (`getCompanies`)
- Modify: `backend/controllers/work.js` (`getAllScheduled`)

- [ ] **Step 1: Users list — staff see everyone, clients see colleagues**

In `user.js#getAll` replace the `canSeeAll` / `scopedCompanyIds` definitions with:

```js
    // Скоуп по типу аккаунта: сотрудник видит всех, клиент — свою компанию.
    // Ответственность за компанию список людей больше не сужает (спека 2026-09-11).
    const canSeeAll = !req.auth.isEndUser;
    const scopedCompanyIds = canSeeAll
      ? null
      : [authedUser.company?._id].filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
```

Keep the rest of the function (it already handles `scopedCompanyIds` null vs list).

In `getScopeCompanies` replace the `canSeeAll` block with:

```js
    let companies;
    if (!req.auth.isEndUser) {
      companies = await Company.find({}, "_id alias").sort({ alias: 1 }).lean();
    } else {
      companies = authedUser.company?._id
        ? [{ _id: authedUser.company._id, alias: authedUser.company.alias }]
        : [];
    }
```

- [ ] **Step 2: Companies — staff all, client own**

In `company.js#getAll` replace the `filteredCompanies` filter with:

```js
    // Сотрудник видит все компании; клиент — только свою (спека 2026-09-11)
    const filteredCompanies = authedUser.isEndUser
      ? allCompanies.filter((company) => String(company._id) === String(authedUser.company?._id))
      : allCompanies;
```

In `company.js#getOne`, right after `if (!company) { … 404 }` add:

```js
    if (authedUser.isEndUser && String(company._id) !== String(authedUser.company?._id)) {
      return next(new AppError("Компания вам недоступна", 403));
    }
```

- [ ] **Step 3: Categories — full list, no subscription filter**

In `ticketCategory.js#getAll` replace the body up to the response with:

```js
    // Список категорий — справочник для форм заявки, регламента и услуги:
    // его видит любой сотрудник, фильтра «мои категории» больше нет
    const categories = await TicketCategory.find({}).sort({ title: 1 });
    res.status(200).json(categories);
```

Remove now-unused `authedUser`/`concatIdsArray` imports if they are no longer referenced (`grep -n concatIdsArray backend/controllers/ticketCategory.js`).

- [ ] **Step 4: Form-data companies — fix the inverted branch**

In `formData.js#getCompanies` replace the three-way `if` with:

```js
    const companies = authedUser.isEndUser
      ? await Company.find({ _id: authedUser.company?._id }).sort({ alias: 1 })
      : await Company.find({}).sort({ alias: 1 });
```

- [ ] **Step 5: Scheduled works follow the ticket scope**

In `work.js#getAllScheduled` replace the `let filteredWorks = []; if (readAll) … else if (readCompany) … else {…}` block with:

```js
    const { ticketTier, ticketListFilter } = require("@/services/ticketScope");
    let filteredWorks = scheduledWorks;
    if (ticketTier(req.auth) !== "all") {
      const ticketIds = [...new Set(scheduledWorks.flatMap((work) => work.tickets.map(String)))];
      const visible = new Set(
        (
          await Ticket.find({ _id: { $in: ticketIds }, ...ticketListFilter(req.auth) })
            .select("_id")
            .lean()
        ).map((ticket) => String(ticket._id)),
      );
      filteredWorks = scheduledWorks.filter((work) => work.tickets.some((id) => visible.has(String(id))));
    }
```

Move the `require` to the top of the file with the other requires. Remove the now-unused `const { userId, company } = req.auth.legacy;` line.

- [ ] **Step 6: Verify** — `node --check` on the five files; `cd backend && pnpm test`.

- [ ] **Step 7: Checkpoint** — report; no commit.

---

### Task 8: Frontend tickets — `manage` replaces `administrate`/`update`, checklist rule, scope-aware facets

**Files:**
- Modify: `frontend/src/components/Ticket/ticket-actions.js`
- Create: `frontend/src/components/Ticket/ticket-actions.test.js`
- Modify: `frontend/src/pages/Ticket/View.jsx` (L288, L525, L550, L599)
- Modify: `frontend/src/components/Ticket/View/AiGuideSection.jsx` (L91, L113)
- Modify: `frontend/src/components/Ticket/View/AttachmentStrip.jsx` (L60-61)
- Modify: `frontend/src/components/Ticket/View/Sections.jsx` (L394-395)
- Modify: `frontend/src/components/Ticket/TicketFormRoute.jsx` (L125)
- Modify: `frontend/src/components/Ticket/Filter.jsx` (L60-61), `frontend/src/pages/Ticket/List.jsx` (L54-55, L352), `frontend/src/components/Dashboard/StaffTickets.jsx` (L78-79), `frontend/src/components/Dashboard/MyTicketsClient.jsx` (L57), `frontend/src/pages/Dashboard.jsx` (L86)
- Modify: `frontend/src/components/app/entity-permissions.ts` (L32)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Ticket/ticket-actions.test.js`:

```js
// node --test src/components/Ticket/ticket-actions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { ticketActions } from "./ticket-actions.js";

const canOf = (granted) => (request) =>
  Object.entries(request).every(([resource, actions]) =>
    (Array.isArray(actions) ? actions : actions.actions).every((a) => (granted[resource] || []).includes(a)),
  );

const me = "u1";
const ctx = (granted, extra = {}) => ({ userId: me, can: canOf(granted), isAdmin: false, isEndUser: false, ...extra });
const keys = (list) => list.map((item) => item.key);

test("new ticket: «Обработать» needs manage", () => {
  const ticket = { state: "Новая", responsibles: [] };
  assert.equal(ticketActions(ticket, ctx({ ticket: ["perform"] })).primary, null);
  assert.equal(ticketActions(ticket, ctx({ ticket: ["manage"] })).primary?.key, "process");
});

test("«Изменить» needs manage, «Удалить» needs delete", () => {
  const ticket = { state: "В работе", responsibles: [{ _id: me }] };
  assert.ok(!keys(ticketActions(ticket, ctx({ ticket: ["perform"] })).menu).includes("update"));
  assert.ok(keys(ticketActions(ticket, ctx({ ticket: ["manage"] })).menu).includes("update"));
  assert.ok(keys(ticketActions(ticket, ctx({ ticket: ["delete"] })).menu).includes("delete"));
});

test("«Составить чек-лист»: performer on own non-routine ticket, or manage", () => {
  const mine = { state: "В работе", responsibles: [{ _id: me }], checklist: [] };
  assert.ok(keys(ticketActions(mine, ctx({ ticket: ["perform"] })).menu).includes("makeChecklist"));
  assert.ok(!keys(ticketActions({ ...mine, routineTask: { _id: "r1" } }, ctx({ ticket: ["perform"] })).menu).includes("makeChecklist"));
  assert.ok(!keys(ticketActions({ ...mine, responsibles: [] }, ctx({ ticket: ["perform"] })).menu).includes("makeChecklist"));
  assert.ok(keys(ticketActions({ ...mine, responsibles: [] }, ctx({ ticket: ["manage"] })).menu).includes("makeChecklist"));
});

test("client: only reopening own closed ticket", () => {
  const closed = { state: "Закрыта", applicant: { _id: me }, responsibles: [] };
  const result = ticketActions(closed, ctx({}, { isEndUser: true }));
  assert.equal(result.primary?.key, "backToWork");
  assert.deepEqual(result.menu, []);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test src/components/Ticket/ticket-actions.test.js` — Expected: FAIL on the manage/checklist assertions.

- [ ] **Step 3: Update `ticket-actions.js`**

Replace

```js
  const canPerformTickets = can({ ticket: ["perform"] });
  const canAdministrateTickets = can({ ticket: ["administrate"] });
  const canEditTickets = can({ ticket: ["update"] });
  const canDeleteTickets = can({ ticket: ["delete"] });

  const mine = isResponsible(ticket, userId);
```

with

```js
  const canPerformTickets = can({ ticket: ["perform"] });
  const canManageTickets = can({ ticket: ["manage"] });
  const canDeleteTickets = can({ ticket: ["delete"] });

  const mine = isResponsible(ticket, userId);
  // Состав чек-листа: ведущий заявки — на любой, исполнитель — на своей и не
  // из регламента (то же правило, что на сервере: services/ticketAccess)
  const canComposeChecklist =
    canManageTickets || (canPerformTickets && mine && !ticket.routineTask);
```

Then: `if (state === "Новая" && (canAdministrateTickets || isAdmin))` → `(canManageTickets || isAdmin)`; `if (canEditTickets) push({ key: "update", …})` → `if (canManageTickets)`; `if (canPerformTickets && !closed && !(ticket.checklist?.length > 0))` → `if (canComposeChecklist && !closed && !(ticket.checklist?.length > 0))`. Export the checklist rule for the card:

```js
/** Правило состава чек-листа — одно на карточку, меню и секцию ИИ. */
export const canComposeChecklistFor = (ticket, { userId, can }) =>
  can({ ticket: ["manage"] }) ||
  (can({ ticket: ["perform"] }) && isResponsible(ticket, userId) && !ticket?.routineTask);
```

and use it inside `ticketActions` instead of the inline expression.

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Card and sections**

`View.jsx` L288: `const canEditChecklist = canComposeChecklistFor(ticket, { userId, can }) && !ticket.isArchived;` (import `canComposeChecklistFor` from `../../components/Ticket/ticket-actions`). L525 and L550: `canEdit={can({ ticket: ["manage"] }) && !ticket.isArchived}`. L599: `<AiGuideSection canEditChecklist={canEditChecklist} />`.

`AiGuideSection.jsx`: signature `const AiGuideSection = ({ canEditChecklist = false }) => {`; delete the local `const canEditChecklist = can({ ticket: ["update"] }) && !ticket?.isArchived;` line.

`AttachmentStrip.jsx` L60-61:

```js
  // Вложения заявки — её содержание: и добавить, и убрать может только тот,
  // кто ведёт заявки. Исполнитель и клиент прикладывают файлы в комментариях.
  const canUpload = !ticket.isArchived && can({ ticket: ["manage"] });
  const canDelete = !ticket.isArchived && can({ ticket: ["manage"] });
```

`Sections.jsx` L394-395:

```js
  const showApplicant =
    !isEndUser ||
    !!can({ ticket: { actions: ["createForOthers", "readCompanies"], connector: "OR" } });
```

`TicketFormRoute.jsx` L125: `if (mode !== "add" && !can({ ticket: ["manage"] })) {`.

- [ ] **Step 6: Lists, facets, dashboard**

`Filter.jsx` L60-61, `List.jsx` L54-55, `StaffTickets.jsx` L78-79: replace `can({ ticket: ["administrate"] }) || can({ ticket: ["readAll"] })` with `!!can({ ticket: { actions: ["readAll", "readCompanies"], connector: "OR" } })` (keep the variable names). `List.jsx` L352: `canEdit={can({ ticket: ["manage"] })}`.

`MyTicketsClient.jsx` L57: `const canSeeCompany = !!can({ ticket: ["readCompanies"] });`.

`Dashboard.jsx` L83-86: delete the `can`/`showTemplates` lines and render `TemplateTiles` unconditionally where `showTemplates &&` guarded it (search `showTemplates` in the file). Update the comment to: «Шаблоны на главной — каждому сотруднику: список уже сужен до видимых ему шаблонов».

`entity-permissions.ts` L32: `return !!(can({ ticket: ["manage"] }) || can({ ticket: ["delete"] }));`.

- [ ] **Step 7: Sweep** — `grep -rn --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' -E '"administrate"|"update"\]|"readCompany"' frontend/src | grep 'ticket'` must return nothing.

- [ ] **Step 8: Verify** — `cd frontend && node --test src/components/Ticket/ticket-actions.test.js && pnpm build && pnpm typecheck; pnpm lint` (typecheck: baseline 3 errors only).

- [ ] **Step 9: Checkpoint** — report; no commit.

---

### Task 9: Client questionnaire — «Инициатор» for `createForOthers`

**Files:**
- Modify: `frontend/src/components/Ticket/TicketFormRoute.jsx` (L49 area)
- Modify: `frontend/src/components/Ticket/use-ticket-form.js` (params, `applicantId` default, exposed `canPickApplicant`, payload)
- Modify: `frontend/src/components/Ticket/TicketFormFields.jsx` (questionnaire)

**Interfaces:**
- `useTicketForm({ …, canCreateForOthers })` returns `canPickApplicant: boolean` plus the existing `applicantId`, `setApplicantId`, `applicants`.
- Backend already accepts `applicantId` from a client with the right (Task 6).

- [ ] **Step 1: Pass the right into the hook**

`TicketFormRoute.jsx`: inside `useTicketForm({ … })` add `canCreateForOthers: !!can({ ticket: ["createForOthers"] }),`.

- [ ] **Step 2: Hook**

In `use-ticket-form.js` add the param (`canCreateForOthers = false`) to the destructured arguments and the JSDoc (`@param {boolean} params.canCreateForOthers заявитель может указать инициатором коллегу`). Find the `applicantId` `useState` and make the client default themselves on creation: if it reads `useState(ticket?.applicantId ? asId(ticket.applicantId) : "")`, change to `useState(ticket?.applicantId ? asId(ticket.applicantId) : isEndUser ? userId : "")`.

Add after the `applicants` memo:

```js
  // Клиент с правом «Заводить заявки за других» выбирает инициатора среди
  // коллег: список приходит с сервера уже суженным до его компании
  const canPickApplicant = isEndUser && canCreateForOthers && applicants.length > 1;
```

In `buildPayload` client branch replace `payload.append("applicantId", "");` with `payload.append("applicantId", canPickApplicant ? applicantId : "");`. Add `canPickApplicant` to the returned object.

- [ ] **Step 3: Question block**

In `TicketFormFields.jsx` destructure `canPickApplicant` from `form` and put this block first inside `questionnaire` (before the description block):

```jsx
      {canPickApplicant && (
        <QuestionBlock
          heading
          title="Инициатор"
          hint="По умолчанию — вы. Выберите коллегу, если проблема у него"
          error={errorOf("applicant")}
        >
          <Combobox
            id="ticket-applicant"
            value={applicantId || null}
            onChange={(next) => setApplicantId(next ?? "")}
            options={applicants.map((person) => ({
              value: String(person._id),
              label: personLabel(person),
            }))}
            placeholder="Выберите коллегу"
            searchPlaceholder="Найти коллегу…"
            emptyText="Коллега не нашёлся."
          />
        </QuestionBlock>
      )}
```

(`QuestionBlock`, `Combobox` and `personLabel` are already imported/defined in this file — confirm with `grep -n "personLabel\|QuestionBlock" frontend/src/components/Ticket/TicketFormFields.jsx`.)

- [ ] **Step 4: Verify** — `cd frontend && pnpm build && pnpm typecheck; pnpm lint`. Then, in the dev UI as `client-admin`, open «Новая заявка»: the «Инициатор» question is first, defaults to self, lists colleagues only.

- [ ] **Step 5: Checkpoint** — report; no commit.

---

### Task 10: Catalogues and routine tasks — read/manage on routes, free lists for forms

**Files:**
- Modify: `backend/routes/internal/ticketCategory.js`, `backend/routes/internal/ticketTemplate.js`, `backend/routes/internal/checklistTemplate.js`, `backend/routes/internal/routineTask.js`
- Modify: `backend/controllers/ticketTemplate.js` (`canSeeTemplate`, `getAll`)
- Modify: `frontend/src/App.jsx` (L720, L747, L795, L818), `frontend/src/util/sections.ts` (L59, L65, L74, L83), `frontend/src/layout/Navigation/menu.js` (L62-64, L69, L237-264, L365-372)

- [ ] **Step 1: Routes**

`ticketCategory.js`: list and `:id` GET → `isAuth, isNotClient` (import `isNotClient`); the three POSTs keep `canManageTicketCategories`.

`routineTask.js`: GET list and `:id` → `isAuth, canReadRoutineTasks`; POSTs keep `canManageRoutineTasks`.

`checklistTemplate.js`: `GET /checklist-templates`, `GET /checklist-templates/for-ticket/:ticketNum`, `GET /checklist-templates/:id` → `isAuth, isNotClient`; `GET /checklist-templates/form-data` and the POSTs keep `canManageChecklistTemplates`.

`ticketTemplate.js`: unchanged (ownership decides; `sync-routines` keeps `canManageRoutineTasks`).

- [ ] **Step 2: Templates — read means all templates**

In `ticketTemplate.js#canSeeTemplate` change `if (auth.can({ ticketTemplate: ["manage"] })) return true;` to `if (auth.can({ ticketTemplate: ["read"] })) return true;`. In `getAll` change `if (req.auth.can({ ticketTemplate: ["manage"] })) {` to `if (req.auth.can({ ticketTemplate: ["read"] })) {`. `canEditTemplate` keeps `manage`.

- [ ] **Step 3: Frontend guards and menu**

`App.jsx`: L720 `ticketCategory: ["read"]`, L747 `ticketTemplate: ["read"]`, L795 `checklistTemplate: ["read"]`, L818 `routineTask: ["read"]`. `sections.ts`: the same four `can:` entries → `read`.

`menu.js`: rename the four constants and their uses:

```js
  const canReadTicketCategories = can({ ticketCategory: ["read"] });
  const canReadTicketTemplates = can({ ticketTemplate: ["read"] });
  const canReadChecklistTemplates = can({ checklistTemplate: ["read"] });
  const canReadRoutineTasks = can({ routineTask: ["read"] });
```

Use them at L237/L244/L251/L258 and at L365-366 (`!canPerformTickets && canReadTicketTemplates && link(…)`); update the comment there to «страница за `ticketTemplate.read`».

- [ ] **Step 4: Verify** — `node --check` on the four route files and the controller; `cd frontend && pnpm build`. In dev as second line: «Регламенты» opens, category picker in the routine-task form loads (no 403).

- [ ] **Step 5: Checkpoint** — report; no commit.

---

### Task 11: Works, reports, approval, finances

**Files:**
- Modify: `backend/controllers/work.js` (`canSeeMoney` L21-22, `canEditWork` L33, delete L486)
- Modify: `backend/controllers/ticket.js` (`getOne` ~L630 `canSeeMoney`)
- Modify: `backend/controllers/user.js` (`canManageFinances` L72-73)
- Modify: `backend/routes/internal/work.js` (`/works` gate), `backend/routes/internal/report.js` (gate), `backend/routes/internal/finances/approval.js` (`canOpenApproval` → `canReadApproval`), `backend/routes/index.js` (finances mounts)
- Modify: `backend/services/reportApprovalScope.js` (L132, L144)
- Modify: `frontend/src/pages/Archive.jsx` (L27-29), `frontend/src/components/Ticket/View/Sections.jsx` (L667-668), `frontend/src/components/User/View.jsx` (L213-216), `frontend/src/components/User/UserForm.jsx` (L151), `frontend/src/App.jsx` (L1364), `frontend/src/util/sections.ts` (L143), `frontend/src/layout/Navigation/menu.js` (L189-196)

- [ ] **Step 1: Money is one right**

`work.js`:

```js
/** Суммы и условия тарифа — своё право, а не сочетание двух (спека 2026-09-11). */
const canSeeMoney = (req) => req.auth.can({ work: ["readCost"] });
```

`canEditWork`: `can({ work: ["manageAll"] })` → `can({ work: ["manage"] })`; L486 likewise. `ticket.js#getOne`: `canSeeMoney: req.auth.can({ work: ["readCost"] }),` (delete the two-line comment about two calls).

`user.js` L72-73: `const canManageFinances = (req) => req.auth.can({ user: ["manageFinances"] });`.

- [ ] **Step 2: Works archive and companies report gates**

`routes/internal/work.js` `/works`: remove `canReadWorksReport` (keep `isAuth, timeTrackingModuleIsActive, canReadWorks`); drop `canReadWorksReport` from the import. `routes/internal/report.js`: `const gate = [isAuth, timeTrackingModuleIsActive, canReadCompaniesReport];` (drop `canReadWorks` — the report is its own right).

- [ ] **Step 3: Approval**

`routes/internal/finances/approval.js`: import `canReadApproval` instead of `canOpenApproval` and use it on `/pipeline`, `/reports/:id`, `/reports/:id/decision`. `reportApprovalScope.js` L132: `if (!can({ approval: ["read"] })) {`; L144 stays `approval.decide`.

`routes/index.js`: both `/finances` mounts lose `canReadServicePlans` (keep `financesModuleIsActive`); remove it from the import list at the top if unused afterwards.

- [ ] **Step 4: Frontend**

`Archive.jsx` L27-29: `!!modules?.timeTracking?.isActive && !!can({ work: ["read"] })`. `Sections.jsx` L667-668: `const showBilling = can({ work: ["readCost"] });` and fix the comment («Доплата вне графика — её видит тот, кому открыта стоимость работ»). `User/View.jsx` L213-216:

```js
  const canSeeFinances =
    !isEndUser && finances && (isSelf || Boolean(can({ user: ["manageFinances"] })));
```

`UserForm.jsx` L151: `const canEditFinances = Boolean(can({ user: ["manageFinances"] }));`. `App.jsx` L1364 and `sections.ts` L143: `approval: ["read"]`. `menu.js` L189-196: `finances && canReadApproval && link("fin-approval", …)` with `const canReadApproval = can({ approval: ["read"] });` added near the other constants.

- [ ] **Step 5: Verify** — `node --check` on the six backend files; `cd backend && pnpm test`; `cd frontend && pnpm build && pnpm typecheck; pnpm lint`.

- [ ] **Step 6: Checkpoint** — report; no commit.

---

### Task 12: Companies, users, roles, service plans — naming and client scope

**Files:**
- Modify: `backend/controllers/user.js` (`getOne` client branch)
- Modify: `backend/routes/internal/finances/servicePlan.js` (GET routes)
- Modify: `frontend/src/layout/Navigation/menu.js` (client branch L111-149; `people` group L342-346), `frontend/src/layout/MobileBottomNavbar.jsx` (L46)

- [ ] **Step 1: A client may open a colleague's card**

In `user.js#getOne` replace the final `} else { res.status(200).json(maskSecrets(authedUser)); }` branch with:

```js
    } else {
      // Клиент: свою карточку — целиком (без секретов), коллегу своей компании —
      // адресной книгой. Чужие компании закрыты.
      const isSelf = authedUser._id.toString() === user._id.toString();
      if (isSelf) return res.status(200).json(maskSecrets(authedUser));
      if (String(user.company?._id) !== String(authedUser.company?._id)) {
        return next(new AppError("Пользователь вам недоступен", 403));
      }
      const { _id, firstName, lastName, email, phone, position, company, subdivision, profileImagePath, isEndUser } = user.toObject();
      res.status(200).json({ _id, firstName, lastName, email, phone, position, company, subdivision, profileImagePath, isEndUser });
    }
```

- [ ] **Step 2: Service plan lists are staff-only, page keeps `read`**

`routes/internal/finances/servicePlan.js`: both GETs get `isAuth, isNotClient` (import `isNotClient` from the permissions middleware).

- [ ] **Step 3: Menu**

Client branch (`if (isEndUser) { … return [ … ] }`): after the `link("dashboard", …)` entry add

```js
      canReadCompanies && link("companies", "Компания", RiBuilding2Line, "/companies"),
      canReadUsers && link("users", "Пользователи", RiContactsLine, "/users"),
```

(`canReadCompanies`, `canReadUsers`, `RiContactsLine`, `RiBuilding2Line` already exist in the file). Staff `people` group: `label: "Пользователи"`. `MobileBottomNavbar.jsx` L46: `label: "Пользователи"`.

- [ ] **Step 4: Verify** — `node --check backend/controllers/user.js backend/routes/internal/finances/servicePlan.js`; `cd frontend && pnpm build`. In dev as `client-admin`: «Компания» opens own card; «Пользователи» lists colleagues; a colleague's card opens.

- [ ] **Step 5: Checkpoint** — report; no commit.

---

### Task 13: Schedules and absences — own without a right, fix the dead `workSchedule` check

**Files:**
- Modify: `backend/routes/internal/team.js`
- Modify: `backend/controllers/absence.js` (`canManage` L23-24, `getAll`, `impact`)
- Modify: `backend/controllers/team/schedule.js` (`getUserSchedule`)

- [ ] **Step 1: Fix the resource name**

`absence.js` L23-24: `(await canFor(user))({ schedule: ["manage"] });` — `workSchedule` is not a dictionary resource, so «завести отсутствие другому» always failed.

- [ ] **Step 2: Own things without the right**

`team.js`: `/schedule/:userId` → `isAuth` (drop `canReadSchedule`); `/absences` GET → `isAuth`; `/absences/impact` → `isAuth`; `/absences` POST → `isAuth`; `/absences/:id/cancel` → `isAuth`. `/schedule`, `/production-calendar` keep `canReadSchedule`; decision keeps `canApproveAbsences`; delete keeps `canManageSchedules`. Update the comment block above the routes: «Свой график и свои отсутствия — без права; чужие — `schedule.read`, проверка внутри контроллера».

`team/schedule.js#getUserSchedule`, right after `const targetId = req.params.userId;`:

```js
    if (String(targetId) !== req.auth.userId && !req.auth.isAdmin && !req.auth.can({ schedule: ["read"] })) {
      return next(new AppError("Чужой график можно смотреть только с правом «Видеть графики и отсутствия»", 403));
    }
```

`absence.js#getAll`: after the query is built and before `Absence.find`, force the scope for people without the right:

```js
    if (!req.auth.isAdmin && !req.auth.can({ schedule: ["read"] })) {
      query.user = req.auth.userId; // без права видны только свои отсутствия
    }
```

`absence.js#impact`: locate where the target user id is read from the query/body and add the same self-or-right check as in `getUserSchedule` (403 «Чужой график…»).

- [ ] **Step 3: Verify** — `node --check` on the three files; `cd backend && pnpm test`. In dev as `contractor-no-works` (no `schedule.read`): «Мой аккаунт → График» renders; the team calendar returns 403.

- [ ] **Step 4: Checkpoint** — report; no commit.

---

### Task 14: Knowledge base — `manage` on routes, `moderate` replaces the settings list

**Files:**
- Modify: `backend/routes/internal/knowledgeNote.js`
- Modify: `backend/controllers/knowledgeNote.js` (`getKbConfig`, every `isModerator(` call, `getModerationSummary`, `runBulkModeration`)
- Modify: `backend/helpers/knowledgeNoteVisibility.js` (remove `isModerator`)
- Modify: `backend/controllers/me.js` (L75-78), `backend/controllers/preferences.js` (L245-248)
- Modify: `backend/routes/internal/user.js` (delete `/users/knowledge-base-moderators`), `backend/controllers/user.js` (delete `getKnowledgeBaseModerators`)
- Modify: `frontend/src/components/Preferences/KnowledgeBase.jsx` (remove the moderators row and payload field)

- [ ] **Step 1: Routes**

Import `canModerateKnowledge`. Replace `canManageKnowledge` with `canModerateKnowledge` on: the `moderationBulkRoutes` loop, `approve/:id`, `confirm-deletion/:id`, `decline-deletion/:id`, `confirm-archive/:id`, `decline-archive/:id`, `:id/ignore-secret`. Add `canModerateKnowledge` to `moderation-summary` (after `canReadKnowledge`). Keep `canManageKnowledge` on `add`, `update/:id`, `send-to-deletion/:id`, `request-archive/:id`, `unarchive/:id`, `delete/:id`, `form-data`. Update the route comments («проверка модератора в контроллере» → «право `knowledge.moderate`»).

- [ ] **Step 2: Controller**

`getKbConfig`: drop `moderatorIds` from the returned object. Replace every `if (!isModerator(authedUser, moderatorIds)) {` / `if (!isModerator(authedUser, kbConfig.moderatorIds)) {` with `if (!req.auth.can({ knowledge: ["moderate"] })) {` (lines ~443, 479, 521, 602, 645, 718, 863, 1024); remove the now-unused `const { moderatorIds } = await getKbConfig();` lines and the `isModerator` import. In `getModerationSummary` keep the shape: `{ isModerator: false, ...ZERO_COUNTS }` when the right is missing.

`knowledgeNoteVisibility.js`: delete `isModerator` and its export.

`me.js` L75-78 and `preferences.js` L245-248: replace the `moderatorIds`/`isModerator(...)` pair with `const userIsModerator = req.auth.can({ knowledge: ["moderate"] });` and drop the `isModerator` import in both files.

- [ ] **Step 3: Settings no longer hold the list**

Delete the `/users/knowledge-base-moderators` route and `exports.getKnowledgeBaseModerators`. In `Preferences/KnowledgeBase.jsx` delete the `moderators` state, the `candidates` state + effect, the `moderators,` payload field and the whole `<SettingRow title="Модераторы" …>`; remove unused imports (`useEffect`, `MultiCombobox`, `toOptions`) if nothing else uses them. The `moderators` field stays in the Mongoose schema (the migration script reads it); it is no longer written.

- [ ] **Step 4: Verify** — `node --check` on the backend files; `cd backend && pnpm test`; `cd frontend && pnpm build && pnpm lint`. In dev as a `kb-moderator`: the moderation card appears on the dashboard; as first line: approve returns 403.

- [ ] **Step 5: Checkpoint** — report; no commit.

---

### Task 15: Inventory — real `supplier.read`, free catalogue lists

**Files:**
- Modify: `backend/routes/index.js` (catalogue mounts)
- Modify: `backend/routes/internal/inventory/vendor.js` (GET routes), `backend/routes/internal/inventory/supplier.js` (GET routes)

- [ ] **Step 1: Mount gates**

In `routes/index.js` replace `canReadInventoryCatalog` with `isNotClient` on the six catalogue mounts (`deviceAttributeRoutes`, `deviceConfigurationRoutes`, `deviceModelRoutes`, `deviceTypeRoutes`, `deviceTypeAttributeRoutes`, and the `vendorRoutes` mount if it is separate — check the file around L147-190). Import `isNotClient` from the permissions middleware; drop `canReadInventoryCatalog` from the import if unused. Device and location mounts keep `canReadDevices`; suppliers keep `canReadSuppliers`; Mikrotik keeps `canReadMikrotik`. Add a comment: «Справочники техники — выпадашки форм устройства: список открыт любому сотруднику, раздел закрыт правом на маршруте фронта».

- [ ] **Step 2: Route files**

`vendor.js`: `GET /vendors` and `GET /vendors/:id` → `isAuth` only. `supplier.js`: `GET /suppliers` and `GET /suppliers/:id` → `isAuth` only (the mount already requires `supplier.read`).

- [ ] **Step 3: Verify** — `node --check backend/routes/index.js backend/routes/internal/inventory/vendor.js backend/routes/internal/inventory/supplier.js`. In dev as first line: the device form's vendor picker loads; «Поставщики» opens.

- [ ] **Step 4: Checkpoint** — report; no commit.

---

### Task 16: Settings — one right

**Files:**
- Modify: `backend/routes/internal/preferences.js`
- Modify: `backend/controllers/preferences.js` (`SECTION_RIGHTS`, `GENERAL_RIGHT`, `sectionsBeyondRights`, the `denied` check in `update`)
- Modify: `frontend/src/pages/Preferences.jsx` (L149-214), `frontend/src/layout/Navbar.jsx` (L178), `frontend/src/layout/NavDrawer.jsx` (L191), `frontend/src/App.jsx` (L1461), `frontend/src/util/sections.ts` (L245)

- [ ] **Step 1: Routes**

Import only `canManageSettings` from the permissions middleware. `GET /preferences` → `canManageSettings`; `POST /preferences` → `canManageSettings`; replace `canManageMailSettings` and `canManageIntegrations` on the check/test routes with `canManageSettings`. Update the comment above `POST /preferences`: «Настройки — одно право: секции по правам не делятся (спека 2026-09-11)».

- [ ] **Step 2: Controller**

Delete `SECTION_RIGHTS`, `GENERAL_RIGHT`, `sectionsBeyondRights` and the block in `update` that starts with `const denied = sectionsBeyondRights(body, req.auth.can);` and ends with the `403` return. Replace the comment above it with one line: «Право проверил маршрут (`canManageSettings`): настройки — одно право».

- [ ] **Step 3: Frontend**

`Preferences.jsx`: replace every `can({ settings: ["manageMail"] }) &&`, `can({ settings: ["manageIntegrations"] }) &&`, `can({ settings: ["manageSecurity"] }) &&` with `general &&`. Keep the `if (!sections.length) return <Forbidden />;` guard. `Navbar.jsx` L178, `NavDrawer.jsx` L191, `App.jsx` L1461, `sections.ts` L245: `settings: ["manage"]`.

- [ ] **Step 4: Verify** — `node --check` on the two backend files; `cd frontend && pnpm build && pnpm lint`. In dev as admin: every settings section renders; saving a mail section still works.

- [ ] **Step 5: Checkpoint** — report; no commit.

---

### Task 17: Role form — audience-filtered matrix (approved mockup)

**Files:**
- Create: `frontend/src/components/Role/audience.js`, `frontend/src/components/Role/audience.test.js`
- Modify: `frontend/src/store/authed-user.ts` (types, `useCanGrant`)
- Modify: `frontend/src/components/User/PermissionModules.jsx` (`audience` prop, hint per audience)
- Modify: `frontend/src/components/Role/Form.jsx` (allowed via grant set, filtered rail, audience switch, hint text)
- Modify: `backend/services/roles.js` (`gaps` by audience)

**Interfaces:**
- Produces: `groupsForAudience(groups, audience)`, `foreignActions(ids, groups, audience)`, `hintFor(action, audience)`; `useCanGrant(): Can` reading `grantStatements` from `/api/me` (Task 2).
- Mockup: https://claude.ai/code/artifact/dddd9e4e-aeca-4ebf-a584-2cc8a170c14c — desktop light = staff role, desktop dark = client role, two mobile boards. The only new visual element is the hint under «Кому назначается»; everything else is the existing form.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Role/audience.test.js`:

```js
// node --test src/components/Role/audience.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { groupsForAudience, foreignActions, hintFor } from "./audience.js";

const groups = [
  {
    key: "tickets",
    label: "Заявки",
    actions: [
      { id: "ticket.readCompanies", label: "Видеть заявки своих компаний", audience: "both", hint: "s", clientHint: "c" },
      { id: "ticket.perform", label: "Брать заявки в работу", audience: "staff", hint: "p" },
    ],
  },
  { key: "approval", label: "Согласование", actions: [{ id: "approval.decide", label: "Согласовывать отчёты", audience: "client" }] },
  { key: "settings", label: "Настройки", actions: [{ id: "settings.manage", label: "Изменять настройки" }] },
];

test("staff role: staff and both rows, client-only group hidden", () => {
  const staff = groupsForAudience(groups, "staff");
  assert.deepEqual(staff.map((g) => g.key), ["tickets", "settings"]);
  assert.deepEqual(staff[0].actions.map((a) => a.id), ["ticket.readCompanies", "ticket.perform"]);
});

test("client role: client and both rows, empty groups dropped", () => {
  const client = groupsForAudience(groups, "client");
  assert.deepEqual(client.map((g) => g.key), ["tickets", "approval"]);
  assert.deepEqual(client[0].actions.map((a) => a.id), ["ticket.readCompanies"]);
});

test("foreignActions lists what a switch removes", () => {
  assert.deepEqual(foreignActions(["ticket.readCompanies", "ticket.perform", "settings.manage"], groups, "client"), ["ticket.perform", "settings.manage"]);
  assert.deepEqual(foreignActions(["approval.decide", "ticket.readCompanies"], groups, "staff"), ["approval.decide"]);
});

test("hintFor picks the client hint only for client roles", () => {
  const both = groups[0].actions[0];
  assert.equal(hintFor(both, "client"), "c");
  assert.equal(hintFor(both, "staff"), "s");
  assert.equal(hintFor(groups[0].actions[1], "client"), "p");
  assert.equal(hintFor({ id: "x", label: "y" }, "staff"), "");
});
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && node --test src/components/Role/audience.test.js`.

- [ ] **Step 3: Implement `frontend/src/components/Role/audience.js`**

```js
/**
 * Адресат в форме роли. Словарь приходит с сервера с полем `audience`
 * («staff» | «client» | «both», по умолчанию staff) — здесь только выбор
 * строк для роли: у роли сотрудника строки staff и both, у клиентской —
 * client и both. Группы без строк не показываются, рейл и счётчики считают
 * видимые строки (спека 2026-09-11, макет «Форма роли»).
 */
const audienceOf = (action) => action?.audience || "staff";

export const actionFits = (action, roleAudience) => {
  const audience = audienceOf(action);
  return audience === "both" || audience === roleAudience;
};

export const groupsForAudience = (groups = [], roleAudience = "staff") =>
  groups
    .map((group) => ({
      ...group,
      actions: (group.actions || []).filter((action) => actionFits(action, roleAudience)),
    }))
    .filter((group) => group.actions.length > 0);

/** Что снимется при смене адресата: выданные действия, которых у нового адресата нет. */
export const foreignActions = (ids = [], groups = [], roleAudience = "staff") => {
  const visible = new Set(
    groupsForAudience(groups, roleAudience).flatMap((group) => group.actions.map((action) => action.id)),
  );
  return [...ids].filter((id) => !visible.has(id));
};

/** Подсказка под правом: клиентской роли — clientHint, если он есть. */
export const hintFor = (action, roleAudience) =>
  (roleAudience === "client" && action?.clientHint) || action?.hint || "";
```

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Types and grant hook**

`store/authed-user.ts`: extend `PermissionAction` with `audience?: "staff" | "client" | "both"; clientHint?: string;` and add after `useCan`:

```ts
/**
 * Что человек вправе ВЫДАТЬ роли — набор его ролей до вырезания по типу
 * аккаунта (`grantStatements` из `/api/me`). Администратор-сотрудник не
 * действует правом «Согласовывать отчёты», но клиентской роли его выдаёт.
 */
export function useCanGrant(): Can {
  const user = useContext(AuthedUserContext) as unknown as {
    grantStatements?: Statements;
    statements?: Statements;
  };
  return useMemo(
    () => makeCan(user?.grantStatements ?? user?.statements),
    [user?.grantStatements, user?.statements],
  );
}
```

Check that `layout/Root.jsx` spreads the whole `/api/me` payload into the context (`{ ...defaultAuthedUser, ...userData }`); if it copies fields explicitly, add `grantStatements` there.

- [ ] **Step 6: `PermissionModules` gets an audience**

Add the prop `audience = "staff"` to the component signature; replace `const groups = usePermissionCatalogue();` with `const groups = groupsForAudience(usePermissionCatalogue(), audience);` and `hint={action.hint || undefined}` with `hint={hintFor(action, audience) || undefined}`. Import both from `@/components/Role/audience`. Update the JSDoc: a paragraph «Строки — по адресату роли: см. `Role/audience.js`».

- [ ] **Step 7: `Role/Form.jsx`**

- Import `useCanGrant` and `groupsForAudience, foreignActions` from `./audience`.
- `const can = useCanGrant();` replaces `useCan()` for `allowed` (comment: «Что можно выдать — по набору ролей самого, до вырезания по типу аккаунта»).
- `railSections`: build from `groupsForAudience(groups, audience)` instead of `groups`.
- Replace `onChange={setAudience}` on the Segmented with:

```jsx
                onChange={(next) => {
                  // Права другого адресата у роли не действуют — снимаем их
                  // сразу; блок «Что изменится» покажет снятое со знаком «−»
                  const dropped = new Set(foreignActions([...actions], groups, next));
                  setActions((current) => new Set([...current].filter((id) => !dropped.has(id))));
                  setAudience(next);
                }}
```

- Field hint for «Кому назначается» (exact text from the mockup): `hint="Ниже — только права, которые действуют у этого типа аккаунта. При смене адресата права другого типа снимаются."`
- Pass `audience={audience}` to `<PermissionModules … />`.
- `pickSource` («Из роли»): keep as is; the matrix hides foreign rows, and foreign actions of the copied role are dropped by `foreignActions` too: `setActions(new Set((source.actions || []).filter((id) => allowed.has(id) && !foreignActions([id], groups, audience).length)));`.

- [ ] **Step 8: Gaps by audience (backend)**

In `backend/services/roles.js` replace `gaps` with:

```js
const { audienceOfAction } = require("@/auth/access");

/**
 * Права без своей роли — по адресату: право клиента — дыра, если его не даёт
 * ни одна клиентская роль (кроме полного доступа); право сотрудника — если ни
 * одна роль сотрудников; `both` — если ни та ни другая.
 */
const gaps = async () => {
  const catalogue = await listRoles();
  const partial = catalogue.filter((role) => !isFullAccess(role.statements));

  const covered = { staff: new Set(), client: new Set() };
  for (const role of partial) {
    for (const [resource, actions] of Object.entries(role.statements)) {
      for (const action of actions) covered[role.audience].add(`${resource}.${action}`);
    }
  }

  return Object.entries(STATEMENT).flatMap(([resource, actions]) =>
    actions
      .map((action) => `${resource}.${action}`)
      .filter((id) => {
        const audience = audienceOfAction(id);
        const wanted = audience === "both" ? ["staff", "client"] : [audience];
        return !wanted.some((key) => covered[key].has(id));
      }),
  );
};
```

(`audienceOfAction` import goes next to the existing `@/auth/access` require at the top of the file.)

- [ ] **Step 9: Verify against the mockup**

`cd frontend && node --test src/components/Role/audience.test.js && pnpm build && pnpm typecheck; pnpm lint`. In dev: open «Роли → Клиент: администратор»: 9 group cards, «Заявки» shows two rows with client hints, rail lists «Основное» plus 9 groups; switch the segment to «Сотрудникам» and back — `«Что изменится»` shows nothing when returning to the saved audience. Open «ИТ-Специалист: первая линия»: 15 groups (16 rail entries with «Основное»), no «Согласовывать отчёты». Compare with the two desktop boards of the mockup.

- [ ] **Step 10: Checkpoint** — report; no commit.

---

### Task 18: Cleanup, coverage, static gates, docs

**Files:**
- Modify: `backend/middleware/permissions.js` (remove legacy gates), `backend/routes/index.js` (imports)
- Modify: `docs/ux-ui-guide.md` («Роли и права»), `docs/ux-ui-changelog.md`
- Modify: memory `permissions-ac-dictionary.md` (out of repo; see step 5)

- [ ] **Step 1: Remove the legacy gates**

Delete from `middleware/permissions.js`: `canAdministrateTickets`, `canUpdateTickets`, `canReadWorksReport`, `canOpenApproval`, `canReadSettings`, `canManageMailSettings`, `canManageIntegrations`, `canManageSecuritySettings`. Then:

```bash
cd backend && grep -rn -E 'canAdministrateTickets|canUpdateTickets|canReadWorksReport|canOpenApproval|canReadSettings|canManageMailSettings|canManageIntegrations|canManageSecuritySettings' --include='*.js' . | grep -v node_modules
```

Fix every hit (routes for `pro32-connected`/`pro32-revoke` in `routes/internal/user.js` use `canManageIntegrations` → `canManageSettings`). Then:

```bash
grep -rn -E '"administrate"|"readCompany"|"manageAll"|report: \["works"\]|settings: \["(read|manageMail|manageIntegrations|manageSecurity)"\]|workSchedule: \[' --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' backend frontend/src | grep -v node_modules
```

must return nothing (except `scripts/legacyPermissions.js` comments and `services/actionMigration.js`).

- [ ] **Step 2: Coverage and tests**

```bash
cd backend && node scripts/checkPermissionCoverage.js && pnpm test
for f in $(git diff --name-only -- backend | grep '\.js$'); do node --check "$f" || echo "SYNTAX $f"; done
cd ../frontend && pnpm build && pnpm typecheck; pnpm lint
```

Expected: «Каждое действие словаря где-то проверяется.», all tests pass, typecheck at baseline (3 known errors), lint clean.

- [ ] **Step 3: Guide**

In `docs/ux-ui-guide.md` section «## Роли и права» add these bullets (keep the existing ones; rewrite the «Роль знает своего адресата» bullet to match):

```markdown
- **Роль знает своего адресата, и матрица показывает только его строки.** У
  действия словаря есть адресат (`staff` / `client` / `both`); форма роли
  рисует строки адресата роли, группы без строк не рисует, рейл и счётчики
  «N из M» считают видимые. Смена «Кому назначается» снимает права другого
  адресата и показывает их в «Что изменится» со знаком «−». У права `both`
  две подсказки: для роли сотрудника и для клиентской.
- **Подпись права — глагол и сущность.** «Видеть X» открывает раздел X,
  «Изменять X» заводит, правит и удаляет. У каждой справочной сущности ровно
  эта пара; особые глаголы только у процессов (брать в работу, вести,
  согласовывать, модерировать).
- **Выпадающий список внутри чужой формы права не требует.** Категория в
  форме заявки, вендор в форме устройства, услуга в форме компании — часть
  права на ту форму. Право «Видеть X» — про раздел X.
- **Своё — без права.** Свой график, свои отсутствия, свои шаблоны заявок,
  свои работы, свой профиль. Право нужно на чужое и на раздел.
- **Раздел людей называется «Пользователи»** — в меню, таб-баре, крошках и
  правах. Слова «Люди» в интерфейсе нет.
```

Also in the «Словарь действий» section (if it has a list of nouns) confirm «пользователи» is the term for the section.

- [ ] **Step 4: Changelog**

Prepend to `docs/ux-ui-changelog.md` (below the header, above the first entry), dated on the day of execution:

```markdown
- **2026-09-XX** — **Словарь прав пересобран.** Подписи стали «глагол +
  сущность», у справочных сущностей пара «Видеть / Изменять», у действий
  появился адресат (сотрудникам / клиентам / обоим), и форма роли показывает
  только строки адресата роли. Слились `Вести чужие заявки` и `Изменять
  содержание заявки` → «Вести заявки»; «Отчёт по работам» растворился в
  «Видеть работы»; стоимость работ, оклады и модерация базы знаний получили
  свои права вместо сочетаний и списка в настройках; настройки — одно право.
  Клиент с правом «Заводить заявки за других» получил в анкете вопрос
  «Инициатор» (коллеги своей компании). Раздел «Люди» переименован в
  «Пользователи». Спека —
  `docs/superpowers/specs/2026-09-11-permissions-dictionary-redesign-design.md`.
```

- [ ] **Step 5: Memory**

Update `~/.claude/projects/-home-aleksey-projects-hd/memory/permissions-ac-dictionary.md`: replace the example `can({ ticket: ["delete"] })` context with a line that the dictionary is the 2026-09-11 one (audience tags, `req.auth.canGrant` for role editing, `services/ticketScope` for ticket tiers) and that `permissions-redesign-status` holds the history. Update `permissions-redesign-status.md`: status «реализовано, ждёт живой проверки владельцем и коммита».

- [ ] **Step 6: Final report (no commit)**

List every changed file grouped by task, the dev-DB script output (roles rewritten, moderators granted), the static-gate results, and the live checks performed. Remind that the owner commits in a batch and that nothing here goes to prod before the better-auth migration.

---

## Self-review notes

- **Spec coverage:** dictionary and hints (T1); audience stripping and grant set (T2); migration, legacy map, catalogue, `kb-moderator` (T3); gates (T4, T18); ticket tiers and relation checks (T5, T6); attachments/checklist/`createForOthers` (T6, T8, T9); `administrate` side effects (T7); catalogues read/manage and free lists (T10, T15); works/reports/approval/finances (T11); companies/users/service plans scope and «Пользователи» (T12); own schedule/absences and the dead `workSchedule` check (T13); knowledge `manage` on routes and `moderate` (T14); settings single right (T16); role form (T17); docs and memory (T18). Out of scope per spec: client close/confirm, middle scope for users/companies.
- **Type consistency:** `ticketListFilter`/`ticketTier`/`ticketInScope` (T5) are the names used in T6/T7; `canEditChecklist` (T5) used in T6; `canComposeChecklistFor` (T8) used in `View.jsx`; `useCanGrant` (T17) reads `grantStatements` produced in T2; gate names introduced in T4 are the ones used in T6, T10, T11, T14.
- **Ordering:** T1→T2→T3 must run before the dev-DB scripts (T3 step 9); T4 before any route task; T18 last.
