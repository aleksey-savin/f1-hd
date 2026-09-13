import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import useLiveTopic from "@/hooks/use-live-topic";
import { useCan } from "@/store/authed-user";
import { AuthedUserContext } from "../../store/authed-user-context";
import {
  businessDaysAgo,
  formatDayMonth,
  formatTime,
} from "../../util/format-date";

/**
 * «Запланировано» — ближайшие выезды и удалённые работы сотрудника.
 *
 * Только СВОИ работы (я исполнитель): страница отвечает на «что на мне
 * сегодня», а чужой график — предмет раздела работ, не лендинга.
 *
 * Прошедшие запланированные работы сюда не попадают. В данных их много —
 * запланировали и не закрыли ещё в 2024-м, — и они бы вытеснили ближайшие,
 * ради которых блок и заводится.
 */

const ROWS = 4;

// «сегодня 14:00» — день словом там, где он рядом, дальше датой.
const whenLabel = (date) => {
  const days = businessDaysAgo(date);
  if (days === 0) return "сегодня";
  if (days === -1) return "завтра";
  return formatDayMonth(date);
};

const ScheduledWorks = () => {
  const { _id: userId } = useContext(AuthedUserContext);
  const can = useCan();
  const fromState = useCrumbFrom("Главная");
  const [works, setWorks] = useState([]);

  // Без права видеть работы блока нет и ручку не дёргаем: ответом всё равно
  // будет отказ.
  const canReadWorks = !!can({ work: ["read"] });

  const load = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/all-scheduled-works`,
      );
      if (!response.ok) throw new Error(`scheduled ${response.status}`);
      const data = await response.json();
      setWorks(Array.isArray(data) ? data : (data.scheduledWorks ?? []));
    } catch (error) {
      console.error("Не удалось загрузить запланированные работы:", error);
    }
  };

  useEffect(() => {
    if (canReadWorks) load();
  }, [canReadWorks]);

  // Работы двигают тему заявок (docs/live-updates.md); тема шумная — не чаще
  // раза в 30 секунд
  useLiveTopic("tickets", load, {
    enabled: canReadWorks,
    minIntervalMs: 30_000,
  });

  const upcoming = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return works
      .filter(
        (work) =>
          String(work.executor?._id) === String(userId) &&
          work.planningToStart &&
          new Date(work.planningToStart) >= dayStart,
      )
      .sort((a, b) => new Date(a.planningToStart) - new Date(b.planningToStart))
      .slice(0, ROWS);
  }, [works, userId]);

  if (!canReadWorks || upcoming.length === 0) return null;

  return (
    <section>
      <Eyebrow
        count={upcoming.length}
        action={
          <Link
            to="/archive?view=works"
            className="text-sm font-medium text-accent-text no-underline"
          >
            Все работы →
          </Link>
        }
      >
        Запланировано
      </Eyebrow>
      <Panel>
        <div className="-mx-5 -my-5">
          {upcoming.map((work) => {
            const ticket = work.tickets?.[0];
            return (
              <div
                key={work._id}
                className="flex gap-3 border-b border-border-soft px-5 py-2.5 last:border-b-0"
              >
                <span className="w-20 flex-none text-sm tabular-nums">
                  <span className="block font-semibold">
                    {whenLabel(work.planningToStart)}
                  </span>
                  <span className="block text-xs text-faint">
                    {formatTime(work.planningToStart)}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {work.visitRequired ? "Выезд" : "Удалённо"}
                    {work.company?.alias ? ` · ${work.company.alias}` : ""}
                  </span>
                  {ticket && (
                    <Link
                      to={`/tickets/${ticket.num}`}
                      state={fromState}
                      className="block truncate text-sm text-muted-foreground no-underline hover:text-foreground"
                    >
                      {ticket.title}
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </section>
  );
};

export default ScheduledWorks;
