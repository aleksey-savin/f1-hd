const Router = require("express");
const router = new Router();
const deviceAttributeController = require("@/controllers/inventory/deviceAttribute");
const isAuth = require("@/middleware/isAuth");
const {
  canManageInventoryCatalog,
} = require("@/middleware/permissions");
const {
  deviceAttributeValidation,
  deviceAttributeTypesValidation,
} = require("@/validations/inventory/deviceAttribute");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/device-attributes", isAuth, deviceAttributeController.getAll);

router.get("/device-attributes/:id", isAuth, deviceAttributeController.getOne);

router.post(
  "/device-attributes/add",
  isAuth,
  canManageInventoryCatalog,
  deviceAttributeValidation,
  checkValidationResult,
  deviceAttributeController.add,
);

router.put(
  "/device-attributes/update/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceAttributeValidation,
  checkValidationResult,
  deviceAttributeController.update,
);

// Привязка к типам набором — из списка атрибутов. Обратная операция (правка
// одной связки с карточки типа) живёт в device-type-attributes; гейт тот же.
router.put(
  "/device-attributes/:id/device-types",
  isAuth,
  canManageInventoryCatalog,
  deviceAttributeTypesValidation,
  checkValidationResult,
  deviceAttributeController.setDeviceTypes,
);

router.post(
  "/device-attributes/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceAttributeController.delete,
);

module.exports = router;
