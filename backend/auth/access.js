/**
 * Словарь прав: какие в системе бывают ресурсы и какие над ними действия.
 *
 * Это свойство КОДА и иначе быть не может — набор возможностей определяется
 * самой системой. Из интерфейса создаются РОЛИ (наборы этих действий), а не
 * новые действия; роли лежат в `organizationRole` и правятся штатными ручками
 * плагина `organization`, деплой для новой роли не нужен.
 *
 * Словарь объявляется здесь, в CommonJS, потому что его читают обе стороны:
 * ESM-остров (там из него собирается `createAccessControl`) и прикладной код
 * (гейты, `/api/me`, скрипты миграции). В остров он приезжает параметром —
 * `module-alias` там не работает.
 */

/**
 * Ресурс → действия. Имена действий короткие и не повторяют имя ресурса:
 * `ticket.delete`, а не `ticket.deleteTicket`.
 */
const STATEMENT = {
  ticket: [
    // «берёт заявки в работу» — попадает в списки исполнителей
    "perform",
    "administrate",
    // видеть заявки своей компании / вообще все
    "readCompany",
    "readAll",
    "update",
    "delete",
  ],
  company: ["manage"],
  user: ["manage"],
  role: ["manage"],
  ticketCategory: ["manage"],
  knowledgeBase: ["read", "manage"],
  routineTask: ["manage"],
  ticketTemplate: ["manage"],
  timeTracking: ["use"],
  work: ["avoid", "readReport"],
  analytics: ["read"],
  workSchedule: ["manage"],
  inventory: ["use"],
  clientDevice: ["manage"],
  mikrotik: ["manageDevices", "manageConfigs"],
  finances: ["use", "readGlobalReport", "readPersonalReport", "confirmActions"],
  servicePlan: ["manage"],
  workReport: ["approve"],
};

/**
 * Прежний плоский ключ → пара «ресурс, действие».
 *
 * Нужен ровно для трёх вещей и все три временные: миграция существующих
 * наборов прав в роли, приёмка (снимок эффективных прав до и после обязан
 * совпасть) и подписи в интерфейсе, которые пока живут по старым ключам.
 * Порядок совпадает с `utils/permissions.js`.
 */
const LEGACY_TO_AC = {
  canPerformTickets: ["ticket", "perform"],
  canAdministrateTickets: ["ticket", "administrate"],
  canSeeAllCompanyTickets: ["ticket", "readCompany"],
  canSeeAllTickets: ["ticket", "readAll"],
  canEditTickets: ["ticket", "update"],
  canDeleteTickets: ["ticket", "delete"],

  canManageCompanies: ["company", "manage"],
  canManageUsers: ["user", "manage"],
  canManageRoles: ["role", "manage"],
  canManageTicketCategories: ["ticketCategory", "manage"],
  canManageKnowledgeBase: ["knowledgeBase", "manage"],
  canSeeKnowledgeBase: ["knowledgeBase", "read"],
  canManageRoutineTasks: ["routineTask", "manage"],
  canManageTicketTemplates: ["ticketTemplate", "manage"],

  canUseTimeTrackingModule: ["timeTracking", "use"],
  canAvoidWorks: ["work", "avoid"],
  canSeeWorksReport: ["work", "readReport"],
  canSeeAnalytics: ["analytics", "read"],
  canManageWorkSchedules: ["workSchedule", "manage"],

  canUseInventoryModule: ["inventory", "use"],
  canManageClientDevices: ["clientDevice", "manage"],
  canManageMikrotikDevices: ["mikrotik", "manageDevices"],
  canManageMikrotikConfigs: ["mikrotik", "manageConfigs"],

  canUseFinancesModule: ["finances", "use"],
  canManageServicePlans: ["servicePlan", "manage"],
  canSeeGlobalFinancialReport: ["finances", "readGlobalReport"],
  canConfirmReportActions: ["finances", "confirmActions"],
  canSeePersonalFinancialReport: ["finances", "readPersonalReport"],
  canApproveWorkReports: ["workReport", "approve"],
};

/** Обратное направление: «ресурс.действие» → прежний ключ. */
const AC_TO_LEGACY = Object.fromEntries(
  Object.entries(LEGACY_TO_AC).map(([key, [resource, action]]) => [
    `${resource}.${action}`,
    key,
  ]),
);

/**
 * Проверка целостности словаря — при загрузке, а не в проде отсутствующей
 * галочкой. Ровно та же роль, что у `assertPermissionKeysMatch`: два списка,
 * которые обязаны совпадать, обязаны и ссориться при запуске.
 */
const assertStatementMatchesKeys = (permissionKeys) => {
  const mapped = Object.keys(LEGACY_TO_AC);
  const missing = permissionKeys.filter((key) => !mapped.includes(key));
  const extra = mapped.filter((key) => !permissionKeys.includes(key));

  const declared = new Set(
    Object.entries(STATEMENT).flatMap(([resource, actions]) =>
      actions.map((action) => `${resource}.${action}`),
    ),
  );
  const undeclared = Object.entries(LEGACY_TO_AC)
    .map(([, [resource, action]]) => `${resource}.${action}`)
    .filter((pair) => !declared.has(pair));
  const unused = [...declared].filter((pair) => !AC_TO_LEGACY[pair]);

  if (missing.length || extra.length || undeclared.length || unused.length) {
    throw new Error(
      "auth/access.js разошёлся с utils/permissions.js. " +
        (missing.length ? `Нет отображения: ${missing.join(", ")}. ` : "") +
        (extra.length ? `Лишнее отображение: ${extra.join(", ")}. ` : "") +
        (undeclared.length
          ? `Нет в словаре: ${undeclared.join(", ")}. `
          : "") +
        (unused.length ? `В словаре без ключа: ${unused.join(", ")}.` : ""),
    );
  }
};

/** Плоский набор прав (28 булевых) → statements для роли. */
const permissionsToStatements = (permissions = {}) => {
  const statements = {};
  for (const [key, [resource, action]] of Object.entries(LEGACY_TO_AC)) {
    if (!permissions[key]) continue;
    (statements[resource] ||= []).push(action);
  }
  return statements;
};

/** Statements → плоский набор из 28 ключей (все, включая false). */
const statementsToPermissions = (statements = {}) => {
  const permissions = {};
  for (const [key, [resource, action]] of Object.entries(LEGACY_TO_AC)) {
    permissions[key] = Boolean(statements[resource]?.includes(action));
  }
  return permissions;
};

/**
 * Роль отдаёт ВЕСЬ словарь — и потому равна полному доступу.
 *
 * Это единственный механический признак «администратора», который у нас есть:
 * по нему зеркалится `user.isAdmin` (его читают около сотни мест и меню
 * фронта) и по нему же считается, какие права нельзя выдать иначе как вместе
 * со всем порталом. Сравнение с ключом роли `"admin"` было бы хуже: ключ
 * принадлежит каталогу, а каталог правят из интерфейса.
 */
const isFullAccess = (statements) =>
  Object.entries(STATEMENT).every(([resource, actions]) =>
    actions.every((action) => statements?.[resource]?.includes(action)),
  );

module.exports = {
  STATEMENT,
  LEGACY_TO_AC,
  AC_TO_LEGACY,
  assertStatementMatchesKeys,
  permissionsToStatements,
  statementsToPermissions,
  isFullAccess,
};
