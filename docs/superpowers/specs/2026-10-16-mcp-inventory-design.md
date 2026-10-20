# MCP: инвентарь для ИИ-агента

## Context

Владелец хочет, чтобы Telegram-агент (тот же, что пишет заметки базы знаний и предлагает изменения Mikrotik) помогал вести инвентарь целиком:
- заводить технику: типы, атрибуты, модели с характеристиками, устройства;
- наводить порядок в справочниках: дубли, кривые значения;
- собирать ПК: из склада, под закупку, апгрейд существующих;
- анализировать парк: сроки и старение, качество данных, склад и распределение, связь с заявками.

Решения владельца (16.10):
- **Агент ничего не меняет сам.** Любая запись — это предложение, а утверждает его **сам автор запроса** (`requester`, сотрудник по Telegram id), если у него есть право на каждую операцию.
- Агент тот же: один ключ на агента, человек передаётся аргументом `requester`, как в `create_knowledge_note` / `propose_mikrotik_change`.
- Характеристики деталей берутся **только из моделей** (`DeviceConfiguration.values`). Новое хранилище атрибутов у устройства не нужно.
- Нужны все три сценария сборок и все четыре направления анализа.
- **Комплектующие следуют за хостом.** При переносе, выдаче или смене статуса ПК агентской операцией прикреплённые устройства едут вместе с ним, и в предложении они перечислены поимённо. Отказаться можно: `withComponents: false` или `exceptComponentIds[]`. Моё прочтение ответа: ручные формы не меняются.
- **Связь «заявки ↔ техника» в v1 приблизительная.** Считается по заявителю: заявки человека, за которым числится устройство (`ticketSource.js:74`), плюс прямой `relatedClientDeviceId`, где он есть. В ответе агенту это помечено как оценка.

Образцы в коде: MCP-сервер `backend/services/mcp/server.js` (семейства по scope, `guard`, JSON Schema без zod), запись с `requester` (`services/mcp/requester.js`, `knowledgeWriteTools.js`), конвейер предложений Mikrotik (`models/mikrotikChange.js`, `services/mikrotik/change*.js`, `docs/mikrotik-changes.md`).

## Решения исполнителя (мои, проверить)

- Два новых scope: `inventory` (чтение и анализ) и `inventoryChanges` (предложения). Оба активны только при включённом модуле инвентаря (`context.modules`), так же как knowledge и mikrotik.
- Чтение не привязано к человеку, как у тикетов: ключ видит все компании. В ответах:
  - `installedSoftware.licenseKey` маскируется;
  - у людей только имя и должность, без контактов (как `list_users`);
  - текстовые поля прогоняются через `maskText`.
- Предложение — **пакет операций с локальными ссылками** (`ref: "m1"` → `{ref: "m1"}` в следующих операциях). Пакет применяется целиком: «создать тип → атрибуты → модель → устройства → прикрепить к сборке» утверждается одним нажатием.
- Слияния дублей (модели, атрибуты, типы) идут последней фазой. Они переносят ссылки только по явному списку `_id`, посчитанному при предложении (правило «No blind deleteMany»).
- Транзакций в проекте нет (Mongo без replica set). Применение такое:
  1. перепроверка всего пакета;
  2. операции по порядку, результат каждой записывается;
  3. на первой ошибке стоп и статус `partial`, без отката.

  Дрейф ловится до применения: снимок `updatedAt` целевых документов из предложения сравнивается с текущим.
- Срок жизни предложения 3 суток, потом `expired`. Протухание делает свой обход в cron рядом с Mikrotik (`app.js:403`). Тот же обход переводит в `failed` предложения, застрявшие в `applying`.
- Статусы в snake_case, как у Mikrotik (`changeSteps.js:5`): `awaiting_requester | applying | done | partial | rejected | cancelled | expired | failed`. `cancelled` — отзыв агентом.
- Применение идёт сразу при утверждении, без воркера: это операции в БД, а не роутер.
- **Конфигурации.** У модели их может быть много, устройство указывает свою (`ClientDevice.configurationId`). Поэтому характеристики читаются из `device.configurationId`, а при его отсутствии — из единственной конфигурации модели. Если конфигураций несколько, отдаём список. В `createDevice` есть `configurationId` (существующая или `{ref}` новой), а операция называется `createConfiguration` (не `setModelConfiguration`). Апгрейд — это attach/detach комплектующих; `configurationId` фирменного ПК меняется только явной `updateDevice`.
- **Слияния.** У типов, атрибутов и вендоров нет `deletedAt`, поэтому источник получает `isActive:false` (обратимо), а не удаляется.
- **`duplicateSerials`** остаётся, но как предупреждение: повтор серийника в модели допустим.
- Тип ищется по имени без учёта регистра: unique-индекс регистрозависим.

