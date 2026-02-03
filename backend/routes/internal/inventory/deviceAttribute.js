const Router = require("express");
const router = new Router();
const deviceAttributeController = require("@/controllers/inventory/deviceAttribute");
const isAuth = require("@/middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageDeviceAttributes,
} = require("@/middleware/permissions");
const {
  deviceAttributeValidation,
} = require("@/validations/inventory/deviceAttribute");
const { checkValidationResult } = require("@/middleware/validation");

router.get(
  "/device-attributes",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceAttributeController.getAll,
);

router.get(
  "/device-attributes/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceAttributeController.getOne,
);

router.post(
  "/device-attributes/add",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceAttributes,
  deviceAttributeValidation,
  checkValidationResult,
  deviceAttributeController.add,
);

router.put(
  "/device-attributes/update/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceAttributes,
  deviceAttributeValidation,
  checkValidationResult,
  deviceAttributeController.update,
);

router.post(
  "/device-attributes/delete/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceAttributes,
  deviceAttributeController.delete,
);

module.exports = router;
