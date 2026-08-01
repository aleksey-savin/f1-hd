// Каталог прав пользователя — ОДИН источник для формы (редактирование) и
// карточки (показ выданных). Список жил в двух местах и расходился: право,
// которого нет в форме, каждое сохранение сбрасывало (`user.permissions =
// permissions`). Показываем только те права, которые реально что-то гейтят на
// бэкенде: галочка, ничего не меняющая, врёт администратору.
//
// master — ключ «рубильника» модуля: выключен, значит группа неактивна.

export const PERMISSION_MODULES = [
  {
    key: "tickets",
    label: "Заявки",
    caps: [
      { key: "canSeeAllCompanyTickets", label: "Все заявки своей компании" },
      { key: "canSeeAllTickets", label: "Все заявки в системе" },
      { key: "canPerformTickets", label: "Выполнение заявок" },
      { key: "canAdministrateTickets", label: "Администрирование заявок" },
      { key: "canEditTickets", label: "Полное редактирование" },
      { key: "canDeleteTickets", label: "Удаление заявок" },
    ],
  },
  {
    key: "portal",
    label: "Администрирование портала",
    caps: [
      { key: "canManageCompanies", label: "Управление компаниями" },
      { key: "canManageUsers", label: "Управление пользователями" },
      { key: "canManageTicketCategories", label: "Категории заявок" },
      { key: "canManageRoutineTasks", label: "Регламенты" },
      { key: "canManageTicketTemplates", label: "Шаблоны заявок" },
    ],
  },
  {
    key: "knowledge",
    label: "База знаний",
    caps: [
      { key: "canSeeKnowledgeBase", label: "Просмотр базы знаний" },
      { key: "canManageKnowledgeBase", label: "Управление базой знаний" },
    ],
  },
  {
    key: "time",
    label: "Учёт времени",
    master: "canUseTimeTrackingModule",
    caps: [
      { key: "canAvoidWorks", label: "Можно не указывать работы" },
      { key: "canSeeWorksReport", label: "Отчёты по работам" },
      { key: "canSeeAnalytics", label: "Аналитика и тренды" },
      { key: "canManageWorkSchedules", label: "Графики и отсутствия" },
    ],
  },
  {
    key: "inventory",
    label: "Учёт техники",
    master: "canUseInventoryModule",
    caps: [
      { key: "canManageClientDevices", label: "Управление устройствами" },
      { key: "canManageMikrotikDevices", label: "Устройства Mikrotik" },
      { key: "canManageMikrotikConfigs", label: "Резервные копии Mikrotik" },
    ],
  },
  {
    key: "finances",
    label: "Финансы",
    master: "canUseFinancesModule",
    caps: [
      { key: "canManageServicePlans", label: "Управление услугами" },
      {
        key: "canSeeGlobalFinancialReport",
        label: "Отчёты по оказанным услугам",
      },
      { key: "canConfirmReportActions", label: "Утверждение отчётов" },
      { key: "canSeePersonalFinancialReport", label: "Персональный отчёт" },
    ],
  },
];

// Категории уведомлений — имя ключа едино для notify.byTelegram / notify.byEmail
// и prefs.notify.personal (см. middleware/notifications.js).
export const NOTIFY_EVENTS = [
  { key: "newTicket", label: "Новая заявка" },
  { key: "respStateUpdate", label: "Статус ответственного" },
  { key: "ticketStateUpdate", label: "Изменение статуса заявки" },
  { key: "ticketDeadlineUpdate", label: "Изменение срока" },
  { key: "ticketNewComment", label: "Новые комментарии" },
  { key: "scheduledWorks", label: "Запланированные работы" },
];

// Что применимо КЛИЕНТУ. Клиент не сотрудник, но у него бывает роль
// «директор / секретарь»: видеть заявки всей своей компании, а не только свои.
// Право читает бэкенд при выборе скоупа заявок (controllers/ticket.js), и оно
// реально выдано — форма обязана его показывать и не затирать при сохранении.
export const CLIENT_PERMISSIONS = [
  {
    key: "canSeeAllCompanyTickets",
    label: "Все заявки своей компании",
    hint: "Иначе клиент видит только свои обращения.",
  },
  {
    key: "canApproveWorkReports",
    label: "Согласование отчётов по услугам",
    // Право клиентское, поэтому живёт здесь, а не в модуле «Финансы»: тот
    // закрыт рубильником canUseFinancesModule, который заказчику не положен —
    // финансовый модуль целиком ему не нужен ради одной кнопки «Согласовать».
    hint: "Открывает раздел «Согласование работ». Объём даёт роль: назначенный согласующий услуги видит отчёт целиком, руководитель подразделения — только свою часть.",
  },
];
export const CLIENT_PERMISSION_KEYS = CLIENT_PERMISSIONS.map((cap) => cap.key);

// Все ключи permissions, которыми управляет форма — чтобы собрать полный объект
// и не потерять права, которых нет ни в одной группе.
export const ALL_PERMISSION_KEYS = PERMISSION_MODULES.flatMap((module) => [
  ...(module.master ? [module.master] : []),
  ...module.caps.map((cap) => cap.key),
]);

/**
 * Как ведётся рабочее время сотрудника. Отдельно от типа аккаунта: тип
 * отвечает «кто это», а режим — «управляем ли мы его временем».
 */
export const WORK_TIME_MODES = [
  { value: "scheduled", label: "По графику" },
  { value: "free", label: "Свободный" },
  { value: "none", label: "Не ведётся" },
];

// Тип аккаунта — один сегмент вместо трёх независимых флагов.
export const ACCOUNT_KINDS = [
  { value: "staff", label: "Сотрудник" },
  { value: "client", label: "Клиент" },
  { value: "service", label: "Служебный" },
];

export const kindOfUser = (user) =>
  user?.isServiceAccount
    ? "service"
    : (user?.isEndUser ?? true)
      ? "client"
      : "staff";

// Обратное преобразование сегмента в флаги модели.
export const kindToFlags = (kind, { isCloudTelephony = false } = {}) => ({
  isEndUser: kind === "client",
  isServiceAccount: kind === "service",
  isCloudTelephony: kind === "service" ? !!isCloudTelephony : false,
});
