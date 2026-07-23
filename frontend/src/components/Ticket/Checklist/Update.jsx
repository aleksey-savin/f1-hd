import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import Checklist from "../../app/Checklist";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Dropdown from "react-bootstrap/Dropdown";

import { MdChecklist } from "react-icons/md";

const UpdateTicketChecklist = (props) => {
  const fetcher = useFetcher();

  const ticket = props.ticket;

  const [checklist, setChecklist] = useState(props.ticket?.checklist || []);

  useEffect(() => {
    setChecklist(props.ticket?.checklist);
  }, [props.ticket]);

  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };

  const closeModal = () => {
    setShow(false);
  };

  const updateChecklistHandler = (checklist) => {
    setChecklist(checklist);
  };

  const updateChecklist = () => {
    const formData = new FormData();

    formData.append("intent", "updateChecklist");
    formData.append("ticketNum", ticket.num);
    checklist.forEach((obj) => {
      formData.append(`checklist`, JSON.stringify(obj));
    });

    fetcher.submit(formData, {
      method: "POST",
      action: `/tickets/${ticket.num}`,
    });
    closeModal();
  };
  return (
    <>
      <Dropdown.Item onClick={showModal}>
        <MdChecklist style={{ marginRight: "0.5rem" }} />
        {ticket.checklist.length > 0 ? "Изменить чек-лист" : "Новый чек-лист"}
      </Dropdown.Item>
      <Modal show={show} onHide={closeModal} centered size="lg">
        <Modal.Body>
          <Checklist
            mode="edit"
            framed={false}
            title="Чек-лист заявки"
            items={checklist}
            onChange={updateChecklistHandler}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeModal}>
            Отмена
          </Button>
          <Button onClick={updateChecklist}>Сохранить</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default UpdateTicketChecklist;
