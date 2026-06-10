import { useParams } from "react-router";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import FormWrapper from "../../UI/FormWrapper";
import LocationFormFields from "./FormFields";

const LocationForm = ({
  location: initialLocation,
  companies = [],
  users = [],
  subdivisions = [],
  preselectedCompany = null,
}) => {
  const params = useParams();
  const isEdit = Boolean(params.id);
  const pageTitle = isEdit
    ? "Редактировать расположение"
    : "Добавить расположение";

  return (
    <FormWrapper title={pageTitle}>
      <Container fluid>
        <Row>
          <Col lg={8}>
            <LocationFormFields
              location={initialLocation}
              companies={companies}
              users={users}
              subdivisions={subdivisions}
              preselectedCompany={preselectedCompany}
            />
          </Col>
        </Row>
      </Container>
    </FormWrapper>
  );
};

export default LocationForm;
