import Accordion from "react-bootstrap/Accordion";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";

import { RiAddLine, RiDeleteBinLine } from "react-icons/ri";

import ModelChainFields from "./ModelChainFields";
import PurchaseFields from "./PurchaseFields";

const refId = (value) => value?._id || value || "";

// Сводка для заголовка свёрнутой карточки: «Тип · Вендор · Модель · гар. до …».
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

// Состав сборки: список комплектующих, каждая — будущий дочерний ClientDevice с
// полной связкой модель→тип→вендор, своим серийником, количеством и блоком
// закупки/гарантии. Состояние держит родитель (ClientDeviceForm), отправка —
// в его syncComponents.
const ComponentsFields = ({
  value = [],
  onChange,
  componentTypes = [],
  deviceTypes = [],
  vendors = [],
  deviceModels = [],
  suppliers = [],
  onResourceCreated,
  onSupplierCreated,
}) => {
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

  return (
    <div className="mt-4">
      <Form.Label className="mb-2 fw-semibold">Комплектующие</Form.Label>

      {value.length === 0 && (
        <p className="text-muted small mb-2">
          Комплектующие не добавлены. Каждая позиция заводится как отдельный
          актив с моделью, серийником и своей гарантией.
        </p>
      )}

      <Accordion alwaysOpen className="mb-2">
        {value.map((row, index) => (
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
        ))}
      </Accordion>

      <Button variant="outline-secondary" size="sm" onClick={addRow}>
        <RiAddLine /> Добавить комплектующее
      </Button>
    </div>
  );
};

export default ComponentsFields;
