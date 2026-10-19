const Router = require("express");
const router = new Router();
const deviceBuildController = require("@/controllers/inventory/deviceBuild");
const isAuth = require("@/middleware/isAuth");
const { canManageInventoryCatalog } = require("@/middleware/permissions");

// Сборки — шаблоны «своих» ПК. Читать может любой сотрудник (модуль и
// личность проверены на монтировании), править — canManageInventoryCatalog.

router.get("/device-builds", isAuth, deviceBuildController.getAll);
router.get("/device-builds/:id", isAuth, deviceBuildController.getOne);

router.post(
  "/device-builds/add",
  isAuth,
  canManageInventoryCatalog,
  deviceBuildController.add,
);

router.put(
  "/device-builds/update/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceBuildController.update,
);

router.post(
  "/device-builds/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceBuildController.delete,
);

module.exports = router;
