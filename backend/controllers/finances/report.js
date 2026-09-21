const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const ServicePlanReport = require("../../models/finances/servicePlanReport");
const Preferences = require("../../models/preferences");

const { resolveTimezone } = require("../../utils/datetime");
const { untrackedUserIds } = require("../../services/financeTracking");
const { AppError } = require("../../middleware/errorHandling");

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Остаток прежнего контроллера отчётов: только выборка работ по сотрудникам за
 * период.
 *
 * Всё, что относилось к «Согласованию работ» — подбор, подтверждение работ,
 * счёт, оплата, архив и удаление, — переехало в `controllers/finances/approval`
 * с конечным автоматом, историей и маршрутом подписей. Прежние эндпоинты
 * удалены намеренно: они меняли те же документы в обход автомата, и отчёт мог
 * оказаться в состоянии, которого маршрут не знает.
 */

exports.getEmployeeReport = async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.body;

    // Границы — по настенным часам бизнес-таймзоны (docs/datetime-conventions).
    // new Date(periodTo) + setHours брали зону сервера, то есть UTC: восточнее
    // из выборки выпадал хвост последнего дня, западнее прилипал чужой.
    const tz = resolveTimezone(await Preferences.findOne({}));
    const fromDate = dayjs.tz(periodFrom, tz).startOf("day").toDate();
    const toDate = dayjs.tz(periodTo, tz).endOf("day").toDate();

    // Find all approved reports that overlap with the period
    const approvedReports = await ServicePlanReport.find({
      status: { $in: ["approved", "awaitingPayment", "paid", "archived"] },
      $or: [
        {
          // Report starts within our period
          periodFrom: { $gte: fromDate, $lte: toDate },
        },
        {
          // Report ends within our period
          periodTo: { $gte: fromDate, $lte: toDate },
        },
        {
          // Report spans our entire period
          periodFrom: { $lte: fromDate },
          periodTo: { $gte: toDate },
        },
      ],
    })
      .populate({
        path: "works",
        populate: {
          path: "tickets",
          select: "num categoryId applicantId",
          populate: [
            { path: "categoryId", select: "title" },
            { path: "applicantId", select: "firstName lastName" },
          ],
        },
      })
      .populate("company", "fullTitle alias profileImagePath")
      .populate("servicePlan", "title");

    // Group works by employee. Люди без финансового учёта в отчёт по
    // сотрудникам не идут — тем же правилом, что сводка и динамика
    const untracked = await untrackedUserIds();
    const employeeWorksMap = new Map();

    for (const report of approvedReports) {
      for (const work of report.works) {
        if (!work.finishedBy || !work.finishedBy._id) continue;
        if (untracked.has(work.finishedBy._id.toString())) continue;

        const employeeId = work.finishedBy._id.toString();
        const employeeName = `${work.finishedBy.lastName} ${work.finishedBy.firstName}`;

        if (!employeeWorksMap.has(employeeId)) {
          employeeWorksMap.set(employeeId, {
            employee: {
              _id: employeeId,
              name: employeeName,
              firstName: work.finishedBy.firstName,
              lastName: work.finishedBy.lastName,
            },
            works: [],
            totalWorksCount: 0,
            totalDuration: 0,
          });
        }

        const employeeData = employeeWorksMap.get(employeeId);

        // Calculate work duration
        const duration =
          work.startedAt && work.finishedAt
            ? new Date(work.finishedAt) - new Date(work.startedAt)
            : 0;

        // Prepare work data
        const workData = {
          _id: work._id,
          description: work.description,
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
          duration: duration,
          company: report.company,
          servicePlan: report.servicePlan,
          report: {
            _id: report._id,
            periodFrom: report.periodFrom,
            periodTo: report.periodTo,
            status: report.status,
          },
          tickets: work.tickets.map((ticket) => ({
            _id: ticket._id,
            num: ticket.num,
            category: ticket.categoryId?.title || "Без категории",
            applicant: ticket.applicantId
              ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
              : "Не указан",
          })),
          withinPlan: work.withinPlan,
        };

        employeeData.works.push(workData);
        employeeData.totalWorksCount++;
        employeeData.totalDuration += duration;
      }
    }

    // Convert map to array and sort by employee name
    const employeeReports = Array.from(employeeWorksMap.values()).sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name),
    );

    // Calculate totals
    const totals = {
      totalEmployees: employeeReports.length,
      totalWorks: employeeReports.reduce(
        (sum, emp) => sum + emp.totalWorksCount,
        0,
      ),
      totalDuration: employeeReports.reduce(
        (sum, emp) => sum + emp.totalDuration,
        0,
      ),
    };

    res.status(200).json({
      employees: employeeReports,
      totals: totals,
      period: {
        from: fromDate,
        to: toDate,
      },
    });
  } catch (error) {
    next(new AppError("Failed to generate employee report", 500, true, error));
  }
};
