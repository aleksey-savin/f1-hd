import { SCHEDULE_DAYS } from "@/components/app/ScheduleEditor";

import { ACCOUNT_KINDS, WORK_TIME_MODES } from "./permissions-catalog";

// «5/2 · 09:00–18:00» — тот же язык, что в истории версий на карточке
const scheduleLabel = (schedule) => {
  if (!schedule) return null;
  if (schedule.workTimeMode !== "scheduled") {
    return WORK_TIME_MODES.find((mode) => mode.value === schedule.workTimeMode)
      ?.label;
  }
  const working = SCHEDULE_DAYS.map(([, key]) => schedule.week?.[key]).filter(
    (day) => day?.isWorking,
  );
  if (working.length === 0) return "нерабочая неделя";
  const first = working[0];
  const same = working.every(
    (day) => day.start === first.start && day.end === first.end,
  );
  const time = first.is24hours
    ? "круглосуточно"
    : same
      ? `${first.start}–${first.end}`
      : "плавающее время";
  return `${working.length}/${7 - working.length} · ${time}`;
};

// Живая сводка мастера создания пользователя: наполняется по мере прохождения
// шагов, чтобы контекст не терялся при переходе вперёд-назад.
const Row = ({ label, children }) => (
  <div className="flex gap-2 border-t border-border-soft py-1.5 text-sm first:border-t-0">
    <span className="w-24 flex-none text-faint">{label}</span>
    <span className="min-w-0 font-medium">{children}</span>
  </div>
);

const None = ({ children }) => (
  <span className="font-normal text-faint">{children}</span>
);

const FormSummary = ({ form, kind, schedule }) => {
  const name = `${form.lastName || ""} ${form.firstName || ""}`.trim();
  const kindLabel = ACCOUNT_KINDS.find((item) => item.value === kind)?.label;
  const isStaff = kind === "staff";

  const grantedCount = Object.values(form.permissions || {}).filter(
    Boolean,
  ).length;

  return (
    <aside className="rounded-xl border border-border bg-accent p-4">
      <div className="mb-2.5 text-xs font-bold tracking-wider text-faint uppercase">
        Сводка
      </div>
      <Row label="Имя">{name || <None>не заполнено</None>}</Row>
      <Row label="Тип">{kindLabel}</Row>
      <Row label="Почта">{form.email || <None>не заполнена</None>}</Row>
      <Row label="Компания">
        {form.company?.alias || <None>не выбрана</None>}
        {form.subdivision?.name && (
          <span className="text-faint"> · {form.subdivision.name}</span>
        )}
      </Row>
      {isStaff && schedule && (
        <Row label="График">
          {scheduleLabel(schedule) || <None>не задан</None>}
        </Row>
      )}
      {isStaff && (
        <>
          <Row label="Права">
            {form.isAdmin ? (
              <span className="text-accent-text">Администратор</span>
            ) : grantedCount > 0 ? (
              <span className="tabular-nums">{grantedCount} выдано</span>
            ) : (
              <None>не выданы</None>
            )}
          </Row>
          <Row label="Категории">
            {form.categories?.length ? (
              <span className="tabular-nums">{form.categories.length}</span>
            ) : (
              <None>нет</None>
            )}
          </Row>
        </>
      )}
    </aside>
  );
};

export default FormSummary;
