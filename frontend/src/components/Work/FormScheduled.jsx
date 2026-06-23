import { useState, useContext, useEffect } from "react";

import { timeDateInputFormat } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

import Select from "../../UI/Select";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import { AuthedUserContext } from "../../store/authed-user-context";
import FormWrapper from "../../UI/FormWrapper";

import CheckIfWithinPlan from "./CheckIfWithinPlan";

import useViewTicketStore from "../../store/view-ticket";
import { useParams } from "react-router";

const FormScheduled = ({ title }) => {
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);
  const { ticket, company, works, responsibles, otherCompanyTickets } =
    useViewTicketStore();

  const { workId } = useParams();
  const work = works.find((work) => work._id.toString() === workId);

  const [description, setDescription] = useState(work?.description || "");
  const [executor, setExecutor] = useState(work?.executor || "");
  const [visitRequired, setVisitRequired] = useState(
    work?.visitRequired || false,
  );

  const [planningToStart, setPlanningToStart] = useState(
    work?.planningToStart ? timeDateInputFormat(work.planningToStart) : "",
  );
  const [planningToFinish, setPlanningToFinish] = useState(
    work?.planningToFinish ? timeDateInputFormat(work.planningToFinish) : "",
  );
  // См. Work/Form.jsx: значение берём из work.linkedTickets (все связи работы),
  // а otherCompanyTickets оставляем как список опций для добавления новых.
  const [linkToTickets, setLinkToTickets] = useState(
    (work?.linkedTickets || []).filter(
      (linked) => linked._id.toString() !== ticket._id.toString(),
    ),
  );
  const [workDuration, setWorkDuration] = useState("00:00 ч.");

  const workDurationHandler = () => {
    const duration =
      planningToStart && planningToFinish
        ? msToHMS(new Date(planningToFinish) - new Date(planningToStart))
        : "00:00 ч.";

    setWorkDuration(duration);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const executorChangeHandler = (selectedItem) => {
    setExecutor(selectedItem);
  };

  const setMe = () => {
    setExecutor(
      responsibles.filter(
        (user) => user._id.toString() === userId.toString(),
      )[0],
    );
  };

  const visitRequiredHandler = () => {
    setVisitRequired(!visitRequired);
  };

  const linkToTicketsHandler = (selectedItems) => {
    setLinkToTickets(selectedItems);
  };

  const [minDate, setMinDate] = useState("");
  const minDateChangeHandler = (event) => {
    setPlanningToStart(event.target.value);
    setMinDate(event.target.value);
    workDurationHandler();
  };

  const addMinutes = (minutes) => {
    const date = planningToFinish
      ? new Date(planningToFinish)
      : planningToStart
        ? new Date(planningToStart)
        : new Date();
    setPlanningToFinish(
      timeDateInputFormat(new Date(date.getTime() + minutes * 60000)),
    );
  };

  const substractMinutes = (minutes) => {
    const date = planningToStart
      ? new Date(planningToStart)
      : planningToFinish
        ? new Date(planningToFinish)
        : new Date();
    setPlanningToStart(
      timeDateInputFormat(new Date(date.getTime() - minutes * 60000)),
    );
  };

  useEffect(() => {
    workDurationHandler();
  }, [planningToStart, planningToFinish]);

  const startedNowHandler = () => {
    setPlanningToStart(timeDateInputFormat(new Date()));
    workDurationHandler();
  };

  const finishedNowHandler = () => {
    setPlanningToFinish(timeDateInputFormat(new Date()));
    workDurationHandler();
  };

  return (
    <>
      <FormWrapper title={title}>
        <Form.Group as={Row} className="mb-3">
          <Form.Label column md="3">
            Выезд
          </Form.Label>
          <Col md="auto" className="mt-2">
            <Form.Check
              type="switch"
              checked={visitRequired}
              value={visitRequired}
              onChange={visitRequiredHandler}
              id="visitRequired"
              name="visitRequired"
            />
          </Col>
        </Form.Group>
        <Form.Group as={Row}>
          <Form.Label column md="3">
            Описание
          </Form.Label>
          <Col md="9" className="mb-3">
            <Form.Control
              as="textarea"
              rows={3}
              value={description}
              onChange={descriptionChangeHandler}
              id="description"
              name="description"
            />
          </Col>
        </Form.Group>
        <Form.Group as={Row}>
          <Form.Label column md="3">
            Планируемое начало
          </Form.Label>
          <Col sm="4" className="mb-3">
            <Form.Control
              required
              type="datetime-local"
              value={planningToStart}
              onChange={minDateChangeHandler}
              id="planningToStart"
              name="planningToStart"
            />
          </Col>

          <Col xs="auto" className="mb-3">
            <Button onClick={startedNowHandler}>Сейчас</Button>
          </Col>
          <Col xs="auto" className="mb-3">
            <Button
              onClick={() => {
                substractMinutes(10);
              }}
            >
              -10 мин
            </Button>
          </Col>
          <Col xs="auto">
            <Button
              onClick={() => {
                substractMinutes(30);
              }}
            >
              -30 мин
            </Button>
          </Col>
        </Form.Group>
        <Form.Group as={Row}>
          <Form.Label column md="3">
            Планируемое окончание
          </Form.Label>
          <Col md="4" className="mb-3" onChange={workDurationHandler}>
            <Form.Control
              required
              type="datetime-local"
              value={planningToFinish}
              onChange={(event) => {
                setPlanningToFinish(event.target.value);
              }}
              min={minDate}
              id="planningToFinish"
              name="planningToFinish"
            />
          </Col>

          <Col xs="auto" className="mb-3">
            <Button onClick={finishedNowHandler}>Сейчас</Button>
          </Col>
          <Col xs="auto" className="mb-3">
            <Button
              onClick={() => {
                addMinutes(10);
              }}
            >
              +10 мин
            </Button>
          </Col>
          <Col xs="auto">
            <Button
              onClick={() => {
                addMinutes(30);
              }}
            >
              +30 мин
            </Button>
          </Col>
        </Form.Group>
        <Form.Group as={Row} className="mb-3">
          <Form.Label column sm="3">
            Длительность
          </Form.Label>
          <Form.Label column sm="9">
            <strong>{workDuration}</strong>
          </Form.Label>
        </Form.Group>
        <CheckIfWithinPlan
          work={work}
          company={company}
          ticket={ticket}
          startedAt={planningToStart}
          finishedAt={planningToFinish}
        />
        {isAdmin && (
          <Form.Group as={Row}>
            <Form.Label column sm="3">
              Исполнитель
            </Form.Label>
            <Col sm="8" className="mb-3">
              <Select
                isSearchable
                required
                options={responsibles}
                value={executor}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={executorChangeHandler}
                id="executor"
                name="executor"
              />
            </Col>
            <Col xs="auto">
              <Button onClick={setMe}>Я</Button>
            </Col>
          </Form.Group>
        )}
        <Form.Group as={Row}>
          <Form.Control
            defaultValue={ticket._id}
            id="ticketId"
            name="ticketId"
            hidden
          />
        </Form.Group>
        <Form.Group as={Row}>
          <Form.Control
            defaultValue={ticket.num}
            id="ticketNum"
            name="ticketNum"
            hidden
          />
        </Form.Group>
        <Form.Group as={Row}>
          <Form.Control
            defaultValue={work?.scheduled}
            id="scheduled"
            name="scheduled"
            hidden
          />
        </Form.Group>
        {work && (
          <Form.Group as={Row}>
            <Form.Control
              defaultValue={work._id}
              id="workId"
              name="workId"
              hidden
            />
          </Form.Group>
        )}
        <Form.Group as={Row} className="mb-3">
          <Form.Label htmlFor="linkToTickets" column sm="3">
            Также привязать к
          </Form.Label>
          <Col sm="9" className="mb-3">
            <Select
              placeholder="Выберите заявки"
              closeMenuOnSelect={false}
              isClearable
              isSearchable
              isMulti
              value={linkToTickets}
              options={otherCompanyTickets}
              getOptionLabel={(option) => `${option.num} / ${option.title}`}
              getOptionValue={(option) => option._id}
              onChange={linkToTicketsHandler}
              id="linkToTickets"
              name="linkToTickets"
            />
          </Col>
        </Form.Group>
      </FormWrapper>
    </>
  );
};

export default FormScheduled;
