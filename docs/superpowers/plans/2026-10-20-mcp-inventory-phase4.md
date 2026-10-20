# MCP inventory, phase 4: catalog edits, merges, retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the agent can propose edits of existing catalog entries, merges of duplicates and the retirement of unused entries, inside the existing `propose_inventory_change` package. The requester approves the exact list of references that will move.

**Architecture:**
- **Service layer.** Three new service modules:
  - `catalogRefs` finds references by the spec's table;
  - `catalogEditOps` holds the edit check/apply pairs;
  - `catalogMerge` holds the merge and retire plan/apply.
- **Change kinds.** The new kinds are registered next to the phase-2 kinds, in `changeOps/catalogEditKinds.js` and `changeOps/mergeKinds.js`. They get the same treatment as the phase-2 kinds: typed params, a check twin, `text`, `page`, `targets`.
- **Drift.** A merge or retire stores its reference snapshot on the operation. It recounts at apply, and refuses on any difference.
- **Hidden records.** «Hidden» (`isActive:false` / `deletedAt`) becomes unselectable on the agent path and in the portal pickers.

**Tech Stack:** Node CommonJS, Mongoose, `node:test`; React for the picker filter.

**Spec:** `docs/superpowers/specs/2026-10-20-mcp-inventory-phase4-design.md`. The parent spec is `docs/superpowers/specs/2026-10-16-mcp-inventory-design.md`, and the module doc is `docs/inventory-changes.md`. Mockup: https://claude.ai/artifact/9opwPYPd2n1uphvD5go8U9 (file `.superpowers/sdd/2026-10-20-mcp-inventory-phase4/mockup.html`); it needs the owner's «ок» before Task 9 and before the texts are final.

## Global Constraints

**Process**
- Paths are relative to `backend/` unless they start with `frontend/` or `docs/`.
- **Never run `git commit`, `git push`, `git add` or `git stash`.** Leave changes in the tree. The owner edits the tree in parallel, so keep to your task's files.
- Tests and checks:
  - backend: `node --test <touched files>`. Never run the full backend `pnpm test`.
  - frontend: `pnpm exec tsc --noEmit` (clean) and `pnpm exec eslint <files>`.
  - Use pnpm only. Add no new dependencies.

**Data safety**
- **No `updateMany`/`deleteMany` without an explicit `_id` list from the snapshot,** combined with a condition on the source value (`{ _id: { $in: ids }, <path>: source }`), so a repeat is a no-op. Never touch other collections: tickets, Mikrotik.

**Rights**
- Catalog kinds need `{ inventoryCatalog: ["manage"] }`. Supplier kinds need `{ supplier: ["manage"] }`.
- `mergeModels`, `mergeDeviceTypes`, `mergeConfigurations` and `mergeSuppliers` also require `{ device: ["manage"] }`. Ruling: a static right per kind, not a dynamic one.
- A kind's `right` may be one statement or an array of statements, all of which are required.

**Copy (Russian)**
- No «№». No grammatical gender.
- Names go in «…».
- The verbs, exact:
  - «Изменить <вид> «A»»;
  - «Слить <вид> «A» в «B»»;
  - «Скрыть <вид> «A» (не используется)»;
  - «Удалить пустую группу «A»».
- The words for each entity kind:

  | Entity | Form |
  |---|---|
  | vendor | вендора |
  | supplier | поставщика |
  | model | модель |
  | type | тип |
  | attribute | атрибут |
  | group | группу |
  | configuration | конфигурацию |
  | build | шаблон сборки |

**Merge counts and what the requester sees**
- Count lines use «устройств: N», «конфигураций: N», «сборок: N», «связей: N», «совместимость: у N моделей», «правил помещений: N», «слотов: N», «значений: N», with « и N удалённых» (or «и 1 удалённое») appended when deleted referrers exist.
- The last sub-line says what happens to the source: «<A> скроется», or «группа <A> удалится» for a group.
- The page shows the first 5 device labels as links, then «… и ещё N». The Telegram text shows counts only.

