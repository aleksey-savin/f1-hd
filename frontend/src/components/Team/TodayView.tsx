import type { TeamMember, TeamScheduleResponse } from "@/types/teamSchedule";
import { WORK_STATUSES, getWorkStatusMeta } from "@/util/work-statuses";

import { fullName, humanDate, initialsOf, offsetLabel, statusColor } from "./calendar";

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

const Row = ({ member, todayKey }: { member: TeamMember; todayKey: string }) => {
  const day = member.days.find((item) => item.date === todayKey);
  const absence = day?.absence ?? null;
  const status = member.status;

  return (
    <div className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:px-4 tw:py-2.5 tw:first:border-t-0">
      <span
        className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground"
        style={{
          boxShadow: `0 0 0 2px var(--card), 0 0 0 3.5px ${statusColor(status?.code)}`,
        }}
      >
        {initialsOf(member.user)}
      </span>

      <span className="tw:min-w-0 tw:flex-1">
        <span className="tw:block tw:truncate tw:text-sm tw:font-medium tw:text-foreground">
          {fullName(member.user)}
        </span>
        <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
          {member.user.position ?? "Должность не указана"} · {member.city}{" "}
          <span className="tw:tabular-nums">{offsetLabel(member.utcOffsetMinutes)}</span>
        </span>
      </span>

      <span className="tw:flex-none tw:text-right">
        <span className="tw:block tw:text-xs tw:text-foreground">
          {status ? `${status.emoji} ${status.label}` : "статус скрыт"}
        </span>
        {/* Формулировка без привязки к полу: «у него» подходит не всем */}
        <span className="tw:block tw:text-xs tw:text-faint tw:tabular-nums">
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
      <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-5 tw:py-12 tw:text-center tw:text-sm tw:text-muted-foreground">
        Сегодняшний день не входит в выбранный период — вернитесь к текущему месяцу.
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
    <div className="tw:grid tw:gap-4 tw:md:grid-cols-2 tw:xl:grid-cols-3">
      {GROUP_ORDER.map((group) => {
        const list = data.employees.filter((member) => kindOf(member) === group.kind);
        if (!list.length) return null;
        return (
          <section
            key={group.kind}
            className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card"
          >
            <header className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-border-soft tw:px-4 tw:py-2.5 tw:text-xs tw:font-bold tw:tracking-wider tw:uppercase">
              <i
                className="tw:size-2 tw:rounded-full"
                style={{ background: colorOfKind(group.kind) }}
              />
              {group.label}
              <span className="tw:ms-auto tw:text-faint tw:tabular-nums">
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
