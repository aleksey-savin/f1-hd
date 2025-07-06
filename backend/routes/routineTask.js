const Router = require('express');
const router = new Router();
const routineTaskController = require('../controllers/routineTask');
const isAuth = require('../middleware/isAuth');
const { canManageRoutineTasks } = require('../middleware/permissions');

router.get(
    '/routine-tasks',
    isAuth,
    canManageRoutineTasks,
    routineTaskController.getAll
);
router.get(
    '/routine-tasks/:id',
    isAuth,
    canManageRoutineTasks,
    routineTaskController.getOne
);

router.post(
    '/routine-tasks/add',
    isAuth,
    canManageRoutineTasks,
    routineTaskController.add
);
router.post(
    '/routine-tasks/update/:id',
    isAuth,
    canManageRoutineTasks,
    routineTaskController.update
);
router.post(
    '/routine-tasks/delete/:id',
    isAuth,
    canManageRoutineTasks,
    routineTaskController.delete
);

module.exports = router;
