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
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 overflow-hidden p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && (
                <CommandItem value="" onSelect={() => pick(null)}>
                  <RiCheckLine
                    className={cn(
                      "flex-none",
                      value === null ? "opacity-100" : "opacity-0",
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
                      "flex-none",
                      option.value === value ? "opacity-100" : "opacity-0",
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
