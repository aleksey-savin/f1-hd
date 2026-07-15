import { useEffect, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { BrowserView, MobileView, isBrowser } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import { cn } from "@/lib/utils";

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

// Порог scrollspy: fixed-навбар (~100px) + запас до метки секции.
const SPY_OFFSET = 140;

// Липкий рейл-якорь (десктоп): все разделы — на одной странице, рейл ведёт по
// ним и подсвечивает текущий. Слушатель на window — только BrowserView
// (на мобайле window не скроллится, см. docs/ux-ui-guide.md).
const AccountNav = () => {
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    if (!isBrowser) return;

    const onScroll = () => {
      // У дна страницы последние секции не доезжают до верха — активна последняя
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      ) {
        setActive(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      let current = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= SPY_OFFSET) {
          current = section.id;
        }
      }
      setActive(current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (event, id) => {
    event.preventDefault();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    setActive(id);
  };

  return (
    <nav
      aria-label="Разделы настроек"
      className="tw:sticky tw:top-28 tw:flex tw:w-48 tw:flex-none tw:flex-col tw:gap-0.5"
    >
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => go(event, section.id)}
          aria-current={active === section.id ? "true" : undefined}
          className={cn(
            "tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-base tw:font-medium tw:no-underline tw:transition-colors",
            active === section.id
              ? "tw:bg-primary/15 tw:text-accent-text tw:hover:text-accent-text"
              : "tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground",
          )}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
};

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
          <AccountNav />
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
