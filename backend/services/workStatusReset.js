const User = require("../models/user");
const Absence = require("../models/absence");
const Preferences = require("../models/preferences");
const logger = require("../utils/logger");
const { LONG_LIVED_WORK_STATUSES } = require("../utils/workStatuses");
const { getAbsenceType } = require("../utils/absenceTypes");
const {
  dayKey,
  dayKeyToUtcMidnight,
  resolveTimezone,
} = require("../utils/datetime");

/**
 * Присутствие по подтверждённым отсутствиям. Раньше «отпуск» и «болею» висели,
 * пока сотрудник сам их не снимет (ночной сброс их намеренно не трогает) — а
 * теперь у отсутствия есть даты, и статус можно вести автоматически:
 * утром первого дня поставить, утром после последнего — снять.
 *
 * Сегодняшний день берётся по настенным часам организации: в UTC контейнера
 * «сегодня» для восточных поясов наступает на сутки позже.
 */
const syncStatusesWithAbsences = async (staffFilter) => {
  const preferences = await Preferences.findOne({}).lean();
  const tz = resolveTimezone(preferences);
  const today = dayKeyToUtcMidnight(dayKey(new Date(), tz));

  const active = await Absence.find({
    status: "approved",
    from: { $lte: today },
    to: { $gte: today },
  })
    .select("user type")
    .lean();

  const wanted = new Map();
  for (const absence of active) {
    const meta = getAbsenceType(absence.type);
    if (meta?.workStatus) {
      // Заметка называет тип: «отсутствует» общий у отгула и дней без
      // содержания и сам по себе ничего не говорит
      wanted.set(absence.user.toString(), { code: meta.workStatus, note: meta.label });
    }
  }

  let applied = 0;
  for (const [userId, { code, note }] of wanted) {
    const result = await User.updateOne(
      { _id: userId, ...staffFilter, "workStatus.code": { $ne: code } },
      { $set: { workStatus: { code, note, updatedAt: new Date(), auto: true } } },
    );
    applied += result.modifiedCount;
  }

  // Отсутствие кончилось — снимаем долгий статус, который иначе висел бы вечно.
  // В 2:30 человек заведомо не на работе, поэтому «не на работе», а не «не
  // указан»; через пять минут автомат по графику поправит, если смена началась.
  const released = await User.updateMany(
    {
      ...staffFilter,
      workTimeMode: { $nin: ["free", "none"] },
      _id: { $nin: [...wanted.keys()] },
      "workStatus.code": { $in: [...LONG_LIVED_WORK_STATUSES] },
    },
    { $set: { workStatus: { code: "offshift", note: "", updatedAt: new Date(), auto: true } } },
  );

  const releasedFree = await User.updateMany(
    {
      ...staffFilter,
      workTimeMode: { $in: ["free", "none"] },
      _id: { $nin: [...wanted.keys()] },
      "workStatus.code": { $in: [...LONG_LIVED_WORK_STATUSES] },
    },
    { $set: { workStatus: { code: "unset", note: "", updatedAt: new Date(), auto: true } } },
  );

  return {
    applied,
    released: released.modifiedCount + releasedFree.modifiedCount,
  };
};

// Ночной сброс статусов присутствия: всё, кроме longLived (отпуск, болею),
// возвращается в «не на работе» (у свободного режима — в «не указан»), заметка
// чистится — утром табло и бар не врут вчерашними статусами. Днём статусы
// ведёт services/workStatusAuto по графику. Выполняется независимо от
// statusBoard.isActive: устаревший статус вреден и в вебе.
const runWorkStatusReset = async () => {
  const staffFilter = {
    isActive: true,
    isEndUser: false,
    isServiceAccount: false,
    isCloudTelephony: false,
  };

  // Штатных ночь возвращает в «не на работе» — это правда про 2:30; «не указан»
  // остаётся тем, чьё время не ведётся по графику (свободные и исключённые).
  const settled = [...LONG_LIVED_WORK_STATUSES, "unset", "offshift"];

  const resetScheduled = await User.updateMany(
    {
      ...staffFilter,
      workTimeMode: { $nin: ["free", "none"] },
      "workStatus.code": { $nin: settled },
    },
    {
      $set: {
        workStatus: { code: "offshift", note: "", updatedAt: new Date(), auto: true },
      },
    },
  );

  const resetFree = await User.updateMany(
    {
      ...staffFilter,
      workTimeMode: { $in: ["free", "none"] },
      "workStatus.code": { $nin: settled },
    },
    {
      $set: {
        workStatus: { code: "unset", note: "", updatedAt: new Date(), auto: true },
      },
    },
  );

  const result = {
    modifiedCount: resetScheduled.modifiedCount + resetFree.modifiedCount,
  };

  // Хвост: осиротевшие заметки у «не указан» (после ручных правок в БД)
  const notes = await User.updateMany(
    {
      ...staffFilter,
      "workStatus.code": { $in: ["unset", "offshift"] },
      "workStatus.note": { $nin: ["", null] },
    },
    { $set: { "workStatus.note": "" } },
  );

  // После сброса — расставить статусы по активным отсутствиям и снять те,
  // чьё отсутствие уже закончилось
  const absences = await syncStatusesWithAbsences(staffFilter);

  if (
    result.modifiedCount > 0 ||
    notes.modifiedCount > 0 ||
    absences.applied > 0 ||
    absences.released > 0
  ) {
    logger.log("info", "Work statuses nightly reset", {
      reset: result.modifiedCount,
      notesCleared: notes.modifiedCount,
      absenceApplied: absences.applied,
      absenceReleased: absences.released,
    });
  }
};

module.exports = { runWorkStatusReset };
