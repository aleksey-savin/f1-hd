import { RiArrowDownSLine } from "react-icons/ri";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ChipSelectOption = {
  value: string;
  label: string;
};

// Дропдаун-чип для КЛЮЧЕВОГО фасета сущности в строке инструментов списка
// (взаимоисключающие значения: «Комплектующие | Расходники | Периферия»).
// Компактен (один чип на фасет), выбранное значение показывается прямо в
// чипе; полный набор фильтров остаётся в Sheet. Стили чипа = app/FilterChip.
const ChipSelect = ({
  placeholder,
  allLabel = "Все",
  clearable = true,
  value,
  options,
  onChange,
  className,
}: {
  /** Подпись чипа, пока ничего не выбрано (имя фасета). */
  placeholder: string;
  /** Пункт сброса в меню. */
  allLabel?: string;
  /** false — обязательный контекст без пункта сброса (например, компания
   *  у дерева расположений: одна выбрана всегда). */
  clearable?: boolean;
  value: string | null;
  options: ChipSelectOption[];
  onChange: (value: string | null) => void;
  className?: string;
}) => {
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "tw:inline-flex tw:h-10 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-input tw:bg-transparent tw:px-4 tw:text-sm tw:font-semibold tw:whitespace-nowrap tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            selected &&
              "tw:border-transparent tw:bg-primary/15 tw:text-accent-text tw:hover:bg-primary/20",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "tw:size-1.5 tw:rounded-full tw:bg-faint",
              selected && "tw:bg-primary",
            )}
          />
          {selected ? selected.label : placeholder}
          <RiArrowDownSLine size={14} aria-hidden className="tw:opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => onChange(next === "" ? null : next)}
        >
          {clearable && (
            <DropdownMenuRadioItem value="">{allLabel}</DropdownMenuRadioItem>
          )}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ChipSelect;
