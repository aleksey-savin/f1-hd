import { useState } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";

import { RiDeleteBinLine } from "react-icons/ri";

const DeleteServicePlan = ({ servicePlan = {}, companyId = "" }) => {
  const fetcher = useFetcher();

  const [show, setShow] = useState(false);
  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const deleteServicePlanHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "deleteServicePlan",
        companyId: companyId,
        servicePlanId: servicePlan._id,
      },
      {
        method: "DELETE",
        action: `/companies/${companyId}`,
      }
    );

    handleClose();
  };

  return (
    <>
      <Button variant="danger" size="sm" onClick={handleShow}>
        <RiDeleteBinLine /> Удалить
      </Button>

      <Modal show={show} onHide={handleClose} centered>
        <Form method="post" onSubmit={deleteServicePlanHandler}>
          <Modal.Header closeButton>
            <Modal.Title>{servicePlan.title}</Modal.Title>
          </Modal.Header>
          <Modal.Body>Вы уверены?</Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Закрыть
            </Button>
            <Button
              variant="danger"
              type="submit"
              name="intent"
              value="deleteServicePlan"
            >
              <RiDeleteBinLine /> Удалить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default DeleteServicePlan;
