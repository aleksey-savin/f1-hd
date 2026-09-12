const Router = require("express");
const router = new Router();

const approvalController = require("@/controllers/finances/approval");
const isAuth = require("@/middleware/isAuth");
const { runValidation } = require("@/middleware/runValidation");
const approvalValidation = require("@/validations/finances/approval");

const {
  canReadApproval,
  canDecideApproval,
  canManageApproval,
} = require("@/middleware/permissions");

/**
 * «Согласование работ». Смонтирован под /api/approval, а НЕ под /api/finances:
 * раздел собран отдельным роутером со своими правами (`canReadApproval`/
 * `canManageApproval`), и согласующему со стороны заказчика права на
 * финансовый модуль (услуги и тарифы) не нужны. Кто что видит внутри —
 * services/reportApprovalScope.
 */

// Конвейер и карточка доступны обеим сторонам, объём режет скоуп
router.get("/pipeline", isAuth, canReadApproval, approvalController.getPipeline);
router.get("/reports/:id", isAuth, canReadApproval, approvalController.getReport);

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

// Право на вход — read, право подписи — decide; чью именно подпись ждёт
// отчёт, решает скоуп внутри контроллера
router.post(
  "/reports/:id/decision",
  isAuth,
  canReadApproval,
  canDecideApproval,
  approvalValidation.decision,
  runValidation,
  approvalController.decision,
);

module.exports = router;
