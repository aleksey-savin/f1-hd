import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";
import useDeviceAttributeFilterStore from "../../store/lists/deviceAttributes";

const DeviceAttributeFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useDeviceAttributeFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const valueTypeChangeHandler = (event) => {
    filterStore.updateFilter({
      ...filterStore,
      valueType: event.target.value,
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
      <Row className="py-2">
        <Col>
          <Form.Label htmlFor="valueType">Тип данных</Form.Label>
          <Form.Select
            id="valueType"
            value={filterStore.valueType}
            onChange={valueTypeChangeHandler}
          >
            <option value="all">Все типы</option>
            <option value="string">Строка (string)</option>
            <option value="number">Число (number)</option>
            <option value="boolean">Да/Нет (boolean)</option>
            <option value="select">Выбор (select)</option>
            <option value="multiselect">
              Множественный выбор (multiselect)
            </option>
            <option value="text">Текст (text)</option>
          </Form.Select>
        </Col>
      </Row>
    </FilterContainer>
  );
};

export default DeviceAttributeFilter;
