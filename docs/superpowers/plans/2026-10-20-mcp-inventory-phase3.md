# MCP inventory, phase 3: proposal page in the portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the requester opens an AI-agent inventory proposal at `/inventory/changes/:id`, reads every operation (with links, field tables and, after applying, per-operation results), and approves or rejects it. Proposals waiting for the viewer also appear in the existing dashboard block.

**Architecture:**
- Each operation's page view (head, sub-lines, field table, links) is computed at proposal time by the kind and stored on the operation, next to the Telegram `text`.
- The HTTP layer is a thin controller over the existing `liveInventoryDecisions()` plus a pure `changeView` module. The structure mirrors Mikrotik changes: `controllers/inventory/mikrotikChange.js`, `services/mikrotik/changeView.js`, `pages/Mikrotik/Change.jsx`.
- Live updates use a new pulse topic `inventoryChanges`.

**Tech Stack:**
- Backend: Node CommonJS, Express 5, Mongoose, `node:test`.
- Frontend: React 19, React Router data loaders, Tailwind + shadcn primitives from `components/app`, TS utils tested with `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-mcp-inventory-design.md` (phase 3). The approved mockup (owner «да, норм», 20.10) is https://claude.ai/artifact/MRyneSKyAQAeFWACHtnj2M; file `.superpowers/sdd/2026-10-20-mcp-inventory-phase3/mockup.html`. The phase 2 module doc is `docs/inventory-changes.md`.

## Global Constraints

- Paths are relative to `backend/` unless they start with `frontend/`, `tg-service/` or `docs/`.
- **Never `git commit`, `git push`, `git add` or `git stash`.** Leave the changes in the tree; the owner handles git.
- Tests and checks, run only on the touched files:
  - backend `node --test <files>`; never the full backend `pnpm test`;
  - frontend `cd frontend && node --test <files>`;
  - `cd frontend && pnpm exec tsc --noEmit`: the only expected error is the long-standing one in FormWrapper;
  - `pnpm exec eslint <touched files>` in both packages.
- pnpm only. No new dependencies.
- **The page follows the mockup pixel for pixel**, built from `components/app` primitives (`Panel`, `Eyebrow`, `PropRow`, `Crumbs`, `ConfirmDialog`, `DeviceStatusText`, `EntityLink`) the way `pages/Mikrotik/Change.jsx` does. It has no new visual elements beyond the mockup. Typography follows the Dense scale: no `text-[Npx]`.
- **Copy (Russian):**
  - no «№» (the proposal is named by its title);
  - gender-neutral («Утверждено на портале», never «Утвердил»);
  - action words «Утвердить / Отклонить / Да, применить / Назад»;
  - status labels from `services/inventory/changeSteps.js` `STATUS_LABELS`; the stuck title is «Применение прервано — результат неизвестен».
- **Who sees what:**
  - The full page with decision buttons: the requester, while the status is `awaiting_requester` and the proposal hasn't expired.
  - The full page without buttons: staff holding `device.manage` OR `inventoryCatalog.manage`. They see the hint «Решает только автор запроса.»
  - Everyone else gets 404 «Предложение не найдено», the same answer as for a missing id.
  - Clients are blocked by the mount gate `isNotClient`.
- **Decisions on the portal** go through `liveInventoryDecisions().decide({ changeId, userId, decision, channel: "portal", comment })`.
  - Comment: optional, one line, at most 300 characters (whitespace collapsed), the same as Mikrotik's `parseComment`.
  - Refusal codes map to HTTP: `not_yours 403`, `no_right 403`, `closed 409`, `expired 410`, `not_found 404`.
  - The portal has no `too_long` rule: every package can be approved here.
- **Link targets.** Frontend paths per model:

  | Model | Path | Right to show the link |
  |---|---|---|
  | `ClientDevice` | `/inventory/client-devices/:id` | `device.read` |
  | `Location` | `/inventory/locations/:id` | `device.read` |
  | `DeviceModel` | `/inventory/device-models/:id` | `inventoryCatalog.read` |
  | `DeviceConfiguration` | its model's page | `inventoryCatalog.read` |
  | `DeviceType` | `/inventory/device-types/:id` | `inventoryCatalog.read` |
  | `Vendor` | `/inventory/vendors/:id` | `inventoryCatalog.read` |
  | `DeviceBuild` | `/inventory/device-builds/:id` | `inventoryCatalog.read` |
  | `Supplier` | `/inventory/suppliers/:id` | `supplier.read` |
  | `DeviceAttribute`, `AttributeGroup`, `Company`, `User` | no link (plain text) | — |

  A link the viewer has no right to open renders as plain text.
