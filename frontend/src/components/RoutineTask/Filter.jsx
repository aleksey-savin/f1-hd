import { useState, useEffect, useMemo } from "react";

import useRoutineTaskFilterStore from "../../store/lists/routine-tasks";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

const RoutineTaskFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useRoutineTaskFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const checklistTogglehandler = (value) => {
    filterStore.updateFilter({ ...filterStore, checklist: value });
    filterStore.applyFilter();
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

  const categoryToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      categories: !filterStore.categories.includes(value)
        ? [...filterStore.categories, value]
        : filterStore.categories.filter((category) => category !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  const getListLengthBy = (list, itemName, item) => {
    let result = [];
    if (itemName === "company") {
      result = list?.filter(
        (ticket) => ticket.company?._id === item._id,
      ).length;
    } else if (itemName === "category") {
      result = list?.filter((task) => task.category?._id === item._id).length;
    }

    return result;
  };

  // Получаем список компаний из всего списка заявок и исключаем дублирование
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((item) => {
      if (
        !array
          .map((company) => company._id.toString())
          .includes(item.company?._id.toString())
      ) {
        array.push({
          _id: item.company?._id.toString(),
          alias: item.company?.alias,
        });
      }
    });
    setCompanies(array.sort((a, b) => a.alias?.localeCompare(b.alias)));
  }, [filterStore.originalList]);

  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((item) => {
      if (
        !array
          .map((category) => category._id.toString())
          .includes(item.category?._id.toString())
      ) {
        array.push({
          _id: item.category?._id.toString(),
          title: item.category?.title,
        });
      }
    });
    setCategories(array.sort((a, b) => a.title?.localeCompare(b.alias)));
  }, [filterStore.originalList]);

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => {
      const aChecked = filterStore.companies?.includes(a._id);
      const bChecked = filterStore.companies?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [companies, filterStore.companies]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const aChecked = filterStore.categories?.includes(a._id);
      const bChecked = filterStore.categories?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [categories, filterStore.categories]);

  const checklistFilter = [
    {
      value: "any",
      label: "Любое значение",
      className: `py-2 ${filterStore.comments === "any" ? "text-info" : ""}`,
    },
    {
      value: "present",
      label: "Есть",
      className: `py-2 ${filterStore.checklist === "present" ? "text-info" : ""}`,
    },
    {
      value: "abcent",
      label: "Нет",
      className: `py-2 ${filterStore.checklist === "abcent" ? "text-info" : ""}`,
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
              Компании
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedCompanies.map((company) => {
              return (
                <Form.Check
                  key={company._id}
                  label={`${company.alias} (${getListLengthBy(filterStore.filteredList, "company", company)})`}
                  className={`
                    ${filterStore.companies?.includes(company._id) ? "text-info" : ""}
                    ${
                      getListLengthBy(
                        filterStore.filteredList,
                        "company",
                        company,
                      ) === 0
                        ? "text-secondary"
                        : ""
                    } py-2`}
                  value={company._id}
                  id={`company-${company._id}`}
                  checked={filterStore.companies?.includes(company._id)}
                  type="checkbox"
                  name="filter-group-companies"
                  onChange={companyToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.categories?.length > 0 ? "text-info" : ""}`}
            >
              Категории
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedCategories.map((category) => {
              return (
                <Form.Check
                  key={category._id}
                  label={`${category.title} (${getListLengthBy(filterStore.filteredList, "category", category)})`}
                  className={`
                      ${filterStore.categories?.includes(category._id) ? "text-info" : ""}
                      ${
                        getListLengthBy(
                          filterStore.filteredList,
                          "category",
                          category,
                        ) === 0
                          ? "text-secondary"
                          : ""
                      } py-2`}
                  value={category._id}
                  id={`company-${category._id}`}
                  checked={filterStore.categories?.includes(category._id)}
                  type="checkbox"
                  name="filter-group-categories"
                  onChange={categoryToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.checklist !== "any" ? "text-info" : ""}`}
            >
              Чек-лист
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {checklistFilter.map((item) => (
              <Form.Check
                className={item.className}
                key={item.value}
                checked={item.value === filterStore.checklist}
                label={`${item.label}`}
                value={item.value}
                id={`checklist-${item.value}`}
                type="radio"
                name="filter-group-checklist"
                onChange={() => {
                  checklistTogglehandler(item.value);
                }}
              />
            ))}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default RoutineTaskFilter;
