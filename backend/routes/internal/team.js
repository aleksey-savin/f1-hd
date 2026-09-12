const Router = require("express");
const router = new Router();

const scheduleController = require("@/controllers/team/schedule");
const absenceController = require("@/controllers/absence");
const isAuth = require("@/middleware/isAuth");

const { runValidation } = require("@/middleware/runValidation");
const teamValidation = require("@/validations/team");

const {
  canReadSchedule,
  canManageSchedules,
  canApproveAbsences,
  canManageSettings,
} = require("@/middleware/permissions");

// Табель и графики — смотреть может любой сотрудник: знать, кто когда работает
// и кто в отпуске, полезно всем, и право «Календарь команды» есть у каждой роли
// сотрудника. Свой график и свои отсутствия — без права; чужие — `schedule.read`,
// проверка внутри контроллера. Менять график — своё право, решать по
// отсутствию — ещё одно: согласующий не обязан уметь править чужие расписания.
router.get(
  "/schedule",
  isAuth,
  canReadSchedule,
  teamValidation.teamSchedule,
  runValidation,
  scheduleController.getSchedule,
);

router.get(
  "/schedule/:userId",
  isAuth,
  teamValidation.userSchedule,
  runValidation,
  scheduleController.getUserSchedule,
);

router.get(
  "/production-calendar",
  isAuth,
  canReadSchedule,
  scheduleController.getProductionCalendar,
);

router.post(
  "/production-calendar/sync",
  isAuth,
  canManageSettings,
  scheduleController.syncProductionCalendar,
);

// ── отсутствия ──────────────────────────────────────────────────────────
router.get(
  "/absences",
  isAuth,
  teamValidation.absenceList,
  runValidation,
  absenceController.getAll,
);

router.get(
  "/absences/impact",
  isAuth,
  teamValidation.absenceImpact,
  runValidation,
  absenceController.impact,
);

// Своё отсутствие сотрудник заводит сам (уйдёт на согласование), чужое —
// только с правом; разделение внутри контроллера, поэтому гейта права тут нет
router.post(
  "/absences",
  isAuth,
  teamValidation.absenceAdd,
  runValidation,
  absenceController.add,
);

router.post(
  "/absences/:id/decision",
  isAuth,
  canApproveAbsences,
  teamValidation.absenceDecision,
  runValidation,
  absenceController.decide,
);

// Отозвать может заявитель (проверка владения — в контроллере)
router.post(
  "/absences/:id/cancel",
  isAuth,
  absenceController.cancel,
);

router.post(
  "/absences/delete/:id",
  isAuth,
  canManageSchedules,
  absenceController.delete,
);

module.exports = router;
