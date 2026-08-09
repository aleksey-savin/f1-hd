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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";

import Combobox, { toOptions } from "@/components/app/Combobox";
import useToastStore from "../../store/toast-store";
import { getLocalStorageData } from "../../util/auth";
import SectionForm from "./SectionForm";

// «Интеграции»: внешние сервисы уровня приложения. Mikrotik — самостоятельная
// интеграция (НЕ зависит от модуля «Учёт техники»): мастер-свитч isActive
// тушит всё разом — меню («Мониторинг», «Диапазоны сетей»), API (middleware
// mikrotikIsActive) и кроны бэкенда (services/mikrotik/enabled). Сервисный
// аккаунт — автор машинных заявок; не задан — авто-заявки не создаются.
const SEVERITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

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
    const { token } = getLocalStorageData();
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users/pro32-connected`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : { users: [] }))
      .then((data) => setConnected(data.users || []))
      .catch(() => {});
  };
  useEffect(loadConnected, []);

  const revokeHandler = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/users/pro32-revoke/${revokeTarget._id}`,
        { method: "POST", headers: { Authorization: "Bearer " + token } },
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

  // Отсутствие поля в старых документах = включено
  const [mikrotikOn, setMikrotikOn] = useState(
    prefs.mikrotik?.isActive !== false,
  );
  const [applicant, setApplicant] = useState(
    prefs.mikrotik?.applicant?._id ? prefs.mikrotik.applicant : null,
  );
  const [offline, setOffline] = useState(() => ({
    isActive: !!prefs.mikrotik?.offlineTicket?.isActive,
    thresholdMinutes: prefs.mikrotik?.offlineTicket?.thresholdMinutes ?? 15,
    categoryId: prefs.mikrotik?.offlineTicket?.categoryId || null,
  }));
  const [configChange, setConfigChange] = useState(() => ({
    isActive: !!prefs.mikrotik?.configChangeTicket?.isActive,
    categoryId: prefs.mikrotik?.configChangeTicket?.categoryId || null,
  }));
  const [security, setSecurity] = useState(() => ({
    isActive: !!prefs.mikrotik?.securityUpdateTicket?.isActive,
    minSeverity: prefs.mikrotik?.securityUpdateTicket?.minSeverity || "high",
    categoryId: prefs.mikrotik?.securityUpdateTicket?.categoryId || null,
  }));

  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    const { token } = getLocalStorageData();
    const headers = { Authorization: "Bearer " + token };
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`, {
      headers,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) =>
        setCategories(
          (Array.isArray(data) ? data : []).map((category) => ({
            value: category._id,
            label: category.title,
          })),
        ),
      )
      .catch(() => {});
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/form-data/service-accounts`,
      {
        headers,
      },
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const categoryOption = (categoryId) =>
    categories.find((option) => option.value === categoryId) || null;

  const categorySelect = (id, value, onChange, disabled) => (
    <div className="w-64 max-md:w-full">
      <Combobox
        id={id}
        placeholder="Без категории"
        clearable
        clearLabel="Без категории"
        disabled={disabled}
        value={categoryOption(value)?.value ?? null}
        options={categories}
        onChange={(next) => onChange(next || null)}
      />
    </div>
  );

  // Строки гаснут при выключенной интеграции; строки авто-заявок — ещё и при
  // выключенном собственном свитче блока
  const dim = (blockOn = true) =>
    mikrotikOn && blockOn ? "py-3" : "py-3 opacity-60";

  return (
    <SectionForm
      buildPayload={() => ({
        getScreen: { isActive: getScreenIsActive },
        mikrotik: {
          isActive: mikrotikOn,
          applicant: applicant?._id
            ? {
                _id: applicant._id,
                firstName: applicant.firstName,
                lastName: applicant.lastName,
              }
            : null,
          offlineTicket: {
            isActive: offline.isActive,
            thresholdMinutes: Number(offline.thresholdMinutes) || 15,
            categoryId: offline.categoryId,
          },
          configChangeTicket: configChange,
          securityUpdateTicket: security,
        },
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

      <div className="px-5 pt-4">
        <SubLabel>Mikrotik</SubLabel>
      </div>
      <SettingRow
        title="Мониторинг и управление устройствами Mikrotik"
        hint="Опрос устройств, конфигурации, прошивки и авто-заявки. Выключено — раздел «Мониторинг» скрыт, фоновые задачи остановлены."
        htmlFor="prefs-mikrotik-enabled"
        className="py-3"
      >
        <Switch
          id="prefs-mikrotik-enabled"
          checked={mikrotikOn}
          onCheckedChange={setMikrotikOn}
        />
      </SettingRow>
      <SettingRow
        title="Сервисный аккаунт"
        hint="Автор машинных заявок и комментариев. Не задан — авто-заявки не создаются."
        htmlFor="prefs-mikrotik-applicant"
        className={dim()}
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="prefs-mikrotik-applicant"
            placeholder="Выберите сервисный аккаунт"
            disabled={!mikrotikOn}
            value={applicant?._id ? String(applicant._id) : null}
            options={toOptions(accounts, {
              value: (account) => String(account._id),
              label: (account) =>
                `${account.lastName || ""} ${account.firstName || ""}`.trim(),
            })}
            onChange={(id) =>
              setApplicant(
                accounts.find((account) => String(account._id) === id) || null,
              )
            }
          />
        </div>
      </SettingRow>
      <SettingRow
        title="Заявка при недоступности"
        hint="Устройство офлайн дольше порога — одна заявка на эпизод."
        htmlFor="prefs-mikrotik-offline"
        className={dim()}
      >
        <Switch
          id="prefs-mikrotik-offline"
          disabled={!mikrotikOn}
          checked={offline.isActive}
          onCheckedChange={(value) =>
            setOffline((current) => ({ ...current, isActive: value }))
          }
        />
      </SettingRow>
      <SettingRow
        title="Порог недоступности"
        htmlFor="prefs-mikrotik-threshold"
        className={dim(offline.isActive)}
      >
        <div className="flex items-center gap-2">
          <Input
            id="prefs-mikrotik-threshold"
            type="number"
            min="1"
            disabled={!mikrotikOn || !offline.isActive}
            value={offline.thresholdMinutes}
            onChange={(event) =>
              setOffline((current) => ({
                ...current,
                thresholdMinutes: event.target.value,
              }))
            }
            className="w-24 text-right"
          />
          <span className="text-sm text-muted-foreground">мин</span>
        </div>
      </SettingRow>
      <SettingRow
        title="Категория заявки о недоступности"
        htmlFor="prefs-mikrotik-offline-category"
        className={dim(offline.isActive)}
      >
        {categorySelect(
          "prefs-mikrotik-offline-category",
          offline.categoryId,
          (categoryId) => setOffline((current) => ({ ...current, categoryId })),
          !mikrotikOn || !offline.isActive,
        )}
      </SettingRow>
      <SettingRow
        title="Заявка при изменении конфигурации"
        hint="Разница running-config между экспортами."
        htmlFor="prefs-mikrotik-config"
        className={dim()}
      >
        <Switch
          id="prefs-mikrotik-config"
          disabled={!mikrotikOn}
          checked={configChange.isActive}
          onCheckedChange={(value) =>
            setConfigChange((current) => ({ ...current, isActive: value }))
          }
        />
      </SettingRow>
      <SettingRow
        title="Категория заявки об изменении"
        htmlFor="prefs-mikrotik-config-category"
        className={dim(configChange.isActive)}
      >
        {categorySelect(
          "prefs-mikrotik-config-category",
          configChange.categoryId,
          (categoryId) =>
            setConfigChange((current) => ({ ...current, categoryId })),
          !mikrotikOn || !configChange.isActive,
        )}
      </SettingRow>
      <SettingRow
        title="Заявка при уязвимостях прошивки"
        hint="Одна сводная заявка с чек-листом на все устройства с опасной CVE, исправляемой обновлением."
        htmlFor="prefs-mikrotik-security"
        className={dim()}
      >
        <Switch
          id="prefs-mikrotik-security"
          disabled={!mikrotikOn}
          checked={security.isActive}
          onCheckedChange={(value) =>
            setSecurity((current) => ({ ...current, isActive: value }))
          }
        />
      </SettingRow>
      <SettingRow
        title="Минимальная опасность"
        hint="Общий порог для индикаторов мониторинга и заявки."
        className={dim(security.isActive)}
      >
        <Segmented
          options={SEVERITY_OPTIONS}
          value={security.minSeverity}
          onChange={(value) =>
            mikrotikOn &&
            security.isActive &&
            setSecurity((current) => ({ ...current, minSeverity: value }))
          }
          ariaLabel="Минимальная опасность уязвимости"
        />
      </SettingRow>
      <SettingRow
        title="Категория заявки об уязвимостях"
        htmlFor="prefs-mikrotik-security-category"
        className={dim(security.isActive)}
      >
        {categorySelect(
          "prefs-mikrotik-security-category",
          security.categoryId,
          (categoryId) =>
            setSecurity((current) => ({ ...current, categoryId })),
          !mikrotikOn || !security.isActive,
        )}
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsIntegrations;
