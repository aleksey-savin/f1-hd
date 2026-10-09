import { cn } from "@/lib/utils";

import { WEEK_ORDER } from "./activity-format";

const DAY_LABEL = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const LEVEL_BG = {
  1: "bg-primary/15",
  2: "bg-primary/35",
  3: "bg-primary/60",
  4: "bg-primary/90",
};

// Штриховка планового отключения — цветом границы, читается в обеих темах.
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 5px)",
};

/**
 * Неделя устройства по часам: 7 строк × 24 колонки, клетка = час. Заливка —
 * активность относительно самого нагруженного часа (ступени 1–4), штриховка —
 * плановое отключение, рамка — ближайшие тихие часы, пустая клетка — данных
 * нет. Числа сетка не показывает: она отвечает на «когда», а не «сколько».
 *
 * `levels` и `planned` индексируются слотом недели (день * 24 + час,
 * 0 — воскресенье 00:00, пояс организации); показ — с понедельника.
 */
const WeekGrid = ({ levels, planned, quietSlots = [], today }) => (
  <div
    role="img"
    aria-label="Активность по часам недели"
    className="mt-3.5 grid grid-cols-[1.625rem_repeat(24,minmax(0,1fr))] gap-0.5"
  >
    <span />
    {["00", "06", "12", "18"].map((label) => (
      <span key={label} className="col-span-6 h-4 text-xs text-faint tabular-nums">
        {label}
      </span>
    ))}
    {WEEK_ORDER.map((day) => (
      <div key={day} className="contents">
        <span
          className={cn(
            "flex items-center text-xs",
            day === today ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {DAY_LABEL[day]}
        </span>
        {HOURS.map((hour) => {
          const slot = day * 24 + hour;
          const off = planned.has(slot);
          return (
            <span
              key={hour}
              style={off ? HATCH : undefined}
              className={cn(
                "h-5 rounded-xs max-md:h-4",
                !off && (LEVEL_BG[levels[slot]] || "bg-muted"),
                quietSlots.includes(slot) && "relative z-10 ring-2 ring-foreground",
              )}
            />
          );
        })}
      </div>
    ))}
  </div>
);

export const WeekLegend = ({ withPlanned }) => (
  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1">
      меньше
      {[1, 2, 3, 4].map((level) => (
        <i key={level} className={cn("inline-block h-3 w-3.5 rounded-xs", LEVEL_BG[level])} />
      ))}
      больше
    </span>
    {withPlanned && (
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-3 w-3.5 rounded-xs" style={HATCH} />
        плановое отключение
      </span>
    )}
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block h-3 w-3.5 rounded-xs ring-2 ring-foreground ring-inset" />
      ближайшие тихие часы
    </span>
  </div>
);

export default WeekGrid;
