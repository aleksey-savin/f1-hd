import { useState } from "react";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const DeviceAttributeFormFields = ({ attribute, onChange }) => {
  const [code, setCode] = useState(attribute?.code || "");
  const [name, setName] = useState(attribute?.name || "");
  const [valueType, setValueType] = useState(attribute?.valueType || "string");
  const [unit, setUnit] = useState(attribute?.unit || "");
  const [options, setOptions] = useState(
    attribute?.options?.map((option) => option.value).join("\n") || "",
  );
  const [isActive, setIsActive] = useState(
    attribute ? attribute.isActive : true,
  );

  const codeChangeHandler = (event) => {
    const newCode = event.target.value;
    setCode(newCode);
    notifyChange({ code: newCode, name, valueType, unit, options, isActive });
  };

  const nameChangeHandler = (event) => {
    const newName = event.target.value;
    setName(newName);
    notifyChange({ code, name: newName, valueType, unit, options, isActive });
  };

  const valueTypeChangeHandler = (event) => {
    const newValueType = event.target.value;
    setValueType(newValueType);
    notifyChange({
      code,
      name,
      valueType: newValueType,
      unit,
      options,
      isActive,
    });
  };

  const unitChangeHandler = (event) => {
    const newUnit = event.target.value;
    setUnit(newUnit);
    notifyChange({ code, name, valueType, unit: newUnit, options, isActive });
  };

  const optionsChangeHandler = (event) => {
    const newOptions = event.target.value;
    setOptions(newOptions);
    notifyChange({ code, name, valueType, unit, options: newOptions, isActive });
  };

  const isActiveChangeHandler = () => {
    const newIsActive = !isActive;
    setIsActive(newIsActive);
    notifyChange({ code, name, valueType, unit, options, isActive: newIsActive });
  };

  const notifyChange = (data) => {
    if (onChange) {
      onChange(data);
    }
  };

  const showOptionsField =
    valueType === "select" || valueType === "multiselect";

  return (
    <>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="code">
              Код
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              autoFocus
              id="code"
              name="code"
              type="text"
              value={code}
              onChange={codeChangeHandler}
              placeholder="ram, processor, screenSize"
            />
            <Form.Text className="text-muted">
              Латиница, без пробелов, camelCase
            </Form.Text>
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="name">
              Наименование
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={nameChangeHandler}
              placeholder="Оперативная память"
            />
            <Form.Text className="text-muted">
              Отображаемое название на русском
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="valueType">
              Тип данных
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Select
              required
              id="valueType"
              name="valueType"
              value={valueType}
              onChange={valueTypeChangeHandler}
            >
              <option value="string">Строка (string)</option>
              <option value="number">Число (number)</option>
              <option value="boolean">Да/Нет (boolean)</option>
              <option value="select">Выбор (select)</option>
              <option value="multiselect">
                Множественный выбор (multiselect)
              </option>
              <option value="text">Текст (text)</option>
            </Form.Select>
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="unit">Единица измерения</Form.Label>
            <Form.Control
              id="unit"
              name="unit"
              type="text"
              value={unit}
              onChange={unitChangeHandler}
              placeholder="ГБ, дюймов, Вт"
            />
            <Form.Text className="text-muted">
              Опционально (ГБ, MHz, дюймов)
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>

      {showOptionsField && (
        <Form.Group className="mb-3">
          <Form.Label htmlFor="options">
            Варианты выбора
            <span style={{ color: "red" }}>*</span>
          </Form.Label>
          <Form.Control
            required={showOptionsField}
            id="options"
            name="options"
            as="textarea"
            rows={5}
            value={options}
            onChange={optionsChangeHandler}
            placeholder="4&#10;8&#10;16&#10;32&#10;64"
          />
          <Form.Text className="text-muted">
            Каждый вариант с новой строки
          </Form.Text>
        </Form.Group>
      )}

      <Form.Group>
        <Form.Check
          checked={isActive}
          type="switch"
          id="isActive"
          name="isActive"
          label="Активен"
          value={isActive}
          onChange={isActiveChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default DeviceAttributeFormFields;
