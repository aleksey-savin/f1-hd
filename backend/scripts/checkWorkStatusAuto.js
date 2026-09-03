// Самопроверка автостатусов по графику: без БД и без сети.
// Проверяет главное правило — «ручной выбор держится до конца дня»:
// утром автомат трогает только offshift/unset, вечером гасит только тот
// рабочий статус, который не меняли уже после окончания смены.
//
// Запуск:  node scripts/checkWorkStatusAuto.js
require("module-alias/register");

const bundled = require("../data/production-calendar/ru-2026.json");
const ProductionCalendar = require("../models/productionCalendar");
ProductionCalendar.findOne = () => ({ lean: async () => bundled });

const Absence = require("../models/absence");
let ABSENCES = [];
Absence.find = () => ({ select: () => ({ lean: async () => ABSENCES }) });
// Подтверждённое отсутствие на весь день 27 июля
const absence = (type, user = "u1") => ({
  user,
  type,
  status: "approved",
  from: new Date("2026-07-27T00:00:00.000Z"),
  to: new Date("2026-07-27T00:00:00.000Z"),
});

const Preferences = require("../models/preferences");
Preferences.findOne = () => ({ lean: async () => ({ timezone: "Europe/Moscow" }) });

const User = require("../models/user");
let STAFF = [];
const WRITES = [];
User.find = () => ({ select: () => ({ lean: async () => STAFF }) });
User.updateOne = async (filter, update) => {
  // Ближайшая смена пишется отдельным $set — к статусам не относится
  if (!update.$set.workStatus) return { modifiedCount: 1 };
  WRITES.push({
    id: String(filter._id),
    code: update.$set.workStatus.code,
    note: update.$set.workStatus.note,
  });
  return { modifiedCount: 1 };
};

const { runWorkStatusAuto } = require("../services/workStatusAuto");

const WEEK = (() => {
  const day = { isWorking: true, is24hours: false, start: "09:00", end: "18:00", breakMinutes: 60 };
  const rest = { isWorking: false, is24hours: false, start: "09:00", end: "18:00", breakMinutes: 0 };
  return { Monday: day, Tuesday: day, Wednesday: day, Thursday: day, Friday: day, Saturday: rest, Sunday: rest };
})();

