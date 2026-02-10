const Router = require("express");
const router = new Router();
const vendorController = require("@/controllers/inventory/vendor");
const isAuth = require("@/middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageClientDevices,
} = require("@/middleware/permissions");
const { vendorValidation } = require("@/validations/inventory/vendor");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/vendors", isAuth, canManageClientDevices, vendorController.getAll);

router.get(
  "/vendors/:id",
  isAuth,
  canManageClientDevices,
  vendorController.getOne,
);

router.post(
  "/vendors/add",
  isAuth,
  canManageClientDevices,
  vendorValidation,
  checkValidationResult,
  vendorController.add,
);

router.put(
  "/vendors/update/:id",
  isAuth,
  canManageClientDevices,
  vendorValidation,
  checkValidationResult,
  vendorController.update,
);

router.post(
  "/vendors/delete/:id",
  isAuth,
  canManageClientDevices,
  vendorController.delete,
);

module.exports = router;
