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
  warning: "tw:bg-warning/15 tw:text-warning",
  danger: "tw:bg-destructive/15 tw:text-destructive",
  info: "tw:bg-info/15 tw:text-info",
  success: "tw:bg-success/15 tw:text-success",
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
        // tw:relative обязателен: баннер лежит на канве, а фоновая картинка —
        // fixed-слой поверх статики (см. docs/ux-ui-guide.md). Непрозрачный
        // bg-card делает текст читаемым поверх любых обоев.
        "tw:relative tw:flex tw:flex-wrap tw:items-center tw:gap-x-3.5 tw:gap-y-2.5 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-3.5 tw:py-3 tw:shadow-sm",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-xl tw:text-lg",
            TILE[tone],
          )}
        >
          {icon}
        </span>
      )}
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:text-sm tw:font-semibold tw:text-foreground">
          {title}
        </div>
        {children && (
          <div className="tw:mt-0.5 tw:text-sm tw:text-muted-foreground">
            {children}
          </div>
        )}
      </div>
      {action && (
        // На узких экранах действие переносится под текст на всю ширину
        <div className="tw:flex-none tw:max-md:order-last tw:max-md:w-full">
          {action}
        </div>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Скрыть"
          className="tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:focus:outline-none"
        >
          <RiCloseLine className="tw:size-4" />
        </button>
      )}
    </div>
  );
};

export default AppBanner;
