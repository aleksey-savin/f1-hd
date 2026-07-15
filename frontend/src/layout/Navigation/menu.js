import {
  RiApps2Line,
  RiArchiveLine,
  RiBookOpenLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCalendar2Line,
  RiCheckboxLine,
  RiContactsLine,
  RiDashboard2Line,
  RiDeviceLine,
  RiDraftLine,
  RiFileList3Line,
  RiListSettingsLine,
  RiMapPinLine,
  RiPulseLine,
  RiRouterLine,
  RiServerLine,
  RiServiceLine,
  RiSettings3Line,
  RiTeamLine,
} from "react-icons/ri";

// Конфиг главной навигации — единый источник для десктопного бара, его
// дропдаунов и мобильного бургер-Sheet (Фаза 2 миграции; заменяет JSX-пары
// Employee.jsx/EndUser.jsx). Условия видимости — 1:1 с легаси, кроме одной
// починки: раздел с подпунктами виден, если виден хотя бы один подпункт
// (легаси скрывал «Отчёты» целиком у пользователей только с финансовыми
// правами). Иконки сведены к набору Remix (Ri*) — правило гайда.
//
// Форма элемента:
//   { key, label, shortLabel?, icon, to }                — ссылка
//   { key, label, icon, groups: [[item, …], […]] }       — раздел; groups
//     рендерятся с разделителями между непустыми группами
const link = (key, label, icon, to, extra = {}) => ({
  key,
  label,
  icon,
  to,
  ...extra,
});

