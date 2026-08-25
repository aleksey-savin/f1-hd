const Router = require("express");
const router = new Router();
const deviceAttributeController = require("@/controllers/inventory/deviceAttribute");
const isAuth = require("@/middleware/isAuth");
const {
  canManageInventoryCatalog,
} = require("@/middleware/permissions");
const {
  deviceAttributeValidation,
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

router.post(
  "/device-attributes/delete/:id",
  isAuth,
  canManageInventoryCatalog,
  deviceAttributeController.delete,
);

module.exports = router;
