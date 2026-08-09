import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiRouterLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AlertMessage from "@/components/app/AlertMessage";
import { FormHeader, FormSections } from "@/components/app/FormLayout";
import Spinner from "@/components/app/Spinner";
import WizardStepper from "@/components/app/WizardStepper";

import useOffcanvasStore from "../../store/offcanvas";
import { getLocalStorageData } from "../../util/auth";
import {
  DeviceFields,
  PlacementFields,
  PurchaseFields,
  TechFields,
} from "./FormFields";
import FormSummary from "./FormSummary";
import InlineCreateDialog from "./InlineCreateDialog";
import useAssignableUsers, { userOptionLabel } from "./useAssignableUsers";
import { useCan } from "@/store/authed-user";

const STEPS = [
  { key: "device", label: "Устройство" },
  { key: "placement", label: "Размещение" },
  { key: "purchase", label: "Закупка" },
  { key: "tech", label: "Сеть и система" },
];
const LAST_STEP = STEPS.length - 1;

// Поля, уходящие на сервер. Вендор — только навигация (нужен, чтобы выбрать
// модель); тип уходит лишь у самосборки, у заводской он берётся из модели.
const SUBMIT_FIELDS = [
  "companyId",
  "locationId",
  "userId",
  "deviceModelId",
  "configurationId",
  "deviceTypeId",
  "serialNumber",
  "inventoryNumber",
  "status",
  "purchasedAt",
  "price",
  "purchaseDocument",
  "supplierId",
  "warrantyExpirationDate",
  "ipAddress",
  "macAddress",
  "operatingSystem",
  "hostname",
  "lastMaintenanceDate",
  "notes",
];

// ISO date → "yyyy-MM-dd" для <input type="date">. Даты покупки/гарантии —
// КАЛЕНДАРНЫЕ, в БД лежат UTC-полночью, поэтому здесь toISOString корректен
// (читаем обратно тот же UTC-день); toDateInputValue дал бы локальный день и
// сдвинул дату в поясах с отрицательным смещением.
const toDateInput = (value) =>
  value ? new Date(value).toISOString().split("T")[0] : "";

const refId = (value) => value?._id || value || "";

const optionsOf = (items, label = (item) => item.name) =>
  items.map((item) => ({ value: item._id, label: label(item) }));

/**
 * Формы устройства: одно поле — одно место правки, две подачи.
 *
 * **Создание — мастер** (шторка lg): шаги «Устройство → Размещение → Закупка →
 * Сеть и система» + живая сводка справа. **Правка — плоская форма** (шторка xl):
 * те же поля секциями с рейлом, без степпера; ярлык «Изменить» в метке секции
 * карточки открывает её хешем (`update#purchase`).
 *
 * Комплектующих здесь нет намеренно: комплектующее — отдельная единица учёта, и
 * заводить его пачкой внутри чужой формы значило бы сохранять отдельными
 * запросами после сохранения хозяина. Состав ведётся на карточке сборки.
 *
 * Тело уходит JSON-ом (гайд: вложенные данные не собираются из FormData).
 */
