const nodemailer = require("nodemailer");

const logger = require("@/utils/logger");
const { guardRecipient, guardSubject } = require("@/utils/mailGuard");
const { SecretUnreadableError } = require("@/helpers/preferencesSecrets");
const {
  buildSmtpOptions,
  buildMailFrom,
  describeMailError,
} = require("@/services/mail/transport");

/**
 * Отправка письма. Переехало из telegram-bot (`middleware/nodemailer.js`).
 *
 * Почта жила в телеграм-боте по историческим причинам и ни по каким другим: там
 * же крутился крон, разбиравший очередь уведомлений. Ценой был второй SMTP-клиент
 * в системе, вторая копия почтового слоя и — главное — необходимость держать на
 * той машине пароль от почтового ящика и `APP_ENC_KEY`, которым он
 * расшифровывается. Отправщик телеграма в этих секретах не нуждается.
 *
 * Транспорт (порт, режим шифрования, наличие авторизации, доверие
 * самоподписанному сертификату) собирает общий билдер `services/mail/transport`.
 *
 * Возвращает `{success, failure}`: `failure` — пара фраз для строки состояния
 * канала в настройках, чтобы причина была видна без похода в журнал сервера.
 * `retryable: false` — повтор бессмыслен (пароль SMTP не читается): очередь не
 * ждёт новых попыток, а сразу помечает письмо `failed` (services/mail/outbox).
 */
exports.sendMail = async (creds, to, subject, text, html) => {
  let options;
  try {
    options = buildSmtpOptions(creds);
  } catch (error) {
    // Другое (нет ключа шифрования — ошибка развёртывания) отказом отправки не
    // притворяется: бросок оставляет письмо в очереди до исправления, а не
    // хоронит его как неотправляемое.
    if (!(error instanceof SecretUnreadableError)) throw error;

    // Пароль не расшифровать: к серверу не обращаемся, и со второго раза он не
    // прочитается. Одна ограниченная строка — путь и причина расшифровки, без
    // шифртекста и без стека: письмо провалится сразу, повторов не будет.
    logger.log("error", "Не удалось отправить письмо: пароль SMTP не читается", {
      module: "mailSend",
      error: error.message,
    });
    return {
      success: false,
      retryable: false,
      failure: describeMailError(error),
    };
  }
  const from = buildMailFrom(creds);

  if (!from) {
    logger.log("error", "Не задан адрес отправителя", { module: "mailSend" });
    return {
      success: false,
      failure: {
        state: "Не задан адрес отправителя",
        hint: "Заполните поле «Отправитель» в настройках уведомлений.",
      },
    };
  }

  /**
   * Вне прода письмо не может уйти клиенту НИ ПРИ КАКИХ настройках в базе.
   *
   * Проверка стоит здесь второй раз намеренно: первый — в модели уведомления
   * (`models/notification.js`), у самого создания документа. Здесь она у самой
   * отправки, то есть последней дверью, и закрывает всё, что попадёт сюда мимо
   * очереди.
   */
  // `guardRecipient` отдаёт СТРОКУ — адрес, куда письмо уйдёт на самом деле
  // (тот же API, что у модели уведомления и у проверки канала). Прежняя
  // версия читала из результата поля `.to`/`.redirected`, которых нет:
  // получатель выходил undefined, и каждое письмо из очереди падало с
  // «No recipients defined» — тихо, потому что крон просто считал попытки.
  const actual = guardRecipient(to, { module: "mailSend" });
  const redirected = actual !== to;
  const finalSubject = redirected ? guardSubject(subject, to) : subject;

  try {
    const transport = nodemailer.createTransport(options);
    const message = await transport.sendMail({
      from,
      to: actual,
      subject: finalSubject,
      text: redirected
        ? `[Письмо предназначалось: ${to}]\n\n${text || ""}`
        : text,
      html: redirected
        ? `<p><b>Письмо предназначалось: ${to}</b></p>${html || ""}`
        : html,
    });

    return { ...message, success: true };
  } catch (error) {
    logger.log("error", "Не удалось отправить письмо", {
      module: "mailSend",
      host: options.host,
      port: options.port,
      error: error.message,
    });
    return {
      success: false,
      failure: describeMailError(error, {
        host: options.host,
        port: options.port,
      }),
    };
  }
};
