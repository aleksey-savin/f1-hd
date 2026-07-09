const mongoose = require("mongoose");

const { Ticket } = require("@/models/ticket");
const Company = require("@/models/company");
const Work = require("@/models/work");
const User = require("@/models/user");
const Preferences = require("@/models/preferences");

const { AppError } = require("@/middleware/errorHandling");
const { resolveTimezone } = require("@/utils/datetime");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

// Месяцы в именительном падеже для подписи «июнь 2026».
const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

// Дельта текущего значения относительно базовой линии (среднего за год).
// При нулевой базе процент не считаем (null) — рост «с нуля» не выражается в %.
const computeDelta = (current, baseline) => {
  if (!baseline || baseline === 0) {
    return { direction: current > 0 ? "up" : "same", percentage: null };
  }
  const change = current - baseline;
  const percentage = Math.round((change / baseline) * 100);
  const direction = change > 0 ? "up" : change < 0 ? "down" : "same";
  return { direction, percentage };
};

/**
 * Статистика компании для карточек на странице компании.
 *
 * Сравнения «этот месяц vs среднее за год» считаются по одинаковому отрезку
 * месяца: берём первые N дней (N = сегодняшнее число) текущего месяца и
 * сравниваем со средним за первые N дней каждого из 12 предыдущих месяцев —
 * иначе неполный текущий месяц всегда выглядел бы хуже полных.
 */
const getCompanyStats = async (companyId) => {
  const exists = await Company.exists({ _id: companyId });
  if (!exists) {
    throw new AppError(`Company ${companyId} not found`, 404);
  }

  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  const preferences = await Preferences.findOne({});
  const tz = resolveTimezone(preferences);

  const now = dayjs.tz(new Date(), tz);
  const dayOfMonth = now.date(); // N — сколько дней месяца уже прошло
  const monthStart = now.startOf("month");
  const currentMonthKey = monthStart.format("YYYY-MM");
  const rangeStart = monthStart.subtract(12, "month").toDate(); // 12 полных + текущий
  const ninetyDaysAgo = now.subtract(90, "day").toDate();
  const twelveMonthsAgo = now.subtract(12, "month").toDate();

  // Помесячные бакеты по первым N дням месяца → { current, baselineAvg }.
  // baselineAvg = сумма по 12 прошлым месяцам / 12 (месяцы без данных = 0).
  const splitCurrentVsBaseline = (buckets, valueKey) => {
    let current = 0;
    let baselineSum = 0;
    for (const bucket of buckets) {
      if (bucket._id === currentMonthKey) {
        current = bucket[valueKey];
      } else {
        baselineSum += bucket[valueKey];
      }
    }
    const baselineAvg = baselineSum / 12;
    return { current, baselineAvg, ...computeDelta(current, baselineAvg) };
  };

  const [ticketBuckets, workBuckets, channelRows, companyUserIds, activeAgg] =
    await Promise.all([
      // Заявки по первым N дням каждого месяца за 13 месяцев.
      Ticket.aggregate([
        {
          $match: {
            "company._id": companyObjectId,
            createdAt: { $gte: rangeStart },
          },
        },
        {
          $addFields: {
            _dom: { $dayOfMonth: { date: "$createdAt", timezone: tz } },
            _ym: {
              $dateToString: {
                date: "$createdAt",
                format: "%Y-%m",
                timezone: tz,
              },
            },
          },
        },
        { $match: { _dom: { $lte: dayOfMonth } } },
        { $group: { _id: "$_ym", count: { $sum: 1 } } },
      ]),

      // Затраченное время (мс) по выполненным работам, тот же отрезок месяца.
      // Доп. разбивка выезд/удалённо — по visitRequired, без populate.
      Work.aggregate([
        {
          $match: {
            company: companyObjectId,
            startedAt: { $ne: null },
            finishedAt: { $ne: null, $gte: rangeStart },
          },
        },
        {
          $addFields: {
            _dom: { $dayOfMonth: { date: "$finishedAt", timezone: tz } },
            _ym: {
              $dateToString: {
                date: "$finishedAt",
                format: "%Y-%m",
                timezone: tz,
              },
            },
            _dur: { $subtract: ["$finishedAt", "$startedAt"] },
          },
        },
        { $match: { _dom: { $lte: dayOfMonth } } },
        {
          $group: {
            _id: "$_ym",
            time: { $sum: "$_dur" },
            onSiteTime: {
              $sum: {
                $cond: [{ $eq: ["$visitRequired", true] }, "$_dur", 0],
              },
            },
            remoteTime: {
              $sum: {
                $cond: [{ $ne: ["$visitRequired", true] }, "$_dur", 0],
              },
            },
          },
        },
      ]),

      // Каналы связи (Ticket.source) за последние 12 месяцев.
      Ticket.aggregate([
        {
          $match: {
            "company._id": companyObjectId,
            createdAt: { $gte: twelveMonthsAgo },
          },
        },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Все пользователи компании.
      User.find({ "company._id": companyObjectId }).distinct("_id"),

      // Уникальные авторы заявок компании за 90 дней (modern + legacy applicant).
      Ticket.aggregate([
        {
          $match: {
            "company._id": companyObjectId,
            createdAt: { $gte: ninetyDaysAgo },
          },
        },
        { $group: { _id: { $ifNull: ["$applicantId", "$applicant._id"] } } },
      ]),
    ]);

  const tickets = splitCurrentVsBaseline(ticketBuckets, "count");

  const workCurrent = workBuckets.find((b) => b._id === currentMonthKey);
  const time = {
    ...splitCurrentVsBaseline(workBuckets, "time"),
    onSite: { current: workCurrent?.onSiteTime || 0 },
    remote: { current: workCurrent?.remoteTime || 0 },
  };

  // Активные = есть заявка за 90 дней; пересекаем с пользователями компании.
  const companyUserIdSet = new Set(companyUserIds.map((id) => id.toString()));
  const active = activeAgg.filter(
    (row) => row._id && companyUserIdSet.has(row._id.toString()),
  ).length;
  const total = companyUserIds.length;
  const users = { total, active, inactive: total - active };

  const channelTotal = channelRows.reduce((sum, row) => sum + row.count, 0);
  const breakdown = channelRows.map((row) => ({
    source: row._id || "Не указан",
    count: row.count,
    percentage: channelTotal
      ? Math.round((row.count / channelTotal) * 100)
      : 0,
  }));
  const channels = {
    total: channelTotal,
    primary: breakdown[0] || null,
    breakdown,
  };

  return {
    period: {
      monthLabel: `${MONTHS_RU[now.month()]} ${now.year()}`,
      daysElapsed: dayOfMonth,
      daysInMonth: now.daysInMonth(),
    },
    tickets,
    time,
    users,
    channels,
  };
};

module.exports = { getCompanyStats };
