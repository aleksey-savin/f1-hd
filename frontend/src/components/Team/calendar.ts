import type { CalendarDay, TeamMember } from "@/types/teamSchedule";
import { getAbsenceType } from "@/util/absence-types";
import { WORK_STATUSES } from "@/util/work-statuses";

// Календарь измеряет ЛЮДЕЙ, а не часы: одна точка — один сотрудник, цвет —
// что с ним в этот день. Палитра — существующие токены присутствия, чтобы
// календарь и бар статусов говорили одним языком.

export const DOW_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** День недели календарной даты (Monday-first). В UTC — это дата, не инстант. */
export const dowOf = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

export const dayNumber = (dateKey: string) => Number(dateKey.slice(8, 10));

export const humanDate = (dateKey: string) =>
  dateKey.split("-").reverse().join(".");

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «10 июня, среда» — заголовок поповера дня. */
export const longDate = (dateKey: string) => {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}, ${DOW_SHORT[dowOf(dateKey)]}`;
};

export const statusColor = (code: string | null | undefined) =>
  WORK_STATUSES.find((status) => status.code === code)?.color ??
  "var(--ws-st-unset)";

export const PLANNED_COLOR =
  "color-mix(in srgb, var(--ws-st-office) 55%, transparent)";
export const OFF_COLOR =
  "color-mix(in srgb, var(--foreground) 9%, transparent)";

type DotState = {
  color: string;
  /** Запрос на согласовании — пунктирное кольцо: не решено ≠ решено. */
  hollow: boolean;
  title: string;
};

/**
 * Состояние точки. Знание о прошлом и будущем разное и не смешивается:
 * сегодня — живой статус присутствия, дальше — план (график + отсутствия).
 */
export const dotState = (
  member: TeamMember,
  day: CalendarDay,
  isToday: boolean,
): DotState => {
  const who = `${member.user.lastName} ${member.user.firstName}`.trim();

  if (day.absence) {
    const color =
      getAbsenceType(day.absence.type)?.color ?? "var(--ws-st-unset)";
    const pending = day.absence.status === "pending";
    return {
      color,
      hollow: pending,
      title: `${who} — ${pending ? "запрос: " : ""}${day.absence.label.toLowerCase()}`,
    };
  }
  if (day.offDuty) {
    return {
      color: OFF_COLOR,
      hollow: false,
      title: `${who} — ${day.holidayTitle ?? "не на работе"}`,
    };
  }
  if (isToday && member.status) {
    return {
      color: statusColor(member.status.code),
      hollow: false,
      title: `${who} — ${member.status.label}${member.status.note ? ` · ${member.status.note}` : ""}`,
    };
  }
  return {
    color: PLANNED_COLOR,
    hollow: false,
    title: `${who} — по графику работает`,
  };
};

export const fullName = (user: TeamMember["user"]) =>
  `${user.lastName ?? ""} ${user.firstName ?? ""}`.trim() || "Без имени";

export const initialsOf = (user: TeamMember["user"]) =>
  `${(user.lastName ?? "").slice(0, 1)}${(user.firstName ?? "").slice(0, 1)}`.toUpperCase();

export const offsetLabel = (minutes: number) => {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
};

/** Порог «команда просела»: меньше 70 % работающих от всего состава. */
export const isThin = (working: number, total: number) =>
  total > 0 && working > 0 && working / total < 0.7;
