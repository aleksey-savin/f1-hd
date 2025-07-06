import { useContext, useState } from "react";
import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";

import { AuthedUserContext } from "../../../store/authed-user-context";

const CompanyModal = ({ ticket, company = {} }) => {
  const { isEndUser } = useContext(AuthedUserContext);

  const subdivision = ticket.applicant?.subdivision
    ? ticket.applicant.subdivision
    : undefined;

  const [showCompanyModal, setShowCompanyModal] = useState(false);

  const companyModalShowHandler = () => {
    setShowCompanyModal(true);
  };

  const companyModalCloseHandler = () => {
    setShowCompanyModal(false);
  };

  return (
    <>
      <Badge bg="primary" onClick={companyModalShowHandler}>
        {`${company.alias} ${subdivision ? "| " + subdivision.name : ""}`}
      </Badge>
      <Modal centered show={showCompanyModal} onHide={companyModalCloseHandler}>
        <Modal.Header closeButton>
          <Modal.Title>Данные компании по Заявке {ticket.num}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Table striped bordered hover>
            <tbody>
              <tr>
                <th>Наименование</th>
                <td>{company.alias}</td>
              </tr>
              {subdivision && (
                <>
                  <tr>
                    <th>Подразделение</th>
                    <td>{subdivision.name}</td>
                  </tr>
                  <tr>
                    <th>Телефон</th>
                    <td>
                      <a href={`tel:${subdivision.phone}`}>
                        {subdivision.phone}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>
                      <a
                        href={`mailto:${subdivision.email}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {subdivision.email}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <th>Адрес</th>
                    <td>
                      <a
                        href={subdivision.linkToMap}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {subdivision.address}
                      </a>
                    </td>
                  </tr>
                </>
              )}
              {!subdivision && (
                <>
                  <tr>
                    <th>Телефон</th>
                    <td>
                      <a href={`tel:${company.phone}`}>{company.phone}</a>
                    </td>
                  </tr>
                  <tr>
                    <th>Адрес</th>
                    <td>
                      <a
                        href={company.linkToMap}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {company.address}
                      </a>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </Table>
          {!isEndUser && (
            <div className="d-flex flex-row-reverse">
              <Button as={Link} to={`/companies/${company._id}`}>
                Подробнее
              </Button>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
};

export default CompanyModal;
