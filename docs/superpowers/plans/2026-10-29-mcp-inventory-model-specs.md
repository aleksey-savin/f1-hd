# MCP-инвентарь: агент заполняет характеристики моделей — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** агент находит спецификации моделей на официальном сайте производителя и предлагает атрибуты типа и значения моделей. Работает по просьбе человека и сам по расписанию. В автоматическом режиме утверждает тот, кто завёл модель.

**Architecture:**
- **Новые данные:** два поля (`Vendor.website`, `DeviceModel.specUrl`) и коллекция отметок `ModelSpecCheck`.
- **Новый режим** `forModelCreator` у `propose_inventory_change` со своей рамкой пакета.
- **Пакет начинает видеть свои атрибуты.** `updateConfiguration` учитывает атрибуты, связи и варианты, которые создают более ранние операции этого же пакета. Без этого главный сценарий «атрибут + значение одним пакетом» сейчас отказывает при предложении.
- **Для агента:** находка `modelsWithoutSpecs` и инструмент `record_model_spec_check`.
- **Портал:** только поля и ссылки, через макет.

**Tech Stack:** Node.js + Mongoose (CommonJS), тесты `node:test`; React + Vite + TypeScript, Tailwind/shadcn (`components/app`).

**Spec:** `docs/superpowers/specs/2026-10-29-mcp-inventory-model-specs-design.md`. Механика пакетов описана в `docs/inventory-changes.md`, инструменты — в `docs/mcp.md`.

## Global Constraints

- **Git:** никаких `git commit`/`push`/`add`/`stash`, git ведёт владелец. Шаг «Commit» в задачах не выполняется.
- **Тесты:** только затронутые файлы, `cd backend && node --test <files>`. Полный `pnpm test` не запускать.
- **Шум логгера:** файлы `backend/logs` принадлежат root. Строка «not ok» на уровне файла из-за EACCES логгера — шум, считаются только подтесты.
- **Менеджер пакетов:** только pnpm.
- **Массовые записи:** никаких слепых `deleteMany`/`updateMany`. Писать только по `_id`, чужие коллекции не трогать.
- **Язык текстов:** людям — по-русски, без «№» (номер есть только у заявки), без рода («вы завели», не «он завёл»). Агенту — по-английски.
- **Telegram:** только простой текст (`escapeHtml` / plain), без HTML-разметки.
- **Контакты:** контакты сотрудников не уходят агенту. В находке нет имени и контактов заведшего модель.
- **Агент не пишет в инвентарь.** Единственная прямая запись агента — `ModelSpecCheck`, через `record_model_spec_check`.
- **UI:** только после макета (обе темы, десктоп и мобайл) и «ок» владельца. Форма модели — одна `DeviceModel/FormFields.jsx`, без своих мини-форм.
- **Пределы:** 40 операций на пакет, 5 открытых предложений на автора, 40 предложений в сутки на ключ (`changeProposals.js`) — не менять.
- **`website` вендора:** домены без схемы и пути, в нижнем регистре, через запятую.
- **`specUrl`:** только `https`, хост — один из доменов или их поддомен.
- **Окно находки:** `days` по умолчанию 30, `note` не длиннее 300 символов.

## Review Focus

1. **Атрибут-список.** Новый вариант дописывается той же `catalog` (подхват атрибута) или `updateAttribute.addOptions`, а `setValues` того же пакета выбирает этот вариант. Ожидается, что предложение принято и применение проходит. Тест — в задаче 3.
2. **Атрибут подхвачен каталогом по имени, а код у него другой.** Агент указал в `catalog` код `diagonal`, а в базе есть «Диагональ» с кодом `screen_size`. `setValues` по `diagonal` должен получить понятный отказ, а `setValues` по `screen_size` — пройти. Тест — в задаче 3.
3. **`specUrl` на поддомене или с другим регистром.** `https://WWW.Dell.com/...` при `website: "dell.com"` принимается. `https://dell.com.evil.ru/...` и `http://dell.com/...` отказывают. Тест — в задаче 1.
4. **Повторный прогон расписания.** Модель, у которой человек вписал `specUrl`, а значения оставил пустыми, после предложения только с `setValues` больше не всплывает в находке. Тест — в задаче 4.
5. **Предложение отказано целиком.** Ни одной отметки `proposed` нет, и модель всплывёт снова (отметка пишется только при успешной записи предложения). Тест — в задаче 4.

