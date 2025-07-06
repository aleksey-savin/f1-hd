import Alert from "react-bootstrap/Alert";

import Transitions from "../animations/Transition";

const AlertMessage = ({ error, message }) => {
  return (
    <>
      {message && (
        <Transitions duration={0.5}>
          <Alert variant={error ? "danger" : "success"}>{message}</Alert>
        </Transitions>
      )}
    </>
  );
};

export default AlertMessage;
