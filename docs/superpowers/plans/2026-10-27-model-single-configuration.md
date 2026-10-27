# Модель с одной конфигурацией по умолчанию — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** По умолчанию у модели одна конфигурация, её характеристики правятся как свойства модели (в форме и на карточке модели). Переключатель «Несколько конфигураций» возвращает нынешний интерфейс вариантов. Устройство привязывается к единственной конфигурации само.

**Architecture:** Значения характеристик по-прежнему живут в `DeviceConfiguration`. Модель получает флаг `multiConfig`. Инвариант: у каждой живой модели есть хотя бы одна живая конфигурация. Правила сведены в один сервис `services/inventory/modelConfigurations.js`: чистые решающие функции плюс тонкие async-обёртки над Mongoose. Ими пользуются контроллеры модели, конфигурации и устройства, операции агента (`catalogOps`) и миграция. Фронт: поля характеристик выносятся в общий `SpecFields`, который рендерят форма конфигурации и форма модели (в том числе в быстром создании модели из формы устройства).

**Tech Stack:** Node/Express/Mongoose (backend, CommonJS, `node:test`), React + React Router data routers + Tailwind/shadcn (frontend, JSX/TS, `node:test` для чистых модулей), pnpm.

**Spec:** макет https://claude.ai/artifact/9pEEHaXmAkf8QSz6XEZdfT (v2, одобрен владельцем 27.10.2026 «ок, делаем»). Разделы макета «1. Карточка модели», «2. Форма модели», «3. Форма устройства», «Что меняется внутри» — спека этого плана. Отдельного документа дизайна нет. Код повторяет макет пиксельно, а не «по мотивам».

## Global Constraints

- **Не коммитить и не пушить.** Git ведёт владелец. Шаг «Commit» в каждой задаче = `git status` + короткий список изменённых файлов в отчёте, без `git add`/`git commit`.
- pnpm, не npm/yarn. Бэкенд-тесты — только файлы затронутого кода: `cd backend && node --test <file>`. Полный `pnpm test` бэкенда не гонять.
- Фронт: `cd frontend && pnpm lint` (`--max-warnings=0`) и `pnpm typecheck`. Typecheck красный до правок одной давней ошибкой (FormWrapper) — новых ошибок быть не должно.
- Плагина `react-hooks` во фронте нет: `eslint-disable react-hooks/*` сам валит линт.
- Тексты интерфейса — по-русски, как в макете, дословно. Комментарии в коде — по-русски, в духе соседнего кода.
- Удаление в миграции запрещено. Миграция только вставляет конфигурации и проставляет поля по списку `_id`.
- Фронт-примитивы — из `components/app` (Panel, Eyebrow, Field, Combobox, SwitchField…). Своих не плодить.
- Никаких `text-[Npx]`. Типографика — шкала Dense из `docs/ux-ui-guide.md`.

## Решения (из макета и обсуждения)

1. `DeviceModel.multiConfig: Boolean`, default `false`. Режим — флаг, а не число конфигураций.
2. У живой модели всегда ≥ 1 живая конфигурация. Новая модель создаётся сразу с конфигурацией (значения из формы или пустая). Последнюю конфигурацию удалить нельзя (в любом режиме).
3. Выключить `multiConfig` можно, только если живая конфигурация одна. Иначе 409 «Чтобы выключить «Несколько конфигураций», оставьте одну конфигурацию». Включить можно всегда, конфигурация становится первой.
4. Добавить конфигурацию через портал (`POST /device-configurations/add`) можно только при `multiConfig: true`. Иначе 409 «Включите «Несколько конфигураций» в модели, чтобы добавить вторую».
5. «Единственная конфигурация» модели = модель НЕ в режиме нескольких и живая конфигурация ровно одна. Сервер пишет её в `configurationId` устройства при создании и правке, если конфигурация не прислана. Привязка записывается, а не вычисляется при чтении.
6. Агент (`createConfiguration`): если модель не в режиме нескольких и её единственная конфигурация пуста (без значений) — заполнить её (имя, описание, значения). Иначе создать новую и включить модели `multiConfig`. `createModel` агента создаёт модель вместе с пустой конфигурацией.
7. Порядок конфигураций для «первой» — по `createdAt` по возрастанию.
8. Список моделей (`DeviceModel/Item.jsx`): в режиме одной конфигурации мета строки — только тип, без «1 конфигурация» (как шапка карточки в макете). **Этой строки нет в макете.** Перед задачей 8 показать владельцу одной фразой и получить «ок».

