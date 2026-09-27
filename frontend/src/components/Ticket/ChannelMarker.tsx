import type { IconType } from "react-icons";
import {
  RiCheckDoubleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiTimeLine,
} from "react-icons/ri";

import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { cn } from "@/lib/utils";
import { networkLabel } from "@/util/conversation-format";
import { deliveryStatusMeta } from "@/util/delivery-routes";

const STATUS_ICON: Record<string, IconType> = {
  clock: RiTimeLine,
  check: RiCheckLine,
  double: RiCheckDoubleLine,
  warn: RiErrorWarningLine,
};

const TONE: Record<string, string> = {
  faint: "text-faint",
  accent: "text-accent-text",
  destructive: "text-destructive",
};

/** Что метке нужно от блока канала комментария; «mail» — письмо. */
export type MarkerChannel = {
  network: string;
  direction: "in" | "out";
  status?: string;
};

/**
 * Метка канала над пузырём хроники (канва D4): глиф и имя сети; у нашего
 * ответа — «→» и статус доставки значком («Прочитано» — бирюзой, «Не
 * доставлено» — красным). Фирменный цвет — только у глифа мессенджера; письмо
 * (`network: "mail"`, `label: "письмо"`) — нейтральное.
 */
const ChannelMarker = ({
  channel,
  label,
}: {
  channel: MarkerChannel;
  label?: string;
}) => {
  const out = channel.direction === "out";
  const status = out ? deliveryStatusMeta(channel.status) : null;
  const StatusIcon = status ? STATUS_ICON[status.icon] : null;

  return (
    <span className="inline-flex flex-none items-center gap-1 text-xs whitespace-nowrap text-faint">
      {out && <span aria-hidden>→</span>}
      <ChannelIcon network={channel.network} size={12} />
      {label ?? networkLabel(channel.network)}
      {status && StatusIcon && (
        <span className={cn("flex", TONE[status.tone])} title={status.label}>
          <StatusIcon
            size={status.icon === "double" ? 14 : 13}
            aria-label={status.label}
          />
        </span>
      )}
    </span>
  );
};

export default ChannelMarker;
