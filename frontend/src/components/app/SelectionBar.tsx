import { RiCheckLine, RiSubtractLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Шапка режима выбора — липкая строка над панелью списка (слот `selection` у
// app/ListWrapper). Здесь живёт управление САМИМ выбором: мастер-чекбокс,
// счётчик, «Выбрать все N» и выход. Действия над выбранным — в плавающей
// app/BulkActionBar, поэтому ничего не дублируется.
//
// Мастер-чекбокс собран локально, а не взят из ui/checkbox: у него три состояния
// с разными глифами (пусто · полоска · галка), а сгенерированный radix-компонент
// рисует галку и для `indeterminate`. Токены и метрики — те же.

const SelectionBar = ({
  count,
  total,
  allSelected,
  someSelected,
  onToggleAll,
  onSelectAll,
  onExit,
  itemsLabel = "Выбрано",
  selectAllLabel = (n: number) => `Выбрать все ${n}`,
  allSelectedLabel = (n: number) => `Выбраны все ${n}`,
}: {
  count: number;
  total: number;
  allSelected: boolean;
  someSelected: boolean;
  /** Пусто/часть → выбрать всё, всё → снять выделение (режим остаётся). */
  onToggleAll: () => void;
  onSelectAll: () => void;
  onExit: () => void;
  itemsLabel?: string;
  selectAllLabel?: (count: number) => string;
  allSelectedLabel?: (count: number) => string;
}) => (
  <div className="flex items-center gap-4 px-4 py-2.5 md:px-5">
    <button
      type="button"
      role="checkbox"
      aria-checked={allSelected ? "true" : someSelected ? "mixed" : "false"}
      aria-label={allSelected ? "Снять выделение" : "Выбрать все"}
      onClick={onToggleAll}
      className={cn(
        "grid size-4 shrink-0 cursor-pointer appearance-none place-content-center rounded-[4px] border p-0 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        allSelected || someSelected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-transparent text-transparent",
      )}
    >
      {allSelected ? (
        <RiCheckLine size={12} aria-hidden />
      ) : someSelected ? (
        <RiSubtractLine size={12} aria-hidden />
      ) : null}
    </button>

    <span className="text-sm font-semibold tabular-nums">
      {itemsLabel} {count} из {total}
    </span>

    {total > 0 && (
      <>
        {allSelected ? (
          <span className="text-sm text-muted-foreground">
            {allSelectedLabel(total)}
          </span>
        ) : (
          <button
            type="button"
            onClick={onSelectAll}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-medium text-accent-text outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
          >
            {selectAllLabel(total)}
          </button>
        )}
      </>
    )}

    <span className="ms-auto flex items-center gap-2.5">
      <span className="hidden rounded border border-border px-1.5 py-px font-mono text-xs text-faint md:inline">
        Esc
      </span>
      <Button variant="ghost" size="xs" onClick={onExit}>
        Отмена
      </Button>
    </span>
  </div>
);

export default SelectionBar;
