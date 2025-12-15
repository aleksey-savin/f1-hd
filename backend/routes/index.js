const express = require("express");

// Internal routes
const appVersionRoutes = require("./internal/appVersion");
const authRoutes = require("./internal/auth");
const changelogRoutes = require("./internal/changelog");
const commentRoutes = require("./internal/comment");
const companyRoutes = require("./internal/company");
const dashboardRoutes = require("./internal/dashboard");
const formDataRoutes = require("./internal/formData");
const getScreenRoutes = require("./internal/getScreen");
const preferencesRoutes = require("./internal/preferences");
const reportRoutes = require("./internal/report");
const routineTaskRoutes = require("./internal/routineTask");
const ticketRoutes = require("./internal/ticket");
const ticketCategoryRoutes = require("./internal/ticketCategory");
const ticketLogRoutes = require("./internal/ticketLog");
const ticketTemplateRoutes = require("./internal/ticketTemplate");
const userRoutes = require("./internal/user");
const workRoutes = require("./internal/work");

// Internal finances routes
const financesReportRoutes = require("./internal/finances/report");
const servicePlanRoutes = require("./internal/finances/servicePlan");

// Internal inventory routes
const clientDeviceRoutes = require("./internal/inventory/clientDevice");
const deviceTypeRoutes = require("./internal/inventory/deviceType");
const locationRoutes = require("./internal/inventory/location");
const mikrotikRoutes = require("./internal/inventory/mikrotik");
const referenceRoutes = require("./internal/inventory/reference");
const vendorRoutes = require("./internal/inventory/vendor");

// External routes
const externalUserRoutes = require("./external/user");

// Public routes
const healthRoutes = require("./public/health");

// Create route groups
const internalRoutes = express.Router();
const externalRoutes = express.Router();
const publicRoutes = express.Router();

// Mount internal routes
internalRoutes.use("/", appVersionRoutes);
internalRoutes.use("/", authRoutes);
internalRoutes.use("/", changelogRoutes);
internalRoutes.use("/", commentRoutes);
internalRoutes.use("/", companyRoutes);
internalRoutes.use("/", dashboardRoutes);
internalRoutes.use("/", formDataRoutes);
internalRoutes.use("/", getScreenRoutes);
internalRoutes.use("/", preferencesRoutes);
internalRoutes.use("/", reportRoutes);
internalRoutes.use("/", routineTaskRoutes);
internalRoutes.use("/", ticketRoutes);
internalRoutes.use("/", ticketCategoryRoutes);
internalRoutes.use("/", ticketLogRoutes);
internalRoutes.use("/", ticketTemplateRoutes);
internalRoutes.use("/", userRoutes);
internalRoutes.use("/", workRoutes);

// Mount internal finances routes
internalRoutes.use("/finances", financesReportRoutes);
internalRoutes.use("/", servicePlanRoutes);

// Mount internal inventory routes
internalRoutes.use("/inventory", clientDeviceRoutes);
internalRoutes.use("/inventory", deviceTypeRoutes);
internalRoutes.use("/inventory", locationRoutes);
internalRoutes.use("/inventory", mikrotikRoutes);
internalRoutes.use("/inventory", referenceRoutes);
internalRoutes.use("/inventory", vendorRoutes);

// Mount external routes
externalRoutes.use("/", externalUserRoutes);

// Mount public routes
publicRoutes.use("/", healthRoutes);

// Export route groups
module.exports = {
  internal: internalRoutes,
  external: externalRoutes,
  public: publicRoutes,
};