- No staff contacts anywhere: people appear only by name.

## Review Focus

1. **A proposal made before this phase has no `page` on its operations.** The page must still render from `op.text`: the head is the first line, the sub-lines are the rest, with no table and no links. Test owner: Task 2 (`toView` on an op without `page`).
2. **A viewer without the catalog right on a package with catalog links.** The links must render as text, and the page must not 403. Test owner: Task 4 (`linkFor` rights).
3. **A decision while the page is stale** (decided in Telegram meanwhile, or expired). The POST answers 409/410 with the service message. The page shows it as a toast and reloads, and the dialogs close. Test owner: Task 2 (409/410 mapping); behaviour in Task 5 mirrors Mikrotik's `dialogStale` and `run`.
4. **Created entities deleted after applying.** `created` resolution must skip missing documents rather than throw. The op still says «✓ Выполнено», without a link. Test owner: Task 2.
5. **A long package (40 operations) on the phone.** The operations panel renders all of them without truncation, and the decision panel comes after them. Test owner: Task 4 (`confirmSummary` with 40 mixed ops); the layout follows the mockup.

---

### Task 1: Per-operation page view, stored at proposal time

**Files:**
- Modify: `services/inventory/changeOps/kit.js` (`defineKind` check result)
- Modify: `services/inventory/changeOps/deviceKinds.js` (createDevice, updateDevice, setDeviceStatus get `page`)
- Modify: `services/inventory/changeOps.js` (`checkPackage` passes `page` through)
- Modify: `services/inventory/changeProposals.js` (store `page` on each operation)
- Modify: `models/inventory/inventoryChange.js` (`operationSchema.page: Schema.Types.Mixed`)
- Modify: `services/inventory/deviceOps.js` only if the patch/status check twins don't already return the current values of the changed fields
- Test: `services/inventory/changeOps.test.js`, `services/inventory/changeProposals.test.js`

**Interfaces:**
- Produces: every checked operation, and every stored `operations[i]`, carries

  ```
  page: {
    head: string,
    subs: string[],
    fields: [{ label, value, before? }],
    links: [{ model, id, label }],
    deferred: boolean,
  }
  ```

  - `head` and `subs` default to the text split on `\n` (each line already collapsed by `oneLine`, as phase 2 does).
  - `deferred` is true when the text carries the « — полная проверка при утверждении» mark; that mark is removed from `head` (the page shows it as a tag).
  - `links` lists every resolved, non-pending entity in `view`. Its `label` is exactly the string the text shows for it (quoted when `quote` is set), so the frontend can find it in `head` and `subs`.
- A kind may define `page(t)` returning `{ head, fields }` to override the head and add the field table.
  - **createDevice:** head «Новое устройство <model or «типа X»>[, конфигурация «…»]». `fields` are the set CREATE_FIELDS in the order the text uses, labelled with the same Russian labels; the inventory number is shown as «выдаст HD» when omitted. Parts of a self-built PC stay as `subs`.
  - **updateDevice:** head «Изменить <device>». `fields` is one row per changed path, `{label, value, before}`; a cleared value reads «очистить».
  - **setDeviceStatus:** head as the text without the cascade tail. `fields: [{label:"статус", value, before}]`, with status labels from `STATUS_LABELS`. The cascade tail (« вместе с деталями: …») stays in `head`.

