# Внешние пробросы MikroTik на ВМ Proxmox — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Пользователь отдельно утверждает план; до этого продуктовый код не менять.

**Goal:** показывать прямые внешние пробросы MikroTik в строке и карточке ВМ/LXC Proxmox; создавать заявки по связанным проблемам только при отдельном явном включении.

**Architecture:** ограниченные сборщики чтения формируют снимки роутера и сетевых интерфейсов гостя. Чистые функции сопоставляют сетевой контекст и разбирают путь NAT/firewall; отдельный обработчик сохраняет результат с версиями входных данных. Список читает компактную сводку, карточка — относящиеся к гостю подробности с проверкой прав.

**Tech Stack:** существующие Node.js/CommonJS, MongoDB/Mongoose, RouterOS API, Proxmox API, React/React Router, общие компоненты HD, `node:test`. Новых зависимостей не требуется.

**Spec:** [утверждённая спецификация](../specs/2026-11-10-proxmox-mikrotik-exposure-design.md).

Статус: план утверждён пользователем 10.11.2026; реализация завершена и проверена. Базовый макет — вариант A,
`.superpowers/proxmox-exposure-prototype/`. Его демонстрационные пробросы
не являются исходными данными реализации. Коммиты, push, деплой, реальные
изменения роутеров/ВМ и включение заявок не входят в разрешения этого плана.

## Global Constraints

- Перед каждой задачей читать её документацию и сравнивать существующие реализации; для UI — `docs/ux-ui-guide.md` и согласованный макет.
- Целевые версии — RouterOS 6/7 и Proxmox VE 8/9. Только прямые IPv4 TCP/UDP-пробросы одного роутера; неподдерживаемое условие остаётся неизвестным.
- Опрос раз в 5 минут; сетевые данные устарели через 15 минут; актуальность завершённой проверки CVE — 36 часов.
- Никаких внешних проверок портов, изменения NAT/firewall/гостя, обновлений или новых гостевых команд CVE по факту проброса.
- Настройки только `/preferences#proxmox`. Блок главной страницы — отдельная работа.
- Отдельный `exposureTicketsEnabled: false` дополнительно к существующему `autoTickets`; по умолчанию нет заявок нового типа.
- Сводка требует `proxmox.read`; сетевые подробности — также `mikrotik.read`. Отключение любого модуля прекращает сбор и выдачу кросс-модульных данных.
- Потеря данных не означает устранения проблемы; старые отчёты сохраняются с датой. Один IP, VMID, компания или транзитный роутер не доказывают связь.
- Не менять чужие незакоммиченные файлы сверх необходимых точечных участков. Коммиты, push и деплой требуют отдельного разрешения.

## Review Focus

1. Разные порты одного правила разрешены, запрещены или неизвестны: сохранять доказанные части отдельно — задача 6.
2. Повторяющиеся адреса/MAC, миграция гостя или повторное использование VMID: не наследовать публикации — задачи 3 и 7.
3. Неполный ответ, новые неизвестные поля RouterOS, лимит разбора: сохранять предыдущие факты, исключать ложное «пробросов нет» — задачи 4–7.
4. Фильтр на второй странице, истечение срока без нового опроса, пользователь без MikroTik-права: результат совпадает с карточкой, адреса не раскрываются — задача 8.
5. Обновление/отключение опций во время создания заявки, перезапуск обработчика: не создавать дубль и не считать проблему восстановленной — задача 10.

## Общие контракты и размещение

Все интервалы в вычислениях полуоткрытые `[from, to)`: IPv4 в диапазоне
`0..2**32`, порты `1..65536`. Полные диапазоны не разворачиваются в адреса
или отдельные порты. Идентификаторы передаются в чистые функции строками;
валидные ObjectId для Mongo формируются на границе API/хранилища.

