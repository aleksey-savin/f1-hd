import type { IconType } from "react-icons";
import {
  RiCheckLine,
  RiInformationLine,
  RiLinkM,
  RiLinkUnlink,
  RiUserLine,
} from "react-icons/ri";
import { Link } from "react-router";

import type { MessageRow } from "@/types/conversation";
import { systemLineParts } from "@/util/conversation-format";

/**
 * Системная строка ленты (канва A1): тонкие линии по краям, иконка бирюзой и
 * фраза с номером заявки ссылкой. `note` — строка без события (первая строка
 * ленты неопознанного собеседника, канва C2).
 */

const ICON: Record<string, IconType> = {
  ticketCreated: RiLinkM,
  bound: RiLinkM,
  bindingRestored: RiLinkM,
  attached: RiLinkM,
  unbound: RiLinkUnlink,
  bindingEnded: RiLinkUnlink,
  handled: RiCheckLine,
  assigned: RiUserLine,
};

const SystemLine = ({
  message,
  note,
  compact = false,
}: {
  message?: MessageRow;
  note?: string;
  compact?: boolean;
}) => {
  const Icon = message ? (ICON[message.event?.kind ?? ""] ?? RiInformationLine) : RiInformationLine;
  const parts = message
    ? systemLineParts(message.event, { compact })
    : [{ text: note ?? "" }];

  return (
    <div className="mt-3 mb-1.5 flex items-center gap-2.5 text-xs text-muted-foreground">
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
      <span className="inline-flex max-w-115 items-center gap-1.5 text-center">
        <Icon size={14} aria-hidden className="flex-none text-accent-text" />
        <span>
          {parts.map((part, index) =>
            part.ticket ? (
              <Link
                key={index}
                to={`/tickets/${part.ticket}`}
                className="font-semibold text-accent-text no-underline hover:underline"
              >
                №{part.ticket}
              </Link>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border-soft" />
    </div>
  );
};

export default SystemLine;