---

### Task 1: Данные и проверка источника

**Files:**
- Create: `backend/services/inventory/specSource.js`, `backend/services/inventory/specSource.test.js`, `backend/models/inventory/modelSpecCheck.js`
- Modify:
  - `backend/models/inventory/vendor.js` (поле `website`);
  - `backend/models/inventory/deviceModel.js` (поле `specUrl`);
  - `backend/controllers/inventory/vendor.js` (create/update принимают `website` через `normalizeDomains`, ошибка → 400);
  - `backend/controllers/inventory/deviceModel.js` (create/update принимают `specUrl` как строку, только trim, домен не проверяется — решение спеки);
  - `docs/inventory.md` (поля вендора и модели).

**Interfaces:**
- Produces:
  - `normalizeDomains(text: string | null | undefined) -> { value: string | undefined } | { error: string }`. Пустое → `{ value: undefined }`. Схема, путь и `www.` срезаются, всё в нижнем регистре, без повторов, через запятую. Невалидный домен (нет точки, пробел, пустая часть) → `{ error: "Неверный сайт вендора: «…»" }`.
  - `specUrlError(url: string, website: string | undefined, vendorName: string) -> string | null`. Возможные ошибки: `"Страница спецификации должна быть адресом https"`, `"У вендора «X» не указан сайт"`, `"Ссылка не на сайт производителя (dell.com)"`. В скобках — домены вендора через запятую.
  - Модель `ModelSpecCheck` (`models/inventory/modelSpecCheck.js`): `{ modelId (ref DeviceModel, unique), outcome: enum ["proposed","complete","notFound","skipped"], url, note (maxlength 300), changeId (ref InventoryChange), keyId, keyName, at: Date }`, timestamps.

- [ ] **Step 1: Write the failing tests** в `specSource.test.js`:
  - `normalizeDomains`:
    - `"https://www.Dell.com/ru-ru, hp.com"` → `{ value: "dell.com,hp.com" }`;
    - `"dell.com, dell.com"` → `{ value: "dell.com" }`;
    - `""` → `{ value: undefined }`;
    - `"dell"` → error.
  - `specUrlError`, при `website` `"dell.com,delltechnologies.com"`:
    - `null` для `https://www.dell.com/x`, `https://WWW.DELL.COM/x` и `https://delltechnologies.com/x`;
    - ошибка https для `http://dell.com/x`;
    - ошибка домена для `https://dell.com.evil.ru/x` и `https://notdell.com/x`;
    - ошибка «не указан сайт» при `website` `undefined`;
    - ошибка https для строки `"not a url"`.
- [ ] **Step 2:** `node --test services/inventory/specSource.test.js` → FAIL (модуля нет).
- [ ] **Step 3:** реализовать `specSource.js`. Хост брать через `new URL()`. Совпадение: `host === d || host.endsWith("." + d)`. Добавить поля моделей, `ModelSpecCheck` и контроллеры.
- [ ] **Step 4:** `node --test services/inventory/specSource.test.js` → PASS.
- [ ] **Step 5:** `pnpm --filter backend exec eslint models/inventory controllers/inventory/vendor.js controllers/inventory/deviceModel.js services/inventory/specSource.js` → без ошибок.

### Task 2: Правки `updateVendor.website` и `updateModel.specUrl`

**Files:**
- Modify:
  - `backend/services/inventory/catalogEditOps.js` (`FIELDS`, `EDITABLE`, `normalize`, `kindRules`);
  - `backend/services/inventory/changeOps/catalogEditKinds.js` (поля агента, `LABELS`);
  - `backend/services/mcp/inventoryChangeTools.js` (описание параметров в `INVENTORY_PROPOSE_DESCRIPTION`);
  - `docs/inventory-changes.md` (таблица видов: строки `updateVendor`, `updateModel`).
- Test: `backend/services/inventory/catalogEditOps.test.js`, `backend/services/inventory/changeOps.test.js`

