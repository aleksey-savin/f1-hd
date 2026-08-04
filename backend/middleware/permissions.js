const getAuthData = require("./getAuthData");

const User = require("../models/user");
const { Ticket } = require("../models/ticket");
const Preferences = require("../models/preferences");

module.exports.isAdmin = async (req, res, next) => {
  const authData = await getAuthData(req);
  const authedUser = await User.findById(authData.userId);

  if (!authedUser.isAdmin) {
    req.isAuth = false;
    const error = new Error("Недостаточно прав для просмотра страниц");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.isNotClient = async (req, res, next) => {
  const authData = await getAuthData(req);
  const authedUser = await User.findById(authData.userId);

  if (authedUser.isEndUser) {
    req.isAuth = false;
    const error = new Error("Недостаточно прав для просмотра страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.allowedToViewTicket = async (req, res, next) => {
  // Заявку может открыть админ, ответственный, инициатор или менеджер
  const { userId, permissions } = await getAuthData(req);
  const authedUser = await User.findById(userId);

  if (isNaN(+req.params.ticketNum)) {
    req.isAuth = false;
    const error = new Error("Заявка не найдена");
    error.statusCode = 404;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  const ticket = await Ticket.findOne({ num: req.params.ticketNum });

  if (!ticket) {
    req.isAuth = false;
    const error = new Error("Заявка не найдена");
    error.statusCode = 404;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  const isResp = ticket.responsibles
    .map((resp) => resp._id.toString())
    .includes(authedUser._id.toString());

  const isApplicant =
    ticket.applicantId?.toString() === authedUser._id.toString() ||
    ticket.applicant._id?.toString() === authedUser._id.toString();

  // Автор заявки. Обязателен: список (controllers/ticket.js, ветка «остальные
  // пользователи») пускает по responsibles ИЛИ createdBy ИЛИ applicantId, и без
  // этой строки сотрудник, заведший заявку за клиента, видел бы её в списке и
  // получал 403 по клику.
  const isCreator = ticket.createdBy?.toString() === authedUser._id.toString();

  const canSeeAllCompanyTickets = Boolean(
    permissions?.canSeeAllCompanyTickets &&
      authedUser.company?._id &&
      authedUser.company._id.toString() === ticket.company?._id?.toString(),
  );

  const canSeeAllTickets = Boolean(authedUser.permissions.canSeeAllTickets);

  // Список допусков, а не условие отказа: в прежней записи `canAdministrateTickets`
  // стоял в отказе БЕЗ отрицания, то есть отказ срабатывал только у того, у кого
  // это право ЕСТЬ. У клиента его нет никогда — и он открывал любую заявку в базе
  // вместе с перепиской, контактами заявителя и списком вложений.
  const allowedToView =
    authedUser.isAdmin ||
    Boolean(authedUser.permissions.canAdministrateTickets) ||
    isResp ||
    isApplicant ||
    isCreator ||
    canSeeAllCompanyTickets ||
    canSeeAllTickets;

  if (!allowedToView) {
    req.isAuth = false;
    const error = new Error("Недостаточно прав для просмотра страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canPerformTickets = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);

  const { isAdmin, permissions } = authedUser;

  if (!permissions.canPerformTickets && !isAdmin) {
    req.isAuth = false;
    const error = new Error(
      "У пользователя отсутствует разрешение на выполнение заявки",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.canAdministrateTickets = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { isAdmin, permissions } = authedUser;
  if (!permissions.canAdministrateTickets && !isAdmin) {
    req.isAuth = false;
    const error = new Error(
      "У пользователя отсутствует разрешение на администрирование заявки",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.canEditTickets = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { isAdmin, permissions } = authedUser;

  if (!permissions.canEditTickets && !isAdmin) {
    req.isAuth = false;
    const error = new Error(
      "У пользователя отсутствует разрешение на редактирование заявки",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.canDeleteTickets = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { isAdmin, permissions } = authedUser;

  if (!permissions.canDeleteTickets && !isAdmin) {
    req.isAuth = false;
    const error = new Error(
      "У пользователя отсутствует разрешение на удаление заявки",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.canManageCompanies = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageCompanies && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageUsers = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageUsers && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageTicketCategories = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageTicketCategories && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageKnowledgeBase = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageKnowledgeBase && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canSeeKnowledgeBase = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canSeeKnowledgeBase) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageRoutineTasks = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageRoutineTasks && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// time tracking module
module.exports.canUseTimeTrackingModule = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canUseTimeTrackingModule && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canSeeWorksReport = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canSeeWorksReport && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данного отчёта");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canSeeAnalytics = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canSeeAnalytics && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра аналитики");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// Правка графиков, заведение отсутствий и решение по запросам. Просмотр табеля
// правом не закрыт — он открыт всем не-клиентам (isNotClient).
module.exports.canManageWorkSchedules = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageWorkSchedules && !isAdmin) {
    const error = new Error(
      "Недостаточно прав для управления графиками и отсутствиями",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// inventory module
module.exports.canUseInventoryModule = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canUseInventoryModule && !isAdmin) {
    const error = new Error("Недостаточно прав");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageClientDevices = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageClientDevices && !isAdmin) {
    const error = new Error("Недостаточно прав");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageMikrotikDevices = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageMikrotikDevices && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageMikrotikConfigs = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageMikrotikConfigs && !isAdmin) {
    const error = new Error(
      "Недостаточно прав для управления резервными копиями конфигураций Mikrotik",
    );
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// finances module
module.exports.canUseFinancesModule = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canUseFinancesModule && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canSeeGlobalFinancialReport = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canSeeGlobalFinancialReport && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

/**
 * Раздел «Согласование работ» открыт двум аудиториям: нам (весь конвейер) и
 * согласующим со стороны клиента (только то, что ждёт их подписи). Объём
 * данных считает services/reportApprovalScope — здесь только вход.
 *
 * Отдельно от canUseFinancesModule намеренно: клиенту не нужен доступ к
 * финансовому модулю целиком ради одной кнопки «Согласовать».
 */
module.exports.canUseWorkApproval = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (
    !isAdmin &&
    !permissions.canSeeGlobalFinancialReport &&
    !permissions.canApproveWorkReports
  ) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canSeePersonalFinancialReport = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canSeePersonalFinancialReport && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// Персональный отчёт открывают и «личные», и «глобальные» обладатели прав;
// доступ к чужому userId дополнительно проверяется в контроллере
module.exports.canSeePersonalOrGlobalFinancialReport = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (
    !permissions.canSeePersonalFinancialReport &&
    !permissions.canSeeGlobalFinancialReport &&
    !isAdmin
  ) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canConfirmReportActions = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canConfirmReportActions && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

module.exports.canManageServicePlans = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageServicePlans && !isAdmin) {
    const error = new Error("Недостаточно прав для просмотра данной страницы");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: false,
      status: error.statusCode,
      message: error.message,
    });
  }
  next();
};

// functional modules enabled/disabled
module.exports.timeTrackingModuleIsActive = async (req, res, next) => {
  const prefs = await Preferences.findOne();

  if (!prefs.modules?.timeTracking.isActive) {
    req.isAuth = false;
    const error = new Error(`Модуль "Учёт времени" отключен.`);
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.inventoryModuleIsActive = async (req, res, next) => {
  const prefs = await Preferences.findOne();

  if (!prefs.modules?.inventory.isActive) {
    req.isAuth = false;
    const error = new Error(`Модуль "Учёт техники" отключен.`);
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

// Интеграция Mikrotik независима от модуля «Учёт техники»: свой рубильник
// prefs.mikrotik.isActive (отсутствие поля в старых документах = включено)
module.exports.mikrotikIsActive = async (req, res, next) => {
  const prefs = await Preferences.findOne();

  if (prefs.mikrotik?.isActive === false) {
    req.isAuth = false;
    const error = new Error(`Интеграция Mikrotik отключена.`);
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.financesModuleIsActive = async (req, res, next) => {
  const prefs = await Preferences.findOne();

  if (!prefs.modules?.finances.isActive) {
    req.isAuth = false;
    const error = new Error(`Модуль "Финансы" отключен.`);
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};

module.exports.knowledgeBaseModuleIsActive = async (req, res, next) => {
  const prefs = await Preferences.findOne();

  if (!prefs.modules?.knowledgeBase.isActive) {
    req.isAuth = false;
    const error = new Error(`Модуль "База знаний" отключен.`);
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
      status: error.statusCode,
      message: error.message,
    });
  }

  next();
};
