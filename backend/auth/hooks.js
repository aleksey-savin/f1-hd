const Notification = require("@/models/notification");
const { mailSignatureHtml } = require("@/services/brand");
const logger = require("@/utils/logger");

const accessEmails = require("./accessEmails");
const config = require("./config");
const {
  mayReceiveMagicLink,
  refuseMagicLinkSession,
} = require("./magicLinkPolicy");
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

/**
 * Письма авторизации уходят СРАЗУ, а не следующим тиком крона: человек стоит
 * у экрана и ждёт, и экран обязан честно сказать, ушло письмо или нет.
 * Документ `Notification` при этом создаётся как у всех — ради учёта и
 * режима почты (MAIL_MODE), — но В БАЗУ ПОПАДАЕТ УЖЕ С ИСХОДОМ: его
 * сохраняет `sendNow` после отправки. Сохранённый заранее документ крон
 * очереди успевал подхватить, пока шёл SMTP-обмен, и письмо уходило дважды.
 * Не ушло — бросаем: вызывающая ручка ответит ошибкой, а не «отправлено».
 *
 * Текст собирает `build` из auth/accessEmails.js; настройки читаются один раз
 * на письмо — из них и названия в тексте, и общая подпись (пустая подпись —
 * письмо без неё).
 */
const send = async (to, build, details) => {
  const Preferences = require("@/models/preferences");
  const preferences = await Preferences.findOne({}).lean();
  const { title, body } = build({ preferences, ...details });

  const notification = new Notification({
    instrument: "email",
    to: { email: to },
    title,
    text: `<div>${body}${mailSignatureHtml(preferences)}</div>`,
  });

  // Лениво: outbox тянет модели и почтовый слой, которым этот файл при
  // загрузке острова не нужен.
  const { sendNow } = require("@/services/mail/outbox");
  const result = await sendNow(notification);
  if (!result?.success) {
    throw new Error(result?.failure?.state || "Письмо не отправлено");
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
 * telegram-bot, а модель уведомления применяет `guardRecipient`: режим почты
 * задаёт MAIL_MODE, и в песочнице получатель подменяется. Прямой вызов SMTP
 * из колбэка обошёл бы эту защиту, и репетиция на копии прода разослала бы
 * письма живым клиентам.
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
    return send(user.email, accessEmails.passwordInvitation, { user, url });
  }

  return send(user.email, accessEmails.passwordReset, { user, url });
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
 * @param {string} userId
 * @param {string|null} [path] — путь ручки better-auth, которая выписывает
 *   сеанс (`ctx.path` хука); null — вызов вне ручки
 * @returns {Promise<string|null>} текст отказа или null, если пускать можно
 */
const sessionRefusal = async (userId, path = null) => {
  const User = require("@/models/user");
  const user = await User.findById(userId)
    .select(
      "isServiceAccount isAdmin isEndUser twoFactorEnabled company.isActive",
    )
    .lean();

  if (!user) return "Учётная запись не найдена";
  if (user.isServiceAccount) {
    return "Служебная учётная запись входит не паролем";
  }
  if (user.company?.isActive === false) {
    return "Учётная запись отключена. Обратитесь к администратору.";
  }

  // Вход по ссылке из письма — только клиенту без второго фактора. Ссылки,
  // выписанные до этого правила или мимо отправки, сотруднику сеанса не дают.
  const linkRefusal = refuseMagicLinkSession({ path, user });
  if (linkRefusal) return linkRefusal;

  /**
   * Обязательный второй фактор у администраторов.
   *
   * Проверка живёт ЗДЕСЬ, а не в контроллере входа, по той же причине, что и
   * остальные наши правила отказа: способов войти несколько (пароль, ссылка из
   * письма, подмена, что появится дальше), и правило, записанное в одном из
   * них, остальные обходят молча.
   *
   * До конца отсрочки не отказываем: иначе включение требования запирает
   * снаружи того, кто его включил.
   */
  if (user.isAdmin && !user.twoFactorEnabled) {
    const Preferences = require("@/models/preferences");
    const prefs = await Preferences.findOne({})
      .select("twoFactorPolicy")
      .lean();
    const policy = prefs?.twoFactorPolicy;
    const graceOver =
      !policy?.graceUntil || new Date(policy.graceUntil) < new Date();

    if (policy?.requireForAdmins && graceOver) {
      return "Для администраторов обязателен вход по коду из приложения. Обратитесь к другому администратору.";
    }
  }

  return null;
};

/**
 * Письмо со ссылкой для входа.
 *
 * Как и восстановление, уходит документом `Notification`, а не прямым SMTP:
 * письма шлёт services/mail/outbox, а модель применяет `guardRecipient`: режим
 * почты задаёт MAIL_MODE, и в песочнице получатель подменяется. Прямой вызов
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
  const user = await User.findOne({ email })
    .select(
      "firstName lastLogin isEndUser isServiceAccount banned banExpires twoFactorEnabled company.isActive",
    )
    .lean();

  /**
   * КОМУ ССЫЛКА ПОЛОЖЕНА, решает не плагин: он шлёт по любому известному
   * адресу. Только клиенту без второго фактора (auth/magicLinkPolicy.js);
   * остальным письма нет. Выписывает ссылку только серверный код
   * (приглашение, services/invitation.js): HTTP-ручка
   * `/api/auth/sign-in/magic-link` снаружи закрыта
   * (middleware/authPathAllowList.js).
   */
  if (!mayReceiveMagicLink(user)) {
    if (user) {
      logger.log(
        "warn",
        "Ссылка для входа не отправлена: учётной записи она не положена",
        { userId: String(user._id) },
      );
    }
    return;
  }

  const first = await isFirstAccess(user._id);

  if (first) {
    return send(email, accessEmails.linkInvitation, { user, url });
  }

  return send(email, accessEmails.signInLink, { user, url });
};

