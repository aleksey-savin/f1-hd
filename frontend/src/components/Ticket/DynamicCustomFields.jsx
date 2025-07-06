import { Row, Col, Button, Form } from "react-bootstrap";
import Select from "../../UI/Select";

const FIELD_TYPES = {
  TEXT: "text",
  SELECT: "select",
  MULTISELECT: "multiselect",
};

const DynamicCustomFields = ({ customFields, setCustomFields }) => {
  const addCustomField = () => {
    setCustomFields([
      ...customFields,
      {
        name: "",
        type: FIELD_TYPES.TEXT,
        value: "",
        options: [],
      },
    ]);
  };

  const removeCustomField = (index) => {
    const newFields = customFields.filter((_, i) => i !== index);
    setCustomFields(newFields);
  };

  const updateField = (index, field, value) => {
    const newFields = [...customFields];
    newFields[index] = { ...newFields[index], [field]: value };

    // Reset value when changing type
    if (field === "type") {
      newFields[index].value = "";
      if (value === FIELD_TYPES.SELECT) {
        newFields[index].options = [""];
      } else {
        delete newFields[index].options;
      }
    }

    setCustomFields(newFields);
  };

  const addOption = (fieldIndex) => {
    const newFields = [...customFields];
    newFields[fieldIndex].options = [
      ...(newFields[fieldIndex].options || []),
      "",
    ];

    setCustomFields(newFields);

    setTimeout(() => {
      const inputs = document.querySelectorAll(
        `[data-field-index="${fieldIndex}"]`,
      );
      const lastInput = inputs[inputs.length - 1];
      lastInput?.focus();
    }, 0);
  };

  const updateOption = (fieldIndex, optionIndex, value) => {
    const newFields = [...customFields];
    newFields[fieldIndex].options[optionIndex] = value;
    setCustomFields(newFields);
  };

  const removeOption = (fieldIndex, optionIndex) => {
    const newFields = [...customFields];
    newFields[fieldIndex].options = newFields[fieldIndex].options.filter(
      (_, idx) => idx !== optionIndex,
    );
    setCustomFields(newFields);
  };

  return (
    <div>
      <Button variant="primary" onClick={addCustomField} className="mb-3">
        Добавить поле
      </Button>
      {customFields.map((field, fieldIndex) => (
        <div key={fieldIndex}>
          <Row className="mb-2 align-items-center">
            <Col sm={4} className="mb-3">
              <Form.Control
                placeholder="Наименование"
                value={field.name}
                onChange={(e) =>
                  updateField(fieldIndex, "name", e.target.value)
                }
              />
            </Col>
            <Col sm={3} className="mb-3">
              <Form.Select
                value={field.type}
                onChange={(e) =>
                  updateField(fieldIndex, "type", e.target.value)
                }
              >
                <option value={FIELD_TYPES.TEXT}>Текст</option>
                <option value={FIELD_TYPES.SELECT}>Выбор</option>
                <option value={FIELD_TYPES.MULTISELECT}>
                  Множественный выбор
                </option>
              </Form.Select>
            </Col>
            <Col sm={4} className="mb-3">
              {field.type === FIELD_TYPES.TEXT && (
                <Form.Control
                  placeholder="Значение"
                  value={field.value}
                  onChange={(e) =>
                    updateField(fieldIndex, "value", e.target.value)
                  }
                />
              )}
              {field.type === FIELD_TYPES.SELECT && (
                <Form.Select
                  value={field.value}
                  onChange={(e) =>
                    updateField(fieldIndex, "value", e.target.value)
                  }
                >
                  <option value="">Выберите значение</option>
                  {field.options?.map((option, idx) => (
                    <option key={idx} value={option}>
                      {option}
                    </option>
                  ))}
                </Form.Select>
              )}
              {field.type === FIELD_TYPES.MULTISELECT && (
                <Select
                  isMulti
                  value={field.options
                    ?.filter((opt) => field.value?.includes(opt))
                    .map((opt) => ({ value: opt, label: opt }))}
                  options={field.options?.map((opt) => ({
                    value: opt || null,
                    label: opt || null,
                  }))}
                  onChange={(selected) => {
                    updateField(
                      fieldIndex,
                      "value",
                      selected?.map((opt) => opt.value) || [],
                    );
                  }}
                  placeholder="Выберите значения"
                />
              )}
            </Col>
            <Col sm={1}>
              <Button
                variant="link"
                onClick={() => removeCustomField(fieldIndex)}
                className="text-danger p-0"
              >
                Удалить
              </Button>
            </Col>
          </Row>

          {field.type === FIELD_TYPES.SELECT && (
            <Row className="mt-3">
              <Col xs={12}>
                <div className="ms-4">
                  <div className="text-muted mb-2">Опции:</div>
                  {field.options?.map((option, optionIndex) => (
                    <Row key={optionIndex} className="mb-2 align-items-center">
                      <Col xs={8}>
                        <Form.Control
                          placeholder="Значение"
                          value={option}
                          data-field-index={fieldIndex}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addOption(fieldIndex);
                            }
                          }}
                          onChange={(e) =>
                            updateOption(
                              fieldIndex,
                              optionIndex,
                              e.target.value,
                            )
                          }
                        />
                      </Col>
                      <Col xs={4}>
                        <Button
                          variant="link"
                          className="text-danger p-0"
                          onClick={() => removeOption(fieldIndex, optionIndex)}
                        >
                          Удалить
                        </Button>
                      </Col>
                    </Row>
                  ))}

                  <Button
                    variant="secondary"
                    onClick={() => addOption(fieldIndex)}
                  >
                    Добавить опцию
                  </Button>
                </div>
              </Col>
            </Row>
          )}

          {field.type === FIELD_TYPES.MULTISELECT && (
            <Row className="mt-3">
              <Col xs={12}>
                <div className="ms-4">
                  <div className="text-muted mb-2">Опции:</div>
                  {field.options?.map((option, optionIndex) => (
                    <Row key={optionIndex} className="mb-2 align-items-center">
                      <Col xs={8}>
                        <Form.Control
                          placeholder="Значение"
                          value={option}
                          data-field-index={fieldIndex}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addOption(fieldIndex);
                            }
                          }}
                          onChange={(e) =>
                            updateOption(
                              fieldIndex,
                              optionIndex,
                              e.target.value,
                            )
                          }
                        />
                      </Col>
                      <Col sm={4}>
                        <Button
                          variant="link"
                          className="text-danger p-0"
                          onClick={() => removeOption(fieldIndex, optionIndex)}
                        >
                          Удалить
                        </Button>
                      </Col>
                    </Row>
                  ))}

                  <Button
                    variant="secondary"
                    onClick={() => addOption(fieldIndex)}
                  >
                    Добавить опцию
                  </Button>
                </div>
              </Col>
            </Row>
          )}
        </div>
      ))}
    </div>
  );
};

export default DynamicCustomFields;
