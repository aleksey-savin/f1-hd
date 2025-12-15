const Router = require("express");
const router = new Router();
const preferencesController = require("@/controllers/preferences");
const isAuth = require("@/middleware/isAuth");
const { isAdmin } = require("@/middleware/permissions");

router.get("/preferences", isAuth, isAdmin, preferencesController.get);
router.get("/preferences-initial", isAuth, preferencesController.getInitial);
router.get("/preferences-auth", preferencesController.getAuth);
router.post("/preferences", isAuth, isAdmin, preferencesController.update);
router.post(
  "/preferences/update-db-conf",
  isAuth,
  isAdmin,
  preferencesController.updateDbConf,
);

module.exports = router;
