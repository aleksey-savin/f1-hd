import { useEffect } from "react";
import { useCan } from "@/store/authed-user";
import Segmented from "@/components/app/Segmented";
import { cn } from "@/lib/utils";
import useConversationsStore from "@/store/conversations";
import type { ConversationQueue } from "@/types/conversation";
import { QUEUES } from "@/util/conversation-format";

type BaseQueue = Exclude<ConversationQueue, "hidden">;

/** Скрытые диалоги — отдельный фильтр; выбор сегмента возвращает к активным. */
const QueueSelector = ({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) => {
  const readsAll = useCan()({ conversation: ["readAll"] });
  const queue = useConversationsStore((state) => state.queue);
  const hidden = useConversationsStore((state) => state.hidden);
  const counts = useConversationsStore((state) => state.counts);
  const setQueue = useConversationsStore((state) => state.setQueue);

  useEffect(() => {
    if (!readsAll && queue === "unbound") setQueue("all");
  }, [readsAll, queue, setQueue]);

  return (
    <div
      className={cn(
        "scrollbar-none max-w-full min-w-0 overflow-x-auto",
        className,
      )}
    >
      <Segmented
        ariaLabel="Режим списка диалогов"
        options={QUEUES.filter(
          (item) => readsAll || item.value !== "unbound",
        ).map((item) => ({
          value: item.value,
          label: item.label,
          count: counts?.[item.value as BaseQueue],
          icon:
            item.dot === "warning" ? (
              <span
                aria-hidden
                className="size-1.5 flex-none rounded-full bg-warning"
              />
            ) : undefined,
        }))}
        value={hidden ? "" : queue}
        onChange={(value) => setQueue(value as BaseQueue)}
        compact={compact}
        fit
        className="w-max"
      />
    </div>
  );
};

export default QueueSelector;
