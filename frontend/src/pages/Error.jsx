import { useRouteError, useNavigation, useNavigate } from "react-router";

import NotFound from "../components/Error/404";
import Forbidden from "../components/Error/403";
import InternalServerError from "../components/Error/500";

import AlertToast from "../UI/AlertToast";

import Container from "react-bootstrap/Container";
import Card from "react-bootstrap/Card";
import ToastContainer from "react-bootstrap/ToastContainer";

import Transitions from "../animations/Transition";
import { useEffect } from "react";

const Error = (props) => {
  const error = useRouteError() || props.error;
  const navigation = useNavigation();
  const navigate = useNavigate();

  useEffect(() => {
    if ([401, 402].includes(error.status)) {
      navigate("/auth");
    }
  }, [error, navigate]);

  return (
    <>
      <Container
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        <Transitions>
          <Card className="mb-3">
            <Card.Body>
              {navigation.state === "idle" && (
                <>
                  {error.status === 404 && <NotFound />}
                  {error.status === 403 && <Forbidden />}
                  {(![401, 402, 403, 404].includes(error.status) ||
                    !error.status) && <InternalServerError />}
                </>
              )}
            </Card.Body>
          </Card>
        </Transitions>
      </Container>
      <ToastContainer className="p-3" position="bottom-end">
        <AlertToast />
      </ToastContainer>
    </>
  );
};

export default Error;