| Файлы | Ответственность |
| --- | --- |
| `backend/services/proxmox/exposure/contract.js` | JSDoc-контракты, сроки и лимиты, свежесть и оценка CVE |
| `backend/models/proxmoxExposure.js` | `RouterExposureSnapshot`, `GuestExposure`, схема сетевой связи |
| `backend/services/proxmox/exposure/network-links.js` | Валидация связей и получение доступных каталогов |
| `backend/services/proxmox/exposure/guest-network.js`, `match.js` | Чтение интерфейсов гостя и чистое сопоставление |
| `backend/services/mikrotik/exposure-snapshot.js` | Ограниченное чтение MikroTik существующим транспортом |
| `backend/services/proxmox/exposure/ip-set.js`, `router-rules.js`, `firewall.js`, `evaluate.js` | Интервалы, нормализация, путь пакета, итог по гостю |
| `backend/services/proxmox/exposure/store.js`, `worker.js` | Версии, сохранение, очередь и повторные проходы |
| `backend/services/proxmox/exposure/view.js`, `query.js` | Публичные DTO и серверные условия фильтра |
| `backend/services/proxmox/exposure/tickets.js` | Явно включаемые заявки и их эпизоды |
| `frontend/src/pages/Proxmox/Exposure.jsx`, `exposure-presentation.js` | Секция, подписи и подсветка |
| `frontend/src/components/Preferences/ProxmoxNetworks.jsx` | Сетевые связи внутри существующих глобальных настроек |

У каждого нового сервиса с логикой — соседний `.test.js`. Это единая функция
с последовательными зависимостями, а не несколько независимых проектов.
Задачи 3–6 имеют отдельные проверяемые результаты, но подключаются к UI
только после общей сборки в задаче 7.
Неполные пути сервисов в задачах ниже относятся к
`backend/services/proxmox/exposure/`.

Данные:

- `Preferences.proxmox.networkLinks[]`: `_id`, `connectionId`, `nodeName`,
  `bridge`, `vlan` (`null` либо `1..4094`), `cidr`, `routerId`, `lanInterface`,
  `wan: { kind: 'interface'|'list', name }`. `networkLinksVersion` — серверный
  хеш нормализованных связей; клиент его не назначает.
- `Resource.guestNetwork` (закрытое поле): `version`, `identity`, `checkedAt`,
  `lastAttemptAt`, `lastError`, `interfaces[]` с MAC, bridge/VLAN и адресами/
  источниками. `exposureGeneration` — закрытый возрастающий номер пересчёта.
- `RouterExposureSnapshot`: уникальный `routerId`, `revision`, `checkedAt`,
  `lastAttemptAt`, `status`, `lastError`, закрытый нормализованный `data`,
  `leaseToken/leaseUntil`. Неуспешная попытка не заменяет `data/checkedAt`.
  `revision` меняется после каждого полного успешного чтения, даже при
  неизменившейся конфигурации. Хеш содержимого при необходимости хранится
  отдельно: два успешных опроса нельзя спутать с повтором одного снимка.
- `GuestExposure`: уникальный `resourceId`, `generation`, `inputVersions`,
  `reportVersion`, `checkedAt`, `freshUntil`, закрытый `report` и закрытый
  `issue` для эпизода заявки. Запись отчёта не заменяет `issue` целиком.
- `Resource.exposure`: только безопасная сводка — `generation`,
  `networkLinksVersion`, `state`, `hasPublic`, `hasRestricted`,
  `publishedCount`, `blockedCount`, `unknownCount`, `checkedAt`, `freshUntil`,
  `lastAttemptOk`, `reasonCodes`, `securityCheckedAt`, `confirmedCveCount`.
  Здесь нет IP/MAC, ссылок, имён роутеров, правил и идентификаторов связей.
  Внутренний `coverage[]` хранит эти же счётчики и свежесть независимо по
  источникам/фрагментам, без их идентификаторов. Всё поле `exposure` выбирается
  явно внутри сервиса; наружу выходит только вычисленная компактная сводка.

`state`: `public|restricted|blocked|unknown|unmatched|none`; свежесть вычисляется
отдельно по времени, результату попытки и версиям. Смешанный результат хранит
отдельные фрагменты и счётчики. `freshness` применяется к каждому источнику;
DTO и query пересчитывают актуальные значения из `coverage[]` на момент запроса.
Поэтому истечение срока одного источника не удаляет свежую публикацию другого.
Общий `freshUntil` ограничивает только утверждения полного отрицательного
результата; сохранённые верхнеуровневые boolean-поля не заменяют эту проверку.

