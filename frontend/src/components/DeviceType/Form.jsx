import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";

const DeviceTypeForm = ({ title }) => {
  const loaderData = useLoaderData();
  const deviceType = loaderData?.deviceType;
  const availableDeviceTypes = loaderData?.availableDeviceTypes || [];

  const [name, setName] = useState(deviceType?.name || "");
  const [isActive, setIsActive] = useState(
    deviceType ? deviceType.isActive : true,
  );
  const [isComponent, setIsComponent] = useState(
    deviceType ? deviceType.isComponent : false,
  );
  const [isConsumable, setIsConsumable] = useState(
    deviceType ? deviceType.isConsumable : false,
  );
  const [attachableToTypeIds, setAttachableToTypeIds] = useState(
    deviceType?.attachableToTypeIds || [],
  );

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const isComponentChangeHandler = () => {
    setIsComponent(!isComponent);
  };

  const isConsumableChangeHandler = () => {
    setIsConsumable(!isConsumable);
  };

  const attachableToTypeIdsChangeHandler = (selectedOptions) => {
    setAttachableToTypeIds(selectedOptions || []);
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
          checked={isComponent}
          type="switch"
          id="isComponent"
          name="isComponent"
          label="Является комплектующим"
          className="py-2"
          value={isComponent}
          onChange={isComponentChangeHandler}
        />
      </Form.Group>
      <Form.Group>
        <Form.Check
          checked={isConsumable}
          type="switch"
          id="isConsumable"
          name="isConsumable"
          label="Является расходником"
          className="py-2"
          value={isConsumable}
          onChange={isConsumableChangeHandler}
        />
      </Form.Group>
      {(isComponent || isConsumable) && (
        <Form.Group className="py-3">
          <Form.Label htmlFor="attachableToTypeIds">
            К каким типам устройств можно прикреплять
          </Form.Label>
          <Select
            id="attachableToTypeIds"
            name="attachableToTypeIds"
            value={attachableToTypeIds}
            onChange={attachableToTypeIdsChangeHandler}
            options={availableDeviceTypes}
            placeholder="Выберите типы устройств..."
            required
            isClearable
            isSearchable
            isMulti
            closeMenuOnSelect={false}
            getOptionLabel={(option) => `${option.name}`}
            getOptionValue={(option) => option._id}
          />
          <Form.Text className="text-muted">
            Можно выбрать несколько типов устройств
          </Form.Text>
        </Form.Group>
      )}
    </FormWrapper>
  );
};

export default DeviceTypeForm;
