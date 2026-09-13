import { useLoaderData, redirect } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { useSheetOpen } from "@/components/app/FormOutlet";
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import { getLocalStorageData } from "../../util/auth";
import useWorkStatusesStore from "../../store/work-statuses";

import ViewUser from "../../components/User/View";
import { newerWorkStatus } from "../../components/User/presence";

const ViewUserPage = () => {
  const { user, tickets, pulse } = useLoaderData();

  // Статус присутствия — из живого табло (User/PresenceSync), своего запроса у
  // карточки нет
  const liveWorkStatus = useWorkStatusesStore(
    useShallow(
      (state) =>
        state.users.find((item) => String(item._id) === String(user._id))
          ?.workStatus,
    ),
  );

  // Заявки человека меняются чужими руками — карточка перечитывается по пульсу
  // (docs/live-updates.md), не чаще раза в 30 секунд и не под открытой формой
  const sheetOpen = useSheetOpen();
  useLiveRouteRevalidate("tickets", {
    baseline: pulse,
    enabled: !sheetOpen,
    minIntervalMs: 30_000,
  });

  const workStatus = newerWorkStatus(user.workStatus, liveWorkStatus);
  return (
    <ViewUser
      user={workStatus === user.workStatus ? user : { ...user, workStatus }}
      tickets={tickets}
    />
  );
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
      );

  const ticketsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/user/${params.id}`,
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
    // Курсор живых обновлений на момент чтения заявок (docs/live-updates.md)
    pulse: ticketsResponse.headers.get("X-Pulse-Cursor"),
  };
}

export async function action({ request }) {

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
    // Причина и срок приходят только при отключении: при включении оба поля в
    // форме отсутствуют, и сервер их же и стирает.
    const banned = data.get("banned") === "true";
    const untilDay = data.get("banExpires");
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/toggle-active/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          banned,
          banReason: banned ? data.get("banReason") || "" : "",
          // Конец дня, а не полночь: «отключён до 15 августа» человек читает
          // как «включая пятнадцатое».
          banExpires:
            banned && untilDay ? new Date(`${untilDay}T23:59:59`) : null,
        }),
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
        },
      },
    );

    if (!response.ok) {
      return refusal(response, "Не удалось отправить ссылку");
    }

    return response;
  }
}
