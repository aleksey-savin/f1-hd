import {
  useNavigate,
  Form as RouterForm,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";

import AlertMessage from "../../../UI/AlertMessage";

import { RiSaveLine } from "react-icons/ri";

const AddMikrotikDevice = () => {
  const navigate = useNavigate();
  const data = useActionData();
  const submit = useSubmit();

  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  const [form, setForm] = useState({
    host: "",
    port: "",
    user: "",
    password: "",
    description: "",
  });

  const changeHandler = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };

  const submitHandler = (event) => {
    event.preventDefault();
    submit(form, { method: "post" });
  };

  return (
    <>
      <Modal
        show
        onHide={() => {
          navigate("/devices/mikrotik");
        }}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Новое устройство Mikrotik</Modal.Title>
        </Modal.Header>

        <RouterForm onSubmit={submitHandler} method="post" reloadDocument>
          <Modal.Body>
            {data && data.errors && (
              <AlertMessage
                variant="danger"
                message={Object.values(data.errors).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              />
            )}
            {data && data.message && (
              <AlertMessage variant="danger" message={data.message} />
            )}
            <Alert variant="light">
              Условия для успешного добавления:
              <ul>
                <li>В ip/services включена служба API</li>
                <li>Пользователь не состоит в группе Full</li>
                <li>Разрешено подлкючение с IP 89.108.109.83</li>
                <li>Имя устройства уникально</li>
              </ul>
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="host">
                Хост
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                autoFocus
                id="host"
                name="host"
                type="text"
                onChange={changeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="port">
                Порт
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                placeholder="8728"
                id="port"
                name="port"
                type="number"
                onChange={changeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="user">
                Имя пользователя
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                placeholder="Пользователь не из группы Full"
                id="user"
                name="user"
                type="text"
                onChange={changeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="password">
                Пароль
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                id="password"
                name="password"
                type="password"
                onChange={changeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="description">
                Описание
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                id="description"
                name="description"
                type="text"
                onChange={changeHandler}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => {
                navigate("/devices/mikrotik");
              }}
            >
              Закрыть
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              <RiSaveLine /> Сохранить
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </>
  );
};

export default AddMikrotikDevice;
