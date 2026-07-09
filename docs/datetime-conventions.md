# Даты и таймзоны — устройство и конвенции

_Обновлено: 2026-07-09, после сквозного аудита дат (бэкенд + фронтенд) и
рефакторинга в четыре пакета (унификация бэка, day-shift баги, единые форматы,
поведенческие исправления). Документ — источник правды для нового кода;
детали сверяйте с `backend/utils/datetime.js` и
`frontend/src/util/format-date.js`._

## TL;DR — три правила

1. **Показываешь дату человеку** — только через хелперы
   (`utils/datetime.js` на бэке, `util/format-date.js` на фронте). Голый
   `toLocaleString()` на сервере = UTC, на клиенте = таймзона браузера — и то и
   другое расходится с бизнес-временем.
2. **Читаешь календарный день из `Date`** — никогда через
   `toISOString().split("T")[0]` (это UTC-день: для UTC+10 «вчера» каждое утро
   до 10:00). Локальный день инстанта — `toDateInputValue(date)`.
3. **`<input type="datetime-local">`** — настенное время в нём означает
   **бизнес-таймзону**: загрузка `utcToLocalForm(iso)`, сохранение
   `localToUtc(value)`, «Сейчас» — `toDateTimeLocal()`. Пары не смешивать.

## Модель данных

- **Инстанты** (моменты времени: `createdAt`, `deadline`, `finishedAt`,
  `offlineSince`…) — UTC `Date` в Mongo, наружу ISO-строки. Всегда точка на
  оси времени; таймзона — вопрос только отображения.
- **Календарные даты** («только дата», без времени: `purchasedAt`,
  `warrantyExpirationDate`, `lastMaintenanceDate`, `effectiveDate`,
  `expiresAt` услуг) — в Mongo лежат **UTC-полночью** (`"2026-07-08" →
  2026-07-08T00:00:00Z`), между фронтом и бэком ходят строками `YYYY-MM-DD`.
  Это НЕ инстанты: показывать их надо «как записано», без сдвига зоной.
- **Бизнес-таймзона** — `Preferences.timezone` (IANA-идентификатор,
  выбирается в Настройки → Основные из `frontend/src/store/timezones.js`;
  схемный дефолт `Europe/Moscow`). При логине кладётся в
  `localStorage.timezone` (`pages/Authentication.jsx`), обновляется на
  странице настроек. Сервер (Docker) живёт в UTC — `TZ` не задан, и на это
  нельзя опираться.

## Бэкенд

### `backend/utils/datetime.js` — единственный источник

| Экспорт | Что делает |
| --- | --- |
| `DEFAULT_TIMEZONE` | `"Europe/Moscow"` — единый дефолт (= схема Preferences). **Не хардкодить зоны по коду.** |
| `resolveTimezone(prefs)` | `prefs?.timezone \|\| DEFAULT_TIMEZONE` |
| `formatInAppTimezone(date, tz, pattern)` | безопасный `date-fns-tz/formatInTimeZone`: битая зона в настройках не роняет текст (фолбэк — серверное время) |
| `fmtDateTime(date, tz)` | канонический `dd.MM.yyyy, HH:mm`, `—` для пустого |

Потребители: тексты заявок/комментариев Mikrotik (`services/mikrotik/tickets.js`
`fmtTime`), имена файлов экспорта (`artifacts.js` `timestampForName`),
уведомления (`middleware/notifications.js` `formatDateTime` — Intl с
`timeZone: resolveTimezone(prefs)`), rate-limit сообщения (`routes/internal/auth.js`,
смещение от Москвы — `getTimezoneOffset` из date-fns-tz).

### Границы периодов в отчётах

Любые границы «день/месяц/квартал/год» — по настенным часам бизнес-таймзоны
через `dayjs.tz` (плагины utc+timezone):

```js
const tz = resolveTimezone(await Preferences.findOne({}));
const from = dayjs.tz(date, tz).startOf("month").toDate(); // instant UTC
const to = dayjs.tz(date, tz).endOf("month").toDate();
```

Так работают: dashboard, `companyStatsService`, `personalReportService`
(личный отчёт: методика переработок обязана совпадать со сводным отчётом — см.
`calcSingleWorkOvertime`), тренды аналитики (`controllers/report.js`
`generatePeriods`), финансы (`controllers/finances/report.js`
`monthBoundsInAppTz` — границы месяца для `ServicePlanReport.periodFrom/To`).
Mongo-агрегации по дням — `$dateToString`/`$dayOfMonth` с опцией
`timezone: tz` (пример — `companyStatsService`).

### Cron / планировщики

- Ежедневные задания — `cron.schedule(expr, fn, { timezone })`: ночная
  очистка/сканы в `app.js` (`registerMaintenanceCrons` — таймзона читается из
  настроек при старте; смена зоны подхватывается рестартом), рутинные задачи
  (`middleware/routineTasks.js`, `taskManager.js`).
- Интервальные (`*/5 * * * *` и чаще) — таймзона не важна.
- Расписания экспорта Mikrotik — свой компилятор `services/mikrotik/schedule.js`
  `computeNextRun` (date-fns-tz, шаг по UTC-полуночам — БЕЗ пропусков дат на
  переводе часов).

### telegram-bot (отдельный пакет)

Без date-fns-tz: `Intl` с `timeZone: prefs.timezone || DEFAULT_TIMEZONE`
(`middleware/tgBotApi.js` `formatDate`), «дедлайн сегодня» (метка 🕗) — через
`dayKey(date, tz)` (`toLocaleDateString("en-CA", { timeZone })`), а не через
`getDate()` сервера. Локальная константа `DEFAULT_TIMEZONE` обязана совпадать
с бэкендовой.

## Фронтенд

### `frontend/src/util/format-date.js`

