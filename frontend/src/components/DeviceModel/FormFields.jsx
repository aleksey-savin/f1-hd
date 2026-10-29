import { useState, useEffect, useRef } from "react";
import { RiInformationLine } from "react-icons/ri";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Field from "@/components/app/Field";
import { SubLabel } from "@/components/app/Panel";
import { sectionAnchorId } from "@/components/app/FormLayout";
import { load } from "@/store/form-data";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";
import { visibleOptions } from "@/util/hidden-options";
import { modelLinks } from "@/components/app/attribute-scope";
import SpecFields from "../DeviceConfiguration/SpecFields";

// Связки типа → атрибуты (populate attributeId) с группами
const linksPath = (typeId) =>
  `/api/inventory/device-type-attributes/type/${typeId}`;

const idOf = (ref) => (ref && typeof ref === "object" ? ref._id : ref) || "";

// Значения для сервера: строки, пустые не отправляются (валидация маршрута
// принимает только строки — у булевых «true»/«false»)
const valuesForSubmit = (values) =>
  values
    .filter((v) => v.value !== "" && v.value != null)
    .map((v) => ({ attributeId: v.attributeId, value: String(v.value) }));

// Поля модели устройства. Рендерят `name`-атрибуты (и скрытые поля) для сабмита
// со страницы (react-router action) и сообщают агрегированное состояние через
// onChange для инлайн-модалки (ClientDevice/InlineCreateDialog). Раздел
// «Характеристики» — значения первой конфигурации модели (режим одной, макет
// «Модель без конфигураций»); в режиме «Несколько конфигураций» они правятся
// отдельной формой с карточки.
const DeviceModelFormFields = ({
  deviceModel,
  // Первая живая конфигурация модели и сколько их всего (правка)
  configuration = null,
  configurationsCount = 0,
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  onChange,
  // Модель заводят с карточки типа: тип задан ею и в форме не меняется
  lockDeviceType = false,
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
  // Две и больше без флага (модель старше миграции) — режим нескольких:
  // иначе форма правила бы первую, а сервер отказал бы сохранить
  const [multiConfig, setMultiConfig] = useState(
    !!deviceModel?.multiConfig || configurationsCount > 1,
  );
  const [values, setValues] = useState(() =>
    (configuration?.values || []).map((v) => ({
      attributeId: idOf(v.attributeId),
      value: v.value,
    })),
  );

  const selectedDeviceType = deviceTypes.find((dt) => dt._id === deviceTypeId);

  // Связки выбранного типа: null — едут. Смена типа сбрасывает значения:
  // атрибуты прежнего типа к новому не относятся
  const [links, setLinks] = useState(null);
  const loadedType = useRef(deviceTypeId);
  useEffect(() => {
    if (loadedType.current !== deviceTypeId) {
      loadedType.current = deviceTypeId;
      setValues([]);
    }
    if (!deviceTypeId) {
      setLinks([]);
      return undefined;
    }
    let cancelled = false;
    setLinks(null);
    load(linksPath(deviceTypeId))
      .then((list) => {
        if (cancelled) return;
        // Характеристики модели — только атрибуты уровня модели
        setLinks(
          modelLinks(Array.isArray(list) ? list : []).filter(
            (link) => link.attributeId && typeof link.attributeId === "object",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceTypeId]);

  // Выключить режим нельзя, пока на карточке больше одной конфигурации
  const multiLocked = multiConfig && configurationsCount > 1;

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
      multiConfig,
      values: valuesForSubmit(values),
    });
  }, [
    name,
    deviceTypeId,
    vendorId,
    compatibleWithModelIds,
    notes,
    multiConfig,
    values,
  ]);

  return (
    <>
      {/* Скрытые поля для сабмита со страницы (react-router action) */}
      <input type="hidden" name="deviceTypeId" value={deviceTypeId} />
      <input type="hidden" name="vendorId" value={vendorId} />
      <input
        type="hidden"
        name="multiConfig"
        value={multiConfig ? "true" : "false"}
      />
      <input
        type="hidden"
        name="values"
        value={JSON.stringify(valuesForSubmit(values))}
      />
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
            options={toOptions(
              visibleOptions(deviceTypes, [deviceModel?.deviceTypeId?._id]),
              {
                value: (option) => String(option._id),
                label: (option) => option.name,
              },
            )}
            placeholder="Выберите тип устройства…"
            clearable={!lockDeviceType}
            clearLabel="Не выбран"
            disabled={lockDeviceType}
          />
        </Field>

        <Field label="Производитель" htmlFor="vendorId" required>
          <Combobox
            id="vendorId"
            value={vendorId || null}
            onChange={(id) => setVendorId(id || "")}
            options={toOptions(
              visibleOptions(vendors, [deviceModel?.vendorId?._id]),
              {
                value: (option) => String(option._id),
                label: (option) => option.name,
              },
            )}
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

      {/* Характеристики (макет «Модель без конфигураций», разд. 2) */}
      <section
        id={sectionAnchorId("specs")}
        className="mt-1.5 border-t border-border-soft pt-3.5"
      >
        <SubLabel>Характеристики</SubLabel>
        <div className="mb-3.5 flex items-start gap-3 rounded-lg bg-accent px-3.5 py-3">
          <Label
            htmlFor="model-multi-config"
            className="grid min-w-0 flex-1 gap-0.5 text-sm font-medium"
          >
            Несколько конфигураций
            <span className="text-xs font-normal text-muted-foreground">
              {multiLocked
                ? "Чтобы выключить, оставьте на карточке одну конфигурацию."
                : "Включите, если модель выпускается в разных исполнениях, например 16 ГБ / 512 ГБ и 32 ГБ / 1 ТБ."}
            </span>
          </Label>
          <Switch
            id="model-multi-config"
            checked={multiConfig}
            onCheckedChange={setMultiConfig}
            disabled={multiLocked}
            className="mt-0.5"
          />
        </div>

        {multiConfig ? (
          <div className="mb-3.5 flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
            <RiInformationLine
              size={16}
              aria-hidden
              className="mt-0.5 flex-none text-accent-text"
            />
            {multiLocked ? (
              <div>
                Характеристики — в{" "}
                <b className="font-medium text-foreground">
                  {configurationsCount} конфигурациях
                </b>{" "}
                на карточке модели.
              </div>
            ) : (
              <div>
                Характеристики задаются в конфигурациях на карточке модели.{" "}
                <b className="font-medium text-foreground">
                  Уже введённые станут первой конфигурацией.
                </b>
              </div>
            )}
          </div>
        ) : !deviceTypeId ? null : links && links.length === 0 ? (
          <p className="mt-0 mb-3.5 text-sm text-muted-foreground">
            У типа устройства нет характеристик.
          </p>
        ) : (
          <SpecFields
            links={links || []}
            values={values}
            onChange={setValues}
          />
        )}
      </section>
    </>
  );
};

export default DeviceModelFormFields;
