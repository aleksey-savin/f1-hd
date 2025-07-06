import { useState, useContext } from "react";

import Card from "react-bootstrap/Card";
import Modal from "react-bootstrap/Modal";

import TicketsList from "../Ticket/List";

import { AuthedUserContext } from "../store/authed-user-context";

const TicketCard = (props) => {
  const { _id: userId } = useContext(AuthedUserContext);

  const { title, list } = props.tickets;

  const userList = list.filter((item) =>
    item.responsibles
      .map((resp) => resp._id.toString())
      .includes(userId.toString()),
  );

  const [show, setShow] = useState(false);

  const handleClose = () => setShow({ active: false, list: [] });
  const handleShow = () => setShow(list?.length > 0);

  return (
    <>
      <a
        href="#"
        className={
          "link-offset-2 link-underline link-underline-opacity-0  " +
          (list.length > 0 ? "pe-auto" : "pe-none user-select-none")
        }
      >
        <Card className="mb-3 shadow" onClick={handleShow}>
          <Card.Body className="text-start">
            <h1 className="display-4">{title}</h1>
            <h1 className="display-6">всего {list?.length}</h1>
            <h1 className="display-6 text-secondary">
              мои {userList.length > 0 ? userList?.length : ""}
            </h1>
          </Card.Body>
        </Card>
      </a>
      <Modal show={show} onHide={handleClose} centered size="xl">
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <TicketsList items={list} />
        </Modal.Body>
      </Modal>
    </>
  );
};

export default TicketCard;
