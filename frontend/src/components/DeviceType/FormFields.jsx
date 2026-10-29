import { useState, useEffect } from "react";
import { isMobile } from "react-device-detect";

import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import SwitchField from "@/components/app/SwitchField";

import { MultiCombobox, toOptions } from "@/components/app/Combobox";
import { plural } from "../../util/plural";
import { KIND_FORM_OPTIONS, isKind, kindFlags, kindOf } from "./kinds";

// Поля типа устройства. Рендерят `name`-атрибуты для сабмита со страницы
// (react-router action) и сообщают агрегированное состояние через onChange для
// инлайн-модалки. Справочник availableDeviceTypes приходит пропсом.
//
// Атрибуты типа сюда НЕ входят — они управляются отдельными формами с карточки
// типа (добавить/изменить/удалить/порядок), как конфигурации у модели.
//
// Назначение — один выбор из четырёх (хранится тремя флагами, взведён не
// больше одного). `initialKind` — раздел списка, из которого создают тип.
const DeviceTypeFormFields = ({
  deviceType,
  availableDeviceTypes = [],
  initialKind,
  onChange,
}) => {
  const [name, setName] = useState(deviceType?.name || "");
  const [isActive, setIsActive] = useState(
    deviceType ? deviceType.isActive : true,
  );
  const [kind, setKind] = useState(
    deviceType ? kindOf(deviceType) : isKind(initialKind) ? initialKind : "primary",
  );
  const { isComponent, isConsumable, isPeripheral } = kindFlags(kind);
  const kindHint = KIND_FORM_OPTIONS.find((o) => o.value === kind)?.hint;
  const [inventoryPrefix, setInventoryPrefix] = useState(
    deviceType?.inventoryPrefix || "",
  );
  const [attachableToTypeIds, setAttachableToTypeIds] = useState(
    deviceType?.attachableToTypeIds || [],
  );
  // «Своя сборка» — только в правке (создание флаг не принимает). Выключить
  // нельзя, пока у типа есть сборки: переключатель остаётся включённым, а
  // подсказка объясняет почему (сервер ответит тем же 409 — страховка).
  const [assemblyEnabled, setAssemblyEnabled] = useState(
    !!deviceType?.assembly?.enabled,
  );
  const [assemblyLocked, setAssemblyLocked] = useState(false);
  const buildsCount = deviceType?.buildsCount || 0;
  const toggleAssembly = (checked) => {
    if (!checked && deviceType?.assembly?.enabled && buildsCount > 0) {
      setAssemblyLocked(true);
      return;
    }
    setAssemblyLocked(false);
    setAssemblyEnabled(checked);
  };

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

      <Field label="Назначение" hint={kindHint}>
        <Segmented
          ariaLabel="Назначение"
          fit
          compact={isMobile}
          options={KIND_FORM_OPTIONS}
          value={kind}
          onChange={setKind}
        />
      </Field>
      {/* Сабмит страницы читает три флага — отдаём их из одного выбора */}
      <input type="hidden" name="isComponent" value={String(isComponent)} />
      <input type="hidden" name="isConsumable" value={String(isConsumable)} />
      <input type="hidden" name="isPeripheral" value={String(isPeripheral)} />

      {kind !== "primary" && (
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

      {/* Собирается из комплектующих только устройство. Скрытый переключатель
          не шлёт поля — сабмит прочтёт «выключено», и сервер не даст снять
          сборку у типа, у которого сборки уже есть (409 с причиной). */}
      {deviceType && kind === "primary" && (
        <SwitchField
          id="assemblyEnabled"
          name="assemblyEnabled"
          checked={assemblyEnabled}
          onCheckedChange={toggleAssembly}
          label="Своя сборка — из комплектующих"
          hint={
            assemblyLocked ? (
              <span className="text-warning-text">
                Нельзя выключить: у типа {buildsCount}{" "}
                {plural(buildsCount, "сборка", "сборки", "сборок")}. Сначала
                удалите их.
              </span>
            ) : (
              "Устройства «Своя сборка» этого типа описываются деталями по слотам, а не атрибутами. Брендовые модели не меняются."
            )
          }
          divider
        />
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent px-3.5 py-2.5 text-sm text-muted-foreground">
        Атрибуты типа настраиваются на его карточке — добавляются, меняются и
        сортируются отдельно.
      </p>
    </>
  );
};

export default DeviceTypeFormFields;
