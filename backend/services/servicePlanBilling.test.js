// node --test services/servicePlanBilling.test.js
require("module-alias/register");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  calcSingleWorkOvertime,
  calcWorkTime,
  dayWindow,
  priceHourPackage,
  MS_PER_MINUTE,
  DAYS_OF_WEEK,
} = require("@/services/servicePlanBilling");

const baseline = require("./__fixtures__/billing-baseline.json");

const ZONE = baseline.zone;
const PERIOD = baseline.tariffingPeriod;

const at = (text) => dayjs.tz(text, ZONE).toDate();
const minutes = (ms) => Math.round(ms / MS_PER_MINUTE);

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

const SCHEDULES = {
  standard: week(5),
  night: week(7, { start: "22:00", end: "06:00" }),
  degenerate: week(7, { start: "00:00", end: "00:00" }),
  allOff: week(0),
  always: week(7, { is24hours: true, start: "", end: "" }),
};

const WORKS = {
  insideWindow: ["2026-06-01 09:00", "2026-06-01 18:00"],
  aroundWindow: ["2026-06-01 08:00", "2026-06-01 19:00"],
  weekend: ["2026-06-06 10:00", "2026-06-06 12:00"],
  nightShift: ["2026-06-01 22:00", "2026-06-02 06:00"],
  fullDay: ["2026-06-01 00:00", "2026-06-02 00:00"],
  tenMinutes: ["2026-06-01 12:00", "2026-06-01 12:10"],
  overWindowEnd: ["2026-06-01 17:50", "2026-06-01 18:20"],
  eveningIntoNight: ["2026-06-01 20:00", "2026-06-02 02:00"],
  acrossMonth: ["2026-05-31 23:00", "2026-06-01 01:00"],
  midnightToMidnight: ["2026-06-02 00:00", "2026-06-03 00:00"],
};

const measure = (scheduleName, workName) => {
  const schedule = SCHEDULES[scheduleName];
  const [from, to] = WORKS[workName];
  const item = { startedAt: at(from), finishedAt: at(to) };
  const overtime = calcSingleWorkOvertime(schedule, item, PERIOD, ZONE);
  const worktime = calcWorkTime(schedule, [item], PERIOD, ZONE);

  return {
    durationMinutes: minutes(
      item.finishedAt.getTime() - item.startedAt.getTime(),
    ),
    worktimeMinutes: worktime.worktime,
    overtimeMinutes: minutes(overtime.actualOvertime),
  };
};

/**
 * Строки, которые правка окон через полночь ОБЯЗАНА изменить, и во что.
 * Всё остальное сверяется с замороженным снимком «до»: расхождение там —
 * регрессия, а не решение.
 */
const CHANGED = {
  "night/insideWindow": { worktimeMinutes: 0, overtimeMinutes: 540 },
  "night/aroundWindow": { worktimeMinutes: 0, overtimeMinutes: 660 },
  "night/weekend": { worktimeMinutes: 0, overtimeMinutes: 120 },
  "night/nightShift": { worktimeMinutes: 480, overtimeMinutes: 0 },
  "night/fullDay": { worktimeMinutes: 480, overtimeMinutes: 960 },
  "night/tenMinutes": { worktimeMinutes: 0, overtimeMinutes: 10 },
  "night/overWindowEnd": { worktimeMinutes: 0, overtimeMinutes: 30 },
  "night/eveningIntoNight": { worktimeMinutes: 240, overtimeMinutes: 120 },
  "night/acrossMonth": { worktimeMinutes: 120, overtimeMinutes: 0 },
  "night/midnightToMidnight": { worktimeMinutes: 480, overtimeMinutes: 960 },
};

for (const scheduleName of Object.keys(SCHEDULES)) {
  for (const workName of Object.keys(WORKS)) {
    const key = `${scheduleName}/${workName}`;

    test(`${key}: числа не разошлись с зафиксированными`, () => {
      const actual = measure(scheduleName, workName);
      const expected = CHANGED[key] || baseline.rows[key];

      assert.equal(actual.worktimeMinutes, expected.worktimeMinutes);
      assert.equal(actual.overtimeMinutes, expected.overtimeMinutes);
    });

    test(`${key}: время в графике плюс переработка равны длительности`, () => {
      // Инвариант ловит и двойной счёт, и дыру в нарезке. До правки его
      // нарушали все восемь ночных строк.
      const actual = measure(scheduleName, workName);
      assert.equal(
        actual.worktimeMinutes + actual.overtimeMinutes,
        actual.durationMinutes,
      );
    });
  }
}

