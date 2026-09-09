import type { ReactNode } from "react";
import { RiCheckLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

export type ChoiceOption = {
  value: string;
  label: ReactNode;
  /** Вторая строка варианта — пояснение, 12 px, приглушённое. */
  hint?: ReactNode;
  disabled?: boolean;
};

type BaseProps = {
  id?: string;
  ariaLabel?: string;
  /** id заголовка вопроса — у группы нет своего `<label htmlFor>`. */
  ariaLabelledBy?: string;
  options: readonly ChoiceOption[];
  /**
   * `2` — две колонки всегда (пара коротких вариантов: «Да / Нет»);
   * `"auto"` — две от `sm` (широкая сетка формы сотрудника), на телефоне одна.
   */
  columns?: 1 | 2 | "auto";
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: string | null;
  onChange: (value: string) => void;
};

type MultiProps = BaseProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
};

/**
 * Видимый выбор — варианты строками, а не за раскрытием списка. Один
 * (`radio`) или несколько (`checkbox`); вся строка — цель нажатия не ниже
 * 44 px, выбранное окрашено как активный сегмент (`app/Segmented`).
 *
 * Не `Segmented`: тот держит 2–4 коротких значения в одну строку и не
 * переносит; здесь варианты — фразы, до шести, столбиком. От семи вариантов
 * или для набора-данных — `app/Combobox` (гайд, «Раскладка полей»).
 *
 * Повторный клик по выбранному варианту одиночного выбора ничего не делает:
 * обязательный вопрос нельзя «разответить», а необязательный начинается
 * пустым. appearance/border/bg гасят дефолты кнопки — preflight выключен.
 */
const ChoiceGroup = (props: SingleProps | MultiProps) => {
  const {
    id,
    ariaLabel,
    ariaLabelledBy,
    options,
    columns = 1,
    invalid = false,
    disabled = false,
    className,
  } = props;

  const isChecked = (value: string) =>
    props.multiple ? props.value.includes(value) : props.value === value;

  const pick = (value: string) => {
    if (props.multiple) {
      const next = props.value.includes(value)
        ? props.value.filter((item) => item !== value)
        : [...props.value, value];
      // Порядок — как у вариантов: ответ читается одинаково в форме, на
      // карточке и в письме независимо от того, в каком порядке нажимали
      props.onChange(
        options
          .map((option) => option.value)
          .filter((option) => next.includes(option)),
      );
    } else if (props.value !== value) {
      props.onChange(value);
    }
  };

  return (
    <div
      id={id}
      role={props.multiple ? "group" : "radiogroup"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-invalid={invalid || undefined}
      className={cn(
        "grid gap-2",
        columns === 2 && "grid-cols-2",
        columns === "auto" && "sm:grid-cols-2",
        className,
      )}
    >
      {options.map((option) => {
        const checked = isChecked(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={props.multiple ? "checkbox" : "radio"}
            aria-checked={checked}
            disabled={disabled || option.disabled}
            onClick={() => pick(option.value)}
            className={cn(
              "flex min-h-11 w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border border-input bg-transparent px-3 py-2 text-left text-sm text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              checked &&
                "border-primary/40 bg-primary/15 text-accent-text hover:bg-primary/20",
              invalid && !checked && "border-destructive",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-4.5 flex-none place-items-center border bg-background",
                props.multiple
                  ? "rounded-[4px] border-input"
                  : "rounded-full border-faint",
                checked &&
                  (props.multiple
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary"),
              )}
            >
              {checked &&
                (props.multiple ? (
                  <RiCheckLine className="size-3.5" />
                ) : (
                  <span className="size-2 rounded-full bg-primary" />
                ))}
            </span>
            <span className="min-w-0 flex-1">
              {option.label}
              {option.hint && (
                <span className="block text-xs text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default ChoiceGroup;
