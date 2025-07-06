import { useState } from "react";
import { Form as RouterForm, useActionData, useNavigation } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Card from "react-bootstrap/Card";
import FloatingLabel from "react-bootstrap/FloatingLabel";

import AlertMessage from "../../UI/AlertMessageV2";

const Welcome = () => {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const actionData = useActionData();

  const [initialSetup, setInitialSetup] = useState({
    companyFullTitle: "",
    userEmail: "",
    userFirstName: "",
    userLastName: "",
    userPassword: "",
    userPasswordRepeat: "",
  });

  const initialSetupChangeHandler = (event) => {
    setInitialSetup((prev) => ({
      ...prev,
      [event.target.name]: event.target.value,
    }));
  };

  return (
    <Card className="shadow mb-2 py-5">
      <Card.Body>
        <Row className="mb-4">
          <h2 className="text-center">F1Lab Helpdesk</h2>
          <h4 className="text-center">Заполнение начальных данных</h4>
        </Row>
        <Row className="justify-content-center mb-4">
          <Col lg={6}>
            <AlertMessage
              message={actionData?.message}
              error={actionData?.error}
            />
          </Col>
        </Row>
        <RouterForm method="post">
          <Row className="justify-content-center">
            <Col lg={6}>
              <Form.Group className="mb-3">
                <FloatingLabel label="Наименование компании">
                  <Form.Control
                    required
                    placeholder="Компания"
                    type="text"
                    name="companyFullTitle"
                    value={initialSetup.companyFullTitle}
                    onChange={initialSetupChangeHandler}
                  />
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="mb-3">
                <FloatingLabel label="Ваше имя">
                  <Form.Control
                    required
                    placeholder="Ваше имя"
                    type="text"
                    name="userFirstName"
                    value={initialSetup.userFirstName}
                    onChange={initialSetupChangeHandler}
                  />
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="mb-3">
                <FloatingLabel label="Ваша фамилия">
                  <Form.Control
                    required
                    placeholder="Ваша фамилия"
                    type="text"
                    name="userLastName"
                    value={initialSetup.userLastName}
                    onChange={initialSetupChangeHandler}
                  />
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="mb-3">
                <FloatingLabel label="Электронная почта">
                  <Form.Control
                    required
                    type="email"
                    name="userEmail"
                    placeholder="Электронная почта"
                    value={initialSetup.userEmail}
                    onChange={initialSetupChangeHandler}
                  />
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="mb-3">
                <FloatingLabel label="Пароль">
                  <Form.Control
                    required
                    id="userPassword"
                    type="password"
                    name="userPassword"
                    placeholder="Пароль"
                    value={initialSetup.userPassword}
                    onChange={initialSetupChangeHandler}
                  />
                  <Form.Text id="userPassword" muted>
                    Минимум 6 символов
                  </Form.Text>
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="mb-3">
                <FloatingLabel label="Подтверждение пароля" className="mb-3">
                  <Form.Control
                    required
                    id="userPasswordRepeat"
                    type="password"
                    name="userPasswordRepeat"
                    placeholder="Подтверждение пароля"
                    value={initialSetup.userPasswordRepeat}
                    onChange={initialSetupChangeHandler}
                  />
                </FloatingLabel>
              </Form.Group>
              <Form.Group className="text-end">
                <Button
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting}
                  name="intent"
                  value="first-launch"
                >
                  {isSubmitting ? "Сохранение..." : "Сохранить"}
                </Button>
              </Form.Group>
            </Col>
          </Row>
        </RouterForm>
      </Card.Body>
    </Card>
  );
};

export default Welcome;
