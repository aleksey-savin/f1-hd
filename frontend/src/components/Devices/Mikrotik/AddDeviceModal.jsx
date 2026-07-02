import { useEffect, useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";

import { FaNetworkWired } from "react-icons/fa";
import { RiArrowRightLine } from "react-icons/ri";

import ParametersModal from "./ParametersModal";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Двухшаговое добавление устройства под управление Mikrotik:
//   Шаг 1 — выбор устройства из инвентаря, ещё не привязанного к управлению
//           (status === "notConfigured"); уже добавленные не показываются.
//   Шаг 2 — модалка «Параметры» для выбранного устройства (то же окно, что и
//           по кнопке «Параметры» в строке таблицы). После сохранения стор
//           перезапрашивает список, и устройство появляется в таблице.
const AddDeviceModal = ({ show, onClose }) => {
  const originalList = useMikrotikDeviceFilterStore(
    (state) => state.originalList,
  );

  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");

  // Сброс мастера при закрытии, чтобы повторное открытие начиналось с шага 1.
  useEffect(() => {
    if (!show) {
      setSelected(null);
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
    onClose();
  };

  return (
    <>
      {/* Шаг 1 — выбор устройства */}
      <Modal show={show && !selected} onHide={closeAll} centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0 d-flex align-items-center gap-2">
            <FaNetworkWired className="text-primary" />
            Добавить устройство
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {available.length === 0 ? (
            <p className="text-muted mb-0">
              Нет доступных устройств для добавления. Все управляемые устройства
              Mikrotik уже добавлены, либо в инвентаре нет устройств с вендором,
              для которого включено управление Mikrotik.
            </p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Control
                  type="search"
                  placeholder="Поиск по имени, модели, расположению…"
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
                        <div className="small text-muted">
                          {[device.model?.name, device.location?.name]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
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
          <Button variant="secondary" onClick={closeAll}>
            Отмена
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Шаг 2 — параметры подключения выбранного устройства */}
      <ParametersModal
        device={selected}
        show={show && !!selected}
        onClose={() => setSelected(null)}
        onSaved={closeAll}
      />
    </>
  );
};

export default AddDeviceModal;
