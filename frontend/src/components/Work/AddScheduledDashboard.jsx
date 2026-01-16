import { useState, useRef, useContext } from "react";

import pad from "pad";

import useHttp from "../../hooks/use-http";

import { changeTimezone } from "../../util/format-date";

import Select from "../../UI/Select";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Modal from "react-bootstrap/Modal";
import Dropdown from "react-bootstrap/Dropdown";

import useToastStore from "../../store/toast-store";

import { AuthedUserContext } from "../../store/authed-user-context";

import { AiOutlinePlusCircle } from "react-icons/ai";
import { getLocalStorageData } from "../../util/auth";

const ScheduleWorkDashboard = ({
  responsibles,
  setWorks,
  tickets,
  buttonType,
}) => {
  const { showToast } = useToastStore();
  const { token } = getLocalStorageData();
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);

  const usersList = responsibles;
  const [ticketsList, setTicketsList] = useState([]);

  let companies = tickets.map((ticket) => ticket.company);
  const jsonObject = companies.map(JSON.stringify);
  const uniqueSet = new Set(jsonObject);
  companies = Array.from(uniqueSet).map(JSON.parse);

  const [executor, setExecutor] = useState();
  const [company, setCompany] = useState();
  const [visitRequired, setVisitRequired] = useState(false);

  const planningToStartInputRef = useRef();
  const planningToFinishInputRef = useRef();

  const [linkToTickets, setLinkToTickets] = useState([]);

  const linkToTicketsHandler = (selectedItems) => {
    setLinkToTickets(selectedItems);
  };

  const executorChangeHandler = (selectedItem) => {
    setExecutor(selectedItem);
  };

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
    setTicketsList(
      tickets.filter(
        (ticket) =>
          ticket.company._id.toString() === selectedItem._id.toString(),
      ),
    );
  };

  const setMe = () => {
    setExecutor(
      usersList.filter((user) => user._id.toString() === userId.toString())[0],
    );
  };

  const visitRequiredHandler = () => {
    setVisitRequired(!visitRequired);
  };

  const { sendRequest: postScheduledWorkHandler } = useHttp();

  const [minDate, setMinDate] = useState("");
  const minDateChangeHandler = (event) => {
    setMinDate(event.target.value);
  };

  const submitHandler = (event) => {
    event.preventDefault();

    const linkedTickets = linkToTickets.map((ticket) => ticket._id);

    const work = {
      tickets: linkedTickets,
      company: company._id,
      visitRequired: visitRequired,
      planningToStart: new Date(planningToStartInputRef.current.value),
      planningToFinish: new Date(planningToFinishInputRef.current.value),
      executor: isAdmin ? executor : userId,
    };

    const createWork = (data) => {
      showToast("success text-white", "Работа добавлена");

      setShowAddModal(false);

      const createdWork = {
        _id: data.work._id,
        tickets: data.work.tickets,
        description: data.work.description,
        visitRequired: data.work.visitRequired,
        planningToStart: data.work.planningToStart,
        planningToFinish: data.work.planningToFinish,
        executor: data.work.executor,
        createdBy: data.work.createdBy,
        createdAt: data.work.createdAt,
      };
      setWorks((prevWorksList) => [...prevWorksList, createdWork]);

      planningToFinishInputRef.current.value = "";
      planningToFinishInputRef.current.value = "";
    };

    postScheduledWorkHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/works/schedule/`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: work,
      },
      (data) => {
        if (data.work) {
          createWork(data);
        } else {
          showToast("danger text-white", data.message);
        }
      },
    );
  };

  const [showAddModal, setShowAddModal] = useState(false);

  const handleCloseAddModal = () => setShowAddModal(false);
  const handleShowAddModal = () => setShowAddModal(true);

  function addMinutes(minutes) {
    const date = planningToFinishInputRef.current.value
      ? new Date(planningToFinishInputRef.current.value)
      : planningToStartInputRef.current.value
        ? new Date(planningToStartInputRef.current.value)
        : null;
    if (date) {
      planningToFinishInputRef.current.value = changeTimezone(
        new Date(date.getTime() + minutes * 60000),
      );
    } else {
      document.getElementById("planning-to-start").focus();
    }

    workDurationHandler();
    return;
  }

  const [workDuration, setWorkDuration] = useState("00:00 ч.");

  const workDurationHandler = () => {
    if (
      planningToFinishInputRef.current?.value &&
      planningToStartInputRef.current?.value
    ) {
      setWorkDuration(
        msToHMS(
          new Date(planningToFinishInputRef.current?.value || "") -
            new Date(planningToStartInputRef.current?.value || ""),
        ),
      );
    } else {
      setWorkDuration("00:00 ч.");
    }
  };

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized =
      [pad(2, hours.toString(), "0"), pad(2, minutes.toString(), "0")].join(
        ":",
      ) + " ч.";

    return humanized;
  };

  return (
    <>
      {buttonType !== "dropdown" && (
        <Button size="lg" className="w-100 my-3" onClick={handleShowAddModal}>
          <AiOutlinePlusCircle size="1.3em" /> Работы
        </Button>
      )}
      {buttonType === "dropdown" && (
        <Dropdown.Item
          size="lg"
          className="w-100 mb-3"
          onClick={handleShowAddModal}
        >
          Работы
        </Dropdown.Item>
      )}

      <Modal
        centered
        size="lg"
        show={showAddModal}
        onHide={handleCloseAddModal}
      >
        <Modal.Header closeButton>
          <Modal.Title>Запланировать работы</Modal.Title>
        </Modal.Header>
        <Form onSubmit={submitHandler}>
          <Modal.Body>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm="4">
                Требуется выезд
              </Form.Label>
              <Col sm="auto" className="mt-2">
                <Form.Check
                  value={visitRequired}
                  onClick={visitRequiredHandler}
                  type="switch"
                  name="visitRequired"
                />
              </Col>
            </Form.Group>
            <Form.Group as={Row}>
              <Form.Label column sm="4">
                Планируемое начало
              </Form.Label>
              <Col sm="auto" className="mb-3" onChange={workDurationHandler}>
                <Form.Control
                  required
                  id="planning-to-start"
                  type="datetime-local"
                  ref={planningToStartInputRef}
                  onChange={minDateChangeHandler}
                />
              </Col>
            </Form.Group>
            <Form.Group as={Row}>
              <Form.Label column sm="4">
                Планируемое окончание
              </Form.Label>
              <Col sm="auto" className="mb-3" onChange={workDurationHandler}>
                <Form.Control
                  required
                  type="datetime-local"
                  ref={planningToFinishInputRef}
                  min={minDate}
                />
              </Col>
              <Col xs="auto" className="mb-3">
                <Button
                  onClick={() => {
                    addMinutes(60);
                  }}
                >
                  +1 час
                </Button>
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm="4">
                Ожидаемая длительность
              </Form.Label>
              <Form.Label column sm="8">
                <strong>{workDuration}</strong>
              </Form.Label>
            </Form.Group>
            {isAdmin && (
              <Form.Group as={Row}>
                <Form.Label column sm="4">
                  Исполнитель
                </Form.Label>
                <Col sm="7" className="mb-3">
                  <Select
                    isSearchable
                    required
                    options={usersList}
                    value={executor}
                    getOptionLabel={(option) =>
                      `${option.lastName} ${option.firstName}`
                    }
                    getOptionValue={(option) => option._id}
                    onChange={executorChangeHandler}
                  />
                </Col>
                <Col xs="auto">
                  <Button onClick={setMe}>Я</Button>
                </Col>
              </Form.Group>
            )}
            <Form.Group as={Row}>
              <Form.Label column sm="4">
                Компания
              </Form.Label>
              <Col sm="7" className="mb-3">
                <Select
                  isSearchable
                  required
                  options={companies}
                  value={company}
                  getOptionLabel={(option) => option.alias}
                  getOptionValue={(option) => option}
                  onChange={companyChangeHandler}
                />
              </Col>
            </Form.Group>
            <Form.Group as={Row} className="mb-3">
              <Form.Label htmlFor="ticketsList" column sm="4">
                Заявки
              </Form.Label>
              <Col sm="8" className="mb-3">
                <Select
                  id="ticketsList"
                  placeholder="Выберите заявки"
                  closeMenuOnSelect={false}
                  isClearable
                  isSearchable
                  isMulti
                  value={linkToTickets}
                  options={ticketsList}
                  getOptionLabel={(option) => `${option.num} / ${option.title}`}
                  getOptionValue={(option) => option._id}
                  onChange={linkToTicketsHandler}
                />
              </Col>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseAddModal}>
              Закрыть
            </Button>
            <Button type="submit" variant="primary">
              Добавить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default ScheduleWorkDashboard;
