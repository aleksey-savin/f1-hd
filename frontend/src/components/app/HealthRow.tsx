import type { ReactNode } from "react";

import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRadioButtonLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

// Строка состояния внешнего канала внутри панели настроек: иконка · фраза
// состояния · приглушённая подсказка · действие справа. Живёт постоянно, а не
// появляется после нажатия — её наполняют фоновые процессы (крон сбора почты,
// реальные отправки уведомлений) и кнопка проверки.
//
// Канон «Статус, который протухает, — предложение, а не бейдж» (ux-ui-guide):
// цветом красим только иконку и само состояние, дату и детали — muted.

export type HealthState = "ok" | "error" | "warning" | "busy" | "idle";

const TONE: Record<HealthState, string> = {
  ok: "tw:text-accent-text",
  error: "tw:text-destructive",
  warning: "tw:text-warning",
  busy: "tw:text-muted-foreground",
  idle: "tw:text-faint",
};

const ICON: Record<HealthState, typeof RiCheckLine> = {
  ok: RiCheckLine,
  error: RiErrorWarningLine,
  warning: RiErrorWarningLine,
  busy: RiLoader4Line,
  idle: RiRadioButtonLine,
};

const HealthRow = ({
  state = "idle",
  title,
  /** Дата/детали справа от состояния — тем же предложением, но приглушённо. */
  meta,
  hint,
  action,
  className,
}: {
  state?: HealthState;
  title: ReactNode;
  meta?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) => {
  const Icon = ICON[state];

  return (
    <div
      className={cn(
        "tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:bg-foreground/[0.03] tw:px-5 tw:py-3.5",
        "tw:max-md:flex-wrap",
        className,
      )}
    >
      <Icon
        aria-hidden
        size={20}
        className={cn(
          "tw:flex-none",
          TONE[state],
          state === "busy" && "tw:animate-spin",
        )}
      />
      <div className="tw:min-w-0">
        <div className="tw:text-[0.9375rem]">
          <span className={cn("tw:font-semibold", TONE[state])}>{title}</span>
          {meta && <span className="tw:text-muted-foreground">{meta}</span>}
        </div>
        {hint && (
          <div className="tw:mt-0.5 tw:text-sm tw:text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      {action && (
        <div className="tw:ms-auto tw:flex-none tw:max-md:ms-0 tw:max-md:w-full tw:max-md:[&>button]:w-full">
          {action}
        </div>
      )}
    </div>
  );
};

export default HealthRow;
