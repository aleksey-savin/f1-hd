const { body, query, param } = require("express-validator");

const { ABSENCE_TYPE_CODES, ABSENCE_STATUSES } = require("../utils/absenceTypes");
const { isWeekSchedule } = require("./workSchedule");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.teamSchedule = [
  query("from").matches(DATE_RE).withMessage("Некорректная дата начала"),
  query("to").matches(DATE_RE).withMessage("Некорректная дата окончания"),
  query("company").optional({ values: "falsy" }).isMongoId(),
  query("subdivision").optional({ values: "falsy" }).isMongoId(),
  query("search").optional({ values: "falsy" }).isLength({ max: 60 }),
];

exports.userSchedule = [
  param("userId").isMongoId().withMessage("Некорректный идентификатор сотрудника"),
  query("from").matches(DATE_RE).withMessage("Некорректная дата начала"),
  query("to").matches(DATE_RE).withMessage("Некорректная дата окончания"),
];

// Тот же блок графика, но вложенным полем `workSchedule` — им форма
// пользователя правит график вместе с остальными полями (add/update).
// Поля графика в теле нет — вся цепочка optional, остальное не трогаем.
exports.workScheduleBlock = [
  body("workSchedule.timezone")
    .optional({ nullable: true })
    .isLength({ max: 64 })
    .withMessage("Некорректный часовой пояс"),
  body("workSchedule.followProductionCalendar").optional().isBoolean(),
  body("workSchedule.effectiveFrom")
    .optional({ nullable: true, values: "falsy" })
    .matches(DATE_RE)
    .withMessage("Некорректная дата начала действия графика"),
  body("workSchedule.workTimeMode")
    .optional()
    .isIn(["scheduled", "free", "none"])
    .withMessage("Неизвестный режим учёта рабочего времени"),
  body("workSchedule.remoteOnly").optional().isBoolean(),
  body("workSchedule.schedule")
    .optional({ nullable: true })
    .custom((value) => (value === null ? true : isWeekSchedule(value))),
];

exports.updateWorkSchedule = [
  param("id").isMongoId().withMessage("Некорректный идентификатор сотрудника"),
  // Пустая строка = «взять пояс организации»
  body("timezone")
    .optional({ nullable: true })
    .isLength({ max: 64 })
    .withMessage("Некорректный часовой пояс"),
  body("followProductionCalendar").optional().isBoolean(),
  body("effectiveFrom")
    .optional({ nullable: true, values: "falsy" })
    .matches(DATE_RE)
    .withMessage("Некорректная дата начала действия графика"),
  body("workTimeMode")
    .optional()
    .isIn(["scheduled", "free", "none"])
    .withMessage("Неизвестный режим учёта рабочего времени"),
  body("remoteOnly").optional().isBoolean(),
  body("schedule").optional({ nullable: true }).custom((value) =>
    value === null ? true : isWeekSchedule(value),
  ),
];

exports.absenceList = [
  query("from").optional({ values: "falsy" }).matches(DATE_RE),
  query("to").optional({ values: "falsy" }).matches(DATE_RE),
  query("status").optional({ values: "falsy" }).isIn(ABSENCE_STATUSES),
  query("user").optional({ values: "falsy" }).isMongoId(),
];

exports.absenceAdd = [
  body("user").optional({ values: "falsy" }).isMongoId(),
  body("type").isIn(ABSENCE_TYPE_CODES).withMessage("Неизвестный тип отсутствия"),
  body("from").matches(DATE_RE).withMessage("Некорректная дата начала"),
  body("to").matches(DATE_RE).withMessage("Некорректная дата окончания"),
  body("comment").optional({ values: "falsy" }).isLength({ max: 300 }),
];

exports.absenceDecision = [
  param("id").isMongoId(),
  body("decision").isIn(["approve", "reject"]).withMessage("Неизвестное решение"),
  body("comment").optional({ values: "falsy" }).isLength({ max: 300 }),
];

exports.absenceImpact = [
  query("user").isMongoId(),
  query("from").matches(DATE_RE),
  query("to").matches(DATE_RE),
];
