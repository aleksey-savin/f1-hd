const Router = require("express");
const router = new Router();
const servicePlanController = require("@/controllers/finances/servicePlan");
const isAuth = require("@/middleware/isAuth");
const {
  canManageServicePlans,
  canReadOrPickServicePlans,
} = require("@/middleware/permissions");

// Прайс-лист — не «любому сотруднику»: `isNotClient` открывал цены и пакеты
// часов всей поддержке и не пускал клиента к его собственным услугам. Право
// своё (`servicePlan.read`, адресат `both`), плюс тот, кто ведёт компании: он
// подключает услуги с карточки компании. Кому какие услуги видны, решает
// контроллер — клиенту только подключённые его компании.
router.get(
  "/service-plans",
  isAuth,
  canReadOrPickServicePlans,
  servicePlanController.getAll,
);

router.get(
  "/service-plans/:id",
  isAuth,
  canReadOrPickServicePlans,
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
