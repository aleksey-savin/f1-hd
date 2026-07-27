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

export type ComboboxOption = {
  value: string;
  label: string;
  /** Приглушённая строка под названием: должность, город, пояснение. */
  hint?: string;
};

/**
 * Выпадающий список с поиском — ПОЛЕ ФОРМЫ (в отличие от app/ChipCombobox,
 * который рисует чип для строки инструментов). Заменяет UI/Select там, где
 * список длинный: react-select внутри шторки рисует меню инлайном и его
 * обрезает прокрутка, а Popover уходит в слой radix и живёт свободно.
 *
 * Ширина меню равна ширине поля (`--radix-popover-trigger-width`), поэтому
 * длинные подписи не растягивают шторку.
 */
const Combobox = ({
  id,
  value,
  options,
  onChange,
  placeholder = "Выберите значение",
  searchPlaceholder = "Найти…",
  emptyText = "Ничего не нашлось.",
  clearable = false,
  clearLabel = "Не выбрано",
  disabled = false,
  className,
}: {
  id?: string;
  value: string | null;
  options: ComboboxOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Добавляет в список пункт сброса. */
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
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
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          // appearance/border/bg заданы явно: preflight выключен, браузерные
          // дефолты <button> никто не сбрасывает
          className={cn(
            "tw:flex tw:h-9 tw:w-full tw:appearance-none tw:items-center tw:gap-2 tw:rounded-md",
            "tw:border tw:border-input tw:bg-background tw:px-3 tw:text-left tw:text-sm",
            "tw:hover:bg-accent tw:focus-visible:outline-2 tw:focus-visible:outline-ring",
            "tw:disabled:cursor-not-allowed tw:disabled:opacity-60",
            className,
          )}
        >
          <span
            className={cn(
              "tw:min-w-0 tw:flex-1 tw:truncate",
              !selected && "tw:text-muted-foreground",
            )}
          >
            {selected ? selected.label : placeholder}
          </span>
          <RiArrowDownSLine className="tw:flex-none tw:text-faint" size={16} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="tw:w-(--radix-popover-trigger-width) tw:p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {clearable && (
                <CommandItem value={clearLabel} onSelect={() => pick(null)}>
                  <span className="tw:flex-1 tw:text-muted-foreground">
                    {clearLabel}
                  </span>
                  {value === null && <RiCheckLine size={16} />}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // value — то, по чему ищет cmdk: подпись, а не id
                  value={`${option.label} ${option.hint ?? ""}`}
                  onSelect={() => pick(option.value)}
                >
                  <span className="tw:min-w-0 tw:flex-1">
                    <span className="tw:block tw:truncate">{option.label}</span>
                    {option.hint && (
                      <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <RiCheckLine className="tw:flex-none" size={16} />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default Combobox;
