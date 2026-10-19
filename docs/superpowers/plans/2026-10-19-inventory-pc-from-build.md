# Инвентарь, проект 3: ПК из сборки — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устройство «Своя сборка» типа с включёнными комплектующими создаётся из сборки (или вручную по слотам): каждая деталь — отдельный `ClientDevice` с серийником, гарантией и закупкой; карточка ПК показывает фактические детали, отличия от сборки и характеристики из деталей; строка списка — ключевые характеристики.

**Architecture:** Бэкенд: `ClientDevice.buildId`, создание ПК вместе с деталями одним запросом (`POST /client-devices/add` с `parts[]`, проверки до записи, откат по `_id`), `getOne` отдаёт данные для сводки (детали с конфигурациями, сборку, сборочную схему типа, `partLinks`), `getAll` — готовую строку ключевых характеристик (серверный порт `buildKeySpecs`: список серверный, с пагинацией). Фронтенд: адаптер деталей устройства к `AssemblyPart` и сравнение со сборкой в `assembly-specs.ts`; мастер — поле «Сборка» и шаг «Комплектующие»; карточка — «Конфигурация», «Подключено», «Характеристики».

**Tech Stack:** Express 5 + Mongoose 9 (CommonJS, Node 22), React 19 + react-router data routers, Tailwind v4 + `components/app`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-19-inventory-specs-and-assemblies-design.md` («Проект 3», «Решения исполнителя»). Макет (авторитет по виду): https://claude.ai/artifact/W72g1vNQj7W91MyyagPRUf — копия в рабочей папке плана `mockup-pc-from-build.html`.

## Global Constraints

- **Ни commit, ни push, ни `git add/rm`.** Тесты — только затронутые файлы; pnpm; новые поля моделей — и в `backend/types/inventory/*.ts`.
- Схема касается **только** устройств «Своя сборка» (`deviceTypeId` без `deviceModelId`) типа с `assembly.enabled`; заводские устройства и прочие типы — без изменений.
- Деталь = отдельный `ClientDevice` с `parentDeviceId` = ПК, `quantity: 1`, свой инвентарный номер по префиксу своего типа; следует за ПК (компания, место, пользователь, статус копируются, как при прикреплении); «Закупка как у ПК» — `purchasedAt`/`supplierId` ПК, если у детали свои не заданы.
- Устройство никогда не бывает одновременно заводским и своей сборкой: `buildId` только при `deviceTypeId` без модели.
- Создание ПК с деталями — один запрос: всё проверяется до первой записи (слоты, обязательные, `multiple`, тип модели, конфигурация обязательна при >1, компания/пользователь как сейчас); сбой посреди записи — удаление созданного по списку `_id`.
- Отличия от сборки: «заменена» (в слоте другая модель, чем в сборке; показать модель сборки «в сборке: …»), «добавлена» (лишняя единица сверх сборки), «не установлена» (в сборке есть, на ПК нет); предупреждение — пуст обязательный слот.
- Строка списка: у ПК своей сборки собираемого типа мета = ключевые характеристики (через « · ») + компания; у остальных — без изменений.
- UI-тексты: «Сборка», «Без сборки — детали вручную», шаг «Комплектующие», «<N> деталей станут отдельными устройствами в составе этого ПК.», «<тип>» + «1 из 2», «Серийный номер», «Гарантия до», «12 мес / 24 мес / 36 мес», «Закупка как у ПК», «Конфигурация», «Подключено», «заменена», «добавлена», «не установлена», «в сборке: …», «Не установлен обязательный «<тип>». Прикрепите деталь или создайте новую.», «гарантия до <дата>», «через N дней», «гарантия истекла <дата>».
- Права: создание/правка устройств — как сейчас (`device.manage`); клиентские пользователи видят карточку — никаких лишних полей (только то, что нужно сводке, `.select(...)`).
- Типографика 14 / токены / обе темы; макет — авторитет по виду.

## Review Focus

1. Модель детали в сборке удалена или сменила тип к моменту создания ПК — мастер подставляет пустую строку с подсказкой, сервер не принимает чужой тип. → тест в Task 1 (`planDeviceParts: модель чужого типа`), Task 4.
2. Две одинаковые детали в слоте «несколько» с разными серийниками и одна из них откреплена — «Конфигурация» показывает «× 1», отличие от сборки не «заменена», а «не установлена» для недостающей единицы. → тест в Task 3 (`diffWithBuild: недостающая единица`).
3. ПК без `buildId` (вручную по слотам) — отличий нет, только предупреждение о пустых обязательных слотах. → тест в Task 3.
4. Деталь, откреплённая от ПК, становится самостоятельным устройством — не исчезает, не тянет `buildId`. → проверка Task 1 (detach не трогает), Task 5.
5. Список устройств: страница из 50 ПК своей сборки — ключевые характеристики считаются одной пачкой запросов, не N+1. → тест/замер Task 2.

---

### Task 1: Создание ПК с деталями и данные карточки (бэкенд)

**Files:**
- Modify: `backend/models/inventory/clientDevice.js`, `backend/types/inventory/clientDevice.ts`, `backend/controllers/inventory/clientDevice.js`
- Create: `backend/controllers/inventory/clientDeviceParts.test.js`

**Interfaces:**
- Consumes: `DeviceType.assembly`, `DeviceBuild`, `ASSEMBLY_POPULATE` (`controllers/inventory/deviceType.js`), `parseBuildParts`/`resolvePartConfiguration` (`controllers/inventory/deviceBuild.js` — переиспользовать, не копировать).
- Produces: `ClientDevice.buildId` (ref `DeviceBuild`, null); `buildDevicePayload` принимает `buildId`.
- Produces: чистая `planDeviceParts(parts, slots) → { parts } | { error }`: `parts[] = { typeId, deviceModelId, configurationId?, serialNumber?, warrantyExpirationDate?, purchasedAt?, supplierId? }`, каждая — одна единица; группировка по типу для правил слотов (`multiple`, обязательные — сообщение «Не заполнено: …»); деталь вне слотов → ошибка.
- Produces HTTP: `POST /client-devices/add` при «своей сборке» типа с `assembly.enabled` принимает `parts[]` (может быть пусто — тогда обязательные слоты не проверяются, ПК создаётся без деталей, как сейчас) и `buildId` (сборка этого типа, не удалена); проверки деталей — до первой записи (модели существуют, не удалены, их тип = `typeId`, конфигурация обязательна при >1 и принадлежит модели); создаётся ПК, затем детали (`parentDeviceId`, компания/место/пользователь/статус ПК, закупка ПК по умолчанию, инвентарный номер по префиксу типа детали); сбой → удаление созданных деталей и ПК по `_id`, исходная ошибка наружу. Ответ — как сейчас + `components`.
- Produces: `GET /client-devices/:id` дополнительно (только у своей сборки собираемого типа): `assembly` (схема типа, populate как в типе), `build` (`{_id, name, parts}` с populate деталей как в `/device-builds/:id`, или null), `partLinks` (по типам деталей-компонентов), а `components[]` — с populate `deviceModelId` (`name vendorId deviceTypeId deletedAt`), `configurationId` (`name values deletedAt` + `values.attributeId` `code name unit valueType options`), `deviceTypeId` (`name`), полями `serialNumber warrantyExpirationDate purchasedAt inventoryNumber quantity`. Отдельные `.select`, без лишнего для клиентов.

- [ ] **Step 1: Тесты `planDeviceParts`**: валидный набор (2 единицы памяти в `multiple`); вторая единица в не-`multiple` → error; деталь вне слотов → error; пропущен обязательный → «Не заполнено: …»; пустой список → `{parts: []}` без проверки обязательных.
- [ ] **Step 2:** FAIL → **Step 3:** реализация (+ `buildId` в схеме/типе, создание с откатом, `getOne`) → **Step 4:** PASS, eslint, `node --check`; дев-смоук со стабами: ПК из сборки с 3 деталями (одна с своей закупкой) → `getOne` возвращает `components`/`build`/`assembly`/`partLinks`; ошибка на второй детали → ничего не осталось (подсчёт по `claude-test`); удалить всё по `_id`.

### Task 2: Ключевые характеристики в списке устройств (бэкенд)

**Files:**
- Create: `backend/services/inventory/assemblyKeySpecs.js`, `backend/services/inventory/assemblyKeySpecs.test.js`
- Modify: `backend/controllers/inventory/clientDevice.js` (`getAll`, `toListDevice`)

**Interfaces:**
- Produces: `keySpecsLine({ keySpecs, slots }, parts) → string` — серверный порт `buildKeySpecs`/`keySpecsLine` из `frontend/src/components/app/assembly-specs.ts` с тем же контрактом и форматированием (`formatSpecValue`: «да/нет», подпись опции, число + единица; `sum` с учётом `quantity`, нечисловые пропуск; `list` — различные через «, »; модель — «Vendor Name», удалённая — «модель удалена»); тесты — **те же векторы**, что во фронтовом `assembly-specs.test.js` для `buildKeySpecs`/`keySpecsLine` (скопировать входы и ожидания).
- Produces: `getAll` → у строк ПК своей сборки собираемого типа поле `keySpecs: string` (пусто — без поля); данные — пачкой на страницу: один запрос детей видимых хостов, один — типов со сборкой, один — моделей/конфигураций деталей (populate), не N+1.

- [ ] **Step 1: Тесты** (векторы фронта) → FAIL → реализация → PASS; тест/проверка «одна пачка»: счётчик вызовов фейковых моделей на 3 ПК — фиксированное число запросов.
- [ ] **Step 2:** eslint, `node --check`; дев-смоук `getAll` со стабом: у ПК из Task 1 (пересоздать `claude-test`) есть `keySpecs`, у прочих нет; удалить по `_id`.

### Task 3: Детали устройства как сборка (утилита фронта)

**Files:**
- Modify: `frontend/src/components/app/assembly-specs.ts`, `frontend/src/components/app/assembly-specs.test.js`

**Interfaces:**
- Consumes: `components[]` и `build` из Task 1.
- Produces:
  - `devicePartsToAssembly(components) → AssemblyPart[]` — каждая деталь-устройство: `typeId` = тип модели (иначе `deviceTypeId`), `deviceModelId`, `configurationId`, `quantity`, плюс `deviceId`, `serialNumber`, `warrantyExpirationDate`.
  - `diffWithBuild(slots, buildParts, deviceParts) → { rows: Array<{ key, slotLabel, typeId, part|null, tag: null|"replaced"|"added"|"missing", buildTitle?: string }>, missingRequired: string[] }` — по слотам: фактические единицы сопоставляются с единицами сборки по модели; совпало — без метки; лишняя единица — «added»; единица сборки без пары — если в слоте есть несопоставленная фактическая единица другой модели → эта единица «replaced» с `buildTitle`, иначе строка «missing» с `buildTitle`; без сборки (`buildParts` null) — меток нет; `missingRequired` — обязательные слоты без единиц; детали вне слотов — не здесь (их покажет «Подключено» / конец списка).
  - `warrantyNote(dateIso, today) → { text, tone: "normal"|"soon"|"expired" }` — «гарантия до 19.10.2029», «… — через N дней» (≤ 30 дней), «гарантия истекла …».

- [ ] **Step 1: Тесты:** совпадение без меток; «заменена» с моделью сборки; «добавлена»; «не установлена»; недостающая единица в `multiple` (Review Focus 2); без сборки — только `missingRequired` (Review Focus 3); `warrantyNote` три тона и граница 30 дней; `devicePartsToAssembly` берёт тип модели.
- [ ] **Step 2:** FAIL → реализация → PASS; eslint; `npx tsc --noEmit -p .`.

### Task 4: Мастер — «Сборка» и шаг «Комплектующие»

**Files:**
- Modify: `frontend/src/components/ClientDevice/Form.jsx`, `frontend/src/components/ClientDevice/FormFields.jsx`, `frontend/src/pages/ClientDevice/Add.jsx` (и loader/action, где собирается тело)
- Create: `frontend/src/components/ClientDevice/PartsStep.jsx`

**Interfaces:**
- Consumes: `GET /device-types/:id` (`assembly`), `GET /device-builds?deviceTypeId=`, `GET /device-models`, `GET /device-configurations/model/:id`, `keySpecsLine`/`buildPartRows` (Task 3 проекта 2), `POST /client-devices/add` с `parts`/`buildId` (Task 1).
- Produces: в шаге «Устройство» при «Своя сборка» и типе с `assembly.enabled` — поле «Сборка» (`Combobox`: сборки типа + «Без сборки — детали вручную»), под ним карточка-сводка (макет разд. 1: ключевые характеристики жирным + «N деталей: …»); шаг «Комплектующие» вставляется вторым (только при создании; при правке ПК детали правятся с карточки) — по макету разд. 2: строки по единицам (из сборки — по `quantity` единиц; вручную — по одной пустой строке на слот, «Ещё <тип>» у `multiple`), в строке: модель (Combobox моделей типа; конфигурация при >1), «Серийный номер», «Гарантия до» (дата) + чипы «12/24/36 мес» от даты покупки (ПК или своей), переключатель «Закупка как у ПК» (выкл → «дата покупки» + «поставщик»); подвал «Серийник можно оставить пустым и дописать позже.»; блокировка «Далее» при пустом обязательном слоте или незаполненной конфигурации («Не заполнено: …»). Тело запроса: `buildId`, `parts[]` (без пустых строк).

- [ ] **Step 1:** Поле «Сборка» + сводка. **Step 2:** Шаг и строки. **Step 3:** Сборка тела, ошибки сервера — в мастере. **Step 4:** eslint, `npx tsc --noEmit -p .`, util-тесты зелёные.

### Task 5: Карточка ПК и строка списка

**Files:**
- Modify: `frontend/src/components/ClientDevice/View.jsx`, `frontend/src/components/ClientDevice/NewComponentDialog.jsx`, `frontend/src/components/ClientDevice/DeviceRow.jsx`

**Interfaces:**
- Consumes: `getOne` (Task 1), `keySpecs` списка (Task 2), `devicePartsToAssembly`/`diffWithBuild`/`warrantyNote` (Task 3), `buildKeySpecs`/`buildAssemblyGroups`/`liveAssembly` (проект 2), `SpecSheet`.
- Produces: у ПК своей сборки собираемого типа (по макету разд. 3): в hero подзаголовок «<тип> · своя сборка · <ссылка на сборку>» и чипы ключевых характеристик (по фактическим деталям); секция «Конфигурация · N» (вместо «Состава сборки»; действия «Новая» / «Прикрепить» прежние) — предупреждение о пустых обязательных слотах, строки `diffWithBuild` (слот, ссылка на устройство-деталь, «SN … · гарантия …» с тоном `warrantyNote`, «× N» для `quantity > 1` при сведённых одинаковых, метки, «в сборке: …», «⋯» → «Открепить» как сейчас); «Подключено · N» — дети вне слотов (периферия и т. п.) прежними строками; «Характеристики» — `SpecSheet` из `buildAssemblyGroups(devicePartsToAssembly(...), partLinks)` вместо конфигурации. У остальных устройств карточка не меняется.
- Produces: `NewComponentDialog` — выбор конфигурации модели детали (если у модели >1 — обязателен; одна — подставляется).
- Produces: `DeviceRow` — мета `keySpecs · компания`, если есть `keySpecs`, иначе прежняя (макет разд. 4).

- [ ] **Step 1:** Карточка. **Step 2:** Диалог. **Step 3:** Строка списка. **Step 4:** eslint, `npx tsc --noEmit -p .`, util-тесты; `docs/inventory.md` — `buildId`, создание с `parts`, поля `getOne`, `keySpecs` в списке.
