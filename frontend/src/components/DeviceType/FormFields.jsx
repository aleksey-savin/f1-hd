import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import {
  RiAddFill,
  RiCloseFill,
  RiArrowUpLine,
  RiArrowDownLine,
} from "react-icons/ri";

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
  const [isPeripheral, setIsPeripheral] = useState(
    deviceType ? deviceType.isPeripheral : false,
  );
  const [inventoryPrefix, setInventoryPrefix] = useState(
    deviceType?.inventoryPrefix || "",
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
      isPeripheral,
      inventoryPrefix,
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
    isPeripheral,
    inventoryPrefix,
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

  // Перемещение атрибута для управляемой последовательности (dir: -1 вверх, +1 вниз).
  const moveAttribute = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= attributes.length) return;
    const next = [...attributes];
    [next[index], next[target]] = [next[target], next[index]];
    setAttributes(next);
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

      <Form.Group className="pb-2">
        <Form.Label htmlFor="inventoryPrefix">
          Префикс инвентарного номера
        </Form.Label>
        <Form.Control
          id="inventoryPrefix"
          name="inventoryPrefix"
          type="text"
          value={inventoryPrefix}
          onChange={(event) =>
            setInventoryPrefix(event.target.value.toUpperCase())
          }
          placeholder="Напр. СБ — номера вида СБ-000001"
        />
        <Form.Text className="text-muted">
          Используется для автогенерации инвентарных номеров устройств этого
          типа. Пусто — префикс по умолчанию.
        </Form.Text>
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
      <Form.Group>
        <Form.Check
          checked={isPeripheral}
          type="switch"
          id="isPeripheral"
          name="isPeripheral"
          label="Периферия"
          className="py-2"
          value={isPeripheral}
          onChange={() => setIsPeripheral(!isPeripheral)}
        />
      </Form.Group>
      {(isComponent || isConsumable || isPeripheral) && (
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
        {attributes.map((attr, index) => {
          // Уже выбранные в других строках атрибуты убираем из списка (своё
          // значение оставляем, чтобы оно отображалось).
          const usedElsewhere = new Set(
            attributes
              .filter((_, j) => j !== index)
              .map((a) => a.attributeId)
              .filter(Boolean),
          );
          const optionsForRow = availableAttributes.filter(
            (a) => a._id === attr.attributeId || !usedElsewhere.has(a._id),
          );

          return (
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
                    options={optionsForRow}
                    placeholder="Выберите из списка..."
                    isClearable
                    isSearchable
                    getOptionLabel={(option) =>
                      `${option.name} (${option.code})`
                    }
                    getOptionValue={(option) => option._id}
                  />
                </Col>

                <Col md={7} className="d-flex align-items-center gap-2">
                  <div className="btn-group" role="group">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => moveAttribute(index, -1)}
                      disabled={index === 0}
                      title="Переместить выше"
                    >
                      <RiArrowUpLine />
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => moveAttribute(index, 1)}
                      disabled={index === attributes.length - 1}
                      title="Переместить ниже"
                    >
                      <RiArrowDownLine />
                    </Button>
                  </div>
                  <Button
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
          );
        })}
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
