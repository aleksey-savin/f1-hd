import { RiFileList2Line } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { formatPrice } from "../../util/format-string";
import { plural } from "../../util/plural";
import { tariffTypeName } from "./tariff-types";

// formatPrice уже добавляет «₽»
const money = (value) => formatPrice(Math.round(Number(value) || 0));

const SHORT_DAYS = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

const priceLabel = (form, packages) => {
  if (form.type === "fixedPrice") return money(form.fixedPrice);
  if (form.type === "hourly") return `${money(form.pricePerHour)}/ч`;
  const rates = packages
    .map((pkg) => Number(pkg.pricePerHour) || 0)
    .filter((rate) => rate > 0);
  const min = rates.length ? Math.min(...rates) : 0;
  const count = packages.length;
  return `${count} ${plural(count, "пакет", "пакета", "пакетов")} · от ${money(min)}/ч`;
};

const nonWorkingLabel = (form) =>
  form.type === "hourPackage" &&
  form.packagesNonWorkingCalcMethod === "coefficient"
    ? `× ${form.packagesNonWorkingCoefficient}`
    : `${money(form.pricePerHourNonWorking)}/ч`;

const scheduleLabel = (form) => {
  if (form.companyWorkSchedule) return "По графику компании";
  const working = Object.entries(SHORT_DAYS)
    .filter(([key]) => form.schedule?.[key]?.isWorking)
    .map(([, short]) => short);
  if (working.length === 0) return "Не задан";
  if (working.length === 7) return "Ежедневно";
  return working.join(", ");
};

const Row = ({ label, value, muted }) => (
  <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:text-sm tw:first:border-t-0">
    <dt className="tw:flex-none tw:text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "tw:m-0 tw:text-right tw:font-semibold tw:tabular-nums",
        muted ? "tw:font-normal tw:text-faint" : "tw:text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
);

// Живая сводка мастера: наполняется по мере прохождения шагов (reached —
// максимально достигнутый шаг). Незаданное показывает «—».
const Summary = ({ form, packages, reached }) => {
  const categoryCount = form.ticketCategories.length;
  const showTariff = reached >= 1;
  const showSchedule = reached >= 2;

  return (
    <aside className="tw:rounded-xl tw:border tw:border-border tw:bg-accent/40 tw:p-4 tw:md:sticky tw:md:top-3">
      <div className="tw:mb-3 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        Сводка
      </div>
      <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2.5">
        <span className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
          <RiFileList2Line />
        </span>
        <div
          className={cn(
            "tw:text-sm tw:leading-tight",
            form.title
              ? "tw:font-semibold tw:text-foreground"
              : "tw:font-medium tw:text-faint",
          )}
        >
          {form.title || "Новая услуга"}
        </div>
      </div>
      <dl className="tw:m-0">
        <Row label="Категории" value={categoryCount || "—"} muted={!categoryCount} />
        <Row
          label="Тарификация"
          value={showTariff ? tariffTypeName(form.type) : "—"}
          muted={!showTariff}
        />
        <Row
          label="Стоимость"
          value={showTariff ? priceLabel(form, packages) : "—"}
          muted={!showTariff}
        />
        <Row
          label="Нерабочее"
          value={showTariff ? nonWorkingLabel(form) : "—"}
          muted={!showTariff}
        />
        <Row
          label="Период"
          value={showTariff ? `${form.tariffingPeriod || 0} мин` : "—"}
          muted={!showTariff}
        />
        <Row
          label="График"
          value={showSchedule ? scheduleLabel(form) : "—"}
          muted={!showSchedule}
        />
      </dl>
    </aside>
  );
};

export default Summary;
