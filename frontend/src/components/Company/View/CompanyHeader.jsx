import { Row, Col, Table } from "react-bootstrap";
import { isBrowser } from "react-device-detect";
import ProfileImage from "./ProfileImage";

const CompanyHeader = ({ company, permissions }) => {
  return (
    <Row className="align-items-center mb-4">
      {isBrowser && (
        <Col xs="12" sm="auto" className="mb-3 mb-sm-0">
          <ProfileImage
            companyId={company._id.toString()}
            initialImage={
              company.profileImagePath
                ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${company.profileImagePath}`
                : "/companypic-placeholder.png"
            }
          />
        </Col>
      )}
      <Col>
        <h2 className="mb-3">{company.alias}</h2>
        <Table striped hover className="mb-0">
          <tbody>
            <tr>
              <th>Полное наименование</th>
              <td>{company.fullTitle}</td>
            </tr>
            <tr>
              <th>Телефон</th>
              <td>
                {company.phones.map((phone) => (
                  <span key={phone}>
                    <a href={"tel:" + phone}>{phone}</a>
                  </span>
                ))}
              </td>
            </tr>
            <tr>
              <th>Адрес</th>
              <td>
                <a href={company.linkToMap} target="_blank" rel="noreferrer">
                  {company.address}
                </a>
              </td>
            </tr>
            {permissions.canManageCompanies && (
              <tr>
                <th>Почтовые домены</th>
                <td>
                  {company.emailDomains.map((domain) => (
                    <h6 key={domain}>{domain}</h6>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Col>
    </Row>
  );
};

export default CompanyHeader;
