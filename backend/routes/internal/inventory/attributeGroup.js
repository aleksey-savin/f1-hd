const Router = require("express");
const router = new Router();
const attributeGroupController = require("@/controllers/inventory/attributeGroup");
const isAuth = require("@/middleware/isAuth");
const { canManageInventoryCatalog } = require("@/middleware/permissions");

// Группы атрибутов каталога. Читать может любой сотрудник (модуль и личность
// проверены на монтировании), править — canManageInventoryCatalog.

router.get("/attribute-groups", isAuth, attributeGroupController.getAll);

router.post(
  "/attribute-groups/add",
  isAuth,
  canManageInventoryCatalog,
  attributeGroupController.add,
);

// reorder — раньше update/:id: держим специфичное выше
router.put(
  "/attribute-groups/reorder",
  isAuth,
  canManageInventoryCatalog,
  attributeGroupController.reorder,
);

router.put(
  "/attribute-groups/update/:id",
  isAuth,
  canManageInventoryCatalog,
  attributeGroupController.update,
);

router.post(
  "/attribute-groups/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  attributeGroupController.delete,
);

module.exports = router;