Таймзона читается **при каждом вызове** (`localStorage.timezone`, фолбэк
`DEFAULT_TIMEZONE`) — не кэшировать её на уровне модуля: значение протухает
после логина/смены настройки.

Отображение **инстантов** (бизнес-таймзона):

| Хелпер | Формат | Типовое место |
| --- | --- | --- |
| `formatDate` | `пн, 08.07.2026, 14:30` | канонический «дата+время»: комментарии, логи, таблицы |
| `formatShortDate` | `08.07.2026` | дата инстанта (создан, последняя копия) |
| `formatDateTime` | `8 июля, 14:30` | компактный без года |
| `formatDayMonthTime` | `08.07, 14:30` | оси/тултипы графиков и лент |
| `formatMonthYear` / `formatMonth` | `июль 2026` / `июль` | заголовки месячных периодов |

Отображение **календарных дат** — `formatCalendarDate` (`08.07.2026`,
`timeZone: "UTC"`): день показывается «как записан» и не съезжает ни в какой
таймзоне браузера. Использовать для полей из «Модели данных» выше (карточка
устройства, сроки услуг, передача ответственности).

Значения инпутов и обратные преобразования:

| Хелпер | Направление | Семантика |
| --- | --- | --- |
| `toDateInputValue(date?)` | → `<input type="date">` | **локальный** календарный день инстанта (дефолт — сегодня) |
| `toDateTimeLocal(date?)` | → `<input type="datetime-local">` | настенное время в **бизнес-таймзоне** (дефолт — сейчас; кнопки «Сейчас») |
| `utcToLocalForm(iso)` | ISO → datetime-local | то же для строки с бэка (загрузка форм) |
| `localToUtc(value)` | datetime-local → ISO | обратное: настенное бизнес-время → UTC (сохранение форм) |
| `timeDateInputFormat(date)` | Date → datetime-local | **браузерная** зона; только для настенной арифметики «±N минут» над уже введённым значением (round-trip без конверсий). В новых местах не использовать. |

`util/time-helpers.js`: `msToHMS` (длительность `ЧЧ:ММ`, tz-агностик) и
`getNextCronDate(cron)` — следующий запуск **в бизнес-таймзоне** (синхронно с
серверным node-cron; используется картточками рутинных задач и их сортировкой).

### Конвенция datetime-форм (дедлайны заявок, работы)

Симметричная пара, всё в бизнес-таймзоне:

```
загрузка:   defaultValue={utcToLocalForm(ticket.deadline)}
«Сейчас»:   setValue(toDateTimeLocal())
±N минут:   setValue(timeDateInputFormat(new Date(parsed ± N*60000)))  // round-trip
сохранение: formData.append("deadline", localToUtc(input.value))
```

Нарушение симметрии (загрузка в одной зоне, сохранение в другой) — это баг
класса «пересохранил без правок — время уехало на разницу поясов».

### Счётчики и «сегодня»

- «До дедлайна N ч M мин», просрочка, гарантия — только epoch-математика над
  `Date` (`endTime - Date.now()`), без парсинга строк. Tz-агностично.
- Статус «рабочее время компании» — `util/get-working-status.js`
  (`toZonedTime` в бизнес-зоне).

## Намеренные исключения (не «чинить»)

- **`ClientDevice/Form.jsx` `toDateInput`** — префилл `type="date"` из
  календарного поля читает день через `toISOString().split("T")[0]` — это
  КОРРЕКТНО (поле хранится UTC-полночью, читаем UTC-день обратно);
  `toDateInputValue` здесь дал бы сдвиг в поясах с отрицательным смещением.
- **`WorkCalendar` / `TimeByDayChart`** (финансы) — рендерят day-key-строки
  `YYYY-MM-DD` самосогласованно в браузерной зоне; менять только вместе с
  сервером ключей.
- **Границы `from`/`to` остальных отчётов** (`controllers/report.js:53,138`) —
  завязаны на сводный отчёт; трогать только с проверкой соответствия
  методике переработок.

## Анти-паттерны (то, что вычищали аудитом)

- `toLocaleString()` / `toLocaleDateString()` мимо хелперов — даёт таймзону
  сервера (UTC) или браузера и плодит новый формат (до аудита их было ~13).
- `toISOString().split("T")[0]` для «сегодня»/значений датапикера — UTC-день
  (архив заявок искал со сдвигом на день; пресет «Этот год» заполнял 31.12).
- Хардкод зон (`"Asia/Vladivostok"`, `"Europe/Moscow"`) по коду — только
  `DEFAULT_TIMEZONE` из утилей; реальная зона всегда из настроек.
- `new Date(y, m, d)` на сервере для границ периодов — это UTC-границы;
  использовать `dayjs.tz`. Отдельно: `new Date(y, m+1, 0)` — это **00:00**
  последнего дня, а не конец месяца (терялся почти весь последний день).
- Несимметричные load/save у datetime-форм (см. конвенцию выше).

## Как проверить руками

1. Поставить в браузере ОС-таймзону, отличную от бизнес-зоны (например,
   Europe/Moscow при бизнес-зоне Asia/Vladivostok), перелогиниться.
2. Открыть заявку: «Создана», комментарии, дедлайн в форме — одинаковое
   бизнес-время везде; пересохранить дедлайн без правок — он не сдвигается.
3. Архив заявок: выбрать день в датапикере — выборка именно за этот день.
4. Карточка устройства: даты покупки/гарантии совпадают с введёнными.
5. Тексты заявок мониторинга Mikrotik: «недоступно с …» соответствует времени
   создания заявки (см. также `docs/mikrotik-management.md`).
6. Рутинные задачи: «следующее выполнение» на карточке совпадает с реальным
   срабатыванием серверного cron.
