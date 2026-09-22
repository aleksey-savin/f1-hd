import { Link } from "react-router";
import { RiComputerLine, RiMapPin2Line } from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useMinuteTick from "@/hooks/use-minute-tick";
import usePlannedWorksStore from "@/store/dashboard-planned-works";
import {
  businessDaysAgo,
  formatDayMonth,
  formatTime,
} from "@/util/format-date";

import { splitPlan } from "./planned-works";

/**
 * «Дальше в плане» — свои плановые работы с завтра на две недели вперёд.
 *
 * Пара к полосе «Сегодня в плане» (`TodayPlan`): сегодняшнее и неподтверждённое
 * стоит там, сверху; здесь — то, к чему готовятся, а не то, куда едут сейчас.
 * Поэтому блок тихий и стоит первым в правой колонке, а не над заявками.
 *
 * Ссылки «Все работы» нет: архив работ показывает выполненные, а плановых
 * списком в интерфейсе нет — обещание, которого раздел не держит, хуже
 * отсутствия ссылки.
 */

const ROWS = 5;

const dayLabel = (date: string) =>
  businessDaysAgo(date) === -1 ? "завтра" : formatDayMonth(date);

const UpcomingWorks = () => {
  const works = usePlannedWorksStore((state) => state.works);
  const now = useMinuteTick();
  const fromState = useCrumbFrom("Главная");

  const { upcoming } = splitPlan(works, { now, daysAgo: businessDaysAgo });
  if (upcoming.length === 0) return null;

  return (
    <section>
      <Eyebrow count={upcoming.length}>Дальше в плане</Eyebrow>
      <Panel>
        <div className="-mx-5 -my-5 overflow-hidden rounded-[inherit]">
          {upcoming.slice(0, ROWS).map(({ work }) => {
            const ticket = work.tickets[0];
            const Icon = work.visitRequired ? RiMapPin2Line : RiComputerLine;
            const kind = work.visitRequired ? "Выезд" : "Удалённо";
            return (
              <div
                key={work._id}
                className="relative flex gap-3 border-t border-border-soft px-5 py-2.5 first:border-t-0 hover:bg-accent/60"
              >
                <span className="w-20 flex-none text-sm tabular-nums">
                  <span className="block font-semibold">
                    {dayLabel(work.planningToStart)}
                  </span>
                  <span className="block text-xs text-faint">
                    {formatTime(work.planningToStart)}
                    {work.planningToFinish
                      ? `–${formatTime(work.planningToFinish)}`
                      : ""}
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    <Icon
                      size={14}
                      aria-hidden
                      className="flex-none text-faint"
                    />
                    <span className="truncate">
                      {kind}
                      {work.company?.alias ? ` · ${work.company.alias}` : ""}
                    </span>
                  </span>
                  {ticket && (
                    <Link
                      to={`/tickets/${ticket.num}`}
                      state={fromState}
                      className="block truncate text-muted-foreground no-underline outline-none after:absolute after:inset-0 hover:text-foreground focus-visible:after:ring-4 focus-visible:after:ring-ring/50"
                    >
                      {ticket.num} · {ticket.title || "Без темы"}
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
          {upcoming.length > ROWS && (
            <div className="border-t border-border-soft px-5 py-2.5 text-sm text-muted-foreground tabular-nums">
              Показаны {ROWS} из {upcoming.length}
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
};

export default UpcomingWorks;