API:

- `GET /api/proxmox/guests/:id/exposure` → `{ resourceId, summary, publications?, sources? }`.
  Последние два поля выдаются только при MikroTik-правах; только публикации
  запрошенного гостя, без полной конфигурации роутера.
- `GET /api/proxmox/exposure/options?connectionId=&nodeName=&routerId=` →
  каталоги для формы глобальных настроек. Права: `settings.manage`,
  `proxmox.manage`, `mikrotik.read`, оба модуля. Сначала сохранённые каталоги;
  при их отсутствии — ограниченное чтение выбранных управляемых устройств,
  с кешем 5 минут. Произвольные host/команды из запроса запрещены.
- Сохранение через существующий `POST /api/preferences`, группу `proxmox`.
  Частичное сохранение других полей не очищает связи и не требует новых прав.
- Список принимает `exposure=published|restricted|attention|none`.
  При выключенном MikroTik параметр игнорируется, кросс-модульных DTO нет.

### Задача 1. Контракт, хранение и выключенные по умолчанию настройки

**Файлы:** создать `contract.js`, `backend/models/proxmoxExposure.js`,
`contract.test.js`, `backend/models/proxmoxExposure.test.js`; изменить
`backend/models/{preferences,proxmox}.js`, `backend/scripts/dev/maskData.js`
и его тест; добавить `backend/scripts/ensureProxmoxExposureIndexes.js` и тест,
зарегистрировать идемпотентную миграцию в `backend/scripts/migrate.js` и его тесте.

**Interfaces:** `enabled(prefs) -> boolean`,
`freshness({checkedAt,lastAttemptOk,versionMatches}, now) -> fresh|stale|unknown`,
`exposureRisk(securityScan, now) -> {confirmedCveCount,securityCheckedAt,missingCheck}`.
Экспортировать `TIMING`, `LIMITS`, модели и `networkLinkSchema`.

- [x] Написать `network freshness expires at 15 minutes` и
  `failed refresh retains a fresh completed CVE result` с проверками:

  ```js
  assert.equal(freshness({ checkedAt: new Date(0), lastAttemptOk: true, versionMatches: true }, new Date(15 * 60000)), 'stale');
  assert.equal(exposureRisk({ status: 'error', checkedAt: new Date(0), report: { findings: [] } }, new Date(36 * 3600000)).missingCheck, false);
  ```

  Также закрепить границы: в 15 минут сеть устарела; отчёт CVE
  актуален до 36 часов включительно; ошибка обновления с ещё актуальным прошлым
  `report` не означает отсутствие проверки. Defaults: новый флаг `false`, связи `[]`.
- [x] Запустить новые тесты до реализации; убедиться в падении на отсутствии
  контракта/полей, затем реализовать схемы, индексы и функции.
- [x] Зафиксировать лимиты: 20 000 строк и 8 MiB на ответ RouterOS,
  32 перехода цепочек, 4096 фрагментов на гостя; остаток при лимите — unknown.
  Маскирование очищает обе новые коллекции, гостевую сеть, сводку, связи,
  версии/эпизоды; принудительно выключает новый флаг.
