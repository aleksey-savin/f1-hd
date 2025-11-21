import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";

const DeviceTypeForm = ({ title }) => {
  const deviceType = useLoaderData();

  const [name, setName] = useState(deviceType?.name || "");
  const [description, setDescription] = useState(deviceType?.description || "");
  const [isActive, setIsActive] = useState(
    deviceType ? deviceType.isActive : true,
  );

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  return (
    <FormWrapper title={title}>
      <Form.Group className="py-3">
        <Form.Label htmlFor="name">
          Название типа устройства
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
          placeholder="Введите название типа устройства"
        />
      </Form.Group>

      <Form.Group className="py-3">
        <Form.Label htmlFor="description">Описание</Form.Label>
        <Form.Control
          id="description"
          name="description"
          as="textarea"
          rows={3}
          value={description}
          onChange={descriptionChangeHandler}
          placeholder="Введите описание типа устройства"
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

export default DeviceTypeForm;