**Retiring a merge source**
- Models and configurations get `deletedAt` and `deletedBy`. Types, attributes, vendors and suppliers get `isActive:false`.
- The source is renamed to `<name> (слито в «<target name>»)`. An attribute also gets code `<code>_merged_<last 6 hex of source id>`.
- A group is hard-deleted.

**Referrers and drift**
- Soft-deleted referrers count as references and are moved by merges. `retire*` refuses only because of live references.
- **Merges and retires on a package's data.** A `merge*`/`retire*`/`deleteGroup` operation is refused at proposal when an earlier operation of the package mentions the source or target id in its params, or has targets that intersect the snapshot ids. The refusal text: «слияние или скрытие предложите отдельным пакетом после утверждения этого».
- `source`/`target` of `merge*`/`retire*` accept existing ids only, never `{ref}`.
- **Drift text.** The text starts with «изменилось после предложения: », then a short Russian phrase. Examples: «на модель «X» появилось 1 новое устройство», «конфигурация «Y» удалена».

## Review Focus

1. **Repeat after a crash mid-merge.** Re-applying the same merge snapshot moves nothing twice and ends with the source retired. Test owner: Task 5 (`merge: повтор после сбоя — ничего не переносится дважды`).
2. **Multiselect option rename and merge.** Rewrite the matching element inside the JSON-array string, not the string as a whole. Keep the order. Drop the duplicate when both old and new are present. Test owner: Task 4 (`renameOptions: multiselect — элемент массива, без дублей`) and Task 6 (`mergeAttributes: multiselect через optionMap`).
3. **Merging into a hidden or deleted target, or merging a record into itself.** Refused at proposal with a clear text. Test owner: Task 5 (`merge: цель скрыта / та же запись — отказ`).
4. **Retiring a record that only soft-deleted documents use.** Allowed; the deleted referrers keep pointing at the hidden record. Test owner: Task 7 (`retireModel: только удалённые устройства — можно`).
5. **Creating a new entry with the name of a hidden (retired, not merged) one.** The agent gets a clear refusal, «имя занято скрытой записью «X» — верните её (isActive) или выберите другое имя», and is never silently re-linked to the hidden record. Test owner: Task 2 (`скрытая запись: создание с тем же именем — понятный отказ`).

---

### Task 1: Reference finder

**Files:**
- Create: `services/inventory/catalogRefs.js`
- Create: `services/inventory/catalogRefs.test.js`

**Interfaces:**
- Produces:
  - `REF_TABLE`: a frozen map. Each entity → list of `{ model, path, kind: "single"|"array"|"subdoc", softDelete: boolean, countLabel }`. Entities: `DeviceModel`, `DeviceType`, `DeviceAttribute`, `Vendor`, `Supplier`, `AttributeGroup`, `DeviceConfiguration`. The table is in spec section «Что есть сейчас»; leave out the dead fields `DeviceType.configurationIds`, `DeviceTypeAttribute.extendableFromIds` and `DeviceConfigurationRecommendation`.
  - `createCatalogRefs({ store }) -> { find(entity, id) -> Promise<Refs>, same(a: Refs, b: Refs) -> { ok, diff: string[] } }`.
    - `Refs = [{ model, path, ids: string[], live: number, deleted: number }]`. Ids are sorted. Empty paths are omitted.
    - `diff` holds Russian phrases for the drift text, per the Global Constraints.
  - `store.query(model, path, kind, id) -> [{ _id, deletedAt? }]` is the only DB seam. The live store lives in the same file, not unit-tested, with lazy `require`s, in the same pattern as `changeOps/names.js`.
  - `countLines(refs) -> string[]` builds the Global Constraints count lines.

- [ ] **Step 1: Write the failing tests:**
  - `find: модель — устройства, конфигурации, сборки, совместимость, с удалёнными отдельно` (a fake store returns 2 live devices and 1 deleted one; assert `live: 2, deleted: 1`);
  - `same: появилось новое — diff «на модель «X» появилось 1 новое устройство»`;
  - `same: исчезло — дрейф`;
  - `countLines: «устройств: 12 и 1 удалённое»`;
  - `REF_TABLE без мёртвых полей` (assert none of the three dead paths appears).
