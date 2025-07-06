const Router = require("express");
const router = new Router();
const mikrotikController = require("../../controllers/inventory/mikrotik");
const isAuth = require("../../middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageMikrotikDevices,
} = require("../../middleware/permissions");

router.get(
  "/mikrotik-devices",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  mikrotikController.getAll,
);
router.get(
  "/mikrotik-devices/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  mikrotikController.getOne,
);
router.get(
  "/mikrotik-devices/report/networks",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  mikrotikController.networksReport,
);

router.post(
  "/mikrotik-devices/add",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageMikrotikDevices,
  mikrotikController.add,
);
router.patch(
  "/mikrotik-devices/update-info",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageMikrotikDevices,
  mikrotikController.updateInfo,
);
router.patch(
  "/mikrotik-devices/update-credentials",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageMikrotikDevices,
  mikrotikController.updateCredentials,
);
router.delete(
  "/mikrotik-devices/delete",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageMikrotikDevices,
  mikrotikController.delete,
);

module.exports = router;
