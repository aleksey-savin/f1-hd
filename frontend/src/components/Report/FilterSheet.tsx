import { type ReactNode } from "react";

import { InsideOverlayContext } from "@/components/app/overlay-context";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

// Sheet-фильтр страницы отчёта — та же шторка, что у списков (разметка блока
// фильтра ListWrapper); открывается общим store/mobile-filter-offcanvas.
// InsideOverlayContext обязателен для модальных обёрток со своими порталами.
const FilterSheet = ({ children }: { children: ReactNode }) => {
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  return (
    <Sheet
      open={filterOffcanvas.isActive}
      onOpenChange={(open) => {
        if (!open) filterOffcanvas.handleClose();
      }}
    >
      <SheetContent side="left" className="tw:w-5/6 tw:max-w-sm">
        <SheetHeader className="tw:border-b tw:border-border">
          <SheetTitle className="tw:text-base">Фильтр</SheetTitle>
        </SheetHeader>
        <div className="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-4">
          <InsideOverlayContext.Provider value={true}>
            {children}
          </InsideOverlayContext.Provider>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default FilterSheet;