## Фаза 1 — чтение и анализ (scope `inventory`)

Новые файлы по образцу тикетов: `services/mcp/inventoryTools.js` (форма ответа, лимиты) + `services/mcp/inventorySource.js` (Mongoose; в тестах подменяется фейком) + тесты `*.test.js` на `node:test`.

Инструменты (`READ_ONLY`):
> Ревизия по навыку build-mcp-server (16.10): `list_device_types`, `list_device_attributes` и `list_vendors_suppliers` слиты в один `get_inventory_catalog({section})`, итого 7 инструментов чтения. Причина: схемы всех инструментов агент оплачивает в каждом ходе, а с Mikrotik, заявками и будущей ревизией их и так за 30. `get_device` принимает отсканированное: ссылку из QR, инв. номер, серийник, hostname. Подробности в плане фазы 1.

1. `list_device_types`: типы, их флаги (`isComponent/isPeripheral/isConsumable`, `attachableToTypeIds` по именам) и набор атрибутов из `DeviceTypeAttribute` (code, name, valueType, unit, options, required, order).
2. `list_device_attributes`: глобальный каталог атрибутов, поиск по коду или названию, у каждого число типов и моделей, где он используется.
3. `search_device_models`: модели по тексту, типу или вендору. У каждой модели конфигурации со значениями по коду и названию атрибута и число устройств. Вендоры и поставщики доступны отдельным лёгким `list_vendors_suppliers` (или параметром, решит исполнитель).
4. `search_devices`: фильтры по компании, типу, модели, статусу, локации, пользователю, тексту (серийник, инв. номер, hostname), датам гарантии и покупки, `free` (без родителя и в `readyForDeployment|inReserve`), `rootOnly`. Отдаёт компактные строки с пагинацией. Компания и тип берутся через `getEffectiveTypeId`.
5. `get_device`: карточка устройства:
   - модель и характеристики её конфигурации;
   - родитель и **комплектующие с их характеристиками**;
   - путь локации, человек (имя), даты гарантии, срок службы, обслуживание, софт (маска ключей);
   - заявки (приблизительно, см. решения): число и последние 5 в формате `ticketFormat`.

   Это основа для апгрейда.
6. `list_attachable_components`: для хоста устройства, которые можно прикрепить. Правила совместимости те же, что у `getAttachable` (`controllers/inventory/clientDevice.js:1189`), их нужно вынести в сервис. Сам `getAttachable` статус не фильтрует, поэтому у инструмента добавлен параметр `onlyFree` (по умолчанию true: `readyForDeployment|inReserve`). Без него в ответ попадут и выданные устройства, такие строки помечены. У каждого кандидата характеристики модели и `compatibleWithModelIds`-подсказка. Совместимость (сокет, тип памяти) сравнивает агент, а инструмент даёт ему данные.
7. `inventory_stats`: подсчёты с группировкой (status/type/model/vendor/company/location) и фильтрами, как `ticket_stats`.
8. `inventory_findings({kind, companyId?, days?, limit})`: проверки состояния парка, по каждой число и top-N с id. Проверки сгруппированы так:
   - **сроки:**
     - `warrantyExpiring` / `warrantyExpired`;
     - `lifespanExceeded` (`purchasedAt|deploymentDate + expectedLifespan`);
     - `maintenanceOverdue`;
     - `longInRepair` (по `updatedAt`, в ответе помечено «приблизительно»: даты смены статуса в модели нет).
   - **склад:** `idleStock` (свободные дольше N дней).
   - **качество данных:**
     - `missingData`: нет серийника, локации или модели;
     - `duplicateSerials`;
     - `catalogDuplicates`: имена типов, моделей и атрибутов после нормализации регистра, пробелов, ё/е и латиницы/кириллицы двойников;
     - `unusedAttributes`;
     - `modelsWithoutConfiguration`;
     - `invalidAttributeValues`: значение не по `valueType`/`options`;
     - `orphanRefs`: join-строки и значения на удалённые атрибуты (`delete` атрибута их оставляет).
   - **заявки:** `ticketHeavy` — устройства и модели с наибольшим числом заявок за период.

