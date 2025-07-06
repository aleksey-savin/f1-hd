import { redirect, useLoaderData } from "react-router";

import { getLocalStorageData } from "../util/auth";

import AuthForm from "../components/Auth/AuthForm";

import Container from "react-bootstrap/Container";

import Transitions from "../animations/Transition";

import Welcome from "../components/FirstLaunch/Welcome";

const Authentication = () => {
  const { firstLaunch } = useLoaderData();
  return (
    <>
      <Transitions>
        <Container className="d-flex align-items-center justify-content-center vh-100">
          {!firstLaunch && <AuthForm />}
          {firstLaunch && <Welcome />}
        </Container>
      </Transitions>
    </>
  );
};

export default Authentication;

export async function loader() {
  document.title = "F1 HD | ВХОД";
  const { token } = getLocalStorageData();

  if (token && token !== "EXPIRED") {
    return redirect("/");
  }

  const prefsResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/preferences-auth`,
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  if (!prefsResponse.ok) {
    throw prefsResponse;
  }

  return await prefsResponse.json();
}

export async function action({ request }) {
  const searchParams = new URL(request.url).searchParams;
  const mode = searchParams.get("mode") || "login";

  if (mode !== "login" && mode !== "signup" && mode !== "forgot-password") {
    throw Response.json(
      {
        message:
          "Неподдерживаемый тип запроса, допустимы только login,signup или forgot-password",
      },
      { status: 422 }
    );
  }

  const data = await request.formData();
  let response = {};

  const intent = data.get("intent");

  if (intent === "first-launch") {
    const initialData = Object.fromEntries(data);

    response = await fetch(`${import.meta.env.VITE_ADDRESS}/api/first-launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialData),
    });

    if ([400, 401, 404, 409, 422, 429].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return await response.json();
  }

  const authData = {
    firstName: data.get("firstName"),
    lastName: data.get("lastName"),
    email: data.get("email"),
    password: data.get("password"),
  };

  response = await fetch(`${import.meta.env.VITE_ADDRESS}/api/${mode}`, {
    method: mode === "login" ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authData),
  });

  if ([401, 404, 409, 422, 429].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  const resData = await response.json();

  if (mode === "forgot-password") {
    const response = await fetch(
      `${import.meta.env.VITE_ADDRESS}/api/forgot-password`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: authData.email }),
      }
    );

    if (!response.ok) {
      return response;
    }

    return { emailSent: true };
  }

  const { token, expiryDate, userId } = resData;

  const expiration = new Date(expiryDate);

  localStorage.setItem("token", token);
  localStorage.setItem("expiryDate", expiration.toISOString());
  localStorage.setItem("userId", userId);

  const prefsResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/preferences-initial`,
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  const prefsResData = await prefsResponse.json();
  const { contacts, getScreen, timezone } = prefsResData;

  localStorage.setItem("contactsTel", contacts?.tel || "");
  localStorage.setItem("contactsEmail", contacts?.email || "");
  localStorage.setItem("contactsAddress", contacts?.address || "");
  localStorage.setItem("getScreenIsActive", getScreen.isActive || "");
  localStorage.setItem("timezone", timezone || "");

  if (!prefsResData) {
    return redirect("/preferences");
  }

  return redirect("/");
}
