const Router = require("express");
const router = new Router();
const companyController = require("@/controllers/company");
const isAuth = require("@/middleware/isAuth");

const fileUpload = require("@/middleware/fileUpload");

const { runValidation } = require("@/middleware/runValidation");
const companyValidation = require("@/validations/company");

const {
  canReadCompanies,
  canManageCompanies,
  canManageServicePlans,
} = require("@/middleware/permissions");

router.get("/companies", isAuth, canReadCompanies, companyController.getAll);
// Блок «Кто ведёт вашу компанию» на главной. Единственный маршрут раздела БЕЗ
// isNotClient — он как раз для клиента; кому именно отвечать, решает контроллер.
// Обязан стоять ВЫШЕ «/companies/:id», иначе :id съест «my-support».
router.get("/companies/my-support", isAuth, companyController.getMySupport);
// Подсказка формы «есть ли в ссылке на карту точка»: короткую ссылку
// «Поделиться» раскрывает бэкенд (из браузера редирект не прочитать).
router.post(
  "/companies/resolve-map-link",
  isAuth,
  companyController.resolveMapLink,
);
// Формат id здесь не валидируем: битый ObjectId переводится в 404 глобально
// (CastError в middleware/errorHandling.js), как у остальных сущностей.
router.get("/companies/:id", isAuth, canReadCompanies, companyController.getOne);
router.get(
  "/companies/:id/stats",
  isAuth,
  canReadCompanies,
  companyController.getStats,
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
  "/companies/toggle-active/:id",
  isAuth,
  canManageCompanies,
  companyValidation.toggleActive,
  runValidation,
  companyController.toggleActive,
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

router.patch(
  "/companies/service-plan/:id",
  isAuth,
  canManageServicePlans,
  companyValidation.updateServicePlan,
  runValidation,
  companyController.updateServicePlan,
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
  canManageCompanies,
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

// Перевыпуск — POST, а не PATCH: это выдача нового значения, а не правка
// существующего, и ответ несёт ключ, которого больше нигде не будет.
router.post(
  "/companies/reissue-api-key",
  isAuth,
  canManageCompanies,
  companyValidation.reissueApiKey,
  runValidation,
  companyController.reissueApiKey,
);

router.delete(
  "/companies/delete-api-key",
  isAuth,
  canManageCompanies,
  companyValidation.deleteApiKey,
  runValidation,
  companyController.deleteApiKey,
);

// Журнал входов AD — имена, учётные записи и имена компьютеров сотрудников
// клиента. До этого гейта его читал любой авторизованный, включая клиента
// ЧУЖОЙ компании: проверялось только существование компании.
router.get(
  "/companies/:id/logs",
  isAuth,
  canManageCompanies,
  companyValidation.getCompanyLogs,
  runValidation,
  companyController.getCompanyLogs,
);

router.get(
  "/companies/:id/logs/accounts",
  isAuth,
  canManageCompanies,
  companyValidation.getCompanyLogs,
  runValidation,
  companyController.getCompanyLogAccounts,
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
