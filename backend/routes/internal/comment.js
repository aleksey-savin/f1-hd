const Router = require("express");
const router = new Router();
const commentController = require("@/controllers/comment");
const isAuth = require("@/middleware/isAuth");
const fileUpload = require("@/middleware/fileUpload");
const {
  canPerformTickets,
  requireTicketAccess,
} = require("@/middleware/permissions");

const { runValidation } = require("@/middleware/runValidation");
const commentValidation = require("@/validations/comment");

// `:ticketNum` здесь на самом деле `_id` заявки — имя параметра историческое.
router.get(
  "/comments/:ticketNum",
  isAuth,
  requireTicketAccess((req) => ({ id: req.params.ticketNum })),
  commentController.getAll,
);

router.post(
  "/comments/add",
  isAuth,
  fileUpload.array("attachments"),
  commentValidation.add,
  runValidation,
  commentController.add,
);

router.post(
  "/comments/add-multiple",
  isAuth,
  canPerformTickets,
  commentController.addMultiple,
);

module.exports = router;
