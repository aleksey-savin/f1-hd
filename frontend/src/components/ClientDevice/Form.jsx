import { useState } from "react";

import Form from "react-bootstrap/Form";

import { useLoaderData } from "react-router";

import FormWrapper from "../../UI/FormWrapper";

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
      deviceType: "",
      manufacturer: "",
      model: "",
      serialNumber: "",
      purchaseDate: "",
      price: 0,
      purchaseDocument: "",
      warrantyExpirationDate: "",
      lastMaintananceDate: "",
      notes: "",
      assignedTo: "",
      ipAddress: "",
      macAddress: "",
      operatingSystem: "",
      status: "",
    },
  );

  const clientDeviceChangeHandler = (event) => {
    setClientDevice({
      ...clientDevice,
      [event.target.name]: event.target.value,
    });
  };

  const deviceStatusList = [
    "Готово к выдаче",
    "Выдано",
    "В ремонте",
    "Списано",
  ];

  return (
    <FormWrapper title={title}>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="company">
          Компания
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          required
          autoFocus
          id="company"
          name="company"
          type="text"
          value={clientDevice.company}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="user">Пользователь</Form.Label>
        <Form.Control
          id="user"
          name="user"
          type="text"
          value={clientDevice.user}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="location">Расположение</Form.Label>
        <Form.Control
          id="location"
          name="location"
          type="text"
          value={clientDevice.location}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="deviceType">
          Тип устройства
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          id="deviceType"
          name="deviceType"
          type="text"
          value={clientDevice.deviceType}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="manufacturer">
          Производитель
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          id="manufacturer"
          name="manufacturer"
          type="text"
          value={clientDevice.manufacturer}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="model">
          Модель
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          id="model"
          name="model"
          type="text"
          value={clientDevice.model}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="serialNumber">
          Серийный номер
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          id="serialNumber"
          name="serialNumber"
          type="text"
          value={clientDevice.serialNumber}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="purchaseDocument">Документ</Form.Label>
        <Form.Control
          id="purchaseDocument"
          name="purchaseDocument"
          type="text"
          value={clientDevice.purchaseDocument}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="purchaseDate">Дата приобретения</Form.Label>
        <Form.Control
          id="purchaseDate"
          name="purchaseDate"
          type="date"
          value={formatDate(clientDevice.purchaseDate)}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="price">
          Стоимость
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          id="price"
          name="price"
          type="number"
          value={clientDevice.price}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
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
      <Form.Group className="mb-3">
        <Form.Label htmlFor="ipAddress">IP-адрес</Form.Label>
        <Form.Control
          id="ipAddress"
          name="ipAddress"
          type="text"
          value={clientDevice.ipAddress}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="macAddress">MAC-адрес</Form.Label>
        <Form.Control
          id="macAddress"
          name="macAddress"
          type="text"
          value={clientDevice.macAddress}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="operatingSystem">Операционная система</Form.Label>
        <Form.Control
          id="operatingSystem"
          name="operatingSystem"
          type="text"
          value={clientDevice.operatingSystem}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="notes">Заметки</Form.Label>
        <Form.Control
          id="notes"
          name="notes"
          as="textarea"
          rows={3}
          value={clientDevice.notes}
          onChange={clientDeviceChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label htmlFor="status">Статус</Form.Label>
        <Form.Select
          id="status"
          name="status"
          placeholder="Выберите статус"
          required
          value={clientDevice.status}
          onChange={clientDeviceChangeHandler}
        >
          {deviceStatusList.map((status) => {
            return <option key={status}>{status}</option>;
          })}
        </Form.Select>
      </Form.Group>
    </FormWrapper>
  );
};

export default ClientDeviceForm;
