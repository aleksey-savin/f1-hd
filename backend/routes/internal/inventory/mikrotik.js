const Router = require("express");
const router = new Router();
const mikrotikController = require("@/controllers/inventory/mikrotik");
const isAuth = require("@/middleware/isAuth");
const { canManageMikrotikDevices } = require("@/middleware/permissions");
const rateLimit = require("express-rate-limit");

// Verify-on-save opens an outbound connection — throttle it per user.
const parametersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || req.ip,
});

// Reads. NOTE: the static "report/networks" route must be declared before the
// ":clientDeviceId" param route so it isn't swallowed as an id.
router.get("/mikrotik-devices", isAuth, mikrotikController.getManagedDevices);
router.get(
  "/mikrotik-devices/report/networks",
  isAuth,
  mikrotikController.networksReport,
);
router.get(
  "/mikrotik-devices/:clientDeviceId",
  isAuth,
  mikrotikController.getOne,
);

// Mutations (verify-on-save parameters, start/stop monitoring).
router.post(
  "/mikrotik-devices/:clientDeviceId/parameters",
  isAuth,
  canManageMikrotikDevices,
  parametersLimiter,
  mikrotikController.updateParameters,
);
router.post(
  "/mikrotik-devices/:clientDeviceId/connect",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.connect,
);
router.post(
  "/mikrotik-devices/:clientDeviceId/disconnect",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.disconnect,
);

// Detach: delete the management record (credentials + polled data). The
// ClientDevice returns to the "not configured" pool for re-adding.
router.delete(
  "/mikrotik-devices/:clientDeviceId",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.detach,
);

module.exports = router;
