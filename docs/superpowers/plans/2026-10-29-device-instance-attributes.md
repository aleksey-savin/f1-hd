# Атрибуты устройства (экземпляра) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У атрибута каталога появляется уровень «у модели / у каждого устройства»; значения уровня устройства хранятся на самом устройстве, а IP, MAC и ОС переезжают из полей карточки в такие атрибуты. Мастер нового устройства теряет шаг «Сеть и система».

**Architecture:** Уровень — свойство `DeviceAttribute.scope` (`"model"` | `"device"`), связка с типом (`DeviceTypeAttribute`) не меняется. Значения уровня устройства лежат в `ClientDevice.attributes: [{ attributeId, value }]` той же формы, что `DeviceConfiguration.values`, и проверяются тем же `attributeValue.js`. Три системных атрибута (`operatingsystem`, `ip_address`, `mac_address`) заводит одна идемпотентная функция; её зовут и новый сид (для новых установок), и миграция переноса значений (для работающих). Потребители старых полей (Mikrotik, MCP, поиск, DTO списков) читают и пишут через один модуль по коду атрибута, поэтому ключи DTO `ipAddress`/`operatingSystem` для фронта остаются.

**Tech Stack:** Node/Express/Mongoose (backend, `node --test`), React Router + Tailwind/shadcn (frontend, `node --test` для чистых модулей).

**Spec:** согласованный макет https://claude.ai/artifact/LDmsKzHFLfZWfWZxoNVTtZ (экраны 1–6, обе темы, десктоп и телефон) и решения из обсуждения 29.10.2026 (память `device-form-no-tech-step`). Отдельного документа спеки нет — решения перечислены в «Global Constraints».

## Global Constraints

- **Не коммитить и не пушить.** Git ведёт владелец; шаги «Commit» в задачах заменены на «оставить в дереве».
- Уровень хранится на атрибуте: `scope: { type: String, enum: ["model", "device"], default: "model" }`. Сменить уровень нельзя, пока у атрибута есть значения (в конфигурациях — для `model`, на устройствах — для `device`): ответ 409 «У атрибута «{name}» уже есть значения — уровень не меняется».
- Новый тип данных `date`, подпись «Дата»; хранится строкой `YYYY-MM-DD`.
- Имя устройства (`hostname`) остаётся полем модели `ClientDevice` (ключ агента, частичный уникальный индекс `companyId+hostname`). В формах и на карточке показывается только у типов с назначением «Устройство» (`kindOf(type) === "primary"`, `frontend/src/components/DeviceType/kinds.js`). Сервер поле не чистит.
- Системные атрибуты уровня устройства, тип данных `string`, без группы:
  - `operatingsystem` «Операционная система» — существующий атрибут сида каталога; на проде (29.10) у него 1 связка и 0 значений в конфигурациях, поэтому его уровень переключается на `device`. Тип — строка, а не список, как нарисовано в макете: Mikrotik пишет «RouterOS 7.21.3 (stable)», старые значения — свободный текст.
  - `ip_address` «IP-адрес», `mac_address` «MAC-адрес» — создаются, если их нет (поиск по коду ИЛИ имени — устаревший уникальный индекс `name_1`, память `deviceattribute-stale-name-index`).
