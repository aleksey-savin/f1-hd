const nodemailer = require("nodemailer");

const {
  buildImapConfig,
  buildSmtpOptions,
  buildMailFrom,
  describeMailError,
  mailboxLogin,
} = require("./transport");
const { connectMailbox } = require("./imapConnect");
const { MAILBOX, SMTP, recordOk, recordError } = require("./health");
const logger = require("../../utils/logger");
const { guardRecipient } = require("../../utils/mailGuard");

// Проверка почтовых каналов по кнопке в настройках. Возвращает ту же пару фраз,
// что и строка состояния: `state` — факт, `hint` — что делать.
//
// Успех записываем в health, неудачу — нет: проверяют обычно ЧЕРНОВИК настроек,
// и красная строка про неотправленный черновик врала бы о сохранённом канале.
// Успех же означает, что связка параметров рабочая, а реальные сбои сохранённого
// канала и так фиксируют крон сбора (раз в 20 с) и отправка уведомлений.

const closeQuietly = (connection) => {
  if (!connection) return;
  try {
    connection.end();
  } catch {
    // end() по мёртвому сокету бросает синхронно — глотаем
  }
};

const checkMailbox = async (mailbox = {}) => {
  const config = buildImapConfig(mailbox);
  const { host, port } = config.imap;
  const folder = (mailbox.folder || "").trim() || "INBOX";

  if (!host) {
    return { ok: false, state: "Не указан сервер IMAP", hint: "" };
  }
  if (!mailboxLogin(mailbox)) {
    return {
      ok: false,
      state: "Не указан адрес ящика",
      hint: "По адресу ящика идёт и вход на сервер.",
    };
  }

  let connection;
  try {
    // connectMailbox вместо imaps.connect: тот оставляет сорвавшееся соединение
    // без слушателя 'error' и роняет процесс (см. ./imapConnect).
    connection = await connectMailbox(config, { module: "mailCheck" });
    // Второй слой: сокетные ошибки уже установленного соединения ImapSimple
    // эмитит асинхронно; без слушателя Node роняет весь процесс, а try/catch
    // вокруг await такое не ловит.
    connection.on("error", (error) =>
      logger.log("warn", "IMAP check connection error (ignored)", {
        module: "mailCheck",
        error: error.message,
      }),
    );

    try {
      await connection.openBox(folder);
    } catch (error) {
      closeQuietly(connection);
      return {
        ok: false,
        state: `Папка «${folder}» не найдена`,
        hint: "Проверьте имя папки: у русских ящиков это чаще всего INBOX.",
        detail: error.message,
      };
    }

    // Только список UID, без выборки тел — проверке хватает.
    const unseen = await new Promise((resolve, reject) => {
      connection.imap.search(["UNSEEN"], (error, uids) =>
        error ? reject(error) : resolve(uids || []),
      );
    });

    closeQuietly(connection);
    const result = {
      ok: true,
      state: "Ящик доступен",
      hint: `Непрочитанных писем в папке «${folder}»: ${unseen.length}`,
    };
    await recordOk(MAILBOX);
    return result;
  } catch (error) {
    closeQuietly(connection);
    logger.log("warn", "Mailbox check failed", {
      module: "mailCheck",
      host,
      port,
      error: error.message,
    });
    return { ok: false, ...describeMailError(error, { host, port }), detail: error.message };
  }
};

const sendTestEmail = async (channel = {}, requestedTo) => {
  // Вне прода тестовое письмо тоже уходит только на разработческий ящик:
  // «без исключений» значит без исключений (см. utils/mailGuard)
  const to = guardRecipient(requestedTo, { module: "mailCheck" });
  const options = buildSmtpOptions(channel);
  const from = buildMailFrom(channel);

  if (!options.host) {
    return { ok: false, state: "Не указан сервер SMTP", hint: "" };
  }
  if (!from) {
    return {
      ok: false,
      state: "Не задан адрес отправителя",
      hint: "Заполните поле «Отправитель»: без корректного «От кого» сервер отвергнет письмо.",
    };
  }
  if (!to) {
    return {
      ok: false,
      state: "Некуда отправить тестовое письмо",
      hint: "У вашей учётной записи не указан адрес почты — заполните его в «Моём аккаунте».",
    };
  }

  const transport = nodemailer.createTransport(options);

  try {
    // verify() отделяет «сервер не пускает» от «сервер не принял письмо» —
    // это две разные подсказки для админа.
    await transport.verify();
  } catch (error) {
    logger.log("warn", "SMTP verify failed", {
      module: "mailCheck",
      host: options.host,
      port: options.port,
      error: error.message,
    });
    return {
      ok: false,
      ...describeMailError(error, { host: options.host, port: options.port }),
      detail: error.message,
    };
  }

  try {
    await transport.sendMail({
      from,
      to,
      subject: "Проверка почтовых уведомлений",
      text: "Канал почтовых уведомлений настроен верно — это письмо отправлено кнопкой проверки в настройках системы.",
      html: "<p>Канал почтовых уведомлений настроен верно — это письмо отправлено кнопкой проверки в настройках системы.</p>",
    });
  } catch (error) {
    logger.log("warn", "SMTP test send failed", {
      module: "mailCheck",
      host: options.host,
      to,
      error: error.message,
    });
    return {
      ok: false,
      ...describeMailError(error, { host: options.host, port: options.port }),
      detail: error.message,
    };
  }

  await recordOk(SMTP, { message: true });
  return {
    ok: true,
    state: "Тестовое письмо отправлено",
    hint: `Адресат — ${to}. Если письма нет, проверьте папку «Спам».`,
  };
};

module.exports = { checkMailbox, sendTestEmail };
