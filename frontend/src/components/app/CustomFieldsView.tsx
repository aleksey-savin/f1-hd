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
          <div className="tw:text-sm tw:text-muted-foreground">{emptyText}</div>
        ) : (
          <div className="tw:grid tw:gap-3">
            {fields.map((field, index) => (
              <div
                key={index}
                className="tw:flex tw:flex-wrap tw:items-start tw:gap-x-3 tw:gap-y-1.5 tw:border-t tw:border-border-soft tw:pt-3 tw:first:border-t-0 tw:first:pt-0"
              >
                <div className="tw:min-w-48 tw:flex-1 tw:text-base tw:font-medium">
                  {field.name || "—"}
                </div>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
                  <span className="tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-muted-foreground">
                    {TYPE_LABEL[field.type ?? "text"] ?? field.type}
                  </span>
                  {(field.options ?? []).map((option, optionIndex) => (
                    <span
                      key={optionIndex}
                      className="tw:rounded-md tw:bg-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted-foreground"
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
