import type { IconType } from "react-icons";
import { RiComputerLine, RiMoonLine, RiSunLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Сегмент темы на три состояния (light/dark/system) — общий для страницы
// «Мой аккаунт» и футера мобильного бургер-меню. Смену темы выполняет
// вызывающий (обычно setTheme из ThemeContext + reload до эндшпиля миграции).
// satisfies проверяет форму опций (value — реальная тема, Icon — иконка),
// сохраняя литеральные value для потребителей.
type ThemeValue = "light" | "dark" | "system";

export const THEME_OPTIONS = [
  { value: "light", label: "Светлая", Icon: RiSunLine },
  { value: "dark", label: "Тёмная", Icon: RiMoonLine },
  { value: "system", label: "Системная", Icon: RiComputerLine },
] as const satisfies readonly {
  value: ThemeValue;
  label: string;
  Icon: IconType;
}[];

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
        "inline-flex gap-0.5 rounded-lg border border-input bg-background p-0.5",
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
            "inline-flex flex-1 cursor-pointer appearance-none items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
            theme === value &&
              "bg-primary/15 text-accent-text hover:text-accent-text",
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