Проводка:
- `models/mcpKey.js` (enum scopes) и `services/mcp/keys.js` (`MCP_SCOPES`);
- `toolFamilies` и инструкции агенту в `server.js`;
- `routes/mcp.js` (`tools.inventory`);
- UI ключей: `frontend/src/util/mcp-keys.ts`, `McpScope` в `types/mcpKey.ts`, `MODULE_OFF_HINTS`/`modulesOn` в `McpKeys.jsx`;
- первая строка инструкций агенту в `server.js:461` сейчас перебирает комбинации, её надо собирать из частей;
- `routes/mcp.test.js`: список инструментов по scope × модуль, проверки на утечку `licenseKey` и контактов.

## Фаза 2 — предложения (scope `inventoryChanges`)

**Сервисный слой.** Почти вся доменная проверка сейчас живёт в контроллерах, поэтому выносим её в `services/inventory/`:
- `catalogOps.js`: тип, атрибут, связь тип↔атрибут, вендор, модель, конфигурация;
- `deviceOps.js`: создание, частичная правка, статус, назначение человека, перенос, attach/detach.

Каждая операция = `validate(op, ctx)` → `{ok, errors[], before}` + `apply(op, ctx)`. Переиспользуется:
- `uniqueAttributeCode` (`services/attributeCode.js`);
- `deviceScope.js`;
- из `clientDevice.js` экспортируются `generateInventoryNumber`, `getEffectiveTypeId`, `duplicateError`;
- правила attach/assign (статус `deployed` при назначении; компания, локация и человек хоста на компоненте).

Контроллеры на эти функции переводятся **только там, где поведение совпадает**. В человеческих формах не появляется ничего нового: новые строгие проверки (существование типа и вендора у модели, значения по `valueType/options`, uniq пары тип↔атрибут) действуют для операций агента. Частичная правка устройства — отдельная функция, потому что контроллерный `update` — полная замена через `buildDevicePayload`.

> **Ревизия 19.10** после обновления инвентаря владельцем (47c3e28: группы атрибутов, `DeviceType.assembly`, `DeviceBuild`, ПК из сборки с `parts[]`). Решения:
> - **Каталожные операции идут в формате сида** (`services/inventory/catalogSeed.js`): `{groups, types:[{attributes:[{attr, group, required}], assembly}], attributes}`.
>   - при предложении `planCatalog` даёт сухой прогон: что создаётся, что подхватывается по имени или коду, предупреждения; его показываем автору;
>   - при утверждении `applyCatalog` пишет, а при сбое откатывает созданное по `_id`;
>   - правила «только добавлять», «атрибут по code ИЛИ имени» и проверку сборки типа (`parseAssembly`) повторно не пишем.
>
>   Правка существующего (переименование, удаление) остаётся отдельными операциями ниже.
> - **ПК из сборки** — `createDevice` с `buildId` и `parts[]` через ту же логику, что `POST /client-devices/add`: `planDeviceParts`, разрешение конфигурации, откат по `_id`. Новые операции:
>   - `createBuild` / `updateBuild` (`parseBuildParts`, `resolvePartConfiguration` из `controllers/inventory/deviceBuild.js`);
>   - `setTypeAssembly` (`parseAssembly`);
>   - `createAttributeGroup`.
> - Сборки и слоты только у «Своей сборки». Брендовый ПК — модель (решение владельца из проекта П1–П3).

**Операции v1:**
- `createDeviceType` / `updateDeviceType`;
- `createAttribute` / `updateAttribute` (в т.ч. добавить опции);
- `linkAttribute` / `unlinkAttribute` (required, order);
- `createVendor`;
- `createModel` (тип, вендор, имя) / `updateModel` / `createConfiguration` (модель, имя, `values` по коду атрибута; значения проверяются по `valueType/options` и по принадлежности атрибута типу модели);
- `createDevice` (модель + `configurationId` или тип, компания обязательна, локация, серийник, цена, поставщик, дата покупки, гарантия). Инв. номер генерируется, если его нет. С `parent` устройство проходит **правила attach** (флаги типа, `attachableToTypeIds`, одна ступень), а не обход, как в контроллерном `add` (`clientDevice.js:956`);
- `updateDevice` (патч);
- `setDeviceStatus`, `assignDeviceUser`, `moveDevice` — по умолчанию с каскадом на комплектующие, отказ через `withComponents:false | exceptComponentIds[]`. У `moveDevice` новая проверка: локация той же компании или `isPublic`;
- `attachComponent` (как сейчас: компонент копирует компанию, локацию, человека и **статус хоста**, `clientDevice.js:1318`), `detachComponent`.

