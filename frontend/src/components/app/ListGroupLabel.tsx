import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Uppercase-метка группы списка со счётчиком — язык статус-борда,
// перенесённый на справочники (согласованный макет).
const ListGroupLabel = ({
  label,
  count,
  tone = "on",
  className,
}: {
  label: ReactNode;
  count?: number;
  tone?: "on" | "off";
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-5 pt-5 pb-2.5 text-base font-semibold tracking-widest uppercase",
        tone === "on" ? "text-accent-text" : "text-faint",
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
