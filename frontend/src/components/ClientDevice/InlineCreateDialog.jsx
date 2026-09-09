import { useState, useEffect } from "react";

import { RiAddLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import { load } from "@/store/form-data";
import { useNavWait } from "@/components/app/nav-wait";


import VendorFormFields from "../Vendor/FormFields";
import DeviceTypeFormFields from "../DeviceType/FormFields";
import DeviceModelFormFields from "../DeviceModel/FormFields";
import LocationFormFields from "../Location/FormFields";
import SupplierFormFields from "../Supplier/FormFields";

const base = import.meta.env.VITE_API_ADDRESS;

const authHeaders = () => {
  return {};
};

// Конфигурация инлайн-создания справочников. Каждый kind переиспользует поля
// настоящей формы сущности (XxxFormFields) — отдельных «мини-форм» больше нет.
// renderFields рисует поля, loadRefs догружает недостающие справочники,
// buildBody собирает тело запроса, afterCreate выполняет доп. шаги после
// создания, validate проверяет данные на клиенте.
const KINDS = {
  vendor: {
    title: "Новый вендор",
    endpoint: "/api/inventory/vendors/add",
    respKey: "vendor",
    renderFields: ({ onChange }) => <VendorFormFields onChange={onChange} />,
    buildBody: (state) => ({
      name: state.name,
      isActive: state.isActive,
      isMikrotikManagementEnabled: state.isMikrotikManagementEnabled,
    }),
    validate: (state) =>
      state.name && state.name.trim().length >= 2
        ? null
        : "Название должно содержать минимум 2 символа",
  },

  supplier: {
    title: "Новый поставщик",
    endpoint: "/api/inventory/suppliers/add",
    respKey: "supplier",
    // Те же поля, что на странице поставщика: мини-форму «только название»
    // не держим — именно так наборы полей и расходятся со временем.
    renderFields: ({ onChange }) => <SupplierFormFields onChange={onChange} />,
    buildBody: (state) => ({
      name: state.name,
      phone: state.phone,
      email: state.email,
      website: state.website,
      address: state.address,
      inn: state.inn,
      kpp: state.kpp,
      notes: state.notes,
      isActive: state.isActive !== false,
    }),
    validate: (state) =>
      state.name && state.name.trim().length >= 2
        ? null
        : "Название должно содержать минимум 2 символа",
  },

  deviceType: {
    title: "Новый тип устройства",
    endpoint: "/api/inventory/device-types/add",
    respKey: "deviceType",
    size: "lg",
    loadRefs: async () => {
      // Справочник — из кэша (store/form-data): второе открытие диалога уже
      // не ждёт (гайд, «Шторка открывается по готовности»).
      const attrs = await load("/api/inventory/device-attributes");
      return {
        availableAttributes: Array.isArray(attrs)
          ? attrs.map((a) => ({ _id: a._id, name: a.name, code: a.code }))
          : [],
      };
    },
    renderFields: ({ onChange, resources }) => (
      <DeviceTypeFormFields
        availableDeviceTypes={resources.deviceTypes || []}
        availableAttributes={resources.availableAttributes || []}
        onChange={onChange}
      />
    ),
    buildBody: (state) => ({
      name: state.name,
      isActive: true,
      isComponent: state.isComponent,
      isConsumable: state.isConsumable,
      isPeripheral: state.isPeripheral,
      inventoryPrefix: state.inventoryPrefix,
      attachableToTypeIds: state.attachableToTypeIds || [],
      attributes: state.attributes || [],
    }),
    validate: (state) =>
      state.name && state.name.trim().length >= 2
        ? null
        : "Название должно содержать минимум 2 символа",
  },

  deviceModel: {
    title: "Новая модель устройства",
    endpoint: "/api/inventory/device-models/add",
    respKey: "deviceModel",
    size: "lg",
    renderFields: ({ onChange, resources, context }) => (
      <DeviceModelFormFields
        deviceModel={
          context?.deviceTypeId || context?.vendorId
            ? {
                deviceTypeId: context.deviceTypeId
                  ? { _id: context.deviceTypeId }
                  : undefined,
                vendorId: context.vendorId
                  ? { _id: context.vendorId }
                  : undefined,
              }
            : undefined
        }
        deviceTypes={resources.deviceTypes || []}
        vendors={resources.vendors || []}
        deviceModels={resources.deviceModels || []}
        onChange={onChange}
      />
    ),
    buildBody: (state) => ({
      name: state.name,
      deviceTypeId: state.deviceTypeId,
      vendorId: state.vendorId,
      compatibleWithModelIds: state.compatibleWithModelIds || [],
      notes: state.notes,
    }),
    // Конфигурации создаются отдельными запросами — как и в action страницы.
    afterCreate: async (created, state) => {
      const configurations = state.configurations || [];
      for (const config of configurations) {
        await fetch(`${base}/api/inventory/device-configurations/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            deviceModelId: created._id,
            values: config.values,
          }),
        });
      }
    },
    validate: (state) =>
      state.deviceTypeId && state.vendorId
        ? null
        : "Выберите тип устройства и вендора",
  },

  location: {
    title: "Новое расположение",
    endpoint: "/api/inventory/locations/add",
    respKey: "location",
    size: "lg",
    loadRefs: async () => {
      const data = await load("/api/users?activeOnly=true");
      return { users: Array.isArray(data) ? data : data.users || [] };
    },
    renderFields: ({ onChange, resources, context }) => (
      <LocationFormFields
        location={
          context?.companyId ? { company: context.companyId } : undefined
        }
        companies={resources.companies || []}
        users={resources.users || []}
        preselectedCompany={context?.companyId || null}
        lockCompany={!!context?.companyId}
        onChange={onChange}
      />
    ),
    buildBody: (state) => ({
      name: state.name,
      type: state.type,
      company: state.company,
      subdivision: state.subdivision,
      assignedUser: state.assignedUser,
      description: state.description,
      isPublic: state.isPublic,
    }),
    validate: (state) => {
      if (!state.name || state.name.trim().length < 2)
        return "Введите название (минимум 2 символа)";
      if (!state.company) return "Не указана компания";
      if (!state.type) return "Выберите тип расположения";
      if (state.type === "workplace" && !state.assignedUser)
        return "Для рабочего места укажите пользователя";
      return null;
    },
  },
};

/**
 * Быстрое заведение справочника прямо из формы устройства — диалог поверх
 * шторки. Поля берутся у НАСТОЯЩЕЙ формы сущности (`XxxFormFields`): вторых
 * мини-форм в приложении не бывает, иначе они разъедутся с оригиналом по
 * правилам заполнения.
 *
 * Диалог, а не шторка: заведение вендора — шаг внутри чужой задачи, и
 * возвращаться нужно ровно туда, откуда открыли. Созданное подставляется в то
 * поле, из которого диалог позвали (`onCreated`).
 */
const InlineCreateDialog = ({
  open,
  onOpenChange,
  kind,
  context,
  resources = {},
  onCreated,
}) => {
  const config = KINDS[kind] || KINDS.vendor;

  const [state, setState] = useState({});
  const [refs, setRefs] = useState({});
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Ожидание справочников диалога — на общей линии под баром оболочки, как у
  // любого другого ожидания содержимого (app/nav-wait): собственный спиннер
  // здесь был третьим видом одного и того же.
  useNavWait(open && !ready && !error);

  // Сброс + загрузка недостающих справочников при открытии.
  useEffect(() => {
    if (!open) {
      setReady(false);
      return undefined;
    }

    setState({});
    setRefs({});
    setError("");
    setSubmitting(false);
    setReady(false);

    if (!config.loadRefs) {
      setReady(true);
      return undefined;
    }

    let cancelled = false;
    config
      .loadRefs()
      .then((loaded) => {
        if (cancelled) return;
        setRefs(loaded || {});
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Не удалось загрузить справочные данные");
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, kind]);

  const mergedResources = { ...resources, ...refs };

  const submitHandler = async (event) => {
    event.preventDefault();

    const validationError = config.validate?.(state);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(`${base}${config.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(config.buildBody(state, context)),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Не удалось создать запись");
        setSubmitting(false);
        return;
      }

      const created = data[config.respKey];
      if (config.afterCreate) await config.afterCreate(created, state);

      onCreated(created);
      onOpenChange(false);
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderBody = () =>
    config.renderFields({
      onChange: setState,
      resources: mergedResources,
      context,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={config.size === "lg" ? "sm:max-w-2xl" : undefined}
      >
        <form onSubmit={submitHandler}>
          <DialogHeader>
            <DialogTitle>{config.title}</DialogTitle>
          </DialogHeader>

          {error && <AlertMessage variant="danger" message={error} />}

          <div
            className="my-4 overflow-y-auto"
            // Длинная форма справочника (тип устройства с атрибутами) не должна
            // выпихивать кнопки за экран; vh встроенной сеткой не выражается.
            style={{ maxHeight: "60vh" }}
          >
            {ready && renderBody()}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting || !ready}>
              <RiAddLine /> {submitting ? "Создаём…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default InlineCreateDialog;