- Поля `ipAddress`, `macAddress`, `operatingSystem` уходят из схемы `ClientDevice`, валидаций и типов; миграция переносит значения и делает `$unset`. На проде (29.10): IP у 19 устройств, ОС у 21, MAC у 0 из 63.
- `macAddress` остаётся секретом для MCP: значение атрибута `mac_address` агенту не отдаётся никогда (как раньше поле).
- Обязательные атрибуты устройства (`link.required`) проверяются только на пути интерфейса (`controllers/inventory/clientDevice.js` add/update): MCP-агент и автосоздание из Mikrotik ими не блокируются.
- В конфигурацию модели атрибут уровня `device` не пишется (400 «Атрибут «{name}» задаётся у каждого устройства, а не у модели»), в ключевые характеристики сборки — тоже.
- Тексты интерфейса — дословно из макета: «Атрибуты модели», «Атрибуты устройства», «Одно значение на конфигурацию модели — заполняется в карточке модели.», «Своё значение у каждого экземпляра — заполняется в карточке устройства.», «Добавить атрибуты устройства», «Значение задаётся», «У модели», «У каждого устройства», «Своё значение у каждого экземпляра: имя в сети, IP, дата производства. Заполняется в карточке устройства.», «Параметры устройства», «{названия необязательных} — потом, в карточке устройства.».
- Тесты — только файлы затронутого кода: `node --test <файл>` (полный `pnpm test` бэкенда не гонять — память `unit-tests-node-test`). Файловый «not ok» из-за EACCES на `logs/` в песочнице — не провал.
- Проверки фронта в конце каждой фронтовой задачи: `npx eslint <файлы>`, `npx tsc --noEmit` (база — 0 ошибок), `npx vite build --outDir "$TMPDIR/vbuild"`.
- **Пересечение с планом `2026-10-29-mcp-inventory-model-specs.md`** (другая сессия): общие файлы `services/inventory/catalogEditOps.js`, `services/inventory/changeOps/kit.js`, `services/mcp/inventoryChangeTools.js`, `services/mcp/inventorySource.js`. Перед задачами 1 и 5 перечитать эти файлы целиком и править точечно, не переписывая чужие куски.

## Review Focus

1. **Смена типа или модели устройства.** Значения атрибутов, которых нет у нового эффективного типа, при сохранении отбрасываются, остальные сохраняются. Тест — задача 3.
2. **Частичная правка (MCP `updateDevice` только с `ipAddress`, синхронизация Mikrotik только IP).** Остальные атрибуты устройства не стираются. Тест — задачи 3 и 5.
3. **Mikrotik пишет IP устройству, у типа которого нет связки с `ip_address`.** Связка создаётся, иначе значение невидимо на карточке. Тест — задача 5.
4. **Поиск по IP в списке устройств и в «Технике» компании** находит устройство, как до переезда. Тест — задача 3.
5. **MAC не утекает в MCP** ни через карточку устройства, ни через поиск. Тест — задача 5.

---

### Task 1: Уровень атрибута и тип «Дата» в каталоге (бэкенд)

**Files:**
- Create: `backend/services/inventory/attributeScope.js`, `backend/services/inventory/attributeScope.test.js`
- Modify: `backend/models/inventory/deviceAttribute.js` (поле `scope`, `date` в enum `valueType`), `backend/types/inventory/deviceAttribute.ts`, `backend/controllers/inventory/deviceAttribute.js` (create/update принимают `scope`; update проверяет блокировку), `backend/services/inventory/attributeValue.js` (+ `date`), `backend/controllers/inventory/deviceConfiguration.js` (add/update), `backend/controllers/inventory/deviceModel.js` (место, где пишутся `values` конфигураций при режиме одной конфигурации), `backend/services/inventory/catalogEditOps.js` (`configurationValues` — одна проверка), `backend/services/inventory/catalogOps.js` (`validateCatalog`: значения и keySpecs), ключевые характеристики сборки в `backend/controllers/inventory/deviceType.js` (проверка `keySpecs` рядом со строкой 353)
- Test: `attributeScope.test.js`, `backend/services/inventory/attributeValue.test.js`, `backend/services/inventory/catalogOps.test.js`

**Interfaces:**
- Produces (`attributeScope.js`):
  - `SCOPES = ["model", "device"]`, `DEFAULT_SCOPE = "model"`
  - `isDeviceScoped(attr: { scope?: string } | null) -> boolean` — `attr?.scope === "device"`
  - `splitLinks(links: Link[]) -> { model: Link[], device: Link[] }` — по `link.attributeId.scope` (populated); непопулированная связка идёт в `model`
  - `deviceScopedValueError(values: {attributeId}[], attrsById: Map<string, Attr>) -> string | null` — текст 400 из Global Constraints для первого атрибута уровня `device`
  - `scopeChangeError(attr: Attr, nextScope: string, counts: { configValues: number, deviceValues: number }) -> string | null` — текст 409 или null
