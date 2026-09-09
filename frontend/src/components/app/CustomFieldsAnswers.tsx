import type { ReactNode } from "react";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";

import { type CustomFieldDef, formatAnswer } from "./custom-fields";

// Ответы на вопросы анкеты на карточке заявки: вопрос → ответ. Отдельно от
// CustomFieldsView (тот показывает определение вопроса — тип и варианты —
// на карточке шаблона): данные разные, и один компонент с режимом читался бы
// хуже, чем два с именами. Пустой ответ — общий «—».
const CustomFieldsAnswers = ({
  fields = [],
  label = "Ответы",
  id,
}: {
  fields?: CustomFieldDef[];
  label?: ReactNode;
  /** Якорь для рейла карточки. */
  id?: string;
}) => {
  if (fields.length === 0) return null;

  return (
    <>
      <Eyebrow id={id} count={fields.length}>
        {label}
      </Eyebrow>
      <Panel>
        <div className="grid gap-3">
          {fields.map((field, index) => {
            const answer = formatAnswer(field);
            return (
              <div
                key={field.key ?? index}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-soft pt-3 first:border-t-0 first:pt-0"
              >
                <span className="w-48 flex-none text-sm text-muted-foreground">
                  {field.name || "—"}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm",
                    answer ? "font-medium" : "text-faint",
                  )}
                >
                  {answer || "—"}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
};

export default CustomFieldsAnswers;