- [x] Выполнить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/contract.test.js models/proxmoxExposure.test.js scripts/dev/maskData.test.js scripts/ensureProxmoxExposureIndexes.test.js scripts/migrate.test.js`.
  Ожидается PASS; повторный запуск миграции ничего не меняет, старые настройки
  не включают новую опцию. Реальную миграцию на рабочей базе не запускать.

### Задача 2. Сетевые связи и каталоги глобальных настроек

**Файлы:** создать `network-links.js/.test.js`,
`backend/controllers/proxmoxExposure.js`,
`backend/controllers/preferences.proxmox-exposure.test.js`; изменить
`backend/services/proxmox/settings.js/.test.js`, `backend/controllers/preferences.js`,
`backend/routes/internal/proxmox.js`.

**Interfaces:** `validateNetworkLinks(input,current,{can,lookups}) -> links`,
`linksVersion(links) -> string`,
`getNetworkOptions({connectionId,nodeName,routerId}, access) -> catalogues`.
Контроллер экспортирует `options` и использует существующие gate/error conventions.

- [x] Тестами закрепить отказ по отсутствующим правам/модулям и чужим ID;
  сохранение неизменённых связей вместе с другими настройками; canonical CIDR,
  VLAN, дубликаты и противоречивые пересечения; транзитный роутер не создаёт связь.
- [x] Увидеть FAIL, реализовать валидацию на границе и серверную версию связей.
  Пустые недоступные каталоги возвращать с причиной; не заменять произвольным
  ручным host. Не менять остальные группы `preferences`.
- [x] Добавить аудит изменений/удаления связей через существующий механизм
  событий Proxmox без сетевых секретов; пометить затронутые поколения для пересчёта.
  Интерфейс задачи 7 подключить после его появления.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/network-links.test.js services/proxmox/settings.test.js controllers/preferences.proxmox-exposure.test.js controllers/preferences.test.js`.
  Ожидается PASS, в том числе частичные старые формы не стирают новые настройки.

### Задача 3. Фактические сети гостя и однозначное сопоставление

**Файлы:** создать `guest-network.js/.test.js`, `match.js/.test.js`;
изменить точечные места `backend/services/proxmox/core.js` смены идентичности.

**Interfaces:** `collectGuestNetwork(resource,connection,{request,now}) -> GuestNetwork`,
`buildGuestIndex(guests,links) -> GuestIndex`,
`matchGuestNetworks({guest,guestIndex,links,routerSnapshots},now) -> {targets,unresolved}`.
Target содержит гостя, интерфейс, IP, scope/link и источник доказательства;
неоднозначность возвращается отдельно, а не выбирается первый кандидат.
GuestIndex включает остальных обнаруженных гостей того же явного сегмента,
чтобы конфликт адреса нельзя было пропустить при расчёте одного гостя.

- [x] Тесты: два одинаковых IP в разных контекстах, клон MAC, несколько NIC,
  Guest Agent без NIC-соответствия, loopback/Docker-сеть, конфликт адресов,
  актуальные DHCP/ARP и просроченная аренда, остановленная/отключённая ВМ.
- [x] Увидеть FAIL, добавить только GET-чтение: QEMU current config и agent
  network interfaces, LXC current config и фактические interfaces. Проверить
  реальные пути/форматы по API PVE 8/9 до написания адаптеров; fixtures должны
  отражать эти форматы. Ошибку чтения не выдавать за пустой интерфейс.
- [x] Реализовать сопоставление в явном сегменте и проверку идентичности.
  При смене UUID/сети/обнаруженном удалении сбрасывать подтверждение;
  LXC после пропуска жизненного цикла не наследует доверие лишь по VMID/MAC.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/guest-network.test.js services/proxmox/exposure/match.test.js services/proxmox/guest-agent.test.js services/proxmox/proxmox.test.js`.
  Ожидается PASS; тесты транспорта запрещают любые POST/PUT/DELETE.

### Задача 4. Ограниченное чтение снимка MikroTik

**Файлы:** создать `backend/services/mikrotik/exposure-snapshot.js/.test.js`;
точечно расширить `backend/services/mikrotik/{apiReader,connector}.js` и их тесты.

**Interfaces:** `collectRouterSnapshot(record,{read,now}) -> RawSnapshot`;
`sendCommand(conn,words,limits?)` и `withApiSession(params,fn,{deadlineMs,readLimits}?)`
получают необязательные ограничения; прежние вызовы сохраняют поведение.

- [x] Тестами запретить всё, кроме фиксированных `/print` для NAT/filter/raw/
  mangle, IP/address/route/arp/DHCP, interface/list/member и address-list.
  Ответ `!trap`, усечение, превышение размера и таймаут не дают complete=true.
- [x] Увидеть FAIL; ограничить байты/строки во время чтения потока, а не после
  загрузки всего ответа. Превышение закрывает сеанс и снимает слушатели.
- [x] Использовать `pollParams`, `resolveJumpContext`, `withApiSession` и
  существующий `liveLimiter`. Не копировать транспорт из upgrade-функций и не
  вызывать их действия. Сеанс: 60 секунд с существующей добавкой транзита,
  команда: 5 секунд; реальная ошибка сохраняется без секретов.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/mikrotik/exposure-snapshot.test.js services/mikrotik/apiReader.test.js services/mikrotik/liveLimiter.test.js services/mikrotik/connector.test.js`.
  Новый NAT-сбор
  не вызывает `recoverToOnline` и не увеличивает failedPolls роутера.

