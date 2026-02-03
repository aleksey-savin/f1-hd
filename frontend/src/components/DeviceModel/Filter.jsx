import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";
import useDeviceModelFilterStore from "../../store/lists/deviceModels";

const DeviceModelFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useDeviceModelFilterStore();

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Row className="py-2">
        <Col>
          <p className="text-muted small">
            Используйте поиск для фильтрации моделей устройств
          </p>
        </Col>
      </Row>
    </FilterContainer>
  );
};

export default DeviceModelFilter;
