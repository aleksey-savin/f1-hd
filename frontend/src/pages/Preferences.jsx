import { useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import AnchorRail from "@/components/app/AnchorRail";

import PrefsGlobals from "../components/Preferences/Globals";
import PrefsSecurity from "../components/Preferences/Security";
import PrefsTickets from "../components/Preferences/Tickets";
import PrefsTicketsCollect from "../components/Preferences/TicketsCollect";
import PrefsNotifications from "../components/Preferences/Notifications";
import PrefsModules from "../components/Preferences/Modules";
import PrefsIntegrations from "../components/Preferences/Integrations";
import PrefsAi from "../components/Preferences/Ai";
import PrefsKnowledgeBase from "../components/Preferences/KnowledgeBase";
import PrefsOvertime from "../components/Preferences/Overtime";
import PrefsProductionCalendar from "../components/Preferences/ProductionCalendar";

import Forbidden from "../components/Error/403";
import { useCan } from "@/store/authed-user";

import { api } from "@/lib/api";

// «Настройки системы»: одна страница вместо вкладок — секции-панели подряд,
// слева липкий рейл-якорь (канон «Мой аккаунт»). Каждая секция сохраняется
// отдельно (частичный POST /api/preferences — бэкенд меняет только присланную
// группу). Секции выключенных модулей не рендерятся и не оставляют пункт в
// рейле; после сохранения «Модулей» loader ревалидируется и состав секций
// обновляется сам.
/**
 * Секции настроек показываем ПО ПРАВАМ, а не по признаку администратора.
 *
 * Раньше страницу целиком закрывал один `isAdmin`, и поручить кому-то почту
 * значило отдать заодно ключи интеграций и политику входа. Теперь у секций
 * разные права, и человек видит ровно те, что может менять; сервер проверяет
 * каждую присланную секцию отдельно (`controllers/preferences.js`).
 */
const Preferences = () => {
  const prefs = useLoaderData() || {};
  const can = useCan();

  const modules = prefs.modules || {};
  const general = can({ settings: ["manage"] });
  const sections = [
    general && {
      id: "globals",
      label: "Основные",
      element: <PrefsGlobals prefs={prefs} />,
    },
    can({ settings: ["manageMail"] }) && {
      id: "tickets-collect",
      label: "Сбор заявок",
      element: <PrefsTicketsCollect prefs={prefs} />,
    },
    // «Сбор заявок» — про то, как заявки приходят; «Заявки» — про то, как за
    // ними следят: срок, чек-листы, правила среза «давно без движения».
    general && {
      id: "tickets",
      label: "Заявки",
      element: <PrefsTickets prefs={prefs} />,
    },
    can({ settings: ["manageMail"] }) && {
      id: "notifications",
      label: "Уведомления",
      element: <PrefsNotifications prefs={prefs} />,
    },
    can({ settings: ["manageIntegrations"] }) && {
      id: "ai",
      label: "Искусственный интеллект",
      // рейл тесный — в нём секция живёт коротким именем
      rail: "ИИ",
      element: <PrefsAi prefs={prefs} />,
    },
    can({ settings: ["manageIntegrations"] }) && {
      id: "integrations",
      label: "Интеграции",
      element: <PrefsIntegrations prefs={prefs} />,
    },
    can({ settings: ["manageSecurity"] }) && {
      id: "security",
      label: "Безопасность",
      element: <PrefsSecurity prefs={prefs} />,
    },
    general && {
      id: "modules",
      label: "Модули",
      element: <PrefsModules prefs={prefs} />,
    },
    general &&
      modules.knowledgeBase?.isActive && {
        id: "knowledge-base",
        label: "База знаний",
        element: <PrefsKnowledgeBase prefs={prefs} />,
      },
    general &&
      modules.finances?.isActive && {
        id: "finances",
        label: "Финансы",
        element: <PrefsOvertime prefs={prefs} />,
      },
    // Календарь нужен норме часов и переработкам, поэтому модулем не закрыт:
    // отпуска и графики ведутся и без учёта времени
    general && {
      id: "production-calendar",
      label: "Производственный календарь",
      element: <PrefsProductionCalendar prefs={prefs} />,
    },
  ].filter(Boolean);

  // Право «видеть настройки» открывает страницу, но менять может быть нечего:
  // так бывает у роли, которой оставили только чтение.
  if (!sections.length) {
    return <Forbidden />;
  }

  const panels = (
    <div className="max-w-2xl space-y-8">
      {sections.map(({ id, label, element }) => (
        <SettingsSection key={id} id={id} label={label}>
          {element}
        </SettingsSection>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="my-0 mb-5 text-4xl leading-none font-semibold tracking-tight">
        Настройки системы
      </h1>
      <BrowserView>
        <div className="flex items-start gap-7">
          <AnchorRail
            sections={sections.map(({ id, label, rail }) => ({
              id,
              label: rail ?? label,
            }))}
            ariaLabel="Разделы настроек"
          />
          <div className="min-w-0 flex-1">{panels}</div>
        </div>
      </BrowserView>
      <MobileView>{panels}</MobileView>
    </div>
  );
};

export default Preferences;

export async function loader() {
  document.title = "Настройки системы";

  return api(`/api/preferences`);
}

// Сохранение секции: JSON-тело уходит на частичный POST /api/preferences.
// Часовой пояс после сохранения дублируется в localStorage (его читает
// util/format-date на каждой странице).
export async function action({ request }) {
  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    // Бэкенд отвечает 422 с человекочитаемой причиной («Укажите сервер IMAP…»)
    // — она полезнее общей фразы, поэтому показываем её как есть.
    const reason = await response
      .json()
      .then((data) => data?.message)
      .catch(() => null);

    return Response.json(
      { error: true, message: reason || "Не удалось сохранить настройки" },
      { status: 200 },
    );
  }

  const data = await response.json();
  if (data.preferences?.timezone) {
    localStorage.setItem("timezone", data.preferences.timezone);
  }
  return Response.json(data);
}