- Produces (`attributeValue.js`): `isValidValue` принимает `valueType: "date"` — валидно, если `/^\d{4}-\d{2}-\d{2}$/` и дата существует (`2026-02-30` — нет).

- [ ] **Step 1: Тесты.** `attributeScope.test.js`: `splitLinks` раскладывает populated-связки, непопулированная → `model`; `deviceScopedValueError` возвращает «Атрибут «IP-адрес» задаётся у каждого устройства, а не у модели»; `scopeChangeError` → строка 409 при `model→device` и `configValues: 1`, при `device→model` и `deviceValues: 2`, null при равном уровне или нулевых счётчиках. `attributeValue.test.js`: `date` — `"2026-06-18"` да, `"2026-02-30"` нет, `"18.06.2026"` нет, `""` да. `catalogOps.test.js`: каталог с конфигурацией, где значение у атрибута `scope: "device"`, → ошибка с тем же текстом.
- [ ] **Step 2:** `node --test` по трём файлам — падают.
- [ ] **Step 3:** Реализовать модуль и `date`; модель и `types/*.ts`; контроллер атрибута: create берёт `scope` (по умолчанию `model`, чужое значение → 400), update перед сменой считает `DeviceConfiguration.countDocuments({"values.attributeId"})` и `ClientDevice.countDocuments({"attributes.attributeId"})` и зовёт `scopeChangeError`; GET атрибута отдаёт `inUse: { configValues, deviceValues }` (нужно форме для блокировки). Проверку `deviceScopedValueError` вызвать в add/update конфигурации, в записи значений через модель, в `catalogEditOps.configurationValues`, в `catalogOps.validateCatalog`; keySpecs с атрибутом уровня `device` → 400 «Ключевая характеристика не может быть атрибутом устройства».
- [ ] **Step 4:** `node --test` по трём файлам + `catalogEditOps.test.js` — зелёные.
- [ ] **Step 5:** Оставить в дереве (без коммита).

### Task 2: Связки типа отдают уровень; добавление атрибутов с уровнем (бэкенд)

**Files:**
- Modify: `backend/controllers/inventory/deviceType.js:167` (populate `attributeId` + `scope`), `backend/controllers/inventory/deviceTypeAttribute.js` (список по типу — тоже `scope`; пакетное добавление: новый атрибут берёт `attribute.scope`; выдача доступных атрибутов для шторки фильтрует по `?scope=`), `backend/controllers/inventory/clientDevice.js:895-905` (`specLinks` — только `model`; новое поле ответа `deviceLinks`), `backend/services/inventory/catalogSeed.js` (определение атрибута принимает `scope`, только при создании)
- Test: `backend/controllers/inventory/deviceTypeAttribute.add.test.js`, `backend/services/inventory/catalogSeed.test.js`

**Interfaces:**
- Consumes: `splitLinks` (Task 1).
- Produces: `GET /api/inventory/client-devices/:id` → `specLinks` (связки уровня `model`, как раньше), `deviceLinks` (уровня `device`, populated `attributeId: code name valueType unit options isActive scope`, `groupId`; отдаются всегда, даже без конфигурации), `attributes` (как в документе). Пакетное добавление `POST …/device-type-attributes/…` принимает `items[].attribute.scope`. Лоадер шторки: `availableAttributes` фильтруется по `scope` из query (`model` по умолчанию).

- [ ] **Step 1: Тесты.** `deviceTypeAttribute.add.test.js`: новый атрибут с `scope: "device"` создаётся с этим уровнем; без `scope` — `model`. `catalogSeed.test.js`: определение `{ code, name, valueType, scope: "device" }` создаёт атрибут с `scope: "device"`, подхваченный существующий атрибут уровня не меняет.
- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализация по Interfaces.
- [ ] **Step 4:** Тесты зелёные.
- [ ] **Step 5:** Оставить в дереве.

### Task 3: Значения атрибутов на устройстве (бэкенд)

