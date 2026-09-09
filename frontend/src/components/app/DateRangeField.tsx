import { useRef, useState } from "react";

import { isMobile } from "react-device-detect";
import type { DateRange } from "react-day-picker";

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

import { parseDayKey, rangeLabel, toDayKey, type DayRange } from "./date-value";

export type DateRangeFieldProps = {
  id?: string;
  /** Границы day-key («» — не задана); фильтры принимают и одну. */
  value: DayRange;
  onChange: (range: DayRange) => void;
  /** Обязательны обе границы — см. RequiredMirror. */
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  /** Крестик очистки у непустого поля (нет у required и disabled). */
  clearable?: boolean;
  ariaLabel?: string;
  invalid?: boolean;
  className?: string;
};

const toDayRange = (range?: DateRange): DayRange => ({
  from: range?.from ? toDayKey(range.from) : "",
  to: range?.to ? toDayKey(range.to) : "",
});

const fromDayRange = ({ from, to }: DayRange): DateRange | undefined =>
  from || to ? { from: parseDayKey(from), to: parseDayKey(to) } : undefined;

/**
 * Период одним полем: «01.09.2026 – 30.09.2026». Календарь в режиме range,
 * два месяца на десктопе и один на телефоне. Пока поповер открыт, выбор —
 * черновик: наружу уходит либо законченный диапазон (и поповер закрывается),
 * либо то, что успели выбрать, при закрытии. Одна граница — тоже значение:
 * фильтры принимают «с даты» без «по» (`to` — «»).
 *
 * `resetOnSelect`: первый щелчок — начало, второй — конец; щелчок при уже
 * полном диапазоне начинает новый, а не растягивает старый (по умолчанию
 * DayPicker делает первый день сразу диапазоном из одного дня и дальше только
 * растягивает — перевыбрать период тогда нельзя, не сбросив его).
 */
const DateRangeField = ({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  min,
  max,
  placeholder = "Выберите период",
  clearable: clearableProp = true,
  ariaLabel,
  invalid = false,
  className,
}: DateRangeFieldProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inOverlay = useInOverlay(triggerRef);

  const minDate = parseDayKey(min);
  const maxDate = parseDayKey(max);
  const clearable =
    clearableProp && Boolean(value.from || value.to) && !required && !disabled;

  const commit = (range?: DateRange) => {
    const next = toDayRange(range);
    if (next.from !== value.from || next.to !== value.to) onChange(next);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(fromDayRange(value));
    else commit(draft);
    setOpen(next);
  };

  const handleSelect = (range: DateRange | undefined) => {
    setDraft(range);
    if (range?.from && range?.to) {
      commit(range);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={inOverlay}>
      {/* relative — якорь для скрытого спутника required и крестика */}
      <div className={cn("relative", className)}>
        {required && (
          <RequiredMirror
            value={value.from && value.to ? "x" : ""}
            disabled={disabled}
            onFocus={() => triggerRef.current?.focus()}
          />
        )}
        <PopoverTrigger asChild>
          <DateTrigger
            ref={triggerRef}
            id={id}
            aria-label={ariaLabel}
            disabled={disabled}
            invalid={invalid}
            clearable={clearable}
            label={rangeLabel(value)}
            placeholder={placeholder}
          />
        </PopoverTrigger>
        {clearable && (
          <DateClearButton onClick={() => onChange({ from: "", to: "" })} />
        )}
      </div>

      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          resetOnSelect
          numberOfMonths={isMobile ? 1 : 2}
          selected={draft}
          defaultMonth={draft?.from ?? minDate}
          startMonth={minDate}
          endMonth={maxDate}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
};

export default DateRangeField;
