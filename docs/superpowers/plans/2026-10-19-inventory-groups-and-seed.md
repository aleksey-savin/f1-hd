# Инвентарь, проект 1: группы характеристик, вид «как DNS», сид каталога — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Характеристики группируются (группа на связке тип↔атрибут, порядок групп глобальный) и показываются «как DNS» на карточках модели и устройства; каталог раскатывается сидом с журналом при деплое.

**Architecture:** Новая модель `AttributeGroup` + поле `DeviceTypeAttribute.groupId`. Группировку и форматирование значений считает чистая утилита фронтенда `components/app/spec-sheet.ts`, рисует компонент `app/SpecSheet`. Сид — раннер `scripts/seed.js` с журналом `seeds` (по образцу `migrate.js`, но прогоняется и на чистой базе) и переиспользуемый помощник `services/inventory/catalogSeed.js` (подхват существующего + только добавление); первый сид — `scripts/seeds/2026-10-19-inventoryCatalog.js`.

**Tech Stack:** Express 5 + Mongoose 9 (CommonJS, Node 22), React 19 + react-router, Tailwind v4 + shadcn-примитивы из `components/app`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-19-inventory-specs-and-assemblies-design.md` (разделы «Проект 1», «Решения исполнителя», приложение A). Макет: https://claude.ai/artifact/MQ6fBrUC2i2d31eLcjZB6b — код повторяет его, не «по мотивам».

## Global Constraints

- **Ни commit, ни push.** Git ведёт владелец; задачи заканчиваются проверкой, не коммитом. `git rm`/`git add` тоже не делать.
- Пакетный менеджер — pnpm; бэкенд-тесты — только файлы затронутого кода (`node --test <file>`), полный `pnpm test` не гонять.
- Новые бэкенд-модели — `.js` + интерфейс в `backend/types/inventory/<model>.ts` (как соседи).
- Удаление в Mongo — только по явному списку `_id`; транзакций нет.
- UI-тексты: «Новая группа», «Новая группа «…»», «Группы», «Без группы» (карточка типа), «Прочее» (вид характеристик), «Группа», «Группы атрибутов», «Переименовать», «Удалить». Без «Добавить группу».
- Типографика: тело 14, без `text-[Npx]`; цвета только токенами; обе темы.
- Права: всё про группы и сид каталога — `inventoryCatalog.manage` (чтение — как у прочего каталога, гейт префикса `inventoryModuleIsActive, isNotClient`).
- Пустое значение не показывается; пустая группа не показывается.
- Порядок групп в виде: по `AttributeGroup.order`, «Прочее» последней; строки в группе — по `order` связки.
- Колонки вида: на ≥ sm две, **сверху вниз сначала левая** (`ceil(n/2)` строк слева); на телефоне одна.

## Review Focus

1. Группа удалена/связка ссылается на несуществующую группу (`groupId` указывает в пустоту) — строка должна уйти в «Прочее»/«Без группы», а не пропасть или уронить карточку. → тест в Task 3 (`buildSpecGroups: битая группа → Прочее`).
2. Значение в конфигурации у атрибута, которого больше нет у типа — должно остаться видимым в «Прочее» (как сейчас делает `buildRows`). → тест в Task 3.
3. Старое значение multiselect, сохранённое простым текстом (не JSON-массив), — показывается как есть, форма не падает. → тесты в Task 3 (`formatSpecValue`) и Task 6.
4. Повторный прогон сида на уже засеянной базе и прогон на базе, где владелец переименовал засеянный тип — ничего не создаётся заново, ничего не перезаписывается. → тесты в Task 8 (`planCatalog`) и ручная проверка в Task 9.
5. Атрибут каталога с тем же именем в другом регистре / с расходящимся типом значения (на проде «Диагональ экрана» `num, дюймов`) — подхватывается, select получает только недостающие варианты, расхождение типа пишется в лог. → тест в Task 8.

---

### Task 1: Модель и API групп

**Files:**
- Create: `backend/models/inventory/attributeGroup.js`, `backend/types/inventory/attributeGroup.ts`, `backend/controllers/inventory/attributeGroup.js`, `backend/routes/internal/inventory/attributeGroup.js`, `backend/controllers/inventory/attributeGroup.test.js`
- Modify: `backend/routes/index.js` (импорт + список роутеров у `mountInventory`), `backend/routes/inventoryMount.js` (префикс `/attribute-groups` в слой каталога), `backend/routes/inventoryMount.test.js` (новый префикс покрыт)

**Interfaces:**
- Produces: модель `AttributeGroup` `{ name: String (trim, required), order: Number (default 0), createdBy, updatedBy, timestamps }`; уникальность имени — без учёта регистра (индекс с `collation: { locale: "ru", strength: 2 }`).
- Produces HTTP (`/api/inventory`): `GET /attribute-groups` → массив `{_id, name, order, typesCount, attributesCount}` по `order, name`; `POST /attribute-groups/add {name}` → `{attributeGroup}` (order = max+1; 409 на дубль имени); `PUT /attribute-groups/update/:id {name}` (409 на дубль); `PUT /attribute-groups/reorder {orderedIds}` (order = позиция); `POST /attribute-groups/delete/:id` (409 «Группа используется», если есть связка с этим `groupId`). Пишущие — `canManageInventoryCatalog`.
- Produces: чистая `exports.parseGroupName(raw) → { name } | { error }` (trim, схлопывание пробелов, пусто → ошибка, > 80 символов → ошибка).

- [ ] **Step 1: Тесты** — `attributeGroup.test.js` (паттерн `mikrotik.responsible.test.js`, `module-alias/register`, `bufferCommands false`): `parseGroupName("  Процессор ")` → `{name:"Процессор"}`; `"Оперативная   память"` → `"Оперативная память"`; `""`/`"   "`/`null` → `error`; строка 81 символ → `error`. В `inventoryMount.test.js` — подроутер с `/attribute-groups/reorder` покрыт слоем каталога (по образцу соседних кейсов).
- [ ] **Step 2:** `node --test controllers/inventory/attributeGroup.test.js routes/inventoryMount.test.js` (из `backend/`) — FAIL.
- [ ] **Step 3:** Модель, тип, контроллер (счётчики `typesCount`/`attributesCount` — одной агрегацией по `devicetypeattributes` с `$group` по `groupId`), роуты, монтирование.
- [ ] **Step 4:** Тот же прогон — PASS; `node --check` на новых файлах; `npx eslint` на них.

### Task 2: Группа на связке типа и в ответах API

**Files:**
- Modify: `backend/models/inventory/deviceTypeAttribute.js` (+`groupId: {type: ObjectId, ref: "AttributeGroup", default: null}`), `backend/types/inventory/deviceTypeAttribute.ts`, `backend/controllers/inventory/deviceTypeAttribute.js`, `backend/controllers/inventory/deviceType.js` (`getOne`), `backend/controllers/inventory/clientDevice.js` (populate + `specLinks` в `getOne`), `backend/controllers/inventory/deviceTypeAttribute.add.test.js`

**Interfaces:**
- Consumes: `AttributeGroup` (Task 1).
- Produces: везде, где отдаются связки (`deviceType.getOne` → `attributes[]`, `deviceTypeAttribute.getOne/getByDeviceTypeId/add/update/reorder`), `groupId` populated `"name order"` (или `null`).
- Produces: `POST /device-type-attributes/add` принимает необязательный `groupId` (ObjectId | null) — ставится всем созданным связкам; `PUT /device-type-attributes/update/:id` принимает `groupId` (ObjectId | null; `undefined` — не менять). Несуществующая группа → 404 до записи.
- Produces: `clientDevice.getOne` → у `configurationId.values.attributeId` populate `"code name unit valueType options"`; в ответе новое поле `specLinks` — связки эффективного типа устройства (тип модели, иначе `deviceTypeId`) с populate `attributeId` (`ATTRIBUTE_FIELDS`) и `groupId` (`"name order"`), сортировка `{order:1, createdAt:1}`; `[]`, если конфигурации нет.
- Produces: чистая `exports.parseGroupId(raw) → { groupId: string|null|undefined } | { error }` в `deviceTypeAttribute.js` (`undefined` → не менять, `null`/`""` → null, валидный ObjectId → строка, иначе ошибка).

- [ ] **Step 1: Тесты** в `deviceTypeAttribute.add.test.js`: `parseGroupId(undefined)` → `{groupId: undefined}`; `parseGroupId(null)` и `("")` → `{groupId: null}`; валидный id → тот же id строкой; `"nope"` → `error`.
- [ ] **Step 2:** `node --test controllers/inventory/deviceTypeAttribute.add.test.js` — FAIL.
- [ ] **Step 3:** Реализация (схема, populate во всех ответах связок, проверка существования группы в `add`/`update` до записи, `specLinks`).
- [ ] **Step 4:** Тест — PASS; ручная проверка по рецепту памяти «E2E auth API testing» (скрипт со стабами `req/res` на дев-базе, тестовые записи удалить по `_id`): `add` с `groupId` → связки с группой; `update {groupId:null}` → группа снята.

### Task 3: Утилита вида характеристик

**Files:**
- Create: `frontend/src/components/app/spec-sheet.ts`, `frontend/src/components/app/spec-sheet.test.js`

**Interfaces:**
- Consumes: формы данных Task 2 — связка `{ _id, order, attributeId: {_id, name, unit, valueType, options[]}, groupId: {_id, name, order} | null }`, значение `{ attributeId: {_id,...} | string, value: string }`.
- Produces:
  - `formatSpecValue(attr: {valueType, unit?, options?}, raw: string | boolean): string` — `boolean`/`"true"`/`"false"` → «да»/«нет»; `select` → подпись опции (нет опции → сырое); `multiselect` → JSON-массив → подписи через «, » (не JSON → сырое как есть); `number`/`string` с единицей → `` `${v} ${unit}` `` (единица `"` — без пробела); пустое → `""`.
  - `buildSpecGroups(links, values, { otherLabel = "Прочее" }): Array<{ key: string, name: string, rows: Array<{ id: string, label: string, value: string }> }>` — группы по `groupId.order` (затем имени), «Прочее» последней; строки по `order` связки; значения без связки (атрибут снят с типа) — в «Прочее» по имени; пустые значения и пустые группы выкинуты; связка с `groupId: null` или битым `groupId` (не объект) — в «Прочее».
  - `splitColumns<T>(rows: T[]): [T[], T[]]` — `ceil(n/2)` слева.
  - `parseMultiValue(raw: string): string[]` и `serializeMultiValue(values: string[]): string` (JSON-массив) — для формы Task 6.