- [ ] **Step 2:** run `node --test services/inventory/catalogRefs.test.js`. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass, and eslint is clean.

### Task 2: Hidden records are not selectable on the agent path

**Files:**
- Modify:
  - `services/inventory/changeOps/names.js` (`describe` also returns `hidden: boolean`);
  - `services/inventory/changeOps/kit.js` (an entity param that points at a hidden record is refused with «<label> «X» скрыт(а)» unless its field spec has `allowHidden: true`);
  - `services/inventory/catalogOps.js` (the create* name-taken checks say «имя занято скрытой записью «X» — верните её (isActive) или выберите другое имя» when the holder is hidden);
  - `services/inventory/catalogSeed.js` (`planCatalog` never reuses a hidden type, attribute or group by name or code; a name clash with a hidden one gives the same refusal);
  - `scripts/seedMikrotikModels.js` (vendor lookup among active vendors only).
- Test: `services/inventory/changeOps.test.js`, `services/inventory/catalogOps.test.js`, `services/inventory/catalogSeed.test.js`.

**Interfaces:**
- Produces: `describe(model, id) -> { name, updatedAt, hidden } | null`, and the field-spec option `allowHidden`. Later tasks set `allowHidden` on the `id` param of `update*` kinds, so a hidden record can be edited and un-hidden.

- [ ] **Step 1: Write the failing tests:**
  - `createModel: скрытый вендор — отказ`;
  - `createDevice: скрытая модель — отказ`;
  - `catalog: скрытый тип с тем же именем не подхватывается — понятный отказ` (Review Focus 5, also for `createVendor`);
  - `describe: hidden у isActive:false и deletedAt`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement. Do not change any portal controller.
- [ ] **Step 4:** run `node --test services/inventory/changeOps.test.js services/inventory/catalogOps.test.js services/inventory/catalogSeed.test.js services/inventory/deviceOps.test.js`. Expected: PASS. Then run eslint.

### Task 3: Edit kinds A — vendor, supplier, model, type, group

**Files:**
- Create: `services/inventory/catalogEditOps.js` and its test
- Create: `services/inventory/changeOps/catalogEditKinds.js`
- Modify: `services/inventory/changeOps.js` (register the kinds; `requiredRights` accepts an array `right`)
- Test: `services/inventory/catalogEditOps.test.js`, `services/inventory/changeOps.test.js`

**Interfaces:**
- Consumes: `describe.hidden` and `allowHidden` (Task 2).
- Produces: kinds `updateVendor`, `updateSupplier`, `updateModel`, `updateDeviceType`, `updateGroup`, with params and refusals exactly as in the spec's «Правка» table.
  - `updateSupplier` takes no `phone`, `email` or `address`; they are unknown params.
  - Each service pair is `check<Kind>(params) -> { ok, before, errors? }` / `apply<Kind>(params, { userId })`. `before` holds only the changed fields, as display values (names for ids).
  - `page(t)` gives the head «Изменить <вид> «A»» and `fields: [{label, value, before}]`.
  - The Telegram text is «Изменить <вид> «A»: <label> → «v», …».
  - Name uniqueness follows the existing portal rule per entity: case-sensitive for type, vendor and supplier; case-insensitive for group; across live models for a model.

- [ ] **Step 1: Write the failing tests.** For each kind: a happy path with before → after, and each refusal in the spec table. Also:
  - `updateDeviceType: isComponent:false у типа в чужом слоте — отказ`;
  - `updateDeviceType: isActive:false при живых моделях — отказ`;
  - `updateSupplier: phone — неизвестный параметр`;
  - `updateVendor: скрытый — можно вернуть isActive:true`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass. Re-run `changeRender.test.js` as well, and eslint.

