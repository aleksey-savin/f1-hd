import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import useToastStore from "../../store/toast-store";
import McpKeys from "./McpKeys";
import SectionForm from "./SectionForm";

// «Интеграции»: внешние сервисы уровня приложения. Mikrotik отсюда ушёл в
// модули (2026-09-14): рубильник — «Модули», настройки — своя секция
// «Мониторинг Mikrotik» (Preferences/Mikrotik.jsx). Ключи ИИ-агентов
// (McpKeys) переехали сюда из «База знаний» (2026-09-18): ключ открывает не
// только базу знаний, и блок должен оставаться видимым даже с выключенным
// модулем «База знаний» — отозвать ключ можно всегда.
const PrefsIntegrations = ({ prefs }) => {
  const { showToast } = useToastStore();

  const [getScreenIsActive, setGetScreenIsActive] = useState(
    !!prefs.getScreen?.isActive,
  );

  // Пользователи с персональным ключом PRO32 (сам ключ бэкенд не отдаёт);
  // отзыв стирает ключ — операция над пользователем, выполняется сразу, без
  // «Сохранить» секции
  const [connected, setConnected] = useState([]);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const loadConnected = () => {
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users/pro32-connected`)
      .then((response) => (response.ok ? response.json() : { users: [] }))
      .then((data) => setConnected(data.users || []))
      .catch(() => {});
  };
  useEffect(loadConnected, []);

  const revokeHandler = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/users/pro32-revoke/${revokeTarget._id}`,
        { method: "POST", headers: {} },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Не удалось отключить");
      }
      showToast("success", data.message);
      setConnected((current) =>
        current.filter((user) => user._id !== revokeTarget._id),
      );
    } catch (error) {
      showToast("danger", error.message);
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

  return (
    <SectionForm
      buildPayload={() => ({
        getScreen: { isActive: getScreenIsActive },
      })}
    >
      <div className="px-5 pt-4">
        <SubLabel>PRO32 Connect</SubLabel>
      </div>
      <SettingRow
        title="Удалённое подключение к клиентам"
        hint="Кнопка подключения к компьютеру клиента в заявке. Сессию создаёт пользователь своим API-ключом — каждому нужно завести ключ и указать его в форме пользователя."
        htmlFor="prefs-pro32"
        className="py-3"
      >
        <Switch
          id="prefs-pro32"
          checked={getScreenIsActive}
          onCheckedChange={setGetScreenIsActive}
        />
      </SettingRow>
      <SettingRow
        title="Подключённые пользователи"
        hint="У кого задан персональный API-ключ. «Отключить» стирает ключ — для повторного подключения понадобится новый."
        className="py-3"
      />
      <div className="mx-5 mb-4 overflow-hidden rounded-lg border border-border-soft">
        {connected.map((user) => (
          <div
            key={user._id}
            className="flex items-center gap-3 border-t border-border-soft px-3.5 py-1.5 first:border-t-0"
          >
            <span
              className={
                user.banned
                  ? "min-w-0 flex-1 truncate text-sm opacity-60"
                  : "min-w-0 flex-1 truncate text-sm"
              }
            >
              {user.lastName} {user.firstName}
              {user.company?.alias && (
                <span className="text-muted-foreground">
                  {" "}
                  · {user.company.alias}
                </span>
              )}
              {user.banned && (
                <span className="text-muted-foreground"> · отключён</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevokeTarget(user)}
              className="flex-none text-destructive hover:text-destructive"
            >
              Отключить
            </Button>
          </div>
        ))}
        {connected.length === 0 && (
          <div className="px-3.5 py-3 text-sm text-muted-foreground">
            Ни у кого не подключено — ключи заводятся в форме пользователя.
          </div>
        )}
      </div>

      <McpKeys
        scanForSecrets={Boolean(prefs.knowledgeBase?.scanForSecrets)}
        knowledgeModuleOn={Boolean(prefs.modules?.knowledgeBase?.isActive)}
      />

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Отключить PRO32 Connect у{" "}
              {revokeTarget
                ? `${revokeTarget.lastName} ${revokeTarget.firstName}`
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              API-ключ будет удалён безвозвратно. Для повторного подключения
              понадобится завести новый ключ в форме пользователя.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={revoking}
              onClick={revokeHandler}
            >
              {revoking ? "Отключение…" : "Отключить"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionForm>
  );
};

export default PrefsIntegrations;
