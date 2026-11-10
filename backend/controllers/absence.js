const Absence = require("../models/absence");
const User = require("../models/user");
const Preferences = require("../models/preferences");

const { AppError } = require("../middleware/errorHandling");
const { getAbsenceType } = require("../utils/absenceTypes");
const { fmtDateTime, resolveTimezone } = require("../utils/datetime");
const {
  buildScheduleContext,
  makePlanner,
  toDateKey,
} = require("../services/workCalendar");
const { resolveOvertimeSettings } = require("../services/workOvertime");
const { runWorkStatusAuto } = require("../services/workStatusAuto");
const logger = require("../utils/logger");
const { permissionFilter } = require("@/services/permissions");
const {
  validateAbsenceTimeRange,
  absencePeriodsOverlap,
  absenceSearchBounds,
  formatAbsencePeriod,
  absenceDurationMinutes,
} = require("../utils/absencePeriod");

// Календарные даты лежат UTC-полночью и ходят строками YYYY-MM-DD
const toUtcMidnight = (key) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (date) => toDateKey(new Date(date));

const shortName = (user) =>
  `${user.lastName || ""} ${(user.firstName || "").slice(0, 1)}.`.trim();

const toDto = (doc) => ({
  _id: doc._id,
  user: doc.user?._id
    ? {
        _id: doc.user._id,
        firstName: doc.user.firstName,
        lastName: doc.user.lastName,
        position: doc.user.position ?? null,
      }
    : doc.user,
  type: doc.type,
  typeLabel: getAbsenceType(doc.type)?.label ?? doc.type,
  reducesNorm: !doc.timeRange && Boolean(getAbsenceType(doc.type)?.reducesNorm),
  from: keyOf(doc.from),
  to: keyOf(doc.to),
  timeRange: doc.timeRange ? { start: doc.timeRange.start, end: doc.timeRange.end } : null,
  comment: doc.comment || "",
  status: doc.status,
  requestedBy: doc.requestedBy?._id
    ? {
        _id: doc.requestedBy._id,
        firstName: doc.requestedBy.firstName,
        lastName: doc.requestedBy.lastName,
      }
    : null,
  decidedBy: doc.decidedBy?._id
    ? {
        _id: doc.decidedBy._id,
        firstName: doc.decidedBy.firstName,
        lastName: doc.decidedBy.lastName,
      }
    : null,
  decidedAt: doc.decidedAt || null,
  decisionComment: doc.decisionComment || "",
  createdAt: doc.createdAt,
});

const POPULATE = [
  { path: "user", select: "firstName lastName position" },
  { path: "requestedBy", select: "firstName lastName" },
  { path: "decidedBy", select: "firstName lastName" },
];

/**
 * Сколько рабочих дней заденет отсутствие — считаем тем же планировщиком, что
 * строит календарь, иначе форма пообещает одно, а календарь покажет другое.
 * Для части дня возвращаем длительность и окно графика только как справку:
 * такое отсутствие не меняет норму и расчёт переработок.
 */
const estimateImpact = async (user, fromKey, toKey, timeRange) => {
  const preferences = await Preferences.findOne({}).lean();
  const overtimeSettings = resolveOvertimeSettings(preferences);
  const ctx = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: [],
    preferences,
  });
  const planner = makePlanner(user, ctx, overtimeSettings);
  const period = planner.periodPlan(fromKey, toKey);
  if (timeRange) {
    const plan = planner.dayPlan(fromKey);
    return {
      workingDays: period.workingDays,
      durationMinutes: absenceDurationMinutes(timeRange),
      reducesNorm: false,
      scheduleWindow: plan.start === null || plan.start === undefined || plan.end <= plan.start
        ? null
        : { date: fromKey, start: plan.start, end: plan.end, crossesMidnight: plan.crossesMidnight },
    };
  }
  return { workingDays: period.workingDays };
};

// Захватываем соседние календарные даты: хвост ночного отсутствия лежит
// в следующем дне, хотя from/to остаются датой начала.
const findApprovedOverlap = async (user, period, excludeId) => {
  const range = absenceSearchBounds(period);
  const candidates = await Absence.find({
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    user,
    status: "approved",
    from: { $lte: range.to },
    to: { $gte: range.from },
  }).lean();
  return candidates.find((candidate) => absencePeriodsOverlap(period, candidate));
};

// GET /absences?from&to&status&user
// Решение по отсутствию меняет присутствие сразу, а не в ночном прогоне:
// иначе согласовали отгул — а человек до утра висит «в офисе». Прогон по
// одному пользователю дёшев и сам разберётся, ставить статус или снимать.
const refreshStatus = async (userId) => {
  try {
    await runWorkStatusAuto({ userIds: [userId] });
  } catch (error) {
    logger.log("error", "Absence status refresh failed", {
      user: String(userId),
      error: error.message,
    });
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { from, to, status, user } = req.query;
    const query = {};
    if (from) {
      query.to = { $gte: toUtcMidnight(from) };
    }
    if (to) {
      query.from = { $lte: toUtcMidnight(to) };
    }
    if (status) {
      query.status = status;
    }
    if (user) {
      query.user = user;
    }

    if (!req.auth.isAdmin && !req.auth.can({ schedule: ["read"] })) {
      query.user = req.auth.userId; // без права видны только свои отсутствия
    }

    const docs = await Absence.find(query)
      .populate(POPULATE)
      .sort({ from: -1 })
      .limit(500)
      .lean();

    res.status(200).json({ absences: docs.filter((d) => d.user).map(toDto) });
  } catch (error) {
    next(new AppError(error.message || "Не удалось получить отсутствия", 500));
  }
};

