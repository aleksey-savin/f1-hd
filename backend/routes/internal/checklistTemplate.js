const Router = require("express");
const router = new Router();
const controller = require("@/controllers/checklistTemplate");
const isAuth = require("@/middleware/isAuth");
const {
  canManageChecklistTemplates,
  isNotClient,
} = require("@/middleware/permissions");

// Читать справочник нужно всем, кто заполняет чек-лист в заявке (список «Ещё
// чек-листы» и «Взять шаблон»), поэтому право не требуется — только «не
// клиент». Править — тем же, кто правит шаблоны заявок.
router.get("/checklist-templates", isAuth, isNotClient, controller.getAll);
router.get(
  "/checklist-templates/form-data",
  isAuth,
  canManageChecklistTemplates,
  controller.getFormData,
);
router.get(
  "/checklist-templates/for-ticket/:ticketNum",
  isAuth,
  isNotClient,
  controller.forTicket,
);
router.get(
  "/checklist-templates/:id",
  isAuth,
  isNotClient,
  controller.getOne,
);

router.post(
  "/checklist-templates/add",
  isAuth,
  canManageChecklistTemplates,
  controller.add,
);
router.post(
  "/checklist-templates/update/:id",
  isAuth,
  canManageChecklistTemplates,
  controller.update,
);
router.post(
  "/checklist-templates/delete/:id",
  isAuth,
  canManageChecklistTemplates,
  controller.delete,
);

module.exports = router;
