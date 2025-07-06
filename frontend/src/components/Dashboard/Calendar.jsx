import { Link } from "react-router";
import { useEffect, useState } from "react";

import FullCalendar from "@fullcalendar/react";

import listPlugin from "@fullcalendar/list";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import ToggleButton from "react-bootstrap/ToggleButton";

import Select from "../../UI/Select";

import { RiCalendarCheckFill } from "react-icons/ri";

import useInitialPrefsStore from "../../store/prefs";

import("../../css/calendar.css");

const DashboardCalendar = ({ scheduledWorks, tickets }) => {
  const { modules } = useInitialPrefsStore();
  const initialWorksEvents = scheduledWorks.map((work) => ({
    title: `${work.executor.lastName} ${
      work.executor.firstName
    }. Запланированы работы в ${work.company.alias} по ${
      work.tickets?.length > 1 ? "заявкам" : "заявке"
    } `,
    start: new Date(work.planningToStart),
    backgroundColor:
      new Date(work.planningToFinish) < new Date() ? "#e74c3c" : "#2c3e50",
    ticket: work.tickets[0]?.num,
    work: work,
    end: new Date(work.planningToFinish),
    executor: work.executor,
  }));

  const initialTicketsEvents = tickets
    .filter((ticket) => !ticket.isClosed)
    .map((ticket) => ({
      title: ticket.title,
      start: new Date(ticket.deadline),
      end: new Date(ticket.deadline),
      backgroundColor:
        new Date(ticket.deadline) < new Date() ? "#e74c3c" : "#2c3e50",
      ticket: ticket,
      responsibles: ticket.responsibles.map((resp) => resp._id.toString()),
    }));

  const [radioValue, setRadioValue] = useState("showTickets");
  const [events, setEvents] = useState(initialTicketsEvents);

  const radioValueChangeHandler = (e) => {
    setRadioValue(e.currentTarget.value);
    e.currentTarget.value === "showTickets"
      ? setEvents(initialTicketsEvents)
      : setEvents(initialWorksEvents);
  };

  const radios = modules.timeTracking.isActive
    ? [
        { name: "Заявки", value: "showTickets" },
        { name: "Работы", value: "showWorks" },
      ]
    : [{ name: "Заявки", value: "showTickets" }];

  const [executor, setExecutor] = useState();

  const executorChangeHandler = (selectedItem) => {
    setExecutor(selectedItem);
  };

  const [responsible, setResponsible] = useState();

  const responsibleChangeHandler = (selectedItem) => {
    setResponsible(selectedItem);
  };

  // Getting work executors and removing duplicated items
  let executors = scheduledWorks.map((work) => work.executor);
  const jsonObject = executors.map(JSON.stringify);
  const uniqueSet = new Set(jsonObject);
  executors = Array.from(uniqueSet).map(JSON.parse);

  useEffect(() => {
    if (executor) {
      setEvents(
        initialWorksEvents.filter(
          (event) => event.executor._id === executor._id,
        ),
      );
    } else {
      radioValue === "showTickets"
        ? setEvents(initialTicketsEvents)
        : setEvents(initialWorksEvents);
    }
  }, [executor, radioValue]);

  // Getting ticket responsibles and removing duplicated items
  let responsibles = [];
  tickets.map((ticket) => {
    for (let resp of ticket.responsibles) {
      if (
        !responsibles
          .map((user) => user._id.toString())
          .includes(resp._id.toString())
      ) {
        responsibles.push(resp);
      }
    }
    return ticket;
  });

  useEffect(() => {
    if (responsible) {
      setEvents(
        initialTicketsEvents.filter((event) =>
          event.responsibles.includes(responsible._id.toString()),
        ),
      );
    } else {
      radioValue === "showTickets"
        ? setEvents(initialTicketsEvents)
        : setEvents(initialWorksEvents);
    }
  }, [responsible, radioValue]);

  // a custom render function
  const renderEventContent = (eventInfo) => {
    const ticket = eventInfo.event.extendedProps.ticket;
    if (radioValue === "showTickets") {
      return (
        <>
          <b>{eventInfo.timeText}</b>

          <div>
            {ticket.responsibles?.map(
              (resp) => resp.lastName + " " + resp.firstName + ", ",
            )}
            крайний срок выполнения заявки{" "}
            <Link to={`/tickets/${ticket.num}`} style={{ color: "#18bc9c" }}>
              <u>{ticket.num}</u>
            </Link>{" "}
            от {ticket.company?.alias}.
          </div>
        </>
      );
    }
    if (radioValue === "showWorks") {
      const work = eventInfo.event.extendedProps.work;
      return (
        <>
          <b>{eventInfo.timeText}</b>
          <div>
            {eventInfo.event.title}{" "}
            {work?.tickets.map((ticket) => {
              return (
                <span key={ticket._id}>
                  <Link
                    to={`/tickets/${ticket.num}`}
                    style={{ color: "#18bc9c" }}
                  >
                    <u>{ticket.num}</u>
                  </Link>
                  {work.tickets[work.tickets.length - 1].num !== ticket.num
                    ? ", "
                    : ""}
                </span>
              );
            })}
            .
          </div>
        </>
      );
    }
  };

  return (
    <>
      <Row className="mb-3 pb-3 justify-content-between">
        <h1 className="display-5">
          <RiCalendarCheckFill /> Календарь
        </h1>
      </Row>
      <Row>
        <Col sm="auto" className="mb-3">
          <ButtonGroup>
            {radios.map((radio, idx) => (
              <ToggleButton
                key={idx}
                id={`radio-${idx}`}
                type="radio"
                variant="outline-primary"
                name="radio"
                value={radio.value}
                checked={radioValue === radio.value}
                onChange={radioValueChangeHandler}
              >
                {radio.name}
              </ToggleButton>
            ))}
          </ButtonGroup>
        </Col>
        {radioValue === "showTickets" && (
          <Col sm="auto" className="mb-3">
            <Form.Group className="mb-3">
              <Select
                id="executor"
                placeholder="Выберите ответственного"
                isClearable
                isSearchable
                options={responsibles}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option}
                onChange={responsibleChangeHandler}
              />
            </Form.Group>
          </Col>
        )}
        {radioValue === "showWorks" && (
          <Col sm="auto" className="mb-3">
            <Form.Group className="mb-3">
              <Select
                id="executor"
                placeholder="Выберите исполнителя"
                isClearable
                isSearchable
                options={executors}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option}
                onChange={executorChangeHandler}
              />
            </Form.Group>
          </Col>
        )}
      </Row>
      <Row className="mb-3">
        <Col sm="12">
          <FullCalendar
            plugins={[listPlugin]}
            initialView="listWeek"
            weekends={true}
            events={events}
            locale="ru"
            eventContent={renderEventContent}
            noEventsContent="Нет запланированных событий"
            headerToolbar={{
              start: "title",
              center: "",
              end: "today prev,next",
            }}
            firstDay={1}
            themeSystem="bootstrap5"
            height={"auto"}
            buttonText={{
              today: "сегодня",
            }}
          />
        </Col>
      </Row>
    </>
  );
};

export default DashboardCalendar;
