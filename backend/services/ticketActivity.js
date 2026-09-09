const { KINDS } = require("@/services/ticketEvents");
const { eachDayKey } = require("@/services/dateKeys");

// Модель и календарь подключаются внутри функций, которым они нужны: наверху
// модуля они тянут за собой mongoose и логгер, а правила среза — чистые
// функции, и тест не должен поднимать инфраструктуру ради арифметики.

/**
 * Срез «давно без движения» для главной: что считать движением, какие заявки
 * идут в зачёт и сколько рабочих дней они молчат.
 *
 * **Движение по заявке — это последнее событие её ХРОНИКИ, кроме служебных.**
 * Своего поля «когда заявку двигал человек» у заявки нет и заводить его не
 * пришлось: хроника (`TicketLog`) уже пишется из двух десятков мест и держит
 * всё, что делает человек, — обработку, «принята в работу», ответственных,
 * дедлайн, работы, чек-лист, вложения, комментарии, закрытие. Служебными
 * каталог видов помечает ровно два: отправку уведомлений (`delivery`) и фоновую
 * обработку ИИ (`ai`). Отсюда определение, которое ничего не выдумывает:
 * движение — то, что человек видит в карточке заявки; невидимое движением не
 * считается.
 *
 * Почему не `updatedAt`: его бумкает любое машинное касание (мониторинг, крон,
 * почта, рассылка уведомлений), и заявка, заведённая в марте и с тех пор никем
 * не тронутая, выглядит как «молчит 12 дней». К тому же `getAllOpened` его
 * вовсе не отдаёт наружу.
 *
 * Порог — в РАБОЧИХ днях по производственному календарю: иначе в понедельник
 * срез вспыхивает от субботы с воскресеньем, а после новогодних — целиком.
 */

// Виды событий, которые движением не считаются. Список выводим из каталога, а
// не переписываем: добавится третий служебный вид — он приедет сам.
const TECHNICAL_KINDS = Object.entries(KINDS)
  .filter(([, meta]) => meta.technical)
  .map(([kind]) => kind);

const DEFAULT_RULES = {
  thresholdDays: 7,
  ignoreAuto: true,
  ignoreUnassigned: true,
};

/**
 * Правила из настроек. Значения по умолчанию дублируют схему `Preferences`
 * намеренно: сервис зовут и до того, как настройки хоть раз сохранили.
 */
const resolveRules = (preferences) => {
  const raw = preferences?.staleTickets || {};
  const threshold = Number(raw.thresholdDays);
  return {
    thresholdDays:
      Number.isFinite(threshold) && threshold > 0
        ? Math.floor(threshold)
        : DEFAULT_RULES.thresholdDays,
    // Переключатели включены, пока их явно не выключили.
    ignoreAuto: raw.ignoreAuto !== false,
    ignoreUnassigned: raw.ignoreUnassigned !== false,
  };
};

/**
 * Машинная заявка: завёл мониторинг или за ней вообще нет человека. Поля
 * `isAuto` у заявки нет — признак собирается из источника и заявителя.
 * «Регламентное задание» машинным НЕ считается: заявку создаёт крон, а работу
 * по ней делает человек.
 */
const isMachineTicket = (ticket) =>
  ticket?.source === "Мониторинг устройств" ||
  !(ticket?.applicantId || ticket?.applicant?._id || ticket?.applicant);

/** Идёт ли заявка в зачёт среза. */
const isEligible = (ticket, rules) => {
  if (rules.ignoreAuto && isMachineTicket(ticket)) return false;
  if (rules.ignoreUnassigned && !(ticket?.responsibles ?? []).length) {
    return false;
  }
  return true;
};

/** Календарный день инстанта в часовом поясе организации, ключом YYYY-MM-DD. */
const businessDayKey = (date, timezone) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone: timezone });

/**
 * Рабочих дней между днём движения и сегодня. День самого движения не в счёт:
 * заявка, которую трогали сегодня, молчит ноль дней, а не один.
 */
const businessDaysBetween = (fromKey, toKey, calendar) => {
  if (!fromKey || !toKey || fromKey >= toKey) return 0;
  let days = 0;
  for (const key of eachDayKey(fromKey, toKey)) {
    if (key === fromKey) continue;
    const { kind } = calendar.classify(key);
    // Сокращённый предпраздничный — рабочий: люди на месте.
    if (kind === "work" || kind === "short") days += 1;
  }
  return days;
};

/**
 * Дата последнего человеческого движения по каждой заявке, одной агрегацией.
 *
 * Записи без вида (`kind`) в выборку попадают: поле появилось позже самой
 * хроники, и до бэкфилла (`scripts/backfillTicketLogKinds.js`) вид пуст у
 * старых событий. Так срез работает и на незаполненной базе — просто чуть
 * оптимистичнее, пока бэкфилл не прошёл.
 */
const lastMovedAt = async (ticketIds) => {
  if (!ticketIds.length) return new Map();
  const TicketLog = require("@/models/ticketLog");
  const rows = await TicketLog.aggregate([
    { $match: { ticketId: { $in: ticketIds }, kind: { $nin: TECHNICAL_KINDS } } },
    { $group: { _id: "$ticketId", movedAt: { $max: "$createdAt" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.movedAt]));
};

/**
 * Чистая половина расчёта — её и проверяет тест. Дописывает каждой заявке
 * `movedAt`, `silentDays` (рабочие дни) и `isStale`.
 */
const computeStale = (tickets, { rules, moved, calendar, timezone, now }) => {
  const todayKey = businessDayKey(now ?? new Date(), timezone);
  return tickets.map((ticket) => {
    const movedAt = moved.get(String(ticket._id)) ?? ticket.createdAt;
    const silentDays = businessDaysBetween(
      businessDayKey(movedAt, timezone),
      todayKey,
      calendar,
    );
    return {
      ...ticket,
      movedAt,
      silentDays,
      isStale: isEligible(ticket, rules) && silentDays >= rules.thresholdDays,
    };
  });
};

/**
 * Полный проход: правила из настроек, даты движения из хроники, календарь на
 * период от самой молчащей заявки до сегодня — один раз на запрос.
 */
const attachStale = async (tickets, preferences) => {
  const { buildCalendarContext } = require("@/services/productionCalendar");
  const rules = resolveRules(preferences);
  if (!tickets.length) return { tickets, rules };

  const timezone = preferences?.timezone || "Europe/Moscow";
  const moved = await lastMovedAt(tickets.map((ticket) => ticket._id));

  const now = new Date();
  const todayKey = businessDayKey(now, timezone);
  const keys = tickets.map((ticket) =>
    businessDayKey(moved.get(String(ticket._id)) ?? ticket.createdAt, timezone),
  );
  const fromKey = keys.reduce((min, key) => (key < min ? key : min), todayKey);
  const calendar = await buildCalendarContext(fromKey, todayKey, preferences);

  return {
    tickets: computeStale(tickets, { rules, moved, calendar, timezone, now }),
    rules,
  };
};

module.exports = {
  TECHNICAL_KINDS,
  DEFAULT_RULES,
  resolveRules,
  isMachineTicket,
  isEligible,
  businessDayKey,
  businessDaysBetween,
  computeStale,
  lastMovedAt,
  attachStale,
};
