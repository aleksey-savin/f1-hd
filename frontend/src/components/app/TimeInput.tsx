import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Поле времени «ЧЧ:ММ» — паттерн «Time Picker» из документации shadcn:
 * нативный <input type="time"> в оболочке Input со спрятанным браузерным
 * индикатором-часами (`::-webkit-calendar-picker-indicator`). Сегменты часов и
 * минут набираются с клавиатуры и стрелками, а вид поля не зависит от ОС и
 * темы. Половина DateTimeField; сам по себе — графики работы
 * (ScheduleEditor), расписания (ScheduleBuilder, Mikrotik). Значение — строка
 * «HH:mm», как у нативного поля.
 */
const TimeInput = ({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) => (
  <Input
    type="time"
    className={cn(
      "appearance-none bg-background tabular-nums [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
      className,
    )}
    {...props}
  />
);

export default TimeInput;
