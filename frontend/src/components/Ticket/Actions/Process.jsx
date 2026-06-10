import { useState, useRef, useCallback, useEffect, useContext } from "react";

import useTicketAction from "../../../hooks/use-ticket-action";
import useHttp from "../../../hooks/use-http";
import { utcToLocalForm } from "../../../util/format-date";

import Select from "../../../UI/Select";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";

import { RiFileEditLine } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";
import { getLocalStorageData } from "../../../util/auth";

const ProcessTicket = ({ ticket }) => {
  const fetcher = useTicketAction();

  const { token } = getLocalStorageData();
  const { permissions, isAdmin } = useContext(AuthedUserContext);
  const { canAdministrateTickets } = permissions;

  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [category, setCategory] = useState(ticket.category);
  const [responsibles, setResponsibles] = useState([]);
  const [company, setCompany] = useState(ticket.company);
  const [applicant, setApplicant] = useState(ticket.applicant);
  const [applicantsList, setApplicantsList] = useState([]);

  const deadlineInputRef = useRef();

  const titleChangeHandler = (event) => {
    setTitle(event.target.value);
  };

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
  };

  const applicantChangeHandler = (selectedItem) => {
    setApplicant(selectedItem);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const categoryChangeHandler = (selectedItem) => {
    setCategory(selectedItem);
  };

  const responsiblesChangeHandler = (selectedUsers) => {
    setResponsibles(selectedUsers);
  };

  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };

  const closeModal = () => {
    setShow(false);
  };

  const [formData, setFormData] = useState({});
  const { sendRequest: fetchFormDataHandler } = useHttp();

  const fetchFormData = useCallback(() => {
    fetchFormDataHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      (data) => {
        setFormData(data);
      },
    );
  }, [fetchFormDataHandler, token]);

  useEffect(() => {
    fetchFormData();
  }, [fetchFormData]);

  const fetchApplicants = useCallback(() => {
    const users = formData.applicants?.filter(
      (user) =>
        user.permissions.canAdministrateTickets ||
        user.permissions.canPerformTickets ||
        user.company?._id.toString() === company?._id.toString(),
    );
    setApplicantsList(users);
  }, [formData, company]);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants, company]);

  const submitHandler = (event) => {
    event.preventDefault();

    const formData = new FormData();

    formData.append("_id", ticket._id);
    formData.append("intent", "process");
    formData.append("num", ticket.num);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("company", JSON.stringify(company));
    formData.append("categoryId", category._id);
    formData.append("applicantId", applicant._id);
    formData.append("responsibles", JSON.stringify(responsibles));
    formData.append("deadline", deadlineInputRef.current.value);
    formData.append("expectedVersion", ticket.version);

    fetcher.submit(formData, {
      method: "POST",
      action: `/tickets/${ticket.num}`,
    });

    closeModal();
  };

  const [ariaFocusMessage, setAriaFocusMessage] = useState(
    "Выберите категорию, чтобы увидеть её описание",
  );

  const onFocus = ({ focused }) => {
    const msg = focused.description
      ? `${focused.description}`
      : "У данной категории нет описания";
    setAriaFocusMessage(msg);
  };

  return (
    <>
      {ticket.state === "Новая" && (canAdministrateTickets || isAdmin) && (
        <>
          <Col sm="auto">
            <Button
              className="mb-2 w-100"
              variant="success"
              size="lg"
              onClick={showModal}
            >
              <strong>
                <RiFileEditLine /> Обработать
              </strong>
            </Button>

            <Modal show={show} onHide={closeModal} centered>
              <Modal.Header closeButton>
                <Modal.Title>Обработать заявку</Modal.Title>
              </Modal.Header>
              <Form method="post" onSubmit={submitHandler}>
                <Modal.Body>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="title">Тема</Form.Label>
                    <Form.Control
                      required
                      onChange={titleChangeHandler}
                      value={title}
                      id="title"
                      name="title"
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="company">Компания</Form.Label>
                    <Select
                      id="company"
                      name="company"
                      placeholder="Выберите компанию"
                      required
                      isClearable
                      isSearchable
                      options={formData.companies}
                      value={company}
                      getOptionLabel={(option) => `${option.alias}`}
                      getOptionValue={(option) => option._id}
                      onChange={companyChangeHandler}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="applicant">Инициатор</Form.Label>
                    <Select
                      id="applicant"
                      name="applicant"
                      placeholder="Выберите пользователя"
                      required
                      isClearable
                      isSearchable
                      options={applicantsList}
                      value={applicant}
                      getOptionLabel={(option) =>
                        `${option.lastName} ${option.firstName}`
                      }
                      getOptionValue={(option) => option._id}
                      onChange={applicantChangeHandler}
                    />
                  </Form.Group>
                  {!ticket.description && (
                    <Form.Group className="mb-3">
                      <Form.Label htmlFor="description">Описание</Form.Label>
                      <Form.Control
                        id="description"
                        name="description"
                        as="textarea"
                        required
                        rows={6}
                        onChange={descriptionChangeHandler}
                        value={description}
                      />
                    </Form.Group>
                  )}

                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="category">Категория</Form.Label>
                    <Alert
                      variant="light"
                      style={{
                        minHeight: "80px",
                        maxHeight: "80px",
                        overflowY: "auto",
                      }}
                    >
                      <small>{ariaFocusMessage}</small>
                    </Alert>
                    <Select
                      id="category"
                      name="category"
                      placeholder="Выберите категорию"
                      aria-labelledby="aria-category"
                      ariaLiveMessages={{
                        onFocus,
                      }}
                      inputId="aria-category-input"
                      required
                      isClearable
                      isSearchable
                      value={category}
                      options={formData.categories}
                      getOptionLabel={(option) => `${option.title}`}
                      getOptionValue={(option) => option._id}
                      onChange={categoryChangeHandler}
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Дедлайн</Form.Label>
                    <Form.Control
                      id="deadline"
                      name="deadline"
                      type="datetime-local"
                      ref={deadlineInputRef}
                      defaultValue={utcToLocalForm(ticket.deadline)}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="responsibles">
                      Ответственные
                    </Form.Label>
                    <Select
                      id="responsibles"
                      name="responsibles"
                      placeholder="Выберите пользователей"
                      isClearable
                      isSearchable
                      isMulti
                      closeMenuOnSelect={false}
                      options={formData.responsibles}
                      getOptionLabel={(option) =>
                        `${option.lastName} ${option.firstName}`
                      }
                      getOptionValue={(option) => option._id}
                      onChange={responsiblesChangeHandler}
                      formatOptionLabel={(option) => (
                        <div
                          className={`${
                            category?.users?.some(
                              (user) => user._id === option._id,
                            )
                              ? "text-success"
                              : "text-warning"
                          }`}
                        >
                          {`${option.lastName} ${option.firstName}`}
                        </div>
                      )}
                    />
                  </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="secondary"
                    onClick={closeModal}
                    disabled={fetcher.state !== "idle"}
                  >
                    Закрыть
                  </Button>
                  <Button
                    variant="primary"
                    disabled={fetcher.state !== "idle"}
                    type="submit"
                    name="intent"
                    value="process"
                  >
                    Подтвердить
                  </Button>
                </Modal.Footer>
              </Form>
            </Modal>
          </Col>
        </>
      )}
    </>
  );
};

export default ProcessTicket;
