const User = require("../../models/user");
const Preferences = require("../../models/preferences");

const { AppError } = require("../../middleware/errorHandling");
const { resolveTimezone } = require("../../utils/datetime");
const { buildMonthlyWorkTrend } = require("../../services/monthlyWorkTrend");
const { resolveOvertimeSettings } = require("../../services/workOvertime");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const MAX_MONTHS = 12;

// GET /finances/employees-trend?to&months[&approvedOnly]
// Помесячная динамика по команде для режима «Динамика» отчёта «Сотрудники».
// Запрос тяжёлый (год работ всей организации + расчёт переработок по каждой),
// поэтому вызывается только при открытии режима, а не с загрузкой страницы.
exports.getTrend = async (req, res, next) => {
  try {
    const { to, months, approvedOnly } = req.query;

    const preferences = await Preferences.findOne({}).lean();
    const tz = resolveTimezone(preferences);

    const anchorDay = to ? dayjs.tz(to, tz) : dayjs.tz(new Date(), tz);
    if (!anchorDay.isValid()) {
      return next(new AppError("Некорректная дата окончания периода", 400));
    }

    const requestedMonths = Number.parseInt(months, 10);
    const monthsCount = Number.isFinite(requestedMonths)
      ? Math.min(Math.max(requestedMonths, 1), MAX_MONTHS)
      : MAX_MONTHS;

    const employees = await User.find({
      isEndUser: false,
      isServiceAccount: false,
    })
      .select(
        "firstName lastName position isActive finances timezone workSchedule followProductionCalendar",
      )
      .lean();

    const trend = await buildMonthlyWorkTrend({
      users: employees,
      anchorDay,
      months: monthsCount,
      tz,
      overtimeSettings: resolveOvertimeSettings(preferences),
      preferences,
      withClasses: true,
      perUser: true,
      countTickets: true,
      approvedOnly: approvedOnly === "true",
    });

    const employeeById = new Map(
      employees.map((employee) => [employee._id.toString(), employee]),
    );

    // Серии сортируются по вкладу: график берёт первые пять слотов палитры,
    // остальные сворачиваются в «Прочие» на клиенте
    const byEmployee = trend.byUser
      .map((series) => {
        const employee = employeeById.get(series.userId);
        return {
          employee: {
            _id: series.userId,
            firstName: employee?.firstName || "",
            lastName: employee?.lastName || "",
            position: employee?.position ?? null,
            isActive: employee?.isActive !== false,
          },
          totalMinutes: series.months.reduce((sum, item) => sum + item.minutes, 0),
          months: series.months,
        };
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .map((series, index) => ({ ...series, rank: index + 1 }));

    res.status(200).json({
      period: {
        from: trend.months[0]?.month ?? null,
        to: trend.months[trend.months.length - 1]?.month ?? null,
        months: monthsCount,
        timezone: tz,
      },
      approvedOnly: approvedOnly === "true",
      months: trend.months,
      byEmployee,
      meta: { employeesCount: employees.length },
    });
  } catch (error) {
    next(new AppError("Failed to build employees trend", 500, true, error));
  }
};
