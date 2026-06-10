import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import { RiAddLine } from "react-icons/ri";

import AlertMessage from "../../UI/AlertMessage";
import { getLocalStorageData } from "../../util/auth";

import VendorFormFields from "../Vendor/FormFields";
import DeviceTypeFormFields from "../DeviceType/FormFields";
import DeviceModelFormFields from "../DeviceModel/FormFields";
import LocationFormFields from "../Location/FormFields";

const base = import.meta.env.VITE_API_ADDRESS;

const authHeaders = () => {
  const { token } = getLocalStorageData();
  return { Authorization: "Bearer " + token };
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
    simpleName: {
      label: "Название поставщика",
      placeholder: "Введите название поставщика",
    },
    buildBody: (state) => ({ name: state.name }),
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
      const res = await fetch(`${base}/api/inventory/device-attributes`, {
        headers: authHeaders(),
      });
      const attrs = await res.json();
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
      const res = await fetch(`${base}/api/users`, { headers: authHeaders() });
      const data = await res.json();
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
 * Универсальная модалка быстрого создания справочника прямо из формы устройства.
 * Переиспользует настоящие поля формы сущности (XxxFormFields): состояние
 * собирается через onChange, сабмит идёт напрямую через fetch (модалка вне
 * react-router формы). enforceFocus отключён, чтобы внутри работали вложенные
 * модалки (например, создание атрибута внутри типа устройства).
 */
const InlineCreateModal = ({
  show,
  onHide,
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

  // Сброс + загрузка справочников при открытии.
  useEffect(() => {
    if (!show) {
      setReady(false);
      return;
    }

    setState({});
    setRefs({});
    setError("");
    setSubmitting(false);
    setReady(false);

    if (!config.loadRefs) {
      setReady(true);
      return;
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
  }, [show, kind]);

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

      if (config.afterCreate) {
        await config.afterCreate(created, state);
      }

      onCreated(created);
      onHide();
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderBody = () => {
    if (config.simpleName) {
      return (
        <Form.Group>
          <Form.Label htmlFor="inline-create-name">
            {config.simpleName.label}
            <span className="text-danger"> *</span>
          </Form.Label>
          <Form.Control
            autoFocus
            id="inline-create-name"
            type="text"
            value={state.name || ""}
            placeholder={config.simpleName.placeholder}
            onChange={(e) => setState({ name: e.target.value })}
          />
        </Form.Group>
      );
    }

    return config.renderFields({
      onChange: setState,
      resources: mergedResources,
      context,
    });
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size={config.size}
      enforceFocus={false}
    >
      <Form onSubmit={submitHandler}>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{config.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <AlertMessage variant="danger" message={error} />}

          {!ready ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : (
            renderBody()
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={submitting}>
            Отмена
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={submitting || !ready}
          >
            {submitting ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <>
                <RiAddLine /> Создать
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default InlineCreateModal;
