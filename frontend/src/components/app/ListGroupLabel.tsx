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
        "tw:flex tw:items-baseline tw:gap-2 tw:px-5 tw:pt-5 tw:pb-2.5 tw:text-base tw:font-semibold tw:tracking-widest tw:uppercase",
        tone === "on" ? "tw:text-accent-text" : "tw:text-faint",
        className,
      )}
    >
      {label}
      {count !== undefined && (
        <span className="tw:font-semibold tw:tracking-normal tw:text-faint tw:tabular-nums">
          · {count}
        </span>
      )}
    </div>
  );
};

export default ListGroupLabel;
