import { MobileView } from "react-device-detect";
import Button from "react-bootstrap/Button";
import useMobileFilterOffcanvasStore from "../store/mobile-filter-offcanvas";

const FilterContainer = ({ resetFilterHandler, children }) => {
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const handleApplyFilter = () => {
    filterOffcanvas.handleClose();
  };

  const handleResetFilter = () => {
    resetFilterHandler();
    filterOffcanvas.handleClose();
  };
  return (
    <>
      {children}
      <div className={`sticky-bottom z-3`}>
        <MobileView>
          <Button className="w-100 mb-2" onClick={handleApplyFilter}>
            Применить
          </Button>
        </MobileView>
        <Button
          className="w-100 mb-2"
          variant="warning"
          onClick={handleResetFilter}
        >
          Сбросить
        </Button>
      </div>
    </>
  );
};

export default FilterContainer;
