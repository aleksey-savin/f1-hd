const Preferences = require("../../models/preferences");
const User = require("../../models/user");

const {
  buildTeamSchedule,
  MAX_PERIOD_DAYS,
} = require("../../services/teamScheduleService");
const {
  buildScheduleContext,
  makePlanner,
} = require("../../services/workCalendar");
const { resolveOvertimeSettings } = require("../../services/workOvertime");
const { getHealth, syncCalendar } = require("../../services/productionCalendar");
const getAuthData = require("../../middleware/getAuthData");
const { AppError } = require("../../middleware/errorHandling");

// Период считается по календарным дням: сравнение UTC-полуночей, а не
// инстантов — иначе граница «ровно 366 дней» уезжает на сутки
const dayDiff = (fromKey, toKey) => {
  const from = new Date(`${fromKey}T00:00:00.000Z`);
  const to = new Date(`${toKey}T00:00:00.000Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000)) + 1;
};

const validatePeriod = (from, to) => {
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return new AppError("Некорректный период", 400);
  }
  if (to < from) {
    return new AppError("Дата окончания периода раньше даты начала", 400);
  }
  if (dayDiff(from, to) > MAX_PERIOD_DAYS) {
    return new AppError(
      `Период не может превышать ${MAX_PERIOD_DAYS} дней`,
      400,
    );
  }
  return null;
};

// GET /team/schedule?from&to[&company&subdivision&search]
// Табель: строка на сотрудника, ячейка на день. Смотреть может любой
// не-клиент; правку и решения по запросам открывает canManage в ответе.
exports.getSchedule = async (req, res, next) => {
  try {
    const { from, to, company, subdivision, search } = req.query;

    const invalid = validatePeriod(from, to);
    if (invalid) {
      return next(invalid);
    }

    const { userId } = await getAuthData(req);
    const [preferences, viewer] = await Promise.all([
      Preferences.findOne({}).lean(),
      User.findById(userId).select("isAdmin permissions").lean(),
    ]);

    const report = await buildTeamSchedule({
      from,
      to,
      companyId: company || null,
      subdivisionId: subdivision || null,
      search: search || "",
      preferences,
      viewer,
    });

    res.status(200).json(report);
  } catch (error) {
    next(new AppError(error.message || "Не удалось построить табель", 500));
  }
};

// GET /team/schedule/:userId?from&to — график и дни одного сотрудника
// (карточка сотрудника и «Мой аккаунт»; свой смотрит без права)
exports.getUserSchedule = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const invalid = validatePeriod(from, to);
    if (invalid) {
      return next(invalid);
    }

    const targetId = req.params.userId;
    const user = await User.findById(targetId)
      .select(
        "firstName lastName position timezone workSchedule workSchedules " +
          "followProductionCalendar workTimeMode remoteOnly",
      )
      .lean();
    if (!user) {
      return next(new AppError("Сотрудник не найден", 404));
    }

    const preferences = await Preferences.findOne({}).lean();
    const overtimeSettings = resolveOvertimeSettings(preferences);
    const ctx = await buildScheduleContext({
      fromKey: from,
      toKey: to,
      userIds: [targetId],
      preferences,
    });
    const planner = makePlanner(user, ctx, overtimeSettings);
    const period = planner.periodPlan(from, to);

    res.status(200).json({
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        position: user.position ?? null,
      },
      timezone: planner.tz,
      organizationTimezone: preferences?.timezone ?? null,
      schedule: planner.schedule,
      scheduleSource: planner.scheduleSource,
      hasPersonalSchedule: planner.hasPersonalSchedule,
      followsProductionCalendar: planner.followsCalendar,
      workTimeMode: planner.workTimeMode,
      remoteOnly: planner.remoteOnly,
      // История версий — карточке сотрудника, чтобы показать «действует с»
      versions: (user.workSchedules || []).map((version) => ({
        effectiveFrom: version.effectiveFrom
          ? new Date(version.effectiveFrom).toISOString().slice(0, 10)
          : null,
        schedule: version.schedule,
        followProductionCalendar: version.followProductionCalendar !== false,
        createdAt: version.createdAt,
      })),
      period: { from, to },
      normMinutes: period.normMinutes,
      normMinutesBeforeAbsences: period.normMinutesBeforeAbsences,
      workingDays: period.workingDays,
      absenceDays: period.absenceDays,
      days: period.days,
    });
  } catch (error) {
    next(new AppError(error.message || "Не удалось построить график", 500));
  }
};

// GET /team/production-calendar?year — состояние загрузчика и дни-исключения
exports.getProductionCalendar = async (req, res, next) => {
  try {
    const preferences = await Preferences.findOne({}).lean();
    res.status(200).json(await getHealth(preferences));
  } catch (error) {
    next(new AppError(error.message || "Не удалось прочитать календарь", 500));
  }
};

// POST /team/production-calendar/sync — ручное обновление из настроек
exports.syncProductionCalendar = async (req, res, next) => {
  try {
    const { results, lastError } = await syncCalendar({ force: true });
    const preferences = await Preferences.findOne({}).lean();
    res.status(200).json({ results, lastError, health: await getHealth(preferences) });
  } catch (error) {
    next(new AppError(error.message || "Не удалось обновить календарь", 500));
  }
};
