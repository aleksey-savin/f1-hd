import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";

const VendorForm = ({ title }) => {
  const vendor = useLoaderData();

  const [name, setName] = useState(vendor?.name || "");
  const [isActive, setIsActive] = useState(vendor ? vendor.isActive : true);

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
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
    </FormWrapper>
  );
};

export default VendorForm;
