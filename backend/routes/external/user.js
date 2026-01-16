const Router = require("express");
const router = new Router();

const { addUserActivity } = require("@/controllers/log/companyLog");
const { createTicket } = require("@/controllers/external/ticket");

const isAuthApiKey = require("@/middleware/isAuthApiKey");
const fileUpload = require("@/middleware/fileUpload");

router.post("/log/user-activity", isAuthApiKey, addUserActivity);
router.post(
  "/ticket/create",
  isAuthApiKey,
  fileUpload.array("attachments"),
  createTicket,
);

module.exports = router;
