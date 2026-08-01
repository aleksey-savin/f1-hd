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

// Get workplaces for specific user

// Get full environment for a user (workplace + ancestor chain + devices).
// Должен идти до "/locations/:id", иначе :id перехватит "user".
router.get(
  "/locations/user/:userId/environment",
  isAuth,
  locationController.getUserEnvironment,
);

// Get full environment for a DEVICE (its location + ancestor chain). Питает
// вкладку «Окружение» заявок мониторинга (их автор — служебный applicant без
// рабочего места). Тоже до "/locations/:id".
router.get(
  "/locations/device/:deviceId/environment",
  isAuth,
  locationController.getDeviceEnvironment,
);

// Get environment overview for a COMPANY (root locations + subtree counts).
// Питает виджет «Окружение» на карточке компании. Тоже до "/locations/:id".
router.get(
  "/locations/company/:companyId/environment",
  isAuth,
  locationController.getCompanyEnvironment,
);

// Flat tech list for a COMPANY card (вид «Список» секции «Техника»)
router.get(
  "/locations/company/:companyId/tech",
  isAuth,
  locationController.getCompanyTech,
);

// Tech list for a USER card (личная + РМ + помещение уровнем выше)
router.get(
  "/locations/user/:userId/tech",
  isAuth,
  locationController.getUserTech,
);

// Get assignable users for a location (правила привязки устройства к пользователю)
router.get(
  "/locations/:id/assignable-users",
  isAuth,
  locationController.getAssignableUsers,
);

// Get a single location node for the environment widget (devices + children)
router.get("/locations/:id/node", isAuth, locationController.getLocationNode);

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

// Delete location
router.post(
  "/locations/delete/:id",
  isAuth,
  canManageClientDevices,
  locationController.delete,
);

module.exports = router;
