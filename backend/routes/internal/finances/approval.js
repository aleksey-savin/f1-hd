const Router = require("express");
const router = new Router();

const approvalController = require("@/controllers/finances/approval");
const isAuth = require("@/middleware/isAuth");
const { runValidation } = require("@/middleware/runValidation");
const approvalValidation = require("@/validations/finances/approval");

const {
  canUseWorkApproval,
  canConfirmReportActions,
} = require("@/middleware/permissions");

/**
 * «Согласование работ». Смонтирован под /api/approval, а НЕ под /api/finances:
 * последний закрыт `canUseFinancesModule`, которого у клиента нет и быть не
 * должно — согласующему со стороны заказчика финансовый модуль целиком не
 * нужен. Кто что видит внутри — services/reportApprovalScope.
 */

// Конвейер и карточка доступны обеим сторонам, объём режет скоуп
router.get("/pipeline", isAuth, canUseWorkApproval, approvalController.getPipeline);
router.get("/reports/:id", isAuth, canUseWorkApproval, approvalController.getReport);

// Карточка подбора — проверка состава ДО формирования отчёта. Только наша
// сторона: клиент в подборе не участвует.
router.get(
  "/preview/:companyId/:servicePlanId/:month",
  isAuth,
  canConfirmReportActions,
  approvalController.getPreviewCard,
);

// Работы вне услуг компании за месяц — чинятся прямо из конвейера
router.get(
  "/unrelated/:companyId/:month",
  isAuth,
  canConfirmReportActions,
  approvalController.getUnrelated,
);

// Формирование и повторная отправка — только наша сторона
router.post(
  "/reports",
  isAuth,
  canConfirmReportActions,
  approvalValidation.create,
  runValidation,
  approvalController.create,
);

router.post(
  "/reports/:id/resubmit",
  isAuth,
  canConfirmReportActions,
  approvalValidation.resubmit,
  runValidation,
  approvalController.resubmit,
);

// Движение после согласования — только наша сторона
router.post(
  "/reports/:id/invoice",
  isAuth,
  canConfirmReportActions,
  approvalValidation.invoice,
  runValidation,
  approvalController.invoice,
);
router.post(
  "/reports/:id/payment",
  isAuth,
  canConfirmReportActions,
  approvalValidation.payment,
  runValidation,
  approvalController.payment,
);
router.post(
  "/reports/:id/archive",
  isAuth,
  canConfirmReportActions,
  approvalController.archive,
);

// Решение клиента: право на вход общее, право на конкретную подпись проверяет
// скоуп внутри контроллера
router.post(
  "/reports/:id/decision",
  isAuth,
  canUseWorkApproval,
  approvalValidation.decision,
  runValidation,
  approvalController.decision,
);

module.exports = router;
