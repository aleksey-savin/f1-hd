import type { ReactNode } from "react";

import ChoiceGroup from "@/components/app/ChoiceGroup";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  type CustomFieldDef,
  errorKeyOf,
  hasOptions,
  inlineChoices,
} from "./custom-fields";

// Ответ на вопрос анкеты — третья роль общего блока «кастомные поля» рядом с
// конструктором (CustomFieldsEditor) и чтением (CustomFieldsView, Answers).
// Контрол выбирает тип вопроса: варианты видны строками (app/ChoiceGroup),
// пока их не больше INLINE_CHOICE_MAX, дальше — Combobox; «Да / Нет» — две
// строки в два столбца; число — Input; дата — app/DateField.
//
// Два вида блока: `field` — обычное поле формы (app/Field, форма сотрудника),
// `question` — блок анкеты заявителя: вопрос заголовком секции, подсказка под
// ним, контрол ниже (макет 09.09).

const YES_NO = [
  { value: "true", label: "Да" },
  { value: "false", label: "Нет" },
];

const BOOLEAN_TO_CHOICE = (value: unknown) =>
  value === true ? "true" : value === false ? "false" : null;

const toChoiceOptions = (options: string[] = []) =>
  options.map((option) => ({ value: option, label: option }));

type ControlProps = {
  field: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  labelId: string;
  invalid: boolean;
  /** Сетка формы сотрудника: варианты в два столбца от `sm`. */
  wide?: boolean;
};

/** Управляет ли вопросом группа кнопок (ей нужен aria-labelledby, а не htmlFor). */
export const isChoiceControl = (field: CustomFieldDef) =>
  field.type === "boolean" || inlineChoices(field);

const Control = ({
  field,
  value,
  onChange,
  id,
  labelId,
  invalid,
  wide = false,
}: ControlProps) => {
  const options = field.options ?? [];

  switch (field.type) {
    case "boolean":
      return (
        <ChoiceGroup
          id={id}
          ariaLabelledBy={labelId}
          options={YES_NO}
          columns={2}
          value={BOOLEAN_TO_CHOICE(value)}
          onChange={(next) => onChange(next === "true")}
          invalid={invalid}
        />
      );
    case "select":
      return inlineChoices(field) ? (
        <ChoiceGroup
          id={id}
          ariaLabelledBy={labelId}
          options={toChoiceOptions(options)}
          columns={wide ? "auto" : 1}
          value={typeof value === "string" && value ? value : null}
          onChange={onChange}
          invalid={invalid}
        />
      ) : (
        <Combobox
          id={id}
          value={typeof value === "string" && value ? value : null}
          onChange={(next) => onChange(next ?? "")}
          options={toChoiceOptions(options)}
          placeholder="Выберите вариант"
          clearable
        />
      );
    case "multiselect":
      return inlineChoices(field) ? (
        <ChoiceGroup
          multiple
          id={id}
          ariaLabelledBy={labelId}
          options={toChoiceOptions(options)}
          columns={wide ? "auto" : 1}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          invalid={invalid}
        />
      ) : (
        <MultiCombobox
          id={id}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          options={toChoiceOptions(options)}
          placeholder="Выберите варианты"
        />
      );
    case "number":
      // Пока печатают — сырая строка («1,» или «-»), число из неё делает
      // сервер; Input с type=number съедал бы недописанное
      return (
        <Input
          id={id}
          inputMode="decimal"
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
        />
      );
    case "date":
      return (
        <DateField
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(next) => onChange(next || null)}
          invalid={invalid}
        />
      );
    default:
      return (
        <Input
          id={id}
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
        />
      );
  }
};

export type CustomFieldInputProps = {
  field: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  error?: ReactNode;
  variant?: "field" | "question";
  wide?: boolean;
  className?: string;
};

