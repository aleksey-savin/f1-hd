import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import { RiAddLine } from "react-icons/ri";

import AlertMessage from "../../UI/AlertMessage";
import { getLocalStorageData } from "../../util/auth";

// Per-entity configuration for the inline creation modal. Each entry knows its
// title, the add endpoint, how to build the request body from local state, and
// where the created entity sits in the response.
const KINDS = {
  vendor: {
    title: "Новый вендор",
    nameLabel: "Название вендора",
    namePlaceholder: "Введите название вендора",
    endpoint: "/api/inventory/vendors/add",
    respKey: "vendor",
    buildBody: (state) => ({ name: state.name }),
  },
  supplier: {
    title: "Новый поставщик",
    nameLabel: "Название поставщика",
    namePlaceholder: "Введите название поставщика",
    endpoint: "/api/inventory/suppliers/add",
    respKey: "supplier",
    buildBody: (state) => ({ name: state.name }),
  },
  deviceType: {
    title: "Новый тип устройства",
    nameLabel: "Название типа",
    namePlaceholder: "Например: Ноутбук, Коммутатор",
    endpoint: "/api/inventory/device-types/add",
    respKey: "deviceType",
    withTypeFlags: true,
    buildBody: (state) => ({
      name: state.name,
      isActive: true,
      isComponent: state.isComponent,
      isConsumable: state.isConsumable,
    }),
  },
  deviceModel: {
    title: "Новая модель устройства",
    nameLabel: "Название модели",
    namePlaceholder: "Например: XPS 15, hAP ac²",
    endpoint: "/api/inventory/device-models/add",
    respKey: "deviceModel",
    nameOptional: true,
    buildBody: (state, context) => ({
      name: state.name,
      deviceTypeId: context?.deviceTypeId,
      vendorId: context?.vendorId,
    }),
  },
};

const emptyState = { name: "", isComponent: false, isConsumable: false };

/**
 * Универсальная модалка для создания справочника (вендор / поставщик / тип /
 * модель) прямо из формы устройства. Сабмит идёт напрямую через fetch, минуя
 * react-router action — модалка рендерится в портал, вложенных <form> нет.
 */
const InlineCreateModal = ({ show, onHide, kind, context, onCreated }) => {
  const config = KINDS[kind] || KINDS.vendor;

  const [state, setState] = useState(emptyState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Сбрасываем поля при каждом открытии.
  useEffect(() => {
    if (show) {
      setState(emptyState);
      setError("");
      setLoading(false);
    }
  }, [show]);

  const setField = (name, value) =>
    setState((prev) => ({ ...prev, [name]: value }));

  const submitHandler = async (event) => {
    event.preventDefault();

    if (!config.nameOptional && state.name.trim().length < 2) {
      setError("Название должно содержать минимум 2 символа");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${config.endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(config.buildBody(state, context)),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Не удалось создать запись");
        setLoading(false);
        return;
      }

      onCreated(data[config.respKey]);
      onHide();
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Form onSubmit={submitHandler}>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{config.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <AlertMessage variant="danger" message={error} />}

          {kind === "deviceModel" && context && (
            <p className="text-muted small mb-3">
              Тип: <strong>{context.deviceTypeName || "—"}</strong> · Вендор:{" "}
              <strong>{context.vendorName || "—"}</strong>
            </p>
          )}

          <Form.Group className="mb-3">
            <Form.Label htmlFor="inline-create-name">
              {config.nameLabel}
              {!config.nameOptional && <span className="text-danger"> *</span>}
            </Form.Label>
            <Form.Control
              autoFocus
              id="inline-create-name"
              type="text"
              value={state.name}
              placeholder={config.namePlaceholder}
              onChange={(e) => setField("name", e.target.value)}
            />
            {config.nameOptional && (
              <Form.Text className="text-muted">
                Можно оставить пустым, если у модели нет конкретного названия.
              </Form.Text>
            )}
          </Form.Group>

          {config.withTypeFlags && (
            <div className="d-flex gap-4">
              <Form.Check
                type="switch"
                id="inline-create-isComponent"
                label="Компонент"
                checked={state.isComponent}
                onChange={() => setField("isComponent", !state.isComponent)}
              />
              <Form.Check
                type="switch"
                id="inline-create-isConsumable"
                label="Расходник"
                checked={state.isConsumable}
                onChange={() => setField("isConsumable", !state.isConsumable)}
              />
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={loading}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? (
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
