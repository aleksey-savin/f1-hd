import { useState, useCallback, useContext } from "react";

import Form from "react-bootstrap/Form";

import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";

import Editor from "../../UI/Editor";
import { Alert, Card } from "react-bootstrap";
import DynamicCustomFields from "../Ticket/DynamicCustomFields";

import { AuthedUserContext } from "../../store/authed-user-context";

const TicketTemplateForm = ({ template, formData }) => {
  const { companies: companiesData, applicants: usersData } = formData;

  const { isEndUser } = useContext(AuthedUserContext);

  const [title, setTitle] = useState(template?.title || "");
  const [description, setDescription] = useState(template?.description || "");
  const [company, setCompany] = useState(template?.company || "");
  const [category, setCategory] = useState(template?.category);
  const [customFields, setCustomFields] = useState(
    template.customFields.map((field) => ({
      ...field,
      value: field.value || "",
    })),
  );

  const titleChangeHandler = (event) => {
    setTitle(event.target.value);
  };

  const descriptionChangeHandler = (content) => {
    setDescription(content);
  };

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
  };

  const categoryChangeHandler = (selectedItem) => {
    setCategory(selectedItem);
  };

  const [ariaFocusMessage, setAriaFocusMessage] = useState(
    category?.description || "У данной категории нет описания",
  );

  const onFocus = useCallback(({ focused }) => {
    const msg = focused?.description
      ? `${focused.description}`
      : "У данной категории нет описания";
    setTimeout(() => {
      setAriaFocusMessage(msg);
    }, 50);
  }, []);

  const [shareWithCompanies, setShareWithCompanies] = useState(
    template?.sharedCompanies.length > 0,
  );
  const [companies, setCompanies] = useState(template.sharedCompanies);
  const [shareWithUsers, setShareWithUsers] = useState(
    template?.sharedUsers.length > 0,
  );
  const [users, setUsers] = useState(template.sharedUsers);

  return (
    <>
      <FormWrapper
        title={template?.title || "Новый шаблон заявки"}
        navigateTo="/ticket-templates"
      >
        <Form.Group className="py-3">
          <Form.Label htmlFor="title">
            Наименование
            <span style={{ color: "red" }}>*</span>
          </Form.Label>
          <Form.Control
            autoFocus
            id="title"
            name="title"
            type="text"
            value={title}
            onChange={titleChangeHandler}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Описание</Form.Label>
          <Editor
            changeHandler={descriptionChangeHandler}
            description={template?.description}
          />
          <textarea
            id="description"
            name="description"
            value={description}
            hidden
            onChange={() => {}}
          />
        </Form.Group>
        {!isEndUser && (
          <>
            {" "}
            <Form.Group className="mb-3">
              <Form.Label htmlFor="company">Компания</Form.Label>
              <Select
                id="company"
                name="company"
                placeholder="Выберите компанию"
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
                name="category"
                placeholder="Выберите категорию"
                aria-labelledby="aria-category"
                ariaLiveMessages={{
                  onFocus,
                }}
                inputId="aria-category-input"
                isClearable
                isSearchable
                value={category}
                options={formData.categories}
                getOptionLabel={(option) => `${option.title}`}
                getOptionValue={(option) => option._id}
                onChange={categoryChangeHandler}
              />
            </Form.Group>
          </>
        )}
        <Card className="mb-3 bg-light">
          <Card.Body>
            <Card.Title>Расширенная форма</Card.Title>
            <DynamicCustomFields
              customFields={customFields}
              setCustomFields={setCustomFields}
            />
            <textarea
              id="customFields"
              name="customFields"
              value={JSON.stringify(customFields)}
              onChange={() => {}}
              hidden
            />
          </Card.Body>
        </Card>
        <Card className="mb-3 bg-light">
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                label={`Поделиться с ${isEndUser ? "компанией" : "компаниями"}`}
                value={shareWithCompanies}
                checked={shareWithCompanies}
                onChange={() => {
                  setShareWithCompanies(!shareWithCompanies);
                }}
              />
            </Form.Group>
            {shareWithCompanies && !isEndUser && (
              <Form.Group className="mb-3">
                <Select
                  id="sharedCompanies"
                  name="sharedCompanies"
                  placeholder="Выберите компании"
                  isClearable
                  isSearchable
                  isMulti
                  options={companiesData}
                  value={companies}
                  getOptionLabel={(option) => `${option.alias}`}
                  getOptionValue={(option) => option._id}
                  onChange={(selectedItems) => {
                    setCompanies(selectedItems);
                  }}
                />
              </Form.Group>
            )}
            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                label={`Поделиться с пользователями`}
                value={shareWithUsers}
                checked={shareWithUsers}
                onChange={() => {
                  setShareWithUsers(!shareWithUsers);
                }}
              />
            </Form.Group>
            {shareWithUsers && (
              <Form.Group className="mb-3">
                <Select
                  id="sharedUsers"
                  name="sharedUsers"
                  placeholder="Выберите пользователей"
                  isClearable
                  isSearchable
                  closeMenuOnSelect={false}
                  isMulti
                  value={users}
                  options={usersData}
                  getOptionLabel={(option) =>
                    `${option.lastName} ${option.firstName}`
                  }
                  getOptionValue={(option) => option._id}
                  onChange={(selectedItems) => {
                    setUsers(selectedItems);
                  }}
                />
              </Form.Group>
            )}
          </Card.Body>
        </Card>
      </FormWrapper>
    </>
  );
};

export default TicketTemplateForm;
