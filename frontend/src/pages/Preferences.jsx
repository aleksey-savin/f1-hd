import { useEffect } from "react";
import { useBlocker, useFetcher, useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import AnchorRail from "@/components/app/AnchorRail";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import DraftBar from "@/components/app/DraftBar";
import { DraftProvider, useDraft } from "@/components/app/draft-context";

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
import useToastStore from "../store/toast-store";

import { api } from "@/lib/api";

// «Настройки системы»: одна страница вместо вкладок — секции-панели подряд,
// слева липкий рейл-якорь (канон «Мой аккаунт»). Секции выключенных модулей не
// рендерятся и не оставляют пункт в рейле.
//
// Сохранение — одно на полотно: секции пишут свои правки в черновик страницы
// (app/draft-context), а записывает их плашка внизу (app/DraftBar). Пока правок
// нет, кнопки сохранения на странице нет вовсе. Уходит один частичный POST — и
// только с теми ключами, которые реально изменились, поэтому роль без права на
// соседнюю группу не ловит на ней отказ.
const PreferencesCanvas = ({ sections }) => {
  const draft = useDraft();
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;

    showToast(fetcher.data.error ? "danger" : "success", fetcher.data.message);
    // Сохранилось — пересеиваем секции из ревалидированного loader'а: они
    // держат своё состояние с монтирования, и без ремоунта на экране осталась
    // бы прежняя копия. fetcher становится idle уже после ревалидации, так что
    // данные к этому моменту свежие, а revalidate() руками звать не нужно.
    if (!fetcher.data.error) draft.reset();
  }, [fetcher.state, fetcher.data]);

  // Уход со страницы с несохранёнными правками: роутер данных блокирует
  // переход, закрытие вкладки перехватывает beforeunload.
  const blocker = useBlocker(() => draft.isDirty);

  useEffect(() => {
    if (!draft.isDirty) return undefined;

    const handler = (event) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft.isDirty]);

  const saveHandler = () => {
    const payload = draft.buildPayload();
    if (Object.keys(payload).length === 0) return;

    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  const dirtyIds = new Set(draft.sections.map((section) => section.id));
  const dirtyNames = draft.sections
    .map((section) => `«${section.label}»`)
    .join(", ");

  const panels = (
    <div className="max-w-2xl space-y-8">
      {sections.map(({ id, label, element }) => (
        // Ключ меняется только у сохранённых разделов — соседей не ремоунтим:
        // у них свои незавершённые дела (результат «Проверить», раскрытый блок)
        <SettingsSection key={draft.sectionKey(id)} id={id} label={label}>
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
              dirty: dirtyIds.has(id),
            }))}
            ariaLabel="Разделы настроек"
          />
          <div className="min-w-0 flex-1">{panels}</div>
        </div>
      </BrowserView>
      <MobileView>{panels}</MobileView>

      <DraftBar
        sections={draft.sections}
        isSaving={isSaving}
        blockedReason={draft.blockedReason}
        onSave={saveHandler}
        onReset={draft.reset}
      />

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title="Уйти без сохранения?"
        description={`Правки в ${
          draft.sections.length === 1 ? "разделе" : "разделах"
        } ${dirtyNames} пропадут.`}
        confirmLabel="Уйти"
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
};

/**
 * Настройки — одно право (`settings.manage`): секции по правам не делятся
 * (спека 2026-09-11). Раньше страницу целиком закрывал `isAdmin`, затем у
 * секций были разные права — обе схемы уступили место одной: у кого есть
 * доступ к настройкам, тот видит и меняет их все, сервер это же право и
 * проверяет (`routes/internal/preferences.js`).
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
    general && {
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
    general && {
      id: "notifications",
      label: "Уведомления",
      element: <PrefsNotifications prefs={prefs} />,
    },
    general && {
      id: "ai",
      label: "Искусственный интеллект",
      // рейл тесный — в нём секция живёт коротким именем
      rail: "ИИ",
      element: <PrefsAi prefs={prefs} />,
    },
    general && {
      id: "integrations",
      label: "Интеграции",
      element: <PrefsIntegrations prefs={prefs} />,
    },
    general && {
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

  // Маршрут уже требует settings.manage (RouteGuard); проверка здесь — на
  // случай прямого захода мимо гварда, а не рабочий сценарий для роли.
  if (!sections.length) {
    return <Forbidden />;
  }

  return (
    <DraftProvider>
      <PreferencesCanvas sections={sections} />
    </DraftProvider>
  );
};

export default Preferences;

export async function loader() {
  document.title = "Настройки системы";

  return api(`/api/preferences`);
}

// Сохранение черновика: JSON-тело уходит на частичный POST /api/preferences —
// бэкенд трогает только присланные группы. Часовой пояс после сохранения
// дублируется в localStorage (его читает util/format-date на каждой странице).
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
