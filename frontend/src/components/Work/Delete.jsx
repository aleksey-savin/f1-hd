import { useState } from "react";

import useHttp from "../../hooks/use-http";
import useToastStore from "../../store/toast-store";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";

import { RiDeleteBinLine } from "react-icons/ri";

import Form from "react-bootstrap/Form";
import { getLocalStorageData } from "../../util/auth";

import useViewTicketStore from "../../store/view-ticket";

const DeleteWork = ({ work }) => {
  const { works, updateWorks } = useViewTicketStore();

  const { token } = getLocalStorageData();
  const { showToast } = useToastStore();
  const [show, setShow] = useState(false);
  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const { sendRequest: deleteWorkHandler } = useHttp();

  const submitHandler = (event) => {
    event.preventDefault();

    const deletedWork = {
      _id: work._id,
      ticket: work.ticket,
    };

    const deleteWork = () => {
      showToast("warning text-white", "Работа удалена");
      updateWorks(
        works.filter(
          (work) => work._id.toString() !== deletedWork._id.toString(),
        ),
      );

      handleClose();
    };

    deleteWorkHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/works/delete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: deletedWork,
      },
      (data) => {
        if (data.success) {
          deleteWork(data);
        } else {
          showToast("danger text-white", data.message);
        }
      },
    );
  };

  return (
    <>
      <Button variant="outline-danger" onClick={handleShow}>
        Удалить
      </Button>

      <Modal show={show} onHide={handleClose} centered>
        <Form>
          <Modal.Header closeButton>
            <Modal.Title>Удаление работы</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            Вы уверены? Это действие нельзя отменить.
            <Form.Control
              name="id"
              type="text"
              hidden
              readOnly
              value={work._id}
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Закрыть
            </Button>
            <Button variant="danger" onClick={submitHandler}>
              <RiDeleteBinLine /> Удалить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default DeleteWork;
