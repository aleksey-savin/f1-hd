import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import { getLocalStorageData } from "../../util/auth";

const DeviceTypeForm = ({ title }) => {
  const loaderData = useLoaderData();
  const deviceType = loaderData?.deviceType;

  const [name, setName] = useState(deviceType?.name || "");
  const [description, setDescription] = useState(deviceType?.description || "");
  const [isActive, setIsActive] = useState(
    deviceType ? deviceType.isActive : true,
  );
  const [attributes, setAttributes] = useState(deviceType?.attributes || []);
  const [availableAttributes, setAvailableAttributes] = useState(
    loaderData?.availableAttributes || [],
  );
  const [isLoadingAttributes, setIsLoadingAttributes] = useState(false);

  useEffect(() => {
    const fetchAttributes = async () => {
      if (availableAttributes.length === 0) {
        setIsLoadingAttributes(true);
        try {
          const { token } = getLocalStorageData();
          const response = await fetch(
            `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes`,
            {
              headers: {
                Authorization: "Bearer " + token,
              },
            },
          );
          const data = await response.json();
          setAvailableAttributes(data);
        } catch (error) {
          console.error("Error fetching attributes:", error);
        } finally {
          setIsLoadingAttributes(false);
        }
      }
    };

    fetchAttributes();
  }, []);

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const handleAddAttribute = (attrId) => {
    const existing = attributes.find((a) => a.attributeId === attrId);
    if (!existing) {
      setAttributes([
        ...attributes,
        {
          attributeId: attrId,
          isRequired: false,
          displayOrder: attributes.length + 1,
        },
      ]);
    }
  };

  const handleRemoveAttribute = (attrId) => {
    setAttributes(attributes.filter((a) => a.attributeId !== attrId));
  };

  const handleToggleRequired = (attrId) => {
    setAttributes(
      attributes.map((a) =>
        a.attributeId === attrId ? { ...a, isRequired: !a.isRequired } : a,
      ),
    );
  };

  const handleMoveUp = (index) => {
    if (index > 0) {
      const newAttributes = [...attributes];
      [newAttributes[index - 1], newAttributes[index]] = [
        newAttributes[index],
        newAttributes[index - 1],
      ];
      // Update display order
      newAttributes.forEach((attr, idx) => {
        attr.displayOrder = idx + 1;
      });
      setAttributes(newAttributes);
    }
  };

  const handleMoveDown = (index) => {
    if (index < attributes.length - 1) {
      const newAttributes = [...attributes];
      [newAttributes[index], newAttributes[index + 1]] = [
        newAttributes[index + 1],
        newAttributes[index],
      ];
      // Update display order
      newAttributes.forEach((attr, idx) => {
        attr.displayOrder = idx + 1;
      });
      setAttributes(newAttributes);
    }
  };

  const getAttributeName = (attrId) => {
    const attr = availableAttributes.find((a) => a._id === attrId);
    return attr ? attr.label : "";
  };

  const isAttributeSelected = (attrId) => {
    return attributes.some((a) => a.attributeId === attrId);
  };

  return (
    <FormWrapper title={title}>
      {/* Hidden field for attributes JSON */}
      <input
        type="hidden"
        name="attributes"
        value={JSON.stringify(attributes)}
      />

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

      <hr className="my-4" />

      <h5 className="mb-3">Атрибуты типа устройства</h5>

      {isLoadingAttributes && (
        <div className="text-center py-3">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Загрузка...</span>
          </div>
          <span className="ms-2">Загрузка атрибутов...</span>
        </div>
      )}

      {!isLoadingAttributes && (
        <Row>
          <Col md={6}>
            <h6>Доступные атрибуты</h6>
            <Card
              className="mb-3"
              style={{ maxHeight: "400px", overflowY: "auto" }}
            >
              <Card.Body>
                {availableAttributes.length === 0 && (
                  <p className="text-muted">Нет доступных атрибутов</p>
                )}
                {availableAttributes
                  .filter((attr) => !isAttributeSelected(attr._id))
                  .map((attr) => (
                    <div
                      key={attr._id}
                      className="d-flex justify-content-between align-items-center mb-2 p-2 border rounded"
                    >
                      <div>
                        <strong>{attr.label}</strong>
                        <br />
                        <small className="text-muted">
                          {attr.name} ({attr.dataType})
                        </small>
                      </div>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => handleAddAttribute(attr._id)}
                      >
                        Добавить →
                      </Button>
                    </div>
                  ))}
              </Card.Body>
            </Card>
          </Col>

          <Col md={6}>
            <h6>Выбранные атрибуты</h6>
            <Card
              className="mb-3"
              style={{ maxHeight: "400px", overflowY: "auto" }}
            >
              <Card.Body>
                {attributes.length === 0 && (
                  <p className="text-muted">Атрибуты не выбраны</p>
                )}
                {attributes.map((attr, index) => (
                  <div
                    key={attr.attributeId}
                    className="d-flex justify-content-between align-items-center mb-2 p-2 border rounded"
                  >
                    <div className="flex-grow-1">
                      <strong>{getAttributeName(attr.attributeId)}</strong>
                      {attr.isRequired && (
                        <Badge bg="danger" className="ms-2">
                          обязательный
                        </Badge>
                      )}
                      <div className="mt-1">
                        <Form.Check
                          inline
                          type="checkbox"
                          id={`required-${attr.attributeId}`}
                          label="Обязательный"
                          checked={attr.isRequired}
                          onChange={() =>
                            handleToggleRequired(attr.attributeId)
                          }
                        />
                      </div>
                    </div>
                    <div className="d-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => handleMoveDown(index)}
                        disabled={index === attributes.length - 1}
                      >
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => handleRemoveAttribute(attr.attributeId)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                ))}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </FormWrapper>
  );
};

export default DeviceTypeForm;
