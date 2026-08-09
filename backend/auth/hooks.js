const Notification = require("@/models/notification");
const logger = require("@/utils/logger");

const config = require("./config");
// Ленивая ссылка: bootstrap требует этот файл сам, и статический импорт дал бы
// цикл с полузагруженным модулем.
const { getAuth } = require("./bootstrap");

/**
 * Колбэки better-auth, которым нужен прикладной код. Живут на стороне
 * CommonJS и передаются в ESM-остров параметрами.
 */

/**
 * ПЕРВОЕ письмо человеку или очередное — вопрос состояния, а не флага.
 *
 * Приглашение и восстановление уходят разными путями (magic-link и
 * request-password-reset), и пометить вызов можно только у одного из них:
 * второй метаданных не принимает. Флаг «сейчас приглашаем» в модуле был бы
 * гонкой, отметка времени — гаданием. Состояние отвечает точно: человек, у
 * которого ещё нет пароля и который ни разу не входил, ничего не
 * восстанавливает — ему открывают доступ впервые.
 */
const isFirstAccess = async (userId) => {
  const User = require("@/models/user");
  const user = await User.findById(userId).select("lastLogin").lean();
  if (!user || user.lastLogin) return false;

  const ctx = await getAuth().$context;
  const accounts = (await ctx.internalAdapter.findAccounts(String(userId))) || [];
  return !accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );
};

/** Обращение по имени; пустое — «Здравствуйте», а не голая запятая. */
const greet = (user) => user.firstName || user.name || "Здравствуйте";

const SIGNATURE = "<p>С уважением,<br />Команда F1Lab</p>";

const send = async (to, title, body) => {
  try {
    await new Notification({
      instrument: "email",
      to: { email: to },
      title,
      text: `<div>${body}${SIGNATURE}</div>`,
    }).save();
  } catch (error) {
    logger.log("error", "Не удалось поставить письмо в очередь", {
      title,
      error: error.message,
    });
    throw error;
  }
};


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
  const url = `${config.baseURL}/reset-password/${token}`;
  const first = await isFirstAccess(user.id);

  if (first) {
    // ПРИГЛАШЕНИЕ, а не восстановление: человек о портале ещё не знает, и
    // «Восстановление доступа» он читает как чужое письмо или как фишинг.
    return send(
      user.email,
      "Вам открыт доступ в портал F1Lab Helpdesk",
      `
        <p>${greet(user)},</p>
        <p>для вас создана учётная запись в портале поддержки F1Lab — через него
          отправляют заявки и следят за их выполнением.</p>
        <p><a href="${url}" target="_blank">Задайте пароль</a> — после этого
          входите по нему и рабочей почте.</p>
        <p>Ссылка действительна сутки и срабатывает один раз.</p>
      `,
    );
  }

  return send(
    user.email,
    "Восстановление доступа к порталу F1Lab Helpdesk",
    `
      <p>${greet(user)},</p>
      <p>сбросить пароль можно пройдя по <a href="${url}" target="_blank">ссылке</a>.</p>
      <p>Ссылка действительна 24 часа и срабатывает один раз.</p>
      <p>Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.</p>
    `,
  );
};

/**
 * Причина отказать в СЕАНСЕ — прикладные правила, которых better-auth не знает.
 *
 * Вызывается хуком `databaseHooks.session.create.before` на ЛЮБОМ способе
 * входа. Пока способ был один, эти проверки жили в `/api/login`; со ссылкой из
 * письма они бы там и остались, а сеанс выписывался бы мимо них.
 *
 * Отключённую учётку не проверяем — это делает плагин `admin` своим таким же
 * хуком, и они складываются.
 *
 * @returns {Promise<string|null>} текст отказа или null, если пускать можно
 */
const sessionRefusal = async (userId) => {
  const User = require("@/models/user");
  const user = await User.findById(userId)
    .select("isServiceAccount company.isActive")
    .lean();

  if (!user) return "Учётная запись не найдена";
  if (user.isServiceAccount) {
    return "Служебная учётная запись входит не паролем";
  }
  if (user.company?.isActive === false) {
    return "Учётная запись отключена. Обратитесь к администратору.";
  }
  return null;
};

/**
 * Письмо со ссылкой для входа.
 *
 * Как и восстановление, уходит документом `Notification`, а не прямым SMTP:
 * письма шлёт telegram-bot, а модель применяет `guardRecipient` — вне прода
 * получатель принудительно подменяется на разработческий ящик. Прямой вызов
 * SMTP обошёл бы защиту, и репетиция на копии прода разослала бы письма живым
 * клиентам.
 *
 * Ссылку берём ту, что дал плагин: у входа по ссылке своей страницы нет —
 * `/api/auth/magic-link/verify` сам ставит cookie и уводит на `callbackURL`.
 * Этим он отличается от восстановления, где страница нужна, чтобы человек
 * придумал пароль.
 */
const sendMagicLink = async ({ email, url }) => {
  const User = require("@/models/user");
  const user = await User.findOne({ email }).select("firstName lastLogin").lean();
  const first = user ? await isFirstAccess(user._id) : false;

  if (first) {
    return send(
      email,
      "Вам открыт доступ в портал F1Lab Helpdesk",
      `
        <p>${greet(user || {})},</p>
        <p>для вас создана учётная запись в портале поддержки F1Lab — через него
          вы отправляете заявки и видите, что с ними происходит.</p>
        <p><a href="${url}" target="_blank">Войти в портал</a> — пароль не
          понадобится.</p>
        <p>Ссылка действительна двое суток и срабатывает один раз. Если она
          истечёт, на странице входа нажмите «Прислать письмо».</p>
      `,
    );
  }

  return send(
    email,
    "Вход в портал F1Lab Helpdesk",
    `
      <p>${greet(user || {})},</p>
      <p>войти в портал можно по <a href="${url}" target="_blank">этой ссылке</a> —
        пароль не понадобится.</p>
      <p>Ссылка действительна 30 минут и срабатывает один раз.</p>
      <p>Если вы её не запрашивали, просто проигнорируйте это письмо: без
        перехода по ссылке ничего не произойдёт.</p>
    `,
  );
};

module.exports = {
  sendResetPassword,
  sendMagicLink,
  sessionRefusal,
  checkPasswordBreach,
};
