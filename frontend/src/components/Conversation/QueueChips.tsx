import FilterChip from "@/components/app/FilterChip";
import { cn } from "@/lib/utils";
import useConversationsStore from "@/store/conversations";
import { QUEUES } from "@/util/conversation-format";

type BaseQueue = "awaiting" | "mine" | "unbound" | "all";

/**
 * Очереди «Диалогов» чипами со счётчиками (канва A1 — `md`, B1 — `sm`).
 * Пока включён фильтр «Скрытые», ни один чип не горит: показана пятая,
 * служебная очередь; нажатие на чип её снимает.
 */
const QueueChips = ({
  size = "md",
  className,
}: {
  size?: "md" | "sm";
  className?: string;
}) => {
  const queue = useConversationsStore((state) => state.queue);
  const hidden = useConversationsStore((state) => state.hidden);
  const counts = useConversationsStore((state) => state.counts);
  const setQueue = useConversationsStore((state) => state.setQueue);

  return (
    <div
      role="group"
      aria-label="Очереди"
      className={cn(
        "flex items-center",
        size === "md" ? "gap-2" : "gap-1.5",
        className,
      )}
    >
      {QUEUES.map((item) => (
        <FilterChip
          key={item.value}
          size={size}
          dot={item.dot as "warning" | "none"}
          active={!hidden && queue === item.value}
          count={counts?.[item.value as BaseQueue] ?? null}
          onClick={() => setQueue(item.value as BaseQueue)}
          className="flex-none"
        >
          {item.label}
        </FilterChip>
      ))}
    </div>
  );
};

export default QueueChips;
