import { Form as RouterForm } from "react-router";
import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

import { TbFileInvoice } from "react-icons/tb";

const CreateInvoice = ({ reportId }) => {
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
        <TbFileInvoice />
      </Button>
      <Modal show={showInvoiceModal} onHide={handleCloseInvoiceModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Данные счёта</Modal.Title>
        </Modal.Header>
        <RouterForm method="post">
          <Modal.Body>
            <input name="reportId" defaultValue={reportId} hidden />
            <Form.Group className="py-1">
              <Form.Label>Номер счёта</Form.Label>
              <Form.Control type="text" name="invoiceNumber" />
            </Form.Group>
            <Form.Group className="py-1">
              <Form.Label>Дата</Form.Label>
              <Form.Control type="date" name="invoiceDate" />
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
              value="createInvoice"
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

export default CreateInvoice;
