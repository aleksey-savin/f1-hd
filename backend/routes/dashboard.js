const Router = require('express');
const router = new Router();
const dashboardController = require('../controllers/dashboard');
const isAuth = require('../middleware/isAuth');
const { canUseDashboard } = require('../middleware/permissions');

router.get(
    '/dashboard/total',
    isAuth,
    canUseDashboard,
    dashboardController.getAll
);

module.exports = router;
