const { Ticket } = require("@/models/ticket");

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
 * Доступ к конкретной заявке. Единственный гейт со своей логикой: он смотрит не
 * только на права, но и на отношение человека к самой заявке.
 *
 * Список допусков совпадает со скоупом списка заявок
 * (`controllers/ticket.js`, ветка «остальные пользователи»): ответственный ИЛИ
 * автор ИЛИ заявитель. Без `isCreator` сотрудник, заведший заявку за клиента,
 * видел бы её в списке и получал 403 по клику.
 */
module.exports.allowedToViewTicket = [
  requireAuth,
  async (req, res, next) => {
    try {
      const notFound = () => {
        req.isAuth = false;
        return res
          .status(404)
          .json({ error: true, status: 404, message: "Заявка не найдена" });
      };

      if (isNaN(+req.params.ticketNum)) {
        return notFound();
      }
      const ticket = await Ticket.findOne({ num: req.params.ticketNum });
      if (!ticket) {
        return notFound();
      }

      const { user, can, isAdmin } = req.auth;
      const userId = user._id.toString();

      const isResp = ticket.responsibles
        .map((resp) => resp._id.toString())
        .includes(userId);
      const isApplicant =
        ticket.applicantId?.toString() === userId ||
        ticket.applicant?._id?.toString() === userId;
      const isCreator = ticket.createdBy?.toString() === userId;
      const sameCompany =
        can({ ticket: ["readCompany"] }) &&
        Boolean(user.company?._id) &&
        user.company._id.toString() === ticket.company?._id?.toString();

      const allowed =
        isAdmin ||
        // connector: "OR" — внутри ресурса, а не рядом с ним: список действий
        // по умолчанию складывается по И (`access.mjs#normalizeActionRequest`).
        can({ ticket: { actions: ["administrate", "readAll"], connector: "OR" } }) ||
        isResp ||
        isApplicant ||
        isCreator ||
        sameCompany;

      return allowed
        ? next()
        : deny(req, res, "Недостаточно прав для просмотра страницы");
    } catch (error) {
      next(error);
    }
  },
];

module.exports.canPerformTickets = requirePermission({ ticket: ["perform"] },
  "У пользователя отсутствует разрешение на выполнение заявки",
);
module.exports.canAdministrateTickets = requirePermission({ ticket: ["administrate"] },
  "У пользователя отсутствует разрешение на администрирование заявки",
);
module.exports.canEditTickets = requirePermission({ ticket: ["update"] },
  "У пользователя отсутствует разрешение на редактирование заявки",
);
module.exports.canDeleteTickets = requirePermission({ ticket: ["delete"] },
  "У пользователя отсутствует разрешение на удаление заявки",
);

// --- администрирование портала -------------------------------------------

module.exports.canManageCompanies = requirePermission({ company: ["manage"] }, PAGE);
module.exports.canManageUsers = requirePermission({ user: ["manage"] }, PAGE);
// Раздача ролей — это раздача прав, поэтому право своё, а не производное от
// управления пользователями: вести людей и решать, что им можно, — разные дела.
module.exports.canManageRoles = requirePermission({ role: ["manage"] }, PAGE);
// Читать каталог нужно и тому, кто ролей не правит: в форме человека роль
// выбирают из списка, а выбрать из невидимого списка нельзя.
module.exports.canReadRoles = requirePermission(
  [{ role: ["manage"] }, { user: ["manage"] }],
  PAGE,
);
module.exports.canManageTicketCategories = requirePermission({ ticketCategory: ["manage"] },
  PAGE,
);
module.exports.canManageKnowledgeBase = requirePermission({ knowledgeBase: ["manage"] },
  PAGE,
);
module.exports.canSeeKnowledgeBase = requirePermission({ knowledgeBase: ["read"] }, PAGE);
module.exports.canManageRoutineTasks = requirePermission({ routineTask: ["manage"] },
  PAGE,
);

// --- учёт времени ---------------------------------------------------------

module.exports.canUseTimeTrackingModule = requirePermission({ timeTracking: ["use"] },
  PAGE,
);
module.exports.canSeeWorksReport = requirePermission({ work: ["readReport"] },
  "Недостаточно прав для просмотра данного отчёта",
);
module.exports.canSeeAnalytics = requirePermission({ analytics: ["read"] },
  "Недостаточно прав для просмотра аналитики",
);
module.exports.canManageWorkSchedules = requirePermission({ workSchedule: ["manage"] },
  "Недостаточно прав для управления графиками и отсутствиями",
);

// --- учёт техники ---------------------------------------------------------

module.exports.canUseInventoryModule = requirePermission({ inventory: ["use"] },
  "Недостаточно прав",
);
module.exports.canManageClientDevices = requirePermission({ clientDevice: ["manage"] },
  "Недостаточно прав",
);
module.exports.canManageMikrotikDevices = requirePermission({ mikrotik: ["manageDevices"] },
  PAGE,
);
module.exports.canManageMikrotikConfigs = requirePermission({ mikrotik: ["manageConfigs"] },
  "Недостаточно прав для управления резервными копиями конфигураций Mikrotik",
);

// --- финансы --------------------------------------------------------------

module.exports.canUseFinancesModule = requirePermission({ finances: ["use"] }, PAGE);
module.exports.canSeeGlobalFinancialReport = requirePermission({ finances: ["readGlobalReport"] },
  PAGE,
);
// Раздел открыт и согласующим со стороны клиента, которым финансовый модуль
// целиком не нужен: достаточно любого из двух прав.
module.exports.canUseWorkApproval = requirePermission(
  [{ finances: ["readGlobalReport"] }, { workReport: ["approve"] }],
  PAGE,
);
module.exports.canSeePersonalFinancialReport = requirePermission({ finances: ["readPersonalReport"] },
  PAGE,
);
module.exports.canSeePersonalOrGlobalFinancialReport = requirePermission(
  [{ finances: ["readPersonalReport"] }, { finances: ["readGlobalReport"] }],
  PAGE,
);
module.exports.canConfirmReportActions = requirePermission({ finances: ["confirmActions"] },
  PAGE,
);
module.exports.canManageServicePlans = requirePermission({ servicePlan: ["manage"] }, PAGE);

// Рубильники модулей переехали в ./modules — это настройка установки, а не
// права. Реэкспорт оставлен, чтобы не править импорты в routes/index.js разом.
const modules = require("./modules");
module.exports.timeTrackingModuleIsActive = modules.timeTrackingModuleIsActive;
module.exports.inventoryModuleIsActive = modules.inventoryModuleIsActive;
module.exports.mikrotikIsActive = modules.mikrotikIsActive;
module.exports.financesModuleIsActive = modules.financesModuleIsActive;
module.exports.knowledgeBaseModuleIsActive = modules.knowledgeBaseModuleIsActive;
