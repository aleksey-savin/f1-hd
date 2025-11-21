import { useState, useEffect } from "react";

import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";

import { useLoaderData } from "react-router";

import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";
import AlertMessage from "../../UI/AlertMessage";
import { getLocalStorageData } from "../../util/auth";

import { RiAddLine, RiSaveLine } from "react-icons/ri";

const ClientDeviceForm = ({ title }) => {
  const data = useLoaderData();

  const formatDate = (date) => {
    if (!date) return "";
    const utcDate = new Date(date);
    return utcDate.toISOString().split("T")[0];
  };

  const [clientDevice, setClientDevice] = useState(
    data || {
      company: "",
      user: "",
      location: "",
      assignmentOption: "", // Новое поле для комбинированного выбора
      deviceType: "",
      vendor: "",
      model: "",
      serialNumber: "",
      purchaseDate: "",
      price: 0,
      purchaseDocument: "",
      warrantyExpirationDate: "",
      lastMaintenanceDate: "",
      notes: "",
      assignedTo: "",
      ipAddress: "",
      macAddress: "",
      operatingSystem: "",
      status: "Готово к выдаче",
    },
  );

  const [companies, setCompanies] = useState([]);
  const [assignmentOptions, setAssignmentOptions] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modal states
  const [showDeviceTypeModal, setShowDeviceTypeModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");

  // New item forms
  const [newDeviceType, setNewDeviceType] = useState({
    name: "",
    description: "",
  });
  const [newVendor, setNewVendor] = useState({
    name: "",
    description: "",
  });

  const clientDeviceChangeHandler = (event) => {
    const { name, value } = event.target;

    setClientDevice({
      ...clientDevice,
      [name]: value,
    });

    // If company changes, reset assignment options and fetch new data
    if (name === "company") {
      setClientDevice((prev) => ({
        ...prev,
        [name]: value,
        user: "", // Reset user when company changes
        location: "", // Reset location when company changes
        assignmentOption: "", // Reset assignment option when company changes
      }));
      if (value) {
        fetchAssignmentOptions(value);
      } else {
        setAssignmentOptions([]);
      }
    }
  };

  const handleSelectChange = (name, selectedOption) => {
    const value = selectedOption ? selectedOption.value : "";

    setClientDevice({
      ...clientDevice,
      [name]: value,
    });

    // If company changes, reset assignment options and fetch new data
    if (name === "company") {
      setClientDevice((prev) => ({
        ...prev,
        [name]: value,
        user: "", // Reset user when company changes
        location: "", // Reset location when company changes
        assignmentOption: "", // Reset assignment option when company changes
      }));
      if (value) {
        fetchAssignmentOptions(value);
      } else {
        setAssignmentOptions([]);
      }
    }
  };

  const fetchReferenceData = async () => {
    setLoading(true);
    const { token } = getLocalStorageData();

    try {
      // Fetch companies
      const companiesResponse = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/reference/companies`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const companiesData = await companiesResponse.json();
      setCompanies(companiesData);

      // Fetch device types
      const deviceTypesResponse = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/reference/device-types`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const deviceTypesData = await deviceTypesResponse.json();
      setDeviceTypes(deviceTypesData);

      // Fetch vendors
      const vendorsResponse = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/reference/vendors`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const vendorsData = await vendorsResponse.json();
      setVendors(vendorsData);

      // If editing existing device, fetch assignment options for the company
      if (data && data.company) {
        fetchAssignmentOptions(data.company._id || data.company);
      }
    } catch (error) {
      console.error("Error fetching reference data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignmentOptions = async (companyId) => {
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/reference/assignment-options?companyId=${companyId}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );
      const optionsData = await response.json();
      setAssignmentOptions(optionsData);
    } catch (error) {
      console.error("Error fetching assignment options:", error);
      setAssignmentOptions([]);
    }
  };

  const createDeviceType = async () => {
    setModalLoading(true);
    setModalError("");
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            ...newDeviceType,
            isActive: true,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create device type");
      }

      const responseData = await response.json();
      const createdDeviceType = responseData.deviceType;

      // Update device types list
      setDeviceTypes((prev) =>
        [...prev, createdDeviceType].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );

      // Set the new device type as selected
      setClientDevice((prev) => ({
        ...prev,
        deviceType: createdDeviceType._id,
      }));

      // Reset form and close modal
      setNewDeviceType({ name: "", description: "" });
      setShowDeviceTypeModal(false);
    } catch (error) {
      setModalError(error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const createVendor = async () => {
    setModalLoading(true);
    setModalError("");
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            ...newVendor,
            isActive: true,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create vendor");
      }

      const responseData = await response.json();
      const createdVendor = responseData.vendor;

      // Update vendors list
      setVendors((prev) =>
        [...prev, createdVendor].sort((a, b) => a.name.localeCompare(b.name)),
      );

      // Set the new vendor as selected
      setClientDevice((prev) => ({
        ...prev,
        vendor: createdVendor._id,
      }));

      // Reset form and close modal
      setNewVendor({ name: "", description: "" });
      setShowVendorModal(false);
    } catch (error) {
      setModalError(error.message);
    } finally {
      setModalLoading(false);
    }
  };

  useEffect(() => {
    fetchReferenceData();
  }, []);

  const deviceStatusList = [
    "Готово к выдаче",
    "Выдано",
    "В ремонте",
    "Списано",
  ];

  // Helper function to format group labels
  const formatGroupLabel = (data) => (
    <div
      style={{
        color: "#666",
        fontWeight: "bold",
        fontSize: "0.9em",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {data.label}
    </div>
  );

  // Helper function to find option in grouped data
  function findOptionInGroups(groups, value) {
    for (const group of groups) {
      if (group.options) {
        const found = group.options.find((option) => option.value === value);
        if (found) return found;
      }
    }
    return null;
  }

  // Convert data to react-select format
  const companyOptions = companies.map((company) => ({
    value: company._id,
    label: `${company.alias}`,
  }));

  const deviceTypeOptions = deviceTypes.map((deviceType) => ({
    value: deviceType._id,
    label: deviceType.name,
  }));

  const vendorOptions = vendors.map((vendor) => ({
    value: vendor._id,
    label: vendor.name,
  }));

  const statusOptions = deviceStatusList.map((status) => ({
    value: status,
    label: status,
  }));

  // Get current selected values
  const selectedCompany = companyOptions.find(
    (option) =>
      option.value === (clientDevice.company._id || clientDevice.company),
  );
  const selectedDeviceType = deviceTypeOptions.find(
    (option) =>
      option.value === (clientDevice.deviceType._id || clientDevice.deviceType),
  );
  const selectedVendor = vendorOptions.find(
    (option) =>
      option.value === (clientDevice.vendor._id || clientDevice.vendor),
  );
  const selectedStatus = statusOptions.find(
    (option) => option.value === clientDevice.status,
  );

  // Get current selected assignment option
  const selectedAssignmentOption = clientDevice.assignmentOption
    ? findOptionInGroups(assignmentOptions, clientDevice.assignmentOption)
    : null;

  return (
    <>
      <FormWrapper title={title}>
        {/* Company and Assignment Information */}
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0">Информация о компании и назначении</h6>
          </Card.Header>
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="company">
                Компания
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="company"
                name="company"
                placeholder="Выберите компанию"
                options={companyOptions}
                value={selectedCompany}
                onChange={(selectedOption) =>
                  handleSelectChange("company", selectedOption)
                }
                isDisabled={loading}
                isClearable
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="assignmentOption">
                Назначение устройства
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="assignmentOption"
                name="assignmentOption"
                placeholder="Выберите расположение или пользователя"
                options={assignmentOptions}
                value={selectedAssignmentOption}
                onChange={(selectedOption) =>
                  handleSelectChange("assignmentOption", selectedOption)
                }
                isDisabled={!clientDevice.company || loading}
                isClearable
                isSearchable
                formatGroupLabel={formatGroupLabel}
              />
              <Form.Text className="text-muted">
                Выберите конкретное расположение или пользователя (устройство
                будет назначено на его рабочее место)
              </Form.Text>
            </Form.Group>

            {/* Hidden inputs for FormData */}
            <input
              type="hidden"
              name="company"
              value={clientDevice.company._id || clientDevice.company || ""}
            />
            <input
              type="hidden"
              name="assignmentOption"
              value={clientDevice.assignmentOption || ""}
            />
          </Card.Body>
        </Card>

        {/* Device Information */}
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0">Информация об устройстве</h6>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="deviceType">
                    Тип устройства
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <div className="d-flex gap-2">
                    <Select
                      id="deviceType"
                      name="deviceType"
                      placeholder="Выберите тип устройства"
                      options={deviceTypeOptions}
                      value={selectedDeviceType}
                      onChange={(selectedOption) =>
                        handleSelectChange("deviceType", selectedOption)
                      }
                      isDisabled={loading}
                      isClearable
                      className="flex-grow-1"
                    />
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => setShowDeviceTypeModal(true)}
                      title="Добавить новый тип устройства"
                    >
                      <RiAddLine />
                    </Button>
                  </div>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="vendor">
                    Производитель
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <div className="d-flex gap-2">
                    <Select
                      id="vendor"
                      name="vendor"
                      placeholder="Выберите производителя"
                      options={vendorOptions}
                      value={selectedVendor}
                      onChange={(selectedOption) =>
                        handleSelectChange("vendor", selectedOption)
                      }
                      isDisabled={loading}
                      isClearable
                      className="flex-grow-1"
                    />
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => setShowVendorModal(true)}
                      title="Добавить нового производителя"
                    >
                      <RiAddLine />
                    </Button>
                  </div>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="model">
                    Модель
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Form.Control
                    id="model"
                    name="model"
                    type="text"
                    placeholder="Введите модель устройства"
                    value={clientDevice.model}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="serialNumber">
                    Серийный номер
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Form.Control
                    id="serialNumber"
                    name="serialNumber"
                    type="text"
                    placeholder="Введите серийный номер"
                    value={clientDevice.serialNumber}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="status">
                Статус
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Select
                id="status"
                name="status"
                placeholder="Выберите статус"
                options={statusOptions}
                value={selectedStatus}
                onChange={(selectedOption) =>
                  handleSelectChange("status", selectedOption)
                }
                isClearable={false}
              />
            </Form.Group>

            {/* Hidden inputs for FormData */}
            <input
              type="hidden"
              name="deviceType"
              value={
                clientDevice.deviceType._id || clientDevice.deviceType || ""
              }
            />
            <input
              type="hidden"
              name="vendor"
              value={clientDevice.vendor._id || clientDevice.vendor || ""}
            />
            <input
              type="hidden"
              name="status"
              value={clientDevice.status || ""}
            />
          </Card.Body>
        </Card>

        {/* Purchase Information */}
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0">Информация о покупке</h6>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="purchaseDate">
                    Дата приобретения
                  </Form.Label>
                  <Form.Control
                    id="purchaseDate"
                    name="purchaseDate"
                    type="date"
                    value={formatDate(clientDevice.purchaseDate)}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="price">
                    Стоимость
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Form.Control
                    id="price"
                    name="price"
                    type="number"
                    placeholder="0"
                    value={clientDevice.price}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="purchaseDocument">Документ</Form.Label>
                  <Form.Control
                    id="purchaseDocument"
                    name="purchaseDocument"
                    type="text"
                    placeholder="Номер документа о покупке"
                    value={clientDevice.purchaseDocument}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="warrantyExpirationDate">
                    Гарантия до
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Form.Control
                    id="warrantyExpirationDate"
                    name="warrantyExpirationDate"
                    type="date"
                    value={formatDate(clientDevice.warrantyExpirationDate)}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Technical Information */}
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0">Техническая информация</h6>
          </Card.Header>
          <Card.Body>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="ipAddress">IP-адрес</Form.Label>
                  <Form.Control
                    id="ipAddress"
                    name="ipAddress"
                    type="text"
                    placeholder="192.168.1.100"
                    value={clientDevice.ipAddress}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="macAddress">MAC-адрес</Form.Label>
                  <Form.Control
                    id="macAddress"
                    name="macAddress"
                    type="text"
                    placeholder="AA:BB:CC:DD:EE:FF"
                    value={clientDevice.macAddress}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="operatingSystem">
                    Операционная система
                  </Form.Label>
                  <Form.Control
                    id="operatingSystem"
                    name="operatingSystem"
                    type="text"
                    placeholder="Windows 11, macOS, Ubuntu 22.04"
                    value={clientDevice.operatingSystem}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="lastMaintenanceDate">
                    Дата последнего обслуживания
                  </Form.Label>
                  <Form.Control
                    id="lastMaintenanceDate"
                    name="lastMaintenanceDate"
                    type="date"
                    value={formatDate(clientDevice.lastMaintenanceDate)}
                    onChange={clientDeviceChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Additional Information */}
        <Card className="mb-4">
          <Card.Header>
            <h6 className="mb-0">Дополнительная информация</h6>
          </Card.Header>
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="notes">Заметки</Form.Label>
              <Form.Control
                id="notes"
                name="notes"
                as="textarea"
                rows={4}
                placeholder="Дополнительные заметки об устройстве..."
                value={clientDevice.notes}
                onChange={clientDeviceChangeHandler}
              />
            </Form.Group>
          </Card.Body>
        </Card>
      </FormWrapper>

      {/* Device Type Modal */}
      <Modal
        show={showDeviceTypeModal}
        onHide={() => setShowDeviceTypeModal(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Новый тип устройства</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalError && <AlertMessage variant="danger" message={modalError} />}
          <Form.Group className="mb-3">
            <Form.Label htmlFor="deviceTypeName">
              Название
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              id="deviceTypeName"
              type="text"
              placeholder="Например: Ноутбук, Принтер, Монитор"
              value={newDeviceType.name}
              onChange={(e) =>
                setNewDeviceType((prev) => ({ ...prev, name: e.target.value }))
              }
              autoFocus
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="deviceTypeDescription">Описание</Form.Label>
            <Form.Control
              id="deviceTypeDescription"
              as="textarea"
              rows={3}
              placeholder="Описание типа устройства (необязательно)"
              value={newDeviceType.description}
              onChange={(e) =>
                setNewDeviceType((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setShowDeviceTypeModal(false);
              setNewDeviceType({ name: "", description: "" });
              setModalError("");
            }}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={createDeviceType}
            disabled={modalLoading || !newDeviceType.name.trim()}
          >
            <RiSaveLine /> {modalLoading ? "Сохранение..." : "Сохранить"}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Vendor Modal */}
      <Modal
        show={showVendorModal}
        onHide={() => setShowVendorModal(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Новый производитель</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalError && <AlertMessage variant="danger" message={modalError} />}
          <Form.Group className="mb-3">
            <Form.Label htmlFor="vendorName">
              Название
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              id="vendorName"
              type="text"
              placeholder="Например: Dell, HP, Apple, Lenovo"
              value={newVendor.name}
              onChange={(e) =>
                setNewVendor((prev) => ({ ...prev, name: e.target.value }))
              }
              autoFocus
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="vendorDescription">Описание</Form.Label>
            <Form.Control
              id="vendorDescription"
              as="textarea"
              rows={3}
              placeholder="Описание производителя (необязательно)"
              value={newVendor.description}
              onChange={(e) =>
                setNewVendor((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setShowVendorModal(false);
              setNewVendor({ name: "", description: "" });
              setModalError("");
            }}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={createVendor}
            disabled={modalLoading || !newVendor.name.trim()}
          >
            <RiSaveLine /> {modalLoading ? "Сохранение..." : "Сохранить"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default ClientDeviceForm;
