import { RiWindowLine } from "react-icons/ri";

import Segmented from "@/components/app/Segmented";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import type { DeliveryRoutes } from "@/types/conversation";
import { NOTIFY_ROUTE, replyRouteOptions } from "@/util/delivery-routes";

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
  if (!choices.length) return null;
  return (
    <div className="mb-2 min-w-0">
      <Segmented
        ariaLabel="Канал ответа"
        iconOnly
        value={value}
        onChange={onChange}
        options={choices.map((option) => ({
          ...option,
          icon: option.value === NOTIFY_ROUTE ? (
            <RiWindowLine size={18} aria-hidden className="flex-none" />
          ) : (
            <ChannelIcon network={option.network} size={18} />
          ),
        }))}
        className="w-fit max-w-full flex-wrap"
      />
    </div>
  );
};

export default ReplyRoute;
