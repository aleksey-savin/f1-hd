import { useState, useRef, useCallback, useEffect, useContext } from "react";
import {
  useLoaderData,
  Form as RouterForm,
  Link,
  useNavigate,
} from "react-router";
import { useDispatch } from "react-redux";

import { utcToLocalForm } from "../../util/format-date";

import Select from "../../UI/Select";

import useHttp from "../../hooks/use-http";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import Stack from "react-bootstrap/Stack";
import Alert from "react-bootstrap/Alert";

import Editor from "../../UI/Editor";
import FileUpload from "../../UI/FileUpload";

import { toastActions } from "../../store/toast";

import { RiSaveLine } from "react-icons/ri";
import { RiArrowGoBackFill } from "react-icons/ri";

import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import useOffcanvasStore from "../../store/offcanvas";
import { Card } from "react-bootstrap";
import DynamicCustomFields from "./DynamicCustomFields";

const UpdateTicket = () => {
  const { ticketData } = useLoaderData();
  const { ticket } = ticketData;

  const { formData } = useLoaderData();

  const dispatch = useDispatch();
  const offcanvas = useOffcanvasStore();
  const navigate = useNavigate();

  const { token, userId, isEndUser } = getLocalStorageData();
  const { permissions } = useContext(AuthedUserContext);
  const { canEditTickets, canPerformTickets } = permissions;

  const [applicantsList, setApplicantsList] = useState([]);
  const [title, setTitle] = useState(ticket?.title);
  const [convertedContent, setConvertedContent] = useState(ticket.description);
  const [company, setCompany] = useState(ticket.company);
  const [applicant, setApplicant] = useState(ticket.applicant);
  const [category, setCategory] = useState(ticket.category);
  const [responsibles, setResponsibles] = useState(ticket?.responsibles || []);
  const [state, setState] = useState(ticket?.state);
  const [files, setFiles] = useState([]);
  const [customFields, setCustomFields] = useState(
    ticket.customFields.map((field) => ({
      ...field,
      value: field.value || "",
    })),
  );

  const deadlineInputRef = useRef();

  const titleChangeHandler = (event) => {
    setTitle(event.target.value);
  };

  const descriptionChangeHandler = (content) => {
    setConvertedContent(content);
  };

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
  };

  const applicantChangeHandler = (selectedItem) => {
    setApplicant(selectedItem);
  };

  const categoryChangeHandler = (selectedItem) => {
    setCategory(selectedItem);
  };

  const responsiblesChangeHandler = (selectedItems) => {
    setResponsibles(selectedItems);
  };

  const stateChangeHandler = (event) => {
    setState(event.target.value);
  };

  const { isLoading, sendRequest: postTicketHandler } = useHttp();

  // фильтруем сотрудников выбранной компании, пользователей с правами canPerformTickets и canAdministrateTickets из общего списка
  const fetchApplicants = useCallback(() => {
    let users = [];
    if (isEndUser) {
      users = formData.applicants?.filter((user) => user._id === userId);
    } else {
      users = formData.applicants?.filter(
        (user) =>
          user.permissions?.canPerformTickets ||
          company?._id === user.company._id,
      );
    }
    setApplicantsList(users);
  }, [formData, company]);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants]);

  const submitHandler = (event) => {
    event.preventDefault();

    if (!convertedContent.trim()) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Описание обязательно для заполнения",
          show: true,
        }),
      );
      return;
    }

    if (!isEndUser && !title.trim()) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Тема обязательна для заполнения",
          show: true,
        }),
      );
      return;
    }

    if (!isEndUser && !company) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Необходимо выбрать компанию",
          show: true,
        }),
      );
      return;
    }

    if (!isEndUser && !applicant._id) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Необходимо выбрать инициатора",
          show: true,
        }),
      );
      return;
    }

    if (!isEndUser && !category) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Необходимо выбрать категорию",
          show: true,
        }),
      );
      return;
    }

    if (!isEndUser && !canPerformTickets && responsibles.length === 0) {
      dispatch(
        toastActions.setState({
          variant: "danger text-white",
          message: "Необходимо выбрать ответственных",
          show: true,
        }),
      );
      return;
    }

    const update = (data) => {
      if (data.ticket) {
        dispatch(
          toastActions.setState({
            variant: "success text-white",
            message: "Данные заявки изменены",
            show: true,
          }),
        );
      } else {
        dispatch(
          toastActions.setState({
            variant: "danger text-white",
            message: data.message,
            show: true,
          }),
        );
      }
    };

    const formData = new FormData();
    formData.append("_id", ticket._id);
    formData.append("title", title);
    formData.append("description", convertedContent);
    if (files.length > 0) {
      for (const singleFile of files) {
        formData.append("attachments", singleFile);
      }
    }

    formData.append("categoryId", category._id);
    formData.append("company", JSON.stringify(company));
    formData.append("responsibles", JSON.stringify(responsibles));
    formData.append("applicantId", applicant._id);
    formData.append("deadline", new Date(deadlineInputRef.current?.value));
    formData.append("state", state);

    const validCustomFields = customFields.filter(
      (field) =>
        field.name.trim() !== "" &&
        (Array.isArray(field.value)
          ? field.value.length > 0
          : field.value?.trim() !== ""),
    );

    formData.append("customFields", JSON.stringify(validCustomFields));

    postTicketHandler(
      {
        url: `${import.meta.env.VITE_ADDRESS}/api/tickets/update`,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
        isFormData: true,
        body: formData,
      },
      update,
    );

    navigate("..", { state: { refresh: true } });
    offcanvas.setClose();
  };

  const ticketStates = [
    "Новая",
    "Не в работе",
    "В работе",
    "Выполнена",
    "Закрыта",
  ];

  const [ariaFocusMessage, setAriaFocusMessage] = useState(
    category?.description || "У данной категории нет описания",
  );

  const onFocus = useCallback(({ focused }) => {
    const msg = focused?.description
      ? `${focused?.description}`
      : "У данной категории нет описания";
    setTimeout(() => {
      setAriaFocusMessage(msg);
    }, 50);
  }, []);

  return (
    <>
      {canEditTickets && (
        <Container>
          <h1>Заявка №{ticket.num}</h1>
          <hr></hr>
          <RouterForm onSubmit={submitHandler} method="post">
            <Form.Group className="mb-3">
              <Form.Label htmlFor="title">Тема</Form.Label>
              <Form.Control
                required
                autoFocus
                id="title"
                type="text"
                value={title}
                onChange={titleChangeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Описание</Form.Label>
              <Editor
                id="description"
                changeHandler={descriptionChangeHandler}
                description={ticket?.description}
              />
            </Form.Group>
            <FileUpload
              setFiles={setFiles}
              files={files}
              showLabel={true}
              showText={true}
            />
            {ticket.template && customFields.length > 0 && (
              <>
                <Card className="mb-3 bg-light">
                  <Card.Body>
                    <Card.Title>Расширенная форма</Card.Title>
                    {customFields.map((field, index) => (
                      <Form.Group key={index} className="mb-3">
                        <Form.Label>{field.name}</Form.Label>
                        {field.type === "multiselect" ? (
                          <Select
                            isMulti
                            closeMenuOnSelect={false}
                            value={field.value?.map((v) => ({
                              value: v,
                              label: v,
                            }))}
                            options={field.options?.map((opt) => ({
                              value: opt,
                              label: opt,
                            }))}
                            onChange={(selected) => {
                              const newFields = [...customFields];
                              newFields[index].value =
                                selected?.map((opt) => opt.value) || [];
                              setCustomFields(newFields);
                            }}
                          />
                        ) : field.type === "select" ? (
                          <Form.Select
                            value={field.value}
                            onChange={(e) => {
                              const newFields = [...customFields];
                              newFields[index].value = e.target.value;
                              setCustomFields(newFields);
                            }}
                          >
                            <option value="">Выберите...</option>
                            {field.options.map((option, idx) => (
                              <option key={idx} value={option}>
                                {option}
                              </option>
                            ))}
                          </Form.Select>
                        ) : (
                          <Form.Control
                            type="text"
                            value={field.value}
                            onChange={(e) => {
                              const newFields = [...customFields];
                              newFields[index].value = e.target.value;
                              setCustomFields(newFields);
                            }}
                          />
                        )}
                      </Form.Group>
                    ))}
                  </Card.Body>
                </Card>
              </>
            )}
            {!ticket.template && (
              // Dynamic custom fields component for non-template tickets
              <Card className="mb-3 bg-light">
                <Card.Body>
                  <Card.Title>Расширенная форма</Card.Title>
                  <DynamicCustomFields
                    customFields={customFields}
                    setCustomFields={setCustomFields}
                  />
                </Card.Body>
              </Card>
            )}
            <Form.Group className="mb-3">
              <Form.Label htmlFor="company">Компания</Form.Label>
              <Select
                id="company"
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
            <Form.Group className="mb-3">
              <Form.Label htmlFor="category">Категория</Form.Label>
              <Alert
                variant="light"
                style={{
                  minHeight: "80px",
                  maxHeight: "80px",
                  overflowY: "auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "start",
                }}
              >
                <small>{ariaFocusMessage}</small>
              </Alert>
              <Select
                id="category"
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
              <Form.Label htmlFor="responsibles">Ответственные</Form.Label>
              <Select
                id="responsibles"
                name="responsibles"
                placeholder="Выберите пользователей"
                required
                isClearable
                isSearchable
                isMulti
                value={responsibles}
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
                      category?.users?.some((user) => user._id === option._id)
                        ? "text-success"
                        : "text-warning"
                    }`}
                  >
                    {`${option.lastName} ${option.firstName}`}
                  </div>
                )}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Дедлайн</Form.Label>
              <Form.Control
                type="datetime-local"
                ref={deadlineInputRef}
                required
                defaultValue={
                  ticket.deadline ? utcToLocalForm(ticket.deadline) : ""
                }
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="state">Статус</Form.Label>
              <Form.Select
                id="state"
                placeholder="Выберите статус"
                required
                value={state}
                onChange={stateChangeHandler}
              >
                {ticketStates.map((ticketState) => {
                  return <option key={ticketState}>{ticketState}</option>;
                })}
              </Form.Select>
            </Form.Group>
            <hr></hr>
            <Stack direction="horizontal" gap={3}>
              <div className="ms-auto">
                <Button
                  as={Link}
                  to={-1}
                  onClick={offcanvas.setClose}
                  variant="secondary"
                >
                  <RiArrowGoBackFill /> Закрыть
                </Button>
              </div>
              <div className="">
                <Button variant="primary" type="submit" disabled={isLoading}>
                  <RiSaveLine /> Сохранить
                </Button>
              </div>
            </Stack>
          </RouterForm>
        </Container>
      )}
    </>
  );
};

export default UpdateTicket;
