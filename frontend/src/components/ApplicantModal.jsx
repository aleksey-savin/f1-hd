import { useState, useContext } from "react";
import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";

import { AuthedUserContext } from "../../../store/authed-user-context";

const ApplicantModal = ({ ticket }) => {
  const { isEndUser } = useContext(AuthedUserContext);

  const { applicant } = ticket;

  const [showApplicantModal, setShowApplicantModal] = useState(false);

  const applicantModalShowHandler = () => {
    setShowApplicantModal(true);
  };

  const applicantModalCloseHandler = () => {
    setShowApplicantModal(false);
  };

  return (
    <>
      <Badge bg="primary" onClick={applicantModalShowHandler}>
        {`${applicant?.lastName} ${applicant?.firstName}`}
      </Badge>
      <Modal
        centered
        show={showApplicantModal}
        onHide={applicantModalCloseHandler}
      >
        <Modal.Header closeButton>
          <Modal.Title>Данные инициатора Заявки {ticket.num}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Table striped bordered hover>
            <tbody>
              <tr>
                <th>Имя</th>
                <td>
                  {applicant.lastName} {applicant.firstName}
                </td>
              </tr>
              <tr>
                <th>Должность</th>
                <td>{applicant.position}</td>
              </tr>
              <tr>
                <th>Телефон</th>
                <td>
                  <a href={`tel:${applicant.phone}`}>{applicant.phone}</a>
                </td>
              </tr>
              <tr>
                <th>Email</th>
                <td>
                  <a href={`mailto:${applicant.email}`}>{applicant.email}</a>
                </td>
              </tr>
            </tbody>
          </Table>
          {!isEndUser && (
            <div className="d-flex flex-row-reverse">
              <Button as={Link} to={`/users/${applicant._id}`}>
                Подробнее
              </Button>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
};

export default ApplicantModal;
