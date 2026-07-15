import type { ReactNode } from "react";

import { isMobile } from "react-device-detect";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { InsideOverlayContext } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

// Нижняя шторка для форм (согласованный макет): на десктопе — колонка 672px
// по центру с автовысотой, на мобильном — почти весь экран. Используется
// ListWrapper'ом для маршрутов add/update; переиспользуйте её и для прочих
// «всплывающих» форм/панелей вместо копирования геометрии.
const FormSheet = ({
  open,
  onOpenChange,
  title = "Форма",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Невидимый заголовок для скринридеров (radix требует Title). */
  title?: string;
  children: ReactNode;
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "tw:rounded-t-2xl tw:border tw:border-b-0 tw:border-border",
          isMobile
            ? "tw:top-3.5 tw:h-auto tw:overflow-y-auto"
            : "tw:inset-x-auto tw:left-1/2 tw:w-full tw:max-w-2xl tw:-translate-x-1/2 tw:overflow-y-auto tw:max-h-[92dvh]",
        )}
      >
        <SheetTitle className="tw:sr-only">{title}</SheetTitle>
        {/* UI/Select внутри шторки переключается на инлайн-меню */}
        <InsideOverlayContext.Provider value={true}>
          <div className="tw:px-6 tw:pt-5 tw:pb-6">{children}</div>
        </InsideOverlayContext.Provider>
      </SheetContent>
    </Sheet>
  );
};

export default FormSheet;
