import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Дни недели: подпись + ключ (как в customProvisionSchedule на бэкенде/View) +
// короткая подпись. Короткую держим здесь же: обрезать полную по две буквы
// нельзя («Че», «Пя», «Су»), а копии словаря уже расходились по компонентам.
export const SCHEDULE_DAYS = [
  ["Понедельник", "Monday", "Пн"],
  ["Вторник", "Tuesday", "Вт"],
  ["Среда", "Wednesday", "Ср"],
  ["Четверг", "Thursday", "Чт"],
  ["Пятница", "Friday", "Пт"],
  ["Суббота", "Saturday", "Сб"],
  ["Воскресенье", "Sunday", "Вс"],
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
//
// Строка дня обязана умещаться в ОДНУ строку и в узком контейнере (мобильная
// шторка формы — 361px): там день называется коротко, поля времени делят
// остаток поровну, подпись свитча сокращается. Фиксированные 144 + 256 px
// переносили строку в три.
const ScheduleEditor = ({ schedule, onChange }) => {
  const setDay = (key, patch) =>
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });

  const toggle24 = (key, on) =>
    setDay(key, on ? { is24hours: true, start: "", end: "" } : emptyDay());

  return (
    <div className="divide-y divide-border-soft">
      {SCHEDULE_DAYS.map(([label, key, short]) => {
        const day = schedule[key] || emptyDay();
        return (
          <div key={key} className="flex items-center gap-2 py-2.5 sm:gap-3">
            <label className="flex w-12 flex-none cursor-pointer items-center gap-2 text-sm font-medium sm:w-36 sm:gap-2.5">
              <Checkbox
                checked={day.isWorking}
                onCheckedChange={(checked) =>
                  setDay(key, { isWorking: checked === true })
                }
              />
              <span className={cn(!day.isWorking && "text-faint")}>
                <span className="sm:hidden">{short}</span>
                <span className="max-sm:hidden">{label}</span>
              </span>
            </label>

            {/* На широком — фиксированная ширина блока времени, чтобы свитч
                «24 часа» выравнивался по дням; на узком блок тянется, и поля
                делят остаток строки поровну */}
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:w-64 sm:flex-none">
              {!day.isWorking ? (
                <span className="text-sm text-faint">Выходной</span>
              ) : day.is24hours ? (
                <span className="text-sm text-muted-foreground">
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
                    className="h-9 w-full min-w-0 tabular-nums sm:w-28"
                  />
                  <span className="text-faint">–</span>
                  <Input
                    type="time"
                    value={day.end}
                    onChange={(event) =>
                      setDay(key, { end: event.target.value })
                    }
                    className="h-9 w-full min-w-0 tabular-nums sm:w-28"
                  />
                </>
              )}
            </div>

            {day.isWorking && (
              <label className="flex flex-none cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  checked={day.is24hours}
                  onCheckedChange={(checked) => toggle24(key, checked === true)}
                  aria-label={`${label}: круглосуточно`}
                />
                <span className="text-xs sm:hidden">24ч</span>
                <span className="max-sm:hidden">24 часа</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ScheduleEditor;
