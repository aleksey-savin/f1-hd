const Router = require("express");
const router = new Router();
const deviceConfigurationController = require("@/controllers/inventory/deviceConfiguration");
const isAuth = require("@/middleware/isAuth");
const {
  canManageDeviceModels,
  canManageClientDevices,
} = require("@/middleware/permissions");
const {
  deviceConfigurationValidation,
} = require("@/validations/inventory/deviceConfiguration");
const { checkValidationResult } = require("@/middleware/validation");

router.get(
  "/device-configurations/model/:id",
  isAuth,
  deviceConfigurationController.getByDeviceModelId,
);

router.get(
  "/device-configurations/:id",
  isAuth,
  deviceConfigurationController.getOne,
);

router.post(
  "/device-configurations/add",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceConfigurationValidation,
  checkValidationResult,
  deviceConfigurationController.add,
);

router.put(
  "/device-configurations/update/:id",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceConfigurationValidation,
  checkValidationResult,
  deviceConfigurationController.update,
);

router.post(
  "/device-configurations/delete/:id",
  isAuth,
  canManageClientDevices,
  // canManageDeviceModels,
  deviceConfigurationController.delete,
);

module.exports = router;