**Files:**
- Create: `backend/services/inventory/deviceAttributes.js`, `backend/services/inventory/deviceAttributes.test.js`
- Modify: `backend/models/inventory/clientDevice.js` (поле `attributes: [{ attributeId: ObjectId ref DeviceAttribute, value: String, _id: false }]`), `backend/types/inventory/clientDevice.ts`, `backend/validations/inventory/clientDevice.js` (`attributes` — массив), `backend/services/inventory/deviceOps.js` (`clean`-сборка тела ~строка 57, списки полей ~1009 и ~1032), `backend/controllers/inventory/clientDevice.js` (add/update — обязательные; `DEVICE_SEARCH_FIELDS` → поиск ещё и по `attributes.value`)
- Test: `deviceAttributes.test.js`, `backend/controllers/inventory/clientDeviceParts.test.js` (если там есть сборка тела create — дополнить)

**Interfaces:**
- Consumes: `isValidValue`, `storedValue` (`attributeValue.js`), `splitLinks` (Task 1).
- Produces (`deviceAttributes.js`):
  - `normalizeDeviceAttributes(raw: unknown, deviceLinks: Link[]) -> { values: {attributeId, value}[] } | { error: string }` — только атрибуты из `deviceLinks`; чужой → ошибка «Атрибут «{name}» не относится к устройствам этого типа»; негодное значение → «Неверное значение атрибута «{name}»»; пустые выбрасываются.
  - `mergeDeviceAttributes(current: Value[], patch: Value[], deviceLinks: Link[]) -> Value[]` — патч поверх текущего по `attributeId`; пустое значение в патче удаляет; значения атрибутов вне `deviceLinks` выпадают (Review Focus 1).
  - `missingRequired(deviceLinks: Link[], values: Value[]) -> string[]` — имена обязательных без значения; контроллер отвечает 400 «Не заполнено: {имена через запятую}».
  - `loadDeviceLinks(typeId) -> Promise<Link[]>` — связки уровня `device` с populated атрибутом.
- [ ] **Step 1: Тесты** (`deviceAttributes.test.js`): `normalizeDeviceAttributes` — годный `date` и `string` проходят, `number` «abc» → ошибка с именем, атрибут другого типа → ошибка, пустая строка выпадает; `mergeDeviceAttributes` — патч только IP не трогает ОС (Review Focus 2), пустое значение удаляет, атрибут вне новых связок выпадает (Review Focus 1); `missingRequired` возвращает `["Операционная система"]`.
- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализация. В контроллере create: `normalize` → `missingRequired` → 400; update: `merge` по связкам НОВОГО эффективного типа, `missingRequired` только для пришедшего тела интерфейса. Поиск: `$or` по `DEVICE_SEARCH_FIELDS` + `{ "attributes.value": regex }` (Review Focus 4).
- [ ] **Step 4:** Тесты зелёные; `npx eslint` по изменённым файлам бэкенда.
- [ ] **Step 5:** Оставить в дереве.

### Task 4: Системные атрибуты, сид и миграция переноса

**Files:**
- Create: `backend/services/inventory/systemDeviceAttributes.js`, `backend/services/inventory/systemDeviceAttributes.test.js`, `backend/scripts/seeds/2026-10-29-deviceSystemAttributes.js`, `backend/scripts/moveDeviceTechToAttributes.js`
- Modify: `backend/scripts/seed.js` (запись в `SEEDS`), `backend/scripts/migrate.js` (запись `{ id: "2026-10-29-moveDeviceTechToAttributes", script: "moveDeviceTechToAttributes.js", apply: true }` в конец), `backend/scripts/seedMikrotikModels.js:233` (не писать `operatingsystem` в конфигурацию CHR), `backend/scripts/seeds/2026-10-19-inventoryCatalog.js:90` (`os` — `scope: "device"`, для будущих чистых баз)

