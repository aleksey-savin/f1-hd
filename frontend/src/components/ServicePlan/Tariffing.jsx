import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";

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

// Число с единицей-суффиксом внутри поля (₽, ₽/ч, мин)
const UnitInput = ({ unit, ...props }) => (
  <div className="tw:relative">
    <Input type="number" className="tw:pr-12 tw:tabular-nums" {...props} />
    <span className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:right-3 tw:flex tw:items-center tw:text-sm tw:text-faint">
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
      <div className="tw:mb-4">
        <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
          Тарификация
        </h3>
        <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          Как считается стоимость услуги
        </p>
      </div>

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
          <UnitInput
            id="fixedPrice"
            unit="₽"
            min={0}
            value={form.fixedPrice}
            onChange={(event) => setField("fixedPrice", event.target.value)}
          />
        </Field>
      )}

      {form.type === "hourly" && (
        <Field label="Стоимость часа в рабочее время" htmlFor="pricePerHour">
          <UnitInput
            id="pricePerHour"
            unit="₽/ч"
            min={0}
            value={form.pricePerHour}
            onChange={(event) => setField("pricePerHour", event.target.value)}
          />
        </Field>
      )}

      {isPackages && (
        <>
          <div className="tw:mb-4">
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
            className="tw:tabular-nums"
          />
        </Field>
      )}

      <div className="tw:grid tw:gap-x-4 tw:sm:grid-cols-2">
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
            <UnitInput
              id="pricePerHourNonWorking"
              unit="₽/ч"
              min={0}
              value={form.pricePerHourNonWorking}
              onChange={(event) =>
                setField("pricePerHourNonWorking", event.target.value)
              }
            />
          </Field>
        )}
        <Field label="Период тарификации" htmlFor="tariffingPeriod">
          <UnitInput
            id="tariffingPeriod"
            unit="мин"
            min={1}
            value={form.tariffingPeriod}
            onChange={(event) => setField("tariffingPeriod", event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
};

export default Tariffing;
