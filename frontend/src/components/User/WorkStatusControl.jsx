import { useContext, useRef } from "react";
import { RiArrowDownSLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AuthedUserContext } from "@/store/authed-user-context";
import { getWorkStatusMeta } from "@/util/work-statuses";

import WorkStatusSwitcher from "./WorkStatusSwitcher";

// Отдельная цель в шапке: статус виден сразу, выбор и заметка — одним кликом.
// Popover не включает действия аккаунта и не открывает клавиатуру телефона
// автоматически: фокус получает выбранный статус, а не поле заметки.
export default function WorkStatusControl({ compact = false }) {
  const { isEndUser, hideWorkStatus, workStatus } =
    useContext(AuthedUserContext);
  const contentRef = useRef(null);
  if (isEndUser || hideWorkStatus) return null;

  const status = getWorkStatusMeta(workStatus?.code);
  const Icon = status.icon;
  const label =
    status.code === "unset"
      ? "Указать статус"
      : status.label.charAt(0).toUpperCase() + status.label.slice(1);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon-lg" : "xs"}
          aria-label={`Мой статус: ${status.label}`}
          title="Изменить статус"
          className={
            compact
              ? "shrink-0 p-0"
              : "shrink-0 gap-2 border border-border px-2.5 text-sm"
          }
        >
          <Icon
            size={16}
            aria-hidden
            className="size-4 shrink-0"
            style={{ color: status.color }}
          />
          {!compact && (
            <>
              <span className="max-w-40 truncate">{label}</span>
              <RiArrowDownSLine
                size={14}
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        aria-label="Мой статус"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-80 overflow-y-auto p-2"
        style={{
          maxWidth: "var(--radix-popover-content-available-width)",
          maxHeight: "var(--radix-popover-content-available-height)",
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = contentRef.current;
          const selected = content?.querySelector(
            'button[aria-pressed="true"]',
          );
          const first = content?.querySelector("button[aria-pressed]");
          (selected ?? first)?.focus();
        }}
      >
        <WorkStatusSwitcher />
      </PopoverContent>
    </Popover>
  );
}
