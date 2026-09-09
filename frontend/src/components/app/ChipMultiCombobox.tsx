import { useRef, useState } from "react";

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
import { useInOverlay } from "@/components/app/overlay-context";
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
  // Ссылка на триггер — чтобы понять, что чип стоит внутри шторки: там поповер
  // обязан быть модальным, иначе список не прокрутить (см. useInOverlay)
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inOverlay = useInOverlay(triggerRef);
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
    <Popover open={open} onOpenChange={setOpen} modal={inOverlay}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "inline-flex h-10 cursor-pointer appearance-none items-center gap-2 rounded-full border border-input bg-transparent px-4 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
            active &&
              "border-transparent bg-primary/15 text-accent-text hover:bg-primary/20",
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full bg-faint",
              active && "bg-primary",
            )}
          />
          {chipLabel}
          <RiArrowDownSLine size={14} aria-hidden className="opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 overflow-hidden p-0">
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
                      "flex-none",
                      value.includes(option.value)
                        ? "opacity-100"
                        : "opacity-0",
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
              className="w-full cursor-pointer appearance-none border-0 border-t border-border bg-transparent px-3 py-2 text-left text-sm font-medium text-accent-text outline-none hover:bg-accent"
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
