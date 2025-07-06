const Router = require("express");
const router = new Router();
const getScreenController = require("../controllers/getScreen");
const isAuth = require("../middleware/isAuth");

router.post("/support/create", isAuth, getScreenController.createSupport);

router.get(
  "/support/connection/:ticketNum",
  isAuth,
  getScreenController.getConnection,
);

module.exports = router;
