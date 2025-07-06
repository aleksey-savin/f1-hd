import { useState } from "react";

import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import { FaCheck } from "react-icons/fa";
import TicketsOffcanvas from "../../layout/Dashboard/Offcanvas";

const TaskCard = ({ task }) => {
  const { desc, list = [], active, priority } = task;

  const [show, setShow] = useState({ active: false, list: [] });

  const handleClose = () => setShow({ active: false });
  const handleShow = (list) => setShow({ active: true, list: list });

  return (
    <>
      <a
        href="#"
        className={
          "link-offset-2 link-underline link-underline-opacity-0  " +
          (active ? "pe-auto" : "pe-none user-select-none")
        }
      >
        <Card
          className={
            !active
              ? "shadow my-3 bg-success bg-opacity-10"
              : priority === "danger"
                ? "shadow my-3 bg-danger bg-opacity-10"
                : "shadow my-3"
          }
          onClick={handleShow}
        >
          <Card.Body className={!active ? "text-decoration-line-through" : ""}>
            <Row>
              <Col className="col-auto me-auto my-1">{desc}</Col>
              <Col className="col-auto my-1">
                {active && <b>Осталось: {list.items?.length}</b>}
                {!active && <FaCheck />}
              </Col>
            </Row>
          </Card.Body>
        </Card>
      </a>
      <TicketsOffcanvas show={show} handleClose={handleClose} list={list} />
    </>
  );
};

export default TaskCard;
