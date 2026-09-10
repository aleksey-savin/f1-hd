// Самопроверка ядра расчёта «Графиков работы» без БД и без сети:
// производственный календарь подставляется снимком из репозитория, модель
// отсутствий — заглушкой. Проверяет то, ради чего фича делалась:
//   • норма года сходится с hours40 источника (1972 ч / 247 дней);
//   • отпуск уменьшает норму ровно на рабочие дни периода;
//   • у сотрудника в UTC+10 обычная смена перестаёт быть переработкой;
//   • праздник и сокращённый день попадают в свои бакеты.
//
// Запуск:  node scripts/checkWorkCalendar.js
require("module-alias/register");

const bundled = require("../data/production-calendar/ru-2026.json");

// ── заглушки вместо БД ───────────────────────────────────────────────────
const ProductionCalendar = require("../models/productionCalendar");
ProductionCalendar.findOne = () => ({ lean: async () => bundled });

const Absence = require("../models/absence");
let ABSENCES = [];
Absence.find = () => ({ select: () => ({ lean: async () => ABSENCES }) });

const { buildScheduleContext, makePlanner } = require("../services/workCalendar");
const {
  resolveOvertimeSettings,
  overtimeForWork,
} = require("../services/workOvertime");

const PREFS = { timezone: "Europe/Moscow" };
const settings = resolveOvertimeSettings(PREFS);

