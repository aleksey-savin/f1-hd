/**
 * Снимок ТЕКУЩЕГО поведения биллинга — страховка перед правкой окон графика.
 *
 * Денежное ядро не покрыто тестами, а правка нарезки по дням трогает счёт.
 * Скрипт прогоняет `servicePlanBilling` по матрице «форма графика × форма
 * работы» и печатает результат JSON'ом. Вывод кладётся в
 * `services/__fixtures__/billing-baseline.json` и служит эталоном: после
 * правки каждое расхождение обязано быть объяснено, а не обнаружено.
 *
 * Часть зафиксированных чисел ЗАВЕДОМО НЕВЕРНА (ночное окно даёт ноль
 * оплачиваемого времени и сутки переработки) — это снимок «как есть», а не
 * «как надо». Ожидания правильного поведения живут в тестах.
 *
 *   node scripts/freezeBilling.js > services/__fixtures__/billing-baseline.json
 */
require("module-alias/register");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  calcSingleWorkOvertime,
  calcWorkTime,
  MS_PER_MINUTE,
} = require("@/services/servicePlanBilling");

// Пояс организации на снимке прода — в нём и морозим
const ZONE = "Asia/Vladivostok";
const TARIFFING_PERIOD = 15;

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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
    DAYS.map((name, index) => [
      name,
      index < workdays ? day(over) : day({ isWorking: false }),
    ]),
  );

const SCHEDULES = {
  // Пн–Пт 09:00–18:00 — самая частая форма (25 из 33 компаний)
  standard: week(5),
  // Ночная смена: сегодня ломает обе половины расчёта
  night: week(7, { start: "22:00", end: "06:00" }),
  // Живой тариф из прода: все семь дней вырождены, «окна нет — всё переработка»
  degenerate: week(7, { start: "00:00", end: "00:00" }),
  // 3 компании и 8 тарифов: рабочих дней нет вовсе
  allOff: week(0),
  // Круглосуточно
  always: week(7, { is24hours: true, start: "", end: "" }),
};

/** Настенное время пояса организации → инстант. */
const at = (text) => dayjs.tz(text, ZONE).toDate();

const WORKS = {
  insideWindow: { startedAt: at("2026-06-01 09:00"), finishedAt: at("2026-06-01 18:00") },
  aroundWindow: { startedAt: at("2026-06-01 08:00"), finishedAt: at("2026-06-01 19:00") },
  weekend: { startedAt: at("2026-06-06 10:00"), finishedAt: at("2026-06-06 12:00") },
  nightShift: { startedAt: at("2026-06-01 22:00"), finishedAt: at("2026-06-02 06:00") },
  fullDay: { startedAt: at("2026-06-01 00:00"), finishedAt: at("2026-06-02 00:00") },
  tenMinutes: { startedAt: at("2026-06-01 12:00"), finishedAt: at("2026-06-01 12:10") },
  overWindowEnd: { startedAt: at("2026-06-01 17:50"), finishedAt: at("2026-06-01 18:20") },
  eveningIntoNight: { startedAt: at("2026-06-01 20:00"), finishedAt: at("2026-06-02 02:00") },
  acrossMonth: { startedAt: at("2026-05-31 23:00"), finishedAt: at("2026-06-01 01:00") },
  midnightToMidnight: { startedAt: at("2026-06-02 00:00"), finishedAt: at("2026-06-03 00:00") },
};

const minutes = (ms) => Math.round(ms / MS_PER_MINUTE);

const rows = {};
for (const [scheduleName, schedule] of Object.entries(SCHEDULES)) {
  for (const [workName, work] of Object.entries(WORKS)) {
    const overtime = calcSingleWorkOvertime(
      schedule,
      work,
      TARIFFING_PERIOD,
      ZONE,
    );
    const worktime = calcWorkTime(
      schedule,
      [work],
      TARIFFING_PERIOD,
      ZONE,
    );
    const durationMs =
      work.finishedAt.getTime() - work.startedAt.getTime();

    rows[`${scheduleName}/${workName}`] = {
      durationMinutes: minutes(durationMs),
      worktimeMinutes: worktime.worktime,
      roundedWorktimeMinutes: worktime.roundedWorktime,
      overtimeMinutes: minutes(overtime.actualOvertime),
      roundedOvertimeMinutes: minutes(overtime.roundUpOvertime),
      // Инвариант, который обязан держаться: время в графике плюс переработка
      // равны длительности работы. Где false — там двойной счёт или дыра.
      conserved:
        worktime.worktime + minutes(overtime.actualOvertime) ===
        minutes(durationMs),
    };
  }
}

process.stdout.write(
  `${JSON.stringify({ zone: ZONE, tariffingPeriod: TARIFFING_PERIOD, rows }, null, 2)}\n`,
);
