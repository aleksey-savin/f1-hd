const Router = require("express");
const router = new Router();
const categoryController = require("../controllers/ticketCategory");
const isAuth = require("../middleware/isAuth");
const { canManageTicketCategories } = require("../middleware/permissions");

router.get(
  "/ticket-categories",
  isAuth,
  canManageTicketCategories,
  categoryController.getAll,
);
router.get(
  "/ticket-categories/:id",
  isAuth,
  canManageTicketCategories,
  categoryController.getOne,
);

router.post(
  "/ticket-categories/add",
  isAuth,
  canManageTicketCategories,
  categoryController.add,
);
router.post(
  "/ticket-categories/update/:id",
  isAuth,
  canManageTicketCategories,
  categoryController.update,
);
router.post(
  "/ticket-categories/delete/:id",
  isAuth,
  canManageTicketCategories,
  categoryController.delete,
);

module.exports = router;
