const Router = require("express");
const router = new Router();
const pro32ConnectController = require("@/controllers/pro32Connect");
const isAuth = require("@/middleware/isAuth");

router.post("/support/create", isAuth, pro32ConnectController.createSupport);

router.get(
  "/support/connection/:ticketNum",
  isAuth,
  pro32ConnectController.getConnection,
);

module.exports = router;
