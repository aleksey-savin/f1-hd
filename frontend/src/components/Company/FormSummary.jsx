import { cn } from "@/lib/utils";
import { SCHEDULE_DAYS } from "@/components/app/ScheduleEditor";

import CompanyLogo from "./CompanyLogo";

import { plural } from "../../util/plural";

// Живая сводка мастера компании: наполняется по мере прохождения шагов
// (reached — максимально достигнутый шаг), незаданное — «—».
const scheduleLabel = (schedule) => {
  const working = SCHEDULE_DAYS.filter(
    ([, key]) => schedule?.[key]?.isWorking,
  ).map(([, , short]) => short);
  if (working.length === 0) return "Не задан";
  if (working.length === 7) return "Ежедневно";
  return working.join(", ");
};

const Row = ({ label, value, muted }) => (
  <div className="flex items-baseline justify-between gap-3 border-t border-border-soft py-2.5 text-sm first:border-t-0">
    <dt className="flex-none text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "m-0 min-w-0 truncate text-right font-semibold tabular-nums",
        muted ? "font-normal text-faint" : "text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
);

const FormSummary = ({
  form,
  phones,
  domains: domainRows = [],
  responsibles,
  schedule,
  reached,
}) => {
  const domains = domainRows.filter((row) => row.value?.trim()).length;
  const phoneCount = phones.filter((phone) => phone.value?.trim()).length;
  const showContacts = reached >= 1;
  const showSchedule = reached >= 2;
  const scheduleText = scheduleLabel(schedule);

  return (
    <aside className="rounded-xl border border-border bg-accent/40 p-4 md:sticky md:top-3">
      <div className="mb-3 text-xs font-bold tracking-wider text-faint uppercase">
        Сводка
      </div>
      <div className="mb-3 flex items-center gap-2.5">
        <CompanyLogo sizeClass="size-10" glyphSize={18} />
        <div
          className={cn(
            "text-sm leading-tight",
            form.alias
              ? "font-semibold text-foreground"
              : "font-medium text-faint",
          )}
        >
          {form.alias || "Новая компания"}
        </div>
      </div>
      <dl className="m-0">
        <Row label="Домены" value={domains || "—"} muted={!domains} />
        <Row
          label="Ответственные"
          value={
            responsibles.length
              ? `${responsibles.length} ${plural(responsibles.length, "человек", "человека", "человек")}`
              : "—"
          }
          muted={!responsibles.length}
        />
        <Row
          label="Телефоны"
          value={showContacts && phoneCount ? phoneCount : "—"}
          muted={!showContacts || !phoneCount}
        />
        <Row
          label="Адрес"
          value={showContacts && form.address ? form.address : "—"}
          muted={!showContacts || !form.address}
        />
        <Row
          label="График"
          value={showSchedule ? scheduleText : "—"}
          muted={!showSchedule || scheduleText === "Не задан"}
        />
      </dl>
    </aside>
  );
};

export default FormSummary;