### Task 4: Edit kinds B — attribute, type↔attribute link, configuration, build

**Files:**
- Modify: `services/inventory/catalogEditOps.js`, `services/inventory/changeOps/catalogEditKinds.js`
- Modify: `models/inventory/inventoryChange.js` (operation field `refs: Schema.Types.Mixed`, used by `renameOptions` and by Tasks 5–7)
- Test: the same test files as Task 3

**Interfaces:**
- Consumes: `createCatalogRefs` (Task 1).
- Produces kinds `updateAttribute`, `updateTypeAttribute`, `unlinkAttribute`, `updateConfiguration`, `updateBuild`, following the spec table:
  - **`updateAttribute`** takes `name`, `unit`, `isActive`, `addOptions[]`, `renameOptions[{from,to}]`. Code/name uniqueness checks `code` OR `name`, because of the stale `name_1`. `valueType` is not accepted. `renameOptions` snapshots the affected configuration ids into `op.refs` at proposal; apply recounts them (drift on difference) and rewrites `select` values and `multiselect` array elements in place. The field row reads «переименовать вариант: «DDR-4» → «DDR4» · в 7 конфигурациях».
  - **`updateTypeAttribute`** changes `required`, `order`, `groupId`.
  - **`unlinkAttribute`** is refused when the attribute is in this type's `keySpecs`, or when any configuration of a model of this type has a value for it.
  - **`updateConfiguration`** takes `setValues` and `clearValues`, with values validated as in `createConfiguration`.
  - **`updateBuild`** takes `name`, `notes` and `parts` (replaced whole, through the same `buildFields` rules as `createBuild`).

- [ ] **Step 1: Write the failing tests:**
  - `renameOptions: select — значения переписаны по списку`;
  - `renameOptions: multiselect — элемент массива, без дублей` (Review Focus 2: `'["DDR-4","DDR4"]'` → `'["DDR4"]'`, order kept);
  - `renameOptions: при утверждении новая конфигурация — дрейф`;
  - `updateAttribute: valueType — неизвестный параметр`;
  - `updateAttribute: имя занято по name_1 — отказ`;
  - `unlinkAttribute: в keySpecs — отказ`;
  - `unlinkAttribute: есть значения — отказ`;
  - `updateConfiguration: значение не по options — отказ`;
  - `updateBuild: части по правилам сборки`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass, and eslint is clean.

### Task 5: Merge engine, simple merges and the package rule

**Files:**
- Create: `services/inventory/catalogMerge.js` and its test
- Create: `services/inventory/changeOps/mergeKinds.js`
- Modify: `services/inventory/changeOps.js` (register the kinds; enforce the Global Constraints package rule for merge/retire kinds using `ctx.earlier` and the snapshot ids)
- Test: `services/inventory/catalogMerge.test.js`, `services/inventory/changeOps.test.js`

**Interfaces:**
- Consumes: `createCatalogRefs` (Task 1), `describe.hidden` (Task 2), and `op.refs` (Task 4 schema).
- Produces:
  - `createCatalogMerge({ refs, store, now })` with:
    - `plan(entity, sourceId, targetId) -> { ok, refs, conflicts: string[], targets, lines, deviceLabels: string[] }`;
    - `apply(entity, snapshot, { userId }) -> { ok, moved: { [countLabel]: n }, error? }`.
  - `apply` steps:
    1. Recount, and drift-check with `refs.same`.
    2. Rewire by ids with the source condition. Arrays use `arrayFilters`, and source → target is replaced without creating duplicates.
    3. Retire the source last (Global Constraints «Retiring a merge source»).
  - **Kinds** `mergeVendors`, `mergeSuppliers`, `mergeGroups`, `mergeModels` with params `{ source, target }`.
    - The text is «Слить <вид> «A» в «B»», with sub-lines from `countLines` plus the source-fate line.
    - `page`: the head, `fields` as the count rows, and `subs` = the device labels line (first 5 linked, then «… и ещё N») plus the source-fate line.
  - **`mergeModels` rules:**
    - The same `deviceTypeId` is required.
    - The target keeps its vendor.
    - `compatibleWithModelIds`: other models have source replaced by target without duplicates; the target gets the union, minus itself.
    - The source's configurations move to the target.

