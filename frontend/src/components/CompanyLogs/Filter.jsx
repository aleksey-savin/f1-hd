import { useState, useEffect, useMemo } from "react";

import useCompanyLogsFilterStore from "../../store/lists/companyLogs";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

const CompanyLogsFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useCompanyLogsFilterStore();

  const actionToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      actions: !filterStore.actions.includes(value)
        ? [...filterStore.actions, value]
        : filterStore.actions.filter((action) => action !== value),
    });
    filterStore.applyFilter();
  };

  const linkedUserToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      linkedUsers: !filterStore.linkedUsers.includes(value)
        ? [...filterStore.linkedUsers, value]
        : filterStore.linkedUsers.filter((status) => status !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  // Получаем список доступных действий из всех логов
  const [availableActions, setAvailableActions] = useState([]);
  useEffect(() => {
    const actions = [...new Set(filterStore.originalList?.map((log) => log.action) || [])];
    const actionLabels = {
      userLogin: "Вход в систему",
    };

    const mappedActions = actions.map((action) => ({
      value: action,
      label: actionLabels[action] || action,
    }));

    setAvailableActions(mappedActions);
  }, [filterStore.originalList]);

  const getListLengthBy = (list, filterType, value) => {
    if (filterType === "action") {
      return list.filter((log) => log.action === value).length;
    }
    if (filterType === "linkedStatus") {
      if (value === "linked") {
        return list.filter((log) => log.userId !== null).length;
      }
      if (value === "unlinked") {
        return list.filter((log) => log.userId === null).length;
      }
    }
    return 0;
  };

  const sortedActions = useMemo(() => {
    return [...availableActions].sort((a, b) => {
      const aChecked = filterStore.actions?.includes(a.value);
      const bChecked = filterStore.actions?.includes(b.value);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [availableActions, filterStore.actions]);

  const linkedStatusOptions = [
    { value: "linked", label: "Связанные" },
    { value: "unlinked", label: "Не связанные" },
  ];

  const sortedLinkedStatus = useMemo(() => {
    return [...linkedStatusOptions].sort((a, b) => {
      const aChecked = filterStore.linkedUsers?.includes(a.value);
      const bChecked = filterStore.linkedUsers?.includes(b.value);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [filterStore.linkedUsers]);

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Accordion className="py-2" defaultActiveKey={["0", "1"]} alwaysOpen>
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.actions?.length > 0 ? "text-info" : ""}`}
            >
              Действия
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedActions.map((action) => {
              const count = getListLengthBy(filterStore.filteredList, "action", action.value);
              return (
                <Form.Check
                  key={action.value}
                  className={`${filterStore.actions?.includes(action.value) ? "text-info" : ""}
                    ${count === 0 ? "text-secondary" : ""} py-2`}
                  label={`${action.label} (${count})`}
                  value={action.value}
                  id={`action-${action.value}`}
                  checked={filterStore.actions?.includes(action.value)}
                  type="checkbox"
                  name="filter-group-actions"
                  onChange={actionToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="1">
          <AccordionHeader>
            <span
              className={`${filterStore.linkedUsers?.length > 0 ? "text-info" : ""}`}
            >
              Статус связывания
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedLinkedStatus.map((status) => {
              const count = getListLengthBy(filterStore.filteredList, "linkedStatus", status.value);
              return (
                <Form.Check
                  key={status.value}
                  className={`${filterStore.linkedUsers?.includes(status.value) ? "text-info" : ""}
                    ${count === 0 ? "text-secondary" : ""} py-2`}
                  label={`${status.label} (${count})`}
                  value={status.value}
                  id={`linked-${status.value}`}
                  checked={filterStore.linkedUsers?.includes(status.value)}
                  type="checkbox"
                  name="filter-group-linked"
                  onChange={linkedUserToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default CompanyLogsFilter;
