const Router = require("express");
const router = new Router();

const isAuth = require("@/middleware/isAuth");
const { canManageRoutineTasks } = require("@/middleware/permissions");

const formDataController = require("@/controllers/formData");

router.get("/form-data/companies", isAuth, formDataController.getCompanies);

router.get(
  "/form-data/service-accounts",
  isAuth,
  formDataController.getServiceAccounts,
);

router.get(
  "/form-data/categories",
  isAuth,
  canManageRoutineTasks,
  formDataController.getCategories,
);

module.exports = router;
