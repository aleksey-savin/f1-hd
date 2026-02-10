const Router = require("express");
const router = new Router();
const deviceModelController = require("@/controllers/inventory/deviceModel");
const isAuth = require("@/middleware/isAuth");
const {
  canManageDeviceModels,
  canManageClientDevices,
} = require("@/middleware/permissions");
const {
  deviceModelValidation,
} = require("@/validations/inventory/deviceModel");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/device-models", isAuth, deviceModelController.getAll);

router.get("/device-models/:id", isAuth, deviceModelController.getOne);

router.post(
  "/device-models/add",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceModelValidation,
  checkValidationResult,
  deviceModelController.add,
);

router.put(
  "/device-models/update/:id",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceModelValidation,
  checkValidationResult,
  deviceModelController.update,
);

router.post(
  "/device-models/delete/:id",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceModelController.delete,
);

module.exports = router;
