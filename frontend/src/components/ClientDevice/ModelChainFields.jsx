import { useState, useMemo } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import SelectWithAdd from "./SelectWithAdd";
import InlineCreateModal from "./InlineCreateModal";

const findOption = (options, value) =>
  options.find((o) => o.value === value) || null;

// Связка Тип→Вендор→Модель с каскадом и инлайн-созданием справочников.
// Самодостаточна: держит свои модалки создания типа/вендора/модели. Созданные
// сущности поднимаются наверх через onResourceCreated (пополнить общие массивы)
// и сразу выбираются. Переиспользуется в шаге устройства мастера и в карточках
// комплектующих (`ComponentsFields`).
const ModelChainFields = ({
  value, // { deviceTypeId, vendorId, deviceModelId }
  onChange, // (partial) => void
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  onResourceCreated, // (kind, entity) — kind: "deviceType" | "vendor" | "deviceModel"
  types, // опц. переопределение списка типов (напр. типы-комплектующие)
  modelRequired = false,
  autoFocusType = false,
  idPrefix = "chain",
}) => {
  const [inlineKind, setInlineKind] = useState(null);

  const typeList = types || deviceTypes;
  const typeOptions = useMemo(
    () => typeList.map((t) => ({ value: t._id, label: t.name })),
    [typeList],
  );
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ value: v._id, label: v.name })),
    [vendors],
  );
  // Модели выбранного типа и вендора. Ссылки могут быть populated ({_id}) или id.
  const modelOptions = useMemo(() => {
    if (!value.deviceTypeId || !value.vendorId) return [];
    return deviceModels
      .filter((m) => {
        const t = m.deviceTypeId?._id || m.deviceTypeId;
        const v = m.vendorId?._id || m.vendorId;
        return t === value.deviceTypeId && v === value.vendorId;
      })
      .map((m) => ({ value: m._id, label: m.name || "— без названия —" }));
  }, [deviceModels, value.deviceTypeId, value.vendorId]);

  const modelDisabled = !value.deviceTypeId || !value.vendorId;

  const handleTypeCreated = (type) => {
    onResourceCreated?.("deviceType", type);
    onChange({ deviceTypeId: type._id, deviceModelId: "" });
  };
  const handleVendorCreated = (vendor) => {
    onResourceCreated?.("vendor", vendor);
    onChange({ vendorId: vendor._id, deviceModelId: "" });
  };
  // Модель могла быть создана с другим типом/вендором (полная форма в модалке) —
  // синхронизируем выбор, чтобы новая модель попала в отфильтрованный список.
  const handleModelCreated = (model) => {
    onResourceCreated?.("deviceModel", model);
    onChange({
      deviceTypeId:
        model.deviceTypeId?._id || model.deviceTypeId || value.deviceTypeId,
      vendorId: model.vendorId?._id || model.vendorId || value.vendorId,
      deviceModelId: model._id,
    });
  };

  return (
    <>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor={`${idPrefix}-type`}>
              Тип устройства <span className="text-danger">*</span>
            </Form.Label>
            <SelectWithAdd
              id={`${idPrefix}-type`}
              placeholder="Выберите тип"
              options={typeOptions}
              value={findOption(typeOptions, value.deviceTypeId)}
              onChange={(o) =>
                onChange({ deviceTypeId: o ? o.value : "", deviceModelId: "" })
              }
              isClearable
              autoFocus={autoFocusType}
              addTitle="Добавить тип"
              onAdd={() => setInlineKind("deviceType")}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor={`${idPrefix}-vendor`}>
              Вендор <span className="text-danger">*</span>
            </Form.Label>
            <SelectWithAdd
              id={`${idPrefix}-vendor`}
              placeholder="Выберите вендора"
              options={vendorOptions}
              value={findOption(vendorOptions, value.vendorId)}
              onChange={(o) =>
                onChange({ vendorId: o ? o.value : "", deviceModelId: "" })
              }
              isClearable
              addTitle="Добавить вендора"
              onAdd={() => setInlineKind("vendor")}
            />
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="mb-0">
        <Form.Label htmlFor={`${idPrefix}-model`}>
          Модель устройства{" "}
          {modelRequired && <span className="text-danger">*</span>}
        </Form.Label>
        <SelectWithAdd
          id={`${idPrefix}-model`}
          placeholder={
            modelDisabled ? "Сначала выберите тип и вендора" : "Выберите модель"
          }
          options={modelOptions}
          value={findOption(modelOptions, value.deviceModelId)}
          onChange={(o) => onChange({ deviceModelId: o ? o.value : "" })}
          isDisabled={modelDisabled}
          isClearable
          noOptionsMessage={() => "Нет моделей — добавьте кнопкой рядом"}
          addTitle="Добавить модель"
          onAdd={() => setInlineKind("deviceModel")}
          addDisabled={modelDisabled}
        />
        <Form.Text className="text-muted">
          Показаны модели выбранного типа и вендора. Нужной нет? Добавьте её
          кнопкой рядом.
        </Form.Text>
      </Form.Group>

      <InlineCreateModal
        show={inlineKind === "deviceType"}
        onHide={() => setInlineKind(null)}
        kind="deviceType"
        resources={{ deviceTypes }}
        onCreated={handleTypeCreated}
      />
      <InlineCreateModal
        show={inlineKind === "vendor"}
        onHide={() => setInlineKind(null)}
        kind="vendor"
        onCreated={handleVendorCreated}
      />
      <InlineCreateModal
        show={inlineKind === "deviceModel"}
        onHide={() => setInlineKind(null)}
        kind="deviceModel"
        context={{ deviceTypeId: value.deviceTypeId, vendorId: value.vendorId }}
        resources={{ deviceTypes, vendors, deviceModels }}
        onCreated={handleModelCreated}
      />
    </>
  );
};

export default ModelChainFields;
