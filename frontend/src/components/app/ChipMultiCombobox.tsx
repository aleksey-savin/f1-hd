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

type Option = { value: string; label: string };

// Мультивыбор-чип с поиском (combobox) для фасета с длинным списком значений
// (компания). Как app/ChipCombobox, но выбирается несколько: чип показывает
// имя (одно) или счётчик (несколько); меню не закрывается на выбор.
const ChipMultiCombobox = ({
  placeholder,
  searchPlaceholder = "Найти…",
  emptyText = "Ничего не нашлось.",
  countLabel = (n) => `${n}`,
  value,
  options,
  onChange,
  className,
}: {
  /** Подпись чипа, пока ничего не выбрано (имя фасета). */
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Подпись чипа при выборе нескольких значений. */
  countLabel?: (count: number) => string;
  value: string[];
  options: Option[];
  onChange: (value: string[]) => void;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const selected = options.filter((option) => value.includes(option.value));
  const active = value.length > 0;

  const toggle = (next: string) =>
    onChange(
      value.includes(next)
        ? value.filter((entry) => entry !== next)
        : [...value, next],
    );

  const chipLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0].label
        : countLabel(selected.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "tw:inline-flex tw:h-10 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-input tw:bg-transparent tw:px-4 tw:text-sm tw:font-semibold tw:whitespace-nowrap tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            active &&
              "tw:border-transparent tw:bg-primary/15 tw:text-accent-text tw:hover:bg-primary/20",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "tw:size-1.5 tw:rounded-full tw:bg-faint",
              active && "tw:bg-primary",
            )}
          />
          {chipLabel}
          <RiArrowDownSLine size={14} aria-hidden className="tw:opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="tw:w-64 tw:overflow-hidden tw:p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // value — подпись: cmdk фильтрует пункты по ней
                  value={option.label}
                  onSelect={() => toggle(option.value)}
                >
                  <RiCheckLine
                    className={cn(
                      "tw:flex-none",
                      value.includes(option.value)
                        ? "tw:opacity-100"
                        : "tw:opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="tw:w-full tw:cursor-pointer tw:appearance-none tw:border-0 tw:border-t tw:border-border tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:text-sm tw:font-medium tw:text-accent-text tw:outline-none tw:hover:bg-accent"
            >
              Сбросить выбор
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ChipMultiCombobox;
