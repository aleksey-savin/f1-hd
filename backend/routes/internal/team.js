const Router = require("express");
const router = new Router();

const scheduleController = require("@/controllers/team/schedule");
const absenceController = require("@/controllers/absence");
const isAuth = require("@/middleware/isAuth");

const { runValidation } = require("@/middleware/runValidation");
const teamValidation = require("@/validations/team");

const {
  isNotClient,
  isAdmin,
  canManageWorkSchedules,
} = require("@/middleware/permissions");

// Табель и графики — смотреть может любой сотрудник: знать, кто когда работает
// и кто в отпуске, полезно всем. Менять — только с правом.
router.get(
  "/schedule",
  isAuth,
  isNotClient,
  teamValidation.teamSchedule,
  runValidation,
  scheduleController.getSchedule,
);

router.get(
  "/schedule/:userId",
  isAuth,
  isNotClient,
  teamValidation.userSchedule,
  runValidation,
  scheduleController.getUserSchedule,
);

router.get(
  "/production-calendar",
  isAuth,
  isNotClient,
  scheduleController.getProductionCalendar,
);

router.post(
  "/production-calendar/sync",
  isAuth,
  isAdmin,
  scheduleController.syncProductionCalendar,
);

// ── отсутствия ──────────────────────────────────────────────────────────
router.get(
  "/absences",
  isAuth,
  isNotClient,
  teamValidation.absenceList,
  runValidation,
  absenceController.getAll,
);

router.get(
  "/absences/impact",
  isAuth,
  isNotClient,
  teamValidation.absenceImpact,
  runValidation,
  absenceController.impact,
);

// Своё отсутствие сотрудник заводит сам (уйдёт на согласование), чужое —
// только с правом; разделение внутри контроллера, поэтому гейта права тут нет
router.post(
  "/absences",
  isAuth,
  isNotClient,
  teamValidation.absenceAdd,
  runValidation,
  absenceController.add,
);

router.post(
  "/absences/:id/decision",
  isAuth,
  canManageWorkSchedules,
  teamValidation.absenceDecision,
  runValidation,
  absenceController.decide,
);

// Отозвать может заявитель (проверка владения — в контроллере)
router.post("/absences/:id/cancel", isAuth, isNotClient, absenceController.cancel);

router.post(
  "/absences/delete/:id",
  isAuth,
  canManageWorkSchedules,
  absenceController.delete,
);

module.exports = router;