**Interfaces:**
- Consumes: `normalizeDomains`, `specUrlError` (Task 1).
- Produces:
  - `EDITABLE.vendor = ["name", "isActive", "website"]`, `EDITABLE.model` + `"specUrl"`;
  - `LABELS.specUrl = "страница спецификации"`; у вендора `LABELS.website` уже «сайт».
  - Правка модели принимает опцию `vendorWebsite?: string` — сайт вендора, который задаст более ранний `updateVendor` того же пакета. При применении её нет: значение уже в базе.

- [ ] **Step 1: Write the failing tests:**
  - `catalogEditOps.test.js`:
    - у вендора `website: "https://www.Dell.com/"` → `set.website === "dell.com"`, было «—»;
    - `website: "dell"` → 400;
    - у поставщика `website` не нормализуется (поведение прежнее);
    - `specUrl` модели вендора с `website: "dell.com"`: `https://www.dell.com/p` проходит, `https://shop.ru/p` → 400 «Ссылка не на сайт производителя (dell.com)»;
    - у вендора без сайта → 400 «не указан сайт», а с опцией `vendorWebsite: "dell.com"` проходит;
    - при одновременной смене `vendorId` и `specUrl` проверяется сайт нового вендора.
  - `changeOps.test.js`: пакет `[updateVendor {id: V, website: "dell.com"}, updateModel {id: M (vendor V), specUrl: "https://dell.com/p"}]` при вендоре без сайта проходит `checkPackage`; тот же `updateModel` без первой операции — отказ.
- [ ] **Step 2:** `node --test services/inventory/catalogEditOps.test.js services/inventory/changeOps.test.js` → новые подтесты FAIL.
- [ ] **Step 3:** реализовать:
  - `normalize` для пары `kind === "vendor" && name === "website"` идёт через `normalizeDomains`;
  - `kindRules.model`, если в `next` есть `specUrl`: вендор = `next.vendorId ?? doc.vendorId`, сайт = `options.vendorWebsite ?? vendor.website`, затем `specUrlError`;
  - в виде `updateModel` (`catalogEditKinds.js`) `vendorWebsite` берётся из `ctx.earlier`: последний `updateVendor` с тем же `id` вендора и полем `website`, пропущенный через `normalizeDomains`.
- [ ] **Step 4:** те же тесты → PASS. Старые подтесты обоих файлов тоже зелёные.

### Task 3: Пакет видит свои атрибуты (`provides`)

**Files:**
- Modify:
  - `backend/services/inventory/catalogOps.js` (`checkCatalogPatch` отдаёт `provides`);
  - `backend/services/inventory/catalogEditOps.js` (`attributeOptions` отдаёт `provides`, `configurationValues` учитывает `options.provided`);
  - `backend/services/inventory/changeOps/kit.js` (`defineKind.check` передаёт `checked.provides` дальше);
  - `backend/services/inventory/changeOps.js` (`checkPackage` копит `provides` и передаёт `ctx.provided` в `check`; в `items` поле не сохраняется);
  - `backend/services/inventory/changeOps/catalogEditKinds.js` (`updateConfiguration` передаёт `ctx.provided` в сервис);
  - `docs/inventory-changes.md` (раздел «Refs between operations»: абзац про `provided`).
- Test: `backend/services/inventory/catalogOps.test.js`, `catalogEditOps.test.js`, `changeOps.test.js`

**Interfaces:**
- Produces:
  ```
  provides = {
    attributes: [{ code, name, valueType, unit?, options: [{ value, label }] }], // создаёт каталог (код — как в плане)
    links:      [{ typeId: string, code }],                                     // связь с существующим типом
    options:    [{ code, values: string[] }],                                   // новые варианты существующего атрибута
  }
  ```
  - `checkCatalogPatch(...)` при `ok` дополнительно отдаёт `provides` и `plan` (`create`, `update`, `matched` из `planCatalog`; для рамки Task 4). Ключи `plan`: `create.groups/types/attributes/links`, `update.attributeOptions/linkGroups/typeFlags/typeAssembly`.
  - В `links` код у подхваченного атрибута — **код из базы**, у созданного — из плана. Связи с новыми типами в `links` не попадают.
  - `attributeOptions` кладёт `{ options: [{ code, values: added }] }` в `acc.out.provides`.
  - `ctx.provided` — слияние `provides` всех более ранних успешно разобранных операций, в порядке пакета. Есть только при предложении.
  - `configurationValues(store, doc, args, options, acc)`: при `options.provided` атрибут по коду ищется сначала в базе, потом в `provided.attributes`. Связь с типом засчитывается и из `provided.links` того же `typeId`. Варианты атрибута = база ∪ `provided.options` по коду. Остальная логика не меняется: строки «было → стало» по текущим значениям конфигурации.

