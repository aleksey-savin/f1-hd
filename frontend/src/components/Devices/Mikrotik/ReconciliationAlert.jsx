import { useState } from "react";

import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Collapse from "react-bootstrap/Collapse";
import Spinner from "react-bootstrap/Spinner";

import { RiErrorWarningLine, RiRefreshLine } from "react-icons/ri";

import ReconciliationTable from "./ReconciliationTable";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Стоячее предупреждение на вкладке «Мониторинг»: данные карточки расходятся с
// устройством. Разворачивается в diff-таблицу с выбором полей и синхронизацией.
const ReconciliationAlert = ({
  clientDeviceId,
  reconciliation,
  canSync,
  onSynced,
}) => {
  const syncInventory = useMikrotikDeviceFilterStore(
    (state) => state.syncInventory,
  );

  const mismatches = reconciliation?.mismatches || [];
  const syncable = mismatches.filter((item) => item.syncable);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(
    () => new Set(syncable.map((item) => item.field)),
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(null);

  if (mismatches.length === 0) return null;

  const toggle = (field) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const response = await syncInventory(clientDeviceId, [...selected]);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Не удалось обновить карточку");
        return;
      }
      onSynced?.();
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Alert variant="warning" className="mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <RiErrorWarningLine className="flex-shrink-0" />
        <span className="flex-grow-1">
          Данные карточки расходятся с устройством (
          {mismatches.length}{" "}
          {mismatches.length === 1
            ? "поле"
            : mismatches.length < 5
              ? "поля"
              : "полей"}
          ).
        </span>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Скрыть" : "Показать"}
        </Button>
      </div>

      <Collapse in={open}>
        <div>
          <div className="mt-3">
            <ReconciliationTable
              mismatches={mismatches}
              selected={selected}
              onToggle={toggle}
            />
          </div>
          {error && (
            <Alert variant="danger" className="mt-3 mb-0">
              {error}
            </Alert>
          )}
          {canSync && syncable.length > 0 && (
            <div className="d-flex justify-content-end mt-3">
              <Button
                size="sm"
                variant="primary"
                disabled={isSyncing || selected.size === 0}
                onClick={handleSync}
              >
                {isSyncing ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  <RiRefreshLine />
                )}{" "}
                Синхронизировать карточку
              </Button>
            </div>
          )}
        </div>
      </Collapse>
    </Alert>
  );
};

export default ReconciliationAlert;
