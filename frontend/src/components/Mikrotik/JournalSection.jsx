import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  RiArrowUpCircleLine,
  RiEdit2Line,
  RiFileTextLine,
  RiKey2Line,
  RiPulseLine,
  RiRobot2Line,
  RiShutDownLine,
  RiTerminalBoxLine,
} from "react-icons/ri";

import { useCrumbFrom } from "@/components/app/Crumbs";
import FilterChip from "@/components/app/FilterChip";
import { Eyebrow, Panel } from "@/components/app/Panel";
import Spinner from "@/components/app/Spinner";
import { Button } from "@/components/ui/button";
import useLiveTopic from "@/hooks/use-live-topic";
import { cn } from "@/lib/utils";
import useMikrotikDevicesStore from "@/store/lists/mikrotik-devices";
import {
  businessDayKey,
  businessDaysAgo,
  formatDate,
  formatDayMonthLong,
  formatTime,
} from "@/util/format-date";
import {
  JOURNAL_FILTERS,
  RAW_FOLD_FROM,
  eventLine,
  groupByDay,
} from "@/util/mikrotik-events";

// Значок различает тип события, цвет — только состояние (макет «Журнал
// устройства Mikrotik», 11.10)
const GROUP_ICON = {
  link: RiPulseLine,
  power: RiShutDownLine,
  config: RiFileTextLine,
  record: RiEdit2Line,
  agent: RiRobot2Line,
  router: RiTerminalBoxLine,
};
const KIND_ICON = {
  upgradeStarted: RiArrowUpCircleLine,
  upgradeFinished: RiArrowUpCircleLine,
  upgradeFailed: RiArrowUpCircleLine,
  upgradeCancelled: RiArrowUpCircleLine,
  firmwareChanged: RiArrowUpCircleLine,
  routerLogin: RiKey2Line,
  routerLoginFailed: RiKey2Line,
};
const TONE_CLASS = {
  ok: "text-accent-text",
  warn: "text-warning-text",
  bad: "text-destructive",
  muted: "",
};

const dayLabel = (at) => {
  const ago = businessDaysAgo(at);
  if (ago === 0) return "Сегодня";
  if (ago === 1) return `Вчера, ${formatDayMonthLong(at)}`;
  return formatDayMonthLong(at);
};

const DIFF_CLASS = {
  "+": "bg-primary/10 text-accent-text",
  "-": "bg-destructive/10 text-destructive",
};

// Небольшое раскрытие внутри строки: строки лога, отличия конфигурации
const Reveal = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="cursor-pointer appearance-none self-start border-0 bg-transparent p-0 text-xs text-muted-foreground underline decoration-border underline-offset-4"
      >
        {open ? "Свернуть" : label}
      </button>
      {open && children}
    </>
  );
};

const RawLines = ({ lines }) => (
  <div className="flex flex-col gap-px font-mono text-xs text-muted-foreground wrap-anywhere">
    {lines.map((text, index) => (
      <span key={index}>{text}</span>
    ))}
  </div>
);

