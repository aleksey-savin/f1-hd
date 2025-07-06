const Router = require('express');
const router = new Router();
const changelogController = require('../controllers/changelog');
const isAuth = require('../middleware/isAuth');
const { canUpdateChangeLog } = require('../middleware/permissions');

router.get('/changelog', isAuth, changelogController.getAll);
router.get(
    '/changelog/check-updates',
    isAuth,
    changelogController.checkUpdates
);

router.post(
    '/changelog/add',
    isAuth,
    canUpdateChangeLog,
    changelogController.add
);
router.post(
    '/changelog/update',
    isAuth,
    canUpdateChangeLog,
    changelogController.update
);
router.post(
    '/changelog/delete',
    isAuth,
    canUpdateChangeLog,
    changelogController.delete
);

module.exports = router;
