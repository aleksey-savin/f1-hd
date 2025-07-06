import { useState } from "react";
import { useFetcher } from "react-router";

import Select from "../../../UI/Select";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Alert from "react-bootstrap/Alert";
import Dropdown from "react-bootstrap/Dropdown";

import { RiShakeHandsLine } from "react-icons/ri";

const RequestHelp = ({ ticket, responsibles }) => {
  const fetcher = useFetcher();

  const [responsiblesList, setResponsiblesList] = useState(responsibles);

  const responsiblesChangeHandler = (selectedUsers) => {
    setResponsiblesList(selectedUsers);
  };

  const [requestHelp, setRequestHelp] = useState(false);

  const showRequestHelp = () => {
    setRequestHelp(true);
  };

  const closeRequestHelp = () => {
    setRequestHelp(false);
  };

  const userList = responsibles?.filter((user) => {
    const respList = ticket.responsibles.map((resp) => resp._id.toString());
    if (respList.includes(user._id.toString())) {
      return false;
    }
    return true;
  });

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "requestHelp",
        _id: ticket._id,
        responsibles: JSON.stringify(responsiblesList),
      },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      }
    );

    closeRequestHelp();
  };

  return (
    <>
      <Dropdown.Item onClick={showRequestHelp}>
        <RiShakeHandsLine /> Запросить помощь
      </Dropdown.Item>
      <Dropdown.Divider />
      <Modal show={requestHelp} onHide={closeRequestHelp} centered>
        <Modal.Header closeButton>
          <Modal.Title>Запросить помощь</Modal.Title>
        </Modal.Header>
        <Form onSubmit={submitHandler}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="responsibles">Пользователи</Form.Label>
              <Select
                id="responsibles"
                placeholder="Выберите пользователей"
                required
                isClearable
                isSearchable
                isMulti
                closeMenuOnSelect={false}
                options={userList}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={responsiblesChangeHandler}
              />
            </Form.Group>
            <Alert variant="light">
              Выбранные пользователи будут добавлены в список ответственных за
              выполнение заявки.
            </Alert>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={closeRequestHelp}
              disabled={fetcher.state !== "idle"}
            >
              Закрыть
            </Button>
            <Button
              variant="primary"
              disabled={fetcher.state !== "idle"}
              type="submit"
            >
              Подтвердить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default RequestHelp;