const CustomFieldInput = ({
  field,
  value,
  onChange,
  id,
  error,
  variant = "field",
  wide = false,
  className,
}: CustomFieldInputProps) => {
  const labelId = `${id}-label`;
  const control = (
    <Control
      field={field}
      value={value}
      onChange={onChange}
      id={id}
      labelId={labelId}
      invalid={!!error}
      wide={wide}
    />
  );

  if (variant === "field") {
    return (
      <Field
        label={<span id={labelId}>{field.name}</span>}
        htmlFor={isChoiceControl(field) ? undefined : id}
        required={!!field.required}
        hint={field.hint || undefined}
        error={error}
        className={className}
      >
        {control}
      </Field>
    );
  }

  return (
    <QuestionBlock
      id={id}
      labelId={labelId}
      title={field.name}
      required={!!field.required}
      hint={field.hint}
      error={error}
      heading={isChoiceControl(field)}
      className={className}
    >
      {control}
    </QuestionBlock>
  );
};

export default CustomFieldInput;

/**
 * Блок анкеты заявителя: анатомия секции формы (app/FormLayout) — заголовок
 * вопроса, подсказка, контрол. Подсказка остаётся над контролом и при
 * ошибке: ошибка встаёт под контролом, они не спорят за одно место.
 *
 * Заголовок — `<label htmlFor>` к одиночному контролу; `heading` — когда
 * контрол групповой (варианты кнопками, редактор): тогда `<h3 id>` и
 * `aria-labelledby` на группе.
 */
export const QUESTION_BLOCK =
  "border-t border-border-soft py-5 first:border-t-0 first:pt-1";

export const QuestionBlock = ({
  id,
  labelId,
  title,
  required = false,
  hint,
  error,
  heading = false,
  className,
  children,
}: {
  id?: string;
  labelId?: string;
  title: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  heading?: boolean;
  className?: string;
  children: ReactNode;
}) => {
  const label = (
    <>
      {title}
      {required && <span className="text-destructive">*</span>}
    </>
  );
  return (
    <section className={cn(QUESTION_BLOCK, className)}>
      {heading || !id ? (
        <h3
          id={labelId}
          className="my-0 text-base font-semibold tracking-tight"
        >
          {label}
        </h3>
      ) : (
        <label
          id={labelId}
          htmlFor={id}
          className="my-0 block text-base font-semibold tracking-tight"
        >
          {label}
        </label>
      )}
      {hint && (
        <p className="mt-0.5 mb-0 text-sm text-muted-foreground">{hint}</p>
      )}
      <div className="mt-4">{children}</div>
      {error && (
        <p role="alert" className="mt-1.5 mb-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
};

/**
 * Все вопросы формы разом. `column` — анкета заявителя, вопрос за вопросом;
 * `grid` — сетка формы сотрудника: два поля в ряд, вопрос с видимыми
 * вариантами на обе колонки, короткие поля заполняют места рядом с широкими
 * (`grid-flow-dense`), порядок обхода — как в шаблоне.
 */
export const CustomFieldsForm = ({
  fields,
  onChange,
  errorOf,
  idPrefix = "ticket-custom",
  layout = "column",
}: {
  fields: CustomFieldDef[];
  onChange: (fields: CustomFieldDef[]) => void;
  errorOf?: (key: string) => ReactNode;
  idPrefix?: string;
  layout?: "column" | "grid";
}) => {
  const patch = (index: number, value: unknown) =>
    onChange(
      fields.map((item, position) =>
        position === index ? { ...item, value } : item,
      ),
    );

  const grid = layout === "grid";
  const items = fields.map((field, index) => {
    const wide = grid && (hasOptions(field.type) || field.type === "boolean");
    return (
      <CustomFieldInput
        key={field.key ?? `${field.name}-${index}`}
        id={`${idPrefix}-${field.key ?? index}`}
        field={field}
        value={field.value}
        onChange={(value) => patch(index, value)}
        error={errorOf?.(errorKeyOf(field))}
        variant={grid ? "field" : "question"}
        wide={wide}
        className={cn(wide && "md:col-span-2")}
      />
    );
  });

  // Колонкой — без обёртки: блоки-вопросы обязаны стоять рядом с соседями по
  // анкете (вводной, описанием, вложениями), иначе `first:` в их рамке
  // считает первым первый вопрос, а не первый блок формы
  return grid ? (
    <div className="grid grid-flow-dense gap-3 md:grid-cols-2">{items}</div>
  ) : (
    items
  );
};
