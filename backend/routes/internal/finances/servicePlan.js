const Router = require("express");
const router = new Router();
const servicePlanController = require("@/controllers/finances/servicePlan");
const isAuth = require("@/middleware/isAuth");
const {
  financesModuleIsActive,
  canUseFinancesModule,
  canManageServicePlans,
} = require("@/middleware/permissions");

router.get(
  "/service-plans",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  servicePlanController.getAll,
);

router.get(
  "/service-plans/:id",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  servicePlanController.getOne,
);

router.post(
  "/service-plans/add",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canManageServicePlans,
  servicePlanController.add,
);
router.put(
  "/service-plans/update/:id",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canManageServicePlans,
  servicePlanController.update,
);
router.delete(
  "/service-plans/delete/:id",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canManageServicePlans,
  servicePlanController.delete,
);

module.exports = router;
