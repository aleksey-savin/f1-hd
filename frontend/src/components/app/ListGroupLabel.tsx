import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Uppercase-метка группы списка со счётчиком — язык статус-борда,
// перенесённый на справочники (согласованный макет).
//
// Тона: `on` — бирюза активной группы, `off` — гаснущая (отключённые,
// закрытые); `warn` и `muted` — группы по состоянию у заявок: янтарные ждут
// человека, «в работе» приглушена — тот же каталог тонов, что у строки
// (Ticket/ticket-state).
const TONE_CLASS = {
  on: "text-accent-text",
  warn: "text-warning-text",
  muted: "text-muted-foreground",
  off: "text-faint",
};

const ListGroupLabel = ({
  label,
  count,
  tone = "on",
  className,
}: {
  label: ReactNode;
  count?: number;
  tone?: keyof typeof TONE_CLASS;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-5 pt-5 pb-2.5 text-base font-semibold tracking-widest uppercase",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
      {count !== undefined && (
        <span className="font-semibold tracking-normal text-faint tabular-nums">
          · {count}
        </span>
      )}
    </div>
  );
};

export default ListGroupLabel;
