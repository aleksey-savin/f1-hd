import { useState } from "react";
import { useFetcher, NavLink } from "react-router";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

import AlertToast from "../../../UI/AlertToast";

const Integrations = ({ user }) => {
  const fetcher = useFetcher();

  const [showMessage, setShowMessage] = useState(false);

  const submitHandler = () => {
    fetcher.submit(fetcher.formData, {
      method: "post",
      action: "/my-account",
    });
    setShowMessage(true);
  };

  const [isActive, setIsActive] = useState(false);

  const isActiveHandler = () => {
    setIsActive(!isActive);
  };

  return (
    <>
      <fetcher.Form method="post" onSubmit={submitHandler}>
        <Form.Control hidden={true} name="id" defaultValue={user._id} />
        <Form.Group>
          <Form.Label>
            <h3>Telegram-бот</h3>
          </Form.Label>
        </Form.Group>
        {!user.telegramBot?.isActive && !isActive && (
          <Form.Group className="mb-3">
            <Button
              as={NavLink}
              onClick={isActiveHandler}
              target="_blank"
              to={`https://t.me/${import.meta.env.VITE_TG_BOT_NAME}?start=${user._id}`}
            >
              Подключить
            </Button>
          </Form.Group>
        )}
        {isActive && (
          <Form.Group className="mb-3">
            <Button variant="Success" disabled>
              Бот подключен
            </Button>
          </Form.Group>
        )}
        {user.telegramBot?.isActive && (
          <Button
            type="submit"
            name="intent"
            value="integrations-update"
            variant="warning"
          >
            Отключить
          </Button>
        )}
        {/* <Form.Group>
                    <Button
                        variant='primary'
                        type='submit'
                        name='intent'
                        value='integrations-update'
                    >
                        <RiSaveLine /> Сохранить
                    </Button>
                </Form.Group> */}
      </fetcher.Form>
      {fetcher.data?.message && (
        <>
          <AlertToast
            show={showMessage}
            setShow={setShowMessage}
            variant={fetcher.data.error ? "danger" : "success"}
            message={fetcher.data.message}
          />
        </>
      )}
    </>
  );
};

export default Integrations;