- [ ] **Step 1: Write the failing tests** in `changeOps.test.js`:
  - `page: createDevice — заголовок без полей, поля табличкой, «выдаст HD»`. Assert `page.head === "Новое устройство типа «Системный блок»"` (fake describe as in the existing createDevice text test) and that `page.fields` contains (values unquoted) `{ label: "компания", value: "ООО Ромашка и партнёры" }` and `{ label: "инвентарный номер", value: "выдаст HD" }` when inventoryNumber is absent.
  - `page: updateDevice — было → стало`. Assert `page.fields` deep-equals `[{ label: "серийный номер", value: "SN-9", before: "SN-1" }, …]` for the existing «Изменить ПК PC-000123: серийный номер → «SN-9»…» case.
  - `page: setDeviceStatus — статус было → стало, каскад в заголовке`: `{ label: "статус", value: "В ремонте", before: "В эксплуатации" }`.
  - `page: ссылки — подписи совпадают с текстом`. For moveDevice, `page.links` deep-equals `[{ model: "ClientDevice", id, label: "ПК PC-000123" }, { model: "Location", id, label: "«Кабинет 214»" }]`, and every `label` is a substring of `page.head`.
  - `page: отложенная операция — пометка не в заголовке, deferred true`.
  - `page: по умолчанию — заголовок и подстроки из текста` (a catalog op: head «Справочники техники», subs = the plan lines).

  In `changeProposals.test.js`: `предложение сохраняет page каждой операции`.
