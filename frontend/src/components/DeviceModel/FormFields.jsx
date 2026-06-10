import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import { RiAddLine, RiDeleteBinLine, RiEditLine } from "react-icons/ri";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

// Поля модели устройства. Рендерят `name`-атрибуты и скрытые поля для сабмита
// со страницы (react-router action) и сообщают агрегированное состояние через
// onChange для инлайн-модалки. Атрибуты выбранного типа подгружаются лениво —
// поэтому список deviceTypes можно передавать без populated attributes.
const DeviceModelFormFields = ({
  deviceModel,
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  existingConfigurations = [],
  onChange,
}) => {
  const [name, setName] = useState(deviceModel?.name || "");
  const [deviceTypeId, setDeviceTypeId] = useState(
    deviceModel?.deviceTypeId?._id || "",
  );
  const [vendorId, setVendorId] = useState(deviceModel?.vendorId?._id || "");
  const [compatibleWithModelIds, setCompatibleWithModelIds] = useState(
    deviceModel?.compatibleWithModelIds?.map((m) => m._id) || [],
  );
  const [notes, setNotes] = useState(deviceModel?.notes || "");
  const [configurations, setConfigurations] = useState([]);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfigIndex, setEditingConfigIndex] = useState(null);
  const [currentConfigValues, setCurrentConfigValues] = useState([]);

  // Атрибуты выбранного типа: берём из populated deviceTypes, иначе подгружаем.
  const [typeAttributes, setTypeAttributes] = useState([]);

  useEffect(() => {
    if (!deviceTypeId) {
      setTypeAttributes([]);
      return;
    }
    const found = deviceTypes.find((dt) => dt._id === deviceTypeId);
    if (found?.attributes) {
      setTypeAttributes(found.attributes);
      return;
    }
    const fetchAttributes = async () => {
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${deviceTypeId}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (response.ok) {
          const full = await response.json();
          setTypeAttributes(full.attributes || []);
        }
      } catch (error) {
        console.error("Error fetching device type attributes:", error);
      }
    };
    fetchAttributes();
  }, [deviceTypeId, deviceTypes]);

  const availableAttributes = typeAttributes;
  const selectedDeviceType = deviceTypes.find((dt) => dt._id === deviceTypeId);

  // Сообщаем состояние наверх (на странице onChange игнорируется).
  useEffect(() => {
    if (!onChange) return;
    onChange({
      name,
      deviceTypeId,
      vendorId,
      compatibleWithModelIds: (compatibleWithModelIds || []).map(
        (m) => m._id || m,
      ),
      notes,
      configurations,
    });
  }, [
    name,
    deviceTypeId,
    vendorId,
    compatibleWithModelIds,
    notes,
    configurations,
  ]);

  const handleAddConfiguration = () => {
    if (!deviceTypeId) {
      alert("Сначала выберите тип устройства");
      return;
    }
    setShowConfigForm(true);
    setEditingConfigIndex(null);
    setCurrentConfigValues([]);
  };

  const handleEditConfiguration = (index) => {
    setEditingConfigIndex(index);
    setCurrentConfigValues(configurations[index].values || []);
    setShowConfigForm(true);
  };

  const handleDeleteConfiguration = (index) => {
    setConfigurations(configurations.filter((_, i) => i !== index));
  };

  const handleSaveConfiguration = () => {
    const config = {
      values: currentConfigValues.filter((v) => v.value && v.value.trim()),
    };

    if (editingConfigIndex !== null) {
      const newConfigs = [...configurations];
      newConfigs[editingConfigIndex] = config;
      setConfigurations(newConfigs);
    } else {
      setConfigurations([...configurations, config]);
    }

    setShowConfigForm(false);
    setCurrentConfigValues([]);
    setEditingConfigIndex(null);
  };

  const handleCancelConfiguration = () => {
    setShowConfigForm(false);
    setCurrentConfigValues([]);
    setEditingConfigIndex(null);
  };

  const handleConfigValueChange = (attributeId, value) => {
    setCurrentConfigValues((prev) => {
      const existing = prev.find((v) => v.attributeId === attributeId);
      if (existing) {
        return prev.map((v) =>
          v.attributeId === attributeId ? { ...v, value } : v,
        );
      }
      return [...prev, { attributeId, value }];
    });
  };

  const getConfigValue = (attributeId) => {
    const val = currentConfigValues.find((v) => v.attributeId === attributeId);
    return val?.value || "";
  };

  const getAttributeName = (attributeId) => {
    const attr = availableAttributes.find(
      (a) => a.attributeId._id === attributeId || a.attributeId === attributeId,
    );
    return attr?.attributeId?.name || "—";
  };

  const renderAttributeInput = (attr) => {
    const attrId =
      typeof attr.attributeId === "object"
        ? attr.attributeId._id
        : attr.attributeId;
    const attrData =
      typeof attr.attributeId === "object"
        ? attr.attributeId
        : availableAttributes.find((a) => a.attributeId === attrId)
            ?.attributeId;

    if (!attrData) return null;

    const value = getConfigValue(attrId);

    switch (attrData.valueType) {
      case "boolean":
        return (
          <Form.Check
            type="checkbox"
            id={`config-attr-${attrId}`}
            checked={value === true || value === "true"}
            onChange={(e) => handleConfigValueChange(attrId, e.target.checked)}
          />
        );

      case "number":
        return (
          <Form.Control
            id={`config-attr-${attrId}`}
            type="number"
            value={value}
            onChange={(e) => handleConfigValueChange(attrId, e.target.value)}
            placeholder={`Введите значение`}
          />
        );

      case "select":
        return (
          <Form.Select
            id={`config-attr-${attrId}`}
            value={value}
            onChange={(e) => handleConfigValueChange(attrId, e.target.value)}
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
            id={`config-attr-${attrId}`}
            as="textarea"
            rows={2}
            value={value}
            onChange={(e) => handleConfigValueChange(attrId, e.target.value)}
            placeholder={`Введите значение`}
          />
        );

      default:
        return (
          <Form.Control
            id={`config-attr-${attrId}`}
            type="text"
            value={value}
            onChange={(e) => handleConfigValueChange(attrId, e.target.value)}
            placeholder={`Введите значение`}
          />
        );
    }
  };

  return (
    <>
      {/* Hidden fields for form submission */}
      <input
        type="hidden"
        name="configurations"
        value={JSON.stringify(configurations)}
      />
      <input type="hidden" name="deviceTypeId" value={deviceTypeId} />
      <input type="hidden" name="vendorId" value={vendorId} />

      <Row>
        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="deviceTypeId">
              Тип устройства
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              id="deviceTypeId"
              value={deviceTypes.find((dt) => dt._id === deviceTypeId) || null}
              onChange={(selectedOption) => {
                setDeviceTypeId(selectedOption?._id || "");
                setCurrentConfigValues([]);
              }}
              options={deviceTypes}
              placeholder="Выберите тип устройства..."
              required
              isClearable
              isSearchable
              getOptionLabel={(option) => option.name}
              getOptionValue={(option) => option._id}
            />
          </Form.Group>
        </Col>

        <Col md={6}>
          <Form.Group className="py-3">
            <Form.Label htmlFor="vendorId">
              Производитель
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              id="vendorId"
              value={vendors.find((v) => v._id === vendorId) || null}
              onChange={(selectedOption) =>
                setVendorId(selectedOption?._id || "")
              }
              options={vendors}
              placeholder="Выберите производителя..."
              required
              isClearable
              isSearchable
              getOptionLabel={(option) => option.name}
              getOptionValue={(option) => option._id}
            />
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="py-3">
        <Form.Label htmlFor="name">Название модели</Form.Label>
        <Form.Control
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="XPS 15, ThinkPad X1 Carbon"
        />
        <Form.Text className="text-muted">
          Опционально. Можно оставить пустым, если модель не имеет конкретного
          названия
        </Form.Text>
      </Form.Group>

      {selectedDeviceType?.isConsumable && (
        <Form.Group className="py-3">
          <Form.Label htmlFor="compatibleWithModelIds">
            Совместимые модели
          </Form.Label>
          <Select
            id="compatibleWithModelIds"
            name="compatibleWithModelIds"
            value={deviceModels.filter((dm) =>
              compatibleWithModelIds.includes(dm._id),
            )}
            onChange={(selectedOptions) =>
              setCompatibleWithModelIds(selectedOptions || [])
            }
            options={deviceModels}
            placeholder="Выберите совместимые модели..."
            isClearable
            isSearchable
            isMulti
            closeMenuOnSelect={false}
            getOptionLabel={(option) =>
              `${option.deviceTypeId?.name || "—"} - ${option.vendorId?.name || "—"} ${option.name || ""}`
            }
            getOptionValue={(option) => option._id}
          />
          <Form.Text className="text-muted">
            Укажите другие модели устройств, с которыми совместима данная модель
          </Form.Text>
        </Form.Group>
      )}

      <Form.Group className="py-3">
        <Form.Label htmlFor="notes">Примечания</Form.Label>
        <Form.Control
          id="notes"
          name="notes"
          as="textarea"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Дополнительная информация о модели"
        />
      </Form.Group>

      <hr className="my-4" />
      <h5 className="mb-3">Конфигурации</h5>

      {configurations.length > 0 && (
        <Card className="mb-3">
          <Card.Body>
            <Table responsive hover size="sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Атрибуты</th>
                  <th style={{ width: "120px" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {configurations.map((config, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        {config.values?.map((val, idx) => (
                          <Badge key={idx} bg="secondary" className="me-1">
                            {getAttributeName(val.attributeId)}: {val.value}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="me-1"
                        onClick={() => handleEditConfiguration(index)}
                      >
                        <RiEditLine />
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => handleDeleteConfiguration(index)}
                      >
                        <RiDeleteBinLine />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {!showConfigForm && (
        <Button
          variant="success"
          size="sm"
          onClick={handleAddConfiguration}
          disabled={!deviceTypeId}
        >
          <RiAddLine /> Добавить конфигурацию
        </Button>
      )}

      {showConfigForm && (
        <Card className="mb-3">
          <Card.Header>
            <h6 className="mb-0">
              {editingConfigIndex !== null
                ? "Редактировать конфигурацию"
                : "Новая конфигурация"}
            </h6>
          </Card.Header>
          <Card.Body>
            {availableAttributes.length === 0 ? (
              <p className="text-muted">
                У выбранного типа устройства нет атрибутов. Сначала добавьте
                атрибуты к типу устройства.
              </p>
            ) : (
              <Row>
                {availableAttributes.map((attr) => {
                  const attrId =
                    typeof attr.attributeId === "object"
                      ? attr.attributeId._id
                      : attr.attributeId;
                  const attrData =
                    typeof attr.attributeId === "object"
                      ? attr.attributeId
                      : null;

                  return (
                    <Col md={6} key={attrId}>
                      <Form.Group className="mb-3">
                        <Form.Label htmlFor={`config-attr-${attrId}`}>
                          {attrData?.name || "Атрибут"}
                          {attr.required && (
                            <span style={{ color: "red" }}>*</span>
                          )}
                          {attrData?.unit && (
                            <span className="text-muted">
                              {" "}
                              ({attrData.unit})
                            </span>
                          )}
                        </Form.Label>
                        {renderAttributeInput(attr)}
                      </Form.Group>
                    </Col>
                  );
                })}
              </Row>
            )}
          </Card.Body>
          <Card.Footer className="d-flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveConfiguration}
              disabled={availableAttributes.length === 0}
            >
              Сохранить
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancelConfiguration}
            >
              Отмена
            </Button>
          </Card.Footer>
        </Card>
      )}

      {deviceModel && existingConfigurations.length > 0 && (
        <>
          <hr className="my-4" />
          <h6 className="mb-3">Существующие конфигурации</h6>
          <p className="text-muted small">
            Эти конфигурации уже сохранены. Для их редактирования или удаления
            используйте страницу просмотра модели.
          </p>
          <Table responsive hover size="sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Атрибуты</th>
              </tr>
            </thead>
            <tbody>
              {existingConfigurations.map((config, index) => (
                <tr key={config._id}>
                  <td>{index + 1}</td>
                  <td>
                    <div className="d-flex flex-wrap gap-1">
                      {config.values?.map((val, idx) => (
                        <Badge key={idx} bg="info">
                          {val.attributeId?.name || "—"}: {val.value || "—"}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
};

export default DeviceModelFormFields;