const EventRow = ({ event, fromState }) => {
  const line = eventLine(event, { formatTime });
  const Icon = KIND_ICON[event.kind] || GROUP_ICON[event.group] || RiPulseLine;
  const tone = TONE_CLASS[line.tone] || "";
  const rawTotal = line.rawTotal || line.raw.length;

  return (
    <div className="grid grid-cols-[2.375rem_1.125rem_minmax(0,1fr)] gap-x-2 border-t border-border-soft py-2 first:border-t-0">
      <time
        dateTime={event.at}
        title={formatDate(event.at)}
        className="pt-0.5 text-xs text-faint tabular-nums"
      >
        {formatTime(event.at)}
      </time>
      <Icon
        size={16}
        aria-hidden
        className={cn("mt-0.5", tone || "text-muted-foreground")}
      />
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="wrap-anywhere">
          <span className={cn("font-medium", tone)}>{line.label}</span>
          {line.who && (
            <span className="text-muted-foreground"> · {line.who}</span>
          )}
        </span>
        {(line.title || line.detail || event.ticketNum) && (
          <span className="text-muted-foreground wrap-anywhere">
            {line.title &&
              (event.changeId ? (
                <Link
                  to={`/devices/mikrotik/changes/${event.changeId}`}
                  state={fromState}
                  className="text-inherit underline decoration-border underline-offset-4 hover:text-foreground"
                >
                  {line.title}
                </Link>
              ) : (
                line.title
              ))}
            {line.title && line.detail && ". "}
            {line.detail}
            {event.ticketNum && (
              <>
                {(line.title || line.detail) && ". "}
                <Link
                  to={`/tickets/${event.ticketNum}`}
                  className="text-inherit underline decoration-border underline-offset-4 hover:text-foreground"
                >
                  Заявка № {event.ticketNum}
                </Link>
              </>
            )}
          </span>
        )}
        {line.change && (
          <span className="text-muted-foreground wrap-anywhere">
            <code className="font-mono text-xs text-foreground line-through decoration-faint">
              {line.change.from || "—"}
            </code>{" "}
            →{" "}
            <code className="font-mono text-xs text-foreground">
              {line.change.to || "—"}
            </code>
          </span>
        )}
        {line.raw.length > 0 &&
          (line.raw.length >= RAW_FOLD_FROM ? (
            <Reveal label={`Показать строки лога (${rawTotal})`}>
              <RawLines lines={line.raw} />
            </Reveal>
          ) : (
            <RawLines lines={line.raw} />
          ))}
        {event.diff?.length > 0 && (
          <Reveal label="Показать отличия">
            <div className="overflow-x-auto rounded-lg border border-border-soft py-1.5 font-mono text-xs">
              {event.diff.map((text, index) => (
                <div
                  key={index}
                  className={cn(
                    "px-2.5 whitespace-pre",
                    DIFF_CLASS[text[0]] || "text-faint",
                  )}
                >
                  {text}
                </div>
              ))}
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
};

// Раздел «Журнал» страницы записи: что происходило с устройством и кто это
// сделал. Лента читается при показе и по пульсу темы `mikrotik` — своего
// таймера нет. Фильтр и листание считает бэкенд.
const JournalSection = ({ recordId, deviceName }) => {
  const fetchEvents = useMikrotikDevicesStore((state) => state.fetchEvents);
  const [filter, setFilter] = useState("all");
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextBefore, setNextBefore] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Первая загрузка не удалась: «событий нет» утверждать нельзя
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Ответ на устаревший запрос (сменили фильтр или устройство) отбрасывается
  const request = useRef(0);
  const fromState = useCrumbFrom(deviceName);
  const group = filter === "all" ? null : filter;

  const load = async ({ silent = false } = {}) => {
    const id = ++request.current;
    const page = await fetchEvents(recordId, { group });
    if (id !== request.current) return;
    setLoaded(true);
    if (!page) {
      // Тихое обновление не затирает уже показанную ленту
      setFailed(true);
      return;
    }
    setFailed(false);
    setTotal(page.total);
    setEvents((shown) => {
      if (!silent) return page.events;
      // Долистанное остаётся: свежая первая страница встаёт поверх
      const fresh = new Set(page.events.map((event) => event._id));
      const oldest = page.events.at(-1)?.at;
      const tail = shown.filter(
        (event) => !fresh.has(event._id) && (!oldest || event.at <= oldest),
      );
      return [...page.events, ...tail];
    });
    if (!silent) setNextBefore(page.nextBefore);
  };

  useEffect(() => {
    setLoaded(false);
    setEvents([]);
    load();
  }, [recordId, filter]);

  useLiveTopic("mikrotik", () => load({ silent: true }));

  const loadMore = async () => {
    const id = request.current;
    setLoadingMore(true);
    const page = await fetchEvents(recordId, { group, before: nextBefore });
    setLoadingMore(false);
    if (id !== request.current || !page) return;
    setEvents((shown) => [...shown, ...page.events]);
    setNextBefore(page.nextBefore);
    setTotal(page.total);
  };

  const chips = (className) => (
    <div
      role="group"
      aria-label="Тип событий"
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {JOURNAL_FILTERS.map((item) => (
        <FilterChip
          key={item.value}
          size="sm"
          dot="none"
          active={filter === item.value}
          onClick={() => setFilter(item.value)}
        >
          {item.label}
        </FilterChip>
      ))}
    </div>
  );

  return (
    <>
      {/* Телефон: фильтры не делят строку с меткой, а стоят под ней */}
      <Eyebrow id="journal" action={chips("max-md:hidden")}>
        Журнал
      </Eyebrow>
      {chips("mb-2 md:hidden")}
      <Panel>
        {!loaded ? (
          <Spinner className="min-h-0 py-6" size={28} />
        ) : failed && events.length === 0 ? (
          <div className="text-sm text-destructive">
            Не удалось загрузить журнал.
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-faint">
            {group
              ? "За последние 365 дней таких событий нет."
              : "Событий пока нет. Журнал ведётся с момента добавления устройства."}
          </div>
        ) : (
          <>
            {groupByDay(events, businessDayKey).map((day, index) => (
              <div key={day.key} className="flex flex-col">
                <span
                  className={cn(
                    "pb-0.5 text-xs font-bold tracking-wider text-faint uppercase",
                    index > 0 && "pt-3",
                  )}
                >
                  {dayLabel(day.at)}
                </span>
                {day.events.map((event) => (
                  <EventRow
                    key={event._id}
                    event={event}
                    fromState={fromState}
                  />
                ))}
              </div>
            ))}
            {nextBefore && (
              <div className="flex flex-col items-center gap-1.5 border-t border-border-soft pt-3.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? "Загрузка…" : "Показать ещё"}
                </Button>
                <span className="text-xs text-faint tabular-nums">
                  Показано {events.length} из {total}
                </span>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
};

export default JournalSection;