// POST /absences — своё уходит на согласование, чужое заводится подтверждённым
exports.add = async (req, res, next) => {
  try {
    const { userId } = req.auth;

    const targetId = req.body.user || userId;
    const isSelf = String(targetId) === String(userId);
    // Право автора запроса берём из `req.auth.can`: `canFor` по урезанному
    // документу (`select("firstName lastName isAdmin")`) считал сотрудника
    // клиентом — не-администратор с правом «Графики и отсутствия» не мог
    // завести отсутствие коллеге, а своё получал `pending`.
    const manager = req.auth.can({ schedule: ["manage"] });

    if (!isSelf && !manager) {
      return next(
        new AppError("Отсутствие другому сотруднику может завести только тот, у кого есть право «Графики и отсутствия»", 403),
      );
    }

    const target = await User.findById(targetId)
      .select("firstName lastName isEndUser deletedAt timezone workSchedule workSchedules followProductionCalendar workTimeMode remoteOnly")
      .lean();
    if (!target) {
      return next(new AppError("Сотрудник не найден", 404));
    }
    if (target.deletedAt) return next(new AppError("Сотрудник удалён", 409));
    if (target.isEndUser) {
      return next(new AppError("Отсутствия ведутся только для сотрудников", 422));
    }

    const fromKey = req.body.from;
    const toKey = req.body.to;
    const timeRange = req.body.timeRange ?? null;
    try {
      validateAbsenceTimeRange(timeRange, fromKey, toKey);
    } catch (error) {
      return next(new AppError(error.message, 422));
    }
    if (toKey < fromKey) {
      return next(new AppError("Дата окончания раньше даты начала", 422));
    }

    // Пересечение с уже подтверждённым — 422 с человеческой фразой, а не
    // молчаливое задвоение, из-за которого норма ушла бы в минус
    const overlap = await findApprovedOverlap(targetId, { from: fromKey, to: toKey, timeRange });
    if (overlap) {
      const label = getAbsenceType(overlap.type)?.label ?? "отсутствие";
      return next(
        new AppError(
          `На ${formatAbsencePeriod(overlap)} уже есть подтверждённое отсутствие «${label}»`,
          422,
        ),
      );
    }

    const created = await Absence.create({
      user: targetId,
      type: req.body.type,
      from: toUtcMidnight(fromKey),
      to: toUtcMidnight(toKey),
      timeRange,
      comment: req.body.comment || "",
      // С правом — заводится сразу подтверждённым; без права (своё) — на согласование
      status: manager ? "approved" : "pending",
      requestedBy: userId,
      decidedBy: manager ? userId : null,
      decidedAt: manager ? new Date() : null,
    });

    const doc = await Absence.findById(created._id).populate(POPULATE).lean();

    if (doc.status === "approved") {
      await refreshStatus(doc.user?._id ?? doc.user);
    }

    if (doc.status === "pending") {
      notifyApprovers(doc).catch((error) =>
        logger.log("error", "Absence request notification failed", {
          error: error.message,
        }),
      );
    }

    res.status(201).json({ absence: toDto(doc) });
  } catch (error) {
    next(new AppError(error.message || "Не удалось сохранить отсутствие", 500));
  }
};

// POST /absences/:id/decision — подтвердить или отклонить
exports.decide = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const { decision, comment } = req.body;

    const absence = await Absence.findById(req.params.id);
    if (!absence) {
      return next(new AppError("Запрос не найден", 404));
    }
    if (absence.status !== "pending") {
      return next(new AppError("По этому запросу решение уже принято", 422));
    }

    if (decision === "approve") {
      const overlap = await findApprovedOverlap(absence.user, absence, absence._id);
      if (overlap) {
        const label = getAbsenceType(overlap.type)?.label ?? "отсутствие";
        return next(
          new AppError(
            `Период пересекается с подтверждённым «${label}» ${formatAbsencePeriod(overlap)}`,
            422,
          ),
        );
      }
    }

    absence.status = decision === "approve" ? "approved" : "rejected";
    absence.decidedBy = userId;
    absence.decidedAt = new Date();
    absence.decisionComment = comment || "";
    await absence.save();

    const doc = await Absence.findById(absence._id).populate(POPULATE).lean();
    await refreshStatus(absence.user);

    notifyRequester(doc).catch((error) =>
      logger.log("error", "Absence decision notification failed", {
        error: error.message,
      }),
    );

    res.status(200).json({ absence: toDto(doc) });
  } catch (error) {
    next(new AppError(error.message || "Не удалось сохранить решение", 500));
  }
};