### Задача 5. Интервалы и нормализация RouterOS

**Файлы:** создать `ip-set.js/.test.js`, `router-rules.js/.test.js`.

**Interfaces:** `parseIPv4Set(value) -> Intervals`, `parsePorts(value) -> Intervals`,
`intersect(a,b)`, `subtract(a,b)`, `union(a,b) -> Intervals`;
`normalizeRouter(raw,now) -> RouterGraph` с таблицами в исходном порядке,
статусом полноты и списком неподдерживаемых условий.

- [x] Написать тесты CIDR `/0`, `/32`, диапазонов, отрицаний, нескольких портов,
  невалидных значений, true/false/yes/no, пустых штатных значений, статических
  address-list и include/exclude interface-list. Unknown непустое условие
  нельзя потерять при нормализации.
- [x] Увидеть FAIL и реализовать интервальную арифметику без перечисления IP.
  Проверить, например, что вычитание `/32` из `/0` даёт два диапазона,
  а не массив из миллиардов адресов.
- [x] Нормализовать поддержанные предикаты; для неизвестных сохранять код и
  название поля, без скриптов/секретных значений. Отличать динамический dst-nat
  от динамического/FQDN-условия с неизвестным текущим множеством адресов.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/ip-set.test.js services/proxmox/exposure/router-rules.test.js`.
  Ожидается PASS, включая лимиты и специальные/CGNAT диапазоны WAN.

### Задача 6. Путь пакета и итоговые публикации

**Файлы:** создать `firewall.js/.test.js`, `evaluate.js/.test.js`.

**Interfaces:** `evaluatePath(graph,target,{limits}) -> {fragments,unresolved}`;
`evaluateTargets({guestTargets,routerSnapshots,links},now) -> ExposureReport`;
`summaryOf(report,securityScan,now) -> ExposureSummary`.
Fragment задаёт точные множества внешних/внутренних адресов/портов, источников,
протокол, verdict и основание. Неизвестный остаток имеет собственную область.

- [x] Написать fixtures обычного dst-nat, remap 44389→3389, отсутствующего
  to-ports, всех портов, UDP, первого совпадения, затенённого NAT, raw drop,
  forward accept/drop, default accept, jump/return/цикла, established-only
  fasttrack и неизвестного предиката до/после доказанного решения.
- [x] Увидеть FAIL и реализовать разбиение множеств: raw/mangle до NAT,
  dstnat по исходному назначению, основной маршрут, forward по переведённому
  адресу/порту. Не разбирать произвольные скрипты или состояния established
  как разрешение нового входящего соединения.
- [x] Проверить конкретный смешанный случай: `TCP 80,443`, 443 разрешён всем,
  80 зависит от неизвестного условия. Результат обязан содержать public только
  для 443 и unknown только для 80; новый запрет 80 не удаляет публикацию 443.
  Разные источники разных портов не объединять в общий allowlist.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/firewall.test.js services/proxmox/exposure/evaluate.test.js`.
  Дополнительно закрепить hairpin/VPN-only/redirect/пул получателей, отсутствующий
  маршрут, недоказанный WAN и отказ одного из нескольких роутеров. PASS означает
  сохранение доказанных частей; none возможно лишь при полном покрытии.

### Задача 7. Фоновый обработчик, версии и сохранение

**Файлы:** создать `store.js/.test.js`, `worker.js/.test.js`; изменить
`backend/app.js`, точечные места `core.js`, `guest-security.js`, а также
хук сохранения сетевых связей из задачи 2.

