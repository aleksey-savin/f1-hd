// node --test services/workOvertime.test.js
require("module-alias/register");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  calcWorkOvertime,
  staticDayPlanner,
} = require("@/services/workOvertime");
const { DAYS_OF_WEEK } = require("@/services/workWindow");

const ZONE = "Asia/Vladivostok";
const PERIOD = 15;

/** Настенное время пояса расчёта → инстант. */
const at = (text) => dayjs.tz(text, ZONE).toDate();
const work = (from, to, over = {}) => ({
  startedAt: at(from),
  finishedAt: at(to),
  ...over,
});

const day = (over = {}) => ({
  isWorking: true,
  is24hours: false,
  start: "09:00",
  end: "18:00",
  breakMinutes: 60,
  ...over,
});
const week = (workdays, over = {}) =>
  Object.fromEntries(
    DAYS_OF_WEEK.map((name, index) => [
      name,
      index < workdays ? day(over) : day({ isWorking: false }),
    ]),
  );

const run = (dayPlanFor, item) =>
  calcWorkOvertime(item, {
    dayPlanFor,
    tariffingPeriodMinutes: PERIOD,
    tz: ZONE,
  });

const minutes = (result) => Math.round(result.actualMs / 60000);

// --- дневной график: поведение обязано остаться прежним --------------------

const DAY_PLAN = staticDayPlanner(week(5));

test("работа внутри окна переработки не даёт", () => {
  const result = run(DAY_PLAN, work("2026-06-01 09:00", "2026-06-01 18:00"));
  assert.equal(minutes(result), 0);
  assert.deepEqual(result.days, []);
});

test("час до и час после окна — два куска, каждый округляется свой", () => {
  const result = run(DAY_PLAN, work("2026-06-01 08:00", "2026-06-01 19:00"));
  assert.equal(minutes(result), 120);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].bucket, "weekday");
  assert.equal(result.days[0].roundedMinutes, 120);
});

test("выходной уходит в переработку целиком", () => {
  const result = run(DAY_PLAN, work("2026-06-06 10:00", "2026-06-06 12:00"));
  assert.equal(minutes(result), 120);
  assert.equal(result.days[0].bucket, "weekend");
});

test("работа через полночь режется по суткам и округляется в каждых", () => {
  // 20:00→02:00 при окне 09:00–18:00: 4 ч в понедельник, 2 ч во вторник
  const result = run(DAY_PLAN, work("2026-06-01 20:00", "2026-06-02 02:00"));
  assert.equal(minutes(result), 360);
  assert.equal(result.days.length, 2);
  assert.deepEqual(
    result.days.map((d) => d.actualMinutes),
    [240, 120],
  );
});

test("withinPlan выключает расчёт целиком", () => {
  const result = run(
    DAY_PLAN,
    work("2026-06-06 10:00", "2026-06-06 12:00", { withinPlan: true }),
  );
  assert.equal(minutes(result), 0);
});

// --- ночная смена ----------------------------------------------------------

const NIGHT_PLAN = staticDayPlanner(week(7, { start: "22:00", end: "06:00" }));

test("ночная смена целиком внутри своего окна — переработки нет", () => {
  // До починки: окно читалось внутри одних суток, куски «до» и «после»
  // перекрывались, и смена давала сутки переработки.
  const result = run(NIGHT_PLAN, work("2026-06-01 22:00", "2026-06-02 06:00"));
  assert.equal(minutes(result), 0);
  assert.deepEqual(result.days, []);
});

test("час до смены и час после неё считаются в своих сутках", () => {
  const result = run(NIGHT_PLAN, work("2026-06-01 21:00", "2026-06-02 07:00"));
  assert.equal(minutes(result), 120);
  assert.equal(result.days.length, 2);
  assert.deepEqual(
    result.days.map((d) => d.actualMinutes),
    [60, 60],
  );
});

test("работа целиком в хвосте смены переработкой не считается", () => {
  const result = run(NIGHT_PLAN, work("2026-06-02 02:00", "2026-06-02 04:00"));
  assert.equal(minutes(result), 0);
  assert.equal(result.days.length, 0);
});

test("сутки работы при ночном графике дают 16 часов, а не сорок", () => {
  // Зафиксированный снимок до починки: 2400 минут переработки из 1440.
  const result = run(NIGHT_PLAN, work("2026-06-01 00:00", "2026-06-02 00:00"));
  assert.equal(minutes(result), 16 * 60);
});

