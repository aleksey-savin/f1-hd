// Подготовка данных под «Графики работы» (2026-07):
//   • заводит блок Preferences.productionCalendar со значениями по умолчанию;
//   • скачивает производственный календарь на текущий и следующий год, чтобы
//     первый же отчёт не ходил в сеть;
//   • печатает, у скольких сотрудников не задан личный график и часовой пояс —
//     пока они пустые, расчёт идёт по прежнему каскаду и польза нулевая.
//
// Идемпотентен: повторный запуск ничего не ломает (upsert календаря + гард на
// «блок уже есть»). Графики сотрудников САМ НЕ ЗАПОЛНЯЕТ — это решение о
// деньгах; для массового проставления дефолта есть явный флаг.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateWorkSchedules.js
//   node scripts/migrateWorkSchedules.js --seed-schedules   (+ дефолт 5/2 всем
//     активным сотрудникам без графика, часовой пояс не трогает)
require("module-alias/register");
const mongoose = require("mongoose");

const Preferences = require("../models/preferences");
const User = require("../models/user");
const { DEFAULT_OVERTIME_SCHEDULE } = require("../utils/overtimeDefaults");
const { syncCalendar, getHealth } = require("../services/productionCalendar");
const Absence = require("../models/absence");
const { getAbsenceType } = require("../utils/absenceTypes");

