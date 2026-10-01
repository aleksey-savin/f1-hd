import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";

import { moneyInputValue } from "../../util/money";
import PackagesEditor from "./PackagesEditor";

const TYPE_SEGMENTS = [
  { value: "fixedPrice", label: "Фиксированная" },
  { value: "hourly", label: "Почасовая" },
  { value: "hourPackage", label: "Пакеты часов" },
];

const NON_WORKING_METHODS = [
  { value: "separatePayment", label: "Отдельная оплата" },
  { value: "coefficient", label: "Коэффициент ко времени" },
];

// Целое число с единицей-суффиксом внутри поля (мин)
const UnitInput = ({ unit, ...props }) => (
  <div className="relative">
    <Input type="number" className="pr-12 tabular-nums" {...props} />
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-faint">
      {unit}
    </span>
  </div>
);

// Цена с копейками и единицей-суффиксом. Поле текстовое: `type="number"` не
// понимает ни запятую, ни пробелы разрядов, а его шаг по умолчанию — целые.
// Пока человек печатает, значение не трогаем; на выходе из поля приводим к
// виду «1 250,50» (целое — «1 250»).
const MoneyInput = ({ unit, value, onChange, ...props }) => (
  <div className="relative">
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="pr-12 tabular-nums"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onChange(moneyInputValue(event.target.value))}
      {...props}
    />
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-faint">
      {unit}
    </span>
  </div>
);

// Шаг «Тарификация»: тип (сегмент) переключает блок цены. Для «пакетов часов» —
// редактор пакетов + метод учёта работ вне графика (+ коэффициент). Поле
// «нерабочее время» показывается всегда, кроме hourPackage+coefficient.
const Tariffing = ({ form, setField, packages, setPackages }) => {
  const isPackages = form.type === "hourPackage";
  const isCoefficient =
    isPackages && form.packagesNonWorkingCalcMethod === "coefficient";

  return (
    <div>
      {/* Заголовок и описание секции рисует каркас формы (шаг мастера или
          секция правки) — здесь только поля */}
      <Field label="Тип тарификации">
        <Segmented
          ariaLabel="Тип тарификации"
          options={TYPE_SEGMENTS}
          value={form.type}
          onChange={(value) => setField("type", value)}
        />
      </Field>

      {form.type === "fixedPrice" && (
        <Field label="Общая стоимость" htmlFor="fixedPrice">
          <MoneyInput
            id="fixedPrice"
            unit="₽"
            value={form.fixedPrice}
            onChange={(value) => setField("fixedPrice", value)}
          />
        </Field>
      )}

      {form.type === "hourly" && (
        <Field label="Стоимость часа в рабочее время" htmlFor="pricePerHour">
          <MoneyInput
            id="pricePerHour"
            unit="₽/ч"
            value={form.pricePerHour}
            onChange={(value) => setField("pricePerHour", value)}
          />
        </Field>
      )}

      {isPackages && (
        <>
          <div className="mb-4">
            <PackagesEditor packages={packages} onChange={setPackages} />
          </div>
          <Field label="Учёт работ вне графика оказания услуги">
            <Segmented
              ariaLabel="Учёт работ вне графика"
              options={NON_WORKING_METHODS}
              value={form.packagesNonWorkingCalcMethod}
              onChange={(value) =>
                setField("packagesNonWorkingCalcMethod", value)
              }
            />
          </Field>
        </>
      )}

      {isCoefficient && (
        <Field
          label="Коэффициент ко времени работ"
          htmlFor="coefficient"
          hint="Стоимость работ вне графика = ставка × коэффициент."
        >
          <Input
            id="coefficient"
            type="number"
            min={1}
            step={0.1}
            value={form.packagesNonWorkingCoefficient}
            onChange={(event) =>
              setField("packagesNonWorkingCoefficient", event.target.value)
            }
            className="tabular-nums"
          />
        </Field>
      )}

      <div className="grid gap-x-4 sm:grid-cols-2">
        {!isCoefficient && (
          <Field
            label="Стоимость часа в нерабочее время"
            htmlFor="pricePerHourNonWorking"
            hint={
              form.type === "fixedPrice"
                ? "Оплата фиксирована на рабочий график; работы вне его — доплата по этой ставке."
                : undefined
            }
          >
            <MoneyInput
              id="pricePerHourNonWorking"
              unit="₽/ч"
              value={form.pricePerHourNonWorking}
              onChange={(value) => setField("pricePerHourNonWorking", value)}
            />
          </Field>
        )}
        <Field label="Период тарификации" htmlFor="tariffingPeriod">
          <UnitInput
            id="tariffingPeriod"
            unit="мин"
            min={1}
            value={form.tariffingPeriod}
            onChange={(event) =>
              setField("tariffingPeriod", event.target.value)
            }
          />
        </Field>
      </div>
    </div>
  );
};

export default Tariffing;