**Interfaces:**
- Produces (`systemDeviceAttributes.js`):
  - `SYSTEM_CODES = { os: "operatingsystem", ip: "ip_address", mac: "mac_address" }`
  - `ensureSystemAttributes({ log }) -> Promise<{ os: ObjectId, ip: ObjectId, mac: ObjectId }>` — найти по коду ИЛИ имени, создать недостающие (`string`, `scope: "device"`); у найденного с `scope: "model"` без значений в конфигурациях — переключить на `device`; со значениями — бросить ошибку «Атрибут «Операционная система» заполнен в конфигурациях — перенос остановлен» (сид и миграция падают с кодом 1).
  - `systemIds() -> Promise<{ os, ip, mac }>` — кэш процесса поверх `ensureSystemAttributes` без записи (только чтение по коду).
  - `systemValues(device, ids) -> { ipAddress: string|null, macAddress: string|null, operatingSystem: string|null }`
  - `withSystemValues(device, patch: { ipAddress?, macAddress?, operatingSystem? }, ids) -> Value[]` — новый массив `attributes`, остальные значения не тронуты.
  - `ensureTypeLinks(typeId, attributeIds: ObjectId[]) -> Promise<void>` — создать недостающие `DeviceTypeAttribute` (без группы, `required: false`, `order` — в конец).
- Сид: `apply({ log })` → `ensureSystemAttributes` + `ensureTypeLinks` для типов, найденных по имени: «Системный блок», «Ноутбук», «Моноблок», «Сервер», «Маршрутизатор», «Коммутатор» (ненайденный — пропуск без ошибки).
- Миграция: без `--apply` — отчёт (сколько устройств, по каким типам, сколько значений каждого поля), с `--apply` — `ensureSystemAttributes`, для каждого устройства с непустыми старыми полями: `ensureTypeLinks(эффективный тип, нужные id)`, запись `attributes` через `withSystemValues` с проверкой по `_id` И прочитанным значениям (стиль `normalizePhones.js`), затем `$unset: { ipAddress, macAddress, operatingSystem }` у всех. Идемпотентна.

- [ ] **Step 1: Тесты** (`systemDeviceAttributes.test.js`, стор в памяти как в `catalogSeed.test.js`): создаёт `ip_address`/`mac_address`; подхватывает `operatingsystem` и переключает уровень; при значениях в конфигурациях бросает с текстом выше; `withSystemValues` не трогает чужие значения; `systemValues` отдаёт null для пустых.
- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализация модуля, сида и миграции по Interfaces.
- [ ] **Step 4:** Тесты зелёные. На деве: `docker compose -f compose.dev.yml run --rm backend node scripts/moveDeviceTechToAttributes.js` (без `--apply`) показывает 19/21/0 на копии прода; затем `seed.js up` и `migrate.js up` (sandbox off, docker); повторный `--apply` ничего не меняет.
- [ ] **Step 5:** Оставить в дереве.

### Task 5: Потребители старых полей (Mikrotik, MCP, удаление полей)

**Files:**
- Modify: `backend/services/mikrotik/reconciliation.js` (`computeReconciliation` читает через `systemValues`; поля расхождений `operatingSystem`/`ipAddress` остаются именами для клиента), `backend/controllers/inventory/mikrotik.js:1108` (`SYNCABLE_FIELDS`) и `:1531` (автосоздание) — запись через `withSystemValues` + `ensureTypeLinks` (Review Focus 3), `backend/services/mcp/inventorySource.js:39` (выбирать `attributes`, отдавать `ip/os`, НЕ `mac` — Review Focus 5), `backend/services/mcp/inventoryFormat.js:311`, `backend/services/mcp/ticketSource.js:23`, `backend/services/mcp/ticketFormat.js:152`, `backend/services/inventory/changeOps/deviceKinds.js:49,79` и `changeOps/kit.js:133` (параметры агента `ipAddress`/`macAddress`/`operatingSystem` сохраняются, пишутся в атрибуты через `withSystemValues`), `backend/services/mcp/inventoryChangeTools.js:69-70` (описание не меняется по смыслу), `frontend/src/components/Mikrotik/DeviceForm.jsx:204` (IP — из `attributes` по коду `ip_address`), DTO `toListDevice` в `backend/controllers/inventory/clientDevice.js:223` и окружения в `backend/controllers/inventory/location.js:93` (ключи `ipAddress`/`operatingSystem` сохраняются, значения — `systemValues`; фронт «Техники» и `EnvironmentDeviceSheet` не меняются); затем удалить `ipAddress`/`macAddress`/`operatingSystem` из `backend/models/inventory/clientDevice.js`, `backend/validations/inventory/clientDevice.js:108-118`, `backend/types/inventory/clientDevice.ts`, `deviceOps.js:57-59`
- Test: `backend/services/mikrotik/reconciliation.test.js` (или существующий тест рядом), `backend/controllers/inventory/mikrotik.inventoryCard.test.js`, `backend/services/mcp/inventorySource.test.js`, `backend/services/mcp/inventoryFormat.test.js`, тест changeOps для `updateDevice`