- [ ] **Step 1: Write the failing tests:**
  - `catalogOps.test.js`: каталог с существующим типом «Монитор», новым атрибутом `{code:"refresh", valueType:"number", unit:"Гц"}` и подхваченным `select`-атрибутом «Матрица» с новым вариантом `"OLED"` отдаёт:
    - `provides.attributes[0].code === "refresh"`;
    - `provides.links` — связи с id «Монитор» для `refresh`;
    - `provides.options` — `[{code:"<код матрицы из базы>", values:["OLED"]}]`.
  - `changeOps.test.js` (Review Focus 1, 2):
    - `[catalog(…выше…), updateConfiguration{ id: C (модель типа «Монитор»), setValues:[{attribute:"refresh", value:144}, {attribute:"<код матрицы>", value:"OLED"}] }]` → `ok`. В `page.fields` есть строки «было —» → «144 Гц» и «OLED»;
    - тот же `updateConfiguration` без каталога → отказ «Атрибут «refresh» не найден»;
    - каталог подхватил «Диагональ» с кодом `screen_size` по имени, а агент указал код `diagonal`: `setValues` по `diagonal` → отказ «не найден», по `screen_size` → `ok`;
    - `[updateAttribute{id: A(select), addOptions:["IPS Black"]}, updateConfiguration{setValues:[{attribute:<код A>, value:"IPS Black"}]}]` → `ok`.
  - `catalogEditOps.test.js`: `configurationValues` без `provided` ведёт себя как раньше: прежние подтесты зелёные.
- [ ] **Step 2:** `node --test services/inventory/catalogOps.test.js services/inventory/catalogEditOps.test.js services/inventory/changeOps.test.js` → новые FAIL.
- [ ] **Step 3:** реализовать, как в Interfaces. `items` и сохраняемое предложение `provides`/`plan` не несут: только проход проверки и рамка Task 4 (`checkPackage` возвращает их отдельным массивом `effects[i]`, выровненным с `items`).
- [ ] **Step 4:** тесты → PASS. Прогнать и `services/inventory/changeExecutor.test.js` — должен быть зелёный.

### Task 4: Режим `forModelCreator`, рамка пакета, отметки

**Files:**
- Create:
  - `backend/services/inventory/modelSpecFrame.js`, `backend/services/inventory/modelSpecFrame.test.js`;
  - `backend/services/inventory/modelSpecChecks.js`, `backend/services/inventory/modelSpecChecks.test.js`.
- Modify:
  - `backend/services/inventory/changeProposals.js` (автор из модели, рамка, `origin`, отметки после `create`);
  - `backend/models/inventory/inventoryChange.js` (поле `origin`);
  - `docs/inventory-changes.md` (новый раздел «Model specs (agent)»: режим, рамка, отметки).
- Test: `backend/services/inventory/changeProposals.test.js`

