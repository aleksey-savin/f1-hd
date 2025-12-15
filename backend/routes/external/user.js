const Router = require("express");
const router = new Router();

const { addUserActivity } = require("@/controllers/log/companyLog");

const isAuthApiKey = require("@/middleware/isAuthApiKey");

router.post("/log/user-activity", isAuthApiKey, addUserActivity);

module.exports = router;
