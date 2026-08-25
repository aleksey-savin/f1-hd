const Router = require("express");
const router = new Router();
const locationController = require("@/controllers/inventory/location");
const isAuth = require("@/middleware/isAuth");
const { inventoryModuleIsActive } = require("@/middleware/permissions");

// «Моё рабочее место» на главной клиента: своя техника, техника рабочего места
// и общая в том же помещении.
//
// Живёт ВНЕ префикса /inventory намеренно. Тот смонтирован за правами раздела
// («видеть технику», «видеть справочники»), которых у клиентов нет ни у кого, и
// выдавать их ради собственного стола значит открыть весь учёт. Модульный
// рубильник при этом соблюдается: выключен учёт техники — нет и блока.
router.get(
  "/my-workplace",
  isAuth,
  inventoryModuleIsActive,
  locationController.getMyTech,
);

module.exports = router;
