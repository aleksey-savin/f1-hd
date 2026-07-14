const User = require("../models/user");
const logger = require("../utils/logger");
const { LONG_LIVED_WORK_STATUSES } = require("../utils/workStatuses");

// Ночной сброс статусов присутствия: всё, кроме longLived (отпуск, болею),
// возвращается в «не указан», заметка чистится — утром табло и бар не врут
// вчерашними статусами. Выполняется независимо от statusBoard.isActive:
// устаревший статус вреден и в вебе.
const runWorkStatusReset = async () => {
  const staffFilter = {
    isActive: true,
    isEndUser: false,
    isServiceAccount: false,
    isCloudTelephony: false,
  };

  const result = await User.updateMany(
    {
      ...staffFilter,
      "workStatus.code": { $nin: [...LONG_LIVED_WORK_STATUSES, "unset"] },
    },
    {
      $set: {
        workStatus: { code: "unset", note: "", updatedAt: new Date() },
      },
    },
  );

  // Хвост: осиротевшие заметки у «не указан» (после ручных правок в БД)
  const notes = await User.updateMany(
    {
      ...staffFilter,
      "workStatus.code": "unset",
      "workStatus.note": { $nin: ["", null] },
    },
    { $set: { "workStatus.note": "" } },
  );

  if (result.modifiedCount > 0 || notes.modifiedCount > 0) {
    logger.log("info", "Work statuses nightly reset", {
      reset: result.modifiedCount,
      notesCleared: notes.modifiedCount,
    });
  }
};

module.exports = { runWorkStatusReset };