**Interfaces:**
- Consumes: `systemIds`, `systemValues`, `withSystemValues`, `ensureTypeLinks` (Task 4).

- [ ] **Step 1: Тесты:** сверка видит расхождение IP, когда IP лежит в атрибуте; синхронизация IP типу без связки создаёт связку и не трогает ОС (Review Focus 2, 3); MCP-карточка устройства показывает `IP:` и `OS:` из атрибутов и не содержит MAC даже при заполненном `mac_address` (Review Focus 5); `updateDevice { ipAddress }` через changeOps оставляет другие атрибуты.
- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Переписать потребителей; удалить поля. `grep -rn "ipAddress\|macAddress\|operatingSystem" backend frontend/src` — остаются только ключи DTO, имена полей расхождений Mikrotik и параметры агента.
- [ ] **Step 4:** Тесты из списка — зелёные; `npx eslint` бэкенда по изменённым файлам.
- [ ] **Step 5:** Оставить в дереве.

### Task 6: Каталог во фронте — уровень атрибута (экраны 1–2)

**Files:**
- Create: `frontend/src/components/app/attribute-scope.ts`, `frontend/src/components/app/attribute-scope.test.js`
- Modify: `frontend/src/components/DeviceAttribute/value-types.js` (`{ value: "date", label: "Дата" }`), `frontend/src/components/DeviceAttribute/FormFields.jsx` (сегмент «Значение задаётся» + подсказка; при `inUse` противоположного уровня сегмент `disabled` с подсказкой «Уже есть значения — уровень не меняется»), `frontend/src/components/DeviceType/View.jsx:516-650` (две секции: «Атрибуты модели» с основной кнопкой, «Атрибуты устройства» с outline-кнопкой и `to="attributes/add?scope=device"`, подписи из Global Constraints; пустое состояние второй секции — та же подпись), `frontend/src/components/DeviceType/AttributesAddForm.jsx` (читает `scope` из URL: заголовок «Добавить атрибуты устройства», черновик с этим `scope`, тело `items[].attribute.scope`), лоадер шторки (передаёт `?scope=` в API), потребители связок модели: `frontend/src/pages/DeviceModel/View.jsx:57`, `frontend/src/components/DeviceModel/FormFields.jsx:19`, `frontend/src/components/app/assembly-specs.ts`, выбор ключевых характеристик сборки (`frontend/src/components/DeviceType/AssemblyForm.jsx`) — все берут `modelLinks(links)`
- Test: `attribute-scope.test.js`

**Interfaces:**
- Produces (`attribute-scope.ts`): `modelLinks(links)`, `deviceLinks(links)` (по `link.attributeId?.scope`, отсутствие → модель), `SCOPE_OPTIONS = [{ value: "model", label: "У модели" }, { value: "device", label: "У каждого устройства" }]`.

- [ ] **Step 1:** Тест `attribute-scope.test.js`: раскладка связок, отсутствующий `scope` → модель.
- [ ] **Step 2:** Тест падает.
- [ ] **Step 3:** Реализация по макету (экраны 1–2): секции, кнопки, сегмент `app/Segmented`, `date` в списке типов.
- [ ] **Step 4:** Тест зелёный; eslint, tsc, vite build.
- [ ] **Step 5:** Оставить в дереве.

### Task 7: Форма устройства — мастер из трёх шагов и правка (экраны 3–5)

