import { useState } from "react";
import { useRouteLoaderData } from "react-router";

import { Input } from "@/components/ui/input";
import Combobox, { toOptions } from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import FormWrapper from "@/components/app/FormWrapper";
import TimeInput from "@/components/app/TimeInput";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const FREQUENCY_OPTIONS = [
  { value: "off", label: "Выключено" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Понедельник" },
  { value: 2, label: "Вторник" },
  { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" },
  { value: 5, label: "Пятница" },
  { value: 6, label: "Суббота" },
  { value: 0, label: "Воскресенье" },
];

/**
 * Расписание экспорта конфигураций — шторка над страницей записи (вложенный
 * маршрут `schedule`, право `manageConfigs`). Секция «Конфигурации» только
 * показывает расписание, сюда ведёт карандаш в её метке — «одно поле — одно
 * место правки».
 *
 * Форма отдельная от формы параметров намеренно: та проверяет подключение
 * при каждом сохранении (verify-on-save), и расписание у недоступного
 * устройства было бы не поменять; право у расписания тоже своё. Текущие
 * значения — из loader'а страницы записи (`id: "mikrotik-record"`), после
 * сабмита роутер перечитывает его сам.
 */
const ScheduleForm = () => {
  const row = useRouteLoaderData("mikrotik-record");
  const current = row?.schedules?.export;

  const [draft, setDraft] = useState({
    frequency: current?.frequency || "off",
    time: current?.time || "03:00",
    weekday: current?.weekday ?? 1,
    dayOfMonth: current?.dayOfMonth ?? 1,
    keepLast: current?.keepLast ?? 10,
  });
  const patch = (next) => setDraft((prev) => ({ ...prev, ...next }));

  return (
    <FormWrapper title="Расписание экспорта" json={() => draft}>
      <Field label="Периодичность" htmlFor="schedule-frequency">
        <Combobox
          id="schedule-frequency"
          options={FREQUENCY_OPTIONS}
          value={draft.frequency || "off"}
          onChange={(value) => patch({ frequency: value || "off" })}
        />
      </Field>
      {draft.frequency !== "off" && (
        <div className="grid gap-x-3 md:grid-cols-2">
          <Field label="Время" htmlFor="schedule-time">
            <TimeInput
              id="schedule-time"
              value={draft.time}
              onChange={(event) => patch({ time: event.target.value })}
            />
          </Field>
          {draft.frequency === "weekly" && (
            <Field label="День недели" htmlFor="schedule-weekday">
              {/* День недели числовой — переводим на границе виджета */}
              <Combobox
                id="schedule-weekday"
                options={toOptions(WEEKDAY_OPTIONS, {
                  value: (option) => String(option.value),
                  label: (option) => option.label,
                })}
                value={String(draft.weekday ?? 1)}
                onChange={(value) =>
                  patch({ weekday: value === null ? 1 : Number(value) })
                }
              />
            </Field>
          )}
          {draft.frequency === "monthly" && (
            <Field
              label="День месяца"
              htmlFor="schedule-day"
              hint="1–28, чтобы запуск был в каждом месяце."
            >
              <Input
                id="schedule-day"
                type="number"
                min={1}
                max={28}
                value={draft.dayOfMonth}
                onChange={(event) =>
                  patch({ dayOfMonth: Number(event.target.value) })
                }
              />
            </Field>
          )}
          <Field
            label="Хранить копий"
            htmlFor="schedule-keep"
            hint="Старые копии сверх лимита удаляются после очередного экспорта."
          >
            <Input
              id="schedule-keep"
              type="number"
              min={1}
              max={365}
              value={draft.keepLast}
              onChange={(event) =>
                patch({ keepLast: Number(event.target.value) })
              }
            />
          </Field>
        </div>
      )}
    </FormWrapper>
  );
};

export default ScheduleForm;

// Router-action шторки: тело — JSON формы, ответ — в формате FormWrapper
// (`error` + `message`); по успеху шторка закрывается сама, loader страницы
// записи перечитывается.
export async function action({ request, params }) {
  const body = await request.json();
  const response = await useMikrotikDeviceFilterStore
    .getState()
    .saveSchedules(params.recordId, { export: body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      error: true,
      message: data.message || "Не удалось сохранить расписание",
    };
  }
  return { message: data.message || "Расписание сохранено" };
}
