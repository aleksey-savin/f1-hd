# Журнал событий устройства Mikrotik — дизайн

Макет раздела: https://claude.ai/artifact/6ATs9Up63bjcMHwnvtuQRv (ждёт одобрения; файл — `.superpowers/sdd/2026-10-10-mikrotik-event-log/mockup.html`).


## Зачем

У устройства Mikrotik нет единой истории. Простои, обновления из HD, запросы агента и копии конфигурации лежат в пяти разных хранилищах; правки записи, включение мониторинга, удаление копий и отказы агенту на входе пишутся только в файловый лог (30 дней). Uptime читается при каждом опросе, но не сохраняется — перезагрузки вне обновления из HD не видны. Смена версии прошивки молча перезаписывается. Лог самого роутера читается только по запросу через MCP и не хранится. Изменение конфигурации определяется лишь по хешу копии, без «что именно».

Цель: один журнал на устройство, отвечающий на «когда перезагружалось, обновлялось, кто и что менял», включая всё, что делает ИИ-агент через MCP.

Решения владельца (10.10):
- конфигурация — лог роутера при опросе + сводка отличий между копиями;
- MCP — весь путь запроса на изменение и живые обращения агента к роутеру (чтения из базы HD не пишутся);
- место — раздел на странице записи, общего журнала парка нет;
- прошлое — разовый перенос из имеющихся хранилищ.

## Порядок работ

1. **Макет раздела «Журнал»** (артефакт: обе темы, десктоп + телефон 390 px, структура как у `.superpowers/sdd/2026-10-10-mikrotik-agent-changes/mockup.html`). Код фронтенда — только после «ок». Бэкенд (шаги 3–6) от макета не зависит и идёт параллельно.
2. **Спека** `docs/superpowers/specs/2026-10-10-mikrotik-event-log-design.md` — фиксирует этот план. Без коммита (git ведёт владелец).
3–8. Реализация по разделам ниже, TDD на чистых модулях.

## Модель и сервис

**`backend/models/mikrotikEvent.js`** — `MikrotikEvent`:

| Поле | Смысл |
|---|---|
| `mikrotik` | запись устройства |
| `at` | когда произошло |
| `kind` | явный вид из каталога (не классификация по тексту — урок `TicketLog`) |
| `group` | `link` · `power` · `config` · `record` · `agent` · `router` — для фильтра |
| `severity` | `info` · `warning` · `danger` |
| `actor` | `{ type: user/system/mcpKey/routerUser, userId, name, keyId, keyName, onBehalfOf }` — имена снимком, как `requestedVia` |
| `data` | небольшой структурный объект вида (from/to, поля, счётчики, текст строки роутера) |
| `diff` | до 60 отредактированных строк отличий конфигурации (отдаётся только с `manageConfigs`) |
| `refs` | `changeId`, `upgradeJobId`, `artifactId`, `outageId`, `ticketId` |
| `count`, `lastAt` | свёртка повторов (обращения агента) |
| `dedupeKey` | уникальный разреженный — идемпотентность переноса и строк роутера |

Индексы `{mikrotik, at:-1}`, `{mikrotik, group, at:-1}`; TTL по `at` — 365 дней (`RETENTION_DAYS`, как в `inAppNotification.js`). Плагин pulse + строка в `services/pulseTopics.js` (тема `mikrotik`). Удаление записи каскадно удаляет её события (рядом с `deleteOutages`/`deleteTraffic` в `deleteRecord`).

**`backend/services/mikrotik/events.js`** — `createEventLog({ store, now, log })` c `record(recordId, kind, {...})`; никогда не бросает (образец `services/aiTicketLog.js`), ленивый mongo-store, тесты на заглушках. **`eventKinds.js`** — каталог `kind → group, severity`; зеркало для фронта `frontend/src/util/mikrotik-events.js` (иконка, подпись, тон — по образцу `util/ticket-events.js`).

## Источники событий

