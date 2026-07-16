import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Дни недели: подпись + ключ (как в customProvisionSchedule на бэкенде/View)
export const SCHEDULE_DAYS = [
  ["Понедельник", "Monday"],
  ["Вторник", "Tuesday"],
  ["Среда", "Wednesday"],
  ["Четверг", "Thursday"],
  ["Пятница", "Friday"],
  ["Суббота", "Saturday"],
  ["Воскресенье", "Sunday"],
];

export const emptyDay = () => ({
  isWorking: false,
  is24hours: false,
  start: "09:00",
  end: "18:00",
});

// Недельный редактор графика оказания: строка на день — чекбокс рабочего дня ·
// время начала/конца · свитч «24 часа» (гасит поля времени, показывает
// «Круглосуточно»). Выходной день приглушён.
const ScheduleEditor = ({ schedule, onChange }) => {
  const setDay = (key, patch) =>
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });

  const toggle24 = (key, on) =>
    setDay(key, on ? { is24hours: true, start: "", end: "" } : emptyDay());

  return (
    <div className="tw:divide-y tw:divide-border-soft">
      {SCHEDULE_DAYS.map(([label, key]) => {
        const day = schedule[key] || emptyDay();
        return (
          <div
            key={key}
            className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:py-2.5"
          >
            <label className="tw:flex tw:w-36 tw:flex-none tw:cursor-pointer tw:items-center tw:gap-2.5 tw:text-sm tw:font-medium">
              <Checkbox
                checked={day.isWorking}
                onCheckedChange={(checked) =>
                  setDay(key, { isWorking: checked === true })
                }
              />
              <span className={cn(!day.isWorking && "tw:text-faint")}>
                {label}
              </span>
            </label>

            {/* Фиксированная ширина блока времени — свитч «24 часа» держится
                в одну строку и выравнивается по дням */}
            <div className="tw:flex tw:w-64 tw:flex-none tw:items-center tw:gap-2">
              {!day.isWorking ? (
                <span className="tw:text-sm tw:text-faint">Выходной</span>
              ) : day.is24hours ? (
                <span className="tw:text-sm tw:text-muted-foreground">
                  Круглосуточно
                </span>
              ) : (
                <>
                  <Input
                    type="time"
                    value={day.start}
                    onChange={(event) =>
                      setDay(key, { start: event.target.value })
                    }
                    className="tw:h-9 tw:w-28 tw:tabular-nums"
                  />
                  <span className="tw:text-faint">–</span>
                  <Input
                    type="time"
                    value={day.end}
                    onChange={(event) => setDay(key, { end: event.target.value })}
                    className="tw:h-9 tw:w-28 tw:tabular-nums"
                  />
                </>
              )}
            </div>

            {day.isWorking && (
              <label className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
                <Switch
                  checked={day.is24hours}
                  onCheckedChange={(checked) => toggle24(key, checked === true)}
                />
                24 часа
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ScheduleEditor;
