const { decryptSecret, isEncrypted } = require("../crypto/secretBox");

// Единственное место, знающее, как настройки почтового канала превращаются в
// конфиг imap-simple / nodemailer: порты по режиму шифрования, TLS, доверие
// самоподписанному сертификату, наличие авторизации. Раньше всё это было зашито
// в emailHandling (993/tls:true) и в nodemailer-обёртке (только secure).
//
// ВНИМАНИЕ: файл существует в двух точных копиях — backend/services/mail и
// telegram-bot/services/mail; копия ушла вместе с ботом, файл теперь один.
// Менять синхронно, как REPLY_MARKER.

// Дефолтные порты по режиму. Их же подставляет форма настроек при смене режима,
// поэтому пары обязаны совпадать с фронтендом (Preferences/MailChannelFields).
const IMAP_PORTS = { ssl: 993, starttls: 143, none: 143 };
const SMTP_PORTS = { ssl: 465, starttls: 587, none: 25 };

const defaultImapPort = (security) => IMAP_PORTS[security] || IMAP_PORTS.ssl;
const defaultSmtpPort = (security) => SMTP_PORTS[security] || SMTP_PORTS.ssl;

// Секреты лежат шифртекстом secretBox. Значения, сохранённые до ввода
// шифрования, читаются как есть — миграция и следующее сохранение настроек
// приводят их к общему виду.
const readSecret = (stored) => {
  if (!stored) return "";
  return isEncrypted(stored) ? decryptSecret(stored) : stored;
};

// Логином ящика служит его адрес — отдельного поля нет.
const mailboxLogin = (mailbox = {}) => (mailbox.address || "").trim();

// Конфиг imap-simple. ssl — TLS с первого байта; starttls — открытое соединение
// с обязательным апгрейдом; none — без шифрования (только внутренний сервер).
const buildImapConfig = (mailbox = {}) => {
  const security = mailbox.security || "ssl";
  const host = (mailbox.host || "").trim();
  const port = Number(mailbox.port) || defaultImapPort(security);

  const tlsOptions = { servername: host };
  if (mailbox.allowSelfSigned) {
    tlsOptions.rejectUnauthorized = false;
  }

  return {
    imap: {
      user: mailboxLogin(mailbox),
      password: readSecret(mailbox.password),
      host,
      port,
      tls: security === "ssl",
      // "required" вместо "always": при starttls незашифрованный фолбэк — это
      // молча отправленный по сети пароль, а не «повезло подключиться».
      autotls: security === "starttls" ? "required" : "never",
      tlsOptions,
      connTimeout: 15000, // установка TCP+TLS соединения
      authTimeout: 10000, // было 3000 — слишком жёстко для внешнего TLS
      // socketTimeout по умолчанию 0 (выключен). Без него «мёртвый» сокет в
      // середине команды висит вечно, и замок сбора почты залипает.
      socketTimeout: 30000,
      keepalive: true,
    },
  };
};

// Опции nodemailer.createTransport для канала уведомлений.
const buildSmtpOptions = (channel = {}) => {
  const security = channel.security || "ssl";
  const host = (channel.host || "").trim();
  const port = Number(channel.port) || defaultSmtpPort(security);

  const options = {
    host,
    port,
    secure: security === "ssl",
    // Без апгрейда на starttls письмо ушло бы открытым текстом; ignoreTLS для
    // «Нет» не даёт nodemailer'у пытаться шифровать там, где это не нужно.
    requireTLS: security === "starttls",
    ignoreTLS: security === "none",
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  };

  if (channel.allowSelfSigned) {
    options.tls = { rejectUnauthorized: false, servername: host };
  }

  // "none" — внутренний релей, принимающий почту без пароля: секция auth не
  // добавляется вовсе, иначе nodemailer попытается авторизоваться пустыми.
  if ((channel.authMethod || "password") !== "none") {
    options.auth = {
      user: (channel.user || "").trim(),
      pass: readSecret(channel.pass),
    };
  }

  return options;
};

// Поле «От кого». Без имени — только адрес: `"" <mail@…>` часть серверов
// отвергает как некорректный envelope.
const buildMailFrom = (channel = {}) => {
  const address = (channel.sendFromEmail || "").trim();
  const name = (channel.sendFromName || "").trim();
  if (!address) return "";
  return name ? `"${name}" <${address}>` : address;
};

// Ошибка соединения → фраза для строки состояния в настройках: `state` красится
// цветом и несёт факт, `hint` приглушён и говорит, что делать (канон «что
// случилось → почему могло → что делать» из ux-ui-guide).
const describeMailError = (error, { host, port } = {}) => {
  const where = [host, port].filter(Boolean).join(":");
  const code = error?.code || "";
  const text = `${error?.message || ""} ${error?.source || ""}`;

  if (code === "EAUTH" || error?.source === "authentication") {
    return {
      state: "Сервер отклонил пароль",
      hint: "Яндекс, Google и Mail.ru требуют пароль приложения — обычный пароль аккаунта они отвергают.",
    };
  }

  if (/self.signed|SELF_SIGNED|ALTNAME|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY/i.test(
    `${code} ${text}`,
  )) {
    return {
      state: "Сертификат сервера не прошёл проверку",
      hint: "Если это внутренний почтовый сервер, включите «Доверять самоподписанному сертификату».",
    };
  }

  if (code === "ENOTFOUND" || code === "EDNS") {
    return {
      state: `Сервер ${host || ""} не найден`.trim(),
      hint: "Проверьте адрес сервера — в нём опечатка или его не знает DNS.",
    };
  }

  if (code === "ECONNREFUSED") {
    return {
      state: `Соединение с ${where} отклонено`,
      hint: "Проверьте порт и режим шифрования: сервер не слушает этот порт.",
    };
  }

  if (code === "EENVELOPE") {
    return {
      state: "Сервер отклонил отправителя или получателя",
      hint: "Проверьте адрес в поле «Отправитель»: обычно он должен совпадать с учётной записью.",
    };
  }

  return {
    state: `Не удалось подключиться к ${where}`,
    hint: "Проверьте адрес сервера, порт и режим шифрования.",
  };
};

module.exports = {
  IMAP_PORTS,
  SMTP_PORTS,
  defaultImapPort,
  defaultSmtpPort,
  readSecret,
  mailboxLogin,
  buildImapConfig,
  buildSmtpOptions,
  buildMailFrom,
  describeMailError,
};