**Interfaces:** `invalidateResources(scope,reason) -> Promise<void>` увеличивает
`exposureGeneration`; `publishReport(resourceId,generation,inputVersions,report)`
сохраняет отчёт/сводку только для действующих входов;
`syncGuestRisk(resourceId)` обновляет безопасные поля CVE;
`tick(deps={}) -> Promise<void>` выполняет ограниченный проход.

- [x] Тесты с фальшивыми часами и моделями: один lease на роутер; старый worker
  после нового снимка/связи/UUID не публикует результат; рестарт восстанавливает
  просроченный lease; отказ сохраняет прошлый отчёт и не переносит checkedAt.
- [x] Увидеть FAIL; реализовать CAS по поколению ресурса и версиям источников.
  GuestExposure и Resource могут записываться последовательно, но читатель
  принимает только совпавшие поколения; промежуточный результат считается
  неизвестным. Более старое поколение не заменяет новое ни в одном документе.
- [x] Зарегистрировать `tick` раз в 30 секунд, с выбором должных источников
  по 5-минутному интервалу, сначала самых старых. За тик — максимум 2 роутера
  и 6 гостей; job watchdog 180 секунд, lease 240 секунд. Таймбюджет включает
  ожидание limiter/транзита: по его окончании новые чтения не стартуют.
- [x] Подключить инвалидирование после изменения/удаления связей, фактических
  сетей и снимков, а риск — после сохранения CVE; первичный пересчёт включает
  существующие отчёты. Ошибки дополнительных задач не портят обычный poll/CVE.
  После опубликованного результата/смены состояния вызвать существующий
  `core.bump()`; существующее обновление страниц перечитывает список/секцию.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/store.test.js services/proxmox/exposure/worker.test.js services/proxmox/monitor-regression.test.js services/proxmox/resource-monitoring.test.js services/proxmox/guest-security.test.js`.
  Ожидается PASS. Оба модуля, родители и ресурс перепроверяются перед чтением
  и публикацией; выключение не обозначается как восстановление.

### Задача 8. DTO, доступ и фильтрация до пагинации

**Файлы:** создать `exposure/view.js/.test.js`, `query.js/.test.js`,
`backend/routes/internal/proxmox-exposure.test.js`; изменить
`backend/controllers/proxmoxExposure.js`, `backend/controllers/proxmox.js`,
`backend/routes/internal/proxmox.js`, `services/proxmox/{view,monitoring-view}.js`
и их тесты, `backend/services/mcp/proxmoxSource.js/.test.js`.

**Interfaces:** `publicSummary(resource,prefs,now) -> summary|null`,
`publicDetail(resource,report,access,prefs,now) -> DTO`,
`applyExposureFilter(filter,value,{prefs,now}) -> void`.
`read.list(kind,query,access={})` и `read.detail(kind,id,access={})`
получают явный контекст; отсутствие контекста никогда не разрешает сетевые детали.

- [x] Тесты: свежесть ровно на границе, CVE 36 часов без нового опроса,
  шаблоны, отсутствующая сводка, неактуальная версия связей, mixed источники;
  фильтры вместе с company/OS/agent/search на странице 2 и корректный total.
  Отдельный тест `one source expiring does not hide another fresh publication`
  проверяет одновременно count/filter/detail после истечения только одного TTL.
- [x] Увидеть FAIL; фильтровать по безопасным полям Resource.exposure.coverage и
  текущему времени до skip/limit/count. `attention` включает неизвестные,
  несопоставленные и просроченные данные, а также свежие публикации с CVE/
  отсутствием актуальной проверки; ни один случай не требует клиентского
  фильтра или неограниченного массива ID из другой коллекции.
- [x] Добавить endpoint детали; удалить закрытые поля также из явных lean/
  сериализованных DTO. Без MikroTik-права нет адресов/имён/ID/ссылок ни в
  строках, facets, ошибках, options, связанных узлах или MCP. Сводка сохраняется.
  При выключенном модуле не возвращать даже исторический exposure DTO.
- [x] Запустить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/view.test.js services/proxmox/exposure/query.test.js services/proxmox/view.test.js services/proxmox/monitoring-view.test.js routes/internal/proxmox-exposure.test.js services/mcp/proxmoxSource.test.js`.
  Ожидается PASS; проверить неизвестный ID, не-гостя, end-user, отказ прав
  и upstream 401/403 без сброса сессии HD.

