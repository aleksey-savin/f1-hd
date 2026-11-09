import { SCHEDULE_DAYS } from "@/components/app/ScheduleEditor";
import type { ScheduleDay, WeekSchedule } from "@/types/teamSchedule";
import { dayIntervals, intervalMinutes } from "@/util/work-schedule";
import { getWorkStatusMeta } from "@/util/work-statuses";

export function DayPlaceSummary({
  day,
  remoteOnly = false,
}: {
  day: ScheduleDay;
  remoteOnly?: boolean;
}) {
  const rows = dayIntervals(day, remoteOnly);
  const windows = intervalMinutes(day, rows);
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {rows.map((row, index) => {
        const Icon = getWorkStatusMeta(row.place)?.icon;
        return (
          <span key={index} className="inline-flex items-center gap-1.5">
            <span className="tabular-nums">
              {day.is24hours && rows.length === 1
                ? "24 часа"
                : `${row.start}–${row.end}${windows[index].end >= 1440 ? " +1" : ""}`}
            </span>
            {Icon && <Icon className="shrink-0 text-muted-foreground" />}
            <span className="text-muted-foreground">
              {row.place === "remote" ? "удалённо" : "офис"}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export default function WorkScheduleView({
  schedule,
  remoteOnly = false,
}: {
  schedule: WeekSchedule;
  remoteOnly?: boolean;
}) {
  return (
    <div className="divide-y divide-border-soft">
      {SCHEDULE_DAYS.map(([label, key, short]) => (
        <div key={key} className="flex gap-4 py-3 text-sm">
          <span className="w-8 shrink-0 font-semibold" title={label}>
            {short}
          </span>
          {schedule[key]?.isWorking ? (
            <DayPlaceSummary day={schedule[key]} remoteOnly={remoteOnly} />
          ) : (
            <span className="text-faint">Выходной</span>
          )}
        </div>
      ))}
    </div>
  );
}
