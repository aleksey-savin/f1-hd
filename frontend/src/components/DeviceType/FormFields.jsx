import { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import { MultiCombobox, toOptions } from "@/components/app/Combobox";

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
          className="mt-3"
        >
          <MultiCombobox
            id="attachableToTypeIds"
            name="attachableToTypeIds"
            required
            value={(attachableToTypeIds || []).map((item) => String(item._id))}
            onChange={(ids) =>
              setAttachableToTypeIds(
                availableDeviceTypes.filter((option) =>
                  ids.includes(String(option._id)),
                ),
              )
            }
            options={toOptions(availableDeviceTypes, {
              value: (option) => String(option._id),
              label: (option) => option.name,
            })}
            placeholder="Выберите типы устройств..."
          />
        </Field>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent px-3.5 py-2.5 text-sm text-muted-foreground">
        Атрибуты типа настраиваются на его карточке — добавляются, меняются и
        сортируются отдельно.
      </p>
    </>
  );
};

export default DeviceTypeFormFields;
