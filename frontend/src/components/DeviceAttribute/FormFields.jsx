import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";
import { VALUE_TYPES } from "./value-types";

// Поля атрибута устройства. Рендерят `name`-атрибуты (для сабмита со страницы
// через router action) и одновременно сообщают агрегированное состояние через
// onChange (для инлайн-модалки в форме типа устройства, которая шлёт fetch
// напрямую) — общий компонент, мини-форм-двойников не заводим.
const DeviceAttributeFormFields = ({ attribute, onChange }) => {
  const [code, setCode] = useState(attribute?.code || "");
  const [name, setName] = useState(attribute?.name || "");
  const [valueType, setValueType] = useState(attribute?.valueType || "string");
  const [unit, setUnit] = useState(attribute?.unit || "");
  const [options, setOptions] = useState(
    attribute?.options?.map((option) => option.value).join("\n") || "",
  );
  const [isActive, setIsActive] = useState(
    attribute ? attribute.isActive : true,
  );

  const notifyChange = (data) => {
    if (onChange) {
      onChange(data);
    }
  };

  const codeChangeHandler = (event) => {
    const newCode = event.target.value;
    setCode(newCode);
    notifyChange({ code: newCode, name, valueType, unit, options, isActive });
  };

  const nameChangeHandler = (event) => {
    const newName = event.target.value;
    setName(newName);
    notifyChange({ code, name: newName, valueType, unit, options, isActive });
  };

  const valueTypeChangeHandler = (option) => {
    const newValueType = option?.value ?? "string";
    setValueType(newValueType);
    notifyChange({
      code,
      name,
      valueType: newValueType,
      unit,
      options,
      isActive,
    });
  };

  const unitChangeHandler = (event) => {
    const newUnit = event.target.value;
    setUnit(newUnit);
    notifyChange({ code, name, valueType, unit: newUnit, options, isActive });
  };

  const optionsChangeHandler = (event) => {
    const newOptions = event.target.value;
    setOptions(newOptions);
    notifyChange({
      code,
      name,
      valueType,
      unit,
      options: newOptions,
      isActive,
    });
  };

  const isActiveChangeHandler = () => {
    const newIsActive = !isActive;
    setIsActive(newIsActive);
    notifyChange({
      code,
      name,
      valueType,
      unit,
      options,
      isActive: newIsActive,
    });
  };

  const showOptionsField =
    valueType === "select" || valueType === "multiselect";

  return (
    <>
      <div className="tw:grid tw:gap-x-4 tw:md:grid-cols-2">
        <Field
          label="Код"
          htmlFor="code"
          required
          hint="Латиница, без пробелов, camelCase"
        >
          <Input
            required
            autoFocus
            id="code"
            name="code"
            type="text"
            value={code}
            onChange={codeChangeHandler}
            placeholder="ram, processor, screenSize"
          />
        </Field>
        <Field
          label="Наименование"
          htmlFor="name"
          required
          hint="Отображаемое название на русском"
        >
          <Input
            required
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={nameChangeHandler}
            placeholder="Оперативная память"
          />
        </Field>
        <Field label="Тип данных" htmlFor="valueType" required>
          <Select
            id="valueType"
            closeMenuOnSelect
            value={VALUE_TYPES.filter((type) => type.value === valueType)}
            options={VALUE_TYPES}
            getOptionLabel={(type) => type.label}
            getOptionValue={(type) => type.value}
            onChange={valueTypeChangeHandler}
          />
          <input type="hidden" name="valueType" value={valueType} />
        </Field>
        <Field
          label="Единица измерения"
          htmlFor="unit"
          hint="Опционально (ГБ, MHz, дюймов)"
        >
          <Input
            id="unit"
            name="unit"
            type="text"
            value={unit}
            onChange={unitChangeHandler}
            placeholder="ГБ, дюймов, Вт"
          />
        </Field>
      </div>

      {showOptionsField && (
        <Field
          label="Варианты выбора"
          htmlFor="options"
          required
          hint="Каждый вариант с новой строки"
        >
          <Textarea
            required={showOptionsField}
            id="options"
            name="options"
            rows={5}
            value={options}
            onChange={optionsChangeHandler}
            placeholder={"4\n8\n16\n32\n64"}
          />
        </Field>
      )}

      <SwitchField
        id="isActive"
        name="isActive"
        checked={isActive}
        onCheckedChange={isActiveChangeHandler}
        label="Активен"
        hint="Атрибут предлагается при настройке типов устройств."
      />
    </>
  );
};

export default DeviceAttributeFormFields;
