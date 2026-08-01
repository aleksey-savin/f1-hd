import { RiFileList2Line } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { formatCalendarDate } from "../../util/format-date";
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
  <div className="flex items-baseline justify-between gap-3 border-t border-border-soft py-2.5 text-sm first:border-t-0">
    <dt className="flex-none text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "m-0 text-right font-semibold tabular-nums",
        muted ? "font-normal text-faint" : "text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
);

// Живая сводка мастера: наполняется по мере прохождения шагов (reached —
// максимально достигнутый шаг). Незаданное показывает «—». attach — контекст
// «Новой услуги» с карточки компании: для кого создаём и с какими параметрами
// подключения (виден на всех шагах).
const Summary = ({ form, packages, reached, attach = null }) => {
  const categoryCount = form.ticketCategories.length;
  const showTariff = reached >= 1;
  const showSchedule = reached >= 2;

  return (
    <aside className="rounded-xl border border-border bg-accent/40 p-4 md:sticky md:top-3">
      <div className="mb-3 text-xs font-bold tracking-wider text-faint uppercase">
        Сводка
      </div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent text-muted-foreground inset-ring inset-ring-border">
          <RiFileList2Line />
        </span>
        <div
          className={cn(
            "text-sm leading-tight",
            form.title
              ? "font-semibold text-foreground"
              : "font-medium text-faint",
          )}
        >
          {form.title || "Новая услуга"}
        </div>
      </div>
      <dl className="m-0">
        <Row
          label="Категории"
          value={categoryCount || "—"}
          muted={!categoryCount}
        />
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
      {attach && (
        <div
          className="mt-3 pt-2.5"
          style={{ borderTop: "1px dashed var(--border)" }}
        >
          <div className="mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wider text-accent-text uppercase">
            <span className="size-1.5 rounded-full bg-primary" />
            Подключение
          </div>
          <div className="text-sm font-semibold">{attach.companyAlias}</div>
          <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            с {formatCalendarDate(attach.isActiveSince) || "сегодня"} ·{" "}
            {attach.customerApprovalRequired
              ? attach.subdivisionApprovalRequired
                ? "согласование с клиентом, по филиалам"
                : "согласование с клиентом"
              : "без согласования"}
          </div>
        </div>
      )}
    </aside>
  );
};

export default Summary;
