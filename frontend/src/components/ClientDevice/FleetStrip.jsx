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
    <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:px-1 tw:max-md:overflow-x-auto tw:max-md:pb-1 tw:md:flex-wrap">
      <span className="tw:flex-none tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
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
              "tw:inline-flex tw:h-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:px-3 tw:text-sm tw:transition-colors tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
              active
                ? "tw:border-input tw:bg-accent tw:text-foreground"
                : "tw:border-border tw:bg-card tw:text-muted-foreground tw:hover:bg-accent",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "tw:size-1.5 tw:flex-none tw:rounded-full",
                TONE_DOT[meta.tone],
              )}
            />
            {meta.label}
            <span className="tw:font-semibold tw:text-foreground tw:tabular-nums">
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
            "tw:inline-flex tw:h-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:px-3 tw:text-sm tw:transition-colors tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:md:ms-auto",
            noInventoryActive
              ? "tw:border-input tw:bg-accent tw:text-foreground"
              : "tw:border-transparent tw:bg-transparent tw:text-faint tw:hover:bg-accent",
          )}
        >
          без инвентарного номера
          <span className="tw:font-semibold tw:tabular-nums">
            {noInventoryNumber}
          </span>
        </button>
      )}
    </div>
  );
};

export default FleetStrip;
