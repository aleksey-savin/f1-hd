// Формы ответов раздела «Сотрудники» (backend: services/employeesSummaryService
// и services/personalReportService). Типизация у границы: один `as` на
// response.json() в сторах store/reports/*.

export type WorkClassStat = { count: number; minutes: number };

export type WorkClassKey = "onSite" | "remote" | "routineTask";

export type FinanceStatusKey =
  | "approved"
  | "underReview"
  | "pendingApproval"
  | "preview"
  | "declined"
  | "none";

export type StatusStat = { count: number; minutes: number };

/**
 * Переработки одного типа дней. `pay` — деньги: без права `user.manageFinances`
 * (и не в своём отчёте) сервер поля не отдаёт.
 */
export type OvertimeBucket = {
  minutes: number;
  coefficient: number;
  pay?: number | null;
};

export type OvertimeTotals = {
  roundedMinutes: number;
  weekdayMinutes: number;
  weekendMinutes: number;
  /** Работа в праздник по производственному календарю — свой коэффициент. */
  holidayMinutes: number;
};

// ------------------------------------------------------- сводка по всем

/** Разрез времени по компаниям/категориям — общий для команды и сотрудника. */
export type BreakdownRow = {
  _id: string | null;
  minutes: number;
  worksCount: number;
  sharePercent: number;
};

export type CompanyBreakdownRow = BreakdownRow & {
  alias: string;
  onSiteCount: number;
  ticketsFinished?: number;
  /** Только в разрезе по команде: сколько сотрудников работали с компанией. */
  employeesCount?: number;
};

export type CategoryBreakdownRow = BreakdownRow & { title: string };

export type EmployeesTotals = {
  employeesCount: number;
  employeesWithWorks: number;
  worksCount: number;
  ticketsFinished: number;
  totalMinutes: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
  overtime: OvertimeTotals;
  /** Деньги: только у обладателя `user.manageFinances`, иначе поля нет. */
  overtimePaySum?: number;
  /** Сколько сотрудников имеют переработки, но не имеют ставки. */
  missingRateCount: number;
  /** Норма периода по производственному календарю и личным графикам. */
  normMinutes: number;
  absenceDays: number;
  /** У скольких не задан личный график — их переработки считаются по-старому. */
  noScheduleCount: number;
  /** Средняя длительность работы — знаменатель у «Работ» в KPI. */
  avgWorkMinutes: number;
};

export type EmployeeRow = {
  employee: {
    _id: string;
    firstName: string;
    lastName: string;
    position: string | null;
    isActive: boolean;
  };
  worksCount: number;
  ticketsFinished: number;
  totalMinutes: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
  overtime: OvertimeTotals & { actualMinutes: number; worksCount: number };
  /** Норма периода: график сотрудника × производственный календарь − отсутствия. */
  normMinutes: number;
  normMinutesBeforeAbsences: number;
  workingDays: number;
  absenceDays: number;
  utilizationPercent: number | null;
  timezone: string;
  scheduleSource: "user" | "plan" | "company" | "fallback";
  hasPersonalSchedule: boolean;
  /**
   * Деньги (ставка и доплата) приходят только обладателю
   * `user.manageFinances` — у остальных остаются минуты и флаг «нет ставки».
   */
  payroll: {
    overtimeHourlyRate?: number | null;
    weekday: OvertimeBucket;
    weekend: OvertimeBucket;
    overtimePay?: number | null;
    missingRate: boolean;
  };
  /** Разрезы приходят только в режиме «Статистика» (includeBreakdown). */
  byCompany?: CompanyBreakdownRow[];
  byCategory?: CategoryBreakdownRow[];
};

export type ReportPeriod = {
  from: string;
  to: string;
  days: number;
  isFullMonth: boolean;
  timezone: string;
};

export type EmployeesSummaryResponse = {
  period: ReportPeriod;
  approvedOnly: boolean;
  settings: {
    weekdayCoefficient: number;
    weekendCoefficient: number;
    defaultTariffingPeriodMinutes: number;
  };
  totals: EmployeesTotals;
  byStatus: Partial<Record<FinanceStatusKey, StatusStat>>;
  byCompany: CompanyBreakdownRow[];
  byCategory: CategoryBreakdownRow[];
  employees: EmployeeRow[];
  prev: { period: ReportPeriod; totals: EmployeesTotals };
};

