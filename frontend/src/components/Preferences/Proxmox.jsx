import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Combobox from "@/components/app/Combobox";
import SettingRow from "@/components/app/SettingRow";
import Segmented from "@/components/app/Segmented";
import SectionForm from "./SectionForm";
import ProxmoxNetworks from "./ProxmoxNetworks";
import { useCan } from "@/store/authed-user";
const defaults = {
  cpuThreshold: 90,
  memoryThreshold: 90,
  storageWarning: 85,
  storageCritical: 95,
  thresholdMinutes: 5,
  autoTickets: false,
  exposureTicketsEnabled: false,
  cveMinSeverity: "high",
  applicantId: null,
  categoryId: null,
};
const thresholds = [
  [
    "cpuThreshold",
    "Загрузка CPU",
    "Нагрузка выше порога непрерывно в течение 10 минут",
  ],
  [
    "memoryThreshold",
    "Использование RAM",
    "Использование выше порога непрерывно в течение 10 минут",
  ],
  ["storageWarning", "Заполнение хранилища", "Уровень предупреждения"],
  [
    "storageCritical",
    "Критическое заполнение",
    "Должно быть выше уровня предупреждения",
  ],
];
export default function PrefsProxmox({ prefs }) {
  const can = useCan();
  const [values, setValues] = useState(() => ({
    ...defaults,
    ...prefs.proxmox,
  }));
  const set = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));
  const options = prefs.proxmoxOptions || { accounts: [], categories: [] };
  const accounts = options.accounts.map((account) => ({
    value: account._id,
    label:
      [account.firstName, account.lastName].filter(Boolean).join(" ") ||
      account.email ||
      account._id,
  }));
  const categories = options.categories.map((category) => ({
    value: category._id,
    label: category.title,
    disabled: category.isActive === false,
    hint: category.isActive === false ? "Категория выключена" : undefined,
  }));
  const selectedCategory = options.categories.find(
    (category) => category._id === values.categoryId,
  );
  const numberValid = (value, min, max, integer = false) =>
    value !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max &&
    (!integer || Number.isInteger(Number(value)));
  const reason = thresholds.some(([key]) => !numberValid(values[key], 1, 100))
    ? "Укажите пороги от 1 до 100%"
    : Number(values.storageCritical) <= Number(values.storageWarning)
      ? "Критический порог должен быть выше предупреждения"
      : !numberValid(values.thresholdMinutes, 1, 1440, true)
        ? "Укажите задержку от 1 до 1440 минут"
        : values.autoTickets
          ? !values.applicantId ||
            !accounts.some((account) => account.value === values.applicantId)
            ? "Выберите сервисный аккаунт"
            : !selectedCategory || selectedCategory.isActive === false
              ? "Выберите активную категорию заявки"
              : null
          : null;
  const payload = () => ({
    proxmox: {
      ...values,
      ...Object.fromEntries(
        thresholds.map(([key]) => [
          key,
          values[key] === "" ? "" : Number(values[key]),
        ]),
      ),
      thresholdMinutes:
        values.thresholdMinutes === "" ? "" : Number(values.thresholdMinutes),
    },
  });
  return (
    <SectionForm buildPayload={payload} blockedReason={reason}>
      <SettingRow
        title="Минимальная опасность CVE"
        hint="Общий порог для предупреждений и заявок. Все найденные CVE остаются в отчёте."
      >
        <Segmented
          options={[
            { value: "high", label: "High" },
            { value: "critical", label: "Critical" },
          ]}
          value={values.cveMinSeverity}
          onChange={(value) => set("cveMinSeverity", value)}
          ariaLabel="Минимальная опасность уязвимости"
        />
      </SettingRow>
      {prefs.modules?.mikrotik?.isActive && (
        <>
          <SettingRow
            title="Создавать заявки по проблемам ВМ с внешним доступом"
            hint="Требует включённых автоматических заявок Proxmox. Сам проброс порта заявку не создаёт."
            htmlFor="prefs-proxmox-exposure-tickets"
          >
            <Switch
              id="prefs-proxmox-exposure-tickets"
              checked={Boolean(values.exposureTicketsEnabled)}
              disabled={!values.autoTickets}
              onCheckedChange={(value) => set("exposureTicketsEnabled", value)}
            />
          </SettingRow>
          <ProxmoxNetworks
            value={values.networkLinks || []}
            onChange={(value) => set("networkLinks", value)}
            canEdit={
              can({ proxmox: ["manage"] }) && can({ mikrotik: ["read"] })
            }
          />
        </>
      )}
      {thresholds.map(([key, label, hint], index) => (
        <SettingRow
          key={key}
          htmlFor={`prefs-proxmox-${key}`}
          title={label}
          hint={hint}
          divider={index > 0}
        >
          <div className="flex items-center gap-2">
            <Input
              id={`prefs-proxmox-${key}`}
              type="number"
              min={1}
              max={100}
              className="w-24 text-right"
              value={values[key]}
              onChange={(event) => set(key, event.target.value)}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </SettingRow>
      ))}
      <SettingRow
        divider
        htmlFor="prefs-proxmox-autoTickets"
        title="Создавать заявку при проблеме"
        hint="Одна заявка на подтверждённый инцидент."
      >
        <Switch
          id="prefs-proxmox-autoTickets"
          checked={Boolean(values.autoTickets)}
          onCheckedChange={(value) =>
            setValues((current) => ({
              ...current,
              autoTickets: value,
              thresholdMinutes:
                !value && !numberValid(current.thresholdMinutes, 1, 1440, true)
                  ? numberValid(prefs.proxmox?.thresholdMinutes, 1, 1440, true)
                    ? prefs.proxmox.thresholdMinutes
                    : defaults.thresholdMinutes
                  : current.thresholdMinutes,
            }))
          }
        />
      </SettingRow>
      {values.autoTickets && (
        <>
          <SettingRow
            divider
            htmlFor="prefs-proxmox-applicant"
            title="Сервисный аккаунт"
            hint="Автор автоматических заявок и комментариев."
          >
            <div className="w-72 max-md:w-full">
              <Combobox
                id="prefs-proxmox-applicant"
                value={values.applicantId}
                options={accounts}
                placeholder="Выберите аккаунт"
                onChange={(value) => set("applicantId", value)}
              />
            </div>
          </SettingRow>
          <SettingRow
            divider
            htmlFor="prefs-proxmox-category"
            title="Категория заявки"
          >
            <div className="w-72 max-md:w-full">
              <Combobox
                id="prefs-proxmox-category"
                value={values.categoryId}
                options={categories}
                placeholder="Выберите категорию"
                onChange={(value) => set("categoryId", value)}
              />
            </div>
          </SettingRow>
          <SettingRow
            divider
            htmlFor="prefs-proxmox-delay"
            title="Проблема сохраняется дольше"
            hint="Задержка перед созданием заявки; мониторинг продолжает работать сразу."
          >
            <div className="flex items-center gap-2">
              <Input
                id="prefs-proxmox-delay"
                className="w-24 text-right"
                type="number"
                min={1}
                max={1440}
                value={values.thresholdMinutes}
                onChange={(event) =>
                  set("thresholdMinutes", event.target.value)
                }
              />
              <span className="text-sm text-muted-foreground">мин</span>
            </div>
          </SettingRow>
        </>
      )}
      <p className="border-t border-border-soft px-5 py-4 text-sm text-muted-foreground">
        Для ВМ используется назначенная компания. Для инфраструктуры и ВМ без
        компании — владелец подключения. Уведомления не содержат сведений о
        других арендаторах.
      </p>
    </SectionForm>
  );
}