- [ ] **Step 1: Write the failing tests** in `catalogMerge.test.js`, with a fake store:
  - `mergeModels: переносит устройства, конфигурации, сборки, совместимость по списку`;
  - `mergeModels: разные типы — отказ`;
  - `merge: цель скрыта / та же запись — отказ` (Review Focus 3);
  - `merge: при утверждении новое устройство — дрейф, ничего не перенесено`;
  - `merge: повтор после сбоя — ничего не переносится дважды` (Review Focus 1: apply after a partial rewire finishes the rest and retires the source);
  - `merge: источник переименован «(слито в «B»)» и скрыт`;
  - `mergeGroups: связи в цель, источник удалён`.

  And in `changeOps.test.js`:
  - `пакет: правка конфигурации → слияние атрибута в одном пакете — отказ «отдельным пакетом»`;
  - `пакет: source как {ref} — отказ`;
  - `права: mergeModels требует и справочники, и устройства`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run `node --test services/inventory/catalogMerge.test.js services/inventory/changeOps.test.js services/inventory/changeRender.test.js services/inventory/changeExecutor.test.js`. Expected: PASS. Then run eslint.

### Task 6: Complex merges — attributes, configurations, types

**Files:**
- Modify: `services/inventory/catalogMerge.js`, `services/inventory/changeOps/mergeKinds.js`
- Test: `services/inventory/catalogMerge.test.js`

**Interfaces:**
- Consumes: the Task 5 engine.
- Produces kinds `mergeAttributes`, `mergeConfigurations` and `mergeDeviceTypes`, with exactly the spec's «Особые правила»:
  - **`mergeAttributes`**:
    - `valueType` must be equal.
    - It takes `optionMap { sourceValue: targetValue }` for select/multiselect. Unmapped source options are added to the target.
    - Conflicting configuration values make the proposal fail, with one sub-line per configuration: «<model> «<config>»: <a> и <b>».
    - Equal values: the source value is dropped.
    - Links: drop the source link where the type already links the target; otherwise repoint it.
    - `keySpecs.attributeId` is repointed.
  - **`mergeConfigurations`**: the same model only. Any source value that is missing from the target or differs from it is a conflict.
  - **`mergeDeviceTypes`**:
    - It is refused when the source has `assembly.enabled`, slots, keySpecs or builds.
    - `isComponent`, `isPeripheral` and `isConsumable` must be equal.
    - Links are unioned, by the attribute rule.
    - `attachableToTypeIds`, other types' slots and keySpecs, and `Location` overrides are repointed without duplicates.
    - The target's prefix is kept.

- [ ] **Step 1: Write the failing tests:**
  - `mergeAttributes: конфликт значений — отказ со списком конфигураций`;
  - `mergeAttributes: одинаковые значения — значение источника убрано`;
  - `mergeAttributes: multiselect через optionMap` (Review Focus 2);
  - `mergeAttributes: связь с целью уже есть — связь источника удалена`;
  - `mergeAttributes: keySpecs переведены`;
  - `mergeConfigurations: другая модель — отказ`;
  - `mergeConfigurations: лишнее значение в источнике — конфликт`;
  - `mergeDeviceTypes: у источника сборочная схема — отказ «в портале»`;
  - `mergeDeviceTypes: правила помещений и attachableToTypeIds переведены без дублей`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass, and eslint is clean.

### Task 7: Retire kinds

**Files:**
- Modify: `services/inventory/catalogMerge.js`, `services/inventory/changeOps/mergeKinds.js`
- Test: `services/inventory/catalogMerge.test.js`

