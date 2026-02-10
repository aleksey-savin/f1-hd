import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const DeviceAttributeForm = ({ title }) => {
  const attribute = useLoaderData();

  const [code, setCode] = useState(attribute?.code || "");
  const [name, setName] = useState(attribute?.name || "");
  const [valueType, setValueType] = useState(attribute?.valueType || "string");
  const [unit, setUnit] = useState(attribute?.unit || "");
  const [options, setOptions] = useState(attribute?.options?.join("\n") || "");
  const [isActive, setIsActive] = useState(
    attribute ? attribute.isActive : true,
  );

  const codeChangeHandler = (event) => {
    setCode(event.target.value);
  };

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const valueTypeChangeHandler = (event) => {
    setValueType(event.target.value);
  };

  const unitChangeHandler = (event) => {
    setUnit(event.target.value);
  };

  const optionsChangeHandler = (event) => {
    setOptions(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const showOptionsField =
    valueType === "select" || valueType === "multiselect";

  return (
    <FormWrapper title={title}>
      <Row>
        <Col md={6}>
          <Form.Group className="py-3">
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
          <Form.Group className="py-3">
            <Form.Label htmlFor="label">
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
          <Form.Group className="py-3">
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
          <Form.Group className="py-3">
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
        <Form.Group className="py-3">
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
          className="py-2"
          value={isActive}
          onChange={isActiveChangeHandler}
        />
      </Form.Group>
    </FormWrapper>
  );
};

export default DeviceAttributeForm;
