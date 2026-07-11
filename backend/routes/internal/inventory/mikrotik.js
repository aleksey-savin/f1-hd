const Router = require("express");
const router = new Router();
const mikrotikController = require("@/controllers/inventory/mikrotik");
const isAuth = require("@/middleware/isAuth");
const {
  canManageMikrotikDevices,
  canManageMikrotikConfigs,
} = require("@/middleware/permissions");
const rateLimit = require("express-rate-limit");

// Verify-on-save opens an outbound connection — throttle it per user.
const parametersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || req.ip,
});

// Requesting a download code sends an email — throttle tightly per user to avoid
// mailbox spam / OTP grinding.
const downloadCodeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
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
// Кэш релизов RouterOS (+чейнджлоги) и свежесть CVE-синка — плашка над таблицей.
router.get(
  "/mikrotik-devices/firmware/releases",
  isAuth,
  mikrotikController.getFirmwareReleases,
);
// --- Standalone devices (no inventory ClientDevice, e.g. Cloud Hosted Router).
// Declared before the ":clientDeviceId" routes so the literal "standalone"
// segment isn't captured as a device id. ---
router.get(
  "/mikrotik-devices/standalone/:recordId",
  isAuth,
  mikrotikController.getStandaloneOne,
);
router.post(
  "/mikrotik-devices/standalone/parameters",
  isAuth,
  canManageMikrotikDevices,
  parametersLimiter,
  mikrotikController.createStandalone,
);
router.post(
  "/mikrotik-devices/standalone/:recordId/parameters",
  isAuth,
  canManageMikrotikDevices,
  parametersLimiter,
  mikrotikController.updateStandaloneParameters,
);
router.delete(
  "/mikrotik-devices/standalone/:recordId",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.detachStandalone,
);

// --- Config exports (.rsc). Keyed by the Mikrotik record id, so the same routes
// serve both inventory-backed and standalone devices. Declared before the
// ":clientDeviceId" routes so the literal "records" segment isn't captured as an
// id. Live operations open an outbound SSH session — throttle them per user. ---
// Config-management routes are gated by the dedicated `canManageMikrotikConfigs`
// permission (separation of duties) — a config operator can be granted access to
// backups/exports WITHOUT the device-editing `canManageMikrotikDevices` right. Even
// listing stored configs requires it (defense in depth; the frontend hides the tab).
// Availability report (uptime / outage episodes) — a read, like getOne.
router.get(
  "/mikrotik-devices/records/:recordId/availability",
  isAuth,
  mikrotikController.getAvailability,
);
router.get(
  "/mikrotik-devices/records/:recordId/artifacts",
  isAuth,
  canManageMikrotikConfigs,
  mikrotikController.listArtifacts,
);
router.post(
  "/mikrotik-devices/records/:recordId/exports",
  isAuth,
  canManageMikrotikConfigs,
  parametersLimiter,
  mikrotikController.createExportNow,
);
// Two-factor download: request an emailed code, then POST it to fetch the file.
router.post(
  "/mikrotik-devices/records/:recordId/artifacts/:artifactId/download-code",
  isAuth,
  canManageMikrotikConfigs,
  downloadCodeLimiter,
  mikrotikController.requestDownloadCode,
);
router.post(
  "/mikrotik-devices/records/:recordId/artifacts/:artifactId/download",
  isAuth,
  canManageMikrotikConfigs,
  mikrotikController.downloadArtifact,
);
router.delete(
  "/mikrotik-devices/records/:recordId/artifacts/:artifactId",
  isAuth,
  canManageMikrotikConfigs,
  mikrotikController.deleteArtifact,
);
router.put(
  "/mikrotik-devices/records/:recordId/schedules",
  isAuth,
  canManageMikrotikConfigs,
  mikrotikController.updateSchedules,
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
// Apply device-derived values to the inventory card (reconciliation). No rate
// limit: the endpoint never opens an outbound connection.
router.post(
  "/mikrotik-devices/:clientDeviceId/sync-inventory",
  isAuth,
  canManageMikrotikDevices,
  mikrotikController.syncInventory,
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
