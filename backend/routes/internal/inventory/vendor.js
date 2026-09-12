const Router = require("express");
const router = new Router();
const vendorController = require("@/controllers/inventory/vendor");
const isAuth = require("@/middleware/isAuth");
const { canManageInventoryCatalog } = require("@/middleware/permissions");
const { vendorValidation } = require("@/validations/inventory/vendor");
const { checkValidationResult } = require("@/middleware/validation");

// Личность и модуль проверены на монтировании (isNotClient, модуль учёта
// техники); право на раздел справочников — только на маршруте фронта
// (inventoryCatalog.read). Список нужен выпадашке формы устройства, поэтому
// права на чтение здесь нет.
router.get("/vendors", isAuth, vendorController.getAll);

router.get("/vendors/:id", isAuth, vendorController.getOne);

router.post(
  "/vendors/add",
  isAuth,
  canManageInventoryCatalog,
  vendorValidation,
  checkValidationResult,
  vendorController.add,
);

router.put(
  "/vendors/update/:id",
  isAuth,
  canManageInventoryCatalog,
  vendorValidation,
  checkValidationResult,
  vendorController.update,
);

router.post(
  "/vendors/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  vendorController.delete,
);

module.exports = router;
