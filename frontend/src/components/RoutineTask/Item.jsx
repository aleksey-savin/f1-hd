import { RiCalendarScheduleLine } from "react-icons/ri";

import ListRow from "@/components/app/ListRow";
import { cn } from "@/lib/utils";
import {
  describeCron,
  formatCronRun,
  isValidCron,
  nextCronRuns,
} from "@/util/cron";

const RoutineTaskItem = ({ item }) => {
  const { title, cronSchedule, isActive, checklist = [] } = item;

  const runs =
    isActive && isValidCron(cronSchedule) ? nextCronRuns(cronSchedule, 1) : [];
  const nextRun = runs[0];

  const meta = [
    describeCron(cronSchedule),
    checklist.length ? `чек-лист ${checklist.length}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const trailing = (
    <span className="flex flex-col items-end gap-0.5 max-md:hidden">
      <span
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium",
          isActive ? "text-accent-text" : "text-faint",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            isActive ? "bg-primary" : "bg-faint",
          )}
        />
        {isActive ? "Активно" : "На паузе"}
      </span>
      {isActive && nextRun && (
        <span className="text-xs text-faint tabular-nums">
          след. {formatCronRun(nextRun)}
        </span>
      )}
    </span>
  );

  return (
    <ListRow
      item={item}
      itemTitle="routineTask"
      monogram={<RiCalendarScheduleLine className="size-6" />}
      title={title}
      meta={meta}
      trailing={trailing}
      detailTo={`/routine-tasks/${item._id}`}
    />
  );
};

export default RoutineTaskItem;
