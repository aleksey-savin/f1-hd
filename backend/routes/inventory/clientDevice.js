const Router = require("express");
const router = new Router();
const deviceController = require("../../controllers/inventory/clientDevice");
const isAuth = require("../../middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageClientDevices,
} = require("../../middleware/permissions");

router.get(
  "/client-devices",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceController.getAll,
);
router.get(
  "/client-devices/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceController.getOne,
);

router.post(
  "/client-devices/add",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  deviceController.add,
);
router.put(
  "/client-devices/update/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  deviceController.update,
);
router.delete(
  "/client-devices/delete/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  deviceController.delete,
);

module.exports = router;
