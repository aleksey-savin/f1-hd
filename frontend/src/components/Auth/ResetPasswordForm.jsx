import { useState } from "react";
import {
  Form as RouterForm,
  Link,
  useLoaderData,
  useActionData,
} from "react-router";

import AlertMessage from "../../UI/AlertMessageV2";

// Bootstrap Components
import Button from "react-bootstrap/Button";
import FloatingLabel from "react-bootstrap/FloatingLabel";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import InputGroup from "react-bootstrap/InputGroup";

import { FaRegEye, FaRegEyeSlash } from "react-icons/fa6";

const ResetPasswordForm = () => {
  const { isValidToken } = useLoaderData();
  const actionData = useActionData();

  // States
  const [formData, setFormData] = useState({
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState({
    password: false,
    confirmPassword: false,
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

  const togglePasswordVisibility = (field) => {
    setShowPassword((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleSubmit = (event) => {
    const form = event.currentTarget;
    if (
      !form.checkValidity() ||
      formData.password !== formData.confirmPassword
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
    setValidated(true);
  };

  if (!isValidToken) {
    return (
      <Row className="justify-content-center">
        <Col sm="auto">
          <div className="alert alert-danger text-center">
            Ссылка для восстановления пароля недействительна или истекла
          </div>
          <div className="text-center mt-3">
            <Link to="/?mode=login" className="text-decoration-none">
              Вернуться к входу
            </Link>
          </div>
        </Col>
      </Row>
    );
  }

  return (
    <RouterForm
      method="post"
      noValidate
      validated={validated}
      onSubmit={handleSubmit}
    >
      <Row className="justify-content-center">
        <Col sm="auto">
          <h4 className="text-center mb-4">Создание нового пароля</h4>

          <AlertMessage
            message={actionData?.message}
            error={actionData?.error}
          />

          {/* Password Input */}
          <Form.Group className="mb-4">
            <InputGroup hasValidation>
              <FloatingLabel label="Новый пароль" style={{ flex: "1 1 auto" }}>
                <Form.Control
                  required
                  type={showPassword.password ? "text" : "password"}
                  name="password"
                  placeholder="Новый пароль"
                  value={formData.password}
                  onChange={handleInputChange}
                  minLength={6}
                  style={{
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                  }}
                />
                <Form.Control.Feedback type="invalid">
                  Минимальная длина пароля - 6 символов
                </Form.Control.Feedback>
              </FloatingLabel>
              <div style={{ alignSelf: "flex-start" }}>
                <InputGroup.Text
                  onClick={() => togglePasswordVisibility("password")}
                  style={{
                    cursor: "pointer",
                    height: "58px",
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                  }}
                  className="px-3"
                >
                  {showPassword.password ? <FaRegEye /> : <FaRegEyeSlash />}
                </InputGroup.Text>
              </div>
            </InputGroup>
          </Form.Group>

          {/* Confirm Password Input */}
          <Form.Group className="mb-4">
            <InputGroup hasValidation>
              <FloatingLabel
                label="Подтверждение пароля"
                style={{ flex: "1 1 auto" }}
              >
                <Form.Control
                  required
                  type={showPassword.confirmPassword ? "text" : "password"}
                  name="confirmPassword"
                  placeholder="Подтверждение пароля"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  isInvalid={
                    validated &&
                    formData.confirmPassword &&
                    formData.password !== formData.confirmPassword
                  }
                  style={{
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                  }}
                />
                <Form.Control.Feedback type="invalid">
                  Пароли не совпадают
                </Form.Control.Feedback>
              </FloatingLabel>
              <div style={{ alignSelf: "flex-start" }}>
                <InputGroup.Text
                  onClick={() => togglePasswordVisibility("confirmPassword")}
                  style={{
                    cursor: "pointer",
                    height: "58px",
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                  }}
                  className="px-3"
                >
                  {showPassword.confirmPassword ? (
                    <FaRegEye />
                  ) : (
                    <FaRegEyeSlash />
                  )}
                </InputGroup.Text>
              </div>
            </InputGroup>
          </Form.Group>

          {/* Action Buttons */}
          <div className="d-grid gap-2">
            <Button size="lg" variant="primary" type="submit" className="mb-3">
              Сохранить новый пароль
            </Button>
            <div className="text-center">
              <Link to="/?mode=login" className="text-decoration-none">
                Вернуться к входу
              </Link>
            </div>
          </div>
        </Col>
      </Row>
    </RouterForm>
  );
};

export default ResetPasswordForm;
