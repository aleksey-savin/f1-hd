import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";
import useDeviceTypeFilterStore from "../../store/lists/device-types";

const DeviceTypeFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useDeviceTypeFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

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
          <Form.Check
            type="switch"
            id="is-active"
            label="Только активные"
            value={filterStore.isActive}
            checked={filterStore.isActive}
            onChange={isActiveToggleHandler}
          />
        </Col>
      </Row>
    </FilterContainer>
  );
};

export default DeviceTypeFilter;
