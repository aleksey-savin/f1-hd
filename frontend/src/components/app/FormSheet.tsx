import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { isMobile } from "react-device-detect";
import { useOutlet } from "react-router";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { OverlayScrollContext } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

// Нижняя шторка для форм (согласованный макет): на десктопе — колонка по центру
// с автовысотой, на мобильном — почти весь экран. Используется ListWrapper'ом
// для маршрутов add/update; переиспользуйте её и для прочих «всплывающих»
// форм/панелей вместо копирования геометрии.

// Ширина — под контент, но НЕ под место, откуда форму открыли: одна и та же
// форма обязана быть одной ширины и со списка, и с карточки.
const SIZES = {
  /** 672 — обычная форма в один столбец. */
  md: "max-w-2xl",
  /** 896 — мастер со сводкой справа. */
  lg: "max-w-4xl",
  /** 1024 — форма с рейлом секций (рейл 192 + колонка полей). */
  xl: "max-w-5xl",
} as const;

// Сколько полей рисовать в заглушке: чем шире шторка, тем длиннее форма за ней.
// Попасть точно нельзя — форм много и все разной длины, — поэтому промах
// доигрывает переход по высоте (ниже); эти числа лишь делают его коротким.
const SKELETON_ROWS = { md: 5, lg: 8, xl: 10 } as const;

/**
 * Заглушка на время лоадера вложенного маршрута. Повторяет каркас
 * `app/FormWrapper` — заголовок, поля, ряд кнопок, — потому что ровно им и
 * станет.
 */
const FormSkeleton = ({ rows }: { rows: number }) => (
  <div role="status">
    <span className="sr-only">Загрузка формы</span>
    <Skeleton className="mb-5 h-7 w-56" />
    <div className="space-y-5">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
    <div className="mt-6 flex justify-end gap-2.5 border-t border-border-soft pt-3">
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-9 w-28" />
    </div>
  </div>
);

const FormSheet = ({
  open,
  onOpenChange,
  title = "Форма",
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Невидимый заголовок для скринридеров (radix требует Title). */
  title?: string;
  size?: keyof typeof SIZES;
  children: ReactNode;
}) => {
  // Скроллится внутренность, а не сама шторка: крестик (у radix он absolute)
  // остаётся на месте в любой длинной форме, а рейлу секций внутри есть за чем
  // следить — на window скролла нет.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  // Шторку открывают щелчком, а форму в неё приносит вложенный маршрут — и он
  // приезжает позже на время своего лоадера. Пока его нет, шторка выезжала
  // пустой полосой в одни поля отступов и дорастала до формы уже на ходу;
  // вместо пустоты показываем заглушку примерно той же высоты. `open` в
  // условии обязателен: на закрытии маршрут уходит раньше анимации выезда, и
  // без него заглушка мигнула бы вслед уезжающей форме.
  const outlet = useOutlet();
  const pending = open && !outlet;

  // Высоту шторке задаёт содержимое, а содержимое здесь подменяется на ходу:
  // сперва заглушка, следом форма, и разницу между ними шторка отыгрывала
  // скачком. Поэтому меряем содержимое и держим высоту числом — смена числа
  // проезжает переходом. Обёртке нельзя давать overflow: hidden: она стала бы
  // скролл-контейнером, и липкие шапка формы и ряд кнопок липли бы к ней, а не
  // к прокручиваемой внутренности шторки. Лишнее обрезает сама шторка.
  const body = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number>();

  useLayoutEffect(() => {
    const node = body.current;
    if (!open || !node) {
      setBodyHeight(undefined);
      return undefined;
    }
    const measure = () => setBodyHeight(node.offsetHeight);
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
          <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto">
            <div
              style={{ height: bodyHeight }}
              className="transition-[height] duration-200 ease-out motion-reduce:transition-none"
            >
              <div ref={body} className="px-6 pt-5 pb-6">
                {children}
                {pending && <FormSkeleton rows={SKELETON_ROWS[size]} />}
              </div>
            </div>
          </div>
        </OverlayScrollContext.Provider>
      </SheetContent>
    </Sheet>
  );
};

export default FormSheet;
