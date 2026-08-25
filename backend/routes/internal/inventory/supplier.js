const Router = require("express");
const router = new Router();
const supplierController = require("@/controllers/inventory/supplier");
const isAuth = require("@/middleware/isAuth");
const { canManageSuppliers } = require("@/middleware/permissions");
const { supplierValidation } = require("@/validations/inventory/supplier");
const { checkValidationResult } = require("@/middleware/validation");

router.get(
  "/suppliers",
  isAuth,
  canManageSuppliers,
  supplierController.getAll,
);

router.get(
  "/suppliers/:id",
  isAuth,
  canManageSuppliers,
  supplierController.getOne,
);

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
