import { useState, useEffect, useMemo } from "react";

import useUserFilterStore from "../../store/lists/users";

import FilterContainer from "../../UI/FilterContainer";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

const lastActivityOptions = [
  { value: "any", label: "Любая" },
  { value: "currentMonth", label: "Текущий месяц" },
  { value: "currentYear", label: "Текущий год" },
  { value: "inactive6m", label: "Не активны более 6 месяцев" },
];

const UserFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useUserFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    // Re-fetch from the backend: turning the toggle off loads inactive users,
    // turning it on drops them again.
    filterStore.fetch();
  };

  const companyToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      companies: !filterStore.companies?.includes(value)
        ? [...filterStore.companies, value]
        : filterStore.companies?.filter((company) => company !== value),
    });
    filterStore.applyFilter();
  };

  const lastActivityToggleHandler = (value) => {
    filterStore.updateFilter({
      ...filterStore,
      lastActivityRange: value,
    });
    filterStore.applyFilter();
  };

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

  // Количество пользователей по компании в текущей выборке
  const getCompanyCount = (companyId) =>
    filterStore.filteredList?.filter(
      (user) => user.company?._id?.toString() === companyId,
    ).length;

  // Список компаний из всего списка пользователей без дублей
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    const array = [];
    filterStore.originalList?.forEach((item) => {
      const id = item.company?._id?.toString();
      if (id && !array.some((company) => company._id === id)) {
        array.push({ _id: id, alias: item.company?.alias });
      }
    });
    setCompanies(array.sort((a, b) => a.alias?.localeCompare(b.alias)));
  }, [filterStore.originalList]);

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => {
      const aChecked = filterStore.companies?.includes(a._id);
      const bChecked = filterStore.companies?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [companies, filterStore.companies]);

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
    {
      value: "canSeeAnalytics",
      label: "Просмотр аналитики и трендов",
      className: `py-2 ${filterStore.timeTrackingModule?.includes("canSeeAnalytics") ? "text-info" : ""}`,
    },
  ];

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
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.companies?.length > 0 ? "text-info" : ""}`}
            >
              Компании{" "}
              {filterStore.companies?.length > 0 &&
                `(${filterStore.companies.length})`}
            </span>
          </AccordionHeader>
          <Accordion.Body style={{ maxHeight: "300px", overflowY: "auto" }}>
            {sortedCompanies.map((company) => (
              <Form.Check
                key={company._id}
                className={`
                  ${filterStore.companies?.includes(company._id) ? "text-info" : ""}
                  ${getCompanyCount(company._id) === 0 ? "text-secondary" : ""} py-2`}
                label={`${company.alias} (${getCompanyCount(company._id)})`}
                value={company._id}
                id={`company-${company._id}`}
                checked={filterStore.companies?.includes(company._id)}
                type="checkbox"
                name="filter-group-companies"
                onChange={companyToggleHandler}
              />
            ))}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.lastActivityRange !== "any" ? "text-info" : ""}`}
            >
              Последняя активность
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {lastActivityOptions.map((item) => (
              <Form.Check
                key={item.value}
                className={`py-2 ${filterStore.lastActivityRange === item.value ? "text-info" : ""}`}
                label={item.label}
                value={item.value}
                id={`last-activity-${item.value}`}
                checked={filterStore.lastActivityRange === item.value}
                type="radio"
                name="filter-group-last-activity"
                onChange={() => lastActivityToggleHandler(item.value)}
              />
            ))}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2">
        <Accordion.Item eventKey="0">
          <Accordion.Header>
            <span
              className={`${filterStore.timeTrackingModule?.length > 0 ? "text-info" : ""}`}
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
