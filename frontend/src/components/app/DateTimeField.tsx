import { useEffect, useRef, useState } from "react";

import DateField from "@/components/app/DateField";
import TimeInput from "@/components/app/TimeInput";
import { cn } from "@/lib/utils";

import { joinDateTime, splitDateTime } from "./date-value";

export type DateTimeFieldProps = {
  /** id кнопки-даты; поле времени получает `${id}-time`. */
  id?: string;
  /** «2026-09-04T14:30» или «» — как у <input type="datetime-local">. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Нижняя граница «yyyy-MM-ddTHH:mm»: дни раньше недоступны, время ограничено в день границы. */
  min?: string;
  invalid?: boolean;
  className?: string;
};

/**
 * Дата со временем — композиция shadcn «Date and Time Picker»: поле-календарь
 * плюс нативное поле времени за одним строковым значением в бизнес-таймзоне
 * (пара utcToLocalForm / localToUtc у вызывающего не меняется).
 *
 * Части живут в локальном состоянии, как у нативного datetime-local: пока
 * нет обеих, наружу уходит «». Внешняя смена значения («Сейчас», чипы
 * длительности, загрузка формы) раскладывается на части заново; собственные
 * эмиссии незавершённый ввод не трогают. Выбранный день время не подставляет:
 * поле времени остаётся пустым, пока его не наберут, и до этого значение — «».
 */
const DateTimeField = ({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  min,
  invalid = false,
  className,
}: DateTimeFieldProps) => {
  const [parts, setParts] = useState(() => splitDateTime(value));
  const emitted = useRef(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setParts(splitDateTime(value));
    }
  }, [value]);

  const emit = (next: { day: string; time: string }) => {
    setParts(next);
    const joined = joinDateTime(next.day, next.time);
    if (joined !== value) {
      emitted.current = joined;
      onChange(joined);
    }
  };

  const minParts = splitDateTime(min ?? "");

  return (
    <div className={cn("flex gap-2", className)}>
      <DateField
        id={id}
        value={parts.day}
        onChange={(day) =>
          emit(day ? { day, time: parts.time } : { day: "", time: "" })
        }
        min={minParts.day || undefined}
        required={required}
        disabled={disabled}
        invalid={invalid}
        className="min-w-0 flex-1"
      />
      <TimeInput
        id={id ? `${id}-time` : undefined}
        aria-label="Время"
        value={parts.time}
        min={
          parts.day && parts.day === minParts.day ? minParts.time : undefined
        }
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => emit({ day: parts.day, time: event.target.value })}
        className="w-28 flex-none"
      />
    </div>
  );
};

export default DateTimeField;
