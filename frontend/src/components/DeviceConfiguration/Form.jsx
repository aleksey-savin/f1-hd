import { useState } from "react";
import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import Combobox from "@/components/app/Combobox";
import FilterChip from "@/components/app/FilterChip";
import {
  groupLinks,
  parseMultiValue,
  serializeMultiValue,
} from "@/components/app/spec-sheet";

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
          <div className="flex h-9 items-center gap-2.5">
            <Switch
              id={inputId}
              checked={value === true || value === "true"}
              onCheckedChange={(checked) => handleValueChange(attrId, checked)}
            />
            <span className="text-sm text-muted-foreground">
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
          <Combobox
            id={inputId}
            value={value || null}
            onChange={(next) => handleValueChange(attrId, next || "")}
            options={attrData.options || []}
            placeholder="Выберите…"
            clearable
            clearLabel="Не выбрано"
          />
        );

      case "multiselect": {
        const options = attrData.options || [];
        const selected = parseMultiValue(String(value ?? ""));
        // Старое текстовое значение вне вариантов не теряем: показываем
        // его выбранным вариантом, иначе сохранение молча его сотрёт
        const extra = selected
          .filter((item) => !options.some((o) => o.value === item))
          .map((item) => ({ value: item, label: item }));
        return (
          <div
            id={inputId}
            role="group"
            aria-label={attrData.name}
            className="flex flex-wrap gap-1.5"
          >
            {[...options, ...extra].map((option) => {
              const active = selected.includes(option.value);
              return (
                <FilterChip
                  key={option.value}
                  size="sm"
                  dot="none"
                  active={active}
                  className={
                    active
                      ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                      : "font-normal"
                  }
                  onClick={() => {
                    const next = active
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value];
                    // Порядок — как у вариантов, независимо от порядка нажатий
                    const ordered = [...options, ...extra]
                      .map((o) => o.value)
                      .filter((v) => next.includes(v));
                    handleValueChange(
                      attrId,
                      ordered.length ? serializeMultiValue(ordered) : "",
                    );
                  }}
                >
                  {option.label}
                </FilterChip>
              );
            })}
          </div>
        );
      }

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

  // Без единой группы заголовки не нужны — и «Прочее» тоже
  const groups = groupLinks(attributes, "Прочее");
  const hasGroups = groups.some((g) => g.key !== "other");

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
      <input
        type="hidden"
        name="deviceModelId"
        value={deviceModel?._id || ""}
      />
      <input
        type="hidden"
        name="values"
        value={JSON.stringify(
          values.filter((v) => v.value !== "" && v.value != null),
        )}
      />

      <p className="-mt-2 mb-5 text-sm text-muted-foreground">
        {subtitle}
        {typeName ? ` · ${typeName}` : ""}
      </p>

      {attributes.length === 0 ? (
        <AlertMessage
          variant="warning"
          message="У типа устройства нет характеристик. Сначала добавьте атрибуты к типу устройства, затем создавайте конфигурации."
        />
      ) : (
        <div>
          {groups.map((group, index) => (
            <section
              key={group.key}
              className={
                index === 0
                  ? "pt-1.5"
                  : "mt-1.5 border-t border-border-soft pt-3.5"
              }
            >
              {hasGroups && (
                <h5 className="mt-0 mb-2.5 text-xs font-bold uppercase tracking-wider text-faint">
                  {group.name}
                </h5>
              )}
              <div className="grid gap-x-4 sm:grid-cols-2">
                {group.links.map((attr) => {
                  const attrData =
                    typeof attr.attributeId === "object"
                      ? attr.attributeId
                      : null;
                  if (!attrData) return null;
                  const attrId = attrData._id;
                  // Мультивыбор шире колонки: варианты — фразы столбиком
                  const wide = attrData.valueType === "multiselect";

                  return (
                    <Field
                      key={attrId}
                      className={wide ? "sm:col-span-2" : undefined}
                      htmlFor={`attr-${attrId}`}
                      required={attr.required}
                      label={
                        <>
                          {attrData.name || "Атрибут"}
                          {attrData.unit && (
                            <span className="font-normal text-faint">
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
            </section>
          ))}
        </div>
      )}
    </FormWrapper>
  );
};

export default DeviceConfigurationForm;
