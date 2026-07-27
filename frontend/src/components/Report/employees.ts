import type { CompanySummary } from "../../types/report";

// Разрез «Сотрудники» собирается на клиенте из executors компаний (бэкенд
// отдаёт исполнителей в разрезе компании). Идентичность — по имени, как в
// легаси: у executors в ответе нет _id.
export type EmployeeAggregate = {
  name: string;
  totalWorks: number;
  totalTime: number;
  onSiteWorks: number;
  onSiteTime: number;
  remoteWorks: number;
  remoteTime: number;
  routineTaskWorks: number;
  routineTaskTime: number;
  companies: { alias: string; time: number; works: number }[];
};

export const aggregateExecutors = (
  companies: CompanySummary[],
): EmployeeAggregate[] => {
  const byName = new Map<string, EmployeeAggregate>();

  for (const companySummary of companies) {
    for (const executor of companySummary.executors) {
      let aggregate = byName.get(executor.name);
      if (!aggregate) {
        aggregate = {
          name: executor.name,
          totalWorks: 0,
          totalTime: 0,
          onSiteWorks: 0,
          onSiteTime: 0,
          remoteWorks: 0,
          remoteTime: 0,
          routineTaskWorks: 0,
          routineTaskTime: 0,
          companies: [],
        };
        byName.set(executor.name, aggregate);
      }
      aggregate.totalWorks += executor.totalWorks;
      aggregate.totalTime += executor.totalTime;
      aggregate.onSiteWorks += executor.onSiteWorks;
      aggregate.onSiteTime += executor.onSiteTime;
      aggregate.remoteWorks += executor.remoteWorks;
      aggregate.remoteTime += executor.remoteTime;
      aggregate.routineTaskWorks += executor.routineTaskWorks;
      aggregate.routineTaskTime += executor.routineTaskTime;
      aggregate.companies.push({
        alias: companySummary.company.alias,
        time: executor.totalTime,
        works: executor.totalWorks,
      });
    }
  }

  return [...byName.values()].sort((a, b) => b.totalTime - a.totalTime);
};
