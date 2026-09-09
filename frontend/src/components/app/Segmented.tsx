import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SegmentOption = {
  value: string;
  label: string;
  /**
   * Число рядом с подписью — «сколько в этом наборе». Заводится там, где
   * сегмент переключает СРЕЗЫ данных и счётчик отвечает на вопрос, не открывая
   * срез («19 без ответственного» на главной). Для наборов, у которых числа
   * нет или оно ничего не значит, проп просто не передают.
   */
  count?: number;
  icon?: ReactNode;
  /**
   * Гасит ОДИН сегмент. Само погасшее состояние и есть сообщение «этой дороги
   * нет» — отдельный абзац-предупреждение рядом не нужен, причину кладём в
   * `title`.
   */
  disabled?: boolean;
  title?: string;
};

// Сегмент-контрол (single-select) — общий стиль с выбором темы: активный сегмент
// bg-primary/15 + accent-text. Для выбора из нескольких взаимоисключающих
// значений (тип тарификации, метод учёта, тип расположения). `stacked` —
// иконка над подписью (компактно для 4–5 вариантов с иконками, влезает и на
// мобайле); `compact` — плотный кегль для телефона; `fit` — ширина сегментов по
// содержимому (подписи разной длины равными долями переносятся на две строки);
// `count` у опции — число набора рядом с подписью. appearance/border/bg гасят
// дефолты кнопки (preflight выключен).
const Segmented = ({
  options,
  value,
  onChange,
  ariaLabel,
  stacked = false,
  compact = false,
  fit = false,
  disabled = false,
  className,
}: {
  options: readonly SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  stacked?: boolean;
  /**
   * Плотный вариант для телефона: кегль 12 и узкие поля. Три подписи со
   * счётчиками («Не назначены 19») в 360 px обычным кеглем не встают.
   */
  compact?: boolean;
  /**
   * Ширина сегментов по содержимому, а не равными долями. Нужен там, где
   * подписи разной длины: «На мне 4 | Без ответственного 4 | Давно без
   * движения» равными третями ломались на две строки.
   */
  fit?: boolean;
  /** Гасит группу целиком — как disabled у поля в выключенной секции настроек. */
  disabled?: boolean;
  className?: string;
}) => {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-0.5 rounded-lg border border-input bg-transparent p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled || option.disabled}
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
            // Ширина сегмента: по умолчанию равные доли — они и нужны там, где
            // подписи одной длины («Активные | Архив»). `fit` — по содержимому:
            // ширину контрола браузер берёт как СУММУ подписей, а равные доли
            // делит поровну, и длинная подпись ломается на две строки.
            fit ? "flex-auto whitespace-nowrap" : "flex-1",
            // Не pointer-events-none: погасший сегмент должен показывать `title`
            // с причиной, а событий он и так не получает — кнопка нативно
            // disabled. Гасим только подсветку под курсором.
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground",
            stacked
              ? "flex-col gap-1 px-1.5 py-2 text-center text-xs leading-tight"
              : compact
                ? "gap-1 px-2 py-2 text-xs"
                : "gap-1.5 px-3 py-2 text-sm",
            value === option.value &&
              "bg-primary/15 text-accent-text hover:text-accent-text",
          )}
        >
          {option.icon}
          {option.label}
          {option.count != null && (
            <span
              className={cn(
                "font-semibold tabular-nums",
                value === option.value ? "text-accent-text" : "text-faint",
              )}
            >
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default Segmented;
