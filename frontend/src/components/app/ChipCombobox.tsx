import { useState } from "react";

import { RiArrowDownSLine, RiCheckLine } from "react-icons/ri";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ChipComboboxOption = {
  value: string;
  label: string;
};

// Дропдаун-чип с ПОИСКОМ (combobox) — для фасетов с длинным списком значений
// (компания у дерева расположений). Стили чипа = app/ChipSelect; для коротких
// списков без поиска используйте ChipSelect.
const ChipCombobox = ({
  placeholder,
  searchPlaceholder = "Найти…",
  emptyText = "Ничего не нашлось.",
  allLabel = "Все",
  clearable = true,
  value,
  options,
  onChange,
  className,
}: {
  /** Подпись чипа, пока ничего не выбрано (имя фасета). */
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Пункт сброса в списке. */
  allLabel?: string;
  /** false — обязательный контекст без пункта сброса. */
  clearable?: boolean;
  value: string | null;
  options: ChipComboboxOption[];
  onChange: (value: string | null) => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
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
      </PopoverTrigger>
      <PopoverContent align="start" className="tw:w-64 tw:overflow-hidden tw:p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && (
                <CommandItem value="" onSelect={() => pick(null)}>
                  <RiCheckLine
                    className={cn(
                      "tw:flex-none",
                      value === null ? "tw:opacity-100" : "tw:opacity-0",
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // value — подпись: cmdk фильтрует пункты по ней
                  value={option.label}
                  onSelect={() => pick(option.value)}
                >
                  <RiCheckLine
                    className={cn(
                      "tw:flex-none",
                      option.value === value ? "tw:opacity-100" : "tw:opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ChipCombobox;
