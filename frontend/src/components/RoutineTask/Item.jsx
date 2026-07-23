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
    <span className="tw:flex tw:flex-col tw:items-end tw:gap-0.5 tw:max-md:hidden">
      <span
        className={cn(
          "tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:font-medium",
          isActive ? "tw:text-accent-text" : "tw:text-faint",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "tw:size-1.5 tw:rounded-full",
            isActive ? "tw:bg-primary" : "tw:bg-faint",
          )}
        />
        {isActive ? "Активно" : "На паузе"}
      </span>
      {isActive && nextRun && (
        <span className="tw:text-xs tw:text-faint tw:tabular-nums">
          след. {formatCronRun(nextRun)}
        </span>
      )}
    </span>
  );

  return (
    <ListRow
      item={item}
      itemTitle="routineTask"
      monogram={<RiCalendarScheduleLine className="tw:size-6" />}
      title={title}
      meta={meta}
      trailing={trailing}
      detailTo={`/routine-tasks/${item._id}`}
    />
  );
};

export default RoutineTaskItem;
