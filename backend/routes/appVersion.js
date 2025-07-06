const Router = require('express');
const router = new Router();
const appVersionController = require('../controllers/appVersion');

router.get('/app-version', appVersionController.getAppVersion);

module.exports = router;
