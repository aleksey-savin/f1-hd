import type { ReactNode } from "react";

import { RiCloseLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Баннер уровня оболочки (первым элементом страницы): версия приложения,
// сервисные оповещения и прочие сквозные сообщения. Карточка с плиткой-иконкой
// в тон, заголовком, подзаголовком, действием и — если задан `onDismiss` —
// крестиком.
type Tone = "warning" | "danger" | "info" | "success";

// Тон несёт и плитка-иконка, и мягкая заливка карточки: баннер живёт внутри
// «листа» страницы, у которого тот же bg-card, — нейтральная карточка с ним
// сливалась. Заливка в языке тональных алертов (components/ui/alert.tsx).
const SURFACE: Record<Tone, string> = {
  warning: "border-warning/30 bg-warning/10",
  danger: "border-destructive/30 bg-destructive/10",
  info: "border-info/30 bg-info/10",
  success: "border-success/30 bg-success/10",
};

const TILE: Record<Tone, string> = {
  warning: "bg-warning/25 text-warning",
  danger: "bg-destructive/25 text-destructive",
  info: "bg-info/25 text-info",
  success: "bg-success/25 text-success",
};

const AppBanner = ({
  tone = "warning",
  icon,
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title: ReactNode;
  /** Подзаголовок-пояснение под заголовком. */
  children?: ReactNode;
  /** Правое действие (обычно `Button size="sm"`). */
  action?: ReactNode;
  /** Если задан — показывается крестик «скрыть». */
  onDismiss?: () => void;
  className?: string;
}) => {
  return (
    <div
      role="alert"
      className={cn(
        // relative обязателен: баннер лежит на канве, а фоновая картинка —
        // fixed-слой поверх статики (см. docs/ux-ui-guide.md).
        "relative flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border px-3.5 py-3 shadow-sm",
        SURFACE[tone],
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "grid size-10 flex-none place-items-center rounded-xl text-lg",
            TILE[tone],
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {children && (
          <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>
        )}
      </div>
      {action && (
        // На узких экранах действие переносится под текст на всю ширину
        <div className="flex-none max-md:order-last max-md:w-full">
          {action}
        </div>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Скрыть"
          className="grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 focus:outline-none"
        >
          <RiCloseLine className="size-4" />
        </button>
      )}
    </div>
  );
};

export default AppBanner;
