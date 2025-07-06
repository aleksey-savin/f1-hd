import { useState, useEffect, useMemo } from "react";

import useCompanyFilterStore from "../../store/lists/companies";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

const CompanyFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useCompanyFilterStore();

  const respToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      responsibles: !filterStore.responsibles.includes(value)
        ? [...filterStore.responsibles, value]
        : filterStore.responsibles.filter((resp) => resp !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  // Получаем список ответственных из всего списка заявок и исключаем дублирование
  const [responsibles, setResponsibles] = useState([]);
  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((company) => {
      company.responsibles.forEach((resp) => {
        if (
          !array
            .map((user) => user._id.toString())
            .includes(resp._id.toString())
        ) {
          array.push({
            _id: resp._id.toString(),
            name: `${resp.lastName} ${resp.firstName}`,
          });
        }
      });
    });
    setResponsibles(array.sort((a, b) => a.name.localeCompare(b.name)));
  }, [filterStore.originalList]);

  const getListLengthBy = (list, itemName, item) => {
    let result = [];
    if (itemName === "responsible") {
      result = list.filter((ticket) =>
        ticket.responsibles.map((resp) => resp._id).includes(item._id),
      ).length;
    }

    return result;
  };

  const sortedResponsibles = useMemo(() => {
    return [...responsibles].sort((a, b) => {
      const aChecked = filterStore.responsibles?.includes(a._id);
      const bChecked = filterStore.responsibles?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [responsibles, filterStore.responsibles]);

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.responsibles?.length > 0 ? "text-info" : ""}`}
            >
              Ответственные
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedResponsibles.map((resp) => {
              return (
                <Form.Check
                  key={resp._id}
                  className={`${filterStore.responsibles?.includes(resp._id) ? "text-info" : ""}
                        ${
                          getListLengthBy(
                            filterStore.filteredList,
                            "responsible",
                            resp,
                          ) === 0
                            ? "text-secondary"
                            : ""
                        } py-2`}
                  label={`${resp.name} (${getListLengthBy(filterStore.filteredList, "responsible", resp)})`}
                  value={resp._id}
                  id={`resp-${resp._id}`}
                  checked={filterStore.responsibles?.includes(resp._id)}
                  type="checkbox"
                  name="filter-group-responsibles"
                  onChange={respToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default CompanyFilter;
