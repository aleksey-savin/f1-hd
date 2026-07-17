import { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";

// Поля типа устройства. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Справочник availableDeviceTypes приходит пропсом.
//
// Атрибуты типа сюда НЕ входят — они управляются отдельными формами с карточки
// типа (добавить/изменить/удалить/порядок), как конфигурации у модели.
const DeviceTypeFormFields = ({
  deviceType,
  availableDeviceTypes = [],
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
    });
  }, [
    name,
    isActive,
    isComponent,
    isConsumable,
    isPeripheral,
    inventoryPrefix,
    attachableToTypeIds,
  ]);

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

      <p className="tw:mt-3 tw:flex tw:items-start tw:gap-2 tw:rounded-lg tw:bg-accent tw:px-3.5 tw:py-2.5 tw:text-sm tw:text-muted-foreground">
        Атрибуты типа настраиваются на его карточке — добавляются, меняются и
        сортируются отдельно.
      </p>
    </>
  );
};

export default DeviceTypeFormFields;
