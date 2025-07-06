import { useState } from "react";
import {
  Form as RouterForm,
  Link,
  useSearchParams,
  useNavigation,
  useLoaderData,
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

const Login = ({ data }) => {
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const { emailIsActive } = useLoaderData();

  const isLogin =
    searchParams.get("mode") !== "signup" &&
    searchParams.get("mode") !== "forgot-password";
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [validated, setValidated] = useState(false);

  // Handlers
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (event) => {
    const form = event.currentTarget;
    // Remove password field from validation check
    const emailInput = form.querySelector('input[type="email"]');
    if (!emailInput.checkValidity()) {
      event.preventDefault();
      event.stopPropagation();
      setValidated(true);
    }
  };

  return (
    <>
      {isLogin && (
        <RouterForm
          method="post"
          noValidate
          className={`needs-validation ${validated ? "was-validated" : ""}`}
          onSubmit={handleSubmit}
        >
          <Row className="justify-content-center mb-4">
            <Col sm="8">
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

              {/* Password Input with Show/Hide Toggle */}
              <Form.Group className="mb-3">
                <InputGroup>
                  <FloatingLabel label="Пароль" className="flex-grow-1">
                    <Form.Control
                      required
                      type={showPassword ? "text" : "password"}
                      name="password"
                      placeholder="Пароль"
                      value={formData.password}
                      onChange={handleInputChange}
                      autoComplete="current-password"
                    />
                    <Form.Control.Feedback type="invalid">
                      Пожалуйста, введите пароль
                    </Form.Control.Feedback>
                  </FloatingLabel>
                  <InputGroup.Text
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ cursor: "pointer" }}
                  >
                    {showPassword ? <FaRegEye /> : <FaRegEyeSlash />}
                  </InputGroup.Text>
                </InputGroup>
              </Form.Group>

              {/* Remember Me & Forgot Password */}
              {emailIsActive && (
                <div className="text-end mb-4">
                  <Link
                    to="?mode=forgot-password"
                    className="text-decoration-none"
                  >
                    Забыли пароль?
                  </Link>
                </div>
              )}
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
                      Вход...
                    </>
                  ) : (
                    "Войти"
                  )}
                </Button>
                <div className="text-center">
                  <span className="text-muted">Нет аккаунта? </span>
                  <Link to="?mode=signup" className="text-decoration-none">
                    Зарегистрироваться
                  </Link>
                </div>
              </div>
            </Col>
          </Row>{" "}
        </RouterForm>
      )}
    </>
  );
};

export default Login;
