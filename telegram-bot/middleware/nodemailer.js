const nodemailer = require("nodemailer");

const logger = require("../utils/logger");
const {
  buildSmtpOptions,
  buildMailFrom,
  describeMailError,
} = require("../services/mail/transport");

// Отправка почтового уведомления. Транспорт (порт, режим шифрования, наличие
// авторизации, доверие самоподписанному сертификату) собирает общий билдер —
// раньше здесь были зашиты secure: isSecure и обязательный блок auth.
//
// Возвращает {success, failure}: failure — пара фраз для строки состояния
// канала в настройках, чтобы причина была видна без похода в журнал сервера.
exports.sendMail = async (creds, to, subject, text, html) => {
  const options = buildSmtpOptions(creds);
  const from = buildMailFrom(creds);

  if (!from) {
    logger.log("error", `Nodemailer: sender address is not configured`);
    return {
      success: false,
      failure: {
        state: "Не задан адрес отправителя",
        hint: "Заполните поле «Отправитель» в настройках уведомлений.",
      },
    };
  }

  try {
    const transport = nodemailer.createTransport(options);
    const message = await transport.sendMail({ from, to, subject, text, html });

    return { ...message, success: true };
  } catch (error) {
    logger.log("error", `Nodemailer failed to send email`, {
      host: options.host,
      port: options.port,
      error: error.message,
      stack: error.stack,
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
