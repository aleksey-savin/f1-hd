import { useState } from "react";
import { Form as RouterForm } from "react-router";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Dropdown from "react-bootstrap/Dropdown";

import { RiDeleteBinLine } from "react-icons/ri";

const DeleteItem = ({ item, isButton = false, customDeleteMessage = "" }) => {
  const [show, setShow] = useState(false);
  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  return (
    <>
      {!isButton && (
        <Dropdown.Item onClick={handleShow} className="w-100 my-1 text-danger">
          <RiDeleteBinLine /> Удалить
        </Dropdown.Item>
      )}
      {isButton && (
        <Button variant="danger" className="mb-2 w-100" onClick={handleShow}>
          <RiDeleteBinLine /> Удалить
        </Button>
      )}

      <Modal show={show} onHide={handleClose} centered>
        <RouterForm method="post">
          <Modal.Header closeButton>
            <Modal.Title>{item.title || item.alias}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {customDeleteMessage && customDeleteMessage}
            {!customDeleteMessage && (
              <>Вы уверены? Это действие нельзя отменить.</>
            )}
            <Form.Control
              name="id"
              type="text"
              hidden
              readOnly
              value={item._id}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Закрыть
            </Button>
            <Button variant="danger" type="submit" name="intent" value="delete">
              <RiDeleteBinLine /> Удалить
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </>
  );
};

export default DeleteItem;
