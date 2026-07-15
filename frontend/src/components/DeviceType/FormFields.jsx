import { useState, useEffect } from "react";

import {
  RiAddFill,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";
import AddDeviceAttributeModal from "./AddDeviceAttributeModal";

// Чекбокс-строки атрибута: radix Checkbox в FormData не попадает — при
// включении рендерим скрытый input с value="on" (контракт router-action:
// `=== "on"`, как у нативного чекбокса)
const AttributeFlag = ({ id, name, label, checked, onCheckedChange }) => (
  <span className="tw:inline-flex tw:items-center tw:gap-2">
    <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
    <Label htmlFor={id} className="tw:text-sm tw:font-normal">
      {label}
    </Label>
    {checked && <input type="hidden" name={name} value="on" />}
  </span>
);

// Поля типа устройства. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Справочники (availableDeviceTypes/availableAttributes)
// приходят пропсами; новые атрибуты создаются во вложенном диалоге.
const DeviceTypeFormFields = ({
  deviceType,
  availableDeviceTypes = [],
  availableAttributes: initialAvailableAttributes = [],
  onChange,
}) => {
  const [name, setName] = useState(deviceType?.name || "");
  const [isActive, setIsActive] = useState(
    deviceType ? deviceType.isActive : true,
  );
  const [isComponent, setIsComponent] = useState(
    deviceType ? deviceType.isComponent : false,
  );
  const [isConsumable, setIsConsumable] = useState(
    deviceType ? deviceType.isConsumable : false,
  );
  const [isPeripheral, setIsPeripheral] = useState(
    deviceType ? deviceType.isPeripheral : false,
  );
  const [inventoryPrefix, setInventoryPrefix] = useState(
    deviceType?.inventoryPrefix || "",
  );
  const [attachableToTypeIds, setAttachableToTypeIds] = useState(
    deviceType?.attachableToTypeIds || [],
  );
  const [attributes, setAttributes] = useState(
    // attributeId может прийти populated-объектом или голым id — нормализуем
    deviceType?.attributes?.map((attr) => ({
      attributeId: String(attr.attributeId?._id ?? attr.attributeId ?? ""),
      required: attr.required || false,
      extendable: attr.extendable || false,
    })) || [],
  );
  const [availableAttributes, setAvailableAttributes] = useState(
    initialAvailableAttributes,
  );
  const [showAttributeModal, setShowAttributeModal] = useState(false);
  const [currentAttributeIndex, setCurrentAttributeIndex] = useState(null);

  // Сообщаем состояние наверх (для модалки). На странице onChange игнорируется —
  // сабмит идёт через `name`-атрибуты.
  useEffect(() => {
    if (!onChange) return;
    onChange({
      name,
      isActive,
      isComponent,
      isConsumable,
      isPeripheral,
      inventoryPrefix,
      attachableToTypeIds: (attachableToTypeIds || []).map((t) => t._id || t),
      attributes: (attributes || [])
        .filter((a) => a.attributeId)
        .map((a) => ({
          attributeId: a.attributeId,
          required: !!a.required,
          extendable: !!a.extendable,
        })),
    });
  }, [
    name,
    isActive,
    isComponent,
    isConsumable,
    isPeripheral,
    inventoryPrefix,
    attachableToTypeIds,
    attributes,
  ]);

  const addAttributeHandler = () => {
    setAttributes([
      ...attributes,
      { attributeId: "", required: false, extendable: false },
    ]);
  };

  const removeAttributeHandler = (index) => {
    setAttributes(attributes.filter((_, i) => i !== index));
  };

  const attributeChangeHandler = (index, field, value) => {
    const newAttributes = [...attributes];
    newAttributes[index] = { ...newAttributes[index], [field]: value };
    setAttributes(newAttributes);
  };

  // Перемещение атрибута для управляемой последовательности (dir: -1 вверх, +1 вниз).
  const moveAttribute = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= attributes.length) return;
    const next = [...attributes];
    [next[index], next[target]] = [next[target], next[index]];
    setAttributes(next);
  };

  const openAttributeModal = (index) => {
    setCurrentAttributeIndex(index);
    setShowAttributeModal(true);
  };

  const handleAttributeCreated = (newAttribute) => {
    setAvailableAttributes([...availableAttributes, newAttribute]);

    if (currentAttributeIndex !== null) {
      attributeChangeHandler(
        currentAttributeIndex,
        "attributeId",
        newAttribute._id,
      );
    }
  };

  return (
    <>
      {deviceType && (
        <SwitchField
          id="isActive"
          name="isActive"
          checked={isActive}
          onCheckedChange={() => setIsActive(!isActive)}
          label="Активен"
          hint="Тип предлагается при добавлении устройств."
        />
      )}
      <Field label="Название типа устройства" htmlFor="name" required>
        <Input
          required
          autoFocus
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Введите название типа устройства"
        />
      </Field>

      <Field
        label="Префикс инвентарного номера"
        htmlFor="inventoryPrefix"
        hint="Используется для автогенерации инвентарных номеров устройств этого типа. Пусто — префикс по умолчанию."
      >
        <Input
          id="inventoryPrefix"
          name="inventoryPrefix"
          type="text"
          value={inventoryPrefix}
          onChange={(event) =>
            setInventoryPrefix(event.target.value.toUpperCase())
          }
          placeholder="Напр. СБ — номера вида СБ-000001"
        />
      </Field>

      <SwitchField
        id="isComponent"
        name="isComponent"
        checked={isComponent}
        onCheckedChange={() => setIsComponent(!isComponent)}
        label="Комплектующие"
      />
      <SwitchField
        id="isConsumable"
        name="isConsumable"
        checked={isConsumable}
        onCheckedChange={() => setIsConsumable(!isConsumable)}
        label="Расходники"
        divider
      />
      <SwitchField
        id="isPeripheral"
        name="isPeripheral"
        checked={isPeripheral}
        onCheckedChange={() => setIsPeripheral(!isPeripheral)}
        label="Периферия"
        divider
      />

      {(isComponent || isConsumable || isPeripheral) && (
        <Field
          label="К каким типам устройств можно прикреплять"
          htmlFor="attachableToTypeIds"
          required
          hint="Можно выбрать несколько типов устройств"
          className="tw:mt-3"
        >
          <Select
            id="attachableToTypeIds"
            name="attachableToTypeIds"
            value={attachableToTypeIds}
            onChange={(selectedOptions) =>
              setAttachableToTypeIds(selectedOptions || [])
            }
            options={availableDeviceTypes}
            placeholder="Выберите типы устройств..."
            required
            isClearable
            isSearchable
            isMulti
            closeMenuOnSelect={false}
            getOptionLabel={(option) => `${option.name}`}
            getOptionValue={(option) => option._id}
          />
        </Field>
      )}

      <div className="tw:mt-4">
        <div className="tw:mb-1.5 tw:text-sm tw:font-semibold tw:text-muted-foreground">
          Атрибуты устройства
        </div>
        {attributes.map((attr, index) => {
          // Уже выбранные в других строках атрибуты убираем из списка (своё
          // значение оставляем, чтобы оно отображалось).
          const usedElsewhere = new Set(
            attributes
              .filter((_, j) => j !== index)
              .map((a) => a.attributeId)
              .filter(Boolean),
          );
          const optionsForRow = availableAttributes.filter(
            (a) => a._id === attr.attributeId || !usedElsewhere.has(a._id),
          );

          return (
            <div
              key={index}
              className="tw:mb-2.5 tw:rounded-lg tw:border tw:border-border-soft tw:p-3"
            >
              <div className="tw:flex tw:items-center tw:gap-1.5">
                <div className="tw:min-w-0 tw:flex-1">
                  <Select
                    id={`attribute-${index}`}
                    name={`attributes[${index}].attributeId`}
                    value={
                      availableAttributes.find(
                        (a) => a._id === attr.attributeId,
                      ) || null
                    }
                    onChange={(selected) =>
                      attributeChangeHandler(
                        index,
                        "attributeId",
                        selected?._id || "",
                      )
                    }
                    options={optionsForRow}
                    placeholder="Выберите из списка..."
                    isClearable
                    isSearchable
                    getOptionLabel={(option) =>
                      `${option.name} (${option.code})`
                    }
                    getOptionValue={(option) => option._id}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  onClick={() => moveAttribute(index, -1)}
                  disabled={index === 0}
                  title="Переместить выше"
                  aria-label="Переместить выше"
                >
                  <RiArrowUpLine />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  onClick={() => moveAttribute(index, 1)}
                  disabled={index === attributes.length - 1}
                  title="Переместить ниже"
                  aria-label="Переместить ниже"
                >
                  <RiArrowDownLine />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="tw:text-destructive tw:hover:bg-destructive/10 tw:hover:text-destructive"
                  onClick={() => removeAttributeHandler(index)}
                  title="Убрать атрибут"
                  aria-label="Убрать атрибут"
                >
                  <RiDeleteBinLine />
                </Button>
              </div>
              <div className="tw:mt-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-5 tw:gap-y-1.5">
                <AttributeFlag
                  id={`required-${index}`}
                  name={`attributes[${index}].required`}
                  label="Обязательный"
                  checked={attr.required}
                  onCheckedChange={(checked) =>
                    attributeChangeHandler(index, "required", checked === true)
                  }
                />
                <AttributeFlag
                  id={`extendable-${index}`}
                  name={`attributes[${index}].extendable`}
                  label="Расширяемый"
                  checked={attr.extendable}
                  onCheckedChange={(checked) =>
                    attributeChangeHandler(
                      index,
                      "extendable",
                      checked === true,
                    )
                  }
                />
                {!availableAttributes.find(
                  (a) => a._id === attr.attributeId,
                ) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="tw:ms-auto"
                    onClick={() => openAttributeModal(index)}
                  >
                    <RiAddFill /> Создать новый
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addAttributeHandler}
        >
          <RiAddFill /> Добавить атрибут
        </Button>
      </div>

      <AddDeviceAttributeModal
        show={showAttributeModal}
        onHide={() => setShowAttributeModal(false)}
        onAttributeCreated={handleAttributeCreated}
      />
    </>
  );
};

export default DeviceTypeFormFields;
