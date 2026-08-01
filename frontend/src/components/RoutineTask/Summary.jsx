import { describeCron } from "@/util/cron";

// Живая сводка мастера регламента: заполняется по мере прохождения шагов
// (незаданное — «—», строки раскрываются по достигнутому шагу).
const pluralItems = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "пункт";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "пункта";
  return "пунктов";
};

const Row = ({ label, value, accent }) => (
  <div className="flex gap-3 border-t border-border-soft py-2 first:border-t-0 first:pt-0">
    <span className="flex-none text-xs text-faint">{label}</span>
    <span
      className={
        accent
          ? "ml-auto text-right text-sm font-medium text-accent-text"
          : "ml-auto text-right text-sm text-foreground"
      }
    >
      {value}
    </span>
  </div>
);

const Summary = ({ form, cronSchedule, checklistCount = 0, reached = 0 }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 text-xs font-bold tracking-wider text-faint uppercase">
        Сводка
      </div>
      <Row label="Тема" value={form.title?.trim() || "—"} />
      {reached >= 0 && (
        <>
          <Row label="Категория" value={form.category?.title || "—"} />
          <Row label="Компания" value={form.company?.alias || "—"} />
          <Row label="Инициатор" value={form.applicant?.firstName || "—"} />
          <Row
            label="Ответственные"
            value={
              form.responsibles?.length
                ? form.responsibles
                    .map((r) =>
                      `${r.lastName || ""} ${r.firstName || ""}`.trim(),
                    )
                    .join(", ")
                : "—"
            }
          />
        </>
      )}
      {reached >= 1 && (
        <>
          <Row label="Расписание" value={describeCron(cronSchedule)} accent />
          <Row
            label="Статус"
            value={form.isActive ? "Активно" : "На паузе"}
            accent={form.isActive}
          />
        </>
      )}
      {reached >= 2 && (
        <Row
          label="Чек-лист"
          value={
            checklistCount > 0
              ? `${checklistCount} ${pluralItems(checklistCount)}`
              : "—"
          }
        />
      )}
    </div>
  );
};

export default Summary;
