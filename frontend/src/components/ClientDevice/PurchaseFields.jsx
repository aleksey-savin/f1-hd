import { useState } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";

import { RiAddLine } from "react-icons/ri";

import Select from "../../UI/Select";
import InlineCreateModal from "./InlineCreateModal";

const findOption = (options, value) =>
  options.find((option) => option.value === value) || null;

/**
 * Поля блока «Покупка». Управляемый компонент: используется и в шаге мастера, и
 * в отдельном редакторе с карточки устройства. Реальные name-атрибуты позволяют
 * собрать значения как через состояние, так и через FormData.
 */
const PurchaseFields = ({ values, onChange, suppliers, onSupplierCreated }) => {
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  const supplierOptions = suppliers.map((supplier) => ({
    value: supplier._id,
    label: supplier.name,
  }));

  const handleSupplierCreated = (supplier) => {
    onSupplierCreated(supplier);
    onChange("supplierId", supplier._id);
  };

  return (
    <>
      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="purchasedAt">Дата приобретения</Form.Label>
            <Form.Control
              id="purchasedAt"
              name="purchasedAt"
              type="date"
              value={values.purchasedAt}
              onChange={(e) => onChange("purchasedAt", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="price">Стоимость</Form.Label>
            <Form.Control
              id="price"
              name="price"
              type="number"
              min="0"
              placeholder="0"
              value={values.price}
              onChange={(e) => onChange("price", e.target.value)}
            />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="purchaseDocument">Документ</Form.Label>
            <Form.Control
              id="purchaseDocument"
              name="purchaseDocument"
              type="text"
              placeholder="Номер документа о покупке"
              value={values.purchaseDocument}
              onChange={(e) => onChange("purchaseDocument", e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="supplierId">Поставщик</Form.Label>
            <div className="d-flex gap-2">
              <div className="flex-grow-1">
                <Select
                  id="supplierId"
                  placeholder="Выберите поставщика"
                  options={supplierOptions}
                  value={findOption(supplierOptions, values.supplierId)}
                  onChange={(option) =>
                    onChange("supplierId", option ? option.value : "")
                  }
                  isClearable
                />
              </div>
              <Button
                variant="outline-secondary"
                title="Добавить поставщика"
                onClick={() => setShowSupplierModal(true)}
              >
                <RiAddLine />
              </Button>
            </div>
            <input type="hidden" name="supplierId" value={values.supplierId} />
          </Form.Group>
        </Col>
      </Row>

      <Row>
        <Col md={6}>
          <Form.Group className="mb-0">
            <Form.Label htmlFor="warrantyExpirationDate">Гарантия до</Form.Label>
            <Form.Control
              id="warrantyExpirationDate"
              name="warrantyExpirationDate"
              type="date"
              value={values.warrantyExpirationDate}
              onChange={(e) =>
                onChange("warrantyExpirationDate", e.target.value)
              }
            />
          </Form.Group>
        </Col>
      </Row>

      <InlineCreateModal
        show={showSupplierModal}
        onHide={() => setShowSupplierModal(false)}
        kind="supplier"
        onCreated={handleSupplierCreated}
      />
    </>
  );
};

export default PurchaseFields;
