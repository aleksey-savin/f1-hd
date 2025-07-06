import { useActionData } from "react-router";

import AlertToast from "../../UI/AlertToast";

import ToastContainer from "react-bootstrap/ToastContainer";
import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Image from "react-bootstrap/Image";

import Signup from "./Signup";
import Login from "./Login";
import ForgotPassword from "./ForgotPassword";

const AuthForm = () => {
  const data = useActionData();

  return (
    <Card className="shadow mb-2 pb-5 pt-5">
      <Card.Body>
        <ToastContainer className="p-3" position="bottom-end">
          <AlertToast />
        </ToastContainer>
        <Row>
          <h2 className="mb-4 text-center">
            <Image
              src="logo.png"
              className="me-2"
              style={{ maxHeight: "80px" }}
            />
            Helpdesk
          </h2>
          <Login data={data} />
          <Signup data={data} />
          <ForgotPassword data={data} />
        </Row>
      </Card.Body>
    </Card>
  );
};

export default AuthForm;
