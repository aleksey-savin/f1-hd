import type { ReactNode } from "react";
import { RiCheckLine, RiFileCopyLine } from "react-icons/ri";

import { copyText } from "@/components/app/PropRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChannelIcon } from "./ChannelGlyph";

/** Компактная строка контакта; текущий диалог отмечен галочкой. */
const ContactChannelRow = ({
  channel,
  label,
  value,
  current = false,
  big = false,
  action,
  actions,
}: {
  channel: string;
  label: string;
  value: string;
  current?: boolean;
  big?: boolean;
  action?: ReactNode;
  /** Меню текущего диалога после копирования адреса. */
  actions?: ReactNode;
}) => (
  <div
    className={cn(
      "flex items-center gap-1.5 text-sm",
      big ? "min-h-11" : "min-h-9",
    )}
  >
    <span title={label} className="mr-0.5 flex-none text-muted-foreground">
      <ChannelIcon network={channel} size={18} />
      <span className="sr-only">{label}</span>
    </span>
    <span
      className="min-w-0 flex-1 truncate tabular-nums select-text"
      title={value}
    >
      {value}
    </span>
    {current && (
      <span title="Этот диалог" className="flex flex-none text-accent-text">
        <RiCheckLine size={16} aria-hidden />
        <span className="sr-only">Этот диалог</span>
      </span>
    )}
    {action ?? (
      <CopyAction value={value} label="Адрес" what="адрес" big={big} />
    )}
    {actions}
  </div>
);

/** Кнопка копирования для строки канала: «Скопировать почту». */
export const CopyAction = ({
  value,
  label,
  what,
  big = false,
}: {
  value: string;
  /** Для тоста: «Почта скопирован» не скажем — «Адрес», «Телефон». */
  label: string;
  /** Для подсказки: «почту», «телефон». */
  what: string;
  big?: boolean;
}) => (
  <Button
    type="button"
    variant="ghost"
    size={big ? "icon-lg" : "icon-xs"}
    aria-label={`Скопировать ${what}`}
    title={`Скопировать ${what}`}
    className="text-faint hover:text-muted-foreground"
    onClick={() => copyText(value, label)}
  >
    <RiFileCopyLine />
  </Button>
);

export default ContactChannelRow;