- [ ] **Step 1: Тесты** (`node:test`, импорт `./spec-sheet.ts`):
  - `formatSpecValue({valueType:"boolean"}, true)` → «да»; `("false")` → «нет»;
  - `formatSpecValue({valueType:"select", options:[{value:"ddr5",label:"DDR5"}]}, "ddr5")` → «DDR5»;
  - `formatSpecValue({valueType:"multiselect", options:[{value:"a",label:"HDMI"},{value:"b",label:"DP"}]}, '["a","b"]')` → «HDMI, DP»; `("HDMI 2.0")` → «HDMI 2.0»;
  - `formatSpecValue({valueType:"number", unit:"ГБ"}, "16")` → «16 ГБ»; `unit:'"'` → `14"`;
  - `buildSpecGroups`: две группы с order 5 и 2 → сначала order 2; строки по `order` связки; пустое значение выкинуто, пустая группа выкинута; «битая группа → Прочее» (`groupId: "6a…"` строкой); «значение без связки → Прочее»; «Прочее» последней;
  - `splitColumns([1,2,3,4,5])` → `[[1,2,3],[4,5]]`; `([])` → `[[],[]]`;
  - `parseMultiValue('["a","b"]')` → `["a","b"]`; `("HDMI")` → `["HDMI"]`; `("")` → `[]`; `serializeMultiValue(["a"])` → `'["a"]'`.
