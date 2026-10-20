import { Link } from "react-router";
import { RiAddLine, RiAlertLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ChoiceGroup from "@/components/app/ChoiceGroup";
import Combobox from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";
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
// Combobox: длинный список внутри шторки (см. гайд).
const CatalogField = ({
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
    <div className="flex gap-2">
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
        className={error ? "border-destructive" : undefined}
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
          className="flex-none"
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
    <span className="flex items-start gap-1.5 text-warning">
      <RiAlertLine size={14} aria-hidden className="mt-0.5 flex-none" />
      <span>
        Такой серийный номер уже есть:{" "}
        {matches.map((match, index) => (
          <span key={match._id}>
            {index > 0 && ", "}
            <Link
              to={`/inventory/client-devices/${match._id}`}
              target="_blank"
              className="font-medium text-warning underline"
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

// «Как описываем» — только у типа, который собирается из комплектующих
const KIND_OPTIONS = [
  { value: "branded", label: "Модель из каталога" },
  { value: "custom", label: "Своя сборка" },
];

/**
 * «Сборка» — у своей сборки типа с комплектующими, только в создании: шаблон
 * сборки или «Без сборки — комплектующие вручную». Под полем — что войдёт в ПК
 * (макет «ПК из сборки», разд. 1); детали правятся на шаге «Комплектующие».
 */
const BuildField = ({ build }) => {
  const retry = build.error && (
    <span>
      Не удалось загрузить сборки типа.{" "}
      <button
        type="button"
        onClick={build.onRetry}
        className="cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-accent-text hover:underline"
      >
        Повторить
      </button>
    </span>
  );
  return (
    <>
      <Field
        label="Сборка"
        htmlFor="device-build"
        // После «Далее»: пока комплектующие типа не загружены, дальше нельзя
        error={build.issue ? retry || build.issue : undefined}
        hint={
          retry ? (
            <span className="text-warning-text">{retry}</span>
          ) : (
            "Или «Без сборки — комплектующие вручную». Детали можно поменять на следующем шаге."
          )
        }
      >
        <Combobox
          id="device-build"
          value={build.value || null}
          options={build.options}
          onChange={(next) => build.onChange(next || "")}
          loading={build.loading}
          placeholder="Выберите сборку"
          searchPlaceholder="Найти сборку…"
        />
      </Field>
      {build.summary && (
        <div className="-mt-1 mb-4 rounded-lg border border-border bg-accent px-3 py-2.5 text-sm text-muted-foreground">
          {build.summary.keySpecs && (
            <b className="block font-medium text-foreground">
              {build.summary.keySpecs}
            </b>
          )}
          {build.summary.composition}
        </div>
      )}
    </>
  );
};

/**
 * «Что это»: сначала тип — от него зависит остальное. Выбор «Модель из
 * каталога / Своя сборка» есть, только когда `kindChoice` (тип собирается из
 * комплектующих; в правке — и у нынешней самосборки). Не гасим неприменимые
 * поля серым — убираем их совсем (гайд, «Форма подстраивается под тип
 * сущности»). `awaitingType` — создание без типа: вместо полей подсказка.
 * `build` — поле «Сборка» (см. BuildField), null — его нет.
 */
export const DeviceFields = ({
  values,
  onChange,
  onKindChange,
  deviceKind,
  kindChoice = false,
  awaitingType = false,
  errors = {},
  options,
  onInlineCreate,
  serialMatches,
  build = null,
}) => (
  <>
    <CatalogField
      id="device-type"
      label="Тип устройства"
      required
      error={errors.deviceTypeId}
      value={values.deviceTypeId}
      options={options.deviceTypes}
      onChange={(next) => onChange("deviceTypeId", next)}
      onAdd={() => onInlineCreate("deviceType")}
      addTitle="Новый тип"
      placeholder="Выберите тип"
      searchPlaceholder="Найти тип…"
    />

    {awaitingType ? (
      <div className="mb-4 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
        <b className="font-medium text-foreground">Выберите тип</b> — от него
        зависит, что спросим дальше: модель из каталога или комплектующие своей
        сборки.
      </div>
    ) : (
      <>
        {kindChoice && (
          <Field label={<span id="device-kind-label">Как описываем</span>}>
            <ChoiceGroup
              ariaLabelledBy="device-kind-label"
              options={KIND_OPTIONS}
              columns="auto"
              value={deviceKind}
              onChange={onKindChange}
            />
          </Field>
        )}

        {deviceKind === "custom" && build && <BuildField build={build} />}

        {deviceKind === "branded" && (
          <>
            <div className="grid gap-x-3 md:grid-cols-2">
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
                селект с подписью «конфигураций нет» — это пустое место,
                занявшее строку формы. Заводят их на странице модели. */}
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

        <div className="grid gap-x-3 md:grid-cols-2">
          <Field
            label="Инвентарный номер"
            htmlFor="device-inventory"
            hint="Оставьте пустым — номер выдаст счётчик типа."
          >
            <Input
              id="device-inventory"
              value={values.inventoryNumber}
              onChange={(event) =>
                onChange("inventoryNumber", event.target.value)
              }
              placeholder="Присвоим автоматически"
              className="font-mono"
            />
          </Field>
          <Field
            label="Серийный номер"
            htmlFor="device-serial"
            hint={
              serialMatches?.length ? (
                <SerialHint matches={serialMatches} />
              ) : (
                // Поле «Сборка» есть — будет и шаг «Комплектующие»
                deviceKind === "custom" &&
                build &&
                "У своей сборки серийники — у деталей, на следующем шаге."
              )
            }
          >
            <Input
              id="device-serial"
              value={values.serialNumber}
              onChange={(event) => onChange("serialNumber", event.target.value)}
              placeholder="Введите, если есть"
              className="font-mono"
            />
          </Field>
        </div>
      </>
    )}
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
      hint="Расположения выбранной компании; ниже — общедоступные других компаний и рабочие места."
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

    <div className="grid gap-x-3 md:grid-cols-2">
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
            className={errors.userId ? "border-destructive" : undefined}
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
    <div className="grid gap-x-3 md:grid-cols-2">
      <Field label="Дата приобретения" htmlFor="device-purchased">
        <DateField
          id="device-purchased"
          value={values.purchasedAt}
          onChange={(next) => onChange("purchasedAt", next)}
          captionLayout="dropdown"
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

    <div className="grid gap-x-3 md:grid-cols-2">
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

    <div className="grid gap-x-3 md:grid-cols-2">
      <Field label="Гарантия до" htmlFor="device-warranty">
        <DateField
          id="device-warranty"
          value={values.warrantyExpirationDate}
          onChange={(next) => onChange("warrantyExpirationDate", next)}
          captionLayout="dropdown"
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
    <div className="grid gap-x-3 md:grid-cols-2">
      <Field
        label="Имя устройства"
        htmlFor="device-hostname"
        hint={
          mikrotikMode
            ? "Остальное заполнится с устройства при подключении к мониторингу."
            : undefined
        }
      >
        <Input
          id="device-hostname"
          value={values.hostname}
          onChange={(event) => onChange("hostname", event.target.value)}
          placeholder="PC-01"
          className="font-mono"
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
        <div className="grid gap-x-3 md:grid-cols-2">
          <Field label="IP-адрес" htmlFor="device-ip">
            <Input
              id="device-ip"
              value={values.ipAddress}
              onChange={(event) => onChange("ipAddress", event.target.value)}
              placeholder="192.168.1.100"
              className="font-mono"
            />
          </Field>
          <Field label="MAC-адрес" htmlFor="device-mac">
            <Input
              id="device-mac"
              value={values.macAddress}
              onChange={(event) => onChange("macAddress", event.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="font-mono"
            />
          </Field>
        </div>
        <div className="grid gap-x-3 md:grid-cols-2">
          <Field label="Последнее обслуживание" htmlFor="device-maintenance">
            <DateField
              id="device-maintenance"
              value={values.lastMaintenanceDate}
              onChange={(next) => onChange("lastMaintenanceDate", next)}
              captionLayout="dropdown"
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
