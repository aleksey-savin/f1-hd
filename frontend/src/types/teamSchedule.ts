// Контракт GET /api/team/schedule — календарь команды.
// Страница отвечает на «кто доступен», поэтому ни часов, ни нормы, ни
// переработок здесь нет: они живут в отчёте «Сотрудники».

export type DayKind = "work" | "short" | "holiday" | "weekend" | "absence";

export type AbsenceStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ScheduleDay = {
  isWorking: boolean;
  is24hours: boolean;
  start: string;
  end: string;
  breakMinutes?: number;
};

export type WeekSchedule = Record<string, ScheduleDay>;

export type DayAbsence = {
  type: string;
  label: string;
  status: AbsenceStatus;
  /** true — человека нет; командировка и обучение оставляют его в работе. */
  away: boolean;
  from: string;
  to: string;
};

export type CalendarDay = {
  date: string;
  kind: DayKind;
  offDuty: boolean;
  away: boolean;
  holidayTitle: string | null;
  absence: DayAbsence | null;
};

export type PresenceStatus = {
  code: string;
  label: string;
  emoji: string;
  note: string;
  updatedAt: string | null;
};

export type TeamMember = {
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    position: string | null;
    profileImagePath: string | null;
  };
  timezone: string;
  utcOffsetMinutes: number;
  /** Местное время сотрудника на момент запроса — «писать ему сейчас или нет». */
  localTime: string | null;
  city: string;
  hasPersonalSchedule: boolean;
  followsProductionCalendar: boolean;
  schedule: WeekSchedule;
  /** Живой статус присутствия; null — сотрудник его скрыл. */
  status: PresenceStatus | null;
  canVisitClient: boolean;
  days: CalendarDay[];
};

export type DayAvailability = {
  date: string;
  working: number;
  absent: number;
  offDuty: number;
};

export type PendingAbsence = {
  _id: string;
  user: TeamMember["user"];
  type: string;
  typeLabel: string;
  away: boolean;
  from: string;
  to: string;
  comment: string;
  requestedBy: { firstName: string; lastName: string } | null;
  createdAt: string;
};

export type TeamScheduleResponse = {
  period: {
    from: string;
    to: string;
    today: string;
    todayInPeriod: boolean;
    isFullMonth: boolean;
    organizationTimezone: string;
  };
  calendar: {
    isActive: boolean;
    country: string;
    days: { date: string; kind: DayKind; title: string | null }[];
    // Годы без производственного календаря: дни посчитаны по дню недели
    missingYears: number[];
  };
  totals: {
    employeesCount: number;
    workingToday: number | null;
    absentToday: number | null;
    canVisitToday: number | null;
    noScheduleCount: number;
  };
  availability: DayAvailability[];
  employees: TeamMember[];
  pending: PendingAbsence[];
  canManage: boolean;
  canApprove: boolean;
};

export type UserScheduleResponse = {
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    position: string | null;
  };
  timezone: string;
  organizationTimezone: string | null;
  schedule: WeekSchedule;
  scheduleSource: "user" | "fallback";
  hasPersonalSchedule: boolean;
  followsProductionCalendar: boolean;
  period: { from: string; to: string };
  normMinutes: number;
  normMinutesBeforeAbsences: number;
  workingDays: number;
  absenceDays: number;
  days: { date: string; kind: DayKind; minutes: number }[];
};
