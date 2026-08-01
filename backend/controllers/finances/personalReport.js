const User = require("../../models/user");
const Preferences = require("../../models/preferences");

const { buildPersonalReport } = require("../../services/personalReportService");

const { AppError } = require("../../middleware/errorHandling");

const getAuthData = require("../../middleware/getAuthData");

const MAX_PERIOD_DAYS = 366;

// GET /finances/personal-report-summary?from&to[&userId][&details=0]
// Свой отчёт — любому обладателю personal/global права; чужой (?userId) —
// только isAdmin или canSeeGlobalFinancialReport.
//
// details=0 — режим плитки на главной: без списка работ и без 12-месячного
// тренда (это два лишних прохода на каждый заход на главную), но с дельтой к
// прошлому периоду — без неё плитке нечего показать под значением.
exports.getSummary = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const { from, to, userId: requestedUserId, details } = req.query;
    const includeDetails = details !== "0" && details !== "false";

    let targetUserId = authData.userId;
    if (requestedUserId && requestedUserId !== String(authData.userId)) {
      const canSeeOthers =
        authData.isAdmin || authData.permissions?.canSeeGlobalFinancialReport;
      if (!canSeeOthers) {
        return next(
          new AppError(
            "Недостаточно прав для просмотра отчёта другого сотрудника",
            403,
          ),
        );
      }
      targetUserId = requestedUserId;
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (toDate < fromDate) {
      return next(
        new AppError("Дата окончания периода раньше даты начала", 400),
      );
    }
    if (toDate - fromDate > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      return next(
        new AppError(
          `Период отчёта не может превышать ${MAX_PERIOD_DAYS} дней`,
          400,
        ),
      );
    }

    const targetUser = await User.findById(targetUserId)
      .select(
        "_id firstName lastName position finances timezone workSchedule followProductionCalendar",
      )
      .lean();
    if (!targetUser) {
      return next(new AppError("Сотрудник не найден", 404));
    }

    const preferences = await Preferences.findOne({}).lean();

    const report = await buildPersonalReport({
      userId: targetUserId,
      from,
      to,
      preferences,
      user: targetUser,
      includeDetails,
      includePrevPeriod: true,
    });

    res.status(200).json({
      employee: {
        _id: targetUser._id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        position: targetUser.position || "",
        isSelf: String(targetUser._id) === String(authData.userId),
      },
      ...report,
    });
  } catch (error) {
    next(
      new AppError("Failed to build personal report summary", 500, true, error),
    );
  }
};

// GET /finances/report-employees — список сотрудников для селектора отчёта.
// Отдаём только 4 поля: полные документы пользователя здесь недопустимы.