- [ ] **Step 2:** `cd frontend && node --test src/components/app/spec-sheet.test.js` — FAIL.
- [ ] **Step 3:** Реализация.
- [ ] **Step 4:** PASS; `npx eslint src/components/app/spec-sheet.ts`; `npx tsc --noEmit -p .`.

### Task 4: `SpecSheet` на карточках модели и устройства

**Files:**
- Create: `frontend/src/components/app/SpecSheet.tsx`
- Modify: `frontend/src/components/DeviceModel/View.jsx` (секция «Конфигурации», `buildRows`/`formatAttrValue` удалить), `frontend/src/components/ClientDevice/View.jsx` (блок `#specs`, локальный `SpecRow` удалить)

**Interfaces:**
- Consumes: `buildSpecGroups`, `splitColumns` (Task 3); `deviceType.attributes` с группами (model loader уже грузит тип), `device.specLinks` (Task 2).
- Produces: `<SpecSheet groups={ReturnType<typeof buildSpecGroups>} />` — только содержимое (без панели): группа = `h4` (text-base font-semibold), строки сеткой как в макете: подпись `text-muted-foreground` + пунктир (`border-b border-dotted`, токен цвета линии — `border-border`), значение `text-foreground tabular-nums`; `sm:` две колонки через `splitColumns`, на телефоне одна.

