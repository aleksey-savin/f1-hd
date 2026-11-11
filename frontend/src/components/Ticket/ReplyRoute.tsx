import { RiMailLine } from "react-icons/ri";

import Segmented from "@/components/app/Segmented";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { cn } from "@/lib/utils";
import type { DeliveryRoutes } from "@/types/conversation";
import { replyRouteOptions } from "@/util/delivery-routes";

/** Approved switcher: channels stay visible above the comment, on both layouts. */
const ReplyRoute = ({
  data,
  value,
  onChange,
}: {
  data: DeliveryRoutes;
  value: string;
  onChange: (value: string) => void;
}) => {
  const choices = replyRouteOptions(data);
  const unavailable = choices.filter((option) => option.disabled);
  return (
    <div className="@container/reply-route mb-3 min-w-0">
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
        Ответить через
      </div>
      <Segmented
        ariaLabel="Канал ответа"
        value={value}
        onChange={onChange}
        options={choices.map((option) => ({
          ...option,
          title: option.reason || undefined,
          icon: option.network === "mail" ? (
            <RiMailLine size={16} aria-hidden className="flex-none text-muted-foreground" />
          ) : (
            <ChannelIcon network={option.network} size={16} />
          ),
        }))}
        className={cn(
          "grid w-full [&_button]:min-w-0 pointer-coarse:[&_button]:min-h-11",
          choices.length === 1 ? "grid-cols-1" : "grid-cols-2",
          choices.length === 3 && "@min-[32rem]/reply-route:grid-cols-3",
          choices.length >= 4 && "@min-[32rem]/reply-route:grid-cols-4",
        )}
      />
      {unavailable.map((option) => (
        <p key={option.value} className="mt-1.5 mb-0 text-xs text-muted-foreground">
          {option.label} — {option.reason}
        </p>
      ))}
    </div>
  );
};

export default ReplyRoute;
