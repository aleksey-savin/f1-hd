import { useEffect, useState } from "react";

import { RiRefreshLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import HealthRow from "@/components/app/HealthRow";
import { SubLabel } from "@/components/app/Panel";

import Combobox, { toOptions } from "@/components/app/Combobox";
import SectionForm from "./SectionForm";
import MailChannelFields from "./MailChannelFields";
import { describeChannelHealth, describeCheckResult } from "./channel-health";

// «Сбор заявок»: почтовый ящик-приёмник (письма становятся заявками) и
// эвристики распознавания отправителя. Пока мастер-свитч выключен, поля
// погашены. Инициатор по умолчанию ставится машинным заявкам; его компания
// денормализуется в defaultCompany (инвариант «заявка без company» — см.
// контроллеры машинных каналов), и без него бэкенд не примет включённый сбор.
//
// Транспорт (порт, шифрование, папка, сертификат) — общий компонент
// MailChannelFields, состояние канала — строка HealthRow: её пишет крон сбора,
// поэтому она честна и без нажатия «Проверить».
const PrefsTicketsCollect = ({ prefs }) => {
  const [mailbox, setMailbox] = useState(() => ({
    isActive: !!prefs.mailbox?.isActive,
    address: prefs.mailbox?.address || "",
    host: prefs.mailbox?.host || "",
    port: prefs.mailbox?.port ?? 993,
    security: prefs.mailbox?.security || "ssl",
    folder: prefs.mailbox?.folder || "INBOX",
    allowSelfSigned: !!prefs.mailbox?.allowSelfSigned,
    // Пароль с сервера не приходит: пустое поле означает «не менять»
    password: "",
  }));
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

  const patch = (values) =>
    setMailbox((current) => ({ ...current, ...values }));

  // Проверка ящика: результат живёт до перезагрузки страницы и перекрывает
  // сохранённое состояние — он свежее.
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const runCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/preferences/mailbox/check`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mailbox }),
        },
      );
      if (!response.ok) throw new Error();
      setCheckResult(await response.json());
    } catch {
      setCheckResult({
        ok: false,
        state: "Не удалось выполнить проверку",
        hint: "Сервер приложения не ответил — попробуйте ещё раз.",
      });
    } finally {
      setChecking(false);
    }
  };

  // Сервисные аккаунты для «Инициатора по умолчанию»; сохранённое значение
  // остаётся выбираемым, даже если его нет в свежем списке
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/form-data/service-accounts`,
      {},
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((data) =>
        setAccounts(Array.isArray(data) ? data : data?.users || []),
      )
      .catch(() => {});
  }, []);

  const applicantOption = applicant
    ? accounts.find((account) => account._id === applicant._id) || applicant
    : null;

  const buildPayload = () => {
    const payload = {
      mailbox: { ...mailbox, port: Number(mailbox.port) || 993 },
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

  const on = mailbox.isActive;
  const dim = on ? "" : "opacity-60";

  const health = checking
    ? { state: "busy", title: "Проверяем ящик…" }
    : checkResult
      ? describeCheckResult(checkResult)
      : describeChannelHealth(prefs.mailbox?.health, { kind: "imap" });

  return (
    <SectionForm buildPayload={buildPayload}>
      <SettingRow
        title="Собирать заявки с почтового ящика"
        hint="Письма на этот ящик становятся заявками, переписка — комментариями."
        htmlFor="prefs-collect-enabled"
      >
        <Switch
          id="prefs-collect-enabled"
          checked={on}
          onCheckedChange={(value) => patch({ isActive: value })}
        />
      </SettingRow>

      {on && (
        <HealthRow
          {...health}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={runCheck}
            >
              <RiRefreshLine
                className={checking ? "animate-spin" : undefined}
              />
              Проверить
            </Button>
          }
        />
      )}

      <div className="px-5 pt-4">
        <SubLabel>Почтовый ящик</SubLabel>
      </div>
      <SettingRow
        title="Адрес ящика"
        hint="Он же логин при входе на сервер."
        htmlFor="prefs-collect-address"
        className={dim}
      >
        <Input
          id="prefs-collect-address"
          type="text"
          disabled={!on}
          value={mailbox.address}
          onChange={(event) => patch({ address: event.target.value })}
          className="w-72 max-md:w-full"
        />
      </SettingRow>

      <MailChannelFields
        kind="imap"
        idPrefix="prefs-collect"
        value={mailbox}
        onChange={patch}
        disabled={!on}
        passwordIsSet={!!prefs.mailbox?.passwordIsSet}
        className={dim}
      />

      <SettingRow
        title="Папка"
        hint="Откуда забирать письма."
        htmlFor="prefs-collect-folder"
        className={dim}
      >
        <Input
          id="prefs-collect-folder"
          type="text"
          disabled={!on}
          value={mailbox.folder}
          onChange={(event) => patch({ folder: event.target.value })}
          className="w-72 max-md:w-full"
        />
      </SettingRow>

      <SettingRow
        divider
        title="Инициатор по умолчанию"
        hint="Ставится машинным заявкам, когда отправитель не распознан; его компания становится компанией таких заявок."
        htmlFor="prefs-default-applicant"
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="prefs-default-applicant"
            placeholder="Выберите аккаунт"
            value={applicantOption?._id ? String(applicantOption._id) : null}
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

      <div className="px-5 pt-4">
        <SubLabel>Распознавание отправителя</SubLabel>
      </div>
      <SettingRow
        title="Определять компанию по почтовому домену"
        htmlFor="prefs-identify-company"
        className="py-3"
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
        className="py-3"
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
        className="py-3"
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
