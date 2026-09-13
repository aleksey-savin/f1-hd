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
  RiListCheck2,
  RiListSettingsLine,
  RiShoppingCart2Line,
  RiMapPinLine,
  RiPriceTag3Line,
  RiPulseLine,
  RiServerLine,
  RiShieldKeyholeLine,
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
// У клиента меню короче: «Главная» (она же его список заявок), «Устройства»,
// «База знаний» и «Отчёты» по правам и модулям, «Архив»; пункта «Заявки» у
// него нет — см. комментарий в ветке.
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
  // Права спрашиваем ФУНКЦИЕЙ, а не плоским набором ключей: плоского набора
  // больше нет, а восемнадцать выдернутых из него имён и были тем местом, где
  // меню расходилось со словарём.
  can,
  modules,
  // Интеграция Mikrotik — свой рубильник, от модулей не зависит
  mikrotikActive = false,
}) {
  const canReadTicketCategories = can({ ticketCategory: ["read"] });
  const canReadTicketTemplates = can({ ticketTemplate: ["read"] });
  const canReadChecklistTemplates = can({ checklistTemplate: ["read"] });
  const canReadCompanies = can({ company: ["read"] });
  const canReadUsers = can({ user: ["read"] });
  const canPerformTickets = can({ ticket: ["perform"] });
  const canReadRoles = can({ role: ["read"] });
  const canReadRoutineTasks = can({ routineTask: ["read"] });
  const canReadCompaniesReport = can({ report: ["companies"] });
  const canReadDevices = can({ device: ["read"] });
  const canReadInventoryCatalog = can({ inventoryCatalog: ["read"] });
  const canReadSuppliers = can({ supplier: ["read"] });
  const canReadMikrotik = can({ mikrotik: ["read"] });
  const canReadServicePlans = can({ servicePlan: ["read"] });
  const canReadEmployeesReport = can({ report: ["employees"] });
  const canReadOwnReport = can({ report: ["own"] });
  const canReadKnowledge = can({ knowledge: ["read"] });
  const canReadApproval = can({ approval: ["read"] });
  const canReadSchedule = can({ schedule: ["read"] });

  const timeTracking = !!modules?.timeTracking?.isActive;
  const inventory = !!modules?.inventory?.isActive;
  const knowledgeBase = !!modules?.knowledgeBase?.isActive;
  const finances = !!modules?.finances?.isActive;

  if (isEndUser) {
    const reports = [
      timeTracking &&
        canReadCompaniesReport &&
        link(
          "report-companies",
          "Компании",
          RiBuilding2Line,
          "/report/companies",
        ),
      // Согласование отчётов по услугам со стороны клиента. Право открывает
      // раздел, объём даёт роль (backend services/reportApprovalScope):
      // назначенный согласующий видит отчёт целиком, руководитель филиала —
      // свою часть. canUseFinancesModule тут НЕ нужен: финансовый модуль
      // целиком согласующему не положен.
      finances &&
        canReadApproval &&
        link(
          "approval",
          "Согласование работ",
          RiDraftLine,
          "/finances/approval",
        ),
    ].filter(Boolean);

    return [
      link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
      canReadCompanies && link("companies", "Компания", RiBuilding2Line, "/companies"),
      canReadUsers && link("users", "Пользователи", RiContactsLine, "/users"),
      // Пункта «Заявки» у клиента нет (2026-09). Открытых заявок у него единицы
      // (самое большое — четыре, у компании целиком — пятнадцать), и список с
      // очередями, фасетами и поиском отвечал ему на тот же вопрос, что блок
      // «Мои заявки» на главной: активные — там, с раскрытием «Показать все N»,
      // закрытые — в «Архиве». Прямой адрес /tickets клиента отправляет на
      // главную (`pages/Ticket/List`), крошка карточки и 404 сразу называют
      // главную (`util/sections`, `sectionAs`).
      // Пункта «Шаблоны заявок» у клиента нет: страница закрыта правом
      // `ticketTemplate.read`, и ссылка вела на 403. Заготовки клиент видит
      // там, где они ему нужны, — плитками «Чем помочь?» на главной
      inventory &&
        canReadDevices &&
        link(
          "client-devices",
          "Устройства",
          RiDeviceLine,
          "/inventory/client-devices",
        ),
      knowledgeBase &&
        canReadKnowledge &&
        link(
          "knowledge-base",
          "База знаний",
          RiBookOpenLine,
          "/knowledge-base",
          {
            shortLabel: "База знаний",
          },
        ),
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
  // Отчёты — плоский список без групп: их всего три, и заголовок «Финансы»
  // над двумя пунктами делил раздел там, где делить нечего. Слово «отчёт» в
  // пунктах не повторяем — оно уже в названии раздела.
  // Гейт зеркален API: весь /finances смонтирован за financesModuleIsActive +
  // canUseFinancesModule (routes/index.js).
  const reportGroups = [
    {
      items: [
        timeTracking &&
          canReadCompaniesReport &&
          link(
            "report-companies",
            "Компании",
            RiBuilding2Line,
            "/report/companies",
          ),
        // Отчёты «Персональный» и «По сотрудникам» слиты в один раздел:
        // с полным правом — сводная по всем («Сотрудники», клик по строке
        // открывает отчёт сотрудника), иначе — только свой («Мой отчёт»).
        finances &&
          canReadEmployeesReport &&
          link(
            "fin-employees",
            "Сотрудники",
            RiTeamLine,
            "/finances/employees",
          ),
        finances &&
          !canReadEmployeesReport &&
          canReadOwnReport &&
          link(
            "fin-personal",
            "Мой отчёт",
            RiContactsLine,
            "/finances/my-report",
          ),
        finances &&
          canReadApproval &&
          link(
            "fin-approval",
            "Согласование работ",
            RiDraftLine,
            "/finances/approval",
          ),
      ].filter(Boolean),
    },
  ].filter((group) => group.items.length > 0);

  // «Люди» — раздел о сотрудниках и клиентах. Календарь команды жил в
  // «Отчётах», но отчёт из него никакой: он отвечает, кто сегодня работает и
  // кого можно послать к клиенту, — это ежедневный оперативный экран.
  // Право обязательно: и страница, и её данные за `schedule.read` — без него
  // пункт вёл на «Нет доступа». Свой график и свои отсутствия человек видит в
  // своей карточке, права на это не нужно.
  const peopleItems = [
    canReadUsers && link("users", "Пользователи", RiContactsLine, "/users"),
    canReadSchedule &&
      link(
        "team-calendar",
        "Календарь команды",
        RiCalendar2Line,
        "/team/calendar",
      ),
  ].filter(Boolean);

  // Группы «Администрирования» подписаны по модулям; «Компании»,
  // «Пользователи» и «Настройки системы» отсюда ушли (верхний уровень и
  // меню аватара соответственно).
  //
  // ВНЕШНЕГО `isAdmin ?` здесь больше нет. Он закрывал всю ветку целиком, и
  // проверки прав у отдельных пунктов внутри были мертвы: человек с правом на
  // регламенты, категории или услуги не видел пункта нигде, хотя сервер его
  // пускал. Теперь у каждого пункта работает его собственное право, а пустая
  // группа отсеивается ниже (`group.items.length > 0`).
  const accessGroup = canReadRoles
    ? [
        {
          label: "Доступ",
          items: [link("adm-roles", "Роли", RiShieldKeyholeLine, "/roles")],
        },
      ]
    : [];

  const adminGroups = [
    {
      label: "Заявки",
      items: [
        canReadTicketTemplates &&
          link(
            "adm-ticket-templates",
            "Шаблоны заявок",
            RiFileList3Line,
            "/ticket-templates",
          ),
        canReadChecklistTemplates &&
          link(
            "adm-checklist-templates",
            "Шаблоны чек-листов",
            RiListCheck2,
            "/tickets/checklist-templates",
          ),
        canReadRoutineTasks &&
          link(
            "adm-routine-tasks",
            "Регламенты",
            RiCalendar2Line,
            "/routine-tasks",
          ),
        canReadTicketCategories &&
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
          canReadServicePlans &&
          link(
            "adm-service-plans",
            "Услуги",
            RiPriceTag3Line,
            "/finances/service-plans",
          ),
      ].filter(Boolean),
    },
    {
      label: "Учёт техники",
      // Модульный гейт как у API; право у каждого справочника своё —
      // раздать поставщиков, не раздавая всю технику, теперь можно
      items: (inventory
        ? [
            canReadDevices &&
              link(
                "adm-locations",
                "Расположения",
                RiMapPinLine,
                "/inventory/locations",
              ),
            canReadInventoryCatalog &&
              link(
                "adm-device-types",
                "Типы устройств",
                RiApps2Line,
                "/inventory/device-types",
              ),
            canReadInventoryCatalog &&
              link(
                "adm-vendors",
                "Вендоры",
                RiBuilding4Line,
                "/inventory/vendors",
              ),
            canReadInventoryCatalog &&
              link(
                "adm-device-attributes",
                "Атрибуты устройств",
                RiListSettingsLine,
                "/inventory/device-attributes",
              ),
            canReadInventoryCatalog &&
              link(
                "adm-device-models",
                "Модели устройств",
                RiDeviceLine,
                "/inventory/device-models",
              ),
            canReadSuppliers &&
              link(
                "adm-suppliers",
                "Поставщики",
                RiShoppingCart2Line,
                "/inventory/suppliers",
              ),
          ]
        : []
      ).filter(Boolean),
    },
  ].filter((group) => group.items.length > 0);

  const administration = [...accessGroup, ...adminGroups];

  return [
    link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
    link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
    canReadCompanies &&
      link("companies", "Компании", RiBuilding2Line, "/companies"),
    peopleItems.length > 0 && {
      key: "people",
      label: "Пользователи",
      icon: RiTeamLine,
      groups: [{ items: peopleItems }],
    },
    inventory &&
      canReadDevices &&
      link(
        "client-devices",
        "Устройства",
        RiDeviceLine,
        "/inventory/client-devices",
      ),
    knowledgeBase &&
      canReadKnowledge &&
      link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base", {
        shortLabel: "База знаний",
      }),
    // Только тем, кто заявки НЕ выполняет: у исполнителя шаблоны и так под
    // рукой в форме заявки, а в «Администрировании» есть полный список для
    // того, кому доверены чужие заготовки. Право обязательно: страница за
    // `ticketTemplate.read`, и без него пункт вёл на 403.
    !canPerformTickets &&
      canReadTicketTemplates &&
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
      canReadMikrotik &&
      link("monitoring", "Мониторинг", RiPulseLine, "/devices/mikrotik"),
    administration.length > 0 && {
      key: "admin",
      // Без короткой подписи намеренно: «Админ» читалось как роль, а не раздел
      label: "Администрирование",
      icon: RiSettings3Line,
      groups: administration,
    },
    link("archive", "Архив", RiArchiveLine, "/archive"),
  ].filter(Boolean);
}
