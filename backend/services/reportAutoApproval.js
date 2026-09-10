const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const ServicePlanReport = require("@/models/finances/servicePlanReport");

const logger = require("@/utils/logger");
const { finalize, pendingApprovers } = require("@/services/reportApproval");
const {
  notifyApprovalRequested,
} = require("@/services/reportApprovalNotifications");
const { resolveTimezone } = require("@/utils/datetime");

/**
 * Срок согласования по договору.
 *
 * «Клиент обязан согласовать в течение N дней» — значит молчание после срока
 * тоже решение. Без этого отчёт висел бы в очереди вечно, а выставление счёта
 * зависело бы от того, зайдёт ли согласующий в почту.
 *
 * Раз в сутки:
 *  - за 24 часа до срока — напоминание всем, кто ещё не подписал (один раз на
 *    попытку, отметка `approval.remindedAt`); автоподпись не должна быть
 *    сюрпризом;
 *  - после срока — подпись от имени системы (`actor: "system"`,
 *    `action: "autoApproved"`), обе стороны получают уведомление.
 *
 * Отчёт, вернувшийся к нам на правку (`declined`), сюда не попадает: у него
 * `deadlineAt = null`, и договорный срок не тикает, пока мяч на нашей стороне.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const runReportAutoApproval = async (now = new Date()) => {
  const preferences = await Preferences.findOne({}).lean();
  if (!preferences?.reportApproval?.autoApprove?.isActive) {
    return { checked: 0, reminded: 0, approved: 0, skipped: "выключено" };
  }

  const due = await ServicePlanReport.find({
    status: "pendingApproval",
    "approval.deadlineAt": { $ne: null, $lte: new Date(now.getTime() + DAY_MS) },
  });

  let reminded = 0;
  let approved = 0;

  for (const report of due) {
    try {
      const [company, servicePlan] = await Promise.all([
        Company.findById(report.company).lean(),
        ServicePlan.findById(report.servicePlan).lean(),
      ]);
      const zone = resolveTimezone(preferences);

      if (report.approval.deadlineAt <= now) {
        await finalize({
          report,
          approve: true,
          actor: null,
          actorKind: "system",
          company,
          servicePlan,
          zone,
        });
        approved += 1;
        logger.log("info", "Report auto-approved by contract deadline", {
          module: "reportAutoApproval",
          reportId: String(report._id),
          company: company?.alias,
        });
        continue;
      }

      // Напоминание за сутки — один раз на попытку
      if (!report.approval.remindedAt) {
        const recipients = await pendingApprovers(report);
        if (recipients.length > 0) {
          await notifyApprovalRequested({
            report,
            company,
            servicePlan,
            recipients,
            isReminder: true,
            timezone: zone,
          });
        }
        report.approval.remindedAt = now;
        report.timeline.push({
          at: now,
          actor: "system",
          action: "reminded",
          scope: "report",
        });
        await report.save();
        reminded += 1;
      }
    } catch (error) {
      // Один битый отчёт не должен ронять весь прогон
      logger.log("error", "Report auto-approval failed for one report", {
        module: "reportAutoApproval",
        reportId: String(report._id),
        error: error.message,
      });
    }
  }

  if (reminded || approved) {
    logger.log("info", "Report auto-approval run finished", {
      module: "reportAutoApproval",
      checked: due.length,
      reminded,
      approved,
    });
  }

  return { checked: due.length, reminded, approved };
};

module.exports = { runReportAutoApproval };
