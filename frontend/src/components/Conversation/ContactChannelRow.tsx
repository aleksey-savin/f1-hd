import type { ReactNode } from "react";
import { RiFileCopyLine } from "react-icons/ri";

import { copyText } from "@/components/app/PropRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChannelTile } from "./ChannelGlyph";

/**
 * Строка канала связи в карточке собеседника (канва A1, B3): плитка канала,
 * подпись, значение и действие справа («Написать» — в другой диалог этого
 * человека, копирование — у почты и телефона). Текущий диалог обведён
 * бирюзой. Геометрия — как у каналов `User/ContactCard`.
 */
const ContactChannelRow = ({
  channel,
  label,
  value,
  current = false,
  big = false,
  action,
}: {
  channel: string;
  label: string;
  value: string;
  current?: boolean;
  big?: boolean;
  action?: ReactNode;
}) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-xl border p-1.5",
      current ? "border-primary/35" : "border-border",
    )}
  >
    <ChannelTile
      network={channel}
      iconSize={18}
      neutralClassName="bg-primary/15 text-accent-text"
      className="size-9 rounded-lg"
    />
    <span className="block min-w-0 flex-1">
      <span className="block text-xs text-faint">{label}</span>
      <span
        className={cn(
          "block truncate leading-5 font-medium tabular-nums",
          big ? "text-base" : "text-sm",
        )}
      >
        {value}
      </span>
    </span>
    {action}
  </div>
);

/** Кнопка копирования для строки канала: «Скопировать почту». */
export const CopyAction = ({
  value,
  label,
  what,
}: {
  value: string;
  /** Для тоста: «Почта скопирован» не скажем — «Адрес», «Телефон». */
  label: string;
  /** Для подсказки: «почту», «телефон». */
  what: string;
}) => (
  <Button
    variant="ghost"
    size="icon-xs"
    aria-label={`Скопировать ${what}`}
    title={`Скопировать ${what}`}
    className="text-faint hover:text-muted-foreground"
    onClick={() => copyText(value, label)}
  >
    <RiFileCopyLine />
  </Button>
);

export default ContactChannelRow;
