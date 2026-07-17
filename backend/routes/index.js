const express = require("express");

const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  financesModuleIsActive,
  canUseFinancesModule,
} = require("@/middleware/permissions");

// Internal routes
const appVersionRoutes = require("./internal/appVersion");
const authRoutes = require("./internal/auth");
const changelogRoutes = require("./internal/changelog");
const commentRoutes = require("./internal/comment");
const companyRoutes = require("./internal/company");
const dashboardRoutes = require("./internal/dashboard");
const formDataRoutes = require("./internal/formData");
const getScreenRoutes = require("./internal/pro32Connect");
const knowledgeNoteRoutes = require("./internal/knowledgeNote");
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
const deviceAttributeRoutes = require("./internal/inventory/deviceAttribute");
const deviceConfigurationRoutes = require("./internal/inventory/deviceConfiguration");
const deviceModelRoutes = require("./internal/inventory/deviceModel");
const deviceTypeRoutes = require("./internal/inventory/deviceType");
const deviceTypeAttributeRoutes = require("./internal/inventory/deviceTypeAttribute");
const locationRoutes = require("./internal/inventory/location");
const mikrotikRoutes = require("./internal/inventory/mikrotik");
const supplierRoutes = require("./internal/inventory/supplier");
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
internalRoutes.use("/", knowledgeNoteRoutes);
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
internalRoutes.use(
  "/finances",
  financesModuleIsActive,
  canUseFinancesModule,
  financesReportRoutes,
);
internalRoutes.use(
  "/finances",
  financesModuleIsActive,
  canUseFinancesModule,
  servicePlanRoutes,
);

// Mount internal inventory routes
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  clientDeviceRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceAttributeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceConfigurationRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceModelRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceTypeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  deviceTypeAttributeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  mikrotikRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  supplierRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canUseInventoryModule,
  vendorRoutes,
);

// Mount external routes
externalRoutes.use("/external", externalUserRoutes);

// Mount public routes
publicRoutes.use("/", healthRoutes);

// Export route groups
module.exports = {
  internal: internalRoutes,
  external: externalRoutes,
  public: publicRoutes,
};
