import type { ReactNode } from "react";

import { RiCloseLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Баннер уровня оболочки (над контентом на канве): версия приложения, сервисные
// оповещения и прочие сквозные сообщения. Согласованный макет (Вариант A):
// НЕПРОЗРАЧНАЯ карточка-«лист» — читаема поверх любых обоев пользователя, —
// плитка-иконка в тон, заголовок, подзаголовок, действие и крестик.
type Tone = "warning" | "danger" | "info" | "success";

// Тон несёт только плитка-иконка; сама карточка нейтральная (bg-card).
const TILE: Record<Tone, string> = {
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
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
        // fixed-слой поверх статики (см. docs/ux-ui-guide.md). Непрозрачный
        // bg-card делает текст читаемым поверх любых обоев.
        "relative flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm",
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
