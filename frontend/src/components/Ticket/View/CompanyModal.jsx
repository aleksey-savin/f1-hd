import { useContext, useState } from "react";
import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";

import { AuthedUserContext } from "../../../store/authed-user-context";
import useMinuteTick from "../../../hooks/use-minute-tick";
import { describeClientTimezone } from "../../../util/timezone-display";

const CompanyModal = ({ ticket, company = {} }) => {
  const { isEndUser } = useContext(AuthedUserContext);

  const subdivision = ticket.applicant?.subdivision
    ? ticket.applicant.subdivision
    : undefined;

  // В модалке пояс показываем всегда, даже совпадающий: сюда заходят именно
  // за контактами, и «время как у нас» — тоже ответ на вопрос
  const now = useMinuteTick();
  const clientTime = describeClientTimezone(ticket.clientTimezone, now);

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
        {company.alias}
      </Badge>
      {subdivision && (
        <Badge bg="info" onClick={companyModalShowHandler}>
          {subdivision.name}
        </Badge>
      )}
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
              {clientTime && (
                <tr>
                  <th>Часовой пояс</th>
                  <td className={clientTime.isNight ? "text-warning" : ""}>
                    {clientTime.city}, {clientTime.localTime}
                    {clientTime.differs && ` (${clientTime.offsetLabel})`}
                    {clientTime.sourceName && (
                      <small className="text-muted d-block">
                        {clientTime.source === "user"
                          ? "личный пояс заявителя"
                          : clientTime.source === "subdivision"
                            ? `по подразделению «${clientTime.sourceName}»`
                            : `по компании «${clientTime.sourceName}»`}
                      </small>
                    )}
                  </td>
                </tr>
              )}
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
