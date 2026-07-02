import { useState, useEffect, useMemo } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Stack from "react-bootstrap/Stack";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import ToggleButton from "react-bootstrap/ToggleButton";
import Container from "react-bootstrap/Container";
import Spinner from "react-bootstrap/Spinner";

import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";

import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiSaveLine,
  RiArrowGoBackFill,
} from "react-icons/ri";

import Select from "../../UI/Select";
import AlertMessage from "../../UI/AlertMessage";
import useOffcanvasStore from "../../store/offcanvas";
import { getLocalStorageData } from "../../util/auth";

import WizardStepper from "./WizardStepper";
import PurchaseFields from "./PurchaseFields";
import TechFields from "./TechFields";
import InlineCreateModal from "./InlineCreateModal";
import ComponentsFields from "./ComponentsFields";
import { fetchAttachableDevices } from "./attachable";
import ModelChainFields from "./ModelChainFields";
import SelectWithAdd from "./SelectWithAdd";
import DeviceSummary from "./DeviceSummary";
import useAssignableUsers, { userOptionLabel } from "./useAssignableUsers";

const STATUS_OPTIONS = [
  { value: "readyForDeployment", label: "Готово к выдаче" },
  { value: "deployed", label: "Выдано" },
  { value: "inRepair", label: "В ремонте" },
  { value: "inReserve", label: "В резерве" },
  { value: "decommissioned", label: "Выведено из эксплуатации" },
  { value: "disposed", label: "Утилизировано" },
];

const STEPS = [
  { label: "Компания" },
  { label: "Устройство" },
  { label: "Покупка" },
  { label: "Тех. инфо" },
];

const LAST_STEP = STEPS.length - 1;
const PURCHASE_STEP = 2;

// Поля устройства, отправляемые на сервер. Вендор — только навигация (нужен для
// выбора модели); тип отправляется для самосборных устройств без модели.
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

// Сообщение об ошибке шага зависит от вида устройства (custom требует только тип)
// и от статуса (Выдано требует пользователя).
const stepError = (index, deviceKind, form) => {
  if (index === 0) return "Выберите компанию";
  if (index === 1) {
    const base =
      deviceKind === "custom"
        ? !form.deviceTypeId && "Выберите тип устройства"
        : (!form.deviceTypeId || !form.vendorId || !form.deviceModelId) &&
          "Заполните тип, вендора и модель";
    if (base) return base;
    if (form.status === "deployed" && !form.userId)
      return "Выберите пользователя (статус «Выдано»)";
  }
  return null;
};

// ISO date -> "yyyy-MM-dd" для <input type="date">.
const toDateInput = (date) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

// Ссылка может прийти populated ({_id}) или сырым id.
const refId = (value) => value?._id || value || "";

const findOption = (options, value) =>
  options.find((option) => option.value === value) || null;

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

