const Router = require("express");
const router = new Router();
const locationController = require("@/controllers/inventory/location");
const isAuth = require("@/middleware/isAuth");
const { inventoryModuleIsActive } = require("@/middleware/permissions");

// «Моё рабочее место» на главной клиента: своя техника, техника рабочего места
// и общая в том же помещении.
//
// Живёт ВНЕ префикса /inventory намеренно. Тот целиком смонтирован за
// `canUseInventoryModule` — правом инженера, открывающим раздел «Устройства»;
// у клиентов его нет ни у одного, и выдавать его ради собственного стола
// значит открыть им весь учёт. Модульный рубильник при этом соблюдается:
// выключен учёт техники — нет и блока.
router.get(
  "/my-workplace",
  isAuth,
  inventoryModuleIsActive,
  locationController.getMyTech,
);

module.exports = router;
