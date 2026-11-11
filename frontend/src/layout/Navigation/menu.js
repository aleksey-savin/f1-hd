import { CONVERSATION_READ_ACCESS } from "../../util/conversation-access.js";
import {
  RiApps2Line,
  RiArchiveLine,
  RiBookOpenLine,
  RiBuilding2Line,
  RiBuilding4Line,
  RiCalendar2Line,
  RiCheckboxLine,
  RiContactsLine,
  RiComputerLine,
  RiDashboard2Line,
  RiDeviceLine,
  RiDiscussLine,
  RiDraftLine,
  RiFileList3Line,
  RiListCheck2,
  RiListSettingsLine,
  RiShoppingCart2Line,
  RiMapPinLine,
  RiPriceTag3Line,
  RiPulseLine,
  RiRouterLine,
  RiServerLine,
  RiShieldKeyholeLine,
  RiSettings3Line,
  RiTeamLine,
  RiTaxiLine,
  RiToolsLine,
} from "react-icons/ri";
import { TAXI_REPORT_ACCESS } from "../../util/taxi-access.js";
import { canOpenGlobalSettings } from "../../util/global-settings-access.ts";

// Конфиг главной навигации — единый источник для левого sidebar и мобильного
// бургер-Sheet. Структура — по согласованному макету
// реорганизации меню: «Компании» и «Пользователи» видны всем ролям с
// доступом и не прыгают в «Администрирование», MikroTik и Proxmox — внутри
// «Инфраструктуры» (раздел сохраняется и с одним доступным модулем),
// «Архив» (заявки + работы, /archive) — последний пункт, «Настройки системы»
// — отдельная ссылка перед ним. Раздел виден, если виден хотя бы один его пункт.
// У клиента меню короче: «Главная» (она же его список заявок), «Устройства»,
// «База знаний» и «Отчёты» по правам и модулям, «Архив»; пункта «Заявки» у
// него нет — см. комментарий в ветке.
//
// Форма элемента:
//   { key, label, icon, to, badge? }       — ссылка; badge:
//     "conversations" — пилюля «Ждут ответа» (Conversation/NavBadges)
//   { key, label, icon, groups: [...], defaultOpen?: boolean } — раздел;
//     группа: { label?, items: [item, …] } — label — подпись группы
//     («Справочники» внутри «Учёта техники»). Sidebar и drawer показывают
//     полные названия.
//     Разделы открыты по умолчанию; defaultOpen: false сворачивает раздел.
const link = (key, label, icon, to, extra = {}) => ({
  key,
  label,
  icon,
  to,
  ...extra,
});

// После проверки прав раздел с одной ссылкой становится обычным пунктом.
// Инфраструктура сохраняет устойчивое место даже с одним доступным модулем.
function singleLinkSection(item) {
  if (!item.groups || item.key === "management") return item;
  const children = item.groups.flatMap((group) => group.items);
  if (children.length !== 1) return item;
  const child = children[0];
  if (item.key !== "reports") return child;
  const labels = {
    "report-companies": "Отчёт по компаниям",
    "fin-employees": "Отчёт по сотрудникам",
    "report-taxi": "Отчёт по такси",
  };
  return { ...child, label: labels[child.key] ?? child.label };
}

// Вложенный справочник /tickets/checklist-templates принадлежит
// «Администрированию», а не одновременно двум пунктам меню.
export function activeMenuKey(items, pathname) {
  const path = pathname === "/" ? "/dashboard" : pathname;
  const links = items.flatMap((item) =>
    item.groups ? item.groups.flatMap((group) => group.items) : [item],
  );
  return links
    .filter((item) => path === item.to || path.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]?.key;
}