- [ ] **Step 2:** run `node --test services/inventory/changeOps.test.js services/inventory/changeProposals.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - In `defineKind`, record `{ model, id, label }` for each resolved entity: `label` is the same string `t.show(path)` returns.
  - Build `page` after `text(t)` and return it from `check` together with `text`.
  - For `before` values, read the current document through the check twin's result, or one `describe`-style read that returns raw field values; do not add DB reads per field.
  - Keep `text` byte-for-byte unchanged: Telegram rendering must not move.
- [ ] **Step 4:** run the same tests plus `node --test services/inventory/changeRender.test.js services/inventory/changeExecutor.test.js`. Expected: PASS.
- [ ] **Step 5:** run eslint on the touched files. Leave the changes in the tree.

### Task 2: View model and portal HTTP

**Files:**
- Create: `services/inventory/changeView.js`, `services/inventory/changeView.test.js`
- Create: `controllers/inventory/inventoryChange.js`, `controllers/inventory/inventoryChange.test.js`
- Create: `routes/internal/inventory/inventoryChange.js`
- Modify: `routes/index.js` (mount the router alongside the other `/inventory` sub-routers)
- Modify: `routes/inventoryMount.js` (prefix `/changes` → `[inventoryModuleIsActive, isNotClient]`) and `routes/inventoryMount.test.js` (a case `/api/inventory/changes/abc`)
- Modify: `docs/inventory-changes.md` (section «Portal HTTP» in English: the endpoints, who sees what, codes)

**Interfaces:**
- Consumes: `op.page` (Task 1), `STATUS`, `STATUS_LABELS`, `isOpen` (`changeSteps.js`), `MESSAGES` and `liveInventoryDecisions` (`changeDecisions.js`), `isStuck` semantics (`change.stuck === true && status === "failed"`).
- Produces:
  - `changeView.toView(change, viewer, now, { created }) -> View`. `viewer = { userId, canManageDevices, canManageCatalog }`. `created` is a `Map` from `"<model>:<id>"` to `{ label, to? }`, resolved by the controller. `View` is:

    ```
    { _id, title, reason, status, statusLabel, stuck, createdAt, expiresAt, closedAt,
      requestedBy: { _id, name },
      agentName,
      decision: { decision, channel, comment, at } | null,
      operations: [{ index, head, subs, fields, links, deferred,
        result: { state, error, created: [{ model, id, label, to? }] } }],
      created: [{ model, id, label, kindLabel, to? }],
      summary: { create: { type, attribute, group, vendor, supplier, model, configuration, build, device }, change: { count, names } },
      timeline: [{ at, text }],
      my: { canDecide } }
    ```

    - `closedAt` is `decision.at` for rejected, the last timeline entry's `at` for the final statuses, and `null` while open.
    - `kindLabel` ∈ «тип», «атрибут», «группа», «вендор», «поставщик», «модель», «конфигурация», «сборка», «устройство».
    - `summary.change` counts distinct existing `ClientDevice` targets of non-create operations; `names` gives their labels when count ≤ 2.
  - `changeView.canView(change, viewer) -> boolean`, by the rule in Global Constraints.
  - `changeView.createdRefs(change) -> [{ model, id }]`: what the controller has to resolve. It covers `result.created` of the forms `{ device: id }`, `{ model: id }`, `{ configuration: id }`, `{ vendor: id }`, `{ supplier: id }`, `{ build: id }`, and catalog `{ type: {key:id}, attribute: {key:id}, group: {key:id} }`.
  - HTTP, all `isAuth`, under `/api/inventory`:
    - `GET /changes/awaiting-me`, registered before `/:id`. Returns `View[]` (operations included) of the viewer's own `awaiting_requester`, unexpired proposals, newest first, at most 100.
    - `GET /changes/:id` → `View`, with header `X-Pulse-Cursor` set the way the app sets it for every API response. 404 when the proposal is missing, the id is invalid, or `!canView`.
    - `POST /changes/:id/decision` with body `{ decision: "approve"|"reject", comment? }`. Returns 400 «Некорректное решение» on a bad body, 404 for hidden or missing, and the mapped codes on refusal. On success, `View` reloaded after the decide call returns, so it holds the applied result.

- [ ] **Step 1: Write the failing tests.**
  - `changeView.test.js`:
    - `toView: автор видит кнопки, пока открыто и не истекло`: `my.canDecide` is true; false after `expiresAt`; false for a colleague.
    - `canView: автор, право на устройства, право на справочники — да; без прав — нет`.
    - `toView: операция без page — заголовок и подстроки из text` (Review Focus 1).
    - `toView: итог операции и созданное` covers:
      - a created device resolved to `{ label: "NB-000214", to: "/inventory/client-devices/<id>" }`;
      - a missing created document gives `created: []` and keeps state done (Review Focus 4);
      - the `created` panel lists catalog entries with `kindLabel`.
    - `toView: прерванное — stuck true, statusLabel «Не применено»`.
    - `summary: создать и изменить` uses the phase 2 sample package: 1 catalog op with 1 type and 1 attribute, 2 createModel… → the counts.
  - `inventoryChange.test.js`, with fakes in the shape of `mikrotikChange.test.js`:
    - 404 for a stranger;
    - 400 on a bad decision;
    - 409 / 410 / 403 mapping;
    - approve passes `channel:"portal"`;
    - a comment over 300 characters gives 400;
    - `awaitingMe` returns only own, open, unexpired proposals.
- [ ] **Step 2:** run `node --test services/inventory/changeView.test.js controllers/inventory/inventoryChange.test.js routes/inventoryMount.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `toView`, `canView`, `createdRefs`, and `createController({ decisions, repo, now, log })`. `repo` has:
  - `findById(id)`: lean, with `requestedBy` and `timeline.user` populated `firstName lastName`;
  - `listAwaiting(userId)`;
  - `resolveCreated(refs) -> Map`. It does one query per model, takes labels (device: `inventoryNumber || serialNumber`; others: `name`) and builds `to` per the Global Constraints table; a configuration's `to` is its model's page.

  Rights come from the session only, as `req.auth.can({ device: ["manage"] })` and `req.auth.can({ inventoryCatalog: ["manage"] })`. Mount with the lazy real-deps pattern of `mikrotikChange.js`.
- [ ] **Step 4:** run the Step 2 tests. Expected: PASS. Run eslint on the touched files.

### Task 3: Pulse topic, bell link, portal wording

**Files:**
- Modify: `services/pulse.js` (`TOPICS` gains `"inventoryChanges"`), `services/pulseTopics.js` (`InventoryChange: { topics: ["inventoryChanges"], noise: isBookkeeping }`), `models/inventory/inventoryChange.js` (`schema.plugin(require("../../services/pulsePlugin"), …)` as in `models/mikrotikChange.js`)
- Modify: `services/inventory/changeNotifications.js`: every `fanOut` call passes `link: pathOf(change)`, as Mikrotik does at `services/mikrotik/changeNotifications.js:314`
- Modify: `services/inventory/changeRender.js` `BIG_NOTE` and `tg-service/src/bot/inventoryChange.ts` `NOT_FITS`, both to «Пакет большой — утвердить можно в портале» (keep them in sync)
- Modify: `services/mcp/inventoryChangeTools.js`
  - The no-Telegram answer becomes «next: no Telegram message could be sent — the person has no linked Telegram bot (or Telegram notifications are off in the helpdesk); they can approve it in the portal: <link>».
  - The propose answer gives the portal link for the person again; drop the comment that the page comes later.
  - If the tool description changes, re-measure the `routes/mcp.test.js` budget. The cap stays at +5000.
