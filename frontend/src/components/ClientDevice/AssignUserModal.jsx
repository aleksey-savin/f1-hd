import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";

import { RiUserAddLine } from "react-icons/ri";

import Select from "../../UI/Select";
import AlertMessage from "../../UI/AlertMessage";
import { getLocalStorageData } from "../../util/auth";

const refId = (value) => value?._id || value || "";

// Модал привязки/смены/снятия пользователя устройства. Отдельный лёгкий экшен
// (бэкенд: POST /client-devices/:id/assign-user) — не трогает прочие поля и сам
// переводит статус в «Выдано» (снятие — обратно в «Готово к выдаче»).
const AssignUserModal = ({ show, onHide, device, onAssigned }) => {
  const companyId = refId(device?.companyId);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(refId(device?.userId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Под текущее устройство при каждом открытии.
  useEffect(() => {
    if (show) {
      setUserId(refId(device?.userId));
      setError("");
    }
  }, [show, device]);

  // Пользователи компании устройства (фильтр по компании — как в форме).
  useEffect(() => {
    if (!show || !companyId) return;

    const fetchUsers = async () => {
      const { token } = getLocalStorageData();
      const base = import.meta.env.VITE_API_ADDRESS;
      try {
        const response = await fetch(`${base}/api/users?activeOnly=true`, {
          headers: { Authorization: "Bearer " + token },
        });
        const data = await response.json();
        const list = Array.isArray(data) ? data : data.users || [];
        setUsers(
          list.filter((u) => (u.company?._id || u.company) === companyId),
        );
      } catch (err) {
        console.error("Error fetching users:", err);
        setUsers([]);
      }
    };

    fetchUsers();
  }, [show, companyId]);

  const userOptions = users.map((u) => ({
    value: u._id,
    label: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
  }));
  const selected = userOptions.find((o) => o.value === userId) || null;

  const submit = async (nextUserId) => {
    setSaving(true);
    setError("");
    const { token } = getLocalStorageData();
    const base = import.meta.env.VITE_API_ADDRESS;
    try {
      const response = await fetch(
        `${base}/api/inventory/client-devices/${device._id}/assign-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ userId: nextUserId || "" }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось назначить пользователя");
      }
      onAssigned?.();
      onHide();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hasUser = !!refId(device?.userId);

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Выдать пользователю</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <AlertMessage variant="danger" message={error} />}
        <Form.Group>
          <Form.Label htmlFor="assignUserId">Пользователь</Form.Label>
          <Select
            id="assignUserId"
            placeholder={
              companyId ? "Выберите пользователя" : "У устройства нет компании"
            }
            options={userOptions}
            value={selected}
            onChange={(o) => setUserId(o ? o.value : "")}
            isClearable
            isSearchable
            isDisabled={saving || !companyId}
            noOptionsMessage={() => "Нет пользователей в компании"}
          />
          <Form.Text className="text-muted">
            Назначение переведёт статус устройства в «Выдано».
          </Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <div>
          {hasUser && (
            <Button
              variant="outline-danger"
              onClick={() => submit("")}
              disabled={saving}
            >
              Снять пользователя
            </Button>
          )}
        </div>
        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={onHide} disabled={saving}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => submit(userId)}
            disabled={saving || !userId}
          >
            {saving ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <>
                <RiUserAddLine /> Назначить
              </>
            )}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default AssignUserModal;
