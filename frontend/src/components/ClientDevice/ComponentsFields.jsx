import Accordion from "react-bootstrap/Accordion";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";

import { RiAddLine, RiDeleteBinLine, RiLinkUnlink } from "react-icons/ri";

import Select from "../../UI/Select";
import ModelChainFields from "./ModelChainFields";
import PurchaseFields from "./PurchaseFields";
import { describeDevice } from "./attachable";

const refId = (value) => value?._id || value || "";

// Сводка для заголовка свёрнутой карточки нового компонента:
// «Тип · Вендор · Модель · гар. до …».
const summarize = (row, deviceTypes, vendors, deviceModels) => {
  const type = deviceTypes.find((t) => t._id === refId(row.deviceTypeId));
  const vendor = vendors.find((v) => v._id === refId(row.vendorId));
  const model = deviceModels.find((m) => m._id === refId(row.deviceModelId));
  const parts = [type?.name, vendor?.name, model?.name].filter(Boolean);
  const base = parts.length ? parts.join(" · ") : "Новая комплектующая";
  const warranty = row.warrantyExpirationDate
    ? ` · гар. до ${row.warrantyExpirationDate}`
    : "";
  return base + warranty;
};

// Состав сборки: можно прикрепить уже существующие устройства-комплектующие
// (становятся дочерними и «следуют за хостом») либо завести новые позиции —
// каждая создаётся как отдельный дочерний ClientDevice. Состояние держит
// родитель (ClientDeviceForm); связь применяется в его syncComponents после
// сохранения хоста. Записи с `_attached` — прикреплённые существующие устройства
// (только открепить), остальные — новые (полноценный редактор).
const ComponentsFields = ({
  value = [],
  onChange,
  componentTypes = [],
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  suppliers = [],
  attachableDevices = [],
  onResourceCreated,
  onSupplierCreated,
}) => {
  const usedIds = new Set(
    value.filter((r) => r._id).map((r) => String(r._id)),
  );
  const pickerOptions = attachableDevices
    .filter((d) => !usedIds.has(String(d._id)))
    .map((d) => ({
      value: d._id,
      label: describeDevice(d).optionLabel,
      device: d,
    }));

  const attachDevice = (option) => {
    if (!option?.device) return;
    onChange([
      ...value,
      { _id: option.device._id, _attached: true, _orig: option.device },
    ]);
  };

  const addRow = () =>
    onChange([
      ...value,
      {
        deviceTypeId: "",
        vendorId: "",
        deviceModelId: "",
        serialNumber: "",
        quantity: 1,
        purchasedAt: "",
        price: "",
        purchaseDocument: "",
        supplierId: "",
        warrantyExpirationDate: "",
      },
    ]);

  const removeRow = (index) => onChange(value.filter((_, i) => i !== index));

  const patchRow = (index, partial) =>
    onChange(value.map((r, i) => (i === index ? { ...r, ...partial } : r)));

  const hasAttached = value.some((r) => r._attached);
  const hasNew = value.some((r) => !r._attached);

  return (
    <div className="mt-4">
      <Form.Label className="mb-2 fw-semibold">Комплектующие</Form.Label>

      {/* Прикрепить существующее устройство */}
      <Form.Group className="mb-3">
        <Select
          inputId="attach-existing"
          placeholder={
            pickerOptions.length
              ? "Прикрепить существующее устройство…"
              : "Нет свободных устройств для прикрепления"
          }
          options={pickerOptions}
          value={null}
          onChange={attachDevice}
          isClearable={false}
          isDisabled={!pickerOptions.length}
          noOptionsMessage={() => "Нет свободных устройств"}
        />
        <Form.Text className="text-muted">
          Свободные устройства той же компании с типом «Комплектующие»,
          «Расходники» или «Периферия». Прикреплённое следует за хостом.
        </Form.Text>
      </Form.Group>

      {/* Прикреплённые устройства (только открепить) */}
      {hasAttached && (
        <div className="mb-3 d-flex flex-column gap-2">
          {value.map((row, index) => {
            if (!row._attached) return null;
            const d = describeDevice(row._orig || row);
            const sub = [
              d.inventoryNumber,
              d.serialNumber && `SN ${d.serialNumber}`,
              d.statusLabel,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={row._id} body className="py-2">
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <div style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate">
                      {d.title}{" "}
                      <Badge bg="light" text="dark" className="fw-normal">
                        прикреплено
                      </Badge>
                    </div>
                    <div className="text-body-secondary small text-truncate">
                      {sub || "—"}
                    </div>
                  </div>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => removeRow(index)}
                  >
                    <RiLinkUnlink /> Открепить
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!hasAttached && !hasNew && (
        <p className="text-muted small mb-2">
          Комплектующие не добавлены. Прикрепите существующее устройство выше или
          заведите новую позицию — она создастся как отдельный актив с моделью,
          серийником и своей гарантией.
        </p>
      )}

      {/* Новые комплектующие (создаются как новые устройства) */}
      <Accordion alwaysOpen className="mb-2">
        {value.map((row, index) => {
          if (row._attached) return null;
          return (
            <Accordion.Item eventKey={String(index)} key={index}>
              <Accordion.Header>
                {summarize(row, deviceTypes, vendors, deviceModels)}
              </Accordion.Header>
              <Accordion.Body>
                <ModelChainFields
                  value={{
                    deviceTypeId: refId(row.deviceTypeId),
                    vendorId: refId(row.vendorId),
                    deviceModelId: refId(row.deviceModelId),
                  }}
                  onChange={(partial) => patchRow(index, partial)}
                  deviceTypes={deviceTypes}
                  vendors={vendors}
                  deviceModels={deviceModels}
                  onResourceCreated={onResourceCreated}
                  types={componentTypes}
                  idPrefix={`component-${index}`}
                />

                <Row className="mt-3">
                  <Col md={8}>
                    <Form.Group className="mb-3">
                      <Form.Label htmlFor={`component-serial-${index}`}>
                        Серийный номер
                      </Form.Label>
                      <Form.Control
                        id={`component-serial-${index}`}
                        type="text"
                        placeholder="Введите серийный номер"
                        value={row.serialNumber || ""}
                        onChange={(e) =>
                          patchRow(index, { serialNumber: e.target.value })
                        }
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label htmlFor={`component-qty-${index}`}>
                        Количество
                      </Form.Label>
                      <Form.Control
                        id={`component-qty-${index}`}
                        type="number"
                        min={1}
                        value={row.quantity ?? 1}
                        onChange={(e) =>
                          patchRow(index, { quantity: e.target.value })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <PurchaseFields
                  values={row}
                  onChange={(name, val) => patchRow(index, { [name]: val })}
                  suppliers={suppliers}
                  onSupplierCreated={onSupplierCreated}
                />

                <div className="mt-3">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => removeRow(index)}
                  >
                    <RiDeleteBinLine /> Удалить комплектующее
                  </Button>
                </div>
              </Accordion.Body>
            </Accordion.Item>
          );
        })}
      </Accordion>

      <Button variant="outline-secondary" size="sm" onClick={addRow}>
        <RiAddLine /> Добавить комплектующее
      </Button>
    </div>
  );
};

export default ComponentsFields;
