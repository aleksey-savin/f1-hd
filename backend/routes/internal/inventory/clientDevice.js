const Router = require("express");
const router = new Router();
const deviceController = require("@/controllers/inventory/clientDevice");
const isAuth = require("@/middleware/isAuth");
const { canManageClientDevices } = require("@/middleware/permissions");
const {
  clientDeviceValidation,
} = require("@/validations/inventory/clientDevice");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/client-devices", isAuth, deviceController.getAll);
router.get("/client-devices/:id", isAuth, deviceController.getOne);

router.post(
  "/client-devices/add",
  isAuth,
  canManageClientDevices,
  clientDeviceValidation,
  checkValidationResult,
  deviceController.add,
);
router.put(
  "/client-devices/update/:id",
  isAuth,
  canManageClientDevices,
  clientDeviceValidation,
  checkValidationResult,
  deviceController.update,
);
router.delete(
  "/client-devices/delete/:id",
  isAuth,

  canManageClientDevices,
  deviceController.delete,
);

module.exports = router;
