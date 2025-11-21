import { useState, useEffect } from "react";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import ListGroup from "react-bootstrap/ListGroup";
import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
import { RiUserLine, RiHistoryLine, RiEditLine } from "react-icons/ri";

const ResponsibilityManager = ({
  deviceId,
  currentResponsibility,
  onChange,
  isDisabled = false,
}) => {
  const [responsibilities, setResponsibilities] = useState([]);
  const [responsibilityHistory, setResponsibilityHistory] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  const [transferData, setTransferData] = useState({
    newResponsibleUser: "",
    transferReason: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const responsibilityTypes = [
    { value: "personal", label: "Персональная ответственность" },
    { value: "department", label: "Ответственность отдела" },
    { value: "shared", label: "Общая ответственность" },
    { value: "maintenance", label: "Техническое обслуживание" },
  ];

  const transferReasons = [
    { value: "user_change", label: "Смена пользователя" },
    { value: "department_change", label: "Смена отдела" },
    { value: "location_change", label: "Смена расположения" },
    { value: "role_change", label: "Смена роли" },
    { value: "device_repair", label: "Ремонт устройства" },
    { value: "other", label: "Другое" },
  ];

  useEffect(() => {
    if (deviceId) {
      fetchResponsibilityHistory();
    }
    fetchUsers();
  }, [deviceId]);

  const fetchUsers = async () => {
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/reference/users`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchResponsibilityHistory = async () => {
    setLoading(true);
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${deviceId}/responsibilities`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await response.json();
      setResponsibilityHistory(data);
    } catch (error) {
      console.error("Error fetching responsibility history:", error);
    } finally {
      setLoading(false);
    }
  };

  const transferResponsibility = async () => {
    setModalLoading(true);
    setModalError("");
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${deviceId}/transfer-responsibility`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(transferData),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || "Ошибка при передаче ответственности",
        );
      }

      const updatedResponsibility = await response.json();

      // Refresh history and update current responsibility
      await fetchResponsibilityHistory();
      onChange(updatedResponsibility);

      // Reset modal
      setTransferData({
        newResponsibleUser: "",
        transferReason: "",
        effectiveDate: new Date().toISOString().split("T")[0],
        notes: "",
      });
      setShowTransferModal(false);
    } catch (error) {
      setModalError(error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleTransferInputChange = (event) => {
    const { name, value } = event.target;
    setTransferData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleTransferSelectChange = (name, selectedOption) => {
    const value = selectedOption ? selectedOption.value : "";
    setTransferData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("ru-RU");
  };

  const getResponsibilityTypeLabel = (type) => {
    const typeObj = responsibilityTypes.find((t) => t.value === type);
    return typeObj ? typeObj.label : type;
  };

  const getTransferReasonLabel = (reason) => {
    const reasonObj = transferReasons.find((r) => r.value === reason);
    return reasonObj ? reasonObj.label : reason;
  };

  const userOptions = users.map((user) => ({
    value: user._id,
    label: `${user.firstName} ${user.lastName} (${user.email})`,
  }));

  const selectedNewUser = userOptions.find(
    (option) => option.value === transferData.newResponsibleUser,
  );
  const selectedTransferReason = transferReasons.find(
    (option) => option.value === transferData.transferReason,
  );

  return (
    <>
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h6 className="mb-0">
            <RiUserLine className="me-2" />
            Ответственность за устройство
          </h6>
          <div className="d-flex gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setShowHistoryModal(true)}
              title="История ответственности"
              disabled={isDisabled || !deviceId}
            >
              <RiHistoryLine />
            </Button>
            <Button
              variant="outline-primary"
              size="sm"
              onClick={() => setShowTransferModal(true)}
              title="Передать ответственность"
              disabled={isDisabled || !deviceId}
            >
              <RiEditLine />
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          {currentResponsibility ? (
            <div>
              <Row>
                <Col md={6}>
                  <strong>Ответственный:</strong>
                  <div>
                    {currentResponsibility.responsibleUser?.firstName}{" "}
                    {currentResponsibility.responsibleUser?.lastName}
                  </div>
                  <small className="text-muted">
                    {currentResponsibility.responsibleUser?.email}
                  </small>
                </Col>
                <Col md={6}>
                  <strong>Тип ответственности:</strong>
                  <div>
                    <Badge bg="primary" className="ms-2">
                      {getResponsibilityTypeLabel(
                        currentResponsibility.responsibilityType,
                      )}
                    </Badge>
                  </div>
                </Col>
              </Row>
              <Row className="mt-2">
                <Col md={6}>
                  <strong>Дата назначения:</strong>
                  <div>{formatDate(currentResponsibility.assignedDate)}</div>
                </Col>
                <Col md={6}>
                  <strong>Статус:</strong>
                  <div>
                    <Badge
                      bg={
                        currentResponsibility.isActive ? "success" : "secondary"
                      }
                    >
                      {currentResponsibility.isActive ? "Активна" : "Неактивна"}
                    </Badge>
                  </div>
                </Col>
              </Row>
              {currentResponsibility.notes && (
                <Row className="mt-2">
                  <Col>
                    <strong>Примечания:</strong>
                    <div>{currentResponsibility.notes}</div>
                  </Col>
                </Row>
              )}
            </div>
          ) : (
            <div className="text-muted">Ответственность не назначена</div>
          )}
        </Card.Body>
      </Card>

      {/* Transfer Responsibility Modal */}
      <Modal
        show={showTransferModal}
        onHide={() => setShowTransferModal(false)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>Передать ответственность</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalError && (
            <div className="alert alert-danger" role="alert">
              {modalError}
            </div>
          )}

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="newResponsibleUser">
                  Новый ответственный
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Select
                  id="newResponsibleUser"
                  name="newResponsibleUser"
                  placeholder="Выберите пользователя"
                  options={userOptions}
                  value={selectedNewUser}
                  onChange={(selectedOption) =>
                    handleTransferSelectChange(
                      "newResponsibleUser",
                      selectedOption,
                    )
                  }
                  isDisabled={modalLoading}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="transferReason">
                  Причина передачи
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Select
                  id="transferReason"
                  name="transferReason"
                  placeholder="Выберите причину"
                  options={transferReasons}
                  value={selectedTransferReason}
                  onChange={(selectedOption) =>
                    handleTransferSelectChange("transferReason", selectedOption)
                  }
                  isDisabled={modalLoading}
                />
              </Form.Group>
            </Col>
          </Row>

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="effectiveDate">
                  Дата вступления в силу
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Form.Control
                  id="effectiveDate"
                  name="effectiveDate"
                  type="date"
                  value={transferData.effectiveDate}
                  onChange={handleTransferInputChange}
                  disabled={modalLoading}
                />
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="transferNotes">Примечания</Form.Label>
            <Form.Control
              id="transferNotes"
              name="notes"
              as="textarea"
              rows={3}
              placeholder="Дополнительные комментарии (опционально)"
              value={transferData.notes}
              onChange={handleTransferInputChange}
              disabled={modalLoading}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowTransferModal(false)}
            disabled={modalLoading}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={transferResponsibility}
            disabled={
              modalLoading ||
              !transferData.newResponsibleUser ||
              !transferData.transferReason ||
              !transferData.effectiveDate
            }
          >
            {modalLoading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Передача...
              </>
            ) : (
              <>
                <RiEditLine className="me-2" />
                Передать
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Responsibility History Modal */}
      <Modal
        show={showHistoryModal}
        onHide={() => setShowHistoryModal(false)}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>История ответственности</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {loading ? (
            <div className="text-center">
              <span className="spinner-border spinner-border-sm me-2" />
              Загрузка истории...
            </div>
          ) : responsibilityHistory.length > 0 ? (
            <ListGroup>
              {responsibilityHistory.map((record, index) => (
                <ListGroup.Item key={record._id || index}>
                  <Row>
                    <Col md={4}>
                      <strong>
                        {record.responsibleUser?.firstName}{" "}
                        {record.responsibleUser?.lastName}
                      </strong>
                      <div className="text-muted small">
                        {record.responsibleUser?.email}
                      </div>
                    </Col>
                    <Col md={3}>
                      <Badge bg="primary">
                        {getResponsibilityTypeLabel(record.responsibilityType)}
                      </Badge>
                      <div className="mt-1">
                        <Badge
                          bg={record.isActive ? "success" : "secondary"}
                          className="small"
                        >
                          {record.isActive ? "Активна" : "Завершена"}
                        </Badge>
                      </div>
                    </Col>
                    <Col md={3}>
                      <div>
                        <strong>Назначена:</strong>{" "}
                        {formatDate(record.assignedDate)}
                      </div>
                      {record.transferredDate && (
                        <div>
                          <strong>Передана:</strong>{" "}
                          {formatDate(record.transferredDate)}
                        </div>
                      )}
                    </Col>
                    <Col md={2}>
                      {record.transferReason && (
                        <div className="small">
                          <strong>Причина:</strong>
                          <br />
                          {getTransferReasonLabel(record.transferReason)}
                        </div>
                      )}
                    </Col>
                  </Row>
                  {record.notes && (
                    <Row className="mt-2">
                      <Col>
                        <div className="small text-muted">
                          <strong>Примечания:</strong> {record.notes}
                        </div>
                      </Col>
                    </Row>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          ) : (
            <div className="text-muted text-center">
              История ответственности пуста
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowHistoryModal(false)}
          >
            Закрыть
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ResponsibilityManager;
