import {
  useNavigate,
  Form as RouterForm,
  useActionData,
  useLoaderData,
} from "react-router";
import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

import AlertMessage from "../../../UI/AlertMessage";

import { RiSaveLine } from "react-icons/ri";

const UpdateMikrotikDevice = () => {
  const navigate = useNavigate();
  const data = useActionData();
  const { device } = useLoaderData();

  const [description, setDescription] = useState(device.description);

  const descriptionChangeHandler = (event) => {
    setDescription(event.target.value);
  };

  return (
    <>
      <Modal
        show={true}
        onHide={() => {
          navigate("/devices/mikrotik");
        }}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Обновление данных</Modal.Title>
        </Modal.Header>

        <RouterForm method="post">
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
                value={description}
                onChange={descriptionChangeHandler}
              />
              <Form.Control
                hidden
                required
                id="_id"
                name="_id"
                type="text"
                defaultValue={device._id}
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
            <Button variant="primary" type="submit">
              <RiSaveLine /> Сохранить
            </Button>
          </Modal.Footer>
        </RouterForm>
      </Modal>
    </>
  );
};

export default UpdateMikrotikDevice;
