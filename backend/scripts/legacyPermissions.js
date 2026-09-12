/**
 * ДОРОЛЕВЫЕ ПРАВА — только для миграции.
 *
 * Тридцать плоских булевых ключей, которые лежали в `users.permissions` до
 * ролей. В работающем приложении их больше нет: словарь прав объявлен в
 * `auth/access.js`, права выдаются ролями, поле в схеме пользователя удалено.
 *
 * Здесь они остались, потому что на проде такие документы ещё лежат: роли туда
 * не выкачены, и `assignRoles.js` выводит роль каждого человека из его прежнего
 * набора галочек. Читать этот файл имеет право только `scripts/` — если его
 * потребовалось подключить в контроллере или сервисе, значит легаси вернулось
 * в приложение, а не осталось в миграции.
 */

/**
 * Порядок ЗНАЧИМ: по нему собирается «подпись» набора прав
 * (`assignRoles.js#signature`), а подписи прописаны в `roles.catalogue.json`.
 */
const PERMISSION_KEYS = [
  // работа с заявками
  "canPerformTickets",
  "canAdministrateTickets",
  "canSeeAllCompanyTickets",
  "canSeeAllTickets",
  "canEditTickets",
  "canDeleteTickets",
  // базовое администрирование портала
  "canManageCompanies",
  "canManageUsers",
  "canManageRoles",
  "canImpersonateUsers",
  "canManageTicketCategories",
  "canManageKnowledgeBase",
  "canSeeKnowledgeBase",
  "canManageRoutineTasks",
  "canManageTicketTemplates",
  // модуль учёта времени
  "canUseTimeTrackingModule",
  "canAvoidWorks",
  "canSeeWorksReport",
  "canSeeAnalytics",
  "canManageWorkSchedules",
  // модуль инвентаря
  "canUseInventoryModule",
  "canManageClientDevices",
  "canManageMikrotikDevices",
  "canManageMikrotikConfigs",
  // модуль финансов
  "canUseFinancesModule",
  "canManageServicePlans",
  "canSeeGlobalFinancialReport",
  "canConfirmReportActions",
  "canSeePersonalFinancialReport",
  "canApproveWorkReports",
];

/**
 * Прежний ключ → действия НОВОГО словаря.
 *
 * Где прежнее право было шире нового — оно раскрывается в несколько действий,
 * и человек не теряет НИЧЕГО из того, что мог: `canUseInventoryModule` открывал
 * весь раздел «Учёт техники» разом, поэтому и превращается в четыре «видеть».
 *
 * Обратного отображения нет и не будет: в новом словаре есть действия, которых
 * в плоском наборе не существовало вовсе (настройки, удалённая помощь, правка
 * чужих работ, заявка от чужого имени, модерация базы знаний). Они достаются
 * роли полного доступа — см. `roles.catalogue.json`.
 */
const LEGACY_TO_ACTIONS = {
  // Плоский флаг не различал свою заявку и чужую — принять можно было любую,
  // поэтому он раскрывается в оба действия нового словаря
  canPerformTickets: ["ticket.perform", "ticket.join"],
  // Шаблоны чек-листов гейтились именно «администрированием заявок»
  canAdministrateTickets: ["ticket.manage", "checklistTemplate.read", "checklistTemplate.manage"],
  canSeeAllCompanyTickets: ["ticket.readCompanies"],
  canSeeAllTickets: ["ticket.readAll"],
  canEditTickets: ["ticket.manage"],
  canDeleteTickets: ["ticket.delete"],

  canManageCompanies: ["company.read", "company.manage", "company.readLogs"],
  // `role.read` тоже: прежний гейт каталога ролей пускал по ЛЮБОМУ из двух прав
  // (`canReadRoles` = роли ИЛИ пользователи) — в форме человека роль выбирают
  // из списка, а выбрать из невидимого списка нельзя
  canManageUsers: [
    "user.read",
    "user.manage",
    "user.manageAccess",
    "role.read",
  ],
  canManageRoles: ["role.read", "role.manage"],
  canImpersonateUsers: ["user.impersonate"],
  canManageTicketCategories: ["ticketCategory.read", "ticketCategory.manage"],
  canManageKnowledgeBase: ["knowledge.manage"],
  canSeeKnowledgeBase: ["knowledge.read"],
  canManageRoutineTasks: ["routineTask.read", "routineTask.manage"],
  canManageTicketTemplates: ["ticketTemplate.read", "ticketTemplate.manage"],

  canUseTimeTrackingModule: ["work.read", "work.log"],
  canAvoidWorks: ["ticket.closeWithoutWork"],
  canSeeWorksReport: ["work.read"],
  canSeeAnalytics: ["report.companies"],
  canManageWorkSchedules: [
    "schedule.read",
    "schedule.manage",
    "schedule.approve",
  ],

  canUseInventoryModule: [
    "device.read",
    "inventoryCatalog.read",
    "supplier.read",
    "mikrotik.read",
  ],
  canManageClientDevices: [
    "device.manage",
    "inventoryCatalog.manage",
    "supplier.manage",
  ],
  canManageMikrotikDevices: ["mikrotik.manage"],
  canManageMikrotikConfigs: ["mikrotik.manageConfigs"],

  canUseFinancesModule: ["servicePlan.read"],
  canManageServicePlans: ["servicePlan.manage"],
  canSeeGlobalFinancialReport: ["report.employees", "user.manageFinances"],
  canConfirmReportActions: ["approval.read", "approval.manage"],
  canSeePersonalFinancialReport: ["report.own"],
  canApproveWorkReports: ["approval.read", "approval.decide"],
};

/** Плоский набор доролевых галочек → действия нового словаря. */
const legacyToActions = (permissions = {}) => {
  const keys = PERMISSION_KEYS.filter((key) => permissions?.[key]);
  const actions = new Set(keys.flatMap((key) => LEGACY_TO_ACTIONS[key] || []));
  // Стоимость работ раньше была сочетанием двух прав
  if (keys.includes("canUseFinancesModule") && keys.includes("canSeeGlobalFinancialReport")) {
    actions.add("work.readCost");
  }
  return [...actions];
};

module.exports = { PERMISSION_KEYS, LEGACY_TO_ACTIONS, legacyToActions };
