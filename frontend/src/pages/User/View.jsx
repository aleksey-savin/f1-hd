import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewUser from "../../components/User/View";

const ViewUserPage = () => {
  const { user, tickets } = useLoaderData();
  return <ViewUser user={user} tickets={tickets} />;
};

export default ViewUserPage;

/**
 * Отказ сервера, который человек может исправить прямо в диалоге (пароль из
 * утечек, отключённая учётка), возвращаем данными — их показывает форма. Общий
 * экран ошибки для такого не годится: он уводит со страницы и теряет ввод.
 * Всё остальное — как было, броском.
 */
async function refusal(response, fallback) {
  const failure = await response.json().catch(() => ({}));
  const message = failure.message || fallback;

  if (response.status === 400 || response.status === 403) {
    return { error: message };
  }

  throw Response.json({ message }, { status: 500 });
}

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

  document.title = "Просмотр пользователя";

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

  if (intent === "toggle-active") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/toggle-active/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось изменить статус пользователя" },
        { status: 500 },
      );
    }

    // Остаёмся на карточке — редирект на неё же перечитывает loader и
    // обновляет состояние (раньше уводило в список).
    return redirect(`/users/${id}`);
  }

  if (intent === "reset-password") {
    const userData = {
      password: data.get("password"),
      repeatedPassword: data.get("repeatedPassword"),
      // Своя смена пароля подтверждается текущим; при сбросе чужого поля нет.
      currentPassword: data.get("currentPassword") || "",
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
      return refusal(response, "Не удалось изменить пароль");
    }

    return response;
  }

  if (intent === "send-password-link") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/send-password-link/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!response.ok) {
      return refusal(response, "Не удалось отправить ссылку");
    }

    return response;
  }
}
