import { useState, type ReactNode } from "react";

import { isMobile } from "react-device-detect";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
          <div
            ref={setScroller}
            className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6"
          >
            {children}
          </div>
        </OverlayScrollContext.Provider>
      </SheetContent>
    </Sheet>
  );
};

export default FormSheet;