- [ ] **Step 1:** `SpecSheet.tsx` по макету (разделы 1–2).
- [ ] **Step 2:** Карточка модели: чипы конфигураций (переключатель, первая выбрана; при одной конфигурации чипов нет), под ними одна `Panel` — шапка (иконка, сводка `summaryOf` прежняя, «N устройств этой конфигурации» — только если число уже есть в данных, иначе без подстроки; `ConfigActions`) + `SpecSheet`. Пустые состояния и «Новая конфигурация» — без изменений.
- [ ] **Step 3:** Карточка устройства: `Eyebrow` «Характеристики · {сводка}» + `Panel` + `SpecSheet` из `buildSpecGroups(device.specLinks, config.values)`; если групп нет — блок не рендерится (как сейчас при пустых `specs`).
- [ ] **Step 4:** `npx eslint` на изменённых файлах, `npx tsc --noEmit -p .` — без новых ошибок; глазами на деве обе карточки (если владелец не возьмёт проверку на себя — см. память «Timebox local E2E»: только статика).

### Task 5: Группы на карточке типа и в формах связки

**Files:**
- Modify: `frontend/src/components/app/Combobox.tsx` (опция создания), `frontend/src/components/DeviceType/View.jsx`, `frontend/src/components/DeviceType/AttributeForm.jsx`, `frontend/src/components/DeviceType/AttributesAddForm.jsx`, `frontend/src/pages/DeviceType/AttributeAdd.jsx`, `frontend/src/pages/DeviceType/AttributeUpdate.jsx`

**Interfaces:**
- Consumes: `GET/POST /attribute-groups` (Task 1), `groupId` в связках и в `add`/`update` (Task 2).
- Produces: `Combobox` получает `onCreate?: (query: string) => void` и `createLabel?: (query: string) => string`: при непустом запросе без точного совпадения подписи (без учёта регистра) в конце списка пункт `createLabel(query)` с иконкой «+», выбор зовёт `onCreate(query)`.
- Produces: общий хук `useAttributeGroups()` в `frontend/src/components/DeviceType/attribute-groups.js` — `{ groups, createGroup(name) → Promise<group> }` (загрузка `load("/api/inventory/attribute-groups")`, создание — fetch + `invalidate("/api/inventory/")`).

- [ ] **Step 1:** `Combobox`: опция создания (точное совпадение — нет пункта).
- [ ] **Step 2:** Карточка типа: внутри одной `Panel` подзаголовки групп (имя · счётчик) в порядке `groupId.order`, «Без группы» последней; перетаскивание и «Выше/Ниже» — только внутри группы (бросок в чужую группу игнорируется); `orderedIds` по-прежнему весь список в порядке отображения.
- [ ] **Step 3:** «Изменить» связки: поле «Группа» (`Combobox`, `clearable`, `clearLabel="Без группы"`, `onCreate` → `createGroup` → выбрать созданную, `createLabel={(q) => \`Новая группа «${q}»\`}`), подсказка из макета; скрытое поле `groupId`; action шлёт `groupId` (пусто → `null`).
- [ ] **Step 4:** «Добавить атрибуты»: поле «Группа» под поиском в шапке (подсказка «Для всех отмеченных. Потом можно поменять у каждого.»), `groupId` уходит в теле рядом с `items`; action передаёт его в `add`.
- [ ] **Step 5:** `npx eslint` на изменённых файлах, `npx tsc --noEmit -p .`.

### Task 6: Форма конфигурации по группам + мультивыбор

**Files:**
- Modify: `frontend/src/components/DeviceConfiguration/Form.jsx`

**Interfaces:**
- Consumes: связки с группами (loader уже берёт `deviceType.attributes`), `buildSpecGroups`-порядок групп — переиспользовать сортировку групп из `spec-sheet.ts` (экспортировать `groupLinks(links): Array<{key,name,links}>` из Task 3 файла, если её там нет — добавить с тестом «порядок групп как у buildSpecGroups, пустые группы остаются»).
- Produces: поля сгруппированы (`h5`-заголовок uppercase как в макете, две колонки на ≥ md); `multiselect` → `ChoiceGroup multiple` по опциям атрибута, значение хранится `serializeMultiValue`, старое текстовое значение читается `parseMultiValue`; `boolean` — как сейчас.

