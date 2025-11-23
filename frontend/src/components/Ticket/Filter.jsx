import { useState, useEffect, useContext, useMemo } from "react";

import useTicketFilterStore from "../../store/lists/tickets";
import useInitialPrefsStore from "../../store/prefs";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import { AuthedUserContext } from "../../store/authed-user-context";
import FilterContainer from "../../UI/FilterContainer";

const isToday = (date) => {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
};

const TicketFilter = () => {
  const {
    isAdmin,
    permissions,
    isEndUser,
    _id: userId,
  } = useContext(AuthedUserContext);

  const { modules } = useInitialPrefsStore();

  const { canSeeAllTickets = false, canAdministrateTickets = false } =
    permissions;

  const filterStore = useTicketFilterStore();

  const items = filterStore.originalList;

  // Фильтруем заявки на мои, необработанные, просроченные и к выполнению на сегодня
  const iAmResponsible = (tickets) =>
    tickets.filter((ticket) =>
      ticket.responsibles.map((resp) => resp._id).includes(userId),
    );

  const allActiveTickets = items.filter((ticket) => !ticket.isClosed);

  const notProcessedTickets = items
    .filter((ticket) => !ticket.isClosed)
    .filter((ticket) => ticket.state === "Новая");

  const overdueTickets = items
    .filter((ticket) => !ticket.isClosed)
    .filter((ticket) => new Date(ticket.deadline) < new Date());

  const todayTickets = items
    .filter((ticket) => !ticket.isClosed)
    .filter((ticket) =>
      // дедлайн на сегодня или просрочен
      isToday(new Date(ticket.deadline)),
    );

  const iAmApplicantTickets = items.filter(
    (ticket) =>
      ticket.applicant?._id?.toString() === userId && !ticket.isClosed,
  );

  const closedTickets = items.filter((ticket) => ticket.isClosed);

  const ticketToggleHandler = (nowActive) => {
    filterStore.updateFilter({ ...filterStore, nowActive: nowActive });
    filterStore.applyFilter();
  };

  const iAmResponsibleToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      iAmResponsible: !filterStore.iAmResponsible,
    });
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

  const commentsTogglehandler = (value) => {
    filterStore.updateFilter({ ...filterStore, comments: value });
    filterStore.applyFilter();
  };

  const scheduledWorksToggleHandler = (value) => {
    filterStore.updateFilter({ ...filterStore, scheduledWorks: value });
    filterStore.applyFilter();
  };

  const routineTaskToggleHandler = (value) => {
    filterStore.updateFilter({ ...filterStore, routineTask: value });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  // Получаем список компаний из всего списка заявок и исключаем дублирование
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    let array = [];
    items.forEach((ticket) => {
      if (
        !array
          .map((company) => company._id.toString())
          .includes(ticket.company?._id.toString())
      ) {
        array.push({
          _id: ticket.company?._id.toString(),
          alias: ticket.company?.alias,
        });
      }
    });
    setCompanies(array.sort((a, b) => a.alias.localeCompare(b.alias)));
  }, [items]);

  // Получаем список ответственных из всего списка заявок и исключаем дублирование
  const [responsibles, setResponsibles] = useState([]);
  useEffect(() => {
    let array = [];
    items.forEach((ticket) => {
      ticket.responsibles.forEach((resp) => {
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
  }, [items]);

  const customFilters = [
    {
      value: "all_active",
      label: "Все активные",
      length: filterStore.iAmResponsible
        ? iAmResponsible(allActiveTickets).length
        : allActiveTickets.length,
      className: `py-2  ${filterStore.nowActive === "all_active" ? "text-info" : ""}`,
    },
    {
      value: "i_am_applicant",
      label: "Созданы мной",
      length: filterStore.iAmResponsible
        ? iAmResponsible(iAmApplicantTickets).length
        : iAmApplicantTickets.length,
      className: `py-2  ${filterStore.nowActive === "i_am_applicant" ? "text-info" : ""}`,
    },
    {
      value: "today",
      label: "Сегодня дедлайн",
      length: filterStore.iAmResponsible
        ? iAmResponsible(todayTickets).length
        : todayTickets.length,
      className: `py-2  ${filterStore.nowActive === "today" ? "text-info" : ""}`,
    },
    {
      value: "overdue",
      label: "Просроченные",
      length: filterStore.iAmResponsible
        ? iAmResponsible(overdueTickets).length
        : overdueTickets.length,
      className: `py-2 ${filterStore.nowActive === "overdue" ? "text-info" : overdueTickets.length > 0 ? "text-danger" : ""}`,
    },
    {
      value: "not_processed",
      label: "Не обработанные",
      length: filterStore.iAmResponsible
        ? iAmResponsible(notProcessedTickets).length
        : notProcessedTickets.length,
      className: notProcessedTickets.length > 0 ? "text-warning py-2" : "py-2",
    },
    {
      value: "recently_closed",
      label: "Закрыты за последние 14 дней",
      length: filterStore.iAmResponsible
        ? iAmResponsible(closedTickets).length
        : closedTickets.length,
      className: `py-2  ${filterStore.nowActive === "recently_closed" ? "text-info" : ""}`,
    },
  ];

  const commentsFilter = [
    {
      value: "any",
      label: "Любое значение",
      className: `py-2 ${filterStore.comments === "any" ? "text-info" : ""}`,
    },
    {
      value: "present",
      label: "Есть",
      className: `py-2 ${filterStore.comments === "present" ? "text-info" : ""}`,
    },
    {
      value: "abcent",
      label: "Нет",
      className: `py-2 ${filterStore.comments === "abcent" ? "text-info" : ""}`,
    },
    {
      value: "more_than_1_day",
      label: "Нет более 24-х часов",
      className: `py-2 ${filterStore.comments === "more_than_1_day" ? "text-info" : ""}`,
    },
    {
      value: "no_comments_after_deadline",
      label: "Нет после нарушенного дедлайна",
      className: `py-2 ${filterStore.comments === "no_comments_after_deadline" ? "text-info" : ""}`,
    },
  ];

  const scheduledWorksFilter = [
    {
      value: "any",
      label: "Любое значение",
      className: `py-2 ${filterStore.scheduledWorks === "any" ? "text-info" : ""}`,
    },
    {
      value: "present",
      label: "Запланированы",
      className: `py-2 ${filterStore.scheduledWorks === "present" ? "text-info" : ""}`,
    },
    {
      value: "abcent",
      label: "Незапланированы",
      className: `py-2 ${filterStore.scheduledWorks === "abcent" ? "text-info" : ""}`,
    },
  ];

  const routineTaskFilter = [
    {
      value: "any",
      label: "Любое значение",
      className: `py-2 ${filterStore.routineTask === "any" ? "text-info" : ""}`,
    },
    {
      value: "present",
      label: "Только регламентные задачи",
      className: `py-2 ${filterStore.routineTask === "present" ? "text-info" : ""}`,
    },
    {
      value: "absent",
      label: "Скрыть регламентные задачи",
      className: `py-2 ${filterStore.routineTask === "absent" ? "text-info" : ""}`,
    },
  ];

  const getListLengthBy = (list = [], itemName, item) => {
    let result = [];
    if (itemName === "company") {
      result = list.filter((ticket) => ticket.company?._id === item._id).length;
    } else if (itemName === "responsible") {
      result = list.filter((ticket) =>
        ticket.responsibles.map((resp) => resp._id).includes(item._id),
      ).length;
    }

    return result;
  };

  const sortedCompanies = useMemo(() => {
    return [...companies]
      .sort((a, b) => {
        const aLength = filterStore.filteredList
          ? getListLengthBy(filterStore.filteredList, "company", a)
          : 0;
        const bLength = filterStore.filteredList
          ? getListLengthBy(filterStore.filteredList, "company", b)
          : 0;
        return bLength - aLength;
      })
      .sort((a, b) => {
        const aChecked = filterStore.companies?.includes(a._id);
        const bChecked = filterStore.companies?.includes(b._id);
        if (aChecked === bChecked) return 0;
        return aChecked ? -1 : 1;
      });
  }, [companies, filterStore]);

  const sortedResponsibles = useMemo(() => {
    return [...responsibles]
      .sort((a, b) => {
        const aLength = getListLengthBy(
          filterStore.filteredList,
          "responsible",
          a,
        );
        const bLength = getListLengthBy(
          filterStore.filteredList,
          "responsible",
          b,
        );
        return bLength - aLength;
      })
      .sort((a, b) => {
        const aChecked = filterStore.responsibles?.includes(a._id);
        const bChecked = filterStore.responsibles?.includes(b._id);
        if (aChecked === bChecked) return 0;
        return aChecked ? -1 : 1;
      });
  }, [responsibles, filterStore]);

  return (
    <FilterContainer resetFilterHandler={resetFilterHandler}>
      {(canAdministrateTickets || isAdmin || canSeeAllTickets) && (
        <Row className="py-2">
          <Col>
            <Form.Check
              type="switch"
              id="i-am-responsible"
              label="Назначены на меня"
              value={filterStore.iAmResponsible}
              checked={filterStore.iAmResponsible}
              onChange={iAmResponsibleToggleHandler}
            />
          </Col>
        </Row>
      )}
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.nowActive !== "all_active" ? "text-info" : ""}`}
            >
              Специальные фильтры
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {customFilters.map((item) => (
              <Form.Check
                className={item.className}
                key={item.value}
                checked={item.value === filterStore.nowActive}
                label={
                  item.label !== "Закрыты за последние 14 дней" &&
                  filterStore.nowActive !== "recently_closed"
                    ? `${item.label} (${item.length})`
                    : `${item.label}`
                }
                value={item.value}
                id={item.value}
                type="radio"
                name="filter-group-state"
                onChange={() => {
                  ticketToggleHandler(item.value);
                }}
                disabled={
                  item.value !== "all_active" &&
                  item.value !== "recently_closed" &&
                  item.length === 0
                }
              />
            ))}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      {!isEndUser && (
        <>
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
                      label={`${company.alias} (${filterStore.responsibles.length === 0 && filterStore.nowActive === "any" ? getListLengthBy(filterStore.originalList, "company", company) : getListLengthBy(filterStore.filteredList, "company", company)})`}
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
          {(canAdministrateTickets || isAdmin) && (
            <Accordion className="py-2">
              <Accordion.Item eventKey="0">
                <AccordionHeader>
                  <span
                    className={`${filterStore.responsibles?.length > 0 ? "text-info" : ""}`}
                  >
                    Ответственные
                  </span>
                </AccordionHeader>
                <Accordion.Body
                  style={{ maxHeight: "100svh", overflowY: "auto" }}
                >
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
          )}
          <Accordion className="py-2">
            <Accordion.Item eventKey="0">
              <AccordionHeader>
                <span
                  className={`${filterStore.routineTask !== "any" ? "text-info" : ""}`}
                >
                  Регламентные работы
                </span>
              </AccordionHeader>
              <Accordion.Body
                style={{ maxHeight: "100svh", overflowY: "auto" }}
              >
                {routineTaskFilter.map((item) => (
                  <Form.Check
                    className={item.className}
                    key={item.value}
                    checked={item.value === filterStore.routineTask}
                    label={`${item.label}`}
                    value={item.value}
                    id={`routine-task-${item.value}`}
                    type="radio"
                    name="filter-group-routine-task"
                    onChange={() => {
                      routineTaskToggleHandler(item.value);
                    }}
                  />
                ))}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
          <Accordion className="py-2">
            <Accordion.Item eventKey="0">
              <AccordionHeader>
                <span
                  className={`${filterStore.comments !== "any" ? "text-info" : ""}`}
                >
                  Комментарии
                </span>
              </AccordionHeader>
              <Accordion.Body
                style={{ maxHeight: "100svh", overflowY: "auto" }}
              >
                {commentsFilter.map((item) => (
                  <Form.Check
                    className={item.className}
                    key={item.value}
                    checked={item.value === filterStore.comments}
                    label={`${item.label}`}
                    value={item.value}
                    id={`comments-${item.value}`}
                    type="radio"
                    name="filter-group-comment"
                    onChange={() => {
                      commentsTogglehandler(item.value);
                    }}
                  />
                ))}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
          {modules.timeTracking.isActive && (
            <Accordion className="py-2">
              <Accordion.Item eventKey="0">
                <AccordionHeader>
                  <span
                    className={`${filterStore.scheduledWorks !== "any" ? "text-info" : ""}`}
                  >
                    Запланированные работы
                  </span>
                </AccordionHeader>
                <Accordion.Body
                  style={{ maxHeight: "100svh", overflowY: "auto" }}
                >
                  {scheduledWorksFilter.map((item) => (
                    <Form.Check
                      className={item.className}
                      key={item.value}
                      checked={item.value === filterStore.scheduledWorks}
                      label={`${item.label}`}
                      value={item.value}
                      id={`scheduled-works-${item.value}`}
                      type="radio"
                      name="filter-group-scheduled-works"
                      onChange={() => {
                        scheduledWorksToggleHandler(item.value);
                      }}
                    />
                  ))}
                </Accordion.Body>
              </Accordion.Item>
            </Accordion>
          )}
        </>
      )}
    </FilterContainer>
  );
};

export default TicketFilter;
