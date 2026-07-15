import { RiComputerLine, RiMoonLine, RiSunLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Сегмент темы на три состояния (light/dark/system) — общий для страницы
// «Мой аккаунт» и футера мобильного бургер-меню. Смену темы выполняет
// вызывающий (обычно setTheme из ThemeContext + reload до эндшпиля миграции).
export const THEME_OPTIONS = [
  { value: "light", label: "Светлая", Icon: RiSunLine },
  { value: "dark", label: "Тёмная", Icon: RiMoonLine },
  { value: "system", label: "Системная", Icon: RiComputerLine },
] as const;

const ThemeSegment = ({
  theme,
  onChange,
  showLabels = true,
  className,
}: {
  theme: string;
  onChange: (value: string) => void;
  /** false — только иконки (узкие места, например футер бургер-меню). */
  showLabels?: boolean;
  className?: string;
}) => {
  return (
    <div
      role="group"
      aria-label="Тема оформления"
      className={cn(
        "tw:inline-flex tw:gap-0.5 tw:rounded-lg tw:border tw:border-input tw:bg-background tw:p-0.5",
        className,
      )}
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={label}
          onClick={() => onChange(value)}
          // appearance/border/bg — гасим браузерные дефолты кнопки
          // (preflight выключен)
          className={cn(
            "tw:inline-flex tw:flex-1 tw:cursor-pointer tw:appearance-none tw:items-center tw:justify-center tw:gap-1.5 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:font-medium tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            theme === value &&
              "tw:bg-primary/15 tw:text-accent-text tw:hover:text-accent-text",
          )}
        >
          <Icon size={15} aria-hidden />
          {showLabels && label}
        </button>
      ))}
    </div>
  );
};

export default ThemeSegment;
