import { useState } from "react";

import { Input } from "@/components/ui/input";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";
import ScheduleEditor, { emptyDay } from "@/components/app/ScheduleEditor";

import Combobox, { toOptions } from "@/components/app/Combobox";
import SectionForm from "./SectionForm";

// «Финансы» (видна при включённом модуле): резервный график и период
// тарификации по умолчанию для работ вне тарифов + коэффициенты оплаты
// переработок. Детекция везде одна — calcSingleWorkOvertime (сводный отчёт =
// персональный отчёт). График широкий — живёт на всю ширину панели, не в
// правой колонке SettingRow.
const WORK_DAY = () => ({ ...emptyDay(), isWorking: true });
const DEFAULT_SCHEDULE = {
  Monday: WORK_DAY(),
  Tuesday: WORK_DAY(),
  Wednesday: WORK_DAY(),
  Thursday: WORK_DAY(),
  Friday: WORK_DAY(),
  Saturday: emptyDay(),
  Sunday: emptyDay(),
};

const TARIFFING_OPTIONS = [5, 10, 15, 20, 30, 60].map((minutes) => ({
  value: minutes,
  label: `${minutes} минут`,
}));

const PrefsOvertime = ({ prefs }) => {
  const [schedule, setSchedule] = useState(() =>
    prefs.overtime?.defaultSchedule?.Monday
      ? structuredClone(prefs.overtime.defaultSchedule)
      : DEFAULT_SCHEDULE,
  );
  const [tariffingPeriod, setTariffingPeriod] = useState(
    prefs.overtime?.defaultTariffingPeriodMinutes ?? 15,
  );
  const [weekdayCoefficient, setWeekdayCoefficient] = useState(
    prefs.overtime?.weekdayCoefficient ?? 1,
  );
  const [weekendCoefficient, setWeekendCoefficient] = useState(
    prefs.overtime?.weekendCoefficient ?? 1,
  );

  return (
    <SectionForm
      buildPayload={() => ({
        overtime: {
          defaultSchedule: schedule,
          defaultTariffingPeriodMinutes: Number(tariffingPeriod) || 15,
          weekdayCoefficient: Number(weekdayCoefficient) || 1,
          weekendCoefficient: Number(weekendCoefficient) || 1,
          // Коэффициент праздника живёт в «Производственном календаре», но
          // группу бэкенд заменяет целиком — без него сохранение «Финансов»
          // сбрасывало бы чужую настройку.
          holidayCoefficient: prefs.overtime?.holidayCoefficient ?? null,
        },
      })}
    >
      <SettingRow
        title="График работы по умолчанию"
        hint="Применяется, если график не задан в тарифе или компании; время вне графика и в нерабочие дни считается переработкой."
      />
      <div className="px-5 pb-4">
        <ScheduleEditor schedule={schedule} onChange={setSchedule} />
      </div>
      <SettingRow
        divider
        title="Период тарификации по умолчанию"
        hint="Минимальный тарифицируемый отрезок работы, если не задан в подключённой к компании услуге."
      >
        <div className="w-44 max-md:w-full">
          {/* Значение периода числовое, а Combobox говорит строками —
              переводим на границе, стор остаётся с числом */}
          <Combobox
            id="prefs-overtime-period"
            value={String(Number(tariffingPeriod))}
            options={toOptions(TARIFFING_OPTIONS, {
              value: (option) => String(option.value),
              label: (option) => option.label,
            })}
            onChange={(value) => setTariffingPeriod(Number(value) || 15)}
          />
        </div>
      </SettingRow>

      <div className="px-5 pt-4">
        <SubLabel>Оплата переработок</SubLabel>
      </div>
      <SettingRow
        title="Коэффициент в будни"
        hint="Доплата = часы × ставка × коэффициент; на величину переработки не влияет."
        className="py-3"
      >
        <Input
          type="number"
          min="0"
          step="0.1"
          value={weekdayCoefficient}
          onChange={(event) => setWeekdayCoefficient(event.target.value)}
          className="w-24 text-right"
          aria-label="Коэффициент оплаты в будни"
        />
      </SettingRow>
      <SettingRow title="Коэффициент в выходные" className="py-3">
        <Input
          type="number"
          min="0"
          step="0.1"
          value={weekendCoefficient}
          onChange={(event) => setWeekendCoefficient(event.target.value)}
          className="w-24 text-right"
          aria-label="Коэффициент оплаты в выходные"
        />
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsOvertime;
