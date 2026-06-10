import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import { RiAddFill, RiCloseFill } from "react-icons/ri";

import Select from "../../UI/Select";
import AddDeviceAttributeModal from "./AddDeviceAttributeModal";

// Поля типа устройства. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Справочники (availableDeviceTypes/availableAttributes)
// приходят пропсами; новые атрибуты создаются во вложенной модалке.
const DeviceTypeFormFields = ({
  deviceType,
  availableDeviceTypes = [],
  availableAttributes: initialAvailableAttributes = [],
  onChange,
}) => {
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
  const [attributes, setAttributes] = useState(
    deviceType?.attributes?.map((attr) => ({
      attributeId: attr.attributeId._id,
      required: attr.required || false,
      extendable: attr.extendable || false,
    })) || [],
  );
  const [availableAttributes, setAvailableAttributes] = useState(
    initialAvailableAttributes,
  );
  const [showAttributeModal, setShowAttributeModal] = useState(false);
  const [currentAttributeIndex, setCurrentAttributeIndex] = useState(null);

  // Сообщаем состояние наверх (для модалки). На странице onChange игнорируется —
  // сабмит идёт через `name`-атрибуты.
  useEffect(() => {
    if (!onChange) return;
    onChange({
      name,
      isActive,
      isComponent,
      isConsumable,
      attachableToTypeIds: (attachableToTypeIds || []).map((t) => t._id || t),
      attributes: (attributes || [])
        .filter((a) => a.attributeId)
        .map((a) => ({
          attributeId: a.attributeId,
          required: !!a.required,
          extendable: !!a.extendable,
        })),
    });
  }, [
    name,
    isActive,
    isComponent,
    isConsumable,
    attachableToTypeIds,
    attributes,
  ]);

  const addAttributeHandler = () => {
    setAttributes([
      ...attributes,
      { attributeId: "", required: false, extendable: false },
    ]);
  };

  const removeAttributeHandler = (index) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const attributeChangeHandler = (index, field, value) => {
    const newAttributes = [...attributes];
    newAttributes[index] = { ...newAttributes[index], [field]: value };
    setAttributes(newAttributes);
  };

  const openAttributeModal = (index) => {
    setCurrentAttributeIndex(index);
    setShowAttributeModal(true);
  };

  const handleAttributeCreated = (newAttribute) => {
    setAvailableAttributes([...availableAttributes, newAttribute]);

    if (currentAttributeIndex !== null) {
      attributeChangeHandler(
        currentAttributeIndex,
        "attributeId",
        newAttribute._id,
      );
    }
  };

  return (
    <>
      {deviceType && (
        <Form.Group>
          <Form.Check
            checked={isActive}
            type="switch"
            id="isActive"
            name="isActive"
            label="Активен"
            className="py-2"
            value={isActive}
            onChange={() => setIsActive(!isActive)}
          />
        </Form.Group>
      )}
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
          onChange={(event) => setName(event.target.value)}
          placeholder="Введите название типа устройства"
        />
      </Form.Group>

      <Form.Group>
        <Form.Check
          checked={isComponent}
          type="switch"
          id="isComponent"
          name="isComponent"
          label="Комплектующие"
          className="py-2"
          value={isComponent}
          onChange={() => setIsComponent(!isComponent)}
        />
      </Form.Group>
      <Form.Group>
        <Form.Check
          checked={isConsumable}
          type="switch"
          id="isConsumable"
          name="isConsumable"
          label="Расходники"
          className="py-2"
          value={isConsumable}
          onChange={() => setIsConsumable(!isConsumable)}
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
            onChange={(selectedOptions) =>
              setAttachableToTypeIds(selectedOptions || [])
            }
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

      <Form.Group className="py-3">
        <Form.Label>Атрибуты устройства</Form.Label>
        {attributes.map((attr, index) => (
          <div key={index}>
            <Row className="mb-2 align-items-center">
              <Col md={5}>
                <Select
                  id={`attribute-${index}`}
                  name={`attributes[${index}].attributeId`}
                  value={availableAttributes.find(
                    (a) => a._id === attr.attributeId,
                  )}
                  onChange={(selected) =>
                    attributeChangeHandler(
                      index,
                      "attributeId",
                      selected?._id || "",
                    )
                  }
                  options={availableAttributes}
                  placeholder="Выберите из списка..."
                  isClearable
                  isSearchable
                  getOptionLabel={(option) => `${option.name} (${option.code})`}
                  getOptionValue={(option) => option._id}
                />
              </Col>

              <Col md={4}>
                <Button
                  className="me-4"
                  variant="danger"
                  size="sm"
                  onClick={() => removeAttributeHandler(index)}
                >
                  <RiCloseFill /> Удалить
                </Button>
                {!availableAttributes.find(
                  (a) => a._id === attr.attributeId,
                ) && (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => openAttributeModal(index)}
                    title="Создать новый атрибут"
                  >
                    <RiAddFill /> Создать новый
                  </Button>
                )}
              </Col>

              <Col md={1}></Col>
            </Row>
            <Row className="my-2">
              <Col sm="auto">
                <Form.Check
                  type="checkbox"
                  id={`required-${index}`}
                  name={`attributes[${index}].required`}
                  label="Обязательный"
                  checked={attr.required}
                  onChange={(e) =>
                    attributeChangeHandler(index, "required", e.target.checked)
                  }
                />
              </Col>
              <Col sm="auto">
                <Form.Check
                  type="checkbox"
                  id={`extendable-${index}`}
                  name={`attributes[${index}].extendable`}
                  label="Расширяемый"
                  checked={attr.extendable}
                  onChange={(e) =>
                    attributeChangeHandler(
                      index,
                      "extendable",
                      e.target.checked,
                    )
                  }
                />
              </Col>
            </Row>
            <Row className="mb-2"></Row>
          </div>
        ))}
        <Row>
          <Col>
            <Button variant="secondary" size="sm" onClick={addAttributeHandler}>
              Добавить атрибут
            </Button>
          </Col>
        </Row>
      </Form.Group>

      <AddDeviceAttributeModal
        show={showAttributeModal}
        onHide={() => setShowAttributeModal(false)}
        onAttributeCreated={handleAttributeCreated}
      />
    </>
  );
};

export default DeviceTypeFormFields;
