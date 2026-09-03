import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Строка настройки в панели: (опц. плитка-иконка) · название + подсказка ·
// контрол справа. На узких экранах складывается в столбец, контрол занимает
// всю ширину. Разделитель между соседними строками — prop divider.
// htmlFor связывает название с контролом (`<label>`): клик по подписи
// переключает свитч/чекбокс или фокусирует поле — для строк с одним контролом
// проп обязателен (см. правило «Подпись контрола» в ux-ui-guide).
const SettingRow = ({
  title,
  hint,
  leading,
  htmlFor,
  divider = false,
  className,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** Плитка-иконка слева (например, логотип интеграции). */
  leading?: ReactNode;
  /** id контрола строки — название становится `<label htmlFor>`. */
  htmlFor?: string;
  /** Тонкая линия сверху — между соседними строками. */
  divider?: boolean;
  className?: string;
  children?: ReactNode;
}) => {
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-4",
        "max-md:flex-col max-md:items-stretch max-md:gap-3",
        divider && "border-t border-border-soft",
        className,
      )}
    >
      {leading && (
        <span
          aria-hidden
          className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border max-md:hidden"
        >
          {leading}
        </span>
      )}
      <div className="min-w-0">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="block cursor-pointer text-sm font-semibold"
          >
            {title}
          </label>
        ) : (
          <div className="text-sm font-semibold">{title}</div>
        )}
        {hint && (
          <div className="mt-0.5 text-sm text-muted-foreground">{hint}</div>
        )}
      </div>
      {children && (
        <div className="ms-auto flex-none max-md:ms-0">{children}</div>
      )}
    </div>
  );
};

export default SettingRow;
