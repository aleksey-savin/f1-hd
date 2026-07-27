import type {
  CompanyTrends,
  ReportTotals,
  TrendPeriod,
  TrendsResponse,
} from "../../types/report";

// Пивоты «Динамики» по загруженным данным (все — чистые функции без запросов).

// Пять метрик динамики — те же, что в легаси-режиме «Анализ трендов»
export type TrendsMetric = {
  key: "totalTime" | "totalTickets" | "onSiteCount" | "remoteCount" | "routineTime";
  label: string;
  isTime: boolean;
  of: (totals: ReportTotals) => number;
};

export const TRENDS_METRICS: readonly TrendsMetric[] = [
  { key: "totalTime", label: "Время работ", isTime: true, of: (t) => t.totalTime },
  { key: "totalTickets", label: "Заявки", isTime: false, of: (t) => t.totalTickets },
  { key: "onSiteCount", label: "Выезды", isTime: false, of: (t) => t.onSite.count },
  { key: "remoteCount", label: "Удалённо", isTime: false, of: (t) => t.remote.count },
  { key: "routineTime", label: "Регламентные", isTime: true, of: (t) => t.routineTask.time },
] as const;

export type AggregatedPeriod = {
  key: string;
  label: string;
  totals: ReportTotals;
};

// Ось периодов: у всех компаний периоды одинаковые — берём у первой
export const periodAxis = (data: TrendsResponse | null): TrendPeriod[] =>
  data?.data[0]?.periods ?? [];

// «Итого» по каждому периоду — сумма по всем компаниям выборки
export const aggregatePeriods = (
  data: TrendsResponse | null,
): AggregatedPeriod[] => {
  const axis = periodAxis(data);
  return axis.map((period, index) => {
    const totals: ReportTotals = {
      totalTickets: 0,
      totalWorks: 0,
      totalTime: 0,
      onSite: { count: 0, time: 0 },
      remote: { count: 0, time: 0 },
      routineTask: { count: 0, time: 0 },
    };
    for (const companyTrends of data?.data ?? []) {
      const companyPeriod = companyTrends.periods[index];
      if (!companyPeriod) continue;
      totals.totalTickets += companyPeriod.totalTickets;
      totals.totalWorks += companyPeriod.totalWorks;
      totals.totalTime += companyPeriod.totalTime;
      for (const key of ["onSite", "remote", "routineTask"] as const) {
        totals[key].count += companyPeriod[key].count;
        totals[key].time += companyPeriod[key].time;
      }
    }
    return { key: period.key, label: period.label, totals };
  });
};

// Базовый порядок компаний — по суммарному времени за весь диапазон.
// Он же раздаёт слоты палитры: смена метрики ничего не перекрашивает.
export const companiesByTotalTime = (
  data: TrendsResponse | null,
): CompanyTrends[] =>
  [...(data?.data ?? [])].sort(
    (a, b) =>
      b.periods.reduce((sum, period) => sum + period.totalTime, 0) -
      a.periods.reduce((sum, period) => sum + period.totalTime, 0),
  );