**Interfaces:**
- Produces kinds `retireAttribute`, `retireModel`, `retireVendor`, `retireSupplier`, `retireDeviceType` and `deleteGroup`, with params `{ id }`.
  - **Refusal at proposal:** live references exist. List them with `countLines`.
  - **Snapshot:** the deleted-referrer snapshot is stored for drift.
  - **Apply:**
    1. Recount. Any new live reference is drift.
    2. Retire the record, without renaming it.
  - `deleteGroup` deletes an empty group.
  - **Text:** «Скрыть <вид> «A» (не используется)», or «Удалить пустую группу «A»».

- [ ] **Step 1: Write the failing tests:**
  - `retireModel: живые устройства — отказ с числами`;
  - `retireModel: только удалённые устройства — можно` (Review Focus 4);
  - `retireAttribute: при утверждении появилась связь — дрейф`;
  - `deleteGroup: пустая — удалена; со связями — отказ`.
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the tests pass, and eslint is clean.

### Task 8: Agent side — findings, tool text, docs

**Files:**
- Modify:
  - `services/mcp/inventoryFindings.js` (`catalogDuplicates` adds vendors and suppliers by name, groups by name, and configurations of one model by name and, separately, by equal value sets; the same `dupKey`; item kinds `vendor|supplier|group|configuration`);
  - `services/mcp/inventoryChangeTools.js` (the operation-kind list in the tool description gains the new kinds in one compact line each; the propose answer includes the merge/retire count lines and the conflicts);
  - `services/mcp/server.js` INSTRUCTIONS `inventoryChanges` (one paragraph: merge only on a `catalogDuplicates` finding or on the person's explicit request; resolve conflicts in a separate proposal first; hidden records are not selectable);
  - `routes/mcp.test.js` (re-measure the budget; ruling: the cap for `inventoryChanges` may rise to at most +7000 over BASELINE 30181, and nothing else may grow);
  - `docs/inventory-changes.md` (operations table, merge/retire lifecycle, hidden records, the `refs` snapshot, rights — in English, no UI);
  - `docs/mcp.md` (the kinds list).
- Test: `services/mcp/inventoryFindings.test.js`, `services/mcp/inventoryChangeTools.test.js`, `routes/mcp.test.js`

- [ ] **Step 1: Write the failing tests:**
  - `catalogDuplicates: вендоры «Lenovo» и «LENOVO » — одна группа`;
  - `catalogDuplicates: конфигурации одной модели с одинаковыми значениями`;
  - `propose: слияние — ответ с числами ссылок`;
  - `описание: все виды операций перечислены` (extend the existing parity test so that it covers the KINDS registry).
- [ ] **Step 2:** run the tests. Expected: FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run `node --test services/mcp/inventoryFindings.test.js services/mcp/inventoryChangeTools.test.js routes/mcp.test.js`. Expected: PASS. Then run eslint.

### Task 9: Portal pickers hide hidden records (after the mockup «ок»)

**Files:**
- Modify: the option lists in:
  - `frontend/src/components/ClientDevice/FormFields.jsx` (model, type, supplier, configuration, build);
  - `frontend/src/components/DeviceModel/FormFields.jsx` (type, vendor, compatible models);
  - `frontend/src/components/DeviceConfiguration/Form.jsx` (model);
  - the build form under `frontend/src/components/DeviceBuild/` (models, configurations).
- Create: `frontend/src/util/hidden-options.ts` and `frontend/src/util/hidden-options.test.js`

**Interfaces:**
- Produces `visibleOptions(items, currentIds: string[]) -> items`. It drops items with `isActive === false` or with `deletedAt` set, unless the item's id is in `currentIds`, so a saved form still shows its current value.

- [ ] **Step 1: Write the failing test** `visibleOptions: скрытые убраны, текущее значение оставлено`.
- [ ] **Step 2:** run `cd frontend && node --test src/util/hidden-options.test.js`. Expected: FAIL.
- [ ] **Step 3:** implement, and apply it in each listed picker. If a loader already filters hidden records server-side, note it and skip that picker. There is no visual change.
- [ ] **Step 4:** run the test (PASS), `pnpm exec tsc --noEmit` (clean), and eslint on the touched files.
