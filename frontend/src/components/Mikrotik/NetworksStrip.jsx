import { cn } from "@/lib/utils";

import { OVERLAP_META, OVERLAP_ORDER } from "./meta";

/**
 * Лента пересечений — сводка и фильтр одновременно (канон «сводка =
 * переключатель»): причина, число сетей с этой причиной, клик сужает и группы,
 * и реестр.
 *
 * Числа считаются по ВСЕЙ выборке и не зависят от выбранных чипов: причина у
 * сети ровно одна, поэтому выбор одной не обнуляет соседние и лента продолжает
 * отвечать на «сколько всего сломано». Причина, которой в парке нет, не
 * рисуется — кроме выбранной, иначе выбор исчезал бы из-под пальца.
 *
 * Отключённые адреса — не причина пересечения, поэтому их переключатель стоит в
 * хвосте, без точки-статуса и приглушённо.
 */
const NetworksStrip = ({
  counts,
  selected,
  onToggle,
  disabledCount,
  showDisabled,
  onToggleDisabled,
}) => {
  const kinds = OVERLAP_ORDER.filter(
    (kind) => counts[kind] > 0 || selected.includes(kind),
  );

  if (!kinds.length && !disabledCount) return null;

  const disabledToggle = (className) =>
    disabledCount > 0 && (
      <button
        type="button"
        onClick={onToggleDisabled}
        aria-pressed={showDisabled}
        className={cn(
          "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
          showDisabled
            ? "border-input bg-accent text-foreground"
            : "border-transparent bg-transparent text-faint hover:bg-accent",
          className,
        )}
      >
        показать отключённые
        <span className="font-semibold tabular-nums">{disabledCount}</span>
      </button>
    );

  // На телефоне (макет 28.09) лента — плитки на всю ширину, по колонке на
  // причину, с короткой подписью каталога; раньше чипы уезжали вбок за край.
  // Переключатель отключённых — в строке метки справа.
  return (
    <div
      className={cn(
        "mb-3 flex items-center gap-2 px-1 md:flex-wrap",
        "max-md:grid max-md:gap-2 max-md:px-0",
        MOBILE_COLUMNS[kinds.length] || "max-md:grid-cols-1",
      )}
    >
      <div className="flex items-center gap-2 max-md:col-span-full max-md:px-0.5 md:contents">
        <span className="flex-none text-xs font-bold tracking-wider text-faint uppercase">
          Пересечения
        </span>
        {disabledToggle("ms-auto md:hidden max-md:h-7 max-md:px-2")}
      </div>
      {kinds.map((kind) => {
        const meta = OVERLAP_META[kind];
        const active = selected.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-2 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              "max-md:h-auto max-md:min-w-0 max-md:flex-col max-md:items-start max-md:gap-0.5 max-md:rounded-xl max-md:px-2.5 max-md:py-2 max-md:text-left",
              active
                ? "border-input bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            <span className="flex min-w-0 items-center gap-2 max-md:max-w-full max-md:text-xs">
              <span
                aria-hidden
                className={cn("size-1.5 flex-none rounded-full", meta.dot)}
              />
              <span className="max-md:hidden">{meta.label}</span>
              <span className="truncate md:hidden">{meta.short}</span>
            </span>
            <span className="font-semibold text-foreground tabular-nums max-md:text-lg">
              {counts[kind] || 0}
            </span>
          </button>
        );
      })}
      {disabledToggle("md:ms-auto max-md:hidden")}
    </div>
  );
};

// Сетка плиток на телефоне — ровно по числу причин в парке, без пустых ячеек
const MOBILE_COLUMNS = {
  1: "max-md:grid-cols-1",
  2: "max-md:grid-cols-2",
  3: "max-md:grid-cols-3",
};

export default NetworksStrip;
