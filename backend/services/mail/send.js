const nodemailer = require("nodemailer");

const logger = require("@/utils/logger");
const { guardRecipient, guardSubject } = require("@/utils/mailGuard");
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
 */
exports.sendMail = async (creds, to, subject, text, html) => {
  const options = buildSmtpOptions(creds);
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
  const guarded = guardRecipient(to);
  const finalSubject = guarded.redirected
    ? guardSubject(subject, guarded.intended)
    : subject;

  try {
    const transport = nodemailer.createTransport(options);
    const message = await transport.sendMail({
      from,
      to: guarded.to,
      subject: finalSubject,
      text: guarded.redirected
        ? `[Письмо предназначалось: ${guarded.intended}]\n\n${text || ""}`
        : text,
      html: guarded.redirected
        ? `<p><b>Письмо предназначалось: ${guarded.intended}</b></p>${html || ""}`
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
