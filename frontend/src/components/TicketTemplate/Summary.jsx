import { RiFileList3Line } from "react-icons/ri";

import { cn } from "@/lib/utils";
import { DESCRIPTION_MODE_LABEL } from "@/components/app/custom-fields";
import { plural } from "../../util/plural";

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
  const requiredCount = (form.customFields ?? []).filter(
    (field) => field.required,
  ).length;
  const checklistCount = form.checklist?.length ?? 0;
  const showFields = reached >= 1;
  const showChecklist = reached >= 2;
  const showAccess = reached >= 3;

  return (
    <aside className="rounded-xl border border-border bg-accent/40 p-4 md:sticky md:top-3">
      <div className="mb-3 text-xs font-bold tracking-wider text-faint uppercase">
        Сводка
      </div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent text-muted-foreground inset-ring inset-ring-border [&_svg]:size-5">
          <RiFileList3Line />
        </span>
        <div
          className={cn(
            "text-sm leading-tight",
            form.title
              ? "font-semibold text-foreground"
              : "font-medium text-faint",
          )}
        >
          {form.title || "Новый шаблон"}
        </div>
      </div>
      <dl className="m-0">
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
          label="Описание"
          value={
            showFields
              ? (DESCRIPTION_MODE_LABEL[form.descriptionMode] ?? "Обязательно")
              : "—"
          }
          muted={!showFields}
        />
        <Row
          label="Поля формы"
          value={
            showFields && fieldsCount
              ? requiredCount
                ? `${fieldsCount} · ${requiredCount} ${plural(requiredCount, "обязательный", "обязательных", "обязательных")}`
                : fieldsCount
              : "—"
          }
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
