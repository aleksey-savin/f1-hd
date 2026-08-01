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
  /** Якорь секции для рейла-навигации (app/AnchorRail). */
  id?: string;
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
  id,
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
      <Eyebrow id={id} count={count}>
        {label}
      </Eyebrow>
      <Panel>
        {count === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          <>
            <div className="relative">
              <div
                ref={cloudRef}
                onTransitionEnd={handleTransitionEnd}
                style={{ maxHeight: maxHeight ?? undefined }}
                className={cn(
                  "flex flex-wrap gap-1.5 overflow-hidden",
                  "transition-all duration-300 ease-out motion-reduce:transition-none",
                )}
              >
                {items.map((item, index) => (
                  <span
                    key={getKey(item, index)}
                    className="inline-flex cursor-default items-center rounded-full border border-border-soft bg-accent px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-accent-text"
                  >
                    {getLabel(item)}
                  </span>
                ))}
              </div>
              {overflowing && !expanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-card/0" />
              )}
            </div>
            {overflowing && (
              <button
                type="button"
                onClick={expanded ? collapse : expand}
                className="mt-3.5 inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0 text-sm font-semibold text-accent-text outline-none hover:underline"
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
