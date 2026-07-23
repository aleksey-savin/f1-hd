import { cn } from "@/lib/utils";
import { monogramFor } from "@/components/app/monogram";
import { SCHEDULE_DAYS } from "@/components/app/ScheduleEditor";

import { plural } from "../../util/plural";

// Живая сводка мастера компании: наполняется по мере прохождения шагов
// (reached — максимально достигнутый шаг), незаданное — «—».
const SHORT_DAYS = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

const scheduleLabel = (schedule) => {
  const working = SCHEDULE_DAYS.filter(
    ([, key]) => schedule?.[key]?.isWorking,
  ).map(([, key]) => SHORT_DAYS[key]);
  if (working.length === 0) return "Не задан";
  if (working.length === 7) return "Ежедневно";
  return working.join(", ");
};

const domainsCount = (value) =>
  String(value || "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean).length;

const Row = ({ label, value, muted }) => (
  <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:text-sm tw:first:border-t-0">
    <dt className="tw:flex-none tw:text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "tw:m-0 tw:min-w-0 tw:truncate tw:text-right tw:font-semibold tw:tabular-nums",
        muted ? "tw:font-normal tw:text-faint" : "tw:text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
);

const FormSummary = ({ form, phones, responsibles, schedule, reached }) => {
  const domains = domainsCount(form.emailDomains);
  const phoneCount = phones.filter((phone) => phone.value?.trim()).length;
  const showContacts = reached >= 1;
  const showSchedule = reached >= 2;
  const scheduleText = scheduleLabel(schedule);

  return (
    <aside className="tw:rounded-xl tw:border tw:border-border tw:bg-accent/40 tw:p-4 tw:md:sticky tw:md:top-3">
      <div className="tw:mb-3 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        Сводка
      </div>
      <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2.5">
        <span className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-accent tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
          {monogramFor(form.alias) || "?"}
        </span>
        <div
          className={cn(
            "tw:text-sm tw:leading-tight",
            form.alias
              ? "tw:font-semibold tw:text-foreground"
              : "tw:font-medium tw:text-faint",
          )}
        >
          {form.alias || "Новая компания"}
        </div>
      </div>
      <dl className="tw:m-0">
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
