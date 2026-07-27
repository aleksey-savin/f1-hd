const ServicePlanReport = require("@/models/finances/servicePlanReport");

/**
 * Фильтр «только согласованные работы» — работы, вошедшие в утверждённые
 * отчёты по услугам. Общий для сводки по сотрудникам и помесячной динамики:
 * переключатель в интерфейсе один, значит и правило должно быть одно.
 */

const APPROVED_REPORT_STATUSES = [
  "approved",
  "awaitingPayment",
  "paid",
  "archived",
];

const filterApprovedWorks = async (works, { fromDate, toDate }) => {
  const reports = await ServicePlanReport.find({
    status: { $in: APPROVED_REPORT_STATUSES },
    periodFrom: { $lte: toDate },
    periodTo: { $gte: fromDate },
  })
    .select("works")
    .lean();

  const approvedWorkIds = new Set();
  for (const report of reports) {
    for (const workId of report.works || []) {
      approvedWorkIds.add(workId.toString());
    }
  }

  return works.filter((work) => approvedWorkIds.has(work._id.toString()));
};

module.exports = { filterApprovedWorks, APPROVED_REPORT_STATUSES };
