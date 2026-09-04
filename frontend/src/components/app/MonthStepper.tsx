import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { formatDayKey } from "../../util/format-date";
import { monthRange } from "../../util/period";

type Range = { from: string; to: string };

// Чип-степпер периода для строки инструментов списка: «‹ июнь 2026 ›» (язык
// месячного пейджера карточки компании). Управляемый: value — { from, to }
// (yyyy-MM-dd, как в Sheet-фильтре), стрелки шагают по календарным месяцам,
// вперёд — по умолчанию не дальше текущего. Произвольный период из шторки показывается
// диапазоном дат (шаг стрелкой нормализует его к календарному месяцу), пустой
// — «Весь период». Снятие периода — бейджем в плашке фильтров или в шторке.
//
// allowFuture снимает потолок: отчёты и архивы смотрят в прошлое, а календарь
// команды — вперёд, отпуска планируют именно на будущие месяцы.
const parseIsoDay = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const MONTH_LABEL = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
});

const arrowClass =
  "grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

const MonthStepper = ({
  from,
  to,
  onChange,
  className,
  allowFuture = false,
}: {
  from: string;
  to: string;
  onChange: (range: Range) => void;
  className?: string;
  allowFuture?: boolean;
}) => {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const anchorDay = from ? parseIsoDay(from) : to ? parseIsoDay(to) : now;
  const anchorMonth = new Date(
    anchorDay.getFullYear(),
    anchorDay.getMonth(),
    1,
  );

  const isEmpty = !from && !to;
  const fullMonth = monthRange(anchorMonth);
  const isFullMonth =
    Boolean(from && to) && fullMonth.from === from && fullMonth.to === to;

  const label = isFullMonth
    ? MONTH_LABEL.format(anchorMonth).replace(" г.", "")
    : isEmpty
      ? "Весь период"
      : `${from ? formatDayKey(from) : "…"} – ${to ? formatDayKey(to) : "…"}`;

  const step = (delta: number) => {
    const base = isEmpty ? currentMonth : anchorMonth;
    onChange(
      monthRange(new Date(base.getFullYear(), base.getMonth() + delta, 1)),
    );
  };

  const nextDisabled = allowFuture
    ? false
    : isEmpty || anchorMonth.getTime() >= currentMonth.getTime();

  return (
    <div
      className={cn(
        "inline-flex h-9 flex-none items-center gap-0.5 rounded-lg border border-input px-0.5",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Предыдущий месяц"
        onClick={() => step(-1)}
        className={arrowClass}
      >
        <RiArrowLeftSLine size={16} aria-hidden />
      </button>
      <span className="min-w-24 px-1 text-center text-sm font-medium whitespace-nowrap tabular-nums">
        {label}
      </span>
      <button
        type="button"
        aria-label="Следующий месяц"
        disabled={nextDisabled}
        onClick={() => step(1)}
        className={arrowClass}
      >
        <RiArrowRightSLine size={16} aria-hidden />
      </button>
    </div>
  );
};

export default MonthStepper;
