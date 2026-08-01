import { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";

// Поля модели устройства. Рендерят `name`-атрибуты (и скрытые поля) для сабмита
// со страницы (react-router action) и сообщают агрегированное состояние через
// onChange для инлайн-модалки (ClientDevice/InlineCreateModal). Конфигурации
// сюда НЕ входят — их добавляют отдельной формой с карточки модели.
const DeviceModelFormFields = ({
  deviceModel,
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  onChange,
}) => {
  const [name, setName] = useState(deviceModel?.name || "");
  const [deviceTypeId, setDeviceTypeId] = useState(
    deviceModel?.deviceTypeId?._id || "",
  );
  const [vendorId, setVendorId] = useState(deviceModel?.vendorId?._id || "");
  // Храним id (а не option-объекты) — консистентно и для value, и для сабмита.
  const [compatibleWithModelIds, setCompatibleWithModelIds] = useState(
    deviceModel?.compatibleWithModelIds?.map((m) => m._id || m) || [],
  );
  const [notes, setNotes] = useState(deviceModel?.notes || "");

  const selectedDeviceType = deviceTypes.find((dt) => dt._id === deviceTypeId);

  // Сообщаем состояние наверх (на странице onChange игнорируется — сабмит идёт
  // через `name`-атрибуты; в инлайн-модалке состояние собирается отсюда).
  useEffect(() => {
    if (!onChange) return;
    onChange({
      name,
      deviceTypeId,
      vendorId,
      compatibleWithModelIds,
      notes,
    });
  }, [name, deviceTypeId, vendorId, compatibleWithModelIds, notes]);

  return (
    <>
      {/* Скрытые поля для сабмита со страницы (react-router action) */}
      <input type="hidden" name="deviceTypeId" value={deviceTypeId} />
      <input type="hidden" name="vendorId" value={vendorId} />
      {compatibleWithModelIds.map((id) => (
        <input
          key={id}
          type="hidden"
          name="compatibleWithModelIds"
          value={id}
        />
      ))}

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Тип устройства" htmlFor="deviceTypeId" required>
          <Combobox
            id="deviceTypeId"
            value={deviceTypeId || null}
            onChange={(id) => setDeviceTypeId(id || "")}
            options={toOptions(deviceTypes, {
              value: (option) => String(option._id),
              label: (option) => option.name,
            })}
            placeholder="Выберите тип устройства…"
            clearable
            clearLabel="Не выбран"
          />
        </Field>

        <Field label="Производитель" htmlFor="vendorId" required>
          <Combobox
            id="vendorId"
            value={vendorId || null}
            onChange={(id) => setVendorId(id || "")}
            options={toOptions(vendors, {
              value: (option) => String(option._id),
              label: (option) => option.name,
            })}
            placeholder="Выберите производителя…"
            clearable
            clearLabel="Не выбран"
          />
        </Field>
      </div>

      <Field
        label="Название модели"
        htmlFor="name"
        hint="Опционально. Можно оставить пустым, если модель не имеет конкретного названия."
      >
        <Input
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="XPS 15, ThinkPad X1 Carbon"
        />
      </Field>

      {/* Совместимые модели — только для расходников (картриджи, тонеры и т.п.) */}
      {selectedDeviceType?.isConsumable && (
        <Field
          label="Совместимые модели"
          htmlFor="compatibleWithModelIds"
          hint="Модели, с которыми совместима данная."
        >
          <MultiCombobox
            id="compatibleWithModelIds"
            value={compatibleWithModelIds.map((id) => String(id))}
            onChange={setCompatibleWithModelIds}
            options={toOptions(deviceModels, {
              value: (option) => String(option._id),
              label: (option) =>
                `${option.vendorId?.name || "—"} ${option.name || ""} · ${option.deviceTypeId?.name || "—"}`,
            })}
            placeholder="Выберите совместимые модели…"
          />
        </Field>
      )}

      <Field label="Примечания" htmlFor="notes">
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Дополнительная информация о модели"
        />
      </Field>
    </>
  );
};

export default DeviceModelFormFields;
