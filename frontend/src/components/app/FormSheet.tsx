import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { isMobile } from "react-device-detect";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { OverlayScrollContext } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

// Нижняя шторка для форм (согласованный макет): на десктопе — колонка по центру
// с автовысотой, на мобильном — почти весь экран. Формы-маршруты приносит в
// неё `app/FormOutlet` (единственный хозяин у списков, карточек и главной);
// для прочих «всплывающих» форм и панелей используйте её напрямую вместо
// копирования геометрии.

// Ширина — под контент, но НЕ под место, откуда форму открыли: одна и та же
// форма обязана быть одной ширины и со списка, и с карточки. У формы-маршрута
// ширину задаёт `handle.sheet.size` маршрута — см. `app/FormOutlet`.
const SIZES = {
  /** 672 — обычная форма в один столбец. */
  md: "max-w-2xl",
  /** 896 — мастер со сводкой справа. */
  lg: "max-w-4xl",
  /** 1024 — форма с рейлом секций (рейл 192 + колонка полей). */
  xl: "max-w-5xl",
} as const;

export type SheetSize = keyof typeof SIZES;

const FormSheet = ({
  open,
  onOpenChange,
  onExitComplete,
  title = "Форма",
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Анимация закрытия доиграла, содержимое размонтировано. Хозяин-маршрут
   * переходит на другой адрес именно здесь — форма уезжает целой, а не
   * исчезает с полпути.
   */
  onExitComplete?: () => void;
  /** Невидимый заголовок для скринридеров (radix требует Title). */
  title?: string;
  size?: SheetSize;
  children: ReactNode;
}) => {
  // Скроллится внутренность, а не сама шторка: крестик (у radix он absolute)
  // остаётся на месте в любой длинной форме, а рейлу секций внутри есть за чем
  // следить — на window скролла нет.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  // Высоту шторке задаёт содержимое, а содержимое открытой формы меняется —
  // раскрылась секция, появились ошибки полей, приехал ленивый редактор.
  // Скачок высоты смотрится рывком, поэтому меряем содержимое и держим высоту
  // числом: смена числа проезжает переходом. Обёртке нельзя давать
  // overflow: hidden — она стала бы скролл-контейнером, и липкие шапка формы и
  // ряд кнопок липли бы к ней, а не к прокручиваемой внутренности шторки.
  // Лишнее обрезает сама шторка.
  //
  // На закрытии содержимое может исчезнуть раньше конца анимации (маршрут ушёл
  // по «назад»), и шторка схлопнулась бы до одних полей отступов. Поэтому
  // последнюю измеренную высоту держим до размонтирования, а состояние
  // сбрасываем в auto: следующее открытие стартует с настоящей высоты формы, а
  // не проезжает к ней от старого числа.
  const body = useRef<HTMLDivElement>(null);
  const measured = useRef<number>(undefined);
  const frozen = useRef<number>(undefined);
  const [bodyHeight, setBodyHeight] = useState<number>();

  useLayoutEffect(() => {
    const node = body.current;
    if (!open || !node) {
      frozen.current = measured.current;
      measured.current = undefined;
      setBodyHeight(undefined);
      return undefined;
    }
    frozen.current = undefined;
    const measure = () => {
      measured.current = node.offsetHeight;
      setBodyHeight(node.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);

  // Защита от потери данных: на десктопе форму нельзя закрыть случайным
  // кликом по затемнению — только сабмитом, крестиком или Escape (все идут
  // через onOpenChange; Escape закрывает ВСЕ шторки приложения одинаково).
  // На мобильных поведение по умолчанию не трогаем.
  const guardDesktopClose = isMobile
    ? undefined
    : (event: Event) => event.preventDefault();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onInteractOutside={guardDesktopClose}
        onCloseAutoFocus={onExitComplete}
        className={cn(
          "overflow-hidden rounded-t-2xl border border-b-0 border-border",
          isMobile
            ? "top-3.5 h-auto"
            : cn(
                "inset-x-auto left-1/2 w-full -translate-x-1/2 max-h-[92dvh]",
                SIZES[size],
              ),
        )}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <OverlayScrollContext.Provider value={scroller}>
          {/* scroll-pb — запас под липкий ряд кнопок формы (app/FormLayout):
              поле, которое подкручивают в зону видимости браузер (фокус при
              открытой экранной клавиатуре) или список выбора (app/Combobox),
              иначе встаёт под кнопки */}
          <div
            ref={setScroller}
            className="min-h-0 flex-1 scroll-pb-20 overflow-y-auto"
          >
            <div
              style={{ height: open ? bodyHeight : frozen.current }}
              className="transition-[height] duration-200 ease-out motion-reduce:transition-none"
            >
              <div ref={body} className="px-6 pt-5 pb-6">
                {children}
              </div>
            </div>
          </div>
        </OverlayScrollContext.Provider>
      </SheetContent>
    </Sheet>
  );
};

export default FormSheet;