const seedSchedules = process.argv.includes("--seed-schedules");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  // 1. Блок настроек календаря
  const preferences = await Preferences.findOne({});
  if (!preferences) {
    console.log("Документ настроек не найден — создайте его в UI и повторите");
    await mongoose.disconnect();
    return;
  }

  if (!preferences.productionCalendar?.country) {
    preferences.productionCalendar = {
      isActive: true,
      country: "ru",
      source: "xmlcalendar",
      overrides: [],
    };
    await preferences.save();
    console.log("Настройки: блок productionCalendar заведён (Россия, xmlcalendar)");
  } else {
    console.log("Настройки: блок productionCalendar уже есть — не трогаю");
  }

  // 2. Перерыв в резервном графике. Он появился вместе с производственным
  // календарём: без него окно 09:00–18:00 даёт 9 часов, и норма никогда не
  // сойдётся с календарной (у мая было бы 170 ч вместо 151). Трогаем только
  // рабочие дни, у которых поля ещё нет, — повторный запуск ничего не меняет.
  const rawPrefs = await mongoose.connection.db
    .collection("preferences")
    .findOne({ _id: preferences._id });
  const rawWeek = rawPrefs?.overtime?.defaultSchedule ?? {};
  const needBreak = Object.entries(rawWeek).filter(
    ([, day]) => day?.isWorking && day.breakMinutes === undefined,
  );
  if (needBreak.length) {
    const patch = Object.fromEntries(
      needBreak.map(([name]) => [`overtime.defaultSchedule.${name}.breakMinutes`, 60]),
    );
    await mongoose.connection.db
      .collection("preferences")
      .updateOne({ _id: preferences._id }, { $set: patch });
    console.log(
      `Резервный график: перерыв 60 мин проставлен рабочим дням (${needBreak.map(([n]) => n).join(", ")})`,
    );
  } else {
    console.log("Резервный график: перерыв уже задан — не трогаю");
  }

  // 3. Календарь на текущий и следующий год
  const { results } = await syncCalendar();
  for (const item of results) {
    if (item.status === "failed") {
      // Календарь следующего года публикуется осенью — до этого 404 штатный
      console.log(`Календарь ${item.year}: не загрузился (${item.error})`);
    } else {
      console.log(`Календарь ${item.year}: ${item.status} из ${item.source}`);
    }
  }

  const health = await getHealth(await Preferences.findOne({}));
  for (const year of health.years) {
    console.log(
      `  ${year.year}: ${year.exceptions} дней-исключений, ` +
        `норма ${year.statistic?.hours40 ?? "?"} ч при ${year.statistic?.workdays ?? "?"} рабочих днях`,
    );
  }

  // 4. Графики → история версий, режим учёта времени
  const withLegacy = await mongoose.connection.db
    .collection("users")
    .find({ workSchedule: { $ne: null }, workSchedules: { $in: [null, []] } })
    .project({ workSchedule: 1, followProductionCalendar: 1 })
    .toArray();

  for (const doc of withLegacy) {
    await mongoose.connection.db.collection("users").updateOne(
      { _id: doc._id },
      {
        $set: {
          // effectiveFrom: null — «действует всегда»: когда график завели, мы
          // не знаем, а задним числом он всё равно был таким
          workSchedules: [
            {
              effectiveFrom: null,
              schedule: doc.workSchedule,
              followProductionCalendar: doc.followProductionCalendar !== false,
              createdBy: null,
              createdAt: new Date(),
            },
          ],
        },
      },
    );
  }
  console.log(
    withLegacy.length
      ? `Графики перенесены в историю версий: ${withLegacy.length}`
      : "Графики: истории версий уже заведены — не трогаю",
  );

  // hideWorkStatus заводился ровно под «сторонние сотрудники» — им и режим
  // «не ведётся»: в календаре команды их быть не должно
  const excluded = await User.updateMany(
    { hideWorkStatus: true, workTimeMode: { $exists: false } },
    { $set: { workTimeMode: "none" } },
  );
  const rest = await User.updateMany(
    { workTimeMode: { $exists: false } },
    { $set: { workTimeMode: "scheduled" } },
  );
  console.log(
    `Режим учёта: «не ведётся» — ${excluded.modifiedCount}, «по графику» — ${rest.modifiedCount}`,
  );

  // Пометка «кем поставлен статус». До неё автоматика узнавала ручной выбор по
  // времени, и это путало отменённое сегодня отсутствие с ручным статусом.
  // Задним числом различить можно только служебные коды: их ставил автомат.
  // Отсутствующий код — это тот же «не указан» по умолчанию схемы, он тоже
  // автоматический: иначе автомат счёл бы его ручным и никогда не тронул
  const autoMarked = await User.updateMany(
    {
      "workStatus.auto": { $exists: false },
      $or: [
        { "workStatus.code": { $in: ["offshift", "unset"] } },
        { "workStatus.code": { $exists: false } },
        { "workStatus.code": null },
      ],
    },
    { $set: { "workStatus.auto": true } },
  );
  // Отпуск и больничный, совпадающие с активной подтверждённой заявкой, ставил
  // автомат (ночная синхронизация) — иначе они застрянут: «ручной» статус
  // держится до конца суток, и снять его в день отмены заявки будет некому
  const todayKey = new Date().toISOString().slice(0, 10);
  const activeAbsences = await Absence.find({
    status: "approved",
    from: { $lte: new Date(`${todayKey}T00:00:00.000Z`) },
    to: { $gte: new Date(`${todayKey}T00:00:00.000Z`) },
  })
    .select("user type")
    .lean();
  let byAbsence = 0;
  for (const absence of activeAbsences) {
    const code = getAbsenceType(absence.type)?.workStatus;
    if (!code) continue;
    const result = await User.updateOne(
      { _id: absence.user, "workStatus.auto": { $exists: false }, "workStatus.code": code },
      { $set: { "workStatus.auto": true } },
    );
    byAbsence += result.modifiedCount;
  }

  const manualMarked = await User.updateMany(
    { "workStatus.auto": { $exists: false } },
    { $set: { "workStatus.auto": false } },
  );
  console.log(
    `Пометка статуса: автоматических — ${autoMarked.modifiedCount + byAbsence} ` +
      `(из них по активным отсутствиям — ${byAbsence}), ручных — ${manualMarked.modifiedCount}`,
  );

  // 5. Что осталось заполнить руками
  const staff = { isEndUser: false, isServiceAccount: { $ne: true }, isActive: true };
  const [total, noSchedule, noTimezone] = await Promise.all([
    User.countDocuments(staff),
    User.countDocuments({ ...staff, workSchedules: { $in: [null, []] } }),
    User.countDocuments({ ...staff, $or: [{ timezone: null }, { timezone: "" }] }),
  ]);
  console.log(
    `\nАктивных сотрудников: ${total}. Без личного графика: ${noSchedule}. ` +
      `Без часового пояса: ${noTimezone} (берут пояс организации).`,
  );

  if (seedSchedules && noSchedule > 0) {
    const result = await User.updateMany(
      { ...staff, workSchedules: { $in: [null, []] } },
      {
        $set: {
          workSchedules: [
            {
              effectiveFrom: null,
              schedule: DEFAULT_OVERTIME_SCHEDULE,
              followProductionCalendar: true,
              createdBy: null,
              createdAt: new Date(),
            },
          ],
        },
      },
    );
    console.log(
      `Проставлен дефолт 5/2 09:00–18:00 (перерыв 60 мин): ${result.modifiedCount} сотрудников`,
    );
  } else if (noSchedule > 0) {
    console.log(
      "Запустите с --seed-schedules, чтобы проставить им дефолт 5/2 09:00–18:00, " +
        "или задайте графики в карточках вручную.",
    );
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Миграция упала:", error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
