import { useContext } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Col from "react-bootstrap/Col";

import { RiServiceLine } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";

const JoinResponsibles = ({ ticket }) => {
  const fetcher = useFetcher();

  const { permissions, _id: userId } = useContext(AuthedUserContext);
  const { canPerformTickets } = permissions;

  const { state } = ticket;

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      { intent: "join", _id: ticket._id },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );
  };

  return (
    <>
      {canPerformTickets &&
        !ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) &&
        state !== "Новая" &&
        state !== "Закрыта" && (
          <>
            <Col sm="auto">
              <Form onSubmit={submitHandler}>
                <Button
                  variant="success"
                  disabled={fetcher.state !== "idle"}
                  type="submit"
                  name="intent"
                  value="join"
                  size="lg"
                  className="w-100 mb-2"
                >
                  <strong>
                    <RiServiceLine /> Присоединиться
                  </strong>
                </Button>
              </Form>
            </Col>
          </>
        )}
    </>
  );
};

export default JoinResponsibles;