## Review Focus

1. **Модель с ≥ 2 конфигурациями до миграции (флаг ещё `false`).** Карточка не должна терять варианты. Миграция ставит им `multiConfig: true`. До неё правило 5 даёт `null` (не ровно одна), и устройство не привязывается к случайной. Тест — задача 1.
2. **Включили переключатель в форме новой модели, уже заполнив поля.** Ожидание из макета: «уже введённые станут первой конфигурацией». Значения уходят в первую конфигурацию. Тест — задача 2 (`modelWriteFromBody`).
3. **Смена модели у существующего устройства.** Конфигурация прежней модели не должна остаться у новой. Форма уже сбрасывает `configurationId`, сервер подставляет единственную конфигурацию новой модели. Тест — задача 3.
4. **Повторный прогон миграции.** Ничего не дублирует: модели с конфигурацией не получают вторую, у устройств с привязкой она не перетирается. Тест — задача 5.
5. **Агент предлагает конфигурацию модели, созданной до миграции, у которой их ноль.** `createConfiguration` должен создать конфигурацию, а не падать на «нет первой». Тест — задача 4.

---

### Task 1: Флаг `multiConfig` и сервис правил

**Files:**
- Modify: `backend/models/inventory/deviceModel.js` (поле после `notes`)
- Create: `backend/services/inventory/modelConfigurations.js`
- Test: `backend/services/inventory/modelConfigurations.test.js`

**Interfaces:**
- Produces (чистые; `model` — `{ multiConfig?: boolean }`, `configs` — живые конфигурации по `createdAt` ↑, у каждой `{ _id, values? }`):
  - `soleConfiguration(model, configs) -> config | null` — `!model.multiConfig && configs.length === 1 ? configs[0] : null`
  - `multiConfigOffError(liveCount: number) -> string | null` — текст решения 3 при `liveCount > 1`
  - `configAddError(model) -> string | null` — текст решения 4 при `!model.multiConfig`
  - `configDeleteError(liveCount: number) -> string | null` — «Последнюю конфигурацию модели удалить нельзя» при `liveCount <= 1`
  - `agentConfigurationMode(model, configs) -> "fill" | "add" | "create"` — `"fill"`: не multi и ровно одна конфигурация без значений; `"create"`: конфигураций нет; иначе `"add"`
- Produces (async, Mongoose):
  - `liveConfigurations(modelId) -> Promise<DeviceConfiguration[]>` — `{ deviceModelId, deletedAt: null }`, sort `{ createdAt: 1 }`, документы (не lean)
  - `soleConfigurationId(modelId) -> Promise<string | null>` — грузит модель (`deletedAt: null`) и конфигурации, применяет `soleConfiguration`, отдаёт `String(_id)`
- Поле схемы: `multiConfig: { type: Boolean, default: false }` с комментарием о решении 1–3.

- [ ] **Step 1: Тесты чистых функций**

```js
test("soleConfiguration: одна живая и не multi — она", () => {
  assert.equal(soleConfiguration({ multiConfig: false }, [C1]), C1);
});
test("soleConfiguration: multi или не ровно одна — null", () => {
  assert.equal(soleConfiguration({ multiConfig: true }, [C1]), null);
  assert.equal(soleConfiguration({}, []), null);
  assert.equal(soleConfiguration({}, [C1, C2]), null); // Review Focus 1
});
test("multiConfigOffError: выключить можно только при одной", () => {
  assert.equal(multiConfigOffError(1), null);
  assert.equal(multiConfigOffError(2), "Чтобы выключить «Несколько конфигураций», оставьте одну конфигурацию");
});
test("configAddError / configDeleteError", () => {
  assert.equal(configAddError({ multiConfig: true }), null);
  assert.match(configAddError({ multiConfig: false }), /Включите «Несколько конфигураций»/);
  assert.equal(configDeleteError(2), null);
  assert.equal(configDeleteError(1), "Последнюю конфигурацию модели удалить нельзя");
});
test("agentConfigurationMode", () => {
  assert.equal(agentConfigurationMode({}, [{ _id: "c", values: [] }]), "fill");
  assert.equal(agentConfigurationMode({}, [{ _id: "c", values: [{ attributeId: "a", value: "1" }] }]), "add");
  assert.equal(agentConfigurationMode({ multiConfig: true }, [{ _id: "c", values: [] }]), "add");
  assert.equal(agentConfigurationMode({}, []), "create"); // Review Focus 5
});
```

