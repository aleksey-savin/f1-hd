import { useState } from "react";
import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import Select from "../../UI/Select";

// Форма конфигурации модели: динамические поля по атрибутам типа устройства.
// Сабмит идёт скрытым `values` (JSON), поэтому контролы неуправляемы через
// `name`, а пишут в состояние. Открывается в нижней шторке карточки модели.
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
    return val?.value ?? "";
  };

  const renderAttributeInput = (attrId, attrData) => {
    const value = getValue(attrId);
    const inputId = `attr-${attrId}`;

    switch (attrData.valueType) {
      case "boolean":
        return (
          <div className="tw:flex tw:h-10 tw:items-center tw:gap-2.5">
            <Switch
              id={inputId}
              checked={value === true || value === "true"}
              onCheckedChange={(checked) =>
                handleValueChange(attrId, checked)
              }
            />
            <span className="tw:text-sm tw:text-muted-foreground">
              {value === true || value === "true" ? "Да" : "Нет"}
            </span>
          </div>
        );

      case "number":
        return (
          <Input
            id={inputId}
            type="number"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      case "select":
        return (
          <Select
            id={inputId}
            value={
              (attrData.options || []).find((o) => o.value === value) || null
            }
            onChange={(option) =>
              handleValueChange(attrId, option?.value || "")
            }
            options={attrData.options || []}
            placeholder="Выберите…"
            isClearable
            getOptionLabel={(option) => option.label}
            getOptionValue={(option) => option.value}
          />
        );

      case "text":
        return (
          <Textarea
            id={inputId}
            rows={2}
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      default:
        return (
          <Input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );
    }
  };

  const subtitle =
    [deviceModel?.vendorId?.name, deviceModel?.name]
      .filter(Boolean)
      .join(" ") || "(Без названия)";
  const typeName = deviceModel?.deviceTypeId?.name;

  return (
    <FormWrapper
      title={title}
      successTo={`/inventory/device-models/${deviceModel?._id}`}
    >
      <input type="hidden" name="deviceModelId" value={deviceModel?._id || ""} />
      <input
        type="hidden"
        name="values"
        value={JSON.stringify(
          values.filter((v) => v.value !== "" && v.value != null),
        )}
      />

      <p className="tw:-mt-2 tw:mb-5 tw:text-sm tw:text-muted-foreground">
        {subtitle}
        {typeName ? ` · ${typeName}` : ""}
      </p>

      {attributes.length === 0 ? (
        <AlertMessage
          variant="warning"
          message="У типа устройства нет характеристик. Сначала добавьте атрибуты к типу устройства, затем создавайте конфигурации."
        />
      ) : (
        <div className="tw:grid tw:gap-x-4 tw:sm:grid-cols-2">
          {attributes.map((attr) => {
            const attrData =
              typeof attr.attributeId === "object" ? attr.attributeId : null;
            const attrId = attrData?._id || attr.attributeId;
            if (!attrData) return null;

            return (
              <Field
                key={attrId}
                htmlFor={`attr-${attrId}`}
                required={attr.required}
                label={
                  <>
                    {attrData.name || "Атрибут"}
                    {attrData.unit && (
                      <span className="tw:font-normal tw:text-faint">
                        {" "}
                        ({attrData.unit})
                      </span>
                    )}
                  </>
                }
              >
                {renderAttributeInput(attrId, attrData)}
              </Field>
            );
          })}
        </div>
      )}
    </FormWrapper>
  );
};

export default DeviceConfigurationForm;
