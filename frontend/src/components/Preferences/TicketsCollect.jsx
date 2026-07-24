import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
import SectionForm from "./SectionForm";

// «Сбор заявок»: почтовый ящик-приёмник (письма становятся заявками) и
// эвристики распознавания отправителя. Пока мастер-свитч выключен, поля
// погашены. Инициатор по умолчанию ставится машинным заявкам; его компания
// денормализуется в defaultCompany (инвариант «заявка без company» — см.
// контроллеры машинных каналов).
const PrefsTicketsCollect = ({ prefs }) => {
  const [useEmail, setUseEmail] = useState(!!prefs.useEmail);
  const [emailAddress, setEmailAddress] = useState(prefs.emailAddress || "");
  const [emailPassword, setEmailPassword] = useState(prefs.emailPassword || "");
  const [imapServer, setImapServer] = useState(prefs.imapServer || "");
  const [applicant, setApplicant] = useState(
    prefs.defaultApplicant?._id ? prefs.defaultApplicant : null,
  );
  const [identifyCompany, setIdentifyCompany] = useState(
    !!prefs.identifyCompany,
  );
  const [identifyApplicant, setIdentifyApplicant] = useState(
    !!prefs.identifyApplicant,
  );
  const [checkPhoneNumber, setCheckPhoneNumber] = useState(
    !!prefs.checkPhoneNumber,
  );

  // Сервисные аккаунты для «Инициатора по умолчанию»; сохранённое значение
  // остаётся выбираемым, даже если его нет в свежем списке
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    const { token } = getLocalStorageData();
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/form-data/service-accounts`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setAccounts(Array.isArray(data) ? data : data?.users || []))
      .catch(() => {});
  }, []);

  const applicantOption = applicant
    ? accounts.find((account) => account._id === applicant._id) || applicant
    : null;

  const buildPayload = () => {
    const payload = {
      useEmail,
      emailAddress,
      emailPassword,
      imapServer,
      identifyCompany,
      identifyApplicant,
      checkPhoneNumber,
    };
    if (applicant?._id) {
      payload.defaultApplicant = {
        _id: applicant._id,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
      };
      // Компания инициатора известна только у значения из списка; у
      // сохранённого объекта её нет — тогда defaultCompany не трогаем
      if (applicant.company?._id) {
        payload.defaultCompany = {
          _id: applicant.company._id,
          alias: applicant.company.alias,
        };
      }
    }
    return payload;
  };

  const dim = useEmail ? "" : "tw:opacity-60";

  return (
    <SectionForm buildPayload={buildPayload}>
      <SettingRow
        title="Собирать заявки с почтового ящика"
        hint="Письма на этот ящик становятся заявками, переписка — комментариями."
        htmlFor="prefs-collect-enabled"
      >
        <Switch
          id="prefs-collect-enabled"
          checked={useEmail}
          onCheckedChange={setUseEmail}
        />
      </SettingRow>
      <SettingRow divider title="Email" htmlFor="prefs-collect-email" className={dim}>
        <Input
          id="prefs-collect-email"
          type="text"
          disabled={!useEmail}
          value={emailAddress}
          onChange={(event) => setEmailAddress(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Пароль" htmlFor="prefs-collect-password" className={dim}>
        <Input
          id="prefs-collect-password"
          type="password"
          disabled={!useEmail}
          value={emailPassword}
          onChange={(event) => setEmailPassword(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
          autoComplete="new-password"
        />
      </SettingRow>
      <SettingRow title="IMAP-сервер" htmlFor="prefs-collect-imap" className={dim}>
        <Input
          id="prefs-collect-imap"
          type="text"
          disabled={!useEmail}
          value={imapServer}
          onChange={(event) => setImapServer(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow
        divider
        title="Инициатор по умолчанию"
        hint="Ставится машинным заявкам, когда отправитель не распознан; его компания становится компанией таких заявок."
        htmlFor="prefs-default-applicant"
      >
        <div className="tw:w-72 tw:max-md:w-full">
          <Select
            id="prefs-default-applicant"
            placeholder="Выберите аккаунт"
            closeMenuOnSelect
            isSearchable
            value={applicantOption}
            options={accounts}
            getOptionLabel={(option) =>
              `${option.lastName || ""} ${option.firstName || ""}`.trim()
            }
            getOptionValue={(option) => option._id}
            onChange={(option) => setApplicant(option || null)}
          />
        </div>
      </SettingRow>

      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Распознавание отправителя</SubLabel>
      </div>
      <SettingRow
        title="Определять компанию по почтовому домену"
        htmlFor="prefs-identify-company"
        className="tw:py-3"
      >
        <Switch
          id="prefs-identify-company"
          checked={identifyCompany}
          onCheckedChange={setIdentifyCompany}
        />
      </SettingRow>
      <SettingRow
        title="Определять инициатора по почтовому адресу"
        htmlFor="prefs-identify-applicant"
        className="tw:py-3"
      >
        <Switch
          id="prefs-identify-applicant"
          checked={identifyApplicant}
          onCheckedChange={setIdentifyApplicant}
        />
      </SettingRow>
      <SettingRow
        title="Искать номер телефона в теме письма"
        hint="Найденный номер сверяется со справочником пользователей."
        htmlFor="prefs-check-phone"
        className="tw:py-3"
      >
        <Switch
          id="prefs-check-phone"
          checked={checkPhoneNumber}
          onCheckedChange={setCheckPhoneNumber}
        />
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsTicketsCollect;