| Группа | События | Где эмитится |
|---|---|---|
| Связь | не в сети, снова в сети (с длительностью) | `monitorState.js`: `recordFailure` (после CAS), `recoverToOnline` (`prev.offlineSince`) |
| Питание и прошивка | перезагрузка; версия изменилась (было → стало); имя/серийник изменились | `recoverToOnline`: сравнение `prev` и `set` |
| Обновление из HD | запущено (кем), завершено, не удалось, отменено (кем) | `controllers/inventory/mikrotikUpgrade.js`, `upgradeWorker.js` (`applyItemPatch` при смене `state`) |
| Конфигурация | конфигурация изменилась (+N −M, затронутые меню); копия создана/удалена/скачана; расписание изменено | `artifacts.js` `createArtifact`; контроллер `mikrotik.js` |
| Запись в HD | создана; параметры изменены (список полей, секреты — только «пароль изменён»); мониторинг вкл/выкл; плановые отключения; ответственный; связь с карточкой; закреплён сертификат/ключ | `controllers/inventory/mikrotik.js` рядом с существующими `logger.log(... actor ...)`; пины — `monitorState.js`, `artifacts.js` |
| Агент | запрос предложен / отклонён на входе / решение / отменён / применён / откат / не применён / требует проверки / истёк; чтение конфигурации, состояния, лога; ping | см. «MCP» |
| Роутер | значимые строки лога RouterOS | опрос, см. ниже |

**Перезагрузка.** `mapPollToFields` (`connector.js`) дополнительно берёт `uptime` из уже читаемого `/system/resource/print`; на записи хранится `bootedAt = now − uptime` (часы HD, не роутера — свитчи без часов). Если новый `bootedAt` позже прежнего больше чем на 2 минуты — событие «перезагрузка» с `at = bootedAt`; причина «при обновлении из HD», если идёт задание обновления (`upgradeGuard`), иначе не указана. Новые поля — в `MONITOR_SET` (`pulseTopics.js`), чтобы опрос не будил вкладки.

**Лог роутера.** В `pollDevice` опция `readLog` (только health-check): `/log/print` с `withReadTimeout`, перед `/interface/print` (тот обязан оставаться последним). Чистый модуль `services/mikrotik/routerLog.js`:
- курсор `logCursor` на записи — последний `.id`; новые строки — с большим `.id`; сброс нумерации после перезагрузки = читать всё;
- первое чтение только ставит курсор (чужое прошлое не импортируется);
- значимое: темы `system`, `critical`, `error`, `account`, правки вида «… added/changed/removed by <user>»; `debug`, вывод скриптов и собственные входы учётки HD отбрасываются (переиспользовать `dropOwnSessions`, `redactSecrets`, `scrubUrls` из `liveState.js`);
- не больше 50 событий за опрос, остаток — одной строкой «ещё N записей»;
- `at` — время опроса (точность до 5 минут, как у простоев), порядок по `.id`; собственная метка времени роутера хранится в `data` как текст. Имя учётки роутера разбирается в `actor.routerUser`.

**Отличия конфигурации.** `diffConfigs` переезжает из `services/mcp/mikrotikTools.js` в `services/mikrotik/configDiff.js` (MCP реэкспортирует). В `createArtifact`, когда хеш отличается от прежнего, загружается предыдущая копия (тот же путь, что `loadExportConfig` в `mikrotikSource.js`), считаются счётчики и затронутые меню, строки проходят `redactConfig` и режутся до 60. Счётчики и меню видны всем с `mikrotik.read`, строки — только с `manageConfigs` (копии закрыты 2FA, журнал не должен её обходить).

## MCP

