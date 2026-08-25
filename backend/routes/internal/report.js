const Router = require("express");
const router = new Router();

const companiesReportController = require("@/controllers/companiesReport");
const isAuth = require("@/middleware/isAuth");

const { runValidation } = require("@/middleware/runValidation");
const reportValidation = require("@/validations/report");

const {
  canReadCompaniesReport,
  timeTrackingModuleIsActive,
  canReadWorks,
} = require("@/middleware/permissions");

// Отчёт «Компании» (бывшая «Аналитика»): сводка → карточка компании →
// карточка подразделения. Право открывает страницу, объём данных считает
// services/reportScope (наш сотрудник — все компании, ответственное лицо
// клиента — свои компании, руководитель подразделения — своё поддерево).
const gate = [isAuth, timeTrackingModuleIsActive, canReadWorks, canReadCompaniesReport];

router.get(
  "/report/companies",
  ...gate,
  reportValidation.companiesSummary,
  runValidation,
  companiesReportController.getSummary,
);

// Объявляется РАНЬШЕ "/report/companies/:companyId", иначе Express уведёт
// "trends" в параметр маршрута
router.get(
  "/report/companies/trends",
  ...gate,
  reportValidation.companiesTrends,
  runValidation,
  companiesReportController.getTrends,
);

router.get(
  "/report/companies/:companyId",
  ...gate,
  reportValidation.companyCard,
  runValidation,
  companiesReportController.getCompany,
);

router.get(
  "/report/companies/:companyId/subdivisions/:subdivisionId",
  ...gate,
  reportValidation.subdivisionCard,
  runValidation,
  companiesReportController.getSubdivision,
);

module.exports = router;