const ClientDeviceForm = ({ title }) => {
  const data = useLoaderData();
  const isEdit = !!data?._id;

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

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

  // Вид устройства: "branded" (тип+вендор+модель) или "custom" (самосборка —
  // только тип). На редактировании выводим из наличия модели/типа.
  const [deviceKind, setDeviceKind] = useState(
    data?.deviceModelId ? "branded" : data?.deviceTypeId ? "custom" : "branded",
  );

  // Состав сборки. Загруженные комплектующие — уже существующие устройства,
  // привязанные к хосту: в форме их можно только открепить (редактируются на
  // своей странице). Новые позиции добавляются ниже и создаются при сохранении.
  // _attached помечает прикреплённое существующее устройство, _orig хранит его
  // populated-объект для отображения.
  const [components, setComponents] = useState(
    (data?.components || []).map((c) => ({
      _id: c._id,
      _attached: true,
      _orig: c,
    })),
  );
  // Свободные устройства, доступные для прикрепления (зависят от компании/типа).
  const [attachableDevices, setAttachableDevices] = useState([]);
  // Страхует от повторного запуска финализации (синхронизации компонентов).
  const [finalizing, setFinalizing] = useState(false);

  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [deviceModels, setDeviceModels] = useState([]);
  const [configurations, setConfigurations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST_STEP : 0);
  const [attempted, setAttempted] = useState(false);
  const [inlineKind, setInlineKind] = useState(null);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  // Кандидаты на пользователя по правилам расположения (рабочее место →
  // назначенный сотрудник; подразделение → его сотрудники + руководитель;
  // иначе — вся компания).
  const {
    users: assignableUsers,
    defaultUserId: assignDefaultUserId,
    single: assignSingle,
  } = useAssignableUsers(form.locationId, form.companyId);

  // Загрузка справочников (расположения грузим отдельно — они зависят от компании).
  useEffect(() => {
    const fetchReferenceData = async () => {
      setLoading(true);
      const { token } = getLocalStorageData();
      const headers = { Authorization: "Bearer " + token };
      const base = import.meta.env.VITE_API_ADDRESS;

      try {
        const responses = await Promise.all([
          fetch(`${base}/api/companies`, { headers }),
          fetch(`${base}/api/inventory/device-types`, { headers }),
          fetch(`${base}/api/inventory/vendors`, { headers }),
          fetch(`${base}/api/inventory/device-models`, { headers }),
          fetch(`${base}/api/inventory/suppliers`, { headers }),
        ]);

        const [
          companiesData,
          typesData,
          vendorsData,
          modelsData,
          suppliersData,
        ] = await Promise.all(responses.map((r) => r.json()));

        setCompanies(Array.isArray(companiesData) ? companiesData : []);
        setDeviceTypes(Array.isArray(typesData) ? typesData : []);
        setVendors(Array.isArray(vendorsData) ? vendorsData : []);
        setDeviceModels(Array.isArray(modelsData) ? modelsData : []);
        setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
      } catch (error) {
        console.error("Error fetching reference data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchReferenceData();
  }, []);

  // Расположения выбранной компании. Бэкенд фильтрует по companyIds; без
  // компании список пуст. При смене компании подгружаем заново (см. также
  // handleCompanyChange — он сбрасывает выбранное расположение).
  useEffect(() => {
    if (!form.companyId) {
      setLocations([]);
      return;
    }

    const fetchLocations = async () => {
      const { token } = getLocalStorageData();
      const headers = { Authorization: "Bearer " + token };
      const base = import.meta.env.VITE_API_ADDRESS;

      try {
        const response = await fetch(
          `${base}/api/inventory/companies-locations?companyIds=${form.companyId}`,
          { headers },
        );
        const data = await response.json();
        setLocations(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching locations:", error);
        setLocations([]);
      }
    };

    fetchLocations();
  }, [form.companyId]);

  // Конфигурации выбранной модели (заводская сборка). Без модели — список пуст.
  useEffect(() => {
    if (!form.deviceModelId) {
      setConfigurations([]);
      return;
    }

    const fetchConfigurations = async () => {
      const { token } = getLocalStorageData();
      const headers = { Authorization: "Bearer " + token };
      const base = import.meta.env.VITE_API_ADDRESS;

      try {
        const response = await fetch(
          `${base}/api/inventory/device-configurations/model/${form.deviceModelId}`,
          { headers },
        );
        const data = await response.json();
        setConfigurations(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching configurations:", error);
        setConfigurations([]);
      }
    };

    fetchConfigurations();
  }, [form.deviceModelId]);

  // Свободные устройства-комплектующие для прикрепления: зависят от компании и
  // типа хоста (для ограничения attachableToTypeIds). На редактировании
  // исключаем само устройство.
  useEffect(() => {
    if (!form.companyId) {
      setAttachableDevices([]);
      return;
    }
    let cancelled = false;
    fetchAttachableDevices({
      companyId: form.companyId,
      excludeId: data?._id,
      hostTypeId: form.deviceTypeId,
    }).then((list) => {
      if (!cancelled) setAttachableDevices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, form.deviceTypeId, data?._id]);

  // Тело запроса для НОВОГО компонента (создаётся как дочерний ClientDevice).
  // Компания/расположение/пользователь наследуются от родителя на сервере;
  // статус проставляем как у хоста — комплектующее «следует за хостом».
  const buildComponentBody = (comp, parentId) => ({
    companyId: form.companyId,
    parentDeviceId: parentId,
    // модель ИЛИ тип: при выбранной модели тип берётся из неё на сервере
    deviceModelId: comp.deviceModelId || "",
    deviceTypeId: comp.deviceModelId ? "" : comp.deviceTypeId || "",
    serialNumber: comp.serialNumber || "",
    quantity: comp.quantity || 1,
    purchasedAt: comp.purchasedAt || "",
    price: comp.price ?? "",
    purchaseDocument: comp.purchaseDocument || "",
    supplierId: comp.supplierId || "",
    warrantyExpirationDate: comp.warrantyExpirationDate || "",
    status: form.status || "",
  });

  // Применяем состав сборки после сохранения хоста: открепляем убранные, цепляем
  // новые существующие устройства, создаём новые позиции. Работает для обеих
  // сборок. Открепление НЕ удаляет устройство — оно возвращается в общий список
  // как «Готово к выдаче».
  const syncComponents = async (parentId) => {
    const { token } = getLocalStorageData();
    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };
    const apiBase = import.meta.env.VITE_API_ADDRESS;

    const originalIds = (data?.components || []).map((c) => String(c._id));
    const currentIds = new Set(
      components.filter((c) => c._id).map((c) => String(c._id)),
    );

    // Открепляем убранные (было привязано, теперь нет в списке).
    for (const origId of originalIds) {
      if (!currentIds.has(origId)) {
        await fetch(
          `${apiBase}/api/inventory/client-devices/${parentId}/components/${origId}`,
          { method: "DELETE", headers },
        );
      }
    }

    for (const comp of components) {
      if (comp._id) {
        // Прикрепляем только новые (ранее не привязанные) существующие устройства.
        if (!originalIds.includes(String(comp._id))) {
          await fetch(
            `${apiBase}/api/inventory/client-devices/${parentId}/components`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ componentId: comp._id }),
            },
          );
        }
        continue;
      }
      // Новая позиция: создаём дочернее устройство (пропускаем пустые строки).
      if (!comp.deviceTypeId && !comp.deviceModelId) continue;
      await fetch(`${apiBase}/api/inventory/client-devices/add`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildComponentBody(comp, parentId)),
      });
    }
  };

  // Успешный сабмит — синхронизируем комплектующие, затем закрываем offcanvas и
  // возвращаемся к списку.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.error) return;
    if (finalizing) return;

    const savedId =
      fetcher.data?.clientDevice?._id || fetcher.data?.device?._id || data?._id;

    const finalize = async () => {
      setFinalizing(true);
      try {
        if (savedId) await syncComponents(savedId);
      } catch (error) {
        console.error("Не удалось сохранить комплектующие:", error);
      }
      offcanvas.setClose();
      navigate("..");
    };

    finalize();
  }, [fetcher.state, fetcher.data]);

  // --- options ---
  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        value: company._id,
        label: company.alias || company.fullTitle,
      })),
    [companies],
  );

  // Список уже отфильтрован по выбранной компании — суффикс с алиасом не нужен.
  const locationOptions = useMemo(
    () =>
      locations.map((location) => ({
        value: location._id,
        label: location.name,
      })),
    [locations],
  );

  const typeOptions = useMemo(
    () => deviceTypes.map((type) => ({ value: type._id, label: type.name })),
    [deviceTypes],
  );

  // Конфигурации модели → опции (имя или собранная из значений строка).
  const configOptions = useMemo(
    () =>
      configurations.map((c) => ({
        value: c._id,
        label:
          c.name ||
          (c.values || [])
            .map(
              (v) =>
                `${v.attributeId?.name || v.attributeId?.code || "—"}: ${v.value}`,
            )
            .join(", ") ||
          "Конфигурация",
      })),
    [configurations],
  );

  const userOptions = useMemo(
    () =>
      assignableUsers.map((u) => ({
        value: u._id,
        label: userOptionLabel(u),
      })),
    [assignableUsers],
  );

  // Статус «Выдано»: если текущий выбор не из списка кандидатов — ставим дефолт
  // (назначенный сотрудник рабочего места / руководитель подразделения). Пока
  // список не загружен (пуст), ничего не трогаем — иначе на редактировании
  // затрём уже сохранённого пользователя во время асинхронной загрузки.
  useEffect(() => {
    if (form.status !== "deployed") return;
    if (assignableUsers.length === 0) return;
    setForm((prev) => {
      const ids = new Set(assignableUsers.map((u) => u._id));
      if (prev.userId && ids.has(prev.userId)) return prev;
      const next = assignSingle ? assignableUsers[0]._id : assignDefaultUserId || "";
      return next === prev.userId ? prev : { ...prev, userId: next };
    });
  }, [assignableUsers, assignDefaultUserId, assignSingle, form.status]);

  // Типы-комплектующие (комплектующие/расходники/периферия). Если у типа задан
  // attachableToTypeIds, показываем его только для подходящего родительского
  // типа; пустой список — совместим со всеми.
  const componentTypes = useMemo(
    () =>
      deviceTypes.filter((t) => {
        if (!(t.isComponent || t.isConsumable || t.isPeripheral)) return false;
        const attachable = t.attachableToTypeIds || [];
        if (attachable.length === 0) return true;
        return attachable.some((a) => (a?._id || a) === form.deviceTypeId);
      }),
    [deviceTypes, form.deviceTypeId],
  );

  // --- каскадные сбросы ---
  // Расположение зависит от компании — при смене компании сбрасываем его.
  // Смена компании сбрасывает расположение и пользователя (они привязаны к ней).
  const handleCompanyChange = (value) =>
    setForm((prev) => ({
      ...prev,
      companyId: value,
      locationId: "",
      userId: "",
    }));

  // custom-ветка: одиночный select типа (модель там не используется).
  const handleTypeChange = (value) =>
    setForm((prev) => ({ ...prev, deviceTypeId: value, deviceModelId: "" }));

  // При переходе на самосборку чистим вендора, модель и конфигурацию (они там
  // бессмысленны — конфигурации привязаны к модели).
  const handleKindChange = (kind) => {
    setDeviceKind(kind);
    if (kind === "custom") {
      setForm((prev) => ({
        ...prev,
        vendorId: "",
        deviceModelId: "",
        configurationId: "",
      }));
    }
  };

  // --- инлайн-создание справочников ---
  // Тип, созданный из одиночного селекта custom-ветки.
  const handleTypeCreated = (type) => {
    setDeviceTypes((prev) => [...prev, type]);
    setForm((prev) => ({ ...prev, deviceTypeId: type._id, deviceModelId: "" }));
  };

  // Новые тип/вендор/модель из ModelChainFields (branded-ветка мастера и карточки
  // компонентов) — пополняем общие массивы; выбор делает сам ModelChainFields.
  const handleResourceCreated = (kind, entity) => {
    if (kind === "deviceType") setDeviceTypes((prev) => [...prev, entity]);
    else if (kind === "vendor") setVendors((prev) => [...prev, entity]);
    else if (kind === "deviceModel")
      setDeviceModels((prev) => [...prev, entity]);
  };

  const handleSupplierCreated = (supplier) =>
    setSuppliers((prev) => [...prev, supplier]);

  const handleLocationCreated = (location) => {
    setLocations((prev) => [...prev, location]);
    setField("locationId", location._id);
  };

  // --- валидация шагов ---
  const stepValid = (index) => {
    switch (index) {
      case 0:
        return !!form.companyId;
      case 1: {
        // Серийник больше не обязателен ни в одной ветке.
        const baseValid =
          deviceKind === "custom"
            ? !!form.deviceTypeId
            : !!form.deviceTypeId && !!form.vendorId && !!form.deviceModelId;
        // Статус «Выдано» требует выбранного пользователя.
        return baseValid && (form.status !== "deployed" || !!form.userId);
      }
      default:
        return true;
    }
  };

  // --- навигация ---
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
    setMaxReached((prev) => Math.max(prev, next));
  };

  const handleBack = () => {
    setAttempted(false);
    setStep((s) => Math.max(0, s - 1));
  };

  const handleStepClick = (index) => {
    if (isEdit || index <= maxReached) goToStep(index);
  };

  const handleClose = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    // Нормализуем поля ветки: custom не шлёт модель, branded — прямой тип
    // (тип берётся из модели на сервере). Иначе залипшие поля уедут на бэк.
    const payload = { ...form };
    if (deviceKind === "custom") {
      payload.deviceModelId = "";
      // конфигурации привязаны к модели — у самосборки их нет
      payload.configurationId = "";
    } else {
      payload.deviceTypeId = "";
    }

    const formData = new FormData();
    SUBMIT_FIELDS.forEach((field) =>
      formData.append(field, payload[field] ?? ""),
    );
    fetcher.submit(formData, { method: "post" });
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Компания и расположение</h6>
            </Card.Header>
            <Card.Body>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="companyId">
                  Компания <span className="text-danger">*</span>
                </Form.Label>
                <Select
                  id="companyId"
                  placeholder="Выберите компанию"
                  options={companyOptions}
                  value={findOption(companyOptions, form.companyId)}
                  onChange={(o) => handleCompanyChange(o ? o.value : "")}
                  isClearable
                  autoFocus
                />
              </Form.Group>
              <Form.Group className="mb-0">
                <Form.Label htmlFor="locationId">Расположение</Form.Label>
                <SelectWithAdd
                  id="locationId"
                  placeholder={
                    form.companyId
                      ? "Выберите расположение"
                      : "Сначала выберите компанию"
                  }
                  options={locationOptions}
                  value={findOption(locationOptions, form.locationId)}
                  onChange={(o) => setField("locationId", o ? o.value : "")}
                  isDisabled={!form.companyId}
                  isClearable
                  addTitle="Добавить расположение"
                  onAdd={() => setInlineKind("location")}
                  addDisabled={!form.companyId}
                />
              </Form.Group>
            </Card.Body>
          </Card>
        );

      case 1:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Устройство</h6>
            </Card.Header>
            <Card.Body>
              <ButtonGroup className="mb-3 w-100">
                <ToggleButton
                  id="kind-branded"
                  type="radio"
                  variant="outline-primary"
                  name="deviceKind"
                  value="branded"
                  checked={deviceKind === "branded"}
                  onChange={() => handleKindChange("branded")}
                >
                  Заводская сборка
                </ToggleButton>
                <ToggleButton
                  id="kind-custom"
                  type="radio"
                  variant="outline-primary"
                  name="deviceKind"
                  value="custom"
                  checked={deviceKind === "custom"}
                  onChange={() => handleKindChange("custom")}
                >
                  Кастомная сборка
                </ToggleButton>
              </ButtonGroup>

              {deviceKind === "branded" ? (
                <>
                  <ModelChainFields
                    value={{
                      deviceTypeId: form.deviceTypeId,
                      vendorId: form.vendorId,
                      deviceModelId: form.deviceModelId,
                    }}
                    onChange={(partial) =>
                      setForm((prev) => ({
                        ...prev,
                        ...partial,
                        // смена модели/типа/вендора сбрасывает конфигурацию
                        ...("deviceModelId" in partial
                          ? { configurationId: "" }
                          : {}),
                      }))
                    }
                    deviceTypes={deviceTypes}
                    vendors={vendors}
                    deviceModels={deviceModels}
                    onResourceCreated={handleResourceCreated}
                    modelRequired
                    autoFocusType
                    idPrefix="device"
                  />
                  {form.deviceModelId && (
                    <Form.Group className="mt-3 mb-0">
                      <Form.Label htmlFor="configurationId">
                        Конфигурация
                      </Form.Label>
                      <Select
                        id="configurationId"
                        placeholder={
                          configOptions.length
                            ? "Выберите конфигурацию"
                            : "У модели нет конфигураций"
                        }
                        options={configOptions}
                        value={findOption(configOptions, form.configurationId)}
                        onChange={(o) =>
                          setField("configurationId", o ? o.value : "")
                        }
                        isClearable
                        isDisabled={!configOptions.length}
                        noOptionsMessage={() => "У модели нет конфигураций"}
                      />
                      <Form.Text className="text-muted">
                        {configOptions.length
                          ? "Набор характеристик модели (ОЗУ, CPU, накопитель…)."
                          : "У этой модели нет конфигураций — добавьте их на странице модели."}
                      </Form.Text>
                    </Form.Group>
                  )}
                </>
              ) : (
                <>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="deviceTypeId">
                      Тип устройства <span className="text-danger">*</span>
                    </Form.Label>
                    <SelectWithAdd
                      id="deviceTypeId"
                      placeholder="Выберите тип"
                      options={typeOptions}
                      value={findOption(typeOptions, form.deviceTypeId)}
                      onChange={(o) => handleTypeChange(o ? o.value : "")}
                      isClearable
                      autoFocus
                      addTitle="Добавить тип"
                      onAdd={() => setInlineKind("deviceType")}
                    />
                  </Form.Group>
                  <p className="text-muted small">
                    Самосборная техника: вендор и модель не указываются.
                    Идентификатор — инвентарный номер (сгенерируется
                    автоматически, если оставить поле пустым).
                  </p>
                </>
              )}

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3 mb-md-0">
                    <Form.Label htmlFor="inventoryNumber">
                      Инвентарный номер
                    </Form.Label>
                    <Form.Control
                      id="inventoryNumber"
                      name="inventoryNumber"
                      type="text"
                      placeholder="Автоматически, если оставить пустым"
                      value={form.inventoryNumber}
                      onChange={(e) =>
                        setField("inventoryNumber", e.target.value)
                      }
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-0">
                    <Form.Label htmlFor="serialNumber">
                      Серийный номер
                    </Form.Label>
                    <Form.Control
                      id="serialNumber"
                      name="serialNumber"
                      type="text"
                      placeholder="Введите серийный номер"
                      value={form.serialNumber}
                      onChange={(e) => setField("serialNumber", e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mt-3 mb-0">
                <Form.Label htmlFor="status">Статус</Form.Label>
                <Select
                  id="status"
                  placeholder="Выберите статус"
                  options={STATUS_OPTIONS}
                  value={findOption(STATUS_OPTIONS, form.status)}
                  onChange={(o) => {
                    const value = o ? o.value : "readyForDeployment";
                    setForm((prev) => ({
                      ...prev,
                      status: value,
                      // вне «Выдано» пользователь не привязывается
                      ...(value !== "deployed" ? { userId: "" } : {}),
                    }));
                  }}
                  isClearable={false}
                />
              </Form.Group>

              {form.status === "deployed" && (
                <Form.Group className="mt-3 mb-0">
                  <Form.Label htmlFor="userId">
                    Пользователь <span className="text-danger">*</span>
                  </Form.Label>
                  <Select
                    id="userId"
                    placeholder={
                      form.companyId
                        ? "Выберите пользователя"
                        : "Сначала выберите компанию"
                    }
                    options={userOptions}
                    value={findOption(userOptions, form.userId)}
                    onChange={(o) => setField("userId", o ? o.value : "")}
                    isClearable
                    isDisabled={!form.companyId}
                    noOptionsMessage={() => "Нет пользователей в компании"}
                  />
                </Form.Group>
              )}

              <ComponentsFields
                value={components}
                onChange={setComponents}
                componentTypes={componentTypes}
                deviceTypes={deviceTypes}
                vendors={vendors}
                deviceModels={deviceModels}
                suppliers={suppliers}
                attachableDevices={attachableDevices}
                onResourceCreated={handleResourceCreated}
                onSupplierCreated={handleSupplierCreated}
              />
            </Card.Body>
          </Card>
        );

      case 2:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Покупка</h6>
              <small className="text-muted">Необязательный блок</small>
            </Card.Header>
            <Card.Body>
              <PurchaseFields
                values={form}
                onChange={setField}
                suppliers={suppliers}
                onSupplierCreated={handleSupplierCreated}
              />
            </Card.Body>
          </Card>
        );

      case 3:
        return (
          <Card>
            <Card.Header>
              <h6 className="mb-0">Техническая информация</h6>
              <small className="text-muted">Необязательный блок</small>
            </Card.Header>
            <Card.Body>
              <TechFields values={form} onChange={setField} />
            </Card.Body>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Container className="text-center py-5">
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container>
      <h1>{title}</h1>
      <hr />

      <WizardStepper
        steps={STEPS}
        currentStep={step}
        maxReached={maxReached}
        allowJump={isEdit}
        onStepClick={handleStepClick}
      />

      {fetcher.data && fetcher.data.error && (
        <AlertMessage variant="danger" message={fetcher.data.message} />
      )}

      <Row>
        <Col lg={8}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>

          {attempted &&
            !stepValid(step) &&
            stepError(step, deviceKind, form) && (
              <p className="text-danger small mt-2 mb-0">
                {stepError(step, deviceKind, form)}
              </p>
            )}
        </Col>

        <Col lg={4} className="mt-3 mt-lg-0">
          <DeviceSummary
            form={form}
            deviceKind={deviceKind}
            components={components}
            companies={companies}
            locations={locations}
            deviceTypes={deviceTypes}
            vendors={vendors}
            deviceModels={deviceModels}
            suppliers={suppliers}
            configurations={configurations}
            users={assignableUsers}
          />
        </Col>
      </Row>

      <hr />
      <Stack direction="horizontal" gap={2}>
        <Button variant="secondary" onClick={handleClose} disabled={saving}>
          <RiArrowGoBackFill /> Закрыть
        </Button>

        <div className="ms-auto d-flex gap-2">
          {step > 0 && (
            <Button
              variant="outline-secondary"
              onClick={handleBack}
              disabled={saving}
            >
              <RiArrowLeftLine /> Назад
            </Button>
          )}

          {step === PURCHASE_STEP && (
            <Button variant="outline-primary" onClick={handleNext}>
              Пропустить
            </Button>
          )}

          {step < LAST_STEP && (
            <Button variant="primary" onClick={handleNext}>
              Далее <RiArrowRightLine />
            </Button>
          )}

          {step === LAST_STEP && (
            <Button variant="primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (
                <Spinner animation="border" size="sm" />
              ) : (
                <>
                  <RiSaveLine /> Сохранить
                </>
              )}
            </Button>
          )}
        </div>
      </Stack>

      <InlineCreateModal
        show={inlineKind === "deviceType"}
        onHide={() => setInlineKind(null)}
        kind="deviceType"
        resources={{ deviceTypes }}
        onCreated={handleTypeCreated}
      />
      <InlineCreateModal
        show={inlineKind === "location"}
        onHide={() => setInlineKind(null)}
        kind="location"
        context={{ companyId: form.companyId }}
        resources={{ companies }}
        onCreated={handleLocationCreated}
      />
    </Container>
  );
};

export default ClientDeviceForm;
