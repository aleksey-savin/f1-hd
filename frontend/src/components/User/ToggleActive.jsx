import { useState } from "react";
import { Form as RouterForm } from "react-router";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Dropdown from "react-bootstrap/Dropdown";

import { RiUserUnfollowLine, RiUserFollowLine } from "react-icons/ri";

const ToggleActive = ({ item }) => {
  const [show, setShow] = useState(false);
  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const isActive = item.isActive;
  const actionLabel = isActive
    ? "Отключить пользователя"
    : "Включить пользователя";
  const Icon = isActive ? RiUserUnfollowLine : RiUserFollowLine;

  return (
    <>
      <Dropdown.Item
        onClick={handleShow}
        className={`w-100 my-1 ${isActive ? "text-warning" : "text-success"}`}
      >
        <Icon /> {actionLabel}
      </Dropdown.Item>

      <Modal show={show} onHide={handleClose} centered>
        <RouterForm method="post">
          <Modal.Header closeButton>
            <Modal.Title>{`${item.lastName} ${item.firstName}`}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {isActive
              ? "Отключить пользователя? Он потеряет доступ к системе."
              : "Включить пользователя? Доступ к системе будет восстановлен."}
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
            <Button
              variant={isActive ? "warning" : "success"}
              type="submit"
              name="intent"
              value="toggle-active"
            >
              <Icon /> {actionLabel}
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </>
  );
};

export default ToggleActive;
