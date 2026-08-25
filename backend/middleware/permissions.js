const {
  loadAccessibleTicket,
  assertTicketsAccessible,
} = require("@/services/ticketAccess");

const requireAuth = require("./requireAuth");

/**
 * Гейты прав. Раньше здесь лежали двадцать восемь почти одинаковых функций, и
 * каждая заново поднимала пользователя (`getAuthData`, затем ещё раз
 * `User.findById`). Теперь личность и эффективные права считает `attachSession`
 * один раз на запрос, а здесь остаётся собственно решение.
 *
 * Express 5 принимает массив мидлварей там же, где одну, поэтому вызовы на
 * маршрутах не меняются: `router.get("/x", isAuth, canManageUsers, handler)`
 * работает как прежде.
 *
 * Два расхождения с прежним поведением, оба осознанные:
 *   • администратор проходит ВЕЗДЕ. Раньше `canSeeKnowledgeBase` был
 *     единственным из двадцати, кто доставал `isAdmin` из документа и не
 *     использовал — админ не попадал в базу знаний без явной галочки;
 *   • тело отказа всегда `error: true`. Четырнадцать гейтов отвечали
 *     `error: false` при статусе 403; фронтенд это поле не читает.
 */
const deny = (req, res, message) => {
  req.isAuth = false;
  return res.status(403).json({ error: true, status: 403, message });
};

/**
 * @param {object|object[]} request — запрос в терминах словаря прав
 *   (`auth/access.js`): `{ ticket: ["delete"] }`. Массив означает «достаточно
 *   ЛЮБОГО из вариантов»; внутри одного объекта действия складываются по И.
 * @param {string} message — текст отказа, сохранён дословно от прежних версий.
 *
 * Решение принимает `req.auth.can` — штатная функция better-auth по набору
 * statements, разрешённому один раз за запрос в `attachSession`. Администратор
 * проходит везде: это признак учётной записи, а не право.
 */
const requirePermission = (request, message) => {
  const variants = Array.isArray(request) ? request : [request];
  return [
    requireAuth,
    (req, res, next) =>
      variants.some((variant) => req.auth.can(variant))
        ? next()
        : deny(req, res, message),
  ];
};

const PAGE = "Недостаточно прав для просмотра данной страницы";

// --- общие ---------------------------------------------------------------

module.exports.isAdmin = [
  requireAuth,
  (req, res, next) =>
    req.auth.isAdmin
      ? next()
      : deny(req, res, "Недостаточно прав для просмотра страниц"),
];

module.exports.isNotClient = [
  requireAuth,
  (req, res, next) =>
    req.auth.isEndUser
      ? deny(req, res, "Недостаточно прав для просмотра страницы")
      : next(),
];

// --- заявки --------------------------------------------------------------

/**
 * Доступ к конкретной заявке — единственный гейт, который смотрит не только на
 * права, но и на отношение человека к самой записи. Само правило живёт в
 * `services/ticketAccess.js`: к заявке ходят не только маршруты с номером в
 * пути, а мидлварь умеет проверять только их.
 *
 * @param {(req) => ({num?: any, id?: any})} locate — где лежит ключ заявки.
 *   Заявку кладём в `req.ticket`: контроллеру она почти всегда нужна следом, и
 *   второе чтение той же записи не окупается.
 */
const requireTicketAccess = (locate) => [
  requireAuth,
  async (req, res, next) => {
    try {
      req.ticket = await loadAccessibleTicket(req.auth, locate(req));
      next();
    } catch (error) {
      next(error);
    }
  },
];

module.exports.requireTicketAccess = requireTicketAccess;

module.exports.allowedToViewTicket = requireTicketAccess((req) => ({
  num: req.params.ticketNum,
}));

/**
 * То же для списка заявок в теле запроса: одна работа вешается сразу на
 * несколько заявок, и доступной должна быть каждая.
 *
 * @param {(req) => string[]} locate — где лежит список идентификаторов.
 */
module.exports.requireTicketsAccess = (locate) => [
  requireAuth,
  async (req, res, next) => {
    try {
      await assertTicketsAccessible(req.auth, locate(req));
      next();
    } catch (error) {
      next(error);
    }
  },
];

