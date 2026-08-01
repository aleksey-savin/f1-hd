import { type ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

// Sheet-фильтр страницы отчёта — та же шторка, что у списков (разметка блока
// фильтра ListWrapper); открывается общим store/mobile-filter-offcanvas.
const FilterSheet = ({ children }: { children: ReactNode }) => {
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  return (
    <Sheet
      open={filterOffcanvas.isActive}
      onOpenChange={(open) => {
        if (!open) filterOffcanvas.handleClose();
      }}
    >
      <SheetContent side="left" className="w-5/6 max-w-sm">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-base">Фильтр</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
};

export default FilterSheet;
