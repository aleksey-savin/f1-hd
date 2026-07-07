import { useEffect, useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";

import { FaNetworkWired } from "react-icons/fa";
import { RiArrowRightLine, RiCloudLine } from "react-icons/ri";

import ParametersModal from "./ParametersModal";
import StandaloneModal from "./StandaloneModal";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Add a device under Mikrotik management. Two paths:
//   • Из инвентаря — pick a manageable ClientDevice not yet added
//     (status === "notConfigured"; already-added devices are excluded), then
//     configure it in ParametersModal.
//   • Cloud Hosted Router вручную — StandaloneModal creates a record with no
//     inventory device (identified by company + optional label).
// After either save the store re-fetches and the device joins the table.
const AddDeviceModal = ({ show, onClose }) => {
  const originalList = useMikrotikDeviceFilterStore(
    (state) => state.originalList,
  );

  const [selected, setSelected] = useState(null);
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Reset the wizard on close so reopening starts at step 1.
  useEffect(() => {
    if (!show) {
      setSelected(null);
      setStandaloneOpen(false);
      setQuery("");
    }
  }, [show]);

  const available = (originalList || []).filter(
    (device) => device.status === "notConfigured",
  );

  const term = query.trim().toLowerCase();
  const filtered = term
    ? available.filter((device) =>
        [
          device.displayName,
          device.company?.name,
          device.model?.name,
          device.location?.name,
          device.serialNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term),
      )
    : available;

  const closeAll = () => {
    setSelected(null);
    setStandaloneOpen(false);
    onClose();
  };

  return (
    <>
      {/* Шаг 1 — выбор устройства из инвентаря или переход к ручному вводу */}
      <Modal
        show={show && !selected && !standaloneOpen}
        onHide={closeAll}
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0 d-flex align-items-center gap-2">
            <FaNetworkWired className="text-primary" />
            Добавить устройство
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {available.length === 0 ? (
            <p className="text-muted mb-0">
              Нет доступных устройств из инвентаря. Добавьте Cloud Hosted Router
              кнопкой выше, либо заведите устройство в инвентаре у вендора с
              включённым управлением Mikrotik.
            </p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Control
                  type="search"
                  placeholder="Поиск по имени, компании, модели…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                />
              </Form.Group>
              {filtered.length === 0 ? (
                <p className="text-muted mb-0">Ничего не найдено.</p>
              ) : (
                <ListGroup>
                  {filtered.map((device) => (
                    <ListGroup.Item
                      key={device.clientDeviceId}
                      action
                      onClick={() => setSelected(device)}
                      className="d-flex align-items-center justify-content-between gap-3"
                    >
                      <div>
                        <div className="fw-semibold">{device.displayName}</div>
                        <div className="small text-body-secondary">
                          {device.company?.name || "— без компании —"}
                        </div>
                        {(device.model?.name || device.location?.name) && (
                          <div className="small text-muted">
                            {[device.model?.name, device.location?.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      <RiArrowRightLine className="flex-shrink-0 text-muted" />
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-primary"
            onClick={() => setStandaloneOpen(true)}
            className="d-inline-flex align-items-center gap-2"
          >
            <RiCloudLine /> Вручную
          </Button>
          <Button variant="secondary" onClick={closeAll}>
            Отмена
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Шаг 2 (инвентарь) — параметры подключения выбранного устройства */}
      <ParametersModal
        device={selected}
        show={show && !!selected}
        onClose={() => setSelected(null)}
        onSaved={closeAll}
      />

      {/* Ручной ввод — Cloud Hosted Router без инвентаря */}
      <StandaloneModal
        show={show && standaloneOpen}
        onClose={() => setStandaloneOpen(false)}
        onSaved={closeAll}
      />
    </>
  );
};

export default AddDeviceModal;
