import { useState } from "react";

import useHttp from "../../hooks/use-http";
import { toastActions } from "../../store/toast";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";

import { RiDeleteBinLine } from "react-icons/ri";

import Form from "react-bootstrap/Form";
import { useDispatch } from "react-redux";
import { getLocalStorageData } from "../../util/auth";

import useViewTicketStore from "../../store/viewTicket";

const DeleteWork = ({ work }) => {
  const { works, updateWorks } = useViewTicketStore();

  const { token } = getLocalStorageData();
  const dispatch = useDispatch();
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
      dispatch(
        toastActions.setState({
          variant: "warning text-white",
          message: "Работа удалена",
          show: true,
        }),
      );
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
          dispatch(
            toastActions.setState({
              variant: "danger text-white",
              message: data.message,
              show: true,
            }),
          );
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
