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
  <div className="tw:flex tw:items-center tw:gap-4 tw:px-4 tw:py-2.5 tw:md:px-5">
    <button
      type="button"
      role="checkbox"
      aria-checked={allSelected ? "true" : someSelected ? "mixed" : "false"}
      aria-label={allSelected ? "Снять выделение" : "Выбрать все"}
      onClick={onToggleAll}
      className={cn(
        "tw:grid tw:size-4 tw:shrink-0 tw:cursor-pointer tw:appearance-none tw:place-content-center tw:rounded-[4px] tw:border tw:p-0 tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50",
        allSelected || someSelected
          ? "tw:border-primary tw:bg-primary tw:text-primary-foreground"
          : "tw:border-input tw:bg-transparent tw:text-transparent",
      )}
    >
      {allSelected ? (
        <RiCheckLine size={12} aria-hidden />
      ) : someSelected ? (
        <RiSubtractLine size={12} aria-hidden />
      ) : null}
    </button>

    <span className="tw:text-sm tw:font-semibold tw:tabular-nums">
      {itemsLabel} {count} из {total}
    </span>

    {total > 0 && (
      <>
        {allSelected ? (
          <span className="tw:text-sm tw:text-muted-foreground">
            {allSelectedLabel(total)}
          </span>
        ) : (
          <button
            type="button"
            onClick={onSelectAll}
            className="tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:font-medium tw:text-accent-text tw:outline-none tw:hover:underline tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
          >
            {selectAllLabel(total)}
          </button>
        )}
      </>
    )}

    <span className="tw:ms-auto tw:flex tw:items-center tw:gap-2.5">
      <span className="tw:hidden tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-px tw:font-mono tw:text-xs tw:text-faint tw:md:inline">
        Esc
      </span>
      <Button variant="ghost" size="xs" onClick={onExit}>
        Отмена
      </Button>
    </span>
  </div>
);

export default SelectionBar;