// ───────────────────────────────────── динамика по команде (12 месяцев)

export type TrendMonth = {
  month: string;
  label: string;
  minutes: number;
  overtimeMinutes: number;
  worksCount: number;
  ticketsFinished: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
};

export type EmployeeTrendSeries = {
  employee: {
    _id: string;
    firstName: string;
    lastName: string;
    position: string | null;
    isActive: boolean;
  };
  totalMinutes: number;
  rank: number;
  months: {
    month: string;
    label: string;
    minutes: number;
    overtimeMinutes: number;
    worksCount: number;
  }[];
};

export type EmployeesTrendResponse = {
  period: {
    from: string | null;
    to: string | null;
    months: number;
    timezone: string;
  };
  approvedOnly: boolean;
  months: TrendMonth[];
  byEmployee: EmployeeTrendSeries[];
  meta: { employeesCount: number };
};

// -------------------------------------------------- персональный отчёт

export type PersonalTotals = {
  worksCount: number;
  totalMinutes: number;
  onSite: WorkClassStat;
  remote: WorkClassStat;
  routineTask: WorkClassStat;
  ticketsFinished: number;
  byStatus: Partial<Record<FinanceStatusKey, StatusStat>>;
  overtime: OvertimeTotals & {
    actualMinutes: number;
    daysWithOvertime: number;
    byScheduleSource: { plan: number; company: number; fallback: number };
  };
  normMinutes: number;
  workingDaysCount: number;
  utilizationPercent: number | null;
};

export type PersonalDay = {
  date: string;
  minutes: number;
  overtimeMinutes: number;
  worksCount: number;
  onSiteCount: number;
};

export type PersonalMonth = {
  month: string;
  minutes: number;
  overtimeMinutes: number;
  worksCount: number;
};

export type PersonalBreakdown = {
  _id: string | null;
  minutes: number;
  worksCount: number;
  sharePercent: number;
};

export type PersonalCompany = PersonalBreakdown & {
  alias: string;
  onSiteCount: number;
  overtimeMinutes: number;
};

export type PersonalCategory = PersonalBreakdown & { title: string };

export type PersonalWork = {
  _id: string;
  description: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;
  visitRequired: boolean;
  workClass: WorkClassKey;
  withinPlan: boolean;
  alwaysWithinPlan: boolean;
  financesStatus: FinanceStatusKey | null;
  company: { _id: string; alias: string } | null;
  tickets: { _id: string; num: number; title: string }[];
  scheduleSource: "plan" | "company" | "fallback";
  planTitle: string | null;
  tariffingPeriodMinutes: number;
  overtime: { actualMinutes: number; roundedMinutes: number };
  issues: string[];
};

/**
 * Расчёт за период. Денежные поля необязательны: в чужом отчёте их отдают
 * только обладателю `user.manageFinances`, в своём — всегда.
 */
export type PersonalPayroll = {
  salary?: number | null;
  overtimeHourlyRate?: number | null;
  weekday: OvertimeBucket;
  weekend: OvertimeBucket;
  overtimePay?: number | null;
  estimatedTotal?: number | null;
  isFullMonth: boolean;
  missing: { salary: boolean; overtimeHourlyRate: boolean };
};

export type PersonalReportResponse = {
  /** Чей это отчёт (isSelf — свой). */
  employee: {
    _id: string;
    firstName: string;
    lastName: string;
    position: string;
    isSelf: boolean;
  };
  period: ReportPeriod;
  settings: {
    defaultTariffingPeriodMinutes: number;
    weekdayCoefficient: number;
    weekendCoefficient: number;
  };
  totals: PersonalTotals;
  payroll: PersonalPayroll;
  byDay: PersonalDay[];
  byMonth: PersonalMonth[];
  byCompany: PersonalCompany[];
  byCategory: PersonalCategory[];
  works: PersonalWork[];
  warnings: {
    excludedWorks: number;
    overlapMinutes: number;
    fallbackScheduleWorks: number;
  };
  prevPeriod: {
    period: ReportPeriod;
    totals: PersonalTotals;
    overtimePay?: number | null;
  };
};
