const Router = require("express");
const router = new Router();
const deviceTypeController = require("@/controllers/inventory/deviceType");
const isAuth = require("@/middleware/isAuth");
const {
  canManageClientDevices,
} = require("@/middleware/permissions");
const { deviceTypeValidation } = require("@/validations/inventory/deviceType");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/device-types", isAuth, deviceTypeController.getAll);

router.get("/device-types/:id", isAuth, deviceTypeController.getOne);

router.post(
  "/device-types/add",
  isAuth,
  canManageClientDevices,
  deviceTypeValidation,
  checkValidationResult,
  deviceTypeController.add,
);

router.put(
  "/device-types/update/:id",
  isAuth,
  canManageClientDevices,
  deviceTypeValidation,
  checkValidationResult,
  deviceTypeController.update,
);

router.post(
  "/device-types/delete/:id",
  isAuth,
  canManageClientDevices,
  deviceTypeController.delete,
);

module.exports = router;