**Files:**
- Modify: `frontend/src/components/ClientDevice/Form.jsx` (`STEPS` без `tech`; `SUBMIT_FIELDS` без `ipAddress`/`macAddress`/`operatingSystem`, `lastMaintenanceDate` и `notes` уходят только в правке; тело получает `attributes`; разделы правки: «Устройство», «Параметры устройства», «Размещение», «Закупка и гарантия», «Заметки»; ключ `tech` в хеше правки → `params`), `frontend/src/components/ClientDevice/FormFields.jsx` (удалить `TechFields`; новый `DeviceParamsFields`; `PurchaseFields` получает «Последнее обслуживание» в пару к «Гарантия до» при `isEdit`), `frontend/src/components/DeviceConfiguration/SpecFields.jsx` (`case "date"` → `app/DateField`; звёздочка у `link.required`; проп `errors: Record<attributeId, string>`), загрузка связок типа устройства для формы (по `deviceTypeId` выбранной модели — тот же путь `/api/inventory/device-type-attributes/type/:id`, `deviceLinks(...)`)
- Test: `frontend/src/components/ClientDevice/device-params.test.js` для чистой функции ниже

**Interfaces:**
- Consumes: `deviceLinks` (Task 6); ответ `getOne` с `deviceLinks`, `attributes` (Task 2–3).
- Produces: `DeviceParamsFields({ values, onChange, links, attributes, onAttributesChange, showHostname, mode: "wizard" | "edit", errors })`; чистая `paramsForStep(links, mode) -> { shown: Link[], laterNames: string[] }` в `frontend/src/components/ClientDevice/device-params.ts` — в мастере `shown` = обязательные, `laterNames` = имена остальных; в правке `shown` = все, `laterNames = []`.

- [ ] **Step 1:** Тест `paramsForStep`: мастер с обязательной ОС и необязательными IP/MAC/датой → `shown` = [ОС], `laterNames` = ["IP-адрес", "MAC-адрес", "Дата производства"]; правка → все, `[]`.
- [ ] **Step 2:** Тест падает.
- [ ] **Step 3:** Реализация по макету: шаг 1 — блок «Параметры устройства» под инв./серийным (имя — только `kindOf(type) === "primary"`; нет имени и нет обязательных — блока нет; подсказка «{laterNames через запятую и «и»} — потом, в карточке устройства.»); проверка обязательных в `errorsFor("device")`; правка — секция «Параметры устройства» после «Устройства». Для ПК своей сборки (`deviceKind === "custom"`) связки берутся у прямого типа.
- [ ] **Step 4:** Тест зелёный; eslint, tsc, vite build.
- [ ] **Step 5:** Оставить в дереве.

### Task 8: Карточка устройства и документация (экран 6)

**Files:**
- Modify: `frontend/src/components/ClientDevice/View.jsx:160-180, 380-400, 760-840` (панель «Параметры устройства» с «Изменить» → `update#params`: имя (моно, только не `partLike`), затем все `deviceLinks` с прочерком у пустых, IP с копированием; панель «Заметки» с «Изменить» → `update#notes`, только если заметки есть; секция «Сеть и система» и `showTech` удаляются; рейл: «Параметры устройства», «Заметки»; `machineId` переезжает строкой в «Параметры устройства», если есть), `docs/ux-ui-guide.md` (правило уровня атрибута в разделе инвентаря), `docs/ux-ui-changelog.md` (запись 2026-10-29), `docs/inventory.md` (поле `scope`, `ClientDevice.attributes`, системные коды, миграция), `docs/mcp.md` (откуда агент получает IP/ОС, MAC по-прежнему скрыт)
- Test: нет новых чистых функций; проверки сборки.

- [ ] **Step 1:** Реализация по макету (экран 6, обе темы, телефон: подпись над значением).
- [ ] **Step 2:** eslint, tsc, vite build — чисто.
- [ ] **Step 3:** Документы.
- [ ] **Step 4:** Итоговая сверка: `grep -rn "TechFields\|update#tech\|showTech" frontend/src` — пусто; `node --test` по всем тестам, созданным в задачах 1–7.
- [ ] **Step 5:** Оставить в дереве; обновить память `device-form-no-tech-step` (реализовано, не закоммичено, в браузере не проверено; деплой = миграция + сид).
