import type {
  CompanyTrends,
  ReportTotals,
  TrendPeriod,
  TrendsResponse,
} from "../../types/report";

// Пивоты «Динамики» по загруженным данным (все — чистые функции без запросов).

// Пять метрик динамики — те же, что в легаси-режиме «Анализ трендов»
type TrendsMetric = {
  key:
    | "totalTime"
    | "totalTickets"
    | "onSiteCount"
    | "remoteCount"
    | "routineTime";
  label: string;
  isTime: boolean;
  of: (totals: ReportTotals) => number;
};

export const TRENDS_METRICS: readonly TrendsMetric[] = [
  {
    key: "totalTime",
    label: "Время работ",
    isTime: true,
    of: (t) => t.totalTime,
  },
  {
    key: "totalTickets",
    label: "Заявки",
    isTime: false,
    of: (t) => t.totalTickets,
  },
  {
    key: "onSiteCount",
    label: "Выезды",
    isTime: false,
    of: (t) => t.onSite.count,
  },
  {
    key: "remoteCount",
    label: "Удалённо",
    isTime: false,
    of: (t) => t.remote.count,
  },
  {
    key: "routineTime",
    label: "Регламентные",
    isTime: true,
    of: (t) => t.routineTask.time,
  },
] as const;

export type AggregatedPeriod = {
  key: string;
  label: string;
  totals: ReportTotals;
};

// Ось периодов и итоги по ним считает сервер (поле overall): складывать
// уникальные заявки компаний на клиенте нельзя — одна заявка живёт в одной
// компании, но сумма «уникальных» по срезам не равна уникальным глобально
export const periodAxis = (data: TrendsResponse | null): TrendPeriod[] =>
  data?.overall ?? [];

export const aggregatePeriods = (
  data: TrendsResponse | null,
): AggregatedPeriod[] =>
  (data?.overall ?? []).map((period) => ({
    key: period.key,
    label: period.label,
    totals: period as ReportTotals,
  }));

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
