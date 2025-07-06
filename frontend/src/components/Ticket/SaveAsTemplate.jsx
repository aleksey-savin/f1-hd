import { useState, useContext } from "react";
import { Modal, Button, Form } from "react-bootstrap";
import { getLocalStorageData } from "../../util/auth";
import Select from "../../UI/Select";

import { AuthedUserContext } from "../../store/authed-user-context";

const SaveAsTemplate = ({
  show,
  handleClose,
  ticketData,
  title,
  setTitle,
  customFields,
  onSave,
  usersData,
  companiesData,
}) => {
  const { token } = getLocalStorageData();
  const { isEndUser } = useContext(AuthedUserContext);

  const [shareWithCompanies, setShareWithCompanies] = useState(false);
  const [companies, setCompanies] = useState(
    companiesData.length === 1 ? [companiesData[0]] : [],
  );
  const [shareWithUsers, setShareWithUsers] = useState(false);
  const [users, setUsers] = useState([]);

  const handleSave = async () => {
    try {
      const templateData = {
        title: title,
        description: ticketData.description,
        category: ticketData.category,
        company: ticketData.company,
        customFields: customFields.map((field) => ({
          name: field.name,
          type: field.type,
          value: field.type === "multiselect" ? [] : "",
          options: field.options,
        })),
        sharedCompanies: shareWithCompanies ? companies : [],
        sharedUsers: shareWithUsers ? users : [],
      };

      const response = await fetch(
        `${import.meta.env.VITE_ADDRESS}/api/ticket-templates/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(templateData),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save template");
      }

      handleClose();
      onSave();
    } catch (error) {
      console.error("Error saving template:", error);
    }
  };

  return (
    <Modal centered show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Сохранить как шаблон</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Имя шаблона</Form.Label>
            <Form.Control
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Form.Group>
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
                id="shared-companies"
                name="shared-companies"
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
                id="shared-users"
                name="shared-users"
                placeholder="Выберите пользователей"
                isClearable
                isSearchable
                closeMenuOnSelect={false}
                isMulti
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
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>
          Отмена
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Сохранить шаблон
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SaveAsTemplate;
