const Router = require("express");
const router = new Router();
const deviceTypeAttributeController = require("@/controllers/inventory/deviceTypeAttribute");
const isAuth = require("@/middleware/isAuth");
const { canManageInventoryCatalog } = require("@/middleware/permissions");

// Атрибуты типа устройства правятся точечно с карточки типа (добавить/изменить/
// удалить/переупорядочить), по образцу конфигураций модели. Пишущий гейт —
// canManageInventoryCatalog (как у device-types / device-configurations); модуль
// уже проверен на монтировании (inventoryModuleIsActive + canReadInventoryCatalog).

router.get(
  "/device-type-attributes/type/:id",
  isAuth,
  deviceTypeAttributeController.getByDeviceTypeId,
);

router.get(
  "/device-type-attributes/:id",
  isAuth,
  deviceTypeAttributeController.getOne,
);

router.post(
  "/device-type-attributes/add",
  isAuth,
  canManageInventoryCatalog,
  deviceTypeAttributeController.add,
);

// reorder — до update/:id: разные вторые сегменты, но держим специфичное выше
router.put(
  "/device-type-attributes/reorder",
  isAuth,
  canManageInventoryCatalog,
  deviceTypeAttributeController.reorder,
);

router.put(
  "/device-type-attributes/update/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceTypeAttributeController.update,
);

router.post(
  "/device-type-attributes/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceTypeAttributeController.delete,
);

module.exports = router;
