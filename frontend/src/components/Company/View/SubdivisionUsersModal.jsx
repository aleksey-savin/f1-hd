import { useState, useEffect } from "react";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Select from "../../../UI/Select";

const SubdivisionUsersModal = ({
  show,
  onHide,
  subdivision,
  companyUsers,
  company,
  onSave,
  fetcher,
}) => {
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedManager, setSelectedManager] = useState(undefined);

  const sortUsersByName = (a, b) => {
    const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
    const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  };

  // Reset state when modal closes
  const handleClose = () => {
    setSelectedUsers(undefined);
    setSelectedManager(undefined);
    onHide();
  };

  useEffect(() => {
    if (show && subdivision) {
      setSelectedUsers(subdivision.users || undefined);
      setSelectedManager(subdivision.manager || undefined);
    }
  }, [show, subdivision]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!subdivision) return;

    // Filter out any empty values and ensure we have valid user IDs
    const validUsers = selectedUsers
      .filter((user) => user && user._id)
      .map((user) => user._id);

    onSave({
      subdivisionId: subdivision._id,
      users: validUsers,
      manager: selectedManager?._id || null,
    });

    handleClose();
  };

  // Helper function to format user name
  const formatUserName = (user) => {
    return `${user.lastName} ${user.firstName}`;
  };

  // Handle manager selection
  const onManagerChange = (newManager) => {
    if (newManager) {
      // Remove the new manager from users list if present
      setSelectedUsers((prev) =>
        prev.filter((user) => user._id !== newManager._id),
      );
    }
    setSelectedManager(newManager || undefined);
  };

  // Handle users selection
  const onUsersChange = (newUsers) => {
    setSelectedUsers(newUsers || []); // This is fine as is for multi-select
  };

  // Add tooltip information for unavailable users
  const getOptionLabel = (option) => {
    if (!subdivision) return formatUserName(option);

    const assignment = company.usersInSubdivisions[option._id];
    if (assignment) {
      // If user is in current subdivision, show it
      if (assignment.subdivisionId === subdivision._id) {
        return `${formatUserName(option)}`;
      }
      // If user is in another subdivision, show which one
      return `${formatUserName(option)} (${assignment.role === "manager" ? "Руководитель" : "Сотрудник"} в ${assignment.subdivisionName})`;
    }
    return formatUserName(option);
  };

  const isOptionDisabled = (option) => {
    if (!subdivision) return false;
    const assignment = company.usersInSubdivisions[option._id];
    // Only disable if user is in a different subdivision
    return assignment && assignment.subdivisionId !== subdivision._id;
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>
            Управление пользователями - {subdivision?.name}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {fetcher.data?.error && (
            <Alert variant="danger">{fetcher.data.error}</Alert>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Руководитель подразделения</Form.Label>
            <Select
              isClearable
              placeholder="Выберите руководителя"
              options={companyUsers.sort(sortUsersByName) || []}
              value={selectedManager || undefined}
              onChange={onManagerChange}
              getOptionLabel={getOptionLabel}
              getOptionValue={(option) => option._id}
              isOptionDisabled={isOptionDisabled}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Сотрудники подразделения</Form.Label>
            <Select
              isMulti
              closeMenuOnSelect={false}
              placeholder="Выберите сотрудников"
              options={companyUsers.sort(sortUsersByName) || []}
              value={selectedUsers}
              onChange={onUsersChange}
              getOptionLabel={getOptionLabel}
              getOptionValue={(option) => option._id}
              isOptionDisabled={isOptionDisabled}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={fetcher.state !== "idle"}
          >
            Сохранить
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default SubdivisionUsersModal;
