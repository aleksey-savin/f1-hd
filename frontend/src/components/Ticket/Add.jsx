import { useState, useRef, useCallback, useEffect, useContext } from "react";

import {
  useNavigate,
  useLoaderData,
  Form as RouterForm,
  Link,
} from "react-router";

import SaveAsTemplate from "./SaveAsTemplate";

import { BrowserView, MobileView } from "react-device-detect";

import Select from "../../UI/Select";

import useHttp from "../../hooks/use-http";
import { localToUtc } from "../../util/format-date";

import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Stack from "react-bootstrap/Stack";
import Alert from "react-bootstrap/Alert";

import DynamicCustomFields from "./DynamicCustomFields";

import useToastStore from "../../store/toast-store";

import { RiSaveLine, RiArrowGoBackFill } from "react-icons/ri";

import Editor from "../../UI/Editor";
import FileUpload from "../../UI/FileUpload";

import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

import useOffcanvasStore from "../../store/offcanvas";
import { Card } from "react-bootstrap";

const AddTicket = () => {
  const offcanvas = useOffcanvasStore();

  useEffect(() => {
    offcanvas.setShow();
  }, []);

  Date.prototype.addHours = function (h) {
    this.setHours(this.getHours() + h);
    return this;
  };

  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const { token } = getLocalStorageData();

  const { isEndUser, _id: userId, permissions } = useContext(AuthedUserContext);
  const { canPerformTickets } = permissions;

  const [title, setTitle] = useState("");

  const ticketFormData = useLoaderData();

  const [convertedContent, setConvertedContent] = useState("");

  const [company, setCompany] = useState();
  const [applicant, setApplicant] = useState({});
  const [category, setCategory] = useState();
  const [responsibles, setResponsibles] = useState([]);
  const [files, setFiles] = useState([]);
  const deadlineInputRef = useRef();

  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const [customFields, setCustomFields] = useState([]);
  const [isFromTemplate, setIsFromTemplate] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch templates");
      }
      const data = await response.json();
      setTemplates([
        { title: "Создать заявку без использования шаблона" },
        ...data,
      ]);
    } catch (error) {
      console.error("Error fetching templates:", error);
    }
  };

  const handleTemplateSelect = async (templateId) => {
    if (templateId) {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${templateId}`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
          },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch template");
        }
        const template = await response.json();

        setTitle(template.title);
        setConvertedContent(template.description);
        setCompany(template.company);
        setCategory(template.category);

        setCustomFields(
          template.customFields.map((field) => ({
            ...field,
            value: field.defaultValue || "",
          })),
        );

        setSelectedTemplate(template);
        setIsFromTemplate(true);
        return;
      } catch (error) {
        console.error("Error loading template:", error);
      }
    }
    setTitle("");
    setConvertedContent("");
    setCategory({ title: "" });
    setCustomFields([]);
    setIsFromTemplate(false);
    return;
  };

  const titleChangeHandler = (event) => {
    setTitle(event.target.value);
  };

  const descriptionChangeHandler = (content) => {
    setConvertedContent(content);
  };

  const mobileDescriptionChangeHandler = (event) => {
    setConvertedContent(event.target.value);
  };

  const companyChangeHandler = (selectedCompany) => {
    setCompany(selectedCompany);
  };

  const applicantChangeHandler = (selectedItem) => {
    setApplicant(selectedItem);
  };

  const categoryChangeHandler = (selectedItem) => {
    setCategory(selectedItem);
  };

  const responsiblesChangeHandler = (selectedUsers) => {
    setResponsibles(selectedUsers);
  };

  const { isLoading, sendRequest: postTicketHandler } = useHttp();

  const [applicantsList, setApplicantsList] = useState([]);

  // фильтруем сотрудников выбранной компании, пользователей с правами на выполнение заявок и менеджеров из общего списка
  const fetchApplicants = useCallback(() => {
    let users = [];
    if (isEndUser) {
      users = ticketFormData.applicants?.filter((user) => user._id === userId);
    } else {
      users = ticketFormData.applicants?.filter(
        (user) =>
          user.permissions?.canPerformTickets ||
          company?._id === user.company._id,
      );
    }
    setApplicantsList(users);
  }, [ticketFormData, company]);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants]);

  const submitHandler = async (event) => {
    event.preventDefault();

    if (!convertedContent.trim()) {
      showToast("danger text-white", "Описание обязательно для заполнения");
      return;
    }

    if (!isEndUser && !title.trim()) {
      showToast("danger text-white", "Тема обязательна для заполнения");
      return;
    }

    if (!isEndUser && !company) {
      showToast("danger text-white", "Необходимо выбрать компанию");
      return;
    }

    if (!isEndUser && !applicant._id) {
      showToast("danger text-white", "Необходимо выбрать инициатора");
      return;
    }

    if (!isEndUser && !category) {
      showToast("danger text-white", "Необходимо выбрать категорию");
      return;
    }

    if (!isEndUser && !canPerformTickets && responsibles.length === 0) {
      showToast("danger text-white", "Необходимо выбрать ответственных");
      return;
    }

    const createTicket = (data) => {
      if (data.ticket) {
        showToast("success text-white", "Заявка добавлена");
        navigate(`/tickets/${data.ticket.num}`);
      } else {
        showToast("danger text-white", data.message);
      }
    };

    const formData = new FormData();

    function htmlToPlainText(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return doc.body.textContent || "";
    }

    formData.append(
      "title",
      isEndUser
        ? `${htmlToPlainText(convertedContent)?.substring(0, 50)}`
        : title,
    );
    formData.append("description", convertedContent);

    const validCustomFields = customFields.filter(
      (field) => field.name.trim() !== "",
    );

    formData.append("customFields", JSON.stringify(validCustomFields));

    if (files.length > 0) {
      for (const singleFile of files) {
        formData.append("attachments", singleFile);
      }
    }

    formData.append(
      "template",
      selectedTemplate._id ? JSON.stringify(selectedTemplate) : null,
    );

    if (category?._id) {
      formData.append("categoryId", category._id);
    }
    formData.append("company", isEndUser ? "" : JSON.stringify(company));
    formData.append("responsibles", JSON.stringify(responsibles));
    formData.append("applicantId", isEndUser ? "" : applicant._id);
    if (!isEndUser) {
      // Значение datetime-local — настенное время в бизнес-таймзоне (симметрично
      // загрузке через utcToLocalForm); new Date() трактовал его как браузерное.
      formData.append(
        "deadline",
        deadlineInputRef.current.value
          ? localToUtc(deadlineInputRef.current.value)
          : "",
      );
    }
    formData.append(
      "state",
      responsibles.length === 0 ? "Новая" : "Не в работе",
    );
    formData.append("source", "Портал");

    await postTicketHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/add`,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
        isFormData: true,
        body: formData,
      },
      createTicket,
    );
    offcanvas.setClose();
  };

  const [ariaFocusMessage, setAriaFocusMessage] = useState(
    "Выберите категорию, чтобы увидеть её описание",
  );

  const onFocus = ({ focused }) => {
    const msg = focused.description
      ? `${focused.description}`
      : "У данной категории нет описания";
    setTimeout(() => {
      setAriaFocusMessage(msg);
    }, 50);
  };

  return (
    <Container>
      <h1>Новая заявка</h1>
      <hr></hr>
      <RouterForm onSubmit={submitHandler} method="post">
        {templates.length > 1 && (
          <Card className="mb-3 bg-success bg-opacity-10">
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label>Шаблон</Form.Label>
                <div className="templateSelect">
                  <Select
                    id="template"
                    placeholder="Выберите значение"
                    isSearchable
                    options={templates}
                    defaultValue={{
                      title: "Создать заявку без использования шаблона",
                    }}
                    getOptionLabel={(option) => `${option.title}`}
                    getOptionValue={(option) => option._id}
                    onChange={(selectedItem) => {
                      setSelectedTemplate(selectedItem);
                      handleTemplateSelect(selectedItem._id);
                    }}
                  />
                </div>
              </Form.Group>
            </Card.Body>
          </Card>
        )}

        {!isEndUser && (
          <>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="title">
                Тема
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                autoFocus
                id="title"
                name="title"
                type="text"
                value={title}
                onChange={titleChangeHandler}
              />
            </Form.Group>
          </>
        )}
        <Form.Label htmlFor="description">Описание</Form.Label>
        <BrowserView>
          <Form.Group className="mb-3">
            <Editor
              id="description"
              changeHandler={descriptionChangeHandler}
              placeholder={isEndUser ? "Опишите задачу или проблему" : ""}
              description={convertedContent}
              selectedTemplate={selectedTemplate}
            />
          </Form.Group>
        </BrowserView>
        <MobileView>
          <Form.Group className="mb-3">
            <Form.Control
              as="textarea"
              rows={5}
              id="description"
              onChange={mobileDescriptionChangeHandler}
              value={convertedContent}
              placeholder={isEndUser ? "Опишите задачу или проблему" : ""}
            />
          </Form.Group>
        </MobileView>
        <FileUpload
          setFiles={setFiles}
          files={files}
          showLabel={true}
          showText={true}
        />
        {isFromTemplate && customFields.length > 0 && (
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
        {!isFromTemplate && (
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
        {!isEndUser && (
          <>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="company">
                Компания
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="company"
                name="company"
                placeholder="Выберите компанию"
                isClearable
                isSearchable
                value={company}
                options={ticketFormData.companies}
                getOptionLabel={(option) => `${option.alias}`}
                getOptionValue={(option) => option._id}
                onChange={companyChangeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="applicant">
                Инициатор
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="applicant"
                name="applicant"
                placeholder="Выберите пользователя"
                isClearable
                isSearchable
                options={applicantsList}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={applicantChangeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="category">
                Категория
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
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
                name="category"
                placeholder="Выберите категорию"
                aria-labelledby="aria-category"
                ariaLiveMessages={{
                  onFocus,
                }}
                inputId="aria-category-input"
                isClearable
                isSearchable
                options={ticketFormData.categories}
                getOptionLabel={(option) => `${option.title}`}
                getOptionValue={(option) => option._id}
                value={category}
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
                closeMenuOnSelect={false}
                options={ticketFormData.responsibles}
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
              <Form.Control type="datetime-local" ref={deadlineInputRef} />
            </Form.Group>
          </>
        )}
        <hr></hr>
        <MobileView>
          {!isFromTemplate && (
            <Stack direction="horizontal" className="mb-3" gap={3}>
              <div className="ms-auto">
                <Button
                  variant="outline-primary"
                  onClick={() => setShowSaveTemplate(true)}
                >
                  Сохранить как шаблон
                </Button>
              </div>
            </Stack>
          )}
        </MobileView>
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
          <BrowserView>
            <div>
              <Button
                variant="outline-primary"
                onClick={() => setShowSaveTemplate(true)}
              >
                Сохранить как шаблон
              </Button>
            </div>
          </BrowserView>
          <div>
            <Button variant="primary" type="submit" disabled={isLoading}>
              <RiSaveLine /> Сохранить
            </Button>
          </div>
        </Stack>
      </RouterForm>

      <SaveAsTemplate
        show={showSaveTemplate}
        handleClose={() => setShowSaveTemplate(false)}
        ticketData={{
          description: convertedContent,
          category: category,
          company: company,
        }}
        title={title}
        setTitle={setTitle}
        customFields={customFields}
        usersData={ticketFormData.applicants}
        companiesData={ticketFormData.companies}
        onSave={() => {
          fetchTemplates();
          setShowSaveTemplate(false);
        }}
      />
    </Container>
  );
};

export default AddTicket;
