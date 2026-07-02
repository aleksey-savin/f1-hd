import { useState } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const DeviceConfigurationForm = ({ title }) => {
  const loaderData = useLoaderData();
  const configuration = loaderData?.configuration;
  const deviceModel = loaderData?.deviceModel;
  const attributes = loaderData?.attributes || [];

  const [values, setValues] = useState(
    configuration?.values?.map((v) => ({
      attributeId:
        typeof v.attributeId === "object" ? v.attributeId._id : v.attributeId,
      value: v.value,
    })) || [],
  );

  const handleValueChange = (attributeId, value) => {
    setValues((prev) => {
      const existing = prev.find((v) => v.attributeId === attributeId);
      if (existing) {
        return prev.map((v) =>
          v.attributeId === attributeId ? { ...v, value } : v,
        );
      }
      return [...prev, { attributeId, value }];
    });
  };

  const getValue = (attributeId) => {
    const val = values.find((v) => v.attributeId === attributeId);
    return val?.value || "";
  };

  const renderAttributeInput = (attr) => {
    const attrId =
      typeof attr.attributeId === "object"
        ? attr.attributeId._id
        : attr.attributeId;
    const attrData =
      typeof attr.attributeId === "object"
        ? attr.attributeId
        : attributes.find((a) => a._id === attrId);

    if (!attrData) return null;

    const value = getValue(attrId);

    switch (attrData.valueType) {
      case "boolean":
        return (
          <Form.Check
            type="checkbox"
            id={`attr-${attrId}`}
            checked={value === true || value === "true"}
            onChange={(e) => handleValueChange(attrId, e.target.checked)}
          />
        );

      case "number":
        return (
          <Form.Control
            id={`attr-${attrId}`}
            type="number"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      case "select":
        return (
          <Form.Select
            id={`attr-${attrId}`}
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
          >
            <option value="">Выберите...</option>
            {attrData.options?.map((option, index) => (
              <option key={index} value={option.value}>
                {option.label}
              </option>
            ))}
          </Form.Select>
        );

      case "text":
        return (
          <Form.Control
            id={`attr-${attrId}`}
            as="textarea"
            rows={2}
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      default:
        return (
          <Form.Control
            id={`attr-${attrId}`}
            type="text"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );
    }
  };

  return (
    <FormWrapper
      title={title}
      successTo={`/inventory/device-models/${deviceModel?._id}`}
    >
      {/* Hidden fields */}
      <input
        type="hidden"
        name="deviceModelId"
        value={deviceModel?._id || ""}
      />
      <input
        type="hidden"
        name="values"
        value={JSON.stringify(
          values.filter((v) => v.value && v.value.toString().trim()),
        )}
      />

      <p className="text-muted mb-4">
        {[deviceModel?.vendorId?.name, deviceModel?.name]
          .filter(Boolean)
          .join(" ") || "(Без названия)"}
        {deviceModel?.deviceTypeId?.name
          ? ` · ${deviceModel.deviceTypeId.name}`
          : ""}
      </p>

      {attributes.length === 0 ? (
        <div className="alert alert-warning">
          У данного типа устройства нет атрибутов. Сначала добавьте атрибуты к
          типу устройства.
        </div>
      ) : (
        <Row>
          {attributes.map((attr) => {
            const attrId =
              typeof attr.attributeId === "object"
                ? attr.attributeId._id
                : attr.attributeId;
            const attrData =
              typeof attr.attributeId === "object"
                ? attr.attributeId
                : attributes.find((a) => a._id === attrId);

            return (
              <Col md={6} key={attrId}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor={`attr-${attrId}`}>
                    {attrData?.name || "Атрибут"}
                    {attr.required && <span style={{ color: "red" }}>*</span>}
                    {attrData?.unit && (
                      <span className="text-muted"> ({attrData.unit})</span>
                    )}
                  </Form.Label>
                  {renderAttributeInput(attr)}
                </Form.Group>
              </Col>
            );
          })}
        </Row>
      )}
    </FormWrapper>
  );
};

export default DeviceConfigurationForm;