- [ ] **Step 2:** `cd backend && node --test services/inventory/modelConfigurations.test.js` → FAIL (модуля нет)
- [ ] **Step 3:** Реализовать поле схемы и сервис по Interfaces
- [ ] **Step 4:** Тот же запуск → PASS
- [ ] **Step 5:** `git status`; в отчёт — список файлов (без коммита)

---

### Task 2: Контроллеры модели и конфигурации

**Files:**
- Modify: `backend/controllers/inventory/deviceModel.js` (`getOne`, `add`, `update`)
- Modify: `backend/controllers/inventory/deviceConfiguration.js` (`add`, `delete`)
- Modify: `backend/services/inventory/modelConfigurations.js` (+ `modelWriteFromBody`)
- Modify: валидация маршрута моделей в `backend/validations/inventory/` (файл модели), если поля проверяются там: `values` — массив, `multiConfig` — boolean, необязательные
- Test: `backend/services/inventory/modelConfigurations.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `modelWriteFromBody(body, { creating: boolean, multiConfig: boolean }) -> { values: Array<{attributeId, value}> | undefined }` — чистая. При создании — `body.values ?? []` всегда (Review Focus 2). При правке — `body.values`, только если итоговый `multiConfig === false`, иначе `undefined` (не трогать).
  - `POST /device-models/add` принимает `values` (форма как у `POST /device-configurations/add`) и `multiConfig`. Создаёт модель, затем конфигурацию `{ deviceModelId, values, createdBy }`. Сбой второй записи → удалить созданную модель по `_id` и вернуть 500. Ответ как сейчас: `deviceModel` теперь с `multiConfig`.
  - `PUT /device-models/update/:id` принимает `values`, `multiConfig`. Выключение при > 1 живой → 409 (`multiConfigOffError`). Затем `values` пишутся в первую живую конфигурацию. Если живых нет — она создаётся.
  - `GET /device-models/:id` → дополнительно `devicesCount` (живые `ClientDevice` с этим `deviceModelId`). Ответ — объект (`.lean()` или `toObject()` + поле).
  - `POST /device-configurations/add` → 409 `configAddError`, если у модели `multiConfig !== true`.
  - `DELETE /device-configurations/:id` → 409 `configDeleteError(liveCount модели)`.

- [ ] **Step 1: Тесты `modelWriteFromBody`**

```js
test("modelWriteFromBody: создание пишет значения и при включённом переключателе", () => {
  const values = [{ attributeId: A1, value: "8" }];
  assert.deepEqual(modelWriteFromBody({ values }, { creating: true, multiConfig: true }), { values });
  assert.deepEqual(modelWriteFromBody({}, { creating: true, multiConfig: false }), { values: [] });
});
test("modelWriteFromBody: правка в режиме нескольких значения не трогает", () => {
  assert.deepEqual(modelWriteFromBody({ values: [] }, { creating: false, multiConfig: true }), { values: undefined });
  assert.deepEqual(modelWriteFromBody({}, { creating: false, multiConfig: false }), { values: undefined });
});
```

- [ ] **Step 2:** Запуск теста → FAIL
- [ ] **Step 3:** Реализовать `modelWriteFromBody` и правки контроллеров по Interfaces
- [ ] **Step 4:** Тест → PASS. `cd backend && pnpm lint` → без новых ошибок в затронутых файлах
- [ ] **Step 5:** `git status`, список файлов

---

### Task 3: Устройство привязывается к единственной конфигурации

**Files:**
- Modify: `backend/services/inventory/deviceOps.js` — `validateNewDevice`, ветка `payload.deviceModelId`
- Modify: `backend/controllers/inventory/clientDevice.js` — `update`, после проверки `deviceModelId`
- Modify: `backend/services/inventory/modelConfigurations.js` (+ `configurationForDevice`)
- Test: `backend/services/inventory/modelConfigurations.test.js`

**Interfaces:**
- Consumes: `soleConfigurationId` (Task 1).
- Produces: `configurationForDevice(given: string | undefined, soleId: string | null) -> string | undefined` — чистая: `given || soleId || undefined`.
- Поведение: создание (портал, «Новая деталь», агент — все через `checkNewDevice`) и правка через форму. Модель задана, `configurationId` не прислан → пишется `soleConfigurationId(deviceModelId)`. Детали ПК из сборки уже решаются `resolvePartConfiguration` — не трогать. `planPatchDevice` модель не меняет — не трогать.

- [ ] **Step 1: Тесты**

```js
test("configurationForDevice: присланная важнее", () => {
  assert.equal(configurationForDevice(C1, C2), C1);
});
test("configurationForDevice: не прислана — единственная модели (смена модели)", () => {
  assert.equal(configurationForDevice(undefined, C2), C2); // Review Focus 3
  assert.equal(configurationForDevice(undefined, null), undefined);
});
```

- [ ] **Step 2:** FAIL → **Step 3:** реализовать и вызвать в двух местах → **Step 4:** PASS; плюс `node --test services/inventory/deviceOps.test.js controllers/inventory/clientDeviceParts.test.js` — зелёные. Если они подменяют `DeviceModel`/`DeviceConfiguration` и падают от нового запроса — добавить в подмену `find`/`findOne`, отдающие пустое
- [ ] **Step 5:** `git status`, список файлов

---

### Task 4: Операции агента

**Files:**
- Modify: `backend/services/inventory/catalogOps.js` — `execute`, `planModel`, `planConfiguration`
- Test: `backend/services/inventory/catalogOps.test.js` (стиль файла: `stubModule`, без базы)
- Modify: `docs/inventory-changes.md` — строка `createConfiguration` таблицы операций (поведение заполнения/включения режима), одной-двумя фразами по-английски

**Interfaces:**
- Consumes: `agentConfigurationMode`, `liveConfigurations` (Task 1).
- Produces:
  - `execute`: план может вернуть `extra: Document[]`. В check-режиме — `validate()` каждого, в записи — `save()` по порядку после `doc`. Результат не меняется (`id` — `doc._id`).
  - `planModel`: `extra = [new DeviceConfiguration({ deviceModelId: doc._id, values: [], ...author })]`. Текст не меняется.
  - `planConfiguration` по режиму:
    - `"fill"` — `doc` = единственная конфигурация (документ) с новыми `name`, `description`, `values`, `updatedBy`. Текст: «Характеристики модели <модель>: <показ>».
    - `"add"` — новая конфигурация, как сейчас; если `!model.multiConfig` — `extra = [модель-документ с multiConfig: true]`.
    - `"create"` — новая конфигурация, как сейчас, без `extra`.

- [ ] **Step 1: Тесты** (подменить `DeviceConfiguration.find` → список по сценарию)
  - `createModel` в записи сохраняет и модель, и пустую конфигурацию с её `deviceModelId`
  - `createConfiguration`, одна пустая конфигурация, не multi → новой не создано, у существующей `values`/`name` из параметров, текст начинается с «Характеристики модели»
  - `createConfiguration`, одна заполненная, не multi → новая + у модели сохранён `multiConfig === true`
  - `createConfiguration`, конфигураций нет → одна новая, модель не сохраняется (Review Focus 5)
  - `checkConfiguration` в любом режиме ничего не сохраняет
- [ ] **Step 2:** FAIL → **Step 3:** реализовать → **Step 4:** `node --test services/inventory/catalogOps.test.js services/inventory/changeOps*.test.js` PASS (какие есть)
- [ ] **Step 5:** `git status`, список файлов

---

### Task 5: Миграция

**Files:**
- Create: `backend/scripts/singleModelConfigurations.js` (по образцу `normalizePhones.js`: шапка-комментарий, без флага — показать, `--apply` — записать, код 1 при несовпадениях)
- Modify: `backend/scripts/migrate.js` — в конец `MIGRATIONS`: `{ id: "2026-10-27-singleModelConfigurations", script: "singleModelConfigurations.js", apply: true }` с однострочным комментарием
- Modify: `backend/services/inventory/modelConfigurations.js` (+ `planModelConfigMigration`)
- Test: `backend/services/inventory/modelConfigurations.test.js`

**Interfaces:**
- Produces: `planModelConfigMigration({ models, configs, devices }) -> { createFor: modelId[], multiOn: modelId[], link: Array<{ deviceId, configurationId }> }` — чистая. Вход: живые модели `{ _id, multiConfig }`, живые конфигурации `{ _id, deviceModelId, createdAt }`, живые устройства с моделью и без `configurationId` `{ _id, deviceModelId }`.
  - `createFor` — модели без конфигураций.
  - `multiOn` — модели с ≥ 2 конфигурациями и `multiConfig !== true`.
  - `link` — устройства, чья модель не в `multiOn`, не multi и имеет ровно одну конфигурацию. Модели из `createFor` в `link` не попадают: id новой конфигурации неизвестен до вставки. Скрипт после вставки зовёт план повторно и только тогда пишет `link`.
- Скрипт пишет `updateOne` по `_id` с условием-стражем: модель `{ multiConfig: { $ne: true } }`, устройство `{ configurationId: null }`. Отчёт — только счётчики и `_id`.

- [ ] **Step 1: Тесты**
  - модель без конфигураций → в `createFor`, её устройства не в `link`
  - модель с одной → её устройства без конфигурации в `link` с этой конфигурацией
  - модель с двумя → в `multiOn`, её устройства не в `link`
  - повторный прогон (Review Focus 4): вход после применения (у каждой модели одна, устройства привязаны, двухконфигурационные с `multiConfig: true`) → все три списка пусты
- [ ] **Step 2:** FAIL → **Step 3:** реализовать план и скрипт → **Step 4:** PASS
- [ ] **Step 5:** Дев-база: `docker compose -f compose.dev.yml run --rm backend node scripts/singleModelConfigurations.js` (показ). Ожидание на дев-копии: около 38 моделей в `createFor`. Затем `docker compose -f compose.dev.yml run --rm backend node scripts/migrate.js up` и повторный показ → «нечего делать». Docker — из песочницы недоступен, нужен `dangerouslyDisableSandbox`
- [ ] **Step 6:** `git status`, список файлов

---

### Task 6: Общий компонент полей характеристик

**Files:**
- Create: `frontend/src/components/DeviceConfiguration/SpecFields.jsx`
- Modify: `frontend/src/components/DeviceConfiguration/Form.jsx` — рендер атрибутов заменить на `SpecFields`

**Interfaces:**
- Produces: `<SpecFields links={SpecLink[]} values={Array<{attributeId: string, value}>} onChange={(next) => void} />` — default export. Внутри: перенесённые без изменений `renderAttributeInput` и разметка групп (`groupLinks(links, "Прочее")`, заголовки групп только при `hasGroups`, сетка `sm:grid-cols-2`, multiselect на две колонки). Без `links` (пустой массив) рендерит `null`: предупреждение «У типа устройства нет характеристик…» остаётся снаружи, в `Form.jsx`.
- Вид формы конфигурации не меняется ни на пиксель.

- [ ] **Step 1:** Перенести код. Логика `values`/`handleValueChange` остаётся у владельца состояния (`Form.jsx`), `SpecFields` получает `values` и сообщает `onChange(nextValues)`
- [ ] **Step 2:** `cd frontend && pnpm lint && pnpm typecheck` → без новых ошибок
- [ ] **Step 3:** `git status`, список файлов

---

### Task 7: Форма модели с разделом «Характеристики»

**Files:**
- Modify: `frontend/src/components/DeviceModel/FormFields.jsx`
- Modify: `frontend/src/components/DeviceModel/Form.jsx`
- Modify: `frontend/src/pages/DeviceModel/Add.jsx`, `frontend/src/pages/DeviceModel/Update.jsx` (loader + action)
- Modify: `frontend/src/components/ClientDevice/InlineCreateDialog.jsx` (вид `deviceModel`)

**Interfaces:**
- Consumes: `SpecFields` (Task 6); API задачи 2.
- `DeviceModelFormFields` получает новые пропсы `configuration` (первая живая конфигурация или `null`) и `configurationsCount: number`. Ведёт состояние `values` (из `configuration.values`) и `multiConfig` (из `deviceModel.multiConfig`). Связки типа грузит по выбранному `deviceTypeId` через `load(\`/api/inventory/device-type-attributes/type/${typeId}\`)` (как `AssemblyForm`). Смена типа сбрасывает `values`.
- Отдаёт наверх: скрытые инпуты `values` (JSON без пустых) и `multiConfig` (`"true"`/`"false"`). В `onChange` — те же поля в агрегате.
- Раздел (макет, «2. Форма модели»): после «Примечаний» — `border-t` + `SubLabel` «Характеристики». Затем строка-переключатель на `bg-accent`, заголовок «Несколько конфигураций», подпись:
  - выключен / включён — «Включите, если модель выпускается в разных исполнениях, например 16 ГБ / 512 ГБ и 32 ГБ / 1 ТБ.»
  - включён и `configurationsCount > 1` — «Чтобы выключить, оставьте на карточке одну конфигурацию.»; переключатель `disabled`
- Под переключателем: выключен → `SpecFields`. Включён → пунктирная плашка с иконкой info: «Характеристики задаются в конфигурациях на карточке модели. **Уже введённые станут первой конфигурацией.**» (при `configurationsCount > 1` — «Характеристики — в **N конфигурациях** на карточке модели.», N — `configurationsCount` цифрами; предложный падеж «конфигурациях» верен для любого N ≥ 2). У типа нет связок → вместо полей текст «У типа устройства нет характеристик.»
- Примечание у кнопок (только выключен): «Пустые поля можно заполнить позже.»
- Раздел адресуем по хешу `#specs` (механизм `FormSections` из `components/app/FormLayout.jsx`, как в форме устройства; рейл не нужен — `rail={false}`).
- Update loader: + `api(\`/api/inventory/device-configurations/model/${params.id}\`)`. В форму — самая ранняя по `createdAt` и `length`. Actions обеих страниц: `values: JSON.parse(data.get("values") || "[]")`, `multiConfig: data.get("multiConfig") === "true"`. 409 возвращается как сейчас (покажет FormWrapper).
- `InlineCreateDialog.deviceModel`: `buildBody` + `values`, `multiConfig`. Удалить `afterCreate` (конфигурацию создаёт сервер), `size` оставить `"lg"`.

- [ ] **Step 1:** Реализовать по Interfaces и макету (обе темы, телефон: поля в одну колонку, переключатель справа в строке)
- [ ] **Step 2:** `pnpm lint && pnpm typecheck` → без новых ошибок
- [ ] **Step 3:** `git status`, список файлов

---

### Task 8: Карточка и список моделей

**Files:**
- Modify: `frontend/src/components/DeviceModel/View.jsx`
- Modify: `frontend/src/components/DeviceModel/Item.jsx` (только после «ок» владельца по решению 8)

**Interfaces:**
- Consumes: `deviceModel.multiConfig`, `deviceModel.devicesCount` (Task 2).
- Шапка (макет «1. Карточка модели»): после ссылки на тип — `· N устройств` (`plural`: устройство/устройства/устройств, жирное число как сейчас). Счётчик конфигураций — только при `multiConfig`. Фото/совместимость — без изменений.
- Не `multiConfig`: вместо блока «Конфигурации» — `Eyebrow` «Характеристики» с действием `Button variant="outline" size="xs"` «Изменить» (иконка `RiEdit2Line`, `Link to="update#specs"`, только при `canManage`). Под ним `Panel` со `SpecSheet` первой конфигурации. Пусто или конфигурации нет → пустое состояние: иконка-список, «Характеристики не заполнены», «Их увидят все устройства этой модели. Из них же собирается сводка ПК своей сборки.», кнопка `size="sm"` «Заполнить» (`update#specs`, только при `canManage`). В пустом состоянии у eyebrow кнопки нет. У типа без атрибутов — нынешний `EmptyConfigs` «У типа устройства нет характеристик».
- `multiConfig`: всё как сейчас. В `ConfigActions` пункт «Удалить» скрыт, когда конфигурация одна.
- `Item.jsx`: не `multiConfig` → `detail = null` (мета — только тип). Иначе — как сейчас. Расходники — без изменений.

- [ ] **Step 1:** Реализовать карточку по макету (три состояния, обе темы, телефон)
- [ ] **Step 2:** Показать владельцу решение 8 одной фразой; после «ок» — `Item.jsx`
- [ ] **Step 3:** `pnpm lint && pnpm typecheck` → без новых ошибок
- [ ] **Step 4:** `git status`, список файлов

---

### Task 9: Форма устройства

**Files:**
- Create: `frontend/src/components/ClientDevice/model-config.ts`
- Test: `frontend/src/components/ClientDevice/model-config.test.js`
- Modify: `frontend/src/components/ClientDevice/FormFields.jsx` (блок `device-configuration`, ~стр. 264–279)
- Modify: `frontend/src/components/ClientDevice/Form.jsx` (загрузка связок типа для сводки)
- Modify: `frontend/src/components/app/spec-sheet.ts` — `specSummary(links, values, limit = 3, separator = " / ")`

**Interfaces:**
- Produces: `configFieldMode(configurations: unknown[] | null) -> "picker" | "summary" | null` — `length > 1` → `"picker"` (правило `needsConfiguration`), `=== 1` → `"summary"`, иначе `null`.
- `"picker"` — нынешнее поле «Конфигурация» без изменений. `"summary"` — плашка под полем «Модель» (макет «3. Форма устройства»): `bg-accent`, рамка, иконка info, жирная сводка `specSummary(typeLinks, configurations[0].values, 4, " · ")`, затем « — характеристики модели. » и ссылка «Открыть модель» на `/inventory/device-models/:id`. Пустая сводка → плашки нет. Связки типа — `load(\`/api/inventory/device-type-attributes/type/${typeId}\`)` по типу выбранной модели, только в режиме `"summary"`.
- Сабмит: в режиме `"summary"` `configurationId` не отправляется — пишет сервер (Task 3).

- [ ] **Step 1: Тест**

```js
test("configFieldMode", () => {
  assert.equal(configFieldMode([{}, {}]), "picker");
  assert.equal(configFieldMode([{}]), "summary");
  assert.equal(configFieldMode([]), null);
  assert.equal(configFieldMode(null), null);
});
```
  и в `spec-sheet.test.js`: `specSummary(links, values, 4, " · ")` склеивает через « · », вызов без 4-го аргумента — через « / ».
- [ ] **Step 2:** `cd frontend && node --test src/components/ClientDevice/model-config.test.js src/components/app/spec-sheet.test.js` → FAIL
- [ ] **Step 3:** Реализовать
- [ ] **Step 4:** Тесты PASS, `pnpm lint && pnpm typecheck` без новых ошибок
- [ ] **Step 5:** `git status`, список файлов

---

### Task 10: Документация и сводная проверка

**Files:**
- Modify: `docs/inventory.md` — абзац у модели данных (`DeviceConfiguration … preset values per model`): флаг `multiConfig`, инвариант ≥ 1, автопривязка устройства. По-английски, без UI (конвенция модульных доков)

- [ ] **Step 1:** Дописать абзац
- [ ] **Step 2:** Бэкенд: `node --test` по всем тест-файлам задач 1–5. Фронт: тесты задачи 9, `pnpm lint`, `pnpm typecheck`
- [ ] **Step 3:** Отчёт владельцу: что сделано, что проверено, что не проверено в браузере (UI владелец смотрит сам), миграция прогнана на деве. `git status` — список файлов, без коммита
