import { useState } from "react";
import { useLocation, useRouteLoaderData } from "react-router";
import { RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import FormWrapper from "@/components/app/FormWrapper";
import TimeInput from "@/components/app/TimeInput";
import { cn } from "@/lib/utils";

import { WEEK_ORDER } from "./activity-format";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const DAY_LABEL = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_NAME = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];
const MAX_WINDOWS = 7;

const emptyWindow = () => ({ days: [1, 2, 3, 4, 5], start: "22:00", end: "07:00" });

/**
 * Плановые отключения устройства — шторка над страницей записи (вложенный
 * маршрут `planned-offline`, право `manage`). Секция «Активность» только
 * показывает окна, сюда ведёт карандаш в её метке и кнопка «Задать окно» у
 * предложенного окна (оно приходит в `location.state.suggestion`).
 *
 * Форма отдельная от формы параметров намеренно: та проверяет подключение при
 * каждом сохранении, а окно задают как раз для устройства, которое бывает
 * выключено. Время — в поясе организации; конец раньше начала значит
 * следующий день.
 */
const PlannedOfflineForm = () => {
  const row = useRouteLoaderData("mikrotik-record");
  const suggestion = useLocation().state?.suggestion;

  const [windows, setWindows] = useState(() => {
    const current = (row?.plannedOffline || []).map((window) => ({ ...window }));
    return suggestion
      ? [...current, { days: suggestion.days, start: suggestion.start, end: suggestion.end }]
      : current;
  });

  const patch = (index, next) =>
    setWindows((prev) =>
      prev.map((window, position) => (position === index ? { ...window, ...next } : window)),
    );
  const toggleDay = (index, day) => {
    const days = windows[index].days;
    patch(index, {
      days: days.includes(day) ? days.filter((value) => value !== day) : [...days, day],
    });
  };

  return (
    <FormWrapper title="Плановые отключения" json={() => ({ windows })}>
      <p className="mb-3 text-sm text-muted-foreground">
        В эти часы устройство выключено намеренно. Заявка о недоступности не
        создаётся, простой не снижает доступность. Если через 30 минут после
        конца окна устройство не вернулось, заявка создаётся.
      </p>

      <div className="divide-y divide-border-soft border-y border-border-soft">
        {windows.length === 0 && (
          <div className="py-3 text-sm text-faint">Окон нет.</div>
        )}
        {windows.map((window, index) => (
          <div key={index} className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 py-3">
            <div
              role="group"
              aria-label="Дни недели"
              className="flex gap-1 max-md:basis-full"
            >
              {WEEK_ORDER.map((day) => {
                const on = window.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAME[day]}
                    onClick={() => toggleDay(index, day)}
                    className={cn(
                      "grid h-8 w-9 cursor-pointer appearance-none place-items-center rounded-lg border text-sm font-medium transition-colors max-md:w-auto max-md:flex-1",
                      on
                        ? "border-primary/55 bg-primary/15 text-accent-text"
                        : "border-border bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {DAY_LABEL[day]}
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-0 items-center gap-2 max-md:flex-1">
              <TimeInput
                value={window.start}
                aria-label="Начало"
                onChange={(event) => patch(index, { start: event.target.value })}
                className="h-9 w-24 min-w-0 max-md:w-full"
              />
              <span className="text-faint">–</span>
              <TimeInput
                value={window.end}
                aria-label="Конец"
                onChange={(event) => patch(index, { end: event.target.value })}
                className="h-9 w-24 min-w-0 max-md:w-full"
              />
            </div>
            {window.end && window.start && window.end < window.start && (
              <span className="text-xs text-faint max-md:order-last max-md:basis-full">
                до {window.end} следующего дня
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ms-auto text-faint"
              aria-label="Удалить окно"
              onClick={() =>
                setWindows((prev) => prev.filter((_, position) => position !== index))
              }
            >
              <RiCloseLine />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={windows.length >= MAX_WINDOWS}
          onClick={() => setWindows((prev) => [...prev, emptyWindow()])}
        >
          Новое окно
        </Button>
        <span className="text-xs text-faint">Время по поясу организации</span>
      </div>
    </FormWrapper>
  );
};

export default PlannedOfflineForm;

// Router-action шторки: тело — JSON формы, ответ — в формате FormWrapper
// (`error` + `message`); по успеху шторка закрывается сама, loader страницы
// записи перечитывается.
export async function action({ request, params }) {
  const body = await request.json();
  const response = await useMikrotikDeviceFilterStore
    .getState()
    .savePlannedOffline(params.recordId, body.windows);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      error: true,
      message: data.message || "Не удалось сохранить плановые отключения",
    };
  }
  return { message: data.message || "Плановые отключения сохранены" };
}
