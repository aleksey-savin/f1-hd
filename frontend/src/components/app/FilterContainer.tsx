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
      <div className="tw:sticky tw:bottom-0 tw:z-10 tw:mt-4 tw:space-y-2 tw:bg-background/80 tw:py-2 tw:backdrop-blur">
        <MobileView>
          <Button
            className="tw:w-full"
            onClick={filterOffcanvas.handleClose}
          >
            Применить
          </Button>
        </MobileView>
        <Button
          variant="warning"
          className="tw:w-full"
          onClick={handleResetFilter}
        >
          Сбросить
        </Button>
      </div>
    </>
  );
};

export default FilterContainer;
