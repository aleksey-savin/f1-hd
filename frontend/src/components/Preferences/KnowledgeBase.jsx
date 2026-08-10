import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";

import { MultiCombobox, toOptions } from "@/components/app/Combobox";
import SectionForm from "./SectionForm";

// «База знаний» (видна при включённом модуле): модерация, поиск секретов и
// отслеживание продления услуг. Включение сканов запускает их сразу (бэкенд).
const PrefsKnowledgeBase = ({ prefs }) => {
  const [moderators, setModerators] = useState(
    prefs.knowledgeBase?.moderators || [],
  );
  const [hideNotApproved, setHideNotApproved] = useState(
    !!prefs.knowledgeBase?.hideNotApproved,
  );
  const [approvalPeriodDays, setApprovalPeriodDays] = useState(
    prefs.knowledgeBase?.approvalPeriodDays ?? 0,
  );
  const [scanForSecrets, setScanForSecrets] = useState(
    !!prefs.knowledgeBase?.scanForSecrets,
  );
  const [trackServiceExpiry, setTrackServiceExpiry] = useState(
    !!prefs.knowledgeBase?.trackServiceExpiry,
  );
  const [serviceExpiryDays, setServiceExpiryDays] = useState(
    prefs.knowledgeBase?.serviceExpiryDays ?? 30,
  );

  // Кандидаты в модераторы — сотрудники с правами «видеть» и «управлять» базой
  const [candidates, setCandidates] = useState([]);
  useEffect(() => {
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/knowledge-base-moderators`,
      {},
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setCandidates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  return (
    <SectionForm
      buildPayload={() => ({
        knowledgeBase: {
          moderators,
          hideNotApproved,
          approvalPeriodDays: Number(approvalPeriodDays) || 0,
          scanForSecrets,
          trackServiceExpiry,
          serviceExpiryDays: Number(serviceExpiryDays) || 30,
        },
      })}
    >
      <SettingRow
        title="Модераторы"
        hint="Проверяют и одобряют заметки; разбирают очереди модерации."
        htmlFor="prefs-kb-moderators"
      >
        <div className="w-80 max-md:w-full">
          <MultiCombobox
            id="prefs-kb-moderators"
            placeholder="Выберите модераторов"
            value={(moderators || []).map((user) => String(user._id))}
            options={toOptions(candidates, {
              value: (user) => String(user._id),
              label: (user) =>
                `${user.lastName || ""} ${user.firstName || ""}`.trim(),
            })}
            onChange={(ids) =>
              setModerators(
                candidates
                  .filter((user) => ids.includes(String(user._id)))
                  .map((user) => ({
                    _id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                  })),
              )
            }
          />
        </div>
      </SettingRow>
      <SettingRow
        divider
        title="Скрывать непроверенные заметки"
        hint="Обычные пользователи видят только проверенное."
        htmlFor="prefs-kb-hide"
      >
        <Switch
          id="prefs-kb-hide"
          checked={hideNotApproved}
          onCheckedChange={setHideNotApproved}
        />
      </SettingRow>
      <SettingRow
        title="Срок действия проверки"
        hint="0 — проверка бессрочна."
        htmlFor="prefs-kb-approval-days"
      >
        <div className="flex items-center gap-2">
          <Input
            id="prefs-kb-approval-days"
            type="number"
            min="0"
            value={approvalPeriodDays}
            onChange={(event) => setApprovalPeriodDays(event.target.value)}
            className="w-24 text-right"
          />
          <span className="text-sm text-muted-foreground">дней</span>
        </div>
      </SettingRow>
      <SettingRow
        divider
        title="Искать секреты в заметках"
        hint="Пароли, ключи шифрования, API-ключи и другие чувствительные данные."
        htmlFor="prefs-kb-secrets"
      >
        <Switch
          id="prefs-kb-secrets"
          checked={scanForSecrets}
          onCheckedChange={setScanForSecrets}
        />
      </SettingRow>
      <SettingRow
        title="Отслеживать продление услуг"
        hint="Домены, хостинг и т. п. — по таблицам в заметках."
        htmlFor="prefs-kb-expiry"
      >
        <Switch
          id="prefs-kb-expiry"
          checked={trackServiceExpiry}
          onCheckedChange={setTrackServiceExpiry}
        />
      </SettingRow>
      <SettingRow
        title="Предупреждать о продлении за"
        htmlFor="prefs-kb-expiry-days"
        className={trackServiceExpiry ? "" : "opacity-60"}
      >
        <div className="flex items-center gap-2">
          <Input
            id="prefs-kb-expiry-days"
            type="number"
            min="1"
            disabled={!trackServiceExpiry}
            value={serviceExpiryDays}
            onChange={(event) => setServiceExpiryDays(event.target.value)}
            className="w-24 text-right"
          />
          <span className="text-sm text-muted-foreground">дней</span>
        </div>
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsKnowledgeBase;
