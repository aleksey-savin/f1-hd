const Router = require("express");
const router = new Router();
const supplierController = require("@/controllers/inventory/supplier");
const isAuth = require("@/middleware/isAuth");
const { canManageSuppliers } = require("@/middleware/permissions");
const { supplierValidation } = require("@/validations/inventory/supplier");
const { checkValidationResult } = require("@/middleware/validation");

// Право supplier.read уже проверено на монтировании роутера (canReadSuppliers
// в routes/index.js) — здесь достаточно подтверждённой личности.
router.get("/suppliers", isAuth, supplierController.getAll);

router.get("/suppliers/:id", isAuth, supplierController.getOne);

router.post(
  "/suppliers/add",
  isAuth,
  canManageSuppliers,
  supplierValidation,
  checkValidationResult,
  supplierController.add,
);

router.put(
  "/suppliers/update/:id",
  isAuth,
  canManageSuppliers,
  supplierValidation,
  checkValidationResult,
  supplierController.update,
);

router.post(
  "/suppliers/delete/:id",
  isAuth,
  canManageSuppliers,
  supplierController.delete,
);

module.exports = router;
