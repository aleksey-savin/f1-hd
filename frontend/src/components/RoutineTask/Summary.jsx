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
  <div className="tw:flex tw:gap-3 tw:border-t tw:border-border-soft tw:py-2 tw:first:border-t-0 tw:first:pt-0">
    <span className="tw:flex-none tw:text-xs tw:text-faint">{label}</span>
    <span
      className={
        accent
          ? "tw:ml-auto tw:text-right tw:text-sm tw:font-medium tw:text-accent-text"
          : "tw:ml-auto tw:text-right tw:text-sm tw:text-foreground"
      }
    >
      {value}
    </span>
  </div>
);

const Summary = ({ form, cronSchedule, checklistCount = 0, reached = 0 }) => {
  return (
    <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-4">
      <div className="tw:mb-2.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
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
                    .map((r) => `${r.lastName || ""} ${r.firstName || ""}`.trim())
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
