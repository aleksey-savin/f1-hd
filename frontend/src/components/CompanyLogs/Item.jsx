import { useState } from "react";
import { useFetcher } from "react-router";

import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";

import { RiUserAddLine, RiUserLine, RiComputerLine } from "react-icons/ri";

import Select from "../../UI/Select";

const CompanyLogItem = ({ item, company, permissions }) => {
  const fetcher = useFetcher();

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [users, setUsers] = useState([]);

  const handleCloseLinkModal = () => {
    setShowLinkModal(false);
    setSelectedUser(null);
  };

  const handleShowLinkModal = () => {
    if (users.length === 0) {
      const companyUsers = [
        ...company.users.map((user) => ({
          _id: user.id,
          firstName: user.fullName?.split(" ")[0] || "",
          lastName: user.fullName?.split(" ")[1] || "",
          email: user.email,
        })),
        ...company.employees.map((user) => user),
      ].filter(
        (user, index, self) =>
          index ===
          self.findIndex((u) => u._id.toString() === user._id.toString()),
      );
      setUsers(companyUsers);
    }
    setShowLinkModal(true);
  };

  const handleLinkUser = (event) => {
    event.preventDefault();

    if (!selectedUser) return;

    fetcher.submit(
      {
        intent: "linkUserToAD",
        logId: item._id,
        userId: selectedUser._id,
      },
      {
        method: "POST",
        action: `/companies/${company._id}/logs`,
      },
    );
  };

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString("ru-RU");
  };

  const getActionBadge = (action) => {
    switch (action) {
      case "userLogin":
        return <Badge bg="success">Вход в систему</Badge>;
      default:
        return <Badge bg="secondary">{action}</Badge>;
    }
  };

  // Закрыть модальное окно после успешного связывания
  if (
    fetcher.state === "idle" &&
    fetcher.data &&
    !fetcher.data.error &&
    showLinkModal
  ) {
    handleCloseLinkModal();
    // Обновляем страницу чтобы увидеть изменения
    window.location.reload();
  }

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Row className="align-items-center">
            <Col md="3">
              <div>
                <strong>
                  {item.firstName} {item.lastName}
                </strong>
                <br />
                <small className="text-muted font-monospace">
                  {item.activeDirectoryLogin}
                </small>
                <br />
                <small className="text-muted">
                  {formatDateTime(item.timeStamp)}
                </small>
              </div>
            </Col>

            <Col md="2">
              {item.computerName && (
                <div>
                  <RiComputerLine /> {item.computerName}
                </div>
              )}
            </Col>

            <Col md="2">{getActionBadge(item.action)}</Col>

            <Col md="3">
              {item.userId ? (
                <div className="text-success">
                  <RiUserLine /> {item.userId.firstName} {item.userId.lastName}
                  <br />
                  <small className="text-muted">{item.userId.email}</small>
                </div>
              ) : (
                <Badge bg="warning">Не связан</Badge>
              )}
            </Col>

            <Col md="2">
              {permissions.canManageCompanies && !item.userId && (
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={handleShowLinkModal}
                >
                  <RiUserAddLine /> Связать
                </Button>
              )}
            </Col>
          </Row>

          {/* Дополнительная информация (GUID) */}
          <Row className="mt-2">
            <Col>
              <small className="text-muted">
                GUID: {item.activeDirectoryObjectGUID}
              </small>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Модальное окно для связывания пользователя */}
      <Modal show={showLinkModal} onHide={handleCloseLinkModal} centered>
        <Form onSubmit={handleLinkUser}>
          <Modal.Header closeButton>
            <Modal.Title>Связать с пользователем</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {fetcher.data?.error && (
              <Alert variant="danger">{fetcher.data.error}</Alert>
            )}

            <div className="mb-3 p-3 bg-light rounded">
              <strong>Active Directory пользователь:</strong>
              <br />
              {item.firstName} {item.lastName} ({item.activeDirectoryLogin})
              <br />
              <small className="text-muted">
                GUID: {item.activeDirectoryObjectGUID}
              </small>
            </div>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="userId">
                Выберите пользователя системы
              </Form.Label>
              <Select
                id="userId"
                placeholder="Выберите пользователя для связывания"
                required
                isClearable
                isSearchable
                options={users}
                getOptionLabel={(option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.email})`
                }
                getOptionValue={(option) => option._id}
                onChange={setSelectedUser}
                value={selectedUser}
              />
              <Form.Text className="text-muted">
                После связывания все записи с данным GUID будут автоматически
                привязаны к выбранному пользователю.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseLinkModal}>
              Отмена
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={fetcher.state !== "idle" || !selectedUser}
            >
              {fetcher.state !== "idle" ? "Связывание..." : "Связать"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default CompanyLogItem;
