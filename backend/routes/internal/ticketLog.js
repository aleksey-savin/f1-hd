const Router = require("express");
const router = new Router();
const ticketLogController = require("@/controllers/log/ticketLog");
const isAuth = require("@/middleware/isAuth");

router.get("/ticket-log/:ticketNum", isAuth, ticketLogController.get);

module.exports = router;
