import { useState, useContext } from "react";

import Col from "react-bootstrap/Col";
import ListGroup from "react-bootstrap/ListGroup";
import Offcanvas from "react-bootstrap/Offcanvas";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";

import { formatDate } from "../../util/format-date";

import { AuthedUserContext } from "../../store/authed-user-context";

const TicketLogList = ({ logs }) => {
  const { isEndUser } = useContext(AuthedUserContext);

  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);
  return (
    <>
      {!isEndUser && (
        <>
          <Col sm="auto">
            <Button
              variant="outline-primary"
              size="lg"
              onClick={handleShow}
              className="w-100"
            >
              Лог
            </Button>
          </Col>
          <Offcanvas
            show={show}
            onHide={handleClose}
            keyboard
            placement="bottom"
            className="h-75"
          >
            <Offcanvas.Header closeButton>
              <Offcanvas.Title>Лог заявки</Offcanvas.Title>
            </Offcanvas.Header>
            <Offcanvas.Body>
              <ListGroup className="list-group-flush">
                {logs?.length > 0 && (
                  <>
                    {" "}
                    {logs.map((entry) => (
                      <ListGroup.Item key={entry._id}>
                        {entry.user && (
                          <>
                            <Badge className="mx-2" bg={entry.severity}>
                              {entry.severity}
                            </Badge>
                            {`${formatDate(entry.createdAt)} - ${
                              entry.user.firstName
                            } ${entry.user.lastName}, ${entry.event}`}
                          </>
                        )}
                        {!entry.user && (
                          <>
                            <Badge className="mx-2" bg={entry.severity}>
                              {entry.severity}
                            </Badge>
                            {`${formatDate(entry.createdAt)} - ${entry.event}`}
                          </>
                        )}
                      </ListGroup.Item>
                    ))}
                  </>
                )}
                {!logs?.length && (
                  <Alert variant="light">{"Нет записей"}</Alert>
                )}
              </ListGroup>
            </Offcanvas.Body>
          </Offcanvas>
        </>
      )}
    </>
  );
};

export default TicketLogList;
