const {
  loadAccessibleTicket,
  assertTicketsAccessible,
  canActOnOwnTicket,
  canActOnOwnTickets,
  canJoinTicket,
  canJoinTickets,
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
 *   • администратор проходит всюду — но не отдельной веткой, а потому, что
 *     `effectivePermissions` выдаёт ему весь словарь сотрудника, и тот лежит в
 *     его `statements`. Поэтому ни в одном гейте ПРАВА нет проверки `isAdmin`:
 *     решение принимает один и тот же `can()` для всех. Гейт `isAdmin` ниже —
 *     исключение по смыслу: он закрывает ручки, доступные не по праву, а только
 *     учётной записи администратора (ручки бота, `routes/bot.js`). Раньше
 *     `canSeeKnowledgeBase` был единственным из двадцати, кто доставал
 *     `isAdmin` из документа и не использовал — админ не попадал в базу знаний
 *     без явной галочки;
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
 * проходит всюду по тому же набору: словарь сотрудника целиком лежит в его
 * `statements`.
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
 * Поднятые заявки кладём в `req.tickets`: следующие гейты (массовые варианты
 * `requireOwnTicketOrManage` и `requireJoinable`) решают по самим документам,
 * и второе чтение тех же записей не окупается.
 *
 * @param {(req) => string[]} locate — где лежит список идентификаторов.
 */
module.exports.requireTicketsAccess = (locate) => [
  requireAuth,
  async (req, res, next) => {
    try {
      req.tickets = await assertTicketsAccessible(req.auth, locate(req));
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

/**
 * Своя карточка или право ВИДЕТЬ чужие. Отдельный гейт нужен потому, что
 * «Мой аккаунт» (`pages/User/MyAccount.jsx`) читает собственный профиль той же
 * ручкой `GET /api/users/:id`: под одним `user.read` страница ложилась у всех,
 * у кого права смотреть чужие карточки нет (`client`, `client-manager`,
 * `kb-moderator`) — человек не видел собственных данных.
 */
module.exports.selfOrCanReadUsers = [
  requireAuth,
  (req, res, next) =>
    String(req.params.id) === String(req.auth.userId) ||
    req.auth.can({ user: ["read"] })
      ? next()
      : deny(req, res, PAGE),
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

/**
 * Вернуть заявку в работу может тот, кто с заявками работает, — и САМ
 * ЗАЯВИТЕЛЬ: закрытая, но не решённая заявка это его вопрос, а комментарий в
 * закрытую, которого никто не разберёт, хуже открытой заново заявки.
 *
 * Стоит ПОСЛЕ `requireTicketAccess`: смотрит на саму заявку, а её поднимает он.
 *
 * Архив запрещает возврат всем: заявка привязана к отчёту за период. До сих пор
 * это обещал только интерфейс — ручка архивную заявку открывала обратно.
 */
module.exports.canReturnTicket = (req, res, next) => {
  const ticket = req.ticket;

  if (ticket?.isArchived) {
    return deny(req, res, "Заявка в архиве — вернуть её в работу нельзя");
  }

  const applicantId = ticket?.applicantId?._id ?? ticket?.applicantId;
  const mine =
    applicantId && String(applicantId) === String(req.auth.userId);

  // Ответственный, ведущий заявки — или сам заявитель. Бывшего «любой, кто
  // берёт заявки» здесь нет: возврат чужой закрытой заявки не делает человека
  // ответственным, он просто открывает работу заново за другого.
  return canActOnOwnTicket(ticket, req.auth) || mine
    ? next()
    : deny(
        req,
        res,
        "У пользователя отсутствует разрешение на возврат заявки в работу",
      );
};

/**
 * Действие над СВОЕЙ заявкой — закрыть, отказаться, изменить срок, запросить
 * помощь, отметить пункт чек-листа. Правило живёт в `services/ticketAccess`
 * (`canActOnOwnTicket`): ответственный или «Вести заявки».
 *
 * Стоит ПОСЛЕ `requireTicketAccess`, как `canReturnTicket`: читает `req.ticket`.
 * Права «Брать заявки в работу» самого по себе не хватает — до сих пор хватало,
 * и исполнитель мог закрыть заявку коллеги мимо интерфейса.
 */
const OWN_DENIED = "Действие доступно ответственному за заявку";

module.exports.requireOwnTicketOrManage = [
  requireAuth,
  (req, res, next) =>
    canActOnOwnTicket(req.ticket, req.auth)
      ? next()
      : deny(req, res, OWN_DENIED),
];

/**
 * То же по списку — правило там же (`canActOnOwnTickets`): подходить должна
 * КАЖДАЯ заявка выделения, а не первая, и пустой список не проходит
 * (`requireTicketsAccess` до него и так отвечает 400 на пустой список).
 */
module.exports.requireOwnTicketsOrManage = [
  requireAuth,
  (req, res, next) =>
    canActOnOwnTickets(req.tickets, req.auth)
      ? next()
      : deny(req, res, OWN_DENIED),
];

/**
 * Присоединиться к заявке — принять в работу, встать в ответственные, забрать
 * себе (`takeOver`). Правило — `canJoinTicket`: ответственный, «Присоединяться
 * к чужим заявкам» или «Вести заявки».
 *
 * Отдельный гейт, а не `requireOwnTicketOrManage`: именно этим действием заявка
 * и становится своей, требовать «быть ответственным» было бы замкнутым кругом.
 */
const JOIN_DENIED =
  "Присоединяться к чужим заявкам можно только с правом «Присоединяться к чужим заявкам»";

module.exports.requireJoinable = [
  requireAuth,
  (req, res, next) =>
    canJoinTicket(req.ticket, req.auth) ? next() : deny(req, res, JOIN_DENIED),
];

/** То же по списку — `canJoinTickets`: каждая заявка выделения (см. выше). */
module.exports.requireJoinableTickets = [
  requireAuth,
  (req, res, next) =>
    canJoinTickets(req.tickets, req.auth)
      ? next()
      : deny(req, res, JOIN_DENIED),
];

module.exports.canPerformTickets = requirePermission(
  { ticket: ["perform"] },
  "У пользователя отсутствует разрешение на выполнение заявки",
);
module.exports.canManageTickets = requirePermission(
  { ticket: ["manage"] },
  "У пользователя отсутствует разрешение вести заявки",
);
module.exports.canDeleteTickets = requirePermission(
  { ticket: ["delete"] },
  "У пользователя отсутствует разрешение на удаление заявки",
);

// --- справочники заявок и регламенты -----------------------------------
//
// Гейта на `ticketTemplate.manage` здесь нет намеренно: шаблон заявки правится
// по своим правилам (личный шаблон — своим владельцем без права), и решение
// принимает `controllers/ticketTemplate.js`. Гейт был, но ни на одном маршруте
// не стоял — мидлварь, которую никто не вызывает, врёт о том, что маршрут закрыт.
module.exports.canManageTicketCategories = requirePermission(
  { ticketCategory: ["manage"] },
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
module.exports.canReadRoutineTasks = requirePermission({ routineTask: ["read"] }, PAGE);

// --- работы и отчёты ------------------------------------------------------

module.exports.canReadWorks = requirePermission({ work: ["read"] }, PAGE);
module.exports.canLogWorks = requirePermission(
  { work: ["log"] },
  "Недостаточно прав для записи работ",
);
// Правка и удаление работы: «свои» пишет тот, кто ведёт учёт, чужие — тот, кому
// они доверены. Двумя гейтами подряд это было бы И, а нужно ИЛИ: право на чужие
// работы без права записи иначе не работало бы вовсе.
//
// Отдельного `canManageWorks` нет по той же причине, что и гейта на шаблоны
// заявок: он не стоял ни на одном маршруте (везде нужен этот ИЛИ), а разбор
// «своя работа или чужая» делает контроллер.
module.exports.canLogOrManageWorks = requirePermission(
  [{ work: ["log"] }, { work: ["manage"] }],
  "Недостаточно прав для правки работ",
);
module.exports.canReadCompaniesReport = requirePermission(
  { report: ["companies"] },
  "Недостаточно прав для просмотра отчёта",
);
module.exports.canReadEmployeesReport = requirePermission(
  { report: ["employees"] },
  PAGE,
);
// Ручка обслуживает и свой отчёт, и чужой; чей именно — решает контроллер:
// свой требует `report.own`, чужой — `report.employees`, и одно другого не
// подразумевает. Гейт роута поэтому пускает обладателя любого из двух.
module.exports.canReadPersonalReport = requirePermission(
  [{ report: ["own"] }, { report: ["employees"] }],
  PAGE,
);

// --- согласование работ ---------------------------------------------------

module.exports.canManageApproval = requirePermission(
  { approval: ["manage"] },
  PAGE,
);
module.exports.canReadApproval = requirePermission({ approval: ["read"] }, PAGE);
module.exports.canDecideApproval = requirePermission(
  { approval: ["decide"] },
  "Недостаточно прав, чтобы согласовывать отчёты",
);

// --- услуги, компании, люди, роли ----------------------------------------

/**
 * Список и карточка услуги: РАЗДЕЛ услуг открывает `servicePlan.read` (у клиента
 * это «услуги своей компании», кому какие — решает контроллер), а остальные два
 * варианта — это ВЫПАДАЮЩИЙ СПИСОК ВНУТРИ ЧУЖОЙ ФОРМЫ, который своего права не
 * требует (спека 2026-09-11): услуга подключается с карточки компании
 * (`company.manage`) и выбирается в форме категории заявок
 * (`ticketCategory.manage`, загрузчики `pages/TicketCategory/Add|Update`).
 *
 * Варианты складываются по ИЛИ — тремя гейтами подряд это было бы И.
 *
 * Отдельного `canReadServicePlans` больше нет: он не стоял ни на одном
 * маршруте, а гейт, которого нет на маршруте, — обещание, а не защита.
 */
module.exports.canReadOrPickServicePlans = requirePermission(
  [
    { servicePlan: ["read"] },
    { company: ["manage"] },
    { ticketCategory: ["manage"] },
  ],
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
module.exports.canModerateKnowledge = requirePermission(
  { knowledge: ["moderate"] },
  "Недостаточно прав для модерации базы знаний",
);

// --- оборудование ---------------------------------------------------------

module.exports.canReadDevices = requirePermission({ device: ["read"] }, PAGE);
module.exports.canManageDevices = requirePermission(
  { device: ["manage"] },
  "Недостаточно прав",
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

module.exports.canManageSettings = requirePermission(
  { settings: ["manage"] },
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
