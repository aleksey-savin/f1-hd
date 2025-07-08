import { Form as RouterForm } from "react-router";
import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

import { RiCheckLine } from "react-icons/ri";

const ConfirmPayment = ({ reportId }) => {
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const handleCloseInvoiceModal = () => setShowInvoiceModal(false);
  const handleShowInvoiceModal = () => setShowInvoiceModal(true);

  return (
    <>
      <Button
        className="m-1"
        size="sm"
        variant="success"
        onClick={handleShowInvoiceModal}
      >
        <RiCheckLine />
      </Button>
      <Modal show={showInvoiceModal} onHide={handleCloseInvoiceModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Подтверждение оплаты</Modal.Title>
        </Modal.Header>
        <RouterForm method="post">
          <Modal.Body>
            <input name="reportId" defaultValue={reportId} hidden />
            <Form.Group className="py-1">
              <Form.Label>Дата полной оплаты</Form.Label>
              <Form.Control type="date" name="fullPaymentDate" />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseInvoiceModal}>
              Закрыть
            </Button>
            <Button
              variant="primary"
              type="submit"
              name="intent"
              value="confirmPayment"
              onClick={handleCloseInvoiceModal}
            >
              Сохранить
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </>
  );
};

export default ConfirmPayment;
