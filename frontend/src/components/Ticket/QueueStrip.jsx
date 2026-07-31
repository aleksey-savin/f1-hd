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
    <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:px-1 tw:max-md:overflow-x-auto tw:max-md:pb-1 tw:md:flex-wrap">
      <span className="tw:flex-none tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase tw:max-md:hidden">
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
              "tw:inline-flex tw:h-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:px-3 tw:text-sm tw:transition-colors tw:outline-none tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
              active
                ? "tw:border-input tw:bg-accent tw:text-foreground"
                : "tw:border-border tw:bg-card tw:text-muted-foreground tw:hover:bg-accent",
            )}
          >
            {queue.tone && (
              <span
                aria-hidden
                className={cn(
                  "tw:size-1.5 tw:flex-none tw:rounded-full",
                  TONE_DOT[queue.tone],
                )}
              />
            )}
            {queue.label}
            <span className="tw:font-semibold tw:text-foreground tw:tabular-nums">
              {counts[queue.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default QueueStrip;
