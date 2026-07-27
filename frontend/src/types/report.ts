// Формы ответов отчёта «Аналитика» (backend/controllers/report.js:
// getCompanySummary и getTrendsAnalysis). Типизация у границы: один `as` на
// response.json() в сторах store/reports/*.

export type WorkClassStat = { count: number; time: number };

// Итоги набора работ: счётчики и время по классам (выезды / удалённо /
// регламент) — форма summarizeWorks бэкенда + уникальные заявки
export type ReportTotals = {
  totalTickets: number;
  totalWorks: number;
  totalTime: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
};

export type CompanyRef = { _id: string; alias: string; name: string };

export type ExecutorSummary = {
  name: string;
  totalWorks: number;
  totalTime: number;
  onSiteWorks: number;
  remoteWorks: number;
  onSiteTime: number;
  remoteTime: number;
  routineTaskWorks: number;
  routineTaskTime: number;
};

export type SubdivisionSummary = {
  _id: string;
  name: string;
  totalWorks: number;
  totalTime: number;
  onSiteCount: number;
  onSiteTime: number;
  remoteCount: number;
  remoteTime: number;
  routineTaskCount: number;
  routineTaskTime: number;
};

export type CompanySummary = ReportTotals & {
  company: CompanyRef;
  /** Пуст в клиентском виде */
  executors: ExecutorSummary[];
  /** Заполнен только в клиентском виде */
  subdivisions: SubdivisionSummary[];
};

export type PeriodRange = { from: string; to: string };

export type AnalyticsSummaryResponse = {
  message: string;
  period: PeriodRange;
  totals: ReportTotals;
  prev: { period: PeriodRange; totals: ReportTotals };
  companies: CompanySummary[];
  subdivisions: { _id: string; name: string }[];
  isClientView: boolean;
};

export type TrendsPreset = "12months" | "currentYear" | "lastYear" | "custom";
export type TrendsGrouping = "month" | "quarter" | "week";

export type TrendPeriod = ReportTotals & {
  start: string;
  end: string;
  label: string;
  key: string;
};

export type CompanyTrends = { company: CompanyRef; periods: TrendPeriod[] };

export type TrendsResponse = {
  message: string;
  data: CompanyTrends[];
  meta: {
    period: TrendsPreset;
    grouping: TrendsGrouping;
    startDate: string;
    endDate: string;
    periodsCount: number;
  };
};