**Модель `models/inventoryChange.js`** по образцу `mikrotikChange.js`:
- `number` (через `Counter`), `title`, `reason`, `requestedBy`, `requestedVia{keyId,keyName}`;
- `operations[{kind, ref, params, text (человеческая фраза), before, targetUpdatedAt, result{state,error,createdId,at}}]`;
- `status`: `awaitingRequester | applying | done | partial | rejected | expired | failed`;
- `decision{user, channel, comment, at}`, `timeline[]`, `expiresAt`.

**Сервисы** `services/inventory/change{Proposals,Decisions,Executor,Notifications,Render}.js`. Из Mikrotik повторяем приём «решение ровно один раз»: запись условна по прежнему статусу, второй вызов получает `closed`. Права проверяются при предложении и ещё раз при решении: `canFor(user)` по каждой операции, каталог → `inventoryCatalog.manage`, устройства → `device.manage`. Создаваемые документы получают `createdBy/updatedBy = requester`.

**MCP-инструменты** `services/mcp/inventoryChangeTools.js`. Аннотации: `readOnlyHint:false, destructiveHint:false, openWorldHint:false`. Это не `PROPOSE_ANNOTATIONS` Mikrotik: наружу ничего не уходит.
- `propose_inventory_change({requester, title, reason, operations[]})`:
  - все ошибки всех операций возвращаются разом;
  - предложение сразу показывает человеческий итог;
  - лимиты: ≤ 50 операций, суточный лимит на ключ, `keyLock`;
  - сканер секретов на текстовых полях.
- `get_inventory_change`, `list_inventory_changes`.

**Уведомление автору.** `fanOut` — внутренняя функция `createChangeNotifier` (`changeNotifications.js:314`), поэтому её выносим в общий модуль и Mikrotik переводим на него без изменения поведения. Каналы:
- Telegram тем же способом, что Mikrotik (`escapeHtml(text)`), с кнопками «Утвердить / Отклонить / Открыть в портале». Кнопки решения появляются, только если весь пакет поместился в сообщение (правило `mikrotikChangeBot.js:6,140`). Большой пакет приходит только со ссылкой в портал;
- колокольчик;
- после применения итог тем же каналом.

Нужна новая категория уведомлений: `notificationCategories.js`, `models/user.js` (≈211/229/244), `models/preferences.js:93` и оба экрана настроек уведомлений на фронте.

**Бот** — две стороны, деплой затрагивает backend + tg-service:
- backend: `/api/bot/inventory-changes/:id/{message,decision}` в `routes/bot.js` (≈143) за `inventoryModuleIsActive`, по образцу `controllers/inventory/mikrotikChangeBot.js`;
- `tg-service`: новый префикс callback рядом с `mc:` (`tg-service/src/bot/index.ts:376`), обработчик, функции и типы в `api/backend.ts` / `api/types.ts`.

На localhost инлайн-кнопок не будет (memory: dev telegram).

**HTTP** для портала: `GET /inventory/changes/:id`, `POST /inventory/changes/:id/decision`. Префикс добавляется в карту гейтов `routes/inventoryMount.js`, иначе приложение упадёт на старте, это задумано.

### Фаза 2 — решения 19.10

Решения владельца:
- **Размер пакета:** в Telegram утверждается только то, что целиком влезает в одно сообщение, как у Mikrotik. Большие пакеты ждут страницу фазы 3, а агенту велено дробить работу.
- **Операции v1:** только создание в справочниках (тип, атрибуты, группы и слоты через формат сида; вендор, поставщик, модель, конфигурация, шаблон сборки) и все операции с техникой: создать (в том числе ПК из сборки), править поля, выдать, перенести, сменить статус, прикрепить или открепить. Переименование и правка существующего в справочниках уходят в фазу 4.
- **`clientDevice.js` можно рефакторить:** логика записи выносится в `services/inventory/deviceOps.js`.

Решения исполнителя:
- HTTP-эндпойнты портала (`GET`/`decision`) переезжают в фазу 3 вместе со страницей.
- Статуса `cancelled` в v1 нет.
- Протухание и зависшее `applying` разбирает свой обход.

План: `docs/superpowers/plans/2026-10-19-mcp-inventory-phase2.md`.

## Фаза 3 — страница предложения в портале

