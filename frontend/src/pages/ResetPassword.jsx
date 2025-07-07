import Container from "react-bootstrap/Container";
import Card from "react-bootstrap/Card";

import Transitions from "../animations/Transition";

import ResetPasswordForm from "../components/Auth/ResetPasswordForm";
import { redirect } from "react-router";

const ResetPassword = () => {
  return (
    <>
      <Transitions>
        <Container className="d-flex align-items-center justify-content-center vh-100">
          <Card className="shadow mb-2 py-2 w-100">
            <Card.Body>
              <ResetPasswordForm />
            </Card.Body>
          </Card>
        </Container>
      </Transitions>
    </>
  );
};

export default ResetPassword;

export async function loader({ params }) {
  const token = localStorage.getItem("token");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/validate-reset-token/${params.token}`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    return { isValidToken: false };
  }

  return { isValidToken: true };
}

// Action function
export async function action({ request, params }) {
  const token = localStorage.getItem("token");
  const data = await request.formData();
  const password = data.get("password");
  const confirmPassword = data.get("confirmPassword");

  // Client-side validation
  if (password !== confirmPassword) {
    return Response.json(
      { error: true, message: "Пароли не совпадают" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return Response.json(
      { error: true, message: "Минимальная длина пароля - 6 символов" },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/reset-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        token: params.token,
        password: password,
      }),
    },
  );

  if (!response.ok) {
    const data = await response.json();
    return Response.json(
      { error: true, message: data.message || "Что-то пошло не так" },
      { status: response.status },
    );
  }

  return redirect("/?mode=login&resetSuccess=true");
}
