const Preferences = require("@/models/preferences");

const { AppError } = require("@/middleware/errorHandling");
const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const { checkBreached, policy } = require("@/services/passwordPolicy");

/**
 * Профиль текущего пользователя, его эффективные права, рубильники модулей и
 * настройки — одним запросом.
 *
 * Заменяет пару `/api/users/:id` + `/api/preferences-initial`, которую дёргал
 * корневой загрузчик фронтенда. Смысл не в экономии запроса, а в том, что
 * `/api/users/:id` перестаёт быть источником собственного профиля: это ручка
 * про ДРУГИХ людей, и именно её чёрный список полей однажды не вырезал
 * `notifications` с сырым токеном восстановления.
 *
 * Список полей здесь БЕЛЫЙ. Добавлять в него что-то надо осознанно.
 */

const publicUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  position: user.position,
  profileImagePath: user.profileImagePath,
  backgroundImagePath: user.backgroundImagePath,
  company: user.company,
  subdivision: user.subdivision,
  responsibleForCompanies: user.responsibleForCompanies,
  categories: user.categories,
  isAdmin: Boolean(user.isAdmin),
  isEndUser: user.isEndUser !== false,
  isCloudTelephony: Boolean(user.isCloudTelephony),
  hideWorkStatus: Boolean(user.hideWorkStatus),
  workStatus: user.workStatus,
  workTimeMode: user.workTimeMode,
  timezone: user.timezone,
  notify: user.notify,
  telegramBot: {
    isActive: Boolean(user.telegramBot?.isActive),
  },
  twoFactorEnabled: Boolean(user.twoFactorEnabled),
  emailVerified: Boolean(user.emailVerified),
  lastLogin: user.lastLogin,
});

exports.getMe = async (req, res, next) => {
  try {
    const { user, permissions, statements, session } = req.auth;
    const preferences = await Preferences.findOne({});

    res.status(200).json({
      user: publicUser(user),
      // Два вида одного и того же, оба нужны и оба дёшевы:
      //   `statements` — язык словаря, по нему работает `can()` во фронте;
      //   `permissions` — плоская карта, по ней рисуется меню и списки галочек
      //   в форме пользователя, где ключи и подписи идут парами.
      statements,
      permissions,
      modules: preferences?.modules || {},
      prefs: {
        contacts: preferences?.contacts,
        timezone: preferences?.timezone,
        getScreen: preferences?.getScreen,
        mikrotik: { isActive: Boolean(preferences?.mikrotik?.isActive) },
      },
      // Идентификатор текущего сеанса нужен разделу «Активные сеансы», чтобы
      // пометить «это устройство».
      sessionId: session?.id || null,
    });
  } catch (error) {
    next(new AppError("Не удалось получить профиль", 500, true, error));
  }
};

/**
 * Проверка пароля для живой подсказки в форме.
 *
 * Ручка есть, чтобы человек видел причину отказа ДО отправки, а не после.
 * Пароль сюда приходит и никуда дальше не уходит: наружу летят только первые
 * пять символов его SHA1 (k-анонимность), в базу он не пишется, в журнал не
 * попадает.
 *
 * За `requireAuth` и с отдельным лимитером: это не оракул для перебора чужих
 * паролей — проверяется тот, что человек прямо сейчас печатает у себя.
 */
exports.checkPassword = async (req, res, next) => {
  try {
    const password = String(req.body?.password || "");
    const { minLength, maxLength } = await policy();

    if (password.length < minLength) {
      return res.status(200).json({
        ok: false,
        reason: "short",
        minLength,
        missing: minLength - password.length,
      });
    }
    if (password.length > maxLength) {
      return res.status(200).json({ ok: false, reason: "long", maxLength });
    }

    const breach = await checkBreached(password);
    if (breach.breached) {
      return res
        .status(200)
        .json({ ok: false, reason: "breached", count: breach.count });
    }

    // `checked: false` — сервис утечек не ответил. Пароль принимаем: запереть
    // человека из-за чужого простоя хуже, чем пропустить одну проверку.
    return res.status(200).json({ ok: true, checked: breach.checked });
  } catch (error) {
    next(new AppError("Не удалось проверить пароль", 500, true, error));
  }
};

/**
 * Выход. Настоящий: гасит серверный сеанс, а не полагается на то, что клиент
 * забудет токен. До better-auth такой ручки не существовало вовсе.
 */
exports.logout = async (req, res, next) => {
  try {
    await getAuth().api.signOut({
      headers: getFromNodeHeaders()(req.headers),
      asResponse: false,
    });
    res.status(200).json({ message: "Сеанс завершён" });
  } catch (error) {
    next(new AppError("Не удалось завершить сеанс", 500, true, error));
  }
};
