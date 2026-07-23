import { RiFileList3Line } from "react-icons/ri";

import { cn } from "@/lib/utils";
import { plural } from "../../util/plural";

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

const accessLabel = (form) => {
  const parts = [];
  if (form.allowAllStaff) parts.push("Всем сотрудникам");
  const companies = form.sharedCompanies?.length ?? 0;
  const users = form.sharedUsers?.length ?? 0;
  if (companies)
    parts.push(
      `${companies} ${plural(companies, "компания", "компании", "компаний")}`,
    );
  if (users)
    parts.push(
      `${users} ${plural(users, "пользователь", "пользователя", "пользователей")}`,
    );
  return parts.length ? parts.join(" · ") : "Личный";
};

// Живая сводка мастера шаблона: наполняется по мере прохождения шагов
// (reached — максимально достигнутый шаг). Незаданное — «—».
const Summary = ({ form, reached }) => {
  const fieldsCount = form.customFields?.length ?? 0;
  const checklistCount = form.checklist?.length ?? 0;
  const showFields = reached >= 1;
  const showChecklist = reached >= 2;
  const showAccess = reached >= 3;

  return (
    <aside className="tw:rounded-xl tw:border tw:border-border tw:bg-accent/40 tw:p-4 tw:md:sticky tw:md:top-3">
      <div className="tw:mb-3 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        Сводка
      </div>
      <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2.5">
        <span className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border tw:[&_svg]:size-5">
          <RiFileList3Line />
        </span>
        <div
          className={cn(
            "tw:text-sm tw:leading-tight",
            form.title
              ? "tw:font-semibold tw:text-foreground"
              : "tw:font-medium tw:text-faint",
          )}
        >
          {form.title || "Новый шаблон"}
        </div>
      </div>
      <dl className="tw:m-0">
        <Row
          label="Категория"
          value={form.category?.title || "—"}
          muted={!form.category}
        />
        <Row
          label="Компания"
          value={form.company?.alias || "—"}
          muted={!form.company}
        />
        <Row
          label="Поля формы"
          value={showFields && fieldsCount ? fieldsCount : "—"}
          muted={!showFields || !fieldsCount}
        />
        <Row
          label="Чек-лист"
          value={
            showChecklist && checklistCount
              ? `${checklistCount} ${plural(checklistCount, "пункт", "пункта", "пунктов")}`
              : "—"
          }
          muted={!showChecklist || !checklistCount}
        />
        <Row
          label="Доступ"
          value={showAccess ? accessLabel(form) : "—"}
          muted={!showAccess}
        />
      </dl>
    </aside>
  );
};

export default Summary;
