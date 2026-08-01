import { useState } from "react";
import { useLoaderData } from "react-router";

import { RiAddLine } from "react-icons/ri";

import FormWrapper from "@/components/app/FormWrapper";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Combobox, { toOptions } from "@/components/app/Combobox";
import AddDeviceAttributeModal from "./AddDeviceAttributeModal";
import { valueTypeLabel } from "../DeviceAttribute/value-types";

// Форма атрибута типа — отдельная шторка с карточки типа (добавить/изменить).
// Выбор атрибута из общего каталога + флаги «Обязательный» / «Расширяемый»
// (последний — только для «выбора из списка»). Сабмит идёт скрытыми полями
// меню Select рисуется инлайн.
const AttributeForm = ({ title }) => {
  const loaderData = useLoaderData();
  const deviceType = loaderData?.deviceType; // { _id, name }
  const link = loaderData?.link; // режим правки: связка с populated attributeId
  const usedAttributeIds = loaderData?.usedAttributeIds || [];

  const [availableAttributes, setAvailableAttributes] = useState(
    loaderData?.availableAttributes || [],
  );
  const currentId = link
    ? String(link.attributeId?._id || link.attributeId || "")
    : "";
  const [attributeId, setAttributeId] = useState(currentId);
  const [required, setRequired] = useState(link ? !!link.required : false);
  const [extendable, setExtendable] = useState(
    link ? !!link.extendable : false,
  );
  const [showModal, setShowModal] = useState(false);

  // Оставляем только нужное для подписи и логики: у каталожного атрибута есть
  // собственное поле `options` (значения select-типа), и тащить его в список
  // выбора незачем.
  const selectOptions = availableAttributes.map((a) => ({
    _id: a._id,
    name: a.name,
    unit: a.unit,
    valueType: a.valueType,
  }));

  const selected = selectOptions.find((a) => a._id === attributeId) || null;
  const isSelectType =
    selected?.valueType === "select" || selected?.valueType === "multiselect";

  // Уже привязанные к типу атрибуты убираем из списка (кроме правимого).
  const options = selectOptions.filter(
    (a) =>
      a._id === attributeId ||
      a._id === currentId ||
      !usedAttributeIds.includes(a._id),
  );

  const handleAttributeCreated = (newAttribute) => {
    setAvailableAttributes((prev) => [...prev, newAttribute]);
    setAttributeId(newAttribute._id);
  };

  return (
    <FormWrapper
      title={title}
      successTo={`/inventory/device-types/${deviceType?._id}`}
    >
      {/* Скрытые поля для сабмита (Select/Switch пишут в состояние) */}
      <input type="hidden" name="attributeId" value={attributeId} />
      <input
        type="hidden"
        name="required"
        value={required ? "true" : "false"}
      />
      <input
        type="hidden"
        name="extendable"
        value={extendable ? "true" : "false"}
      />

      {deviceType?.name && (
        <p className="-mt-2 mb-5 text-sm text-muted-foreground">
          Тип: {deviceType.name}
        </p>
      )}

      <Field label="Атрибут" htmlFor="attributeId" required>
        <Combobox
          id="attributeId"
          value={attributeId || null}
          onChange={(id) => setAttributeId(id || "")}
          options={toOptions(options, {
            value: (option) => String(option._id),
            label: (option) =>
              `${option.name}${option.unit ? ` (${option.unit})` : ""}${
                option.valueType ? ` · ${valueTypeLabel(option.valueType)}` : ""
              }`,
          })}
          placeholder="Выберите из каталога атрибутов…"
          clearable
          clearLabel="Не выбран"
        />
      </Field>

      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="-mt-1.5 mb-2 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text hover:underline"
      >
        <RiAddLine size={15} /> Новый атрибут
      </button>

      <SwitchField
        id="required"
        checked={required}
        onCheckedChange={setRequired}
        label="Обязательный"
        hint="Значение нельзя пропустить при создании конфигурации модели этого типа."
        divider
      />

      {isSelectType && (
        <SwitchField
          id="extendable"
          checked={extendable}
          onCheckedChange={setExtendable}
          label="Расширяемый список"
          hint="Разрешить добавлять новые значения прямо при заполнении конфигурации."
          divider
        />
      )}

      <AddDeviceAttributeModal
        show={showModal}
        onHide={() => setShowModal(false)}
        onAttributeCreated={handleAttributeCreated}
      />
    </FormWrapper>
  );
};

export default AttributeForm;
