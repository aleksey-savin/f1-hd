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
            "inline-flex h-10 cursor-pointer appearance-none items-center gap-2 rounded-full border border-input bg-transparent px-4 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
            selected &&
              "border-transparent bg-primary/15 text-accent-text hover:bg-primary/20",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full bg-faint",
              selected && "bg-primary",
            )}
          />
          {selected ? selected.label : placeholder}
          <RiArrowDownSLine size={14} aria-hidden className="opacity-60" />
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
