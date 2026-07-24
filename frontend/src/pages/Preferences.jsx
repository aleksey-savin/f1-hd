import { useContext } from "react";
import { useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import AnchorRail from "@/components/app/AnchorRail";

import PrefsGlobals from "../components/Preferences/Globals";
import PrefsTicketsCollect from "../components/Preferences/TicketsCollect";
import PrefsNotifications from "../components/Preferences/Notifications";
import PrefsModules from "../components/Preferences/Modules";
import PrefsIntegrations from "../components/Preferences/Integrations";
import PrefsAi from "../components/Preferences/Ai";
import PrefsKnowledgeBase from "../components/Preferences/KnowledgeBase";
import PrefsOvertime from "../components/Preferences/Overtime";

import Forbidden from "../components/Error/403";
import { getLocalStorageData } from "../util/auth";
import { AuthedUserContext } from "../store/authed-user-context";

// «Настройки системы»: одна страница вместо вкладок — секции-панели подряд,
// слева липкий рейл-якорь (канон «Мой аккаунт»). Каждая секция сохраняется
// отдельно (частичный POST /api/preferences — бэкенд меняет только присланную
// группу). Секции выключенных модулей не рендерятся и не оставляют пункт в
// рейле; после сохранения «Модулей» loader ревалидируется и состав секций
// обновляется сам.
const Preferences = () => {
  const { isAdmin } = useContext(AuthedUserContext);
  const prefs = useLoaderData() || {};

  if (!isAdmin) {
    return <Forbidden />;
  }

  const modules = prefs.modules || {};
  const sections = [
    { id: "globals", label: "Основные", element: <PrefsGlobals prefs={prefs} /> },
    {
      id: "tickets-collect",
      label: "Сбор заявок",
      element: <PrefsTicketsCollect prefs={prefs} />,
    },
    {
      id: "notifications",
      label: "Уведомления",
      element: <PrefsNotifications prefs={prefs} />,
    },
    {
      id: "ai",
      label: "Искусственный интеллект",
      // рейл тесный — в нём секция живёт коротким именем
      rail: "ИИ",
      element: <PrefsAi prefs={prefs} />,
    },
    {
      id: "integrations",
      label: "Интеграции",
      element: <PrefsIntegrations prefs={prefs} />,
    },
    { id: "modules", label: "Модули", element: <PrefsModules prefs={prefs} /> },
    ...(modules.knowledgeBase?.isActive
      ? [
          {
            id: "knowledge-base",
            label: "База знаний",
            element: <PrefsKnowledgeBase prefs={prefs} />,
          },
        ]
      : []),
    ...(modules.finances?.isActive
      ? [
          {
            id: "finances",
            label: "Финансы",
            element: <PrefsOvertime prefs={prefs} />,
          },
        ]
      : []),
  ];

  const panels = (
    <div className="tw:max-w-2xl tw:space-y-8">
      {sections.map(({ id, label, element }) => (
        <SettingsSection key={id} id={id} label={label}>
          {element}
        </SettingsSection>
      ))}
    </div>
  );

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <h1 className="tw:my-0 tw:mb-5 tw:text-4xl tw:leading-none tw:font-semibold tw:tracking-tight">
        Настройки системы
      </h1>
      <BrowserView>
        <div className="tw:flex tw:items-start tw:gap-7">
          <AnchorRail
            sections={sections.map(({ id, label, rail }) => ({
              id,
              label: rail ?? label,
            }))}
            ariaLabel="Разделы настроек"
          />
          <div className="tw:min-w-0 tw:flex-1">{panels}</div>
        </div>
      </BrowserView>
      <MobileView>{panels}</MobileView>
    </div>
  );
};

export default Preferences;

export async function loader() {
  document.title = "Настройки системы";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

// Сохранение секции: JSON-тело уходит на частичный POST /api/preferences.
// Часовой пояс после сохранения дублируется в localStorage (его читает
// util/format-date на каждой странице).
export async function action({ request }) {
  const { token } = getLocalStorageData();
  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return Response.json(
      { error: true, message: "Не удалось сохранить настройки" },
      { status: 200 },
    );
  }

  const data = await response.json();
  if (data.preferences?.timezone) {
    localStorage.setItem("timezone", data.preferences.timezone);
  }
  return Response.json(data);
}
