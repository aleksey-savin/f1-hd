const Router = require("express");
const router = new Router();
const companyController = require("@/controllers/company");
const isAuth = require("@/middleware/isAuth");

const fileUpload = require("@/middleware/fileUpload");

const { runValidation } = require("@/middleware/runValidation");
const companyValidation = require("@/validations/company");

const {
  canManageCompanies,
  canManageServicePlans,
  isNotClient,
} = require("@/middleware/permissions");

router.get("/companies", isAuth, isNotClient, companyController.getAll);
router.get(
  "/companies/:id",
  isAuth,
  isNotClient,
  companyValidation.getOne,
  runValidation,
  companyController.getOne,
);

router.post(
  "/companies/add",
  isAuth,
  canManageCompanies,
  companyValidation.add,
  runValidation,
  companyController.add,
);
router.put(
  "/companies/update/:id",
  isAuth,
  canManageCompanies,
  companyValidation.update,
  runValidation,
  companyController.update,
);
router.delete(
  "/companies/delete/:id",
  isAuth,
  canManageCompanies,
  companyValidation.delete,
  runValidation,
  companyController.delete,
);

router.post(
  "/companies/add-subdivision",
  isAuth,
  canManageCompanies,
  companyValidation.addSubdivision,
  runValidation,
  companyController.addSubdivision,
);
router.put(
  "/companies/update-subdivision",
  isAuth,
  canManageCompanies,
  companyValidation.updateSubdivision,
  runValidation,
  companyController.updateSubdivision,
);
router.delete(
  "/companies/delete-subdivision",
  isAuth,
  canManageCompanies,
  companyValidation.deleteSubdivision,
  runValidation,
  companyController.deleteSubdivision,
);

router.patch(
  "/companies/update-subdivision-users",
  isAuth,
  canManageCompanies,
  companyValidation.updateSubdivisionUsers,
  runValidation,
  companyController.updateSubdivisionUsers,
);

router.post(
  "/companies/add-service-plan/:id",
  isAuth,
  canManageServicePlans,
  companyValidation.addServicePlan,
  runValidation,
  companyController.addServicePlan,
);

router.delete(
  "/companies/delete-service-plan/:id",
  isAuth,
  canManageServicePlans,
  companyValidation.deleteServicePlan,
  runValidation,
  companyController.deleteServicePlan,
);

router.patch(
  "/companies/:id/add-profile-image",
  isAuth,
  fileUpload.single("profileImage"),
  companyController.addProfileImage,
);

router.post(
  "/companies/create-api-key",
  isAuth,
  canManageCompanies,
  companyValidation.createApiKey,
  runValidation,
  companyController.createApiKey,
);

router.delete(
  "/companies/delete-api-key",
  isAuth,
  canManageCompanies,
  companyValidation.deleteApiKey,
  runValidation,
  companyController.deleteApiKey,
);

router.get(
  "/companies/:id/logs",
  isAuth,
  canManageCompanies,
  companyValidation.getCompanyLogs,
  runValidation,
  companyController.getCompanyLogs,
);

router.patch(
  "/companies/link-user-to-ad",
  isAuth,
  canManageCompanies,
  companyValidation.linkUserToAD,
  runValidation,
  companyController.linkUserToAD,
);

router.patch(
  "/companies/unlink-user-from-ad",
  isAuth,
  canManageCompanies,
  companyValidation.unlinkUserFromAD,
  runValidation,
  companyController.unlinkUserFromAD,
);

module.exports = router;
