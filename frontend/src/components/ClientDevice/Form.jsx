import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

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
import {
  FormActions,
  FormHeader,
  FormSections,
} from "@/components/app/FormLayout";
import WizardStepper from "@/components/app/WizardStepper";
import { liveAssembly } from "@/components/app/assembly-specs";
import { specSummary } from "@/components/app/spec-sheet";
import { load } from "@/store/form-data";
import { toDayKey } from "@/components/app/date-value";
import { visibleOptions } from "@/util/hidden-options";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { useFormSheet } from "@/components/app/FormOutlet";
import {
  DeviceFields,
  PlacementFields,
  PurchaseFields,
  TechFields,
} from "./FormFields";
import FormSummary from "./FormSummary";
import PartsStep from "./PartsStep";
import {
  buildSummary,
  manualUnits,
  partsBody,
  unitsFromBuild,
} from "./device-parts";
import { slotGaps } from "../DeviceBuild/part-models";
import {
  useModelConfigurations,
  useModelIndex,
} from "../DeviceBuild/part-pickers";
import InlineCreateDialog from "./InlineCreateDialog";
import { configFieldMode } from "./model-config";
import useAssignableUsers, { userOptionLabel } from "./useAssignableUsers";
import { useCan } from "@/store/authed-user";

const STEPS = [
  { key: "device", label: "Устройство" },
  { key: "placement", label: "Размещение" },
  { key: "purchase", label: "Закупка" },
  { key: "tech", label: "Сеть и система" },
];
// Шаг «Комплектующие» — вторым, только при создании ПК своей сборки типа с
// комплектующими (при правке детали правятся с карточки ПК)
const PARTS_STEP = { key: "parts", label: "Комплектующие" };
const STEPS_WITH_PARTS = [STEPS[0], PARTS_STEP, ...STEPS.slice(1)];

// Значение поля «Сборка» «Без сборки — комплектующие вручную»
const MANUAL_BUILD = "manual";

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

// ISO date → "yyyy-MM-dd" для app/DateField. Даты покупки/гарантии —
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
 * Сеть и система» + живая сводка справа; у своей сборки типа с комплектующими
 * вторым встаёт шаг «Комплектующие». **Правка — плоская форма** (шторка xl):
 * те же поля секциями с рейлом, без степпера; ярлык «Изменить» в метке секции
 * карточки открывает её хешем (`update#purchase`).
 *
 * Комплектующие заводятся вместе с новым ПК своей сборки (поле «Сборка» и шаг
 * «Комплектующие»): ПК и все его детали сервер создаёт одним запросом
 * (`buildId`, `parts`), каждая деталь — отдельным устройством в составе ПК.
 * При правке шага нет и `buildId` не уходит: состав ведётся на карточке ПК.
 *
 * Тело уходит JSON-ом (гайд: вложенные данные не собираются из FormData).
 */
