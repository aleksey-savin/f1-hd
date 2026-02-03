const Router = require("express");
const router = new Router();
const deviceModelController = require("@/controllers/inventory/deviceModel");
const isAuth = require("@/middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageDeviceModels,
} = require("@/middleware/permissions");
const { deviceModelValidation } = require("@/validations/inventory/deviceModel");
const { checkValidationResult } = require("@/middleware/validation");

router.get(
  "/device-models",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceModelController.getAll,
);

router.get(
  "/device-models/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceModelController.getOne,
);

router.post(
  "/device-models/add",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceModels,
  deviceModelValidation,
  checkValidationResult,
  deviceModelController.add,
);

router.put(
  "/device-models/update/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceModels,
  deviceModelValidation,
  checkValidationResult,
  deviceModelController.update,
);

router.post(
  "/device-models/delete/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageDeviceModels,
  deviceModelController.delete,
);

module.exports = router;
