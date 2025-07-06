import useUserFilterStore from "../../store/lists/users";

import FilterContainer from "../../UI/FilterContainer";

import Accordion from "react-bootstrap/Accordion";
import Form from "react-bootstrap/Form";

const UserFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useUserFilterStore();

  const timeTrackingToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      timeTrackingModule: !filterStore.timeTrackingModule.includes(value)
        ? [...filterStore.timeTrackingModule, value]
        : filterStore.timeTrackingModule.filter((item) => item !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  const timeTrackingModulePermissionsFilter = [
    {
      value: "canUseTimeTrackingModule",
      label: "Разрешено использование модуля",
      className: `py-2 ${filterStore.timeTrackingModule?.includes("canUseTimeTrackingModule") ? "text-info" : ""}`,
    },
    {
      value: "canAvoidWorks",
      label: "Можно не указывать работы",
      className: `py-2 ${filterStore.timeTrackingModule?.includes("canAvoidWorks") ? "text-info" : ""}`,
    },
    {
      value: "canSeeWorksReport",
      label: "Формирование и просмотр отчёта по работам",
      className: `py-2 ${filterStore.timeTrackingModule?.includes("canSeeWorksReport") ? "text-info" : ""}`,
    },
  ];

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Accordion className="py-2">
        <Accordion.Item eventKey="0">
          <Accordion.Header>
            <span
              className={`${filterStore.responsibles?.length > 0 ? "text-info" : ""}`}
            >
              Модуль учёта времени
            </span>
          </Accordion.Header>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {timeTrackingModulePermissionsFilter.map((item) => {
              return (
                <Form.Check
                  key={item.value}
                  className={item.className}
                  label={`${item.label}`}
                  value={item.value}
                  id={`time-tracking-${item.value}`}
                  checked={filterStore.timeTrackingModule?.includes(item.value)}
                  type="checkbox"
                  name="filter-group-responsibles"
                  onChange={timeTrackingToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};
export default UserFilter;
