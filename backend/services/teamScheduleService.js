const User = require("@/models/user");
const Absence = require("@/models/absence");

const { resolveTimezone } = require("@/utils/datetime");
const { getAbsenceType } = require("@/utils/absenceTypes");
const {
  WORK_STATUS_BY_CODE,
  VISIT_STATUS_CODES,
} = require("@/utils/workStatuses");
const { resolveOvertimeSettings } = require("@/services/workOvertime");
const {
  buildScheduleContext,
  makePlanner,
  eachDayKey,
} = require("@/services/workCalendar");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { canFor } = require("@/services/permissions");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Календарь команды: КТО ДОСТУПЕН, а не сколько наработал.
 *
 * Отвечает ровно на четыре вопроса: кто сегодня работает и кому кидать заявку,
 * кто болеет, кого можно физически отправить к клиенту, и когда безопасно
 * ставить отпуск. Часов, нормы и переработок здесь нет намеренно — они живут
 * в отчёте «Сотрудники» (services/employeesSummaryService).
 *
 * Отсюда и лёгкость: коллекция работ не читается вовсе.
 *
 * Знание о прошлом и будущем разное и не смешивается:
 *   • сегодня — фактический статус присутствия (user.workStatus);
 *   • дальше — план: недельный график плюс подтверждённые отсутствия.
 */

const MAX_PERIOD_DAYS = 366;

// Кого можно отправить к клиенту — из каталога (поле visit): удалёнка не
// годится, человек может работать и из другой страны.
const CAN_VISIT_STATUSES = new Set(VISIT_STATUS_CODES);

const toPerson = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  position: user.position ?? null,
  profileImagePath: user.profileImagePath ?? null,
});

/** Смещение пояса в минутах и местное время «сейчас» — для вида «Сегодня». */
const zoneInfo = (tz) => {
  try {
    const now = dayjs().tz(tz);
    return { utcOffsetMinutes: now.utcOffset(), localTime: now.format("HH:mm") };
  } catch {
    return { utcOffsetMinutes: 0, localTime: null };
  }
};

