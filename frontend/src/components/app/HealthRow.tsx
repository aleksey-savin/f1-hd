import type { ReactNode } from "react";

import {
  RiCheckLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoader4Line,
  RiRadioButtonLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

// Полоса примечания в панели настроек: иконка · фраза · приглушённая деталь ·
// подсказка · действие справа. Два назначения, одна геометрия:
//
//  • СОСТОЯНИЕ ВНЕШНЕГО КАНАЛА (ok/error/warning/busy/idle) — живёт постоянно,
//    а не появляется после нажатия: его наполняют фоновые процессы (крон сбора
//    почты, реальные отправки уведомлений) и кнопка проверки;
//  • ПОЯСНЕНИЕ (info) — «выключенный модуль скрывает свои разделы», «канал
//    отключён администратором». Раньше такие сообщения рисовались тремя
//    разными способами: заливной плашкой, стопкой жёлтых алертов и подписью
//    внутри строки состояния.
//
// Канон «Статус, который протухает, — предложение, а не бейдж» (ux-ui-guide):
// цветом красим только иконку и саму фразу, дату и детали — muted.

type HealthState = "ok" | "error" | "warning" | "busy" | "idle" | "info";

const TONE: Record<HealthState, string> = {
  ok: "text-accent-text",
  error: "text-destructive",
  warning: "text-warning",
  busy: "text-muted-foreground",
  idle: "text-faint",
  info: "text-muted-foreground",
};

const ICON: Record<HealthState, typeof RiCheckLine> = {
  ok: RiCheckLine,
  error: RiErrorWarningLine,
  warning: RiErrorWarningLine,
  busy: RiLoader4Line,
  idle: RiRadioButtonLine,
  info: RiInformationLine,
};

const HealthRow = ({
  state = "idle",
  title,
  /**
   * Один факт «когда» справа от фразы — тем же предложением, но приглушённо.
   * Разделитель ставит сама строка: вызывающий отдаёт чистый текст, иначе он
   * расходится от места к месту (так и было — у календаря его не было вовсе).
   * Всё, что не про «когда», уходит в hint.
   */
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
        <div className="text-sm">
          <span className={cn("font-semibold", TONE[state])}>{title}</span>
          {meta && <span className="text-muted-foreground"> · {meta}</span>}
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
