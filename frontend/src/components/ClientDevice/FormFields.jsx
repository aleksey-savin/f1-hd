import { Link } from "react-router";
import { RiAddLine, RiAlertLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Combobox from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import { DEVICE_STATUS_OPTIONS } from "@/components/app/device-status";

// Группы полей устройства — ОДИН набор на мастер создания и на плоскую правку.
// Форк «мини-формы» под каждый режим и есть тот случай, когда правила
// заполнения расходятся молча (см. docs/ux-ui-guide.md, «Создание — визард,
// правка — плоская»).
//
// Каждая группа контролируемая: значения приходят из `values`, изменения — в
// `onChange(field, value)`. Ошибки полей — карта `errors[field]`, чтобы причина
// стояла у самого поля, а не строкой под всей формой.

// Поле-справочник с кнопкой «завести новое» рядом: список длинный, поэтому
// Combobox (react-select внутри шторки обрезается прокруткой — см. гайд).
export const CatalogField = ({
  id,
  label,
  required,
  hint,
  error,
  value,
  options,
  onChange,
  onAdd,
  addTitle,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
}) => (
  <Field label={label} htmlFor={id} required={required} hint={error || hint}>
    <div className="tw:flex tw:gap-2">
      <Combobox
        id={id}
        value={value || null}
        options={options}
        onChange={(next) => onChange(next || "")}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        clearable
        disabled={disabled}
        className={error ? "tw:border-destructive" : undefined}
      />
      {onAdd && (
        <Button
          type="button"
          variant="outline"
          // icon-sm — высота Combobox (36px), иначе кнопка на 4px выше поля
          size="icon-sm"
          title={addTitle}
          aria-label={addTitle}
          disabled={disabled}
          onClick={onAdd}
          className="tw:flex-none"
        >
          <RiAddLine />
        </Button>
      )}
    </div>
  </Field>
);

/**
 * Совпадение серийного номера — ПРЕДУПРЕЖДЕНИЕ, а не запрет: производитель
 * повторяет номера (партия одинаковых блоков питания), наклейка бывает
 * нечитаемой, и жёсткое ограничение люди обходили суффиксом, портя данные.
 * Показываем, что уже заведено, и даём открыть — решает человек.
 */
const SerialHint = ({ matches }) => {
  if (!matches?.length) return null;
  return (
    <span className="tw:flex tw:items-start tw:gap-1.5 tw:text-warning">
      <RiAlertLine size={14} aria-hidden className="tw:mt-0.5 tw:flex-none" />
      <span>
        Такой серийный номер уже есть:{" "}
        {matches.map((match, index) => (
          <span key={match._id}>
            {index > 0 && ", "}
            <Link
              to={`/inventory/client-devices/${match._id}`}
              target="_blank"
              className="tw:font-medium tw:text-warning tw:underline"
            >
              {[match.inventoryNumber, match.name, match.company]
                .filter(Boolean)
                .join(" · ")}
            </Link>
          </span>
        ))}
        . Для одинаковых партий это нормально — сохранить всё равно можно.
      </span>
    </span>
  );
};

const KIND_OPTIONS = [
  { value: "branded", label: "Заводская сборка" },
  { value: "custom", label: "Своя сборка" },
];

/**
 * «Что это»: вид сборки решает, показывать ли цепочку вендор → модель. Не
 * гасим неприменимые поля серым — убираем их совсем (гайд, «Форма
 * подстраивается под тип сущности»).
 */
export const DeviceFields = ({
  values,
  onChange,
  onKindChange,
  deviceKind,
  errors = {},
  options,
  onInlineCreate,
  serialMatches,
}) => (
  <>
    <Segmented
      ariaLabel="Вид сборки"
      options={KIND_OPTIONS}
      value={deviceKind}
      onChange={onKindChange}
      className="tw:mb-4"
    />

    <CatalogField
      id="device-type"
      label="Тип устройства"
      required
      error={errors.deviceTypeId}
      hint={
        deviceKind === "custom"
          ? "Производитель и модель не указываются — единицу опознаёт инвентарный номер."
          : undefined
      }
      value={values.deviceTypeId}
      options={options.deviceTypes}
      onChange={(next) => onChange("deviceTypeId", next)}
      onAdd={() => onInlineCreate("deviceType")}
      addTitle="Новый тип"
      placeholder="Выберите тип"
      searchPlaceholder="Найти тип…"
    />

    {deviceKind === "branded" && (
      <>
        <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
          <CatalogField
            id="device-vendor"
            label="Производитель"
            required
            error={errors.vendorId}
            value={values.vendorId}
            options={options.vendors}
            onChange={(next) => onChange("vendorId", next)}
            onAdd={() => onInlineCreate("vendor")}
            addTitle="Новый производитель"
            placeholder="Выберите производителя"
            searchPlaceholder="Найти производителя…"
          />
          <CatalogField
            id="device-model"
            label="Модель"
            required
            error={errors.deviceModelId}
            value={values.deviceModelId}
            options={options.deviceModels}
            onChange={(next) => onChange("deviceModelId", next)}
            onAdd={() => onInlineCreate("deviceModel")}
            addTitle="Новая модель"
            placeholder={
              values.vendorId && values.deviceTypeId
                ? "Выберите модель"
                : "Сначала тип и производитель"
            }
            searchPlaceholder="Найти модель…"
            emptyText="Моделей нет — заведите новую"
            disabled={!values.deviceTypeId || !values.vendorId}
          />
        </div>

        {/* Поле есть, только когда есть из чего выбрать: заблокированный
            селект с подписью «конфигураций нет» — это пустое место, занявшее
            строку формы. Заводят их на странице модели. */}
        {values.deviceModelId && options.configurations.length > 0 && (
          <CatalogField
            id="device-configuration"
            label="Конфигурация"
            hint="Набор характеристик модели — попадёт в секцию «Характеристики» карточки."
            value={values.configurationId}
            options={options.configurations}
            onChange={(next) => onChange("configurationId", next)}
            placeholder="Выберите конфигурацию"
            searchPlaceholder="Найти конфигурацию…"
          />
        )}
      </>
    )}

    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field
        label="Инвентарный номер"
        htmlFor="device-inventory"
        hint="Оставьте пустым — номер выдаст счётчик типа."
      >
        <Input
          id="device-inventory"
          value={values.inventoryNumber}
          onChange={(event) => onChange("inventoryNumber", event.target.value)}
          placeholder="Присвоим автоматически"
          className="tw:font-mono"
        />
      </Field>
      <Field
        label="Серийный номер"
        htmlFor="device-serial"
        hint={<SerialHint matches={serialMatches} />}
      >
        <Input
          id="device-serial"
          value={values.serialNumber}
          onChange={(event) => onChange("serialNumber", event.target.value)}
          placeholder="Введите, если есть"
          className="tw:font-mono"
        />
      </Field>
    </div>
  </>
);

/**
 * «Чьё и где». Поле «Кому выдаём» показывается только у статуса
 * «В эксплуатации» и только в создании: дальше выдача и возврат — операция
 * карточки со своим эндпоинтом (он же меняет статус).
 */
export const PlacementFields = ({
  values,
  onChange,
  errors = {},
  options,
  onInlineCreate,
  showAssignee,
}) => (
  <>
    <CatalogField
      id="device-company"
      label="Компания"
      required
      error={errors.companyId}
      value={values.companyId}
      options={options.companies}
      onChange={(next) => onChange("companyId", next)}
      placeholder="Выберите компанию"
      searchPlaceholder="Найти компанию…"
    />

    <CatalogField
      id="device-location"
      label="Расположение"
      hint="Список — расположения выбранной компании, полным путём."
      value={values.locationId}
      options={options.locations}
      onChange={(next) => onChange("locationId", next)}
      onAdd={() => onInlineCreate("location")}
      addTitle="Новое расположение"
      placeholder={
        values.companyId ? "Выберите расположение" : "Сначала выберите компанию"
      }
      searchPlaceholder="Найти расположение…"
      disabled={!values.companyId}
    />

    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field label="Учётный статус" htmlFor="device-status">
        <Combobox
          id="device-status"
          value={values.status}
          options={DEVICE_STATUS_OPTIONS}
          onChange={(next) => onChange("status", next || "readyForDeployment")}
          placeholder="Выберите статус"
          searchPlaceholder="Найти статус…"
        />
      </Field>

      {showAssignee && values.status === "deployed" && (
        <Field
          label="Кому выдаём"
          htmlFor="device-user"
          required
          hint={
            errors.userId ||
            "Дальше выдача и возврат — операция на карточке устройства."
          }
        >
          <Combobox
            id="device-user"
            value={values.userId || null}
            options={options.users}
            onChange={(next) => onChange("userId", next || "")}
            placeholder={
              values.companyId
                ? "Выберите сотрудника"
                : "Сначала выберите компанию"
            }
            searchPlaceholder="Найти сотрудника…"
            emptyText="Нет подходящих сотрудников"
            disabled={!values.companyId}
            className={errors.userId ? "tw:border-destructive" : undefined}
          />
        </Field>
      )}
    </div>
  </>
);

/** Закупка и гарантия — блок необязательный целиком. */
export const PurchaseFields = ({
  values,
  onChange,
  options,
  onInlineCreate,
}) => (
  <>
    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field label="Дата приобретения" htmlFor="device-purchased">
        <Input
          id="device-purchased"
          type="date"
          value={values.purchasedAt}
          onChange={(event) => onChange("purchasedAt", event.target.value)}
        />
      </Field>
      <Field label="Стоимость, ₽" htmlFor="device-price">
        <Input
          id="device-price"
          type="number"
          min="0"
          step="0.01"
          value={values.price}
          onChange={(event) => onChange("price", event.target.value)}
          placeholder="0"
        />
      </Field>
    </div>

    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field label="Документ" htmlFor="device-document">
        <Input
          id="device-document"
          value={values.purchaseDocument}
          onChange={(event) => onChange("purchaseDocument", event.target.value)}
          placeholder="Номер документа о покупке"
        />
      </Field>
      <CatalogField
        id="device-supplier"
        label="Поставщик"
        value={values.supplierId}
        options={options.suppliers}
        onChange={(next) => onChange("supplierId", next)}
        onAdd={() => onInlineCreate("supplier")}
        addTitle="Новый поставщик"
        placeholder="Выберите поставщика"
        searchPlaceholder="Найти поставщика…"
      />
    </div>

    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field label="Гарантия до" htmlFor="device-warranty">
        <Input
          id="device-warranty"
          type="date"
          value={values.warrantyExpirationDate}
          onChange={(event) =>
            onChange("warrantyExpirationDate", event.target.value)
          }
        />
      </Field>
    </div>
  </>
);

/**
 * Сеть и система. У вендора с управлением Mikrotik блок сжимается до имени:
 * серийник, прошивку и адреса устройство отдаст само при подключении.
 */
export const TechFields = ({ values, onChange, mikrotikMode }) => (
  <>
    <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
      <Field
        label="Имя в сети"
        htmlFor="device-hostname"
        hint={
          mikrotikMode
            ? "Остальное заполнится с устройства при подключении к мониторингу."
            : "Сетевое имя ПК или identity устройства."
        }
      >
        <Input
          id="device-hostname"
          value={values.hostname}
          onChange={(event) => onChange("hostname", event.target.value)}
          placeholder="AG-WS001"
          className="tw:font-mono"
        />
      </Field>
      {!mikrotikMode && (
        <Field label="Операционная система" htmlFor="device-os">
          <Input
            id="device-os"
            value={values.operatingSystem}
            onChange={(event) =>
              onChange("operatingSystem", event.target.value)
            }
            placeholder="Windows 11, Ubuntu 22.04"
          />
        </Field>
      )}
    </div>

    {!mikrotikMode && (
      <>
        <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
          <Field label="IP-адрес" htmlFor="device-ip">
            <Input
              id="device-ip"
              value={values.ipAddress}
              onChange={(event) => onChange("ipAddress", event.target.value)}
              placeholder="192.168.1.100"
              className="tw:font-mono"
            />
          </Field>
          <Field label="MAC-адрес" htmlFor="device-mac">
            <Input
              id="device-mac"
              value={values.macAddress}
              onChange={(event) => onChange("macAddress", event.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="tw:font-mono"
            />
          </Field>
        </div>
        <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
          <Field label="Последнее обслуживание" htmlFor="device-maintenance">
            <Input
              id="device-maintenance"
              type="date"
              value={values.lastMaintenanceDate}
              onChange={(event) =>
                onChange("lastMaintenanceDate", event.target.value)
              }
            />
          </Field>
        </div>
      </>
    )}

    <Field label="Заметки" htmlFor="device-notes">
      <Textarea
        id="device-notes"
        rows={3}
        value={values.notes}
        onChange={(event) => onChange("notes", event.target.value)}
        placeholder="Дополнительные заметки об устройстве…"
      />
    </Field>
  </>
);
