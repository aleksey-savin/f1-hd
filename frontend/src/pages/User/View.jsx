import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewUser from "../../components/User/View";

const ViewUserPage = () => {
  const { user, tickets } = useLoaderData();
  return <ViewUser user={user} tickets={tickets} />;
};

export default ViewUserPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();
  if (!token) {
    return redirect("/auth");
  }

  const userResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const ticketsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/user/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!userResponse.ok) {
    throw Response.json(
      { message: userResponse.message },
      { status: userResponse.status },
    );
  }

  return {
    user: await userResponse.json(),
    tickets: await ticketsResponse.json(),
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/delete/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось удалить пользователя" },
        { status: 500 },
      );
    }

    return redirect("/users");
  }

  if (intent === "reset-password") {
    const userData = {
      password: data.get("password"),
      repeatedPassword: data.get("repeatedPassword"),
      sendPassword: data.get("sendPassword") === "true",
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/reset-password/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(userData),
      },
    );
    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось изменить пароль" },
        { status: 500 },
      );
    }

    return response;
  }
}
