import { Link } from "react-router";
import {
  RiCheckboxCircleLine,
  RiComputerLine,
  RiMapPin2Line,
} from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import useMinuteTick from "@/hooks/use-minute-tick";
import { cn } from "@/lib/utils";
import usePlannedWorksStore from "@/store/dashboard-planned-works";
import {
  businessDaysAgo,
  formatDayMonth,
  formatTime,
} from "@/util/format-date";

import {
  countdownText,
  splitPlan,
  type PlannedWork,
  type TodayItem,
} from "./planned-works";

/**
 * «Сегодня в плане» — полоса над блоками главной сотрудника.
 *
 * Место работы на главной решает срочность: сегодняшнее и неподтверждённое —
 * здесь, сверху и крупно; всё, что позже, — тихим списком «Дальше в плане» в
 * правой колонке (`UpcomingWorks`). Выезд через неделю не должен двигать
 * заявки, а сегодняшний — теряться среди прочих строк.
 *
 * Полосы нет, когда на сегодня ничего: пустой блок главная не рисует, и в
 * обычный день страница выглядит как без неё.
 *
 * Карточка отвечает на «когда и что дальше»: время крупно, «через 2 ч 20 мин»
 * или «идёт · до 12:30», у вышедшей по времени — «Подтвердить» (без
 * подтверждения заявку не закрыть). Подсвечена идущая, а без неё — ближайшая.
 * Отсчёт идёт по минутному тику. На телефоне карточки становятся строками
 * одной панели.
 */

const kindOf = (work: PlannedWork) =>
  work.visitRequired
    ? { label: "Выезд", Icon: RiMapPin2Line }
    : { label: "Удалённо", Icon: RiComputerLine };

// «вчера», дальше дата — подпись дня у неподтверждённой с прошлого дня
const pastDayLabel = (work: PlannedWork) =>
  businessDaysAgo(work.planningToStart) === 1
    ? "вчера"
    : formatDayMonth(work.planningToStart);

const Status = ({ item, now }: { item: TodayItem; now: Date }) => {
  const { work, phase } = item;
  if (phase === "unconfirmed")
    return <span className="text-warning">не подтверждена</span>;
  if (phase === "now")
    return (
      <span className="font-semibold text-accent-text">
        <span
          aria-hidden
          className="me-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
        />
        {work.planningToFinish
          ? `идёт · до ${formatTime(work.planningToFinish)}`
          : "идёт"}
      </span>
    );
  return (
    <span
      className={cn(
        phase === "soon"
          ? "font-semibold text-accent-text"
          : "text-muted-foreground",
      )}
    >
      {countdownText(new Date(work.planningToStart), now)}
    </span>
  );
};

const ConfirmButton = ({
  work,
  state,
}: {
  work: PlannedWork;
  state: ReturnType<typeof useCrumbFrom>;
}) => {
  const ticket = work.tickets[0];
  if (!ticket) return null;
  return (
    <Button asChild variant="outline" size="xs" className="relative z-10">
      <Link
        to={`/tickets/${ticket.num}/work/${work._id}/confirm`}
        state={state}
      >
        <RiCheckboxCircleLine />
        Подтвердить
      </Link>
    </Button>
  );
};

// Ссылка на заявку растянута на карточку псевдоэлементом; «Подтвердить» лежит
// над ней (`relative z-10`) — вложить ссылку в ссылку нельзя
const stretched =
  "text-inherit no-underline outline-none after:absolute after:inset-0 focus-visible:after:ring-4 focus-visible:after:ring-ring/50";

