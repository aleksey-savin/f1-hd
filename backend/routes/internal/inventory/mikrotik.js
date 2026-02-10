const Router = require("express");
const router = new Router();
const mikrotikController = require("@/controllers/inventory/mikrotik");
const isAuth = require("@/middleware/isAuth");
const { canManageMikrotikDevices } = require("@/middleware/permissions");

router.get("/mikrotik-devices", isAuth, mikrotikController.getAll);
router.get("/mikrotik-devices/:id", isAuth, mikrotikController.getOne);
router.get(
  "/mikrotik-devices/report/networks",
  isAuth,
  mikrotikController.networksReport,
);

router.post(
  "/mikrotik-devices/add",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.add,
);
router.patch(
  "/mikrotik-devices/update-info",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.updateInfo,
);
router.patch(
  "/mikrotik-devices/update-credentials",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.updateCredentials,
);
router.delete(
  "/mikrotik-devices/delete",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.delete,
);

module.exports = router;
