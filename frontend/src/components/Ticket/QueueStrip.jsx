import { cn } from "@/lib/utils";

import { TICKET_QUEUES } from "../../util/ticket-queues";
import { TONE_DOT } from "./ticket-state";

/**
 * Лента очередей — сводка и переключатель одновременно: число отвечает на вопрос
 * о множестве, нажатие сужает список. Заменила шесть радио-кнопок в сайдбаре.
 *
 * Счётчики считаются по всей выборке и БЕЗ самой очереди (см. стор), поэтому
 * выбранная очередь не обнуляет соседние. Пустая очередь не рисуется — плашка с
 * нулём не информация; исключение — выбранная, иначе выбор исчезал бы
 * из-под пальца.
 */
const QueueStrip = ({ value, counts = {}, onChange }) => {
  const queues = TICKET_QUEUES.filter(
    (queue) =>
      queue.value === "all" || counts[queue.value] > 0 || queue.value === value,
  );
  if (queues.length <= 1) return null;

  return (
    <div className="mb-3 flex items-center gap-2 px-1 max-md:overflow-x-auto max-md:pb-1 md:flex-wrap">
      <span className="flex-none text-xs font-bold tracking-wider text-faint uppercase max-md:hidden">
        Очереди
      </span>
      {queues.map((queue) => {
        const active = queue.value === value;
        return (
          <button
            key={queue.value}
            type="button"
            onClick={() => onChange(queue.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 flex-none cursor-pointer appearance-none items-center gap-2 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
              active
                ? "border-input bg-accent text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            {queue.tone && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 flex-none rounded-full",
                  TONE_DOT[queue.tone],
                )}
              />
            )}
            {queue.label}
            <span className="font-semibold text-foreground tabular-nums">
              {counts[queue.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default QueueStrip;