### Задача 9. Вариант A и глобальные настройки

**Файлы:** создать `frontend/src/pages/Proxmox/Exposure.jsx`,
`exposure-presentation.js/.test.js`,
`frontend/src/components/Preferences/ProxmoxNetworks.jsx`;
изменить `frontend/src/pages/Proxmox/{List,Detail,shared}.jsx`, `fleet.css`,
`data.js`, `frontend/src/components/Preferences/Proxmox.jsx`.

**Interfaces:** `ExposureLabel({summary})`,
`ExposureSection({resourceId,summary,canReadMikrotik})`,
`ProxmoxNetworks({value,onChange,options,canEdit})`;
`exposureLabel(summary)`, `exposureTone(summary)`, `exposureFilterOptions`.
Resource loader получает `section=exposure`; отдельного settings route нет.

- [x] Тестами представления закрепить подписи, старые даты/смешанные источники,
  отсутствие отрицательной метки в каждой строке и то, что номер порта не
  превращается в доказательство службы или эксплуатируемой CVE.
- [x] Реализовать вариант A с существующими ListRow/Section/AnchorRail, сохранив
  названия ВМ, фильтры/группы, power/bulk/backup-меню. Ссылки на MikroTik несут
  контекст возврата. Отметка видна и на узкой ширине, без добавленной широкой колонки.
  Секция перечитывает данные при изменении `summary.generation/checkedAt`;
  ответ другого `resourceId` не отображается во время перехода. При смене
  прав или выключении модуля старые данные fetcher также скрываются.
- [x] В существующем разделе `/preferences#proxmox` добавить строки сетевых
  связей на Combobox/общих полях и новый Switch заявок. Данные входят в
  существующий SectionForm/DraftBar; отдельного «Сохранить» нет. Новый флаг
  требует общего autoTickets; отключение общего флага не включает/очищает
  новый молча. Ошибки каталога не очищают черновик связей.
- [x] Выполнить `cd frontend && pnpm test`, затем scoped ESLint изменённых
  файлов и `pnpm build`. Ожидается PASS/успешная сборка. Для обратной связи
  пользователя дать рабочие страницы в обеих темах; браузер/E2E от агента —
  только при отдельном запросе согласно проектному workflow.

### Задача 10. Заявки по явному включению и эпизоды

**Файлы:** создать `exposure/tickets.js/.test.js`; изменить точечный вызов
в `worker.js` и фильтр `recoveryComments` в `services/proxmox/monitor.js`;
дополнить `services/proxmox/monitor-tickets.test.js`.

**Interfaces:** `syncExposureIssue(resourceId,{now}) -> Promise<void>`;
закрытый `GuestExposure.issue` хранит `episodeKey`, `activeKey`, `firstSeenAt`,
`lastQualifiedRevision`, `successStreak`, `ticketId`, `recoveredAt`, claims.
Ticket.proxmoxSource использует `type:'exposureSecurity'` и существующий
уникальный механизм activeKey; одна активная заявка на гостя/эпизод.

- [x] Тесты: новый флаг отсутствует/false, общий false, модули выключены,
  остановленная/отключённая ВМ, maintenance, только NAT/админ-порт, unknown NAT,
  CVE review-only — ни одного вызова создания/обновления заявки.
- [x] Увидеть FAIL и реализовать подтверждение двумя разными успешными
  5-минутными проходами плюс thresholdMinutes. Повтор одного revision не
  увеличивает streak. Ошибка/разрыв сбрасывает подтверждение, не закрывая
  существующий эпизод. Для missingCheck использовать задачу 1, а не только
  последний scan.status. Остальные условия и компания — как в спецификации.
- [x] Реализовать claim/идемпотентный source: сбой после Ticket.create до
  сохранения ticketId находится по activeKey; ручное закрытие заявки при
  продолжающемся том же эпизоде не создаёт новую. Изменения фактов обновляют
  источник без повторных заявок и комментариев на каждом poll.
