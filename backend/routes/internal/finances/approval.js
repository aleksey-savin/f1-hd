const Router = require("express");
const router = new Router();

const approvalController = require("@/controllers/finances/approval");
const isAuth = require("@/middleware/isAuth");
const { runValidation } = require("@/middleware/runValidation");
const approvalValidation = require("@/validations/finances/approval");

const {
  canOpenApproval,
  canManageApproval,
} = require("@/middleware/permissions");

/**
 * «Согласование работ». Смонтирован под /api/approval, а НЕ под /api/finances:
 * последний закрыт `canReadServicePlans`, которого у клиента нет и быть не
 * должно — согласующему со стороны заказчика финансовый модуль целиком не
 * нужен. Кто что видит внутри — services/reportApprovalScope.
 */

// Конвейер и карточка доступны обеим сторонам, объём режет скоуп
router.get("/pipeline", isAuth, canOpenApproval, approvalController.getPipeline);
router.get("/reports/:id", isAuth, canOpenApproval, approvalController.getReport);

// Карточка подбора — проверка состава ДО формирования отчёта. Только наша
// сторона: клиент в подборе не участвует.
router.get(
  "/preview/:companyId/:servicePlanId/:month",
  isAuth,
  canManageApproval,
  approvalController.getPreviewCard,
);

// Работы вне услуг компании за месяц — чинятся прямо из конвейера
router.get(
  "/unrelated/:companyId/:month",
  isAuth,
  canManageApproval,
  approvalController.getUnrelated,
);

// Формирование и повторная отправка — только наша сторона
router.post(
  "/reports",
  isAuth,
  canManageApproval,
  approvalValidation.create,
  runValidation,
  approvalController.create,
);

router.post(
  "/reports/:id/resubmit",
  isAuth,
  canManageApproval,
  approvalValidation.resubmit,
  runValidation,
  approvalController.resubmit,
);

// Движение после согласования — только наша сторона
router.post(
  "/reports/:id/invoice",
  isAuth,
  canManageApproval,
  approvalValidation.invoice,
  runValidation,
  approvalController.invoice,
);
router.post(
  "/reports/:id/payment",
  isAuth,
  canManageApproval,
  approvalValidation.payment,
  runValidation,
  approvalController.payment,
);
router.post(
  "/reports/:id/archive",
  isAuth,
  canManageApproval,
  approvalController.archive,
);

// Решение клиента: право на вход общее, право на конкретную подпись проверяет
// скоуп внутри контроллера
router.post(
  "/reports/:id/decision",
  isAuth,
  canOpenApproval,
  approvalValidation.decision,
  runValidation,
  approvalController.decision,
);

module.exports = router;
