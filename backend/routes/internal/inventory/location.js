const Router = require("express");
const router = new Router();
const locationController = require("@/controllers/inventory/location");
const isAuth = require("@/middleware/isAuth");
const { canManageClientDevices } = require("@/middleware/permissions");
const { locationValidation } = require("@/validations/inventory/location");
const { checkValidationResult } = require("@/middleware/validation");

// Get all locations
router.get("/locations", isAuth, locationController.getAll);

// Get all locations for company
router.get("/companies-locations", isAuth, locationController.getAllCompanies);

// Get location hierarchy
router.get("/locations/hierarchy", isAuth, locationController.getHierarchy);

// Get location statistics
router.get("/locations/stats", isAuth, locationController.getLocationStats);

// Get workplaces for specific user
router.get(
  "/locations/user/:userId/workplaces",
  isAuth,
  locationController.getUserWorkplaces,
);

// Get devices in a location
router.get(
  "/locations/:id/devices",
  isAuth,
  locationController.getLocationDevices,
);

// Get single location
router.get("/locations/:id", isAuth, locationController.getOne);

// Create new location
router.post(
  "/locations/add",
  isAuth,
  canManageClientDevices,
  locationValidation,
  checkValidationResult,
  locationController.add,
);

// Update location
router.put(
  "/locations/update/:id",
  isAuth,
  canManageClientDevices,
  locationValidation,
  checkValidationResult,
  locationController.update,
);

// Move devices between locations
router.post(
  "/locations/move-devices",
  isAuth,
  canManageClientDevices,
  locationController.moveDevices,
);

// Delete location
router.post(
  "/locations/delete/:id",
  isAuth,
  canManageClientDevices,
  locationController.delete,
);

module.exports = router;
