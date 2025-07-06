import { useState } from "react";
import {
  Form as RouterForm,
  Link,
  useSearchParams,
  useNavigation,
} from "react-router";

import AlertMessage from "../../UI/AlertMessageV2";

// Bootstrap Components
import Button from "react-bootstrap/Button";
import FloatingLabel from "react-bootstrap/FloatingLabel";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";

const ForgotPassword = ({ data }) => {
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();

  const isForgotPassword = searchParams.get("mode") === "forgot-password";
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [formData, setFormData] = useState({
    email: "",
  });
  const [validated, setValidated] = useState(false);

  // Handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      event.preventDefault();
      event.stopPropagation();
    }
    setValidated(true);
  };

  return (
    <>
      {isForgotPassword && (
        <RouterForm
          method="post"
          noValidate
          validated={validated}
          onSubmit={handleSubmit}
        >
          <Row className="justify-content-center mb-4">
            <Col sm={6}>
              <h4 className="text-center mb-4">Восстановление пароля</h4>
              <p className="text-muted text-center mb-4 ">
                Введите email, указанный при регистрации. Мы отправим инструкции
                по восстановлению пароля.
              </p>
              <AlertMessage message={data?.message} error={data?.error} />

              {/* Email Input */}
              <Form.Group className="mb-4">
                <FloatingLabel label="E-Mail">
                  <Form.Control
                    required
                    type="email"
                    name="email"
                    placeholder="E-Mail"
                    value={formData.email}
                    onChange={handleInputChange}
                    autoComplete="email"
                  />
                  <Form.Control.Feedback type="invalid">
                    Пожалуйста, введите корректный email
                  </Form.Control.Feedback>
                </FloatingLabel>
              </Form.Group>

              {/* Action Buttons */}
              <div className="d-grid gap-2">
                <Button
                  size="lg"
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting}
                  className="mb-3"
                >
                  {isSubmitting ? (
                    <>
                      <Spinner
                        as="span"
                        animation="border"
                        size="sm"
                        role="status"
                        aria-hidden="true"
                        className="me-2"
                      />
                      Отправка...
                    </>
                  ) : (
                    "Отправить"
                  )}
                </Button>
                <div className="text-center">
                  <Link to="?mode=login" className="text-decoration-none">
                    <i className="bi bi-arrow-left me-2"></i>
                    Вернуться к входу
                  </Link>
                </div>
              </div>

              {/* Success Message */}
              {data?.emailSent && (
                <div className="alert alert-success text-center mt-4">
                  Инструкции по восстановлению пароля отправлены на указанный
                  email
                </div>
              )}
            </Col>
          </Row>
        </RouterForm>
      )}
    </>
  );
};

export default ForgotPassword;
