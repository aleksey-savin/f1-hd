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

  const canSeeAllCompanyTickets =
    permissions?.canSeeAllCompanyTickets &&
    authedUser.company._id.toString() === ticket.company?._id?.toString();

  const canSeeAllTickets = authedUser.permissions.canSeeAllTickets;

  if (
    !authedUser.isAdmin &&
    authedUser.permissions.canAdministrateTickets &&
    !isResp &&
    !isApplicant &&
    !canSeeAllCompanyTickets &&
    !canSeeAllTickets
  ) {
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

module.exports.canUpdateChangeLog = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canUpdateChangelog && !isAdmin) {
    const error = new Error("Недостаточно прав для изменения Changelog");
    error.statusCode = 403;
    return res.status(error.statusCode).json({
      error: true,
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

module.exports.canManageDeviceModels = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageDeviceModels && !isAdmin) {
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

module.exports.canManageDeviceTypes = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageDeviceTypes && !isAdmin) {
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

module.exports.canManageDeviceAttributes = async (req, res, next) => {
  const { userId } = await getAuthData(req);
  const authedUser = await User.findById(userId);
  const { permissions, isAdmin } = authedUser;
  if (!permissions.canManageDeviceAttributes && !isAdmin) {
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

// dashboard
module.exports.canUseDashboard = async (req, res, next) => {
  const authedUser = await getAuthData(req);

  if (!authedUser.dashboard?.isActive) {
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
