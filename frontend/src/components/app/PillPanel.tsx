import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TransitionEvent,
} from "react";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";

type PillItem = Record<string, unknown>;

type PillPanelProps = {
  /** Метка секции (eyebrow) над панелью. */
  label: ReactNode;
  /** Однородные сущности — категории, компании, теги. */
  items?: PillItem[];
  /** Ключ пилюли (по умолчанию _id, иначе индекс). */
  getKey?: (item: PillItem, index: number) => string;
  /** Подпись пилюли (по умолчанию title / alias / name). */
  getLabel?: (item: PillItem) => ReactNode;
  /** Текст пустого состояния. */
  emptyText?: ReactNode;
  /** Высота свёрнутого «облака», px; при переполнении — «Показать все». */
  collapsedMaxHeight?: number;
};

const defaultKey = (item: PillItem, index: number) =>
  String((item?._id as string | undefined) ?? index);

// Пилюли однородных сущностей подписываем текстом; произвольный объект не
// рендерим (гайд: сужаем тип type-guard'ом, а не приводим unknown к ReactNode).
const asText = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;

const defaultLabel = (item: PillItem): ReactNode =>
  asText(item.title) ?? asText(item.alias) ?? asText(item.name) ?? "—";

// ~3 ряда пилюль
const COLLAPSED_MAX_HEIGHT = 112;

// Панель-«облако» нейтральных пилюль с eyebrow-заголовком и счётчиком.
// Однородные сущности не раскрашиваем (гайд). При переполнении свёрнутой высоты
// показывает градиент-затухание и кнопку «Показать все (N)» с плавной
// анимацией высоты; пилюли подсвечиваются при наведении.
const PillPanel = ({
  label,
  items = [],
  getKey = defaultKey,
  getLabel = defaultLabel,
  emptyText,
  collapsedMaxHeight = COLLAPSED_MAX_HEIGHT,
}: PillPanelProps) => {
  const count = items.length;
  const cloudRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // Инлайновая max-height для анимации; null — без ограничения (авто-высота).
  const [maxHeight, setMaxHeight] = useState<number | null>(collapsedMaxHeight);

  // scrollHeight отдаёт полную высоту контента независимо от клэмпа — меряем
  // переполнение в обоих состояниях против свёрнутой высоты.
  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (!el) return undefined;
    const check = () =>
      setOverflowing(el.scrollHeight > collapsedMaxHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, collapsedMaxHeight]);

  const expand = () => {
    const el = cloudRef.current;
    // Анимируем вверх до измеренной полной высоты.
    setMaxHeight(el ? el.scrollHeight : null);
    setExpanded(true);
  };

  const collapse = () => {
    const el = cloudRef.current;
    if (el) {
      // Фиксируем текущую высоту, затем на следующем кадре съезжаем к клэмпу.
      setMaxHeight(el.scrollHeight);
      requestAnimationFrame(() => setMaxHeight(collapsedMaxHeight));
    } else {
      setMaxHeight(collapsedMaxHeight);
    }
    setExpanded(false);
  };

  // После раскрытия снимаем ограничение — контент сможет свободно перетекать.
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName === "max-height" && expanded) setMaxHeight(null);
  };

  return (
    <>
      <Eyebrow count={count}>{label}</Eyebrow>
      <Panel>
        {count === 0 ? (
          <div className="tw:text-sm tw:text-muted-foreground">{emptyText}</div>
        ) : (
          <>
            <div className="tw:relative">
              <div
                ref={cloudRef}
                onTransitionEnd={handleTransitionEnd}
                style={{ maxHeight: maxHeight ?? undefined }}
                className={cn(
                  "tw:flex tw:flex-wrap tw:gap-1.5 tw:overflow-hidden",
                  "tw:transition-all tw:duration-300 tw:ease-out tw:motion-reduce:transition-none",
                )}
              >
                {items.map((item, index) => (
                  <span
                    key={getKey(item, index)}
                    className="tw:inline-flex tw:cursor-default tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-foreground tw:transition-colors tw:hover:border-primary/40 tw:hover:bg-primary/10 tw:hover:text-accent-text"
                  >
                    {getLabel(item)}
                  </span>
                ))}
              </div>
              {overflowing && !expanded && (
                <div className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:bottom-0 tw:h-8 tw:bg-gradient-to-t tw:from-card tw:to-card/0" />
              )}
            </div>
            {overflowing && (
              <button
                type="button"
                onClick={expanded ? collapse : expand}
                className="tw:mt-3.5 tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:font-semibold tw:text-accent-text tw:outline-none tw:hover:underline"
              >
                {expanded ? "Свернуть" : `Показать все (${count})`}
              </button>
            )}
          </>
        )}
      </Panel>
    </>
  );
};

export default PillPanel;
