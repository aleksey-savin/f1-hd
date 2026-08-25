const Router = require("express");
const router = new Router();
const vendorController = require("@/controllers/inventory/vendor");
const isAuth = require("@/middleware/isAuth");
const {
  canReadInventoryCatalog,
  inventoryModuleIsActive,
  canManageInventoryCatalog,
} = require("@/middleware/permissions");
const { vendorValidation } = require("@/validations/inventory/vendor");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/vendors", isAuth, canManageInventoryCatalog, vendorController.getAll);

router.get(
  "/vendors/:id",
  isAuth,
  canManageInventoryCatalog,
  vendorController.getOne,
);

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