- [ ] **Step 1:** Тест `groupLinks` в `spec-sheet.test.js` (если функция новая) — FAIL → реализация → PASS.
- [ ] **Step 2:** Форма по группам + мультивыбор.
- [ ] **Step 3:** `npx eslint`, `npx tsc --noEmit -p .`.

### Task 7: Шторка «Группы атрибутов»

**Files:**
- Create: `frontend/src/pages/DeviceAttribute/Groups.jsx`, `frontend/src/components/DeviceAttribute/GroupsSheet.jsx`
- Modify: `frontend/src/App.jsx` (дочерний маршрут `groups` у `inventory/device-attributes`, `handle: CATALOG_FORM`), `frontend/src/pages/DeviceAttribute/List.jsx` (кнопка «Группы» в `toolbar` рядом с `ChipSelect`, только при `inventoryCatalog.manage`)

**Interfaces:**
- Consumes: API групп (Task 1).
- Produces: шторка по макету (раздел 6): строки (перетаскивание, имя, «N типов · M атр.» / «не используется», «⋯» → «Переименовать» (диалог с полем имени) и «Удалить» (`DeleteDialog`, только для неиспользуемой; у используемой пункт выключен с подписью-причиной)), кнопка «Новая группа» (тот же диалог), подвал «Закрыть». Порядок сохраняется `PUT /attribute-groups/reorder` сразу после броска (оптимистично, как атрибуты на карточке типа).

- [ ] **Step 1:** Маршрут + loader (`GET /attribute-groups`) + action (`intent`: `create`/`rename`/`reorder`/`delete`), ошибки 409 — тостом.
- [ ] **Step 2:** `GroupsSheet` по макету.
- [ ] **Step 3:** `npx eslint`, `npx tsc --noEmit -p .`.

### Task 8: Раннер сидов и помощник каталога

**Files:**
- Create: `backend/scripts/seed.js`, `backend/scripts/seed.test.js`, `backend/services/inventory/catalogSeed.js`, `backend/services/inventory/catalogSeed.test.js`
- Modify: `deploy.sh` (шаг после миграций, команда `seed`), `docs/deployment.md`

**Interfaces:**
- Produces: `scripts/seed.js status | up | mark <id>` — список `SEEDS = [{ id, module }]` (модуль экспортирует `async apply({ log })`), журнал — коллекция `seeds` (`_id` = id, `appliedAt`, `mode`). `up` прогоняет неприменённые по порядку **и на пустой базе**; сбой — код ≠ 0, применённое остаётся в журнале.
- Produces: `catalogSeed.js`:
  - чистая `planCatalog(catalog, existing) → { create: {groups, types, attributes, links}, update: {attributeOptions: [{_id, add: [{value,label}]}], linkGroups: [{_id, groupKey}], typeFlags: [{_id, set: {isComponent: true}}]}, warnings: string[] }`, где `catalog = { groups: [{key, name, order}], types: [{key, name, flags?, attributes: [{attr: attrKey, group: groupKey, required?}]}], attributes: [{key, code, name, valueType, unit?, options?}] }`, `existing` — лёгкие выборки из базы (`{groups, types, attributes, links}`);
  - подхват: группы и типы — по `name` без учёта регистра; атрибуты — по `code` ИЛИ `name` без учёта регистра; связки — по паре (тип, атрибут);
  - только добавление: существующее не перезаписывается, кроме (а) недостающих вариантов select/multiselect, (б) `groupId` у связки, где он `null`, (в) `isComponent: true` у подхваченного типа, помеченного в каталоге как комплектующая; расхождение `valueType` → строка в `warnings`, атрибут всё равно подхватывается;
  - новые группы получают `order` из каталога, сдвинутый за максимальный существующий;
  - `async applyCatalog(catalog, { log }) → { created: {...counts}, updated: {...counts}, warnings }` — читает `existing`, зовёт `planCatalog`, пишет; созданные `_id` копит и при сбое удаляет по списку; коды новых атрибутов — из каталога (при занятости — `uniqueAttributeCode`).