- Modify: `docs/live-updates.md` (topic `inventoryChanges`), `docs/inventory-changes.md` (bell link, wording)
- Test: `services/pulseTopics.test.js` (if it enumerates models), `services/inventory/changeNotifications.test.js`, `services/inventory/changeRender.test.js`, `services/mcp/inventoryChangeTools.test.js`, `tg-service/src/bot/inventoryChange.test.ts`, `routes/mcp.test.js`

**Interfaces:**
- Produces: the pulse topic `inventoryChanges`, bumped on every non-bookkeeping write to `InventoryChange`; the bell rows' `link` = `/inventory/changes/<id>`.

- [ ] **Step 1: Write the failing tests:**
  - `уведомления: колокольчик ведёт на страницу предложения`: `pushInApp` receives `link: "/inventory/changes/<id>"` for proposed, result and expired.
  - The BIG_NOTE text assertion is updated to the new wording, in the backend and in tg-service.
  - The MCP no-Telegram answer contains `approve it in the portal` and the link.
  - If `pulseTopics.test.js` checks the model map, add the `InventoryChange` case.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** as listed in Files.
- [ ] **Step 4:** run:
  - `node --test services/inventory/changeNotifications.test.js services/inventory/changeRender.test.js services/mcp/inventoryChangeTools.test.js routes/mcp.test.js services/pulseTopics.test.js services/pulse.test.js` (the files that exist);
  - `cd tg-service && node --test src/bot/inventoryChange.test.ts`.
  
  Expected: PASS. Then run eslint.

### Task 4: Frontend data layer

**Files:**
- Create: `frontend/src/types/inventoryChange.ts`: `InventoryChangeView`, mirroring Task 2's `View`
- Create: `frontend/src/store/inventory-changes.ts`:
  - `fetchChangeResponse(id)` (raw, for the loader);
  - `decideChange(id, decision, comment?)`;
  - `fetchAwaitingMe()`.
  
  Base `/api/inventory/changes`; style as `store/mikrotik-changes.ts`.
- Create: `frontend/src/util/inventory-changes.ts`, `frontend/src/util/inventory-changes.test.js`

**Interfaces:**
- Consumes: the `View` shape (Task 2).
- Produces (`util/inventory-changes.ts`):
  - `statusTone(status, stuck) -> Tone` (the `Tone` type from `util/mikrotik-changes.ts`). The mapping:
    - `awaiting_requester`, `partial` → `wait`;
    - `applying` → `info`;
    - `done` → `ok`;
    - `failed` → `bad`;
    - `rejected`, `expired` → `idle`.
  - `opsCount(n) -> string`: «1 операция», «3 операции», «9 операций», «21 операция».
  - `segments(text, links, can) -> [{ text, to? }]`. It splits `text` on the first occurrence of each link label, longest label first, with no overlaps. `to` comes from `linkFor(link, can)`. A label that isn't found contributes nothing.
  - `linkFor({ model, id }, can) -> string | null`, by the Global Constraints table. `can` is the `useCan()` function.
  - `confirmSummary(summary, total) -> { title, items: string[] }`.
    - `title` is «Применить N операций?», using `opsCount` in the genitive-after-numeral form already given by `opsCount`.
    - The item «создать: …» uses accusative forms. Count 1 is written without a number. The forms are:

      | Entity | 1 | 2–4 | 5+ |
      |---|---|---|---|
      | тип | тип | типа | типов |
      | атрибут | атрибут | атрибута | атрибутов |
      | группа | группу | группы | групп |
      | вендор | вендор | вендора | вендоров |
      | поставщик | поставщика | поставщиков | поставщиков |
      | модель | модель | модели | моделей |
      | конфигурация | конфигурацию | конфигурации | конфигураций |
      | сборка | сборку | сборки | сборок |
      | устройство | устройство | устройства | устройств |

      The entries are joined with «, », and the last two with « и ».
    - The item «изменить: …» lists `names` when present, otherwise «N устройств» (the same plural forms).
    - An empty side is omitted. Items end with «;» except the last, which ends with «.».
  - `resultLabel(result, stuck) -> { tone: "ok"|"bad"|"idle"|"wait", text }`. The mapping:
    - `done` → «✓ Выполнено»;
    - `failed` → «✗ Не выполнено: <error>»;
    - pending or skipped while stuck → «Результат неизвестен» (tone `wait`);
    - otherwise `skipped` or `pending` → «Не выполнялась», or «Не выполнялась: <error>» when there is an error (drift).

