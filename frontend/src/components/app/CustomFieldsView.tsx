import type { ReactNode } from "react";

import { Eyebrow, Panel } from "@/components/app/Panel";

// Просмотр кастомных полей (форма-опросник). Общий компонент: одинаково
// показывает поля на карточке шаблона и заявки — пользователь не должен
// видеть одну и ту же структуру в разном виде.
type CustomField = {
  name?: string;
  type?: string;
  options?: string[];
  value?: unknown;
};

const TYPE_LABEL: Record<string, string> = {
  text: "Текст",
  select: "Выбор",
  multiselect: "Множественный выбор",
};

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
                <div className="min-w-48 flex-1 text-base font-medium">
                  {field.name || "—"}
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
