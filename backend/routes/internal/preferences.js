const Router = require("express");
const router = new Router();
const preferencesController = require("@/controllers/preferences");
const isAuth = require("@/middleware/isAuth");
const { isAdmin } = require("@/middleware/permissions");
const { uploadCompanyLogo } = require("@/middleware/imageUpload");

router.get("/preferences", isAuth, isAdmin, preferencesController.get);
router.get("/preferences-initial", isAuth, preferencesController.getInitial);
router.get("/preferences-auth", preferencesController.getAuth);
router.post("/preferences", isAuth, isAdmin, preferencesController.update);
router.post(
  "/preferences/logo",
  isAuth,
  isAdmin,
  // Локальный diskStorage: лого читается на каждой странице каждым пользователем
  uploadCompanyLogo,
  preferencesController.uploadLogo,
);
router.post(
  "/preferences/delete-logo",
  isAuth,
  isAdmin,
  preferencesController.deleteLogo,
);
router.post(
  "/preferences/ai-models",
  isAuth,
  isAdmin,
  preferencesController.getAiModels,
);
router.post(
  "/preferences/update-db-conf",
  isAuth,
  isAdmin,
  preferencesController.updateDbConf,
);

module.exports = router;