**Interfaces:**
- Consumes: `checkPackage(...) -> { ok, reasons, items, effects }` (Task 3, `effects[i].plan` у `catalog`, `effects[i].provides`).
- Produces:
  - `InventoryChange.origin?: { kind: "modelSpecs", modelId: ObjectId }`. Есть только в режиме `forModelCreator`.
  - `frameErrors(model: { _id, deviceTypeId, vendorId }, items, effects, lookup) -> string[]`. `lookup` — `{ vendor(id) -> { website }, configurationModel(id) -> modelId, attributeTypeLinked(attrId, typeId) -> bool }`. Разрешено только:
    - `updateModel`: `id === model._id`, поля только `specUrl` и/или `notes`;
    - `updateConfiguration`: конфигурация этой модели, только `setValues`;
    - `updateVendor`: `id === model.vendorId`, поле только `website`, и текущий `website` вендора пуст;
    - `updateAttribute`: только `addOptions`, у атрибута, связанного с типом модели (в базе или через `provides.links`);
    - `catalog`: в `plan.create.types` и `plan.create.groups` пусто, в `plan.update.typeFlags` и `plan.update.typeAssembly` пусто, все `plan.create.links` и `plan.update.linkGroups` — только тип модели, `matched.types` — только тип модели.

    Остальные виды и цели дают причину `"Операция N: в предложении для модели «X» можно менять только эту модель, её конфигурации, атрибуты её типа и пустой сайт вендора"`.
  - `modelSpecChecks`:
    - `modelsTouched(items, configurationModel) -> Promise<string[]>`: модели из `updateModel.id` и моделей конфигураций `updateConfiguration.id`, без повторов;
    - `markProposed(store, { modelIds, change, caller })`: upsert по `modelId` с `outcome: "proposed"`, `changeId`, `url` = `specUrl` из пакета или уже сохранённый у модели, `keyId`, `keyName`, `at`;
    - `record(store, { modelId, outcome, note, url, caller })`: для инструмента Task 6, `outcome` ∈ `complete | notFound | skipped`.
  - `createProposals(...).propose(input, caller)`:
    - принимает `input.forModelCreator` (24-hex) вместо `input.requester`. Оба сразу или ни одного → `"give either requester or forModelCreator"`;
    - автор = `createdBy` модели через новый `store.findModelCreator(modelId) -> { user, model } | { error }`;
    - ошибки: `"model not found"`, `"the model has no creator: nobody can approve; record it as skipped"`, `"the model's creator cannot approve (banned / not staff / service account)"`;
    - Telegram у автора не обязателен;
    - права и пределы — как сейчас;
    - после `store.create` вызывает `markProposed` для `modelsTouched` в любом режиме. При отказе отметки не пишутся.

- [ ] **Step 1: Write the failing tests:**
  - `modelSpecFrame.test.js`: каждый разрешённый случай проходит. Отказ с текстом рамки дают:
    - `updateModel` чужой модели;
    - `updateModel` с `name`;
    - `updateVendor` при уже заданном сайте;
    - `catalog` с новым типом;
    - `catalog` с `flags`;
    - `catalog`, где связь с другим типом;
    - `createDevice`.
  - `modelSpecChecks.test.js`:
    - `modelsTouched` собирает модель из `updateModel` и из конфигурации;
    - `markProposed` берёт `url` из пакета, а без него — сохранённый `specUrl` модели (Review Focus 4).
  - `changeProposals.test.js`:
    - `forModelCreator` + `requester` → отказ;
    - модель без `createdBy` → отказ «no creator»;
    - автор без Telegram → предложение создано, `requestedBy` = создатель, `origin.kind === "modelSpecs"`;
    - пакет вне рамки → отказ с текстом рамки;
    - после успешного предложения `markProposed` вызван с моделью;
    - при отказе пакета (неверная операция) `markProposed` не вызван (Review Focus 5);
    - обычный режим с `requester` тоже ставит отметку модели, которую трогает пакет.
- [ ] **Step 2:** `node --test services/inventory/modelSpecFrame.test.js services/inventory/modelSpecChecks.test.js services/inventory/changeProposals.test.js` → FAIL.
- [ ] **Step 3:** реализовать. В `mongoStore` добавить:
  - `findModelCreator`: живая модель, затем пользователь `createdBy`. Проверки те же, что у `pickRequester`, кроме Telegram: `isEndUser === false`, не служебная учётка, `!isBanned`;
  - `configurationModel(id)`, `vendor(id)`, `attributeTypeLinked(attrId, typeId)`;
  - запись `ModelSpecCheck` через `findOneAndUpdate({ modelId }, …, { upsert: true })`.
- [ ] **Step 4:** тесты → PASS.

### Task 5: Уведомление в режиме `forModelCreator`

**Files:**
- Modify: `backend/services/inventory/changeNotifications.js`, `backend/services/inventory/changeRender.js` (заголовок текста, если там собирается `present`)
- Test: `backend/services/inventory/changeNotifications.test.js`

**Interfaces:**
- Consumes: `change.origin` (Task 4).
- Produces: `proposed(change)` при `origin.kind === "modelSpecs"`:
  - Telegram без `force`, через выключатели категории;
  - колокольчик всегда: `force` для in-app, если общий `fanOut` это позволяет, иначе как сейчас;
  - заголовок и первая строка: `Агент нашёл характеристики модели «<имя модели>», которую вы завели`.

  Без `origin` поведение прежнее.

