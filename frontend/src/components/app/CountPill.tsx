import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Число-пилюля: непрочитанное в строке «Диалогов», счётчик «Ждут ответа» у
 * пункта меню «Диалоги». Бирюзовая подложка и читаемая бирюза текста — тот же
 * язык, что у включённого чипа (канва «Омниканальные диалоги», A1).
 */
const CountPill = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-md bg-primary/15 px-1.5 text-xs font-semibold text-accent-text tabular-nums",
      className,
    )}
  >
    {children}
  </span>
);

export default CountPill;