test("хвост ночной смены в нерабочий день остаётся внутри плана", () => {
  // Только понедельник рабочий: вторник выходной, но утро вторника накрыто
  // хвостом понедельничной смены.
  const plan = staticDayPlanner(week(1, { start: "22:00", end: "06:00" }));
  assert.equal(minutes(run(plan, work("2026-06-02 02:00", "2026-06-02 04:00"))), 0);
  // А после хвоста вторник уже переработка
  const after = run(plan, work("2026-06-02 07:00", "2026-06-02 09:00"));
  assert.equal(minutes(after), 120);
  assert.equal(after.days[0].bucket, "weekend");
});

test("утро праздника после ночной смены оплачивается по праздничному бакету", () => {
  const night = staticDayPlanner(week(7, { start: "22:00", end: "06:00" }));
  const holidayKey = "2026-06-12";
  const plan = (dateKey) =>
    dateKey === holidayKey
      ? { kind: "holiday", start: null, end: null }
      : night(dateKey);

  // Смена с 11 июня 22:00; её хвост до 06:00 12-го внутри плана, дальше праздник
  const result = run(plan, work("2026-06-11 22:00", "2026-06-12 08:00"));
  assert.equal(minutes(result), 120);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].date, holidayKey);
  assert.equal(result.days[0].bucket, "holiday");
});

// --- статический планировщик ----------------------------------------------

test("статический планировщик разбирает окно через полночь", () => {
  const plan = staticDayPlanner(week(7, { start: "22:00", end: "06:00" }))(
    "2026-06-01",
  );
  assert.equal(plan.start, 1320);
  assert.equal(plan.end, 1800);
  assert.equal(plan.crossesMidnight, true);
});

test("рабочий день с битым временем переработки не даёт", () => {
  const plan = staticDayPlanner(week(7, { start: "", end: "" }));
  assert.equal(plan("2026-06-01").start, null);
  assert.equal(minutes(run(plan, work("2026-06-01 10:00", "2026-06-01 12:00"))), 0);
});

test("вырожденное окно 00:00–00:00 оставляет всю работу переработкой", () => {
  // Живой тариф из прода: «окна нет — всё переработка». Прочитать его как
  // сутки значит перевернуть счёт клиенту.
  const plan = staticDayPlanner(week(7, { start: "00:00", end: "00:00" }));
  assert.equal(plan("2026-06-01").start, null);
  assert.equal(minutes(run(plan, work("2026-06-01 10:00", "2026-06-01 12:00"))), 0);
});

test("битая дата окончания не вешает расчёт", () => {
  const result = run(DAY_PLAN, {
    startedAt: at("2026-06-01 10:00"),
    finishedAt: new Date("3000-01-01T00:00:00Z"),
  });
  assert.equal(minutes(result), 0);
});

// --- доплата сотруднику меряется только по его графику ---------------------

const { overtimeForWork } = require("@/services/workOvertime");

const SETTINGS = {
  defaultSchedule: week(5),
  defaultTariffingPeriodMinutes: PERIOD,
  weekdayCoefficient: 1,
  weekendCoefficient: 1,
  holidayCoefficient: 1,
};

test("без личного графика берётся дефолтный из настроек, а не окно клиента", () => {
  // Раньше человек получал разные переработки за одинаковый вечер в
  // зависимости от того, к какому клиенту его послали.
  const result = overtimeForWork(work("2026-06-01 19:00", "2026-06-01 21:00"), {
    planner: null,
    overtimeSettings: SETTINGS,
    orgTz: ZONE,
  });

  assert.equal(result.scheduleSource, "fallback");
  assert.equal(result.overtime.days[0].actualMinutes, 120);
  assert.equal(result.tariffingPeriodMinutes, PERIOD);
});

test("с личным графиком считается по нему", () => {
  const planner = {
    hasPersonalSchedule: true,
    // Смена 12:00–20:00 — вечер внутри окна, переработки нет
    dayPlan: staticDayPlanner(week(5, { start: "12:00", end: "20:00" })),
  };
  const result = overtimeForWork(work("2026-06-01 19:00", "2026-06-01 21:00"), {
    planner,
    overtimeSettings: SETTINGS,
    orgTz: ZONE,
  });

  assert.equal(result.scheduleSource, "user");
  assert.equal(Math.round(result.overtime.actualMs / 60000), 60);
});

test("период тарификации доплаты берётся из настроек, а не у тарифа клиента", () => {
  const result = overtimeForWork(work("2026-06-01 18:00", "2026-06-01 18:01"), {
    planner: null,
    overtimeSettings: { ...SETTINGS, defaultTariffingPeriodMinutes: 30 },
    orgTz: ZONE,
  });

  assert.equal(result.tariffingPeriodMinutes, 30);
  assert.equal(result.overtime.days[0].roundedMinutes, 30);
});