- [ ] **Step 1: Write the failing tests:**
  - с `origin` и выключенным Telegram в категории `inventoryChange` Telegram не уходит, колокольчик уходит, текст начинается с «Агент нашёл характеристики модели «Dell P2422H», которую вы завели»;
  - без `origin` и с выключенным Telegram — уходит, как сейчас (`force`).
- [ ] **Step 2:** `node --test services/inventory/changeNotifications.test.js` → FAIL.
- [ ] **Step 3:** реализовать. Имя модели — через уже подключённый `context(change)` или новый лёгкий lookup в нём, без новой выборки на каждый вызов.
- [ ] **Step 4:** тест → PASS. Прогнать и `services/inventory/changeRender.test.js`.

### Task 6: Агентская сторона: находка, отметка, строки, инструкции

**Files:**
- Modify:
  - `backend/services/mcp/inventoryFindings.js` (вид `modelsWithoutSpecs` в `CATALOG_KINDS`, окно в `WINDOWS`);
  - `backend/services/mcp/inventorySource.js` (данные для находки: модели за окно без отметки, отметки, оценка автора);
  - `backend/services/mcp/inventoryTools.js` (строка `spec check` у модели в `search_device_models`);
  - `backend/services/mcp/inventoryChangeTools.js` (`forModelCreator` в схеме `propose`, инструмент `record`);
  - `backend/services/mcp/server.js` (регистрация `record_model_spec_check` в семействе `inventoryChanges`, правила агента в инструкциях);
  - `backend/routes/mcp.test.js` (список инструментов по scope, перемер бюджета `tools/list`);
  - `docs/mcp.md` (инструменты, правила, готовая формулировка задачи cron для OpenClaw).
- Test: `backend/services/mcp/inventoryFindings.test.js`, `inventorySource.test.js`, `inventoryTools.test.js`, `inventoryChangeTools.test.js`, `backend/routes/mcp.test.js`

**Interfaces:**
- Consumes: `ModelSpecCheck`, `modelSpecChecks.record` (Task 4), `propose` с `forModelCreator` (Task 4).
- Produces:
  - Находка `modelsWithoutSpecs(data, { now, days = 30, limit })`, одна строка на модель:
    `<Вендор Модель> (<Тип>): vendor site <dell.com | (vendor has no website)> · <N> of <M> type attributes empty · approver: <model creator | none (no creator | banned | not staff | no right «Изменять справочники техники»)> · <id>`
    - `N` — атрибуты типа, пустые хотя бы в одной живой конфигурации модели.
    - Окно в сводке: `created in the last ${days} days`.
  - `data.specCandidates` строит `inventorySource`: живые модели с `createdAt >= now - days`, без записи `ModelSpecCheck`. У каждой — `approver` (строка выше) и счёт пустых атрибутов. Для прав — `canFor(user)({ inventoryCatalog: ["manage"] })`, по одному разу на создателя.
  - В `search_device_models` у модели строка `spec check: <outcome> <DD.MM> · <url | note>`, если отметка есть, и `spec page: <url>`, если есть `specUrl`.
  - `record_model_spec_check({ model: id, outcome: "complete"|"notFound"|"skipped", note: string 1..300, url?: https })`:
    - scope `inventoryChanges`, аннотации как у `propose` (не read-only, идемпотентно по модели);
    - сканер секретов на `note` — тот же, что у `propose`;
    - ответ: `recorded: <outcome> for «<модель>»`;
    - отказы: модель не найдена, `outcome` вне списка, `note` пустая или длиннее 300.
  - `propose_inventory_change`: `forModelCreator` (24-hex) в схеме, `requester` становится необязательным. В ответе при `origin`: `next: the model's creator must approve (Telegram if enabled, the bell and the portal).`
  - Инструкции агенту в `server.js`, одним абзацем после строки «Merge catalog records…» — правила спеки, раздел «Правила агента»:
    - только официальный сайт;
    - не нашёл — `notFound`;
    - только явные значения, перевод единиц разрешён;
    - сначала существующие атрибуты через `catalog` по коду;
    - варианты подбираются к существующим;
    - только пустые значения, расхождения — в `reason`;
    - у модели с несколькими конфигурациями — только общее;
    - всё совпало — `complete`;
    - модели с отметкой — только по просьбе;
    - расписание: `modelsWithoutSpecs` → предложение с `forModelCreator`, `approver: none` → `skipped`, упёрся в предел — ждать следующего прогона.

