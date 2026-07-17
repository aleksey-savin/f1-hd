import { useState, useEffect } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";

import Select from "../../UI/Select";

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

      <div className="tw:grid tw:gap-x-4 tw:sm:grid-cols-2">
        <Field label="Тип устройства" htmlFor="deviceTypeId" required>
          <Select
            id="deviceTypeId"
            value={deviceTypes.find((dt) => dt._id === deviceTypeId) || null}
            onChange={(option) => setDeviceTypeId(option?._id || "")}
            options={deviceTypes}
            placeholder="Выберите тип устройства…"
            isClearable
            isSearchable
            getOptionLabel={(option) => option.name}
            getOptionValue={(option) => option._id}
          />
        </Field>

        <Field label="Производитель" htmlFor="vendorId" required>
          <Select
            id="vendorId"
            value={vendors.find((v) => v._id === vendorId) || null}
            onChange={(option) => setVendorId(option?._id || "")}
            options={vendors}
            placeholder="Выберите производителя…"
            isClearable
            isSearchable
            getOptionLabel={(option) => option.name}
            getOptionValue={(option) => option._id}
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
          <Select
            id="compatibleWithModelIds"
            value={deviceModels.filter((dm) =>
              compatibleWithModelIds.includes(dm._id),
            )}
            onChange={(options) =>
              setCompatibleWithModelIds((options || []).map((o) => o._id))
            }
            options={deviceModels}
            placeholder="Выберите совместимые модели…"
            isClearable
            isSearchable
            isMulti
            closeMenuOnSelect={false}
            getOptionLabel={(option) =>
              `${option.vendorId?.name || "—"} ${option.name || ""} · ${option.deviceTypeId?.name || "—"}`
            }
            getOptionValue={(option) => option._id}
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
