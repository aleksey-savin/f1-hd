/**
 * Единственный список ключей прав.
 *
 * До появления этого файла список жил в трёх местах и уже разошёлся:
 * `types/user.ts` содержал `canManageDeviceModels`, `canManageDeviceTypes` и
 * `canManageDeviceAttributes`, которых в модели нет, и не содержал
 * `canManageWorkSchedules` с `canApproveWorkReports`, которые есть и гейтят.
 * `pnpm typecheck` этого не ловит: у бэкенда `checkJs: false`.
 *
 * Порядок значим — он совпадает с порядком в `models/user.js` и с
 * группировкой в `frontend/src/components/User/permissions-catalog.js`.
 * Каталог на фронте остаётся источником ПОДПИСЕЙ (это тексты интерфейса),
 * а источником самих КЛЮЧЕЙ становится этот файл.
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
 * Сверка списка с реальной схемой пользователя. Вызывается один раз при
 * загрузке модели и БРОСАЕТ при расхождении: молчаливый рассинхрон — ровно то,
 * из-за чего появился этот файл, и обнаружиться он должен в деве при первом
 * запуске, а не в проде отсутствующей галочкой.
 */
const assertPermissionKeysMatch = (userSchema) => {
  const inSchema = Object.keys(userSchema.paths)
    .filter((path) => path.startsWith("permissions."))
    .map((path) => path.slice("permissions.".length))
    .sort();
  const known = [...PERMISSION_KEYS].sort();

  const missing = inSchema.filter((key) => !known.includes(key));
  const extra = known.filter((key) => !inSchema.includes(key));

  if (missing.length || extra.length) {
    throw new Error(
      "utils/permissions.js разошёлся с models/user.js. " +
        (missing.length ? `Нет в списке: ${missing.join(", ")}. ` : "") +
        (extra.length ? `Нет в схеме: ${extra.join(", ")}. ` : "") +
        "Приведите PERMISSION_KEYS в соответствие со схемой.",
    );
  }
};

module.exports = {
  PERMISSION_KEYS,
  assertPermissionKeysMatch,
};