- [x] Перепроверять разрешающие флаги перед каждым побочным эффектом. Новый
  тип исключить из общего recoveryComments: его восстановление/комментарии
  обслуживает этот сервис с теми же opt-in gates. В issue не использовать
  общий Resource.monitoringIssues, чтобы recoverResource при выключении
  мониторинга не восстанавливал проблему внешнего доступа.
- [x] Выполнить `docker compose exec -T -e NODE_ENV=test backend node --test services/proxmox/exposure/tickets.test.js services/proxmox/monitor-tickets.test.js services/proxmox/resource-monitoring.test.js`.
  Ожидается PASS, включая гонку выключения, рестарт, несколько портов/роутеров,
  неизвестный источник и восстановление только по подтверждённым данным.
  Текст заявки содержит сводку/ссылку, не сетевые адреса и имена роутеров;
  автоматически сама заявка не закрывается.

### Задача 11. Итоговая проверка и документация

**Файлы:** дополнить существующие `docs/inventory.md`,
`docs/mikrotik-management.md`, `docs/ux-ui-guide.md`; отметить выполненные пункты
этого плана. Новые документы вне утверждённых спеки/плана не требуются.

- [x] Сверить каждый из 11 пунктов приёмки спецификации с соответствующими
  тестами выше и выполнить объединённый набор:

  ```bash
  docker compose exec -T -e NODE_ENV=test backend node --test 'services/proxmox/*.test.js' 'services/proxmox/exposure/*.test.js' models/proxmoxExposure.test.js services/mikrotik/exposure-snapshot.test.js services/mikrotik/apiReader.test.js services/mikrotik/connector.test.js services/mikrotik/hostGuard.test.js services/mikrotik/liveLimiter.test.js routes/internal/proxmox-exposure.test.js routes/internal/proxmox-security.test.js controllers/preferences.proxmox-exposure.test.js controllers/preferences.test.js services/mcp/proxmoxSource.test.js scripts/dev/maskData.test.js scripts/ensureProxmoxExposureIndexes.test.js scripts/migrate.test.js
  ```

  Ожидается ноль ошибок. Тесты изменения секций должны оставаться независимыми
  от локального состава базы, наличия bash/git внутри контейнера и сети.
- [x] Выполнить frontend tests/scoped lint/build и `git diff --check`.
  Если новая ошибка не обнаружена, не повторять уже успешные проверки без причины.
- [x] Проверить чтением локальной базы компактность DTO и согласованность
  count/filter/detail. Реальные связи не выдумывать, новую опцию не включать.
  Роутеры/ВМ для итоговой read-only сверки опрашивать лишь в существующем
  разрешённом контексте; изменение настроек не нужно для завершения проверки.
- [x] В существующих docs описать источники, границы покрытия, права, свежесть,
  настройку связей и явный opt-in заявок. Перед сдачей выполнить один итоговый
  независимый review изменений; исправить значимые замечания и проверить
  затронутые области. Сообщить пользователю результат и ограничения.

## Порядок и граница текущего этапа

Порядок: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.
Рекомендуемый способ — выполнить задачи последовательно в этой сессии и
провести один независимый review в конце: интерфейсы тесно связаны, а
контракты и случаи проверки уже определены планом. Делегирование разработки
по каждой задаче можно выбрать отдельно, если оно предпочтительнее.

Реализация выполнена в текущей рабочей копии без коммитов и деплоя.
Независимое ревью выявило восемь важных случаев; исправления проверены
регрессионными тестами с воспроизведением до исправления. Для LXC добавлен
закрытый `guestIncarnation` при наблюдаемом исчезновении/повторном обнаружении;
он участвует в CAS и сетевой идентичности и удаляется маскированием.
Неоднозначное преобразование диапазона `to-ports` и влияющая policy routing
остаются неизвестными: предположение об offset не используется.

Итог: 268 целевых backend-тестов, 79 frontend-тестов, scoped ESLint,
production build и `git diff --check` проходят. Локальная база проверена
чтением: 32 гостя, сетевых связей 0, подтверждённых публикаций 0,
новая опция заявок выключена. Реальные устройства этой функцией при проверке
не опрашивались; связи и автоматические заявки не включались. Настройка
связей выполняется пользователем в `/preferences#proxmox`.
