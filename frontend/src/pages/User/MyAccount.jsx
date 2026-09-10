import { useEffect } from "react";
import { redirect, useBlocker, useFetcher, useLoaderData } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import SettingsSection from "@/components/app/SettingsSection";
import AnchorRail from "@/components/app/AnchorRail";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import DraftBar from "@/components/app/DraftBar";
import { DraftProvider, useDraft } from "@/components/app/draft-context";

import Profile from "../../components/User/AccountSettings/Profile";
import Appearance from "../../components/User/AccountSettings/Appearance";
import MySchedule from "../../components/User/AccountSettings/MySchedule";
import Notifications from "../../components/User/AccountSettings/Notifications";
import Integrations from "../../components/User/AccountSettings/Integrations";
import Security from "../../components/User/AccountSettings/Security";

import useToastStore from "../../store/toast-store";
import { getLocalStorageData } from "../../util/auth";

// Рейл ведёт только по реально отрисованным секциям: у клиента нет графика
const buildSections = (showSchedule) => [
  { id: "profile", label: "Профиль" },
  { id: "appearance", label: "Внешний вид" },
  ...(showSchedule ? [{ id: "schedule", label: "График и отсутствия" }] : []),
  { id: "notifications", label: "Уведомления" },
  { id: "integrations", label: "Интеграции" },
  { id: "security", label: "Безопасность" },
];

// Сохранение — одно на полотно, как в «Настройках системы»: «Профиль» и
// «Уведомления» пишут правки в черновик страницы (app/draft-context), а
// записывает их плашка внизу (app/DraftBar). «Внешний вид» в черновик не
// входит — масштаб и тема применяются сразу, побочных эффектов у них нет;
// «График», «Интеграции» и «Безопасность» живут диалогами и своими ручками.
const MyAccountCanvas = ({ user, initialPrefs, showSchedule }) => {
  const draft = useDraft();
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  const isSaving = fetcher.state !== "idle";
  const railSections = buildSections(showSchedule);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.message) return;

    showToast(fetcher.data.error ? "danger" : "success", fetcher.data.message);
    // Сохранилось — пересеиваем секции из ревалидированного loader'а: они
    // держат своё состояние с монтирования (см. pages/Preferences.jsx).
    if (!fetcher.data.error) draft.reset();
  }, [fetcher.state, fetcher.data]);

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

  const sections = (
    <div className="max-w-2xl space-y-8">
      {/* Ключ меняется только у сохранённых разделов. Остальные секции живут
          своей жизнью — у «Графика» открытая форма отсутствия, у «Интеграций»
          ожидание привязки бота, у «Безопасности» диалог смены пароля, — и
          ремоунтить их из-за чужого сохранения нельзя. */}
      <SettingsSection
        key={draft.sectionKey("profile")}
        id="profile"
        label="Профиль"
      >
        <Profile user={user} />
      </SettingsSection>
      <SettingsSection id="appearance" label="Внешний вид">
        <Appearance user={user} />
      </SettingsSection>
      {/* Клиенту норма часов и отпуска не положены — секции у него нет */}
      {showSchedule && (
        <SettingsSection id="schedule" label="График и отсутствия">
          <MySchedule user={user} />
        </SettingsSection>
      )}
      <SettingsSection
        key={draft.sectionKey("notifications")}
        id="notifications"
        label="Уведомления"
      >
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
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="my-0 mb-5 text-4xl leading-none font-semibold tracking-tight">
        Мой аккаунт
      </h1>
      <BrowserView>
        <div className="flex items-start gap-7">
          <AnchorRail
            sections={railSections.map((section) => ({
              ...section,
              dirty: dirtyIds.has(section.id),
            }))}
            ariaLabel="Разделы настроек"
          />
          <div className="min-w-0 flex-1">{sections}</div>
        </div>
      </BrowserView>
      <MobileView>{sections}</MobileView>

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

const MyAccount = () => {
  const { user, initialPrefs } = useLoaderData();

  return (
    <DraftProvider>
      <MyAccountCanvas
        user={user}
        initialPrefs={initialPrefs}
        showSchedule={!user.isEndUser}
      />
    </DraftProvider>
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
  );

  const initialPrefsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
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

const updateAccount = async (profile) =>
  fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(profile),
  });

export async function action({ request }) {
  // Черновик страницы приходит JSON'ом одним телом на профиль и уведомления:
  // ручка принимает частичный объект и трогает только присланные поля.
  // Остальные intent'ы — по-прежнему FormData: это разовые действия.
  if (request.headers.get("content-type")?.includes("application/json")) {
    const response = await updateAccount(await request.json());

    if (!response.ok) {
      const reason = await response
        .json()
        .then((data) => data?.message)
        .catch(() => null);

      return Response.json(
        { error: true, message: reason || "Не удалось сохранить настройки" },
        { status: 200 },
      );
    }

    return response;
  }

  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "integrations-update") {
    const response = await updateAccount({
      id: data.get("id"),
      telegramBot: {
        chatId: "",
        isActive: false,
      },
    });

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
        },
        body: JSON.stringify({
          code: data.get("code"),
          note: data.get("note") ?? "",
        }),
      },
    );
  }
}
