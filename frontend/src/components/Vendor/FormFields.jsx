import { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

// Поля вендора. Рендерят `name`-атрибуты (для сабмита со страницы через
// react-router action) и одновременно сообщают агрегированное состояние через
// onChange (для инлайн-модалки, которая шлёт fetch напрямую).
const VendorFormFields = ({ vendor, onChange }) => {
  const [name, setName] = useState(vendor?.name || "");
  const [isActive, setIsActive] = useState(vendor ? vendor.isActive : true);
  const [isMikrotikManagementEnabled, setIsMikrotikManagementEnabled] =
    useState(vendor ? vendor.isMikrotikManagementEnabled : false);

  const emit = (data) => {
    if (onChange) onChange(data);
  };

  // Сообщаем начальное состояние, чтобы модалка имела полный объект без правок.
  useEffect(() => {
    emit({ name, isActive, isMikrotikManagementEnabled });
  }, []);

  const nameChangeHandler = (event) => {
    const newName = event.target.value;
    setName(newName);
    emit({ name: newName, isActive, isMikrotikManagementEnabled });
  };

  const isActiveChangeHandler = () => {
    const newIsActive = !isActive;
    setIsActive(newIsActive);
    emit({ name, isActive: newIsActive, isMikrotikManagementEnabled });
  };

  const isMikrotikManagementEnabledChangeHandler = () => {
    const newValue = !isMikrotikManagementEnabled;
    setIsMikrotikManagementEnabled(newValue);
    emit({ name, isActive, isMikrotikManagementEnabled: newValue });
  };

  return (
    <>
      <Field label="Название" htmlFor="name" required>
        <Input
          required
          autoFocus
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={nameChangeHandler}
          placeholder="Например, MikroTik"
        />
      </Field>

      <SwitchField
        id="isActive"
        name="isActive"
        checked={isActive}
        onCheckedChange={isActiveChangeHandler}
        label="Активен"
        hint="Вендор предлагается при добавлении устройств."
      />

      <SwitchField
        id="isMikrotikManagementEnabled"
        name="isMikrotikManagementEnabled"
        checked={isMikrotikManagementEnabled}
        onCheckedChange={isMikrotikManagementEnabledChangeHandler}
        label="Управление MikroTik"
        hint="Мониторинг устройств и обновление прошивок RouterOS."
        divider
      />
    </>
  );
};

export default VendorFormFields;