const ClientDeviceForm = ({ title }) => {
  // Справочники приезжают лоадером из кэша (store/form-data), поэтому форма
  // открывается готовой: собственного ожидания у неё нет.
  const { device: data, formData, presetCompanyId } = useLoaderData();
  const isEdit = Boolean(data?._id);

  const fetcher = useFetcher();
  const { close } = useFormSheet();
  const can = useCan();

  const [form, setForm] = useState({
    companyId: refId(data?.companyId) || presetCompanyId || "",
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

  // Те справочники, в которые дописывает создание «на месте»
  // (InlineCreateDialog), держим состоянием; компании инлайн не заводятся,
  // поэтому они берутся из лоадера как есть.
  const { companies } = formData;
  const [locations, setLocations] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState(formData.deviceTypes);
  const [vendors, setVendors] = useState(formData.vendors);
  const [deviceModels, setDeviceModels] = useState(formData.deviceModels);
  const [configurations, setConfigurations] = useState([]);
  const [suppliers, setSuppliers] = useState(formData.suppliers);

  // Текущий шаг и пройденные — КЛЮЧАМИ: список шагов меняется («Комплектующие»
  // появляются и пропадают), и номер сместился бы хотя бы на кадр
  const [currentKey, setCurrentKey] = useState("device");
  const [reachedKeys, setReachedKeys] = useState(["device"]);
  const [attempted, setAttempted] = useState(false);
  const [inlineKind, setInlineKind] = useState(null);
  const [headHeight, setHeadHeight] = useState(0);
  // Устройства с таким же серийником — предупреждение, а не запрет
  const [serialMatches, setSerialMatches] = useState([]);
  // id созданного устройства, которому предложено подключение к мониторингу
  const [connectOffer, setConnectOffer] = useState(null);

  // ── Сборка и комплектующие (только создание своей сборки) ──
  // Комплектующие типа (слоты, ключевые характеристики) и его сборки
  const [assemblyData, setAssemblyData] = useState(null);
  const [assemblyStatus, setAssemblyStatus] = useState("idle");
  const [assemblyReload, setAssemblyReload] = useState(0);
  // "" — не выбрана, MANUAL_BUILD — комплектующие вручную, иначе id сборки
  const [buildId, setBuildId] = useState("");
  // Строки шага «Комплектующие» — по одной на физическую деталь
  const [units, setUnits] = useState([]);

  const setField = (name, value) =>
    setForm((previous) => ({ ...previous, [name]: value }));

  // Общедоступное расположение чужой компании правил выдачи не задаёт: его
  // подразделения и сотрудники — не той компании, что устройство. Тогда
  // кандидаты — пользователи компании устройства.
  const selectedLocation = locations.find(
    (location) => location._id === form.locationId,
  );
  const isForeignLocation =
    Boolean(selectedLocation) &&
    refId(selectedLocation.company) !== form.companyId;
  const { users: assignableUsers, defaultUserId } = useAssignableUsers(
    isForeignLocation ? "" : form.locationId,
    form.companyId,
  );

  // Расположения выбранной компании и общедоступные расположения других
  // компаний (`includePublic`).
  useEffect(() => {
    if (!form.companyId) {
      setLocations([]);
      return undefined;
    }
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?companyIds=${form.companyId}&includePublic=1`,
      {},
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
    let cancelled = false;
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/model/${form.deviceModelId}`,
      {},
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

  // Одна конфигурация у модели — вместо выбора сводка её характеристик;
  // связки типа нужны для порядка и единиц (макет «Модель без конфигураций»)
  // Только конфигурации выбранной модели: список догружается после смены
  // модели, и до ответа в нём ещё прежние
  const modelConfigs = configurations.filter(
    (c) => (c.deviceModelId?._id ?? c.deviceModelId) === form.deviceModelId,
  );
  const configMode = configFieldMode(modelConfigs);
  const [typeLinks, setTypeLinks] = useState([]);
  useEffect(() => {
    if (configMode !== "summary" || !form.deviceTypeId) {
      setTypeLinks([]);
      return undefined;
    }
    let cancelled = false;
    load(`/api/inventory/device-type-attributes/type/${form.deviceTypeId}`)
      .then((list) => {
        if (!cancelled) setTypeLinks(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setTypeLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [configMode, form.deviceTypeId]);

  // Слоты типа своей сборки и его сборки. Свежими, не из кэша: тип только
  // что могли перевести на комплектующие, сборку — завести. Смена типа (или
  // вида) сбрасывает выбор сборки и строки деталей.
  const assemblyTypeId =
    !isEdit && deviceKind === "custom" ? form.deviceTypeId : "";
  useEffect(() => {
    setAssemblyData(null);
    setBuildId("");
    setUnits([]);
    if (!assemblyTypeId) {
      setAssemblyStatus("idle");
      return undefined;
    }
    let cancelled = false;
    setAssemblyStatus("loading");
    (async () => {
      const type = await api(`/api/inventory/device-types/${assemblyTypeId}`);
      const assembly = liveAssembly(type?.assembly);
      const builds = assembly.enabled
        ? await api(
            `/api/inventory/device-builds?deviceTypeId=${assemblyTypeId}`,
          )
        : [];
      return { assembly, builds };
    })()
      .then(({ assembly, builds }) => {
        if (cancelled) return;
        setAssemblyData({
          typeId: assemblyTypeId,
          enabled: Boolean(assembly.enabled),
          slots: assembly.slots,
          keySpecs: assembly.keySpecs,
          builds: Array.isArray(builds) ? builds : [],
        });
        setUnits(manualUnits(assembly.slots));
        setAssemblyStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setAssemblyStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [assemblyTypeId, assemblyReload]);

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
    const timer = setTimeout(() => {
      const url = new URL(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/serial-check`,
        window.location.origin,
      );
      url.searchParams.set("value", value);
      if (data?._id) url.searchParams.set("excludeId", data._id);
      fetch(url)
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
  // Порядок блоков: свои расположения (без заголовка), общедоступные чужие,
  // рабочие места — отдельным блоком в самом низу.
  const locationOptions = useMemo(() => {
    const blockOf = (location) =>
      refId(location.company) !== form.companyId
        ? 1
        : location.type === "workplace"
          ? 2
          : 0;
    const personName = (user) =>
      user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "";
    return [...locations]
      .sort((a, b) => blockOf(a) - blockOf(b))
      .map((location) => {
        const block = blockOf(location);
        return {
          value: location._id,
          label: location.fullPath || location.name,
          group:
            block === 1
              ? "Общедоступные"
              : block === 2
                ? "Рабочие места"
                : undefined,
          hint:
            block === 1
              ? location.company?.alias || location.company?.fullTitle
              : block === 2
                ? personName(location.assignedUser) || location.parent?.name
                : undefined,
        };
      });
  }, [locations, form.companyId]);
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
    // Все типы; собираемый из комплектующих подписан — у него следом
    // спросим «Модель из каталога / Своя сборка»
    deviceTypes: useMemo(
      () =>
        visibleOptions(deviceTypes, [
          refId(data?.deviceModelId?.deviceTypeId) || refId(data?.deviceTypeId),
        ]).map((type) => ({
          value: type._id,
          label: type.name,
          hint: type.assembly?.enabled ? "из комплектующих" : undefined,
        })),
      [deviceTypes, data],
    ),
    vendors: useMemo(
      () =>
        optionsOf(
          visibleOptions(vendors, [refId(data?.deviceModelId?.vendorId)]),
        ),
      [vendors, data],
    ),
    deviceModels: modelOptions,
    configMode,
    modelSummary:
      configMode === "summary"
        ? specSummary(typeLinks, modelConfigs[0]?.values || [], 4, " · ")
        : "",
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
    suppliers: useMemo(
      () => optionsOf(visibleOptions(suppliers, [refId(data?.supplierId)])),
      [suppliers, data],
    ),
    users: useMemo(
      () =>
        assignableUsers.map((user) => ({
          value: user._id,
          label: userOptionLabel(user),
        })),
      [assignableUsers],
    ),
  };

  // --- сборка и комплектующие ---
  const assembly =
    assemblyTypeId && assemblyData?.typeId === assemblyTypeId
      ? assemblyData
      : null;
  const partsEnabled = Boolean(assembly?.enabled && assembly.slots.length > 0);
  // Пока комплектующие типа грузятся, поле «Сборка» показываем по флагу из
  // списка типов
  const listAssemblyEnabled = Boolean(
    deviceTypes.find((type) => type._id === form.deviceTypeId)?.assembly
      ?.enabled,
  );
  // Не загрузилось — поле с ошибкой и «Повторить» в любом случае: флаг из
  // списка мог устареть, молча пропустить комплектующие нельзя
  const showBuildField =
    Boolean(assemblyTypeId) &&
    (assembly
      ? partsEnabled
      : listAssemblyEnabled || assemblyStatus === "error");
  const selectedBuild =
    (assembly?.builds || []).find((build) => build._id === buildId) || null;

  const steps = partsEnabled ? STEPS_WITH_PARTS : STEPS;
  const lastStep = steps.length - 1;
  // Шаг пропал (тип сменили на шаге «Комплектующие») — первый шаг
  const step = Math.max(
    0,
    steps.findIndex((item) => item.key === currentKey),
  );
  const stepKey = steps[step].key;
  // Достигнутые — непрерывный префикс пройденных: появившийся шаг, где ещё
  // не были, недостижим по степперу (только через «Далее»)
  let maxReached = 0;
  while (
    maxReached < lastStep &&
    reachedKeys.includes(steps[maxReached + 1].key)
  ) {
    maxReached += 1;
  }

  // Шаг «Комплектующие» появился или пропал (выбран тип, догрузились его
  // комплектующие) — остаёмся на том же шаге по смыслу; вперёд по степперу —
  // только заново через «Далее». Правка состояния прямо в рендере: без
  // промежуточного кадра со старыми шагами
  const stepsSignature = steps.map((item) => item.key).join("|");
  const [seenSignature, setSeenSignature] = useState(stepsSignature);
  if (seenSignature !== stepsSignature) {
    setSeenSignature(stepsSignature);
    setCurrentKey(stepKey);
    setReachedKeys((previous) =>
      steps
        .slice(0, step + 1)
        .map((item) => item.key)
        .filter((key) => key === stepKey || previous.includes(key)),
    );
  }

  const modelIndex = useModelIndex(deviceModels);
  const configsByModel = useModelConfigurations(units, modelIndex.byId);
  // Модели выбранной сборки — подписи для строк, если в кэше каталога их нет
  const knownModels = useMemo(
    () =>
      new Map(
        (selectedBuild?.parts || [])
          .map((part) => part.deviceModelId)
          .filter((model) => model && !model.deletedAt)
          .map((model) => [model._id, model]),
      ),
    [selectedBuild],
  );
  const partsGaps = partsEnabled
    ? slotGaps(assembly.slots, units, modelIndex.byId)
    : [];

  const handleBuildChange = (next) => {
    setBuildId(next);
    const build = assembly?.builds.find((item) => item._id === next);
    // Сборка подставляет детали заново; вручную — пустая строка на слот
    setUnits(
      build
        ? unitsFromBuild(assembly.slots, build.parts || [])
        : manualUnits(assembly?.slots || []),
    );
  };

  const buildField = showBuildField
    ? {
        value: buildId,
        options: [
          ...(assembly?.builds || []).map((build) => ({
            value: build._id,
            label: build.name,
          })),
          { value: MANUAL_BUILD, label: "Без сборки — комплектующие вручную" },
        ],
        onChange: handleBuildChange,
        loading: assemblyStatus === "loading",
        error: assemblyStatus === "error",
        onRetry: () => setAssemblyReload((count) => count + 1),
        summary:
          selectedBuild && assembly
            ? buildSummary(assembly, selectedBuild.parts || [])
            : null,
      }
    : null;

  // Номер шага по ключу — для подсказок сводки «шаг 3»
  const stepOf = (key) => steps.findIndex((item) => item.key === key) + 1;

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
    build: labelOf(buildField?.options || [], buildId),
  };

  // --- валидация: причина стоит у поля ---
  const errorsFor = (key) => {
    const errors = {};
    if (key === "device") {
      if (!form.deviceTypeId) errors.deviceTypeId = "Выберите тип устройства";
      if (deviceKind === "branded") {
        if (!form.vendorId) errors.vendorId = "Выберите производителя";
        if (!form.deviceModelId) errors.deviceModelId = "Выберите модель";
      }
      // Комплектующие типа ещё не загружены — иначе ПК ушёл бы без деталей
      if (showBuildField && !assembly) {
        errors.buildId =
          assemblyStatus === "error"
            ? "Не удалось загрузить сборки типа."
            : "Загружаем сборки типа — секунду.";
      }
    }
    if (key === "parts" && partsEnabled && partsGaps.length) {
      errors.parts = partsGaps;
    }
    if (key === "placement") {
      if (!form.companyId) errors.companyId = "Выберите компанию";
      if (form.status === "deployed" && !form.userId && !isEdit) {
        errors.userId = "Статус «В эксплуатации» требует сотрудника";
      }
    }
    return errors;
  };
  const stepErrors = attempted ? errorsFor(stepKey) : {};
  const stepValid = (key) => Object.keys(errorsFor(key)).length === 0;

  // --- переходы ---
  const goToStep = (index) => {
    setAttempted(false);
    setCurrentKey(steps[index].key);
  };
  const handleNext = () => {
    if (!stepValid(stepKey)) {
      setAttempted(true);
      return;
    }
    const nextKey = steps[Math.min(step + 1, lastStep)].key;
    setAttempted(false);
    setCurrentKey(nextKey);
    setReachedKeys((previous) =>
      previous.includes(nextKey) ? previous : [...previous, nextKey],
    );
  };
  const handleClose = () => close();

  // Ветки не смешиваются: у самосборки нет производителя, модели и
  // конфигурации; у заводской нет сборки (её сбросит смена assemblyTypeId).
  const branchReset = (kind) =>
    kind === "custom"
      ? { vendorId: "", deviceModelId: "", configurationId: "" }
      : {};

  const handleKindChange = (kind) => {
    setDeviceKind(kind);
    setForm((previous) => ({ ...previous, ...branchReset(kind) }));
  };

  // Вид сборки следует за типом: у типа без комплектующих выбора нет — только
  // модель из каталога; собираемый в создании начинается со своей сборки (в
  // правке вид остаётся прежним). `type` — для только что заведённого типа,
  // которого ещё нет в состоянии.
  const kindForType = (typeId, type) => {
    const picked = type || deviceTypes.find((item) => item._id === typeId);
    if (!picked?.assembly?.enabled) return "branded";
    return isEdit ? deviceKind : "custom";
  };

  const handleFieldChange = (field, value, extra) => {
    const nextKind =
      field === "deviceTypeId" && value ? kindForType(value, extra) : null;
    if (nextKind) setDeviceKind(nextKind);
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
      if (nextKind) Object.assign(next, branchReset(nextKind));
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
      handleFieldChange("deviceTypeId", created._id, created);
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
    // Первый по порядку шаг с ошибкой
    const invalid = steps.findIndex((item) => !stepValid(item.key));
    if (invalid >= 0) {
      setAttempted(true);
      setCurrentKey(steps[invalid].key);
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
      // Поля выбора нет — единственная конфигурация модели. Явно, а не
      // пустым: у модели в режиме нескольких с одной конфигурацией сервер
      // сам её не подставит
      if (configMode === "summary") {
        payload.configurationId = modelConfigs[0]._id;
      }
    }
    const body = Object.fromEntries(
      SUBMIT_FIELDS.map((field) => [field, payload[field] ?? ""]),
    );
    // Новый ПК своей сборки — вместе с деталями, одним запросом. При правке
    // `buildId` не уходит вовсе: сервер сохраняет прежний
    if (partsEnabled) {
      if (buildId && buildId !== MANUAL_BUILD) body.buildId = buildId;
      body.parts = partsBody(units, {
        pcPurchasedAt: form.purchasedAt,
        today: toDayKey(new Date()),
      });
    }
    fetcher.submit(body, { method: "post", encType: "application/json" });
  };

  // Успешный сабмит: у вендора Mikrotik предлагаем подключить мониторинг —
  // диалогом поверх ещё открытой шторки (скрыть её, оставаясь на маршруте
  // формы, нельзя: открыта она, пока совпадает маршрут); иначе — обычный исход
  // (карточка созданной сущности / возврат на карточку).
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.error) return;
    const created = fetcher.data.clientDevice || fetcher.data;
    if (!isEdit && isMikrotikVendor && created?._id) {
      setConnectOffer(created._id);
      return;
    }
    close(
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

  // «Модель из каталога / Своя сборка» — у собираемого типа; в правке и у
  // нынешней самосборки на её прежнем типе (легаси: модель-less устройство
  // типа без комплектующих сохраняет и вид, и тип)
  const legacyCustom =
    isEdit &&
    !data?.deviceModelId &&
    Boolean(data?.deviceTypeId) &&
    form.deviceTypeId === refId(data.deviceTypeId);
  const kindChoice = listAssemblyEnabled || legacyCustom;

  const deviceStep = (
    <DeviceFields
      {...fieldProps}
      deviceKind={deviceKind}
      onKindChange={handleKindChange}
      kindChoice={kindChoice}
      awaitingType={!isEdit && !form.deviceTypeId}
      errors={stepErrors}
      serialMatches={serialMatches}
      build={buildField && { ...buildField, issue: stepErrors.buildId }}
    />
  );
  const partsStep = partsEnabled && (
    <PartsStep
      slots={assembly.slots}
      units={units}
      onUnitsChange={setUnits}
      modelIndex={modelIndex}
      knownModels={knownModels}
      configsByModel={configsByModel}
      supplierOptions={options.suppliers}
      pcPurchasedAt={form.purchasedAt}
      today={toDayKey(new Date())}
      attempted={attempted && stepKey === "parts"}
      gaps={partsGaps}
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
        <FormActions className="justify-end">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </FormActions>
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
        steps={steps}
        current={step}
        maxReached={maxReached}
        onStepClick={goToStep}
      />

      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 flex-1">
          {stepKey === "device" && deviceStep}
          {stepKey === "parts" && partsStep}
          {stepKey === "placement" && placementStep}
          {stepKey === "purchase" && purchaseStep}
          {stepKey === "tech" && techStep}
        </div>
        <div className="md:w-72 md:flex-none">
          <FormSummary
            form={form}
            deviceKind={deviceKind}
            labels={summaryLabels}
            stepOf={stepOf}
            partsCount={
              partsEnabled ? units.filter((unit) => unit.modelId).length : null
            }
          />
        </div>
      </div>

      {errorAlert && <div className="mt-4">{errorAlert}</div>}

      <FormActions>
        <Button variant="ghost" onClick={handleClose} disabled={saving}>
          Отмена
        </Button>
        {/* Пояснение шага «Комплектующие»; на телефоне скрыто (ошибка
            повторяется под строками) */}
        {stepKey === "parts" && (
          <div
            className={cn(
              "hidden min-w-0 flex-1 text-xs leading-snug sm:block",
              stepErrors.parts ? "text-destructive" : "text-faint",
            )}
          >
            {stepErrors.parts
              ? `Не заполнено: ${stepErrors.parts.join(", ")}`
              : "Серийник можно оставить пустым и дописать позже."}
          </div>
        )}
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
          {step < lastStep ? (
            // Без типа первому шагу нечего проверять — дальше нельзя
            <Button
              onClick={handleNext}
              disabled={stepKey === "device" && !form.deviceTypeId}
            >
              Далее <RiArrowRightLine />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </Button>
          )}
        </div>
      </FormActions>

      <InlineCreateDialog
        open={Boolean(inlineKind)}
        onOpenChange={(open) => !open && setInlineKind(null)}
        kind={inlineKind || "vendor"}
        context={inlineContext}
        resources={inlineResources}
        onCreated={(created) => handleInlineCreated(inlineKind, created)}
      />

      {/* Оффер подключения — только у вендора с управлением Mikrotik. Диалог
          поверх шторки: она уезжает вместе с выбранным исходом */}
      <Dialog
        open={Boolean(connectOffer)}
        onOpenChange={(open) => {
          if (open) return;
          const id = connectOffer;
          setConnectOffer(null);
          close(`/inventory/client-devices/${id}`, { replace: true });
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
                close(`/inventory/client-devices/${id}`, { replace: true });
              }}
            >
              Позже
            </Button>
            <Button
              disabled={!can({ mikrotik: ["manage"] })}
              onClick={() =>
                close(`/devices/mikrotik/add?clientDeviceId=${connectOffer}`)
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
