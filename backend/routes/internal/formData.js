const Router = require("express");
const router = new Router();

const isAuth = require("@/middleware/isAuth");
const { isNotClient } = require("@/middleware/permissions");

const formDataController = require("@/controllers/formData");

router.get("/form-data/companies", isAuth, formDataController.getCompanies);

// Служебные учётки нужны только настройкам и регламентам — экранам сотрудника
router.get(
  "/form-data/service-accounts",
  isAuth,
  isNotClient,
  formDataController.getServiceAccounts,
);

// Категории — тот же справочник для выпадашки, что и /ticket-categories:
// достаточно быть сотрудником. На `routineTask.manage` форма регламента
// ломалась у того, кому регламенты дали только читать.
router.get(
  "/form-data/categories",
  isAuth,
  isNotClient,
  formDataController.getCategories,
);

module.exports = router;