/**
 * Письмо с кодом («Войти по коду из письма» на экране входа).
 *
 * Тот же путь через `Notification`, что и у остальных писем: режим почты
 * задаёт MAIL_MODE, в песочнице получатель подменяется.
 *
 * ТИП КОДА ПРИВЯЗАН К ТИПУ АККАУНТА: клиенту — код для ВХОДА (`sign-in`),
 * сотруднику — код для СМЕНЫ ПАРОЛЯ (`forget-password`), после которого он
 * входит паролем и вторым фактором. Какой тип просить, решает
 * `controllers/auth.js`; проверка повторяется здесь на случай прямого вызова
 * ручки плагина: `POST /api/auth/email-otp/send-verification-otp` снаружи
 * закрыт списком (middleware/authPathAllowList.js), но открой его — он минует
 * наш гейт, и без этой проверки сотрудник получил бы код для входа, а с ним —
 * вход мимо пароля. Код без письма бесполезен, поэтому не слать его
 * достаточно.
 *
 * Остальные типы плагина (подтверждение почты, смена адреса) мы не просим;
 * такое письмо не отправляем вовсе.
 */
const sendEmailCode = async ({ email, otp, type }) => {
  const User = require("@/models/user");
  const user = await User.findOne({ email })
    .select("firstName name isEndUser")
    .lean();
  const isClient = user?.isEndUser !== false;
  const minutes = Math.round(config.loginCodeTtlSeconds / 60);

  if (type === "sign-in" && isClient) {
    return send(email, accessEmails.signInCode, { user, otp, minutes });
  }

  if (type === "forget-password" && !isClient) {
    return send(email, accessEmails.passwordCode, { user, otp, minutes });
  }

  logger.log("warn", "Код из письма не отправлен: тип не подходит аккаунту", {
    email,
    type,
  });
};

module.exports = {
  sendResetPassword,
  sendMagicLink,
  sendEmailCode,
  sessionRefusal,
  checkPasswordBreach,
};
