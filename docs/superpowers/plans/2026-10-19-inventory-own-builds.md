# Инвентарь, проект 2: своя сборка — слоты, ключевые характеристики, сборки-шаблоны — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У типа с включённой своей сборкой («Системный блок») — слоты комплектующих и ключевые характеристики; сборки-шаблоны (`DeviceBuild`) со своей карточкой и формой; характеристики сборки собираются из конфигураций моделей деталей.

**Architecture:** Бэкенд хранит `DeviceType.assembly` и новую модель `DeviceBuild` и отдаёт сырые данные (детали с моделями и значениями конфигураций, связки типов деталей с группами). Сводку — ключевые характеристики, группы «как DNS», блок «Конфигурация» — считает чистая утилита фронтенда `components/app/assembly-specs.ts` поверх `spec-sheet.ts` проекта 1 (форматирование значений живёт там; проект 3 переиспользует её для фактических деталей устройства). Включение у «Системного блока» и его слоты раскатывает второй сид через раннер проекта 1.

**Tech Stack:** Express 5 + Mongoose 9 (CommonJS, Node 22), React 19 + react-router data routers, Tailwind v4 + `components/app`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-19-inventory-specs-and-assemblies-design.md` (раздел «Проект 2», «Решения исполнителя», приложение A «Собираемый тип»). Макет (код повторяет его): https://claude.ai/artifact/QdJg2jb57yQZyVDFPmtKfx — локальная копия будет в рабочей папке плана как `mockup-own-builds.html`.

## Global Constraints

- **Ни commit, ни push, ни `git add/rm`.** Git ведёт владелец; задачи заканчиваются проверкой.
- pnpm; бэкенд-тесты — только файлы затронутого кода (`node --test <file>`); новые модели — `.js` + `backend/types/inventory/<model>.ts`.
- Удаление в Mongo — только по явному списку `_id`; транзакций нет; сборки — мягкое удаление (`deletedAt`), как модели.
- Схема своей сборки касается **только устройств «Своя сборка»**; модели типа (брендовые ПК) и атрибуты типа не меняются и не прячутся.
- Слот = тип-комплектующая (`isComponent: true`), один слот на тип; `multiple` — деталей этого типа может быть несколько.
- Ключевая характеристика: `{ typeId, source: "model" | "attribute", attributeId?, aggregate: "first" | "sum" | "list" }`; `sum` — только числа, нечисловые пропускаются, с учётом `quantity`; `list` — различные значения через «, ».
- Выключить своя сборку у типа можно, только пока у него нет сборок (409 «Нельзя выключить: у типа N сборок»).
- Обязательные слоты сборки обязательны (сервер 400, форма — кнопка неактивна, подпись «Не заполнено: …»).
- UI-тексты: «Своя сборка», «Своя сборка — из комплектующих», «Комплектующие», «Ключевые характеристики», «обязательная», «несколько», «Добавить комплектующую», «Добавить характеристику», «первое / сумма / список», «Сборки», «Новая сборка», «Ещё <тип в вин. падеже, строчными>» (напр. «Ещё накопитель»), «Конфигурация», «Характеристики», «Не заполнено: …». Без «Добавить сборку».
- Права: всё про слоты и сборки — `inventoryCatalog.manage` на запись; чтение — гейт префикса каталога (`inventoryModuleIsActive, isNotClient`).
- Типографика 14 / без `text-[Npx]` / токены / обе темы; макет — авторитет по виду.

## Review Focus

1. Сборка ссылается на модель или конфигурацию, которую потом мягко удалили / сменили ей тип — карточка сборки не падает, деталь показывается с пометкой «модель удалена», характеристики без неё. → тест в Task 3 (`assemblySpecs: деталь без модели`), populate в Task 2 без фильтра `deletedAt`.
2. Слот убрали из типа, а сборки с такой деталью есть — деталь остаётся в «Конфигурации» (в конце, без слота), ключевые характеристики её не учитывают. → тест в Task 3.
3. «Сумма» по атрибуту, у которого в одной детали число, в другой — текст/пусто — сумма по числам, без NaN; если чисел нет — характеристики нет. → тест в Task 3.
4. Две разные модели в слоте «несколько» (два накопителя) — строки характеристик сводятся «500 ГБ + 2000 ГБ», одинаковые — «2 × 8 ГБ». → тесты в Task 3.
5. Повторный прогон сида и тип, у которого владелец уже настроил слоты — сид слоты не трогает. → тест в Task 6.

---

### Task 1: Своя сборка на типе (данные и API)

**Files:**
- Modify: `backend/models/inventory/deviceType.js`, `backend/types/inventory/deviceType.ts`, `backend/controllers/inventory/deviceType.js`, `backend/routes/internal/inventory/deviceType.js`
- Create: `backend/models/inventory/deviceBuild.js` (только схема — API в Task 2), `backend/types/inventory/deviceBuild.ts`, `backend/controllers/inventory/deviceTypeAssembly.test.js`

**Interfaces:**
- Produces: `DeviceType.assembly = { enabled: Boolean (false), slots: [{ typeId: ref DeviceType, required: Boolean, multiple: Boolean }], keySpecs: [{ typeId: ref DeviceType, source: "model"|"attribute", attributeId: ref DeviceAttribute|null, aggregate: "first"|"sum"|"list" }] }` (порядок — порядок массивов).
- Produces: `DeviceBuild` `{ name (trim, required), deviceTypeId (ref DeviceType, required), parts: [{ typeId, deviceModelId (ref DeviceModel), configurationId (ref DeviceConfiguration|null), quantity: Number ≥1 }], notes, deletedAt, deletedBy, createdBy, updatedBy, timestamps }`; индекс `{deviceTypeId:1, deletedAt:1}`.
- Produces: чистая `parseAssembly(body, { componentTypeIds: Set<string>, attributeIdsByType: Map<string, Set<string>> }) → { slots, keySpecs } | { error }` в `controllers/inventory/deviceType.js`: слот — тип-комплектующая, без повторов; keySpec — `typeId` есть среди слотов, `attribute` → `attributeId` из связок этого типа, `model` → `attributeId: null`, `aggregate` из трёх; `sum` разрешён только для `number`-атрибута (нужна `valueTypeById`, добавить в опции).
- Produces HTTP: `PUT /device-types/:id/assembly { slots, keySpecs }` → тип (populated); `PUT /device-types/update/:id` принимает `assemblyEnabled` (Boolean, `undefined` — не трогать); выключение при существующих неудалённых сборках → 409. `GET /device-types/:id` отдаёт `assembly` с populate `slots.typeId`/`keySpecs.typeId` (`name`) и `keySpecs.attributeId` (`name unit valueType`), плюс `buildsCount`.

- [ ] **Step 1: Тесты `parseAssembly`**: валидный набор проходит, порядок сохранён; тип не-комплектующая → error; повтор слота → error; keySpec с `typeId` не из слотов → error; `attribute` без связки у типа → error; `sum` по не-числу → error; `model` с `attributeId` → нормализуется в `null`; пустые массивы — валидно.
- [ ] **Step 2:** `cd backend && node --test controllers/inventory/deviceTypeAssembly.test.js` — FAIL.
- [ ] **Step 3:** Схемы, `parseAssembly`, ручка, `assemblyEnabled` с проверкой, populate.
- [ ] **Step 4:** PASS; `node --check`, eslint на изменённых; дев-проверка контроллеров со стабами (рецепт house-rules): включить, задать слоты, попытка выключить при сборке (создать `claude-test` сборку напрямую моделью и удалить по `_id`).

### Task 2: API сборок

**Files:**
- Create: `backend/controllers/inventory/deviceBuild.js`, `backend/routes/internal/inventory/deviceBuild.js`, `backend/controllers/inventory/deviceBuild.test.js`
- Modify: `backend/routes/index.js`, `backend/routes/inventoryMount.js` (префикс `/device-builds` в слой каталога), `backend/routes/inventoryMount.test.js`

**Interfaces:**
- Consumes: `DeviceType.assembly`, `DeviceBuild` (Task 1).
- Produces: чистая `parseBuildParts(parts, slots) → { parts } | { error }`: у каждой детали `typeId` — слот типа; деталь в слоте без `multiple` — одна и `quantity` 1; `quantity` целое ≥1; все `required`-слоты заполнены (ошибка «Не заполнено: <имена>»; имена слотов приходят в `slots[].typeName`); порядок деталей — порядок слотов, внутри слота — как прислано.
- Produces HTTP: `GET /device-builds?deviceTypeId=` → `[{ _id, name, notes, parts (populated), updatedAt }]` без удалённых; `GET /device-builds/:id` → `{ build, deviceType: {_id, name, assembly (populated как в Task 1)}, partLinks: { [typeId]: links[] } }`; `POST /device-builds/add`, `PUT /device-builds/update/:id` (`{name, notes, parts}`; модель детали существует и её тип = `typeId`; конфигурация принадлежит модели; если у модели ровно одна конфигурация и `configurationId` не прислан — подставить её); `POST /device-builds/delete/:id` — мягкое удаление. Populate деталей: `deviceModelId` (`name vendorId deviceTypeId deletedAt` + `vendorId.name`), `configurationId` (`name values deletedAt` + `values.attributeId` `code name unit valueType options`), `typeId` (`name`). `partLinks` — связки типов деталей (как `specLinks`: `attributeId` + `groupId` `name order`, `.select("attributeId groupId order createdAt").lean()`).
- Ошибки — человеческие («Модель «…» не найдена», «Тип «…» не собирается из комплектующих»).

- [ ] **Step 1: Тесты `parseBuildParts`**: валидная сборка; деталь вне слотов → error; две детали в не-`multiple` слоте → error; `quantity` 2 в не-`multiple` → error; `quantity` 0 / дробное → error; пропущен обязательный слот → error с его именем; порядок по слотам; mount-тест на `/device-builds`.
- [ ] **Step 2:** FAIL. **Step 3:** реализация. **Step 4:** PASS + eslint + дев-проверка со стабами (`claude-test` сборка: add → getOne с `partLinks` → update → delete; удалить по `_id`).

### Task 3: Утилита сводки сборки

**Files:**
- Create: `frontend/src/components/app/assembly-specs.ts`, `frontend/src/components/app/assembly-specs.test.js`

**Interfaces:**
- Consumes: `formatSpecValue`, `buildSpecGroups` из `spec-sheet.ts` (проект 1); формы данных Task 2.
- Produces:
  - `partTitle(part) → string` — «Vendor Name» модели, «модель удалена», если модели нет или `deletedAt`.
  - `buildKeySpecs(keySpecs, parts) → Array<{ typeId, label: string, value: string }>` — по одной записи на тип слота в порядке первого появления в `keySpecs`; `label` — имя типа; `value` — значения его keySpecs через пробел (`model` → `partTitle`; `first`/`sum`/`list` по `aggregate`; `sum` × `quantity`, единица из атрибута, нечисловые пропущены, нет чисел → пропуск); пустые записи выкидываются.
  - `keySpecsLine(keySpecs, parts) → string` — `buildKeySpecs` значения через « · ».
  - `buildAssemblyGroups(parts, partLinks, { otherLabel = "Прочее" }) → groups` (форма `buildSpecGroups`): строки всех деталей; одинаковые детали (модель+конфигурация) сводятся: числовое значение «N × v» при `quantity > 1`; разные детали одного типа — значения строки через « + »; порядок групп глобальный, строки — по слотам, затем по связкам.
  - `buildPartRows(slots, parts) → Array<{ key, label, title, modelId|null, quantity }>` — «Конфигурация»: по слотам, деталь вне слотов — в конце с `label` = имя её типа.

- [ ] **Step 1: Тесты** (имена — по Review Focus): `buildKeySpecs: модель + сумма 2×8 ГБ = 16 ГБ + тип DDR5 → «AMD Ryzen 5 8600G», «16 ГБ DDR5»`; `sum: текст и пусто пропущены, нет чисел — нет записи`; `list: различные через «, »`; `деталь без модели → «модель удалена», характеристики без неё`; `buildAssemblyGroups: 2 × 8 ГБ`; `разные накопители → «500 ГБ + 2000 ГБ»`; `деталь вне слотов — в конце buildPartRows, не в keySpecs`; `keySpecsLine` соединяет через « · ».
- [ ] **Step 2:** `cd frontend && node --test src/components/app/assembly-specs.test.js` — FAIL. **Step 3:** реализация. **Step 4:** PASS + eslint + `npx tsc --noEmit -p .`.

### Task 4: Карточка и форма типа

**Files:**
- Modify: `frontend/src/components/DeviceType/View.jsx`, `frontend/src/components/DeviceType/FormFields.jsx`, `frontend/src/pages/DeviceType/Update.jsx` (+ `View.jsx` loader при необходимости), `frontend/src/App.jsx`
- Create: `frontend/src/components/DeviceType/AssemblyForm.jsx`, `frontend/src/pages/DeviceType/Assembly.jsx`

**Interfaces:**
- Consumes: API Task 1–2; `keySpecsLine` (Task 3); хук `hooks/use-drag-reorder.js` (проект 1) для порядка слотов/характеристик.
- Produces: карточка типа по макету разд. 1 — при `assembly.enabled`: секция «Своя сборка · N комплектующих» (кнопка «Изменить» → `assembly`), подсекции «Комплектующие» (пилюли «несколько», «обязательная») и «Ключевые характеристики» (чипы «Тип · что, как»), подсказка; секция «Сборки · N» с «Новая сборка» (→ `builds/add`, Task 5) и строками (имя + `keySpecsLine`, переход на карточку сборки). Данные сборок — loader карточки `GET /device-builds?deviceTypeId=`.
- Produces: шторка «Своя сборка» (маршрут `inventory/device-types/:id/assembly`, `CATALOG_FORM`) по макету разд. 2: строки слотов (Combobox типов-комплектующих без уже выбранных, переключатели «обязательная»/«несколько», «Убрать», перетаскивание), «Добавить комплектующую»; строки ключевых характеристик (слот, «Название модели» или атрибут типа слота, сегмент «первое/сумма/список» — «сумма» только для числового атрибута, иначе неактивна), «Добавить характеристику»; JSON-сабмит `PUT /device-types/:id/assembly`.
- Produces: форма типа — переключатель «Своя сборка — из комплектующих» (подсказка из макета разд. 5); при выключении и наличии сборок — сообщение сервера в форме.

- [ ] **Step 1:** Маршрут + шторка. **Step 2:** Секции карточки. **Step 3:** Переключатель в форме. **Step 4:** eslint, `npx tsc --noEmit -p .`, тесты `spec-sheet`/`assembly-specs` зелёные.

### Task 5: Карточка и форма сборки

**Files:**
- Create: `frontend/src/components/DeviceBuild/View.jsx`, `frontend/src/components/DeviceBuild/Form.jsx`, `frontend/src/pages/DeviceBuild/View.jsx`, `frontend/src/pages/DeviceBuild/Add.jsx`, `frontend/src/pages/DeviceBuild/Update.jsx`
- Modify: `frontend/src/App.jsx` (маршрут `inventory/device-builds/:id` с дочерним `update`; `inventory/device-types/:id/builds/add`)

**Interfaces:**
- Consumes: API Task 2; `buildKeySpecs`, `buildAssemblyGroups`, `buildPartRows` (Task 3); `SpecSheet` (проект 1); `Crumbs`/`useCrumbFrom`; `DeleteDialog`.
- Produces: карточка сборки по макету разд. 3 — крошки «Учёт · Типы устройств · <тип> · Сборка», hero (плитка-глиф, имя, «Своя сборка · <тип> · N деталей», чипы ключевых характеристик «<тип> <значение>»), «⋯» → «Удалить», «Изменить» (→ `update`); «Конфигурация · N» — `SpecSheet`-вид строк «тип → ссылка на модель» (с «N ×»), «Характеристики» — `SpecSheet` из `buildAssemblyGroups`; удаление → на карточку типа.
- Produces: форма «Новая сборка»/«Изменить сборку» по макету разд. 4: «Наименование», секция «Комплектующие» — строка на слот: подпись (имя типа, «*» у обязательного, «несколько»), Combobox моделей этого типа (`GET /device-models` с фильтром по `deviceTypeId`; если у выбранной модели >1 конфигурации — второй Combobox конфигураций), количество (только `multiple`), «Убрать»; у `multiple` — «Ещё <тип>» добавляет строку; «Примечание»; подвал «Не заполнено: …» + неактивная кнопка, пока есть пустые обязательные слоты; JSON-сабмит. После создания — на карточку сборки.

- [ ] **Step 1:** Маршруты, лоадеры, экшены. **Step 2:** Карточка. **Step 3:** Форма. **Step 4:** eslint, `npx tsc --noEmit -p .`.

### Task 6: Сид своей сборки «Системного блока»

**Files:**
- Modify: `backend/services/inventory/catalogSeed.js`, `backend/services/inventory/catalogSeed.test.js`, `backend/scripts/seed.js`, `docs/inventory.md`, `docs/deployment.md` (таблица сидов)
- Create: `backend/scripts/seeds/2026-10-19-systemUnitAssembly.js`

**Interfaces:**
- Consumes: каталог первого сида (ключи типов/атрибутов), `planCatalog/applyCatalog`.
- Produces: каталог допускает у типа `assembly: { slots: [{ type: typeKey, required, multiple }], keySpecs: [{ type: typeKey, source, attr?: attrKey, aggregate }] }`; план — `update.typeAssembly: [{ _id, assembly }]` **только если у подхваченного типа `assembly.slots` пуст** (иначе ничего, без предупреждения); `enabled: true` ставится вместе со слотами.
- Второй сид: переиспользует определения первого (импорт его `catalog`), для «Системного блока» — слоты по спеке (Процессор*, Материнская плата*, Оперативная память* несколько, Накопитель* несколько, Блок питания*, Корпус*, Видеокарта, Охлаждение, Wi-Fi адаптер) и ключевые характеристики (процессор — модель; память — объём модуля, сумма; тип памяти, первое; накопитель — объём, сумма; тип накопителя, список; видеокарта — модель).

- [ ] **Step 1: Тесты:** `typeAssembly` — у типа без слотов ставится; у типа со слотами — не трогается; ключи слотов/атрибутов неизвестны → warning; повторный план по результату — пусто; санитар второго сида на пустой базе с первым сидом — без warnings.
- [ ] **Step 2:** FAIL → реализация → PASS; eslint.
- [ ] **Step 3:** Дев-база: `node scripts/seed.js up` (только второй сид — первый уже применён) → лог; второй `up` → «nothing pending». Документация: `inventory.md` (assembly, DeviceBuild, API), таблица сидов в `deployment.md`.
