import { useActionData, Link, useFetcher, useNavigate } from "react-router";

import Button from "react-bootstrap/Button";
import Container from "react-bootstrap/Container";
import Stack from "react-bootstrap/Stack";

import { RiSaveLine, RiArrowGoBackFill } from "react-icons/ri";

import AlertMessage from "./AlertMessage";
import Transitions from "../animations/Transition";

import useOffcanvasStore from "../store/offcanvas";
import { useEffect } from "react";

const FormWrapper = ({ title, action, children }) => {
  const data = useActionData();
  const offcanvas = useOffcanvasStore();

  const fetcher = useFetcher();
  const navigate = useNavigate();

  const submitHandler = (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    fetcher.submit(formData);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      navigate("..");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Container>
      <Transitions>
        <fetcher.Form method="post" action={action || "."}>
          <h1>{title}</h1>
          <hr></hr>
          {fetcher.data && fetcher.data.error && (
            <AlertMessage variant="danger" message={fetcher.data.message} />
          )}
          {data && data.message && data.error && (
            <AlertMessage variant="danger" message={data.message} />
          )}
          {data && data.message && !data.error && (
            <AlertMessage variant="success" message={data.message} />
          )}
          {children}
          <hr></hr>
          <Stack direction="horizontal" gap={3}>
            <div className="ms-auto">
              <Button
                as={Link}
                to={-1}
                onClick={offcanvas.setClose}
                variant="secondary"
              >
                <RiArrowGoBackFill /> Закрыть
              </Button>
            </div>
            <div className="">
              <Button
                variant="primary"
                type="submit"
                disabled={fetcher.state !== "idle"}
                onSubmit={submitHandler}
              >
                <RiSaveLine /> Сохранить
              </Button>
            </div>
          </Stack>
        </fetcher.Form>
      </Transitions>
    </Container>
  );
};

export default FormWrapper;