const person = (over = {}) => ({
  _id: over._id || "u1",
  timezone: "Europe/Moscow",
  workTimeMode: "scheduled",
  remoteOnly: false,
  workSchedules: [{ effectiveFrom: null, schedule: WEEK, followProductionCalendar: true }],
  workStatus: { code: "offshift", note: "", updatedAt: new Date("2026-07-27T02:30:00Z") },
  ...over,
});

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}: ${actual ?? "—"}${ok ? "" : ` (ждали ${expected ?? "—"})`}`);
};

// Понедельник 27 июля 2026, время московское → UTC = −3ч
const at = (hhmm) => new Date(`2026-07-27T${hhmm}:00.000Z`);

const run = async (staff, now, absences = []) => {
  STAFF = staff;
  ABSENCES = absences;
  WRITES.length = 0;
  await runWorkStatusAuto({ now });
  return WRITES[0]?.code ?? null;
};
const runNote = async (staff, now, absences = []) => {
  await run(staff, now, absences);
  return WRITES[0]?.note ?? null;
};

(async () => {
  console.log("Смена 09:00–18:00 по Москве, понедельник");

  check("08:30 — до смены, ничего не меняем", await run([person()], at("05:30")), null);
  check("09:05 — начало смены → в офисе", await run([person()], at("06:05")), "office");
  check("09:05 у remoteOnly → на удалёнке",
    await run([person({ remoteOnly: true })], at("06:05")), "remote");

  console.log("\nРучной выбор держится до конца дня");
  const manualRemote = person({
    workStatus: { code: "remote", note: "", updatedAt: at("07:20") },
  });
  check("13:00 — ручную удалёнку не трогаем", await run([manualRemote], at("10:00")), null);
  check("18:05 — рабочий статус гаснет", await run([manualRemote], at("15:05")), "offshift");

  const setAfterShift = person({
    workStatus: { code: "trip", note: "", updatedAt: at("15:40") },
  });
  check("статус, поставленный в 18:40, доживает до ночи",
    await run([setAfterShift], at("16:00")), null);

  console.log("\nРежимы и отсутствия");
  check("свободный режим автоматика не трогает",
    await run([person({ workTimeMode: "free", workStatus: { code: "unset", updatedAt: at("02:30") } })], at("06:05")),
    null);
  check("в отпуске начало смены не срабатывает",
    await run(
      [person({ workStatus: { code: "vacation", note: "", updatedAt: at("02:30") } })],
      at("06:05"),
      [absence("vacation")],
    ),
    null);

  // Ради этого всё и затевалось: согласовали отгул — статус меняется сразу,
  // а не в ночном прогоне. Раньше человек оставался «в офисе»
  check("согласованный отгул гасит «в офисе»",
    await run(
      [person({ workStatus: { code: "office", note: "", updatedAt: at("06:05") } })],
      at("10:00"),
      [absence("dayoff")],
    ),
    "offshift");
  check("заметка называет тип отсутствия",
    await runNote(
      [person({ workStatus: { code: "office", note: "", updatedAt: at("06:05") } })],
      at("10:00"),
      [absence("dayoff")],
    ),
    "Отгул");
  check("день без содержания — тоже «не на работе»",
    await run([person({ workStatus: { code: "office", updatedAt: at("06:05") } })], at("10:00"),
      [absence("unpaid")]),
    "offshift");
  check("отпуск поверх рабочего статуса",
    await run([person({ workStatus: { code: "office", updatedAt: at("06:05") } })], at("10:00"),
      [absence("vacation")]),
    "vacation");
  // Командировка — рабочий статус: подменяет «в офисе» на старте смены…
  check("командировка вместо «в офисе» на старте смены",
    await run([person({ workStatus: { code: "offshift", updatedAt: at("02:30") } })], at("06:05"),
      [absence("trip")]),
    "trip");
  // …но среди дня выбор не перебивает: на обед в командировке имеет право
  check("обед в командировке не перебивается",
    await run([person({ workStatus: { code: "lunch", updatedAt: at("09:00") } })], at("10:00"),
      [absence("trip")]),
    null);
  check("обучение статус не трогает (человек работает)",
    await run([person({ workStatus: { code: "office", updatedAt: at("06:05") } })], at("10:00"),
      [absence("training")]),
    null);
  check("отгул действует и при свободном графике",
    await run([person({ workTimeMode: "free", workStatus: { code: "remote", updatedAt: at("06:05") } })],
      at("10:00"), [absence("dayoff")]),
    "offshift");
  // Статус проставлен при согласовании накануне, отсутствие кончилось в полночь
  check("отгул кончился — на смене снова «в офисе»",
    await run(
      [person({
        workStatus: { code: "offshift", note: "Отгул", updatedAt: new Date("2026-07-24T09:00:00.000Z"), auto: true },
      })],
      at("10:00"),
    ),
    "office");
  check("ручной «не на работе» (форс-мажор) на смене держится",
    await run(
      [person({ workStatus: { code: "offshift", note: "вернусь к 15:00", updatedAt: at("09:00"), auto: false } })],
      at("10:00"),
    ),
    null);
  check("форс-мажорный больничный, поставленный сегодня, держится",
    await run([person({ workStatus: { code: "sick", note: "", updatedAt: at("06:40") } })], at("10:00")),
    null);
  // Пятничный хвост в субботу гаснет…
  check("суббота: вчерашний рабочий статус гаснет",
    await run(
      [person({ workStatus: { code: "office", note: "", updatedAt: new Date("2026-07-24T06:05:00.000Z") } })],
      new Date("2026-07-25T10:00:00.000Z"),
    ),
    "offshift");
  // …а осознанный выход в выходной — нет: человек сам поставил статус сегодня
  check("суббота: сегодняшний статус не трогаем",
    await run(
      [person({ workStatus: { code: "office", note: "", updatedAt: new Date("2026-07-25T02:00:00.000Z") } })],
      new Date("2026-07-25T10:00:00.000Z"),
    ),
    null);

  console.log("\nПометка «поставлен автоматически»");
  // Ради чего флаг и заведён: отпуск сняли в тот же день, статус его пережил
  // бы — «поставлен сегодня» неотличимо от ручного без пометки
  check("автоматический отпуск снимается в день отмены заявки",
    await run([person({
      workStatus: { code: "vacation", note: "Отпуск", updatedAt: at("06:10"), auto: true },
    })], at("10:00")),
    "offshift");
  check("ручной статус в начале смены не перебивается",
    await run([person({
      workStatus: { code: "lunch", note: "", updatedAt: at("02:30"), auto: false },
    })], at("06:05")),
    null);
  check("автоматический статус в начале смены обновляется",
    await run([person({
      workStatus: { code: "offshift", note: "", updatedAt: at("02:30"), auto: true },
    })], at("06:05")),
    "office");
  check("автоматический «в офисе» повторно не переписывается",
    await run([person({
      workStatus: { code: "office", note: "", updatedAt: at("06:05"), auto: true },
    })], at("10:00")),
    null);

  console.log(failures === 0 ? "\nВсе проверки прошли" : `\nПРОВАЛЕНО: ${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
