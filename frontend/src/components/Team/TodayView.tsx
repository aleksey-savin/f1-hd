import type { TeamMember, TeamScheduleResponse } from "@/types/teamSchedule";
import { WORK_STATUSES, getWorkStatusMeta } from "@/util/work-statuses";

import {
  fullName,
  humanDate,
  initialsOf,
  offsetLabel,
  statusColor,
} from "./calendar";

type Props = { data: TeamScheduleResponse };

/**
 * Группы строятся ИЗ КАТАЛОГА по полю kind, а не списком кодов: раньше это был
 * единственный экран, где неизвестный статус приводил к исчезновению человека,
 * а не к мягкой деградации.
 */
const GROUP_ORDER: { kind: string; label: string }[] = [
  { kind: "working", label: "Работают" },
  { kind: "break", label: "Перерыв" },
  { kind: "away", label: "Отсутствуют" },
  { kind: "idle", label: "Не на работе" },
];

const Row = ({
  member,
  todayKey,
}: {
  member: TeamMember;
  todayKey: string;
}) => {
  const day = member.days.find((item) => item.date === todayKey);
  const absence = day?.absence ?? null;
  const status = member.status;

  return (
    <div className="flex items-center gap-3 border-t border-border-soft px-4 py-2.5 first:border-t-0">
      <span
        className="grid size-9 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground"
        style={{
          boxShadow: `0 0 0 2px var(--card), 0 0 0 3.5px ${statusColor(status?.code)}`,
        }}
      >
        {initialsOf(member.user)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {fullName(member.user)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {member.user.position ?? "Должность не указана"} · {member.city}{" "}
          <span className="tabular-nums">
            {offsetLabel(member.utcOffsetMinutes)}
          </span>
        </span>
      </span>

      <span className="flex-none text-right">
        <span className="block text-xs text-foreground">
          {status ? `${status.emoji} ${status.label}` : "статус скрыт"}
        </span>
        {/* Формулировка без привязки к полу: «у него» подходит не всем */}
        <span className="block text-xs text-faint tabular-nums">
          {absence
            ? `до ${humanDate(absence.to)}`
            : member.localTime
              ? `местное ${member.localTime}`
              : ""}
        </span>
      </span>
    </div>
  );
};

/** Срез «прямо сейчас»: кому кидать заявку и кто чем занят. */
const TodayView = ({ data }: Props) => {
  const todayKey = data.period.today;

  if (!data.period.todayInPeriod) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
        Сегодняшний день не входит в выбранный период — вернитесь к текущему
        месяцу.
      </div>
    );
  }

  const kindOf = (member: TeamMember) =>
    getWorkStatusMeta(member.status?.code ?? "unset")?.kind ?? "idle";

  // Цвет заголовка группы — от первого статуса этого вида в каталоге
  const colorOfKind = (kind: string) =>
    WORK_STATUSES.find((status) => status.kind === kind)?.color ??
    "var(--ws-st-unset)";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {GROUP_ORDER.map((group) => {
        const list = data.employees.filter(
          (member) => kindOf(member) === group.kind,
        );
        if (!list.length) return null;
        return (
          <section
            key={group.kind}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <header className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5 text-xs font-bold tracking-wider uppercase">
              <i
                className="size-2 rounded-full"
                style={{ background: colorOfKind(group.kind) }}
              />
              {group.label}
              <span className="ms-auto text-faint tabular-nums">
                {list.length}
              </span>
            </header>
            {list.map((member) => (
              <Row key={member.user._id} member={member} todayKey={todayKey} />
            ))}
          </section>
        );
      })}
    </div>
  );
};

export default TodayView;
