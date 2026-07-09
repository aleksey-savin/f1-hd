import { useState, useContext, useEffect } from "react";

import {
  utcToLocalForm,
  timeDateInputFormat,
  toDateTimeLocal,
} from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

import Select from "../../UI/Select";

import CheckIfWithinPlan from "./CheckIfWithinPlan";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import { AuthedUserContext } from "../../store/authed-user-context";
import FormWrapper from "../../UI/FormWrapper";

import { useLoaderData, useParams } from "react-router";
import useViewTicketStore from "../../store/view-ticket";

const WorkForm = ({ title }) => {
  const { ticket, otherCompanyTickets, responsibles, works } =
    useViewTicketStore();

  const {
    limitWorksDateFrom,
    hasServicePlan,
    schedule,
    pricePerHourNonWorking,
    tariffingPeriod,
    alwaysWithinPlan,
  } = useLoaderData();

  const { workId } = useParams();

  const work = works.find((work) => work._id.toString() === workId) || null;

  const { isAdmin, _id: userId } = useContext(AuthedUserContext);

  const [description, setDescription] = useState(work?.description || "");
  const [finishedBy, setFinishedBy] = useState(work?.finishedBy || "");
  const [visitRequired, setVisitRequired] = useState(
    work?.visitRequired || false,
  );

  const [startedAt, setStartedAt] = useState(
    work?.startedAt ? utcToLocalForm(work.startedAt) : "",
  );
  const [finishedAt, setFinishedAt] = useState(
    work?.finishedAt ? utcToLocalForm(work.finishedAt) : "",
  );
  // Уже привязанные заявки берём из work.linkedTickets (резолвятся бэкендом со
  // всеми связями работы), а не фильтром по otherCompanyTickets — иначе связи с
  // заявками вне кандидатного списка (другая категория и т.п.) не отображались бы
  // и терялись при сохранении. otherCompanyTickets остаётся списком опций для
  // добавления новых связей.
  const [linkToTickets, setLinkToTickets] = useState(
    (work?.linkedTickets || []).filter(
      (linked) => linked._id.toString() !== ticket._id.toString(),
    ),
  );
  const [workDuration, setWorkDuration] = useState("00:00 ч.");

  const workDurationHandler = () => {
    const duration =
      startedAt && finishedAt
        ? msToHMS(new Date(finishedAt) - new Date(startedAt))
        : "00:00 ч.";

    setWorkDuration(duration);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const finishedByChangeHandler = (selectedItem) => {
    setFinishedBy(selectedItem);
  };

  const setMe = () => {
    setFinishedBy(
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
    setStartedAt(event.target.value);
    setMinDate(event.target.value);
    workDurationHandler();
  };

  const addMinutes = (minutes) => {
    const date = finishedAt
      ? new Date(finishedAt)
      : startedAt
        ? new Date(startedAt)
        : new Date();
    setFinishedAt(
      timeDateInputFormat(new Date(date.getTime() + minutes * 60000)),
    );
  };

  const substractMinutes = (minutes) => {
    const date = startedAt
      ? new Date(startedAt)
      : finishedAt
        ? new Date(finishedAt)
        : new Date();
    setStartedAt(
      timeDateInputFormat(new Date(date.getTime() - minutes * 60000)),
    );
  };

  useEffect(() => {
    workDurationHandler();
  }, [startedAt, finishedAt]);

  const startedNowHandler = () => {
    // «Сейчас» — текущее настенное время в бизнес-таймзоне (сохранение идёт
    // через localToUtc, браузерное время дало бы сдвиг при другом поясе).
    setStartedAt(toDateTimeLocal());
    workDurationHandler();
  };

  const finishedNowHandler = () => {
    setFinishedAt(toDateTimeLocal());
    workDurationHandler();
  };

  return (
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
            required
            value={description}
            onChange={descriptionChangeHandler}
            id="description"
            name="description"
          />
        </Col>
      </Form.Group>
      <Form.Group as={Row}>
        <Form.Label column md="3">
          Начало
        </Form.Label>
        <Col sm="4" className="mb-3">
          <Form.Control
            required
            min={
              limitWorksDateFrom
                ? toDateTimeLocal(limitWorksDateFrom)
                : ""
            }
            type="datetime-local"
            value={startedAt}
            onChange={minDateChangeHandler}
            id="startedAt"
            name="startedAt"
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
          Окончание
        </Form.Label>
        <Col md="4" className="mb-3" onChange={workDurationHandler}>
          <Form.Control
            required
            type="datetime-local"
            value={finishedAt}
            onChange={(event) => {
              setFinishedAt(event.target.value);
            }}
            min={minDate}
            id="finishedAt"
            name="finishedAt"
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
        startedAt={startedAt}
        finishedAt={finishedAt}
        hasServicePlan={hasServicePlan}
        schedule={schedule}
        pricePerHourNonWorking={pricePerHourNonWorking}
        tariffingPeriod={tariffingPeriod}
        alwaysWithinPlan={alwaysWithinPlan}
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
              value={finishedBy}
              getOptionLabel={(option) =>
                `${option.lastName} ${option.firstName}`
              }
              getOptionValue={(option) => option._id}
              onChange={finishedByChangeHandler}
              id="finishedBy"
              name="finishedBy"
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
  );
};

export default WorkForm;
