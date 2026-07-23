import { redirect, useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import AnchorRail from "@/components/app/AnchorRail";

import Profile from "../../components/User/AccountSettings/Profile";
import Appearance from "../../components/User/AccountSettings/Appearance";
import Notifications from "../../components/User/AccountSettings/Notifications";
import Integrations from "../../components/User/AccountSettings/Integrations";
import Security from "../../components/User/AccountSettings/Security";

import { getLocalStorageData } from "../../util/auth";

const SECTIONS = [
  { id: "profile", label: "Профиль" },
  { id: "appearance", label: "Внешний вид" },
  { id: "notifications", label: "Уведомления" },
  { id: "integrations", label: "Интеграции" },
  { id: "security", label: "Безопасность" },
];

const MyAccount = () => {
  const { user, initialPrefs } = useLoaderData();

  const sections = (
    <div className="tw:max-w-2xl tw:space-y-8">
      <SettingsSection id="profile" label="Профиль">
        <Profile user={user} />
      </SettingsSection>
      <SettingsSection id="appearance" label="Внешний вид">
        <Appearance user={user} />
      </SettingsSection>
      <SettingsSection id="notifications" label="Уведомления">
        <Notifications user={user} initialPrefs={initialPrefs} />
      </SettingsSection>
      <SettingsSection id="integrations" label="Интеграции">
        <Integrations user={user} />
      </SettingsSection>
      <SettingsSection id="security" label="Безопасность">
        <Security user={user} />
      </SettingsSection>
    </div>
  );

  return (
    // max-w-4xl (896px) = рейл 192px + зазор 28px + колонка панелей 672px:
    // блок настроек целиком центрируется, поля слева и справа равные
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <h1 className="tw:my-0 tw:mb-5 tw:text-4xl tw:leading-none tw:font-semibold tw:tracking-tight">
        Мой аккаунт
      </h1>
      <BrowserView>
        <div className="tw:flex tw:items-start tw:gap-7">
          <AnchorRail sections={SECTIONS} ariaLabel="Разделы настроек" />
          <div className="tw:min-w-0 tw:flex-1">{sections}</div>
        </div>
      </BrowserView>
      <MobileView>{sections}</MobileView>
    </div>
  );
};

export default MyAccount;

export async function loader() {
  const { token, userId } = getLocalStorageData();

  if (!token) {
    return redirect("/auth");
  }

  document.title = "F1 HD | МОЙ АККАУНТ";

  const userResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/${userId}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const initialPrefsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!userResponse.ok) {
    if (userResponse.status === 401 || userResponse.status === 402) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: userResponse.message },
      {
        status: userResponse.status,
      },
    );
  } else {
    return {
      user: await userResponse.json(),
      initialPrefs: await initialPrefsResponse.json(),
    };
  }
}

export async function action({ request }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "profile-update") {
    const profile = {
      id: data.get("id"),
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      position: data.get("position"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "notifications-update") {
    const profile = {
      id: data.get("id"),
      notify: {
        byTelegram: {
          newTicket: data.get("tgNewTicket") === "true",
          respStateUpdate: data.get("tgRespStateUpdate") === "true",
          ticketStateUpdate: data.get("tgTicketStateUpdate") === "true",
          ticketDeadlineUpdate: data.get("tgTicketDeadlineUpdate") === "true",
          ticketNewComment: data.get("tgTicketNewComment") === "true",
          scheduledWorks: data.get("tgScheduledWorks") === "true",
        },
        byEmail: {
          newTicket: data.get("emailNewTicket") === "true",
          respStateUpdate: data.get("emailRespStateUpdate") === "true",
          ticketStateUpdate: data.get("emailTicketStateUpdate") === "true",
          ticketDeadlineUpdate:
            data.get("emailTicketDeadlineUpdate") === "true",
          ticketNewComment: data.get("emailTicketNewComment") === "true",
          scheduledWorks: data.get("emailScheduledWorks") === "true",
        },
      },
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "integrations-update") {
    const profile = {
      id: data.get("id"),
      telegramBot: {
        chatId: "",
        isActive: false,
      },
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }

  // Смена статуса присутствия из навбара (WorkStatusSwitcher). Ошибку не
  // бросаем: падение фонового переключателя не должно ронять страницу в
  // errorElement — статус просто не изменится после ревалидации.
  if (intent === "status-update") {
    return await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/set-status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          code: data.get("code"),
          note: data.get("note") ?? "",
        }),
      },
    );
  }
}