- [ ] **Step 1: Write the failing tests:**
  - `inventoryFindings.test.js`:
    - модель за окном и модель с отметкой не попадают;
    - строка содержит `vendor site dell.com`, `2 of 5 type attributes empty`, `approver: model creator`;
    - без `createdBy` → `approver: none (no creator)`.
  - `inventorySource.test.js`: `specCandidates` на фейке (если в файле есть шаблон фейков; иначе — тест только на чистой функции оценки автора, вынесенной в `inventorySource`).
  - `inventoryTools.test.js`: строки `spec check: notFound 29.10 · no page for this revision` и `spec page: https://…`.
  - `inventoryChangeTools.test.js`:
    - `record` пишет отметку;
    - отказ на `outcome: "proposed"`;
    - отказ на `note` в 301 символ;
    - `propose` прокидывает `forModelCreator`.
  - `routes/mcp.test.js`:
    - `record_model_spec_check` есть только при scope `inventoryChanges` и включённом модуле инвентаря;
    - бюджет перемерен, а `BASELINE`/кап поправлены с записью замера в комментарии, как в фазе 4.
- [ ] **Step 2:** `node --test services/mcp/inventoryFindings.test.js services/mcp/inventorySource.test.js services/mcp/inventoryTools.test.js services/mcp/inventoryChangeTools.test.js routes/mcp.test.js` → FAIL.
- [ ] **Step 3:** реализовать. Записать в `docs/mcp.md` формулировку задачи cron: «Раз в час: inventory_findings kind=modelsWithoutSpecs; по каждой модели — найти спецификацию на официальном сайте и предложить характеристики с forModelCreator по правилам; approver none — record_model_spec_check skipped».
- [ ] **Step 4:** тесты → PASS.

### Task 7: Макет портала

**Files:**
- Create: `.superpowers/sdd/2026-10-29-model-specs/mockup.html`

Макет показывает:
- карточку модели (`pages/DeviceModel/View.jsx`) со ссылкой «Спецификация на сайте производителя ↗» и без неё;
- форму модели с полем «Страница спецификации»;
- форму вендора с полем «Сайт» и подсказкой «домен, например dell.com; несколько — через запятую»;
- строки предложения «страница спецификации» и «сайт» в табличке «было → стало» на `/inventory/changes/:id` с кликабельной ссылкой;
- обе темы, десктоп и мобайл.

Компоненты — из `components/app` (сначала каталог), типографика — шкала Dense.

- [ ] **Step 1:** собрать макет по текущим страницам: открыть `View.jsx`, `FormFields.jsx`, `Vendor/Add.jsx`, `Vendor/Update.jsx`, `InventoryChange/Change.jsx`.
- [ ] **Step 2:** опубликовать артефактом, отдать владельцу ссылку и ждать «ок». Задача 8 до «ок» не начинается.

### Task 8: Портал по макету

**Files:**
- Modify:
  - `frontend/src/pages/DeviceModel/FormFields.jsx`, `frontend/src/pages/DeviceModel/View.jsx`;
  - `frontend/src/pages/Vendor/Add.jsx`, `frontend/src/pages/Vendor/Update.jsx` (или их общая форма, если есть), `frontend/src/pages/Vendor/View.jsx`;
  - `frontend/src/pages/InventoryChange/Change.jsx` (значение поля `https://…` — внешняя ссылка);
  - типы `frontend/src/types/*` для вендора и модели, если они есть.
- Test: `frontend/src/util/*.test.ts`, если появляется чистая функция (например `isExternalUrl`).

**Interfaces:**
- Consumes: `website` вендора, `specUrl` модели в API (Task 1). У `page.fields[].value` — строка.

- [ ] **Step 1:** сделать по одобренному макету. Ссылки наружу: `target="_blank" rel="noopener noreferrer"`.
- [ ] **Step 2:** `cd frontend && pnpm exec tsc --noEmit` и `pnpm exec eslint <изменённые файлы>`. Известная давняя ошибка FormWrapper допустима.
- [ ] **Step 3:** обновить строку в памяти проекта (`mcp-inventory-plan.md`) и статус спеки: «реализовано <дата>, не закоммичено, в браузере не проверено».
