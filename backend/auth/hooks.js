const Notification = require("@/models/notification");
const logger = require("@/utils/logger");

const config = require("./config");

/**
 * Колбэки better-auth, которым нужен прикладной код. Живут на стороне
 * CommonJS и передаются в ESM-остров параметрами.
 */

/**
 * Проверка пароля по спискам утечек для ручек better-auth.
 *
 * Отдаёт готовое сообщение, а не число: остров не должен знать, как мы
 * формулируем отказ. Функция `checkBreached` подключается лениво — иначе
 * получится цикл require (bootstrap → hooks → passwordPolicy → bootstrap), и
 * `getAuth` придёт из полузагруженного модуля.
 */
const checkPasswordBreach = async (password) => {
  const { checkBreached, breachMessage } = require("@/services/passwordPolicy");
  const breach = await checkBreached(password);

  return breach.breached
    ? { breached: true, message: breachMessage(breach.count) }
    : { breached: false };
};

/**
 * Письмо восстановления пароля.
 *
 * Отправляем НЕ напрямую, а документом `Notification`: физически письма шлёт
 * telegram-bot, а модель уведомления применяет `guardRecipient` — вне прода
 * получатель принудительно подменяется на разработческий ящик. Прямой вызов
 * SMTP из колбэка обошёл бы эту защиту, и репетиция на копии прода разослала
 * бы письма живым клиентам.
 *
 * Ссылку строим свою, а не берём `url` из аргументов: better-auth ведёт по
 * своему адресу и оттуда редиректит на `redirectTo`, а у нас уже есть готовый
 * маршрут `/reset-password/:token`. Токен в обоих случаях один и тот же —
 * страница отдаёт его обратно в `POST /api/auth/reset-password`.
 */
const sendResetPassword = async ({ user, token }) => {
  const resetUrl = `${config.baseURL}/reset-password/${token}`;
  // Поля `name` у нас нет (см. спецификацию, этап 1), а `firstName` доезжает
  // сюда не всегда: better-auth отдаёт пользователя по своей схеме. Поэтому
  // обращение безличное, но не пустое — «,» одной запятой выглядит поломкой.
  const greeting = user.firstName || user.name || "Здравствуйте";
  try {
    await new Notification({
      instrument: "email",
      to: { email: user.email },
      title: "Восстановление доступа к порталу F1Lab Helpdesk",
      text: `
        <div>
          <p>${greeting},</p>
          <p>Сбросить пароль можно пройдя по <a href="${resetUrl}" target="_blank">ссылке</a>.</p>
          <p>Ссылка действительна 24 часа и срабатывает один раз.</p>
          <p>Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.</p>
          <p>С уважением,<br />Команда F1Lab</p>
        </div>
      `,
    }).save();
  } catch (error) {
    // Молча не проглатываем: человек ждёт письмо, которое не придёт.
    logger.log("error", "Не удалось поставить в очередь письмо восстановления", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

module.exports = { sendResetPassword, checkPasswordBreach };
