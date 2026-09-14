import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import Segmented from "@/components/app/Segmented";

import Combobox, { toOptions } from "@/components/app/Combobox";
import SectionForm from "./SectionForm";

// «Мониторинг Mikrotik»: настройки модуля. Секция есть, только пока модуль
// включён в «Модулях» — рубильник там (modules.mikrotik), а не здесь: он тушит
// меню, API (middleware mikrotikIsActive) и кроны (services/mikrotik/enabled).
// От «Учёта техники» модуль не зависит. Сервисный аккаунт — автор машинных
// заявок; не задан — авто-заявки не создаются.
const SEVERITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const PrefsMikrotik = ({ prefs }) => {
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
    const headers = {};
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

  // Строки авто-заявок гаснут при выключенном собственном свитче блока
  const dim = (blockOn) => (blockOn ? "py-3" : "py-3 opacity-60");

  return (
    <SectionForm
      buildPayload={() => ({
        mikrotik: {
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
      <SettingRow
        title="Сервисный аккаунт"
        hint="Автор машинных заявок и комментариев. Не задан — авто-заявки не создаются."
        htmlFor="prefs-mikrotik-applicant"
        className="py-3"
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="prefs-mikrotik-applicant"
            placeholder="Выберите сервисный аккаунт"
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
        className="py-3"
      >
        <Switch
          id="prefs-mikrotik-offline"
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
            disabled={!offline.isActive}
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
          !offline.isActive,
        )}
      </SettingRow>
      <SettingRow
        title="Заявка при изменении конфигурации"
        hint="Разница running-config между экспортами."
        htmlFor="prefs-mikrotik-config"
        className="py-3"
      >
        <Switch
          id="prefs-mikrotik-config"
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
          !configChange.isActive,
        )}
      </SettingRow>
      <SettingRow
        title="Заявка при уязвимостях прошивки"
        hint="Одна сводная заявка с чек-листом на все устройства с опасной CVE, исправляемой обновлением."
        htmlFor="prefs-mikrotik-security"
        className="py-3"
      >
        <Switch
          id="prefs-mikrotik-security"
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
          !security.isActive,
        )}
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsMikrotik;
