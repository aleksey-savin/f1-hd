import { useRef, useState } from "react";

import { RequiredMirror } from "@/components/app/Combobox";
import DateTrigger, { DateClearButton } from "@/components/app/DateTrigger";
import { useInOverlay } from "@/components/app/overlay-context";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { formatDayKey } from "../../util/format-date";
import { parseDayKey, toDayKey } from "./date-value";

export type DateFieldProps = {
  id?: string;
  /** «2026-09-04» или «» — как у <input type="date">. */
  value: string;
  onChange: (value: string) => void;
  /** Имя поля в FormData: рендерит скрытый input со значением. */
  name?: string;
  /** Нативная валидация формы — через скрытый спутник, см. RequiredMirror. */
  required?: boolean;
  disabled?: boolean;
  /** Границы day-key: дни вне их недоступны, навигация ограничена. */
  min?: string;
  max?: string;
  placeholder?: string;
  /** Крестик очистки у непустого поля (нет у required и disabled). */
  clearable?: boolean;
  /** dropdown — месяц и год списками: для дат за годы отсюда. */
  captionLayout?: "label" | "dropdown";
  /** Подпись для скринридера, когда видимого лейбла у поля нет. */
  ariaLabel?: string;
  invalid?: boolean;
  className?: string;
};

// Выпадающим спискам месяца/года DayPicker нужен явный диапазон лет — без
// него он не заглядывает в будущее, а гарантия и обслуживание как раз там.
const YEARS_BACK = 30;
const YEARS_AHEAD = 20;

/**
 * Поле «дата» — календарь shadcn в Popover, замена <input type="date">.
 * Значение — та же строка yyyy-MM-dd, поэтому сторы, actions и хелперы дат
 * не меняются. Выбор — по сетке (мышь, клавиатура); ввода текстом нет.
 */
const DateField = ({
  id,
  value,
  onChange,
  name,
  required = false,
  disabled = false,
  min,
  max,
  placeholder = "Выберите дату",
  captionLayout = "label",
  clearable: clearableProp = true,
  ariaLabel,
  invalid = false,
  className,
}: DateFieldProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inOverlay = useInOverlay(triggerRef);

  const selected = parseDayKey(value);
  const minDate = parseDayKey(min);
  const maxDate = parseDayKey(max);
  const dropdown = captionLayout === "dropdown";
  const thisYear = new Date().getFullYear();
  const startMonth =
    minDate ?? (dropdown ? new Date(thisYear - YEARS_BACK, 0) : undefined);
  const endMonth =
    maxDate ?? (dropdown ? new Date(thisYear + YEARS_AHEAD, 11) : undefined);
  const clearable = clearableProp && Boolean(value) && !required && !disabled;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inOverlay}>
      {/* relative — якорь для скрытого спутника required и крестика */}
      <div className={cn("relative", className)}>
        {required && (
          <RequiredMirror
            value={value}
            disabled={disabled}
            onFocus={() => triggerRef.current?.focus()}
          />
        )}
        {/* name — контракт FormData: сабмит страницы читает значение через
            formData.get(name) */}
        {name && <input type="hidden" name={name} value={value} />}
        <PopoverTrigger asChild>
          <DateTrigger
            ref={triggerRef}
            id={id}
            aria-label={ariaLabel}
            disabled={disabled}
            invalid={invalid}
            clearable={clearable}
            label={formatDayKey(value)}
            placeholder={placeholder}
          />
        </PopoverTrigger>
        {clearable && <DateClearButton onClick={() => onChange("")} />}
      </div>

      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minDate}
          captionLayout={captionLayout}
          startMonth={startMonth}
          endMonth={endMonth}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={(date) => {
            // Повторный щелчок по выбранному дню DayPicker считает снятием
            // выбора; для поля это ничего не значит — оставляем как было
            if (!date) return;
            onChange(toDayKey(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};

export default DateField;
