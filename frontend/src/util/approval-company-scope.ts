import type { PipelineResponse, StageStat } from "../types/approval";

/** Restrict the already authorized dataset, including the pipeline's counters. */
export function scopeApprovalPipeline(
  data: PipelineResponse | null,
  companyId: string,
): PipelineResponse | null {
  if (!data || !companyId) return data;
  const preview = data.preview.filter((row) => row.company._id === companyId);
  const reports = data.reports.filter((row) => row.company._id === companyId);
  const stages: PipelineResponse["stages"] = {
    preview: {
      count: preview.length,
      total: preview.reduce((sum, row) => sum + row.total, 0),
      unrelatedWorks: preview.reduce(
        (sum, row) => sum + row.unrelatedWorksCount,
        0,
      ),
    },
  };
  for (const row of reports) {
    if (row.status === "archived") continue;
    const stat: StageStat = stages[row.status] ?? { count: 0, total: 0 };
    stat.count++;
    stat.total += row.total ?? 0;
    stages[row.status] = stat;
  }
  const now = Date.now();
  const daysBetween = (from: number, to: number) =>
    Math.floor((to - from) / 86400000);
  for (const status of [
    "pendingApproval",
    "approved",
    "awaitingPayment",
  ] as const) {
    const oldest = reports
      .filter((row) => row.status === status)
      .map((row) =>
        status === "pendingApproval"
          ? row.approval?.deadlineAt
          : status === "approved"
            ? row.updatedAt
            : row.invoice?.date,
      )
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    const stat = stages[status];
    if (!stat || !oldest) continue;
    if (status === "pendingApproval") {
      stat.nearestDeadlineAt = oldest;
      stat.nearestDeadlineDays = daysBetween(now, new Date(oldest).getTime());
    } else if (status === "approved")
      stat.oldestDays = daysBetween(new Date(oldest).getTime(), now);
    else stat.oldestInvoiceDays = daysBetween(new Date(oldest).getTime(), now);
  }
  return { ...data, preview, reports, stages };
}