- Фабрики `createMikrotikTools`, `createMikrotikDiagnostics`, `createMikrotikChangeTools` получают зависимость `events` в `backend/routes/mcp.js`.
- `propose_mikrotik_change`: «предложен» и «отклонён на входе» (с причиной; сейчас отказ не остаётся нигде в базе). Актор — ключ (`keyId`, `keyName`), `onBehalfOf` — названный заявитель.
- `get_mikrotik_config`, `get_mikrotik_state`, `get_mikrotik_log`, `ping_from_mikrotik`: событие обращения; тот же ключ + тот же инструмент в пределах 10 минут — `$inc count` и `lastAt` вместо новой строки. Ответ из кеша (устройство не тронуто) не пишется.
- Решения и исходы: `changeDecisions.js` (решение, отмена — человек и канал), `changeWorker.js` `finish()` и прямые `store.update` (не применён за 30 минут, истёк). В событии `refs.changeId` — строка журнала ведёт на страницу запроса. Номера запроса в тексте нет («№» — только заявка).
- Новый инструмент чтения `get_mikrotik_events` (scope `mikrotik`): устройство, период, группа, лимит 20 (макс. 100); текстом по конвенциям `docs/mcp.md` (заголовок со счётчиком, строка на событие, `iso()`, `safeLine`, только имена, английские подписи через карту).

## API и перенос

- `GET /api/inventory/mikrotik-devices/records/:recordId/events?before=&group=&limit=30` → `{ events, nextBefore }`; гейт `canReadMikrotik`; `diff` вырезается без `manageConfigs`. Контроллер — отдельный `controllers/inventory/mikrotikEvent.js`, маршрут в `routes/internal/inventory/mikrotik.js`.
- Миграция `backfillMikrotikEvents` через `backend/scripts/migrate.js`: `MikrotikOutage` → связь; элементы `MikrotikUpgradeJob` → обновления и смена версии; `MikrotikChange.timeline` → события агента; `MikrotikArtifact` → копии (у отличающихся по хешу — «изменилась, состав не сохранён»). Только upsert по `dedupeKey`, ничего не удаляет.

## Фронтенд (после одобрения макета)

- `frontend/src/components/Mikrotik/JournalSection.jsx`, `Eyebrow id="journal"`, запись в `railSections` (`pages/Mikrotik/Record.jsx`). Предложение для макета: раздел последним, после «Изменений».
- Форма по правилам ленты из гайда: дни подписями («Сегодня», «9 октября»), в строке — время, иконка в тоне каталога, подпись + кто; содержание отдельной строкой (моно для строк роутера, «было → стало» как в `ChangeCommands.jsx`); свёртка шума (обращения агента ×N, серии строк роутера); фильтр `FilterChip` по группам в `action` у `Eyebrow`; «Показать ещё» курсором.
- Переиспользовать: `Panel`/`Eyebrow`, `FilterChip`, `FoldRow`, `UserLink`, `formatTime`/`formatDayMonthLong`/`formatDate`, `businessDayKey`; стор — метод `fetchEvents` в `store/lists/mikrotik-devices.js`; живое обновление — `useLiveTopic("mikrotik")`, без своих таймеров.
- В макете решить: название раздела рядом с уже существующим свёрнутым «Журналом простоев» в «Доступности».

## Документация

`docs/mikrotik-management.md` (раздел про журнал: модель, каталог, источники, пределы), `docs/mcp.md` (новый инструмент, что пишется от агента), `docs/mikrotik-changes.md` (точки эмиссии), `docs/ux-ui-guide.md` + changelog — после макета. Заметки — на английском, без UI.

## Проверка

- Юнит-тесты `node:test` только затронутых файлов: `events`, `eventKinds`, `routerLog` (курсор, сброс после перезагрузки, фильтр, лимит), `configDiff`, обнаружение перезагрузки, свёртка обращений агента, `mikrotikTools`/`mikrotikDiagnostics`/`mikrotikChangeTools` (эмиссия с актором-ключом), `changeDecisions`, `changeWorker`, `upgradeWorker`, новый MCP-инструмент. Полный `pnpm test` бэкенда не запускать.
- `node --check` изменённых файлов бэкенда; фронт — eslint и сборка (typecheck красный до правок — сверять только новые ошибки).
- Миграция на локальной копии базы: счётчики до/после, повторный запуск не добавляет событий.
- Вживую (владелец): перезагрузить тестовое устройство, поменять правило на роутере руками, сделать копию, провести запрос агента до применения — все четыре следа должны появиться в журнале. Не проверено заранее: формат строк лога RouterOS 6 и поведение `.id` на свитчах.
