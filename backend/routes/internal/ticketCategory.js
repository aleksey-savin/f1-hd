const Router = require("express");
const router = new Router();
const categoryController = require("@/controllers/ticketCategory");
const isAuth = require("@/middleware/isAuth");
const {
  canManageTicketCategories,
  isNotClient,
} = require("@/middleware/permissions");

// Список и карточка категории нужны и разделу «Категории», и выпадающему
// списку в форме заявки/шаблона — там право не требуется вовсе, поэтому чтение
// открыто любому сотруднику. Раздел закрыт правом на фронте (`handle.can` /
// `util/sections`), а не здесь.
router.get(
  "/ticket-categories",
  isAuth,
  isNotClient,
  categoryController.getAll,
);
router.get(
  "/ticket-categories/:id",
  isAuth,
  isNotClient,
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