const utcMidnight = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}: ${actual}${ok ? "" : ` (ждали ${expected})`}`);
};

const plannerFor = async (user, fromKey, toKey) => {
  const ctx = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: [String(user._id)],
    preferences: PREFS,
  });
  return makePlanner(user, ctx, settings);
};

/** Недельный график одной формой на все семь дней Пн–Пт. */
const weekSchedule = ({ start, end, breakMinutes = 60 }) =>
  Object.fromEntries(
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
      (name, index) => [
        name,
        index < 5
          ? { isWorking: true, is24hours: false, start, end, breakMinutes }
          : { isWorking: false, is24hours: false, start, end, breakMinutes: 0 },
      ],
    ),
  );

const staffUser = (overrides = {}) => ({
  _id: "u1",
  timezone: null,
  workSchedule: settings.defaultSchedule,
  followProductionCalendar: true,
  finances: { salary: null, overtimeHourlyRate: 500 },
  ...overrides,
});

const run = async () => {
  console.log("Норма по производственному календарю (5/2 09:00–18:00, перерыв 60)");
  ABSENCES = [];
  const yearPlanner = await plannerFor(staffUser(), "2026-01-01", "2026-12-31");
  const year = yearPlanner.periodPlan("2026-01-01", "2026-12-31");
  check("рабочих дней 2026", year.workingDays, 247);
  check("часов 2026", hours(year.normMinutes), 1972);

  const may = yearPlanner.periodPlan("2026-05-01", "2026-05-31");
  check("май: рабочих дней", may.workingDays, 19);
  check("май: часов", hours(may.normMinutes), 151);

  const july = yearPlanner.periodPlan("2026-07-01", "2026-07-31");
  check("июль: рабочих дней", july.workingDays, 23);
  check("июль: часов", hours(july.normMinutes), 184);

  console.log("\nОтпуск 18–29 мая уменьшает норму");
  ABSENCES = [
    {
      user: "u1",
      type: "vacation",
      status: "approved",
      from: utcMidnight("2026-05-18"),
      to: utcMidnight("2026-05-29"),
    },
  ];
  const vacPlanner = await plannerFor(staffUser(), "2026-05-01", "2026-05-31");
  const vac = vacPlanner.periodPlan("2026-05-01", "2026-05-31");
  check("май с отпуском: дней отсутствия", vac.absenceDays, 10);
  check("май с отпуском: часов", hours(vac.normMinutes), 71);
  check("май без отпуска (справочно)", hours(vac.normMinutesBeforeAbsences), 151);

  console.log("\nКомандировка норму НЕ уменьшает");
  ABSENCES = [
    {
      user: "u1",
      type: "trip",
      status: "approved",
      from: utcMidnight("2026-05-20"),
      to: utcMidnight("2026-05-22"),
    },
  ];
  const tripPlanner = await plannerFor(staffUser(), "2026-05-01", "2026-05-31");
  const trip = tripPlanner.periodPlan("2026-05-01", "2026-05-31");
  check("май с командировкой: часов", hours(trip.normMinutes), 151);
  check("май с командировкой: дней отсутствия", trip.absenceDays, 0);

  console.log(
    "\nТаймзона: инженер во Владивостоке при организации в Москве",
  );
  ABSENCES = [];
  // 2026-05-13, среда. Он работает 09:30–17:00 по своему времени,
  // то есть 02:30–10:00 по Москве — а графики задаются в поясе организации.
  const work = {
    startedAt: new Date("2026-05-12T23:30:00.000Z"),
    finishedAt: new Date("2026-05-13T07:00:00.000Z"),
    withinPlan: false,
    company: null,
    tickets: [],
  };
  const inOrgZone = weekSchedule({ start: "02:30", end: "10:00" });
  const vlad = staffUser({
    timezone: "Asia/Vladivostok",
    workSchedule: inOrgZone,
  });
  const vladPlanner = await plannerFor(vlad, "2026-05-01", "2026-05-31");
  const withSchedule = overtimeForWork(work, {
    planner: vladPlanner,
    plansByCompany: new Map(),
    overtimeSettings: settings,
    orgTz: "Europe/Moscow",
  });
  check(
    "график задан в поясе организации: переработка, мин",
    Math.round(withSchedule.overtime.roundedMs / 60000),
    0,
  );
  check("с личным графиком: источник", withSchedule.scheduleSource, "user");

  // Тот же человек, но график записали его местным временем — вся смена
  // уезжает в переработку. Ровно поэтому у поля стоит пометка о поясе.
  const naive = staffUser({ timezone: "Asia/Vladivostok" });
  const naivePlanner = await plannerFor(naive, "2026-05-01", "2026-05-31");
  const withNaive = overtimeForWork(work, {
    planner: naivePlanner,
    plansByCompany: new Map(),
    overtimeSettings: settings,
    orgTz: "Europe/Moscow",
  });
  check(
    "график записан местным временем: переработка, мин",
    Math.round(withNaive.overtime.roundedMs / 60000),
    390,
  );

  // Личный пояс на расчёт больше не влияет: те же цифры без него
  const noZone = staffUser({ workSchedule: inOrgZone });
  const noZonePlanner = await plannerFor(noZone, "2026-05-01", "2026-05-31");
  const withoutZone = overtimeForWork(work, {
    planner: noZonePlanner,
    plansByCompany: new Map(),
    overtimeSettings: settings,
    orgTz: "Europe/Moscow",
  });
  check(
    "личный пояс на расчёт не влияет: переработка, мин",
    Math.round(withoutZone.overtime.roundedMs / 60000),
    0,
  );

  console.log("\nПраздник и сокращённый день");
  // 12 июня 2026 — пятница, День России. Работа 10:00–14:00 по Москве.
  const holidayWork = {
    startedAt: new Date("2026-06-12T07:00:00.000Z"),
    finishedAt: new Date("2026-06-12T11:00:00.000Z"),
    withinPlan: false,
    company: null,
    tickets: [],
  };
  const junePlanner = await plannerFor(staffUser(), "2026-06-01", "2026-06-30");
  const holiday = overtimeForWork(holidayWork, {
    planner: junePlanner,
    plansByCompany: new Map(),
    overtimeSettings: settings,
    orgTz: "Europe/Moscow",
  });
  check("работа в День России: бакет", holiday.overtime.days[0]?.bucket, "holiday");
  check("работа в День России: переработка, мин", Math.round(holiday.overtime.roundedMs / 60000), 240);
  check("12 июня: норма дня, мин", junePlanner.dayPlan("2026-06-12").minutes, 0);
  check("11 июня сокращённый: норма дня, мин", junePlanner.dayPlan("2026-06-11").minutes, 420);

  // 8 мая сокращён до 17:00 — работа до 18:00 даёт час переработки
  const shortWork = {
    startedAt: new Date("2026-05-08T06:00:00.000Z"), // 09:00 МСК
    finishedAt: new Date("2026-05-08T15:00:00.000Z"), // 18:00 МСК
    withinPlan: false,
    company: null,
    tickets: [],
  };
  const shortPlanner = await plannerFor(staffUser(), "2026-05-01", "2026-05-31");
  const short = overtimeForWork(shortWork, {
    planner: shortPlanner,
    plansByCompany: new Map(),
    overtimeSettings: settings,
    orgTz: "Europe/Moscow",
  });
  check("8 мая: норма дня, мин", shortPlanner.dayPlan("2026-05-08").minutes, 420);
  check("8 мая: переработка после 17:00, мин", Math.round(short.overtime.roundedMs / 60000), 60);
  check("8 мая: бакет", short.overtime.days[0]?.bucket, "weekday");

  console.log("\nВерсии графика: с января 08:00–17:00, с марта 09:00–18:00");
  ABSENCES = [];
  const day = (start, end) => ({ isWorking: true, is24hours: false, start, end, breakMinutes: 60 });
  const rest = () => ({ isWorking: false, is24hours: false, start: "09:00", end: "18:00", breakMinutes: 0 });
  const week = (start, end) => ({
    Monday: day(start, end), Tuesday: day(start, end), Wednesday: day(start, end),
    Thursday: day(start, end), Friday: day(start, end), Saturday: rest(), Sunday: rest(),
  });
  const versioned = staffUser({
    workSchedule: null,
    workSchedules: [
      { effectiveFrom: new Date("2026-01-01T00:00:00Z"), schedule: week("08:00", "17:00"), followProductionCalendar: true },
      { effectiveFrom: new Date("2026-03-01T00:00:00Z"), schedule: week("09:00", "18:00"), followProductionCalendar: true },
    ],
  });
  const vp = await plannerFor(versioned, "2026-01-01", "2026-12-31");
  check("февраль по первой версии: окно начала, мин", vp.dayPlan("2026-02-10").start, 8 * 60);
  check("апрель по второй версии: окно начала, мин", vp.dayPlan("2026-04-10").start, 9 * 60);
  check("обе версии дают 8-часовой день (февраль)", vp.dayPlan("2026-02-10").minutes, 480);
  check("год всё равно сходится с источником, ч", hours(vp.periodPlan("2026-01-01", "2026-12-31").normMinutes), 1972);

  console.log("\nРежимы учёта времени");
  const freeUser = await plannerFor(staffUser({ workTimeMode: "free" }), "2026-05-01", "2026-05-31");
  check("свободный: план дня", freeUser.dayPlan("2026-05-13").kind, "unscheduled");
  check("свободный: норма месяца, ч", hours(freeUser.periodPlan("2026-05-01", "2026-05-31").normMinutes), 0);
  const noneUser = await plannerFor(staffUser({ workTimeMode: "none" }), "2026-05-01", "2026-05-31");
  check("не ведётся: рабочих дней", noneUser.periodPlan("2026-05-01", "2026-05-31").workingDays, 0);

  console.log(
    failures === 0
      ? "\nВсе проверки прошли"
      : `\nПРОВАЛЕНО проверок: ${failures}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) => {
  console.error("Проверка упала:", error);
  process.exitCode = 1;
});