test("вырожденный тариф 00:00–00:00 окна не даёт", () => {
  assert.equal(dayWindow(SCHEDULES.degenerate, "2026-06-01", ZONE), null);
});

test("круглосуточный день кончается следующей полуночью, а не в 23:59:59.999", () => {
  const window = dayWindow(SCHEDULES.always, "2026-06-01", ZONE);
  assert.equal(window.workEnd, dayjs.tz("2026-06-02 00:00", ZONE).valueOf());
  // Работа ровно в сутки при круглосуточном графике — ноль переработки
  const item = { startedAt: at("2026-06-01 00:00"), finishedAt: at("2026-06-02 00:00") };
  const { actualOvertime } = calcSingleWorkOvertime(
    SCHEDULES.always,
    item,
    PERIOD,
    ZONE,
  );
  assert.equal(actualOvertime, 0);
});

test("окно через полночь заканчивается в следующих сутках", () => {
  const window = dayWindow(SCHEDULES.night, "2026-06-01", ZONE);
  assert.equal(window.workStart, dayjs.tz("2026-06-01 22:00", ZONE).valueOf());
  assert.equal(window.workEnd, dayjs.tz("2026-06-02 06:00", ZONE).valueOf());
});

test("withinPlan выключает и нарезку по графику, и переработку", () => {
  const item = {
    startedAt: at("2026-06-06 10:00"),
    finishedAt: at("2026-06-06 12:00"),
    withinPlan: true,
  };
  assert.equal(
    calcSingleWorkOvertime(SCHEDULES.standard, item, PERIOD, ZONE)
      .actualOvertime,
    0,
  );
  assert.equal(
    calcWorkTime(SCHEDULES.standard, [item], PERIOD, ZONE).worktime,
    120,
  );
});

/**
 * Переработка округляется вверх до периода ОДИН раз на работу — как и время в
 * графике (`calcWorkTime`). Раньше округлялся каждый непокрытый кусок отдельно,
 * а сутки резали непрерывный час на два: 23:40–00:40 давали 30 + 45 = 75 минут
 * «к тарификации» при 60 фактических.
 */
const roundedOvertime = (from, to) =>
  minutes(
    calcSingleWorkOvertime(
      SCHEDULES.standard,
      { startedAt: at(from), finishedAt: at(to) },
      PERIOD,
      ZONE,
    ).roundUpOvertime,
  );

test("округление: ровный час через полночь остаётся часом", () => {
  assert.equal(roundedOvertime("2026-06-01 23:40", "2026-06-02 00:40"), 60);
});

test("округление: час из двух кусков вокруг окна остаётся часом", () => {
  // 08:20–09:00 (40 мин) + 18:00–18:20 (20 мин) = 60 мин
  assert.equal(roundedOvertime("2026-06-01 08:20", "2026-06-01 18:20"), 60);
});

test("округление: неровная сумма по-прежнему идёт вверх до периода", () => {
  assert.equal(roundedOvertime("2026-06-01 18:00", "2026-06-01 18:50"), 60);
  // 20 + 30 = 50 мин через полночь → 60, а не 30 + 30
  assert.equal(roundedOvertime("2026-06-01 23:40", "2026-06-02 00:30"), 60);
  // 40 + 25 = 65 мин вокруг окна → 75
  assert.equal(roundedOvertime("2026-06-01 08:20", "2026-06-01 18:25"), 75);
});

test("пакет часов: перебор остаётся на своей ступени, а не прыгает на следующую", () => {
  // 24:10 обязаны считаться по ставке пакета 24 ч, а не по цене пакета 48 ч.
  const tariff = {
    hourPackages: [
      { hours: 24, pricePerHour: 1000 },
      { hours: 48, pricePerHour: 900 },
    ],
  };

  const exact = priceHourPackage(tariff, 24);
  assert.equal(exact.basis.mode, "package");
  assert.equal(exact.price, 24 * 1000);

  const over = priceHourPackage(tariff, 24 + 10 / 60);
  assert.equal(over.basis.mode, "overflow");
  assert.equal(over.basis.hours, 24);
  assert.equal(over.price, (24 + 10 / 60) * 1000);
  // Дороже пакета 48 ч быть не может — иначе смысл сравнения теряется
  assert.ok(over.price < 48 * 900);
});