Фаза 3 — реализовано 20.10, не закоммичено. Макет одобрен 20.10 (https://claude.ai/artifact/MRyneSKyAQAeFWACHtnj2M); план `docs/superpowers/plans/2026-10-20-mcp-inventory-phase3.md`. Операции идут списком по порядку применения, без группировки по сущностям (решение макета).

`/inventory/changes/:id` содержит:
- заголовок, причину, автора, ключ;
- операции человеческими фразами с «было → станет» по сгруппированным сущностям;
- кнопки решения для автора;
- после применения: итог по каждой операции со ссылками на созданное.

**Сначала макет** (обе темы, десктоп + мобайл) → «ок» владельца → код, по правилу ui-mockup-first. Компоненты берутся из `components/app`, крошки вместо кнопки «назад», без «№» в тексте (номер есть только у заявки), без рода в формулировках.

## Фаза 4 — уборка дублей

Подробная спецификация 20.10 — `docs/superpowers/specs/2026-10-20-mcp-inventory-phase4-design.md` (правка справочников + слияние + скрытие неиспользуемого). Там же уточнения к этому разделу: мёртвые поля не трогаются, источник слияния переименовывается.

Операции `mergeModels`, `mergeAttributes`, `mergeDeviceTypes`, `deleteUnusedAttribute`:
- при предложении фиксируется явный список `_id` переносимых ссылок и их число. Это устройства, конфигурации, join-строки, а также `DeviceType.configurationIds`, `DeviceTypeAttribute.extendableFromIds`, `DeviceModel.compatibleWithModelIds` и `DeviceConfigurationRecommendation.deviceConfigurationId`;
- при применении переносится только этот список. Модель удаляется мягко (`deletedAt`), а тип, атрибут и вендор получают `isActive:false`;
- если найдено расхождение со снимком, это дрейф и отказ.

Учесть устаревший unique `name_1` в `deviceattributes`: проверять **code ИЛИ name**.

## Фаза 5 — инвентаризация обходом кабинетов (черновик; идёт после фазы 2, потому что опирается на предложения)

Решения владельца (17.10):
- **Единица — один кабинет (локация).** Сотрудник открывает кабинет, сканирует, закрывает. При закрытии расхождения по кабинету **сразу** уходят автору одним предложением.
- **Ненайденное — только пометка.** Статус не меняется. У устройства появляется отметка «не найдено при ревизии <дата>, <кабинет>», а в анализе — новая проверка `notFoundOnAudit`. Если устройство потом отсканировали в другом кабинете, отметка снимается и предлагается перенос.

Владелец (16.10): сотрудник идёт по кабинетам, сканирует заведённую технику и заводит новую. Нужны **оба пути** на одной общей «сессии инвентаризации»: через агента (фото QR или наклейки в Telegram) и через страницу HD (камера телефона, список кабинета с отметками).

Набросок:
- модель `InventoryAudit`:
  - компания и набор локаций;
  - снимок «что должно быть где» на старте;
  - отметки `{device, location, by, via: agent|portal, at, result: found|moved|unknown}`;
- отметки — это запись о ходе ревизии, а не правка инвентаря, поэтому делаются сразу;
- **итог ревизии** (переносы найденного не на своём месте, статус ненайденного, заведение нового) идёт **одним предложением** по фазе 2 и утверждается автором;
- агентские инструменты (свой scope): старт, отметка по отсканированному тексту (`parseDeviceRef` из фазы 1), прогресс «что ещё не найдено», завершение с предложением;
- страница в портале: мобильный режим ревизии со сканером QR, сначала макет.

## Риски

- Дрейф: у `ClientDevice` есть `__v`, у справочников нет. Для них сравниваем `updatedAt` из снимка.
- `keyLock` работает в памяти и на один ключ. Конкурирующие предложения от разных ключей ловит только сравнение со снимком.
- `routes/mcp.test.js`: 403 «ключу нечего делать» и матрица scope × модуль требуют новых случаев.

## Документация

- `docs/mcp.md`: разделы «Inventory tools» и «Inventory change tools» на английском, как остальной док;
- новый `docs/inventory-changes.md` (жизненный цикл, операции, модель данных, безопасность);
- поправить устаревшие места `docs/inventory.md` (стр. 298, 189/198, 461);
- спецификация `docs/superpowers/specs/2026-10-16-mcp-inventory-design.md`.

## Верификация

- Модульные тесты только затронутых файлов: `cd backend && node --test services/mcp/inventory*.test.js services/inventory/*.test.js routes/mcp.test.js`. Полный `pnpm test` не гонять.
- `backend` eslint; frontend typecheck (одна давняя ошибка FormWrapper ожидаема).
- Ручная проверка curl'ом по `docs/mcp.md` «Tests and manual check» на локальной копии прода внутри `hd-backend-1`:
  - `tools/list` с ключом `inventory`;
  - `inventory_findings kind=catalogDuplicates`;
  - `propose_inventory_change` с пакетом «тип → модель → устройство → attach»;
  - решение через портал;
  - проверка созданных документов.
- UI владелец проверяет сам. Без коммитов: git ведёт владелец.
