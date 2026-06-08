const Router = require("express");
const router = new Router();
const supplierController = require("@/controllers/inventory/supplier");
const isAuth = require("@/middleware/isAuth");
const { canManageClientDevices } = require("@/middleware/permissions");
const { supplierValidation } = require("@/validations/inventory/supplier");
const { checkValidationResult } = require("@/middleware/validation");

router.get(
  "/suppliers",
  isAuth,
  canManageClientDevices,
  supplierController.getAll,
);

router.get(
  "/suppliers/:id",
  isAuth,
  canManageClientDevices,
  supplierController.getOne,
);

router.post(
  "/suppliers/add",
  isAuth,
  canManageClientDevices,
  supplierValidation,
  checkValidationResult,
  supplierController.add,
);

router.put(
  "/suppliers/update/:id",
  isAuth,
  canManageClientDevices,
  supplierValidation,
  checkValidationResult,
  supplierController.update,
);

router.post(
  "/suppliers/delete/:id",
  isAuth,
  canManageClientDevices,
  supplierController.delete,
);

module.exports = router;
