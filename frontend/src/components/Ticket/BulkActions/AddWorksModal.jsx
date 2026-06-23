import { useState, useEffect, useMemo, useContext } from "react";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";

import Select from "../../../UI/Select";
import CheckIfWithinPlan from "../../Work/CheckIfWithinPlan";

import { AuthedUserContext } from "../../../store/authed-user-context";
import { getLocalStorageData } from "../../../util/auth";
import { timeDateInputFormat } from "../../../util/format-date";
import { msToHMS } from "../../../util/time-helpers";

const emptyPlan = {
  hasServicePlan: false,
  schedule: {},
  pricePerHourNonWorking: 0,
  tariffingPeriod: 0,
  alwaysWithinPlan: false,
  limitWorksDateFrom: null,
};

// Массовое добавление работ: одна запись работы привязывается сразу ко всем
// выбранным заявкам (поле Work.tickets[]). Все заявки одной компании (гарантирует
// eligibility), поэтому интерфейс полностью повторяет добавление работы к
// одиночной заявке: описание, выезд, время с хелперами, выбор исполнителя, блок
// «в рамках плана».
const AddWorksModal = ({ show, onHide, selectedItems, onConfirm }) => {
  const {
    isAdmin,
    _id: userId,
    firstName,
    lastName,
  } = useContext(AuthedUserContext);

  const [description, setDescription] = useState("");
  const [visitRequired, setVisitRequired] = useState(false);
  const [startedAt, setStartedAt] = useState("");
  const [finishedAt, setFinishedAt] = useState("");
  const [finishedBy, setFinishedBy] = useState("");
  const [withinPlan, setWithinPlan] = useState(false);

  const [plan, setPlan] = useState(emptyPlan);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);

  // Исполнители для выбора — объединение ответственных всех выбранных заявок.
  const executorOptions = useMemo(() => {
    const map = new Map();
    for (const t of selectedItems) {
      for (const r of t.responsibles || []) {
        map.set(r._id.toString(), r);
      }
    }
    return [...map.values()];
  }, [selectedItems]);

  // При открытии подтягиваем данные плана компании (все заявки одной компании) —
  // для блока «в рамках плана» и ограничения минимальной даты работ.
  useEffect(() => {
    if (!show || !selectedItems.length) return;
    let active = true;
    const num = selectedItems[0].num;
    const { token } = getLocalStorageData();
    setPlanLoading(true);
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/works/additional-data/${num}`,
      { headers: { Authorization: "Bearer " + token } },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) {
          setPlan({ ...emptyPlan, ...data });
          setPlanLoaded(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPlanLoading(false);
      });
    return () => {
      active = false;
    };
  }, [show, selectedItems]);

  const workDuration =
    startedAt && finishedAt
      ? msToHMS(new Date(finishedAt) - new Date(startedAt))
      : "00:00 ч.";

  const startedNow = () => setStartedAt(timeDateInputFormat(new Date()));
  const finishedNow = () => setFinishedAt(timeDateInputFormat(new Date()));

  const addMinutes = (minutes) => {
    const base = finishedAt
      ? new Date(finishedAt)
      : startedAt
        ? new Date(startedAt)
        : new Date();
    setFinishedAt(
      timeDateInputFormat(new Date(base.getTime() + minutes * 60000)),
    );
  };

  const substractMinutes = (minutes) => {
    const base = startedAt
      ? new Date(startedAt)
      : finishedAt
        ? new Date(finishedAt)
        : new Date();
    setStartedAt(
      timeDateInputFormat(new Date(base.getTime() - minutes * 60000)),
    );
  };

  const setMe = () => setFinishedBy({ _id: userId, firstName, lastName });

  const reset = () => {
    setDescription("");
    setVisitRequired(false);
    setStartedAt("");
    setFinishedAt("");
    setFinishedBy("");
    setWithinPlan(false);
    setPlan(emptyPlan);
    setPlanLoaded(false);
    setPlanLoading(false);
  };

  const close = () => {
    reset();
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({
      description,
      visitRequired,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      finishedBy: finishedBy?._id,
      withinPlan,
    });
    close();
  };

  return (
    <Modal show={show} onHide={close} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Добавить работы ({selectedItems.length})</Modal.Title>
      </Modal.Header>
      <Form onSubmit={submitHandler}>
        <Modal.Body>
          <p className="text-muted">
            Одна запись работы будет привязана ко всем выбранным заявкам.
          </p>
          <Form.Group as={Row} className="mb-3">
            <Form.Label column md="3">
              Выезд
            </Form.Label>
            <Col md="auto" className="mt-2">
              <Form.Check
                type="switch"
                checked={visitRequired}
                onChange={() => setVisitRequired((v) => !v)}
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
                onChange={(e) => setDescription(e.target.value)}
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
                  plan.limitWorksDateFrom
                    ? timeDateInputFormat(new Date(plan.limitWorksDateFrom))
                    : ""
                }
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </Col>
            <Col xs="auto" className="mb-3">
              <Button onClick={startedNow}>Сейчас</Button>
            </Col>
            <Col xs="auto" className="mb-3">
              <Button onClick={() => substractMinutes(10)}>-10 мин</Button>
            </Col>
            <Col xs="auto">
              <Button onClick={() => substractMinutes(30)}>-30 мин</Button>
            </Col>
          </Form.Group>
          <Form.Group as={Row}>
            <Form.Label column md="3">
              Окончание
            </Form.Label>
            <Col md="4" className="mb-3">
              <Form.Control
                required
                type="datetime-local"
                value={finishedAt}
                onChange={(e) => setFinishedAt(e.target.value)}
                min={startedAt}
              />
            </Col>
            <Col xs="auto" className="mb-3">
              <Button onClick={finishedNow}>Сейчас</Button>
            </Col>
            <Col xs="auto" className="mb-3">
              <Button onClick={() => addMinutes(10)}>+10 мин</Button>
            </Col>
            <Col xs="auto">
              <Button onClick={() => addMinutes(30)}>+30 мин</Button>
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
          {planLoading && (
            <div className="text-center my-2 text-muted">
              <Spinner animation="border" size="sm" /> Загрузка данных…
            </div>
          )}
          {planLoaded && (
            <CheckIfWithinPlan
              startedAt={startedAt}
              finishedAt={finishedAt}
              hasServicePlan={plan.hasServicePlan}
              schedule={plan.schedule}
              pricePerHourNonWorking={plan.pricePerHourNonWorking}
              tariffingPeriod={plan.tariffingPeriod}
              alwaysWithinPlan={plan.alwaysWithinPlan}
              onWithinPlanChange={setWithinPlan}
            />
          )}
          {isAdmin && (
            <Form.Group as={Row}>
              <Form.Label column sm="3">
                Исполнитель
              </Form.Label>
              <Col sm="8" className="mb-3">
                <Select
                  isSearchable
                  required
                  options={executorOptions}
                  value={finishedBy}
                  getOptionLabel={(option) =>
                    `${option.lastName} ${option.firstName}`
                  }
                  getOptionValue={(option) => option._id}
                  onChange={setFinishedBy}
                />
              </Col>
              <Col xs="auto">
                <Button onClick={setMe}>Я</Button>
              </Col>
            </Form.Group>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button type="submit">Добавить</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddWorksModal;
