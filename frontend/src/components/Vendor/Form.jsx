import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";

const VendorForm = ({ title }) => {
  const vendor = useLoaderData();

  const [name, setName] = useState(vendor?.name || "");
  const [isActive, setIsActive] = useState(vendor ? vendor.isActive : true);
  const [isMikrotikManagementEnabled, setIsMikrotikManagementEnabled] =
    useState(vendor ? vendor.isMikrotikManagementEnabled : false);

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const isMikrotikManagementEnabledChangeHandler = () => {
    setIsMikrotikManagementEnabled(!isMikrotikManagementEnabled);
  };

  return (
    <FormWrapper title={title}>
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
    </FormWrapper>
  );
};

export default VendorForm;
