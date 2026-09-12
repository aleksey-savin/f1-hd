const Router = require("express");
const router = new Router();
const mikrotikController = require("@/controllers/inventory/mikrotik");
const isAuth = require("@/middleware/isAuth");
const {
  canManageDevices,
  canManageMikrotik,
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

// Reads. Все живые операции адресуются id ЗАПИСИ мониторинга: обратный путь по
// карточке инвентаря жил ради вкладки «Мониторинг», её больше нет.
router.get("/mikrotik-devices", isAuth, mikrotikController.getManagedDevices);
// Блок «Мониторинг» на главной: только офлайн, без доступности и прошивок.
router.get(
  "/mikrotik-devices/offline",
  isAuth,
  mikrotikController.getOfflineDevices,
);
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
// --- Standalone device (no inventory ClientDevice, e.g. Cloud Hosted Router):
// заводится тем же мастером, дальше живёт как обычная запись. ---
router.post(
  "/mikrotik-devices/standalone/parameters",
  isAuth,
  canManageMikrotik,
  parametersLimiter,
  mikrotikController.createStandalone,
);

// --- Record-centric operations (страница записи и новая форма). Запись — общий
// адрес для инвентарных и standalone устройств; связь с карточкой инвентаря —
// отдельный шаг после проверки (link-inventory / create-inventory). ---
router.get(
  "/mikrotik-devices/records/:recordId",
  isAuth,
  mikrotikController.getRecordOne,
);
router.post(
  "/mikrotik-devices/records/:recordId/parameters",
  isAuth,
  canManageMikrotik,
  parametersLimiter,
  mikrotikController.updateRecordParameters,
);
router.post(
  "/mikrotik-devices/records/:recordId/connect",
  isAuth,
  canManageMikrotik,
  mikrotikController.connectRecord,
);
router.post(
  "/mikrotik-devices/records/:recordId/disconnect",
  isAuth,
  canManageMikrotik,
  mikrotikController.disconnectRecord,
);
router.delete(
  "/mikrotik-devices/records/:recordId",
  isAuth,
  canManageMikrotik,
  mikrotikController.deleteRecord,
);
// Авто-связь с инвентарём (шаг после проверки). Создание карточки требует ещё и
// права на устройства инвентаря — она пишет в ClientDevice.
router.post(
  "/mikrotik-devices/records/:recordId/link-inventory",
  isAuth,
  canManageMikrotik,
  mikrotikController.linkInventory,
);
// Применить считанные с устройства значения к связанной карточке инвентаря.
router.post(
  "/mikrotik-devices/records/:recordId/sync-inventory",
  isAuth,
  canManageMikrotik,
  mikrotikController.syncInventory,
);
router.post(
  "/mikrotik-devices/records/:recordId/create-inventory",
  isAuth,
  canManageMikrotik,
  // Карточка пишется в ClientDevice — значит спрашивается и право на технику
  // инвентаря. Здесь дважды стоял `canManageMikrotik`, и создать карточку мог
  // любой, кто ведёт мониторинг.
  canManageDevices,
  mikrotikController.createInventoryCard,
);

// --- Config exports (.rsc). Keyed by the Mikrotik record id — он общий адрес и
// для инвентарных, и для standalone устройств. Live operations open an outbound
// SSH session — throttle them per user. ---
// Config-management routes are gated by the dedicated `canManageMikrotikConfigs`
// permission (separation of duties) — a config operator can be granted access to
// backups/exports WITHOUT the device-editing `canManageMikrotik` right. Even
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

module.exports = router;
