const Router = require("express");
const router = new Router();
const ticketTemplateController = require("@/controllers/ticketTemplate");
const isAuth = require("@/middleware/isAuth");

router.get("/ticket-templates", isAuth, ticketTemplateController.getAll);
router.get("/ticket-templates/:id", isAuth, ticketTemplateController.getOne);
router.post("/ticket-templates/add", isAuth, ticketTemplateController.add);
router.post(
  "/ticket-templates/update/:id",
  isAuth,
  ticketTemplateController.update,
);
router.post(
  "/ticket-templates/:id/checklist",
  isAuth,
  ticketTemplateController.updateChecklist,
);
router.post(
  "/ticket-templates/:id/sync-routines",
  isAuth,
  ticketTemplateController.syncRoutines,
);
router.post(
  "/ticket-templates/delete/:id",
  isAuth,
  ticketTemplateController.delete,
);

module.exports = router;
