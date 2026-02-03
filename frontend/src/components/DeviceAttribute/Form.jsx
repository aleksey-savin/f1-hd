import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const DeviceAttributeForm = ({ title }) => {
  const attribute = useLoaderData();

  const [name, setName] = useState(attribute?.name || "");
  const [label, setLabel] = useState(attribute?.label || "");
  const [description, setDescription] = useState(attribute?.description || "");
  const [dataType, setDataType] = useState(attribute?.dataType || "string");
  const [unit, setUnit] = useState(attribute?.unit || "");
  const [options, setOptions] = useState(
    attribute?.options?.join("\n") || ""
  );
  const [isActive, setIsActive] = useState(
    attribute ? attribute.isActive : true
  );

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const labelChangeHandler = (event) => {
    setLabel(event.target.value);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const dataTypeChangeHandler = (event) => {
    setDataType(event.target.value);
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

  const showOptionsField = dataType === "select" || dataType === "multiselect";

  return (
    <FormWrapper title={title}>
      <Row>
        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="name">
              Имя (name)
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
              Название (label)
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              id="label"
              name="label"
              type="text"
              value={label}
              onChange={labelChangeHandler}
              placeholder="Оперативная память"
            />
            <Form.Text className="text-muted">
              Отображаемое название на русском
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="py-3">
        <Form.Label htmlFor="description">Описание</Form.Label>
        <Form.Control
          id="description"
          name="description"
          as="textarea"
          rows={2}
          value={description}
          onChange={descriptionChangeHandler}
          placeholder="Краткое описание атрибута"
        />
      </Form.Group>

      <Row>
        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="dataType">
              Тип данных
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Select
              required
              id="dataType"
              name="dataType"
              value={dataType}
              onChange={dataTypeChangeHandler}
            >
              <option value="string">Строка (string)</option>
              <option value="number">Число (number)</option>
              <option value="boolean">Да/Нет (boolean)</option>
              <option value="select">Выбор (select)</option>
              <option value="multiselect">Множественный выбор (multiselect)</option>
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
