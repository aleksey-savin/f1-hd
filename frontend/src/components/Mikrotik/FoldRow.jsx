import { useId, useState } from "react";
import { RiArrowDownSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

/**
 * Свёрнутый хвост секции страницы записи: строка-кнопка «что внутри ·
 * Показать все (N)» и содержимое под ней. Журнал простоев, ранние копии
 * конфигурации, адреса сверх первых шести, список уязвимостей нужны редко, а
 * места занимали больше, чем всё остальное на странице (макет «Страница
 * устройства Mikrotik», 10.10).
 *
 * `summary` — что свёрнуто, приглушённым текстом слева; `count` — число в
 * «Показать все (N)» (общее число записей, а не только спрятанных); `label`
 * заменяет подпись целиком («Показать»). `flush` — строка без отступа сверху:
 * когда она идёт сразу за видимыми строками списка.
 */
const FoldRow = ({ summary, count, label, flush = false, children }) => {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full cursor-pointer appearance-none items-center justify-between gap-3 border-0 border-t border-border-soft bg-transparent px-0 pt-3 pb-0 text-start text-sm text-muted-foreground",
          !flush && "mt-3.5",
        )}
      >
        <span className="min-w-0">{summary}</span>
        <span className="inline-flex flex-none items-center gap-1 font-semibold whitespace-nowrap text-accent-text">
          {open ? "Свернуть" : label || `Показать все (${count})`}
          <RiArrowDownSLine
            size={16}
            aria-hidden
            className={cn(
              "transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div id={id} className="pt-2.5">
          {children}
        </div>
      )}
    </>
  );
};

export default FoldRow;
