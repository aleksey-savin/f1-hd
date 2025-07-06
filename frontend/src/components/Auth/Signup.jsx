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
import InputGroup from "react-bootstrap/InputGroup";
import Spinner from "react-bootstrap/Spinner";

import { FaRegEye, FaRegEyeSlash } from "react-icons/fa6";

const Signup = ({ data }) => {
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();

  const isSignup = searchParams.get("mode") === "signup";
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
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

  const togglePasswordVisibility = (field) => {
    setShowPassword((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  return (
    <>
      {isSignup && (
        <RouterForm
          method="post"
          noValidate
          className={`needs-validation ${validated ? "was-validated" : ""}`}
          onSubmit={handleSubmit}
        >
          <Row className="justify-content-center mb-4">
            <Col sm={8}>
              <AlertMessage message={data?.message} error={data?.error} />

              {/* First Name Input */}
              <Form.Group className="mb-4">
                <FloatingLabel label="Имя">
                  <Form.Control
                    required
                    type="text"
                    name="firstName"
                    placeholder="Имя"
                    value={formData.firstName}
                    onChange={handleInputChange}
                  />
                  <Form.Control.Feedback type="invalid">
                    Пожалуйста, введите имя
                  </Form.Control.Feedback>
                </FloatingLabel>
              </Form.Group>

              {/* Last Name Input */}
              <Form.Group className="mb-4">
                <FloatingLabel label="Фамилия">
                  <Form.Control
                    required
                    type="text"
                    name="lastName"
                    placeholder="Фамилия"
                    value={formData.lastName}
                    onChange={handleInputChange}
                  />
                  <Form.Control.Feedback type="invalid">
                    Пожалуйста, введите фамилию
                  </Form.Control.Feedback>
                </FloatingLabel>
              </Form.Group>

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
                <Form.Text className="text-muted">
                  Обязательно указывайте рабочий адрес
                </Form.Text>
              </Form.Group>

              {/* Password Input */}
              <Form.Group className="mb-4">
                <InputGroup hasValidation>
                  <FloatingLabel label="Пароль" style={{ flex: "1 1 auto" }}>
                    <Form.Control
                      required
                      type={showPassword.password ? "text" : "password"}
                      name="password"
                      placeholder="Пароль"
                      value={formData.password}
                      onChange={handleInputChange}
                      minLength={6}
                      style={{
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                      }}
                    />
                    <Form.Control.Feedback
                      type="invalid"
                      style={{ marginRight: "40px" }}
                    >
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
                    <Form.Control.Feedback
                      type="invalid"
                      style={{ marginRight: "40px" }}
                    >
                      Пароли не совпадают
                    </Form.Control.Feedback>
                  </FloatingLabel>
                  <div style={{ alignSelf: "flex-start" }}>
                    <InputGroup.Text
                      onClick={() =>
                        togglePasswordVisibility("confirmPassword")
                      }
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
                      Регистрация...
                    </>
                  ) : (
                    "Зарегистрироваться"
                  )}
                </Button>
                <div className="text-center">
                  <span className="text-muted">Уже есть аккаунт? </span>
                  <Link to="?mode=login" className="text-decoration-none">
                    Войти
                  </Link>
                </div>
              </div>
            </Col>
          </Row>
        </RouterForm>
      )}
    </>
  );
};

export default Signup;
