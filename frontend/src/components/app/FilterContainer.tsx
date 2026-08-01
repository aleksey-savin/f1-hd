import type { ReactNode } from "react";

import { MobileView } from "react-device-detect";

import { Button } from "@/components/ui/button";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

// tw-двойник UI/FilterContainer.jsx: тело фильтра + липкие «Применить»
// (только мобайл, закрывает шторку) и «Сбросить».
const FilterContainer = ({
  resetFilterHandler,
  children,
}: {
  resetFilterHandler: () => void;
  children: ReactNode;
}) => {
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  const handleResetFilter = () => {
    resetFilterHandler();
    filterOffcanvas.handleClose();
  };

  return (
    <>
      {children}
      <div className="sticky bottom-0 z-10 mt-4 space-y-2 bg-background/80 py-2 backdrop-blur">
        <MobileView>
          <Button className="w-full" onClick={filterOffcanvas.handleClose}>
            Применить
          </Button>
        </MobileView>
        {/* Не warning: у залитой кнопки в приложении текст всегда белый, а
            вариант warning даёт тёмный текст на янтарном — «Сбросить»
            выбивалась из всех остальных экранов. Залитая в шторке одна —
            «Применить». */}
        <Button
          variant="outline"
          className="w-full"
          onClick={handleResetFilter}
        >
          Сбросить
        </Button>
      </div>
    </>
  );
};

export default FilterContainer;
