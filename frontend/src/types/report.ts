// Формы ответов отчёта «Компании» (backend/services/companiesReportService.js).
// Типизация у границы: один `as` на response.json() в сторах store/reports/*.

export type WorkClassStat = { count: number; time: number };

// Итоги набора работ: счётчики и время по классам (выезды / удалённо /
// регламент) — форма summarize бэкенда + уникальные заявки
export type ReportTotals = {
  totalTickets: number;
  totalWorks: number;
  totalTime: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
};

export type CompanyRef = { _id: string; alias: string; fullTitle?: string };

/** Объём доступа: сервер решает, что видит запрашивающий (services/reportScope). */
export type ReportScope = {
  kind: "all" | "scoped" | "none";
  isClientView: boolean;
  reasons: (
    | "clientsSideResponsible"
    | "subdivisionManager"
    | "ownSubdivision"
  )[];
  /** Единственный доступный объект — открывается сразу, без списка из одной строки. */
  defaultView:
    | { level: "company" | "subdivision"; companyId: string; subdivisionId?: string }
    | null;
};

export type PeriodRange = { from: string; to: string };

export type ReportPeriod = PeriodRange & { days: number; timezone: string };

export type CompanyRow = ReportTotals & {
  company: CompanyRef;
  access: "full" | "partial" | null;
  hasSubdivisions: boolean;
  /** Доступ сужен подразделениями — итог компании заведомо неполный. */
  scopeLimited: boolean;
};

export type CompaniesSummaryResponse = {
  period: ReportPeriod;
  totals: ReportTotals & { companiesWithData: number };
  prev: { period: ReportPeriod; totals: ReportTotals };
  companies: CompanyRow[];
  scope: ReportScope;
};

// ────────────────────────────────────────────── карточки компании и филиала

export type SubdivisionRow = ReportTotals & {
  _id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: { _id: string; name: string }[];
  /** Итог поддерева (узел + вложенные) — по нему сортируются строки. */
  subtree: { totalTickets: number; totalWorks: number; totalTime: number };
};

export type CategoryRow = {
  _id: string | null;
  title: string;
  time: number;
  worksCount: number;
  sharePercent: number;
};

export type ExecutorRow = {
  _id: string;
  name: string;
  time: number;
  worksCount: number;
  onSiteCount: number;
};

export type MonthPoint = {
  month: string;
  label: string;
  totalTime: number;
  totalWorks: number;
};

/** Работы, чьё подразделение не определилось, и заявки без филиала. */
export type ReportDiagnostics = {
  mixedSubdivisionWorks: number;
  unresolvedTickets: number;
  worksWithoutTickets: number;
};

export type CompanyCardResponse = {
  period: ReportPeriod;
  access: "full" | "partial";
  scopeLimited: boolean;
  company: CompanyRef & { timezone: string | null; subdivisionsCount: number };
  totals: ReportTotals;
  prev: { period: ReportPeriod; totals: ReportTotals };
  subdivisions: SubdivisionRow[];
  /** null при суженном доступе: чужие работы в этот бакет не попадают. */
  unassigned: ReportTotals | null;
  byCategory: CategoryRow[];
  executors: ExecutorRow[];
  byMonth: MonthPoint[];
  diagnostics: ReportDiagnostics;
  scope: ReportScope;
};

export type ApplicantRow = {
  _id: string | null;
  firstName: string;
  lastName: string;
  ticketsCount: number;
};

export type SubdivisionCardResponse = {
  period: ReportPeriod;
  includeDescendants: boolean;
  access: "full" | "partial";
  company: CompanyRef;
  subdivision: {
    _id: string;
    name: string;
    parentId: string | null;
    path: { _id: string; name: string }[];
    manager: {
      _id: string;
      firstName: string;
      lastName: string;
      position: string | null;
    } | null;
    usersCount: number;
    timezone: string | null;
    childrenCount: number;
  };
  totals: ReportTotals;
  /** Только сам узел, без вложенных. */
  self: ReportTotals;
  prev: { period: ReportPeriod; totals: ReportTotals };
  children: SubdivisionRow[];
  byCategory: CategoryRow[];
  byApplicant: ApplicantRow[];
  byMonth: MonthPoint[];
  diagnostics: ReportDiagnostics;
  scope: ReportScope;
};

// ────────────────────────────────────────────────────────────── динамика

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
  data: CompanyTrends[];
  /** Итоги по всем компаниям выборки — считает сервер (уникальные заявки). */
  overall: TrendPeriod[];
  meta: {
    period: TrendsPreset;
    grouping: TrendsGrouping;
    startDate: string;
    endDate: string;
    periodsCount: number;
  };
  scope: ReportScope;
};