- `deploy.sh`: после блока миграций `dc run --rm backend node scripts/seed.js up || die "a seed failed — fix the cause and run ./deploy.sh again (it resumes there), or skip it with ./deploy.sh seed mark <id>"`; команда `seed) shift; dc run --rm backend node scripts/seed.js "$@" ;;` и строка в шапке-справке.

- [ ] **Step 1: Тесты `planCatalog`:**
  - пустая база → всё в `create`, `warnings` пусты;
  - повторный план по результату первого (существующее = каталог) → `create` и `update` пусты (идемпотентность);
  - (`seed.test.js`) `pendingSeeds(SEEDS, appliedIds)` → только неприменённые, в исходном порядке; применённый сид не попадает в список — поэтому переименованное владельцем после прогона не воскрешается;
  - атрибут «диагональ экрана» (регистр другой, `valueType: "select"`) при каталожном `number` → подхвачен, `warnings` содержит его имя, в `create.attributes` его нет;
  - select «Сокет» с опциями `[AM4, AM5]` при каталожных `[AM4, AM5, LGA1700]` → `update.attributeOptions` = `[{_id, add:[LGA1700]}]`;
  - связка существует с `groupId: null` → `update.linkGroups` с группой из каталога; с заданной группой → не трогается;
  - подхваченный тип «Блок питания» без `isComponent` при каталожном флаге комплектующей → `update.typeFlags`.
- [ ] **Step 2:** `node --test services/inventory/catalogSeed.test.js scripts/seed.test.js` — FAIL.
- [ ] **Step 3:** Реализация (`pendingSeeds` экспортировать из `seed.js`, запуск `main()` только при `require.main === module`).
- [ ] **Step 4:** PASS; `bash -n deploy.sh`; существующий `ci/tests/deploy_image_source.sh` проходит.

### Task 9: Первый сид каталога и уборка старого

**Files:**
- Create: `backend/scripts/seeds/2026-10-19-inventoryCatalog.js`
- Delete: `backend/scripts/initializeInventoryData.js` (константа `MIKROTIK_VENDOR_NAME` — в `seedMikrotikModels.js`)
- Modify: `backend/scripts/seed.js` (запись в `SEEDS`), `backend/scripts/seedMikrotikModels.js`, `docs/inventory.md` (группы, `specLinks`, сид), `docs/deployment.md`, `docs/mikrotik-management.md` (ссылка на удалённый скрипт)

**Interfaces:**
- Consumes: `applyCatalog` (Task 8).
- Produces: каталог по приложению A спеки **без слотов и ключевых характеристик** (это проект 2): группы в указанном порядке; типы комплектующих (флаг `isComponent`); заводские типы Ноутбук (новый), Моноблок, Маршрутизатор, Коммутатор, МФУ; «Системный блок» — атрибуты для брендовых моделей «как у моноблока без экрана» (группы Общие параметры, Программное обеспечение, Процессор, Оперативная память, Накопители данных, Видеокарта, Беспроводная сеть, Разъёмы и интерфейсы, Питание, Габариты и вес); стабильные латинские `code` у каждого атрибута; общие атрибуты (Сокет, Тип памяти, Стандарт Wi-Fi, Длина/Ширина/Высота/Глубина, Вес, Цвет, Линейка, Год релиза, Модель процессора…) — один ключ на весь каталог.

- [ ] **Step 1:** Файл сида (данные + `apply` = `applyCatalog`).
- [ ] **Step 2:** Тест-санитар в `catalogSeed.test.js`: каталог первого сида проходит `planCatalog` на пустой базе без `warnings`; у каждой связки существующие ключи группы и атрибута; коды уникальны.
- [ ] **Step 3:** Удалить `initializeInventoryData.js`, перенести константу, поправить ссылки в доках.
- [ ] **Step 4:** Проверка на дев-базе (копия прода): `docker compose -f compose.dev.yml run --rm backend node scripts/seed.js up` → лог: создано/подхвачено/предупреждения (ожидается предупреждений 0–1: «Диагональ экрана» `num` совместима); второй `up` → «nothing pending»; `status` → `✓ 2026-10-19-inventoryCatalog`. Снять список почти-дублей и старых атрибутов «Системного блока»/«Моноблока», не подхваченных сидом, — отдать владельцу (раздел спеки «Владельцу после выкатки»).
- [ ] **Step 5:** `docs/inventory.md` — разделы про `AttributeGroup`, `groupId`, `specLinks`, сид; дата «Last updated».