const PlanCard = ({
  item,
  now,
  state,
}: {
  item: TodayItem;
  now: Date;
  state: ReturnType<typeof useCrumbFrom>;
}) => {
  const { work, highlighted } = item;
  const ticket = work.tickets[0];
  const { label, Icon } = kindOf(work);

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-xl border p-4 transition-colors",
        highlighted
          ? "border-primary/45 bg-primary/7"
          : "border-border bg-card hover:bg-accent/60",
      )}
    >
      {item.pastDay && (
        <div className="mb-1 text-xs font-semibold text-warning tabular-nums">
          {pastDayLabel(work)}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
          {formatTime(work.planningToStart)}
          {work.planningToFinish && (
            <span className="text-base font-medium text-muted-foreground">
              {" "}
              – {formatTime(work.planningToFinish)}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-muted-foreground">
          <Icon size={14} aria-hidden />
          {label}
        </span>
      </div>
      <div className="mt-0.5 text-sm tabular-nums">
        <Status item={item} now={now} />
      </div>
      <div
        className={cn(
          "mt-3 flex-1 border-t pt-3 text-sm",
          highlighted ? "border-primary/15" : "border-border-soft",
        )}
      >
        {ticket ? (
          <Link
            to={`/tickets/${ticket.num}`}
            state={state}
            className={cn("block truncate font-medium", stretched)}
          >
            {work.company?.alias ?? `Заявка ${ticket.num}`}
          </Link>
        ) : (
          <div className="truncate font-medium">{work.company?.alias}</div>
        )}
        {ticket && (
          <div className="line-clamp-2 text-muted-foreground">
            {ticket.num} · {ticket.title || "Без темы"}
          </div>
        )}
      </div>
      {item.phase === "unconfirmed" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="min-w-0 text-xs text-faint">
            без подтверждения заявку не закрыть
          </span>
          <ConfirmButton work={work} state={state} />
        </div>
      )}
    </div>
  );
};

const PlanRow = ({
  item,
  now,
  state,
}: {
  item: TodayItem;
  now: Date;
  state: ReturnType<typeof useCrumbFrom>;
}) => {
  const { work, highlighted } = item;
  const ticket = work.tickets[0];
  const { label, Icon } = kindOf(work);

  return (
    <div
      className={cn(
        "relative flex gap-3 border-t border-border-soft px-4 py-3 first:border-t-0",
        highlighted && "bg-primary/7",
      )}
    >
      <span className="w-13 flex-none tabular-nums">
        <span className="block text-base font-semibold">
          {formatTime(work.planningToStart)}
        </span>
        {work.planningToFinish && (
          <span className="block text-xs text-faint">
            {formatTime(work.planningToFinish)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        {item.pastDay && (
          <span className="block text-xs font-semibold text-warning tabular-nums">
            {pastDayLabel(work)}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <Icon size={14} aria-hidden className="flex-none text-faint" />
          {ticket ? (
            <Link
              to={`/tickets/${ticket.num}`}
              state={state}
              className={cn("truncate", stretched)}
            >
              {label}
              {work.company?.alias ? ` · ${work.company.alias}` : ""}
            </Link>
          ) : (
            <span className="truncate">
              {label}
              {work.company?.alias ? ` · ${work.company.alias}` : ""}
            </span>
          )}
        </span>
        {ticket && (
          <span className="block truncate text-muted-foreground">
            {ticket.num} · {ticket.title || "Без темы"}
          </span>
        )}
        <span className="mt-1 flex min-h-5 items-center justify-between gap-2 tabular-nums">
          <Status item={item} now={now} />
          {item.phase === "unconfirmed" && (
            <ConfirmButton work={work} state={state} />
          )}
        </span>
      </span>
    </div>
  );
};

const TodayPlan = () => {
  const works = usePlannedWorksStore((state) => state.works);
  const now = useMinuteTick();
  const fromState = useCrumbFrom("Главная");

  const { today } = splitPlan(works, { now, daysAgo: businessDaysAgo });
  if (today.length === 0) return null;

  return (
    <section>
      <Eyebrow count={today.length}>Сегодня в плане</Eyebrow>
      <div className="grid gap-3 max-md:hidden md:grid-cols-2 xl:grid-cols-3">
        {today.map((item) => (
          <PlanCard
            key={item.work._id}
            item={item}
            now={now}
            state={fromState}
          />
        ))}
      </div>
      <div className="md:hidden">
        <Panel>
          <div className="-mx-4 -my-4 overflow-hidden rounded-[inherit] md:-mx-5 md:-my-5">
            {today.map((item) => (
              <PlanRow
                key={item.work._id}
                item={item}
                now={now}
                state={fromState}
              />
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
};

export default TodayPlan;