const buildTeamSchedule = async ({
  from,
  to,
  companyId = null,
  subdivisionId = null,
  search = "",
  preferences,
  viewer,
}) => {
  const orgTz = resolveTimezone(preferences);
  const overtimeSettings = resolveOvertimeSettings(preferences);

  const fromDay = dayjs.tz(from, orgTz).startOf("day");
  const toDay = dayjs.tz(to, orgTz).endOf("day");
  const fromKey = fromDay.format("YYYY-MM-DD");
  const toKey = toDay.format("YYYY-MM-DD");
  const todayKey = dayjs().tz(orgTz).format("YYYY-MM-DD");

  // ── сотрудники выборки ────────────────────────────────────────────────
  // «Не ведётся» — человека в календаре команды нет вовсе: подрядчики и
  // разовые работы, их временем мы не управляем
  const query = {
    isEndUser: false,
    isServiceAccount: false,
    banned: { $ne: true },
    workTimeMode: { $ne: "none" },
    // Сотрудники сторонних компаний, которым портал — хаб для своих заявок:
    // время им вести можно, но нашей смены они не часть
    hideInTeamCalendar: { $ne: true },
  };
  if (companyId) {
    query["company._id"] = companyId;
  }
  if (subdivisionId) {
    query.subdivision = subdivisionId;
  }
  if (search) {
    // Терм экранируется и ограничивается: ".*" в поиске = скан коллекции
    const term = search.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(term, "i");
    query.$or = [{ firstName: rx }, { lastName: rx }, { position: rx }];
  }

  const employees = await User.find(query)
    .select(
      "firstName lastName position profileImagePath timezone workSchedule " +
        "workSchedules followProductionCalendar company subdivision " +
        "workStatus hideWorkStatus workTimeMode remoteOnly",
    )
    .sort({ lastName: 1, firstName: 1 })
    .lean();

  const userIds = employees.map((employee) => employee._id);

  // ── календарь периода и подтверждённые отсутствия ─────────────────────
  const scheduleContext = await buildScheduleContext({
    fromKey,
    toKey,
    userIds,
    preferences,
  });

  // ── строки ────────────────────────────────────────────────────────────
  // Доступность по дням копится параллельно: она нужна и календарю (счётчик
  // в ячейке), и планированию отпусков (подсветка провалов)
  const availability = new Map();
  for (const dateKey of eachDayKey(fromKey, toKey)) {
    availability.set(dateKey, { date: dateKey, working: 0, absent: 0, offDuty: 0 });
  }

  const rows = employees.map((employee) => {
    const planner = makePlanner(employee, scheduleContext, overtimeSettings);
    const zone = zoneInfo(planner.personalTz);

    // Статус показываем только сегодня и только если человек его не скрыл
    const statusCode = employee.hideWorkStatus
      ? null
      : (employee.workStatus?.code ?? "unset");
    const statusMeta = statusCode ? WORK_STATUS_BY_CODE?.[statusCode] : null;

    const days = [];
    for (const dateKey of eachDayKey(fromKey, toKey)) {
      const plan = planner.dayPlan(dateKey);
      const absence = plan.absence
        ? {
            type: plan.absence.type,
            label: getAbsenceType(plan.absence.type)?.label ?? plan.absence.type,
            status: plan.absence.status,
            // away — человека нет; командировка и обучение оставляют его в работе
            away: Boolean(getAbsenceType(plan.absence.type)?.reducesNorm),
            from: plan.absence.fromKey,
            to: plan.absence.toKey,
          }
        : null;

      const offDuty = plan.kind === "weekend" || plan.kind === "holiday";
      const away = plan.kind === "absence";
      const bucket = availability.get(dateKey);
      if (away) {
        bucket.absent += 1;
      } else if (offDuty) {
        bucket.offDuty += 1;
      } else {
        bucket.working += 1;
      }

      days.push({
        date: dateKey,
        // work | short | holiday | weekend | absence — без часов и нормы
        kind: plan.kind,
        offDuty,
        away,
        holidayTitle: plan.holidayTitle,
        absence,
      });
    }

    return {
      user: toPerson(employee),
      timezone: planner.personalTz,
      utcOffsetMinutes: zone.utcOffsetMinutes,
      localTime: zone.localTime,
      city:
        planner.personalTz.split("/").pop()?.replace(/_/g, " ") ??
        planner.personalTz,
      hasPersonalSchedule: planner.hasPersonalSchedule,
      workTimeMode: planner.workTimeMode,
      isScheduled: planner.isScheduled,
      remoteOnly: planner.remoteOnly,
      followsProductionCalendar: planner.followsCalendar,
      schedule: planner.schedule,
      // Живой статус — только про «сейчас», поэтому отдельно от days
      status: statusCode
        ? {
            code: statusCode,
            label: statusMeta?.label ?? statusCode,
            emoji: statusMeta?.emoji ?? "",
            note: employee.workStatus?.note || "",
            updatedAt: employee.workStatus?.updatedAt ?? null,
          }
        : null,
      canVisitClient: Boolean(statusCode && CAN_VISIT_STATUSES.has(statusCode)),
      days,
    };
  });

  // ── шапка: календарь периода ──────────────────────────────────────────
  const calendarDays = [];
  for (const dateKey of eachDayKey(fromKey, toKey)) {
    const day = scheduleContext.calendar.classify(dateKey);
    calendarDays.push({ date: dateKey, kind: day.kind, title: day.title });
  }

  // ── запросы, ждущие решения ───────────────────────────────────────────
  const pendingDocs = await Absence.find({
    status: "pending",
    to: { $gte: fromDay.toDate() },
  })
    .populate("user", "firstName lastName position")
    .populate("requestedBy", "firstName lastName")
    .sort({ from: 1 })
    .limit(50)
    .lean();

  const pending = pendingDocs
    .filter((doc) => doc.user)
    .map((doc) => ({
      _id: doc._id,
      user: toPerson(doc.user),
      type: doc.type,
      typeLabel: getAbsenceType(doc.type)?.label ?? doc.type,
      away: Boolean(getAbsenceType(doc.type)?.reducesNorm),
      from: dayjs(doc.from).utc().format("YYYY-MM-DD"),
      to: dayjs(doc.to).utc().format("YYYY-MM-DD"),
      comment: doc.comment || "",
      requestedBy: doc.requestedBy
        ? { firstName: doc.requestedBy.firstName, lastName: doc.requestedBy.lastName }
        : null,
      createdAt: doc.createdAt,
    }));

  // Счётчики «сегодня» имеют смысл, только когда сегодняшний день попал в
  // период: пролистав на прошлый месяц, «работают N» врали бы нулями
  const today = availability.get(todayKey) ?? null;
  const todayInPeriod = Boolean(today);

  return {
    period: {
      from: fromKey,
      to: toKey,
      today: todayKey,
      todayInPeriod,
      isFullMonth: fromDay.date() === 1 && toDay.isSame(fromDay.endOf("month"), "day"),
      organizationTimezone: orgTz,
    },
    calendar: {
      isActive: scheduleContext.calendar.isActive,
      country: scheduleContext.calendar.settings.country,
      days: calendarDays,
      missingYears: scheduleContext.calendar.missingYears ?? [],
    },
    totals: {
      employeesCount: rows.length,
      workingToday: todayInPeriod ? today.working : null,
      absentToday: todayInPeriod ? today.absent : null,
      canVisitToday: todayInPeriod
        ? rows.filter((row) => row.canVisitClient).length
        : null,
      noScheduleCount: rows.filter((row) => !row.hasPersonalSchedule).length,
    },
    // Доступность по дням — календарю для счётчика, планированию для провалов
    availability: [...availability.values()],
    employees: rows,
    pending,
    canManage: viewer
      ? (await canFor(viewer))({ workSchedule: ["manage"] })
      : false,
  };
};

module.exports = { buildTeamSchedule, MAX_PERIOD_DAYS };
