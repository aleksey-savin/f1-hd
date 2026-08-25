const express = require("express");

const {
  inventoryModuleIsActive,
  financesModuleIsActive,
  mikrotikIsActive,
  canReadDevices,
  canReadInventoryCatalog,
  canReadSuppliers,
  canReadMikrotik,
  canReadServicePlans,
} = require("@/middleware/permissions");

// Internal routes
const appVersionRoutes = require("./internal/appVersion");
const meRoutes = require("./internal/me");
const authRoutes = require("./internal/auth");
const commentRoutes = require("./internal/comment");
const companyRoutes = require("./internal/company");
const formDataRoutes = require("./internal/formData");
const myWorkplaceRoutes = require("./internal/myWorkplace");
const getScreenRoutes = require("./internal/pro32Connect");
const knowledgeNoteRoutes = require("./internal/knowledgeNote");
const preferencesRoutes = require("./internal/preferences");
const reportRoutes = require("./internal/report");
const roleRoutes = require("./internal/role");
const routineTaskRoutes = require("./internal/routineTask");
const ticketRoutes = require("./internal/ticket");
const ticketCategoryRoutes = require("./internal/ticketCategory");
const ticketTemplateRoutes = require("./internal/ticketTemplate");
const checklistTemplateRoutes = require("./internal/checklistTemplate");
const teamRoutes = require("./internal/team");
const userRoutes = require("./internal/user");
const workRoutes = require("./internal/work");

// Internal finances routes
const financesReportRoutes = require("./internal/finances/report");
const servicePlanRoutes = require("./internal/finances/servicePlan");
const workApprovalRoutes = require("./internal/finances/approval");

// Internal inventory routes
const clientDeviceRoutes = require("./internal/inventory/clientDevice");
const deviceAttributeRoutes = require("./internal/inventory/deviceAttribute");
const deviceConfigurationRoutes = require("./internal/inventory/deviceConfiguration");
const deviceModelRoutes = require("./internal/inventory/deviceModel");
const deviceTypeRoutes = require("./internal/inventory/deviceType");
const deviceTypeAttributeRoutes = require("./internal/inventory/deviceTypeAttribute");
const locationRoutes = require("./internal/inventory/location");
const mikrotikRoutes = require("./internal/inventory/mikrotik");
const supplierRoutes = require("./internal/inventory/supplier");
const vendorRoutes = require("./internal/inventory/vendor");

// External routes
const externalUserRoutes = require("./external/user");
const externalApprovalRoutes = require("./external/approval");

// Public routes
const healthRoutes = require("./public/health");

// Telegram-сервис: закрытый список ручек за общим секретом (см. routes/bot.js)
const botRoutes = require("./bot");

// Create route groups
const internalRoutes = express.Router();
const externalRoutes = express.Router();
const publicRoutes = express.Router();

// Личность устанавливается ОДИН РАЗ на всю группу и до всех маршрутов, включая
// неавторизованные: attachSession ничего не запрещает, он только наполняет
// req.auth. Раньше личность поднималась заново в каждом гейте и в каждом
// контроллере — до четырёх чтений `users` на запрос.
//
// Это же чинит давнюю мину: гейты модулей смонтированы НИЖЕ, до внутреннего
// isAuth, и на анонимном запросе к /finances или /inventory прежний код падал
// в 500 вместо 401, разыменовывая пользователя, которого не нашёл.
const attachSession = require("@/middleware/attachSession");

/**
 * Телеграм-сервис — ДО `attachSession`, и это не косметика.
 *
 * У него нет и не может быть серверного сеанса: он ходит с общим секретом и
 * заголовком актора, а `req.auth` ему собирает `attachTelegramActor`. Пусти
 * его через `attachSession` — и на маршрут приехал бы ещё и браузерный сеанс,
 * если бы к запросу прицепилась чужая cookie; две личности на одном запросе
 * это ровно тот класс путаницы, ради выхода из которого всё и затевалось.
 *
 * Регистрация раньше по порядку означает, что до `attachSession` эти запросы
 * просто не доходят.
 */
internalRoutes.use("/bot", botRoutes);

internalRoutes.use(attachSession);
// Внешние маршруты живут на своих удостоверениях (X-API-Key, токен в ссылке),
// но сессия им не мешает: если она есть, ею можно пользоваться.
externalRoutes.use(attachSession);

// Mount internal routes
internalRoutes.use("/", appVersionRoutes);
internalRoutes.use("/", meRoutes);
internalRoutes.use("/", authRoutes);
internalRoutes.use("/", commentRoutes);
internalRoutes.use("/", companyRoutes);
internalRoutes.use("/", formDataRoutes);
internalRoutes.use("/", myWorkplaceRoutes);
internalRoutes.use("/", getScreenRoutes);
internalRoutes.use("/", knowledgeNoteRoutes);
internalRoutes.use("/", preferencesRoutes);
internalRoutes.use("/", reportRoutes);
internalRoutes.use("/", roleRoutes);
internalRoutes.use("/", routineTaskRoutes);
internalRoutes.use("/", ticketRoutes);
internalRoutes.use("/", ticketCategoryRoutes);
internalRoutes.use("/", ticketTemplateRoutes);
internalRoutes.use("/", checklistTemplateRoutes);
// Графики работы, производственный календарь и отсутствия. Модулем «Учёт
// времени» НЕ закрыты: отпуска и присутствие нужны и без учёта часов.
internalRoutes.use("/team", teamRoutes);
internalRoutes.use("/", userRoutes);
internalRoutes.use("/", workRoutes);

// Mount internal finances routes
internalRoutes.use(
  "/finances",
  financesModuleIsActive,
  canReadServicePlans,
  financesReportRoutes,
);
internalRoutes.use(
  "/finances",
  financesModuleIsActive,
  canReadServicePlans,
  servicePlanRoutes,
);

// «Согласование работ» — отдельный префикс: раздел открыт и согласующим со
// стороны клиента, которым финансовый модуль целиком не нужен
// (см. routes/internal/finances/approval.js)
internalRoutes.use("/approval", financesModuleIsActive, workApprovalRoutes);

// Mount internal inventory routes
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadDevices,
  clientDeviceRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  deviceAttributeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  deviceConfigurationRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  deviceModelRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  deviceTypeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  deviceTypeAttributeRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadDevices,
  locationRoutes,
);
// Mikrotik — самостоятельная интеграция (не зависит от модуля «Учёт техники»):
// рубильник собственный, право на вход в раздел — тоже. Более узкие права
// (устройства, конфигурации) проверяют сами роуты. Путь /inventory сохранён —
// его знает фронтенд
internalRoutes.use("/inventory", mikrotikIsActive, canReadMikrotik, mikrotikRoutes);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadSuppliers,
  supplierRoutes,
);
internalRoutes.use(
  "/inventory",
  inventoryModuleIsActive,
  canReadInventoryCatalog,
  vendorRoutes,
);

// Mount external routes
externalRoutes.use("/external", externalUserRoutes);
// Согласование отчёта по ссылке из письма: авторизацией служит сам токен
externalRoutes.use("/external", externalApprovalRoutes);

// Mount public routes
publicRoutes.use("/", healthRoutes);

// Export route groups
module.exports = {
  internal: internalRoutes,
  external: externalRoutes,
  public: publicRoutes,
};