const ClientDeviceForm = ({ title }) => {
  const data = useLoaderData();
  const isEdit = Boolean(data?._id);

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const can = useCan();

  const [form, setForm] = useState({
    companyId: refId(data?.companyId),
    locationId: refId(data?.locationId),
    userId: refId(data?.userId),
    deviceTypeId:
      refId(data?.deviceModelId?.deviceTypeId) || refId(data?.deviceTypeId),
    vendorId: refId(data?.deviceModelId?.vendorId),
    deviceModelId: refId(data?.deviceModelId),
    configurationId: refId(data?.configurationId),
    serialNumber: data?.serialNumber || "",
    inventoryNumber: data?.inventoryNumber || "",
    status: data?.status || "readyForDeployment",
    purchasedAt: toDateInput(data?.purchasedAt),
    price: data?.price ?? "",
    purchaseDocument: data?.purchaseDocument || "",
    supplierId: refId(data?.supplierId),
    warrantyExpirationDate: toDateInput(data?.warrantyExpirationDate),
    lastMaintenanceDate: toDateInput(data?.lastMaintenanceDate),
    ipAddress: data?.ipAddress || "",
    macAddress: data?.macAddress || "",
    operatingSystem: data?.operatingSystem || "",
    hostname: data?.hostname || "",
    notes: data?.notes || "",
  });

  // Вид сборки: заводская (тип + вендор + модель) или своя (только тип).
  const [deviceKind, setDeviceKind] = useState(
    data?.deviceModelId ? "branded" : data?.deviceTypeId ? "custom" : "branded",
  );

  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [deviceModels, setDeviceModels] = useState([]);
  const [configurations, setConfigurations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [inlineKind, setInlineKind] = useState(null);
  const [headHeight, setHeadHeight] = useState(0);
  // Устройства с таким же серийником — предупреждение, а не запрет
  const [serialMatches, setSerialMatches] = useState([]);
  // id созданного устройства, которому предложено подключение к мониторингу
  const [connectOffer, setConnectOffer] = useState(null);

  const setField = (name, value) =>
    setForm((previous) => ({ ...previous, [name]: value }));

  const { users: assignableUsers, defaultUserId } = useAssignableUsers(
    form.locationId,
    form.companyId,
  );

  // Справочники: компании, типы, вендоры, модели, поставщики.
  useEffect(() => {
    const { token } = getLocalStorageData();
    const headers = { Authorization: "Bearer " + token };
    const base = import.meta.env.VITE_API_ADDRESS;
    let cancelled = false;

    (async () => {
      try {
        const responses = await Promise.all([
          fetch(`${base}/api/companies`, { headers }),
          fetch(`${base}/api/inventory/device-types`, { headers }),
          fetch(`${base}/api/inventory/vendors`, { headers }),
          fetch(`${base}/api/inventory/device-models`, { headers }),
          fetch(`${base}/api/inventory/suppliers`, { headers }),
        ]);
        const [companyList, typeList, vendorList, modelList, supplierList] =
          await Promise.all(responses.map((response) => response.json()));
        if (cancelled) return;
        setCompanies(Array.isArray(companyList) ? companyList : []);
        setDeviceTypes(Array.isArray(typeList) ? typeList : []);
        setVendors(Array.isArray(vendorList) ? vendorList : []);
        setDeviceModels(Array.isArray(modelList) ? modelList : []);
        setSuppliers(Array.isArray(supplierList) ? supplierList : []);
      } catch (error) {
        console.warn("Справочники формы устройства не загрузились:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Расположения выбранной компании — полным путём (одноимённых комнат у
  // клиента столько же, сколько зданий).
  useEffect(() => {
    if (!form.companyId) {
      setLocations([]);
      return undefined;
    }
    const { token } = getLocalStorageData();
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?companyIds=${form.companyId}`,
      { headers: { Authorization: "Bearer " + token } },
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        if (!cancelled) setLocations(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  // Конфигурации выбранной модели.
  useEffect(() => {
    if (!form.deviceModelId) {
      setConfigurations([]);
      return undefined;
    }
    const { token } = getLocalStorageData();
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/model/${form.deviceModelId}`,
      { headers: { Authorization: "Bearer " + token } },
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        if (!cancelled) setConfigurations(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setConfigurations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.deviceModelId]);

  // Пользователь по умолчанию: у рабочего места это его сотрудник.
  useEffect(() => {
    if (form.status !== "deployed" || form.userId || !defaultUserId) return;
    setField("userId", defaultUserId);
  }, [form.status, form.userId, defaultUserId]);

  // Серийный номер не уникален (партии с одинаковым номером — обычное дело),
  // но повтор стоит показать: вдруг устройство уже заводили. Спрашиваем с
  // задержкой, как поиск списка.
  useEffect(() => {
    const value = form.serialNumber.trim();
    if (!value) {
      setSerialMatches([]);
      return undefined;
    }
    const { token } = getLocalStorageData();
    const timer = setTimeout(() => {
      const url = new URL(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/serial-check`,
        window.location.origin,
      );
      url.searchParams.set("value", value);
      if (data?._id) url.searchParams.set("excludeId", data._id);
      fetch(url, { headers: { Authorization: "Bearer " + token } })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => setSerialMatches(result?.matches || []))
        .catch(() => setSerialMatches([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [form.serialNumber, data?._id]);

  const isMikrotikVendor =
    deviceKind === "branded" &&
    Boolean(
      vendors.find((vendor) => vendor._id === form.vendorId)
        ?.isMikrotikManagementEnabled,
    );

  // --- опции полей ---
  const locationOptions = useMemo(
    () =>
      locations.map((location) => ({
        value: location._id,
        label: location.fullPath || location.name,
      })),
    [locations],
  );
  const modelOptions = useMemo(
    () =>
      optionsOf(
        deviceModels.filter(
          (model) =>
            (!form.deviceTypeId ||
              refId(model.deviceTypeId) === form.deviceTypeId) &&
            (!form.vendorId || refId(model.vendorId) === form.vendorId),
        ),
      ),
    [deviceModels, form.deviceTypeId, form.vendorId],
  );
  const options = {
    companies: useMemo(
      () =>
        optionsOf(companies, (company) => company.alias || company.fullTitle),
      [companies],
    ),
    locations: locationOptions,
    deviceTypes: useMemo(() => optionsOf(deviceTypes), [deviceTypes]),
    vendors: useMemo(() => optionsOf(vendors), [vendors]),
    deviceModels: modelOptions,
    configurations: useMemo(
      () =>
        configurations.map((configuration) => ({
          value: configuration._id,
          label:
            configuration.name ||
            (configuration.values || [])
              .map((entry) => entry.value)
              .filter(Boolean)
              .join(" / ") ||
            "Конфигурация",
        })),
      [configurations],
    ),
    suppliers: useMemo(() => optionsOf(suppliers), [suppliers]),
    users: useMemo(
      () =>
        assignableUsers.map((user) => ({
          value: user._id,
          label: userOptionLabel(user),
        })),
      [assignableUsers],
    ),
  };

  const labelOf = (list, value) =>
    list.find((option) => option.value === value)?.label || null;
  const summaryLabels = {
    deviceType: labelOf(options.deviceTypes, form.deviceTypeId),
    vendor: labelOf(options.vendors, form.vendorId),
    model: labelOf(options.deviceModels, form.deviceModelId),
    configuration: labelOf(options.configurations, form.configurationId),
    company: labelOf(options.companies, form.companyId),
    location: labelOf(options.locations, form.locationId),
    user: labelOf(options.users, form.userId),
  };

  // --- валидация: причина стоит у поля ---
  const errorsFor = (index) => {
    const errors = {};
    if (index === 0) {
      if (!form.deviceTypeId) errors.deviceTypeId = "Выберите тип устройства";
      if (deviceKind === "branded") {
        if (!form.vendorId) errors.vendorId = "Выберите производителя";
        if (!form.deviceModelId) errors.deviceModelId = "Выберите модель";
      }
    }
    if (index === 1) {
      if (!form.companyId) errors.companyId = "Выберите компанию";
      if (form.status === "deployed" && !form.userId && !isEdit) {
        errors.userId = "Статус «В эксплуатации» требует сотрудника";
      }
    }
    return errors;
  };
  const stepErrors = attempted ? errorsFor(step) : {};
  const allErrors = { ...errorsFor(0), ...errorsFor(1) };
  const stepValid = (index) => Object.keys(errorsFor(index)).length === 0;

  // --- переходы ---
  const goToStep = (index) => {
    setAttempted(false);
    setStep(index);
  };
  const handleNext = () => {
    if (!stepValid(step)) {
      setAttempted(true);
      return;
    }
    const next = Math.min(step + 1, LAST_STEP);
    setAttempted(false);
    setStep(next);
    setMaxReached((previous) => Math.max(previous, next));
  };
  const handleClose = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  const handleKindChange = (kind) => {
    setDeviceKind(kind);
    // Ветки не смешиваются: у самосборки нет модели и конфигурации.
    setForm((previous) => ({
      ...previous,
      ...(kind === "custom"
        ? { vendorId: "", deviceModelId: "", configurationId: "" }
        : {}),
    }));
  };

  const handleFieldChange = (field, value) => {
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      // Смена компании обнуляет зависимые от неё поля.
      if (field === "companyId") {
        next.locationId = "";
        next.userId = "";
      }
      // Модель определяет конфигурацию; тип и вендор сужают список моделей.
      if (field === "deviceModelId") next.configurationId = "";
      if (field === "deviceTypeId" || field === "vendorId") {
        next.deviceModelId = "";
        next.configurationId = "";
      }
      // Вне «В эксплуатации» сотрудник не привязывается.
      if (field === "status" && value !== "deployed") next.userId = "";
      return next;
    });
  };

  // Созданный справочник сразу подставляется в поле, из которого его завели.
  const handleInlineCreated = (kind, created) => {
    if (!created) return;
    if (kind === "deviceType") {
      setDeviceTypes((previous) => [...previous, created]);
      handleFieldChange("deviceTypeId", created._id);
    }
    if (kind === "vendor") {
      setVendors((previous) => [...previous, created]);
      handleFieldChange("vendorId", created._id);
    }
    if (kind === "deviceModel") {
      setDeviceModels((previous) => [...previous, created]);
      handleFieldChange("deviceModelId", created._id);
    }
    if (kind === "location") {
      setLocations((previous) => [...previous, created]);
      setField("locationId", created._id);
    }
    if (kind === "supplier") {
      setSuppliers((previous) => [...previous, created]);
      setField("supplierId", created._id);
    }
    setInlineKind(null);
  };

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    if (Object.keys(allErrors).length) {
      setAttempted(true);
      setStep(Object.keys(errorsFor(0)).length ? 0 : 1);
      return;
    }
    // Нормализуем ветку: у самосборки нет модели, у заводской тип берётся из
    // модели на сервере — иначе залипшие поля уедут на бэкенд.
    const payload = { ...form };
    if (deviceKind === "custom") {
      payload.deviceModelId = "";
      payload.configurationId = "";
    } else {
      payload.deviceTypeId = "";
    }
    const body = Object.fromEntries(
      SUBMIT_FIELDS.map((field) => [field, payload[field] ?? ""]),
    );
    fetcher.submit(body, { method: "post", encType: "application/json" });
  };

  // Успешный сабмит: у вендора Mikrotik предлагаем подключить мониторинг,
  // иначе — обычный исход (карточка созданной сущности / возврат на карточку).
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.error) return;
    const created = fetcher.data.clientDevice || fetcher.data;
    offcanvas.setClose();
    if (!isEdit && isMikrotikVendor && created?._id) {
      setConnectOffer(created._id);
      return;
    }
    navigate(
      !isEdit && created?._id
        ? `/inventory/client-devices/${created._id}`
        : "..",
      { replace: true },
    );
  }, [fetcher.state, fetcher.data]);

  const inlineResources = { companies, deviceTypes, vendors, deviceModels };
  const inlineContext = {
    companyId: form.companyId,
    deviceTypeId: form.deviceTypeId,
    vendorId: form.vendorId,
  };

  const fieldProps = {
    values: form,
    onChange: handleFieldChange,
    options,
    onInlineCreate: setInlineKind,
  };

  if (loading) return <Spinner className="min-h-64" />;

  const deviceStep = (
    <DeviceFields
      {...fieldProps}
      deviceKind={deviceKind}
      onKindChange={handleKindChange}
      errors={stepErrors}
      serialMatches={serialMatches}
    />
  );
  const placementStep = (
    <PlacementFields
      {...fieldProps}
      errors={stepErrors}
      showAssignee={!isEdit}
    />
  );
  const purchaseStep = <PurchaseFields {...fieldProps} />;
  const techStep = (
    <TechFields {...fieldProps} mikrotikMode={isMikrotikVendor} />
  );

  const errorAlert = fetcher.data?.error && (
    <AlertMessage variant="danger" message={fetcher.data.message} />
  );

  // ── Правка: плоские секции с рейлом ──
  if (isEdit) {
    return (
      <>
        <FormHeader title={title} onHeight={setHeadHeight} />
        {errorAlert}
        <FormSections
          headHeight={headHeight}
          sections={[
            { key: "device", title: "Устройство", body: deviceStep },
            { key: "placement", title: "Размещение", body: placementStep },
            {
              key: "purchase",
              title: "Закупка и гарантия",
              body: purchaseStep,
            },
            { key: "tech", title: "Сеть и система", body: techStep },
          ]}
        />
        <div className="sticky bottom-0 -mx-6 mt-6 flex items-center justify-end gap-2.5 border-t border-border-soft bg-background px-6 py-3">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
        <InlineCreateDialog
          open={Boolean(inlineKind)}
          onOpenChange={(open) => !open && setInlineKind(null)}
          kind={inlineKind || "vendor"}
          context={inlineContext}
          resources={inlineResources}
          onCreated={(created) => handleInlineCreated(inlineKind, created)}
        />
      </>
    );
  }

  // ── Создание: мастер со сводкой ──
  return (
    <>
      <h1 className="my-0 mb-4 pr-10 text-2xl font-semibold tracking-tight">
        {title}
      </h1>

      <WizardStepper
        steps={STEPS}
        current={step}
        maxReached={maxReached}
        onStepClick={goToStep}
      />

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 flex-1">
          {step === 0 && deviceStep}
          {step === 1 && placementStep}
          {step === 2 && purchaseStep}
          {step === 3 && techStep}
        </div>
        <div className="md:w-72 md:flex-none">
          <FormSummary
            form={form}
            deviceKind={deviceKind}
            labels={summaryLabels}
          />
        </div>
      </div>

      {errorAlert && <div className="mt-4">{errorAlert}</div>}

      <div className="sticky bottom-0 -mx-6 mt-6 flex items-center gap-2.5 border-t border-border-soft bg-background px-6 py-3">
        <Button variant="ghost" onClick={handleClose} disabled={saving}>
          Отмена
        </Button>
        <div className="ms-auto flex gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => goToStep(step - 1)}
              disabled={saving}
            >
              <RiArrowLeftLine /> Назад
            </Button>
          )}
          {step < LAST_STEP ? (
            <Button onClick={handleNext}>
              Далее <RiArrowRightLine />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </Button>
          )}
        </div>
      </div>

      <InlineCreateDialog
        open={Boolean(inlineKind)}
        onOpenChange={(open) => !open && setInlineKind(null)}
        kind={inlineKind || "vendor"}
        context={inlineContext}
        resources={inlineResources}
        onCreated={(created) => handleInlineCreated(inlineKind, created)}
      />

      {/* Оффер подключения — только у вендора с управлением Mikrotik */}
      <Dialog
        open={Boolean(connectOffer)}
        onOpenChange={(open) => {
          if (open) return;
          const id = connectOffer;
          setConnectOffer(null);
          navigate(`/inventory/client-devices/${id}`, { replace: true });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Подключить к мониторингу?</DialogTitle>
            <DialogDescription>
              Устройство сохранено. Mikrotik умеет отдавать серийный номер,
              прошивку и адреса сам — подключим сейчас?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                const id = connectOffer;
                setConnectOffer(null);
                navigate(`/inventory/client-devices/${id}`, { replace: true });
              }}
            >
              Позже
            </Button>
            <Button
              disabled={!can({ mikrotik: ["manageDevices"] })}
              onClick={() =>
                navigate(`/devices/mikrotik/add?clientDeviceId=${connectOffer}`)
              }
            >
              <RiRouterLine /> Подключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ClientDeviceForm;
