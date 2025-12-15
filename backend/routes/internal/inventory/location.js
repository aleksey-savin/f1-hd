const Router = require("express");
const router = new Router();
const locationController = require("@/controllers/inventory/location");
const isAuth = require("@/middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
  canManageClientDevices,
} = require("@/middleware/permissions");
const { locationValidation } = require("@/validations/inventory/location");
const { checkValidationResult } = require("@/middleware/validation");

// Get all locations
router.get(
  "/locations",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getAll,
);

// Get all locations for company
router.get(
  "/companies-locations",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getAllCompanies,
);

// Get location hierarchy
router.get(
  "/locations/hierarchy",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getHierarchy,
);

// Get location statistics
router.get(
  "/locations/stats",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getLocationStats,
);

// Get workplaces for specific user
router.get(
  "/locations/user/:userId/workplaces",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getUserWorkplaces,
);

// Get devices in a location
router.get(
  "/locations/:id/devices",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getLocationDevices,
);

// Get single location
router.get(
  "/locations/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  locationController.getOne,
);

// Create new location
router.post(
  "/locations/add",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  locationValidation,
  checkValidationResult,
  locationController.add,
);

// Update location
router.put(
  "/locations/update/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  locationValidation,
  checkValidationResult,
  locationController.update,
);

// Move devices between locations
router.post(
  "/locations/move-devices",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  locationController.moveDevices,
);

// Delete location
router.post(
  "/locations/delete/:id",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  canManageClientDevices,
  locationController.delete,
);

module.exports = router;
