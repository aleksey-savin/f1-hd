import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";

// Поля вендора. Рендерят `name`-атрибуты (для сабмита со страницы через
// react-router action) и одновременно сообщают агрегированное состояние через
// onChange (для инлайн-модалки, которая шлёт fetch напрямую).
const VendorFormFields = ({ vendor, onChange }) => {
  const [name, setName] = useState(vendor?.name || "");
  const [isActive, setIsActive] = useState(vendor ? vendor.isActive : true);
  const [isMikrotikManagementEnabled, setIsMikrotikManagementEnabled] =
    useState(vendor ? vendor.isMikrotikManagementEnabled : false);

  const emit = (data) => {
    if (onChange) onChange(data);
  };

  // Сообщаем начальное состояние, чтобы модалка имела полный объект без правок.
  useEffect(() => {
    emit({ name, isActive, isMikrotikManagementEnabled });
  }, []);

  const nameChangeHandler = (event) => {
    const newName = event.target.value;
    setName(newName);
    emit({ name: newName, isActive, isMikrotikManagementEnabled });
  };

  const isActiveChangeHandler = () => {
    const newIsActive = !isActive;
    setIsActive(newIsActive);
    emit({ name, isActive: newIsActive, isMikrotikManagementEnabled });
  };

  const isMikrotikManagementEnabledChangeHandler = () => {
    const newValue = !isMikrotikManagementEnabled;
    setIsMikrotikManagementEnabled(newValue);
    emit({ name, isActive, isMikrotikManagementEnabled: newValue });
  };

  return (
    <>
      <Form.Group className="py-3">
        <Form.Label htmlFor="name">
          Название вендора
          <span style={{ color: "red" }}>*</span>
        </Form.Label>
        <Form.Control
          required
          autoFocus
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={nameChangeHandler}
          placeholder="Введите название вендора"
        />
      </Form.Group>

      <Form.Group>
        <Form.Check
          checked={isActive}
          type="switch"
          id="isActive"
          name="isActive"
          label="Активен"
          className="py-2"
          value={isActive}
          onChange={isActiveChangeHandler}
        />
      </Form.Group>

      <Form.Group>
        <Form.Check
          checked={isMikrotikManagementEnabled}
          type="switch"
          id="isMikrotikManagementEnabled"
          name="isMikrotikManagementEnabled"
          label="Включить управление устройствами Mikrotik"
          className="py-2"
          value={isMikrotikManagementEnabled}
          onChange={isMikrotikManagementEnabledChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default VendorFormFields;
