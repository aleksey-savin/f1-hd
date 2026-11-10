const router = require("express").Router();
const requireAuth = require("../../middleware/requireAuth");
const { proxmoxIsActive } = require("../../middleware/modules");
const c = require("../../controllers/proxmox");
const rateLimit = require("express-rate-limit");
const gate = (action) => (req, res, next) =>
  req.auth && !req.auth.isEndUser && req.auth.can({ proxmox: [action] })
    ? next()
    : res
        .status(403)
        .json({ error: true, message: "Недостаточно прав Proxmox" });
const live = rateLimit({
  windowMs: 60000,
  max: 30,
  keyGenerator: (req) => String(req.auth.userId),
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(requireAuth);
router.put(
  "/settings",
  require("../../middleware/permissions").canManageSettings,
  c.saveSettings,
);
router.use(proxmoxIsActive, gate("read"));
router.get("/options", c.options);
router.get('/exposure/options', live, require('../../controllers/proxmoxExposure').options);
router.get('/guests/:id/exposure', require('../../controllers/proxmoxExposure').detail);
router.get("/settings", c.settings);
router.post("/connections/verify", gate("manage"), live, c.verify);
router.post("/connections", gate("manage"), live, c.saveConnection);
router.put("/connections/:id", gate("manage"), live, c.saveConnection);
router.patch(
  "/connections/:id/monitoring",
  gate("manage"),
  c.connectionMonitoring,
);
router.put(
  "/connections/:id/maintenance",
  gate("manage"),
  c.connectionMaintenance,
);
router.delete("/connections/:id", gate("manage"), c.archive);
router.patch("/guests/company", gate("manage"), (req, res, next) => {
  req.params.kind = "guests";
  return c.company(req, res, next);
});
for (const kind of ["nodes", "guests"])
  router.patch(`/${kind}/:id/company`, gate("manage"), (req, res, next) => {
    req.params.kind = kind;
    return c.company(req, res, next);
  });
router.patch("/guests/:id/monitoring", gate("manage"), c.guestMonitoring);
router.patch("/guests/:id/agent", gate("manage"), live, c.guestAgent);
router.patch("/resources/:id/monitoring", gate("manage"), c.resourceMonitoring);
router.get("/guests/:id/security", c.guestSecurity);
router.get("/nodes/:id/security", c.nodeSecurity);
router.post("/nodes/:id/security", gate("manage"), live, c.checkNodeSecurity);
router.post("/guests/:id/security", gate("manage"), live, c.checkGuestSecurity);
router.post("/guests/:id/operations", live, c.operation);
router.get("/guests/:id/operations", c.operationHistory);
router.post("/guests/:id/operations/:operationId/reconcile", live, c.reconcile);
router.post(
  "/guests/:id/operations/:operationId/cancel",
  live,
  c.cancelOperation,
);
router.get("/resources/:id/metrics", live, c.metrics);
router.get("/resources/:id/events", c.events);
router.get("/resources/:id/availability", c.availability);
router.put("/resources/:id/maintenance", gate("manage"), c.maintenance);
router.put("/resources/:id/inventory-link", gate("manage"), c.inventory);
router.get("/companies/:id/resources", c.companyResources);
router.get("/companies", c.companies);
router.get("/companies/:id", c.companyDetail);
router.get("/discovery/networks", gate("discover"), live, c.networks);
router.post("/discovery/sessions", gate("discover"), live, c.createDiscovery);
router.get("/discovery/sessions/:id", gate("discover"), c.discovery);
router.post(
  "/discovery/sessions/:id/cancel",
  gate("discover"),
  c.cancelDiscovery,
);
router.delete("/discovery/sessions/:id", gate("discover"), c.closeDiscovery);
for (const kind of ["connections", "nodes", "guests", "storages"]) {
  router.get(`/${kind}`, (req, res, next) => {
    req.params.kind = kind;
    return c.list(req, res, next);
  });
  router.get(`/${kind}/:id`, (req, res, next) => {
    req.params.kind = kind;
    return c.detail(req, res, next);
  });
}
module.exports = router;