export function buildMenu({
  isEndUser,
  // Права спрашиваем ФУНКЦИЕЙ, а не плоским набором ключей: плоского набора
  // больше нет, а восемнадцать выдернутых из него имён и были тем местом, где
  // меню расходилось со словарём.
  can,
  modules,
  hideWorkStatus,
}) {
  const canReadTicketCategories = can({ ticketCategory: ["read"] });
  const canReadTicketTemplates = can({ ticketTemplate: ["read"] });
  const canReadChecklistTemplates = can({ checklistTemplate: ["read"] });
  const canReadCompanies = can({ company: ["read"] });
  const canReadUsers = can({ user: ["read"] });
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
  const canReadConversations = can(CONVERSATION_READ_ACCESS);

  const timeTracking = !!modules?.timeTracking?.isActive;
  const inventory = !!modules?.inventory?.isActive;
  const knowledgeBase = !!modules?.knowledgeBase?.isActive;
  const finances = !!modules?.finances?.isActive;
  const mikrotik = !!modules?.mikrotik?.isActive;
  const messaging = !!modules?.messaging?.isActive;
  const settingsLink =
    canOpenGlobalSettings(can) &&
    link("preferences", "Настройки системы", RiSettings3Line, "/preferences");

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
      canReadCompanies &&
        link("companies", "Компания", RiBuilding2Line, "/companies"),
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
        ),
      reports.length > 0 && {
        key: "reports",
        label: "Отчёты",
        icon: RiDraftLine,
        groups: [{ items: reports }],
      },
      settingsLink,
      link("archive", "Архив", RiArchiveLine, "/archive"),
    ]
      .filter(Boolean)
      .map(singleLinkSection);
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
        can(TAXI_REPORT_ACCESS) &&
          link("report-taxi", "Такси", RiTaxiLine, "/report/taxi"),
      ].filter(Boolean),
    },
  ].filter((group) => group.items.length > 0);

  // Рабочий список техники и его справочники находятся в одном разделе.
  const inventoryCatalogItems = (
    inventory
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
  ).filter(Boolean);

  const inventoryGroups = [
    {
      items: [
        inventory &&
          canReadDevices &&
          link(
            "client-devices",
            "Устройства",
            RiDeviceLine,
            "/inventory/client-devices",
          ),
      ].filter(Boolean),
    },
    { label: "Справочники", items: inventoryCatalogItems },
  ].filter((group) => group.items.length > 0);

  // У каждого справочника собственное право, без общего административного гейта.
  const administration = [
    canReadRoles && link("adm-roles", "Роли", RiShieldKeyholeLine, "/roles"),
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
    finances &&
      canReadServicePlans &&
      link(
        "adm-service-plans",
        "Услуги",
        RiPriceTag3Line,
        "/finances/service-plans",
      ),
  ].filter(Boolean);
  const managementItems = [
    mikrotik &&
      canReadMikrotik &&
      link("mikrotik", "MikroTik", RiRouterLine, "/devices/mikrotik"),
    modules?.proxmox?.isActive &&
      can({ proxmox: ["read"] }) &&
      link("proxmox", "Proxmox", RiServerLine, "/devices/proxmox"),
  ].filter(Boolean);

  return [
    link("dashboard", "Главная", RiDashboard2Line, "/dashboard"),
    link("tickets", "Заявки", RiCheckboxLine, "/tickets"),
    // «Диалоги» — сразу за заявками: это та же работа с клиентом (канва A1).
    // Пилюля — сколько диалогов ждут ответа
    messaging &&
      canReadConversations &&
      link("conversations", "Диалоги", RiDiscussLine, "/conversations", {
        badge: "conversations",
      }),
    canReadCompanies &&
      link("companies", "Компании", RiBuilding2Line, "/companies"),
    canReadUsers && link("users", "Пользователи", RiContactsLine, "/users"),
    // Календарь команды отвечает, кто сегодня работает и кого можно послать к
    // клиенту, — поэтому живёт рядом с табло присутствия: внизу рейла статусов
    // (десктоп) и в блоке «Команда сейчас» (телефон). Пунктом меню он остаётся
    // только тем, у кого рейла и блока нет, — `hideWorkStatus` снимает оба, и
    // без пункта в календарь было бы не попасть. Право обязательно: страница и
    // её данные за `schedule.read`.
    hideWorkStatus &&
      canReadSchedule &&
      link(
        "team-calendar",
        "Календарь команды",
        RiCalendar2Line,
        "/team/calendar",
      ),
    knowledgeBase &&
      canReadKnowledge &&
      link("knowledge-base", "База знаний", RiBookOpenLine, "/knowledge-base"),
    managementItems.length > 0 && {
      key: "management",
      label: "Инфраструктура",
      icon: RiPulseLine,
      groups: [{ items: managementItems }],
    },
    inventoryGroups.length > 0 && {
      key: "inventory",
      label: "Учёт техники",
      defaultOpen: false,
      icon: RiComputerLine,
      groups: inventoryGroups,
    },
    reportGroups.length > 0 && {
      key: "reports",
      label: "Отчёты",
      icon: RiDraftLine,
      groups: reportGroups,
    },
    administration.length > 0 && {
      key: "admin",
      // Без короткой подписи намеренно: «Админ» читалось как роль, а не раздел
      label: "Администрирование",
      defaultOpen: false,
      icon: RiToolsLine,
      groups: [{ items: administration }],
    },
    settingsLink,
    link("archive", "Архив", RiArchiveLine, "/archive"),
  ]
    .filter(Boolean)
    .map(singleLinkSection);
}
