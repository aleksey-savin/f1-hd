import { useState, useEffect, useMemo, useContext } from "react";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";
import useTicketCategoryFilterStore from "../../store/lists/ticket-categories";
import { AuthedUserContext } from "../../store/authed-user-context";

const TicketCategoryFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const { permissions } = useContext(AuthedUserContext);

  const filterStore = useTicketCategoryFilterStore();

  const items = filterStore.originalList;

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const alwaysWithinPlanToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      alwaysWithinPlan: !filterStore.alwaysWithinPlan,
    });
    filterStore.applyFilter();
  };

  const usersToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      users: !filterStore.users.includes(value)
        ? [...filterStore.users, value]
        : filterStore.users.filter((user) => user !== value),
    });
    filterStore.applyFilter();
  };

  const servicePlansToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      servicePlans: !filterStore.servicePlans.includes(value)
        ? [...filterStore.servicePlans, value]
        : filterStore.servicePlans.filter((plan) => plan !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  const [users, setUsers] = useState([]);
  useEffect(() => {
    let array = [];
    items.forEach((item) => {
      item.users.forEach((user) => {
        if (
          !array
            .map((user) => user._id.toString())
            .includes(user._id.toString())
        ) {
          array.push({
            _id: user._id.toString(),
            name: `${user.lastName} ${user.firstName}`,
          });
        }
      });
    });
    setUsers(array.sort((a, b) => a.name.localeCompare(b.name)));
  }, [items]);

  const [plans, setPlans] = useState([]);
  useEffect(() => {
    let array = [];
    items.forEach((item) => {
      item.servicePlans.forEach((plan) => {
        if (
          !array
            .map((plan) => plan._id.toString())
            .includes(plan._id.toString())
        ) {
          array.push({
            _id: plan._id.toString(),
            title: `${plan.title}`,
          });
        }
      });
    });
    setPlans(array.sort((a, b) => a.title.localeCompare(b.title)));
  }, [items]);

  const getListLengthBy = (list, itemName, item) => {
    let result = [];
    if (itemName === "servicePlan") {
      result = list.filter((category) =>
        category.servicePlans.map((plan) => plan._id).includes(item._id),
      ).length;
    } else if (itemName === "user") {
      result = list.filter((category) =>
        category.users.map((user) => user._id).includes(item._id),
      ).length;
    }

    return result;
  };

  const sortedUsers = useMemo(() => {
    return [...users]
      .sort((a, b) => {
        const aLength = getListLengthBy(filterStore.filteredList, "user", a);
        const bLength = getListLengthBy(filterStore.filteredList, "user", b);
        return bLength - aLength;
      })
      .sort((a, b) => {
        const aChecked = filterStore.users?.includes(a._id);
        const bChecked = filterStore.users?.includes(b._id);
        if (aChecked === bChecked) return 0;
        return aChecked ? -1 : 1;
      });
  }, [users, filterStore]);

  const sortedPlans = useMemo(() => {
    return [...plans]
      .sort((a, b) => {
        const aLength = getListLengthBy(
          filterStore.filteredList,
          "servicePlan",
          a,
        );
        const bLength = getListLengthBy(
          filterStore.filteredList,
          "servicePlan",
          b,
        );
        return bLength - aLength;
      })
      .sort((a, b) => {
        const aChecked = filterStore.servicePlans?.includes(a._id);
        const bChecked = filterStore.servicePlans?.includes(b._id);
        if (aChecked === bChecked) return 0;
        return aChecked ? -1 : 1;
      });
  }, [plans, filterStore]);

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
      {permissions.canUseFinancesModule && (
        <Row className="py-2">
          <Col>
            <Form.Check
              type="switch"
              id="always-within-plan"
              label="Всегда в рамках тарифного плана"
              value={filterStore.alwaysWithinPlan}
              checked={filterStore.alwaysWithinPlan}
              onChange={alwaysWithinPlanToggleHandler}
            />
          </Col>
        </Row>
      )}
      <Accordion className="py-2" activeKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.users?.length > 0 ? "text-info" : ""}`}
            >
              Пользователи
            </span>
          </AccordionHeader>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {sortedUsers.map((user) => {
              return (
                <Form.Check
                  key={user._id}
                  className={`${filterStore.users?.includes(user._id) ? "text-info" : ""}
                        ${
                          getListLengthBy(
                            filterStore.filteredList,
                            "user",
                            user,
                          ) === 0
                            ? "text-secondary"
                            : ""
                        } py-2`}
                  label={`${user.name} (${getListLengthBy(filterStore.filteredList, "user", user)})`}
                  value={user._id}
                  id={`user-${user._id}`}
                  checked={filterStore.users?.includes(user._id)}
                  type="checkbox"
                  name="filter-group-users"
                  onChange={usersToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2" activeKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.servicePlans?.length > 0 ? "text-info" : ""}`}
            >
              Услуги
            </span>
          </AccordionHeader>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {sortedPlans.map((plan) => {
              return (
                <Form.Check
                  key={plan._id}
                  className={`${filterStore.servicePlans?.includes(plan._id) ? "text-info" : ""}
                        ${
                          getListLengthBy(
                            filterStore.filteredList,
                            "servicePlan",
                            plan,
                          ) === 0
                            ? "text-secondary"
                            : ""
                        } py-2`}
                  label={`${plan.title} (${getListLengthBy(filterStore.filteredList, "servicePlan", plan)})`}
                  value={plan._id}
                  id={`plan-${plan._id}`}
                  checked={filterStore.servicePlans?.includes(plan._id)}
                  type="checkbox"
                  name="filter-group-plans"
                  onChange={servicePlansToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default TicketCategoryFilter;