- [ ] **Step 1: Write the failing tests** in `util/inventory-changes.test.js` (header `// node --test src/util/inventory-changes.test.js`). Cover:
  - `opsCount` for 1, 3, 9, 21;
  - `statusTone` for all 7 statuses and for stuck;
  - `segments`:
    - two links in one head;
    - a label appearing twice → only the first is linked;
    - a link without the right → no `to` (Review Focus 2);
    - a missing label is ignored;
  - `confirmSummary`:
    - the mockup sample `{create:{type:1,attribute:1,model:1,configuration:1,device:2}, change:{count:1,names:["ПК PC-000123"]}}`, total 9 → title «Применить 9 операций?», items `["создать: тип, атрибут, модель, конфигурацию и 2 устройства;", "изменить: ПК PC-000123."]`;
    - 40 operations creating 40 devices → «создать: 40 устройств.» (Review Focus 5);
  - `resultLabel`, every branch.
- [ ] **Step 2:** run `cd frontend && node --test src/util/inventory-changes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** run the test again (PASS), then `pnpm exec tsc --noEmit` (only the FormWrapper error) and eslint on the new files.

### Task 5: The proposal page

**Files:**
- Create: `frontend/src/pages/InventoryChange/Change.jsx`, with `loader` as in `pages/Mikrotik/Change.jsx`: a 404 throws the response, `setDocTitle("Предложение ИИ-агента по технике")`, `pulse` from `X-Pulse-Cursor`
- Create: `frontend/src/components/InventoryChange/ChangeOperations.jsx` (the «Что изменится» panel), `frontend/src/components/InventoryChange/ChangeDecision.jsx` (the «Утверждение» panel), `frontend/src/components/InventoryChange/ChangeCreated.jsx` (the «Создано» panel)
- Modify: `frontend/src/App.jsx`: route `inventory/changes/:id`, `handle: { module: "inventory" }`, next to the Mikrotik change route, with the same comment rationale
- Reuse: `components/Mikrotik/ChangeTimeline.jsx` for «Хроника» (import it; don't copy it)

**Interfaces:**
- Consumes: Task 4 (store and util), Task 2 (`View`).

The layout is the mockup's «Страница предложения», state by state:
- **Crumbs:** «Устройства» (a link to `/inventory/client-devices` when `device.read`) › title. Mirror the Mikrotik crumbs: no chain when coming from a page with `location.state.from`.
- **Hero:**
  - kind line «Предложение ИИ-агента по технике»;
  - `h1` with the title;
  - meta row: the status as `DeviceStatusText` with `statusTone`, then `opsCount`, then the time. While open, the time is `expiresPhrase(expiresAt)` from `util/mikrotik-changes`; once closed, `atPhrase(closedAt)`.
- **Left column**, in this order:
  1. Notes, when they apply:
     - partial → warn «Применено K из N операций» plus the body from the mockup, with operation numbers;
     - stuck → warn with `STUCK` title and body.
  2. The «Что изменится» panel:
     - the Eyebrow counter «N операций по порядку»;
     - per operation: the number, `head` via `segments`, `subs` as the dash list, the `fields` table (`before` struck through, then «→»), the tag «полная проверка при утверждении» while open and `deferred`, and the result via `resultLabel` once closed, with links to `created`;
     - the hint under the list while open, from the mockup.
  3. The «Зачем» panel: the reason, plus «Со слов агента <agentName>».
- **Right column**, in this order:
  1. «Утверждение». One step: «<name>, автор запроса».
     - The note under it is one of: «Утверждает весь пакет целиком»; «Утверждено на портале|в Telegram, HH:MM»; «Отклонено …», with the comment in quotes.
     - With `my.canDecide`: the buttons «Утвердить» (primary) and «Отклонить», and the hint from the mockup.
     - Without them, but while open: «Решает только автор запроса.»
  2. «Создано» with a counter, after the apply, when `created` is non-empty.
  3. «Сведения»: «Агент», «Автор», «Создано».
  4. «Хроника».
- **On the phone**, one column in the same order.
- **Dialogs:**
  - «Утвердить» opens `ConfirmDialog` with the title and items from `confirmSummary`, the body «Операции идут по порядку. Если одна не пройдёт, HD остановится, а уже сделанное останется.», and the buttons «Назад» / «Да, применить». The dialog text is frozen when it opens.
  - «Отклонить» opens the reject dialog copied from Mikrotik: «Отклонить предложение?», the description «Изменения не будут применены.», the optional comment (max 300) and «Назад» / «Отклонить».
  - Toasts: approve → «Предложение утверждено»; reject → «Предложение отклонено»; an error shows the server message, then `refresh()`.
  - `dialogStale` handling is the same as Mikrotik's.
  - Live updates: `useLiveRouteRevalidate("inventoryChanges", { baseline: change.pulse })`.

- [ ] **Step 1:** implement the page and its components so that every mockup state renders:
  - waiting as the author;
  - waiting as a colleague;
  - the confirm dialog;
  - applied;
  - partial;
  - stuck;
  - rejected.
- [ ] **Step 2:** run `cd frontend && pnpm exec tsc --noEmit` (only the FormWrapper error) and eslint on the new and touched files. Expected: clean.
- [ ] **Step 3: Static self-check against the mockup.** Write a short table into the report, panel by panel: mockup element → component and class.
  - No playwright and no browser: the owner checks the UI personally.

### Task 6: Dashboard block

**Files:**
- Modify: `frontend/src/components/Dashboard/AgentChanges.jsx`

**Interfaces:**
- Consumes: `fetchAwaitingMe` from `store/inventory-changes.ts` (Task 4) and `opsCount`.

Behaviour:
- **Sources.** The block loads Mikrotik changes when `modules.mikrotik` is on, and inventory proposals when `modules.inventory` is on. It is hidden for clients, as today.
- **Ordering.** The two lists are merged and sorted by `createdAt` descending.
- **Inventory row** (mockup «Главная: блок внимания»):
  - title;
  - the right side `expiryLabel(expiresAt)`, with tone only when `expiresSoon`, as for Mikrotik;
  - meta «Учёт техники. <opsCount>»;
  - the link goes to `/inventory/changes/<id>` with the crumb `from` the way the Mikrotik rows do.
- **Live updates and failures:**
  - `useLiveTopic("inventoryChanges", load, { enabled: inventoryOn && !isEndUser })`;
  - the existing `mikrotikChanges` subscription stays;
  - a failure of one source must not drop the other's rows: load them separately and keep the last good list per source only when that source succeeded; on failure that source's rows go empty, as today's comment says.
- The header counter is the merged count. The block is hidden when both lists are empty.

- [ ] **Step 1:** implement.
- [ ] **Step 2:** run `pnpm exec tsc --noEmit` and eslint on the file. Expected: clean, apart from FormWrapper.
- [ ] **Step 3:** update the file's header comment, which currently describes Mikrotik only.

---

## Docs (folded into the tasks above)
- `docs/inventory-changes.md`:
  - Task 2: the «Portal HTTP» section;
  - Task 3: the topic, the bell link and the wording;
  - Task 5: one line «Portal page: `/inventory/changes/:id` (frontend `pages/InventoryChange/Change.jsx`)». It stays without UI description, per the module-doc convention.
- `docs/live-updates.md`: the topic (Task 3).
- The spec: after Task 6, add the line «Фаза 3 — реализовано 20.10, не закоммичено» under phase 3.