/**
 * Своя карточка или право распоряжаться чужими. Отдельный гейт нужен там, где
 * человек правит СЕБЯ без всяких прав — аватар, — а `:id` в пути позволяет
 * подставить чужой. Стоит ДО multer: отказать надо раньше, чем принят файл.
 */
module.exports.selfOrCanManageUsers = [
  requireAuth,
  (req, res, next) =>
    String(req.params.id) === req.auth.userId ||
    req.auth.can({ user: ["manage"] })
      ? next()
      : deny(req, res, "Изменить можно только свою карточку"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Гейты словаря.
//
// Имя гейта = действие словаря, и это правило, а не совпадение. Прежние имена
// врали: `canUseFinancesModule` означало «видеть услуги и тарифы»,
// `canUseTimeTrackingModule` — «видеть работы», `canUseInventoryModule` открывал
// сразу технику, справочники, поставщиков и Mikrotik. Гейт, названный не тем,
// что он проверяет, — это будущая ошибка раздачи прав.
// ─────────────────────────────────────────────────────────────────────────────

// --- заявки ---------------------------------------------------------------

module.exports.canPerformTickets = requirePermission(
  { ticket: ["perform"] },
  "У пользователя отсутствует разрешение на выполнение заявки",
);
module.exports.canAdministrateTickets = requirePermission(
  { ticket: ["administrate"] },
  "У пользователя отсутствует разрешение на администрирование заявки",
);
module.exports.canUpdateTickets = requirePermission(
  { ticket: ["update"] },
  "У пользователя отсутствует разрешение на редактирование заявки",
);
module.exports.canDeleteTickets = requirePermission(
  { ticket: ["delete"] },
  "У пользователя отсутствует разрешение на удаление заявки",
);

// --- заготовки заявок -----------------------------------------------------

module.exports.canManageTicketCategories = requirePermission(
  { ticketCategory: ["manage"] },
  PAGE,
);
module.exports.canManageTicketTemplates = requirePermission(
  { ticketTemplate: ["manage"] },
  PAGE,
);
module.exports.canManageChecklistTemplates = requirePermission(
  { checklistTemplate: ["manage"] },
  PAGE,
);
module.exports.canManageRoutineTasks = requirePermission(
  { routineTask: ["manage"] },
  PAGE,
);

// --- работы и отчёты ------------------------------------------------------

module.exports.canReadWorks = requirePermission({ work: ["read"] }, PAGE);
module.exports.canLogWorks = requirePermission(
  { work: ["log"] },
  "Недостаточно прав для записи работ",
);
module.exports.canReadWorksReport = requirePermission(
  { report: ["works"] },
  "Недостаточно прав для просмотра данного отчёта",
);
module.exports.canReadCompaniesReport = requirePermission(
  { report: ["companies"] },
  "Недостаточно прав для просмотра отчёта",
);
module.exports.canReadEmployeesReport = requirePermission(
  { report: ["employees"] },
  PAGE,
);
// Ручка обслуживает и свой отчёт, и чужой; чей именно — решает контроллер
module.exports.canReadPersonalReport = requirePermission(
  [{ report: ["own"] }, { report: ["employees"] }],
  PAGE,
);

// --- согласование работ ---------------------------------------------------

// Раздел открыт и согласующим со стороны клиента, которым отчёт по сотрудникам
// не нужен вовсе: достаточно любого из двух прав.
module.exports.canOpenApproval = requirePermission(
  [{ report: ["employees"] }, { approval: ["decide"] }],
  PAGE,
);
module.exports.canManageApproval = requirePermission(
  { approval: ["manage"] },
  PAGE,
);

// --- услуги, компании, люди, роли ----------------------------------------

module.exports.canReadServicePlans = requirePermission(
  { servicePlan: ["read"] },
  PAGE,
);
module.exports.canManageServicePlans = requirePermission(
  { servicePlan: ["manage"] },
  PAGE,
);

module.exports.canReadCompanies = requirePermission({ company: ["read"] }, PAGE);
module.exports.canManageCompanies = requirePermission(
  { company: ["manage"] },
  PAGE,
);
module.exports.canReadCompanyLogs = requirePermission(
  { company: ["readLogs"] },
  PAGE,
);

module.exports.canReadUsers = requirePermission({ user: ["read"] }, PAGE);
module.exports.canManageUsers = requirePermission({ user: ["manage"] }, PAGE);
// Пароли, сеансы, второй фактор и раздача ролей: распоряжаться входом — не то
// же самое, что вести карточку человека.
module.exports.canManageUserAccess = requirePermission(
  { user: ["manageAccess"] },
  PAGE,
);
module.exports.canImpersonateUsers = requirePermission(
  { user: ["impersonate"] },
  "У вас нет разрешения входить под пользователем",
);

module.exports.canReadRoles = requirePermission({ role: ["read"] }, PAGE);
module.exports.canManageRoles = requirePermission({ role: ["manage"] }, PAGE);

// --- графики и база знаний ------------------------------------------------

module.exports.canReadSchedule = requirePermission(
  { schedule: ["read"] },
  PAGE,
);
module.exports.canManageSchedules = requirePermission(
  { schedule: ["manage"] },
  "Недостаточно прав для управления графиками и отсутствиями",
);
module.exports.canApproveAbsences = requirePermission(
  { schedule: ["approve"] },
  "Недостаточно прав для согласования отсутствий",
);

module.exports.canReadKnowledge = requirePermission(
  { knowledge: ["read"] },
  PAGE,
);
module.exports.canManageKnowledge = requirePermission(
  { knowledge: ["manage"] },
  PAGE,
);

// --- оборудование ---------------------------------------------------------

module.exports.canReadDevices = requirePermission({ device: ["read"] }, PAGE);
module.exports.canManageDevices = requirePermission(
  { device: ["manage"] },
  "Недостаточно прав",
);
module.exports.canReadInventoryCatalog = requirePermission(
  { inventoryCatalog: ["read"] },
  PAGE,
);
module.exports.canManageInventoryCatalog = requirePermission(
  { inventoryCatalog: ["manage"] },
  "Недостаточно прав",
);
module.exports.canReadSuppliers = requirePermission(
  { supplier: ["read"] },
  PAGE,
);
module.exports.canManageSuppliers = requirePermission(
  { supplier: ["manage"] },
  "Недостаточно прав",
);
module.exports.canReadMikrotik = requirePermission({ mikrotik: ["read"] }, PAGE);
module.exports.canManageMikrotik = requirePermission(
  { mikrotik: ["manage"] },
  PAGE,
);
module.exports.canManageMikrotikConfigs = requirePermission(
  { mikrotik: ["manageConfigs"] },
  "Недостаточно прав для управления резервными копиями конфигураций Mikrotik",
);

// --- удалённая помощь и настройки ----------------------------------------

module.exports.canUseRemoteSupport = requirePermission(
  { remoteSupport: ["use"] },
  "Недостаточно прав для запуска сеанса удалённой помощи",
);

module.exports.canReadSettings = requirePermission(
  { settings: ["read"] },
  "Недостаточно прав для просмотра настроек",
);
module.exports.canManageSettings = requirePermission(
  { settings: ["manage"] },
  PAGE,
);
module.exports.canManageMailSettings = requirePermission(
  { settings: ["manageMail"] },
  PAGE,
);
module.exports.canManageIntegrations = requirePermission(
  { settings: ["manageIntegrations"] },
  PAGE,
);
module.exports.canManageSecuritySettings = requirePermission(
  { settings: ["manageSecurity"] },
  PAGE,
);

// Рубильники модулей переехали в ./modules — это настройка установки, а не
// права. Реэкспорт оставлен, чтобы не править импорты в routes/index.js разом.
const modules = require("./modules");
module.exports.timeTrackingModuleIsActive = modules.timeTrackingModuleIsActive;
module.exports.inventoryModuleIsActive = modules.inventoryModuleIsActive;
module.exports.mikrotikIsActive = modules.mikrotikIsActive;
module.exports.financesModuleIsActive = modules.financesModuleIsActive;
module.exports.knowledgeBaseModuleIsActive = modules.knowledgeBaseModuleIsActive;