// POST /absences/:id/cancel — заявитель отзывает свой запрос
exports.cancel = async (req, res, next) => {
  try {
    const { userId } = req.auth;

    const absence = await Absence.findById(req.params.id);
    if (!absence) {
      return next(new AppError("Отсутствие не найдено", 404));
    }
    const isOwn = String(absence.requestedBy) === String(userId);
    if (!isOwn && !req.auth.can({ schedule: ["manage"] })) {
      return next(new AppError("Отозвать можно только свой запрос", 403));
    }
    if (absence.status === "cancelled") {
      return next(new AppError("Запрос уже отозван", 422));
    }

    absence.status = "cancelled";
    absence.decidedBy = userId;
    absence.decidedAt = new Date();
    await absence.save();

    const doc = await Absence.findById(absence._id).populate(POPULATE).lean();
    await refreshStatus(absence.user);

    res.status(200).json({ absence: toDto(doc) });
  } catch (error) {
    next(new AppError(error.message || "Не удалось отозвать запрос", 500));
  }
};

// POST /absences/delete/:id
exports.delete = async (req, res, next) => {
  try {
    const absence = await Absence.findByIdAndDelete(req.params.id);
    if (!absence) {
      return next(new AppError("Отсутствие не найдено", 404));
    }
    await refreshStatus(absence.user);

    res.status(200).json({ _id: absence._id });
  } catch (error) {
    next(new AppError(error.message || "Не удалось удалить отсутствие", 500));
  }
};

// GET /absences/impact?user&from&to — сколько снимет с нормы (живая сводка формы)
exports.impact = async (req, res, next) => {
  try {
    const { user: targetId, from, to } = req.query;
    let timeRange;
    try {
      timeRange = typeof req.query.timeRange === "string" ? JSON.parse(req.query.timeRange) : req.query.timeRange;
      validateAbsenceTimeRange(timeRange, from, to);
      if (to < from) throw new Error("Дата окончания раньше даты начала");
    } catch (error) {
      return next(new AppError(error.message, 422));
    }
    if (
      String(targetId) !== req.auth.userId &&
      !req.auth.isAdmin &&
      !req.auth.can({ schedule: ["read"] })
    ) {
      return next(
        new AppError("Чужой график можно смотреть только с правом «Видеть графики и отсутствия»", 403),
      );
    }
    const target = await User.findById(targetId)
      .select("timezone workSchedule workSchedules followProductionCalendar workTimeMode remoteOnly")
      .lean();
    if (!target) {
      return next(new AppError("Сотрудник не найден", 404));
    }
    res.status(200).json(await estimateImpact(target, from, to, timeRange));
  } catch (error) {
    next(new AppError(error.message || "Не удалось посчитать период", 500));
  }
};

/**
 * Уведомления. Категории absenceRequest/absenceDecision живут в общей матрице
 * user.notify.byTelegram/byEmail — ключ одинаков у обоих каналов.
 * Отправка идёт через тот же канал, что и прочие уведомления приложения;
 * падение уведомления не должно ронять сохранение — вызовы обёрнуты в catch.
 */
const notifyApprovers = async (doc) => {
  const preferences = await Preferences.findOne({}).lean();
  const tz = resolveTimezone(preferences);
  // Отключённых и служебные учётки отсекает сам permissionFilter
  const approvers = await User.find({
    isEndUser: false,
    ...(await permissionFilter("schedule.approve")),
  })
    .select("firstName lastName telegramBot notify email")
    .lean();

  const label = getAbsenceType(doc.type)?.label ?? doc.type;
  const text =
    `${shortName(doc.user)} запросил(а): ${label.toLowerCase()} ` +
    `${formatAbsencePeriod(doc)}` +
    (doc.comment ? `\n«${doc.comment}»` : "") +
    `\nПодал(а) ${fmtDateTime(doc.createdAt, tz)}`;

  const { notifyAbsence } = require("../services/absenceNotifications");
  await notifyAbsence({ recipients: approvers, text, category: "absenceRequest" });
};

const notifyRequester = async (doc) => {
  const requester = await User.findById(doc.requestedBy?._id || doc.requestedBy)
    .select("firstName lastName telegramBot notify email")
    .lean();
  if (!requester) {
    return;
  }

  const label = getAbsenceType(doc.type)?.label ?? doc.type;
  const verdict = doc.status === "approved" ? "подтверждён" : "отклонён";
  const text =
    `${label} ${formatAbsencePeriod(doc)} — ${verdict}` +
    (doc.decidedBy ? `\nРешение: ${shortName(doc.decidedBy)}` : "") +
    (doc.decisionComment ? `\n«${doc.decisionComment}»` : "");

  const { notifyAbsence } = require("../services/absenceNotifications");
  await notifyAbsence({ recipients: [requester], text, category: "absenceDecision" });
};