export function buildMenu({
  isEndUser,
  isAdmin,
  permissions = {},
  modules,
  dashboardActive,
}) {
  const {
    canManageTicketCategories,
    canManageCompanies,
    canManageUsers,
    canManageRoutineTasks,
    canSeeWorksReport,
    canSeeAnalytics,
    canUseTimeTrackingModule,
    canUseInventoryModule,
    canManageMikrotikDevices,
    canManageMikrotikConfigs,
    canManageClientDevices,
    canSeeGlobalFinancialReport,
    canSeePersonalFinancialReport,
    canManageServicePlans,
    canPerformTickets,
    canSeeKnowledgeBase,
  } = permissions;

  const timeTracking = !!modules?.timeTracking?.isActive;
  const inventory = !!modules?.inventory?.isActive;
  const knowledgeBase = !!modules?.knowledgeBase?.isActive;

  if (isEndUser) {
    const reports = [
      timeTracking &&
        canUseTimeTrackingModule &&
        canSeeWorksReport &&
        link("report-work", "Отчёт по работам", RiDraftLine, "/report/work"),
      timeTracking &&
        canUseTimeTrackingModule &&
        canSeeAnalytics &&
        link(
          "report-analytics",
          "Аналитика",
          RiBuilding2Line,
          "/report/analytics",
        ),
    ].filter(Boolean);

    return [
      dashboardActive &&
        link("dashboard", "Dashboard", RiDashboard2Line, "/dashboard"),
      link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
      link(
        "ticket-templates",
        "Шаблоны заявок",
        RiFileList3Line,
        "/ticket-templates",
      ),
      link("closed-tickets", "Архив заявок", RiArchiveLine, "/closed-tickets", {
        shortLabel: "Архив",
      }),
      inventory &&
        canUseInventoryModule &&
        link(
          "client-devices",
          "Устройства",
          RiDeviceLine,
          "/inventory/client-devices",
        ),
      knowledgeBase &&
        canSeeKnowledgeBase &&
        link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base"),
      reports.length > 0 && {
        key: "reports",
        label: "Отчёты",
        icon: RiDraftLine,
        groups: [reports],
      },
    ].filter(Boolean);
  }

  // --- Сотрудник ---
  const reportGroups = [
    [
      timeTracking &&
        canUseTimeTrackingModule &&
        canSeeWorksReport &&
        link("report-work", "Отчёт по работам", RiDraftLine, "/report/work"),
      timeTracking &&
        canUseTimeTrackingModule &&
        canSeeAnalytics &&
        link(
          "report-analytics",
          "Аналитика",
          RiBuilding2Line,
          "/report/analytics",
        ),
      inventory &&
        canUseInventoryModule &&
        canManageMikrotikDevices &&
        link(
          "report-networks",
          "Диапазоны сетей",
          RiDraftLine,
          "/report/networks",
        ),
    ].filter(Boolean),
    [
      canSeeGlobalFinancialReport &&
        link(
          "fin-summary",
          "Согласование отчётов",
          RiDraftLine,
          "/finances/summary-report",
        ),
      (canSeePersonalFinancialReport ||
        canSeeGlobalFinancialReport ||
        isAdmin) &&
        link(
          "fin-personal",
          "Персональный отчёт",
          RiContactsLine,
          "/finances/personal-report",
        ),
      canSeeGlobalFinancialReport &&
        link(
          "fin-employees",
          "Отчёт по сотрудникам",
          RiTeamLine,
          "/finances/employee-report",
        ),
    ].filter(Boolean),
  ].filter((group) => group.length > 0);

  const adminGroups = isAdmin
    ? [
        [
          link(
            "adm-ticket-templates",
            "Шаблоны заявок",
            RiFileList3Line,
            "/ticket-templates",
          ),
          canManageRoutineTasks &&
            link(
              "adm-routine-tasks",
              "Регламентные задания",
              RiCalendar2Line,
              "/routine-tasks",
            ),
          canManageTicketCategories &&
            link(
              "adm-ticket-categories",
              "Категории заявок",
              RiServerLine,
              "/ticket-categories",
            ),
          canManageCompanies &&
            link("adm-companies", "Компании", RiBuilding2Line, "/companies"),
          (canManageUsers || isAdmin) &&
            link("adm-users", "Пользователи", RiTeamLine, "/users"),
        ].filter(Boolean),
        [
          canManageServicePlans &&
            link(
              "adm-service-plans",
              "Услуги",
              RiServiceLine,
              "/finances/service-plans",
            ),
        ].filter(Boolean),
        [
          canManageClientDevices &&
            link(
              "adm-locations",
              "Расположения",
              RiMapPinLine,
              "/inventory/locations",
            ),
        ].filter(Boolean),
        [
          canManageClientDevices &&
            link(
              "adm-device-types",
              "Типы устройств",
              RiApps2Line,
              "/inventory/device-types",
            ),
          canManageClientDevices &&
            link(
              "adm-vendors",
              "Вендоры",
              RiBuilding4Line,
              "/inventory/vendors",
            ),
          canManageClientDevices &&
            link(
              "adm-device-attributes",
              "Атрибуты устройств",
              RiListSettingsLine,
              "/inventory/device-attributes",
            ),
          canManageClientDevices &&
            link(
              "adm-device-models",
              "Модели устройств",
              RiDeviceLine,
              "/inventory/device-models",
            ),
        ].filter(Boolean),
        [
          link(
            "adm-preferences",
            "Настройки системы",
            RiSettings3Line,
            "/preferences",
          ),
        ],
      ].filter((group) => group.length > 0)
    : [];

  return [
    dashboardActive &&
      link("dashboard", "Dashboard", RiDashboard2Line, "/dashboard"),
    link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
    knowledgeBase &&
      canSeeKnowledgeBase &&
      link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base"),
    canPerformTickets &&
      !canManageCompanies &&
      link("companies", "Компании", RiBuilding2Line, "/companies"),
    inventory &&
      canUseInventoryModule &&
      link(
        "client-devices",
        "Устройства",
        RiDeviceLine,
        "/inventory/client-devices",
      ),
    canPerformTickets &&
      !canManageUsers &&
      link("users", "Пользователи", RiTeamLine, "/users"),
    !canPerformTickets &&
      link(
        "ticket-templates",
        "Шаблоны заявок",
        RiFileList3Line,
        "/ticket-templates",
      ),
    reportGroups.length > 0 && {
      key: "reports",
      label: "Отчёты",
      icon: RiDraftLine,
      groups: reportGroups,
    },
    inventory &&
      (canManageMikrotikDevices || canManageMikrotikConfigs) && {
        key: "monitoring",
        label: "Мониторинг",
        icon: RiPulseLine,
        groups: [
          [link("mikrotik", "Mikrotik", RiRouterLine, "/devices/mikrotik")],
        ],
      },
    adminGroups.length > 0 && {
      key: "admin",
      label: "Администрирование",
      icon: RiSettings3Line,
      groups: adminGroups,
    },
    link("closed-tickets", "Архив заявок", RiArchiveLine, "/closed-tickets", {
      shortLabel: "Архив",
    }),
  ].filter(Boolean);
}
