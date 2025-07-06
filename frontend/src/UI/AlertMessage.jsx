import Alert from "react-bootstrap/Alert";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const AlertMessage = ({ variant, message }) => {
  return (
    <Row id="info-alert">
      <Col>
        <Alert variant={variant}>{message}</Alert>
      </Col>
    </Row>
  );
};

export default AlertMessage;
