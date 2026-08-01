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

type HealthState = "ok" | "error" | "warning" | "busy" | "idle";

const TONE: Record<HealthState, string> = {
  ok: "text-accent-text",
  error: "text-destructive",
  warning: "text-warning",
  busy: "text-muted-foreground",
  idle: "text-faint",
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
        "flex items-center gap-3 border-t border-border-soft bg-foreground/[0.03] px-5 py-3.5",
        "max-md:flex-wrap",
        className,
      )}
    >
      <Icon
        aria-hidden
        size={20}
        className={cn(
          "flex-none",
          TONE[state],
          state === "busy" && "animate-spin",
        )}
      />
      <div className="min-w-0">
        <div className="text-[0.9375rem]">
          <span className={cn("font-semibold", TONE[state])}>{title}</span>
          {meta && <span className="text-muted-foreground">{meta}</span>}
        </div>
        {hint && (
          <div className="mt-0.5 text-sm text-muted-foreground">{hint}</div>
        )}
      </div>
      {action && (
        <div className="ms-auto flex-none max-md:ms-0 max-md:w-full max-md:[&>button]:w-full">
          {action}
        </div>
      )}
    </div>
  );
};

export default HealthRow;
