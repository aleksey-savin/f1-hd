import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import { getLocalStorageData } from "../../util/auth";

const DeviceModelForm = ({ title }) => {
  const loaderData = useLoaderData();
  const deviceModel = loaderData?.deviceModel;

  const [name, setName] = useState(deviceModel?.name || "");
  const [deviceTypeId, setDeviceTypeId] = useState(
    deviceModel?.deviceTypeId?._id || ""
  );
  const [vendorId, setVendorId] = useState(deviceModel?.vendorId?._id || "");
  const [notes, setNotes] = useState(deviceModel?.notes || "");
  const [attributes, setAttributes] = useState(
    deviceModel?.attributes || []
  );

  const [deviceTypes, setDeviceTypes] = useState(loaderData?.deviceTypes || []);
  const [vendors, setVendors] = useState(loaderData?.vendors || []);
  const [availableAttributes, setAvailableAttributes] = useState([]);
  const [isLoadingAttributes, setIsLoadingAttributes] = useState(false);

  // Load available attributes when device type changes
  useEffect(() => {
    const fetchDeviceTypeAttributes = async () => {
      if (!deviceTypeId) {
        setAvailableAttributes([]);
        return;
      }

      setIsLoadingAttributes(true);
      try {
        const { token } = getLocalStorageData();
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${deviceTypeId}`,
          {
            headers: {
              Authorization: "Bearer " + token,
            },
          }
        );
        const deviceType = await response.json();

        // Fetch full attribute definitions
        if (deviceType.attributes && deviceType.attributes.length > 0) {
          const attrIds = deviceType.attributes.map((a) => a.attributeId);
          const attributesResponse = await fetch(
            `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes`,
            {
              headers: {
                Authorization: "Bearer " + token,
              },
            }
          );
          const allAttributes = await attributesResponse.json();

          // Filter and sort attributes
          const filtered = allAttributes
            .filter((attr) => attrIds.includes(attr._id))
            .map((attr) => {
              const config = deviceType.attributes.find(
                (a) => a.attributeId === attr._id
              );
              return {
                ...attr,
                isRequired: config?.isRequired || false,
                displayOrder: config?.displayOrder || 0,
              };
            })
            .sort((a, b) => a.displayOrder - b.displayOrder);

          setAvailableAttributes(filtered);

          // Initialize attributes values if empty
          if (attributes.length === 0) {
            const initialAttrs = filtered.map((attr) => ({
              attributeId: attr._id,
              value: "",
            }));
            setAttributes(initialAttrs);
          }
        } else {
          setAvailableAttributes([]);
        }
      } catch (error) {
        console.error("Error fetching device type attributes:", error);
      } finally {
        setIsLoadingAttributes(false);
      }
    };

    fetchDeviceTypeAttributes();
  }, [deviceTypeId]);

  const nameChangeHandler = (event) => {
    setName(event.target.value);
  };

  const deviceTypeChangeHandler = (event) => {
    setDeviceTypeId(event.target.value);
    setAttributes([]);
  };

  const vendorChangeHandler = (event) => {
    setVendorId(event.target.value);
  };

  const notesChangeHandler = (event) => {
    setNotes(event.target.value);
  };

  const attributeChangeHandler = (attributeId, value) => {
    setAttributes((prev) => {
      const existing = prev.find((a) => a.attributeId === attributeId);
      if (existing) {
        return prev.map((a) =>
          a.attributeId === attributeId ? { ...a, value } : a
        );
      } else {
        return [...prev, { attributeId, value }];
      }
    });
  };

  const getAttributeValue = (attributeId) => {
    const attr = attributes.find((a) => a.attributeId === attributeId);
    return attr?.value || "";
  };

  const renderAttributeField = (attr) => {
    const value = getAttributeValue(attr._id);

    switch (attr.dataType) {
      case "boolean":
        return (
          <Form.Check
            type="checkbox"
            id={`attr-${attr._id}`}
            label={attr.label}
            checked={value === true || value === "true"}
            onChange={(e) =>
              attributeChangeHandler(attr._id, e.target.checked)
            }
          />
        );

      case "number":
        return (
          <Form.Control
            required={attr.isRequired}
            id={`attr-${attr._id}`}
            type="number"
            value={value}
            onChange={(e) => attributeChangeHandler(attr._id, e.target.value)}
            placeholder={`Введите ${attr.label.toLowerCase()}`}
          />
        );

      case "select":
        return (
          <Form.Select
            required={attr.isRequired}
            id={`attr-${attr._id}`}
            value={value}
            onChange={(e) => attributeChangeHandler(attr._id, e.target.value)}
          >
            <option value="">Выберите...</option>
            {attr.options?.map((option, index) => (
              <option key={index} value={option}>
                {option}
              </option>
            ))}
          </Form.Select>
        );

      case "text":
        return (
          <Form.Control
            required={attr.isRequired}
            id={`attr-${attr._id}`}
            as="textarea"
            rows={3}
            value={value}
            onChange={(e) => attributeChangeHandler(attr._id, e.target.value)}
            placeholder={`Введите ${attr.label.toLowerCase()}`}
          />
        );

      default:
        return (
          <Form.Control
            required={attr.isRequired}
            id={`attr-${attr._id}`}
            type="text"
            value={value}
            onChange={(e) => attributeChangeHandler(attr._id, e.target.value)}
            placeholder={`Введите ${attr.label.toLowerCase()}`}
          />
        );
    }
  };

  return (
    <FormWrapper title={title}>
      {/* Hidden field for attributes JSON */}
      <input
        type="hidden"
        name="attributes"
        value={JSON.stringify(attributes.filter((a) => a.value !== ""))}
      />

      <Row>
        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="deviceTypeId">
              Тип устройства
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Select
              required
              id="deviceTypeId"
              name="deviceTypeId"
              value={deviceTypeId}
              onChange={deviceTypeChangeHandler}
            >
              <option value="">Выберите тип устройства</option>
              {deviceTypes.map((type) => (
                <option key={type._id} value={type._id}>
                  {type.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="vendorId">
              Вендор
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Select
              required
              id="vendorId"
              name="vendorId"
              value={vendorId}
              onChange={vendorChangeHandler}
            >
              <option value="">Выберите вендора</option>
              {vendors.map((vendor) => (
                <option key={vendor._id} value={vendor._id}>
                  {vendor.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="py-3">
        <Form.Label htmlFor="name">Название модели</Form.Label>
        <Form.Control
          autoFocus
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={nameChangeHandler}
          placeholder="XPS 15, ThinkPad X1"
        />
        <Form.Text className="text-muted">
          Опционально, если модель имеет название
        </Form.Text>
      </Form.Group>

      {isLoadingAttributes && (
        <div className="py-3 text-center">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Загрузка...</span>
          </div>
          <span className="ms-2">Загрузка атрибутов...</span>
        </div>
      )}

      {!isLoadingAttributes && availableAttributes.length > 0 && (
        <div className="py-3">
          <h5 className="mb-3">Характеристики</h5>
          <Row>
            {availableAttributes.map((attr) => (
              <Col md={6} key={attr._id}>
                <Form.Group className="py-2">
                  <Form.Label htmlFor={`attr-${attr._id}`}>
                    {attr.label}
                    {attr.isRequired && (
                      <span style={{ color: "red" }}>*</span>
                    )}
                    {attr.unit && (
                      <span className="text-muted"> ({attr.unit})</span>
                    )}
                  </Form.Label>
                  {renderAttributeField(attr)}
                </Form.Group>
              </Col>
            ))}
          </Row>
        </div>
      )}

      <Form.Group className="py-3">
        <Form.Label htmlFor="notes">Примечания</Form.Label>
        <Form.Control
          id="notes"
          name="notes"
          as="textarea"
          rows={3}
          value={notes}
          onChange={notesChangeHandler}
          placeholder="Дополнительная информация"
        />
      </Form.Group>
    </FormWrapper>
  );
};

export default DeviceModelForm;
