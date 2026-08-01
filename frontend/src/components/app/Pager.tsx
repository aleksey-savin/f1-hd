import { BrowserView, MobileView } from "react-device-detect";
import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Постраничность списка на серверной выборке: нумерованные страницы (десктоп)
// + «Показать ещё» (мобайл). Порцию считает сервер; здесь только контролы.
// page — текущая страница (десктоп) / число загруженных порций (мобайл,
// докрутка). Используют «Пользователи» и «Архив заявок».

type PagerProps = {
  page: number;
  pageSize: number;
  total: number;
  /** Сколько строк уже показано (для мобильной докрутки). */
  loaded: number;
  onPage: (page: number) => void;
  onLoadMore: () => void;
};

// 1 … (page-1) page (page+1) … last, с многоточиями
const pageList = (current: number, totalPages: number) => {
  const wanted = new Set([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...wanted]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const out: Array<number | string> = [];
  let prev = 0;
  for (const page of sorted) {
    if (page - prev > 1) out.push(`gap-${page}`);
    out.push(page);
    prev = page;
  }
  return out;
};

const Pager = ({
  page,
  pageSize,
  total,
  loaded,
  onPage,
  onLoadMore,
}: PagerProps) => {
  if (!total) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <>
      <BrowserView>
        {totalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 px-1">
            <span className="text-sm text-muted-foreground tabular-nums">
              Показаны {from}–{to} из {total}
            </span>
            <div className="ms-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                aria-label="Предыдущая страница"
              >
                <RiArrowLeftSLine />
              </Button>
              {pageList(page, totalPages).map((entry) =>
                typeof entry === "string" ? (
                  <span key={entry} aria-hidden className="px-1 text-faint">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => onPage(entry)}
                    aria-current={entry === page ? "page" : undefined}
                    className={cn(
                      "inline-grid h-8 min-w-8 cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-muted-foreground tabular-nums transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
                      entry === page &&
                        "bg-primary/15 text-accent-text hover:bg-primary/15 hover:text-accent-text",
                    )}
                  >
                    {entry}
                  </button>
                ),
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={page >= totalPages}
                onClick={() => onPage(page + 1)}
                aria-label="Следующая страница"
              >
                <RiArrowRightSLine />
              </Button>
            </div>
          </div>
        )}
      </BrowserView>
      <MobileView>
        <div className="mt-3 flex flex-col items-center gap-2 px-1">
          {loaded < total && (
            <Button variant="outline" className="w-full" onClick={onLoadMore}>
              Показать ещё
            </Button>
          )}
          <span className="text-sm text-faint tabular-nums">
            {loaded < total ? `Показаны ${loaded} из ${total}` : `Все ${total}`}
          </span>
        </div>
      </MobileView>
    </>
  );
};

export default Pager;
