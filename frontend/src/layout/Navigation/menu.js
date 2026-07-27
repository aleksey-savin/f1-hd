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
  RiServerLine,
  RiServiceLine,
  RiSettings3Line,
  RiTeamLine,
} from "react-icons/ri";

// Конфиг главной навигации — единый источник для десктопного бара, его
// дропдаунов и мобильного бургер-Sheet. Структура — по согласованному макету
// реорганизации меню (2026-07): «Компании» и раздел «Люди» (пользователи +
// календарь команды) видны всем ролям с доступом и не прыгают в
// «Администрирование», «Мониторинг» — прямая ссылка,
// «Архив» (заявки + работы, /archive) — последний пункт, «Настройки системы»
// живут в меню аватара. Раздел виден, если виден хотя бы один его пункт.
//
// Форма элемента:
//   { key, label, shortLabel?, icon, to }               — ссылка
//   { key, label, shortLabel?, icon, groups: [...] }    — раздел-дропдаун;
//     группа: { label?, items: [item, …] } — label — uppercase-заголовок
//     («Администрирование» подписывает группы по модулям), группы рендерятся
//     с разделителями. shortLabel показывает только десктоп-бар (экономия
//     ширины на xl); дропдауны и drawer — полные названия.
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
  // Интеграция Mikrotik — свой рубильник, от модулей не зависит
  mikrotikActive = false,
  dashboardActive,
}) {
  const {
    canManageTicketCategories,
    canManageCompanies,
    canManageUsers,
    canManageRoutineTasks,
    canSeeAnalytics,
    canUseTimeTrackingModule,
    canUseFinancesModule,
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
  const finances = !!modules?.finances?.isActive;

  if (isEndUser) {
    const reports = [
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
        link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
      link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
      link(
        "ticket-templates",
        "Шаблоны заявок",
        RiFileList3Line,
        "/ticket-templates",
      ),
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
        link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base", {
          shortLabel: "База",
        }),
      reports.length > 0 && {
        key: "reports",
        label: "Отчёты",
        icon: RiDraftLine,
        groups: [{ items: reports }],
      },
      link("archive", "Архив", RiArchiveLine, "/archive"),
    ].filter(Boolean);
  }

  // --- Сотрудник ---
  const reportGroups = [
    {
      items: [
        timeTracking &&
          canUseTimeTrackingModule &&
          canSeeAnalytics &&
          link(
            "report-analytics",
            "Аналитика",
            RiBuilding2Line,
            "/report/analytics",
          ),
      ].filter(Boolean),
    },
    {
      // Слово «отчёт» не повторяем — оно уже в названии раздела «Отчёты».
      // Гейт зеркален API: весь /finances смонтирован за
      // financesModuleIsActive + canUseFinancesModule (routes/index.js)
      label: "Финансы",
      items: [
        finances &&
          canUseFinancesModule &&
          canSeeGlobalFinancialReport &&
          link(
            "fin-summary",
            "Согласование",
            RiDraftLine,
            "/finances/summary-report",
          ),
        // Отчёты «Персональный» и «По сотрудникам» слиты в один раздел:
        // с полным правом — сводная по всем («Сотрудники», клик по строке
        // открывает отчёт сотрудника), иначе — только свой («Мой отчёт»).
        finances &&
          canUseFinancesModule &&
          (canSeeGlobalFinancialReport || isAdmin) &&
          link("fin-employees", "Сотрудники", RiTeamLine, "/finances/employees"),
        finances &&
          canUseFinancesModule &&
          !(canSeeGlobalFinancialReport || isAdmin) &&
          canSeePersonalFinancialReport &&
          link("fin-personal", "Мой отчёт", RiContactsLine, "/finances/my-report"),
      ].filter(Boolean),
    },
  ].filter((group) => group.items.length > 0);

  // «Люди» — раздел о сотрудниках и клиентах. Календарь команды жил в
  // «Отчётах», но отчёт из него никакой: он отвечает, кто сегодня работает и
  // кого можно послать к клиенту, — это ежедневный оперативный экран.
  // Смотрят его все сотрудники; правка внутри — под canManageWorkSchedules.
  const peopleItems = [
    (canPerformTickets || canManageUsers || isAdmin) &&
      link("users", "Пользователи", RiContactsLine, "/users"),
    link("team-calendar", "Календарь команды", RiCalendar2Line, "/team/calendar"),
  ].filter(Boolean);

  // Группы «Администрирования» подписаны по модулям; «Компании»,
  // «Пользователи» и «Настройки системы» отсюда ушли (верхний уровень и
  // меню аватара соответственно)
  const adminGroups = isAdmin
    ? [
        {
          label: "Заявки",
          items: [
            link(
              "adm-ticket-templates",
              "Шаблоны заявок",
              RiFileList3Line,
              "/ticket-templates",
            ),
            canManageRoutineTasks &&
              link(
                "adm-routine-tasks",
                "Регламенты",
                RiCalendar2Line,
                "/routine-tasks",
              ),
            canManageTicketCategories &&
              link(
                "adm-ticket-categories",
                "Категории",
                RiServerLine,
                "/ticket-categories",
              ),
          ].filter(Boolean),
        },
        {
          label: "Финансы",
          items: [
            // Модульный гейт как у API: /finances закрыт financesModuleIsActive
            finances &&
              canManageServicePlans &&
              link(
                "adm-service-plans",
                "Услуги",
                RiServiceLine,
                "/finances/service-plans",
              ),
          ].filter(Boolean),
        },
        {
          label: "Учёт техники",
          // Модульный гейт как у API: весь /inventory смонтирован за
          // inventoryModuleIsActive + canUseInventoryModule (routes/index.js)
          items: (inventory && canUseInventoryModule
            ? [
                canManageClientDevices &&
                  link(
                    "adm-locations",
                    "Расположения",
                    RiMapPinLine,
                    "/inventory/locations",
                  ),
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
              ]
            : []
          ).filter(Boolean),
        },
      ].filter((group) => group.items.length > 0)
    : [];

  return [
    dashboardActive &&
      link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
    link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
    (canPerformTickets || canManageCompanies || isAdmin) &&
      link("companies", "Компании", RiBuilding2Line, "/companies"),
    peopleItems.length > 0 && {
      key: "people",
      label: "Люди",
      icon: RiTeamLine,
      groups: [{ items: peopleItems }],
    },
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
      link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base", {
        shortLabel: "База",
      }),
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
    mikrotikActive &&
      (canManageMikrotikDevices || canManageMikrotikConfigs) &&
      link("monitoring", "Мониторинг", RiPulseLine, "/devices/mikrotik"),
    adminGroups.length > 0 && {
      key: "admin",
      label: "Администрирование",
      shortLabel: "Админ",
      icon: RiSettings3Line,
      groups: adminGroups,
    },
    link("archive", "Архив", RiArchiveLine, "/archive"),
  ].filter(Boolean);
}
