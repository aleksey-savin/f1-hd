import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import Segmented from "@/components/app/Segmented";

// Поля транспорта почтового канала — одни и те же у приёма (IMAP) и отправки
// (SMTP), поэтому один компонент на обе секции: сервер и порт, режим
// шифрования, пароль, доверие самоподписанному сертификату. Отличия каналов
// вынесены в пропсы, а не в копию разметки. У ящика-приёмника логином служит
// его адрес — отдельного поля нет; у SMTP имя пользователя своё, потому что
// с адресом отправителя оно совпадает не всегда.
//
// Дефолтные порты обязаны совпадать с backend/services/mail/transport.js.
const PORTS = {
  imap: { ssl: 993, starttls: 143, none: 143 },
  smtp: { ssl: 465, starttls: 587, none: 25 },
};

const SECURITY_OPTIONS = [
  { value: "ssl", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
  { value: "none", label: "Нет" },
];

const MailChannelFields = ({
  kind, // "imap" | "smtp"
  idPrefix,
  value,
  onChange,
  disabled = false,
  passwordIsSet = false,
  className = "",
}) => {
  const isSmtp = kind === "smtp";
  const defaults = PORTS[kind];
  const authOn = !isSmtp || (value.authMethod || "password") !== "none";

  // Смена режима подставляет типовой порт, но только если в поле стоял
  // дефолт прошлого режима — введённое руками не трогаем.
  const changeSecurity = (security) => {
    const wasDefault = Object.values(defaults).includes(Number(value.port));
    onChange({
      security,
      ...(wasDefault ? { port: defaults[security] } : {}),
    });
  };

  return (
    <>
      <SettingRow
        title={isSmtp ? "Сервер SMTP и порт" : "Сервер IMAP и порт"}
        htmlFor={`${idPrefix}-host`}
        className={className}
      >
        <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
          <Input
            id={`${idPrefix}-host`}
            type="text"
            disabled={disabled}
            value={value.host || ""}
            onChange={(event) => onChange({ host: event.target.value })}
            className="w-56 max-md:w-full"
          />
          <Input
            type="number"
            min="1"
            max="65535"
            disabled={disabled}
            value={value.port ?? defaults.ssl}
            onChange={(event) => onChange({ port: event.target.value })}
            className="w-24 text-right max-md:w-full"
            aria-label={isSmtp ? "Порт SMTP-сервера" : "Порт IMAP-сервера"}
          />
        </div>
      </SettingRow>

      <SettingRow title="Шифрование" className={className}>
        <Segmented
          ariaLabel={isSmtp ? "Режим шифрования SMTP" : "Режим шифрования IMAP"}
          options={SECURITY_OPTIONS}
          value={value.security || "ssl"}
          onChange={changeSecurity}
          disabled={disabled}
          className="w-72 max-md:w-full"
        />
      </SettingRow>

      {isSmtp && (
        <SettingRow
          title="Сервер требует авторизацию"
          hint="Выключите для внутреннего релея, который принимает почту без пароля."
          htmlFor={`${idPrefix}-auth`}
          className={className}
        >
          <Switch
            id={`${idPrefix}-auth`}
            disabled={disabled}
            checked={authOn}
            onCheckedChange={(on) =>
              onChange({ authMethod: on ? "password" : "none" })
            }
          />
        </SettingRow>
      )}

      {authOn && (
        <>
          {isSmtp && (
            <SettingRow
              title="Имя пользователя"
              htmlFor={`${idPrefix}-user`}
              className={className}
            >
              <Input
                id={`${idPrefix}-user`}
                type="text"
                disabled={disabled}
                value={value.user || ""}
                onChange={(event) => onChange({ user: event.target.value })}
                className="w-72 max-md:w-full"
              />
            </SettingRow>
          )}

          <SettingRow
            title="Пароль"
            hint={
              passwordIsSet
                ? "Хранится в зашифрованном виде. Оставьте пустым, чтобы не менять."
                : undefined
            }
            htmlFor={`${idPrefix}-password`}
            className={className}
          >
            <Input
              id={`${idPrefix}-password`}
              type="password"
              disabled={disabled}
              autoComplete="new-password"
              placeholder={passwordIsSet ? "••••••••  (задан)" : ""}
              value={value.password || ""}
              onChange={(event) => onChange({ password: event.target.value })}
              className="w-72 max-md:w-full"
            />
          </SettingRow>
        </>
      )}

      <SettingRow
        title="Доверять самоподписанному сертификату"
        hint="Только для внутренних серверов: проверка сертификата отключается."
        htmlFor={`${idPrefix}-selfsigned`}
        className={className}
      >
        <Switch
          id={`${idPrefix}-selfsigned`}
          disabled={disabled || value.security === "none"}
          checked={!!value.allowSelfSigned}
          onCheckedChange={(on) => onChange({ allowSelfSigned: on })}
        />
      </SettingRow>
    </>
  );
};

export default MailChannelFields;
