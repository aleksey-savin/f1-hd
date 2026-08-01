import { cn } from "@/lib/utils";

import {
  DEVICE_STATUS_META,
  DEVICE_STATUS_ORDER,
  TONE_DOT,
} from "@/components/app/device-status";

/**
 * Лента парка — сводка и фильтр одновременно (канон «сводка = переключатель»):
 * стадии жизненного цикла с числами по ВСЕЙ выборке, клик сужает список.
 *
 * Числа приходят с сервера и считаются без фасета статуса — иначе выбранная
 * стадия обнуляла бы соседние и лента переставала бы отвечать на «сколько
 * всего готово к выдаче». Стадии, в которых техники нет, не рисуются: пустая
 * плашка не информация (исключение — выбранная стадия, иначе выбор исчезал бы
 * из-под пальца).
 */
const FleetStrip = ({
  statusCounts = {},
  selected = [],
  onToggle,
  noInventoryNumber = 0,
  noInventoryActive = false,
  onToggleNoInventory,
}) => {
  const stages = DEVICE_STATUS_ORDER.filter(
    (status) => statusCounts[status] > 0 || selected.includes(status),
  );
  if (!stages.length && !noInventoryNumber) return null;

  return (
    <div className="mb-3 flex items-center gap-2 px-1 max-md:overflow-x-auto max-md:pb-1 md:flex-wrap">
      <span className="flex-none text-xs font-bold tracking-wider text-faint uppercase">
        Парк
      </span>
      {stages.map((status) => {
        const meta = DEVICE_STATUS_META[status];
        const active = selected.includes(status);
        return (
          <button
            key={status}
            type="button"
            onClick={() => onToggle(status)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-2 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              active
                ? "border-input bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 flex-none rounded-full",
                TONE_DOT[meta.tone],
              )}
            />
            {meta.label}
            <span className="font-semibold text-foreground tabular-nums">
              {statusCounts[status] || 0}
            </span>
          </button>
        );
      })}
      {noInventoryNumber > 0 && (
        // Пробел учёта — не стадия, поэтому он в хвосте и без точки-статуса.
        <button
          type="button"
          onClick={onToggleNoInventory}
          aria-pressed={noInventoryActive}
          className={cn(
            "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50 md:ms-auto",
            noInventoryActive
              ? "border-input bg-accent text-foreground"
              : "border-transparent bg-transparent text-faint hover:bg-accent",
          )}
        >
          без инвентарного номера
          <span className="font-semibold tabular-nums">
            {noInventoryNumber}
          </span>
        </button>
      )}
    </div>
  );
};

export default FleetStrip;
