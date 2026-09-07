import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

// Шапка страницы: заголовок слева, строка инструментов справа, главное действие
// в правом верхнем углу. При сужении окна раскладка переходит по ступеням
// (гайд → «Анатомия списка с фильтром → Шапка»), и ступень ставит ИЗМЕРЕНИЕ,
// а не брейкпоинт: строке инструментов «Категорий» хватает ~520 px,
// «Пользователям» с сегментом и чипом нужно ~930 — один порог либо рано
// ломает простые страницы, либо поздно спасает богатые.
//   1 — всё в одну строку;
//   2 — строка инструментов не помещается рядом с заголовком и целиком уходит
//       под него, к левому краю, тем же порядком; действие остаётся в углу
//       строки заголовка;
//   3 — не помещается и своя строка: поиск во всю ширину, ниже контролы слева
//       и сортировка справа — структура мобильного списка.
// DOM у ступеней один и тот же: поле поиска не перемонтируется, фокус и
// набранный текст переживают смену ступени. Делят ListWrapper (десктоп) и
// PageShell. Макет: артефакт «Строка инструментов списка».

type Tier = 1 | 2 | 3;

/** Ширина поиска на ступенях 1–2: класс и его значение в rem для измерения.
 *  Лежат рядом, потому что Tailwind не собирает классы из переменных. */
const SEARCH_BASIS_CLASS = "basis-80";
const SEARCH_REM = 20;
/** Зазор между контролами — участвует в измерении так же, как в раскладке. */
const GAP_CLASS = "gap-x-2.5 gap-y-3";
const GAP_REM = 0.625;

/** Собственная (max-content) ширина элемента независимо от того, растянул
 *  или сжал его флекс: на время замера гасим flex и просим max-content.
 *  Без этого блок заголовка в ряду с кнопкой читался бы шириной ряда, и
 *  шапка никогда не возвращалась бы на ступень 1 при расширении окна. */
const naturalWidth = (el: HTMLElement) => {
  const { flex, width } = el.style;
  el.style.flex = "none";
  el.style.width = "max-content";
  const measured = el.getBoundingClientRect().width;
  el.style.flex = flex;
  el.style.width = width;
  return measured;
};

/** Сумма ширин видимых боксов внутри контейнера с зазорами между ними.
 *  Обёртки `display: contents` (например, `hidden md:contents` у чипов
 *  списка) раскрываются — боксы у них внутри; скрытые пропускаются. */
const boxesWidth = (container: HTMLElement | null, gap: number) => {
  if (!container) return 0;
  let sum = 0;
  let count = 0;
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const { display } = getComputedStyle(child);
      if (display === "none") continue;
      if (display === "contents") {
        visit(child);
        continue;
      }
      sum += child.getBoundingClientRect().width;
      count += 1;
    }
  };
  visit(container);
  return count ? sum + gap * (count - 1) : 0;
};

/** Ширина ряда из ненулевых частей с зазорами между ними. */
const joinWidths = (gap: number, ...parts: number[]) =>
  parts
    .filter((part) => part > 0)
    .reduce((sum, part, index) => sum + part + (index ? gap : 0), 0);

type PageHeaderProps = {
  /** Блок заголовка: h1 со счётчиком, плитка, подзаголовок. На ступенях 2–3
   *  делит строку с действием и переносит текст, если не помещается. */
  title: ReactNode;
  /** Поиск: 20rem на ступенях 1–2, вся строка на ступени 3. */
  search?: ReactNode;
  /** Сортировка: первой после поиска, на ступени 3 — у правого края строки
   *  контролов, как на телефоне. */
  sort?: ReactNode;
  /** Контролы строки инструментов: чипы фасетов, степпер периода, фильтр. */
  controls?: ReactNode;
  /** Главное действие («Новый X») — всегда в правом верхнем углу. */
  action?: ReactNode;
  className?: string;
};

const PageHeader = ({
  title,
  search,
  sort,
  controls,
  action,
  className,
}: PageHeaderProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLDivElement | null>(null);
  const [tier, setTier] = useState<Tier>(1);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const titleEl = titleRef.current;
    if (!root || !titleEl) return;
    const width = root.getBoundingClientRect().width;
    if (!width) return;
    const rem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gap = GAP_REM * rem;
    const searchWidth = searchRef.current ? SEARCH_REM * rem : 0;
    const toolbar = joinWidths(
      gap,
      searchWidth,
      boxesWidth(controlsRef.current, gap),
    );
    const oneRow = joinWidths(
      gap,
      naturalWidth(titleEl),
      toolbar,
      actionRef.current ? naturalWidth(actionRef.current) : 0,
    );
    // Без поиска третьей ступени нет: делить строку контролов не на что,
    // а если она шире листа, её переносит flex-wrap.
    const next: Tier =
      oneRow <= width ? 1 : toolbar <= width || !searchRef.current ? 2 : 3;
    setTier((prev) => (prev === next ? prev : next));
  }, []);

  // После каждого рендера: подписи чипов и сортировки меняются без изменения
  // размера корня, а замер — несколько чтений в маленьком поддереве.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // Шрифт мог подъехать после первого кадра — ширины текста изменятся
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  // Ступень 1 всегда nowrap: помещение измерено, а субпиксельный перелив
  // невидим, тогда как перенос одного контрола — та самая дыра. Без поиска
  // ступень 2 переносит контролы сама (третьей ступени у неё нет).
  const wrapTools = tier === 3 || (tier === 2 && !search);

  return (
    <div
      ref={rootRef}
      data-tier={tier}
      className={cn(
        "flex items-center",
        GAP_CLASS,
        tier === 1 ? "flex-nowrap" : "flex-wrap",
        className,
      )}
    >
      <div ref={titleRef} className="min-w-0 flex-1">
        {title}
      </div>
      {/* Ступень 1: ряд в хвосте строки заголовка; 2–3: своя строка целиком
          (order-last + basis-full), действие остаётся в первой */}
      <div
        className={cn(
          "flex shrink-0 items-center",
          GAP_CLASS,
          wrapTools ? "flex-wrap" : "flex-nowrap",
          tier >= 2 && "order-last basis-full",
        )}
      >
        {search && (
          <div
            ref={searchRef}
            className={cn(
              "shrink-0",
              tier === 3 ? "basis-full" : SEARCH_BASIS_CLASS,
            )}
          >
            {search}
          </div>
        )}
        {/* На ступенях 1–2 контейнер прозрачен для флекса (contents) — сортировка
            и контролы стоят в одном ряду с поиском; на ступени 3 — своя строка */}
        <div
          ref={controlsRef}
          className={
            tier === 3
              ? cn("flex basis-full flex-wrap items-center", GAP_CLASS)
              : "contents"
          }
        >
          {sort && (
            <div
              className={cn("flex-none", tier === 3 && "order-last ms-auto")}
            >
              {sort}
            </div>
          )}
          {controls}
        </div>
      </div>
      {action && (
        <div ref={actionRef} className="flex-none">
          {action}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
