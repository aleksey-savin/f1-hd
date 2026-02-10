const Router = require("express");
const router = new Router();
const servicePlanController = require("@/controllers/finances/servicePlan");
const isAuth = require("@/middleware/isAuth");
const { canManageServicePlans } = require("@/middleware/permissions");

router.get(
  "/service-plans",
  isAuth,

  servicePlanController.getAll,
);

router.get(
  "/service-plans/:id",
  isAuth,

  servicePlanController.getOne,
);

router.post(
  "/service-plans/add",
  isAuth,
  canManageServicePlans,
  servicePlanController.add,
);
router.put(
  "/service-plans/update/:id",
  isAuth,
  canManageServicePlans,
  servicePlanController.update,
);
router.delete(
  "/service-plans/delete/:id",
  isAuth,
  canManageServicePlans,
  servicePlanController.delete,
);

module.exports = router;
