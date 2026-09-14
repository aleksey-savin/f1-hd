const User = require("../../models/user");
const Preferences = require("../../models/preferences");

const { buildPersonalReport } = require("../../services/personalReportService");

const { AppError } = require("../../middleware/errorHandling");


const MAX_PERIOD_DAYS = 366;

// GET /finances/personal-report-summary?from&to[&userId][&details=0]
// Свой отчёт — по праву `report.own`; чужой (?userId) — по `report.employees`.
// Одно другого не подразумевает, поэтому гейт роута пускает обладателя любого
// из двух, а чей именно отчёт открыт — решает контроллер.
//
// Деньги (оклад, ставка, доплата, итог) едут только обладателю
// `user.manageFinances` или в своём отчёте — свои каждый видит сам.
//
// details=0 — режим карточки на главной: без списка работ, 12-месячного тренда
// и прохода за прошлый период. Карточка листает месяцы, каждый шаг — запрос, а
// дельт она не рисует: посреди месяца сравнение с полным прошлым всегда врёт.
exports.getSummary = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;
    const { from, to, userId: requestedUserId, details } = req.query;
    const includeDetails = details !== "0" && details !== "false";

    let targetUserId = authData.userId;
    if (requestedUserId && requestedUserId !== String(authData.userId)) {
      const canSeeOthers = req.auth.can({ report: ["employees"] });
      if (!canSeeOthers) {
        return next(
          new AppError(
            "Недостаточно прав для просмотра отчёта другого сотрудника",
            403,
          ),
        );
      }
      targetUserId = requestedUserId;
    } else if (!req.auth.can({ report: ["own"] })) {
      // Право на чужие отчёты не заменяет права на свой: у ручки два входа
      return next(
        new AppError("Недостаточно прав для просмотра своего отчёта", 403),
      );
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
        "_id firstName lastName position finances timezone workSchedule workSchedules followProductionCalendar",
      )
      .lean();
    if (!targetUser) {
      return next(new AppError("Сотрудник не найден", 404));
    }

    const preferences = await Preferences.findOne({}).lean();

    const isSelf = String(targetUser._id) === String(authData.userId);

    const report = await buildPersonalReport({
      userId: targetUserId,
      from,
      to,
      preferences,
      user: targetUser,
      // Свои деньги видит каждый; чужие — только с правом на оклады и ставки
      canSeeMoney: isSelf || Boolean(req.auth.can({ user: ["manageFinances"] })),
      includeDetails,
      includePrevPeriod: includeDetails,
    });

    res.status(200).json({
      employee: {
        _id: targetUser._id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        position: targetUser.position || "",
        isSelf,
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
