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

  return (
    <div className="mb-3 flex items-center gap-2 px-1 max-md:overflow-x-auto max-md:pb-1 md:flex-wrap">
      <span className="flex-none text-xs font-bold tracking-wider text-faint uppercase">
        Пересечения
      </span>
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
              active
                ? "border-input bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 flex-none rounded-full", meta.dot)}
            />
            {meta.label}
            <span className="font-semibold text-foreground tabular-nums">
              {counts[kind] || 0}
            </span>
          </button>
        );
      })}
      {disabledCount > 0 && (
        <button
          type="button"
          onClick={onToggleDisabled}
          aria-pressed={showDisabled}
          className={cn(
            "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-1.5 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50 md:ms-auto",
            showDisabled
              ? "border-input bg-accent text-foreground"
              : "border-transparent bg-transparent text-faint hover:bg-accent",
          )}
        >
          показать отключённые
          <span className="font-semibold tabular-nums">{disabledCount}</span>
        </button>
      )}
    </div>
  );
};

export default NetworksStrip;
