import type { ReactNode } from "react";

import { Eyebrow, Panel } from "@/components/app/Panel";

import { type CustomFieldDef as CustomField, TYPE_LABEL } from "./custom-fields";

// Просмотр определений вопросов анкеты — карточка шаблона: тип, варианты,
// обязательность и подсказка. Ответы на карточке заявки показывает
// CustomFieldsAnswers — там важны значения, а не устройство вопроса.

const CustomFieldsView = ({
  fields = [],
  label = "Поля формы",
  emptyText,
}: {
  fields?: CustomField[];
  label?: ReactNode;
  /** Если задан — секция показывается даже пустой с этим текстом; иначе скрыта. */
  emptyText?: ReactNode;
}) => {
  if (fields.length === 0 && !emptyText) return null;

  return (
    <>
      <Eyebrow count={fields.length}>{label}</Eyebrow>
      <Panel>
        {fields.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          <div className="grid gap-3">
            {fields.map((field, index) => (
              <div
                key={index}
                className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-border-soft pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-48 flex-1">
                  <div className="text-base font-medium">
                    {field.name || "—"}
                    {field.required && (
                      <span className="text-destructive">*</span>
                    )}
                  </div>
                  {field.hint && (
                    <div className="text-sm text-muted-foreground">
                      {field.hint}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full border border-border bg-accent px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    {TYPE_LABEL[field.type ?? "text"] ?? field.type}
                  </span>
                  {(field.options ?? []).map((option, optionIndex) => (
                    <span
                      key={optionIndex}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {option}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
};

export default CustomFieldsView;
